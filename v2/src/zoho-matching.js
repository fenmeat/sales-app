import {isQty,check,validateCatalog} from './domain.js';

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

// Reviewed catalogue IDs extend (or explicitly replace) the original pilot IDs.
export function zohoMatch(catalog,kind,id){
 const list=kind==='product'?catalog.products:catalog.routes,key=kind==='product'?'zoho_item_ids':'zoho_salesperson_ids';
 const explicit=list.filter(x=>x[key]?.includes(id)||(kind==='product'&&x[key]===undefined&&x.zoho_item_id===id));
 if(explicit.length===1)return explicit[0];
 if(explicit.length)return null;
 const code=(kind==='product'?products:routes).get(id);
 return list.find(x=>x.code===code&&x[key]===undefined)??null;
}

export function applyZohoMappings(catalog,input){
 check(Array.isArray(input.entries)&&input.entries.length<=200,'Choose valid Zoho matches.');const next=structuredClone(catalog),seen=new Set();
 for(const entry of input.entries){
  check(['product','route','method'].includes(entry.kind),'Choose a product, route or payment method.');
  const identity=entry.kind+':'+entry.id;check(!seen.has(identity),'Review duplicate mapping choices.');seen.add(identity);
  if(entry.kind==='method'){
   const route=next.routes.find(r=>r.code===input.route);check(route&&typeof entry.id==='string'&&entry.id.length>0&&entry.id.length<=80&&['cash','shop2shop','card','eft'].includes(entry.code),'Choose a valid payment method.');route.zoho_payment_methods={...route.zoho_payment_methods,[entry.id]:entry.code};continue;
  }
  check(typeof entry.id==='string'&&/^[0-9]{1,40}$/.test(entry.id),'Choose a real Zoho record ID.');
  const list=entry.kind==='product'?next.products:next.routes,key=entry.kind==='product'?'zoho_item_ids':'zoho_salesperson_ids',defaults=entry.kind==='product'?products:routes;
  check(list.some(e=>e.code===entry.code),'Choose an app catalogue entry.');
  for(const e of list){const ids=e[key]??(entry.kind==='product'&&e.zoho_item_id?[e.zoho_item_id]:[...defaults].filter(([,code])=>code===e.code).map(([id])=>id));if(e.code===entry.code||ids.includes(entry.id)){e[key]=ids.filter(id=>id!==entry.id);if(e.code===entry.code)e[key].push(entry.id);e.zoho_mapping_source='Owner-reviewed Zoho matching, 1 app sales unit = 1 Zoho sales unit; '+new Date().toISOString();}}
 }
 return validateCatalog(next);
}

export function matchZohoInvoice(invoice,catalog){
 const route=zohoMatch(catalog,'route',invoice.salesperson_id);
 const issues=[];
 if(!route)issues.push('Route needs checking.');
 if(invoice.currency!=='ZAR')issues.push('Invoice currency needs checking.');
 const excluded=['draft','void'].includes(invoice.status);
 if(!excluded&&!['sent','paid','overdue','partially_paid','unpaid'].includes(invoice.status))issues.push('Invoice status needs checking.');
 const seen=new Set(),totals=new Map();
 const lines=invoice.lines.map(line=>{
  const product=zohoMatch(catalog,'product',line.item_id);
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
