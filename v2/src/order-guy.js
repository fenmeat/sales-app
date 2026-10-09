import {check,dateKey,addDays,today,cleanText} from './domain.js';
import {productionPlanningView,productionSummary,productionProfile} from './production.js';
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
  if(m.minimum_stock!==undefined)check(qty(m.minimum_stock),'Minimum stock must be a non-negative quantity.');
  if(m.pack_spec!==undefined){check(m.pack_spec&&typeof m.pack_spec==='object','Invalid purchase pack description.');for(const field of ['label','unit_label','note','source'])text(m.pack_spec[field],field==='unit_label'?60:1500);}
  const p=m.price;check(p&&optional(p.amount)&&['verified','reference','expired','unknown'].includes(p.status),'Invalid price.');text(p.source,1500);if(p.date!==null)dateKey(p.date);if(p.valid_until!==null)dateKey(p.valid_until);check(p.status!=='verified'||(p.amount!==null&&p.date&&p.source.trim()),'A verified price needs an amount, date and source.');
  const s=m.stock;check(s&&optional(s.qty)&&optional(s.reserve)&&Array.isArray(s.incoming)&&s.incoming.length<=100,'Invalid material stock.');if(s.date!==null)dateKey(s.date);check(s.qty===null||s.date,'Date the usable stock count.');text(s.source,1500);for(const x of s.incoming){check(qty(x.qty),'Invalid incoming quantity.');dateKey(x.date);text(x.reference,200);check(x.reference.trim().length>0,'Incoming stock needs a PO or delivery reference.');}unique(s.incoming,x=>x.reference);
  if(s.available_from!==undefined){dateKey(s.available_from);check(s.date&&s.available_from>=s.date&&s.available_from<=addDays(s.date,31),'Invalid stock availability date.');check(s.available_from===s.date||s.availability_confirmed===true,'Confirm availability when using an earlier count.');}
 }
 const materials=new Map(r.materials.map(m=>[m.id,m]));
 const line=l=>{check(materials.has(l.material),'Unknown material in recipe/packaging.');check(qty(l.qty)&&l.qty>0,'Ingredient quantities must be positive.');check(l.unit===materials.get(l.material).unit,'Material units differ. Resolve the conversion before importing.');check(['approved','estimate','review'].includes(l.status),'Invalid quantity status.');text(l.note);};
 for(const recipe of r.recipes){id(recipe.group);check(Number.isSafeInteger(recipe.version)&&recipe.version>0,'Recipe version must be a positive integer.');if(recipe.group==='R07')check([1,2].includes(recipe.plan_version??recipe.version),'Select the Babalas production batch basis, 1 or 2.');text(recipe.name,150);dateKey(recipe.effective_date);check(['approved','review','historical'].includes(recipe.status),'Invalid recipe status.');check(qty(recipe.batch_kg)&&recipe.batch_kg>0,'Recipe batch mass is required.');check(typeof recipe.complete==='boolean','Mark recipe and manufacturing consumable completeness.');text(recipe.source,1500);text(recipe.notes);check(recipe.source.trim(),'Recipe source is required.');for(const key of ['ingredients','consumables']){check(Array.isArray(recipe[key])&&recipe[key].length<=80,'Invalid recipe lines.');recipe[key].forEach(line);unique(recipe[key],l=>l.material);}check(recipe.ingredients.length>0,'Recipe needs ingredient quantities.');
  // Quantity unit gaps cannot be hidden inside the nominal batch mass.
  const kg=recipe.ingredients.filter(l=>l.unit==='kg').reduce((n,l)=>n+l.qty,0);check(Math.abs(kg-recipe.batch_kg)<.005,'Ingredient kg must match the declared recipe mass.');
  if(recipe.forecast_yields!==undefined){check(Array.isArray(recipe.forecast_yields)&&recipe.forecast_yields.length<=50,'Invalid forecast yields.');unique(recipe.forecast_yields,y=>y.product);for(const y of recipe.forecast_yields){id(y.product);check(productionProfile({code:y.product,name:y.product}).group===recipe.group,'Forecast yield product belongs to a different recipe group.');check(qty(y.qty)&&y.qty>0,'Saleable output per full batch must be positive.');check(['approved','estimate','review'].includes(y.status),'Invalid yield status.');text(y.source);check(y.source.trim(),'Each forecast yield needs its recipe-specific evidence source.');}}
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

export const EARLY_MONTH_BUFFER={rate:.15,first_day:1,last_day:14,basis:'production date',version:'2026-10-09',setting:'Initial operating setting; additional purchasing reserve, not extra production.'};
const whole=n=>Math.ceil(Math.max(0,n-1e-9));
const currentRecipe=(register,group,date,version=null)=>register.recipes.filter(x=>x.group===group&&x.effective_date<=date&&(version===null||(x.plan_version??x.version)===version)).sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||b.version-a.version)[0];

