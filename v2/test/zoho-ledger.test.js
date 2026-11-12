import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {hash} from '../src/auth.js';
import {ledgerCommand,ledgerStatus,advanceLedger,ensureLedger,prepareBaseline,scheduledLedger} from '../src/zoho-ledger.js';
import {assessInvoice,normalInvoice,normalPayment,signature} from '../src/britos-ledger.js';

// Transactional SQLite exercises the same SQL and CAS constraints as D1.
function database(t){const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());const db={prepare:q=>{let args=[];const stmt={bind:(...a)=>{args=a;return stmt;},first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}})};return stmt;},batch:async ss=>{sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.all());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};return db;}
const invoice=(changes={})=>({id:'1',number:'INV-1',date:'2026-10-15',customer:'Test',customer_id:'3',route:'Test',currency:'ZAR',status:'paid',total:20000,balance:0,credits:0,writeoff:0,adjustment:0,tax:0,shipping:0,modified:null,lines:[{key:'old-1',item_id:'2',name:'Test product',qty:2,rate:10000,value:20000,tax:0,settled:0}],...changes});
const payment=(changes={})=>({id:'4',number:'PAY-4',date:'2026-10-16',customer_id:'3',amount:20000,unused:0,currency:'ZAR',refunded:0,modified:null,allocations:[{id:'5',invoice_id:'1',number:'INV-1',value:20000,withheld:0}],...changes});
const baseline=(i=invoice(),p=payment())=>({format:'fenmeat-zoho-baseline-v1',organisation:'852102281',report_id:'BRITOS-2026-11-09-R02',since:'2026-11-06T00:00:00Z',asof:'2026-11-09T14:04:00Z',sales_through:'2026-11-06',source_sha256:'a'.repeat(64),archive_sha256:'b'.repeat(64),settlement_evidence:'Synthetic owner confirmation',invoices:[i],payments:[p],mapping:{'2':{owner:'Alinda',code:'B01'}},exceptions:['Migration unverified'],expected:{Alinda:i.balance===0?20000:0,Xalinda:0,Xavier:0}});
async function bootstrap(t,base=baseline()){
 const DB=database(t),env={DB};await ensureLedger(DB);const raw=JSON.stringify(base),id=await hash(raw),parts=[raw.slice(0,500),raw.slice(500)],manifest={id,parts:await Promise.all(parts.map(hash))};
 const command=(operation,data={},revision=0,request_id=crypto.randomUUID())=>ledgerCommand(env,{username:'alex'},{operation,...data,revision,request_id,reason:'Authorised isolated synthetic test'});
 await command('zoho_import_start',{import_id:id,manifest});
 for(let part=0;part<parts.length;part++)await command('zoho_import_chunk',{import_id:id,part,payload:parts[part]});
 const result=await command('zoho_import_finish',{import_id:id});return {DB,env,result,command};
}
const modified='2026-11-10T10:00:00Z';
const apiInvoice=(changes={})=>({invoice_id:'1',invoice_number:'INV-1',date:'2026-10-15',customer_id:'3',customer_name:'Test',currency_code:'ZAR',status:'paid',total:200,balance:0,credits_applied:0,write_off_amount:0,adjustment:0,tax_total:0,shipping_charge:0,last_modified_time:modified,line_items:[{line_item_id:'9',item_id:'2',name:'Test product',quantity:2,rate:100,item_total:200,tax_id:''}],...changes});
const apiPayment=(changes={})=>({payment_id:'4',payment_number:'PAY-4',date:'2026-11-10',customer_id:'3',currency_code:'ZAR',amount:200,unused_amount:0,amount_refunded:0,last_modified_time:modified,invoices:[{invoice_id:'1',invoice_number:'INV-1',amount_applied:200,tax_amount_withheld:0}],...changes});
async function start(f){const state={since:'2026-11-08T00:00:00Z',until:'2026-11-12T00:00:00Z',phase:'invoices',page:1,queue:[],affected:[],calls:0,changed:0,unchanged:0,attempts:0};await f.DB.prepare("INSERT INTO v2_zoho_mirror_runs(id,status,started_at,state) VALUES('synthetic-run','running','2026-11-12T00:00:00Z',?)").bind(JSON.stringify(state)).run();}
function reader({invoiceValue=apiInvoice(),paymentValue=apiPayment(),failure,duplicate=false,ignored=false}={}){const calls=[];return {calls,read:async(_env,_user,path,params)=>{calls.push({path,params});if(failure?.(path))throw new Error('simulated timeout');if(path==='invoices/1')return {invoice:invoiceValue};if(path==='customerpayments/4')return {payment:paymentValue};const item={invoice_id:'1',payment_id:'4',last_modified_time:ignored?'2026-01-01T00:00:00Z':modified};return {invoices:duplicate?[item,item]:[item],customer_payments:[item],page_context:{page:Number(params.page),has_more_page:false}};}};}

