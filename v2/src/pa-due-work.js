import {check} from './domain.js';
import {projectTask,taskOwner,stepClosed,localDate} from './task-workflow.js';

// A small routing index over the original task events, not a second task register.
export const DUE_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_pa_due_index(task_id TEXT NOT NULL,step_id TEXT NOT NULL,revision INTEGER NOT NULL,due_at TEXT NOT NULL,PRIMARY KEY(task_id,step_id))`,
 `CREATE INDEX IF NOT EXISTS v2_pa_due_time ON v2_pa_due_index(due_at,task_id,step_id)`,
 `CREATE TABLE IF NOT EXISTS v2_pa_due_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_pa_followup_events(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,recorded_at TEXT NOT NULL,payload TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS v2_pa_followup_date ON v2_pa_followup_events(recorded_at,id)`
];
const closed=t=>['Complete','Cancelled','Archived'].includes(t.status);
const start=date=>date?date+'T00:00:00+02:00':'1970-01-01T00:00:00.000Z';
export function paCandidates(raw,now=new Date()){
 const task=projectTask(raw,localDate(now));
 if(closed(task)||task.step_only)return [];
 const steps=task.steps?.length?task.steps.filter(s=>s.assigned_to==='pa'&&!stepClosed(s)&&!s.blocked):
  taskOwner(task)==='pa'?[{id:'current',description:task.native_review?.description||task.responsibility?.action||task.next_action||task.details||task.title,due_date:task.native_review?.due_date||task.review_date||task.due_date||'',status:task.status}]:[];
 return steps.map(s=>{
  const key=JSON.stringify([s.id,s.description,s.due_date||'',s.status]);
  const execution=task.pa_followups?.[s.id];
  const same=execution?.next_key===key||execution?.source_key===key;
  let due_at=new Date(start(s.due_date)).toISOString();
  if(same&&execution.state==='working'&&execution.lease_until>due_at)due_at=execution.lease_until;
  else if(same&&execution.next_check_at>due_at)due_at=execution.next_check_at;
  return {step_id:s.id,source_key:key,description:s.description,due_date:s.due_date||'',due_at,overdue:!!s.due_date&&s.due_date<localDate(now),execution:same?execution:null};
 });
}
export function dueIndexStatements(db,task,revision){
 const statements=[db.prepare('DELETE FROM v2_pa_due_index WHERE task_id=? AND revision<=?').bind(task.id,revision)];
 for(const s of paCandidates(task))statements.push(db.prepare(`INSERT INTO v2_pa_due_index SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM v2_task_heads WHERE task_id=? AND revision=?)
 ON CONFLICT(task_id,step_id) DO UPDATE SET revision=excluded.revision,due_at=excluded.due_at WHERE excluded.revision>=revision`).bind(task.id,s.step_id,revision,s.due_at,task.id,revision));
 return statements;
}
export async function bootstrapDueIndex(db){
 if(await db.prepare("SELECT value FROM v2_pa_due_meta WHERE key='backfill-v1'").first())return;
 const rows=(await db.prepare('SELECT e.payload,e.revision FROM v2_task_heads h JOIN v2_task_events e ON e.task_id=h.task_id AND e.revision=h.revision').all()).results;
 for(const r of rows)await db.batch(dueIndexStatements(db,JSON.parse(r.payload),r.revision));
 await db.prepare("INSERT OR IGNORE INTO v2_pa_due_meta VALUES('backfill-v1',?)").bind(new Date().toISOString()).run();
}
export async function dueWorkPage(db,user,{offset=0,audit=false}={}){
 check(user.username==='alex','Net Alex se PA kan die volledige opvolglys lees.',403);
 check(Number.isSafeInteger(offset)&&offset>=0&&offset<=100000,'Ongeldige bladsy.');
 await bootstrapDueIndex(db);
 const now=new Date().toISOString();
 const rows=(await db.prepare(`SELECT i.step_id,e.task_id,e.revision,e.payload FROM v2_pa_due_index i
 JOIN v2_task_events e ON e.task_id=i.task_id AND e.revision=i.revision
 WHERE ${audit?'1':'i.due_at<=?'} ORDER BY i.due_at,i.task_id,i.step_id LIMIT 26 OFFSET ?`).bind(...(audit?[]:[now]),offset).all()).results;
 const items=rows.slice(0,25).flatMap(r=>{
  const t=JSON.parse(r.payload),s=paCandidates(t).find(s=>s.step_id===r.step_id);
  return s?[{task_id:r.task_id,pa_task_id:t.pa_task_id||'',revision:r.revision,title:t.title,scope:t.visibility==='private'?'private':'fenmeat',...s}]:[];
 });
 // Detect legacy gaps without downloading the register or any task history.
 const legacy=offset===0?(await db.prepare(`SELECT r.value FROM v2_pa_report_versions v,json_each(v.payload,'$.rows') r
 WHERE v.resource_key='register' AND v.revision=(SELECT MAX(revision) FROM v2_pa_report_versions WHERE resource_key='register')
 AND json_extract(r.value,'$.status') IN ('Pending','Waiting','Scheduled') AND json_extract(r.value,'$.responsibility.owner')='pa'
 AND ${audit?'1':"COALESCE(NULLIF(json_extract(r.value,'$.review_date'),''),json_extract(r.value,'$.due_date'),'')<=date('now','+2 hours')"}
 AND NOT EXISTS(SELECT 1 FROM v2_task_heads h JOIN v2_task_events e ON e.task_id=h.task_id AND e.revision=h.revision WHERE e.task_id=json_extract(r.value,'$.app_task_id') OR json_extract(e.payload,'$.pa_task_id')=json_extract(r.value,'$.id'))`).all()).results.map(r=>{const t=JSON.parse(r.value);return {pa_task_id:t.id,scope:t.scope,title:t.title,due_date:t.review_date||t.due_date||'',next_action:t.responsibility.action,materialize_required:true};}):[];
 return {items,legacy,next_offset:rows.length>25?offset+25:null,checked_at:now};
}
const text=(v,max=6000)=>{check(typeof v==='string'&&v.trim()&&v.length<=max,'Gee die werklike opvolgresultaat.');return v.trim();};
export function changePaFollowup(task,b,user,at){
 check(user.via==='pa'&&user.username==='alex','Net Alex se gemagtigde PA-koppeling kan opvolgwerk uitvoer.',403);
 check(!closed(task),'Hierdie taak is reeds afgehandel.',409);
 const candidate=paCandidates(task,new Date(at)).find(s=>s.step_id===b.step_id);
 check(candidate,'Hierdie stap is nie uitvoerbare PA-werk nie.',409);
 task.pa_followups||={};
 if(b.action==='pa_followup_claim'){
  check(candidate.source_key===b.source_key&&candidate.due_at<=at,'Lees die huidige verskuldigde PA-stap.',409);
  const previous=task.pa_followups[b.step_id];
  check(!previous||previous.state!=='working'||previous.lease_until<=at,'PA werk reeds aan hierdie stap.',409);
  task.pa_followups[b.step_id]={...previous,state:'working',source_key:candidate.source_key,claim_id:b.request_id,started_at:at,lease_until:new Date(Date.parse(at)+3600000).toISOString(),original_due_date:candidate.due_date};
  return;
 }
 const execution=task.pa_followups[b.step_id],d=b.data;
 check(execution?.state==='working'&&execution.claim_id===b.claim_id&&execution.lease_until>at&&candidate.source_key===execution.source_key,'Neem die huidige opvolgstap weer in werk.',409);
 check(['followed_up','waiting','approval','blocked','failed'].includes(d?.outcome),'Kies die werklike opvolguitkoms.');
 const result=text(d.result),attempted=text(d.attempted,2000),next_action=text(d.next_action,2000);
 check(Array.isArray(d.sources)&&d.sources.length<=12&&(d.outcome==='failed'||d.sources.length>0),'Gee die nagegane bronbewyse.');
 const sources=d.sources.map(s=>text(s,2000));
 check(typeof d.checked_at==='string'&&Number.isFinite(Date.parse(d.checked_at))&&Date.parse(d.checked_at)>=Date.parse(execution.started_at)-300000&&Date.parse(d.checked_at)<=Date.parse(at)+60000,'Gee die werklike kontroletyd.');
 check(['pa','alex','alinda','xavier','xalinda'].includes(d.next_owner),'Gee die werklike volgende persoon.');
 if(['failed','blocked','approval'].includes(d.outcome)){text(d.reason,2000);text(d.needed,2000);}
 // A failure near the end of an hourly run must be eligible when the next
 // scheduled run starts, not one hour after this later result was saved.
 const next_check_at=d.outcome==='failed'?new Date((Math.floor(Date.parse(at)/3600000)+1)*3600000).toISOString():d.next_check_at;
 check(typeof next_check_at==='string'&&Number.isFinite(Date.parse(next_check_at))&&Date.parse(next_check_at)>Date.parse(at),'Gee die volgende kontroletyd.');
 if(d.outcome==='failed'){
  check(d.next_owner==='pa','PA bly verantwoordelik vir tegniese herprobering.');
  check(!b.task_updates?.length,'Behou die uitstaande werk en datum by ’n tegniese fout.');
 }
 task.pa_followups[b.step_id]={state:d.outcome,source_key:execution.source_key,original_due_date:execution.original_due_date,started_at:execution.started_at,
  checked_at:new Date(d.checked_at).toISOString(),last_success_at:d.outcome==='failed'?execution.last_success_at||null:at,
  attempted,result,sources,next_action,next_owner:d.next_owner,next_check_at:new Date(next_check_at).toISOString(),reason:d.reason||'',needed:d.needed||'',request_id:b.request_id};
}
export function finishPaFollowup(task,b){
 const s=task.pa_followups?.[b.step_id];if(!s)return;
 const next=paCandidates(task).find(c=>c.step_id===b.step_id);
 if(next)s.next_key=next.source_key;
}
