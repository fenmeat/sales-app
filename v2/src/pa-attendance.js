import {hash,isAdmin,keys} from './auth.js';
import {check,dateKey,UserError} from './domain.js';
import {dayAt,isCasual,appendPunch,shiftSummary,uuid} from './staff-domain.js';
import {staffState,latestCondition,shiftsBetween,timeInsert} from './staff-api.js';
import {FRESH_START,nextFriday} from './payroll-domain.js';
import {initPaStorage} from './pa-storage.js';

export const CLOCK_SCOPE='fenmeat:staff:write';
export const CLOCK_SCOPES=['fenmeat:read','fenmeat:staff:read',CLOCK_SCOPE];
const table='v2_pa_clock_commands';
const pending=['scheduled','pending'];
const readCommand=(db,id)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
const timeVersion='(SELECT COALESCE(MAX(rowid),0) FROM v2_staff_time)';
const payVersion='(SELECT COALESCE(MAX(revision),0) FROM v2_staff_payroll)';
const staffVersion='(SELECT COALESCE(MAX(revision),0) FROM v2_staff_register)';
// The OAuth provider stores the revocable, per-account grant in this D1-backed KV.
// Check it again in the SAME transaction as punches, including scheduled executions.
const liveGrant=`EXISTS(SELECT 1 FROM v2_pa_oauth g WHERE g.key=? AND
 (g.expires IS NULL OR g.expires>unixepoch()) AND
 COALESCE(json_extract(g.value,'$.expiresAt'),unixepoch()+1)>unixepoch() AND
 EXISTS(SELECT 1 FROM json_each(g.value,'$.scope') WHERE value='fenmeat:staff:write') AND
 EXISTS(SELECT 1 FROM json_each(g.value,'$.scope') WHERE value='fenmeat:staff:read'))`;
