// Pure, integer-cent calculations. No Zoho writes, inferred receipts or pro rata.
export const OWNERS=['Alinda','Xalinda','Xavier'];
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
export function cents(v){
 requireValue(typeof v==='number'&&Number.isFinite(v)&&Number.isSafeInteger(Math.round(v*100))&&Math.abs(v*100-Math.round(v*100))<0.0001,'Missing or invalid money amount');
 return Math.round(v*100);
}
const id=v=>{requireValue(typeof v==='string'&&/^\d{1,40}$/.test(v),'Invalid source ID');return v;};
const date=v=>{requireValue(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v),'Missing source date');return v;};
export function timestamp(v){const n=Date.parse(v);requireValue(typeof v==='string'&&Number.isFinite(n),'Missing change timestamp');return n;}
export const signature=l=>JSON.stringify([l.item_id,l.name,l.qty,l.rate,l.value]);
export function normalInvoice(i,previous){
 requireValue(i&&Array.isArray(i.line_items)&&i.line_items.length<=500,'Missing invoice lines');
 const seen=new Set(),available=[...(previous?.lines??[])];
 const lines=i.line_items.map(l=>{
  const source_id=id(l.line_item_id);requireValue(!seen.has(source_id),'Duplicate invoice line');seen.add(source_id);
  requireValue(typeof l.quantity==='number'&&Number.isFinite(l.quantity)&&l.quantity>=0,'Invalid line quantity');
  const row={source_id,item_id:l.item_id?id(l.item_id):null,name:String(l.name??''),qty:l.quantity,rate:cents(l.rate),value:cents(l.item_total),tax:l.tax_id?(l.tax_amount===undefined?null:cents(l.tax_amount)):0};
  const old=available.findIndex(x=>signature(x)===signature(row));row.key=old>=0?available.splice(old,1)[0].key:'api:'+source_id;
  return row;
 });
 return {id:id(i.invoice_id),number:String(i.invoice_number??''),date:date(i.date),customer:String(i.customer_name??''),customer_id:id(i.customer_id),route:String(i.salesperson_name??''),currency:i.currency_code,status:i.status,total:cents(i.total),balance:cents(i.balance),credits:cents(i.credits_applied),writeoff:cents(i.write_off_amount),adjustment:cents(i.adjustment),tax:cents(i.tax_total),shipping:cents(i.shipping_charge),modified:new Date(timestamp(i.last_modified_time)).toISOString(),lines};
}
export function normalPayment(p,{modified,refunded}={}){
 requireValue(p&&Array.isArray(p.invoices)&&p.invoices.length<=500,'Missing payment allocations');
 const seen=new Set();
 const allocations=p.invoices.map(a=>{
  const invoice_id=id(a.invoice_id);requireValue(!seen.has(invoice_id),'Duplicate payment allocation');seen.add(invoice_id);
  return {id:a.invoice_payment_id?String(a.invoice_payment_id):invoice_id,invoice_id,number:String(a.invoice_number??''),value:cents(a.amount_applied),withheld:cents(a.tax_amount_withheld??0)};
 });
 const result={id:id(p.payment_id),number:String(p.payment_number??''),date:date(p.date),customer_id:id(p.customer_id),currency:p.currency_code,amount:cents(p.amount),unused:cents(p.unused_amount),refunded:cents(p.amount_refunded??refunded),modified:new Date(timestamp(p.last_modified_time||modified)).toISOString(),allocations};
 requireValue(result.amount>=0&&result.unused>=0&&allocations.every(a=>a.value>=0&&a.withheld>=0),'Negative payment amount');
 const allocated=allocations.reduce((s,a)=>s+a.value,0)+result.unused;
 requireValue(allocated===result.amount||allocated+result.refunded===result.amount,'Payment allocations do not reconcile');
 return result;
}
export function assessInvoice(invoice,payments,mapping,settlements=[]){
 const errors=[],lines=[],seen=new Set();let received=0;
 for(const p of payments){
  requireValue(!seen.has(p.id),'Duplicate payment');seen.add(p.id);
  for(const a of p.allocations){if(a.invoice_id===invoice.id){
   received+=a.value;
   if(p.currency!=='ZAR'||p.customer_id!==invoice.customer_id||p.refunded||a.withheld)errors.push('Payment needs reconciliation');
  }}
 }
 const relevant=invoice.lines.some(l=>mapping[l.item_id]?.owner)||settlements.length;
 if(invoice.date<'2026-10-14')return {id:invoice.id,lines:[],errors:[],received,excluded:true};
 for(const l of invoice.lines){if(!Object.hasOwn(mapping,l.item_id))errors.push('Unknown product ownership: '+l.item_id);}
 if(!relevant)return {id:invoice.id,lines:[],errors:[...new Set(errors)],received};
 if(invoice.currency!=='ZAR'||![invoice.total,invoice.balance,invoice.credits,invoice.writeoff,invoice.adjustment,invoice.tax,invoice.shipping,received].every(Number.isSafeInteger))errors.push('Missing invoice amounts/currency');
 if(invoice.lines.reduce((s,l)=>s+l.value,0)+invoice.tax!==invoice.total||invoice.shipping||invoice.adjustment||invoice.credits||invoice.writeoff||invoice.lines.some(l=>mapping[l.item_id]?.owner&&l.tax!==0))errors.push('Invoice discount, credit, tax or adjustment needs review');
 const draft=invoice.status==='draft',voided=['void','cancelled'].includes(invoice.status);
 if(!['paid','closed','sent','open','overdue','unpaid','partiallypaid','partially_paid','viewed','draft','void','cancelled'].includes(invoice.status))errors.push('Unknown invoice status');
 if(!draft&&!voided&&received+invoice.balance!==invoice.total)errors.push('Receipts and invoice balance differ');
 for(const s of settlements){const l=invoice.lines.find(l=>l.key===s.key);if(!l||signature(l)!==s.signature||s.amount>l.value||s.owner!==mapping[l.item_id]?.owner)errors.push('Previously settled line changed or disappeared');}
 const state=draft?'draft':voided?'void':errors.length?'unresolved':received===invoice.total&&invoice.balance===0?'paid':received>0?'partial':'unpaid';
 for(const l of invoice.lines){const m=mapping[l.item_id];if(!m?.owner)continue;requireValue(OWNERS.includes(m.owner),'Unknown owner');
  const settled=settlements.filter(s=>s.key===l.key).reduce((s,x)=>s+x.amount,0);
  if(settled&&state!=='paid')errors.push('Previously settled invoice is no longer fully paid');
  lines.push({...l,owner:m.owner,code:m.code,invoice_id:invoice.id,invoice:invoice.number,date:invoice.date,customer:invoice.customer,route:invoice.route,state,settled,eligible:state==='paid'?l.value:0,due:state==='paid'?l.value-settled:0,invoice_total:invoice.total,invoice_received:received,invoice_balance:invoice.balance});
 }
 return {id:invoice.id,received,lines,errors:[...new Set(errors)]};
}
export function summarize(assessments,through){
 const owners=Object.fromEntries(OWNERS.map(o=>[o,{eligible:0,settled:0,due:0,unpaid:0,partial:0,draft:0}]));
 const errors=[],lines=[];
 for(const a of assessments){errors.push(...a.errors.map(error=>({invoice_id:a.id,error})));for(const l of a.lines){if(l.date>through)continue;lines.push(l);const s=owners[l.owner];s.eligible+=l.eligible;s.settled+=l.settled;s.due+=l.due;if(['unpaid','partial','draft'].includes(l.state))s[l.state]+=l.value;}}
 return {owners,total:Object.values(owners).reduce((s,o)=>s+o.due,0),lines,errors};
}
