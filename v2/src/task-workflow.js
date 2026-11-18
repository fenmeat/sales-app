// Shared date-aware projection: the app unlocks work without a PA run.
export const localDate=(now=new Date())=>new Date(now.getTime()+7200000).toISOString().slice(0,10);
export const taskType=t=>t.task_type||(t.kind==='general'&&!t.pa_task_id&&!t.parent_cycle_id?'reminder':'legacy');
export const syncRequired=t=>taskType(t)!=='reminder'&&(!!t.pa_task_id||!!t.parent_cycle_id||t.pa_required===true||taskType(t)==='legacy');
export function stepReminder(task,step,now=new Date()){
 const date=localDate(now),mode=step.reminder_mode||'due';
 if(['Complete','Cancelled'].includes(task.status)||step.status==='Complete'||mode==='off'||!step.due_date||step.due_date>date||new Date(now.getTime()+7200000).toISOString().slice(11,16)<'08:00')return null;
 const kind=step.due_date<date?'step_overdue':'step_due';
 return {id:['step',task.id,step.id,kind,mode==='daily'?date:step.due_date,step.assigned_to].join('-'),kind};
}
export function stepView(steps,day=localDate()){
 const done=new Set(steps.filter(s=>s.status==='Complete').map(s=>s.id));
 return steps.map(s=>{const blocked=(s.dependencies||[]).some(id=>!done.has(id));let effective_status=s.status;
  if(s.status!=='Complete')effective_status=blocked?'Waiting':s.status==='In Progress'?'In Progress':s.status==='Waiting'&&(!s.due_date||s.due_date>day)?'Waiting':s.due_date>day?'Scheduled':'Pending';
  return {...s,blocked,effective_status,overdue:s.status!=='Complete'&&!!s.due_date&&s.due_date<day};
 });
}
export function projectTask(t,day=localDate()){
 const type=taskType(t),result={...t,task_type:type};
 if(t.step_only||t.status==='Cancelled')return result;
 if(type==='workflow'&&t.steps?.length){
  const steps=stepView(t.steps,day),open=steps.filter(s=>s.required!==false&&s.status!=='Complete');
  const ready=open.filter(s=>!s.blocked),actionable=ready.filter(s=>['Pending','In Progress'].includes(s.effective_status));
  const future=ready.filter(s=>s.effective_status==='Scheduled'),waiting=ready.filter(s=>s.effective_status==='Waiting');
  // Existing closed workflows stay closed. Every new/reopened workflow needs
  // explicit final approval; completing a child never supplies that approval.
  const approved=!!t.approval||t.status==='Complete'&&!!t.completion;
  const ready_for_approval=!open.length&&!approved;
  let status=!open.length?(approved?'Complete':'Pending'):actionable.length?'Pending':waiting.length?'Waiting':future.length?'Scheduled':'Waiting';
  const next=[...actionable,...waiting,...future][0]||open[0];
  const override=t.status_override;if(open.length&&override&&(!override.until||override.until>day))status=override.status;
  const done=steps.filter(s=>s.status==='Complete').length;
  return {...result,status,steps,ready_for_approval,next_action:next?.description||(ready_for_approval?'Wag vir finale goedkeuring.':'Taak afgehandel.'),next_action_date:next?.due_date||'',next_assigned_to:next?.assigned_to||t.assigned_to,waiting_reason:next?.waiting_reason||'',progress:{done,total:steps.length,remaining:steps.length-done,percent:Math.round(done/steps.length*100),overdue:steps.filter(s=>s.overdue).length}};
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
