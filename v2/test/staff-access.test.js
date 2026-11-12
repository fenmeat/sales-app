import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {keys} from '../src/auth.js';
import {fixture} from './helpers/report-fixture.js';
const primary={alex:'a'.repeat(64),alinda:'b'.repeat(64)};
const staff={xavier:'c'.repeat(64),xalinda:'d'.repeat(64)};
test('separate staff keys preserve primary identities and fail closed independently',()=>{
 const env={APP_ACCESS_KEYS:JSON.stringify(primary)};
 assert.deepEqual({...keys(env)},primary);
 env.APP_STAFF_ACCESS_KEYS=JSON.stringify({...staff,alex:'z'.repeat(64),alinda:'y'.repeat(64),duplicate:primary.alex,bad:'short'});
 assert.deepEqual({...keys(env)},{...primary,...staff});
 assert.equal(keys(env).constructor,undefined,'unconfigured inherited properties are not accounts');
 for(const invalid of ['{','null','[]','false','"text"',JSON.stringify(Object.fromEntries(Array.from({length:21},(_,i)=>['staff'+i,'x'.repeat(64)])))]){
  env.APP_STAFF_ACCESS_KEYS=invalid;assert.deepEqual({...keys(env)},primary);
 }
 env.APP_ACCESS_KEYS='invalid';env.APP_STAFF_ACCESS_KEYS=JSON.stringify(staff);assert.equal(Object.keys(keys(env)).length,0,'extra keys cannot bootstrap missing primary setup');
 const many=Object.fromEntries(Array.from({length:19},(_,i)=>['person'+i,String(i).padStart(64,'0')]));
 assert.equal(Object.keys(keys({APP_ACCESS_KEYS:JSON.stringify(many),APP_STAFF_ACCESS_KEYS:JSON.stringify(staff)})).length,20);
});