// Work from gross forecast demand. No future finished/cooked stock is set to zero,
// no plan decision is manufactured, and trolley allocations are never summed.
function forecastRequirements(plan,register){
 const items=plan.items.map(i=>({...i,packing:i.demand}));
 const groups=plan.groups.map(g=>{
  const rows=items.filter(i=>i.group===g.id),version=g.id==='R07'?rows[0].recipe_version??2:null;
  const recipe=currentRecipe(register,g.id,plan.date,version),issues=[],yields=[];
  let equivalent=0,known=true;
  for(const i of rows){
   if(i.demand===null){known=false;issues.push(i.code+': forecast is unknown.');continue;}
   for(const b of i.breakdown??[])if(b.warning)issues.push(i.code+' / '+b.route+': '+b.warning);
   if(i.demand===0||['buy','pack'].includes(g.mode))continue;
   const verified=recipe?.forecast_yields?.find(y=>y.product===i.code);
   let output=verified?.qty??i.yield_qty,status=verified?.status??'estimate',source=verified?.source??i.yield_note;
   if(!verified&&g.mode==='casings'){output=i.casing_yield_qty*4;status='approved';source=i.yield_note+' Four casings per complete batch.';}
   if(!verified&&g.mode==='rolls')output=g.rolls_per_batch>0?g.rolls_per_batch*g.disks_per_roll/20:null;
   if(!(output>0)){known=false;issues.push(i.code+': saleable output for the current recipe is missing.');}
   else{
    // Polony needs whole casings per size; other shared recipes combine before batch rounding.
    equivalent+=g.mode==='casings'&&!verified?whole(i.demand/i.casing_yield_qty)/4:g.mode==='rolls'&&!verified?whole(i.demand*20/g.disks_per_roll)/g.rolls_per_batch:i.demand/output;
    if(status!=='approved')issues.push(i.code+': verify saleable output against recipe v'+(recipe?.version??'?')+' before finalising purchase quantities.');
   }
   yields.push({product:i.code,sales_units:i.demand,units_per_batch:output,status,source});
  }
  return {...g,rows,recipe,planned:['buy','pack'].includes(g.mode)?0:known?whole(equivalent):null,yields,issues,conversion_ready:known&&yields.every(y=>y.status==='approved')};
 });
 return {items,groups};
}

