import {check,dateKey,addDays,today,cleanText} from './domain.js';
import {productionPlanningView,productionSummary} from './production.js';
const qty=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e8;
const optional=n=>n===null||qty(n);
const text=(s,n=1500)=>cleanText(s,n);
const id=s=>{check(typeof s==='string'&&/^[A-Z0-9_-]{1,40}$/.test(s),'Invalid material or recipe code.');return s;};
const unique=(rows,key)=>{const keys=rows.map(key);check(new Set(keys).size===keys.length,'Duplicate register entry.');};
const round=n=>Math.round(n*1e6)/1e6;
export const emptyRegister=()=>({schema_version:1,materials:[],recipes:[],packaging:[],notes:''});
// All operating data is private D1 content, never a bundled browser asset.
export function validateRegister(input){
 check(input&&input.schema_version===1,'Use register format 1.');
 for(const [key,max] of [['materials',500],['recipes',250],['packaging',250]])check(Array.isArray(input[key])&&input[key].length<=max,'Invalid '+key+' register.');
 const r=structuredClone(input);text(r.notes);unique(r.materials,m=>m.id);unique(r.recipes,x=>x.group+'@'+x.version);unique(r.packaging,p=>p.product);
 for(const m of r.materials){id(m.id);text(m.name,150);check(m.name.length>0,'Material name is required.');text(m.unit,30);check(m.unit.length>0,'Material unit is required.');text(m.supplier,150);text(m.notes);text(m.source,1500);check(optional(m.pack_qty)&&m.pack_qty!==0,'Pack size must be positive or unknown.');check(typeof m.procure==='boolean','Mark whether the material is purchased.');
  const p=m.price;check(p&&optional(p.amount)&&['verified','reference','expired','unknown'].includes(p.status),'Invalid price.');text(p.source,1500);if(p.date!==null)dateKey(p.date);if(p.valid_until!==null)dateKey(p.valid_until);check(p.status!=='verified'||(p.amount!==null&&p.date&&p.source.trim()),'A verified price needs an amount, date and source.');
  const s=m.stock;check(s&&optional(s.qty)&&optional(s.reserve)&&Array.isArray(s.incoming)&&s.incoming.length<=100,'Invalid material stock.');if(s.date!==null)dateKey(s.date);check(s.qty===null||s.date,'Date the usable stock count.');text(s.source,1500);for(const x of s.incoming){check(qty(x.qty),'Invalid incoming quantity.');dateKey(x.date);text(x.reference,200);check(x.reference.trim().length>0,'Incoming stock needs a PO or delivery reference.');}unique(s.incoming,x=>x.reference);
 }
 const materials=new Map(r.materials.map(m=>[m.id,m]));
 const line=l=>{check(materials.has(l.material),'Unknown material in recipe/packaging.');check(qty(l.qty)&&l.qty>0,'Ingredient quantities must be positive.');check(l.unit===materials.get(l.material).unit,'Material units differ. Resolve the conversion before importing.');check(['approved','estimate','review'].includes(l.status),'Invalid quantity status.');text(l.note);};
 for(const recipe of r.recipes){id(recipe.group);check(Number.isSafeInteger(recipe.version)&&recipe.version>0,'Recipe version must be a positive integer.');if(recipe.group==='R07')check([1,2].includes(recipe.plan_version??recipe.version),'Select the Babalas production batch basis, 1 or 2.');text(recipe.name,150);dateKey(recipe.effective_date);check(['approved','review','historical'].includes(recipe.status),'Invalid recipe status.');check(qty(recipe.batch_kg)&&recipe.batch_kg>0,'Recipe batch mass is required.');check(typeof recipe.complete==='boolean','Mark recipe and manufacturing consumable completeness.');text(recipe.source,1500);text(recipe.notes);check(recipe.source.trim(),'Recipe source is required.');for(const key of ['ingredients','consumables']){check(Array.isArray(recipe[key])&&recipe[key].length<=80,'Invalid recipe lines.');recipe[key].forEach(line);unique(recipe[key],l=>l.material);}check(recipe.ingredients.length>0,'Recipe needs ingredient quantities.');
  // Quantity unit gaps cannot be hidden inside the nominal batch mass.
  const kg=recipe.ingredients.filter(l=>l.unit==='kg').reduce((n,l)=>n+l.qty,0);check(Math.abs(kg-recipe.batch_kg)<.005,'Ingredient kg must match the declared recipe mass.');
 }
 for(const p of r.packaging){id(p.product);check(typeof p.complete==='boolean','Mark packaging completeness.');text(p.source,1500);text(p.notes);check(Array.isArray(p.lines)&&p.lines.length<=30,'Invalid packaging lines.');p.lines.forEach(line);unique(p.lines,l=>l.material);}
 return r;
}
export function priceFor(m,asOf=today()){
 const p=m.price;return p.status==='verified'&&p.amount!==null&&p.date<=asOf&&(!p.valid_until||p.valid_until>=asOf)?p.amount:null;
}
export function recipeCost(recipe,register,asOf=today()){
 const materials=new Map(register.materials.map(m=>[m.id,m]));const lines=[...recipe.ingredients,...recipe.consumables].map(l=>{const price=priceFor(materials.get(l.material),asOf);return {...l,name:materials.get(l.material).name,price,cost:price===null?null:round(price*l.qty)};});
 const complete=recipe.complete&&recipe.status==='approved'&&lines.every(l=>l.cost!==null&&l.status==='approved');
 const known_subtotal=round(lines.reduce((s,l)=>s+(l.cost??0),0));return {group:recipe.group,version:recipe.version,lines,complete,known_subtotal,total:complete?known_subtotal:null,cost_per_raw_kg:complete?round(known_subtotal/recipe.batch_kg):null,basis:'ZAR including VAT; ingredients and manufacturing consumables only. Finished packing, labour and overhead excluded.'};
}
export function orderGuyReport({register,registry_revision,plans,from,to,catalog,asOf=today()}){
 dateKey(from);dateKey(to);check(to>=from&&to<=addDays(from,30),'Choose at most 31 production days.');
 const materials=new Map(register.materials.map(m=>[m.id,m])), totals=new Map(),warnings=[],coverage=[];
 const warn=(date,scope,message)=>warnings.push({date,scope,message});
 function add(l,multiplier,evidence){if(multiplier===0)return;const m=materials.get(l.material);let row=totals.get(m.id);if(!row){row={material:m.id,name:m.name,unit:m.unit,supplier:m.supplier,procure:m.procure,gross:0,provisional:0,contributions:[]};totals.set(m.id,row);}const q=l.qty*multiplier;row.gross+=q;if(l.status!=='approved'||evidence.phase!=='confirmed')row.provisional+=q;row.contributions.push({...evidence,qty:round(q),quantity_status:l.status,note:l.note});}
 for(let date=from;date<=to;date=addDays(date,1)){
  const r=plans.find(p=>p.plan.date===date);
  if(!r||!(r.revision>0)){coverage.push({date,status:'no_saved_plan'});warn(date,'coverage','No saved production plan. This date has not been treated as zero.');continue;}
  const plan=productionPlanningView(r.plan,catalog,asOf),summary=productionSummary(plan),evidence={date,target_date:plan.target_date,routes:plan.routes,phase:plan.phase,revision:r.revision,saved_at:r.saved_at};
  coverage.push({...evidence,status:'saved',stale:r.stale??null,source_warning:r.source_warning??null,demand_snapshot:plan.demand_snapshot});
  if(plan.phase!=='confirmed')warn(date,'plan','Saved draft: review and approve the quantities before ordering.');
  if(r.stale!==false)warn(date,'plan',r.source_warning??'Route needs have changed or could not be verified.');
  for(const w of summary.warnings)warn(date,w.group,w.message);
  for(const g of summary.groups){
   if(g.planned===null){warn(date,g.id,'New production / purchase decision is unknown.');continue;}
   if(g.planned===0||['buy','pack'].includes(g.mode))continue;
   const version=g.id==='R07'?(g.rows[0].recipe_version??1):null;
   const recipe=register.recipes.filter(x=>x.group===g.id&&x.effective_date<=date&&(version===null||(x.plan_version??x.version)===version)).sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||b.version-a.version)[0];
   if(!recipe||recipe.status!=='approved'){warn(date,g.id,'No approved recipe for this plan and batch version. Ingredients omitted, never assumed zero.');continue;}
   if(!recipe.complete)warn(date,g.id,'Recipe / manufacturing consumables are incomplete. Known ingredients are listed separately.');
   for(const l of [...recipe.ingredients,...recipe.consumables])add(l,g.planned,{...evidence,group:g.id,recipe_version:recipe.version,recipe_source:recipe.source,basis:'new batches',batches:g.planned});
  }
  for(const i of summary.items){
   const g=summary.groups.find(g=>g.id===i.group),packing=['shared','cooked','casings'].includes(g.mode)?i.pack_plan:g.output;
   if(packing===0)continue;
   if(packing===null){warn(date,i.code,'Packing quantity is unknown.');continue;}
   const p=register.packaging.find(p=>p.product===i.code);
   if(!p||!p.complete)warn(date,i.code,'Packaging specification is incomplete. Known lines are listed separately.');
   for(const l of p?.lines??[])add(l,packing,{...evidence,product:i.code,basis:'packed sales units',sales_units:packing,source:p.source});
   if(g.mode==='buy')warn(date,i.code,'Bought-in product: '+packing+' sales units required. Confirm supplier SKU and purchase pack separately.');
  }
 }
 const rows=[...totals.values()].map(row=>{
  const m=materials.get(row.material),p=priceFor(m,asOf),s=m.stock;
  const inventory_ready=s.qty!==null&&s.date===from&&s.reserve!==null&&s.source.trim().length>0;
  // Incoming must arrive by the first day it is needed, not just the end of the window.
  let stock=inventory_ready?s.qty-s.reserve:null,shortage=0;
  const daily=[];for(let date=from;date<=to;date=addDays(date,1)){
   const use=row.contributions.filter(c=>c.date===date).reduce((n,c)=>n+c.qty,0),incoming=s.incoming.filter(x=>x.date===date).reduce((n,x)=>n+x.qty,0);
   if(stock!==null){stock+=incoming-use;if(stock<0){shortage+=-stock;stock=0;}}daily.push({date,gross:round(use),incoming:round(incoming)});
  }
  const net=inventory_ready?round(shortage):null,pack=m.pack_qty;
  return {...row,gross:round(row.gross),provisional:round(row.provisional),daily,price:p,known_cost:p===null?null:round(row.gross*p),price_status:m.price.status,price_source:m.price.source,price_date:m.price.date,stock:s,inventory_ready,net,pack_qty:pack,order_packs:net===null||pack===null?null:Math.ceil(Math.max(0,net/pack-1e-10)),quantity_review:row.provisional>0||!inventory_ready};
 }).sort((a,b)=>a.supplier.localeCompare(b.supplier)||a.material.localeCompare(b.material));
 return {source:'FenMeat Sales V2',generated_at:new Date().toISOString(),from,to,registry_revision,coverage,warnings,rows,complete:warnings.length===0&&rows.every(r=>!r.quantity_review&&(!r.procure||r.order_packs!==null)),cost_basis:'ZAR including VAT. Missing/expired prices are blank, never zero.',note:'Gross requirements use saved My plan once. Trolleys are a reconciliation check. Drafts, estimates, coverage gaps and stock gaps require review; this is not a purchase order.'};
}
