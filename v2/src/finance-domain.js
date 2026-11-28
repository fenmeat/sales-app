import {validateBudget,budgetSummary} from './budget-domain.js';
// Shared financial register rules. Amounts are integer cents; blank is unknown.
const field=(key,label,type='text',options)=>({key,label,type,...(options?{options}:{})});
const f=field,amount=(key,label)=>f(key,label,'money'),date=(key,label)=>f(key,label,'date');
const status=f('status','Status','select',['Unknown','To Pay','Paid','Part paid','Query','Confirmed','Provisional']);
export const FINANCE_TYPES={
 budget:{title:'Budget',group:'budget',fields:[f('month','Budget month','month'),f('notes','Notes','textarea')]},
 invoice:{title:'Supplier invoices & credits',group:'suppliers',fields:[f('supplier','Supplier'),f('month','Account month','month'),date('date','Document date'),f('reference','Invoice / credit note'),f('order','Purchase order'),amount('amount','Amount incl. VAT (negative for credit)'),f('review','Needs review','textarea'),f('notes','Notes','textarea')]},
 account:{title:'Monthly accounts',group:'suppliers',fields:[f('supplier','Supplier'),f('month','Account month','month'),date('due_date','Payment due'),f('discount_bps','Settlement discount %','percent'),f('discount_state','Discount','select',['None','Conditional','Confirmed']),amount('statement_total','Statement total before settlement discount'),amount('opening_paid','Previously recorded payment'),date('paid_date','Previous payment date'),f('evidence','Payment evidence','select',['Unknown','Bank proof','Owner confirmation','Marked statement']),status,f('review','Needs review','textarea'),f('notes','Notes','textarea')]},
 weekly:{title:'Weekly payments',group:'weekly',fields:[f('supplier','Supplier'),f('reference','Invoice number'),date('date','Planned payment date'),f('period','Payment week / grouping'),amount('amount','Invoice amount'),amount('opening_paid','Previously recorded payment'),date('paid_date','Previous payment date'),f('evidence','Payment evidence','select',['Unknown','Bank proof','Owner confirmation','Marked statement']),status,f('order','Purchase order'),f('review','Needs review','textarea'),f('notes','Notes','textarea')]},
 payment:{title:'Recorded payments',group:'payments',fields:[f('target_id','Account / invoice record ID'),date('date','Actual payment date'),amount('amount','Amount paid'),f('method','Payment method','select',['EFT','Cash deposit','Cash','Card','Shop2Shop','Other']),f('reference','Payment reference'),f('evidence','Payment evidence','select',['Bank proof','Owner confirmation','Marked statement']),f('notes','Confirmation / notes','textarea')]},
 debt:{title:'Debt collection',group:'debt',fields:[date('date','Route date'),f('route','Route'),f('accounts','Accounts to follow up','integer'),amount('amount','Recorded 7+ day debt'),f('driver','Driver'),f('status','Status','select',['To follow up','Awaiting driver','Payment query','Complete','Historical']),f('notes','Driver feedback / notes','textarea')]},
 credit:{title:'Credit warnings',group:'credit',fields:[date('date','First overdue route date'),f('route','Route'),f('customer','Customer'),f('reference','Invoice number'),amount('amount','Recorded outstanding amount'),f('feedback','Driver feedback','textarea'),f('verification','Verification','select',['Not verified','Outstanding confirmed','Paid confirmed','Payment query','Invoice corrected']),f('verification_note','Source / verification notes','textarea'),f('decision','Credit decision','select',['Under review','Keep 7 days','Warn customer','Cash only']),date('checked_date','Last verified'),f('review','Needs review','textarea'),f('notes','Notes','textarea')]},
 purchase:{title:'Garden Route Deli purchases',group:'garden',fields:[date('date','Purchase date'),f('reference','Supplier invoice'),amount('amount','Garden Route Deli share incl. VAT'),date('recovered_date','Actual recovery date'),amount('recovered','Amount recovered for this purchase'),f('complete','Fully recovered','checkbox'),f('review','Needs review','textarea'),f('notes','Notes','textarea')]},
 stock:{title:'Garden Route Deli stock',group:'garden',fields:[f('reference','Purchase invoice / stock period'),f('product','Product / unit'),f('bought','Purchased units','quantity'),f('opening','Opening units','quantity'),f('received','Received units','quantity'),f('sold','Sold units','quantity'),f('other_out','Other units out','quantity'),f('closing','Counted closing units','quantity'),date('date','Count date'),f('review','Needs review','textarea'),f('notes','Notes','textarea')]},
 settlement:{title:'Garden Route Deli transfers',group:'garden',fields:[f('period','Sales period'),date('date','Closing / planned date'),amount('amount','Amount approved for transfer'),status,date('received_date','Actual date received'),amount('received','Actual amount received'),f('reference','Transfer reference'),f('notes','Coverage / confirmation','textarea')]},
 sale:{title:'Garden Route Deli sales & receipts',group:'garden',fields:[date('date','Invoice date'),f('period','Sales week'),f('reference','Sales invoice'),f('customer','Customer'),f('product','Product'),f('quantity','Units sold','quantity'),amount('unit_price','Selling price per unit'),amount('amount','Product sales amount'),f('status','Receipt status','select',['Unverified','Unpaid','Paid','Part paid - allocation pending','Draft','Query']),f('line_id','Unique source line'),f('payment_reference','Receipt reference'),f('settlement_id','Transfer record ID'),f('notes','Source / notes','textarea')]},
 profit:{title:'Garden Route Deli profit',group:'garden',fields:[f('period','Period'),amount('sales','Final sales'),amount('cost','Cost of goods sold'),amount('expenses','Other expenses'),f('notes','Cost matching / notes','textarea')]},
 note:{title:'Financial notes',group:'notes',fields:[f('title','Title'),f('period','Period'),f('notes','Notes','textarea')]}
};
export const money=n=>n===null||n===undefined?'Unknown':new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(n/100);
export function decimal(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 let s=String(value??'').trim().replace(/[R\s\u00a0]/g,'');if(!s)return null;
 if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replaceAll('.','').replace(',','.'):s.replaceAll(',','');
 else if(s.includes(','))s=/,\d{1,2}$/.test(s)?s.replace(',','.'):s.replaceAll(',','');
 return /^-?\d+(\.\d+)?$/.test(s)&&Number.isFinite(Number(s))?Number(s):null;
}
export function toCents(value){const n=decimal(value);return n===null?null:Math.sign(n)*Math.round((Math.abs(n)+Number.EPSILON)*100);}
export const norm=s=>String(s??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export const dateValid=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&new Date(d+'T12:00Z').toISOString().slice(0,10)===d;
const fail=(ok,message)=>{if(!ok)throw Error(message);};
export function validLink(url){try{const u=new URL(url,'https://fenmeat.invalid');return (!u.username&&!u.password)&&((u.protocol==='https:'&&u.hostname!=='fenmeat.invalid')||/^\/api\/financial\/file\?id=[a-zA-Z0-9-]{16,80}$/.test(url));}catch{return false;}}
export function validateFinancialRecord(record,{importing=false}={}){
 fail(record&&FINANCE_TYPES[record.type]&&/^[a-zA-Z0-9-]{12,100}$/.test(record.id??''),'Invalid financial record.');
 const spec=FINANCE_TYPES[record.type],data=record.data;fail(data&&typeof data==='object'&&!Array.isArray(data),'Record fields are missing.');
 fail(Object.keys(data).every(k=>spec.fields.some(f=>f.key===k)||['links','source','archived'].includes(k)||(record.type==='budget'&&['items','weeks','allocations','copied_from'].includes(k))),'Unknown financial field.');
 if(record.type==='budget')validateBudget(data);
 for(const field of spec.fields){const v=data[field.key];if(v===null||v===undefined||v==='')continue;
  if(['money','integer','percent'].includes(field.type))fail(Number.isSafeInteger(v)&&Math.abs(v)<=100000000000&&(field.type==='money'||v>=0),'Invalid '+field.label+'.');
  else if(field.type==='quantity')fail(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000000000,'Invalid '+field.label+'.');
  else if(field.type==='date')fail(dateValid(v),'Invalid '+field.label+'.');
  else if(field.type==='month')fail(/^\d{4}-(0[1-9]|1[012])$/.test(v),'Choose a valid account month.');
  else if(field.type==='checkbox')fail(typeof v==='boolean','Invalid '+field.label+'.');
  else if(field.type==='select')fail(field.options.includes(v),'Choose a valid '+field.label+'.');
  else fail(typeof v==='string'&&v.length<=(field.type==='textarea'?25000:500),'Invalid '+field.label+'.');
 }
 fail(data.archived===undefined||typeof data.archived==='boolean','Invalid archive state.');
 fail(Array.isArray(data.links??[])&&(data.links??[]).length<=40,'Use up to 40 document links.');
 for(const l of data.links??[])fail(typeof l.label==='string'&&l.label.length<=200&&validLink(l.url),'Use a valid HTTPS document link.');
 fail(JSON.stringify(data.source??null).length<80000,'Source details are too large.');
 if(record.type==='invoice'||record.type==='account')fail(data.supplier?.trim()&&data.month,'Choose a supplier and account month.');
 if(record.type==='invoice'||record.type==='weekly'||record.type==='credit')fail(data.reference?.trim(),'Enter an invoice / document reference.');
 if(record.type==='weekly')fail(data.supplier?.trim(),'Enter a supplier.');
 if(record.type==='credit')fail(data.customer?.trim()&&data.route?.trim()&&data.date,'Enter customer, route and overdue date.');
 if(record.type==='account')fail((data.discount_bps??0)<=10000,'Discount must be between 0% and 100%.');
 for(const k of ['opening_paid','received','recovered'])if(data[k]!=null)fail(data[k]>=0,'Paid / received amounts cannot be negative.');
 if(record.type==='payment'){
  fail(typeof data.target_id==='string'&&data.target_id.length>=12&&data.date&&data.amount>0,'Choose an account, actual payment date and positive amount.');
  fail(data.evidence&&data.evidence!=='Unknown','Record how payment was confirmed.');
  fail(data.reference?.trim()||data.notes?.trim(),'Enter a payment reference or confirmation note.');
  if(data.evidence==='Bank proof')fail(data.links?.length,'Attach or link the bank proof.');
 }
 if(!importing&&data.opening_paid>0)fail(data.paid_date&&data.evidence&&data.evidence!=='Unknown','Previous payments need an actual date and evidence type.');
 if(!importing&&record.type==='settlement'&&data.received>0)fail(data.received_date,'Enter the actual date received.');
 return record;
}
export function recordKey(r){const d=r.data;if(d.archived)return null;
 if(r.type==='budget')return 'budget|'+d.month;
 if(r.type==='invoice')return 'invoice|'+norm(d.supplier)+'|'+norm(d.reference).replace(/\s*[—-]\s*bl\..*$/,'');
 if(r.type==='account')return 'account|'+norm(d.supplier)+'|'+d.month;
 if(r.type==='weekly')return 'weekly|'+norm(d.supplier)+'|'+norm(d.reference);
 if(r.type==='credit')return 'credit|'+norm(d.route)+'|'+norm(d.customer)+'|'+norm(d.reference);
 if(r.type==='sale'&&d.line_id)return 'sale|'+d.line_id;
 return null;
}
export function paymentSum(records,id){return records.filter(r=>r.type==='payment'&&!r.data.archived&&r.data.target_id===id).reduce((n,r)=>n+r.data.amount,0);}
const paymentStatus=(balance,paid,fallback)=>balance==null?fallback||'Unknown':balance<0?'Credit balance':balance===0?'Paid':paid>0?'Part paid':fallback==='Query'?'Query':'To Pay';
export function matchesFinanceFilter(r,s,filter){
 if(!filter||filter==='Archived')return true;
 if(filter==='Needs review')return !!r.data.review;
 if(filter==='Open')return s.outstanding!==undefined?s.outstanding!==0:!['Paid','Complete'].includes(r.data.status);
 return (s.payment_status??r.data.status)===filter;
}
export function accountSummary(account,records){
 const d=account.data,rows=records.filter(r=>r.type==='invoice'&&!r.data.archived&&norm(r.data.supplier)===norm(d.supplier)&&r.data.month===d.month);
 const missing=rows.filter(r=>r.data.amount==null).length,total=rows.reduce((n,r)=>n+(r.data.amount??0),0);
 const discount=d.discount_state==='None'?0:Math.round(total*(d.discount_bps??0)/10000),net=total-discount;
 const paid=(d.opening_paid??0)+paymentSum(records,account.id),known=d.opening_paid!=null||['To Pay','Part paid','Paid'].includes(d.status)||paid>0;
 return {total,discount,net,paid,outstanding:known?net-paid:null,payment_status:paymentStatus(known?net-paid:null,paid,d.status),missing,documents:rows.length,statement_difference:d.statement_total==null?null:total-d.statement_total,conditional:d.discount_state==='Conditional',review:rows.filter(r=>r.data.review).length};
}
export function recordSummary(r,records){const d=r.data;
 if(r.type==='budget')return budgetSummary(d);
 if(r.type==='account')return accountSummary(r,records);
 if(r.type==='weekly'){const paid=(d.opening_paid??0)+paymentSum(records,r.id),outstanding=d.amount==null?null:((d.opening_paid!=null||['To Pay','Part paid','Paid'].includes(d.status)||paid>0)?d.amount-paid:null);return {total:d.amount??null,paid,outstanding,payment_status:paymentStatus(outstanding,paid,d.status)};}
 if(r.type==='stock'){const known=['opening','received','sold','other_out'].every(k=>typeof d[k]==='number');const expected=known?d.opening+d.received-d.sold-d.other_out:null;return {expected,difference:expected!==null&&d.closing!=null?d.closing-expected:null};}
 if(r.type==='profit')return {profit:['sales','cost','expenses'].every(k=>d[k]!=null)?d.sales-d.cost-d.expenses:null};
 if(r.type==='purchase')return {recovery_difference:d.complete&&d.recovered_date&&d.recovered!=null&&d.amount!=null?d.recovered-d.amount:null};
 if(r.type==='settlement')return {remaining:d.amount!=null&&d.received!=null?d.amount-d.received:null};
 if(r.type==='credit'){const end=d.date,from=new Date(Date.parse(end+'T12:00Z')-60*86400000).toISOString().slice(0,10);const refs=new Set(records.filter(x=>x.type==='credit'&&!x.data.archived&&norm(x.data.route)===norm(d.route)&&norm(x.data.customer)===norm(d.customer)&&x.data.date>=from&&x.data.date<=end).map(x=>norm(x.data.reference)));return {cases:refs.size,warning:refs.size>=3?'Consider cash only':refs.size>=2?'Review credit':'Monitor'};}
 return {};
}
export function recordTitle(r){const d=r.data;if(r.type==='budget')return 'Budget · '+d.month;return [d.supplier||d.customer||d.product||d.title||d.period||d.route||'Payment',d.reference||d.month||d.date].filter(Boolean).join(' · ');}
