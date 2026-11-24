// Shared date-aware projection: the app unlocks work without a PA run.
export const localDate=(now=new Date())=>new Date(now.getTime()+7200000).toISOString().slice(0,10);
export const taskType=t=>t.task_type||(t.kind==='general'&&!t.pa_task_id&&!t.parent_cycle_id?'reminder':'legacy');
export const syncRequired=t=>taskType(t)!=='reminder'&&(!!t.pa_task_id||!!t.parent_cycle_id||t.pa_required===true||taskType(t)==='legacy');
export const stepClosed = step => ['Complete','Waived'].includes(step.status);
export function supplierSteps(task) {
 const descriptions=['Stuur die goedgekeurde bestelling.','Bevestig ontvangs en verklaar verskille.',
  'Vergelyk die faktuur en ontvangsbewys.','Bevestig die betaaldatum en reël betaling.',
  'Bevestig betaling en heg die betaalbewys aan.'];
 const ids=['dispatch','receipt','invoice','payment-date','payment-proof'];
 return descriptions.map((description,i)=>({id:ids[i],description,assigned_to:task.assigned_to,status:'Pending',
  due_date:i===0?task.review_date||task.due_date:'',dependencies:i?[ids[i-1]]:[],
  requires_evidence:i===4||i===0&&task.requires_evidence,reminder_mode:'due'}));
}
export function standardSteps(task, day=localDate()) {
 if (task.steps?.length) return task.steps;
 const closed=['Complete','Cancelled','Archived','Klaar gemeld'].includes(task.status);
 const review=!closed&&task.native_review;
 const due=review?.due_date||task.next_action_date||task.review_date||task.due_date||'';
 return [{id:'current',description:!closed&&(review?.description||task.responsibility?.action)||task.title,
   assigned_to:review?.assigned_to||taskOwner(task),due_date:due,status:task.status,
   effective_status:task.status,overdue:!closed&&!!due&&due<day,
   waiting_reason:task.waiting_reason,document_url:task.document_url,
   completion:task.completion?{by:task.completion.by,at:task.completion.at,note:task.completion.note}:null,requires_evidence:task.requires_evidence}];
}
export function stepProgress(steps) {
 const done=steps.filter(s=>s.status==='Complete').length;
 const waived=steps.filter(s=>s.status==='Waived'||s.status==='Cancelled').length;
 return {done,total:steps.length,remaining:steps.length-done-waived,percent:Math.round((done+waived)*100/Math.max(1,steps.length)),
   overdue:steps.filter(s=>s.overdue).length,...(waived?{waived}:{})};
}
export function stepReminder(task,step,now=new Date()){
 const date=localDate(now),mode=step.reminder_mode||'due';
 if(['Complete','Cancelled'].includes(task.status)||stepClosed(step)||step.blocked||step.assigned_to==='pa'||mode==='off'||!step.due_date||step.due_date>date||new Date(now.getTime()+7200000).toISOString().slice(11,16)<'08:00')return null;
 const kind=step.due_date<date?'step_overdue':'step_due';
 return {id:['step',task.id,step.id,kind,mode==='daily'?date:step.due_date,step.assigned_to].join('-'),kind};
}
export function stepView(steps,day=localDate()){
 const done=new Set(steps.filter(stepClosed).map(s=>s.id));
 return steps.map(s=>{const blocked=(s.dependencies||[]).some(id=>!done.has(id));let effective_status=s.status;
  if(!stepClosed(s))effective_status=blocked?'Waiting':s.status==='In Progress'?'In Progress':s.status==='Waiting'&&(!s.due_date||s.due_date>day)?'Waiting':s.due_date>day?'Scheduled':'Pending';
  return {...s,blocked,effective_status,overdue:!stepClosed(s)&&!blocked&&!!s.due_date&&s.due_date<day};
 });
}
export function projectTask(t,day=localDate()){
 const type=taskType(t),result={...t,task_type:type};
 if(t.step_only||t.status==='Cancelled')return result;
 if(type==='workflow'&&t.steps?.length){
  const steps=stepView(t.steps,day),open=steps.filter(s=>s.required!==false&&!stepClosed(s));
  const ready=open.filter(s=>!s.blocked),actionable=ready.filter(s=>['Pending','In Progress'].includes(s.effective_status));
  const future=ready.filter(s=>s.effective_status==='Scheduled'),waiting=ready.filter(s=>s.effective_status==='Waiting');
  // Existing closed workflows stay closed. Every new/reopened workflow needs
  // explicit final approval; completing a child never supplies that approval.
  const approved=!!t.approval||t.status==='Complete'&&(!!t.completion||t.historical_closure===true);
  const ready_for_approval=!open.length&&!approved;
  let status=!open.length?(approved?'Complete':'Pending'):actionable.length?'Pending':waiting.length?'Waiting':future.length?'Scheduled':'Waiting';
  const next=[...actionable,...waiting,...future][0]||open[0];
  const override=t.status_override;if(open.length&&override&&(!override.until||override.until>day))status=override.status;
  return {...result,status,steps,ready_for_approval,next_action:next?.description||(ready_for_approval?'Wag vir finale goedkeuring.':'Taak afgehandel.'),next_action_date:next?.due_date||'',next_assigned_to:next?.assigned_to||t.assigned_to,waiting_reason:next?.waiting_reason||'',progress:stepProgress(steps)};
 }
 if(type==='reminder'&&t.status!=='Complete'){
  const date=t.status==='Waiting'?t.review_date||t.due_date:t.due_date||t.review_date;return {...result,status:t.status==='Waiting'&&date>day?'Waiting':date>day?'Scheduled':'Pending',next_action:t.details||t.title,next_action_date:date||''};
 }
 return result;
}
export function nextOccurrence(date,repeat,day=localDate()){
 if(!repeat||repeat==='none')return '';
 const origin=new Date(date+'T12:00:00Z');let next=new Date(origin);
 for(let n=1;n<=50000;n++){
  if(repeat==='monthly'){const y=origin.getUTCFullYear(),m=origin.getUTCMonth()+n;next=new Date(Date.UTC(y,m,1,12));next.setUTCDate(Math.min(origin.getUTCDate(),new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate()));}
  else next.setUTCDate(next.getUTCDate()+({daily:1,weekly:7}[repeat]||1));
  const value=next.toISOString().slice(0,10);if(value>day)return value;
 }
 throw Error('Kies ’n geldige herhaling.');
}
export const statusLabel=s=>({Pending:'Doen nou',Scheduled:'Scheduled Tasks · Later',Waiting:'Wag vir iemand',Complete:'Klaar',Cancelled:'Gekanselleer'}[s]||s);

