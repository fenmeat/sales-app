import {check,UserError,today,dateKey,addDays} from './domain.js';
import {isAdmin,hash} from './auth.js';
import {readCustomerBalance} from './zoho.js';
import {openingAccount,accountSummary,applyInvoiceCommand} from './invoice-domain.js';
export const INVOICE_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_invoice_balances(customer_id TEXT PRIMARY KEY, payload TEXT NOT NULL, checked_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_invoice_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT, route TEXT NOT NULL, actor TEXT NOT NULL, device TEXT NOT NULL, service_date TEXT NOT NULL, status TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, catalog TEXT NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS v2_invoice_active_route ON v2_invoice_sessions(route) WHERE status='active'`,
 `CREATE TABLE IF NOT EXISTS v2_invoice_events(request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, session_id INTEGER NOT NULL, sequence INTEGER NOT NULL, customer_id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL, captured_at TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(customer_id,revision), UNIQUE(session_id,sequence))`,
 `CREATE INDEX IF NOT EXISTS v2_invoice_customer_events ON v2_invoice_events(customer_id,revision)`
];
export function invoiceAccess(user){check(isAdmin(user.username)||user.username==='mosa','This pilot is available to Alex, Alinda and Mosa.',403);}
function routeStores(c,route){const r=c.routes.find(r=>r.code===route);check(r&&Array.isArray(r.invoice_stores)&&r.invoice_stores.length>0,'This route has not been prepared for invoicing.',409);check(r.invoice_stores.length<=250,'Route is too large.');return r.invoice_stores.map(s=>({...s,route:r.code}));}
async function current(db,store){
 const e=await db.prepare('SELECT payload FROM v2_invoice_events WHERE customer_id=? ORDER BY revision DESC LIMIT 1').bind(store.id).first();if(e)return JSON.parse(e.payload);
 const cached=await db.prepare('SELECT payload FROM v2_invoice_balances WHERE customer_id=?').bind(store.id).first();const opening=cached?JSON.parse(cached.payload):store.opening;
 if(!opening)return null;return openingAccount({...store,opening});
}
const viewSession=s=>s?{id:s.id,route:s.route,actor:s.actor,device:s.device,date:s.service_date,status:s.status,sequence:s.sequence,products:JSON.parse(s.catalog).products,catalog_revision:JSON.parse(s.catalog).revision,opened_at:s.opened_at}:null;
export async function invoiceApi({request,url,env,user,catalog,bodyOf}){
 invoiceAccess(user);const db=env.DB,path=url.pathname;
 if(path==='/api/invoicing/bootstrap'&&request.method==='GET'){
  const route=url.searchParams.get('route')??'R03',stores=routeStores(catalog,route),accounts={};
  for(const s of stores)accounts[s.id]=await current(db,s);
  const session=await db.prepare("SELECT * FROM v2_invoice_sessions WHERE route=? AND status='active'").bind(route).first();
  return {username:user.username,admin:isAdmin(user.username),date:today(),route,route_name:catalog.routes.find(r=>r.code===route).name,stores:stores.map(({opening,...s})=>s),accounts,products:catalog.products.filter(p=>p.active),catalog_revision:catalog.revision,session:viewSession(session),zoho_write:false};
 }
 if(path==='/api/invoicing/reconciliation'&&request.method==='GET')return invoiceReconciliation(db,url.searchParams.get('date'),url.searchParams.get('route'));
 if(path==='/api/invoicing/export'&&request.method==='GET'){
  check(isAdmin(user.username),'Only Alex or Alinda exports the invoice ledger.',403);const from=dateKey(url.searchParams.get('from')??today()),to=dateKey(url.searchParams.get('to')??today());check(from<=to&&to<=addDays(from,31),'Export up to 31 days.');
  const rows=await db.prepare('SELECT e.* FROM v2_invoice_events e JOIN v2_invoice_sessions s ON e.session_id=s.id WHERE s.service_date BETWEEN ? AND ? ORDER BY e.session_id,e.sequence').bind(from,to).all();
  return {generated_at:new Date().toISOString(),from,to,events:rows.results.map(({payload,...e})=>({...e,account:JSON.parse(payload)}))};
 }
 check(request.method==='POST','Method not allowed.',405);const b=await bodyOf(request),route=b.route??'R03',stores=routeStores(catalog,route);
 if(path==='/api/invoicing/balance'){
  check(isAdmin(user.username),'Alex or Alinda refreshes the Zoho opening balances.',403);const s=stores.find(s=>s.id===b.customer_id);check(s,'Unknown customer.');
  const existing=await db.prepare('SELECT 1 AS found FROM v2_invoice_events WHERE customer_id=? LIMIT 1').bind(s.id).first();check(!existing,'This account has started in the app. Its opening balance is locked; use its app ledger.',409);
  const active=await db.prepare("SELECT 1 AS found FROM v2_invoice_sessions WHERE route=? AND status='active'").bind(route).first();check(!active,'Finish and sync the active route before refreshing opening balances.',409);
  const balance=await readCustomerBalance(env,user,s.id);
  await db.prepare('INSERT INTO v2_invoice_balances VALUES(?,?,?) ON CONFLICT(customer_id) DO UPDATE SET payload=excluded.payload,checked_at=excluded.checked_at').bind(s.id,JSON.stringify(balance),balance.generated_at).run();return balance;
 }
 check(typeof b.device==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(b.device),'Missing phone identifier.');
 if(path==='/api/invoicing/start'){
  const date=dateKey(b.date);check(date===today(),'Prepare today’s route while online.');
  const old=await db.prepare("SELECT * FROM v2_invoice_sessions WHERE route=? AND status='active'").bind(route).first();
  if(old){check(old.actor===user.username&&old.device===b.device,'This route is open on another phone. Sync and finish that route first.',409);check(old.service_date===date,'Sync and finish the earlier route before starting today.',409);return {session:viewSession(old)};}
  check(b.cutover_ack===true,'Confirm that this route’s invoices and collections will now be recorded in this app.');
  for(const s of stores){const a=await current(db,s);check(a,'A shop has no verified opening balance: '+s.name,409);if(a.revision===0)check(Date.parse(a.opening.generated_at)>=Date.now()-36*3600000,'Refresh the opening balance for '+s.name,409);}
  const snapshot={products:catalog.products,revision:catalog.revision};let row;
  try{row=await db.prepare("INSERT INTO v2_invoice_sessions(route,actor,device,service_date,status,sequence,catalog,opened_at) VALUES(?,?,?,?,'active',0,?,?) RETURNING *").bind(route,user.username,b.device,date,JSON.stringify(snapshot),new Date().toISOString()).first();}catch{throw new UserError('Another phone started this route. Refresh to check.',409);}
  return {session:viewSession(row)};
 }
 const session=await db.prepare('SELECT * FROM v2_invoice_sessions WHERE id=?').bind(b.session_id).first();check(session&&session.route===route&&session.actor===user.username&&session.device===b.device,'This route belongs to a different signed-in person or phone.',403);
 if(path==='/api/invoicing/finish'){
  check(Number.isSafeInteger(b.sequence)&&b.sequence===session.sequence,'Some transactions are not synced. Sync before finishing.',409);
  const result=await db.prepare("UPDATE v2_invoice_sessions SET status='closed',closed_at=? WHERE id=? AND sequence=? AND status='active'").bind(new Date().toISOString(),session.id,b.sequence).run();check(result.meta.changes===1||session.status==='closed','Route changed while finishing. Refresh.',409);return {closed:true};
 }
 check(path==='/api/invoicing/command','Unknown invoice operation.',404);
 const c=b.command;check(c&&typeof c==='object','Missing invoice command.');
 const fingerprint=await hash(JSON.stringify(b)),prior=await db.prepare('SELECT * FROM v2_invoice_events WHERE request_id=?').bind(c.request_id??'').first();
 if(prior){check(prior.request_hash===fingerprint&&prior.actor===user.username,'Transaction identifier was reused for different data.',409);return {account:JSON.parse(prior.payload),sequence:prior.sequence,replayed:true,saved_at:prior.saved_at};}
 check(session.status==='active','This route has finished.',409);check(Number.isSafeInteger(b.sequence)&&b.sequence===session.sequence+1,'Sync transactions in order before continuing.',409);
 check(typeof c.captured_at==='string'&&Number.isFinite(Date.parse(c.captured_at))&&new Date(Date.parse(c.captured_at)+7200000).toISOString().slice(0,10)===session.service_date,'Capture date differs from the prepared route date.');
 const store=stores.find(s=>s.id===c.customer_id);check(store,'Unknown customer.');const a=await current(db,store);check(a,'Opening balance is missing.',409);
 const ctx={actor:user.username,admin:isAdmin(user.username),date:session.service_date,session:session.id,products:JSON.parse(session.catalog).products,invoiceId:`FM-${session.id}-${b.sequence}`,invoiceNumber:`FM-${session.service_date.replaceAll('-','')}-${session.id}-${String(b.sequence).padStart(3,'0')}`};
 const next=applyInvoiceCommand(a,c,ctx),stamp=new Date().toISOString();
 try{
  await db.batch([
   db.prepare("INSERT INTO v2_invoice_events(request_id,request_hash,session_id,sequence,customer_id,revision,action,payload,actor,captured_at,saved_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM v2_invoice_sessions WHERE id=? AND status='active' AND sequence=?)").bind(c.request_id,fingerprint,session.id,b.sequence,next.customer_id,next.revision,c.action,JSON.stringify(next),user.username,c.captured_at,stamp,session.id,b.sequence-1),
   db.prepare('UPDATE v2_invoice_sessions SET sequence=? WHERE id=? AND sequence=? AND EXISTS(SELECT 1 FROM v2_invoice_events WHERE request_id=?)').bind(b.sequence,session.id,b.sequence-1,c.request_id)
  ]);
 }catch{throw new UserError('A save conflicted or its result is uncertain. Keep this transaction and sync the same identifier again.',409);}
 const saved=await db.prepare('SELECT payload,saved_at FROM v2_invoice_events WHERE request_id=?').bind(c.request_id).first();check(saved,'Route changed before this save. Keep your pending transaction and refresh.',409);
 return {account:JSON.parse(saved.payload),sequence:b.sequence,saved_at:saved.saved_at};
}

export async function invoiceReconciliation(db,date,route){
 dateKey(date);check(typeof route==='string'&&/^[A-Z0-9_-]{1,25}$/.test(route),'Choose a route.');
 const sessions=(await db.prepare('SELECT id,status,sequence FROM v2_invoice_sessions WHERE service_date=? AND route=? ORDER BY id').bind(date,route).all()).results;
 check(sessions.length>0,'No app invoice route was started on this date.',409);check(sessions.every(s=>s.status==='closed'),'Sync every transaction and Finish route on the invoicing phone before reconciliation.',409);
 const rows=(await db.prepare(`SELECT e.payload FROM v2_invoice_events e JOIN (SELECT customer_id,MAX(revision) revision FROM v2_invoice_events GROUP BY customer_id) latest ON latest.customer_id=e.customer_id AND latest.revision=e.revision WHERE e.customer_id IN (SELECT e2.customer_id FROM v2_invoice_events e2 JOIN v2_invoice_sessions s ON s.id=e2.session_id WHERE s.route=?) ORDER BY e.customer_id`).bind(route).all()).results;
 const invoice_lines=[],payments=[];
 for(const row of rows){const a=JSON.parse(row.payload),summary=accountSummary(a);
  for(const i of summary.invoices.filter(i=>i.kind==='app'&&i.date===date))for(const l of i.lines)invoice_lines.push({id:i.id+':'+l.code,invoice_id:i.id,product:l.code,qty:l.qty/1000,status:i.status==='cancelled'?'void':i.balance===0?'paid':i.received?'partially_paid':'sent'});
  for(const r of a.receipts.filter(r=>r.date===date)){let cash=r.cash;for(const allocation of r.allocations){const i=a.invoices.find(i=>i.id===allocation.invoice_id);check(i,'Missing invoice allocation.',500);const cashPart=Math.min(cash,allocation.amount);cash-=cashPart;const shopPart=allocation.amount-cashPart;for(const [method,cents] of [['cash',cashPart],['shop2shop',shopPart]])if(cents)payments.push({id:r.id+':'+i.id+':'+method,date,invoice_date:i.date,method,cents});}}
 }
 const base={complete:true,date,route,source:'FenMeat invoice ledger',invoice_lines,payments,invoice_sessions:sessions.map(s=>({id:s.id,sequence:s.sequence}))};
 return {...base,native_ledger_hash:await hash(JSON.stringify(base)),imported_at:new Date().toISOString()};
}
export async function verifyInvoiceReconciliation(db,recon){
 if(!recon?.native_ledger_hash)return;
 const fresh=await invoiceReconciliation(db,recon.date,recon.route),{native_ledger_hash,imported_at,...base}=recon;
 check(native_ledger_hash===fresh.native_ledger_hash&&await hash(JSON.stringify(base))===fresh.native_ledger_hash,'The invoice ledger changed or this comparison was edited. Load app invoices again.',409);
}

export async function readInvoicePilot(db,catalog,route='R03'){
 const stores=routeStores(catalog,route),tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_invoice_events'").first();
 if(!tables)return {route,store_count:stores.length,ready:false,message:'Open the invoice app to initialise its storage.'};
 const accounts=[];for(const s of stores){const a=await current(db,s);accounts.push({customer_id:s.id,name:a?.name??s.name,stop:s.stop,balance_cents:a?accountSummary(a).balance:null,opening_checked_at:a?.opening.generated_at??null,terms:a?.terms??null,revision:a?.revision??null,invoice_count:a?.invoices.filter(i=>i.kind==='app').length??0,receipt_count:a?.receipts.length??0});}
 const sessions=(await db.prepare("SELECT id,route,actor,service_date,status,sequence FROM v2_invoice_sessions WHERE route=? ORDER BY id DESC LIMIT 5").bind(route).all()).results;
 return {route,store_count:stores.length,balances_loaded:accounts.filter(a=>a.balance_cents!==null).length,total_balance_cents:accounts.every(a=>a.balance_cents!==null)?accounts.reduce((n,a)=>n+a.balance_cents,0):null,credit_terms_pending:accounts.filter(a=>a.terms===null).length,accounts,sessions,generated_at:new Date().toISOString(),zoho_write:false};
}
