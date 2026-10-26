// Shared, deterministic account rules. Money is integer cents; quantities are
// integer thousandths of the catalogue sale unit. No implicit paid toggle.
import {check,dateKey,addDays} from './domain.js';
export const invoiceMoney=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000;
export function parseAmount(s){s=String(s??'').trim().replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return invoiceMoney(n)?n:null;}
export function parseQuantity(s){s=String(s??'').trim().replace(',','.');if(!/^\d+(?:\.\d{1,3})?$/.test(s))return null;const [a,b='']=s.split('.');const n=Number(a)*1000+Number(b.padEnd(3,'0'));return Number.isSafeInteger(n)&&n<=100000000?n:null;}
export function openingAccount(store){
 const b=store.opening;check(b?.complete===true&&b.customer_id===store.id&&invoiceMoney(b.balance_cents),'Current opening balance not loaded.');
 check(Array.isArray(b.invoices)&&b.invoices.every(i=>i.customer_id===store.id&&invoiceMoney(i.balance)&&i.balance>0),'Opening invoices are incomplete.');
 check(b.invoices.reduce((n,i)=>n+i.balance,0)===b.balance_cents,'Opening invoice total does not match.');
 return {customer_id:store.id,name:store.name,imported_name:store.name,route:store.route,stop:store.stop,confirmed:false,terms:store.terms??null,revision:0,opening:structuredClone(b),contacts:[],pin:null,invoices:b.invoices.map(i=>({id:'zoho:'+i.id,number:i.number,date:i.date,due:i.due_date,kind:'opening',total:i.balance,original_total:i.total,lines:[],version:1,status:'issued',history:[]})),receipts:[],changes:[]};
}
export function accountSummary(a){
 const invoices=a.invoices.map(i=>{const received=a.receipts.reduce((n,r)=>n+r.allocations.filter(x=>x.invoice_id===i.id).reduce((t,x)=>t+x.amount,0),0);return {...i,received,balance:i.total-received};});
 return {invoices,balance:invoices.reduce((n,i)=>n+i.balance,0),cash:a.receipts.reduce((n,r)=>n+r.cash,0),shop2shop:a.receipts.reduce((n,r)=>n+r.shop2shop,0)};
}
function text(v,max=160){check(typeof v==='string'&&v.trim().length>0&&v.trim().length<=max,'Enter valid text.');return v.trim();}
function receipt(a,c,allocations,ctx){
 check(invoiceMoney(c.cash)&&invoiceMoney(c.shop2shop),'Enter a valid cash and Shop2Shop amount.');
 const sum=c.cash+c.shop2shop;check(invoiceMoney(sum)&&sum>0,'Enter the amount actually received.');
 check(c.received===true,'Confirm that this money was actually received.');
 let reference='';if(c.shop2shop){reference=text(c.reference,100);check(!a.receipts.some(r=>r.shop2shop>0&&r.reference.toLowerCase()===reference.toLowerCase()),'This Shop2Shop reference is already recorded on the account.');}
 check(allocations.reduce((n,x)=>n+x.amount,0)===sum,'Payment allocation does not match.');
 a.receipts.push({id:c.request_id,cash:c.cash,shop2shop:c.shop2shop,reference,allocations,date:ctx.date,captured_at:c.captured_at,actor:ctx.actor});
}
function linesFor(c,ctx,old){
 check(Array.isArray(c.lines)&&c.lines.length<=200,'Choose valid invoice items.');const seen=new Set();
 const lines=c.lines.filter(x=>x.qty!==0).map(x=>{
  check(typeof x.code==='string'&&!seen.has(x.code),'Duplicate or unknown item.');seen.add(x.code);
  check(Number.isSafeInteger(x.qty)&&x.qty>0&&x.qty<=100000000,'Enter a valid quantity.');check(x.checked===true,'Check every delivered product.');
  const existing=old?.lines.find(p=>p.code===x.code),product=ctx.products.find(p=>p.code===x.code);
  check(product&&(existing||product.active&&product.available),'This product is unavailable. Refresh before adding it.');
  const price=existing?.price??product.price_cents;check(invoiceMoney(price),'Product price is missing.');
  const total=Math.round(price*x.qty/1000);check(invoiceMoney(total),'Item amount is too large.');
  return {code:product.code,name:existing?.name??product.name,unit:existing?.unit??product.unit,price,qty:x.qty,total,checked:true};
 });
 const total=lines.reduce((n,i)=>n+i.total,0);check(invoiceMoney(total),'Invoice amount is too large.');return {lines,total};
}
export function applyInvoiceCommand(original,c,ctx){
 const a=structuredClone(original);check(c.customer_id===a.customer_id,'Wrong customer.');check(c.revision===a.revision,'This account changed. Sync and review it before continuing.',409);
 check(typeof c.request_id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(c.request_id),'Missing transaction identifier.');
 check(typeof c.captured_at==='string'&&Number.isFinite(Date.parse(c.captured_at)),'Missing capture time.');dateKey(ctx.date);
 const sum=accountSummary(a);
 if(c.action==='draft'){check(c.draft&&typeof c.draft==='object'&&JSON.stringify(c.draft).length<=50000,'Invalid invoice draft.');check(c.draft.lines&&typeof c.draft.lines==='object'&&!Array.isArray(c.draft.lines)&&Object.keys(c.draft.lines).length<=200,'Invalid draft items.');for(const [code,l] of Object.entries(c.draft.lines)){check(ctx.products.some(p=>p.code===code)&&l&&typeof l.qty==='string'&&l.qty.length<=30&&typeof l.checked==='boolean','Invalid draft quantity.');}for(const k of ['cash','shop2shop','reference','reason'])check(typeof c.draft[k]==='string'&&c.draft[k].length<=300,'Invalid draft field.');check(typeof c.draft.received==='boolean'&&typeof c.draft.returned==='boolean','Invalid draft confirmation.');a.draft=structuredClone(c.draft);}
 else if(c.action==='name'){const name=text(c.name);a.name=name;a.confirmed=true;a.changes.push({kind:'name',name,actor:ctx.actor,at:c.captured_at});}
 else if(c.action==='terms'){check(ctx.admin,'Only Alex or Alinda can approve credit terms.',403);check(c.terms===7||c.terms===0,'Choose cash only or 7-day credit.');a.terms=c.terms;a.changes.push({kind:'terms',terms:c.terms,actor:ctx.actor,at:c.captured_at});}
 else if(c.action==='contacts'){
  check(Array.isArray(c.contacts)&&c.contacts.length<=50,'Use up to 50 contacts.');const nums=new Set();a.contacts=c.contacts.map(p=>{const name=text(p.name,100),phone=text(p.phone,30).replace(/[\s()-]/g,'');const normalized=/^0\d{9}$/.test(phone)?'+27'+phone.slice(1):phone;check(/^\+[1-9]\d{7,14}$/.test(normalized)&&!nums.has(normalized),'Use unique valid phone numbers.');nums.add(normalized);return {name,phone:normalized,role:['Owner','Manager','Staff','Other'].includes(p.role)?p.role:'Other'};});
 }
 else if(c.action==='pin'){check(c.pin&&Number.isFinite(c.pin.lat)&&Math.abs(c.pin.lat)<=90&&Number.isFinite(c.pin.lng)&&Math.abs(c.pin.lng)<=180,'Choose valid coordinates.');a.pin={lat:c.pin.lat,lng:c.pin.lng,note:typeof c.pin.note==='string'?c.pin.note.slice(0,300):'',actor:ctx.actor,at:c.captured_at};}
 else if(c.action==='collect'){
  check(invoiceMoney(c.cash)&&invoiceMoney(c.shop2shop),'Enter valid payment amounts.');let left=c.cash+c.shop2shop;check(left>0&&left<=sum.balance,'Payment exceeds the outstanding balance.');
  const allocations=[];for(const i of [...sum.invoices].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))){const amount=Math.min(left,i.balance);if(amount>0){allocations.push({invoice_id:i.id,amount});left-=amount;}}
  receipt(a,c,allocations,ctx);
 }
 else if(c.action==='issue'){
  check(sum.balance===0,'Settle all previous invoices before completing this invoice.');
  check(!a.invoices.some(i=>i.id===ctx.invoiceId),'This invoice already exists.');
  const {lines,total}=linesFor(c,ctx);check(lines.length>0&&total>0,'Add a product before completing the invoice.');
  check(invoiceMoney(c.cash)&&invoiceMoney(c.shop2shop),'Enter valid payment amounts.');const paid=c.cash+c.shop2shop;check(paid<=total,'Payment exceeds the invoice total.');
  if(paid<total)check(a.terms===7,a.terms===0?'This is a cash-only shop. Receive the full amount.':'Credit terms need Alex or Alinda’s approval before a credit sale.');
  a.invoices.push({id:ctx.invoiceId,number:ctx.invoiceNumber,date:ctx.date,due:paid<total?addDays(ctx.date,7):ctx.date,kind:'app',customer_name:a.name,contact:a.contacts[0]??null,lines,total,version:1,status:'issued',history:[],actor:ctx.actor,captured_at:c.captured_at,session:ctx.session});
  if(paid)receipt(a,c,[{invoice_id:ctx.invoiceId,amount:paid}],ctx);delete a.draft;
 }
 else if(c.action==='revise'){
  const i=a.invoices.find(i=>i.id===c.invoice_id);check(i?.kind==='app'&&i.date===ctx.date&&i.session===ctx.session,'Only today’s invoice on this route visit can be edited.');check(i.version===c.invoice_version,'Invoice version changed.',409);
  const {lines,total}=linesFor(c,ctx,i),paid=sum.invoices.find(x=>x.id===i.id).received;
  check(invoiceMoney(c.cash??0)&&invoiceMoney(c.shop2shop??0),'Enter valid additional payment amounts.');const extra=(c.cash??0)+(c.shop2shop??0);
  check(total>=paid+extra,'This change would require a refund. Keep the issued invoice and ask Alex or Alinda to resolve the refund first.');
  if(total>paid+extra)check(a.terms===7,'Cash-only invoices must remain fully paid. Record the extra payment with a new invoice.');
  const reason=text(c.reason,300);if(i.lines.some(x=>(lines.find(y=>y.code===x.code)?.qty??0)<x.qty))check(c.returned===true,'Confirm that removed goods were not delivered or have been returned.');
  check(JSON.stringify(lines)!==JSON.stringify(i.lines),'No item changes to save.');
  if(extra)receipt(a,c,[{invoice_id:i.id,amount:extra}],ctx);
  const {history,...before}=i;i.history.push(before);Object.assign(i,{lines,total,due:total>paid+extra?addDays(i.date,7):i.due,version:i.version+1,status:total===0?'cancelled':'issued',reason,changed_at:c.captured_at,changed_by:ctx.actor});delete a.draft;
 }
 else check(false,'Unknown invoice action.');
 a.revision++;check(accountSummary(a).invoices.every(i=>invoiceMoney(i.balance)),'Invalid account balance.');return a;
}
