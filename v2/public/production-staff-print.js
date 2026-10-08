import {productionSummary,productionPlanningView} from './production.js';

// Read-only snapshot: Master DATA packsPerBag, verified 7 October 2026.
// The original production planner excludes S01–S03 and O01–O03 from labels.
// These are packets per OUTER sales unit, not recipe yields or casing yields.
const packetsPerUnit={
 W01:10,W02:5,W03:5,W04:5,W05:5,W06:5,W07:5,W08:5,
 R01:10,R02:10,R03:10,R04:10,R05:10,R06:10,R07:10,R08:1,
 V01:10,V02:10,P01:10,P02:10,P03:10,P04:10,C01:5,C02:5,C03:5,
 D01:1,D02:1,D03:1,D04:1,D05:1,D06:1,D07:1,D08:1,
 B01:1,B02:1,B03:1,B04:1,B05:1,B06:1,B07:1,B08:1,B09:1,B10:1
};
const noLabels=new Set(['S01','S02','S03','O01','O02','O03']);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'?':new Intl.NumberFormat('en-ZA',{maximumFractionDigits:3}).format(v);
const batches=v=>num(v)+' '+(v===1?'batch':'batches');
export function staffLabelCount(code,pack){
 if(pack===0||noLabels.has(code))return 0;
 if(!Number.isSafeInteger(pack)||pack<0||!Object.hasOwn(packetsPerUnit,code))return null;
 return pack*(packetsPerUnit[code]+1);
}

// Consume chosen, SAVED quantities only. Summary suggestions and effective
// casing/packing fallbacks are deliberately not production instructions here.
export function productionStaffModel(plan){
 const summary=productionSummary(plan),rows=[],review=new Set();
 const add=(g,i,make,pack,{name=i.name,manufactureOnly=false,note=''}={})=>{
  const labels=manufactureOnly?null:staffLabelCount(i.code,pack);
  const needsReview=g.warnings.length>0||(!manufactureOnly&&(pack==null||labels==null));
  if(needsReview)review.add(g.id);
  rows.push({code:i.code,group:g.id,name,make,pack,labels,manufactureOnly,note,review:needsReview});
 };
 for(const g of summary.groups){
  const first=g.rows[0];if(!first)continue;
  if(g.mode==='shared'||g.mode==='casings'){
   const active=g.planned>0||g.rows.some(i=>i.pack_plan>0||i.casing_plan>0);if(!active)continue;
   if(g.planned!==0)add(g,first,batches(g.planned),null,{name:g.id==='POLONY'?'POLONY · all sizes':'RUSSIAN · all sizes',manufactureOnly:true});
   for(const i of g.rows){
    // If new batches have no chosen size allocation, show the missing decision.
    if(!(i.pack_plan>0||i.casing_plan>0||(g.planned>0&&(i.pack_plan===null||(g.mode==='casings'&&i.casing_plan===null)))))continue;
    add(g,i,g.mode==='casings'?num(i.casing_plan)+(i.casing_plan===1?' casing':' casings'):'—',i.pack_plan);
   }
  }else if(g.mode==='rolls'){
   if(g.cut_planned>0)add(g,first,'Cut '+num(g.cut_planned)+' rolls',g.output,{note:g.loose_disks>0?num(g.loose_disks)+' loose disks remain':''});
   if(g.planned>0)add(g,first,batches(g.planned),null,{name:first.name+' · for freezing',manufactureOnly:true});
  }else if(g.mode==='cooked'){
   if(g.planned>0||first.pack_plan>0)add(g,first,batches(g.planned),first.pack_plan,{note:g.id==='R07'?(first.recipe_version===2?'2 spice packs · 106 kg per batch':'Previous recipe basis'):''});
  }else if(g.planned>0){
   add(g,first,g.mode==='batch'?batches(g.planned):'—',g.output);
  }
 }
 const trolley=summary.trolley;
 const trolleyReview=trolley.rows.some(r=>r.warnings.length||r.slots.some(s=>s.detail==='Unknown recipe'))||
  trolley.requirements.some(r=>(r.basis==='My plan'&&r.remaining!==0)||(r.basis!=='My plan'&&r.assigned>0))||
  trolley.casing_requirements.some(r=>(r.basis==='My plan'&&r.remaining!==0)||(r.basis!=='My plan'&&r.assigned>0));
 return {rows,trolleys:trolley.rows,trolleyReview,review:[...review]};
}
function productTable(rows){return `<table class="staff-products"><colgroup><col class="staff-product-col"><col class="staff-make-col"><col class="staff-qty-col"><col class="staff-label-col"><col class="staff-actual-col"></colgroup><thead><tr><th>Product</th><th>Make</th><th>Pack</th><th>Labels</th><th>Actual</th></tr></thead><tbody>${rows.map(r=>`<tr data-staff-code="${esc(r.code)}" data-staff-group="${esc(r.group)}"${r.manufactureOnly?' class="staff-recipe"':''}><td>${esc(r.name)}${r.review?' *':''}${r.note?'<small>'+esc(r.note)+'</small>':''}</td><td>${esc(r.make.replace(/ batch(?:es)?$/,''))}</td><td>${r.manufactureOnly?'—':num(r.pack)}</td><td>${r.manufactureOnly?'—':num(r.labels)}</td><td class="staff-actual">${r.manufactureOnly?'—':''}</td></tr>`).join('')}</tbody></table>`;}
export function productionStaffHTML(saved,catalog,{dirty=false}={}){
 const p=saved.plan,m=productionStaffModel(productionPlanningView(p,catalog)),middle=Math.ceil(m.rows.length/2);
 return `<div class="staff-heading"><h1>Production &amp; Packing</h1><strong>FEN MEAT</strong></div><div class="staff-context"><strong>${p.routes.map(code=>esc(catalog.routes.find(r=>r.code===code)?.name??code)).join(' + ')}</strong><span>Production: <b>${esc(p.date)}</b><br>Route date: <b>${esc(p.target_date)}</b></span></div><p class="staff-status">${esc(p.phase.toUpperCase())} · Saved revision ${esc(saved.revision)}${dirty?' · Unsaved screen edits excluded':''}</p>${m.rows.length?'<div class="staff-columns">'+productTable(m.rows.slice(0,middle))+productTable(m.rows.slice(middle))+'</div>':'<p class="staff-empty">No manufacturing or packing work selected in this saved plan.</p>'}<section class="staff-trolleys"><h2>Production trolley plan${m.trolleyReview?' *':''}</h2>${m.trolleys.length?`<table><colgroup><col class="staff-trolley-number"><col class="staff-trolley-batch"><col class="staff-trolley-batch"><col class="staff-trolley-casings"></colgroup><thead><tr><th>#</th><th>Batch 1</th><th>Batch 2</th><th>Polony casings · S / M / L</th></tr></thead><tbody>${m.trolleys.map(r=>'<tr><td>'+r.number+'</td>'+r.slots.map(s=>'<td>'+esc(s.id?s.label:'—')+'</td>').join('')+'<td>'+(r.show_casings?[r.casings.P02,r.casings.P03,r.casings.P04].map(num).join(' / '):'—')+'</td></tr>').join('')}</tbody></table><p>S = Small · M = Medium · L = Long. Numbers are casings on that trolley.</p>`:'<p>No trolley selections saved.</p>'}</section>${p.notes?'<p class="staff-notes"><b>Notes:</b> '+esc(p.notes)+'</p>':''}<p class="staff-key"><b>Pack / Actual:</b> finished sales units; Actual is for handwriting. <b>Labels:</b> packet labels + outer-bag label. <b>Make:</b> batches unless casings or cut rolls are stated. Shared recipes are made once across all sizes.${m.review.length||m.trolleyReview?'<br><b>* Review marked plans in the app before work. ? = quantity not yet set or label rule needs checking.</b>':''}</p>`;
}

