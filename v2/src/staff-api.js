import {check,UserError,dateKey,today,addDays} from './domain.js';
import {hash,randomToken,isAdmin,sameOrigin} from './auth.js';
import {blankStaff,applyStaffAction,staffPerson,uuid,text,shiftSummary,appendPunch,periodHours,dayStart,dayAt,LEAVE_TYPES,balance,clockPin,casualPin,isCasual} from './staff-domain.js';
import {PAYROLL_SCHEMA,payrollApi} from './payroll-api.js';
import {IMPORT_SCHEMA,staffImportApi} from './staff-import.js';

export const STAFF_SCHEMA=[
 ...IMPORT_SCHEMA,
 ...PAYROLL_SCHEMA,
 `CREATE TABLE IF NOT EXISTS v2_staff_register (revision INTEGER PRIMARY KEY, payload TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, detail TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_staff_requests (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_staff_pins (employee_id TEXT PRIMARY KEY, salt TEXT NOT NULL, digest TEXT NOT NULL, pepper_id TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_staff_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, code_hash TEXT UNIQUE, code_expires INTEGER NOT NULL, token_hash TEXT UNIQUE, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_staff_time (request_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, shift_id TEXT NOT NULL, revision INTEGER NOT NULL, start_at TEXT NOT NULL, end_at TEXT, state TEXT NOT NULL, payload TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(employee_id,revision))`,
 `CREATE INDEX IF NOT EXISTS v2_staff_time_shift ON v2_staff_time(shift_id,revision)`,
 `CREATE INDEX IF NOT EXISTS v2_staff_time_date ON v2_staff_time(start_at,end_at)`
];
const encoder=new TextEncoder();
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const hasPepper=env=>typeof env.STAFF_PIN_PEPPER==='string'&&env.STAFF_PIN_PEPPER.length>=32;
const requiredPepper=env=>check(hasPepper(env),'The Staff PIN secret must be configured before clock setup.',503);
const conflict=()=>new UserError('Another Staff action was saved first. Reload the saved records and review your change.',409);
export async function staffState(db){const row=await db.prepare('SELECT * FROM v2_staff_register ORDER BY revision DESC LIMIT 1').first();return {state:row?JSON.parse(row.payload):blankStaff(),revision:row?.revision??0,saved_at:row?.saved_at??null};}
async function limited(db,key,max,minutes=15){
 const now=Date.now(),window=minutes*60000,bucket='staff:'+await hash(key+'|'+Math.floor(now/window));
 const r=await db.prepare('INSERT INTO v2_auth_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,now+window).first();
 check(r.attempts<=max,`Too many attempts. Try again in ${minutes} minutes.`,429);return bucket;
}
async function pinDigest(pin,salt,env){
 requiredPepper(env);const secret=await crypto.subtle.importKey('raw',encoder.encode(env.STAFF_PIN_PEPPER),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const material=await crypto.subtle.sign('HMAC',secret,encoder.encode(pin));
 const key=await crypto.subtle.importKey('raw',material,'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256);
 return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifyPin(db,person,pin,device,env){
 requiredPepper(env);check(typeof pin==='string'&&/^\d{4}$/.test(pin),'Enter your 4-digit PIN.',401);
 const bucket=await limited(db,'pin:'+person.id,5),deviceBucket=await limited(db,'device:'+device.id,80);
 const assigned=clockPin(person);
 check(assigned,isCasual(person)?'Ask Alex or Alinda to assign your casual PIN.':'Ask Alex or Alinda to save your date of birth before clocking.',401);
 // The selected employee UUID always owns the time records. Reusing a casual
 // slot cannot transfer their history or authenticate an inactive employee.
 const digest=await pinDigest(pin,person.id,env),expected=await pinDigest(assigned,person.id,env);
 let diff=0;for(let i=0;i<64;i++)diff|=digest.charCodeAt(i)^expected.charCodeAt(i);
 check(diff===0,isCasual(person)?'PIN is incorrect. Ask Alex or Alinda for your current casual PIN.':'PIN is incorrect. Use your birth month followed by the day, or ask Alex or Alinda to check your date of birth.',401);
 // Correct PINs do not use up the failure allowance for a shared device.
 await db.batch([db.prepare('DELETE FROM v2_auth_limits WHERE bucket=?').bind(bucket),db.prepare('UPDATE v2_auth_limits SET attempts=MAX(0,attempts-1) WHERE bucket=?').bind(deviceBucket)]);
}
async function operation(db,actor,path,b,env){
 const id=uuid(b.request_id),safe={...b};if('pin' in safe)safe.pin=await hash(String(safe.pin)+'|'+(env.STAFF_PIN_PEPPER??''));
 const digest=await hash(canonical({actor,path,body:safe}));
 const replay=async()=>{const old=await db.prepare('SELECT * FROM v2_staff_requests WHERE id=?').bind(id).first();if(!old)return null;check(old.request_hash===digest,'This action ID was already used for different details.',409);return {...JSON.parse(old.result),replayed:true};};
 return {id,old:await replay(),async commit(statements,result){try{await db.batch([...statements,db.prepare('INSERT INTO v2_staff_requests VALUES(?,?,?)').bind(id,digest,JSON.stringify(result))]);return result;}catch(e){const old=await replay();if(old)return old;throw conflict();}}};
}
const registerInsert=(db,current,state,action,actor,detail,stamp)=>db.prepare('INSERT INTO v2_staff_register VALUES(?,?,?,?,?,?)').bind(current.revision+1,JSON.stringify(state),action,actor,stamp,JSON.stringify(detail));
const latestCondition='NOT EXISTS (SELECT 1 FROM v2_staff_time newer WHERE newer.shift_id=t.shift_id AND newer.revision>t.revision)';
async function shiftsBetween(db,from,to){const rows=await db.prepare(`SELECT t.* FROM v2_staff_time t WHERE ${latestCondition} AND start_at<? AND (end_at IS NULL OR end_at>?) ORDER BY start_at LIMIT 7001`).bind(new Date(dayStart(to)+86400000).toISOString(),new Date(dayStart(from)).toISOString()).all();check(rows.results.length<=7000,'Too many shifts. Review a shorter period.',409);return rows.results.map(r=>({...JSON.parse(r.payload),revision:r.revision}));}
async function latestShift(db,id){return db.prepare(`SELECT t.* FROM v2_staff_time t WHERE employee_id=? AND ${latestCondition} ORDER BY start_at DESC LIMIT 1`).bind(id).first();}
async function timeRevision(db,id){return (await db.prepare('SELECT MAX(revision) revision FROM v2_staff_time WHERE employee_id=?').bind(id).first())?.revision??0;}
function timeInsert(db,op,shift,rev,action,actor,stamp){const s=shiftSummary(shift);return db.prepare('INSERT INTO v2_staff_time VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(op.id,shift.employee_id,shift.id,rev,s.start_at,s.end_at,s.state,JSON.stringify(shift),action,actor,stamp);}
async function deviceSession(request,db){const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Secure-fm_clock=([a-f0-9]{64})(?:;|$)/)?.[1];check(token,'Register this clock device with a code from Alex or Alinda.',401);const device=await db.prepare('SELECT * FROM v2_staff_devices WHERE token_hash=? AND revoked=0 AND expires>?').bind(await hash(token),Date.now()).first();check(device,'This clock device has expired or was revoked. Ask Alex or Alinda to register it again.',401);return device;}

// A completely separate credential. Neither an app login nor a stocktake account
// authorises kiosk operations; a kiosk credential never authenticates app APIs.
export async function staffClockApi({request,url,env,bodyOf}){
 const db=env.DB,path=url.pathname,b=request.method==='POST'?await bodyOf(request):null;
 if(b)sameOrigin(request);
 if(path==='/api/staff-clock/enrol'&&b){
  requiredPepper(env);await limited(db,'enrol:'+(request.headers.get('CF-Connecting-IP')??'local'),10);
  check(typeof b.code==='string'&&/^[a-f0-9]{16}$/i.test(b.code),'Enter the 16-character device code.',401);
  const token=randomToken(),device=await db.prepare('UPDATE v2_staff_devices SET token_hash=?,code_hash=NULL,expires=? WHERE code_hash=? AND code_expires>? AND revoked=0 AND token_hash IS NULL RETURNING id,name').bind(await hash(token),Date.now()+90*86400000,await hash(b.code.toLowerCase()),Date.now()).first();
  check(device,'Device code is invalid, expired or already used. Ask for a new code.',401);
  const adminToken=request.headers.get('Cookie')?.match(/(?:^|;\s*)fm_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(adminToken)await db.prepare('DELETE FROM v2_sessions WHERE token_hash=?').bind(await hash(adminToken)).run();
  return {data:{ok:true,device:{id:device.id,name:device.name}},cookies:[`__Secure-fm_clock=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/staff-clock; Max-Age=7776000`,'fm_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0']};
 }
 const device=await deviceSession(request,db),current=await staffState(db);
 if(path==='/api/staff-clock/state'&&request.method==='GET'){
  const rows=await db.prepare(`SELECT t.employee_id,t.state,t.start_at FROM v2_staff_time t WHERE t.state!='out' AND ${latestCondition}`).all();
  const people=current.state.people.filter(p=>p.active).map(p=>({id:p.id,name:p.name,state:rows.results.find(r=>r.employee_id===p.id)?.state??'out'}));
  return {data:{device:{id:device.id,name:device.name},server_time:new Date().toISOString(),people}};
 }
 if(path==='/api/staff-clock/punch'&&b){
  const p=staffPerson(current.state,b.employee_id);check(p.active,'Employee is inactive.',403);
  await verifyPin(db,p,b.pin,device,env);const op=await operation(db,device.id,path,b,env);if(op.old)return {data:op.old};
  const last=await latestShift(db,p.id),rev=await timeRevision(db,p.id),stamp=new Date().toISOString();
  check(p.start_date&&p.employment_verified!==false,'Confirm the employment start date before clocking.');check(p.start_date<=dayAt(stamp),'Employment has not started.');
  check(Number.isInteger(b.revision)&&b.revision===rev,'Clock status changed. Check your last action before retrying.',409);
  const old=last?JSON.parse(last.payload):null,active=last&&last.state!=='out';
  let shift=active?old:{id:crypto.randomUUID(),employee_id:p.id,punches:[]};
  if(!active){check(b.kind==='in','Clock in before recording this action.',409);check(!last||stamp>last.end_at,'A clock entry already exists at this time.',409);}
  shift=appendPunch(shift,b.kind,stamp);const s=shiftSummary(shift);
  // Recheck register and device inside the transaction; racing deactivation or
  // revocation must fail instead of accepting a stale read.
  const guard=db.prepare(`INSERT INTO v2_staff_requests(id,request_hash,result) SELECT ?, '', '' WHERE NOT EXISTS (SELECT 1 FROM v2_staff_register WHERE revision=?) OR EXISTS (SELECT 1 FROM v2_staff_register WHERE revision>?) OR NOT EXISTS (SELECT 1 FROM v2_staff_devices WHERE id=? AND revoked=0 AND token_hash=? AND expires>?)`).bind(op.id,current.revision,current.revision,device.id,device.token_hash,Date.now());
  const result={ok:true,employee_id:p.id,kind:b.kind,at:stamp,state:s.state,revision:rev+1,issues:s.issues};
  return {data:await op.commit([guard,timeInsert(db,op,shift,rev+1,'punch',device.id,stamp)],result)};
 }
 if(path==='/api/staff-clock/verify'&&b){
  const p=staffPerson(current.state,b.employee_id);check(p.active,'Employee is inactive.',403);await verifyPin(db,p,b.pin,device,env);
  const last=await latestShift(db,p.id);return {data:{employee_id:p.id,state:last?.state??'out',revision:await timeRevision(db,p.id),last_at:last?JSON.parse(last.payload).punches.at(-1).at:null,server_time:new Date().toISOString()}};
 }
 throw new UserError('Not found.',404);
}

export async function staffApi({request,url,env,user,bodyOf}){
 check(isAdmin(user.username),'Only Alex or Alinda can access Staff administration.',403);
 const db=env.DB,path=url.pathname,current=await staffState(db),stamp=new Date().toISOString();
 if(path==='/api/staff/payroll'||path==='/api/staff/payroll/history')return payrollApi({request,url,db,user,bodyOf,current,operation,shiftsBetween,env});
 if(path==='/api/staff/imports'||path.startsWith('/api/staff/imports/'))return staffImportApi({request,url,db,user,bodyOf,current});
 if(path==='/api/staff'&&request.method==='GET'){
  const devices=(await db.prepare('SELECT id,name,code_expires,expires,revoked,created_by,created_at,token_hash IS NOT NULL AS enrolled FROM v2_staff_devices ORDER BY created_at DESC').all()).results;
  const open=(await db.prepare(`SELECT t.employee_id,t.state,t.start_at FROM v2_staff_time t WHERE t.state!='out' AND ${latestCondition}`).all()).results;
  return {...current,username:user.username,pin_secret_configured:hasPepper(env),people:current.state.people.map(p=>({...p,pin_ready:hasPepper(env)&&!!clockPin(p),casual_pin:casualPin(p),state:open.find(r=>r.employee_id===p.id)?.state??'out',balances:Object.fromEntries(LEAVE_TYPES.filter(t=>t!=='Unpaid').map(t=>[t,balance(current.state,p.id,t,today())]))})),devices,payroll_enabled:true,payroll_ready:false};
 }
 if(path==='/api/staff/hours'&&request.method==='GET'){
  const from=dateKey(url.searchParams.get('from')??addDays(today(),-6)),to=dateKey(url.searchParams.get('to')??today());check(from<=to&&dayStart(to)-dayStart(from)<31*86400000,'Review up to 31 days at a time.');
  const shifts=await shiftsBetween(db,from,to),revisions=(await db.prepare('SELECT employee_id,MAX(revision) revision FROM v2_staff_time GROUP BY employee_id').all()).results;
  return {from,to,shifts,revisions,rows:periodHours(current.state.people,shifts,current.state.leave,from,to)};
 }
 if(path==='/api/staff/audit'&&request.method==='GET'){
  return {register:(await db.prepare('SELECT revision,action,actor,saved_at,detail FROM v2_staff_register ORDER BY revision DESC LIMIT 100').all()).results,clock:(await db.prepare('SELECT request_id,employee_id,shift_id,revision,action,actor,saved_at,payload FROM v2_staff_time ORDER BY saved_at DESC LIMIT 100').all()).results};
 }
 check(request.method==='POST','Not found.',404);const b=await bodyOf(request),op=await operation(db,user.username,path,b,env);if(op.old)return op.old;
 check(Number.isInteger(b.revision)&&b.revision===current.revision,'Staff records changed. Reload before saving.',409);
 if(path==='/api/staff'){
  const result=applyStaffAction(current.state,b,user.username,stamp);
  const before=current.state.people.find(p=>p.id===result.detail.employee_id),after=result.state.people.find(p=>p.id===result.detail.employee_id),statements=[];
  if(before&&((before.active&&!after.active)||isCasual(before)!==isCasual(after))){
   const openSql=`SELECT 1 FROM v2_staff_time t WHERE employee_id=? AND t.state!='out' AND ${latestCondition}`;
   check(!await db.prepare(openSql).bind(before.id).first(),'Clock out or correct the open shift before making this person inactive or changing their PIN type.');
   // Race a clock-in safely: if it commits first this guard rolls back the
   // status change. If deactivation commits first, the punch register guard fails.
   statements.push(db.prepare(`INSERT INTO v2_staff_requests(id,request_hash,result) SELECT ?, '', '' WHERE EXISTS (${openSql})`).bind(op.id,before.id));
  }
  return op.commit([...statements,registerInsert(db,current,result.state,b.action,user.username,result.detail,stamp)],{ok:true,revision:current.revision+1,employee_id:result.detail.employee_id});
 }
 if(path==='/api/staff/pin'){
  throw new UserError('Refresh Staff. Use People → Birthday / PIN for regular staff, or Casuals for assigned casual PINs.');
 }
 if(path==='/api/staff/device'){
  let stmt,detail;
  if(b.action==='create'){
   requiredPepper(env);const id=uuid(b.device_id),name=text(b.name,'device name',60);check(typeof b.code==='string'&&/^[a-f0-9]{16}$/.test(b.code),'Invalid enrolment code.');
   const count=await db.prepare('SELECT COUNT(*) count FROM v2_staff_devices WHERE revoked=0').first();check(count.count<20,'Revoke an old device before adding another.');
   stmt=db.prepare('INSERT INTO v2_staff_devices VALUES(?,?,?,?,NULL,0,0,?,?)').bind(id,name,await hash(b.code),Date.now()+600000,user.username,stamp);detail={id,name};
  }else{
   check(b.action==='revoke','Invalid device action.');const id=uuid(b.device_id);check(await db.prepare('SELECT id FROM v2_staff_devices WHERE id=?').bind(id).first(),'Device not found.',404);
   stmt=db.prepare('UPDATE v2_staff_devices SET revoked=1,code_hash=NULL,token_hash=NULL WHERE id=?').bind(id);detail={id};
  }
  return op.commit([registerInsert(db,current,current.state,'device_'+b.action,user.username,detail,stamp),stmt],{ok:true,revision:current.revision+1,...detail});
 }
 if(path==='/api/staff/correction'){
  const p=staffPerson(current.state,b.employee_id),reason=text(b.reason,'correction reason',300),rev=await timeRevision(db,p.id);check(b.clock_revision===rev,'Clock records changed. Reload before correcting.',409);
  const old=await db.prepare('SELECT * FROM v2_staff_time WHERE shift_id=? AND employee_id=? ORDER BY revision DESC LIMIT 1').bind(uuid(b.shift_id),p.id).first();check(old,'Shift not found.',404);
  check(Array.isArray(b.punches),'Supply the corrected clock entries.');
  const shift={id:old.shift_id,employee_id:p.id,punches:b.punches.map(e=>({kind:e.kind,at:e.at})),correction:{reason,actor:user.username,at:stamp,replaces_revision:old.revision},...(b.confirm_review===true?{reviewed:{actor:user.username,at:stamp,reason}}:{})};
  const s=shiftSummary(shift);check(s.state==='out','A correction must include a complete clock-in and clock-out.');check(Date.parse(s.end_at)<=Date.now(),'A correction cannot use a future clock time.');check(dayAt(s.start_at)>=p.start_date,'A correction cannot precede employment.');
  const overlaps=await db.prepare(`SELECT t.shift_id FROM v2_staff_time t WHERE employee_id=? AND shift_id!=? AND ${latestCondition} AND start_at<? AND (end_at IS NULL OR end_at>?) LIMIT 1`).bind(p.id,shift.id,s.end_at,s.start_at).first();check(!overlaps,'The corrected shift overlaps another shift.');
  return op.commit([registerInsert(db,current,current.state,'clock_correction',user.username,{employee_id:p.id,shift_id:shift.id,reason},stamp),timeInsert(db,op,shift,rev+1,'correction',user.username,stamp)],{ok:true,revision:current.revision+1,clock_revision:rev+1});
 }
 throw new UserError('Not found.',404);
}
