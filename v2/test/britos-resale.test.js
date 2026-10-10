import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRegister,validateRegister,withResaleMaterials,orderGuyReport} from '../src/order-guy.js';
import {applySupplierCount,supplierGroups} from '../src/stocktake.js';
import {buildProductionPlan,productionProfile} from '../src/production.js';

const date='2026-10-12';
const catalog={products:['B01','B03','B06'].map(code=>({code,name:code,unit:'sales unit',active:true,available:true})),routes:[{code:'TEST',name:'Test',weekday:2}]};
const register=()=>withResaleMaterials(emptyRegister(),catalog);
function plan(demands){return buildProductionPlan({date,target_date:'2026-10-13',routes:['TEST'],items:catalog.products.map(p=>({...p,...productionProfile(p),demand:demands[p.code],breakdown:[]})),snapshot:'test'});}
function report(reg,p,extra={}){return orderGuyReport({register:reg,registry_revision:1,plans:[],forecast_days:[{date,status:'forecast',plan:p}],from:date,to:date,catalog,asOf:date,...extra});}

test('Brito resale counts use boxes and eight-pack bales; unknown counts and other stock are preserved',()=>{
 const reg=register();assert.doesNotThrow(()=>validateRegister(reg));assert.equal(reg.materials.length,3);
 assert(reg.materials.every(m=>m.stock.qty===null&&m.price.amount===null));
 assert.deepEqual(withResaleMaterials(reg,catalog),reg);
 const counted=applySupplierCount(reg,{supplier:"brito's",date,rows:[{material:'BUY_B01',packs:10,loose:0,reserve:0},{material:'BUY_B03',packs:2,loose:3,reserve:0},{material:'BUY_B06',packs:0,loose:null,reserve:0}]},'alex',date).register;
 assert.equal(counted.materials.find(m=>m.id==='BUY_B03').stock.qty,19);
 assert.equal(counted.materials.find(m=>m.id==='BUY_B01').stock.qty,10);
 assert.equal(counted.materials.find(m=>m.id==='BUY_B06').stock.qty,0);
 assert.deepEqual(withResaleMaterials(counted,catalog),counted);
 const inactive=structuredClone(catalog);inactive.products[0].available=false;
 const hidden=withResaleMaterials(counted,inactive);
 assert.equal(hidden.materials.find(m=>m.id==='BUY_B01').stock.qty,10);
 assert(!supplierGroups(hidden.materials)[0].materials.some(m=>m.id==='BUY_B01'));
 assert.equal(report(hidden,plan({B01:20,B03:20,B06:0}),{catalog:inactive}).rows.some(r=>r.material==='BUY_B01'),false);
});

test('resale forecast nets stock once and rounds pork bales once without manufacturing ingredients or extra reserve',()=>{
 const reg=register();for(const m of reg.materials)Object.assign(m.stock,{qty:m.id==='BUY_B03'?19:2,date,reserve:0,source:'Synthetic physical count'});
 const r=report(reg,plan({B01:10,B03:28,B06:5}));
 const pork=r.rows.find(r=>r.material==='BUY_B03');assert.equal(pork.gross,28);assert.equal(pork.net,9);assert.equal(pork.order_packs,2);assert.equal(pork.early_month_reserve,0);
 assert.equal(r.rows.find(r=>r.material==='BUY_B01').order_packs,8);assert.equal(r.rows.find(r=>r.material==='BUY_B06').order_packs,3);
 assert.equal(r.requirements.length,0);assert.equal(r.unmapped_requirements,false);
 assert(r.rows.every(r=>r.price===null));assert.equal(r.warnings.length,0);
});

test('resale gross route demand avoids netting confirmed buy/repack decisions twice; unknown dates and demand block only affected lines',()=>{
 const reg=register();for(const m of reg.materials)Object.assign(m.stock,{qty:5,date,reserve:0,source:'Synthetic count'});
 const p=plan({B01:12,B03:0,B06:null});p.phase='confirmed';
 for(const i of p.items)i.stock=5;for(const g of p.groups)g.planned=g.id==='B01'?7:0;
 let r=report(reg,p,{plans:[{plan:p,revision:1,stale:false}],forecast_days:[]});
 assert.equal(r.rows.find(r=>r.material==='BUY_B01').net,7);assert.equal(r.rows.find(r=>r.material==='BUY_B06').net,null);
 assert.equal(r.rows.find(r=>r.material==='BUY_B03').order_packs,0);
 r=report(reg,p,{to:'2026-10-13'});assert(r.rows.every(r=>r.net===null));
 const missingRaw=structuredClone(p);missingRaw.phase='draft';missingRaw.items.push({code:'W01',name:'Test raw recipe',...productionProfile({code:'W01',name:'Test raw recipe'}),demand:10});missingRaw.groups.push({id:'W01',mode:'batch',planned:null});
 r=report(reg,missingRaw);assert.equal(r.unmapped_requirements,true);assert.equal(r.rows.find(r=>r.material==='BUY_B01').net,7);
});


test('an active resale item missing from an older plan is unknown rather than zero',()=>{
 const reg=register();for(const m of reg.materials)Object.assign(m.stock,{qty:0,date,reserve:0,source:'Test count'});
 const p=plan({B01:1,B03:2,B06:3});p.items=p.items.filter(i=>i.code!=='B06');p.groups=p.groups.filter(g=>g.id!=='B06');
 const r=report(reg,p);assert.equal(r.rows.find(r=>r.material==='BUY_B06').net,null);assert.equal(r.rows.find(r=>r.material==='BUY_B01').net,1);
});
