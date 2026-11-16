import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {weeklyPaye} from '../src/weekly-paye.js';
import {FRESH_START} from '../src/payroll-domain.js';

test('SARS 2027 weekly table, age at tax year end, printed ambiguity and year boundary',()=>{
 const person={birth_date:'1980-01-01',start_date:'2020-01-01',active:true};
 const tax=(cents,p=person,date='2026-11-20')=>weeklyPaye(cents,date,p,'2026-11-16');
 assert.equal(tax(193400),700);assert.equal(tax(194999),700);assert.equal(tax(195000),1000);
 assert.equal(tax(477100,{...person,birth_date:'1962-02-28'}),33500);
 assert.equal(tax(477100,{...person,birth_date:'1952-02-28'}),27300);
 assert.throws(()=>tax(3072000,{...person,birth_date:'1941-01-01'}),/ambiguous/);
 assert.equal(tax(3400000),1162600);
 assert.throws(()=>tax(200000,{...person,birth_date:null}),/date of birth/);
 assert.throws(()=>tax(200000,person,'2027-03-05'),/tax year/);
});

test('Fresh start, saved settings and history, November payroll through second Friday in isolated D1',async t=>{
 // Advance only the isolated Worker's clock. Production has no time override.
 const now=Date.parse('2026-11-27T15:00:00Z');
 const bundle=await build({entryPoints:[new URL('../src/worker.js',import.meta.url).pathname],bundle:true,
  format:'esm',platform:'browser',write:false,define:{'Date.now':'testClock'},banner:{js:`const testClock=()=>${now};`}});
 const origin='https://payroll.example',keys=Object.fromEntries(['alex','alinda','xalinda'].map(u=>[u,'synthetic-key-for-'+u+'x'.repeat(40)]));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,
  compatibilityDate:'2026-09-30',d1Databases:{DB:'payroll-fresh'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(keys)},
  outboundService:()=>{throw Error('Test must not contact external services');}}));
 t.after(()=>mf.dispose());
 const cookies={};
 const call=async(user,path,body)=>{
  const res=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookies[user]??'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json(),headers:res.headers};
 };
 for(const user of Object.keys(keys)){
  const res=await call(user,'/api/login',{username:user,key:keys[user]});
  assert.equal(res.status,200);cookies[user]=res.headers.get('set-cookie').split(';')[0];
 }
 const db=await mf.getD1Database('DB'),path='/api/staff/payroll',date='2026-11-20',next='2026-11-27';
 const get=async(d=date)=>{const r=await call('alinda',path+'?pay_date='+d);assert.equal(r.status,200);return r.data;};
 const body=async(action,data={})=>{const s=await get();return {action,request_id:crypto.randomUUID(),revision:s.source.staff_revision,payroll_revision:s.revision,time_version:s.source.time_version,pay_date:date,...data};};
 const post=async(action,data={},user='alinda')=>call(user,path,await body(action,data));
 const ok=async(action,data={})=>{const r=await post(action,data);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const employee_id=crypto.randomUUID();
 assert.equal((await call('alinda','/api/staff',{action:'person',request_id:crypto.randomUUID(),revision:0,person:{id:employee_id,name:'Synthetic Worker',code:'TEST-101',team:'Test Staff',birth_date:'1980-01-01',start_date:'2026-02-01',active:true}})).status,200);
 await ok('company',{company:{name:'Test Employer',address:'Test address',first_pay_date:'2026-11-13'}});
 const profile={employee_id,from:'2026-02-01',basis:'Hourly',rate_cents:4000,fixed_cents:0,occupation:'Test worker',break_rule:'Recorded breaks',payment_method:'Bank',uif:'Liable',reason:'Existing verified test profile'};
 await ok('profile',{profile});
 // A historical opening and frozen payslip already exist, as do native clock records.
 const oldDate='2026-11-13';
 await ok('opening',{opening:{employee_id,gross_cents:90000,net_cents:89100,uif_base_cents:90000,uif_employee_cents:900,uif_employer_cents:900,reason:'Existing historical evidence'}});
 const old=await get(oldDate);
 const oldRow={...old.run.rows[0],ordinary_seconds:9*3600,reviewed:true,included:true,paye_cents:0,note:'Original verified hours',confirmed:true};
 await ok('row',{row:oldRow,pay_date:oldDate});await ok('approve',{pay_date:oldDate,note:'Earlier approval'});await ok('paid',{pay_date:oldDate,paid_on:oldDate,note:'Earlier payment'});
 const frozen=(await get(oldDate)).run;
 for(const day of ['16','17','18','19','20']){
  const start='2026-11-'+day+'T05:00:00Z',end='2026-11-'+day+'T15:00:00Z',id=crypto.randomUUID();
  const shift={id,employee_id,punches:[{kind:'in',at:start},{kind:'out',at:end}]};
  await db.prepare('INSERT INTO v2_staff_time VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),employee_id,id,Number(day),start,end,'out',JSON.stringify(shift),'synthetic','tester',end).run();
 }
 const snapshot=async(sql)=>(await db.prepare(sql).all()).results;
 const ledger=await snapshot('SELECT * FROM v2_staff_payroll ORDER BY revision');
 const clocks=await snapshot('SELECT * FROM v2_staff_time ORDER BY rowid');
 const people=await snapshot('SELECT * FROM v2_staff_register ORDER BY revision');
 const initial=await get();
 assert.equal((await post('fresh_start',{},'xalinda')).status,403);
 const start=await body('fresh_start');assert.equal((await call('alinda',path,start)).status,200);
 assert.equal((await call('alinda',path,start)).data.replayed,true);await ok('fresh_start');
 let s=await get();assert.deepEqual(s.settings.profiles,initial.settings.profiles);assert.deepEqual(s.openings,initial.openings);
 assert.equal(s.settings.company.first_pay_date,date);assert.equal(s.settings.fresh_start.start_date,FRESH_START.start_date);
 assert.deepEqual((await get(oldDate)).run,frozen);
 assert.equal((await post('refresh',{pay_date:oldDate})).status,400);
 assert.equal((await post('opening',{opening:{employee_id}})).status,400);
 assert.equal((await post('company',{company:initial.settings.company})).status,400);
 await ok('refresh');s=await get();
 const clock=s.run.rows[0];assert.equal(clock.ordinary_seconds,45*3600);assert.equal(clock.overtime_seconds,5*3600);
 const row={...clock,confirmed:true,note:'Verified November ceiling, weekly earnings and hours',bonus_cents:10000,meat_cents:5000,other_deduction_cents:2000,paye_method:'SARS weekly table',standard_week_confirmed:true};
 assert.match((await post('row',{row})).data.error,/earlier November/);
 assert.equal((await post('row',{row:{...row,cutover_uif:'Full weekly share',standard_week_confirmed:false}})).status,400);
 assert.equal((await post('row',{row:{...row,paye_method:'Auditor confirmed',paye_cents:null,cutover_uif:'Full weekly share'}})).status,400);
 await ok('row',{row:{...row,cutover_uif:'Full weekly share'}});
 await ok('approve',{note:'Synthetic weekly review'});
 const slip=(await get()).run.rows[0];
 assert.equal(slip.gross_cents,220000);assert.equal(slip.paye_cents,5300);assert.equal(slip.uif_employee_cents,2200);assert.equal(slip.net_cents,205500);
 const payment=await body('paid',{paid_on:date,note:'Synthetic test payment'});
 const attempts=await Promise.all([call('alinda',path,payment),call('alinda',path,payment)]);
 assert.deepEqual(attempts.map(r=>r.status),[200,200]);assert.equal(attempts.filter(r=>r.data.replayed).length,1);
 assert.equal((await post('paid',{paid_on:date,note:'Do not duplicate this payment'})).status,400);
 await ok('refresh',{pay_date:next});s=await get(next);
 const second={...s.run.rows[0],ordinary_seconds:40*3600,confirmed:true,paye_cents:1200,cutover_uif:'Confirmed current amounts',current_employee_cents:610,current_employer_cents:610,note:'Auditors confirmed current November capped UIF and PAYE'};
 assert.equal((await post('row',{pay_date:next,row:{...second,current_employer_cents:null}})).status,400);
 await ok('row',{pay_date:next,row:second});await ok('approve',{pay_date:next,note:'Second Friday checked'});
 s=await get(next);assert.equal(s.run.rows[0].net_cents,158190);
 assert.deepEqual(s.month.approved_dates.sort(),[date,next]);assert.equal(s.month.partial,true);assert.match(s.month.coverage,/Earlier payments/);
 assert.equal(s.month.totals.gross_cents,380000);assert.equal(s.month.rows[0].paid_net_cents,205500);assert.equal(s.month.rows[0].uif_total_cents,5620);
 await ok('refresh',{pay_date:'2026-12-04'});
 const dec=await get('2026-12-04');await ok('row',{pay_date:'2026-12-04',row:{...dec.run.rows[0],ordinary_seconds:10*3600,paye_cents:0,confirmed:true,note:'Verified current week'}});
 assert.equal((await get('2026-12-04')).run.rows[0].uif_employee_cents,400);
 assert.equal((await post('approve',{pay_date:'2026-12-04',note:'Future approvals are blocked'})).status,400);
 assert.deepEqual(await snapshot('SELECT * FROM v2_staff_payroll WHERE revision<='+initial.revision+' ORDER BY revision'),ledger);
 assert.deepEqual(await snapshot('SELECT * FROM v2_staff_time ORDER BY rowid'),clocks);
 assert.deepEqual(await snapshot('SELECT * FROM v2_staff_register ORDER BY revision'),people);
 assert.deepEqual((await get(oldDate)).run,frozen);
 assert.equal((await snapshot("SELECT revision FROM v2_staff_payroll WHERE action='fresh_start'")).length,1);
 assert.equal((await snapshot("SELECT revision FROM v2_staff_payroll WHERE action='paid' AND entity_key='run:2026-11-20'")).length,1);
});
