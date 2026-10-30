import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PDFDocument} from 'pdf-lib';
import {today,addDays} from '../src/domain.js';

function pdfText(pdf){
 return pdf.getPages().map(page=>page.node.Contents().asArray().map(ref=>{
  const content=inflateSync(pdf.context.lookup(ref).getContents()).toString();
  return [...content.matchAll(/<([A-Fa-f0-9]+)> Tj/g)].map(m=>Buffer.from(m[1],'hex').toString('latin1')).join(' ');
 }).join(' ')).join(' ');
}

test('stocktake PDF is a private, date-specific, revision-pinned read for existing stocktake users only',async t=>{
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false});
 const users=['alex','alinda','xavier','xalinda','other','tapiz'];
 const access=Object.fromEntries(users.map(name=>[name,('synthetic-pdf-'+name+'-').padEnd(64,'x')]));
 const mf=new Miniflare(convertV4MiniflareOptions({name:'stocktake-summary-pdf-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'stocktake-summary-pdf'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(access)},outboundService:()=>{throw Error('No external traffic in stocktake PDF tests');}}));
 t.after(()=>mf.dispose());
 const origin='https://synthetic-stocktake-pdf.example',date=today();
 const endpoint=(supplier='test supplier',countDate=date,revision)=>'/api/print/stocktake?'+new URLSearchParams({date:countDate,supplier,...(revision===undefined?{}:{revision:String(revision)})});
 const raw=(path,{cookie='',body,method=body===undefined?'GET':'POST'}={})=>mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await raw(endpoint())).status,401);
 const cookies={};
 for(const name of users){
  const response=await raw('/api/login',{body:{username:name,key:access[name]}});
  assert.equal(response.status,200,response.ok?'':await response.text());
  cookies[name]=response.headers.get('set-cookie').split(';')[0];
 }
 assert.equal((await raw(endpoint(),{cookie:cookies.alex})).status,404,'an unsaved supplier register is not a printable count');
 const db=await mf.getD1Database('DB');
 const catalog={products:[{code:'B01',name:'Synthetic catalogue product',unit:'box',price_cents:54321,active:true,available:true}],routes:[{code:'TEST',name:'Synthetic route',weekday:1}]};
 assert.equal((await raw('/api/catalog',{cookie:cookies.alex,body:{revision:0,catalog}})).status,200);
 const material=(id,name,qty,{supplier='Test supplier',pack=25,countDate=qty===null?null:date,availableFrom=countDate}={})=>({
  id,name,supplier,unit:'kg',pack_qty:pack,procure:true,notes:'SECRET_MATERIAL_NOTE',source:'SECRET_INVOICE_SOURCE',
  price:{amount:65432.1,status:'verified',date,valid_until:null,source:'SECRET_PRICE_SOURCE'},
  stock:{qty,date:countDate,available_from:availableFrom,reserve:qty===null?null:0,incoming:[],source:'SECRET_COUNT_SOURCE',...(qty===null||pack===null?{}:{count:{packs:qty/pack,loose:0,pack_qty:pack,unit:'kg'}})}
 });
 for(const revision of [1,2]){
  const counted=material('CURRENT',revision===1?'Revision one stock':'Revision two stock',revision*25);
  counted.stock.reserve=1;
  counted.stock.incoming=[{date:addDays(date,1),qty:88888,reference:'SECRET_INCOMING_PO'}];
  const register={schema_version:1,notes:'SECRET_REGISTER_NOTE',recipes:[{name:'SECRET_RECIPE_FORMULA'}],packaging:[{source:'SECRET_PACKAGING_SOURCE'}],materials:[
   counted,
   material('ZERO','Synthetic zero',0,{pack:null}),
   material('UNKNOWN','Synthetic unknown',null),
   material('OLD','Synthetic earlier count',98765,{pack:null,countDate:addDays(date,-2)}),
   material('LATER','Available later',75,{availableFrom:addDays(date,1)}),
   {...material('RETIRED','Excluded non-purchased item',25),procure:false},
   {...material('UNAVAILABLE','Excluded unavailable resale',25),resale_available:false},
   material('OTHER','Other supplier item',25,{supplier:'Other supplier'}),
   material('UNASSIGNED','Unassigned supplier item',14,{supplier:'',pack:7})
  ]};
  await db.prepare('INSERT INTO v2_recipe_events(request_id,request_hash,revision,payload,actor,saved_at,reason) VALUES(?,?,?,?,?,?,?)').bind('synthetic-pdf-revision-'+revision,'synthetic-hash',revision,JSON.stringify(register),'alex',date+'T08:00:00Z','Synthetic stocktake PDF fixture').run();
 }
 await db.prepare('INSERT INTO v2_task_events(request_id,fingerprint,task_id,revision,action,payload,actor,saved_at) VALUES(?,?,?,?,?,?,?,?)').bind('synthetic-task-event','synthetic-fingerprint','synthetic-count-task',1,'create',JSON.stringify({id:'synthetic-count-task',kind:'stocktake',supplier:'test supplier',due_date:date,assigned_to:'xavier',status:'Pending'}),'alex',date+'T08:00:00Z').run();
 const businessSnapshot=async()=>{
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v2_%' AND name NOT IN ('v2_sessions','v2_auth_limits') ORDER BY name").all()).results;
  return Object.fromEntries(await Promise.all(tables.map(async({name})=>[name,(await db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()).results])));
 };
 const before=await businessSnapshot();
 const readPDF=async(path,cookie)=>{
  const response=await raw(path,{cookie});
  assert.equal(response.status,200,response.ok?'':await response.text());
  assert.equal(response.headers.get('content-type'),'application/pdf');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-disposition'),/^inline; filename="FenMeat-Stocktake-[A-Za-z0-9._-]+\.pdf"$/);
  const pdf=await PDFDocument.load(await response.arrayBuffer());
  assert.equal(pdf.getPageCount(),1);
  assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<.1);
  assert.ok(Math.abs(pdf.getPage(0).getHeight()-841.89)<.1);
  return {text:pdfText(pdf),revision:response.headers.get('x-fenmeat-print-revision')};
 };
 for(const name of ['alex','alinda','xavier','xalinda']){
  const latest=await readPDF(endpoint(),cookies[name]);
  assert.equal(latest.revision,'2');
  assert.match(latest.text,/Revision two stock/);
  assert.doesNotMatch(latest.text,/Revision one stock/);
  for(const product of ['Synthetic zero','Synthetic unknown','Synthetic earlier count','Available later'])assert.ok(latest.text.includes(product),product+' must remain visible');
  assert.match(latest.text,/Synthetic zero\s+0(?:\s|$)/,'explicit zero remains distinguishable from a missing count');
  assert.ok((latest.text.match(/Not counted/g)??[]).length>=2,'unknown and wrong-date stock are marked uncounted for the selected date');
  assert.doesNotMatch(latest.text,/98765|98[ ,]765|88888|88[ ,]888|SECRET_|65432|65[ ,]432|54321|54[ ,]321/,'old-date values, incoming, prices, sources and formulas are not exposed');
  assert.doesNotMatch(latest.text,/Excluded non-purchased item|Excluded unavailable resale|Other supplier item|Unassigned supplier item/);
 }
 const historical=await readPDF(endpoint('test supplier',date,1),cookies.xavier);
 assert.equal(historical.revision,'1');
 assert.match(historical.text,/Revision one stock/);assert.doesNotMatch(historical.text,/Revision two stock/);
 const normalized=await readPDF(endpoint('Test supplier',date,2),cookies.alex);
 assert.match(normalized.text,/Revision two stock/,'supplier capitalization follows the existing grouping rule');
 const unassigned=await readPDF(endpoint('',date,2),cookies.xalinda);
 assert.match(unassigned.text,/Unassigned supplier item/);assert.doesNotMatch(unassigned.text,/Revision two stock/);
 const resale=await readPDF(endpoint("brito's",date,2),cookies.alinda);
 assert.match(resale.text,/Superbraai Box/);assert.match(resale.text,/Not counted/,'current resale mapping cannot invent a physical count');
 for(const name of ['other','tapiz'])assert.equal((await raw(endpoint(),{cookie:cookies[name]})).status,403,name+' has no stocktake PDF access');
 for(const path of [
  '/api/print/stocktake?date='+date,
  endpoint('missing supplier'),
  endpoint('test supplier\nInjected'),
  endpoint('test supplier','bad'),
  endpoint('test supplier','2026-02-30'),
  endpoint('test supplier',addDays(date,1)),
  endpoint('test supplier',date,0),
  endpoint('test supplier',date,'1e2'),
  endpoint('test supplier',date,'9007199254740992')
 ])assert.equal((await raw(path,{cookie:cookies.alex})).status,400,path);
 assert.equal((await raw(endpoint('test supplier',date,999),{cookie:cookies.alex})).status,404,'a missing pinned revision cannot silently fall back');
 assert.ok([404,405].includes((await raw(endpoint(),{cookie:cookies.alex,body:{}})).status),'the summary endpoint cannot save counts');
 assert.deepEqual(await businessSnapshot(),before,'PDF reads, rejected requests and staff access leave all business rows and count tasks unchanged');
});
