import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PDFDocument} from 'pdf-lib';
import {addDraftProducts,emptyRun,today,addDays} from '../src/domain.js';
import {stockPrintRows,stockPrintPDF} from '../src/stock-print-pdf.js';

const product=(code,name=code)=>({code,name,unit:'bag: 5 x 200 g',price_cents:8000,active:true,available:true});
const catalog={products:[product('OLD')],routes:[{code:'TEST',name:'TEST ROUTE',weekday:1}]};
const fresh=product('NEW','COUNTRY STYLE MIXED VEGETABLES - BAG (5 X 1KG)');
test('draft additions preserve all existing values and snapshots, stay blank and are idempotent',()=>{
 const run=emptyRun(today(),'TEST',catalog.products);run.items[0].planned=0;run.items[0].loaded=4;run.items[0].returned=1;run.notes='Keep this';run.cash.card=1500;
 const before=structuredClone(run),products=[{...product('OLD'),price_cents:1234},fresh,{...product('OFF'),active:false}];
 const updated=addDraftProducts(run,products,{NEW:{qty:7}});
 assert.deepEqual(run,before);assert.deepEqual(updated.items[0],run.items[0]);
 assert.deepEqual(updated.items[1],{code:'NEW',name:fresh.name,unit:fresh.unit,price_cents:8000,available:true,forecast:{qty:7},planned:null,loaded:null,returned:null,sold_out:null,adjustment:0,adjustment_reason:''});
 assert.deepEqual({...updated,items:[]},{...run,items:[]});assert.deepEqual(addDraftProducts(updated,products),updated);
 for(const phase of ['loaded','returned','closed']){const past={...run,phase};assert.equal(addDraftProducts(past,products),past);}
 const past={...run,date:addDays(today(),-1)};assert.equal(addDraftProducts(past,products),past);
});

test('stock print rows use saved plans, preserve zeros and blank new rows, retain unavailable loaded items',()=>{
 const run=emptyRun(today(),'TEST',[product('OLD'),product('ZERO'),product('LOADED'),product('HIDDEN')]);
 run.items[0].planned=12;run.items[0].loaded=999;run.items[0].returned=222;
 run.items[1].planned=0;run.items[2].planned=8;run.items[2].loaded=3;
 const c={...catalog,products:[product('OLD'),product('ZERO'),{...product('LOADED'),available:false},{...product('HIDDEN'),available:false},fresh]};
 const before=structuredClone(run),rows=stockPrintRows({run},c);
 assert.deepEqual(rows.map(({code,out})=>({code,out})),[{code:'OLD',out:12},{code:'ZERO',out:0},{code:'LOADED',out:3},{code:'NEW',out:null}]);
 assert.deepEqual(run,before);assert.throws(()=>stockPrintRows({run:emptyRun(today(),'TEST',catalog.products)},catalog),/Save your planned/);
});

test('long catalogue names produce one A4 PDF without changing saved quantities',async()=>{
 for(const count of [20,21,39,59]){
  const c={...catalog,products:Array.from({length:count},(_,i)=>product('P'+i,i>count-11?fresh.name:'SYNTHETIC PRODUCT '+i))};
  const run=emptyRun(today(),'TEST',c.products);run.items[0].planned=0;
  const before=structuredClone(run),bytes=await stockPrintPDF({run,revision:1},c),pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),1);assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<.1);assert.ok(Math.abs(pdf.getPage(0).getHeight()-841.89)<.1);
  assert.deepEqual(run,before);assert.ok(bytes.length>1000);
 }
});

