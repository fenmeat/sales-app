import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {today,addDays} from '../src/domain.js';

test('real Worker saves supplier counts privately, rejects stale writes, replays retries and applies documented updates as an explicit audited save',async t=>{
 const origin='https://stocktake-local.example',key='synthetic-stocktake-key-01234567890123456789';
 const mf=new Miniflare(convertV4MiniflareOptions({name:'stocktake-test',modules:['worker','staff-api','payroll-api','payroll-domain','staff-domain','staff-import','staff-history','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching','zoho-reconcile'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',d1Databases:{DB:'stocktake-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key}),APP_STAFF_ACCESS_KEYS:JSON.stringify({xavier:'synthetic-staff-stocktake-key-0123456789'})},outboundService:()=>{throw Error('No outbound calls in stocktake tests');}}));t.after(()=>mf.dispose());let cookie='';
 async function call(path,body,extra={}){const response=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),headers:response.headers};}
 assert.equal((await call('/api/recipes/margot-packs')).status,401);assert.equal((await call('/api/stocktake')).status,401);assert.equal((await call('/api/recipes/documented-update')).status,401);
 cookie=(await call('/api/login',{username:'alex',key})).headers.get('set-cookie').split(';')[0];
 const material=(id,unit,supplier,pack_qty)=>({id,name:id,unit,supplier,pack_qty,procure:true,source:'Test',notes:'',price:{amount:null,status:'unknown',date:null,valid_until:null,source:''},stock:{qty:null,date:null,reserve:null,incoming:[],source:''}});
 const register={schema_version:1,notes:'Synthetic',materials:[material('RM65','unit','Margot Swiss',25),material('RAW','kg','Crown',20),{...material('RM83','unit','Margot Swiss',null),name:'Bandsaw Blades'},{...material('RM48','kg','Margot Swiss',null),name:'Brown Vinegar'}],packaging:[],recipes:[{group:'W07',version:1,name:'Synthetic patties',effective_date:'2026-10-01',status:'approved',complete:false,batch_kg:59,ingredients:[{material:'RAW',qty:59,unit:'kg',status:'approved',note:''}],consumables:[],source:'Synthetic recipe',notes:''}]};
 assert.equal((await call('/api/recipes',{register,revision:0,request_id:crypto.randomUUID(),reason:'Synthetic stocktake fixture'})).status,200);
 const before=structuredClone(register),date=today(),body={revision:1,request_id:crypto.randomUUID(),supplier:'margot swiss',date,available_from:addDays(date,3),availability_confirmed:true,rows:[{material:'RM65',packs:2,loose:0,reserve:3}]};
 assert.equal((await call('/api/stocktake',body,{Origin:'https://different.example'})).status,403);
 for(const invalid of [{loose:3},{packs:1.5},{packs:null},{packs:-1},{packs:'2'}]){
  const rejected=await call('/api/stocktake',{...body,request_id:crypto.randomUUID(),rows:[{...body.rows[0],...invalid}]});
  assert.equal(rejected.status,400,JSON.stringify(rejected.data));
  const unchanged=(await call('/api/stocktake')).data;assert.equal(unchanged.revision,1);assert.equal(unchanged.register.materials[0].stock.qty,null);
 }
 const first=await call('/api/stocktake',body);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.revision,2);assert.equal(first.data.counted,1);assert.equal(first.data.register.materials[0].stock.qty,50);assert.equal(first.data.current_user,'alex');assert.equal(first.data.request_id,body.request_id);
 const replay=await call('/api/stocktake',body);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.revision,2);assert.deepEqual(replay.data.register,first.data.register);
 assert.equal((await call('/api/stocktake',{...body,rows:[{...body.rows[0],loose:4}]})).status,409);
 assert.equal((await call('/api/stocktake',{...body,request_id:crypto.randomUUID()})).status,409);
 cookie=(await call('/api/login',{username:'alex',key})).headers.get('set-cookie').split(';')[0];
 let saved=(await call('/api/stocktake')).data;assert.equal(saved.current_user,'alex');assert.equal(saved.request_id,body.request_id);assert.equal(saved.revision,2);assert.equal(saved.register.materials[0].stock.qty,50);assert.equal(saved.register.materials[0].stock.date,date);assert.equal(saved.register.materials[0].stock.available_from,addDays(date,3));assert.equal(saved.register.materials[0].stock.reserve,3);assert.deepEqual(saved.register.materials[1],before.materials[1]);assert.deepEqual(saved.register.recipes,before.recipes);
 assert.equal((await call('/api/stocktake',{...body,revision:2,request_id:crypto.randomUUID(),rows:[{material:'RAW',packs:1,loose:0,reserve:0}]})).status,400);
 const preview=await call('/api/recipes/documented-update');assert.equal(preview.status,200);assert(preview.data.changes.length>0);assert.equal((await call('/api/recipes')).data.revision,2);
 const correction={revision:2,request_id:crypto.randomUUID()};const update=await call('/api/recipes/documented-update',correction);assert.equal(update.status,200,JSON.stringify(update.data));assert.equal(update.data.revision,3);
 assert.equal((await call('/api/recipes/documented-update',correction)).data.replayed,true);
 saved=(await call('/api/recipes')).data;assert.equal(saved.register.recipes.length,2);assert.deepEqual(saved.register.recipes[0],before.recipes[0]);assert.equal(saved.register.recipes[1].forecast_yields[0].qty,29.5);assert.equal(saved.register.materials[0].stock.qty,50);assert.equal((await call('/api/recipes/documented-update')).data.applied,true);
 const audit=(await call('/api/recipes/audit')).data.events;assert.equal(audit.length,3);assert(audit.some(e=>e.reason.includes('Supplier stocktake: Margot Swiss')));assert(audit.every(e=>e.actor==='alex'));
 const beforePacks=structuredClone(saved.register);const packsPreview=await call('/api/recipes/margot-packs');assert.equal(packsPreview.status,200);assert.equal(packsPreview.data.changes.length,2);assert.equal((await call('/api/recipes')).data.revision,3);
 const packsBody={revision:3,request_id:crypto.randomUUID()};assert.equal((await call('/api/recipes/margot-packs',packsBody,{Origin:'https://different.example'})).status,403);
 assert.equal((await call('/api/recipes/margot-packs',{...packsBody,revision:2})).status,409);
 const packsSaved=await call('/api/recipes/margot-packs',packsBody);assert.equal(packsSaved.status,200,JSON.stringify(packsSaved.data));assert.equal(packsSaved.data.revision,4);assert.equal((await call('/api/recipes/margot-packs',packsBody)).data.replayed,true);
 saved=(await call('/api/recipes')).data;assert.equal(saved.register.materials.find(m=>m.id==='RM48').pack_qty,5);assert.equal(saved.register.materials.find(m=>m.id==='RM83').minimum_stock,2);
 assert.deepEqual(saved.register.materials.map(m=>m.stock),beforePacks.materials.map(m=>m.stock));assert.deepEqual(saved.register.recipes,beforePacks.recipes);assert.equal((await call('/api/recipes/margot-packs')).data.applied,true);
 const restore=(await call('/api/stocktake')).data;const spare=restore.register.materials.find(m=>m.id==='RM83');assert.equal(spare.minimum_stock,2);
 const savedSpare=await call('/api/stocktake',{revision:restore.revision,request_id:crypto.randomUUID(),supplier:'margot swiss',date,available_from:addDays(date,3),availability_confirmed:true,rows:[{material:'RM83',packs:1,loose:0,reserve:0}]});assert.equal(savedSpare.status,200);
 const report=(await call('/api/order-guy?from='+addDays(date,3)+'&to='+addDays(date,3))).data;const ordered=report.rows.find(r=>r.material==='RM83');assert.equal(ordered.stock.qty,1);assert.equal(ordered.inventory_ready,true);assert.equal(ordered.order_packs,1);
 const wrongDate=(await call('/api/order-guy?from='+date+'&to='+date)).data.rows.find(r=>r.material==='RM83');assert.equal(wrongDate.stock.qty,1);assert.equal(wrongDate.inventory_ready,false);assert.match(wrongDate.inventory_reason,/telling is gestoor/);
 const db=await mf.getD1Database('DB');assert.equal((await db.prepare('SELECT count(*) n FROM v2_production_events').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM v2_events').first()).n,0);
 cookie=(await call('/api/login',{username:'xavier',key:'synthetic-staff-stocktake-key-0123456789'})).headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/stocktake')).status,200);assert.equal((await call('/api/stocktake',{...body,revision:3,request_id:crypto.randomUUID()})).status,409);assert.equal((await call('/api/recipes/documented-update')).status,403);assert.equal((await call('/api/recipes/margot-packs')).status,403);assert.equal((await call('/api/recipes/margot-packs',{revision:4,request_id:crypto.randomUUID()})).status,403);
});