test('real Worker keeps existing sessions/data while staff is added, rotated or removed',async t=>{
 const origin='https://staff.example';
 const base={name:'staff-access-test',modules:['worker','pa-report-api','finance-api','finance-domain','finance-import','budget-domain','budget-import','pos-api','pos-domain','invoice-auth','invoice-api','invoice-domain','staff-api','payroll-api','payroll-domain','staff-domain','staff-import','staff-history','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','tasks-api','tasks-mail','tasks-push','webpush-bundle','zoho-ledger','britos-ledger','zoho','zoho-matching','zoho-reconcile'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',d1Databases:{DB:'staff-access-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(primary)},outboundService:()=>{throw Error('No outbound calls in staff access tests');}};
 const mf=new Miniflare(convertV4MiniflareOptions(base));t.after(()=>mf.dispose());
 const call=async(path,{body,cookie='',headers={}}={})=>{
  const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:await r.json(),headers:r.headers};
 };
 const login=async(username,key)=>{const r=await call('/api/login',{body:{username,key}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 assert.equal((await call('/api/staff')).status,401);
 const cookies={alex:await login('alex',primary.alex),alinda:await login('alinda',primary.alinda)};
 for(const name of ['alex','alinda']){const p=await call('/api/staff',{cookie:cookies[name]});assert.equal(p.status,200);assert.equal(p.data.payroll_ready,false);assert.equal(p.data.revision,0);}
 assert.equal((await call('/api/login',{body:{username:'xavier',key:staff.xavier}})).status,401);
 assert.equal((await call('/api/login',{body:{username:'constructor',key:'function Object() { [native code] }'}})).status,401);
 const catalog={products:[{code:'W01',name:'BRAAI WORS',unit:'sales bag',price_cents:16000,active:true,available:true}],routes:[{code:'MB',name:'MOSSEL BAY',weekday:4}]};
 assert.equal((await call('/api/catalog',{body:{revision:0,catalog},cookie:cookies.alex})).status,200);
 const run=(await call('/api/run?date=2026-10-08&route=MB',{cookie:cookies.alinda})).data.run;
 run.items[0].planned=35;run.items[0].loaded=32;run.notes='Keep saved manual plan';
 assert.equal((await call('/api/run',{cookie:cookies.alinda,body:{run,revision:0,action:'save',request_id:crypto.randomUUID()}})).status,200);
 const db=await mf.getD1Database('DB');
 const before=(await db.prepare('SELECT * FROM v2_events').all()).results;
 const setStaff=async value=>mf.setOptions(convertV4MiniflareOptions({...base,bindings:{...base.bindings,APP_STAFF_ACCESS_KEYS:value}}));
 await setStaff(JSON.stringify(staff));
 for(const name of ['alex','alinda'])assert.equal((await call('/api/bootstrap',{cookie:cookies[name]})).data.username,name);
 for(const name of ['xavier','xalinda']){
  cookies[name]=await login(name,staff[name]);
  assert.equal((await call('/api/staff',{cookie:cookies[name]})).status,name==='xalinda'?200:403);
  assert.equal((await call('/api/bootstrap',{cookie:cookies[name]})).data.username,name);
  assert.equal((await call('/api/run?date=2026-10-08&route=MB',{cookie:cookies[name]})).data.run.items[0].planned,35);
  assert.equal((await call('/api/production?date=2026-10-07',{cookie:cookies[name]})).status,200);
  assert.equal((await call('/api/zoho/connect',{cookie:cookies[name],body:{}})).status,403);
 }
 assert.deepEqual((await (await mf.getD1Database('DB')).prepare('SELECT * FROM v2_events').all()).results,before,'adding/logging in does not rewrite business data');
 // A new user's save is attributed to their own identity, not Alex or Alinda.
 const production=(await call('/api/production?date=2026-10-07',{cookie:cookies.xavier})).data;
 production.plan.groups[0].planned=2;
 const saved=await call('/api/production',{cookie:cookies.xavier,body:{plan:production.plan,revision:0,action:'save',request_id:crypto.randomUUID()}});
 assert.equal(saved.status,200);assert.equal(saved.data.actor,'xavier');
 const changed=structuredClone(run);changed.notes='Xalinda note';
 const sales=await call('/api/run',{cookie:cookies.xalinda,body:{run:changed,revision:1,action:'save',request_id:crypto.randomUUID()}});
 assert.equal(sales.status,200);assert.equal(sales.data.actor,'xalinda');
 await setStaff(JSON.stringify({...staff,xavier:'e'.repeat(64)}));
 assert.equal((await call('/api/bootstrap',{cookie:cookies.xavier})).status,401);
 for(const name of ['alex','alinda','xalinda'])assert.equal((await call('/api/bootstrap',{cookie:cookies[name]})).status,200);
 await setStaff('malformed');
 assert.equal((await call('/api/bootstrap',{cookie:cookies.xalinda})).status,401);
 for(const name of ['alex','alinda'])assert.equal((await call('/api/bootstrap',{cookie:cookies[name]})).status,200);
 assert.equal((await call('/api/run?date=2026-10-08&route=MB',{cookie:cookies.alex})).data.run.notes,'Xalinda note');
 assert.equal((await call('/api/production?date=2026-10-07',{cookie:cookies.alinda})).data.plan.groups[0].planned,2);
});

test('Xalinda can manage Staff and payroll with her own audit identity while other admin areas stay closed',async t=>{
 const {call,db}=await fixture(t);
 const reads=['/api/staff','/api/staff/hours','/api/staff/audit','/api/staff/payroll','/api/staff/payroll/history','/api/staff/imports'];
 for(const username of ['alex','alinda','xalinda']){
  for(const path of reads)assert.equal((await call(username,path)).status,200,username+' '+path);
  const navigation=(await call(username,'/api/navigation')).data.sections;
  assert.ok(navigation.some(s=>s.id==='staff'&&s.href==='/staff'));
 }
 for(const username of ['xavier','tapiz','unsigned']){
  const expected=username==='unsigned'?401:403;
  for(const path of [...reads,'/api/staff/imports/export','/api/staff/imports/rows','/api/staff/imports/history'])assert.equal((await call(username,path)).status,expected,username+' '+path);
  for(const path of ['/api/staff','/api/staff/correction','/api/staff/device','/api/staff/payroll','/api/staff/imports/start'])assert.equal((await call(username,path,{})).status,expected,username+' POST '+path);
 }
 const id=crypto.randomUUID(),body={request_id:crypto.randomUUID(),revision:0,action:'person',person:{id,code:'QA-STAFF',name:'Synthetic access employee',team:'Test',active:true,start_date:'2026-01-01'}};
 assert.equal((await call('xalinda','/api/staff',body,{Origin:'https://outside.example'})).status,403);
 assert.equal((await call('xalinda','/api/staff',body)).status,200);
 assert.equal((await call('xalinda','/api/staff',body)).data.replayed,true);
 for(const username of ['alex','alinda','xalinda'])assert.equal((await call(username,'/api/staff')).data.people[0].id,id);
 const edited={...body,request_id:crypto.randomUUID(),revision:1,person:{...body.person,name:'Synthetic updated employee'}};
 assert.equal((await call('xalinda','/api/staff',edited)).status,200);
 assert.equal((await call('xalinda','/api/staff',{...edited,request_id:crypto.randomUUID()})).status,409);
 const audit=(await call('alinda','/api/staff/audit')).data.register;
 assert.deepEqual(audit.map(r=>r.actor),['xalinda','xalinda']);
 const payroll=(await call('xalinda','/api/staff/payroll?pay_date=2026-11-13')).data;
 const draft={request_id:crypto.randomUUID(),revision:payroll.source.staff_revision,payroll_revision:payroll.revision,time_version:payroll.source.time_version,action:'refresh',pay_date:'2026-11-13'};
 assert.equal((await call('xalinda','/api/staff/payroll',draft)).status,200);
 assert.equal((await call('alinda','/api/staff/payroll/history')).data.events[0].actor,'xalinda');
 assert.equal((await call('xalinda','/api/staff-clock/state')).status,401,'Staff access cannot replace a registered clock credential');
 for(const path of ['/api/financial','/api/financial/audit'])assert.equal((await call('xalinda',path)).status,403);
 for(const path of ['/api/financial','/api/recipes','/api/catalog','/api/zoho/connect'])assert.equal((await call('xalinda',path,{})).status,403);
 const navigation=(await call('xalinda','/api/navigation')).data.sections;
 assert.equal(navigation.some(s=>['financial','setup'].includes(s.id)),false);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_events').first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_production_events').first()).n,0);
});
