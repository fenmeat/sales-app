import test from 'node:test';
import {inflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PDFDocument} from 'pdf-lib';
import {productionStaffPDF} from '../src/production-print-pdf.js';
import {buildProductionPlan,productionProfile} from '../src/production.js';
import {today,addDays} from '../src/domain.js';

function pdfText(pdf){
 return pdf.getPages().map(page=>page.node.Contents().asArray().map(ref=>{
  const stream=pdf.context.lookup(ref),content=inflateSync(stream.getContents()).toString();
  return [...content.matchAll(/<([A-Fa-f0-9]+)> Tj/g)].map(m=>Buffer.from(m[1],'hex').toString('latin1')).join(' ');
 }).join(' ')).join(' ');
}

function fixture(count=17){
 const products=Array.from({length:count},(_,i)=>({code:'TEST'+i,name:'SYNTHETIC PRODUCT '+i,unit:'bag',price_cents:100,active:true,available:true}));
 const catalog={products,routes:[{code:'TEST',name:'TEST ROUTE',weekday:1}]};
 const plan=buildProductionPlan({date:today(),target_date:addDays(today(),1),routes:['TEST'],snapshot:'test',items:products.map(p=>({...p,demand:100,breakdown:[],...productionProfile(p),yield_qty:10}))});
 for(const g of plan.groups)g.planned=2;
 for(const i of plan.items){i.actual=999;i.stock=0;}
 return {saved:{plan,revision:7},catalog};
}
test('production PDF retains the saved plan and fits ordinary work on one A4 page',async()=>{
 const f=fixture(),before=structuredClone(f);
 f.saved.plan.notes='Use saved plan. Check \u2192 final packing \u{1F44D}';
 before.saved.plan.notes=f.saved.plan.notes;
 const pdf=await PDFDocument.load(await productionStaffPDF(f.saved,f.catalog));
 assert.equal(pdf.getPageCount(),1);assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<.1);assert.ok(Math.abs(pdf.getPage(0).getHeight()-841.89)<.1);
 assert.deepEqual(f,before);assert.doesNotMatch(pdfText(pdf),/999/);assert.match(pdfText(pdf),/Saved revision 7/);
});
test('oversized production plans continue onto readable A4 pages without dropping rows or notes',async()=>{
 const f=fixture(100);f.saved.plan.notes=('Keep all saved notes. ').repeat(60);
 f.saved.plan.trolleys=Array.from({length:30},(_,i)=>({id:'synthetic-'+i,slot1:'',slot2:'',casings:{P02:0,P03:0,P04:0}}));
 const before=structuredClone(f),pdf=await PDFDocument.load(await productionStaffPDF(f.saved,f.catalog));
 for(let i=0;i<100;i++)assert.ok(pdfText(pdf).includes('SYNTHETIC PRODUCT '+i));assert.equal((pdfText(pdf).match(/Keep all saved notes\./g)||[]).length,60);
 assert.ok(pdf.getPageCount()>1);assert.ok(pdf.getPageCount()<12);assert.deepEqual(f,before);
 for(const page of pdf.getPages())assert.ok(Math.abs(page.getHeight()-841.89)<.1);
});
test('production PDF endpoint reads the latest persisted revision, authenticates and does not refresh or write plans',async t=>{
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'production-pdf-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'production-pdf'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:'synthetic-production-print-key-0123456789'})},outboundService:()=>{throw Error('No external traffic');}}));
 t.after(()=>mf.dispose());const origin='https://synthetic-production.example';let cookie='';
 const raw=(path,body)=>mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const date=today(),path='/api/print/production?date='+date;
 assert.equal((await raw(path)).status,401);
 const auth=await raw('/api/login',{username:'alex',key:'synthetic-production-print-key-0123456789'});cookie=auth.headers.get('set-cookie').split(';')[0];
 const f=fixture(2);assert.equal((await raw('/api/catalog',{revision:0,catalog:f.catalog})).status,200);
 assert.equal((await raw(path)).status,404,'unsaved suggestions are never printed');
 const db=await mf.getD1Database('DB');
 for(const revision of [1,2]){
  const plan=structuredClone(f.saved.plan);plan.groups[0].planned=revision;
  await db.prepare('INSERT INTO v2_production_events(request_id,request_hash,production_date,revision,action,payload,actor,saved_at) VALUES(?,?,?,?,?,?,?,?)').bind('synthetic-revision-'+revision,'hash',date,revision,'save',JSON.stringify(plan),'alex',new Date().toISOString()).run();
 }
 const events=async()=>(await db.prepare('SELECT * FROM v2_production_events ORDER BY revision').all()).results;
 const before=await events(),response=await raw(path),pdf=await PDFDocument.load(await response.arrayBuffer());
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition'),/inline; filename="FenMeat-Production-/);assert.equal(pdf.getPageCount(),1);
 assert.deepEqual(await events(),before);assert.match(pdfText(pdf),/Saved revision 2/);assert.doesNotMatch(pdfText(pdf),/Saved revision 1/);
 assert.equal(response.headers.get('x-fenmeat-print-revision'),'2');
 const pinned=await raw(path+'&revision=1');assert.equal(pinned.status,200);assert.equal(pinned.headers.get('x-fenmeat-print-revision'),'1');
 assert.match(pdfText(await PDFDocument.load(await pinned.arrayBuffer())),/Saved revision 1/);
 assert.equal((await raw(path+'&revision=999')).status,404);assert.equal((await raw(path+'&revision=0')).status,400);
 assert.equal((await raw(path+'&revision=1e2')).status,400);assert.deepEqual(await events(),before);
 assert.equal((await raw('/api/print/production?date=bad')).status,400);
 assert.equal((await raw('/api/print/production?date='+addDays(date,1))).status,404);
 assert.equal((await raw(path,{})).status,404);
});
test('staff print opens the in-app preview and retains unsaved plans',async()=>{
 const vm=await import('node:vm'),source=await readFile(new URL('../public/production-app.js',import.meta.url),'utf8');
 const click=source.slice(source.indexOf('function printStaffSheet('),source.indexOf("window.addEventListener('beforeunload'"));
 const state={saved:{plan:{groups:[{planned:2}]}},result:{plan:{date:'2026-10-26'}},dirty:true,selection:null},before=structuredClone(state),notices=[],previews=[];
 const c=vm.createContext({state,notice:x=>notices.push(x),encodeURIComponent,openPrintPreview:x=>previews.push(x)});vm.runInContext(click,c);c.printStaffSheet();
 assert.equal(previews.length,1);assert.equal(previews[0].url,'/api/print/production?date=2026-10-26');assert.equal(previews[0].unsaved,true);assert.deepEqual(state,before);
 state.saved=null;c.printStaffSheet();assert.equal(previews.length,1);assert.match(notices[0],/Save your production plan/);
});
