import {taskOwner} from './task-workflow.js';
import {check,today} from './domain.js';
import {mailSummaries,projectMail} from './pa-email.js';
import {isTaskManager,taskReadScope,taskView} from './task-access.js';
import {hash,isAdmin,keys} from './auth.js';
import {isInvoiceRep} from './invoice-auth.js';
import {taskUsers,latestSQL,decode,currentTaskNotification,ensureTaskSchema,getTask} from './tasks-api.js';
import {workflowState,visiblePaRows,paUsers,ensurePaReportSchema,readPaReport} from './pa-report-api.js';
import {unifiedWork,selectWork,workCounts} from '../public/pa-report-model.js';

const statuses=new Set(['open','scheduled','waiting','closed','complete','cancelled','submitted','all']);
const sourceFields=['pa_followups','conversation_version','id','title','kind','task_type','status','revision','pa_task_id','parent_cycle_id','assigned_to','created_by','due_date','review_date','next_action_date','requires_evidence','document_url','pa_sync','step_only','visibility','priority','can_manage'];
const workStatus=t=>{
 const job=t.pa_work?.find(j=>j.status!=='answered')||t.pa_work?.at(-1);
 return job?.status==='working'&&job.lease_until&&Date.parse(job.lease_until)<=Date.now()?'queued':job?.status;
};
const brief=t=>({...Object.fromEntries(sourceFields.filter(k=>t[k]!==undefined).map(k=>[k,t[k]])),pa_work_status:workStatus(t),brief:true});
function compact(row){
 const {pa_work,last_edit,completion,attachments,last_update,last_reason,feedback_request,...r}=row;
 if(pa_work?.length)r.pa_work_status=workStatus(row);
 if(r.steps)r.steps=r.steps.map(({completion,notes,...step})=>step);
 if(!r.is_pa)r.display_owner=taskOwner(row);
 if(r.stages)r.stages=r.stages.map(brief);
 return r;
}
// A paged view of existing events + the existing PA mirror, never another register.
export async function readTaskWorkspace(env,user,query={}){
 check(taskUsers(env).includes(user.username),'This account cannot use Tasks.',403);
 const admin=isAdmin(user.username),rep=isInvoiceRep(user.username),status=query.status||'open',scope=query.report_default==='1'&&admin?(user.username==='alex'?'all':'fenmeat'):(query.scope||'mine'),search=String(query.search||'').trim().slice(0,200),offset=Number(query.offset||0),size=25;
 check(statuses.has(status)&&['mine','pa','others','fenmeat','private','all'].includes(scope),'Choose a task list.');
 check(admin||['mine','all'].includes(scope)||isTaskManager(user.username)&&['pa','others','fenmeat'].includes(scope),'Only admins can view other task lists.',403);check(scope!=='private'||user.username==='alex','Private tasks are for Alex only.',403);
 check(Number.isSafeInteger(offset)&&offset>=0&&offset<=100000,'Invalid page.');
 const access=taskReadScope(user);
 const statements=[env.DB.prepare(latestSQL+' WHERE '+access.sql).bind(...access.params)];
 if(!rep)statements.push(env.DB.prepare("SELECT * FROM v2_pa_report_versions WHERE resource_key='register' ORDER BY revision DESC LIMIT 1"),env.DB.prepare(`SELECT f.id,f.subject_key,f.actor,f.created_at,f.acknowledged_at,json_extract(f.payload,'$.completion_scope') completion_scope,json_extract(f.payload,'$.action') action,
 instr(COALESCE(json_extract(f.payload,'$.note'),''),'?')>0 question,a.feedback_id answered
 FROM v2_pa_report_feedback f LEFT JOIN v2_pa_report_answers a ON a.feedback_id=f.id
 WHERE json_extract(f.payload,'$.action') IN ('respond','complete') AND NOT EXISTS
 (SELECT 1 FROM v2_pa_report_feedback n WHERE n.subject_key=f.subject_key AND json_extract(n.payload,'$.action') IN ('respond','complete') AND (n.created_at>f.created_at OR (n.created_at=f.created_at AND n.id>f.id))) ORDER BY f.created_at DESC,f.id DESC`));
 const result=await env.DB.batch(statements),tasks=result[0].results.map(row=>taskView(user,decode(row))).filter(Boolean),raw=result[1]?.results[0];
 const register=raw?JSON.parse(raw.payload):null,visibleRows=await visiblePaRows(env,user,register?.rows||[]);
 const mails=user.username==='alex'?await mailSummaries(env.DB):new Map();
 const nativeById=new Map(tasks.map(t=>[t.id,t]));
 const canonical=visibleRows.map(r=>workflowState(projectMail(r,mails.get(r.id),today()),nativeById.get(r.app_task_id))),known=new Set(canonical.map(r=>r.id));
 const feedback=(result[2]?.results||[]).filter(f=>known.has(f.subject_key)).map(f=>({...f,status:f.answered?'answered':f.action==='respond'||f.question?'pending':f.acknowledged_at?'processed':'pending'}));
 const app={username:user.username,admin,task_manager:isTaskManager(user.username),invoice_rep:rep,today:today(),users:isTaskManager(user.username)?taskUsers(env):[user.username],suppliers:[],tasks:tasks.map(t=>{const key='app-'+t.id,m=mails.get(key);return m?{...t,email:projectMail(t,m).email,mail_key:key}:t;}),notifications:[],next_offset:null};
 const pa={username:user.username,admin,users:isTaskManager(user.username)?paUsers(env):[user.username],today:app.today,private_report:user.username==='alex',rabbi_access:!rep&&['alex','alinda','xalinda','xavier'].includes(user.username),register_revision:raw?.revision||0,source_at:register?.source_at||null,source_url:admin?register?.source_url||null:null,rows:canonical,feedback};
 const {person='',date='',priority=''}=query;
 const rows=unifiedWork(app,pa),selected=selectWork(rows,{username:user.username,admin,scope,status,search,person,date,priority}),counts=workCounts(rows,user.username);
 const snapshot=await hash(JSON.stringify({username:user.username,today:app.today,register:raw?.revision||0,tasks:tasks.map(t=>[t.id,t.revision,t.pa_sync]),feedback,mail:[...mails].map(([id,m])=>[id,m.revision]),scope,status,search,person,date,priority}));
 const reset=!!query.snapshot&&query.snapshot!==snapshot,pageOffset=reset?0:offset,items=selected.slice(pageOffset,pageOffset+size);
 const deep=query.case&&rows.find(r=>r.subject_key===query.case||r.id===query.case||r.app_task_id===query.case);
 if(deep&&!items.some(r=>r.id===deep.id))items.push(deep);
 const canonicalById=new Map(canonical.map(r=>[r.id,r])),included=new Set();
 const page=await Promise.all(items.map(async r=>{
  const source=canonicalById.get(r.id),copy=compact(r);
  if(!r.is_pa&&r.pa_does_work){
   const job=r.pa_work?.find(w=>['blocked','approval'].includes(w.status));if(job?.results?.length)copy.work_next_action=job.results.at(-1).next_action;
  }
  if(!r.is_pa)copy.display_progress=r.completion?.note||r.part_confirmation?.note||r.last_update?.text||'';
  if(source){copy.subject_key=source.id;copy.subject_hash=await hash(JSON.stringify(source));included.add(source.id);}
  return copy;
 }));
 // Load only answers for visible page subjects. Report-only replies stay private to Alex.
 const keys=JSON.stringify([...included]);
 if(included.size){
  const replies=await env.DB.prepare("SELECT f.subject_key, f.payload, json_extract(a.payload,'$.text') text, a.created_at FROM v2_pa_report_answers a JOIN v2_pa_report_feedback f ON f.id=a.feedback_id WHERE f.subject_key IN (SELECT value FROM json_each(?)) OR (?='alex' AND EXISTS (SELECT 1 FROM json_each(f.payload,'$.source_task_ids') WHERE value IN (SELECT value FROM json_each(?)))) ORDER BY a.created_at DESC,a.feedback_id DESC").bind(keys,user.username,keys).all();
  const byId=new Map(page.map(r=>[r.id,r]));
  for(const answer of replies.results){
   const sourceIds=user.username==='alex'?JSON.parse(answer.payload).source_task_ids||[]:[];
   for(const key of [answer.subject_key,...sourceIds]){
    const row=byId.get(key);if(row&&!row.latest_answer){row.latest_answer=answer.text;row.latest_answer_at=answer.created_at;}
   }
  }
 }
 for(const row of page){
  const original=items.find(r=>r.id===row.id);
  const results=(original.stages||[original]).flatMap(t=>(t.pa_work||[]).flatMap(j=>j.results||[]));
  const latest=results.sort((a,b)=>b.at.localeCompare(a.at))[0];
  if(original.conversation_version||original.stages?.some(t=>t.conversation_version)){delete row.latest_answer;delete row.latest_work_answer;row.has_conversation=true;continue;}
  if(latest){row.latest_work_answer=latest.answer;if(!row.latest_answer||Date.parse(latest.at)>Date.parse(row.latest_answer_at))row.latest_answer=latest.answer;}
 }
 const pageTasks=new Map();for(const r of items){for(const t of r.stages||[])pageTasks.set(t.id,brief(t));if(!r.is_pa)pageTasks.set(r.id,brief(r));}
 const sources=canonical.filter(r=>included.has(r.id));
 // Cards already carry display fields. A link can fetch the full current subject on demand.
 pa.rows=query.compact==='1'?sources.map(r=>({id:r.id,subject_key:r.id,app_task_id:r.app_task_id,title:r.title})):
  sources.map(r=>({...r,subject_key:r.id,subject_hash:page.find(p=>p.id===r.id).subject_hash}));
 pa.feedback=[];pa.report=null;pa.history=[];pa.rabbi=null;pa.rabbi_history=[];pa.alerts=[];pa.reminders=[];
 pa.workspace={rows:page,counts,total:selected.length,page_size:size,offset:pageOffset,next_offset:pageOffset+size<selected.length?pageOffset+size:null,snapshot,reset,scope,status,search,person,date,priority};
 app.tasks=[...pageTasks.values()];
 const payload={app,pa},etag='"'+await hash(JSON.stringify(payload))+'"';
 return {...payload,etag};
}
export async function taskOptions(env,user){
 const r=isInvoiceRep(user.username)?null:await env.DB.prepare('SELECT payload FROM v2_recipe_events ORDER BY revision DESC LIMIT 1').first();
 return {suppliers:r?[...new Set(JSON.parse(r.payload).materials.filter(m=>m.procure&&m.resale_available!==false).map(m=>m.supplier.trim().toLowerCase()))].sort():[]};
}
export async function taskInbox(env,user){
 const [notifications,pa]=await Promise.all([
  env.DB.prepare(`SELECT n.id,n.username,n.task_id,n.kind,n.created_at,n.read_at,e.payload FROM v2_task_notifications n JOIN v2_task_events e ON e.task_id=n.task_id AND e.revision=(SELECT MAX(revision) FROM v2_task_events WHERE task_id=n.task_id) WHERE n.username=? AND n.read_at IS NULL ORDER BY n.created_at DESC LIMIT 100`).bind(user.username).all(),
  isInvoiceRep(user.username)?Promise.resolve({alerts:[],reminders:[]}):readPaReport(env,user,{view:'inbox'})
 ]);
 return {username:user.username,notifications:notifications.results.filter(n=>currentTaskNotification(JSON.parse(n.payload),n)).map(({payload,username,...n})=>n),...pa};
}
export async function workspaceDiagnostic(env,user,query={}){
 check(user.username==='alex','Only Alex can inspect Tasks performance.',403);
 await Promise.all([ensureTaskSchema(env.DB),ensurePaReportSchema(env.DB)]);
 const status=query.status||'open',start=Date.now(),r=await readTaskWorkspace(env,user,{scope:'all',status,compact:'1'});
 const detailStart=Date.now(),detail=await getTask(env.DB,'fnb-atm-refunds-20261102-03'),detail_ms=Date.now()-detailStart;
 return {detail_ms,detail_revision:detail?.revision,detail_status:detail?.status,version:'0.58.1',measured_at:new Date().toISOString(),total_ms:detailStart-start,bytes:new TextEncoder().encode(JSON.stringify(r)).length,records:r.pa.workspace.rows.length,total:r.pa.workspace.total,counts:r.pa.workspace.counts,snapshot:r.pa.workspace.snapshot,etag:r.etag};
}

