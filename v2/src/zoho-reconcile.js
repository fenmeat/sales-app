import {check,dateKey,today,isMoney,isQty,validateRecon} from './domain.js';
import {readZoho,ZOHO_ORGANISATION} from './zoho.js';
import {zohoMatch} from './zoho-matching.js';

const excluded=status=>['draft','void'].includes(status);
const active=status=>['sent','paid','overdue','partially_paid','unpaid'].includes(status);
const money=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value*100-Math.round(value*100))<0.00001&&isMoney(Math.round(value*100))?Math.round(value*100):null;
const channels={cash:'cash',shop2shop:'shop2shop','shop 2 shop':'shop2shop',card:'card',creditcard:'card','credit card':'card','debit card':'card',eft:'eft',banktransfer:'eft','bank transfer':'eft'};
const canonical=rows=>JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)));

// Pure comparison: never turns invoice totals/balances into receipts, never
// multiplies outer packs, and never fills independent physical captures.
export function assembleZohoReconciliation(job,catalog){
 const issues=[],invoice_lines=[],payments=[],selected=catalog.routes.find(r=>r.code===job.route);
 const issue=(kind,record,message,extra={})=>issues.push({kind,id:record?.id??'',reference:record?.number??'',message,...extra});
 for(const header of job.invoice_headers){
  if(excluded(header.status))continue;
  const invoice=job.invoices[header.id];
  if(!invoice){issue('invoice',header,'Invoice detail is missing.');continue;}
  if(invoice.date!==job.date){issue('invoice',invoice,'Invoice date changed during the read.');continue;}
  if(excluded(invoice.status)){issue('invoice',invoice,'Invoice status changed during the read.');continue;}
  const route=zohoMatch(catalog,'route',invoice.salesperson_id);
  if(!route){issue('route',invoice,'Match this Zoho salesperson to an app route.',{zoho_id:invoice.salesperson_id,name:invoice.salesperson});continue;}
  if(route.code!==job.route)continue;
  if(invoice.currency!=='ZAR'||!active(invoice.status)){issue('invoice',invoice,'Check invoice currency or status.');continue;}
  if(!invoice.lines.length)issue('invoice',invoice,'Invoice has no product lines.');
  const seen=new Set();
  for(const line of invoice.lines){
   const product=zohoMatch(catalog,'product',line.item_id);
   if(!product){issue('product',invoice,'Match this Zoho item to its app sales unit.',{zoho_id:line.item_id,name:line.name,unit:line.unit});continue;}
   if(!isQty(line.quantity)||seen.has(line.id)){issue('invoice',invoice,'Invalid quantity or duplicate invoice line.');continue;}
   seen.add(line.id);invoice_lines.push({id:invoice.id+':'+line.id,invoice_id:invoice.id,invoice_number:invoice.number,product:product.code,qty:line.quantity,status:invoice.status});
  }
 }
 for(const header of job.payment_headers){
  const payment=job.payments[header.id];
  if(!payment){issue('payment',header,'Payment detail is missing.');continue;}
  const allocations=payment.invoices??[],routes=new Set();let unknown=false;
  for(const a of allocations){const invoice=job.invoices[a.invoice_id];const route=invoice&&zohoMatch(catalog,'route',invoice.salesperson_id);if(!route)unknown=true;else routes.add(route.code);}
  // A payment without a resolved route might belong here; it cannot be zero.
  if(unknown||!allocations.length){issue('payment',payment,'Payment has an invoice or route that still needs allocation.');continue;}
  if(!routes.has(job.route))continue;
  const amount=money(payment.amount),unused=money(payment.unused_amount??0),refunded=money(payment.refunded??0),charges=money(payment.bank_charges??0);
  if(payment.date!==job.date||payment.currency!=='ZAR'||payment.status&& !['success','paid','completed'].includes(payment.status.toLowerCase())||amount===null||unused===null||unused>0||refunded!==0||charges===null||charges>0){issue('payment',payment,'Check payment date, currency, status, unused credit, refund or bank charges.');continue;}
  const normalized=payment.method.trim().toLowerCase();
  const method=Object.hasOwn(selected?.zoho_payment_methods??{},payment.method)?selected.zoho_payment_methods[payment.method]:Object.hasOwn(channels,normalized)?channels[normalized]:null;
  if(!method){issue('method',payment,'Match the Zoho payment method to cash, Shop2Shop, card or EFT.',{name:payment.method});continue;}
  let sum=0,valid=true;const seen=new Set(),parts=[];
  for(const a of allocations){
   const invoice=job.invoices[a.invoice_id],cents=money(a.applied),withheld=money(a.withheld??0);
   if(!invoice||seen.has(a.invoice_id)||cents===null||withheld!==0||invoice.currency!=='ZAR'||excluded(invoice.status)||!active(invoice.status)||invoice.date>job.date||payment.customer_id&&invoice.customer_id&&payment.customer_id!==invoice.customer_id){valid=false;break;}
   seen.add(a.invoice_id);sum+=cents;
   if(zohoMatch(catalog,'route',invoice.salesperson_id)?.code===job.route)parts.push({id:payment.id+':'+invoice.id,payment_id:payment.id,payment_number:payment.number,invoice_id:invoice.id,invoice_number:invoice.number,date:job.date,invoice_date:invoice.date,method,cents});
  }
  if(!valid||sum!==amount){issue('payment',payment,'Invoice allocations do not equal the received payment, or contain unsupported adjustments.');continue;}
  payments.push(...parts);
 }
 const unique=[...new Map(issues.map(x=>[JSON.stringify(x),x])).values()];
 const recon={date:job.date,route:job.route,complete:unique.length===0,source:'FEN Zoho Books '+ZOHO_ORGANISATION.id,zoho_job_id:job.id,read_started_at:job.started_at,imported_at:job.finished_at,invoice_lines,payments};
 if(recon.complete)validateRecon(recon,{date:job.date,route:job.route});
 return {complete:recon.complete,issues:unique,recon:recon.complete?recon:null,counts:{invoices:job.invoice_headers.length,payments:job.payment_headers.length,matched_invoice_lines:invoice_lines.length,matched_payment_allocations:payments.length},allocation_basis:'Payments follow the salesperson route of each allocated invoice; older invoices are included. Unallocated or unsupported receipts prevent completion.'};
}

