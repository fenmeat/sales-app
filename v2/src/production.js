import {check,dateKey,addDays,weekday,isQty,roundQty,cleanText} from './domain.js';
// Planning references only. Original production app and Master remain read-only.
const yields={W01:13,W02:26,W03:24,W04:55,W05:50,W06:16,W07:29,W08:31,R05:22,R06:24,R07:23,V01:32,V02:36};
const russianPieces={R01:60,R02:50,R03:40,R04:30};
export const POLONY_CASING_YIELDS={P02:20,P03:14,P04:8};
export const POLONY_CASINGS_PER_TROLLEY=8;
export const POLONY_CASINGS_PER_BATCH=4; // Owner: 2 recipes per 8-casing trolley.
const cookedCodes=['R05','R06','R07','V01','V02'];
const whole=n=>Math.ceil(Math.max(0,n-1e-9));
const sumKnown=values=>values.some(v=>v==null)?null:values.reduce((a,v)=>a+v,0);
const equivalent=(qty,yieldQty)=>qty==null?null:qty===0?0:yieldQty>0?qty/yieldQty:null;
const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
export function productionProfile(p){
 if(russianPieces[p.code])return {group:'RUSSIAN',group_name:'Russian · shared recipe',mode:'shared',yield_qty:1310/russianPieces[p.code],yield_note:'Existing planner: 1,310 loose Russians per batch; '+russianPieces[p.code]+' per sales bag. Review after recipe changes.'};
 if(POLONY_CASING_YIELDS[p.code])return {group:'POLONY',group_name:'Polony · casing plan',mode:'casings',yield_qty:null,casing_yield_qty:POLONY_CASING_YIELDS[p.code],yield_note:'Owner-confirmed sales units per casing. Sizes remain separate, including cooked stock.'};
 if(p.code==='W07')return {group:p.code,group_name:p.name,mode:'rolls',yield_qty:yields.W07,yield_note:'Frozen rolls are cut into disks: 4 disks per tray, 5 trays per bag. New rolls must be frozen before cutting.'};
 if(yields[p.code])return {group:p.code,group_name:p.name,mode:cookedCodes.includes(p.code)?'cooked':'batch',yield_qty:yields[p.code],yield_note:'Sales bags per complete recipe, from the existing production planner. Check when the recipe or pack size changes.'};
 if(['P01','R08'].includes(p.code))return {group:p.code,group_name:p.name,mode:'pack',yield_qty:null,yield_note:'Pack from available offcuts / surplus. No separate recipe is assumed.'};
 if(/^(B|C|D|S|O)\d+$/.test(p.code))return {group:p.code,group_name:p.name,mode:'buy',yield_qty:null,yield_note:'Bought-in / repacked product. The plan does not place an order.'};
 return {group:p.code,group_name:p.name,mode:'batch',yield_qty:null,yield_note:'Enter the saleable output per complete recipe before using a suggestion.'};
}
// Add fields in a copy. Never rewrite historical payloads or reinterpret saved
// batch counts as rolls/casings. Existing group.planned ALWAYS remains batches.
export function normaliseProductionPlan(input){
 const plan=structuredClone(input);plan.planning_version=3;plan.trolleys=plan.trolleys??[];
 plan.items=plan.items.map(i=>({...i,...productionProfile(i),yield_qty:has(i,'yield_qty')?i.yield_qty:productionProfile(i).yield_qty,stock:i.stock??null,pack_plan:i.pack_plan??null,actual:i.actual??null,coldroom_casings:i.coldroom_casings??null,casing_plan:i.casing_plan??null}));
 plan.groups=plan.groups.map(g=>{const item=plan.items.find(i=>i.group===g.id);return {...g,name:item?.group_name??g.name,mode:item?.mode??g.mode,planned:g.planned??null,coldroom_batches:g.coldroom_batches??null,roll_stock:g.roll_stock??null,cut_planned:g.cut_planned??null,rolls_per_batch:g.rolls_per_batch??null,min_roll_stock:g.min_roll_stock??null,disks_per_roll:g.disks_per_roll??30};});
 return plan;
}
export function nextProductionTarget(date,routes){for(let n=1;n<=7;n++){const d=addDays(date,n);if(routes.some(r=>r.weekday===weekday(d)))return d;}return addDays(date,1);}
export function productionContext(plan,catalog){
 dateKey(plan.date);dateKey(plan.target_date);check(plan.target_date>plan.date&&plan.target_date<=addDays(plan.date,14),'Choose a route date after production, within 14 days.');
 check(Array.isArray(plan.routes)&&plan.routes.length>0&&plan.routes.length<=50,'Choose at least one route.');
 check(new Set(plan.routes).size===plan.routes.length&&plan.routes.every(code=>catalog.routes.some(r=>r.code===code)),'Unknown or repeated route.');
}
export function aggregateProductionDemand(products,sources){return products.map(p=>{
 const breakdown=sources.map(s=>{const i=s.run?.items.find(x=>x.code===p.code);const manual=i?.planned;
 // An explicit zero is a decision. Unknown forecasts are never treated as zero.
 const qty=manual!=null?manual:!p.available?0:s.forecasts[p.code]?.qty??null;
 return {route:s.route,name:s.name,qty,source:manual!=null?'Your route plan':!p.available?'Not available for loading':'Forecast',revision:s.revision,warning:manual==null&&p.available?s.forecasts[p.code]?.warning??null:null};});
 return {code:p.code,name:p.name,unit:p.unit,demand:breakdown.some(x=>x.qty===null)?null:roundQty(breakdown.reduce((a,x)=>a+x.qty,0)),breakdown,...productionProfile(p)};
});}
export function buildProductionPlan({date,target_date,routes,items,snapshot,previous=null,yieldSettings=null,settingsPlan=null}){
 const prev=previous?normaliseProductionPlan(previous):null,old=new Map((prev?.items??[]).map(i=>[i.code,i]));
 const plan={planning_version:3,trolleys:structuredClone(prev?.trolleys??[]),date,target_date,routes,phase:'draft',demand_snapshot:snapshot,notes:prev?.notes??'',items:items.map(i=>{
  const prior=old.get(i.code),setting=yieldSettings?.find(x=>x.code===i.code);
  return {...i,stock:prior?.stock??null,yield_qty:prior?prior.yield_qty:setting?setting.yield_qty:i.yield_qty,pack_plan:prior?.pack_plan??null,actual:prior?.actual??null,coldroom_casings:prior?.coldroom_casings??null,casing_plan:prior?.casing_plan??null};
 }),groups:[]};
 for(const i of prev?.items??[])if(!plan.items.some(x=>x.code===i.code))plan.items.push({...i,demand:0,breakdown:[],retained:true});
 for(const i of plan.items)if(!plan.groups.some(g=>g.id===i.group)){
  const prior=prev?.groups.find(g=>g.id===i.group),setting=settingsPlan?.groups.find(g=>g.id===i.group);
  plan.groups.push(prior?{...prior}:{id:i.group,name:i.group_name,mode:i.mode,planned:null,rolls_per_batch:setting?.rolls_per_batch??null,min_roll_stock:setting?.min_roll_stock??null,disks_per_roll:setting?.disks_per_roll??30});
 }
 return normaliseProductionPlan(plan);
}
export function productionSummary(input){
 const plan=normaliseProductionPlan(input);
 const items=plan.items.map(i=>{const shortage=i.demand==null||i.stock==null?null:roundQty(Math.max(0,i.demand-i.stock));return {...i,shortage,packing_qty:i.pack_plan??shortage};});
 const groups=plan.groups.map(g=>{
  const rows=items.filter(i=>i.group===g.id),cooked=['shared','cooked'].includes(g.mode),packing=cooked||g.mode==='casings';
  const warnings=[];
  if(rows.some(i=>i.stock===null))warnings.push('Packed stock not counted');
  if(rows.some(i=>i.demand===null))warnings.push('Route need is incomplete');
  if(['batch','shared','cooked'].includes(g.mode)&&rows.some(i=>!(i.yield_qty>0)))warnings.push('Recipe yield needs setting');
  let suggested=null,output=null,used=null,required_batches=null,available_batches=null,unpacked_left=null;
  let suggested_batches=null,rolls_to_make=null,rolls_after_cut=null,loose_disks=null,new_casings=null,trolleys=null,casing_capacity=null;
  if(g.mode==='batch'){
   const required=sumKnown(rows.map(i=>equivalent(i.shortage,i.yield_qty)));suggested=required===null?null:whole(required);
   output=g.planned===0?0:g.planned!==null&&rows[0].yield_qty>0?roundQty(g.planned*rows[0].yield_qty):null;
  }else if(g.mode==='buy'||g.mode==='pack'){
   suggested=sumKnown(rows.map(i=>i.shortage));output=g.planned;
  }else if(cooked){
   required_batches=sumKnown(rows.map(i=>equivalent(i.packing_qty,i.yield_qty)));
   suggested=required_batches===0?0:required_batches===null||g.coldroom_batches===null?null:whole(required_batches-g.coldroom_batches);
   used=sumKnown(rows.map(i=>equivalent(i.pack_plan,i.yield_qty)));
   available_batches=g.planned===null||g.coldroom_batches===null?null:g.planned+g.coldroom_batches;
   unpacked_left=available_batches===null||used===null?null:roundQty(available_batches-used);
   if(g.coldroom_batches===null)warnings.push('Cooked, unpacked batches not counted');
   if(required_batches!==null&&available_batches!==null&&required_batches>available_batches+1e-9)warnings.push('Packing plan exceeds cooked stock plus new batches');
  }else if(g.mode==='casings'){
   for(const i of rows){
    i.casing_suggested=i.packing_qty===0?0:i.packing_qty===null||i.coldroom_casings===null?null:whole((i.packing_qty-i.coldroom_casings*i.casing_yield_qty)/i.casing_yield_qty);
    i.effective_casings=i.casing_plan??i.casing_suggested;
    i.unpacked_left=i.coldroom_casings===null||i.casing_plan===null||i.pack_plan===null?null:roundQty((i.coldroom_casings+i.casing_plan)*i.casing_yield_qty-i.pack_plan);
    if(i.coldroom_casings===null)warnings.push(i.name+': cooked casings not counted');
    if(i.casing_plan===null)warnings.push(i.name+': casing plan not chosen');
    if(i.unpacked_left!==null&&i.unpacked_left<0)warnings.push(i.name+': packing exceeds cooked stock plus new casings');
   }
   new_casings=sumKnown(rows.map(i=>i.effective_casings));
   suggested=new_casings===null?null:whole(new_casings/POLONY_CASINGS_PER_BATCH);
   trolleys=new_casings===null?null:whole(new_casings/POLONY_CASINGS_PER_TROLLEY);
   casing_capacity=g.planned===null?null:g.planned*POLONY_CASINGS_PER_BATCH;
   const chosen=sumKnown(rows.map(i=>i.casing_plan));
   if(chosen!==null&&casing_capacity!==null){
    if(chosen>casing_capacity)warnings.push('Casing plan exceeds My plan batch capacity');
    if(chosen<casing_capacity)warnings.push((casing_capacity-chosen)+' casing slots still need a size allocation');
   }
  }else if(g.mode==='rolls'){
   const need=rows[0].shortage;
   suggested=need===null?null:whole(whole(need)*20/g.disks_per_roll);
   output=g.cut_planned===null?null:Math.floor((g.cut_planned*g.disks_per_roll+1e-9)/20);
   loose_disks=g.cut_planned===null?null:g.cut_planned*g.disks_per_roll-output*20;
   const cut=g.cut_planned??suggested;
   rolls_after_cut=cut===null||g.roll_stock===null?null:g.roll_stock-cut;
   rolls_to_make=rolls_after_cut===null?null:Math.max(0,(g.min_roll_stock??0)-rolls_after_cut);
   suggested_batches=rolls_to_make===0?0:rolls_to_make===null||!(g.rolls_per_batch>0)?null:whole(rolls_to_make/g.rolls_per_batch);
   if(g.roll_stock===null)warnings.push('Frozen rolls not counted');
   if(g.cut_planned===null)warnings.push('Roll cutting plan not chosen');
   if(rolls_after_cut!==null&&rolls_after_cut<0)warnings.push('Not enough frozen rolls to cut; new rolls must be frozen first');
   if((rolls_to_make>0||g.planned>0)&&!(g.rolls_per_batch>0))warnings.push('Set rolls per batch for replenishment');
   if(rolls_to_make!==null&&g.planned!==null&&g.rolls_per_batch>0&&g.planned*g.rolls_per_batch<rolls_to_make)warnings.push('New roll batches do not cover the replenishment need');
  }
  if(g.planned===null)warnings.push(g.mode==='rolls'?'New-roll batch plan not chosen':'My plan not chosen');
  if(packing&&rows.some(i=>i.pack_plan===null))warnings.push('Packing plan incomplete');
  const balances=rows.map(i=>{const made=packing?i.pack_plan:output;return {code:i.code,output:made,balance:i.stock===null||i.demand===null||made===null?null:roundQty(i.stock+made-i.demand)};});
  if(balances.some(b=>b.balance<0))warnings.push('My plan leaves a shortage');
  const has_decision=g.planned!==null&&(g.mode!=='rolls'||g.cut_planned!==null)&&(g.mode!=='casings'||rows.every(i=>i.casing_plan!==null));
  return {...g,rows,suggested,packing_based:packing&&rows.some(i=>i.pack_plan!==null),output,used,balances,warnings,required_batches,available_batches,unpacked_left,suggested_batches,rolls_to_make,rolls_after_cut,loose_disks,new_casings,trolleys,casing_capacity,has_decision};
 });
 const trolley=trolleySummary(plan,groups);
 return {items,groups,trolley,warnings:[...groups.flatMap(g=>g.warnings.map(message=>({group:g.id,name:g.name,message}))),...trolley.warnings.map(message=>({group:'TROLLEYS',name:'Trolley plan',message}))]};
}
export function applyProductionSuggestion(plan,id,{blankOnly=false}={}){
 const s=productionSummary(plan).groups.find(g=>g.id===id),g=plan.groups.find(g=>g.id===id);if(!s||s.suggested===null)return false;
 if(s.mode==='rolls'){
  if(blankOnly&&g.cut_planned!=null)return false;
  g.cut_planned=s.suggested;
  const next=productionSummary(plan).groups.find(x=>x.id===id);
  if(g.planned==null&&next.suggested_batches!==null)g.planned=next.suggested_batches;
 }else{
  if(blankOnly&&g.planned!=null)return false;
  g.planned=s.suggested;
  if(['shared','cooked','casings'].includes(s.mode))for(const row of s.rows){
   const i=plan.items.find(x=>x.code===row.code);
   if(i.pack_plan==null)i.pack_plan=row.packing_qty;
   if(s.mode==='casings'&&i.casing_plan==null)i.casing_plan=row.casing_suggested;
  }
 }
 plan.phase='draft';return true;
}
export function validateProductionEdits(input,base){
 check(input&&Array.isArray(input.items)&&Array.isArray(input.groups),'Invalid production plan.');
 check(input.items.length===base.items.length&&new Set(input.items.map(i=>i.code)).size===base.items.length&&base.items.every(i=>input.items.some(x=>x.code===i.code)),'Production products changed. Refresh the plan.');
 check(input.groups.length===base.groups.length&&new Set(input.groups.map(g=>g.id)).size===base.groups.length&&base.groups.every(g=>input.groups.some(x=>x.id===g.id)),'Production groups changed. Refresh the plan.');
 const plan=normaliseProductionPlan(base);plan.notes=cleanText(input.notes,1500);plan.phase='draft';
 const qty=(value,label,wholeOnly=false,positive=false)=>check(value===null||(isQty(value)&&(!wholeOnly||Number.isSafeInteger(value))&&(!positive||value>0)),label);
 for(const i of plan.items){
  const submitted=input.items.find(x=>x.code===i.code);
  for(const key of ['stock','pack_plan','actual','coldroom_casings','casing_plan'])if(has(submitted,key)){qty(submitted[key],'Enter non-negative quantities, or leave uncounted values blank.',key==='casing_plan');i[key]=submitted[key];}
  check(submitted.yield_qty===null||(typeof submitted.yield_qty==='number'&&Number.isFinite(submitted.yield_qty)&&submitted.yield_qty>0&&submitted.yield_qty<=100000),'Recipe yield must be greater than zero.');i.yield_qty=submitted.yield_qty;
 }
 for(const g of plan.groups){
  const submitted=input.groups.find(x=>x.id===g.id),value=submitted.planned;
  check(value===null||(['batch','shared','cooked','casings','rolls'].includes(g.mode)?typeof value==='number'&&Number.isSafeInteger(value*(['V01','V02'].includes(g.id)?2:1))&&value>=0&&value<=10000:isQty(value)),'Use non-negative whole batches; Vienna may use half batches. Bought-in / packing items use sales units.');g.planned=value;
  for(const key of ['coldroom_batches','roll_stock','cut_planned','rolls_per_batch','min_roll_stock','disks_per_roll'])if(has(submitted,key)){
   qty(submitted[key],'Use non-negative counts and whole rolls; recipe yields must be positive.',key!=='coldroom_batches',['rolls_per_batch','disks_per_roll'].includes(key));
   check(key!=='disks_per_roll'||submitted[key]!==null,'Enter disks per roll.');g[key]=submitted[key];
  }
 }
 if(has(input,'trolleys'))plan.trolleys=validateTrolleys(input.trolleys,plan.groups);
 return plan;
}


