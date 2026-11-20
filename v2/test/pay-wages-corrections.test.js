import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const date='2026-11-20';
const days=['16','17','18','19','20'].map(d=>'2026-11-'+d);
function exampleCases(){
 const rates=[3810,3823,3822,3000];
 return rates.map((rate,i)=>{
  const id=crypto.randomUUID(),role=['A','B','C','D'][i];
  const person={id,name:'Worker '+role,code:'TEST-'+role,active:true,start_date:'2026-11-02',employment_type:i===3?'Casual':'Regular',employment_verified:true,schedules:[{from:days[0],minutes:[480,480,480,480,480,0,0]}]};
  const leave=i===0?days.map((date,n)=>({id:crypto.randomUUID(),employee_id:id,type:'Annual',date,units:1,status:n===4?'Pending':'Approved',paid_minutes:n===4?0:480,scheduled_minutes:480})):[];
  const ledger=i===0?[{id:crypto.randomUUID(),employee_id:id,type:'Annual',date:days[0],kind:'opening',units:4},...leave.slice(0,4).map(r=>({id:crypto.randomUUID(),employee_id:id,type:'Annual',date:r.date,kind:'usage',units:-1,leave_id:r.id}))]:[];
  const shifts=i===3?days.filter(d=>d!==days[1]).map((date,day)=>({id:crypto.randomUUID(),employee_id:id,revision:day+1,punches:[{kind:'in',at:date+'T06:00:00Z'},{kind:'out',at:date+'T14:00:00Z'}]})):[];
  return {role,rate,person,leave,ledger,shifts};
 });
}

