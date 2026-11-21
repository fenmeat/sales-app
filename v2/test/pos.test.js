import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {today} from '../src/domain.js';
import {posPayment} from '../src/pos-domain.js';
import {posDaily,posStockSummary} from '../src/pos-api.js';
import {printPageOptions} from '../public/print-page-options.js';

const products=[{code:'P1',name:'SYNTHETIC PRODUCT',unit:'bag: 5 packs',active:true,available:true,price_cents:10000},{code:'P2',name:'SYNTHETIC DECIMAL',unit:'kg',active:true,available:true,price_cents:1234}];
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],target:'es2022'});
async function fixture(t){
  const names=['alex','alinda','xavier','xalinda','tapiz','mosa','musa','other'],keys=Object.fromEntries(names.map(n=>[n,'SYNTHETIC-pos-test-only-'+n+'-012345678901234567890123456789']));
  const mf=new Miniflare(convertV4MiniflareOptions({name:'pos-isolated-tests',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'pos-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(keys)},outboundService:()=>{throw Error('No external traffic in POS tests.');}}));t.after(()=>mf.dispose());
  const origin='https://fenmeat-sales-test.alexander-fenwick.workers.dev',cookies={};
  async function req(path,body,user='alex',extra={}){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookies[user]??'',...extra},body:body?JSON.stringify(body):undefined});const data=r.headers.get('content-type')?.includes('application/pdf')?new Uint8Array(await r.arrayBuffer()):await r.json();return {status:r.status,data,headers:r.headers};}
  for(const name of names){const r=await req('/api/login',{username:name,key:keys[name]});assert.equal(r.status,200);cookies[name]=r.headers.get('set-cookie').split(';')[0];}
  const catalog={products,routes:[{code:'R03',name:'SYNTHETIC ROAD',weekday:2},{code:'R12',name:'Factory Sales',invoice_stores:[]}]};
  assert.equal((await req('/api/catalog',{revision:0,catalog})).status,200);
  const db=await mf.getD1Database('DB');
  const body=(extra={})=>({id:crypto.randomUUID(),request_id:crypto.randomUUID(),revision:0,action:'save',customer_id:null,lines:[{code:'P1',qty:1000}],...extra});
  async function draft(user='alex',extra={}){const b=body(extra),r=await req('/api/pos/sale',b,user);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.sale;}
  const pay=(sale,payment={cash_tendered:sale.total,card:0,shop2shop:0,received:true})=>({id:sale.id,revision:sale.revision,request_id:crypto.randomUUID(),action:'complete',captured_at:new Date().toISOString(),payment});
  return {req,db,body,draft,pay,catalog};
}
test('full split settlement computes exact cash/change and requires approved external payments',()=>{
  assert.deepEqual(posPayment({cash_tendered:10000,card:3000,shop2shop:2000,received:true,card_approved:true,shop2shop_reference:'SYNTHETIC-123'},10000),{cash:5000,cash_tendered:10000,change:5000,card:3000,shop2shop:2000,received:true,card_approved:true,card_reference:'',shop2shop_reference:'SYNTHETIC-123'});
  for(const p of [{cash_tendered:9999,card:0,shop2shop:0,received:true},{cash_tendered:0,card:10000,shop2shop:0,received:true},{cash_tendered:0,card:0,shop2shop:10000,received:true},{cash_tendered:0,card:11000,shop2shop:0,received:true,card_approved:true},{cash_tendered:-1,card:0,shop2shop:0,received:true},{cash_tendered:10000,card:0,shop2shop:0,received:false}])assert.throws(()=>posPayment(p,10000));
});
test('all four cashiers sell concurrently without route starts; totals and stock count each paid sale once',async t=>{
  const f=await fixture(t),names=['alex','alinda','xavier','xalinda'];
  const sales=await Promise.all(names.map(name=>f.draft(name)));
  const payments=[{cash_tendered:15000,card:0,shop2shop:0,received:true},{cash_tendered:0,card:10000,shop2shop:0,received:true,card_approved:true},{cash_tendered:0,card:0,shop2shop:10000,received:true,shop2shop_reference:'SYNTHETIC-S2S-1'},{cash_tendered:5000,card:3000,shop2shop:2000,received:true,card_approved:true,shop2shop_reference:'SYNTHETIC-S2S-2'}];
  const requests=sales.map((s,i)=>f.pay(s,payments[i]));
  const result=await Promise.all(requests.map((b,i)=>f.req('/api/pos/sale',b,names[i])));
  result.forEach(r=>assert.equal(r.status,200,JSON.stringify(r.data)));
  assert.equal(new Set(result.map(r=>r.data.sale.number)).size,4);
  for(let i=0;i<4;i++){const replay=await f.req('/api/pos/sale',requests[i],names[i]);assert.equal(replay.data.replayed,true);assert.equal(replay.data.sale.actor,names[i]);}
  const report=await posDaily(f.db,today());assert.deepEqual(report.totals,{sales:4,total:40000,cash:15000,card:13000,shop2shop:12000,change:5000});assert.equal(report.staff.length,4);assert.equal(report.stock.items[0].qty,4000);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM v2_pos_stock').first()).n,4);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM v2_invoice_sessions').first()).n,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM v2_invoice_events').first()).n,0);
});
test('factory permissions cover every read, write and PDF; draft ownership and same-origin checks are enforced',async t=>{
  const f=await fixture(t),sale=await f.draft('xavier'),complete=f.pay(sale);
  for(const user of ['tapiz','mosa','musa','other','unsigned']){
    const expected=user==='unsigned'?401:403;
    for(const path of ['/api/pos/bootstrap','/api/pos/customers','/api/pos/daily','/api/pos/sales','/api/pos/sale?id='+sale.id,'/api/pos/receipt?id='+sale.id])assert.equal((await f.req(path,null,user)).status,expected,user+' '+path);
    for(const [path,body] of [['/api/pos/sale',complete],['/api/pos/customers',{id:crypto.randomUUID(),name:'SYNTHETIC'}]])assert.equal((await f.req(path,body,user)).status,expected);
  }
  assert.equal((await f.req('/api/pos/sale',complete,'alinda')).status,403);
  assert.equal((await f.req('/api/pos/sale?id='+sale.id,null,'alinda')).status,404);
  assert.equal((await f.req('/api/pos/sale',complete,'xavier',{Origin:'https://other.example'})).status,403);
  assert.equal((await f.req('/api/pos/sale',complete,'xavier')).status,200);
  for(const user of ['alex','alinda','xavier','xalinda'])assert.equal((await f.req('/api/pos/sale?id='+sale.id,null,user)).status,200);
});
test('unpaid drafts, rejected cards and duplicate payment references never issue stock or book money',async t=>{
  const f=await fixture(t),sale=await f.draft();
  for(const payment of [{cash_tendered:9999,card:0,shop2shop:0,received:true},{cash_tendered:0,card:10000,shop2shop:0,received:true},{cash_tendered:0,card:0,shop2shop:10000,received:true}])assert.equal((await f.req('/api/pos/sale',f.pay(sale,payment))).status,400);
  assert.equal((await posDaily(f.db,today())).totals.sales,0);assert.equal((await posStockSummary(f.db,today())).items.length,0);
  const payment={cash_tendered:0,card:0,shop2shop:10000,received:true,shop2shop_reference:'SYNTHETIC-DUPLICATE'};
  assert.equal((await f.req('/api/pos/sale',f.pay(sale,payment))).status,200);
  const other=await f.draft('xalinda');assert.equal((await f.req('/api/pos/sale',f.pay(other,payment),'xalinda')).status,409);
  assert.equal((await f.req('/api/pos/sale?id='+other.id,null,'xalinda')).data.sale.status,'draft');
  assert.equal((await posDaily(f.db,today())).totals.sales,1);assert.equal((await posStockSummary(f.db,today())).items[0].qty,1000);
});
test('racing completions and stale draft edits have a single atomic winner; altered retries are rejected',async t=>{
  const f=await fixture(t),sale=await f.draft(),b=f.pay(sale);
  const results=await Promise.all([f.req('/api/pos/sale',b),f.req('/api/pos/sale',b),f.req('/api/pos/sale',{...b,request_id:crypto.randomUUID()})]);
  assert.ok(results.every(r=>[200,409].includes(r.status)));assert.equal((await posDaily(f.db,today())).totals.sales,1);assert.equal((await posStockSummary(f.db,today())).items[0].qty,1000);
  assert.equal((await f.req('/api/pos/sale',{...b,payment:{...b.payment,cash_tendered:11000}})).status,409);
  const d=await f.draft(),a={...f.body(),id:d.id,revision:d.revision,lines:[{code:'P2',qty:1250,price:1}]};
  const edit=await f.req('/api/pos/sale',a);assert.equal(edit.data.sale.total,1543);assert.equal(edit.data.sale.lines[0].price,1234);
  assert.equal((await f.req('/api/pos/sale',{...a,request_id:crypto.randomUUID()})).status,409);
  const cancelled=await f.req('/api/pos/sale',{id:d.id,revision:2,action:'cancel',request_id:crypto.randomUUID()});assert.equal(cancelled.data.sale.status,'cancelled');
  assert.equal((await posDaily(f.db,today())).totals.sales,1);
});
test('named customer history and PDF use saved snapshots, while new walk-ins have no pooled debt',async t=>{
  const f=await fixture(t),id=crypto.randomUUID(),customer={id,name:'SYNTHETIC TEST CUSTOMER',phone:'0821234567'};
  const created=await f.req('/api/pos/customers',customer);assert.equal(created.status,200);assert.equal(created.data.customer.phone,'+27821234567');
  assert.equal((await f.req('/api/pos/customers',customer)).status,200);
  const s=await f.draft('alex',{customer_id:id});const completed=await f.req('/api/pos/sale',f.pay(s));assert.equal(completed.status,200);
  const history=await f.req('/api/pos/sales?customer='+id);assert.equal(history.data.sales.length,1);assert.equal(history.data.sales[0].customer.id,id);
  const pdf=await f.req('/api/pos/receipt?id='+s.id);assert.equal(pdf.status,200);assert.equal((await PDFDocument.load(pdf.data)).getPageCount(),1);
  const options=printPageOptions('document=pos&id='+s.id);assert.equal(options.url,'/api/pos/receipt?id='+s.id);assert.equal(options.returnPath,'/pos');
  assert.throws(()=>printPageOptions('document=pos&id=../../api/private'));
  const walkin=await f.draft();assert.equal(walkin.customer.id,null);assert.equal(walkin.customer.name,'Walk-in customer');assert.equal((await f.req('/api/pos/sale',f.pay(walkin))).status,200);
  assert.equal((await f.req('/api/invoicing/start',{route:'R12',device:'synthetic-pos-phone-00001',date:today(),cutover_ack:true})).status,409);
});
test('delayed payment retries retain the original South African sale day and reject invalid capture times',async t=>{
  const f=await fixture(t),sale=await f.draft(),created=new Date(Date.now()-2*86400000).toISOString();
  await f.db.prepare("UPDATE v2_pos_sales SET payload=json_set(payload,'$.created_at',?) WHERE id=?").bind(created,sale.id).run();
  const b=f.pay(sale);b.captured_at=new Date(Date.now()-86400000).toISOString();
  const future={...b,request_id:crypto.randomUUID(),captured_at:new Date(Date.now()+86400000).toISOString()};assert.equal((await f.req('/api/pos/sale',future)).status,400);
  const saved=await f.req('/api/pos/sale',b);assert.equal(saved.status,200,JSON.stringify(saved.data));const day=new Date(Date.parse(b.captured_at)+7200000).toISOString().slice(0,10);
  assert.equal(saved.data.sale.date,day);assert.equal((await posDaily(f.db,today())).totals.sales,0);assert.equal((await posDaily(f.db,day)).totals.sales,1);
  assert.equal((await f.req('/api/pos/sale',b)).data.replayed,true);assert.equal((await posStockSummary(f.db,day)).items[0].qty,1000);
});
