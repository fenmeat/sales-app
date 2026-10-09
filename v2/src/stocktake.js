import {check,dateKey,today,addDays} from './domain.js';

export function supplierKey(value){return String(value??'').trim().toLowerCase().replace(/\s+/g,' ');}
export function supplierGroups(materials){
 const groups=new Map();
 for(const m of materials.filter(m=>m.procure&&m.resale_available!==false)){
  const key=supplierKey(m.supplier),label=m.supplier.trim()||'Supplier not assigned';
  if(!groups.has(key))groups.set(key,{key,name:label,materials:[]});
  const group=groups.get(key);if(label!==label.toUpperCase())group.name=label;group.materials.push(m);
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e8;
export function stockQuantity(material,packs,loose){
 check(packs===null||valid(packs),'Enter a non-negative pack count.');
 check(loose===null||valid(loose),'Enter a non-negative loose quantity.');
 check(packs!==null||loose!==null,'Enter a count, including 0 when there is none.');
 check(!packs||(material.pack_qty>0),'This purchase pack size is unknown. Count in the displayed material unit.');
 const total=(packs??0)*(material.pack_qty??0)+(loose??0);
 check(valid(total),'Stock quantity is too large.');return Math.round(total*1e6)/1e6;
}
export function applySupplierCount(register,input,actor,asOf=today()){
 const date=dateKey(input.date),availableFrom=dateKey(input.available_from??date);
 check(date<=asOf,'Die fisiese teldatum is in die toekoms. Kies die dag waarop jy werklik getel het; vandag is '+asOf+'.');
 check(availableFrom>=date&&availableFrom<=addDays(date,31),'Die beskikbaarheidsdatum moet op of ná die teldatum en binne 31 dae daarvan wees.');
 check(availableFrom===date||input.availability_confirmed===true,'Bevestig dat die getelde voorraad, ná enige verbruik of voorraad wat jy uitsit, op die gekose produksiedatum beskikbaar sal wees.');
 check(typeof input.supplier==='string','Choose a supplier.');
 const group=supplierGroups(register.materials).find(g=>g.key===input.supplier);check(group,'Supplier not found.');
 check(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=500,'Enter at least one count.');
 check(new Set(input.rows.map(r=>r.material)).size===input.rows.length,'A material can only be counted once.');
 const next=structuredClone(register);
 for(const row of input.rows){
  const m=next.materials.find(m=>m.id===row.material);check(m&&m.procure&&supplierKey(m.supplier)===group.key,'A count belongs to a different supplier.');
  check(!m.stock.date||date>=m.stock.date,'A newer count already exists for '+m.name+'. Reload the latest stock.');
  const qty=stockQuantity(m,row.packs,row.loose);
  check(valid(row.reserve)&&row.reserve<=qty,'Stock kept aside must be between zero and the counted total for '+m.name+'.');
  const received=row.included_incoming??[];
  check(Array.isArray(received)&&received.length<=100&&new Set(received).size===received.length&&received.every(ref=>m.stock.incoming.some(x=>x.reference===ref)),'Choose existing deliveries that are already included in this physical count.');
  m.stock={...m.stock,qty,date,reserve:row.reserve,incoming:m.stock.incoming.filter(x=>!received.includes(x.reference)),available_from:availableFrom,availability_confirmed:availableFrom===date||input.availability_confirmed===true,source:'Physical count by '+actor+' for '+group.name+' on '+date, count:{packs:row.packs,loose:row.loose,pack_qty:m.pack_qty,unit:m.unit,included_incoming:received}};
 }
 return {register:next,counted:input.rows.length,supplier:group.name};
}
