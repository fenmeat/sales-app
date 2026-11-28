import {check} from './domain.js';
import {fullTaskAccess} from './task-access.js';

export const CONVERSATION_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_task_messages(task_id TEXT NOT NULL,id TEXT NOT NULL,role TEXT NOT NULL,actor TEXT,created_at TEXT,sort_at TEXT NOT NULL,payload TEXT NOT NULL,owner_only INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(task_id,id))`,
 `CREATE INDEX IF NOT EXISTS v2_task_messages_page ON v2_task_messages(task_id,sort_at DESC,id DESC)`,
 `CREATE TABLE IF NOT EXISTS v2_task_conversation_backups(task_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL)`
];
export function messageStatement(db,taskId,m){
 return db.prepare('INSERT OR IGNORE INTO v2_task_messages(task_id,id,role,actor,created_at,sort_at,payload,owner_only) VALUES(?,?,?,?,?,?,?,?)')
  .bind(taskId,m.id,m.role,m.actor||null,m.at||null,m.at||'',JSON.stringify(m),m.owner_only?1:0);
}
export function workMessages(task){
 return (task.pa_work||[]).flatMap(j=>[
  {id:'work-'+j.id,role:'user',actor:j.actor,at:j.asked_at,text:j.instruction,work_id:j.id},
  ...(j.followups||[]).map((f,i)=>({id:'work-'+j.id+'-follow-'+i,role:'user',actor:f.by,at:f.at,text:f.text,work_id:j.id})),
  ...(j.results||[]).map((r,i)=>({id:'work-'+j.id+'-result-'+i,role:'pa',actor:'pa',at:r.at,text:r.answer,next_action:r.next_action,links:r.links||[],files:r.files||[],work_id:j.id}))
 ]);
}
export function newWorkStatements(db,before,after,files=[]){
 const known=new Set(workMessages(before||{}).map(m=>m.id));
 return workMessages(after).filter(m=>!known.has(m.id)).map(m=>messageStatement(db,after.id,m.role==='user'?{...m,files:files.map(f=>({id:f.id,name:f.filename}))}:m));
}
export function feedbackText(p){
 if(p.note?.trim())return p.note;
 if(p.action==='complete')return p.completion_scope==='part'?'My aandeel is as klaar aangemeld.':'Die hele taak is as klaar aangemeld; PA moet die bevestiging nagaan.';
 if(p.action==='remind')return 'Herinnering gestel'+(p.remind_at?' vir '+p.remind_at:'')+'.';
 if(p.action==='assign')return 'Toewysing versoek'+(p.assigned_to?' aan '+p.assigned_to:'')+'.';
 return 'Terugvoer versoek.';
}
export async function reportMessageStatements(db,f,answer){
 const payload=JSON.parse(f.payload),ids=[f.subject_key,...(payload.source_task_ids||[])];
 const rows=(await db.prepare(`SELECT e.task_id,json_extract(e.payload,'$.pa_task_id') pa_task_id FROM v2_task_heads h JOIN v2_task_events e ON e.task_id=h.task_id AND e.revision=h.revision WHERE json_extract(e.payload,'$.pa_task_id') IN (SELECT value FROM json_each(?)) OR e.task_id IN (SELECT task_key FROM v2_pa_report_task_links WHERE subject_key=?)`).bind(JSON.stringify(ids),f.subject_key).all()).results;
 return rows.flatMap(r=>{
  const m={source_key:f.subject_key,id:'feedback-'+f.id,role:'user',actor:f.actor,at:f.created_at,text:feedbackText(payload),files:(payload.attachments||[]).map(id=>({id,name:'Bewysstuk',report:true})),links:payload.proof_url?[{label:'Bewys',url:payload.proof_url}]:[],owner_only:f.subject_key!==r.pa_task_id};
  const statements=[messageStatement(db,r.task_id,m)];
  if(answer){const a={source_key:f.subject_key,id:'answer-'+f.id,role:'pa',actor:'pa',at:answer.at,text:answer.text,next_action:answer.next_action,owner_only:m.owner_only};
   statements.push(db.prepare(`INSERT OR IGNORE INTO v2_task_messages SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM v2_pa_report_answers WHERE feedback_id=?)`).bind(r.task_id,a.id,a.role,a.actor,a.at,a.at,JSON.stringify(a),a.owner_only?1:0,f.id));}
  return statements;
 });
}
export const looksLikeConversation=text=>/^\s*PA se antwoord\b/im.test(text||'')||(/^\s*PA\s*:/im.test(text||'')&&/^\s*(?:Alex|Alinda|Xavier|Xalinda)\s*:/im.test(text||''));

// Never guess speakers or dates from prose. Event snapshots can prove exact appended
// portions; otherwise retain the complete source as an explicitly unclassified archive.
export async function migrationPlan(db,task,at){
 const messages=workMessages(task),fields=[];
 if(looksLikeConversation(task.details))fields.push({path:'details',text:task.details});
 for(const s of task.steps||[])for(const key of ['notes','description'])if(looksLikeConversation(s[key]))fields.push({path:'steps.'+s.id+'.'+key,text:s[key]});
 const events=fields.length?(await db.prepare('SELECT request_id,action,payload,actor,saved_at FROM v2_task_events WHERE task_id=? ORDER BY revision').bind(task.id).all()).results:[];
 const read=(t,path)=>{if(path==='details')return t.details||'';const [,id,key]=path.split('.');return t.steps?.find(s=>s.id===id)?.[key]||'';};
 for(const field of fields){
  let previous='',parts=[],reliable=true;
  for(const e of events){const value=read(JSON.parse(e.payload),field.path);if(value===previous)continue;
   if(!value.startsWith(previous)){reliable=false;parts=[];}
   const added=value.startsWith(previous)?value.slice(previous.length).replace(/^\n/,''):value;
   if(added)parts.push({id:'legacy-'+e.request_id+'-'+field.path.replaceAll('.','-'),role:/^PA se (?:antwoord|bronkontrole)\b/i.test(added)?'pa':'user',actor:/^PA se (?:antwoord|bronkontrole)\b/i.test(added)?'pa':e.actor,at:e.saved_at,text:added,source:field.path});
   previous=value;
  }
  // A single old snapshot containing multiple voices has no trustworthy attribution.
  if(!reliable||previous!==field.text||parts.some(p=>(p.text.match(/PA se antwoord/gi)||[]).length>1||p.role==='user'&&looksLikeConversation(p.text))){
   messages.push({id:'legacy-field-'+field.path.replaceAll('.','-'),role:'history',text:field.text,source:field.path,review_required:true});
  }else messages.push(...parts);
 }
 const cleaned=structuredClone(task);
 for(const f of fields){if(f.path==='details')cleaned.details='Huidige werk: '+task.title+'. Sien die taakstappe vir die volgende aksie. Die oorspronklike gesprek is onder Gesprek met PA bewaar.';
  else{const [,id,key]=f.path.split('.'),s=cleaned.steps.find(s=>s.id===id);s[key]=key==='notes'?'Vorige gesprek is onder Gesprek met PA bewaar.':'Gaan die oorspronklike stap in Gesprek met PA na.';}}
 cleaned.conversation_version=1;
 cleaned.conversation_review_required=messages.some(m=>m.review_required);
 const reportTables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_pa_report_feedback'").first();
 const feedback=reportTables&&task.pa_task_id?(await db.prepare(`SELECT f.*,a.payload answer_payload,a.created_at answered_at FROM v2_pa_report_feedback f LEFT JOIN v2_pa_report_answers a ON a.feedback_id=f.id WHERE f.subject_key=? OR EXISTS(SELECT 1 FROM json_each(f.payload,'$.source_task_ids') WHERE value=?) OR EXISTS(SELECT 1 FROM v2_pa_report_task_links WHERE subject_key=f.subject_key AND task_key IN (?,?))`).bind(task.pa_task_id,task.pa_task_id,task.id,task.pa_task_id).all()).results:[];
 for(const f of feedback){const p=JSON.parse(f.payload),owner_only=f.subject_key!==task.pa_task_id;messages.push({source_key:f.subject_key,id:'feedback-'+f.id,role:'user',actor:f.actor,at:f.created_at,text:feedbackText(p),owner_only,files:(p.attachments||[]).map(id=>({id,name:'Bewysstuk',report:true})),links:p.proof_url?[{label:'Bewys',url:p.proof_url}]:[]});if(f.answer_payload){const a=JSON.parse(f.answer_payload);messages.push({source_key:f.subject_key,id:'answer-'+f.id,role:'pa',actor:'pa',at:f.answered_at,text:a.text,next_action:a.next_action,owner_only});}}
 return {task:cleaned,messages,fields:fields.map(f=>f.path),statements:[db.prepare('INSERT OR IGNORE INTO v2_task_conversation_backups VALUES(?,?,?,?)').bind(task.id,task.revision,JSON.stringify(task),at),...messages.map(m=>messageStatement(db,task.id,m))]};
}

export async function readTaskConversation(env,user,task,{before='',limit=30,offset=0}={}){
 check(task&&fullTaskAccess(user,task),'Task not found.',404);
 limit=Number(limit);offset=Number(offset);check(Number.isSafeInteger(limit)&&limit>=1&&limit<=50&&Number.isSafeInteger(offset)&&offset>=0&&offset<=100000,'Ongeldige gespreksbladsy.');
 let cursor=null;if(before){try{cursor=JSON.parse(before);}catch{}check(Array.isArray(cursor)&&cursor.length===2&&cursor.every(x=>typeof x==='string')&&before.length<400,'Ongeldige gespreksbladsy.');}
 const rows=await env.DB.prepare(`SELECT payload,sort_at,id FROM v2_task_messages WHERE task_id=? AND (owner_only=0 OR ?='alex') ${cursor?'AND (sort_at,id)<(?,?)':''} ORDER BY sort_at DESC,id DESC LIMIT ? OFFSET ?`)
  .bind(task.id,user.username,...(cursor||[]),limit+1,offset).all();
 const page=rows.results.slice(0,limit),last=page.at(-1);
 const parsed=page.reverse().map(r=>JSON.parse(r.payload)),denied=new Set();
 const empty=parsed.filter(m=>m.id.startsWith('feedback-')&&!m.text?.trim());
 if(empty.length){
  const feedback=(await env.DB.prepare('SELECT id,payload FROM v2_pa_report_feedback WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(empty.map(m=>m.id.slice(9)))).all()).results;
  for(const m of empty){const f=feedback.find(f=>'feedback-'+f.id===m.id);if(f)m.text=feedbackText(JSON.parse(f.payload));}
 }
 // Explicit historical speaker labels take precedence over the PA connection's owner identity.
 for(const m of parsed)if(m.role!=='history'&&m.id.startsWith('legacy-')&&/^PA se (?:antwoord|bronkontrole)\b/i.test(m.text)){m.role='pa';m.actor='pa';}

 if(user.username!=='alex'){
  const sources=[...new Set(parsed.map(m=>m.source_key).filter(Boolean))];
  if(sources.length){
   const keys=JSON.stringify(sources);
   const records=(await env.DB.prepare("SELECT j.value FROM v2_pa_report_versions v,json_each(v.payload,'$.rows') j WHERE v.resource_key='register' AND v.revision=(SELECT MAX(revision) FROM v2_pa_report_versions WHERE resource_key='register') AND json_extract(j.value,'$.id') IN (SELECT value FROM json_each(?))").bind(keys).all()).results.map(r=>JSON.parse(r.value));
   const linked=(await env.DB.prepare("SELECT e.payload FROM v2_task_heads h JOIN v2_task_events e ON e.task_id=h.task_id AND e.revision=h.revision WHERE json_extract(e.payload,'$.pa_task_id') IN (SELECT value FROM json_each(?))").bind(keys).all()).results.map(r=>JSON.parse(r.payload));
   for(const key of sources)if(!records.some(r=>r.id===key&&r.scope==='fenmeat')||linked.some(t=>t.pa_task_id===key&&!fullTaskAccess(user,t)))denied.add(key);
  }
 }
 return {task_id:task.id,revision:task.revision,messages:parsed.filter(m=>!denied.has(m.source_key)),next_before:rows.results.length>limit?JSON.stringify([last.sort_at,last.id]):null,next_offset:rows.results.length>limit?offset+limit:null,
  review_required:!!task.conversation_review_required,migrated:!!task.conversation_version,
  pending:(task.pa_work||[]).filter(j=>j.status!=='answered').map(({id,status,actor,updated_at})=>({id,status,actor,updated_at}))};
}

// Responses and stored drafts never include the old transcript before the conversation opens.
export function withoutTranscript(task){
 if(!task)return task;
 const {last_edit,last_reason,...rest}=task;
 return {...rest,pa_work:(task.pa_work||[]).map(({instruction,followups,results,...job})=>job)};
}
