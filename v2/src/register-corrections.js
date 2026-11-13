// Server-only, source-backed specifications. This file contains no stock counts or prices.
// Application is an authenticated, explicit POST and preserves prior recipe versions.
export const DOCUMENTED_UPDATE='packaging-patties-2026-10-09';
const costing='https://docs.google.com/document/d/1hb8pmHBz6Ijo_Ebf5rvzbXdYHq-VSAe8YU2PWrVK9ls';
const ordering='https://docs.google.com/document/d/1QCXeOa80hrU-0ODJKTuSC7kD9GeohChbvRCsxHmYThY';
export const MARGOT_PACK_UPDATE='margot-packs-2026-10-09-alinda';
const margotSheet='https://docs.google.com/spreadsheets/d/1g1hk9oMD2h4NlISgFMysAbaM8DCy3eptT0Lvs9e7YEg/edit#gid=656937722';
// Alinda's 9 October 13:46 email, linked Margot Swiss sheet A4:B37.
// Pack quantities are always in the EXISTING material unit. Container contents
// are descriptions, not conversions: a 5 L Pine Gel tub is one stock unit.
const margotPacks=[
 ['RM82',4,'Apron: Plastic','unit',100,'100 voorskote','voorskote'],
 ['RM83',5,'Bandsaw Blades','unit',1,'1 saaglem','saaglemme'],
 ['RM84',6,'DZ400 Ribbon Element 12mm','unit',1,'1 ribbon-element','ribbon-elemente'],
 ['RM85',7,'Teflon Tape 5m Vacuum','unit',1,'1 Teflon-band','Teflon-bande'],
 ['RM86',8,'Mop Caps','unit',100,'100 haarnette','haarnette'],
 ['RM87',9,'Beard Caps','unit',100,'100 baardnette','baardnette'],
 ['RM88',10,'Pine Gel','unit',1,'1 houer van 5 L','houers van 5 L'],
 ['RM89',11,'Bleach Sachets Capricide/Bactrax','unit',100,'100 sakkies van 30 g','sakkies'],
 ['RM90',12,'Jumbo Wipe Roll','unit',1,'1 rol van 200 mm × 550 m (IMPI205)','rolle'],
 ['RM91',13,'Toilet Paper','unit',48,'48 rolle, 1-laag','rolle'],
 ['RM92',14,'Foodgrease','unit',1,'1 patroon van 400 g','patrone'],
 ['RM93',15,'Foodspray','unit',1,'1 spuitbus van 400 ml','spuitbusse'],
 ['RM32',16,'Casing 55 Shirred French Red','unit',1,'1 casing-rol','casing-rolle'],
 ['RM65',17,'Casing: Clear 150/60 Patty','unit',25,'25 patty-casings','casings'],
 ['RM73',18,'Film 330mx1400m','roll',1,'1 rol van 330 mm × 1 400 m','rolle'],
 ['RM71',19,'Carry Bags Handy','unit',100,'100 Handy-sakke','sakke'],
 ['RM72',20,'Carry Bags MIDI','unit',100,'100 Midi-sakke','sakke'],
 ['RM37',21,'Fomo Black 71M Labels','unit',250,'250 Black 71M-bakkies','bakkies','Fomo Black 71M trays'],
 ['RM38',22,'Fomo White Oval Labels','unit',200,'200 White Oval 2-bakkies','bakkies','Fomo White Oval 2 trays'],
 ['RM66',23,'Fomo Black Nr8 Patties','unit',50,'50 patty-bakkies','bakkies'],
 ['RM67',24,'Fomo Black Oval 2','unit',200,'200 Black Oval 2-bakkies','bakkies'],
 ['RM68',25,'Vacuum Bags 150x200','unit',1000,'1 000 vakuumsakke van 150 × 200 mm','sakke'],
 ['RM69',26,'Vacuum Bags 150x250','unit',1000,'1 000 vakuumsakke van 150 × 250 mm','sakke'],
 ['RM33',27,'Clear Bags 300x450 (30mic)','unit',250,'250 sakke van 300 × 450 mm','sakke'],
 ['RM34',28,'Clear Bags 350x450 (30mic)','unit',250,'250 sakke van 350 × 450 mm','sakke'],
 ['RM35',29,'Clear Bags 450x600 (30mic)','unit',250,'250 sakke van 450 × 600 mm','sakke'],
 ['RM48',30,'Brown Vinegar','kg',5,'1 houer van 5 L = 5 kg','kg'],
 ['RM23',31,'Coriander Ground','kg',1,'1 kg koljander','kg'],
 ['RM20',32,'Salt','kg',50,'50 kg sout','kg'],
 ['RM50',33,'Nutmeg Ground','kg',1,'1 kg neutmuskaat','kg'],
 ['RM21',34,'Peri-Peri Hot','kg',1,'1 kg peri-peri','kg'],
 ['RM22',35,'Black Pepper Ground','kg',1,'1 kg gemaalde swartpeper','kg'],
 ['RM52',36,'Brown Sugar','kg',1,'1 kg bruinsuiker','kg'],
 ['RM49',37,'Cloves Ground','kg',1,'1 kg naeltjies','kg'],
];
export function margotPackCorrections(input){
 const register=structuredClone(input),changes=[],skipped=[];
 if(register.applied_updates?.includes(MARGOT_PACK_UPDATE))return {register,changes,skipped,applied:true};
 for(const [id,row,name,unit,pack,label,unit_label,newName] of margotPacks){
  const m=register.materials.find(m=>m.id===id);if(!m)continue;
  if(m.supplier.trim().toLowerCase()!=='margot swiss'||m.unit!==unit||![name,newName].includes(m.name)||m.pack_spec){skipped.push(id+': Die bestaande produkbesonderhede is gewysig; dit is behou.');continue;}
  if(m.pack_qty!==null&&m.pack_qty!==pack&&!(id==='RM38'&&m.pack_qty===250&&m.name===name)){skipped.push(id+': Die gestoorde pakgrootte verskil van Alinda se blad; dit is behou.');continue;}
  let note='';
  if(id==='RM48')note='Alex het op 9 Oktober 2026 bevestig: gebruik 1 liter = 1 kg. Een 5-literhouer tel dus as 5 kg. Los liter en los kg het dieselfde invoerwaarde.';
  if(['RM83','RM84','RM85'].includes(id)){
   if(m.minimum_stock!==undefined&&m.minimum_stock!==2){skipped.push(id+': Die bestaande minimum voorraad is behou.');continue;}
   m.minimum_stock=2;note='Alex het op 9 Oktober 2026 bevestig: bestel enkel eenhede soos nodig en hou minstens 2 aan. Order Guy vul die tekort tot by 2 aan wanneer die voorraad getel is.';
  }
  if(id==='RM34')note='Die blad noem 25 mikron; die bestaande produk is 30 mikron. Die bevestigde 250 sakke per pak bly dieselfde; bevestig die dikte wanneer jy bestel.';
  if(id==='RM37')note='250 per pak volgens die blad wat Alinda op 9 Oktober gestuur het. Ander bestelrekords het ook 125-bakkie sleeves; tel die fisiese pak wat jy het. Die aparte CIBA-produk is onveranderd.';
  m.pack_qty=pack;if(newName)m.name=newName;
  m.pack_spec={label,unit_label,note,source:margotSheet+'&range=A'+row+':B'+row};
  changes.push(m.name+': '+label+'.'+(note?' '+note:''));
 }
 const documented=new Set(margotPacks.map(x=>x[0]));
 for(const m of register.materials.filter(m=>m.supplier.trim().toLowerCase()==='margot swiss'&&m.pack_qty===null&&!documented.has(m.id)))skipped.push(m.name+': Geen bevestigde pakgrootte in die gekoppelde blad nie; tel voorlopig die totale '+m.unit+'.');
 if(changes.length)register.applied_updates=[...(register.applied_updates??[]),MARGOT_PACK_UPDATE];
 return {register,changes,skipped,applied:false};
}
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
