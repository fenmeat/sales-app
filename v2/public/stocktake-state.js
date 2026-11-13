import {applySupplierCount,supplierGroups,fullPackQuantity,needsFullPackConfirmation} from './stocktake.js';
import {today} from './domain.js';

export function countNumber(value){
 const v=String(value??'').trim().replace(',','.');if(!v)return null;
 if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(v)||!Number.isFinite(Number(v)))throw Error('Voer ’n geldige hoeveelheid van 0 of meer in. ’n Desimale komma is reg.');
 return Number(v);
}
export const hasCountChanges=draft=>!!draft.metaDirty||Object.keys(draft.rows??{}).length>0;
export function savedCountRow(m){
 const base={packs:'',reserve:m.stock.reserve??0,included_incoming:[],pack_qty:m.pack_qty,unit:m.unit};
 if(m.stock.qty===null)return base;
 const c=m.stock.count;
 if(needsFullPackConfirmation(m))return {...base,review:'Die vorige telling bevat los voorraad of deelpakke. Bevestig die huidige aantal volle pakke; die ou totaal bly in die geskiedenis.'};
 if(c&&c.unit===m.unit&&c.pack_qty===m.pack_qty){
  try{if(Math.abs(fullPackQuantity(m,c.packs)-m.stock.qty)<1e-6)return {...base,packs:c.packs};}catch{}
 }
 // Never round, discard a remainder or reinterpret a changed pack basis.
 if(!c&&m.pack_qty>0){const packs=m.stock.qty/m.pack_qty;if(Number.isSafeInteger(packs))return {...base,packs};}
 return {...base,review:'Bevestig die volle pakke met die huidige pakgrootte. Die vorige totaal word nie afgerond of by jou nuwe telling getel nie.'};
}
export function initialiseCountDraft(register,draft){
 const groups=supplierGroups(register.materials);
 const group=groups.find(g=>g.key===draft.supplier)??groups[0];if(!group)return null;
 draft.supplier=group.key;draft.rows??={};
 const saved=group.materials.filter(m=>m.stock.qty!==null&&m.stock.date);
 const latest=saved.map(m=>m.stock.date).sort().at(-1);
 draft.date??=latest??today();
 const dates=[...new Set(saved.filter(m=>m.stock.date===draft.date).map(m=>m.stock.available_from??m.stock.date))];
 draft.available_from??=dates.length===1?dates[0]:draft.date;
 // The existing acknowledgement may be displayed, but date edits reset it.
 draft.confirmed??=saved.length>0&&saved.every(m=>(m.stock.available_from??m.stock.date)===draft.available_from&&(m.stock.date===draft.available_from||m.stock.availability_confirmed===true));
 return group;
}
export function prepareCountRequest(result,draft){
 const group=supplierGroups(result.register.materials).find(g=>g.key===draft.supplier);
 if(!group)throw Error('Kies eers die verskaffer.');
 const rows=[];
 for(const m of group.materials){
  if(!Object.hasOwn(draft.rows??{},m.id)&&!draft.metaDirty)continue;
  const row=draft.rows[m.id]??savedCountRow(m),packs=countNumber(row.packs);
  if(row.review&&Object.hasOwn(draft.rows,m.id))throw Error(m.name+': '+row.review);
  if(row.loose!==undefined&&row.loose!==null&&row.loose!==''&&Number(row.loose)!==0)throw Error(m.name+': Herbevestig slegs die volle pakke; die ou los invoer mag nie saam gestoor word nie.');
  if(packs===null){if(row.included_incoming?.length)throw Error('Voer die fisiese telling vir '+m.name+' in voordat jy ’n aflewering daarby insluit.');continue;}
  if(row.unit!==undefined&&(row.unit!==m.unit||row.pack_qty!==m.pack_qty))throw Error(m.name+': Die pakgrootte het verander. Jou invoer is behou; laai die jongste gegewens voordat jy stoor.');
  rows.push({material:m.id,packs,reserve:countNumber(row.reserve)??0,included_incoming:row.included_incoming??[]});
 }
 if(!rows.length)throw Error('Geen nuwe telling is ingevoer nie. Die gestoorde hoeveelhede wat op die skerm staan, bly behoue.');
 const body={revision:result.revision,supplier:draft.supplier,date:draft.date,available_from:draft.available_from,availability_confirmed:!!draft.confirmed,rows};
 applySupplierCount(result.register,body,result.current_user??'owner');
 return body;
}
export function reconcileCountDraft(result,draft){
 if(result.request_id&&(result.request_id===draft.request?.request_id||result.request_id===draft.legacy_request_id)){draft.rows={};draft.metaDirty=false;draft.request=null;delete draft.legacy_request_id;delete draft.date;delete draft.available_from;delete draft.confirmed;return 'Jou vorige stoor is op die bediener gevind. Die gestoorde hoeveelhede is hieronder ingevul.';}
 if(!hasCountChanges(draft)){delete draft.date;delete draft.available_from;delete draft.confirmed;}
 let changedBasis=0;
 for(const [id,row] of Object.entries(draft.rows??{})){
  const m=result.register.materials.find(m=>m.id===id);if(!m||(row.unit===m.unit&&row.pack_qty===m.pack_qty))continue;
  row.review='Die pakgrootte of eenheid het verander. Jou invoer is behou; tik die volle pakke weer in om die nuwe pakgrootte te bevestig.';changedBasis++;
 }
 draft.request=null;
 return changedBasis?'Die pakgrootte het verander. Herbevestig die volle pakke voordat jy stoor.':hasCountChanges(draft)?'Die jongste gestoorde telling is gelaai. Jou ongestoorde veranderings is steeds in die blokkies.':'Die jongste gestoorde hoeveelhede is weer in die blokkies ingevul.';
}
const storageKey=user=>'fenmeat-stocktake-draft-v1:'+user;
export function readCountDraft(storage,user){
 try{
  const saved=JSON.parse(storage.getItem(storageKey(user))??'null');
  if(![1,2].includes(saved?.schema)||!saved.draft||typeof saved.draft!=='object'||!hasCountChanges(saved.draft))return null;
  if(saved.schema===1){
   for(const row of Object.values(saved.draft.rows??{})){row.review='Ongestoorde invoer uit die vorige skerm is behou. Tik die volle pakke weer in; los voorraad word nie oorgedra nie.';}
   // A legacy request may have reached the server. Retain its ID for reload
   // acknowledgement only, never resend its obsolete body.
   saved.draft.legacy_request_id=saved.draft.request?.request_id;saved.draft.request=null;
  }
  return saved.draft;
 }catch{return null;}
}
export function writeCountDraft(storage,user,draft){
 try{if(!hasCountChanges(draft))storage.removeItem(storageKey(user));else storage.setItem(storageKey(user),JSON.stringify({schema:2,draft}));return true;}catch{return false;}
}