const grantKey=row=>'grant:'+row.actor+':'+row.grant_id;
function timing(local) {
 if(local===undefined)return null;
 check(typeof local==='string' && /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d$/.test(local),'Gebruik ’n Suid-Afrikaanse datum en tyd, bv. 2026-11-20T15:00.');
 dateKey(local.slice(0,10));
 return new Date(local+':00+02:00').toISOString();
}
function normalize(input) {
 uuid(input.request_id);
 const action=input.action,ids=input.employee_ids?.map(uuid).sort(),group=input.group;
 check(['in','out','correct'].includes(action),'Kies in, uit of ’n regstelling.');
 check(group==='active_casuals'?!ids:ids?.length>0&&ids.length<=50,'Kies werknemers of die groep aktiewe casuals.');
 if(ids)check(new Set(ids).size===ids.length,'Elke werknemer mag net een keer voorkom.');
 if(group)check(action==='out','Kies spesifieke werknemers om in te klok of reg te stel.');
 let correction=null;
 if(action==='correct'){
  const c=input.correction;
  check(ids?.length===1&&input.local_time&&c&&['in','out'].includes(c.punch)&&Number.isInteger(c.shift_revision)&&c.shift_revision>0&&c.reason?.trim(),'Kies een skof, die klokinskrywing, die nuwe tyd en die rede.');
  correction={shift_id:uuid(c.shift_id),shift_revision:c.shift_revision,punch:c.punch,reason:c.reason.trim()};
 }else check(!input.correction,'Gebruik die regstellingsaksie vir ’n bestaande kloktyd.');
 return {action,group:group??null,ids:ids??[],at:timing(input.local_time),correction};
}
function propose(person,records,cmd,at,actor,stamp){
 check(person?.active,'Werknemer is nie aktief of kon nie gevind word nie.');
 const day=dayAt(at);
 check(person.start_date&&person.employment_verified!==false&&person.start_date<=day,'Diensdatum moet eers bevestig word.');
 const shifts=records.filter(r=>!r.exclusion).sort((a,b)=>a.punches[0].at.localeCompare(b.punches[0].at));
 const opens=shifts.filter(s=>s.punches.at(-1).kind!=='out');
 check(opens.length<=1,'Meer as een oop skof. Kies die skof vir ’n regstelling.');
 let shift,previous=null;
 if(cmd.action==='correct'){
  previous=records.find(s=>s.id===cmd.correction.shift_id);
  check(previous&&!previous.exclusion&&previous.revision===cmd.correction.shift_revision,'Die gekose skof het verander of is uitgesluit. Lees die skof weer.');
  const index=cmd.correction.punch==='in'?0:previous.punches.length-1;
  const original=previous.punches[index];
  check(original.kind===cmd.correction.punch,'Daardie klokinskrywing ontbreek.');
  check(dayAt(original.at)===day,'Die regstelling moet op dieselfde datum as die gekose inskrywing val.');
  if(Date.parse(original.at)===Date.parse(at))return {status:'already_correct'};
  const punches=previous.punches.map((p,i)=>i===index?{...p,at}:p);
  shift={...previous,punches,correction:{actor,reason:cmd.correction.reason,at:stamp,replaces_revision:previous.revision}};
  delete shift.reviewed;
 }else if(cmd.action==='in'){
  if(opens.length)return {status:'already_in'};
  check(!shifts.some(s=>s.punches.at(-1).at>=at),'Hierdie inkloktyd oorvleuel ’n bestaande skof.');
  shift=appendPunch({id:crypto.randomUUID(),employee_id:person.id,punches:[]},'in',at);
 }else{
  if(!opens.length)return {status:shifts.length?'already_out':'no_shift'};
  previous=opens[0];
  check(dayAt(previous.punches[0].at)===day,'Die oop skof het op ’n ander datum begin. Gaan die skof na.');
  check(Date.parse(previous.punches.at(-1).at)<Date.parse(at),'Die uitkloktyd moet ná die laaste inskrywing val.');
  shift=appendPunch(previous,'out',at);
 }
 const summary=shiftSummary(shift);
 check(nextFriday(dayAt(summary.start_at))===nextFriday(day)&&(!summary.end_at||nextFriday(dayAt(summary.end_at))===nextFriday(day)),'Hierdie skof strek oor twee loonweke. Laat die loonadministrateur dit nagaan.');
 check(dayAt(summary.start_at)>=FRESH_START.start_date,'Hierdie skof is voor die nuwe loonperiode.');
 check(!shifts.some(s=>s.id!==shift.id&&s.punches[0].at<(summary.end_at??'9999')&&
  (s.punches.at(-1).kind!=='out'||s.punches.at(-1).at>summary.start_at)),'Hierdie tyd oorvleuel ’n ander skof.');
 delete shift.revision;
 return {status:'saved',shift,original:cmd.action==='correct'?previous.punches.find(p=>p.kind===cmd.correction.punch).at:null};
}
async function receipt(db,row){
 const result={request_id:row.id,actor:row.actor,status:row.status,effective_at:row.effective_at,requested_at:row.requested_at,finished_at:row.finished_at,...JSON.parse(row.result??'{}')};
 const saved=(result.employees??[]).filter(p=>p.status==='saved');
 if(saved.length){
  const ids=saved.map(p=>row.id+':'+p.employee_id);
  const sql='SELECT employee_id,shift_id,revision,actor,payload,('+latestCondition+') AS current_revision FROM v2_staff_time t WHERE request_id IN ('+ids.map(()=>'?').join(',')+')';
  const records=(await db.prepare(sql).bind(...ids).all()).results;
  for(const item of saved){
   const event=records.find(r=>r.employee_id===item.employee_id);
   check(event&&event.actor===row.actor&&event.shift_id===item.shift_id&&event.revision===item.revision,'Die gestoorde klokinskrywing kon nie bevestig word nie.',409);
   const punches=JSON.parse(event.payload).punches;
   check(punches.some(p=>p.kind===item.punch&&p.at===row.effective_at),'Die gestoorde tyd verskil van die opdrag.',409);
   item.verified=true;
   item.current=Boolean(event.current_revision);
  }
 }
 return result;
}
export async function clockReceipt(db,id,actor){
 const row=await readCommand(db,uuid(id));
 check(row&&row.actor===actor,'Klokopdrag nie gevind nie.',404);
 return receipt(db,row);
}
async function finish(db,row,status,result,stamp){
 await db.prepare(`UPDATE ${table} SET status=?,result=?,finished_at=? WHERE id=? AND status=?`)
  .bind(status,JSON.stringify(result),stamp,row.id,row.status).run();
 return receipt(db,await readCommand(db,row.id));
}
async function execute(env,row){
 const db=env.DB,now=Date.now(),stamp=new Date(now).toISOString(),cmd=JSON.parse(row.command);
 if(!pending.includes(row.status)||row.effective_at>stamp)return receipt(db,row);
 if(row.status==='scheduled'&&now-Date.parse(row.effective_at)>120000)
  return finish(db,row,'expired',{reason:'Die vasgestelde tyd is verby. Bevestig die werklike tyd vir ’n nuwe opdrag.'},stamp);
 const key=keys(env)[row.actor];
 if(!isAdmin(row.actor)||!key||await hash(key)!==row.fingerprint||
    !(await db.prepare('SELECT '+liveGrant+' AS valid').bind(grantKey(row)).first()).valid)
  return finish(db,row,'denied',{reason:'Die oorspronklike toestemming is nie meer geldig nie.'},stamp);
 const day=dayAt(row.effective_at);
 const versions=await db.prepare(`SELECT ${timeVersion} AS clock, ${payVersion} AS payroll`).first();
 const current=await staffState(db);
 const payDate=nextFriday(day);
 const run=await db.prepare('SELECT json_extract(payload,\'$.status\') AS status,json_extract(payload,\'$.rows\') AS wage_rows FROM v2_staff_payroll WHERE entity_key=? ORDER BY revision DESC LIMIT 1').bind('run:'+payDate).first();
 if(['Approved','Paid'].includes(run?.status))
  return finish(db,row,'blocked',{reason:'Hierdie loonweek is reeds goedgekeur of betaal.'},stamp);
 const shifts=await shiftsBetween(db,day,day),ids=cmd.group?current.state.people.filter(p=>p.active&&isCasual(p)).map(p=>p.id):cmd.ids;
 const frozen=new Set(JSON.parse(run?.wage_rows??'[]').filter(r=>['Paid','Approved'].includes(r.wage_state)).map(r=>r.employee_id));
 const statements=[],employees=[];
 const revisions=ids.length?(await db.prepare('SELECT employee_id,MAX(revision) AS revision,MAX(CASE WHEN '+latestCondition+' THEN start_at END) AS latest_start FROM v2_staff_time t WHERE employee_id IN ('+ids.map(()=>'?').join(',')+') GROUP BY employee_id').bind(...ids).all()).results:[];
 for(const id of ids){
  const person=current.state.people.find(p=>p.id===id),item={employee_id:id,name:person?.name??null};
  try{
   check(!frozen.has(id),'Die werknemer se loon is reeds goedgekeur of betaal.');
   const history=revisions.find(r=>r.employee_id===id);
   if(cmd.action==='in')check(!history?.latest_start||history.latest_start<=row.effective_at,'Daar is reeds ’n latere skof. Kies die bestaande rekord vir ’n regstelling.');
   const proposed=propose(person,shifts.filter(s=>s.employee_id===id),cmd,row.effective_at,row.actor,stamp);
   item.status=proposed.status;
   if(proposed.shift){
    const revision=(history?.revision??0)+1;
    statements.push(timeInsert(db,{id:row.id+':'+id},proposed.shift,revision,'pa_'+cmd.action,row.actor,stamp));
    Object.assign(item,{shift_id:proposed.shift.id,revision,punch:cmd.correction?.punch??cmd.action,original_at:proposed.original,at:row.effective_at});
   }
  }catch(error){if(!(error instanceof UserError))throw error;Object.assign(item,{status:'blocked',reason:error.message});}
  employees.push(item);
 }
 const blocked=employees.filter(p=>p.status==='blocked').length;
 const status=blocked?(blocked===employees.length?'blocked':'partial'):'completed';
 // A failing CHECK rolls back the entire D1 batch, including a competing scheduler or kiosk write.
 const guard=db.prepare(`UPDATE ${table} SET write_guard=(status=? AND ${timeVersion}=? AND ${payVersion}=? AND ${staffVersion}=? AND ${liveGrant}) WHERE id=?`)
  .bind(row.status,versions.clock,versions.payroll,current.revision,grantKey(row),row.id);
 const result={employees,...(cmd.correction?{reason:cmd.correction.reason}:{})};
 statements.push(db.prepare(`UPDATE ${table} SET status=?,result=?,finished_at=? WHERE id=?`).bind(status,JSON.stringify(result),stamp,row.id));
 await db.batch([guard,...statements]);
 return receipt(db,await readCommand(db,row.id));
}
async function processCommand(env,row){
 try{return await execute(env,row);}catch(error){
  if(!/constraint|UNIQUE|write_guard/i.test(String(error)))throw error;
  return execute(env,await readCommand(env.DB,row.id));
 }
}
export async function saveAttendance(input,env,actor,scopes,grantId){
 check(isAdmin(actor)&&CLOCK_SCOPES.every(s=>scopes.includes(s))&&grantId,'Gee afsonderlike toestemming om te klok.',403);
 const db=env.DB,cmd=normalize(input),body=JSON.stringify(cmd),stamp=new Date().toISOString(),at=cmd.at??stamp;
 check(dayAt(at)>=FRESH_START.start_date,'Die nuwe loonperiode begin op 16 November 2026.');
 const future=at>stamp;
 check(!(future&&cmd.correction),'’n Regstelling kan nie in die toekoms wees nie.');
 const key=keys(env)[actor];check(key,'Hierdie aanmelding is nie meer geldig nie.',403);
 await db.prepare(`INSERT INTO ${table}(id,actor,grant_id,fingerprint,command,effective_at,requested_at,status)
  VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
  .bind(input.request_id,actor,grantId,await hash(key),body,at,stamp,future?'scheduled':'pending').run();
 const row=await readCommand(db,input.request_id);
 check(row.actor===actor&&row.command===body,'Hierdie versoek-ID is reeds vir ’n ander opdrag gebruik.',409);
 return processCommand(env,row);
}
export async function dueAttendance(env){
 const due=()=>env.DB.prepare(`SELECT * FROM ${table} WHERE status='scheduled' AND effective_at<=? ORDER BY effective_at LIMIT 12`).bind(new Date().toISOString()).all();
 let page;
 try{page=await due();}catch(error){
  if(!String(error).includes('no such table: '+table))throw error;
  await initPaStorage(env.DB);page=await due();
 }
 const rows=page.results;
 let failure;
 for(const row of rows){
  try{await processCommand(env,row);}catch(error){failure=error;}
 }
 if(failure)throw failure;
}
export async function openAttendance(db,current){
 const records=(await db.prepare(`SELECT t.employee_id,t.shift_id,t.start_at,t.state,t.revision FROM v2_staff_time t WHERE t.state!='out' AND ${latestCondition} ORDER BY t.start_at`).all()).results;
 return {server_time:new Date().toISOString(),people:records.map(r=>({...r,name:current.state.people.find(p=>p.id===r.employee_id)?.name??null}))};
}
