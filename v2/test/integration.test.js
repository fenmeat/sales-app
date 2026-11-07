import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readdir,readFile} from 'node:fs/promises';import worker from '../src/worker.js';import {emptyRun,CASH_DENOMINATIONS,today,captureItems} from '../src/domain.js';
class D1 {constructor(){this.db=new DatabaseSync(':memory:');}prepare(sql){const db=this.db;let values=[];const stmt={bind(...v){values=v;return stmt;},async first(){return db.prepare(sql).get(...values)??null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:r.changes}};},sql,values:()=>values};return stmt;}async batch(statements){this.db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}}
const key='test-only-local-key-012345678901234567890123456789';const origin='https://test.example';
const catalog={products:[{code:'W01',name:'Braai wors',unit:'bag',price_cents:16000,available:true,active:true}],routes:[{code:'R07',name:'MOSSEL BAY',weekday:4}]};
test('availability switches persist across imports and sessions, protect loads, and filter current production without changing history',async()=>{
 const env={APP_ENV:'test',DB:new D1(),APP_ACCESS_KEYS:JSON.stringify({alex:key,alinda:key+'-alinda',staff:key+'-staff'})};let cookie='';
 async function call(path,body){const r=await worker.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,data:await r.json(),headers:r.headers};}
 async function login(username){const r=await call('/api/login',{username,key:key+(username==='alex'?'':'-'+username)});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];}
 await login('alex');const source={...catalog,products:['W01','C01','C02','C03'].map(code=>({...catalog.products[0],code,name:code}))};
 assert.equal((await call('/api/catalog',{revision:0,catalog:source})).status,200);
 let c=(await call('/api/bootstrap')).data.catalog;assert.deepEqual(c.products.map(p=>p.available),[true,false,false,false]);
 const toggle=(code,available,revision=c.revision)=>call('/api/products/availability',{code,available,revision});
 c=(await toggle('C01',true)).data.catalog;assert.equal(c.revision,2);assert.equal((await toggle('C01',false,1)).status,409);
 const date=today();let run=(await call('/api/run?date='+date+'&route=R07')).data;for(const i of run.run.items){i.planned=12;i.loaded=i.code==='C01'?5:0;i.returned=0;}run.run.cash.card=1234;
 run=(await call('/api/run',{run:run.run,revision:0,action:'save',request_id:crypto.randomUUID()})).data;
 let production=(await call('/api/production?date='+date)).data;for(const i of production.plan.items)i.stock=0;
 production=(await call('/api/production',{plan:production.plan,revision:0,action:'save',request_id:crypto.randomUUID()})).data;
 const oldSales=env.DB.db.prepare('SELECT * FROM v2_events').all(),oldProduction=env.DB.db.prepare('SELECT * FROM v2_production_events').all();
 c=(await toggle('C01',false)).data.catalog;assert.equal(c.products.find(p=>p.code==='C01').availability_updated_by,'alex');
 const persisted=(await call('/api/run?date='+date+'&route=R07')).data;assert.deepEqual(persisted.run,run.run);assert.equal(captureItems(persisted.run,true,c.products).find(p=>p.code==='C01').loaded,5);
 let view=(await call('/api/production?date='+date)).data;assert.equal(view.plan.items.some(p=>p.code==='C01'),true);assert.equal(view.summary.items.some(p=>p.code==='C01'),false);
 assert.deepEqual(env.DB.db.prepare('SELECT * FROM v2_events').all(),oldSales);assert.deepEqual(env.DB.db.prepare('SELECT * FROM v2_production_events').all(),oldProduction);
 const staleLoad=structuredClone(run);staleLoad.run.items.find(i=>i.code==='C01').loaded=6;assert.equal((await call('/api/run',{run:staleLoad.run,revision:run.revision,action:'save',request_id:crypto.randomUUID()})).status,409);
 run.run.items.find(i=>i.code==='C01').returned=2;const returned=await call('/api/run',{run:run.run,revision:run.revision,action:'save',request_id:crypto.randomUUID()});assert.equal(returned.status,200);assert.equal(returned.data.run.cash.card,1234);
 await login('staff');assert.equal((await toggle('C01',true)).status,403);await login('alinda');c=(await toggle('C01',true)).data.catalog;
 view=(await call('/api/production?date='+date)).data;assert.equal(view.summary.items.some(p=>p.code==='C01'),true);
 assert.equal((await call('/api/catalog',{revision:c.revision,catalog:source})).status,200);c=(await call('/api/bootstrap')).data.catalog;assert.equal(c.products.find(p=>p.code==='C01').available,true);assert.equal(c.products.find(p=>p.code==='C01').availability_updated_by,'alinda');
 await login('alex');assert.equal((await call('/api/bootstrap')).data.catalog.products.find(p=>p.code==='C01').available,true);
});
test('all shipped browser modules load through the Worker without signing in',async()=>{
 const publicDir=new URL('../public/',import.meta.url);
 const env={APP_ENV:'test',ASSETS:{async fetch(request){return new Response(await readFile(new URL(new URL(request.url).pathname.slice(1),publicDir)),{headers:{'Content-Type':'application/javascript'}});}}};
 for(const file of (await readdir(publicDir)).filter(file=>file.endsWith('.js'))){
  const response=await worker.fetch(new Request(origin+'/'+file),env);
  assert.equal(response.status,200,file+' must be reachable before login');
  assert.match(response.headers.get('content-type'),/javascript/);
  assert.equal(await response.text(),await readFile(new URL(file,publicDir),'utf8'));
 }
});
test('demo and sample reconciliation are removed without opening protected routes',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/demoApi|state\.demo|Try the demo|sample-recon/);
 assert.match(app,/Personal access key/);
 assert.match(app,/Saved successfully/);
 const response=await worker.fetch(new Request(origin+'/demo.js'),{APP_ENV:'test'});
 assert.equal(response.status,404);
});
test('protected pilot: sign-in, save, idempotency, concurrent edit, reconciliation and close',async()=>{const env={APP_ENV:'test',DB:new D1(),APP_ACCESS_KEYS:JSON.stringify({alex:key})};let cookie='';async function call(path,body,extra={}){const r=await worker.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:body?JSON.stringify(body):undefined}),env);return {r,data:await r.json()};}
 assert.equal((await call('/api/bootstrap')).r.status,401);assert.equal((await call('/api/login',{username:'alex',key:'wrong'})).r.status,401);
 const auth=await call('/api/login',{username:'alex',key});assert.equal(auth.r.status,200);cookie=auth.r.headers.get('set-cookie').split(';')[0];assert.match(auth.r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await call('/api/catalog',{revision:0,catalog})).r.status,200);
 let r=emptyRun('2026-09-30','R07',catalog.products);r.rep='Alex';r.items[0].loaded=20;r.items[0].returned=null;
 const first={run:structuredClone(r),revision:0,action:'load',request_id:crypto.randomUUID()};let saved=await call('/api/run',first);assert.equal(saved.r.status,200,JSON.stringify(saved.data));assert.equal(saved.data.revision,1);
 assert.equal((await call('/api/run',first)).data.replayed,true);
 assert.equal((await call('/api/run',{...first,request_id:crypto.randomUUID()})).r.status,409);
 r=saved.data.run;r.cash.denominations=Object.fromEntries(CASH_DENOMINATIONS.map(d=>[d,0]));r.cash.denominations[20000]=150;r.cash.counted=1;r.items[0].returned=2;let returns=await call('/api/run',{run:r,revision:1,action:'returns',request_id:crypto.randomUUID()});assert.equal(returns.r.status,200);r=returns.data.run;assert.equal(r.cash.counted,3000000);const reloaded=await call('/api/run?date=2026-09-30&route=R07');assert.deepEqual(reloaded.data.run.cash.denominations,r.cash.denominations);assert.equal(reloaded.data.run.cash.counted,3000000);
 r.recon={date:r.date,route:r.route,complete:true,source:'Test invoices and payments',invoice_lines:[{id:'INV1:1',product:'W01',qty:18,status:'sent'}],payments:[{id:'PAY1:1',date:r.date,invoice_date:r.date,method:'cash',cents:3000000}]};Object.assign(r.cash,{counted:3000000,shop2shop:0,card:0,eft:0});
 let closed=await call('/api/run',{run:r,revision:2,action:'close',request_id:crypto.randomUUID()});assert.equal(closed.r.status,200,JSON.stringify(closed.data));assert.equal(closed.data.run.phase,'closed');assert.equal((await call('/api/bootstrap')).data.history.rows,1);
 assert.equal((await call('/api/run',{run:closed.data.run,revision:3,action:'save',request_id:crypto.randomUUID()})).r.status,400);
 r=closed.data.run;r.notes='Reopening to correct returns';let reopened=await call('/api/run',{run:r,revision:3,action:'reopen',request_id:crypto.randomUUID()});assert.equal(reopened.r.status,200);assert.equal((await call('/api/bootstrap')).data.history.rows,0);
 assert.equal((await call('/api/audit?date=2026-09-30&route=R07')).data.events.length,4);
 assert.equal((await call('/api/catalog',{revision:1,catalog},{Origin:'https://evil.example',Authorization:'random'})).r.status,403);
 env.APP_ACCESS_KEYS=JSON.stringify({alex:key+'rotated'});assert.equal((await call('/api/bootstrap')).r.status,401);
});
test('missing access configuration denies business endpoints and writes',async()=>{const env={APP_ENV:'test',DB:new D1()};for(const path of ['/api/bootstrap','/api/run','/api/sync/export']){const r=await worker.fetch(new Request(origin+path),env);assert.equal(r.status,503);}env.APP_ENV='production';assert.equal((await worker.fetch(new Request(origin+'/api/health'),env)).status,503);});