async function currentJob(db,id){check(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'Choose a valid reconciliation read.');const row=await db.prepare('SELECT * FROM v2_zoho_recon_jobs WHERE id=?').bind(id).first();check(row&&row.expires>Date.now(),'This Zoho read expired. Start a new read.',409);return row;}
function publicJob(job,version){return {id:job.id,version,date:job.date,route:job.route,stage:job.stage,done:job.stage==='done',progress:{invoice_pages:job.invoice_page-1,invoices_read:Object.keys(job.invoices).length,payment_pages:job.payment_page-1,payments_read:Object.keys(job.payments).length},...(job.result?{result:job.result}:{}),read_only:true};}

// One bounded upstream read per step makes a large day resumable and avoids a
// long HTTP request. CAS prevents competing responses overwriting newer steps.
export async function zohoReconciliation(env,user,input,catalog,read=readZoho){
 check(user.username==='alex','Alex manages the Zoho reconciliation read.',403);
 if(!input.job_id){
  const date=dateKey(input.date);check(date>='2026-10-01'&&date<=today(),'Choose a date from 1 October 2026 up to today.');check(catalog.routes.some(r=>r.code===input.route),'Choose an app route.');
  const job={id:crypto.randomUUID(),date,route:input.route,catalog_revision:catalog.revision,started_at:new Date().toISOString(),stage:'invoices',invoice_page:1,payment_page:1,invoice_headers:[],payment_headers:[],invoices:{},payments:{},verify:[],verify_page:1};
  await env.DB.prepare('DELETE FROM v2_zoho_recon_jobs WHERE expires<?').bind(Date.now()).run();
  await env.DB.prepare('INSERT INTO v2_zoho_recon_jobs VALUES(?,?,?,?,?)').bind(job.id,user.username,0,Date.now()+7200000,JSON.stringify(job)).run();return publicJob(job,0);
 }
 const row=await currentJob(env.DB,input.job_id);check(row.actor===user.username,'This read belongs to another user.',403);const job=JSON.parse(row.payload);
 if(input.inspect===true||job.stage==='done')return publicJob(job,row.version);
 check(input.version===row.version,'The read advanced in another request. Resume its latest version.',409);
 check(job.catalog_revision===catalog.revision,'Product or route mappings changed. Start a fresh Zoho read.',409);
 if(job.last_request_at&&Date.now()-job.last_request_at<1100)await new Promise(resolve=>setTimeout(resolve,1100-(Date.now()-job.last_request_at)));
 const get=query=>read(env,user,query);
 if(['invoices','payments','verify_invoices','verify_payments'].includes(job.stage)){
  const verify=job.stage.startsWith('verify_'),type=job.stage.endsWith('invoices')?'invoices':'payments',key=type==='invoices'?'invoice':'payment',page=verify?job.verify_page:job[key+'_page'];
  const result=await get({resource:type,date:job.date,page});check(result.page===page&&typeof result.has_more==='boolean'&&Array.isArray(result.records),'Incomplete Zoho page.',502);
  const list=verify?job.verify:job[key+'_headers'];const ids=new Set(list.map(x=>x.id));check(result.records.every(x=>!ids.has(x.id)),'Duplicate records across Zoho pages. Restart the read.',409);list.push(...result.records);check(list.length<=1000&&page<=100,'This day is too large for one reconciliation read.');
  if(verify)job.verify_page++;else job[key+'_page']++;
  if(!result.has_more){
   if(verify){check(canonical(list)===canonical(job[key+'_headers']),'Zoho changed while it was being read. Start again to use the latest records.',409);job.verify=[];job.verify_page=1;job.stage=type==='invoices'?'verify_payments':'finish';}
   else job.stage=type==='invoices'?'invoice_details':'payment_details';
  }
 }else if(job.stage==='invoice_details'){
  const next=job.invoice_headers.find(i=>!excluded(i.status)&&!job.invoices[i.id]);
  if(next){const d=await get({resource:'invoice',id:next.id});check(d.invoice.id===next.id&&d.invoice.date===job.date,'Invoice changed during the read.',409);job.invoices[next.id]=d.invoice;}
  if(!job.invoice_headers.some(i=>!excluded(i.status)&&!job.invoices[i.id]))job.stage='payments';
 }else if(job.stage==='payment_details'){
  const next=job.payment_headers.find(p=>!job.payments[p.id]);
  if(next){const d=await get({resource:'payment',id:next.id});check(d.payment.id===next.id&&d.payment.date===job.date,'Payment changed during the read.',409);job.payments[next.id]=d.payment;}
  if(!job.payment_headers.some(p=>!job.payments[p.id]))job.stage='allocated_invoices';
 }else if(job.stage==='allocated_invoices'){
  const next=Object.values(job.payments).flatMap(p=>p.invoices).find(a=>!job.invoices[a.invoice_id]);
  if(next){const d=await get({resource:'invoice',id:next.invoice_id});check(d.invoice.id===next.invoice_id,'Wrong allocated invoice.',502);job.invoices[next.invoice_id]=d.invoice;}
  if(!Object.values(job.payments).flatMap(p=>p.invoices).some(a=>!job.invoices[a.invoice_id]))job.stage='verify_invoices';
 }
 if(job.stage==='finish'){job.finished_at=new Date().toISOString();job.result=assembleZohoReconciliation(job,catalog);job.stage='done';}
 job.last_request_at=Date.now();const payload=JSON.stringify(job);check(payload.length<=1500000,'This read exceeds the safe snapshot size.');
 const result=await env.DB.prepare('UPDATE v2_zoho_recon_jobs SET version=version+1,payload=? WHERE id=? AND version=?').bind(payload,job.id,row.version).run();check(result.meta.changes===1,'Another request advanced the read. Resume its latest version.',409);
 return publicJob(job,row.version+1);
}

export async function verifyZohoSnapshot(db,recon,previous,catalog){
 if(!recon?.zoho_job_id||JSON.stringify(recon)===JSON.stringify(previous?.recon))return;
 const row=await currentJob(db,recon.zoho_job_id),job=JSON.parse(row.payload);
 check(job.stage==='done'&&job.result?.complete&&job.catalog_revision===catalog.revision&&JSON.stringify(job.result.recon)===JSON.stringify(recon),'Use a complete, unchanged Zoho read with the current product and route mappings.',409);
}