test('wage corrections keep records, contracted leave, extra hours, prior UIF, and the payment receipt consistent in D1',async t=>{
 const examples=process.env.FEN_PAYROLL_CASES?JSON.parse(await readFile(process.env.FEN_PAYROLL_CASES,'utf8')):exampleCases();
 const bundle=await build({entryPoints:[new URL('../src/worker.js',import.meta.url).pathname],format:'esm',platform:'browser',bundle:true,write:false,define:{'Date.now':'testDate'},banner:{js:'const testDate=()=>'+Date.parse(date+'T17:00Z')+';'}});
 const origin='https://isolated.example',key='synthetic-payroll-test-session-key-'.repeat(2);
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'isolated-wages'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alinda:key})},outboundService:()=>{throw Error('No external requests');}}));
 t.after(()=>mf.dispose());
 let cookie='';
 const request=async(path,body)=>{
  const res=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(res.headers.has('Set-Cookie'))cookie=res.headers.get('Set-Cookie').split(';')[0];
  return {status:res.status,data:await res.json()};
 };
 assert.equal((await request('/api/login',{username:'alinda',key})).status,200);
 const api='/api/staff/payroll';
 const get=async()=>{const r=await request(api+'?view=wages&pay_date='+date);assert.equal(r.status,200);return r.data;};
 const command=async(action,fields={})=>{const r=await get();return {revision:r.source.staff_revision,payroll_revision:r.revision,time_version:r.source.time_version,request_id:crypto.randomUUID(),pay_date:date,action,...fields};};
 const save=async(action,fields={},expected=200)=>{const out=await request(api,await command(action,fields));assert.equal(out.status,expected,JSON.stringify(out.data));return out.data;};
 const staff=async()=>(await request('/api/staff')).data;
 const before=await staff(),db=await mf.getD1Database('DB');
 const register={...before.state,people:examples.map(x=>x.person),leave:examples.flatMap(x=>x.leave),ledger:examples.flatMap(x=>x.ledger)};
 await db.prepare('INSERT INTO v2_staff_register VALUES(?,?,?,?,?,?)').bind(1,JSON.stringify(register),'test_fixture','fixture',days[0]+'T05:00Z','{}').run();
 for(const shift of examples.flatMap(x=>x.shifts)){
  const first=shift.punches[0],last=shift.punches.at(-1);
  await db.prepare('INSERT INTO v2_staff_time VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),shift.employee_id,shift.id,shift.revision??1,first.at,last.kind==='out'?last.at:null,last.kind==='out'?'out':'in',JSON.stringify(shift),'synthetic','fixture',last.at).run();
 }
 await save('company',{company:{name:'Fixture employer',address:'Fixture address',first_pay_date:date}});
 for(const x of examples)await save('profile',{profile:{employee_id:x.person.id,from:days[0],basis:'Hourly',rate_cents:x.rate,fixed_cents:0,occupation:'Factory',payment_method:'Cash',break_rule:'Recorded breaks',uif:'Review each week',reason:'Test of confirmed payroll rate'}});
 await save('fresh_start');
 const [a,b,c,d]=examples.map(x=>x.person.id);
 const read=async id=>(await get()).run.rows.find(r=>r.employee_id===id);
 const absence=(id,extra={})=>({employee_id:id,dates:days,type:'Sick',note:'Confirmed absence and employer-approved additional pay',extra_minutes:300,...extra});
 // An unsuccessful reclassification cannot even partially reverse a balance.
 await save('wages_absence',absence(a),409);
 await save('wages_absence',absence(a,{replace:true}),400);
 assert.deepEqual((await staff()).state.ledger,register.ledger);
 await save('wages_absence',absence(a,{replace:true,employer_cover:true}));
 const revised=await staff();
 assert.deepEqual(revised.state.leave.filter(r=>r.employee_id===a).map(r=>r.id),examples[0].leave.map(r=>r.id));
 assert.equal(revised.state.ledger.filter(r=>r.kind==='reversal').length,4);
 assert.equal(revised.people.find(p=>p.id===a).balances.Annual,4);
 assert.equal(revised.people.find(p=>p.id===a).balances.Sick,null);
 const attempt=await command('wages_absence',absence(b,{employer_cover:true}));
 assert.equal((await request(api,attempt)).status,200);
 assert.equal((await request(api,attempt)).data.replayed,true);
 await save('wages_absence',absence(a,{replace:true,employer_cover:true}));
 assert.deepEqual((await staff()).state.ledger,revised.state.ledger);
 for(const [id,gross,extra] of [[a,171450,19050],[b,172035,19115]]){
  const row=await read(id);assert.deepEqual([row.leave_seconds,row.extra_hours_cents,row.overtime_seconds,row.gross_cents,row.paye_cents],[40*3600,extra,0,gross,0]);
  assert.equal(row.net_cents,null);assert.equal(row.estimate_net_cents,gross-Math.round(gross/100));
 }
 const work={employee_id:c,minutes:45*60,note:'Confirmed total worked after breaks'};
 await save('wages_worked_week',work);
 assert.deepEqual([(await read(c)).ordinary_seconds,(await read(c)).overtime_seconds,(await read(c)).gross_cents],[162000,0,171990]);
 await save('wages_clear_week',{employee_id:c,note:'Use original daily evidence'});assert.equal((await read(c)).gross_cents,null);
 await save('wages_worked_week',work);
 await save('wages_day',{employee_id:d,day:days[1],kind:'sick_paid',minutes:480,note:'Existing paid sick day for Tuesday'});
 const casual=await read(d);
 assert.equal(casual.profile.rate_cents,3023);assert.equal(casual.leave_seconds,28800);assert.equal(casual.overtime_seconds,0);
 if(process.env.FEN_PAYROLL_CASES)assert.deepEqual([casual.gross_cents,casual.estimate_net_cents],[111965,110845]);
 // Independent employee/employer November balances, with different remaining room.
 await save('wages_prior_uif',{employee_id:c,employee_cents:17650,employer_cents:17300,note:'Amounts from fixture previous pay slips'});
 const prior=await read(c);
 assert.deepEqual([prior.uif_employee_cents,prior.uif_employer_cents,prior.net_cents,prior.ready],[62,412,171928,true]);
 const cmd=await command('wages_pay_now',{employee_ids:[c],expected_cents:prior.net_cents,method:'Cash',paid_on:date});
 assert.equal((await request(api,{...cmd,request_id:crypto.randomUUID(),expected_cents:1})).status,409);
 const attempts=await Promise.all([request(api,cmd),request(api,cmd)]);
 assert.ok(attempts.every(r=>r.status===200));assert.equal(attempts.filter(r=>r.data.replayed).length,1);
 const frozen=await read(c);assert.equal(frozen.wage_state,'Paid');assert.equal(frozen.paid_by,'alinda');assert.equal(frozen.paid_on,date);assert.ok(frozen.paid_at);
 await save('wages_pay_now',{employee_ids:[c],expected_cents:prior.net_cents,method:'Cash',paid_on:date},409);
 assert.equal((await get()).run.rows.filter(r=>r.wage_state==='Paid').length,1);
 assert.deepEqual((await staff()).state.people,register.people);
 assert.deepEqual((await db.prepare('SELECT payload FROM v2_staff_register WHERE revision=1').first()).payload,JSON.stringify(register));
});
