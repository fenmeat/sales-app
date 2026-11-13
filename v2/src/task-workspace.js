import {check,today} from './domain.js';
import {hash,isAdmin} from './auth.js';
import {isInvoiceRep} from './invoice-auth.js';
import {taskUsers,latestSQL,decode,canSeeTask,currentTaskNotification,ensureTaskSchema,getTask} from './tasks-api.js';
import {canSeePa,paUsers,ensurePaReportSchema,readPaReport} from './pa-report-api.js';
import {unifiedWork,selectWork,workCounts} from '../public/pa-report-model.js';

const statuses=new Set(['open','scheduled','waiting','closed','submitted','all']);
const sourceFields=['id','title','kind','task_type','status','revision','pa_task_id','parent_cycle_id','assigned_to','created_by','due_date','review_date','next_action_date','requires_evidence','document_url','pa_sync'];
const brief=t=>({...Object.fromEntries(sourceFields.filter(k=>t[k]!==undefined).map(k=>[k,t[k]])),brief:true});
function compact(row){
 const {last_edit,completion,attachments,last_update,last_reason,feedback_request,...r}=row;
 if(r.steps)r.steps=r.steps.map(({completion,notes,...step})=>step);
 if(r.stages)r.stages=r.stages.map(brief);
 return r;
}
// A paged view of existing events + the existing PA mirror, never another register.
export async function readTaskWorkspace(env,user,query={}){
 check(taskUsers(env).includes(user.username),'This account cannot use Tasks.',403);
 const admin=isAdmin(user.username),rep=isInvoiceRep(user.username),status=query.status||'open',scope=query.scope||'mine',search=String(query.search||'').trim().slice(0,200),offset=Number(query.offset||0),size=25;
 check(statuses.has(status)&&['mine','fenmeat','private','all'].includes(scope),'Choose a task list.');
 check(admin||scope==='mine','Only admins can view other task lists.',403);check(scope!=='private'||user.username==='alex','Private tasks are for Alex only.',403);
 check(Number.isSafeInteger(offset)&&offset>=0&&offset<=100000,'Invalid page.');
 const statements=[env.DB.prepare(latestSQL+(admin?'':" WHERE (json_extract(e.payload,'$.assigned_to')=? OR EXISTS (SELECT 1 FROM json_each(e.payload,'$.steps') st WHERE json_extract(st.value,'$.assigned_to')=?))"))];
 if(!admin)statements[0]=statements[0].bind(user.username,user.username);
 if(!rep)statements.push(env.DB.prepare("SELECT * FROM v2_pa_report_versions WHERE resource_key='register' ORDER BY revision DESC LIMIT 1"),env.DB.prepare(`SELECT f.id,f.subject_key,f.actor,f.created_at,f.acknowledged_at,json_extract(f.payload,'$.action') action,
 instr(COALESCE(json_extract(f.payload,'$.note'),''),'?')>0 question,a.feedback_id answered
 FROM v2_pa_report_feedback f LEFT JOIN v2_pa_report_answers a ON a.feedback_id=f.id
 WHERE json_extract(f.payload,'$.action') IN ('respond','complete') AND NOT EXISTS
 (SELECT 1 FROM v2_pa_report_feedback n WHERE n.subject_key=f.subject_key AND json_extract(n.payload,'$.action') IN ('respond','complete') AND (n.created_at>f.created_at OR (n.created_at=f.created_at AND n.id>f.id))) ORDER BY f.created_at DESC,f.id DESC`));
 const result=await env.DB.batch(statements),tasks=result[0].results.map(decode).filter(t=>canSeeTask(user,t)),raw=result[1]?.results[0];
 const register=raw?JSON.parse(raw.payload):null,canonical=register?.rows.filter(r=>canSeePa(user,r))||[],known=new Set(canonical.map(r=>r.id));
 const feedback=(result[2]?.results||[]).filter(f=>known.has(f.subject_key)).map(f=>({...f,status:f.answered?'answered':f.action==='respond'||f.question?'pending':f.acknowledged_at?'processed':'pending'}));
 const app={username:user.username,admin,invoice_rep:rep,today:today(),users:admin?taskUsers(env):[user.username],suppliers:[],tasks,notifications:[],next_offset:null};
 const pa={username:user.username,admin,users:admin?paUsers(env):[user.username],today:app.today,private_report:user.username==='alex',rabbi_access:!rep&&['alex','alinda','xalinda','xavier'].includes(user.username),register_revision:raw?.revision||0,source_at:register?.source_at||null,source_url:register?.source_url||null,rows:canonical,feedback};
 const rows=unifiedWork(app,pa),selected=selectWork(rows,{username:user.username,admin,scope,status,search}),counts=workCounts(rows,user.username);
 const snapshot=await hash(JSON.stringify({username:user.username,date:app.today,register:raw?.revision||0,tasks:tasks.map(t=>[t.id,t.revision,t.pa_sync]),feedback,scope,status,search}));
 const reset=!!query.snapshot&&query.snapshot!==snapshot,pageOffset=reset?0:offset,items=selected.slice(pageOffset,pageOffset+size);
 const deep=query.case&&rows.find(r=>r.subject_key===query.case||r.id===query.case||r.app_task_id===query.case);
 if(deep&&!items.some(r=>r.id===deep.id))items.push(deep);
 const canonicalById=new Map(canonical.map(r=>[r.id,r])),included=new Set();
 const page=await Promise.all(items.map(async r=>{
  const source=canonicalById.get(r.id),copy=compact(r);
  if(source){copy.subject_key=source.id;copy.subject_hash=await hash(JSON.stringify(source));included.add(source.id);}
  return copy;
 }));
 const pageTasks=new Map();for(const r of items){for(const t of r.stages||[])pageTasks.set(t.id,brief(t));if(!r.is_pa)pageTasks.set(r.id,brief(r));}
 pa.rows=canonical.filter(r=>included.has(r.id)).map(r=>({...r,subject_key:r.id,subject_hash:page.find(p=>p.id===r.id).subject_hash}));
 pa.feedback=[];pa.report=null;pa.history=[];pa.rabbi=null;pa.rabbi_history=[];pa.alerts=[];pa.reminders=[];
 pa.workspace={rows:page,counts,total:selected.length,page_size:size,offset:pageOffset,next_offset:pageOffset+size<selected.length?pageOffset+size:null,snapshot,reset,scope,status,search};
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
 const status=query.status||'open',start=Date.now(),r=await readTaskWorkspace(env,user,{scope:'all',status});
 const detailStart=Date.now(),detail=await getTask(env.DB,'fnb-atm-refunds-20261102-03'),detail_ms=Date.now()-detailStart;
 return {detail_ms,detail_revision:detail?.revision,detail_status:detail?.status,version:'0.41.0',measured_at:new Date().toISOString(),total_ms:detailStart-start,bytes:new TextEncoder().encode(JSON.stringify(r)).length,records:r.pa.workspace.rows.length,total:r.pa.workspace.total,counts:r.pa.workspace.counts,snapshot:r.pa.workspace.snapshot,etag:r.etag};
}
