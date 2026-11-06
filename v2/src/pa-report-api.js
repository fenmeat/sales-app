import {check,UserError,dateKey,today} from './domain.js';
import {hash,isAdmin,keys} from './auth.js';

// A versioned read model of the existing PA register, never a second master.
// Private records and the complete email report are filtered on the server.
export const PA_REPORT_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_pa_report_versions (resource_key TEXT NOT NULL,revision INTEGER NOT NULL,request_id TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,saved_at TEXT NOT NULL,PRIMARY KEY(resource_key,revision))`,
 `CREATE TABLE IF NOT EXISTS v2_pa_report_feedback (id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,subject_key TEXT NOT NULL,subject_hash TEXT NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,acknowledged_at TEXT,outcome TEXT,source_url TEXT)`,
 `CREATE INDEX IF NOT EXISTS v2_pa_report_feedback_subject ON v2_pa_report_feedback(subject_key,created_at)`,
 `CREATE TABLE IF NOT EXISTS v2_pa_report_files (id TEXT PRIMARY KEY,subject_key TEXT NOT NULL,actor TEXT NOT NULL,fingerprint TEXT NOT NULL,mime_type TEXT NOT NULL,filename TEXT NOT NULL,bytes BLOB NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_pa_report_alerts (id TEXT PRIMARY KEY,username TEXT NOT NULL,subject_key TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,push_sent_at TEXT,push_attempts INTEGER NOT NULL DEFAULT 0,next_attempt TEXT)`,
 `CREATE TABLE IF NOT EXISTS v2_pa_report_reminders (username TEXT NOT NULL,subject_key TEXT NOT NULL,remind_at TEXT NOT NULL,request_id TEXT NOT NULL,PRIMARY KEY(username,subject_key))`
];
export const ensurePaReportSchema=db=>db.batch(PA_REPORT_SCHEMA.map(s=>db.prepare(s)));
const ID=/^[a-zA-Z0-9-]{8,90}$/,TSK=/^TSK-\d{5,}$/;
const statuses=new Set(['Pending','Waiting','Complete','Cancelled','Archived']);
const opened=t=>['Pending','Waiting'].includes(t.status);
const users=env=>Object.keys(keys(env)).filter(u=>!['tapiz','mosa','musa'].includes(u));
const txt=(v,max,required=false)=>{check(typeof v==='string'&&v.length<=max&&(!required||v.trim()),'Enter the required report details.');return v.trim();};
const iso=v=>{check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'Provide the source timestamp.');return new Date(v).toISOString();};
function link(v){if(!v)return '';let u;try{u=new URL(v);}catch{throw new UserError('Use a complete secure source link.');}check(u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=2000,'Use a secure source link.');return u.href;}
const canSee=(u,r)=>r.scope==='private'?u.username==='alex':isAdmin(u.username)||r.assigned_to===u.username;
async function latest(db,key){const r=await db.prepare('SELECT * FROM v2_pa_report_versions WHERE resource_key=? ORDER BY revision DESC LIMIT 1').bind(key).first();return r?{...JSON.parse(r.payload),revision:r.revision,saved_at:r.saved_at}:null;}
async function subject(env,user,key){
 const register=await latest(env.DB,'register');
 if(TSK.test(key)){const r=register?.rows.find(r=>r.id===key);check(r&&canSee(user,r),'Report item not found.',404);return {...r,subject_key:r.id,subject_hash:await hash(JSON.stringify(r)),register_revision:register.revision};}
 check(user.username==='alex','Report item not found.',404);
 const m=/^(report-\d{4}-\d{2}-\d{2}):([a-zA-Z0-9-]{1,90})$/.exec(key??'');check(m,'Invalid report item.');
 const report=await latest(env.DB,m[1]),item=report?.sections.flatMap(s=>s.items).find(i=>i.id===m[2]);check(item,'Report item not found.',404);
 return {...item,scope:'private',assigned_to:'alex',subject_key:key,subject_hash:await hash(JSON.stringify(item)),report_date:report.date};
}
function summary(rows){const active=rows.filter(opened);return {total:rows.length,open:active.length,pending:active.filter(r=>r.status==='Pending').length,waiting:active.filter(r=>r.status==='Waiting').length,fenmeat:active.filter(r=>r.scope==='fenmeat').length,private:active.filter(r=>r.scope==='private').length};}
function feedbackRow(r){return {...JSON.parse(r.payload),id:r.id,subject_key:r.subject_key,subject_hash:r.subject_hash,actor:r.actor,created_at:r.created_at,status:r.acknowledged_at?'processed':'pending',acknowledged_at:r.acknowledged_at,outcome:r.outcome,source_url:r.source_url};}
export async function readPaReport(env,user,query={}){
 check(users(env).includes(user.username),'This account cannot use Daily Report.',403);await ensurePaReportSchema(env.DB);
 if(query.resource==='pending_feedback'){
  check(user.username==='alex','Only Alex can process the private PA feedback queue.',403);
  const offset=Number(query.offset??0);check(Number.isSafeInteger(offset)&&offset>=0&&offset<=100000,'Invalid page.');
  const list=await env.DB.prepare('SELECT * FROM v2_pa_report_feedback WHERE acknowledged_at IS NULL ORDER BY created_at,id LIMIT 51 OFFSET ?').bind(offset).all();
  const feedback=[];for(const r of list.results.slice(0,50)){let current;try{current=await subject(env,user,r.subject_key);}catch{current=null;}feedback.push({...feedbackRow(r),current_subject:current});}
  return {feedback,next_offset:list.results.length>50?offset+50:null};
 }
 if(query.resource==='file'){
  check(user.username==='alex','Only Alex can read private report evidence through PA.',403);const f=await file(env,user,query.id),bytes=new Uint8Array(f.bytes);let binary='';for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.slice(n,n+8192));return {id:f.id,filename:f.filename,mime_type:f.mime_type,subject_key:f.subject_key,base64:btoa(binary),byte_length:bytes.length,download_url:'/api/pa-report/file?id='+f.id};
 }
 const register=await latest(env.DB,'register'),rows=register?.rows.filter(r=>canSee(user,r))??[];
 const visible=new Set(rows.map(r=>r.id));
 const all=await env.DB.prepare('SELECT * FROM v2_pa_report_feedback ORDER BY created_at DESC,id DESC LIMIT 2000').all();
 const feedback=all.results.filter(r=>visible.has(r.subject_key)||(user.username==='alex'&&r.subject_key.startsWith('report-'))).map(feedbackRow);
 const alerts=(await env.DB.prepare('SELECT * FROM v2_pa_report_alerts WHERE username=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 100').bind(user.username).all()).results;
 const reminders=(await env.DB.prepare('SELECT subject_key,remind_at FROM v2_pa_report_reminders WHERE username=?').bind(user.username).all()).results.filter(r=>visible.has(r.subject_key)||user.username==='alex'&&r.subject_key.startsWith('report-'));
 const currentAlerts=[];for(const a of alerts)if(await reportAlertVisible(env,a))currentAlerts.push(a);
 let report=null,history=[];
 if(user.username==='alex'){
  history=(await env.DB.prepare("SELECT resource_key,MAX(revision) revision FROM v2_pa_report_versions WHERE resource_key LIKE 'report-%' GROUP BY resource_key ORDER BY resource_key DESC LIMIT 30").all()).results.map(r=>({date:r.resource_key.slice(7),revision:r.revision}));
  const date=query.date?dateKey(query.date):history[0]?.date;if(date)report=await latest(env.DB,'report-'+date);
 }
 for(const r of rows){const fingerprint=await hash(JSON.stringify(r));r.subject_key=r.id;r.subject_hash=fingerprint;}
 if(report)for(const s of report.sections)for(const i of s.items){i.subject_key='report-'+report.date+':'+i.id;i.subject_hash=await hash(JSON.stringify({...i,subject_key:undefined,subject_hash:undefined}));}
 return {username:user.username,admin:isAdmin(user.username),private_report:user.username==='alex',today:today(),users:isAdmin(user.username)?users(env):[user.username],register_revision:register?.revision??0,source_at:register?.source_at??null,source_url:register?.source_url??null,summary:summary(rows),rows,feedback,report,history,reminders,alerts:currentAlerts};
}
function validateRegister(data,env){
 check(data&&Array.isArray(data.rows)&&data.rows.length>0&&data.rows.length<=2000,'Supply the complete bounded PA register.');
 const seen=new Set(),rows=data.rows.map(r=>{
  check(TSK.test(r.id)&&!seen.has(r.id),'Duplicate or invalid permanent PA task ID.');seen.add(r.id);
  check(['fenmeat','private'].includes(r.scope)&&statuses.has(r.status),'Choose a valid scope and PA status.');
  check(r.scope!=='fenmeat'||r.area==='Fen Meat','Only Fen Meat records may be shared with staff.');
  check(!r.assigned_to||users(env).includes(r.assigned_to),'Use an existing assignee, or leave an unverified owner empty.');
  const row={id:r.id,scope:r.scope,area:txt(r.area,100,true),title:txt(r.title,500,true),status:r.status,assigned_to:r.assigned_to||'',priority:txt(r.priority||'Normal',30),next_action:txt(r.next_action||'',16000),review_group:txt(r.review_group||'',200),due_date:r.due_date?dateKey(r.due_date):'',review_date:r.review_date?dateKey(r.review_date):'',source_url:link(r.source_url),app_task_id:txt(r.app_task_id||'',90),outcome:txt(r.outcome||'',4000)};
  check(row.source_url.startsWith('https://docs.google.com/spreadsheets/'),'Keep the canonical PA row link.');return row;
 });
 const source_at=iso(data.source_at);check(Date.parse(source_at)<=Date.now()+60000,'Source time is in the future.');
 const source_url=link(data.source_url);check(source_url.startsWith('https://docs.google.com/spreadsheets/'),'Keep the existing PA register source.');
 return {source_at,source_url,rows};
}
function validateReport(data,register){
 check(data&&Array.isArray(data.sections)&&data.sections.length===5,'Publish all five report sections.');
 const date=dateKey(data.date),cutoff=iso(data.source_at);check(date<=today()&&Date.parse(cutoff)<=Date.now()+60000,'A report needs a real source date.');
 check(register&&data.register_revision===register.revision,'Read and publish the current register before the report.',409);
 const expected=['emails','activity','tasks','tomorrow','rabbi'],seen=new Set();
 const sections=data.sections.map((s,n)=>{check(s.id===expected[n]&&Array.isArray(s.items)&&s.items.length>0&&s.items.length<=100,'Keep all five ordered sections.');return {id:s.id,title:txt(s.title,200,true),items:s.items.map(i=>{
  check(/^[a-zA-Z0-9-]{1,90}$/.test(i.id??'')&&!seen.has(i.id),'Use unique report item IDs.');seen.add(i.id);
  check(Array.isArray(i.pa_task_ids??[])&&(i.pa_task_ids??[]).every(id=>register.rows.some(r=>r.id===id)),'Link only verified PA task IDs.');
  check(Array.isArray(i.links??[])&&(i.links??[]).length<=30,'Too many source links.');
  return {id:i.id,title:txt(i.title||'',300),text:txt(i.text,24000,true),needs_reply:s.id==='rabbi'?false:!!i.needs_reply,question:txt(i.question||'',1000),pa_task_ids:[...new Set(i.pa_task_ids??[])],links:(i.links??[]).map(l=>({label:txt(l.label,200,true),url:link(l.url)}))};
 })};});
 let task_summary=summary(register.rows);
 if(data.historical===true){
  check(date<today()&&/^https:\/\/mail\.google\.com\//.test(data.source_url),'Historical reports need their original sent-email source.');
  const h=data.reported_task_summary;
  check(h&&['total','open','pending','waiting'].every(k=>Number.isSafeInteger(h[k])&&h[k]>=0)&&h.pending+h.waiting===h.open&&h.open<=h.total,'Verify the historical report counts from the original email.');
  task_summary={total:h.total,open:h.open,pending:h.pending,waiting:h.waiting};
 }
 return {date,source_at:cutoff,source_url:link(data.source_url),register_revision:register.revision,historical:data.historical===true,task_summary,coverage:txt(data.coverage||'',10000),sections};
}
export async function savePaReport(env,user,b){
 check(user.username==='alex'&&user.via==='pa','Only the authorised Alex PA connection can publish or acknowledge reports.',403);await ensurePaReportSchema(env.DB);
 check(ID.test(b.request_id??'')&&typeof b.reason==='string'&&b.reason.trim().length>=5,'Record the authorised instruction and a unique save ID.');
 if(b.operation==='acknowledge'){
  const r=await env.DB.prepare('SELECT * FROM v2_pa_report_feedback WHERE id=?').bind(b.feedback_id??'').first();check(r,'Feedback not found.',404);
  const outcome=txt(b.outcome,4000,true),url=link(b.source_url);check(url&&b.subject_hash===r.subject_hash,'Read the exact feedback and verify its PA update first.',409);
  if(r.acknowledged_at){check(r.outcome===outcome&&r.source_url===url,'Feedback already processed with a different result.',409);return {saved:true,replayed:true,feedback:feedbackRow(r)};}
  await env.DB.prepare('UPDATE v2_pa_report_feedback SET acknowledged_at=?,outcome=?,source_url=? WHERE id=? AND acknowledged_at IS NULL').bind(new Date().toISOString(),outcome,url,r.id).run();
  return {saved:true,feedback:feedbackRow(await env.DB.prepare('SELECT * FROM v2_pa_report_feedback WHERE id=?').bind(r.id).first())};
 }
 check(['register','report'].includes(b.operation),'Choose register or report publication.');
 const key=b.operation==='register'?'register':'report-'+dateKey(b.data?.date),fingerprint=await hash(JSON.stringify({...b,actor:user.username}));
 const prior=await env.DB.prepare('SELECT * FROM v2_pa_report_versions WHERE request_id=?').bind(b.request_id).first();
 if(prior){check(prior.fingerprint===fingerprint,'This request ID was used for different content.',409);return {saved:true,replayed:true,revision:prior.revision,resource_key:prior.resource_key};}
 const old=await latest(env.DB,key);check(Number.isSafeInteger(b.revision)&&b.revision===(old?.revision??0),'This report changed. Read its current revision.',409);
 let payload;
 if(b.operation==='register'){
  payload=validateRegister(b.data,env);check(!old||Date.parse(payload.source_at)>=Date.parse(old.source_at),'Do not publish an older register.',409);
  check(!old||old.rows.every(r=>payload.rows.some(n=>n.id===r.id)),'Do not silently drop existing PA identities. Preserve closed or archived records.',409);
 }else payload=validateReport(b.data,await latest(env.DB,'register'));
 const at=new Date().toISOString();
 try{await env.DB.prepare('INSERT INTO v2_pa_report_versions VALUES(?,?,?,?,?,?,?)').bind(key,b.revision+1,b.request_id,fingerprint,JSON.stringify(payload),user.username,at).run();}catch{throw new UserError('The report changed while publishing. Reload before retrying.',409);}
 return {saved:true,revision:b.revision+1,resource_key:key,source_at:payload.source_at};
}
async function file(env,user,id){check(ID.test(id??''),'Invalid evidence ID.');const r=await env.DB.prepare('SELECT * FROM v2_pa_report_files WHERE id=?').bind(id).first();check(r,'Evidence not found.',404);await subject(env,user,r.subject_key);return r;}
async function upload(env,user,b){
 const s=await subject(env,user,b.subject_key);check(s.subject_hash===b.subject_hash,'This item changed. Refresh before adding evidence.',409);
 check(ID.test(b.id??'')&&['image/jpeg','image/png','application/pdf'].includes(b.mime_type),'Use a JPG, PNG or PDF.');check(typeof b.base64==='string'&&b.base64.length<=700000&&/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64),'Keep each attachment below 500 KB.');
 let bytes;try{bytes=Uint8Array.from(atob(b.base64),c=>c.charCodeAt(0));}catch{throw new UserError('Invalid evidence file.');}check(bytes.length>0&&bytes.length<=500000,'Keep each attachment below 500 KB.');
 check(b.mime_type==='application/pdf'?String.fromCharCode(...bytes.slice(0,5))==='%PDF-':b.mime_type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'The file does not match its type.');
 const fingerprint=await hash(JSON.stringify({...b,actor:user.username})),prior=await env.DB.prepare('SELECT fingerprint FROM v2_pa_report_files WHERE id=?').bind(b.id).first();if(prior){check(prior.fingerprint===fingerprint,'Evidence ID already used for different bytes.',409);return {id:b.id,replayed:true};}
 const filename=txt(b.filename||'evidence',100).replace(/[^a-zA-Z0-9._-]/g,'_');
 await env.DB.prepare('INSERT INTO v2_pa_report_files VALUES(?,?,?,?,?,?,?,?)').bind(b.id,b.subject_key,user.username,fingerprint,b.mime_type,filename,bytes,new Date().toISOString()).run();return {id:b.id};
}
async function respond(env,user,b){
 check(ID.test(b.request_id??''),'Use a unique response ID.');
 const fingerprint=await hash(JSON.stringify({...b,actor:user.username})),prior=await env.DB.prepare('SELECT * FROM v2_pa_report_feedback WHERE id=?').bind(b.request_id).first();
 if(prior){check(prior.fingerprint===fingerprint,'This response ID belongs to a different answer.',409);await subject(env,user,prior.subject_key);return {saved:true,replayed:true,feedback:feedbackRow(prior)};}
 const s=await subject(env,user,b.subject_key);check(b.subject_hash===s.subject_hash,'This item changed. Refresh and review your answer before saving.',409);
 check(['respond','complete','assign','request_update','remind'].includes(b.action),'Choose a feedback action.');
 const attachments=b.attachments??[];check(Array.isArray(attachments)&&attachments.length<=12&&new Set(attachments).size===attachments.length,'Choose up to twelve evidence files.');
 for(const id of attachments){const f=await file(env,user,id);check(f.subject_key===s.subject_key&&f.actor===user.username,'Use your evidence for this item.');}
 const payload={action:b.action,note:txt(b.note??'',5000,!['remind'].includes(b.action)),attachments,proof_url:link(b.proof_url),assigned_to:'',remind_at:'',source_task_ids:TSK.test(s.subject_key)?[s.id]:s.pa_task_ids??[]};
 if(b.action==='complete')check(TSK.test(s.subject_key)&&opened(s),'Choose an open PA obligation. This records your confirmation for PA verification.');
 if(b.action==='assign'){check(isAdmin(user.username)&&TSK.test(s.subject_key),'Only admins can reassign an existing task.',403);check(s.scope!=='private','Private PA work cannot be assigned to staff.',403);check(users(env).includes(b.assigned_to),'Choose an existing app user.');payload.assigned_to=b.assigned_to;}
 if(b.action==='request_update')check(isAdmin(user.username)&&TSK.test(s.subject_key)&&s.assigned_to&&s.assigned_to!==user.username&&s.scope==='fenmeat','Choose another staff member’s task.',403);
 if(b.action==='remind'){payload.remind_at=iso(b.remind_at);check(Date.parse(payload.remind_at)>Date.now(),'Choose a future reminder time.');}
 const at=new Date().toISOString(),statements=[env.DB.prepare('INSERT INTO v2_pa_report_feedback(id,fingerprint,subject_key,subject_hash,payload,actor,created_at) VALUES(?,?,?,?,?,?,?)').bind(b.request_id,fingerprint,s.subject_key,s.subject_hash,JSON.stringify(payload),user.username,at)];
 if(b.action==='remind')statements.push(env.DB.prepare('INSERT INTO v2_pa_report_reminders VALUES(?,?,?,?) ON CONFLICT(username,subject_key) DO UPDATE SET remind_at=excluded.remind_at,request_id=excluded.request_id').bind(user.username,s.subject_key,payload.remind_at,b.request_id));
 const recipient=b.action==='request_update'?s.assigned_to:user.username==='alex'?null:'alex';
 if(recipient)statements.push(env.DB.prepare('INSERT INTO v2_pa_report_alerts(id,username,subject_key,kind,created_at) VALUES(?,?,?,?,?)').bind(b.request_id+'-'+recipient,recipient,s.subject_key,b.action==='request_update'?'request_update':'response',at));
 try{await env.DB.batch(statements);}catch{throw new UserError('Your answer could not be confirmed. Retry the same response.',409);}
 return {saved:true,feedback:{...payload,id:b.request_id,subject_key:s.subject_key,actor:user.username,created_at:at,status:'pending'}};
}
export async function reportAlertVisible(env,n,now=new Date()){
 let s;try{s=await subject(env,{username:n.username},n.subject_key);}catch{return false;}
 if(TSK.test(n.subject_key)&&!opened(s))return false;
 if(n.kind==='remind'){const r=await env.DB.prepare('SELECT * FROM v2_pa_report_reminders WHERE username=? AND subject_key=?').bind(n.username,n.subject_key).first();return !!r&&n.id==='remind-'+r.request_id&&Date.parse(r.remind_at)<=now.getTime();}return true;
}
export async function queuePaReportReminders(env,now=new Date()){
 await ensurePaReportSchema(env.DB);
 await env.DB.prepare("INSERT OR IGNORE INTO v2_pa_report_alerts(id,username,subject_key,kind,created_at) SELECT 'remind-'||request_id,username,subject_key,'remind',? FROM v2_pa_report_reminders WHERE remind_at<=?").bind(now.toISOString(),now.toISOString()).run();
}
export async function paReportApi({request,url,env,user,bodyOf}){
 check(users(env).includes(user.username),'This account cannot use Daily Report.',403);await ensurePaReportSchema(env.DB);
 if(request.method==='GET'&&url.pathname==='/api/pa-report')return readPaReport(env,user,{date:url.searchParams.get('date')||undefined});
 if(request.method==='GET'&&url.pathname==='/api/pa-report/file'){const f=await file(env,user,url.searchParams.get('id'));return new Response(new Uint8Array(f.bytes),{headers:{'Content-Type':f.mime_type,'Content-Disposition':'inline; filename="'+f.filename+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 check(request.method==='POST','Method not allowed.',405);const b=await bodyOf(request);
 if(url.pathname==='/api/pa-report/feedback')return respond(env,user,b);
 if(url.pathname==='/api/pa-report/file')return upload(env,user,b);
 if(url.pathname==='/api/pa-report/read'){await env.DB.prepare('UPDATE v2_pa_report_alerts SET read_at=? WHERE id=? AND username=?').bind(new Date().toISOString(),b.id??'',user.username).run();return {saved:true};}
 throw new UserError('Report endpoint not found.',404);
}
