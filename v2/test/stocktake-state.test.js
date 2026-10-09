import test from 'node:test';
import assert from 'node:assert/strict';
import {savedCountRow,initialiseCountDraft,prepareCountRequest,reconcileCountDraft,readCountDraft,writeCountDraft,hasCountChanges} from '../public/stocktake-state.js';
import {applySupplierCount} from '../src/stocktake.js';
import {today,addDays} from '../src/domain.js';

const material=(id,qty=null)=>({id,name:id,unit:'unit',supplier:'Margot Swiss',procure:true,pack_qty:25,stock:{qty,date:qty===null?null:today(),reserve:0,incoming:[],source:qty===null?'':'Physical count',available_from:today()}});
const result=()=>({revision:4,current_user:'alex',register:{materials:[material('M1'),material('M2',0)],recipes:[],packaging:[]}});
test('a saved count reopens with its actual packs and loose units, including zero and changed pack sizes',()=>{
 const r=result(),d={supplier:'margot swiss'};initialiseCountDraft(r.register,d);d.rows.M1={...savedCountRow(r.register.materials[0]),packs:'2',loose:'3'};
 const body=prepareCountRequest(r,d),saved=applySupplierCount(r.register,body,'alex').register,m=saved.materials[0];
 assert.equal(m.stock.qty,53);assert.deepEqual([savedCountRow(m).packs,savedCountRow(m).loose],[2,3]);
 assert.equal(savedCountRow(saved.materials[1]).loose,'0');assert.equal(savedCountRow(r.register.materials[0]).loose,'');
 m.pack_qty=50;assert.equal(savedCountRow(m).packs,'');assert.equal(savedCountRow(m).loose,'53');
});
test('reload preserves unsaved edits, converts their old pack basis once and recognises an acknowledged timed-out save',()=>{
 const r=result(),d={supplier:'margot swiss',rows:{M1:{...savedCountRow(r.register.materials[0]),packs:'2',loose:'3'}},request:{request_id:'original-request'}};
 r.register.materials[0].pack_qty=50;reconcileCountDraft(r,d);assert.equal(d.rows.M1.packs,'');assert.equal(d.rows.M1.loose,'53');assert(hasCountChanges(d));
 initialiseCountDraft(r.register,d);assert.equal(prepareCountRequest(r,d).rows[0].loose,53);
 d.request={request_id:'saved-request'};r.request_id='saved-request';reconcileCountDraft(r,d);assert.equal(hasCountChanges(d),false);assert.equal(d.request,null);
});
test('availability can be corrected using existing saved quantities without retyping or silently changing other suppliers',()=>{
 const r=result();r.register.materials[0]=material('M1',53);r.register.materials.push({...material('OTHER',7),supplier:'Crown'});
 const d={supplier:'margot swiss'};initialiseCountDraft(r.register,d);d.available_from=addDays(today(),3);d.confirmed=true;d.metaDirty=true;
 const body=prepareCountRequest(r,d);assert.equal(body.rows.length,2);assert.equal(body.rows[0].loose,53);assert.equal(body.rows[1].loose,0);
 const saved=applySupplierCount(r.register,body,'alex').register;assert.equal(saved.materials[0].stock.available_from,d.available_from);assert.deepEqual(saved.materials[2],r.register.materials[2]);
 const reopened={supplier:'margot swiss'};initialiseCountDraft(saved,reopened);assert.equal(reopened.available_from,d.available_from);assert.equal(reopened.confirmed,true);
 d.date=addDays(today(),1);assert.throws(()=>prepareCountRequest(r,d),/toekoms/);
});
test('pending input survives a page reload, is scoped to its signed-in owner, and clears only after acknowledgement',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const d={supplier:'margot swiss',rows:{M1:{packs:'2',loose:'3',reserve:0,pack_qty:25,unit:'unit'}},request:{request_id:'pending-save'}};
 assert(writeCountDraft(storage,'alex',d));assert.deepEqual(readCountDraft(storage,'alex'),d);assert.equal(readCountDraft(storage,'alinda'),null);
 const reopened=readCountDraft(storage,'alex');assert.equal(reopened.request.request_id,'pending-save');
 reconcileCountDraft({...result(),request_id:'pending-save'},reopened);writeCountDraft(storage,'alex',reopened);assert.equal(readCountDraft(storage,'alex'),null);
 assert.equal(writeCountDraft({setItem(){throw Error('Storage unavailable');}},'alex',d),false);
});
