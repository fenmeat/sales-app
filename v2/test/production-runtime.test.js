import test from 'node:test';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {applyProductionSuggestion} from '../src/production.js';
const origin='https://production-local.example',key='test-production-key-012345678901234567890';
async function fixture(t,codes=['W01']){const mf=new Miniflare(convertV4MiniflareOptions({name:'production-test',modules:['worker','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',d1Databases:{DB:'production-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key})},outboundService:()=>{throw Error('No outbound traffic in production tests');}}));t.after(()=>mf.dispose());let cookie='';async function call(path,body,headers={}){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};}
 assert.equal((await call('/api/production?date=2026-10-07')).status,401);const auth=await call('/api/login',{username:'alex',key});cookie=auth.headers.get('set-cookie').split(';')[0];
 const catalog={products:codes.map(code=>({code,name:code,unit:'bag',price_cents:16000,active:true,available:true})),routes:[{code:'MB',name:'Mossel Bay',weekday:4},{code:'PL',name:'Plett',weekday:4}]};assert.equal((await call('/api/catalog',{revision:0,catalog})).status,200);
 for(const route of ['MB','PL']){let r=(await call('/api/run?date=2026-10-08&route='+route)).data;for(const item of r.run.items)item.planned=15;assert.equal((await call('/api/run',{run:r.run,revision:0,action:'save',request_id:crypto.randomUUID()})).status,200);}
 const save=(r,action='save',extra={})=>call('/api/production',{plan:r.plan,revision:r.revision,action,request_id:crypto.randomUUID(),...extra});return {mf,call,save};}
test('real D1 production save, reopen, refresh, explicit zero, stale/concurrent/idempotent writes and route isolation',async t=>{const {mf,call,save}=await fixture(t),db=await mf.getD1Database('DB');const before=(await db.prepare('SELECT * FROM v2_events ORDER BY run_id,revision').all()).results;
 let r=(await call('/api/production?date=2026-10-07')).data;assert.equal(r.plan.items[0].demand,30);r.plan.items[0].stock=10;r.plan.groups[0].planned=2;const body={plan:r.plan,revision:0,action:'save',request_id:crypto.randomUUID()};let first=await call('/api/production',body);assert.equal(first.status,200,JSON.stringify(first));r=first.data;assert.equal(r.summary.groups[0].output,26);assert.equal(r.summary.groups[0].balances[0].balance,6);
 assert.equal((await call('/api/production',body)).data.replayed,true);assert.equal((await call('/api/production',{...body,request_id:crypto.randomUUID()})).status,409);assert.equal((await call('/api/production',{...body,action:'refresh'})).status,409);
 assert.deepEqual((await call('/api/production?date=2026-10-07')).data.plan,r.plan);
 r.plan.groups[0].planned=0;r.plan.notes='Manual zero retained';r.plan.items[0].yield_qty=14;r=(await save(r)).data;
 let route=(await call('/api/run?date=2026-10-08&route=MB')).data;route.run.items[0].planned=25;await call('/api/run',{run:route.run,revision:route.revision,action:'save',request_id:crypto.randomUUID()});
 assert.equal((await call('/api/production?date=2026-10-07')).data.stale,true);r=(await save(r,'refresh')).data;assert.equal(r.plan.items[0].demand,40);assert.equal(r.plan.groups[0].planned,0);assert.equal(r.plan.items[0].stock,10);assert.equal(r.plan.items[0].yield_qty,14);assert.equal(r.plan.notes,'Manual zero retained');
 assert.equal((await save(r,'confirm')).status,400);r=(await save(r,'confirm',{acknowledge_warnings:true})).data;assert.equal(r.plan.phase,'confirmed');r.plan.items[0].actual=0;r=(await save(r,'actuals')).data;assert.equal(r.plan.phase,'confirmed');assert.equal(r.plan.items[0].actual,0);
 const tampered=structuredClone(r);tampered.plan.items[0].stock=100;assert.equal((await save(tampered,'actuals')).status,400);
 const events=(await db.prepare('SELECT * FROM v2_events ORDER BY run_id,revision').all()).results;assert.equal(events.length,before.length+1);assert.deepEqual(events.filter(e=>e.revision===1),before);assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_history').first()).n,0);
 assert.equal((await call('/api/production/audit?date=2026-10-07',{plan:r.plan,revision:r.revision,action:'save',request_id:crypto.randomUUID()})).status,405);
 assert.equal((await call('/api/production/audit?date=2026-10-07')).data.events.length,5);
 const wrongOrigin=await call('/api/production',{plan:r.plan,revision:r.revision,action:'save',request_id:crypto.randomUUID()},{Origin:'https://evil.example'});assert.equal(wrongOrigin.status,403);
 const next=(await call('/api/production?date=2026-10-08')).data;assert.equal(next.plan.items[0].stock,null);assert.equal(next.plan.items[0].yield_qty,14);assert.equal(next.plan.groups[0].planned,null);
});
test('production D1 rejects partial batches, missing plan decisions and tampered source quantities',async t=>{const {call,save}=await fixture(t);let r=(await call('/api/production?date=2026-10-07')).data;assert.equal((await save(r,'confirm',{acknowledge_warnings:true})).status,400);r.plan.groups[0].planned=.5;assert.equal((await save(r)).status,400);r.plan.groups[0].planned=2;r.plan.items[0].stock=10;r.plan.items[0].demand=99999;r=(await save(r)).data;assert.equal(r.plan.items[0].demand,30);r.plan.items[0].demand=1;r=(await save(r)).data;assert.equal(r.plan.items[0].demand,30);});

test('shared packing suggestions and accepted batches survive D1 save, refresh and reload without changing route data',async t=>{
 const {mf,call,save}=await fixture(t,['R01','R02','R03','R04']),db=await mf.getD1Database('DB');
 const before=(await db.prepare('SELECT * FROM v2_events ORDER BY run_id,revision').all()).results;
 let r=(await call('/api/production?date=2026-10-07')).data;
 for(const i of r.plan.items)i.stock=30;r.plan.groups[0].coldroom_batches=0;
 r.plan.items[0].stock=16;r.plan.items[1].stock=5;
 r.plan.groups[0].planned=2;r=(await save(r)).data;assert.equal(r.summary.groups[0].suggested,2);
 r.plan.items[0].pack_plan=100;r=(await save(r)).data;
 assert.equal(r.summary.groups[0].suggested,6);assert.equal(r.plan.groups[0].planned,2);
 assert.equal(r.summary.groups[0].packing_based,true);
 applyProductionSuggestion(r.plan,'RUSSIAN');r=(await save(r)).data;
 assert.equal(r.plan.groups[0].planned,6);assert.deepEqual(r.plan.items.map(i=>i.pack_plan),[100,25,0,0]);
 const saved=structuredClone(r.plan);assert.deepEqual((await call('/api/production?date=2026-10-07')).data.plan,saved);
 r=(await save(r,'refresh')).data;assert.equal(r.summary.groups[0].suggested,6);assert.equal(r.plan.groups[0].planned,6);assert.deepEqual(r.plan.items.map(i=>i.pack_plan),[100,25,0,0]);
 r.plan.items[1].pack_plan=0;r=(await save(r)).data;assert.equal(r.summary.groups[0].suggested,5);assert.equal(r.plan.groups[0].planned,6);
 assert.deepEqual((await db.prepare('SELECT * FROM v2_events ORDER BY run_id,revision').all()).results,before);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_history').first()).n,0);
});

test('legacy production records upgrade in memory only; new counts and decisions persist without sales changes',async t=>{
 const {mf,call,save}=await fixture(t,['W07','P02','P03','P04','R01','R05']),db=await mf.getD1Database('DB');
 const before=(await db.prepare('SELECT * FROM v2_events ORDER BY run_id,revision').all()).results;
 let r=(await call('/api/production?date=2026-10-07')).data;
 for(const i of r.plan.items){i.stock=0;i.pack_plan=0;i.actual=0;delete i.casing_plan;delete i.coldroom_casings;delete i.casing_yield_qty;if(i.code.startsWith('P')){i.mode='shared';i.yield_qty=122;}}
 delete r.plan.planning_version;
 for(const g of r.plan.groups){g.planned=g.id==='W07'?2:0;for(const key of ['coldroom_batches','roll_stock','cut_planned','rolls_per_batch','min_roll_stock','disks_per_roll'])delete g[key];if(g.id==='W07')g.mode='batch';if(g.id==='POLONY')g.mode='shared';}
 const legacy=JSON.stringify(r.plan);
 await db.prepare('INSERT INTO v2_production_events VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'legacy','2026-10-07',1,'save',legacy,'alex','2026-10-06T00:00:00Z').run();
 r=(await call('/api/production?date=2026-10-07')).data;
 assert.equal((await db.prepare('SELECT payload FROM v2_production_events WHERE revision=1').first()).payload,legacy,'Read must not migrate stored data');
 assert.equal(r.plan.groups[0].planned,2);assert.equal(r.plan.groups[0].cut_planned,null);assert.equal(r.plan.items[1].yield_qty,122);assert.equal(r.plan.items[1].casing_yield_qty,20);
 Object.assign(r.plan.groups[0],{roll_stock:20,cut_planned:2,rolls_per_batch:12,min_roll_stock:10});
 for(const g of r.plan.groups)if(['cooked','shared'].includes(g.mode))g.coldroom_batches=.5;
 for(const [n,i] of r.plan.items.filter(i=>i.mode==='casings').entries()){i.coldroom_casings=0;i.casing_plan=[1,3,4][n];i.pack_plan=[20,42,32][n];}
 r.plan.groups.find(g=>g.id==='POLONY').planned=2;
 r=(await save(r)).data;assert.equal(r.revision,2);assert.deepEqual((await call('/api/production?date=2026-10-07')).data.plan,r.plan);
 const olderClient=structuredClone(r);for(const g of olderClient.plan.groups)for(const key of ['coldroom_batches','roll_stock','cut_planned','rolls_per_batch','min_roll_stock','disks_per_roll'])delete g[key];for(const i of olderClient.plan.items){delete i.casing_plan;delete i.coldroom_casings;}
 r=(await save(olderClient)).data;assert.equal(r.plan.groups[0].cut_planned,2);assert.equal(r.plan.items[2].casing_plan,3);
 r=(await save(r,'refresh')).data;assert.equal(r.plan.groups[0].roll_stock,20);assert.equal(r.plan.items[2].pack_plan,42);
 r=(await save(r,'confirm',{acknowledge_warnings:true})).data;assert.equal(r.plan.phase,'confirmed');r.plan.items[0].actual=3;r=(await save(r,'actuals')).data;assert.equal(r.plan.phase,'confirmed');assert.equal(r.plan.groups[0].planned,2);
 const next=(await call('/api/production?date=2026-10-08')).data;assert.equal(next.plan.groups[0].rolls_per_batch,12);assert.equal(next.plan.groups[0].min_roll_stock,10);assert.equal(next.plan.groups[0].roll_stock,null);assert.equal(next.plan.groups[0].cut_planned,null);assert.equal(next.plan.items[2].casing_plan,null);assert.equal(next.plan.items[2].coldroom_casings,null);
 assert.deepEqual((await db.prepare('SELECT * FROM v2_events ORDER BY run_id,revision').all()).results,before);
 assert.equal((await db.prepare('SELECT payload FROM v2_production_events WHERE revision=1').first()).payload,legacy);
});

test('trolley choices persist through D1 saves, reload, refresh, old clients, actuals, conflicts and explicit clear',async t=>{
 const {mf,call,save}=await fixture(t,['R01','R06','V01','P02','P03','P04']),db=await mf.getD1Database('DB');
 const before=(await db.prepare('SELECT * FROM v2_events ORDER BY run_id,revision').all()).results;
 let r=(await call('/api/production?date=2026-10-07')).data;assert.deepEqual(r.plan.trolleys,[]);
 for(const i of r.plan.items){i.stock=30;i.pack_plan=0;i.casing_plan=0;i.coldroom_casings=0;}for(const g of r.plan.groups){g.planned=0;g.coldroom_batches=0;}
 r.plan.groups.find(g=>g.id==='RUSSIAN').planned=1;r.plan.groups.find(g=>g.id==='R06').planned=1;r.plan.groups.find(g=>g.id==='V01').planned=.5;
 r.plan.trolleys=[{id:'mixed-trolley',slot1:'RUSSIAN',slot2:'R06',casings:{P02:0,P03:0,P04:0}},{id:'half-trolley',slot1:'V01_HALF',slot2:'',casings:{P02:0,P03:0,P04:0}}];
 const chosen=structuredClone(r.plan.trolleys),body={plan:r.plan,revision:0,action:'save',request_id:crypto.randomUUID()};r=(await call('/api/production',body)).data;assert.equal(r.revision,1);assert.deepEqual((await call('/api/production?date=2026-10-07')).data.plan.trolleys,chosen);
 assert.equal((await call('/api/production',body)).data.replayed,true);assert.equal((await call('/api/production',{...body,request_id:crypto.randomUUID()})).status,409);
 const oldClient=structuredClone(r);delete oldClient.plan.trolleys;r=(await save(oldClient)).data;assert.deepEqual(r.plan.trolleys,chosen);
 r.plan.groups.find(g=>g.id==='RUSSIAN').planned=0;r=(await save(r,'refresh')).data;assert.deepEqual(r.plan.trolleys,chosen);assert.equal(r.summary.trolley.requirements.find(g=>g.id==='RUSSIAN').remaining,-1);
 assert.equal((await save(r,'confirm')).status,400);r=(await save(r,'confirm',{acknowledge_warnings:true})).data;r.plan.items[0].actual=1;r=(await save(r,'actuals')).data;assert.equal(r.plan.phase,'confirmed');assert.deepEqual(r.plan.trolleys,chosen);
 const tamper=structuredClone(r);tamper.plan.trolleys[0].slot1='R06';assert.equal((await save(tamper,'actuals')).status,400);tamper.plan.trolleys[0].slot1='NOT-A-RECIPE';assert.equal((await save(tamper)).status,400);
 assert.deepEqual((await call('/api/production?date=2026-10-08')).data.plan.trolleys,[]);
 r.plan.trolleys=[];r=(await save(r)).data;assert.deepEqual((await call('/api/production?date=2026-10-07')).data.plan.trolleys,[]);
 assert.deepEqual((await db.prepare('SELECT * FROM v2_events ORDER BY run_id,revision').all()).results,before);
});