test('recipe register is private, revisioned, retry-safe and independent of sales/production; Order Guy combines confirmed plans with forecast coverage',async()=>{
 const env={APP_ENV:'test',DB:new D1(),APP_ACCESS_KEYS:JSON.stringify({alex:key,staff:key+'-staff'})};let cookie='';
 async function call(path,body,extra={}){const r=await worker.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,data:await r.json(),headers:r.headers};}
 assert.equal((await call('/api/recipes')).status,401);assert.equal((await call('/api/sync/order-guy')).status,401);
 let auth=await call('/api/login',{username:'staff',key:key+'-staff'});cookie=auth.headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/recipes')).status,403);
 auth=await call('/api/login',{username:'alex',key});cookie=auth.headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/recipes')).data.revision,0);
 const material={id:'TEST',name:'Synthetic',unit:'kg',supplier:'Supplier',source:'TEST',notes:'',pack_qty:5,procure:true,price:{amount:2,status:'verified',date:'2026-10-01',valid_until:null,source:'TEST INVOICE'},stock:{qty:0,date:'2026-10-08',reserve:0,incoming:[],source:'Physical count'}};
 const recipe={group:'W01',name:'Synthetic recipe',version:1,effective_date:'2026-10-01',status:'approved',complete:true,batch_kg:10,ingredients:[{material:'TEST',qty:10,unit:'kg',status:'approved',note:''}],consumables:[],source:'TEST RECIPE',notes:''};
 const body={revision:0,request_id:crypto.randomUUID(),reason:'Test import source',register:{schema_version:1,materials:[material],recipes:[recipe],packaging:[],notes:''}};
 assert.equal((await call('/api/recipes',body,{Origin:'https://evil.example'})).status,403);
 assert.equal((await call('/api/import/recipes',body,{Authorization:'Bearer '+key,'X-User':'alex'})).status,200);
 assert.equal((await call('/api/recipes',body)).data.replayed,true);assert.equal((await call('/api/recipes',{...body,reason:'Changed contents'})).status,409);
 assert.equal((await call('/api/recipes',{...body,request_id:crypto.randomUUID()})).status,409);
 assert.equal((await call('/api/catalog',{revision:0,catalog})).status,200);
 let p=(await call('/api/production?date=2026-10-08')).data;p.plan.groups[0].planned=1;
 const saved=await call('/api/production',{plan:p.plan,revision:0,action:'confirm',acknowledge_warnings:true,request_id:crypto.randomUUID()});assert.equal(saved.status,200);
 const before=env.DB.db.prepare('SELECT * FROM v2_production_events').all();
 const exportData=(await call('/api/sync/order-guy?from=2026-10-08&to=2026-10-09',{},{Authorization:'Bearer '+key,'X-User':'alex'}));assert.equal(exportData.status,405);
 const report=await call('/api/sync/order-guy?from=2026-10-08&to=2026-10-09',null,{Authorization:'Bearer '+key,'X-User':'alex'});assert.equal(report.status,200);assert.equal(report.data.rows[0].gross,10);assert.equal(report.data.plans.length,1);assert.equal(report.data.coverage[1].status,'covered_by_other_day');assert.equal(report.data.complete,false);
 const changed=structuredClone(body);changed.revision=1;changed.request_id=crypto.randomUUID();changed.register.recipes[0].ingredients[0].qty=11;changed.register.recipes[0].batch_kg=11;assert.equal((await call('/api/recipes',changed)).status,400);
 changed.register=structuredClone(body.register);changed.register.materials[0].price.amount=3;assert.equal((await call('/api/recipes',changed)).status,200);
 assert.equal((await call('/api/recipes/audit')).data.events.length,2);assert.deepEqual(env.DB.db.prepare('SELECT * FROM v2_production_events').all(),before);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM v2_events').get().n,0);
 assert.equal((await call('/api/order-guy?from=2026-10-08&to=2026-12-01')).status,400);
});