test('real Worker adds new draft rows through read/save/refresh while print remains authenticated and read-only',async t=>{
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'catalogue-print-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'catalogue-print'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:'synthetic-print-test-key-012345678901234567890'})},outboundService:()=>{throw Error('No external traffic');}}));
 t.after(()=>mf.dispose());const origin='https://synthetic-print.example';let cookie='';
 const raw=(path,body)=>mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const call=async(path,body)=>{const r=await raw(path,body);return {status:r.status,data:await r.json(),headers:r.headers};};
 const date=addDays(today(),1),path='/api/run?date='+date+'&route=TEST',print='/api/print/stock?date='+date+'&route=TEST';
 assert.equal((await raw(print)).status,401);
 const auth=await call('/api/login',{username:'alex',key:'synthetic-print-test-key-012345678901234567890'});cookie=auth.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/catalog',{revision:0,catalog})).status,200);
 let state=(await call(path)).data;state.run.items[0].planned=17;state.run.notes='Keep manual data';
 state=(await call('/api/run',{run:state.run,revision:0,action:'save',request_id:crypto.randomUUID()})).data;
 const stale=structuredClone(state),db=await mf.getD1Database('DB'),events=async()=>(await db.prepare('SELECT * FROM v2_events ORDER BY revision').all()).results;
 const oldEvents=await events();
 assert.equal((await call('/api/catalog',{revision:1,catalog:{...catalog,products:[...catalog.products,fresh]}})).status,200);
 const read=(await call(path)).data;
 assert.equal(read.revision,1);assert.equal(read.run.items.length,2);assert.deepEqual(read.run.items[0],state.run.items[0]);assert.equal(read.run.items[1].forecast.qty,null);
 assert.deepEqual(await events(),oldEvents,'GET stages rows without a business write');
 const printed=await raw(print);assert.equal(printed.status,200);assert.equal(printed.headers.get('content-type'),'application/pdf');assert.equal(printed.headers.get('cache-control'),'no-store');assert.match(printed.headers.get('content-disposition'),/inline; filename="FenMeat-Stock-/);
 assert.equal((await PDFDocument.load(await printed.arrayBuffer())).getPageCount(),1);assert.deepEqual(await events(),oldEvents,'PDF generation writes no data');
 assert.equal((await raw('/api/print/stock?date='+date+'&route=NOPE')).status,400);
 assert.equal((await raw('/api/print/stock?date='+addDays(date,1)+'&route=TEST')).status,404);
 state=(await call('/api/run',{run:stale.run,revision:stale.revision,action:'save',request_id:crypto.randomUUID()})).data;
 assert.equal(state.run.items.length,2);assert.equal(state.run.items[1].planned,null);assert.equal(state.run.items[1].loaded,null);assert.equal(state.run.items[0].planned,17);
 assert.equal((await call('/api/run',{run:stale.run,revision:1,action:'save',request_id:crypto.randomUUID()})).status,409);
 state=(await call('/api/run',{run:state.run,revision:state.revision,action:'forecast',request_id:crypto.randomUUID()})).data;
 assert.equal(state.run.items.length,2);assert.equal(state.run.items[0].planned,17);assert.equal(state.run.items[1].planned,null);
 state.run.rep='Synthetic rep';state.run.items[0].loaded=17;
 assert.equal((await call('/api/run',{run:state.run,revision:state.revision,action:'load',request_id:crypto.randomUUID()})).status,400,'new products require an actual count or explicit zero');
 state.run.items[1].loaded=0;
 state=(await call('/api/run',{run:state.run,revision:state.revision,action:'load',request_id:crypto.randomUUID()})).data;
 assert.equal((await call('/api/catalog',{revision:2,catalog:{...catalog,products:[...catalog.products,fresh,product('LATER')]}})).status,200);
 assert.deepEqual((await call(path)).data.run,state.run,'confirmed route snapshots are retained');
});

test('stock print opens the in-app preview without navigating or changing unsaved entries',async()=>{
 const vm=await import('node:vm'),source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const click=source.slice(source.indexOf('function printStock('),source.indexOf('\nfunction reconView('));
 const state={result:{run:{date:'2026-10-26',route:'TEST'}},savedRun:{items:[{planned:7}]},dirty:true};
 const notices=[],previews=[],c=vm.createContext({state,notice:x=>notices.push(x),encodeURIComponent,openPrintPreview:x=>previews.push(x)});
 vm.runInContext(click,c);const before=structuredClone(state);c.printStock();
 assert.deepEqual(state,before);assert.equal(previews.length,1);assert.equal(previews[0].unsaved,true);assert.equal(previews[0].url,'/api/print/stock?date=2026-10-26&route=TEST');
 state.savedRun=null;c.printStock();assert.equal(previews.length,1);assert.match(notices[0],/Save a load plan/);
});
