import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierGroups,stockQuantity,applySupplierCount} from '../src/stocktake.js';
import {documentedCorrections,DOCUMENTED_UPDATE,margotPackCorrections,MARGOT_PACK_UPDATE} from '../src/register-corrections.js';
import {emptyRegister,validateRegister,orderGuyReport} from '../src/order-guy.js';
import {buildProductionPlan,productionProfile} from '../src/production.js';

const date='2026-10-09';
const material=(id,unit='unit',supplier='Margot Swiss',pack_qty=25)=>({id,name:id,unit,supplier,pack_qty,procure:true,source:'Test',notes:'',price:{amount:null,status:'unknown',date:null,valid_until:null,source:''},stock:{qty:null,date:null,reserve:null,incoming:[],source:''}});
function register(){return {...emptyRegister(),materials:[material('M1'),material('M2','unit','MARGOT SWISS',null),material('OTHER','kg','Crown',2)]};}
const count=()=>({supplier:'margot swiss',date,available_from:date,rows:[{material:'M1',packs:2,loose:3,reserve:5}]});
test('supplier count groups case variants, converts purchase packs once, preserves zero, uncounted materials, prices and incoming',()=>{
 const r=register();r.materials[0].stock.incoming=[{date:'2026-10-12',qty:25,reference:'TEST-PO'}];const before=structuredClone(r);
 assert.equal(supplierGroups(r.materials).length,2);assert.equal(supplierGroups(r.materials).find(g=>g.key==='margot swiss').materials.length,2);
 const c=count();c.rows.push({material:'M2',packs:null,loose:0,reserve:0});const result=applySupplierCount(r,c,'alex',date);
 assert.equal(result.register.materials[0].stock.qty,53);assert.equal(result.register.materials[0].stock.reserve,5);assert.equal(result.register.materials[1].stock.qty,0);assert.equal(result.register.materials[2].stock.qty,null);
 assert.deepEqual(result.register.materials[0].stock.incoming,before.materials[0].stock.incoming);assert.deepEqual(result.register.materials[0].price,before.materials[0].price);assert.deepEqual(r,before);assert.doesNotThrow(()=>validateRegister(result.register));
 assert.equal(stockQuantity(r.materials[2],1.5,.5),3.5);
 c.rows[0].included_incoming=['TEST-PO'];const received=applySupplierCount(r,c,'alex',date).register.materials[0].stock;
 assert.equal(received.qty,53);assert.deepEqual(received.incoming,[]);assert.deepEqual(received.count.included_incoming,['TEST-PO']);
 c.rows[0].included_incoming=['NOT-A-PO'];assert.throws(()=>applySupplierCount(r,c,'alex',date));
});
test('stocktake rejects ambiguous/mismatched counts and cannot relabel a Friday physical count as a Monday count',()=>{
 const r=register();for(const mutate of [c=>c.rows[0].loose=-1,c=>c.rows[0].packs='2',c=>c.rows[0].reserve=54,c=>c.rows[0].material='OTHER',c=>c.rows.push(c.rows[0]),c=>c.date='2026-10-10',c=>c.rows[0].packs=c.rows[0].loose=null,c=>c.rows[0].material='M2']){const c=count();mutate(c);assert.throws(()=>applySupplierCount(r,c,'alex',date));}
 const c=count();c.available_from='2026-10-12';assert.throws(()=>applySupplierCount(r,c,'alex',date));c.availability_confirmed=true;
 const saved=applySupplierCount(r,c,'alex',date).register;assert.equal(saved.materials[0].stock.date,date);assert.equal(saved.materials[0].stock.available_from,'2026-10-12');assert.doesNotThrow(()=>validateRegister(saved));
 saved.materials[0].stock.date='2026-10-10';assert.throws(()=>applySupplierCount(saved,count(),'alex','2026-10-10'));
});
test('Order Guy uses an expressly carried-forward count, allocation and extra reserve once; an unconfirmed earlier count stays unknown',()=>{
 const r=register();const c=count();c.available_from='2026-10-12';c.availability_confirmed=true;
 const reg=applySupplierCount(r,c,'alex',date).register;
 const catalog={products:[{code:'P01',name:'Packing',active:true,available:true,unit:'bag'}],routes:[]};
 reg.packaging=[{product:'P01',complete:true,source:'Test',notes:'',lines:[{material:'M1',qty:10,unit:'unit',status:'approved',note:''}]}];
 const plan=buildProductionPlan({date:'2026-10-12',target_date:'2026-10-13',routes:[],items:[{...catalog.products[0],...productionProfile(catalog.products[0]),demand:5,breakdown:[]}],snapshot:'test'});
 const report=()=>orderGuyReport({register:reg,registry_revision:1,plans:[],forecast_days:[{date:plan.date,status:'forecast',plan}],from:plan.date,to:plan.date,catalog});
 const row=report().rows[0];assert.equal(row.gross,50);assert.equal(row.early_month_reserve,7.5);assert.equal(row.net,9.5);assert.equal(row.order_packs,1);
 delete reg.materials[0].stock.availability_confirmed;assert.equal(report().rows[0].net,null);
});
function correctionFixture(){
 const r={...emptyRegister(),materials:['RM65','RM32','RM69','RM68','RM33','RM35','RM41','RM42','RM40','RM39','RM36','RM66','RM67','RM38','RM71','RM73','MINCE_TRAY','LABELS_UNALLOCATED'].map(id=>material(id,id==='RM73'?'roll':'unit'))};r.materials.push(material('RAW','kg','Crown',20));
 r.recipes=[['W07',59],['POLONY',100]].map(([group,batch_kg])=>({group,name:group,version:1,effective_date:'2026-10-01',status:'approved',batch_kg,complete:false,ingredients:[{material:'RAW',qty:batch_kg,unit:'kg',status:'approved',note:''}],consumables:[],source:'Current approved formula',notes:''}));
 r.packaging=['R01','V01','P02','R08','W07'].map(product=>({product,complete:false,source:'Test',notes:'Only current label count is confirmed.',lines:[{material:'LABELS_UNALLOCATED',qty:product==='R08'?2:product==='W07'?6:11,unit:'unit',status:'review',note:''}]}));return r;
}
test('documented packing and patty allocation preserve ingredients, old versions, stock and prices, and apply only once',()=>{
 const original=correctionFixture(),before=structuredClone(original),result=documentedCorrections(original),r=result.register;assert.equal(result.applied,false);assert(r.applied_updates.includes(DOCUMENTED_UPDATE));assert.doesNotThrow(()=>validateRegister(r));assert.deepEqual(original,before);assert.deepEqual(r.recipes.slice(0,2),before.recipes);
 const p=r.recipes.find(x=>x.group==='W07'&&x.version===2);assert.equal(p.batch_kg,59);assert.equal(p.consumables[0].qty,20);assert.equal(p.forecast_yields[0].qty,29.5);assert.deepEqual(p.ingredients,before.recipes[0].ingredients);
 assert.equal(r.recipes.find(x=>x.group==='POLONY'&&x.version===2).consumables[0].qty,4);
 for(const [code,bag,qty] of [['R01','RM69',10],['V01','RM68',10],['P02','RM35',1],['R08','RM36',1],['W07','RM66',5]])assert.equal(r.packaging.find(x=>x.product===code).lines.find(l=>l.material===bag).qty,qty);
 assert.equal(r.packaging.find(p=>p.product==='R08').lines.reduce((n,l)=>n+(l.material==='RM41'?l.qty:0),0),1);
 assert.deepEqual(documentedCorrections(r).register,r);assert.equal(documentedCorrections(r).applied,true);
 for(let i=0;i<r.materials.length;i++){assert.deepEqual(r.materials[i].stock,before.materials[i].stock);assert.deepEqual(r.materials[i].price,before.materials[i].price);}
 const edited=correctionFixture();edited.packaging[0].lines.push({material:'RM69',qty:7,unit:'unit',status:'approved',note:'Newer owner decision'});const protectedUpdate=documentedCorrections(edited);assert.deepEqual(protectedUpdate.register.packaging[0],edited.packaging[0]);assert(protectedUpdate.skipped.some(x=>x.startsWith('R01:')));
});
test('patty forecast rounds the 59 kg recipe, not 20 full 3 kg rolls; cutting frozen stock needs trays but no new casings',()=>{
 const r=documentedCorrections(correctionFixture()).register;
 const catalog={products:[{code:'W07',name:'Patties',active:true,available:true,unit:'bag'}],routes:[]};
 const plan=buildProductionPlan({date:'2026-10-12',target_date:'2026-10-13',routes:[],items:[{...catalog.products[0],...productionProfile(catalog.products[0]),demand:30,breakdown:[]}],snapshot:'test'});
 const report=(plans=[])=>orderGuyReport({register:r,registry_revision:2,plans,forecast_days:[{date:plan.date,status:'forecast',plan}],from:plan.date,to:plan.date,catalog});
 let result=report();assert.equal(result.requirements[0].batches,2);assert.equal(result.rows.find(x=>x.material==='RAW').gross,118);assert.equal(result.rows.find(x=>x.material==='RM65').gross,40);assert.equal(result.rows.find(x=>x.material==='RM66').gross,150);
 plan.phase='confirmed';Object.assign(plan.groups[0],{planned:0,cut_planned:2,roll_stock:2,disks_per_roll:30});plan.items[0].stock=0;
 result=report([{plan,revision:1,stale:false}]);assert(!result.rows.some(x=>x.material==='RM65'));assert.equal(result.rows.find(x=>x.material==='RM66').gross,15);
});
test('Margot pack update retains saved stock and prices, distinguishes container contents, and uses owner-confirmed vinegar conversion',()=>{
 const items=[['RM82','Apron: Plastic','unit'],['RM91','Toilet Paper','unit'],['RM88','Pine Gel','unit'],['RM48','Brown Vinegar','kg'],['RM83','Bandsaw Blades','unit'],['RM84','DZ400 Ribbon Element 12mm','unit'],['RM85','Teflon Tape 5m Vacuum','unit'],['RM38','Fomo White Oval Labels','unit'],['RM51','Ginger Ground','kg']];
 const r={...emptyRegister(),applied_updates:[DOCUMENTED_UPDATE],materials:items.map(([id,name,unit])=>({...material(id,unit,'Margot Swiss',id==='RM38'?250:null),name}))};
 for(const m of r.materials)m.stock={qty:17,date,reserve:1,incoming:[{qty:3,date:'2026-10-12',reference:'TEST-PO'}],source:'Saved before pack correction',available_from:'2026-10-12',availability_confirmed:true,count:{packs:1,loose:2,pack_qty:15,unit:m.unit}};
 const before=structuredClone(r),update=margotPackCorrections(r),byId=id=>update.register.materials.find(m=>m.id===id);
 assert.equal(update.changes.length,8);assert(update.register.applied_updates.includes(MARGOT_PACK_UPDATE));assert.doesNotThrow(()=>validateRegister(update.register));assert.deepEqual(r,before);
 for(let i=0;i<r.materials.length;i++){assert.deepEqual(update.register.materials[i].stock,before.materials[i].stock);assert.deepEqual(update.register.materials[i].price,before.materials[i].price);}
 assert.equal(stockQuantity(byId('RM82'),2,3),203);assert.equal(stockQuantity(byId('RM91'),2,3),99);assert.equal(stockQuantity(byId('RM88'),2,0),2);assert.match(byId('RM88').pack_spec.label,/5 L/);
 assert.equal(stockQuantity(byId('RM48'),2,3),13);assert.equal(byId('RM83').minimum_stock,2);assert.equal(byId('RM84').pack_qty,1);assert.equal(byId('RM85').pack_qty,1);
 assert.equal(byId('RM38').pack_qty,200);assert.equal(byId('RM38').name,'Fomo White Oval 2 trays');assert.equal(byId('RM51').pack_qty,null);
 assert.deepEqual(margotPackCorrections(update.register).register,update.register);assert.equal(margotPackCorrections(update.register).applied,true);
 const changed=structuredClone(r);changed.materials[0].pack_qty=200;changed.materials[1].supplier='Other supplier';const guarded=margotPackCorrections(changed).register;assert.deepEqual(guarded.materials[0],changed.materials[0]);assert.deepEqual(guarded.materials[1],changed.materials[1]);
});
test('maintenance minimum creates independent order rows, buys only the shortage and applies no extra 15 percent',()=>{
 const r={...emptyRegister(),materials:[0,1,2,3,null].map((qty,i)=>({...material('SPARE'+i,'unit','Margot Swiss',1),minimum_stock:2,stock:{qty,date,reserve:0,incoming:[],source:'Physical count'}}))};
 const report=()=>orderGuyReport({register:r,registry_revision:1,plans:[],forecast_days:[],from:date,to:date,catalog:{products:[],routes:[]}});
 const rows=report().rows;assert.deepEqual(rows.map(x=>x.order_packs),[2,1,0,0,null]);assert(rows.every(x=>x.gross===0&&x.early_month_reserve===0&&x.minimum_only));
 r.materials[0].stock.incoming=[{qty:1,date,reference:'TEST-PO'}];assert.equal(report().rows[0].order_packs,1);
 r.materials[1].stock.reserve=1;assert.equal(report().rows[1].order_packs,1); // A smaller ordinary reserve is not counted twice.
 r.materials[3].stock.reserve=4;assert.equal(report().rows[3].order_packs,1); // A larger existing reserve remains effective.
 r.materials[0].minimum_stock=-1;assert.throws(()=>validateRegister(r));
});
