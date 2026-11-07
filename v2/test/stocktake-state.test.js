import test from 'node:test';
import assert from 'node:assert/strict';
import {savedCountRow,initialiseCountDraft,prepareCountRequest,reconcileCountDraft,readCountDraft,writeCountDraft,hasCountChanges} from '../public/stocktake-state.js';
import {applySupplierCount} from '../src/stocktake.js';
import {today,addDays} from '../src/domain.js';

const material=(id,qty=null)=>({id,name:id,unit:'unit',supplier:'Margot Swiss',procure:true,pack_qty:25,stock:{qty,date:qty===null?null:today(),reserve:0,incoming:[],source:qty===null?'':'Physical count',available_from:today()}});
const result=()=>({revision:4,current_user:'alex',register:{materials:[material('M1'),material('M2',0)],recipes:[],packaging:[]}});
test('whole packs and zero reopen exactly; changed pack sizes require confirmation without rounding',()=>{
 const r=result(),d={supplier:'margot swiss'};initialiseCountDraft(r.register,d);d.rows.M1={...savedCountRow(r.register.materials[0]),packs:'2'};
 const saved=applySupplierCount(r.register,prepareCountRequest(r,d),'alex').register,m=saved.materials[0];
 assert.equal(m.stock.qty,50);assert.equal(savedCountRow(m).packs,2);assert.equal(savedCountRow(m).loose,undefined);assert.equal(m.stock.count.loose,0);
 assert.equal(savedCountRow(saved.materials[1]).packs,0);assert.equal(savedCountRow(r.register.materials[0]).packs,'');
 m.pack_qty=50;assert.equal(savedCountRow(m).packs,'');assert(savedCountRow(m).review);assert.equal(m.stock.qty,50);
});
test('reload retains old-basis draft for reconfirmation and recognises an acknowledged timed-out save',()=>{
 const r=result(),d={supplier:'margot swiss',rows:{M1:{...savedCountRow(r.register.materials[0]),packs:'2'}},request:{request_id:'original-request'}};
 r.register.materials[0].pack_qty=50;reconcileCountDraft(r,d);assert.equal(d.rows.M1.packs,'2');assert.equal(d.rows.M1.pack_qty,25);assert(d.rows.M1.review);assert(hasCountChanges(d));
 initialiseCountDraft(r.register,d);assert.throws(()=>prepareCountRequest(r,d),/pakgrootte/);
 d.request={request_id:'saved-request'};r.request_id='saved-request';reconcileCountDraft(r,d);assert.equal(hasCountChanges(d),false);assert.equal(d.request,null);
});
test('availability changes keep whole-pack counts, skip unconfirmed legacy totals and preserve other suppliers',()=>{
 const r=result();r.register.materials[0]=material('M1',50);r.register.materials.push({...material('OTHER',7),supplier:'Crown'},material('LEGACY',53));
 const d={supplier:'margot swiss'};initialiseCountDraft(r.register,d);d.available_from=addDays(today(),3);d.confirmed=true;d.metaDirty=true;
 const body=prepareCountRequest(r,d);assert.deepEqual(body.rows.map(r=>[r.material,r.packs]),[['M1',2],['M2',0]]);
 const saved=applySupplierCount(r.register,body,'alex').register;assert.equal(saved.materials[0].stock.available_from,d.available_from);assert.deepEqual(saved.materials.slice(2),r.register.materials.slice(2));
 d.date=addDays(today(),1);assert.throws(()=>prepareCountRequest(r,d),/toekoms/);
});
test('mixed historical counts cannot be converted or silently date-confirmed',()=>{
 const r=result(),m=r.register.materials[0];m.stock={...m.stock,qty:30,date:today(),count:{packs:7,loose:9,pack_qty:3,unit:'unit'}};m.pack_qty=3;
 const before=structuredClone(m),row=savedCountRow(m);assert.equal(row.packs,'');assert(row.review);assert.equal(row.loose,undefined);assert.deepEqual(m,before);
 const d={supplier:'margot swiss',metaDirty:true};initialiseCountDraft(r.register,d);assert.deepEqual(prepareCountRequest(r,d).rows.map(r=>r.material),['M2']);
 d.rows.M1={...row,packs:'7'};assert.throws(()=>prepareCountRequest(r,d),/los voorraad/);
 delete d.rows.M1.review;const saved=applySupplierCount(r.register,prepareCountRequest(r,d),'alex').register;assert.equal(saved.materials[0].stock.qty,21);assert.equal(m.stock.qty,30);
});
const storageFixture=()=>{const map=new Map();return {map,storage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};};
test('whole-pack drafts survive reload, stay user-scoped and clear only after acknowledgement',()=>{
 const {storage}=storageFixture(),d={supplier:'margot swiss',rows:{M1:{packs:'2',reserve:0,pack_qty:25,unit:'unit'}},request:{request_id:'pending-save'}};
 assert(writeCountDraft(storage,'alex',d));assert.deepEqual(readCountDraft(storage,'alex'),d);assert.equal(readCountDraft(storage,'alinda'),null);
 const reopened=readCountDraft(storage,'alex');assert.equal(reopened.request.request_id,'pending-save');
 reconcileCountDraft({...result(),request_id:'pending-save'},reopened);writeCountDraft(storage,'alex',reopened);assert.equal(readCountDraft(storage,'alex'),null);
 assert.equal(writeCountDraft({setItem(){throw Error('Storage unavailable');}},'alex',d),false);
});
test('old local drafts retain typed input for review but cannot replay loose-stock requests',()=>{
 const {storage,map}=storageFixture(),old={supplier:'margot swiss',rows:{M1:{packs:'2',loose:'3',reserve:0,pack_qty:25,unit:'unit'}},request:{request_id:'old-save',rows:[{packs:2,loose:3}]}};
 map.set('fenmeat-stocktake-draft-v1:alex',JSON.stringify({schema:1,draft:old}));
 const d=readCountDraft(storage,'alex');assert.equal(d.rows.M1.packs,'2');assert.equal(d.rows.M1.loose,'3');assert(d.rows.M1.review);assert.equal(d.request,null);assert.equal(d.legacy_request_id,'old-save');
 initialiseCountDraft(result().register,d);assert.throws(()=>prepareCountRequest(result(),d),/vorige skerm/);
 reconcileCountDraft({...result(),request_id:'old-save'},d);assert.equal(hasCountChanges(d),false);
});
