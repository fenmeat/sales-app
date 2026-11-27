import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {hash} from '../src/auth.js';
import {periodHours} from '../src/staff-domain.js';
import {readClockStore,writeClockStore,lockClockGrant,unlockClockGrant,queueClockAction,acceptClockReceipt} from '../public/staff-clock-storage.js';
const id=crypto.randomUUID(),person={id,name:'Synthetic casual',code:'QA',active:true,employment_type:'Casual',casual_pin_slot:1,start_date:'2026-11-16',employment_verified:true,schedules:[{from:'2026-11-16',minutes:[480,480,480,480,480,0,0]}]};
test('missing today is unknown, ten-second records warn, inactive and pre-employment dates do not claim missing work',()=>{
 const read=(p=person,shifts=[])=>periodHours([p],shifts,[],'2026-11-27','2026-11-27',Date.parse('2026-11-27T13:29:00Z'))[0];
 assert.deepEqual(read().issues,['Missing attendance record']);assert.deepEqual(read({...person,active:false}).issues,[]);assert.deepEqual(read({...person,start_date:'2026-11-30'}).issues,[]);
 assert.deepEqual(read(person,[{employee_id:id,punches:[{kind:'in',at:'2026-11-27T13:24:15Z'},{kind:'out',at:'2026-11-27T13:24:25Z'}]}]).issues,['Short attendance record']);
});
test('offline evidence survives reload and errors; encrypted grant holds no PIN and mismatched receipt cannot delete action',async()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 let store=readClockStore(storage);const grant={issued:1,expires:2,tickets:[{revision:1,token:'synthetic-ticket'}]},locked=await lockClockGrant('0001',grant);
 assert.deepEqual(await unlockClockGrant('0001',locked),grant);await assert.rejects(()=>unlockClockGrant('0002',locked));
 const e={employee_id:id,revision:1,request_id:crypto.randomUUID(),kind:'out',captured_at:'2026-11-27T13:00:00.000Z',ticket:'synthetic'};
 store=queueClockAction(store,e);writeClockStore(store,storage);assert.deepEqual(readClockStore(storage).queue,[e]);assert.throws(()=>queueClockAction(store,{...e,request_id:crypto.randomUUID()}));
 assert.throws(()=>acceptClockReceipt(store,e,{employee_id:id,kind:'out',revision:2,at:'2026-11-27T14:00:00.000Z'}));assert.equal(store.queue.length,1);
 const confirmed=acceptClockReceipt(store,e,{employee_id:id,kind:'out',revision:2,at:e.captured_at});assert.equal(confirmed.queue.length,0);assert.equal(confirmed.receipts[0].at,e.captured_at);
 storage.setItem('fenmeat-clock-durable-v2','bad');assert.throws(()=>readClockStore(storage));
});
test('device capture uses original timestamp once, rejects forged or conflicting tickets, retains audit and honours device revocation',async t=>{
 const compiled=await build({entryPoints:[new URL('../src/worker.js',import.meta.url).pathname],bundle:true,format:'esm',platform:'browser',write:false});
 const key='synthetic-admin-key-'.repeat(3),mf=new Miniflare(convertV4MiniflareOptions({name:'staff-integrity',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'integrity'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key}),STAFF_PIN_PEPPER:'synthetic-only-pepper-'.repeat(3)},outboundService:()=>{throw Error('No external traffic');}}));t.after(()=>mf.dispose());
 const origin='https://staff.example',call=async(path,body,cookie='')=>{const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};};
 const login=await call('/api/login',{username:'alex',key}),admin=login.headers.get('set-cookie').split(';')[0],db=await mf.getD1Database('DB');
 const device=crypto.randomUUID(),token='d'.repeat(64),cookie='__Secure-fm_clock='+token,other={...person,id:crypto.randomUUID(),code:'QA2',casual_pin_slot:2};
 await db.prepare('INSERT INTO v2_staff_register VALUES(?,?,?,?,?,?)').bind(1,JSON.stringify({people:[person,other],leave:[],ledger:[]}),'fixture','fixture',new Date().toISOString(),'{}').run();
 await db.prepare('INSERT INTO v2_staff_devices VALUES(?,?,NULL,0,?,?,0,?,?)').bind(device,'Test device',await hash(token),Date.now()+86400000,'fixture',new Date().toISOString()).run();
 assert.equal((await call('/api/staff-clock/state',null,cookie)).data.people[0].attendance_state,'missing');
 const auth=(await call('/api/staff-clock/verify',{employee_id:id,pin:'0001'},cookie)).data,at=new Date(auth.offline.issued+1).toISOString();
 const e={employee_id:id,revision:0,request_id:crypto.randomUUID(),kind:'in',captured_at:at,ticket:auth.offline.tickets[0].token};
 assert.equal((await call('/api/staff-clock/punch',{...e,employee_id:other.id},cookie)).status,401);assert.equal((await call('/api/staff-clock/punch',{...e,ticket:e.ticket.slice(0,-1)+'x'},cookie)).status,401);
 const results=await Promise.all([call('/api/staff-clock/punch',e,cookie),call('/api/staff-clock/punch',e,cookie)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results[0].data.at,at);assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_staff_time').first()).n,1);
 assert.equal((await call('/api/staff-clock/punch',{...e,request_id:crypto.randomUUID()},cookie)).status,409);
 for(const [n,kind] of ['break_start','break_end','out'].entries()){
  const action={...e,request_id:crypto.randomUUID(),revision:n+1,kind,captured_at:new Date(auth.offline.issued+n+2).toISOString(),ticket:auth.offline.tickets[n+1].token},r=await call('/api/staff-clock/punch',action,cookie);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.at,action.captured_at);
 }
 assert.equal((await call('/api/staff-clock/state',null,cookie)).data.people[0].attendance_state,'review');
 const day=at.slice(0,10),audit=await call('/api/staff/audit?from='+day+'&to='+day,null,admin);assert.equal(audit.data.clock.length,4);assert.equal(audit.data.integrity.find(r=>r.employee_id===id).revisions,4);assert.equal(audit.data.next_offset,null);
 assert.equal((await call('/api/staff/audit?from='+day+'&to='+day+'&offset=2',null,admin)).data.clock.length,2);assert.equal((await call('/api/staff/audit?from='+day+'&to='+day)).status,401);
 await db.prepare('UPDATE v2_staff_devices SET revoked=1 WHERE id=?').bind(device).run();assert.equal((await call('/api/staff-clock/punch',e,cookie)).status,401);
});
