export class UserError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
export function check(ok, message, status=400) { if (!ok) throw new UserError(message,status); }
export function dateKey(value) { const stamp=typeof value==='string'?Date.parse(value+'T12:00:00Z'):NaN;check(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10)===value,'Use a valid YYYY-MM-DD date.'); return value; }
export const today = () => new Date(Date.now()+7200000).toISOString().slice(0,10);
export const addDays = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export const weekday = date => new Date(date+'T12:00:00Z').getUTCDay();
export const roundQty = x => Math.round(x*1000)/1000;
export const isQty = x => typeof x==='number' && Number.isFinite(x) && x>=0 && x<=100000 && Math.abs(x*1000-Math.round(x*1000))<0.00001;
export const isMoney = x => Number.isSafeInteger(x) && x>=0 && x<=1000000000;
export function cleanText(v, max=300) { check(typeof v==='string' && v.length<=max,'Text is missing or too long.'); return v.trim(); }
// All money is integer cents; blank counts stay distinct from a counted zero.
export const CASH_DENOMINATIONS = [20000,10000,5000,2000,1000,500,200,100,50];
export function cashCountTotal(counts) {
  if(counts==null)return null;
  check(typeof counts==='object'&&!Array.isArray(counts),'Invalid cash count.');
  check(Object.keys(counts).length===CASH_DENOMINATIONS.length&&CASH_DENOMINATIONS.every(d=>Object.hasOwn(counts,d)),'Capture all cash denominations.');
  let total=0,entered=false;
  for(const d of CASH_DENOMINATIONS){const n=counts[d];if(n===null)continue;check(Number.isSafeInteger(n)&&n>=0&&n<=100000,'Cash counts must be non-negative whole numbers.');entered=true;total+=d*n;}
  check(isMoney(total),'Cash count is too large.');
  return entered?total:null;
}
export function availableForLoad(item,products=[]) {
  const current=products.find(p=>p.code===item.code);
  return current?current.active&&current.available:item.available;
}
export function captureItems(run,evening,products=[]) {
  return run.items.filter(i=>evening?i.loaded>0||i.returned>0:availableForLoad(i,products));
}
export function validateCatalog(c) {
  check(c && Array.isArray(c.products) && c.products.length>0 && c.products.length<=200 && Array.isArray(c.routes) && c.routes.length>0 && c.routes.length<=50,'Invalid product/route catalogue.');
  for(const list of [c.products,c.routes]) { const seen=new Set(); for(const p of list) { check(/^[A-Z0-9_-]{1,25}$/.test(p.code) && !seen.has(p.code),'Duplicate or invalid catalogue code.'); seen.add(p.code); cleanText(p.name,120); } }
  for(const p of c.products) check(isMoney(p.price_cents) && typeof p.available==='boolean' && typeof p.active==='boolean' && typeof p.unit==='string' && p.unit.length<=30,'Invalid product price, unit or availability.');
  for(const r of c.routes) check(Number.isInteger(r.weekday) && r.weekday>=0 && r.weekday<=6,'Invalid route weekday.');
  return c;
}
export function emptyRun(date,route,products,forecasts={}) {
  return {date,route,trip:1,phase:'plan',rep:'',vehicle:'',notes:'',items:products.filter(p=>p.active).map(p=>({code:p.code,name:p.name,unit:p.unit,price_cents:p.price_cents,available:p.available,forecast:forecasts[p.code]??null,planned:null,loaded:null,returned:null,sold_out:null,adjustment:0,adjustment_reason:''})),cash:{denominations:null,counted:null,float:0,banked:0,expenses:0,extra:0,adjustment_reason:'',shop2shop:null,card:null,eft:null},recon:null};
}
export function itemSales(item) {
  if(item.loaded===null||item.returned===null) return null;
  return roundQty(item.loaded-item.returned-item.adjustment);
}
export function summarise(run) {
  const comparison=run.recon;
  const invoiceTotals={};
  for(const i of comparison?.invoice_lines??[]) if(!['draft','void'].includes(i.status)) invoiceTotals[i.product]=roundQty((invoiceTotals[i.product]??0)+i.qty);
  const items=run.items.map(i=>{const sold=itemSales(i);const invoiced=comparison?.complete?invoiceTotals[i.code]??0:null;return {...i,sold,invoiced,variance:sold===null||invoiced===null?null:roundQty(sold-invoiced)};});
  // Include invoiced products that were never loaded, so discrepancies cannot disappear.
  for(const [code,qty] of Object.entries(invoiceTotals)) if(!items.some(i=>i.code===code)) items.push({code,name:code,sold:0,invoiced:qty,variance:-qty,loaded:0,returned:0,price_cents:0});
  const receipts={cash:null,shop2shop:null,card:null,eft:null}; let currentCash=0,oldCash=0,unallocatedCash=0;
  if(comparison?.complete){for(const k of Object.keys(receipts))receipts[k]=0;for(const p of comparison.payments){receipts[p.method]+=p.cents;if(p.method==='cash'){if(!p.invoice_date)unallocatedCash+=p.cents;else if(p.invoice_date<run.date)oldCash+=p.cents;else currentCash+=p.cents;}}}
  const c=run.cash;const expected=receipts.cash===null?null:c.float+receipts.cash+c.extra-c.banked-c.expenses;
  const counted=c.denominations==null?c.counted:cashCountTotal(c.denominations);
  const cashVariance=expected===null||counted===null?null:counted-expected;
  const variances={cash:cashVariance,...Object.fromEntries(['shop2shop','card','eft'].map(k=>[k,receipts[k]===null||c[k]===null?null:c[k]-receipts[k]]))};
  return {items,receipts,currentCash,oldCash,unallocatedCash,expected,cashVariance,variances,stock_complete:items.every(i=>i.sold!==null),stock_matches:!!comparison?.complete&&items.every(i=>i.variance===0),cash_matches:Object.values(variances).every(v=>v===0),estimated_value_cents:items.every(i=>i.sold!==null)?Math.round(items.reduce((s,i)=>s+i.sold*i.price_cents,0)):null};
}
export function validateRecon(recon,run) {
  check(recon && recon.complete===true,'Confirm that the invoice and payment extract is complete.');
  check(recon.date===run.date && recon.route===run.route,'The reconciliation date and route must match the run.');
  check(Array.isArray(recon.invoice_lines)&&Array.isArray(recon.payments)&&recon.invoice_lines.length<=2000&&recon.payments.length<=2000,'Invalid reconciliation rows.');
  cleanText(recon.source,200);check(recon.source.length>0,'Record the report/source reference.');
  let seen=new Set();for(const i of recon.invoice_lines){check(typeof i.id==='string'&&i.id.length>0&&!seen.has(i.id),'Invoice line IDs must be unique.');seen.add(i.id);check(typeof i.product==='string'&&isQty(i.qty)&&['sent','paid','overdue','partially_paid','unpaid','draft','void'].includes(i.status),'Invalid invoice line.');}
  seen=new Set();for(const p of recon.payments){check(typeof p.id==='string'&&p.id.length>0&&!seen.has(p.id),'Payment allocation IDs must be unique.');seen.add(p.id);check(p.date===run.date&&['cash','shop2shop','card','eft'].includes(p.method)&&isMoney(p.cents),'Payment date, method or amount is invalid.');if(p.invoice_date){dateKey(p.invoice_date);check(p.invoice_date<=run.date,'Invoice date cannot follow payment date.');}}
  return recon;
}
export function validateRun(run, previous, action) {
  check(run && ['save','load','returns','close','reopen','reconcile'].includes(action),'Invalid save action.');dateKey(run.date);check(/^[A-Z0-9_-]{1,25}$/.test(run.route),'Invalid route.');check(run.trip===1,'One combined route run per day is supported in this pilot.');
  check(Array.isArray(run.items)&&run.items.length>0&&run.items.length<=200,'No route items.');
  const seen=new Set();for(const i of run.items){check(!seen.has(i.code),'Duplicate product.');seen.add(i.code);check(isMoney(i.price_cents),'Invalid price.');for(const k of ['planned','loaded','returned']) check(i[k]===null||isQty(i[k]),'Enter a non-negative quantity, or leave it blank.');check(isQty(i.adjustment),'Invalid non-sale stock adjustment.');check(i.adjustment===0||cleanText(i.adjustment_reason).length>=3,'Explain each damage, sample or transfer adjustment.');check([true,false,null].includes(i.sold_out),'Invalid sold-out value.');if(i.loaded!==null&&i.returned!==null)check(i.returned+i.adjustment<=i.loaded,'Returns and non-sale stock cannot exceed the load.');if(i.sold_out===true)check(i.loaded>0&&i.returned===0,'Sold out requires a positive load and zero returns.');}
  cleanText(run.rep,80);cleanText(run.vehicle,40);cleanText(run.notes,1000);
  check(run.cash&&typeof run.cash==='object'&&!Array.isArray(run.cash),'Missing cash fields.');
  if(run.cash.denominations!=null)run.cash.counted=cashCountTotal(run.cash.denominations);
  for(const [k,v] of Object.entries(run.cash))if(!['adjustment_reason','denominations'].includes(k))check(v===null||isMoney(v),'Cash values must be non-negative cents.');
  for(const k of ['counted','float','banked','expenses','extra','shop2shop','card','eft'])check(Object.hasOwn(run.cash,k),'Missing cash field.');
  check(['float','banked','expenses','extra'].every(k=>run.cash[k]!==null),'Float and cash adjustments require explicit amounts.');
  check(!(run.cash.banked||run.cash.expenses||run.cash.extra)||cleanText(run.cash.adjustment_reason).length>=3,'Explain cash banked, expenses or other cash added.');
  for(const i of run.items){const prior=previous?.items.find(p=>p.code===i.code);check(i.adjustment===(prior?.adjustment??0),'Non-sale stock entry is no longer supported. Existing saved adjustments must be preserved.');}
  for(const k of ['float','banked','expenses','extra'])check(run.cash[k]===(previous?.cash[k]??0),'Cash adjustments are no longer supported. Existing saved amounts must be preserved.');
  // Hidden, never-loaded products must not block confirmation or imply unknown sales.
  for(const i of run.items){if(!i.available&&i.loaded===null)i.loaded=0;if(i.loaded===0&&i.returned===null)i.returned=0;}
  if(run.recon)validateRecon(run.recon,run);
  if(previous){check(previous.date===run.date&&previous.route===run.route,'A saved run cannot change its date or route.');if(previous.phase==='closed')check(action==='reopen','Reopen this run before changing it.');if(previous.phase!=='closed')check(action!=='reopen','Only a closed run can be reopened.');}
  else check(['save','load'].includes(action),'Save a morning plan first.');
  if(action==='load'){check(run.rep.length>0,'Enter the salesperson.');check(run.items.every(i=>i.loaded!==null),'Capture all actual load quantities, including zero.');run.phase='loaded';}
  else if(action==='returns'){check(previous&&['loaded','returned'].includes(previous.phase),'Confirm the morning load first.');check(run.items.every(i=>i.loaded!==null&&i.returned!==null),'Capture every evening return, including zero.');run.phase='returned';}
  else if(action==='close'){const s=summarise(run);check(previous?.phase==='returned','Confirm evening returns first.');check(s.stock_matches&&s.cash_matches,'Resolve stock and payment differences before closing.');check(!s.unallocatedCash,'Allocate the unallocated cash before closing.');run.phase='closed';}
  else if(action==='reopen'){check(cleanText(run.notes).length>=5,'Record the reason for reopening.');run.phase='returned';}
  else run.phase=previous?.phase??'plan';
  if(previous?.phase==='loaded'||previous?.phase==='returned'){check(run.items.every(i=>i.loaded!==null),'Confirmed loads cannot become blank.');if(previous.phase==='returned')check(run.items.every(i=>i.returned!==null),'Confirmed returns cannot become blank.');}
  return run;
}
