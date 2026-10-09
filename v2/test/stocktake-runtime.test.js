import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {today,addDays} from '../src/domain.js';

test('real Worker saves supplier counts privately, rejects stale writes, replays retries and applies documented updates as an explicit audited save',async t=>{
 const origin='https://stocktake-local.example',key='synthetic-stocktake-key-01234567890123456789';
 const mf=new Miniflare(convertV4MiniflareOptions({name:'stocktake-test',modules:['worker','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',d1Databases:{DB:'stocktake-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key}),APP_STAFF_ACCESS_KEYS:JSON.stringify({xavier:'synthetic-staff-stocktake-key-0123456789'})},outboundService:()=>{throw Error('No outbound calls in stocktake tests');}}));t.after(()=>mf.dispose());let cookie='';
 async function call(path,body,extra={}){const response=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),headers:response.headers};}
 assert.equal((await call('/api/recipes/margot-packs')).status,401);assert.equal((await call('/api/stocktake')).status,401);assert.equal((await call('/api/recipes/documented-update')).status,401);
 cookie=(await call('/api/login',{username:'alex',key})).headers.get('set-cookie').split(';')[0];
 const material=(id,unit,supplier,pack_qty)=>({id,name:id,unit,supplier,pack_qty,procure:true,source:'Test',notes:'',price:{amount:null,status:'unknown',date:null,valid_until:null,source:''},stock:{qty:null,date:null,reserve:null,incoming:[],source:''}});
 const register={schema_version:1,notes:'Synthetic',materials:[material('RM65','unit','Margot Swiss',25),material('RAW','kg','Crown',20),{...material('RM83','unit','Margot Swiss',null),name:'Bandsaw Blades'},{...material('RM48','kg','Margot Swiss',null),name:'Brown Vinegar'}],packaging:[],recipes:[{group:'W07',version:1,name:'Synthetic patties',effective_date:'2026-10-01',status:'approved',complete:false,batch_kg:59,ingredients:[{material:'RAW',qty:59,unit:'kg',status:'approved',note:''}],consumables:[],source:'Synthetic recipe',notes:''}]};
 assert.equal((await call('/api/recipes',{register,revision:0,request_id:crypto.randomUUID(),reason:'Synthetic stocktake fixture'})).status,200);
 const before=structuredClone(register),date=today(),body={revision:1,request_id:crypto.randomUUID(),supplier:'margot swiss',date,available_from:addDays(date,3),availability_confirmed:true,rows:[{material:'RM65',packs:2,loose:3,reserve:3}]};
 assert.equal((await call('/api/stocktake',body,{Origin:'https://different.example'})).status,403);
 const first=await call('/api/stocktake',body);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.revision,2);assert.equal(first.data.counted,1);
 const replay=await call('/api/stocktake',body);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.revision,2);
 assert.equal((await call('/api/stocktake',{...body,rows:[{...body.rows[0],loose:4}]})).status,409);
 assert.equal((await call('/api/stocktake',{...body,request_id:crypto.randomUUID()})).status,409);
 let saved=(await call('/api/stocktake')).data;assert.equal(saved.revision,2);assert.equal(saved.register.materials[0].stock.qty,53);assert.equal(saved.register.materials[0].stock.date,date);assert.equal(saved.register.materials[0].stock.available_from,addDays(date,3));assert.equal(saved.register.materials[0].stock.reserve,3);assert.deepEqual(saved.register.materials[1],before.materials[1]);assert.deepEqual(saved.register.recipes,before.recipes);
 assert.equal((await call('/api/stocktake',{...body,revision:2,request_id:crypto.randomUUID(),rows:[{material:'RAW',packs:1,loose:0,reserve:0}]})).status,400);
 const preview=await call('/api/recipes/documented-update');assert.equal(preview.status,200);assert(preview.data.changes.length>0);assert.equal((await call('/api/recipes')).data.revision,2);
 const correction={revision:2,request_id:crypto.randomUUID()};const update=await call('/api/recipes/documented-update',correction);assert.equal(update.status,200,JSON.stringify(update.data));assert.equal(update.data.revision,3);
 assert.equal((await call('/api/recipes/documented-update',correction)).data.replayed,true);
 saved=(await call('/api/recipes')).data;assert.equal(saved.register.recipes.length,2);assert.deepEqual(saved.register.recipes[0],before.recipes[0]);assert.equal(saved.register.recipes[1].forecast_yields[0].qty,29.5);assert.equal(saved.register.materials[0].stock.qty,53);assert.equal((await call('/api/recipes/documented-update')).data.applied,true);
 const audit=(await call('/api/recipes/audit')).data.events;assert.equal(audit.length,3);assert(audit.some(e=>e.reason.includes('Supplier stocktake: Margot Swiss')));assert(audit.every(e=>e.actor==='alex'));
 const beforePacks=structuredClone(saved.register);const packsPreview=await call('/api/recipes/margot-packs');assert.equal(packsPreview.status,200);assert.equal(packsPreview.data.changes.length,2);assert.equal((await call('/api/recipes')).data.revision,3);
 const packsBody={revision:3,request_id:crypto.randomUUID()};assert.equal((await call('/api/recipes/margot-packs',packsBody,{Origin:'https://different.example'})).status,403);
 assert.equal((await call('/api/recipes/margot-packs',{...packsBody,revision:2})).status,409);
 const packsSaved=await call('/api/recipes/margot-packs',packsBody);assert.equal(packsSaved.status,200,JSON.stringify(packsSaved.data));assert.equal(packsSaved.data.revision,4);assert.equal((await call('/api/recipes/margot-packs',packsBody)).data.replayed,true);
 saved=(await call('/api/recipes')).data;assert.equal(saved.register.materials.find(m=>m.id==='RM48').pack_qty,5);assert.equal(saved.register.materials.find(m=>m.id==='RM83').minimum_stock,2);
 assert.deepEqual(saved.register.materials.map(m=>m.stock),beforePacks.materials.map(m=>m.stock));assert.deepEqual(saved.register.recipes,beforePacks.recipes);assert.equal((await call('/api/recipes/margot-packs')).data.applied,true);
 const db=await mf.getD1Database('DB');assert.equal((await db.prepare('SELECT count(*) n FROM v2_production_events').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM v2_events').first()).n,0);
 cookie=(await call('/api/login',{username:'xavier',key:'synthetic-staff-stocktake-key-0123456789'})).headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/stocktake')).status,403);assert.equal((await call('/api/stocktake',{...body,revision:3,request_id:crypto.randomUUID()})).status,403);assert.equal((await call('/api/recipes/documented-update')).status,403);assert.equal((await call('/api/recipes/margot-packs')).status,403);assert.equal((await call('/api/recipes/margot-packs',{revision:4,request_id:crypto.randomUUID()})).status,403);
});
