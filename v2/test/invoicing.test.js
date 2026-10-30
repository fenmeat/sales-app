import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {applyInvoiceCommand,openingAccount,accountSummary,parseAmount,parseQuantity} from '../src/invoice-domain.js';
import {today} from '../src/domain.js';
import {verifyInvoiceReconciliation,readInvoicePilot} from '../src/invoice-api.js';
const date=today(),products=[{code:'P1',name:'Product',unit:'bag',active:true,available:true,price_cents:10000}],id='9001001';
const store={id,name:'SYNTHETIC TEST SHOP',stop:1,route:'R03',terms:7,opening:{customer_id:id,complete:true,balance_cents:10000,invoices:[{id:'old1',customer_id:id,number:'SYNTHETIC-OLD',date:'2020-01-01',due_date:'2020-01-08',total:15000,balance:10000}],generated_at:new Date().toISOString(),drafts:[]}};
const ctx={date,actor:'alex',admin:true,session:1,products,invoiceId:'FM-1-1',invoiceNumber:'SYNTHETIC-NEW'};
const command=(a,action,extra={})=>({action,customer_id:id,request_id:crypto.randomUUID(),revision:a.revision,captured_at:new Date().toISOString(),...extra});
const paid=()=>{const a=openingAccount(store);return applyInvoiceCommand(a,command(a,'collect',{cash:10000,shop2shop:0,received:true}),ctx);};
test('exact money and quantity entry accepts decimal commas and rejects ambiguous values',()=>{
 assert.equal(parseAmount('12,34'),1234);assert.equal(parseAmount('0'),0);for(const s of ['', '-1','NaN','1e2','1.234','1,234.50'])assert.equal(parseAmount(s),null);assert.equal(parseQuantity('1,25'),1250);assert.equal(parseQuantity('0.001'),1);
});
test('older debt and partial receipts gate new sales; no paid toggle or invented zero',()=>{
 let a=openingAccount(store);assert.throws(()=>openingAccount({...store,opening:null}));
 assert.throws(()=>applyInvoiceCommand(a,command(a,'issue',{lines:[{code:'P1',qty:1000,checked:true}],cash:0,shop2shop:0}),ctx),/previous/);
 a=applyInvoiceCommand(a,command(a,'collect',{cash:2500,shop2shop:2500,reference:'SYNTHETIC-S2S',received:true}),ctx);assert.equal(accountSummary(a).balance,5000);assert.equal(a.receipts.length,1);
 assert.throws(()=>applyInvoiceCommand(a,command(a,'collect',{cash:0,shop2shop:1000,reference:'SYNTHETIC-S2S',received:true}),ctx),/already/);
 assert.throws(()=>applyInvoiceCommand(a,command(a,'collect',{cash:5001,shop2shop:0,received:true}),ctx),/exceeds/);
});
test('server catalogue prices, delivery checks, cash-only and approved credit are enforced',()=>{
 let a=paid(),c=command(a,'issue',{lines:[{code:'P1',qty:1000,checked:true,price:1}],cash:4000,shop2shop:0,received:true});
 for(const terms of [null,0])assert.throws(()=>applyInvoiceCommand({...a,terms},c,ctx),/credit|full/);
 assert.throws(()=>applyInvoiceCommand(a,{...c,lines:[{code:'P1',qty:1000,checked:false}]},ctx),/Check/);
 assert.throws(()=>applyInvoiceCommand(a,{...c,received:false},ctx),/actually/);
 a=applyInvoiceCommand(a,c,ctx);const i=accountSummary(a).invoices.at(-1);assert.equal(i.total,10000);assert.equal(i.balance,6000);assert.equal(i.due,new Date(Date.parse(date+'T12:00:00Z')+7*86400000).toISOString().slice(0,10));assert.equal(i.lines[0].price,10000);
});
test('cash-only Shop2Shop and partial-payment edits preserve history and reject unsupported refunds',()=>{
 let a={...paid(),terms:0};a=applyInvoiceCommand(a,command(a,'issue',{lines:[{code:'P1',qty:1000,checked:true}],cash:0,shop2shop:10000,reference:'SYNTHETIC-PAID',received:true}),ctx);
 assert.throws(()=>applyInvoiceCommand(a,command(a,'revise',{invoice_id:ctx.invoiceId,invoice_version:1,lines:[{code:'P1',qty:500,checked:true}],reason:'Returned half',returned:true}),ctx),/refund/);
 a=applyInvoiceCommand(a,command(a,'revise',{invoice_id:ctx.invoiceId,invoice_version:1,lines:[{code:'P1',qty:2000,checked:true}],reason:'Extra bag',cash:10000,shop2shop:0,received:true}),ctx);
 const i=accountSummary(a).invoices.at(-1);assert.equal(i.total,20000);assert.equal(i.balance,0);assert.equal(i.history.length,1);assert.equal(i.history[0].total,10000);assert.equal(i.version,2);
});
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],target:'es2022'});
async function fixture(t){
 const key='SYNTHETIC-only-key-012345678901234567890123456789';
 const mf=new Miniflare(convertV4MiniflareOptions({name:'invoice-isolated-tests',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'invoices-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key,mosa:key+'m',xavier:key+'x'})},outboundService:()=>{throw Error('No external traffic in financial tests.');}}));t.after(()=>mf.dispose());
 const origin='https://fenmeat-sales-test.alexander-fenwick.workers.dev';
 async function req(path,body,cookie=''){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};}
 async function login(user='alex'){const r=await req('/api/login',{username:user,key:key+({alex:'',mosa:'m',xavier:'x'}[user])});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
 const cookie=await login(),cat={products,routes:[{code:'R03',name:'RIVERSDALE',weekday:2,invoice_stores:[store]}]};assert.equal((await req('/api/catalog',{revision:0,catalog:cat},cookie)).status,200);
 const device='synthetic-phone-0000000000001';
 const start=await req('/api/invoicing/start',{route:'R03',date,device,cutover_ack:true},cookie);assert.equal(start.status,200,JSON.stringify(start.data));const session=start.data.session;
 let seq=0,a=openingAccount(store);
 function body(action,extra={}){return {route:'R03',device,session_id:session.id,sequence:++seq,command:command(a,action,extra)};}
 async function send(b){const r=await req('/api/invoicing/command',b,cookie);if(r.status===200)a=r.data.account;return r;}
 return {mf,req,login,cookie,device,session,body,send,get a(){return a;}};
}
test('real workerd/D1 persists atomically, protects replay and concurrent route access, rejects unauthorised reads',async t=>{
 const f=await fixture(t);
 assert.equal((await f.req('/api/invoicing/bootstrap')).status,401);
 assert.equal((await f.req('/api/invoicing/bootstrap',undefined,await f.login('xavier'))).status,403);
 const boot=await f.req('/api/bootstrap',undefined,await f.login('xavier'));assert.equal(boot.status,200);assert.equal(boot.data.catalog.routes[0].invoice_stores,undefined);
 const other=await f.req('/api/invoicing/start',{route:'R03',date,device:'synthetic-phone-0000000000002',cutover_ack:true},f.cookie);assert.equal(other.status,409);
 const b=f.body('collect',{cash:10000,shop2shop:0,received:true});let r=await f.send(b);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(accountSummary(r.data.account).balance,0);
 r=await f.send(b);assert.equal(r.status,200);assert.equal(r.data.replayed,true);assert.equal(r.data.account.receipts.length,1);
 r=await f.send({...b,command:{...b.command,cash:5000}});assert.equal(r.status,409);
 const issue=f.body('issue',{lines:[{code:'P1',qty:1000,checked:true}],cash:1000,shop2shop:0,received:true});
 const attempts=await Promise.all([f.send(issue),f.send({...issue,command:{...issue.command,request_id:crypto.randomUUID()}})]);assert.equal(attempts.filter(x=>x.status===200).length,1);
 const fresh=await f.req('/api/invoicing/bootstrap',undefined,await f.login());assert.equal(fresh.status,200);assert.equal(fresh.data.accounts[id].invoices.length,2);assert.equal(accountSummary(fresh.data.accounts[id]).balance,9000);assert.equal(fresh.data.accounts[id].receipts.length,2);
 const wrong=await f.req('/api/invoicing/finish',{route:'R03',device:f.device,session_id:f.session.id,sequence:1},f.cookie);assert.equal(wrong.status,409);
 const closed=await f.req('/api/invoicing/finish',{route:'R03',device:f.device,session_id:f.session.id,sequence:2},f.cookie);assert.equal(closed.status,200);
 const after=f.body('name',{name:'After close'});r=await f.send(after);assert.equal(r.status,409);
 const exported=await f.req('/api/invoicing/export?from='+date+'&to='+date,undefined,f.cookie);assert.equal(exported.data.events.length,2);
});
test('offline sequence can be replayed in order after reconnection without losing receipts or final balance',async t=>{
 const f=await fixture(t);let a=openingAccount(store),sequence=0;const queue=[];
 for(const [action,extra] of [['collect',{cash:6000,shop2shop:4000,reference:'SYNTHETIC-OFFLINE',received:true}],['issue',{lines:[{code:'P1',qty:2000,checked:true}],cash:5000,shop2shop:0,received:true}]]){
  const c=command(a,action,extra),seq=++sequence;a=applyInvoiceCommand(a,c,{...ctx,session:f.session.id,invoiceId:`FM-${f.session.id}-${seq}`,invoiceNumber:`FM-${date.replaceAll('-','')}-${f.session.id}-${String(seq).padStart(3,'0')}`});queue.push({route:'R03',device:f.device,session_id:f.session.id,sequence:seq,command:c});
 }
 assert.equal(accountSummary(a).balance,15000);
 assert.equal((await f.send(queue[1])).status,409);
 for(const b of queue){assert.equal((await f.send(b)).status,200);assert.equal((await f.send(b)).status,200);}
 const result=await f.req('/api/invoicing/bootstrap',undefined,f.cookie);assert.deepEqual(result.data.accounts[id],a);assert.equal(result.data.session.sequence,2);
});
test('closed native ledger reconciles edited quantities and actual split receipts including old debt',async t=>{
 const f=await fixture(t),url='/api/invoicing/reconciliation?date='+date+'&route=R03';
 assert.equal((await f.req(url,undefined,f.cookie)).status,409);
 assert.equal((await f.send(f.body('collect',{cash:6000,shop2shop:4000,reference:'SYNTHETIC-RECON',received:true}))).status,200);
 assert.equal((await f.send(f.body('issue',{lines:[{code:'P1',qty:2000,checked:true}],cash:5000,shop2shop:0,received:true}))).status,200);
 const invoice=f.a.invoices.at(-1);
 assert.equal((await f.send(f.body('revise',{invoice_id:invoice.id,invoice_version:1,lines:[{code:'P1',qty:1000,checked:true}],cash:0,shop2shop:0,reason:'One bag not delivered',returned:true}))).status,200);
 assert.equal((await f.req('/api/invoicing/finish',{route:'R03',device:f.device,session_id:f.session.id,sequence:3},f.cookie)).status,200);
 const r=await f.req(url,undefined,f.cookie);assert.equal(r.status,200,JSON.stringify(r.data));const recon=r.data;
 assert.equal(recon.invoice_lines.length,1);assert.equal(recon.invoice_lines[0].qty,1);assert.equal(recon.invoice_lines[0].status,'partially_paid');
 assert.equal(recon.payments.filter(p=>p.method==='cash').reduce((n,p)=>n+p.cents,0),11000);
 assert.equal(recon.payments.filter(p=>p.method==='shop2shop').reduce((n,p)=>n+p.cents,0),4000);
 assert.equal(recon.payments.filter(p=>p.invoice_date==='2020-01-01').reduce((n,p)=>n+p.cents,0),10000);
 const db=await f.mf.getD1Database('DB');await verifyInvoiceReconciliation(db,recon);
 const forged=structuredClone(recon);forged.invoice_lines[0].qty=20;await assert.rejects(verifyInvoiceReconciliation(db,forged),/edited/);
 const report=await readInvoicePilot(db,{routes:[{code:'R03',invoice_stores:[store]}]});assert.equal(report.balances_loaded,1);assert.equal(report.total_balance_cents,5000);assert.equal(report.accounts[0].receipt_count,2);
});
test('route imports use the latest opening, protect active routes and preserve accounts already used',async t=>{
 const f=await fixture(t),db=await f.mf.getD1Database('DB');
 const cat={products:structuredClone(products),routes:[{code:'R03',name:'RIVERSDALE',weekday:2,invoice_stores:[structuredClone(store)]}]};
 const old={...store.opening,generated_at:'2020-01-01T00:00:00.000Z'};
 await db.prepare('INSERT INTO v2_invoice_balances VALUES(?,?,?)').bind(id,JSON.stringify(old),old.generated_at).run();
 let boot=await f.req('/api/invoicing/bootstrap',undefined,f.cookie);
 assert.equal(boot.data.accounts[id].opening.generated_at,store.opening.generated_at,'old cache cannot mask a newer verified import');
 const changed=structuredClone(cat);changed.routes[0].invoice_stores[0].opening={...store.opening,balance_cents:0,invoices:[],generated_at:new Date().toISOString()};
 assert.equal((await f.req('/api/catalog',{revision:1,catalog:changed},f.cookie)).status,409,'active route keeps its opening');
 const unrelated=structuredClone(cat);unrelated.routes.push({code:'R04',name:'OTHER',weekday:2,invoice_stores:[]});
 assert.equal((await f.req('/api/catalog',{revision:1,catalog:unrelated},f.cookie)).status,200,'other route can be prepared without touching this route');
 assert.equal((await f.send(f.body('collect',{cash:10000,shop2shop:0,received:true}))).status,200);
 assert.equal((await f.req('/api/invoicing/finish',{route:'R03',device:f.device,session_id:f.session.id,sequence:1},f.cookie)).status,200);
 assert.equal((await f.req('/api/catalog',{revision:2,catalog:changed},f.cookie)).status,200);
 boot=await f.req('/api/invoicing/bootstrap',undefined,f.cookie);
 assert.equal(boot.data.accounts[id].revision,1);assert.equal(boot.data.accounts[id].receipts.length,1);
 assert.equal(boot.data.accounts[id].opening.balance_cents,10000,'issued app history retains its original opening');
 const removed=structuredClone(changed);removed.routes[0].invoice_stores=[];
 assert.equal((await f.req('/api/catalog',{revision:3,catalog:removed},f.cookie)).status,409);
 const moved=structuredClone(removed);moved.routes.push({code:'R04',name:'OTHER',weekday:2,invoice_stores:[store]});
 assert.equal((await f.req('/api/catalog',{revision:3,catalog:moved},f.cookie)).status,409);
});
