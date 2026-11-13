import {projectTask,localDate} from './task-workflow.js';
export const paOpen=t=>['Pending','Scheduled','Waiting'].includes(t.status);
export const paDue=t=>t.next_action_date||t.review_date||t.due_date;
// A person's confirmation saves immediately; the PA spreadsheet remains authoritative.
const needsReview=r=>r.scope!=='fenmeat'||/(?:\bPO[-\s]?\d+\b|\b(?:supplier|bestelling(?:s)?|order|invoice|faktuur|betaling|payment|bank|ontvangs|aflewering|stocktake|voorraadtelling|telling|payroll|loon|uif|skuld|rekeninge)\b)/i.test([r.title,r.review_group].join(' '));
export function unifiedWork(app,pa){
 const day=app.today||localDate();app={...app,tasks:app.tasks.map(t=>projectTask(t,day))};
 const known=new Set(pa.rows.map(r=>r.id)),knownApp=new Set(pa.rows.map(r=>r.app_task_id).filter(Boolean)),last=new Map();
 // Feedback is newest-first; a later reply can correct an earlier completion.
 for(const f of pa.feedback??[])if((f.action==='complete'||f.action==='respond')&&!last.has(f.subject_key))last.set(f.subject_key,f);
 const rows=pa.rows.map(r=>{
  const stages=app.tasks.filter(t=>t.pa_task_id===r.id||t.id===r.app_task_id),f=last.get(r.id);
  const completion_requested=paOpen(r)&&f?.action==='complete'&&f.status==='pending';
  const completion_pending=completion_requested&&f.actor===r.assigned_to&&stages.length===0&&!needsReview(r);
  const workflow=stages.find(t=>t.task_type==='workflow');
  const edited=stages.length===1&&stages[0].last_edit&&stages[0].pa_sync?.status==='pending'&&stages[0].kind==='general'?stages[0]:null;
  const scheduled=['Pending','Scheduled'].includes(r.status)&&r.review_date>day;
  const status=workflow?.status||edited?.status||(completion_pending?'Klaar gemeld':scheduled?'Scheduled':['Waiting','Scheduled'].includes(r.status)&&r.review_date&&r.review_date<=day?'Pending':r.status);
  return {...r,...(edited?{title:edited.title,priority:edited.priority,assigned_to:edited.assigned_to,due_date:edited.due_date,review_date:edited.review_date,next_action:edited.status==='Complete'?'Afgehandel. PA werk die bestaande register by.':edited.details,app_edit_pending:true}:{}),...(workflow?{status:workflow.status,next_action:workflow.next_action,next_action_date:workflow.next_action_date,steps:workflow.steps,progress:workflow.progress,workflow_id:workflow.id,assigned_to:workflow.next_assigned_to||workflow.assigned_to}:{}),is_pa:true,details:r.next_action,supplier:r.review_group,stages,source_status:r.status,completion_requested,completion_pending,needs_completion_review:completion_requested&&!completion_pending,status};
 });
 for(const t of app.tasks)if(!knownApp.has(t.id)&&(!t.pa_task_id||!known.has(t.pa_task_id)))rows.push({...t,is_pa:false,scope:'fenmeat',review_group:'New app tasks',subject_key:t.id});
 return rows;
}
export function workCounts(rows,username){const active=rows.filter(paOpen);return {open:active.length,mine:active.filter(r=>r.assigned_to===username||r.steps?.some(s=>s.assigned_to===username)).length,fenmeat:active.filter(r=>r.scope==='fenmeat').length,private:active.filter(r=>r.scope==='private').length,pending:active.filter(r=>r.status==='Pending').length,waiting:active.filter(r=>r.status==='Waiting').length,scheduled:active.filter(r=>r.status==='Scheduled').length,submitted:rows.filter(r=>r.completion_pending).length};}
export function selectWork(rows,{username,admin,scope='mine',status='open',search=''}){
 return rows.filter(r=>(scope==='mine'?(r.assigned_to===username||r.steps?.some(s=>s.assigned_to===username)):scope==='private'?r.scope==='private':scope==='fenmeat'?r.scope==='fenmeat':admin)
 &&(status==='all'||status==='open'&&r.status==='Pending'||status==='scheduled'&&r.status==='Scheduled'||status==='closed'&&['Complete','Cancelled','Archived'].includes(r.status)||status==='waiting'&&r.status==='Waiting'||status==='submitted'&&r.completion_pending)
 &&(!search||[r.title,r.next_action,r.details,r.assigned_to,r.review_group].join(' ').toLowerCase().includes(search.toLowerCase())))
 .sort((a,b)=>Number(paOpen(b))-Number(paOpen(a))||({Critical:0,High:1,Normal:2,Low:3}[a.priority]??2)-({Critical:0,High:1,Normal:2,Low:3}[b.priority]??2)||(paDue(a)||'9999').localeCompare(paDue(b)||'9999')||a.title.localeCompare(b.title));
}