test('Brito resale entries appear automatically, save alongside MDM and persist across reads without mutating on GET',async t=>{
 const origin='https://britos-local.example',key='synthetic-britos-test-key-01234567890123456789';
 const mf=new Miniflare(convertV4MiniflareOptions({name:'britos-test',modules:['worker','staff-api','payroll-api','payroll-domain','staff-domain','staff-import','staff-history','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching','zoho-reconcile'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',d1Databases:{DB:'britos-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key})},outboundService:()=>{throw Error('No outbound calls');}}));t.after(()=>mf.dispose());let cookie='';
 async function call(path,body){const response=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return {data,headers:response.headers};}
 cookie=(await call('/api/login',{username:'alex',key})).headers.get('set-cookie').split(';')[0];
 const db=await mf.getD1Database('DB'),date=today();
 const mdm={id:'RM01',name:'Test MDM',unit:'kg',supplier:"Brito's",pack_qty:20,procure:true,notes:'',source:'Synthetic source',price:{amount:null,status:'unknown',date:null,valid_until:null,source:''},stock:{qty:3600,date,reserve:0,source:'Synthetic prior count',incoming:[]}};
 await call('/api/recipes',{register:{schema_version:1,materials:[mdm],recipes:[],packaging:[],notes:''},revision:0,reason:'Synthetic prior MDM count',request_id:crypto.randomUUID()});
 await call('/api/catalog',{revision:0,catalog:{products:['B01','B03','B06'].map(code=>({code,name:code,unit:'sales unit',price_cents:100,active:true,available:true})),routes:[{code:'TEST',name:'Test',weekday:2}]}});
 const read=(await call('/api/recipes')).data;assert.equal(read.revision,1);assert.equal(read.register.materials.length,4);assert.deepEqual(read.register.materials[0],mdm);
 assert.equal((await db.prepare('SELECT count(*) n FROM v2_recipe_events').first()).n,1);
 const b={revision:read.revision,request_id:crypto.randomUUID(),supplier:"brito's",date,available_from:date,rows:[{material:'BUY_B01',packs:9,loose:0,reserve:0},{material:'BUY_B03',packs:2,loose:0,reserve:0},{material:'BUY_B06',packs:0,loose:null,reserve:0}]};
 const save=(await call('/api/stocktake',b)).data;assert.equal(save.revision,2);assert.equal(save.counted,3);
 assert.equal((await call('/api/stocktake',b)).data.replayed,true);
 cookie=(await call('/api/login',{username:'alex',key})).headers.get('set-cookie').split(';')[0];
 const reload=(await call('/api/stocktake')).data;assert.equal(reload.revision,2);assert.deepEqual(reload.register,save.register);
 assert.deepEqual(reload.register.materials[0],mdm);assert.equal(reload.register.materials.find(m=>m.id==='BUY_B03').stock.qty,16);assert.equal(reload.register.materials.find(m=>m.id==='BUY_B06').stock.qty,0);
 const persisted=JSON.parse((await db.prepare('SELECT payload FROM v2_recipe_events WHERE revision=2').first()).payload);assert.deepEqual(persisted,reload.register);
 assert.equal((await db.prepare('SELECT count(*) n FROM v2_events').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM v2_production_events').first()).n,0);
});


