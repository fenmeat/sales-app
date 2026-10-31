import {check,UserError,dateKey,today} from './domain.js';
import {isAdmin,keys,hash} from './auth.js';
import {MAIL_SCHEMA,mailAction,readTaskMail} from './tasks-mail.js';

export const TASK_SCHEMA=[
 ...MAIL_SCHEMA,
 `CREATE TABLE IF NOT EXISTS v2_task_events (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, task_id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(task_id,revision))`,
 `CREATE INDEX IF NOT EXISTS v2_tasks_latest ON v2_task_events(task_id,revision DESC)`,
 `CREATE TABLE IF NOT EXISTS v2_task_po_links (parent_cycle_id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE)`,
 `CREATE TABLE IF NOT EXISTS v2_task_sync (task_id TEXT PRIMARY KEY, acknowledged_revision INTEGER NOT NULL DEFAULT 0, pa_task_id TEXT, source_url TEXT, synced_at TEXT, last_error TEXT)`,
 `CREATE TABLE IF NOT EXISTS v2_task_notifications (id TEXT PRIMARY KEY, username TEXT NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, push_sent_at TEXT, push_attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT)`,
 `CREATE INDEX IF NOT EXISTS v2_task_notifications_user ON v2_task_notifications(username,created_at)`,
 `CREATE TABLE IF NOT EXISTS v2_task_count_receipts (request_id TEXT PRIMARY KEY, supplier TEXT NOT NULL, count_date TEXT NOT NULL, material_ids TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_task_push_keys (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_task_push_subscriptions (endpoint_hash TEXT PRIMARY KEY, username TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_task_attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, username TEXT NOT NULL, mime_type TEXT NOT NULL, filename TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL)`
];
export const ensureTaskSchema=db=>db.batch(TASK_SCHEMA.map(s=>db.prepare(s)));
export const taskUsers=env=>Object.keys(keys(env)).filter(u=>!['tapiz','mosa','musa'].includes(u)).sort();
const ID=/^[a-zA-Z0-9-]{8,90}$/,PA_ID=/^TSK-\d{5,}$/;
const statusSet=new Set(['Pending','Waiting','Complete','Cancelled']);
const reminderFields=['reminder_mode','reminder_at'];
const editable=['title','details','assigned_to','due_date','review_date','priority','kind','supplier','required_materials','po_number','po_revision','document_url','source_url','parent_cycle_id','pa_task_id','requires_evidence',...reminderFields];
const selfEditable=['title','details','assigned_to','due_date','review_date','priority','kind','supplier','document_url','requires_evidence',...reminderFields];
export const managesOwnTask=(user,task)=>task.created_by===user.username&&task.assigned_to===user.username&&task.kind!=='po_dispatch';
const latestSQL=`SELECT e.*,s.acknowledged_revision,s.pa_task_id AS synced_pa_task_id,s.source_url AS synced_source_url,s.synced_at,s.last_error FROM v2_task_events e JOIN (SELECT task_id,MAX(revision) revision FROM v2_task_events GROUP BY task_id) l ON e.task_id=l.task_id AND e.revision=l.revision LEFT JOIN v2_task_sync s ON s.task_id=e.task_id`;
const text=(value,max,required=false)=>{check(typeof value==='string'&&value.length<=max&&(!required||value.trim()),'Enter the required task details.');return value.trim();};
const optionalText=(v,max)=>v===null||v===undefined?'':text(v,max);
function safeURL(value){if(!value)return '';let u;try{u=new URL(value);}catch{throw new UserError('Enter a complete secure document link.');}check(u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=2000,'Use a secure document link.');return u.href;}
function decode(row){if(!row)return null;return {...JSON.parse(row.payload),revision:row.revision,updated_at:row.saved_at,updated_by:row.actor,pa_task_id:row.synced_pa_task_id||JSON.parse(row.payload).pa_task_id||'',pa_sync:{acknowledged_revision:row.acknowledged_revision??0,status:(row.acknowledged_revision??0)>=row.revision?'synced':'pending',synced_at:row.synced_at??null,error:row.last_error??null}};}
export async function getTask(db,id){check(ID.test(id),'Invalid task.');return decode(await db.prepare(latestSQL+' WHERE e.task_id=?').bind(id).first());}
function canSee(user,task){return isAdmin(user.username)||task.assigned_to===user.username;}
export function currentTaskNotification(task,n,now=new Date()){
 if(!task||!canSee({username:n.username},task))return false;
 if(n.kind==='follow_up'){
  const when=task.followup_reminders?.[n.username];
  return openTask(task)&&isAdmin(n.username)&&!!when&&n.id==='followup-'+task.id+'-'+n.username+'-'+Math.floor(Date.parse(when)/1000)&&Date.parse(when)<=now.getTime();
 }
 if(n.kind==='update_requested')return openTask(task)&&task.feedback_request?.status==='pending'&&task.feedback_request.to===n.username&&n.id===task.feedback_request.id+'-'+n.username;
 if(n.kind!=='due')return true;
 if(!openTask(task)||n.username!==task.assigned_to)return false;
 const mode=task.reminder_mode??'daily';
 if(mode==='off')return false;
 const date=new Date(now.getTime()+7200000).toISOString().slice(0,10);
 const id=mode==='once'?'reminder-once-'+task.id+'-'+Math.floor(Date.parse(task.reminder_at)/1000):'reminder-'+task.id+'-'+date;
 const due=task.status==='Waiting'?task.review_date:task.due_date||task.review_date;
 return n.id===id&&(mode==='once'?Date.parse(task.reminder_at)<=now.getTime():!!due&&due<=date);
}
function visible(user,task){check(task&&canSee(user,task),'Task not found.',404);return task;}
export async function listTasks(env,user,query={}){
 check(taskUsers(env).includes(user.username),'This account cannot use Tasks.',403);
 const offset=Number(query.offset??0);check(Number.isSafeInteger(offset)&&offset>=0&&offset<=100000,'Invalid page.');
 const conditions=[],params=[];
 if(!isAdmin(user.username)||query.mine){conditions.push('json_extract(e.payload,\'$.assigned_to\')=?');params.push(user.username);}
 if(query.pending_sync){check(isAdmin(user.username),'Only admins can synchronise PA tasks.',403);conditions.push('COALESCE(s.acknowledged_revision,0)<e.revision');}
 const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
 const result=await env.DB.prepare(latestSQL+where+' ORDER BY e.saved_at DESC,e.task_id LIMIT 101 OFFSET ?').bind(...params,offset).all();
 const notifications=await env.DB.prepare(`SELECT n.id,n.username,n.task_id,n.kind,n.created_at,n.read_at,e.payload FROM v2_task_notifications n JOIN v2_task_events e ON e.task_id=n.task_id AND e.revision=(SELECT MAX(revision) FROM v2_task_events WHERE task_id=n.task_id) WHERE n.username=? ORDER BY n.created_at DESC LIMIT 100`).bind(user.username).all();
 const register=await env.DB.prepare('SELECT payload FROM v2_recipe_events ORDER BY revision DESC LIMIT 1').first();
 const suppliers=register?[...new Set(JSON.parse(register.payload).materials.filter(m=>m.procure&&m.resale_available!==false).map(m=>m.supplier.trim().toLowerCase()))].sort():[];
 return {username:user.username,admin:isAdmin(user.username),today:today(),users:isAdmin(user.username)?taskUsers(env):[user.username],suppliers,tasks:result.results.slice(0,100).map(decode),next_offset:result.results.length>100?offset+100:null,notifications:notifications.results.filter(n=>currentTaskNotification(JSON.parse(n.payload),n)).map(({payload,username,...n})=>n)};
}
function validateReminder(task){
 const t={...task,reminder_mode:task.reminder_mode??'daily'};
 check(['daily','once','off'].includes(t.reminder_mode),'Choose a reminder option.');
 if(t.reminder_mode==='once'){
  check(typeof t.reminder_at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(t.reminder_at)&&Number.isFinite(Date.parse(t.reminder_at))&&new Date(t.reminder_at).toISOString()===t.reminder_at,'Choose a valid reminder date and time.');
 }else t.reminder_at='';
 return t;
}
function validateTask(raw,env){
 const t=validateReminder(raw);t.title=text(t.title,180,true);t.details=optionalText(t.details,5000);
 check(taskUsers(env).includes(t.assigned_to),'Choose a current app user.');
 check(['general','stocktake','po_dispatch'].includes(t.kind),'Choose a task type.');
 check(['Critical','High','Normal','Low'].includes(t.priority),'Choose a priority.');
 t.due_date=t.due_date?dateKey(t.due_date):'';t.review_date=t.review_date?dateKey(t.review_date):'';
 check(t.due_date||t.review_date,'Set a due date or a review date.');
 t.document_url=safeURL(t.document_url);t.source_url=safeURL(t.source_url);
 t.pa_task_id=optionalText(t.pa_task_id,40);t.parent_cycle_id=optionalText(t.parent_cycle_id,40);
 check(!t.pa_task_id||PA_ID.test(t.pa_task_id),'Invalid PA task link.');check(!t.parent_cycle_id||PA_ID.test(t.parent_cycle_id),'Invalid parent cycle.');
 t.requires_evidence=!!t.requires_evidence;t.supplier=optionalText(t.supplier,120).toLowerCase();
 t.required_materials=t.required_materials??[];check(Array.isArray(t.required_materials)&&t.required_materials.length<=300&&t.required_materials.every(x=>typeof x==='string'&&/^[A-Z0-9_-]{1,40}$/.test(x)),'Invalid stocktake materials.');t.required_materials=[...new Set(t.required_materials)];
 t.po_number=optionalText(t.po_number,30);t.po_revision=optionalText(t.po_revision,80);
 if(t.kind==='po_dispatch'){check(/^PO-\d{3,6}(?:\/[A-Z])?$/.test(t.po_number)&&t.document_url&&t.po_revision&&t.parent_cycle_id,'A dispatch task needs its approved PO, document revision and existing PA cycle.');}
 if(t.kind==='stocktake'){check(t.supplier&&t.due_date,'A stocktake needs a supplier and count date.');check(['alex','alinda','xavier','xalinda'].includes(t.assigned_to),'Choose a user with Stocktake access.');check(!t.requires_evidence,'A stocktake uses its complete saved count as evidence. Use a separate general task if an additional photo is needed.');}
 return t;
}
function notification(db,requestId,username,task,kind,at){return db.prepare('INSERT INTO v2_task_notifications(id,username,task_id,kind,created_at) VALUES(?,?,?,?,?)').bind(requestId+'-'+username,username,task.id,kind,at);}
export async function saveTask(env,user,b){
 check(taskUsers(env).includes(user.username),'This account cannot use Tasks.',403);
 check(b&&ID.test(b.request_id??'')&&ID.test(b.task_id??''),'Use a valid save identifier.');
 check(Number.isSafeInteger(b.revision)&&b.revision>=0,'Read the task before saving.');
 if(['report_contacts','queue_email','email_status','cancel_email'].includes(b.action))return mailAction(env,user,b,()=>getTask(env.DB,b.task_id));
 const fingerprint=await hash(JSON.stringify({...b,actor:user.username}));
 const prior=await env.DB.prepare('SELECT fingerprint,task_id,revision FROM v2_task_events WHERE request_id=?').bind(b.request_id).first();
 if(prior){check(prior.fingerprint===fingerprint,'This save identifier belongs to a different action.',409);return {task:visible(user,await getTask(env.DB,prior.task_id)),replayed:true};}
 const old=await getTask(env.DB,b.task_id),admin=isAdmin(user.username),at=new Date().toISOString();
 if(old)visible(user,old);
 check((old?.revision??0)===b.revision,'This task changed. Reload before saving.',409);
 const action=b.action??'create';let task=old?structuredClone(old):null;
 if(action==='create'){
  check(!old,'This task already exists.',409);
  check(b.data&&Object.keys(b.data).every(k=>editable.includes(k)||k==='area'),'Unknown task field.');check(!b.data.area||b.data.area==='Fen Meat','Personal PA matters cannot be imported into FenMeat.');
  if(!admin){check(!b.data.assigned_to||b.data.assigned_to===user.username,'You can only create tasks for yourself.',403);check(Object.keys(b.data).every(k=>selfEditable.includes(k)||k==='area')&&['general','stocktake'].includes(b.data.kind??'general'),'Only admins can create linked PA or PO tasks.',403);}
  task=validateTask({kind:'general',priority:'Normal',assigned_to:user.username,...b.data,id:b.task_id,area:'Fen Meat',status:'Pending',created_by:user.username,created_at:at,completion:null,waiting_reason:''},env);
  if(task.kind==='stocktake'&&!task.required_materials.length){
   const register=await env.DB.prepare('SELECT payload FROM v2_recipe_events ORDER BY revision DESC LIMIT 1').first();
   const materials=register?JSON.parse(register.payload).materials:[];
   task.required_materials=materials.filter(m=>m.supplier.trim().toLowerCase()===task.supplier&&m.procure&&m.resale_available!==false).map(m=>m.id);
   check(task.required_materials.length,'No stocktake materials were found for this supplier.');
  }
  if(task.kind==='po_dispatch'){
   const duplicate=await env.DB.prepare(latestSQL+" WHERE json_extract(e.payload,'$.parent_cycle_id')=? AND json_extract(e.payload,'$.kind')='po_dispatch' LIMIT 1").bind(task.parent_cycle_id).first();
   check(!duplicate,'This PO cycle already has a dispatch task. Update its existing revision.',409);
  }
 }else{
  check(old,'Task not found.',404);
  if(action==='update'){
   check(admin||managesOwnTask(user,old),'Only admins can change tasks assigned by someone else. You can change your reminder.',403);check(b.data&&Object.keys(b.data).every(k=>(admin?editable:selfEditable).includes(k)),'Unknown task field.');
   if(!admin)check(!Object.hasOwn(b.data,'assigned_to')||b.data.assigned_to===user.username,'You can only keep tasks assigned to yourself.',403);
   check(!['Complete','Cancelled'].includes(old.status),'Reopen this task before changing its instructions.');
   task=validateTask({...old,...b.data},env);
   check(task.kind===old.kind&&task.parent_cycle_id===old.parent_cycle_id&&task.pa_task_id===old.pa_task_id,'Keep the existing task type and PA identity.');
  }else if(action==='reminder'){
   check(openTask(old),'Reopen this task before changing its reminder.');
   check(b.data&&Object.keys(b.data).length&&Object.keys(b.data).every(k=>reminderFields.includes(k)),'Only reminder fields can be changed here.');
   task=validateReminder({...old,...b.data});
  }else if(action==='followup_reminder'){
   check(admin,'Only admins can follow up another person’s task.',403);
   check(openTask(old),'Reopen this task before setting a follow-up.');
   check(b.data&&Object.keys(b.data).length===1&&Object.hasOwn(b.data,'reminder_at')&&typeof b.data.reminder_at==='string','Choose your follow-up time.');
   const when=validateReminder({reminder_mode:b.data.reminder_at?'once':'off',reminder_at:b.data.reminder_at}).reminder_at;
   check(!when||Date.parse(when)>Date.parse(at),'Choose a reminder time in the future.');
   task.followup_reminders={...old.followup_reminders};
   if(when)task.followup_reminders[user.username]=when;else delete task.followup_reminders[user.username];
  }else if(action==='complete'){
   check(old.status==='Pending'||old.status==='Waiting','This task is already closed.');
   const note=optionalText(b.note,2000),proof_url=safeURL(b.proof_url),attachments=Array.isArray(b.attachments)?b.attachments:[];
   check(attachments.length<=4&&attachments.every(x=>ID.test(x)),'Invalid attachments.');
   for(const id of attachments){const file=await env.DB.prepare('SELECT task_id FROM v2_task_attachments WHERE id=?').bind(id).first();check(file?.task_id===task.id,'An attachment belongs to another task.');}
   check(!task.requires_evidence||proof_url||attachments.length,'Attach the required completion evidence.');
   const completion={by:user.username,at,note,proof_url,attachments};
   if(task.kind==='po_dispatch'){
    check(admin,'An admin must confirm PO sending.',403);check(b.po_revision===task.po_revision,'The approved PO changed. Open the current document first.',409);
    check(['Email','WhatsApp','Other'].includes(b.channel),'Choose how you sent the PO.');
    check(typeof b.sent_at==='string'&&Number.isFinite(Date.parse(b.sent_at))&&Date.parse(b.sent_at)<=Date.now()+60000,'Enter the actual sending time.');
    completion.sent_at=new Date(b.sent_at).toISOString();completion.channel=b.channel;completion.po_revision=task.po_revision;completion.owner_confirmation=true;
   }
   if(task.kind==='stocktake'){
    check(ID.test(b.stocktake_request_id??''),'Save the supplier count before completing this task.');
    const event=await env.DB.prepare('SELECT r.*,e.revision FROM v2_task_count_receipts r JOIN v2_recipe_events e ON e.request_id=r.request_id WHERE r.request_id=?').bind(b.stocktake_request_id).first();
    check(event&&event.actor===task.assigned_to&&event.saved_at>=task.created_at,'Use the assigned person’s saved count for this task.');
    check(event.supplier===task.supplier&&event.count_date===task.due_date,'The count must match this supplier and requested count date.');
    const counted=JSON.parse(event.material_ids);
    check(task.required_materials.length&&task.required_materials.every(id=>counted.includes(id)),'Save all requested material counts together before completing this task.');
    completion.stocktake={request_id:event.request_id,revision:event.revision,date:task.due_date,supplier:task.supplier};
   }
   task.status='Complete';task.completion=completion;task.waiting_reason='';
   if(task.feedback_request?.status==='pending')task.feedback_request={...task.feedback_request,status:'answered',answered_at:at,answer:'complete',note};
  }else if(action==='request_update'){
   check(admin&&old.assigned_to!==user.username,'An admin can request an update from another task owner.',403);
   check(openTask(old),'This task is already closed.');
   check(old.feedback_request?.status!=='pending','An update has already been requested. Wait for the reply.',409);
   task.feedback_request={id:b.request_id,by:user.username,to:old.assigned_to,at,status:'pending',question:text(b.note,1000,true)};
  }else if(action==='respond'||action==='note'){
   check(openTask(old),'Reopen this task before adding an update.');
   if(action==='respond'){
    check(old.feedback_request?.status==='pending'&&old.feedback_request.to===user.username,'There is no current update request for you.',409);
    check(['in_progress','blocked'].includes(b.response),'Choose a response.');
    if(b.response==='blocked'){task.waiting_reason=text(b.note,2000,true);task.review_date=dateKey(b.review_date);task.status='Waiting';}
    task.feedback_request={...old.feedback_request,status:'answered',answered_at:at,answer:b.response,note:optionalText(b.note,2000)};
   }
   task.last_update={by:user.username,at,kind:action==='respond'?b.response:'note',text:action==='respond'&&b.response==='in_progress'?(optionalText(b.note,2000)||'Work is in progress.'):text(b.note,2000,true)};
  }else if(action==='undo_complete'){
   check(old.kind==='general'&&old.status==='Complete'&&old.completion?.by===user.username,'Only your own recent general-task completion can be undone.',403);
   const event=await env.DB.prepare('SELECT action,payload FROM v2_task_events WHERE task_id=? AND revision=?').bind(old.id,old.revision).first();
   check(event?.action==='complete'&&Date.parse(at)-Date.parse(old.completion.at)<=300000,'This completion can no longer be undone. Ask an admin to reopen it.',409);
   const before=await env.DB.prepare('SELECT payload FROM v2_task_events WHERE task_id=? AND revision=?').bind(old.id,old.revision-1).first();
   check(before,'The earlier task could not be found.',409);task=JSON.parse(before.payload);task.last_update={by:user.username,at,kind:'undo_complete',text:'Completion undone.'};
  }else if(action==='wait'){
   check(!['Complete','Cancelled'].includes(task.status),'Reopen this task first.');task.waiting_reason=text(b.note,2000,true);task.review_date=dateKey(b.review_date);task.status='Waiting';
  }else if(action==='reopen'||action==='cancel'){
   check(admin||managesOwnTask(user,old),'Only admins can reopen or cancel tasks assigned by someone else.',403);text(b.note,2000,true);task.status=action==='reopen'?'Pending':'Cancelled';task.last_reason=b.note;task.completion=null;
  }else throw new UserError('Unsupported task action.');
 }
 if(old?.assigned_to!==task.assigned_to&&task.feedback_request?.status==='pending')task.feedback_request={...task.feedback_request,status:'cancelled',cancelled_at:at};
 check(statusSet.has(task.status),'Invalid task status.');
 if(task.reminder_mode==='once'&&(!old||old.reminder_mode!=='once'||old.reminder_at!==task.reminder_at))check(Date.parse(task.reminder_at)>Date.parse(at),'Choose a reminder time in the future.');
 for(const key of ['revision','updated_at','updated_by','pa_sync'])delete task[key];
 const revision=b.revision+1;
 const statements=[env.DB.prepare('INSERT INTO v2_task_events(request_id,fingerprint,task_id,revision,action,payload,actor,saved_at) VALUES(?,?,?,?,?,?,?,?)').bind(b.request_id,fingerprint,task.id,revision,action,JSON.stringify(task),user.username,at)];
 if(action==='create'&&task.kind==='po_dispatch')statements.push(env.DB.prepare('INSERT INTO v2_task_po_links VALUES(?,?)').bind(task.parent_cycle_id,task.id));
 if(action==='create'||old?.assigned_to!==task.assigned_to)statements.push(notification(env.DB,b.request_id,task.assigned_to,task,'assigned',at));
 else if(['complete','wait'].includes(action))statements.push(notification(env.DB,b.request_id,task.created_by,task,action==='complete'?'completed':'waiting',at));
 else if(['update','reopen','cancel','undo_complete'].includes(action))statements.push(notification(env.DB,b.request_id,task.assigned_to,task,action,at));
 if(action==='request_update')statements.push(notification(env.DB,b.request_id,task.assigned_to,task,'update_requested',at));
 const recipients=new Set();
 if(['respond','note'].includes(action))recipients.add(task.created_by);
 if(['respond','note','complete','undo_complete'].includes(action)&&old?.feedback_request)recipients.add(old.feedback_request.by);
 for(const recipient of recipients)if(recipient!==user.username&&!(action==='complete'&&recipient===task.created_by)&&canSee({username:recipient},task))statements.push(notification(env.DB,b.request_id,recipient,task,'response',at));
 try{await env.DB.batch(statements);}catch{throw new UserError('This task changed while saving. Reload; your previous work is safe.',409);}
 return {task:await getTask(env.DB,task.id),replayed:false};
}
export async function acknowledgeTask(env,user,b){
 check(isAdmin(user.username),'Only admins can synchronise PA.',403);
 const t=await getTask(env.DB,b.task_id);check(t&&b.revision===t.revision,'Read the current task before confirming its PA update.',409);
 check(PA_ID.test(b.pa_task_id??''),'Provide the existing PA task ID.');const source=safeURL(b.source_url);check(source.startsWith('https://docs.google.com/spreadsheets/'),'Provide the verified PA register row.');
 check(!t.pa_task_id||t.pa_task_id===b.pa_task_id,'Do not replace an existing PA task identity.');
 check(!t.parent_cycle_id||t.parent_cycle_id===b.pa_task_id,'A PO step must remain linked to its existing cycle.');
 await env.DB.prepare('INSERT INTO v2_task_sync(task_id,acknowledged_revision,pa_task_id,source_url,synced_at,last_error) VALUES(?,?,?,?,?,NULL) ON CONFLICT(task_id) DO UPDATE SET acknowledged_revision=MAX(acknowledged_revision,excluded.acknowledged_revision),pa_task_id=excluded.pa_task_id,source_url=excluded.source_url,synced_at=excluded.synced_at,last_error=NULL').bind(t.id,b.revision,b.pa_task_id,source,new Date().toISOString()).run();
 return {task:await getTask(env.DB,t.id)};
}
export async function completeCountTasks(env,user,count){
 const rows=await env.DB.prepare(latestSQL+" WHERE json_extract(e.payload,'$.kind')='stocktake' AND json_extract(e.payload,'$.status') IN ('Pending','Waiting') AND json_extract(e.payload,'$.assigned_to')=?").bind(user.username).all();
 const completed=[];
 for(const row of rows.results){const task=decode(row);if(task.supplier!==count.supplier.toLowerCase()||task.due_date!==count.date)continue;
  try{const result=await saveTask(env,user,{task_id:task.id,revision:task.revision,request_id:await hash('count-task:'+task.id+':'+count.request_id),action:'complete',stocktake_request_id:count.request_id,note:'Completed from the saved supplier count.'});completed.push(result.task.id);}catch(e){if(!(e instanceof UserError))throw e;}
 }
 return completed;
}
export async function tasksApi({request,url,env,user,bodyOf}){
 const path=url.pathname;
 check(taskUsers(env).includes(user.username),'This account cannot use Tasks.',403);
 if(path==='/api/tasks/emails'&&request.method==='GET')return readTaskMail(env,user);
 if(path==='/api/tasks'&&request.method==='GET')return listTasks(env,user,{offset:url.searchParams.get('offset')??0,mine:url.searchParams.get('mine')==='1'});
 if(path==='/api/tasks/file'&&request.method==='GET'){
  const id=url.searchParams.get('id');check(ID.test(id??''),'Invalid attachment.');
  const file=await env.DB.prepare('SELECT * FROM v2_task_attachments WHERE id=?').bind(id).first();check(file,'Attachment not found.',404);visible(user,await getTask(env.DB,file.task_id));
  return new Response(file.bytes,{headers:{'Content-Type':file.mime_type,'Content-Disposition':'inline; filename="'+file.filename+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='/api/tasks/audit'&&request.method==='GET'){
  const task=visible(user,await getTask(env.DB,url.searchParams.get('id')??''));
  const rows=await env.DB.prepare('SELECT revision,action,actor,saved_at,payload FROM v2_task_events WHERE task_id=? ORDER BY revision DESC LIMIT 100').bind(task.id).all();return {task,history:rows.results.map(({payload,...r})=>({...r,task:JSON.parse(payload)}))};
 }
 check(request.method==='POST','Method not allowed.',405);const b=await bodyOf(request);
 if(path==='/api/tasks/check-count'){
  const task=visible(user,await getTask(env.DB,b.task_id));check(task.kind==='stocktake'&&openTask(task),'Choose an open stocktake.');
  const receipts=await env.DB.prepare('SELECT request_id FROM v2_task_count_receipts WHERE actor=? AND supplier=? AND count_date=? AND saved_at>=? ORDER BY saved_at DESC LIMIT 5').bind(task.assigned_to,task.supplier,task.due_date,task.created_at).all();
  let last;for(const r of receipts.results){try{return await saveTask(env,{username:task.assigned_to},{task_id:task.id,revision:task.revision,request_id:await hash('count-task:'+task.id+':'+r.request_id),action:'complete',stocktake_request_id:r.request_id,note:'Completed from the saved supplier count.'});}catch(e){if(!(e instanceof UserError))throw e;last=e;}}
  throw last??new UserError('No complete count by the assigned person has been saved for the requested date. Open Stocktake and save all requested materials.');
 }
 if(path==='/api/tasks/file'){
  const task=visible(user,await getTask(env.DB,b.task_id));check(!['Complete','Cancelled'].includes(task.status),'Reopen the task before adding evidence.');
  check(ID.test(b.id??'')&&['image/jpeg','image/png','application/pdf'].includes(b.mime_type),'Use a JPG, PNG or PDF attachment.');
  check(typeof b.base64==='string'&&b.base64.length<=700000&&/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64),'Keep each attachment smaller than 500 KB.');
  let bytes;try{bytes=Uint8Array.from(atob(b.base64),c=>c.charCodeAt(0));}catch{throw new UserError('Invalid attachment.');}
  check(bytes.length>0&&bytes.length<=500000,'Keep each attachment smaller than 500 KB.');
  const signature=b.mime_type==='application/pdf'?String.fromCharCode(...bytes.slice(0,5))==='%PDF-':b.mime_type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  check(signature,'The file contents do not match its type.');
  const old=await env.DB.prepare('SELECT task_id FROM v2_task_attachments WHERE id=?').bind(b.id).first();if(old){check(old.task_id===task.id,'Attachment identifier already used.',409);return {id:b.id};}
  const count=await env.DB.prepare('SELECT COUNT(*) n FROM v2_task_attachments WHERE task_id=?').bind(task.id).first();check(count.n<12,'This task already has twelve attachments.');
  const filename=optionalText(b.filename,100).replace(/[^a-zA-Z0-9._-]/g,'_')||'evidence';
  await env.DB.prepare('INSERT INTO v2_task_attachments VALUES(?,?,?,?,?,?,?)').bind(b.id,task.id,user.username,b.mime_type,filename,bytes,new Date().toISOString()).run();return {id:b.id};
 }
 if(path==='/api/tasks')return saveTask(env,user,b);
 if(path==='/api/tasks/read'){check(/^[a-zA-Z0-9_-]{8,140}$/.test(b.id??''),'Invalid notification.');await env.DB.prepare('UPDATE v2_task_notifications SET read_at=? WHERE id=? AND username=?').bind(new Date().toISOString(),b.id,user.username).run();return {saved:true};}
 throw new UserError('Task endpoint not found.',404);
}
function openTask(task){return ['Pending','Waiting'].includes(task.status);}
export async function readTasksForPa(env,user,query={}){
 await ensureTaskSchema(env.DB);check(isAdmin(user.username),'Only admins can read PA task integration.',403);
 if(query.resource==='email_requests'||query.resource==='report_contacts')return readTaskMail(env,user,query);
 if(query.task_id){const task=await getTask(env.DB,query.task_id);check(task,'Task not found.',404);return {task};}
 return listTasks(env,user,{pending_sync:query.resource==='pending_sync',offset:query.offset??0});
}