export function orderGuyReport({register,registry_revision,plans,forecast_days=[],from,to,catalog,asOf=today()}){
 dateKey(from);dateKey(to);check(to>=from&&to<=addDays(from,30),'Choose at most 31 production days.');
 const materials=new Map(register.materials.map(m=>[m.id,m])),totals=new Map(),warnings=[],coverage=[],requirements=[];
 let unmapped=false;
 const warn=(date,scope,message)=>warnings.push({date,scope,message});
 function rowFor(l){const m=materials.get(l.material);let row=totals.get(m.id);if(!row){row={material:m.id,name:m.name,unit:m.unit,supplier:m.supplier,procure:m.procure,gross:0,provisional:0,contributions:[],unresolved:[]};totals.set(m.id,row);}return row;}
 function block(lines,date,scope,reason){for(const l of lines){const row=rowFor(l);if(!row.unresolved.some(x=>x.date===date&&x.scope===scope&&x.reason===reason))row.unresolved.push({date,scope,reason});}}
 function add(l,multiplier,evidence){if(multiplier===0)return;const row=rowFor(l),q=l.qty*multiplier;row.gross+=q;if(l.status!=='approved'||evidence.basis_type==='forecast')row.provisional+=q;row.contributions.push({...evidence,qty:round(q),quantity_status:l.status,note:l.note});if(l.status!=='approved')block([l],evidence.date,evidence.group??evidence.product,'Material quantity needs verification.');}
 for(let date=from;date<=to;date=addDays(date,1)){
  const r=plans.find(p=>p.plan.date===date),confirmed=r?.revision>0&&r.plan.phase==='confirmed',f=forecast_days.find(f=>f.date===date);
  if(!confirmed&&f?.status==='covered_by_other_day'){coverage.push({...f});continue;}
  if(!confirmed&&(!f?.plan||f.status!=='forecast')){coverage.push({date,status:'forecast_unavailable',source_warning:f?.source_warning??'Current app forecast not supplied.'});warn(date,'coverage',f?.source_warning??'No confirmed plan or usable current app forecast. This date has not been treated as zero.');unmapped=true;continue;}
  const plan=confirmed?productionPlanningView(r.plan,catalog,asOf):f.plan;
  const summary=confirmed?productionSummary(plan):forecastRequirements(plan,register);
  const evidence={date,target_date:plan.target_date,routes:plan.routes,basis_type:confirmed?'confirmed_plan':'forecast',phase:confirmed?'confirmed':'forecast',revision:confirmed?r.revision:0,saved_at:confirmed?r.saved_at:null,demand_snapshot:plan.demand_snapshot};
  coverage.push({...evidence,status:confirmed?'confirmed_plan':'forecast',...(confirmed?{stale:r.stale??null,source_warning:r.source_warning??null}:{replaced_draft_revision:f.replaced_draft_revision??null,overlaps:f.overlaps??[],sources:f.sources??[],settings_date:f.settings_date??null})});
  if(confirmed){if(r.stale!==false)warn(date,'plan',r.source_warning??'Route needs have changed or could not be verified.');for(const w of summary.warnings)warn(date,w.group,w.message);}
  for(const g of summary.groups){
   if(!confirmed)for(const message of g.issues)warn(date,g.id,message);
   if(['buy','pack'].includes(g.mode))continue;
   const version=g.id==='R07'?(g.rows[0].recipe_version??1):null;
   const recipe=confirmed?currentRecipe(register,g.id,date,version):g.recipe;
   requirements.push({...evidence,group:g.id,batches:g.planned,recipe_version:recipe?.version??null,...(!confirmed?{yields:g.yields,conversion_ready:g.conversion_ready}:{} )});
   if(g.planned===0)continue;
   if(!recipe||recipe.status!=='approved'){warn(date,g.id,'No approved recipe for this date and batch version. Ingredients remain unresolved.');unmapped=true;continue;}
   const lines=[...recipe.ingredients,...recipe.consumables];
   if(g.planned===null){const reason=confirmed?'New production decision is unknown.':'Forecast or current recipe output is unknown.';warn(date,g.id,reason);block(lines,date,g.id,reason);continue;}
   if(!recipe.complete){warn(date,g.id,'Recipe / manufacturing consumables are incomplete. Known ingredients are listed separately.');block(lines,date,g.id,'Incomplete manufacturing specification.');unmapped=true;}
   if(!confirmed&&!g.conversion_ready)block(lines,date,g.id,'Forecast yield needs verification for this recipe version.');
   for(const l of lines)add(l,g.planned,{...evidence,group:g.id,recipe_version:recipe.version,recipe_source:recipe.source,basis:confirmed?'confirmed new batches':'gross forecast batches',batches:g.planned,...(!confirmed?{yields:g.yields}:{} )});
  }
  for(const i of summary.items){
   const g=summary.groups.find(g=>g.id===i.group),packing=confirmed?(['shared','cooked','casings'].includes(g.mode)?i.pack_plan:g.output):i.packing;
   if(packing===0)continue;
   const p=register.packaging.find(p=>p.product===i.code);
   if(!p||!p.complete){warn(date,i.code,'Packaging specification is incomplete. Known lines are listed separately.');unmapped=true;}
   if(packing===null){warn(date,i.code,'Packing quantity is unknown.');block(p?.lines??[],date,i.code,'Packing quantity is unknown.');continue;}
   for(const l of p?.lines??[])add(l,packing,{...evidence,product:i.code,basis:confirmed?'packed sales units':'forecast sales units',sales_units:packing,source:p.source});
   if(g.mode==='buy')warn(date,i.code,'Bought-in product: '+packing+' sales units required. Confirm supplier SKU and purchase pack separately.');
  }
 }
 // Minimum stock also creates a purchasing row for maintenance items without recipe demand.
 for(const m of register.materials)if(m.procure&&m.minimum_stock>0)rowFor({material:m.id});
 const referenced=new Set([...register.recipes.flatMap(r=>[...r.ingredients,...r.consumables]),...register.packaging.flatMap(p=>p.lines)].map(l=>l.material));
 const rows=[...totals.values()].map(row=>{
  const m=materials.get(row.material),p=priceFor(m,asOf),s=m.stock;
  const inventory_ready=s.qty!==null&&(s.available_from??s.date)===from&&(s.date===from||s.availability_confirmed===true)&&s.reserve!==null&&s.source.trim().length>0;
  const inventory_reason=inventory_ready?null:s.qty===null?'Hierdie produk het nog geen gestoorde voorraadtelling nie':(s.available_from??s.date)!==from?'Die telling is gestoor en beskikbaar vanaf '+(s.available_from??s.date)+', maar hierdie bestelling begin '+from+'. Pas die begindatum aan of bevestig die voorraad vir daardie datum in Voorraadtelling':s.date!==from&&s.availability_confirmed!==true?'Die telling is gestoor; bevestig dat die voorraad nog op die produksiedatum beskikbaar is':'Die telling is gestoor; voltooi die datum, voorraad wat uitgesit is en die telbron';
  const minimum=m.minimum_stock??0,retained=Math.max(s.reserve??0,minimum),minimumOnly=minimum>0&&!referenced.has(m.id);
  let stock=inventory_ready?s.qty-retained:null,shortage=0,high=0,extra=0;
  const daily=[];for(let date=from;date<=to;date=addDays(date,1)){
   const use=row.contributions.filter(c=>c.date===date).reduce((n,c)=>n+c.qty,0),eligible=m.procure&&Number(date.slice(8))<=EARLY_MONTH_BUFFER.last_day;
   const buffer=eligible?use*EARLY_MONTH_BUFFER.rate:0,incoming=s.incoming.filter(x=>x.date===date).reduce((n,x)=>n+x.qty,0);
   if(eligible)high+=use;extra+=buffer;
   let short=null;if(stock!==null){stock+=incoming-use-buffer;short=Math.max(0,-stock);shortage+=short;stock=Math.max(0,stock);}
   daily.push({date,gross:round(use),early_month_reserve:round(buffer),incoming:round(incoming),shortage:short===null?null:round(short)});
  }
  const quantity_ready=(!unmapped||minimumOnly)&&!row.unresolved.length,net=inventory_ready&&quantity_ready?round(shortage):null,pack=m.pack_qty;
  return {...row,gross:round(row.gross),provisional:round(row.provisional),early_month_gross:round(high),early_month_reserve:round(extra),required_with_reserve:round(row.gross+extra),daily,price:p,known_cost:p===null?null:round(row.gross*p),required_cost:p===null?null:round((row.gross+extra)*p),price_status:m.price.status,price_source:m.price.source,price_date:m.price.date,stock:s,minimum_stock:minimum,retained_stock:retained,minimum_only:minimumOnly,inventory_ready,inventory_reason,quantity_ready,net,pack_qty:pack,pack_spec:m.pack_spec??null,order_packs:net===null||pack===null?null:Math.ceil(Math.max(0,net/pack-1e-10)),quantity_review:row.provisional>0||!inventory_ready||!quantity_ready};
 }).sort((a,b)=>a.supplier.localeCompare(b.supplier)||a.material.localeCompare(b.material));
 return {source:'FenMeat Sales V2',calculation_version:'2.0',generated_at:new Date().toISOString(),from,to,registry_revision,buffer_policy:EARLY_MONTH_BUFFER,coverage,requirements,warnings,unmapped_requirements:unmapped,rows,complete:warnings.length===0&&rows.every(r=>!r.quantity_review&&(!r.procure||r.order_packs!==null)),cost_basis:'ZAR including VAT. Missing/expired prices are blank, never zero.',note:'Confirmed production decisions take precedence. Other days use the current app forecast once per route/date, without future finished-stock counts. Gross forecast quantities are purchasing estimates, not saved production plans. Extra 15% reserve applies only to purchased materials needed on production dates 1–14, before stock netting and pack rounding. Ordinary material reserve is separate and must exclude this extra reserve. This is not a purchase order.'};
}
