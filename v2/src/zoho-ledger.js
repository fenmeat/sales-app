import {check,UserError} from './domain.js';
import {hash,isAdmin} from './auth.js';
import {readFenBooks} from './zoho.js';
import {normalInvoice,normalPayment,timestamp,signature,assessInvoice,summarize,OWNERS} from './britos-ledger.js';

// Independent read mirror: no UPDATE/DELETE of sales, invoices, POS or receipts.
export const LEDGER_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_control(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,enabled INTEGER NOT NULL,last_success TEXT,baseline TEXT,config TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_imports(id TEXT PRIMARY KEY,manifest TEXT NOT NULL,status TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_parts(import_id TEXT NOT NULL,part INTEGER NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(import_id,part))`,
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,run_id TEXT NOT NULL,PRIMARY KEY(kind,id))`,
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_versions(run_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(run_id,kind,id))`,
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,state TEXT NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS v2_zoho_one_active ON v2_zoho_mirror_runs(status) WHERE status='running'`,
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_assessments(invoice_id TEXT PRIMARY KEY,payload TEXT NOT NULL,run_id TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_reports(id TEXT PRIMARY KEY,digest TEXT UNIQUE NOT NULL,sales_through TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_zoho_mirror_audit(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,operation TEXT NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,saved_at TEXT NOT NULL,guard INTEGER NOT NULL CHECK(guard=1))`
];
const schemas=new WeakMap();
export async function ensureLedger(db){if(!schemas.has(db))schemas.set(db,db.batch(LEDGER_SCHEMA.map(sql=>db.prepare(sql))).catch(error=>{schemas.delete(db);throw error;}));await schemas.get(db);}
const now=()=>new Date().toISOString();
const json=v=>JSON.stringify(v);
const control=db=>db.prepare('SELECT * FROM v2_zoho_mirror_control WHERE id=1').first();
const queryRows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const records=async db=>(await queryRows(db,'SELECT kind,id,payload FROM v2_zoho_mirror_records')).map(r=>({...r,value:JSON.parse(r.payload)}));
const source=async(db,kind,id)=>{const r=await db.prepare('SELECT payload FROM v2_zoho_mirror_records WHERE kind=? AND id=?').bind(kind,id).first();return r?JSON.parse(r.payload):null;};
const active=db=>db.prepare("SELECT * FROM v2_zoho_mirror_runs WHERE status='running'").first();
function safeError(e){return e instanceof UserError?e.message.slice(0,240):'Source validation or database operation failed; the previous successful snapshot is retained.';}

export async function ledgerStatus(db,{date,page=1,job_id}={}){
 await ensureLedger(db);const c=await control(db),job=await active(db);
 const runs=await queryRows(db,'SELECT id,status,started_at,finished_at,error FROM v2_zoho_mirror_runs ORDER BY started_at DESC LIMIT 5');
 const counts=await queryRows(db,'SELECT kind,COUNT(*) count FROM v2_zoho_mirror_records GROUP BY kind');
 const config=c?JSON.parse(c.config):{},progress=job?JSON.parse(job.state):null;
 const status={available:true,enabled:!!c?.enabled,activation_pending:!!config.activate_after_success,revision:c?.revision??0,schedule:'22:00 Africa/Johannesburg',last_success:c?.last_success??null,baseline:c?.baseline??null,counts,running:job?{id:job.id,phase:progress.phase,page:progress.page,queued:progress.queue.length,calls:progress.calls,changed:progress.changed,error:job.error,retry_at:job.retry_at}:null,runs};
 if(job_id){
  check(Number.isInteger(page)&&page>=1&&page<=200,'Choose a valid report page.');
  const snapshot=await db.prepare('SELECT * FROM v2_zoho_mirror_reports WHERE id=?').bind(job_id).first();check(snapshot,'Report snapshot not found.',404);
  const report=JSON.parse(snapshot.payload);return {...status,report:{...report,snapshot_id:snapshot.id,lines:report.lines.slice((page-1)*100,page*100),page,has_more:report.lines.length>page*100}};
 }
 if(date&&c){
  check(/^\d{4}-\d\d-\d\d$/.test(date),'Choose a report cutoff date.');check(Number.isInteger(page)&&page>=1&&page<=200,'Choose a valid report page.');
  const cfg=JSON.parse(c.config),assessments=(await queryRows(db,'SELECT payload FROM v2_zoho_mirror_assessments')).map(r=>JSON.parse(r.payload)),summary=summarize(assessments,date);
  const native=await nativeCoverage(db,date,cfg.mapping);const blockers=cfg.exceptions.filter(x=>!(x==='App/Factory POS migration boundary requires reconciliation'&&native.reconciled_no_britos));
  if(!c.last_success||Date.now()-Date.parse(c.last_success)>36*3600000)blockers.push('Zoho update is not current');
  if(job)blockers.push('Zoho update is still in progress');
  if(!cfg.inventory_verified_at||Date.now()-Date.parse(cfg.inventory_verified_at)>8*86400000)blockers.push('Deletion/inventory audit has not been verified');
  if(native.britos_lines?.length||native.opening_receipts?.length||native.errors?.length)blockers.push('App and POS sales require migration/duplicate reconciliation before combining totals');
  if(!native.available)blockers.push('App/POS ledger coverage is unavailable');
  if(summary.errors.length)blockers.push('Invoice, payment or product exceptions require review');
  if(!cfg.owner_confirmed_through||cfg.owner_confirmed_through<date)blockers.push('Owner transfers since the previous confirmation must be checked');
  const report={sales_through:date,receipt_asof:c.last_success??cfg.asof,complete:blockers.length===0,can_send_payment_instructions:blockers.length===0,blockers,owners:summary.owners,total:summary.total,errors:summary.errors,error_count:summary.errors.length,native,lines:summary.lines,line_count:summary.lines.length,unit:'integer ZAR cents',source:'Committed Zoho mirror; native app and POS shown separately'};
  const digest=await hash(json(report));await db.prepare('INSERT INTO v2_zoho_mirror_reports VALUES(?,?,?,?,?) ON CONFLICT(digest) DO NOTHING').bind(crypto.randomUUID(),digest,date,json(report),now()).run();
  const snapshot=await db.prepare('SELECT id FROM v2_zoho_mirror_reports WHERE digest=?').bind(digest).first();
  status.report={...report,snapshot_id:snapshot.id,lines:report.lines.slice((page-1)*100,page*100),page,has_more:report.lines.length>page*100};
 }
 return status;
}
async function nativeCoverage(db,date,mapping){
 const tables=(await queryRows(db,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('v2_invoice_events','v2_pos_sales')")).map(r=>r.name);
 if(tables.length!==2)return {available:false,app_invoices:null,pos_sales:null};
 const events=await queryRows(db,'SELECT payload FROM v2_invoice_events e WHERE revision=(SELECT MAX(revision) FROM v2_invoice_events x WHERE x.customer_id=e.customer_id)');
 const accounts=events.map(e=>JSON.parse(e.payload));
 const invoices=accounts.flatMap(a=>(a.invoices??[]).filter(i=>i.kind==='app'&&i.date>='2026-10-14'&&i.date<=date).map(i=>({...i,receipts:(a.receipts??[]).filter(r=>r.allocations.some(x=>x.invoice_id===i.id))})));
 const opening_receipts=accounts.flatMap(a=>(a.receipts??[]).filter(r=>r.date>='2026-10-14'&&r.allocations.some(x=>x.invoice_id.startsWith('zoho:'))).map(r=>({customer_id:a.customer_id,...r})));
 const pos=await db.prepare("SELECT COUNT(*) count,COALESCE(SUM(json_extract(payload,'$.total')),0) total FROM v2_pos_sales WHERE status='paid' AND service_date BETWEEN '2026-10-14' AND ?").bind(date).first();
 const sales=(await queryRows(db,"SELECT payload FROM v2_pos_sales WHERE status='paid' AND service_date BETWEEN '2026-10-14' AND ? ORDER BY service_date,seq",date)).map(r=>JSON.parse(r.payload));
 const catalogExists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_catalog'").first(),catalogRow=catalogExists?await db.prepare('SELECT revision,payload FROM v2_catalog WHERE id=1').first():null;
 const products=catalogRow?JSON.parse(catalogRow.payload).products:[],britos_lines=[],errors=[];
 for(const [kind,items] of [['app',invoices],['pos',sales]])for(const sale of items){
  if(!Array.isArray(sale.lines)){errors.push(kind+':'+sale.id+' missing lines');continue;}
  if(sale.lines.reduce((s,l)=>s+l.total,0)!==sale.total)errors.push(kind+':'+sale.id+' lines do not reconcile');
  if(kind==='pos'&&(!sale.payment?.received||sale.payment.cash+sale.payment.card+sale.payment.shop2shop!==sale.total))errors.push('pos:'+sale.id+' payment does not reconcile');
  for(const line of sale.lines){const product=products.find(p=>p.code===line.code),assigned=product&&mapping[product.zoho_item_id];
   if(!assigned){errors.push(kind+':'+sale.id+' unknown product '+line.code);continue;}
   if(assigned.owner)britos_lines.push({source:kind,id:sale.id,number:sale.number,date:sale.date,code:line.code,name:line.name,qty:line.qty,value:line.total,owner:assigned.owner});
  }
 }
 return {available:true,app_invoices:invoices.length,app_total:invoices.reduce((s,i)=>s+i.total,0),pos_sales:pos.count,pos_total:pos.total,app_details:invoices,pos_details:sales,opening_receipts,britos_lines,errors,catalog_revision:catalogRow?.revision??null,reconciled_no_britos:!errors.length&&!britos_lines.length&&!opening_receipts.length,separate:true};
}

// Financial transport uses its existing admin write grant. Data lives only in
// mirror tables; it is never a Financial transaction or owner-payment command.
export async function ledgerCommand(env,user,b){
 check(isAdmin(user.username),'Admin access required.',403);await ensureLedger(env.DB);const db=env.DB;
 check(typeof b.request_id==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(b.request_id),'Use a stable request ID.');check(typeof b.reason==='string'&&b.reason.length>=5,'Record the authority and source.');
 const fingerprint=await hash(json(b)),saved=await db.prepare('SELECT fingerprint,payload FROM v2_zoho_mirror_audit WHERE request_id=?').bind(b.request_id).first();
 if(saved){check(saved.fingerprint===fingerprint,'Request ID was reused with different content.',409);const prior=JSON.parse(saved.payload);return {...(prior.result??prior),replayed:true};}
 const audit=result=>db.prepare('INSERT INTO v2_zoho_mirror_audit VALUES(?,?,?,?,?,?,?,1)').bind(b.request_id,fingerprint,b.operation,json(result),user.username,b.reason,now());
 if(b.operation==='zoho_import_start'){
  const m=b.manifest;check(m?.id===b.import_id&&/^[a-f0-9]{64}$/.test(m.id)&&Array.isArray(m.parts)&&m.parts.length>0&&m.parts.length<=80&&m.parts.every(x=>/^[a-f0-9]{64}$/.test(x)),'Invalid mirror manifest.');
  check(!await control(db),'Mirror already has a baseline; it cannot be overwritten.',409);
  const old=await db.prepare('SELECT manifest FROM v2_zoho_mirror_imports WHERE id=?').bind(m.id).first();check(!old||old.manifest===json(m),'Manifest changed.',409);
  const result={status:'uploading',import_id:m.id};await db.batch([db.prepare("INSERT INTO v2_zoho_mirror_imports VALUES(?,?,'uploading',?,?) ON CONFLICT(id) DO NOTHING").bind(m.id,json(m),user.username,now()),audit(result)]);return result;
 }
 if(b.operation==='zoho_import_chunk'){
  const im=await db.prepare('SELECT manifest,status FROM v2_zoho_mirror_imports WHERE id=?').bind(b.import_id).first();check(im,'Start the import first.');const m=JSON.parse(im.manifest);
  check(Number.isInteger(b.part)&&b.part>=0&&b.part<m.parts.length&&typeof b.payload==='string'&&b.payload.length<=100000,'Invalid mirror chunk.');
  const digest=await hash(b.payload);check(digest===m.parts[b.part],'Chunk checksum differs.');
  const result={part:b.part,digest};await db.batch([db.prepare('INSERT INTO v2_zoho_mirror_parts VALUES(?,?,?,?) ON CONFLICT(import_id,part) DO NOTHING').bind(b.import_id,b.part,digest,b.payload),audit(result)]);return result;
 }
 if(b.operation==='zoho_import_finish'){
  check(!await control(db),'A verified baseline already exists.',409);
  const im=await db.prepare('SELECT manifest FROM v2_zoho_mirror_imports WHERE id=?').bind(b.import_id).first();check(im,'Start the import first.');const m=JSON.parse(im.manifest),parts=await queryRows(db,'SELECT * FROM v2_zoho_mirror_parts WHERE import_id=? ORDER BY part',b.import_id);
  check(parts.length===m.parts.length&&parts.every((p,i)=>p.part===i&&p.digest===m.parts[i]),'Baseline upload is incomplete.');
  const raw=parts.map(p=>p.payload).join('');check(await hash(raw)===m.id,'Baseline checksum differs.');const base=JSON.parse(raw),prepared=prepareBaseline(base);
  const runId='baseline:'+m.id,statements=[];
  for(let offset=0;offset<prepared.rows.length;offset+=20){const rows=await Promise.all(prepared.rows.slice(offset,offset+20).map(async r=>({...r,payload:json(r.value),digest:await hash(json(r.value))})));
   statements.push(db.prepare("INSERT INTO v2_zoho_mirror_records SELECT json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.payload'),json_extract(value,'$.digest'),? FROM json_each(?)").bind(runId,json(rows)));
  }
  statements.push(db.prepare('INSERT INTO v2_zoho_mirror_versions SELECT run_id,kind,id,payload,digest FROM v2_zoho_mirror_records'));
  for(let offset=0;offset<prepared.assessments.length;offset+=25)statements.push(db.prepare("INSERT INTO v2_zoho_mirror_assessments SELECT json_extract(value,'$.id'),value,? FROM json_each(?)").bind(runId,json(prepared.assessments.slice(offset,offset+25))));
  const cfg={mapping:base.mapping,settlements:prepared.settlements,exceptions:base.exceptions,asof:base.asof,since:base.since,source_sha256:base.source_sha256,archive_sha256:base.archive_sha256,owner_confirmed_through:'2026-11-09',inventory_verified_at:null};
  const result={saved:true,revision:1,baseline:base.report_id,counts:{invoices:base.invoices.length,payments:base.payments.length,lines:base.invoices.reduce((s,i)=>s+i.lines.length,0)},replay:prepared.summary.owners,total:prepared.summary.total,enabled:false};
  statements.push(db.prepare('INSERT INTO v2_zoho_mirror_control VALUES(1,1,0,NULL,?,?)').bind(base.report_id,json(cfg)),db.prepare("UPDATE v2_zoho_mirror_imports SET status='complete' WHERE id=?").bind(m.id),audit(result));await db.batch(statements);return result;
 }
 const c=await control(db);check(c,'Import and verify the checked baseline first.',409);check(c.revision===b.revision,'Mirror configuration changed. Read its current revision.',409);
 if(b.operation==='zoho_owner_settlement'||b.operation==='zoho_review'){
  check(!await active(db),'Finish the active update before recording a review.',409);
  check(typeof b.evidence==='string'&&b.evidence.trim().length>=20,'Supply the verified PA record or explicit owner confirmation.');
  const cfg=JSON.parse(c.config),affected=new Set();
  if(b.operation==='zoho_owner_settlement'){
   check(Array.isArray(b.lines)&&b.lines.length>0&&b.lines.length<=1000,'Supply the explicitly allocated settled lines.');
   for(const s of b.lines){
    check(OWNERS.includes(s.owner)&&Number.isSafeInteger(s.amount)&&s.amount>0,'Invalid confirmed owner transfer.');
    const i=await source(db,'invoice',s.invoice_id),l=i?.lines.find(l=>l.key===s.key);check(l&&cfg.mapping[l.item_id]?.owner===s.owner,'Unknown settled source line.');
    const paid=cfg.settlements.filter(x=>x.invoice_id===s.invoice_id&&x.key===s.key).reduce((n,x)=>n+x.amount,0);check(paid+s.amount<=l.value,'This would count an owner transfer twice.');
    cfg.settlements.push({invoice_id:s.invoice_id,key:s.key,owner:s.owner,signature:signature(l),amount:s.amount,evidence:b.evidence});affected.add(s.invoice_id);
   }
  }else{
   check(/^\d{4}-\d\d-\d\d$/.test(b.owner_confirmed_through??''),'Supply the actual latest owner-transfer review date.');
   check(b.owner_confirmed_through>=(cfg.owner_confirmed_through??''),'The confirmation date cannot move backwards.');cfg.owner_confirmed_through=b.owner_confirmed_through;
   check(Array.isArray(b.resolved_exceptions??[])&&(b.resolved_exceptions??[]).every(x=>cfg.exceptions.includes(x)),'Choose existing reviewed exceptions.');
   cfg.exceptions=cfg.exceptions.filter(x=>!(b.resolved_exceptions??[]).includes(x));
  }
  const statements=[];if(affected.size){const payments=(await records(db)).filter(r=>r.kind==='payment').map(r=>r.value);for(const id of affected){const result=assessInvoice(await source(db,'invoice',id),payments,cfg.mapping,cfg.settlements.filter(s=>s.invoice_id===id));check(!result.errors.length,'The settled line needs reconciliation first.');statements.push(db.prepare('UPDATE v2_zoho_mirror_assessments SET payload=? WHERE invoice_id=?').bind(json(result),id));}}
  const result={saved:true,revision:c.revision+1,operation:b.operation};await db.batch([db.prepare('UPDATE v2_zoho_mirror_control SET config=?,revision=revision+1 WHERE id=1 AND revision=?').bind(json(cfg),c.revision),db.prepare('INSERT INTO v2_zoho_mirror_audit VALUES(?,?,?,?,?,?,?,changes())').bind(b.request_id,fingerprint,b.operation,json({result,evidence:b.evidence,lines:b.lines??[],review_date:b.owner_confirmed_through??null}),user.username,b.reason,now()),...statements]);return result;
 }
 if(b.operation==='zoho_arm'){
  check(await active(db),'Start the initial source validation first.',409);check(!c.enabled&&!c.last_success,'Use normal enable after a completed validation.',409);
  const cfg=JSON.parse(c.config);cfg.activate_after_success=true;
  const result={saved:true,enabled:false,activation_pending:true,revision:c.revision+1};
  await db.batch([db.prepare('UPDATE v2_zoho_mirror_control SET config=?,revision=revision+1 WHERE id=1 AND revision=?').bind(json(cfg),c.revision),db.prepare('INSERT INTO v2_zoho_mirror_audit VALUES(?,?,?,?,?,?,?,changes())').bind(b.request_id,fingerprint,b.operation,json(result),user.username,b.reason,now())]);return result;
 }
 if(b.operation==='zoho_enable'||b.operation==='zoho_disable'){
  const enabled=b.operation==='zoho_enable';if(enabled)check(c.last_success&&!await active(db),'Complete a verified initial delta before enabling the schedule.',409);
  const cfg=JSON.parse(c.config);cfg.activate_after_success=false;
  const result={saved:true,enabled,revision:c.revision+1};await db.batch([db.prepare('UPDATE v2_zoho_mirror_control SET enabled=?,config=?,revision=revision+1 WHERE id=1 AND revision=?').bind(enabled?1:0,json(cfg),c.revision),db.prepare('INSERT INTO v2_zoho_mirror_audit VALUES(?,?,?,?,?,?,?,changes())').bind(b.request_id,fingerprint,b.operation,json(result),user.username,b.reason,now())]);return result;
 }
 if(b.operation==='zoho_run'){
  const job=await startRun(db);await audit({started:true,run_id:job.id}).run();return {started:true,run_id:job.id,...await advanceLedger(env)};
 }
 if(b.operation==='zoho_resume'){const result=await advanceLedger(env);await audit(result).run();return result;}
 throw new UserError('Unknown Zoho mirror operation.');
}
export function prepareBaseline(base){
 check(base?.format==='fenmeat-zoho-baseline-v1'&&base.organisation==='852102281'&&base.report_id==='BRITOS-2026-11-09-R02','Wrong checked baseline.');
 check(Array.isArray(base.invoices)&&base.invoices.length<=10000&&Array.isArray(base.payments)&&base.payments.length<=10000,'Invalid baseline records.');timestamp(base.since);timestamp(base.asof);
 check(base.settlement_evidence&&base.mapping&&Array.isArray(base.exceptions),'Baseline evidence or exceptions missing.');
 const rows=[...base.invoices.map(value=>({kind:'invoice',id:value.id,value})),...base.payments.map(value=>({kind:'payment',id:value.id,value}))];check(new Set(rows.map(r=>r.kind+':'+r.id)).size===rows.length,'Duplicate baseline records.');
 const settlements=base.invoices.flatMap(i=>i.lines.filter(l=>l.settled>0).map(l=>({invoice_id:i.id,key:l.key,signature:signature(l),owner:base.mapping[l.item_id]?.owner,amount:l.settled,evidence:base.settlement_evidence})));
 const assessments=base.invoices.map(i=>assessInvoice(i,base.payments,base.mapping,settlements.filter(s=>s.invoice_id===i.id))),summary=summarize(assessments,base.sales_through);
 check(summary.errors.length===0,'Baseline reconciliation failed: '+json(summary.errors.slice(0,3)));
 check(OWNERS.every(o=>summary.owners[o].due===base.expected[o]),'Baseline replay differs from the checked report.');return {rows,settlements,assessments,summary};
}
async function startRun(db){
 const existing=await active(db);if(existing)return existing;const c=await control(db);check(c,'No baseline.',409);const cfg=JSON.parse(c.config),stamp=now();
 const since=new Date(timestamp(c.last_success??cfg.since)-2*86400000).toISOString();
 const state={since,until:stamp,phase:'invoices',page:1,queue:[],affected:[],calls:0,changed:0,unchanged:0,attempts:0,inventory:!cfg.inventory_verified_at||Date.parse(stamp)-Date.parse(cfg.inventory_verified_at)>7*86400000,inventory_ids:{invoice:[],payment:[]}};
 const id=crypto.randomUUID();try{await db.prepare("INSERT INTO v2_zoho_mirror_runs(id,status,started_at,state) VALUES(?,'running',?,?)").bind(id,stamp,json(state)).run();}catch{const running=await active(db);if(running)return running;throw Error('Could not create sync run');}return active(db);
}
export async function scheduledLedger(env,event,options={}){
 await ensureLedger(env.DB);const c=await control(env.DB);if(!c||!c.enabled&&!JSON.parse(c.config).activate_after_success)return;
 if(c.enabled&&event.cron==='0 20 * * *')await startRun(env.DB);
 if(await active(env.DB))await advanceLedger(env,{maxCalls:20,...options});
}
export async function advanceLedger(env,{read=readFenBooks,maxCalls=4}={}){
 const db=env.DB;await ensureLedger(db);const job=await active(db);if(!job)return {idle:true};
 if(job.retry_at>Date.now())return {waiting:true,retry_at:job.retry_at};
 const token=crypto.randomUUID(),leaseUntil=Date.now()+120000;
 const claimed=await db.prepare("UPDATE v2_zoho_mirror_runs SET lease=?,lease_until=? WHERE id=? AND status='running' AND lease_until<? RETURNING state").bind(token,leaseUntil,job.id,Date.now()).first();if(!claimed)return {busy:true};
 let state=JSON.parse(claimed.state);const c=await control(db),cfg=JSON.parse(c.config);let used=0;
 const checkpoint=async statements=>{
  const guard=db.prepare("UPDATE v2_zoho_mirror_runs SET state=?,lease_until=?,error=NULL,retry_at=0 WHERE id=? AND lease=? AND status='running' RETURNING id").bind(json(state),Date.now()+120000,job.id,token);
  // Conditional SELECT keeps every staged record attached to its current lease.
  await db.batch([guard,...statements]);
 };
 try{
  while(used<maxCalls){
   if(state.phase==='finish'&&!state.queue.length){await commitRun(db,job.id,token,state,cfg);return {complete:true,run_id:job.id,calls:state.calls,changed:state.changed,unchanged:state.unchanged};}
   if(state.queue.length){
    const task=state.queue[0],prior=await source(db,task.kind,task.id);
    // The imported R02 already proves these records. Its exports lack modified
    // stamps, so keep a two-hour boundary overlap, not repeated old details.
    if(task.modified&&prior&&!prior.modified&&timestamp(task.modified)<timestamp(cfg.asof)-2*3600000){state.queue.shift();state.unchanged++;await checkpoint([]);continue;}
    const path=task.kind==='invoice'?'invoices':'customerpayments',response=await read(env,{username:'alex'},path+'/'+task.id,{});used++;state.calls++;
    let refunded;
    if(task.kind==='payment'&&response.payment?.amount_refunded==null){
     const refunds=await read(env,{username:'alex'},path+'/'+task.id+'/refunds',{page:'1',per_page:'200'});used++;state.calls++;
     check(Array.isArray(refunds.payment_refunds)&&Number(refunds.page_context?.page)===1&&refunds.page_context?.has_more_page===false,'Payment refund coverage is incomplete.',502);
     refunded=refunds.payment_refunds.reduce((s,r)=>{check(typeof r.amount_fcy==='number'&&Number.isFinite(r.amount_fcy),'Missing refund amount.',502);return s+r.amount_fcy;},0);
    }
    const value=task.kind==='invoice'?normalInvoice(response.invoice,prior):normalPayment(response.payment,{modified:task.modified,refunded});
    check(value.id===task.id,'Zoho returned a different record.',502);
    const digest=await hash(json(value));const old=await db.prepare('SELECT digest FROM v2_zoho_mirror_records WHERE kind=? AND id=?').bind(task.kind,task.id).first();
    const statements=[];
    if(old?.digest!==digest){
     statements.push(db.prepare("INSERT INTO v2_zoho_mirror_versions SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM v2_zoho_mirror_runs WHERE id=? AND lease=?) ON CONFLICT(run_id,kind,id) DO UPDATE SET payload=excluded.payload,digest=excluded.digest").bind(job.id,task.kind,value.id,json(value),digest,job.id,token));
     state.changed++;if(task.kind==='invoice')state.affected.push(value.id);else{
      for(const a of [...(prior?.allocations??[]),...value.allocations])if(a.invoice_id){state.affected.push(a.invoice_id);if(!state.queue.some(t=>t.kind==='invoice'&&t.id===a.invoice_id))state.queue.push({kind:'invoice',id:a.invoice_id});}
     }
    }else state.unchanged++;
    state.queue.shift();state.affected=[...new Set(state.affected)];await checkpoint(statements);continue;
   }
   const inventory=state.phase.startsWith('inventory_');
   const kind=state.phase.endsWith('invoices')?'invoice':'payment',path=kind==='invoice'?'invoices':'customerpayments';
   check(state.page<=100,'Delta exceeded 100 pages; review the source filter.',409);
   const response=await read(env,{username:'alex'},path,{...(inventory?{date_start:'2026-10-14'}:{last_modified_time:state.since.replace('.000Z','+0000')}),page:String(state.page),per_page:'100',sort_column:'created_time',sort_order:'A'});used++;state.calls++;
   const rows=kind==='invoice'?response.invoices:response.customer_payments??response.customerpayments,pg=response.page_context;
   check(Array.isArray(rows)&&rows.length<=100&&Number(pg?.page)===state.page&&typeof pg.has_more_page==='boolean','Zoho did not confirm complete delta pagination.',502);
   const ids=new Set();for(const r of rows){const id=String(kind==='invoice'?r.invoice_id:r.payment_id);check(/^\d{1,40}$/.test(id)&&!ids.has(id),'Duplicate/invalid source index identity.',502);ids.add(id);
    const changed=timestamp(r.last_modified_time);
    if(inventory){check(typeof r.date==='string'&&r.date>='2026-10-14','Zoho ignored the inventory date filter.',502);state.inventory_ids[kind].push(id);continue;}
    check(changed>=timestamp(state.since),'Zoho ignored the modification filter; the mirror has not advanced.',502);
    if(changed>timestamp(state.until))continue;
    const previous=await source(db,kind,id);if(previous&&(previous.modified?timestamp(previous.modified)===changed:changed<timestamp(cfg.asof)-2*3600000)){state.unchanged++;continue;}
    state.queue.push({kind,id,modified:r.last_modified_time});
   }
   if(pg.has_more_page)state.page++;else{state.phase=inventory?(kind==='invoice'?'inventory_payments':'finish'):(kind==='invoice'?'payments':state.inventory?'inventory_invoices':'finish');state.page=1;}
   await checkpoint([]);
  }
  return {running:true,run_id:job.id,phase:state.phase,calls:state.calls,changed:state.changed};
 }catch(e){
  const persisted=await db.prepare('SELECT state FROM v2_zoho_mirror_runs WHERE id=? AND lease=?').bind(job.id,token).first();
  if(!persisted)return {busy:true};state=JSON.parse(persisted.state);
  state.attempts=(state.attempts??0)+1;const retry=Date.now()+Math.min(3600000,300000*2**Math.min(state.attempts-1,4));
  await db.prepare('UPDATE v2_zoho_mirror_runs SET error=?,retry_at=?,state=? WHERE id=? AND lease=?').bind(safeError(e),retry,json(state),job.id,token).run();
  return {failed:true,resumable:true,run_id:job.id,error:safeError(e),retry_at:retry};
 }finally{await db.prepare('UPDATE v2_zoho_mirror_runs SET lease=NULL,lease_until=0 WHERE id=? AND lease=?').bind(job.id,token).run();}
}
async function commitRun(db,runId,token,state,cfg){
 const all=new Map((await records(db)).map(r=>[r.kind+':'+r.id,r]));
 const staged=await queryRows(db,'SELECT kind,id,payload,digest FROM v2_zoho_mirror_versions WHERE run_id=?',runId);
 for(const r of staged)all.set(r.kind+':'+r.id,{...r,value:JSON.parse(r.payload)});
 const payments=[...all.values()].filter(r=>r.kind==='payment').map(r=>r.value),statements=[];
 if(state.inventory){
  const missing=[...all.values()].filter(r=>r.value.date>='2026-10-14'&&!state.inventory_ids[r.kind].includes(r.id));
  cfg.inventory_missing=missing.map(r=>({kind:r.kind,id:r.id}));cfg.inventory_verified_at=state.until;
  if(missing.length)cfg.exceptions=[...new Set([...cfg.exceptions,'Records disappeared from Zoho; review the retained versions before reporting'])];
 }
 for(const invoiceId of [...new Set(state.affected)]){const row=all.get('invoice:'+invoiceId);if(!row)continue;const result=assessInvoice(row.value,payments,cfg.mapping,cfg.settlements.filter(s=>s.invoice_id===invoiceId));
  statements.push(db.prepare('INSERT INTO v2_zoho_mirror_assessments VALUES(?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET payload=excluded.payload,run_id=excluded.run_id').bind(invoiceId,json(result),runId));
 }
 // Atomically promote the whole generation and watermark; failures retain the
 // previous report. Versions and imported sources are never deleted.
 await db.batch([
  db.prepare("UPDATE v2_zoho_mirror_runs SET status='complete',finished_at=?,state=? WHERE id=? AND lease=? AND status='running'").bind(now(),json(state),runId,token),
  db.prepare('INSERT INTO v2_zoho_mirror_audit VALUES(?,?,?,?,?,?,?,changes())').bind('commit-'+runId,await hash(json(state)),'commit',json({until:state.until,changed:state.changed}),'scheduler','Verified source delta',now()),
  db.prepare('INSERT INTO v2_zoho_mirror_records SELECT kind,id,payload,digest,run_id FROM v2_zoho_mirror_versions WHERE run_id=? ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,digest=excluded.digest,run_id=excluded.run_id').bind(runId),...statements,
  // Read the current configuration inside the transaction: a concurrent disable
  // must not be overwritten by an earlier worker's activation decision.
  db.prepare("UPDATE v2_zoho_mirror_control SET last_success=?,enabled=CASE WHEN json_extract(config,'$.activate_after_success')=1 THEN 1 ELSE enabled END,config=json_set(?, '$.activate_after_success',json('false')) WHERE id=1").bind(state.until,json(cfg))
 ]);
}
