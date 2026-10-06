import {check,dateKey,addDays,weekday,isQty,roundQty,cleanText} from './domain.js';
// Existing production planner references, read 6 Oct 2026. These are planning
// yields, not measured guarantees. Keep recipe/output changes explicit per plan.
const yields={W01:13,W02:26,W03:24,W04:55,W05:50,W06:16,W07:29,W08:31,R05:22,R06:24,R07:23,V01:32,V02:36,P02:122,P03:61,P04:31};
const russianPieces={R01:60,R02:50,R03:40,R04:30};
export function productionProfile(p){
 if(russianPieces[p.code])return {group:'RUSSIAN',group_name:'Russian · shared recipe',mode:'shared',yield_qty:1310/russianPieces[p.code],yield_note:'Existing planner: 1,310 loose Russians per batch; '+russianPieces[p.code]+' per sales bag. Review after recipe changes.'};
 if(['P02','P03','P04'].includes(p.code))return {group:'POLONY',group_name:'Polony · shared recipe',mode:'shared',yield_qty:yields[p.code],yield_note:'Sales bags from one complete recipe if packed entirely in this size. Existing planning reference; review after recipe changes.'};
 if(yields[p.code])return {group:p.code,group_name:p.name,mode:'batch',yield_qty:yields[p.code],yield_note:'Sales bags per complete recipe, from the existing production planner. Check when the recipe or pack size changes.'};
 if(['P01','R08'].includes(p.code))return {group:p.code,group_name:p.name,mode:'pack',yield_qty:null,yield_note:'Pack from available offcuts / surplus. No separate recipe is assumed.'};
 if(/^(B|C|D|S|O)\d+$/.test(p.code))return {group:p.code,group_name:p.name,mode:'buy',yield_qty:null,yield_note:'Bought-in / repacked product. The plan does not place an order.'};
 return {group:p.code,group_name:p.name,mode:'batch',yield_qty:null,yield_note:'Enter the saleable output per complete recipe before using a suggestion.'};
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
export function buildProductionPlan({date,target_date,routes,items,snapshot,previous=null,yieldSettings=null}){
 const old=new Map((previous?.items??[]).map(i=>[i.code,i]));
 const plan={date,target_date,routes,phase:'draft',demand_snapshot:snapshot,notes:previous?.notes??'',items:items.map(i=>{const p=old.get(i.code),setting=yieldSettings?.find(x=>x.code===i.code);return {...i,stock:p?.stock??null,yield_qty:p?p.yield_qty:setting?setting.yield_qty:i.yield_qty,pack_plan:p?.pack_plan??null,actual:p?.actual??null};}),groups:[]};
 // Retain user-owned fields on products no longer in the current catalogue.
 for(const i of previous?.items??[])if(!plan.items.some(x=>x.code===i.code))plan.items.push({...i,demand:0,breakdown:[],retained:true});
 for(const i of plan.items)if(!plan.groups.some(g=>g.id===i.group)){const g=previous?.groups.find(g=>g.id===i.group);plan.groups.push({id:i.group,name:i.group_name,mode:i.mode,planned:g?.planned??null});}
 return plan;
}
export function productionSummary(plan){
 const items=plan.items.map(i=>{const shortage=i.demand==null||i.stock==null?null:roundQty(Math.max(0,i.demand-i.stock));return {...i,shortage};});
 const groups=plan.groups.map(g=>{const rows=items.filter(i=>i.group===g.id),batch=['batch','shared'].includes(g.mode);
 // A packing quantity is NEW output, so stock has already been accounted for.
 // An explicit zero overrides shortage too; only blank sizes use the shortage.
 const required=rows.map(i=>{const qty=g.mode==='shared'?(i.pack_plan??i.shortage):i.shortage;return qty===null?null:qty===0?0:batch?i.yield_qty>0?qty/i.yield_qty:null:qty;});
 const suggested=required.some(x=>x===null)?null:batch?Math.ceil(Math.max(0,required.reduce((a,x)=>a+x,0)-1e-9)):roundQty(required.reduce((a,x)=>a+x,0));
 let used=null,output=null;
 if(g.mode==='shared')used=rows.some(i=>i.pack_plan===null||(i.pack_plan>0&&!(i.yield_qty>0)))?null:rows.reduce((a,i)=>a+(i.pack_plan===0?0:i.pack_plan/i.yield_qty),0);
 if(g.mode==='batch')output=g.planned===0?0:g.planned!==null&&rows[0].yield_qty>0?roundQty(g.planned*rows[0].yield_qty):null;
 if(g.mode==='buy'||g.mode==='pack')output=g.planned;
 const warnings=[];
 if(rows.some(i=>i.stock===null))warnings.push('Stock not counted');
 if(rows.some(i=>i.demand===null))warnings.push('Route need is incomplete');
 if(batch&&rows.some(i=>!(i.yield_qty>0)))warnings.push('Recipe yield needs setting');
 if(g.planned===null)warnings.push('My plan not chosen');
 if(g.mode==='shared'&&used===null)warnings.push('Packing plan incomplete');
 if(g.mode==='shared'&&used!==null&&g.planned!==null&&used>g.planned+1e-9)warnings.push('Packing plan exceeds planned batches');
 const balances=rows.map(i=>{const made=g.mode==='shared'?i.pack_plan:output;return {code:i.code,output:made,balance:i.stock===null||i.demand===null||made===null?null:roundQty(i.stock+made-i.demand)};});
 if(balances.some(b=>b.balance<0))warnings.push('My plan leaves a shortage');
 return {...g,rows,suggested,packing_based:g.mode==='shared'&&rows.some(i=>i.pack_plan!==null),output,used,balances,warnings};
 });
 return {items,groups,warnings:groups.flatMap(g=>g.warnings.map(message=>({group:g.id,name:g.name,message})))};
}
export function applyProductionSuggestion(plan,id,{blankOnly=false}={}){
 const s=productionSummary(plan).groups.find(g=>g.id===id),g=plan.groups.find(g=>g.id===id);if(!s||s.suggested===null||(blankOnly&&g.planned!==null))return false;
 g.planned=s.suggested;if(g.mode==='shared')for(const row of s.rows){const i=plan.items.find(x=>x.code===row.code);if(i.pack_plan===null)i.pack_plan=row.shortage;}
 plan.phase='draft';return true;
}
export function validateProductionEdits(input,base){
 check(input&&Array.isArray(input.items)&&Array.isArray(input.groups),'Invalid production plan.');
 check(input.items.length===base.items.length&&new Set(input.items.map(i=>i.code)).size===base.items.length&&base.items.every(i=>input.items.some(x=>x.code===i.code)),'Production products changed. Refresh the plan.');
 check(input.groups.length===base.groups.length&&new Set(input.groups.map(g=>g.id)).size===base.groups.length&&base.groups.every(g=>input.groups.some(x=>x.id===g.id)),'Production groups changed. Refresh the plan.');
 const plan=structuredClone(base);plan.notes=cleanText(input.notes,1500);plan.phase='draft';
 for(const i of plan.items){const submitted=input.items.find(x=>x.code===i.code);for(const key of ['stock','pack_plan','actual']){check(submitted[key]===null||isQty(submitted[key]),'Enter non-negative sales quantities, or leave uncounted values blank.');i[key]=submitted[key];}
  check(submitted.yield_qty===null||(typeof submitted.yield_qty==='number'&&Number.isFinite(submitted.yield_qty)&&submitted.yield_qty>0&&submitted.yield_qty<=100000),'Recipe yield must be greater than zero.');i.yield_qty=submitted.yield_qty;
 }
 for(const g of plan.groups){const value=input.groups.find(x=>x.id===g.id).planned;check(value===null||(['batch','shared'].includes(g.mode)?Number.isSafeInteger(value)&&value>=0&&value<=10000:isQty(value)),'My plan must use non-negative whole batches (or sales units for bought-in / packing items).');g.planned=value;}
 return plan;
}