// Read-only release check on the deployed Worker. Return counts only.
export async function taskAccessSummary(env,user){
 check(user.username==='alex','Slegs Alex kan die toegangsoorsig lees.',403);
 await ensureTaskSchema(env.DB);
 const all=(await env.DB.prepare(latestSQL).all()).results.map(decode);
 const summaries=[];
 const register=await env.DB.prepare("SELECT payload FROM v2_pa_report_versions WHERE resource_key='register' ORDER BY revision DESC LIMIT 1").first();
 const paRows=register?JSON.parse(register.payload).rows:[];
 for(const username of [...new Set([...Object.keys(keys(env)),...taskUsers(env),'musa'])].sort()){
  const registered=taskUsers(env).includes(username),actor={username},scope=taskReadScope(actor);
  const found=(await env.DB.prepare(latestSQL+' WHERE '+scope.sql).bind(...scope.params).all()).results;
  const actual=new Set(found.map(row=>row.task_id)),visible=all.map(t=>taskView(actor,t)).filter(Boolean);
  const matches=visible.length===actual.size&&visible.every(t=>actual.has(t.id));
  const pa=await visiblePaRows(env,actor,paRows);
  summaries.push({username,registered,canonical_username:username==='musa'?'mosa':username,private_tasks:visible.filter(t=>t.visibility==='private').length,private_pa_rows:pa.filter(r=>r.scope==='private').length,task_manager:isTaskManager(username),admin:isAdmin(username),matches,
   ordinary:visible.filter(t=>t.visibility==='operational').length,
   confidential:visible.filter(t=>t.visibility==='confidential').length,step_only:visible.filter(t=>t.step_only).length});
 }
 return {verification:'server_policy_evaluation_not_user_login',private_tasks:all.filter(t=>t.visibility==='private').length,private_pa_rows:paRows.filter(r=>r.scope==='private').length,tasks:all.length,operational:all.filter(t=>taskView(user,t).visibility==='operational').length,users:summaries};
}