test('Xavier and Xalinda save and reload only stock, keep audit identities and cannot edit manager data',async t=>{
 const origin='https://staff-stock.example';
 const names=['alex','alinda','xavier','xalinda','other'];
 const access=Object.fromEntries(names.map(name=>[name,('synthetic-'+name+'-stocktake-only-').padEnd(64,'x')]));
 const mf=new Miniflare(convertV4MiniflareOptions({name:'staff-stock-test',modules:['worker','staff-api','payroll-api','payroll-domain','staff-domain','staff-import','staff-history','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching','zoho-reconcile'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',d1Databases:{DB:'staff-stock-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(access)},outboundService:()=>{throw Error('No outbound calls');}}));
 t.after(()=>mf.dispose());
 const call=async(path,{body,cookie='',originHeader=origin}={})=>{const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:originHeader,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};};
 const login=async name=>(await call('/api/login',{body:{username:name,key:access[name]}})).headers.get('set-cookie').split(';')[0];
 const cookies=Object.fromEntries(await Promise.all(names.map(async name=>[name,await login(name)])));
 const date=today(),material={id:'RAW',name:'Synthetic stock material',unit:'kg',supplier:'Test supplier',pack_qty:20,procure:true,source:'Private cost evidence',notes:'Manager note',price:{amount:99,status:'verified',date,valid_until:null,source:'Private price'},stock:{qty:null,date:null,reserve:0,incoming:[],source:''}};
 const register={schema_version:1,notes:'Private register notes',materials:[material],packaging:[],recipes:[]};
 const seeded=await call('/api/recipes',{cookie:cookies.alex,body:{register,revision:0,request_id:crypto.randomUUID(),reason:'Synthetic staff stock fixture'}});assert.equal(seeded.status,200,JSON.stringify(seeded.data));
 const privateBefore=(await call('/api/recipes',{cookie:cookies.alinda})).data.register;
 assert.equal((await call('/api/stocktake')).status,401);
 assert.equal((await call('/api/stocktake',{cookie:cookies.other})).status,403);
 let revision=1,previousRequest;
 const assertRestricted=data=>{
  assert.equal(data.stocktake_only,true);assert.equal(data.costs,undefined);assert.deepEqual(data.register.recipes,[]);assert.deepEqual(data.register.packaging,[]);
  assert.equal(data.register.notes,undefined);assert.equal(data.register.materials[0].price,undefined);assert.equal(data.register.materials[0].source,undefined);assert.equal(data.register.materials[0].notes,undefined);
 };
 for(const [index,name] of ['xavier','xalinda'].entries()){
  const cookie=cookies[name],read=await call('/api/stocktake',{cookie});assert.equal(read.status,200);assert.equal(read.data.current_user,name);assertRestricted(read.data);
  for(const path of ['/api/recipes','/api/recipes/audit','/api/import/recipes','/api/recipes/documented-update','/api/recipes/margot-packs','/api/order-guy','/api/sync/order-guy']){
   assert.equal((await call(path,{cookie})).status,403,path);
   assert.equal((await call(path,{cookie,body:{register,revision,request_id:crypto.randomUUID(),reason:'Attempt outside stock scope'}})).status,403,path);
  }
  assert.equal((await call('/api/products/availability',{cookie,body:{revision:0,code:'RAW',available:false}})).status,403);
  if(previousRequest)assert.equal((await call('/api/stocktake',{cookie,body:previousRequest})).status,409,'another user cannot replay the previous user save');
  const body={revision,request_id:crypto.randomUUID(),supplier:'test supplier',date,rows:[{material:'RAW',packs:index+2,loose:0,reserve:0}],register:{...register,materials:[]}};
  assert.equal((await call('/api/stocktake',{cookie,body,originHeader:'https://other.example'})).status,403);
  const saved=await call('/api/stocktake',{cookie,body});assert.equal(saved.status,200,JSON.stringify(saved.data));revision++;
  assert.equal(saved.data.revision,revision);assert.equal(saved.data.actor,name);assertRestricted(saved.data);assert.equal(saved.data.register.materials[0].stock.qty,(index+2)*20);assert.match(saved.data.register.materials[0].stock.source,new RegExp(name));
  const retry=await call('/api/stocktake',{cookie,body});assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);assertRestricted(retry.data);
  assert.equal((await call('/api/stocktake',{cookie,body:{...body,request_id:crypto.randomUUID()}})).status,409);
  const freshCookie=await login(name),reloaded=await call('/api/stocktake',{cookie:freshCookie});assert.equal(reloaded.status,200);assert.equal(reloaded.data.revision,revision);assert.equal(reloaded.data.register.materials[0].stock.qty,(index+2)*20);assertRestricted(reloaded.data);
  previousRequest=body;
 }
 for(const name of ['alex','alinda']){
  const read=(await call('/api/stocktake',{cookie:cookies[name]})).data;assert.equal(read.stocktake_only,false);assert.deepEqual(read.register.materials[0].price,privateBefore.materials[0].price);
  assert.deepEqual({...read.register,materials:read.register.materials.map(m=>({...m,stock:privateBefore.materials.find(x=>x.id===m.id).stock}))},privateBefore,'stock saves preserve all other fields');
 }
 const audit=(await call('/api/recipes/audit',{cookie:cookies.alex})).data.events;assert.deepEqual(audit.map(e=>e.actor),['xalinda','xavier','alex']);
 const db=await mf.getD1Database('DB');assert.equal((await db.prepare('SELECT count(*) n FROM v2_events').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM v2_production_events').first()).n,0);
});
