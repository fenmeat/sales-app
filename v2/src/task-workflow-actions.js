import {check,dateKey} from './domain.js';
import {projectTask,taskType,nextOccurrence,localDate} from './task-workflow.js';
const clean=(s,max=3000)=>{check(typeof s==='string'&&s.trim()&&s.length<=max,'Vul die stap se besonderhede in.');return s.trim();};
const url=s=>{if(!s)return '';let u;try{u=new URL(s);}catch{}check(u&&u.protocol==='https:'&&!u.username&&!u.password,'Gebruik ’n volledige veilige dokumentskakel.');return u.href;};
export function validateSteps(steps,users){
 check(Array.isArray(steps)&&steps.length>0&&steps.length<=100,'Gebruik 1 tot 100 stappe.');
 const ids=new Set();const result=steps.map(s=>{
  check(/^[a-zA-Z0-9-]{1,90}$/.test(s.id||'')&&!ids.has(s.id),'Elke stap moet ’n unieke verwysing hê.');ids.add(s.id);
  check(users.includes(s.assigned_to),'Kies wie hierdie stap moet doen.');check(['Pending','Scheduled','Waiting','Complete'].includes(s.status),'Kies ’n geldige stapstatus.');
  const due_date=s.due_date?dateKey(s.due_date):'';check(!['Waiting','Scheduled'].includes(s.status)||due_date,'Kies wanneer ons weer moet opvolg.');check(s.status!=='Waiting'||s.waiting_reason?.trim(),'Sê waarvoor ons wag.');
  check(Array.isArray(s.dependencies||[])&&(s.dependencies||[]).length<=100,'Ongeldige vorige stappe.');
  check(s.status!=='Complete'||(s.completion?.by&&s.completion?.at&&Number.isFinite(Date.parse(s.completion.at))),'Voltooiing moet ’n persoon en datum hê.');
  const completion=s.completion?{...s.completion,proof_url:url(s.completion.proof_url)}:null;
  return {id:s.id,description:clean(s.description),assigned_to:s.assigned_to,due_date,status:s.status,required:s.required!==false,dependencies:[...new Set(s.dependencies||[])],waiting_reason:String(s.waiting_reason||'').slice(0,2000),notes:String(s.notes||'').slice(0,5000),document_url:url(s.document_url),requires_evidence:!!s.requires_evidence,attachments:s.attachments||[],completion};
 });
 check(result.some(s=>s.required),'Ten minste een stap moet vereis word.');
 const map=new Map(result.map(s=>[s.id,s])),visiting=new Set(),visited=new Set();
 function visit(id){check(map.has(id),'’n Vorige stap bestaan nie.');check(!visiting.has(id),'Stappe kan nie in ’n sirkel van mekaar afhang nie.');if(visited.has(id))return;visiting.add(id);for(const dep of map.get(id).dependencies)visit(dep);visiting.delete(id);visited.add(id);}
 result.forEach(s=>visit(s.id));return result;
}
export async function workflowAction({task,b,user,admin,users,at,db}){
 const originalCompletion=task.completion,originalStatus=task.status;
 const action=b.action,manage=admin||(task.created_by===user.username&&task.assigned_to===user.username);
 if(action==='start_workflow'){
  check(manage,'Net die eienaar of admin kan stappe opstel.',403);check(task.kind!=='stocktake','Behoud die bestaande voorraadtelling se bewysproses.');check(taskType(task)!=='workflow','Hierdie taak het reeds stappe.');check(b.note?.trim(),'Teken aan waarom die taak na stappe omgeskakel word.');
  const steps=b.steps||[{id:'step-1',description:task.title,assigned_to:task.assigned_to,due_date:task.review_date||task.due_date,status:task.status==='Complete'?'Complete':'Pending',completion:task.completion}];
  if(!admin)check(steps.every(s=>s.status!=='Complete'),'Slegs ’n admin kan bestaande voltooiings met bronbewys oordra.',403);
  if(steps.some(s=>s.status==='Complete'))check(admin&&steps.filter(s=>s.status==='Complete').every(s=>s.completion?.note||s.completion?.proof_url),'Gee die bevestiging vir elke reeds voltooide stap.');
  task.legacy_completion=task.completion;task.task_type='workflow';task.pa_required=!!(task.pa_task_id||task.parent_cycle_id||b.pa_required);task.steps=validateSteps(steps,users);task.status='Pending';task.completion=null;task.repeat='none';task.last_reason=clean(b.note);
 }else{
  check(taskType(task)==='workflow','Hierdie taak het nog nie stappe nie.');check(task.status!=='Cancelled','Heropen die taak eers.');
  if(action==='status_override'){
   check(manage,'Net die eienaar of admin kan die status korrigeer.',403);const reason=clean(b.note);
   if(b.status==='auto')task.status_override=null;
   else{check(['Pending','Scheduled','Waiting'].includes(b.status),'Voltooi die vereiste stappe om die taak af te handel.');check(b.status==='Pending'||b.until,'Kies ’n opvolgdatum.');task.status_override={status:b.status,until:b.until?dateKey(b.until):'',reason,by:user.username,at};}task.last_reason=reason;
  }else{
   const index=task.steps.findIndex(s=>s.id===b.step_id),old=task.steps[index];
   if(action==='step_add'){check(manage,'Net die eienaar of admin kan stappe byvoeg.',403);check(b.data?.status!=='Complete','Voltooi die nuwe stap afsonderlik.');task.steps.push({...b.data,id:b.step_id,status:b.data?.status||'Pending',completion:null});}
   else{
    check(old,'Stap nie gevind nie.',404);check(admin||old.assigned_to===user.username,'Hierdie stap is aan iemand anders toegeken.',403);
    if(action==='step_update'){check(manage,'Net die eienaar of admin kan stappe wysig.',403);check(admin||old.status!=='Complete','Heropen hierdie stap om dit te verander.');check(b.data&&Object.keys(b.data).every(k=>['description','assigned_to','due_date','status','dependencies','waiting_reason','notes','document_url','required','requires_evidence'].includes(k)),'Ongeldige stapveld.');check(b.data.status!=='Complete'||old.status==='Complete','Gebruik die Klaar-knoppie.');
     if(old.status==='Complete'){
      check(!b.data.status||b.data.status==='Complete','Gebruik Heropen stap om die voltooiing te verander.');
      check((b.data.required===undefined||b.data.required===old.required)&&(b.data.dependencies===undefined||JSON.stringify(b.data.dependencies)===JSON.stringify(old.dependencies)),'Heropen die stap voordat jy sy afhanklikhede verander.');
     }
     task.steps[index]={...old,...b.data};}
    else if(action==='step_complete'){
     check(old.status!=='Complete','Hierdie stap is reeds klaar.',409);check(!projectTask(task).steps[index].blocked,'Voltooi eers die vorige vereiste stap.');
     const attachments=b.attachments||[];check(Array.isArray(attachments)&&attachments.length<=12,'Gebruik hoogstens 12 bewysstukke.');
     for(const id of attachments){const f=await db.prepare('SELECT task_id FROM v2_task_attachments WHERE id=?').bind(id).first();check(f?.task_id===task.id,'Die bewysstuk behoort aan ’n ander taak.');}
     const proof_url=url(b.proof_url);check(!old.requires_evidence||proof_url||attachments.length,'Voeg die vereiste bewys by.');task.steps[index]={...old,status:'Complete',completion:{by:user.username,at,note:String(b.note||'').slice(0,3000),proof_url,attachments}};
    }else if(action==='step_reopen'){check(manage,'Net die eienaar of admin kan ’n stap heropen.',403);check(b.note?.trim(),'Sê waarom hierdie stap heropen word.');task.steps[index]={...old,status:'Pending',completion:null};task.last_reason=clean(b.note);}
    else check(false,'Onbekende stapaksie.');
   }
   task.steps=validateSteps(task.steps,users);task.status_override=null;
  }
 }
 const projected=projectTask(task);task.status=projected.status;task.completion=task.status==='Complete'?(originalStatus==='Complete'&&originalCompletion?originalCompletion:{by:user.username,at,note:'Alle vereiste stappe afgehandel.'}):null;return task;
}
export function completeReminder(task,at){
 if(taskType(task)!=='reminder'||!task.repeat||task.repeat==='none')return task;
 const date=nextOccurrence(task.recurrence_anchor||task.due_date||task.review_date,task.repeat,localDate(new Date(at)));
 task.recurrence_anchor=task.recurrence_anchor||task.due_date||task.review_date;
 task.last_occurrence={...task.completion,due_date:task.review_date||task.due_date};task.occurrence=(task.occurrence||0)+1;task.status='Scheduled';task.completion=null;task.due_date=date;task.review_date=date;
 if(task.reminder_mode==='once')task.reminder_at=date+'T06:00:00.000Z';return task;
}