export const MAX_PRODUCTION_TROLLEYS=8;
const trolleyDefinitions=[
 {id:'RUSSIAN',group:'RUSSIAN',label:'RUSSIAN',fraction:1},
 {id:'R05',group:'R05',label:'ECONO RUSSIAN',fraction:1},
 {id:'R06',group:'R06',label:'CHEESE RUSSIAN',fraction:1},
 {id:'R07',group:'R07',label:'BABALAS RUSSIAN',fraction:1},
 {id:'V01',group:'V01',label:'VIENNA Full',fraction:1},
 {id:'V01_HALF',group:'V01',label:'VIENNA Half',fraction:.5},
 {id:'V02',group:'V02',label:'CHEESE VIENNA Full',fraction:1},
 {id:'V02_HALF',group:'V02',label:'CHEESE VIENNA Half',fraction:.5},
 {id:'POLONY',group:'POLONY',label:'POLONY',fraction:1}
];
export function trolleyRecipeOptions(groups){return trolleyDefinitions.filter(r=>groups.some(g=>g.id===r.group));}
export function createProductionTrolley(){return {id:crypto.randomUUID(),slot1:'',slot2:'',casings:{P02:0,P03:0,P04:0}};}
function validateTrolleys(rows,groups){
 check(Array.isArray(rows)&&rows.length<=MAX_PRODUCTION_TROLLEYS,'Use at most eight trolleys per production day.');
 const allowed=new Set(trolleyRecipeOptions(groups).map(r=>r.id)),ids=new Set();
 return rows.map(row=>{
  check(row&&typeof row==='object'&&typeof row.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(row.id)&&!ids.has(row.id),'Invalid or repeated trolley identifier.');ids.add(row.id);
  check(['slot1','slot2'].every(key=>row[key]===''||allowed.has(row[key])),'Choose a supported recipe for each trolley position.');
  check(row.casings&&typeof row.casings==='object','Enter the polony casings on each trolley.');
  const casings={};for(const code of Object.keys(POLONY_CASING_YIELDS)){
   const value=row.casings[code];check(Number.isSafeInteger(value)&&value>=0&&value<=POLONY_CASINGS_PER_TROLLEY,'Use whole casing counts from zero to eight on a trolley.');casings[code]=value;
  }
  // Construct the trusted shape: clients cannot add a third batch or forge capacity.
  check(!Object.keys(row).some(k=>!['id','slot1','slot2','casings'].includes(k)),'A trolley has exactly two recipe positions.');
  return {id:row.id,slot1:row.slot1,slot2:row.slot2,casings};
 });
}
// Pure reconciliation: report differences, never assign, clear or reorder a trolley.
function trolleySummary(plan,groups){
 const recipes=trolleyRecipeOptions(groups),definitions=new Map(recipes.map(r=>[r.id,r]));
 const warnings=[],assigned=new Map(),casingAssigned={P02:0,P03:0,P04:0};
 const rows=plan.trolleys.map((row,index)=>{
  const slots=['slot1','slot2'].map(key=>{
   const recipe=definitions.get(row[key]);
   if(!row[key])return {key,id:'',label:'Empty',fraction:0,detail:''};
   if(!recipe){warnings.push('Trolley '+(index+1)+': unknown recipe');return {key,id:row[key],label:row[key],fraction:0,detail:'Unknown recipe'};}
   assigned.set(recipe.group,(assigned.get(recipe.group)??0)+recipe.fraction);
   const group=groups.find(g=>g.id===recipe.group);
   // A shared Russian batch is loose pieces, never 1,310 sales bags.
   const qty=recipe.group==='POLONY'?POLONY_CASINGS_PER_BATCH:recipe.group==='RUSSIAN'?null:group.rows[0].yield_qty>0?roundQty(group.rows[0].yield_qty*recipe.fraction):null;
   const detail=recipe.group==='POLONY'?qty+' casings capacity':recipe.group==='RUSSIAN'?'Shared recipe · packing in Products & stock':qty===null?'Set recipe yield':qty+' sales units before packing';
   return {...recipe,key,detail};
  });
  const capacity=slots.filter(s=>s.group==='POLONY').length*POLONY_CASINGS_PER_BATCH;
  const casings={...row.casings},total=Object.values(casings).reduce((a,b)=>a+b,0);
  for(const code of Object.keys(casingAssigned))casingAssigned[code]+=casings[code]??0;
  const notes=[];
  if(total>capacity)notes.push('Casings exceed the selected polony batch capacity');
  if(capacity>total)notes.push((capacity-total)+' casing spaces still need sizes');
  if(!slots.some(s=>s.id)&&total===0)notes.push('No recipes selected');
  warnings.push(...notes.map(note=>'Trolley '+(index+1)+': '+note));
  return {...row,number:index+1,slots,casing_capacity:capacity,casing_total:total,show_casings:capacity>0||total>0,warnings:notes};
 });
 const requirements=groups.filter(g=>recipes.some(r=>r.group===g.id)).map(g=>{
  const required=g.planned??g.suggested,allocated=assigned.get(g.id)??0,remaining=required===null?null:required-allocated;
  const label=recipes.find(r=>r.group===g.id&&r.fraction===1).label.replace(' Full','');
  if(remaining===null)warnings.push(label+': cooking requirement is not yet known');
  else if(remaining>0)warnings.push(label+': '+remaining+' batches still to assign');
  else if(remaining<0)warnings.push(label+': '+(-remaining)+' extra batches assigned');
  return {id:g.id,label,required,assigned:allocated,remaining,basis:g.planned===null?'Suggestion — choose My plan':'My plan'};
 });
 const polony=groups.find(g=>g.id==='POLONY');
 const casing_requirements=Object.keys(POLONY_CASING_YIELDS).filter(code=>polony?.rows.some(i=>i.code===code)||casingAssigned[code]>0).map(code=>{
  const item=polony?.rows.find(i=>i.code===code),required=item?(item.casing_plan??item.casing_suggested):0,allocated=casingAssigned[code],remaining=required===null?null:required-allocated;
  const label={P02:'Small',P03:'Medium',P04:'Long'}[code];
  if(remaining===null)warnings.push('Polony '+label+': casing requirement not yet known');
  else if(remaining>0)warnings.push('Polony '+label+': '+remaining+' casings still to assign');
  else if(remaining<0)warnings.push('Polony '+label+': '+(-remaining)+' extra casings assigned');
  return {code,label,required,assigned:allocated,remaining,basis:item?.casing_plan!=null?'My plan':'Suggestion — choose casing plan'};
 });
 const minimum_slots=sumKnown(requirements.map(r=>r.required===null?null:Math.ceil(r.required)));
 if(minimum_slots>MAX_PRODUCTION_TROLLEYS*2)warnings.push('More than eight trolleys are needed; review today’s cooking plan');
 return {recipes,rows,requirements,casing_requirements,warnings,max_trolleys:MAX_PRODUCTION_TROLLEYS,minimum_trolleys:minimum_slots===null?null:Math.ceil(minimum_slots/2)};
}