// The contact controls access. The next action determines whose list shows the task.
export function taskOwner(task) {
  if (task.native_review&&!['Complete','Cancelled'].includes(task.status)) return task.native_review.assigned_to;
  if (task.display_owner) return task.display_owner;
  if (task.next_assigned_to) return task.next_assigned_to;
  if (task.email && !['completed','cancelled'].includes(task.email.phase)) {
    return ['approval','draft'].includes(task.email.phase) ? 'alex' : 'pa';
  }
  if (task.part_pending) return 'pa';
  if (task.app_owner_changed) return task.assigned_to;
  if (task.responsibility) return task.responsibility.owner;
  const job = task.pa_work?.find(w => w.status !== 'answered');
  if (job && (task.pa_does_work || task.part_confirmation)) {
    return ['approval','blocked'].includes(job.status) ? job.actor : 'pa';
  }
  if (task.pa_does_work && !job) return 'pa';
  return task.assigned_to;
}

export function ownStep(task, username, status) {
  return task.steps?.find(step => step.assigned_to === username && !stepClosed(step)
    && (!status || (status === 'open' ? !step.blocked && ['Pending','In Progress'].includes(step.effective_status || step.status)
      : status === 'scheduled' ? step.effective_status === 'Scheduled' : true)));
}

export function taskBrief(task, username) {
  const owner = taskOwner(task), step = ownStep(task,username,'open');
  const closed = ['Complete','Cancelled','Archived','Klaar gemeld'].includes(task.status);
  const job=(task.pa_work||[]).find(w=>['blocked','approval'].includes(w.status));
  const result=job?.results?.at(-1);
  const next = task.native_review?.description || task.work_next_action || (result&&task.pa_does_work?result.next_action:'') || (task.part_pending ? 'PA moet die bevestiging nagaan en vasstel wat nog oorbly.' :
    task.next_action || task.details || task.title);
  const current = task.next_assigned_to || task.email || task.app_edit_pending;
  const single = current ? next : task.responsibility?.action || next;
  const completed = task.steps?.filter(s=>s.status==='Complete').map(s=>s.description);
  const progress = task.progress && typeof task.progress === 'object' ?
    task.progress.done+' van '+task.progress.total+' stappe klaar.' :
    task.outcome || task.display_progress || task.part_confirmation?.note || task.completion?.note || task.last_update?.text || 'Geen vordering is nog aangeteken nie.';
  return {owner, situation: task.responsibility?.situation || (task.details?.length<=240?task.details:'') || task.title,
    action: !closed && !['Waiting','Scheduled'].includes(task.status) && (step || owner === username) ?
      step?.description || single : 'Niks op hierdie stadium nie',
    progress: completed?.length ? completed.join(' · ') : task.outcome || (task.part_pending ? 'Jou aandeel is as klaar aangemeld.' : progress), next: closed ? 'Geen verdere stap nie.' : single};
}
