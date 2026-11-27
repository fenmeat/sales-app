import {projectTask,localDate} from './task-workflow.js';
import {taskOwner,ownStep,stepClosed} from './task-workflow.js';
export const paOpen=t=>['Pending','Scheduled','Waiting'].includes(t.status);
export const paDue=t=>t.next_action_date||t.review_date||t.due_date;
// A person's confirmation saves immediately; the PA spreadsheet remains authoritative.
const needsReview=r=>r.scope!=='fenmeat'||/(?:\bPO[-\s]?\d+\b|\b(?:supplier|bestelling(?:s)?|order|invoice|faktuur|betaling|payment|bank|ontvangs|aflewering|stocktake|voorraadtelling|telling|payroll|loon|uif|skuld|rekeninge)\b)/i.test([r.title,r.review_group].join(' '));
export function unifiedWork(app,pa){
 const day=app.today||localDate();app={...app,tasks:app.tasks.map(t=>projectTask(t,day))};
 const canonical=new Map(pa.rows.map(r=>[r.id,r])),byApp=new Map(pa.rows.filter(r=>r.app_task_id).map(r=>[r.app_task_id,r])),last=new Map();
 // Feedback is newest-first; a later reply can correct an earlier completion.
 for(const f of pa.feedback??[])if((f.action==='complete'||f.action==='respond')&&!last.has(f.subject_key))last.set(f.subject_key,f);
 const rows=pa.rows.map(r=>{
  const stages=app.tasks.filter(t=>t.pa_task_id===r.id||t.id===r.app_task_id),f=last.get(r.id);
  const completion_requested=paOpen(r)&&f?.action==='complete'&&f.status==='pending';
  const part_pending=completion_requested&&f.completion_scope==='part';
  const completion_pending=completion_requested&&!part_pending&&f.actor===r.assigned_to&&stages.length===0&&!needsReview(r);
  const workflow=stages.find(t=>t.task_type==='workflow'&&t.id===r.app_task_id)||stages.find(t=>t.task_type==='workflow'&&(!r.app_task_id||stages.length===1));
  const native=stages.find(t=>t.id===r.app_task_id&&t.native_history);
  const edited=paOpen(r)&&stages.length===1&&stages[0].last_edit&&stages[0].pa_sync?.status==='pending'&&stages[0].kind==='general'?stages[0]:null;
  const scheduled=(['Pending','Scheduled'].includes(r.status)||r.responsibility&&r.status==='Waiting')&&r.review_date>day;
  const status=workflow?.status||edited?.status||(completion_pending?'Klaar gemeld':scheduled?'Scheduled':['Waiting','Scheduled'].includes(r.status)&&r.review_date&&r.review_date<=day?'Pending':r.status);
  return {...r,...(native?{native_history:native.native_history,native_review:native.native_review,next_action_date:native.next_action_date}:{}),...(edited?{title:edited.title,priority:edited.priority,assigned_to:edited.assigned_to,due_date:edited.due_date,review_date:edited.review_date,next_action:edited.status==='Complete'?'Afgehandel. PA werk die bestaande register by.':edited.details,app_edit_pending:true,app_owner_changed:edited.last_edit.changes?.some(change=>change.field==='assigned_to')}:{}),...(workflow?{pa_followups:workflow.pa_followups,status:workflow.status,next_action:workflow.next_action,next_action_date:workflow.next_action_date,steps:workflow.steps,progress:workflow.progress,ready_for_approval:workflow.ready_for_approval,workflow_id:workflow.id,next_assigned_to:workflow.next_assigned_to,assigned_to:workflow.assigned_to}:{}),part_pending,is_pa:true,details:r.next_action,supplier:r.review_group,stages,source_status:r.status,completion_requested,completion_pending,needs_completion_review:completion_requested&&!completion_pending,status};
 });
 for(const t of app.tasks){
  const parent=byApp.get(t.id)||canonical.get(t.pa_task_id);
  if(parent&&(paOpen(parent)||!paOpen(t)||t.task_type==='workflow'))continue;
  rows.push({...t,...(t.email&&t.task_type!=='workflow'&&paOpen(t)&&t.email.phase!=='cancelled'?{status:t.email.phase==='sent'&&t.email.review_date>day?'Scheduled':'Pending',next_action:t.email.next_action,next_action_date:t.email.review_date}:{}),is_pa:false,scope:t.visibility==='private'?'private':'fenmeat',review_group:t.visibility==='private'?'Private PA':'Take uit die app',subject_key:t.id});
 }
 return rows;
}
export function workCounts(rows,username){const active=rows.filter(paOpen);return {open:active.length,mine:active.filter(r=>taskOwner(r)===username||ownStep(r,username)).length,fenmeat:active.filter(r=>r.scope==='fenmeat').length,private:active.filter(r=>r.scope==='private').length,pending:active.filter(r=>r.status==='Pending').length,waiting:active.filter(r=>r.status==='Waiting').length,scheduled:active.filter(r=>r.status==='Scheduled').length,submitted:rows.filter(r=>r.completion_pending).length};}
export function selectWork(rows,{username,admin,scope='mine',status='open',search='',person='',date='',priority=''}){
 const statusFor=r=>{
  if(scope!=='mine'||!paOpen(r)||!r.steps?.length||r.ready_for_approval)return r.status;
  const mine=r.steps.filter(s=>s.assigned_to===username&&!stepClosed(s));
  if(!mine.length)return r.status;
  if(ownStep(r,username,'open'))return 'Pending';
  return mine.some(s=>!s.blocked&&s.effective_status==='Scheduled')?'Scheduled':'Waiting';
 };
 return rows.filter(r=>(scope==='mine'?(taskOwner(r)===username||ownStep(r,username)):scope==='pa'?(taskOwner(r)==='pa'||ownStep(r,'pa','open')):scope==='others'?!!taskOwner(r)&&!['pa',username].includes(taskOwner(r)):scope==='private'?r.scope==='private':scope==='fenmeat'?r.scope==='fenmeat':scope==='all')
 &&(status==='all'||status==='open'&&statusFor(r)==='Pending'||status==='scheduled'&&statusFor(r)==='Scheduled'||status==='closed'&&['Complete','Cancelled','Archived'].includes(r.status)||status==='complete'&&r.status==='Complete'||status==='cancelled'&&r.status==='Cancelled'||status==='waiting'&&statusFor(r)==='Waiting'||status==='submitted'&&r.completion_pending)
 &&(!person||taskOwner(r)===person||r.steps?.some(s=>s.assigned_to===person))
 &&(!date||[r.due_date,r.review_date,paDue(r)].includes(date)||r.steps?.some(s=>s.due_date===date))
 &&(!priority||r.priority===priority)
 &&(!search||[r.id,r.pa_task_id,r.app_task_id,r.title,r.next_action,r.details,r.supplier,r.outcome,taskOwner(r),r.assigned_to,r.review_group,...(r.steps||[]).map(s=>s.description),...(r.stages||[]).flatMap(t=>[t.id,t.title,t.details,t.supplier])].join(' ').toLowerCase().includes(search.toLowerCase())))
 .sort((a,b)=>Number(paOpen(b))-Number(paOpen(a))||({Critical:0,High:1,Normal:2,Low:3}[a.priority]??2)-({Critical:0,High:1,Normal:2,Low:3}[b.priority]??2)||(paDue(a)||'9999').localeCompare(paDue(b)||'9999')||a.title.localeCompare(b.title));
}
