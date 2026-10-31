import {check,UserError} from './domain.js';
import {hash} from './auth.js';

// Private configuration and an explicit, human-approved outbox. This module never sends mail.
export const MAIL_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_task_report_contacts (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_task_mail (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS v2_task_mail_open ON v2_task_mail(task_id) WHERE status IN ('pending','processing')`
];
const email=v=>typeof v==='string'&&v.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\u0000\u000b\u000c]/.test(v);
const decode=r=>r?{...JSON.parse(r.payload),revision:r.revision}:null;
const taskSnapshot=t=>JSON.stringify([t.title,t.details,t.assigned_to,t.kind,t.po_revision,t.status]);
async function config(env){return decode(await env.DB.prepare('SELECT * FROM v2_task_report_contacts WHERE id=1').first());}
export async function readTaskMail(env,user,query={}){
 check(user.username==='alex','Only Alex can access his email requests.',403);
 const settings=await config(env),offset=Number(query.offset??0);check(Number.isSafeInteger(offset)&&offset>=0&&offset<=100000,'Invalid page.');
 if(query.resource==='report_contacts')return {contacts:settings};
 const r=await env.DB.prepare('SELECT * FROM v2_task_mail ORDER BY updated_at DESC,id LIMIT 101 OFFSET ?').bind(offset).all();
 return {contacts:settings,requests:r.results.slice(0,100).map(decode),next_offset:r.results.length>100?offset+100:null};
}
export async function mailAction(env,user,b,getTask){
 check(user.username==='alex','Only Alex can approve mail from his account.',403);
 const at=new Date().toISOString(),fingerprint=await hash(JSON.stringify({...b,actor:user.username,via:user.via??'app'}));
 if(b.action==='report_contacts'){
  check(user.via==='pa','Contact verification is handled by PA.',403);
  const old=await config(env);
  if(old?.last_request_id===b.request_id){check(old.fingerprint===fingerprint,'Save identifier reused.',409);return {contacts:old,replayed:true};}
  check((old?.revision??0)===b.revision,'Contact details changed. Read them again.',409);
  const d=b.data;check(d&&email(d.from_address)&&clean(d.source_url,2000)&&/^https:\/\/(mail.google.com|docs.google.com)\//.test(d.source_url),'Provide the verified sender and evidence source.');
  check(d.recipients&&Object.keys(d.recipients).every(u=>['alinda','xavier','xalinda'].includes(u))&&Object.values(d.recipients).every(email),'Provide only verified staff email addresses.');
  const value={from_address:d.from_address,recipients:d.recipients,source_url:d.source_url,verified_at:at,last_request_id:b.request_id,fingerprint};
  const result=old?await env.DB.prepare('UPDATE v2_task_report_contacts SET revision=?,payload=? WHERE id=1 AND revision=?').bind(b.revision+1,JSON.stringify(value),b.revision).run():await env.DB.prepare('INSERT OR IGNORE INTO v2_task_report_contacts VALUES(1,1,?)').bind(JSON.stringify(value)).run();
  check(result.meta.changes===1,'Contact details changed. Reload.',409);return {contacts:await config(env)};
 }
 const id=b.action==='queue_email'?b.request_id:b.email_id;
 check(typeof id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(id),'Invalid email request.');
 const old=decode(await env.DB.prepare('SELECT * FROM v2_task_mail WHERE id=?').bind(id).first());
 const prior=old?.history.find(h=>h.request_id===b.request_id);
 if(prior){check(prior.fingerprint===fingerprint,'Save identifier reused.',409);return {email:old,replayed:true};}
 const task=await getTask();check(task,'Task not found.',404);
 if(b.action==='queue_email'){
  check(user.via!=='pa','Only a signed-in human can approve a new email in Daily Report.',403);
  check(!old&&task.revision===b.revision,'The task changed. Reload before sending.',409);
  check(['Pending','Waiting'].includes(task.status),'This task is closed.');
  const settings=await config(env),to=settings?.recipients?.[task.assigned_to];
  check(to&&b.to_address===to&&b.from_address===settings.from_address,'Review the current verified recipient and sender.');
  check(b.confirm_send===true&&clean(b.body,5000),'Review the message and choose Send.');
  const value={id,task_id:task.id,task_revision:task.revision,task_snapshot:taskSnapshot(task),to_user:task.assigned_to,to_address:to,from_address:settings.from_address,subject:`FenMeat task update | ${task.title.replace(/[\r\n]/g,' ')} [FM:${id}]`,body:b.body,approved_by:user.username,approved_at:at,status:'pending',history:[{request_id:b.request_id,fingerprint,at,status:'pending',actor:user.username}]};
  try{await env.DB.prepare('INSERT INTO v2_task_mail VALUES(?,?,1,?,?,?)').bind(id,task.id,'pending',JSON.stringify(value),at).run();}catch{throw new UserError('An email is already queued for this task. Review or cancel it first.',409);}
  return {email:{...value,revision:1},replayed:false};
 }
 check(old&&old.task_id===task.id,'Email request not found.',404);
 check(old.revision===b.revision,'The email status changed. Read it again.',409);
 let status,error='',message_id='',sent_url='';
 if(b.action==='cancel_email'){
  check(user.via!=='pa','Use email_status for PA processing.',403);
  check(old.status==='pending','Only a queued email can be cancelled.');status='cancelled';
 }else{
  check(user.via==='pa','Only PA can record verified delivery.',403);
  status=b.status;
  check({pending:['processing','cancelled'],processing:['sent','failed'],failed:['sent']}[old.status]?.includes(status),'Invalid email status transition.',409);
  if(status==='processing'){
   const settings=await config(env);
   check(taskSnapshot(task)===old.task_snapshot&&settings?.recipients?.[old.to_user]===old.to_address&&settings.from_address===old.from_address,'Task or contact changed. Cancel this request; a new approval is needed.',409);
  }
  if(status==='sent'){
   check(/^[a-f0-9]{8,40}$/.test(b.message_id??'')&&typeof b.sent_url==='string'&&/^https:\/\/mail\.google\.com\//.test(b.sent_url),'Provide the verified Gmail Sent message.');message_id=b.message_id;sent_url=b.sent_url;
  }else if(status==='failed'||status==='cancelled'){check(clean(b.error,500),'Record why this request was stopped.');error=b.error;}
 }
 const value={...old,status,updated_at:at,...(error?{error}:{}),...(status==='sent'?{message_id,sent_url,sent_at:at,error:''}:{}),history:[...old.history,{request_id:b.request_id,fingerprint,at,status,actor:user.username}]};delete value.revision;
 const result=await env.DB.prepare('UPDATE v2_task_mail SET revision=revision+1,status=?,payload=?,updated_at=? WHERE id=? AND revision=?').bind(status,JSON.stringify(value),at,id,b.revision).run();
 check(result.meta.changes===1,'The email status changed. Read it again.',409);return {email:{...value,revision:b.revision+1},replayed:false};
}