// Measure the same fixed-width typography used by the print renderer. Never
// clip notes/rows or shrink below 8.5pt just to claim a single-page print.
export function fitProductionStaffSheet(sheet){
 const maximumHeight=275*96/25.4;
 for(const density of ['roomy','compact','tight']){
  sheet.dataset.density=density;
  balanceStaffColumns(sheet);
  if(sheet.getBoundingClientRect().height<=maximumHeight)return true;
 }
 return false;
}

function balanceStaffColumns(sheet){
 const bodies=[...sheet.querySelectorAll('.staff-products tbody')];if(bodies.length!==2)return;
 const rows=bodies.flatMap(body=>[...body.children]);if(rows.length<2)return;
 const split=at=>{bodies[0].replaceChildren(...rows.slice(0,at));bodies[1].replaceChildren(...rows.slice(at));};
 let low=1,high=rows.length-1,best=low,height=Infinity;
 // Heights are monotonic as the split moves, so only a few measurements are needed.
 while(low<=high){
  const at=Math.floor((low+high)/2);split(at);
  const left=bodies[0].getBoundingClientRect().height,right=bodies[1].getBoundingClientRect().height;
  const orphan=rows[at-1].classList.contains('staff-recipe')&&rows[at-1].dataset.staffGroup===rows[at].dataset.staffGroup;
  if(!orphan&&Math.max(left,right)<height){best=at;height=Math.max(left,right);}
  if(left<right)low=at+1;else high=at-1;
 }
 split(best);
}