test('bootstrap is atomic, checksummed, idempotent and does not enable scheduling',async t=>{
 const f=await bootstrap(t);assert.equal(f.result.total,20000);assert.equal((await ledgerStatus(f.DB)).enabled,false);
 await assert.rejects(f.command('zoho_enable',{},1),/initial delta/);
 await assert.rejects(f.command('zoho_import_finish',{import_id:'a'.repeat(64)}),/already exists/);
 const r=await ledgerStatus(f.DB,{date:'2026-11-06'});assert.equal(r.report.can_send_payment_instructions,false);assert.equal(r.report.total,20000);
});
test('old partial credit becomes fully paid; changed payment refreshes old invoice; restart resumes checkpoints',async t=>{
 const p=payment({amount:5000,allocations:[{id:'5',invoice_id:'1',value:5000,withheld:0}]}),f=await bootstrap(t,baseline(invoice({balance:15000,status:'partially_paid'}),p));await start(f);
 const r=reader();assert.equal((await advanceLedger(f.env,{read:r.read,maxCalls:1})).running,true);
 assert.equal((await ledgerStatus(f.DB,{date:'2026-11-06'})).report.total,0);
 for(let n=0;n<8;n++){const x=await advanceLedger(f.env,{read:r.read,maxCalls:1});if(x.complete)break;}
 const s=await ledgerStatus(f.DB,{date:'2026-11-06'});assert.equal(s.last_success,'2026-11-12T00:00:00Z');assert.equal(s.report.total,20000);assert.equal(s.counts.find(x=>x.kind==='payment').count,1);assert.ok(r.calls.some(x=>x.path==='invoices/1'));
});
test('network failure retains checkpoint and previous successful snapshot; safe retry does not duplicate',async t=>{
 const f=await bootstrap(t);await start(f);const r=reader({failure:p=>p==='customerpayments/4'});
 const x=await advanceLedger(f.env,{read:r.read,maxCalls:10});assert.equal(x.failed,true);assert.equal((await ledgerStatus(f.DB)).last_success,null);
 await f.DB.prepare('UPDATE v2_zoho_mirror_runs SET retry_at=0').run();const ok=reader();const result=await advanceLedger(f.env,{read:ok.read,maxCalls:10});assert.equal(result.complete,true);
 assert.equal((await ledgerStatus(f.DB)).counts.find(x=>x.kind==='payment').count,1);assert.equal((await advanceLedger(f.env,{read:ok.read})).idle,true);
});
test('ignored change filters and duplicate source IDs fail closed',async t=>{
 for(const options of [{ignored:true},{duplicate:true}]){const f=await bootstrap(t);await start(f);const r=reader(options);const result=await advanceLedger(f.env,{read:r.read});assert.equal(result.failed,true);assert.equal((await ledgerStatus(f.DB)).last_success,null);}
});
test('partial mixed invoices are held, unknowns are not zero, credits are not cash',()=>{
 const b=baseline(),mapping=b.mapping;
 assert.equal(assessInvoice(invoice({balance:5000}),[payment({amount:15000,allocations:[{invoice_id:'1',value:15000,withheld:0}]})],mapping).lines[0].state,'partial');
 assert.equal(assessInvoice(invoice(),[],mapping).lines[0].due,0);
 assert.ok(assessInvoice(invoice({credits:20000}),[],mapping).errors.length);
 assert.throws(()=>normalInvoice(apiInvoice({balance:undefined})),/Missing/);
 assert.throws(()=>normalPayment(apiPayment({amount:undefined})),/Missing/);
 assert.throws(()=>assessInvoice(invoice(),[payment(),payment()],mapping),/Duplicate/);
});
test('settled line identity survives API conversion and changed or missing settled lines block instructions',()=>{
 const old=invoice(),s={invoice_id:'1',key:'old-1',signature:signature(old.lines[0]),owner:'Alinda',amount:20000};
 const normalized=normalInvoice(apiInvoice(),old);assert.equal(normalized.lines[0].key,'old-1');assert.equal(assessInvoice(normalized,[payment()],baseline().mapping,[s]).lines[0].due,0);
 const changed=normalInvoice(apiInvoice({line_items:[{line_item_id:'9',item_id:'2',name:'Changed pack',quantity:2,rate:100,item_total:200}]}),old);assert.ok(assessInvoice(changed,[payment()],baseline().mapping,[s]).errors.some(x=>x.includes('settled line')));
});
test('concurrent lease blocks duplicate work and disabled cron makes no source calls',async t=>{
 const f=await bootstrap(t);await start(f);await f.DB.prepare("UPDATE v2_zoho_mirror_runs SET lease='other',lease_until=?").bind(Date.now()+100000).run();const r=reader();assert.equal((await advanceLedger(f.env,{read:r.read})).busy,true);assert.equal(r.calls.length,0);await scheduledLedger(f.env,{cron:'0 20 * * *'});assert.equal(r.calls.length,0);
});
test('corrupt baseline receipt/settlement totals cannot be promoted',()=>{
 const b=baseline();b.payments[0].allocations[0].value=0;assert.throws(()=>prepareBaseline(b),/reconciliation/);
});
test('payment list timestamp and explicit refund read cover missing detail fields; missing values fail',()=>{
 const p=apiPayment();delete p.last_modified_time;delete p.amount_refunded;
 assert.throws(()=>normalPayment(p,{modified}),/Missing/);
 assert.equal(normalPayment(p,{modified,refunded:0}).refunded,0);
 assert.equal(normalPayment(p,{modified,refunded:0}).modified,modified.replace('Z','.000Z'));
});
test('confirmed owner allocation is audited, replay-safe, cannot be deducted twice and old report is immutable',async t=>{
 const f=await bootstrap(t),before=await ledgerStatus(f.DB,{date:'2026-11-06'}),request=crypto.randomUUID();
 const data={evidence:'Explicit synthetic owner confirmation with line allocation',lines:[{invoice_id:'1',key:'old-1',owner:'Alinda',amount:15000}]};
 assert.equal((await f.command('zoho_owner_settlement',data,1,request)).revision,2);
 assert.equal((await f.command('zoho_owner_settlement',data,1,request)).replayed,true);
 assert.equal((await ledgerStatus(f.DB,{date:'2026-11-06'})).report.total,5000);
 assert.equal((await ledgerStatus(f.DB,{job_id:before.report.snapshot_id})).report.total,20000);
 await assert.rejects(f.command('zoho_owner_settlement',data,2),/twice/);
});
test('weekly header inventory detects missing source IDs without deleting retained evidence',async t=>{
 const f=await bootstrap(t);await start(f);const job=await f.DB.prepare('SELECT state FROM v2_zoho_mirror_runs').first(),state=JSON.parse(job.state);state.phase='inventory_invoices';state.inventory=true;state.inventory_ids={invoice:[],payment:[]};await f.DB.prepare('UPDATE v2_zoho_mirror_runs SET state=?').bind(JSON.stringify(state)).run();
 const r=await advanceLedger(f.env,{maxCalls:4,read:async()=>({invoices:[],customer_payments:[],page_context:{page:1,has_more_page:false}})});assert.equal(r.complete,true);
 const status=await ledgerStatus(f.DB,{date:'2026-11-06'});assert.equal(status.counts.find(r=>r.kind==='invoice').count,1);assert.ok(status.report.blockers.some(x=>x.includes('disappeared')));assert.equal(status.report.can_send_payment_instructions,false);
});
test('unauthorised staff cannot import or operate the finance mirror',async t=>{
 const DB=database(t);await assert.rejects(ledgerCommand({DB},{username:'musa'},{operation:'zoho_enable'}),/Admin/);
});
test('authorised initial catch-up runs on existing cron and activates only after atomic validation',async t=>{
 const f=await bootstrap(t);await start(f);await f.command('zoho_arm',{},1);
 assert.equal((await ledgerStatus(f.DB)).enabled,false);assert.equal((await ledgerStatus(f.DB)).activation_pending,true);
 const r=reader();await scheduledLedger(f.env,{cron:'*/5 * * * *'},{read:r.read,maxCalls:1});
 assert.equal((await ledgerStatus(f.DB)).enabled,false);
 await scheduledLedger(f.env,{cron:'*/5 * * * *'},{read:r.read,maxCalls:20});
 const s=await ledgerStatus(f.DB);assert.equal(s.enabled,true);assert.equal(s.activation_pending,false);assert.ok(s.last_success);
});
test('disable cancels pending activation and a failed catch-up never enables schedule',async t=>{
 const f=await bootstrap(t);await start(f);await f.command('zoho_arm',{},1);
 const fail=reader({ignored:true});await scheduledLedger(f.env,{cron:'*/5 * * * *'},{read:fail.read});assert.equal((await ledgerStatus(f.DB)).enabled,false);
 await f.command('zoho_disable',{},2);await f.DB.prepare('UPDATE v2_zoho_mirror_runs SET retry_at=0').run();
 const r=reader();await scheduledLedger(f.env,{cron:'*/5 * * * *'},{read:r.read});assert.equal(r.calls.length,0);
 await advanceLedger(f.env,{read:r.read,maxCalls:20});assert.equal((await ledgerStatus(f.DB)).enabled,false);
});
