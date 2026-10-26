import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {today} from '../src/domain.js';

test('casual PIN allocation, reuse, races, inactive denial and independent history persist in real D1',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fen-casual-')),origin='https://casual.example',key='synthetic-casual-admin-key-'.repeat(3);
 const config={name:'casual-test',modules:['worker','invoice-api','invoice-domain','staff-api','payroll-api','payroll-domain','staff-domain','staff-import','staff-history','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching','zoho-reconcile'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',d1Databases:{DB:'casual-test'},resourcePersistencePath:directory,bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key,alinda:key+'a',xavier:key+'x'}),STAFF_PIN_PEPPER:'synthetic-casual-pepper-'.repeat(3)},outboundService:()=>{throw Error('No external traffic');}};
 let mf=new Miniflare(convertV4MiniflareOptions(config));t.after(async()=>{await mf.dispose();await rm(directory,{recursive:true,force:true});});
 const call=async(path,{body,cookie=''}={})=>{const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};};
 const login=async(username,k)=>{const r=await call('/api/login',{body:{username,key:k}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 let admin=await login('alex',key),rev=0;
 const save=async(body,path='/api/staff')=>{const r=await call(path,{cookie:admin,body:{request_id:crypto.randomUUID(),revision:rev,...body}});if(r.status===200)rev=r.data.revision;return r;};
 const state=async()=>(await call('/api/staff',{cookie:admin})).data;
 const make=name=>({id:crypto.randomUUID(),name,team:'Synthetic production',start_date:today(),active:true,employment_type:'Casual'});
 const first=make('Synthetic first casual'),second=make('Synthetic second casual');
 const creation={request_id:crypto.randomUUID(),revision:rev,action:'person',person:first};
 assert.equal((await save(creation)).status,200);assert.equal((await save(creation)).data.replayed,true);
 assert.equal((await save({action:'person',person:{...second,casual_pin_slot:1}})).status,200);
 let s=await state();assert.equal(s.people.length,2);assert.equal(s.people[0].casual_pin,'0001');assert.equal(s.people[1].casual_pin,'0002');assert.equal(s.people[0].birth_date,null);assert.equal(s.people[0].pin_ready,true);
 const device=crypto.randomUUID(),code='a0b1c2d3e4f56789';assert.equal((await save({action:'create',device_id:device,name:'Synthetic yard phone',code},'/api/staff/device')).status,200);
 const enrolled=await call('/api/staff-clock/enrol',{body:{code}});assert.equal(enrolled.status,200);const clock=enrolled.headers.get('set-cookie').match(/__Secure-fm_clock=[a-f0-9]{64}/)[0];
 const verify=(id,pin)=>call('/api/staff-clock/verify',{cookie:clock,body:{employee_id:id,pin}});
 assert.equal((await verify(first.id,'0001')).status,200);assert.equal((await verify(second.id,'0002')).status,200);
 for(const pin of ['1',1,'00001'])assert.equal((await verify(first.id,pin)).status,401);
 const roster=(await call('/api/staff-clock/state',{cookie:clock})).data;assert.deepEqual(Object.keys(roster.people[0]).sort(),['id','name','state']);assert.doesNotMatch(JSON.stringify(roster),/"(?:casual_pin|casual_pin_slot|birth_date|employment_type)"/);
 assert.equal((await call('/api/staff',{cookie:clock})).status,401);
 const staff=await login('xavier',key+'x');assert.equal((await call('/api/staff',{cookie:staff,body:{action:'status',employee_id:first.id,active:false,revision:rev,request_id:crypto.randomUUID()}})).status,403);
 const inBody={employee_id:first.id,pin:'0001',kind:'in',revision:0,request_id:crypto.randomUUID()};
 assert.equal((await call('/api/staff-clock/punch',{cookie:clock,body:inBody})).status,200);
 assert.equal((await save({action:'status',employee_id:first.id,active:false})).status,400,'open shift prevents PIN release');
 s=await state();assert.equal((await save({action:'person',person:{...s.people[0],active:false}})).status,400,'editing cannot bypass open-shift protection');
 assert.equal((await save({action:'clock_type',employee_id:first.id,employment_type:'Regular'})).status,400,'changing credential type requires clock-out');
 assert.equal((await call('/api/staff-clock/punch',{cookie:clock,body:{...inBody,kind:'out',revision:1,request_id:crypto.randomUUID()}})).status,200);
 const deactivate={request_id:crypto.randomUUID(),revision:rev,action:'status',employee_id:first.id,active:false};assert.equal((await save(deactivate)).status,200);assert.equal((await save(deactivate)).data.replayed,true);
 const replacement=make('Synthetic replacement');assert.equal((await save({action:'person',person:replacement})).status,200);s=await state();assert.equal(s.people.find(p=>p.id===replacement.id).casual_pin,'0001');
 assert.equal((await verify(first.id,'0001')).status,403);assert.equal((await verify(replacement.id,'0001')).status,200);
 assert.equal((await call('/api/staff-clock/punch',{cookie:clock,body:inBody})).status,403,'inactive employees cannot replay even an old successful clock request');
 const hours=(await call('/api/staff/hours?from='+today()+'&to='+today(),{cookie:admin})).data;assert.equal(hours.shifts.length,1);assert.equal(hours.shifts[0].employee_id,first.id,'old hours never follow a reused PIN');
 const activeIds=(await call('/api/staff-clock/state',{cookie:clock})).data.people.map(p=>p.id);assert.ok(!activeIds.includes(first.id));assert.ok(activeIds.includes(replacement.id));
 assert.equal((await save({action:'status',employee_id:first.id,active:true})).status,200);s=await state();assert.equal(s.people.find(p=>p.id===first.id).casual_pin,'0003');assert.equal((await verify(first.id,'0001')).status,401);assert.equal((await verify(first.id,'0003')).status,200);
 const requests=[make('Synthetic parallel A'),make('Synthetic parallel B')].map(person=>({action:'person',person,revision:rev,request_id:crypto.randomUUID()}));
 const simultaneous=await Promise.all(requests.map(body=>call('/api/staff',{cookie:admin,body})));assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,409]);s=await state();rev=s.revision;
 const loser=requests[simultaneous.findIndex(r=>r.status===409)];assert.equal((await save({...loser,revision:rev,request_id:crypto.randomUUID()})).status,200);s=await state();assert.equal(new Set(s.people.filter(p=>p.active).map(p=>p.casual_pin)).size,5);
 // Either the clock-in or deactivation can win, never an inactive open shift.
 const raced=await Promise.all([
  call('/api/staff',{cookie:admin,body:{action:'status',employee_id:second.id,active:false,revision:rev,request_id:crypto.randomUUID()}}),
  call('/api/staff-clock/punch',{cookie:clock,body:{employee_id:second.id,pin:'0002',kind:'in',revision:0,request_id:crypto.randomUUID()}})
 ]);assert.equal(raced.filter(r=>r.status===200).length,1);s=await state();rev=s.revision;const secondSaved=s.people.find(p=>p.id===second.id);assert.ok(secondSaved.active||secondSaved.state==='out');
 const beforeRestart=s.people.map(p=>({id:p.id,pin:p.casual_pin,active:p.active}));
 await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(config));admin=await login('alinda',key+'a');s=await state();assert.deepEqual(s.people.map(p=>({id:p.id,pin:p.casual_pin,active:p.active})),beforeRestart);assert.equal((await verify(first.id,'0003')).status,200);
 const db=await mf.getD1Database('DB'),history=(await db.prepare('SELECT employee_id,payload FROM v2_staff_time WHERE employee_id=?').bind(first.id).all()).results;assert.equal(history.length,2);assert.ok(history.every(r=>JSON.parse(r.payload).employee_id===first.id));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_events').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_production_events').first()).n,0);
});
