import {isQty} from './domain.js';

// Verified from FEN invoice INV-018567 and Alex's 2 October 2026 confirmation.
// Numeric name prefixes are sort positions. All Zoho/app quantities use the same
// sales unit: e.g. 1 Ouma = 1 outer bag of 5 packs on BOTH systems (factor 1).
// Only immutable Zoho IDs establish a match; names/SKUs never auto-assign one.
const products=new Map([
 ['5173603000000845465','W01'],
 ['5173603000000845476','W02'],
 ['5173603000000845487','W03'],
 ['5173603000000845751','S01'],
 ['5173603000000845762','S02']
]);
const routes=new Map([['5173603000000932936','R07']]);

export function matchZohoInvoice(invoice,catalog){
 const route=catalog.routes.find(r=>r.code===routes.get(invoice.salesperson_id));
 const issues=[];
 if(!route)issues.push('Route needs checking.');
 if(invoice.currency!=='ZAR')issues.push('Invoice currency needs checking.');
 const excluded=['draft','void'].includes(invoice.status);
 if(!excluded&&!['sent','paid','overdue','partially_paid','unpaid'].includes(invoice.status))issues.push('Invoice status needs checking.');
 const seen=new Set(),totals=new Map();
 const lines=invoice.lines.map(line=>{
  const product=catalog.products.find(p=>p.code===products.get(line.item_id));
  let problem=!product?'Product needs checking.':!isQty(line.quantity)?'Quantity needs checking.':null;
  if(seen.has(line.id))problem='Duplicate invoice line ID.';
  seen.add(line.id);
  if(problem)issues.push(problem);
  if(product){
   const total=totals.get(product.code)??{code:product.code,name:product.name,milli:0,valid:true};
   if(problem)total.valid=false;else total.milli+=Math.round(line.quantity*1000);
   totals.set(product.code,total);
  }
  return {line_id:line.id,product_code:product?.code??null,product_name:product?.name??null,quantity_factor:1,problem};
 });
 if(!invoice.lines.length)issues.push('Invoice has no product lines.');
 const quantities=[...totals.values()].map(p=>{
  const quantity=p.milli/1000,valid=p.valid&&isQty(quantity);
  if(!valid)issues.push('Product total needs checking.');
  return {code:p.code,name:p.name,quantity:valid?quantity:null};
 });
 return {invoice_only:true,quantity_factor:1,route:route?{code:route.code,name:route.name}:null,
  excluded,all_matched:issues.length===0,issues:[...new Set(issues)],lines,quantities};
}
