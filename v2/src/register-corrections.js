// Server-only, source-backed specifications. This file contains no stock counts or prices.
// Application is an authenticated, explicit POST and preserves prior recipe versions.
export const DOCUMENTED_UPDATE='packaging-patties-2026-10-09';
const costing='https://docs.google.com/document/d/1hb8pmHBz6Ijo_Ebf5rvzbXdYHq-VSAe8YU2PWrVK9ls';
const ordering='https://docs.google.com/document/d/1QCXeOa80hrU-0ODJKTuSC7kD9GeohChbvRCsxHmYThY';
export function documentedCorrections(input){
 const register=structuredClone(input),changes=[],skipped=[];
 if(register.applied_updates?.includes(DOCUMENTED_UPDATE))return {register,changes,skipped,applied:true};
 const materials=new Map(register.materials.map(m=>[m.id,m]));
 const line=(material,qty,status='approved',note=costing)=>({material,qty,unit:materials.get(material)?.unit,status,note});
 const latest=group=>register.recipes.filter(r=>r.group===group).sort((a,b)=>b.version-a.version)[0];
 function addRecipe(old,consumables,extra={}){
  const next={...structuredClone(old),...extra,version:old.version+1,effective_date:'2026-10-09',consumables,complete:true,source:old.source,notes:old.notes+' | Manufacturing allocation restored from '+costing+'; owner instruction 9 October 2026. Ingredient formula unchanged.'};
  register.recipes.push(next);changes.push(old.name+': manufacturing consumables added as recipe v'+next.version+'.');
 }
 const patty=latest('W07');
 if(patty?.status==='approved'&&patty.effective_date<='2026-10-09'&&patty.batch_kg===59&&patty.consumables.length===0&&materials.get('RM65')?.unit==='unit'){
  const source=costing+'; owner 2026-10-09: 30 disks per 3 kg roll, 4 disks per tray, 5 trays per sales bag. Calculated planning output; no old cooking-loss factor.';
  addRecipe(patty,[line('RM65',Math.ceil(patty.batch_kg/3),'approved',source+' 19 full rolls and one partly filled casing; do not count the partial casing as 30 disks.')],{forecast_yields:[{product:'W07',qty:patty.batch_kg/3*30/4/5,status:'approved',source}]});
 }else skipped.push('Patties recipe differs from the reviewed 59 kg version or already has casing data; existing values retained.');
 const polony=latest('POLONY');
 if(polony?.status==='approved'&&polony.effective_date<='2026-10-09'&&polony.batch_kg===100&&polony.consumables.length===0&&materials.get('RM32')?.unit==='unit')addRecipe(polony,[line('RM32',4,'approved','Current approved production basis: 4 casings per 100 kg recipe; 8 per trolley. '+costing)]);
 else skipped.push('Polony recipe differs from the reviewed 100 kg version or already has casing data; existing values retained.');
 // These are identity/pack corrections, not price updates. Existing stock stays in individual units.
 const white=materials.get('RM38');
 if(white?.name==='Fomo White Oval Labels'&&white.unit==='unit'){
  white.name='Fomo White Oval 2 trays';white.pack_qty=200;white.notes+=' | Tray identity and 200-per-pack confirmed by filed Margot ordering record; old name incorrectly said labels. '+ordering;
  changes.push('White Oval 2 is a tray, with 200 trays per purchase pack.');
 }
 const casing=materials.get('RM65');if(casing?.unit==='unit'&&casing.pack_qty===null){casing.pack_qty=25;casing.notes+=' | 25 casings per purchase pack, owner-confirmed 25 September. '+ordering;changes.push('Patty casings: 25 per purchase pack.');}
 const outer=materials.get('RM33');if(outer?.unit==='unit'&&outer.pack_qty===null){outer.pack_qty=250;outer.notes+=' | 300 x 450 outer bags: 250 per pack in current supplier stocktake.';changes.push('300 x 450 outer bags: 250 per purchase pack.');}
 const packaging=new Map(register.packaging.map(p=>[p.product,p]));
 function patch(product,parts,innerLabel,innerCount,{film=false,single=false}={}){
  const p=packaging.get(product);
  if(!p||p.complete||!p.lines.some(l=>l.material==='LABELS_UNALLOCATED')){skipped.push(product+': newer or non-seed packaging retained.');return;}
  const labelCount=p.lines.find(l=>l.material==='LABELS_UNALLOCATED').qty;
  const baseline=product.startsWith('W')?{RM67:5,RM38:5,RM66:5,MINCE_TRAY:5,RM73:2.5/1400,RM71:1}:{};
  if(labelCount!==(single?2:innerCount+1)||p.lines.some(l=>l.material!=='LABELS_UNALLOCATED'&&(!Object.hasOwn(baseline,l.material)||Math.abs(l.qty-baseline[l.material])>1e-10))){skipped.push(product+': packaging quantities have been edited since the reviewed export; existing values retained.');return;}
  const outerLabels=single?0:Math.max(0,labelCount-innerCount);
  const needs=[...parts.map(([id])=>id),innerLabel,...(outerLabels?['LABELS_UNALLOCATED']:[])];
  if(needs.some(id=>!materials.has(id))){skipped.push(product+': a required material identity is missing.');return;}
  p.lines=parts.map(([id,qty,status])=>line(id,qty,status??'approved'));
  p.lines.push(line(innerLabel,innerCount));
  if(outerLabels)p.lines.push(line('LABELS_UNALLOCATED',outerLabels,'review','Outer label quantity confirmed by current staff print; allocate the label stock type before ordering labels.'));
  p.complete=true; // Every physical requirement is represented; unverified individual lines still block that material.
  p.source=costing+'; '+ordering+'; current staff print for outer label quantities; owner instruction 2026-10-09';
  p.notes='Documented packing per sales unit restored. '+(outerLabels?'Outer label stock type still needs allocation. ':'')+(film?'Film uses the documented 0.5 metre per tray planning estimate. ':'')+'No ingredient recipe or historical price replaced.';
  changes.push(product+': documented packaging restored.');
 }
 for(const code of ['R01','R02','R03','R04','R05','R06','R07','P01'])patch(code,[['RM69',10],['RM35',1]],code==='R05'?'RM40':code==='R06'?'RM39':'RM41',10);
 for(const code of ['V01','V02'])patch(code,[['RM68',10],['RM33',1]],'RM41',10);
 for(const code of ['P02','P03','P04'])patch(code,[['RM35',1]],'RM41',10);
 patch('R08',[['RM36',1]],'RM41',1,{single:true});
 for(const code of ['W02','W03','W04','W05','W06','W07','W08']){
  const tray=code==='W03'?'RM38':code==='W07'?'RM66':code==='W08'?'MINCE_TRAY':'RM67';
  patch(code,[[tray,5,code==='W08'?'review':'approved'],['RM73',2.5/1400,'estimate'],['RM71',1]],code==='W02'?'RM42':'RM41',5,{film:true});
 }
 // Braaiwors' old document has residual packaging, so retain the newer itemised register.
 if(changes.length)register.applied_updates=[...(register.applied_updates??[]),DOCUMENTED_UPDATE];
 return {register,changes,skipped,applied:false};
}
