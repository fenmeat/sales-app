import {isTaskManager,taskVisibility} from './task-access.js';
import {check,dateKey} from './domain.js';
import {projectTask,taskType,nextOccurrence,localDate,stepClosed} from './task-workflow.js';
const clean=(s,max=3000)=>{check(typeof s==='string'&&s.trim()&&s.length<=max,'Vul die stap se besonderhede in.');return s.trim();};
const url=s=>{if(!s)return '';let u;try{u=new URL(s);}catch{}check(u&&u.protocol==='https:'&&!u.username&&!u.password,'Gebruik ’n volledige veilige dokumentskakel.');return u.href;};
export function validateSteps(steps,users){
 check(Array.isArray(steps)&&steps.length>0&&steps.length<=100,'Gebruik 1 tot 100 stappe.');
 const ids=new Set();const result=steps.map(s=>{
  check(/^[a-zA-Z0-9-]{1,90}$/.test(s.id||'')&&!ids.has(s.id),'Elke stap moet ’n unieke verwysing hê.');ids.add(s.id);
  check((users.includes(s.assigned_to)||s.assigned_to==='pa'),'Kies wie hierdie stap moet doen.');check(['Pending','In Progress','Scheduled','Waiting','Complete','Waived'].includes(s.status),'Kies ’n geldige stapstatus.');
  check(s.status!=='Waived'||(s.waiver?.by&&s.waiver?.at&&s.waiver?.reason?.trim()),'Gee die rede waarom die stap verval.');
  const due_date=s.due_date?dateKey(s.due_date):'';check(!['Waiting','Scheduled'].includes(s.status)||due_date,'Kies wanneer ons weer moet opvolg.');check(s.status!=='Waiting'||s.waiting_reason?.trim(),'Sê waarvoor ons wag.');
  check(Array.isArray(s.dependencies||[])&&(s.dependencies||[]).length<=100,'Ongeldige vorige stappe.');
  check(s.status!=='Complete'||(s.completion?.recorded_source&&s.completion?.note||s.completion?.by&&s.completion?.at&&Number.isFinite(Date.parse(s.completion.at))),'Voltooiing moet ’n persoon en datum hê.');
  const reminder_mode=s.reminder_mode||'due';check(['due','daily','off'].includes(reminder_mode),'Kies ’n stapherinnering.');
  check(Array.isArray(s.attachments||[])&&(s.attachments||[]).length<=120,'Gebruik hoogstens 120 stapdokumente.');
  const completion=s.completion?{...s.completion,proof_url:url(s.completion.proof_url)}:null;
  return {id:s.id,description:clean(s.description),assigned_to:s.assigned_to,due_date,status:s.status,required:s.required!==false,dependencies:[...new Set(s.dependencies||[])],waiting_reason:String(s.waiting_reason||'').slice(0,2000),notes:String(s.notes||'').slice(0,5000),document_url:url(s.document_url),requires_evidence:!!s.requires_evidence,reminder_mode,attachments:s.attachments||[],...(s.waiver?{waiver:s.waiver}:{}),completion};
 });
 check(result.some(s=>s.required),'Ten minste een stap moet vereis word.');
 const map=new Map(result.map(s=>[s.id,s])),visiting=new Set(),visited=new Set();
 function visit(id){check(map.has(id),'’n Vorige stap bestaan nie.');check(!visiting.has(id),'Stappe kan nie in ’n sirkel van mekaar afhang nie.');if(visited.has(id))return;visiting.add(id);for(const dep of map.get(id).dependencies)visit(dep);visiting.delete(id);visited.add(id);}
 result.forEach(s=>visit(s.id));return result;
}
export async function workflowAction({task,b,user,admin,manage:manager=admin,users,at,db}){
 const originalCompletion=task.completion,originalStatus=task.status;
 const action=b.action,manage=manager||(!(task.steps||[]).some(s=>s.assigned_to!==user.username)&&task.created_by===user.username&&task.assigned_to===user.username);
 if(action==='start_workflow'){
  check(manage,'Net die eienaar of admin kan stappe opstel.',403);check(task.kind!=='stocktake','Behoud die bestaande voorraadtelling se bewysproses.');check(taskType(task)!=='workflow','Hierdie taak het reeds stappe.');check(b.note?.trim(),'Teken aan waarom die taak na stappe omgeskakel word.');
  const steps=b.steps||[{id:'step-1',description:task.title,assigned_to:task.assigned_to,due_date:task.review_date||task.due_date,status:task.status==='Complete'?'Complete':'Pending',completion:task.completion}];
  if(!manager)check(steps.every(s=>s.assigned_to===user.username),'Jy kan net eie stappe opstel.',403);
  if(!admin)check(steps.every(s=>s.status!=='Complete'),'Slegs ’n admin kan bestaande voltooiings met bronbewys oordra.',403);
  if(steps.some(s=>s.status==='Complete'))check(admin&&steps.filter(s=>s.status==='Complete').every(s=>s.completion?.note||s.completion?.proof_url),'Gee die bevestiging vir elke reeds voltooide stap.');
  task.legacy_completion=task.completion;task.task_type='workflow';task.pa_required=!!(task.pa_task_id||task.parent_cycle_id||b.pa_required);task.steps=validateSteps(steps,users);task.status='Pending';task.completion=null;task.repeat='none';task.last_reason=clean(b.note);
 }else{
  check(taskType(task)==='workflow','Hierdie taak het nog nie stappe nie.');check(task.status!=='Cancelled','Heropen die taak eers.');
  if(action==='approve_workflow'){
   check(user.username==='alex'||task.assigned_to===user.username||(task.kind==='general'&&taskVisibility(task)==='operational'&&isTaskManager(user.username)),'Die verantwoordelike persoon of ’n gemagtigde taakbestuurder moet die taak goedkeur.',403);
   const remaining = task.steps.filter(s=>s.required!==false&&!stepClosed(s));
   check(projectTask(task).ready_for_approval,'Hierdie stappe bly oor: '+remaining.map(s=>s.description).join(' · '));
   task.approval={by:user.username,at,note:String(b.note||'').slice(0,3000)};task.completion=task.approval;task.status='Complete';return task;
  }else if(action==='step_reorder'){
   check(manage,'Net die eienaar of admin kan stappe herrangskik.',403);
   check(Array.isArray(b.step_ids)&&b.step_ids.length===task.steps.length&&new Set(b.step_ids).size===task.steps.length&&b.step_ids.every(id=>task.steps.some(s=>s.id===id)),'Behou elke bestaande stap een keer.');
   task.steps=b.step_ids.map(id=>task.steps.find(s=>s.id===id));
  }else if(action==='status_override'){
   check(manage,'Net die eienaar of admin kan die status korrigeer.',403);const reason=clean(b.note);
   if(b.status==='auto')task.status_override=null;
   else{check(['Pending','Scheduled','Waiting'].includes(b.status),'Voltooi die vereiste stappe om die taak af te handel.');check(b.status==='Pending'||b.until,'Kies ’n opvolgdatum.');task.status_override={status:b.status,until:b.until?dateKey(b.until):'',reason,by:user.username,at};}task.last_reason=reason;
  }else{
   const index=task.steps.findIndex(s=>s.id===b.step_id),old=task.steps[index];
   if(action==='step_add'){check(manage,'Net die eienaar of admin kan stappe byvoeg.',403);check(!b.data?.completion&&!b.data?.attachments?.length&&!['Complete','Completed','Waived'].includes(b.data?.status),'Voltooi die nuwe stap afsonderlik.');check(manager||b.data?.assigned_to===user.username,'Jy kan net eie stappe delegeer.',403);task.steps.push({...b.data,id:b.step_id,status:b.data?.status||'Pending',completion:null});}
   else{
    check(old,'Stap nie gevind nie.',404);check(manager||old.assigned_to===user.username,'Hierdie stap is aan iemand anders toegeken.',403);
    if(action==='step_update'){check(b.data?.status!=='Waived'&&old.status!=='Waived','Gebruik die verval- of heropenaksie.');check(manage,'Net die eienaar of admin kan stappe wysig.',403);check(manager||old.status!=='Complete','Heropen hierdie stap om dit te verander.');check(b.data&&Object.keys(b.data).every(k=>['description','assigned_to','due_date','status','dependencies','waiting_reason','notes','document_url','required','requires_evidence','reminder_mode'].includes(k)),'Ongeldige stapveld.');check(b.data.status!=='Complete'||old.status==='Complete','Gebruik die Klaar-knoppie.');
     if(old.status==='Complete'){
      check(!b.data.status||b.data.status==='Complete','Gebruik Heropen stap om die voltooiing te verander.');
      check((b.data.required===undefined||b.data.required===old.required)&&(b.data.dependencies===undefined||JSON.stringify(b.data.dependencies)===JSON.stringify(old.dependencies)),'Heropen die stap voordat jy sy afhanklikhede verander.');
     }
     check(manager||!b.data.assigned_to||b.data.assigned_to===user.username,'Net admin kan aan ’n ander persoon delegeer.',403);
     check(b.data.status!=='In Progress'||!projectTask(task).steps[index].blocked,'Voltooi eers die vorige stap.');
     task.steps[index]={...old,...b.data};}
    else if(action==='step_waive'){
     check(manage&&!stepClosed(old),'Slegs die taakbestuurder kan ’n oop stap laat verval.',403);
     task.steps[index]={...old,status:'Waived',waiver:{by:user.username,at,reason:clean(b.note)},completion:null};
    }else if(action==='step_start'){
     check(!stepClosed(old)&&!projectTask(task).steps[index].blocked,'Heropen die stap of voltooi eers die vorige stap.');
     task.steps[index]={...old,status:'In Progress'};
    }else if(action==='step_note'){
     check(b.note?.trim()||b.files?.length,'Voeg ’n nota of dokument by.');
     task.steps[index]={...old,notes:[old.notes,b.note?.trim()].filter(Boolean).join('\n').slice(-5000)};
    }else if(action==='step_delete'){
     check(manage,'Net die eienaar of admin kan stappe verwyder.',403);check(b.confirm===true&&b.note?.trim(),'Bevestig die verwydering en gee ’n rede.');
     check(!task.steps.some(s=>s.dependencies?.includes(old.id)),'Verander eers die stappe wat van hierdie stap afhang.');
     task.steps.splice(index,1);
    }else if(action==='step_complete'){
     check(!stepClosed(old),'Hierdie stap is reeds klaar.',409);check(!projectTask(task).steps[index].blocked,'Voltooi eers die vorige vereiste stap.');
     let dispatch;
     if(task.dispatch_step_id===old.id){
      check(admin&&b.po_revision===task.po_revision,'Kontroleer die goedgekeurde bestelling en sy weergawe.');
      check(['Email','WhatsApp','Other'].includes(b.channel)&&Number.isFinite(Date.parse(b.sent_at))&&Date.parse(b.sent_at)<=Date.now()+60000,'Gee die werklike stuurtyd en metode.');
      dispatch={channel:b.channel,sent_at:new Date(b.sent_at).toISOString(),po_revision:task.po_revision,owner_confirmation:true};
     }
     const attachments=b.attachments||[];check(Array.isArray(attachments)&&attachments.length<=12,'Gebruik hoogstens 12 bewysstukke.');
     for(const id of attachments){const f=await db.prepare('SELECT task_id,username FROM v2_task_attachments WHERE id=?').bind(id).first();check(f?.task_id===task.id&&(manager||f.username===user.username),'Die bewysstuk behoort aan ’n ander taak.');}
     check(attachments.every(id=>!task.attachments?.includes(id)&&!task.steps.some(s=>s.attachments?.includes(id))),'Voeg nuwe voltooiingsbewys by; opdragdokumente is nie voltooiingsbewys nie.');
     const proof_url=url(b.proof_url);check(!old.requires_evidence||proof_url||attachments.length,'Voeg die vereiste bewys by.');task.steps[index]={...old,status:'Complete',completion:{by:user.username,at,note:String(b.note||'').slice(0,3000),proof_url,attachments,...dispatch}};
    }else if(action==='step_reopen'){check(manage,'Net die eienaar of admin kan ’n stap heropen.',403);check(b.note?.trim(),'Sê waarom hierdie stap heropen word.');task.steps[index]={...old,status:'Pending',completion:null,waiver:null};task.last_reason=clean(b.note);}
    else check(false,'Onbekende stapaksie.');
   }
   task.steps=validateSteps(task.steps,users);task.status_override=null;
  }
 }
 if(['step_add','step_reopen','start_workflow'].includes(action)){task.approval=null;task.completion=null;task.status='Pending';}
 const projected=projectTask(task);task.status=projected.status;task.completion=task.status==='Complete'?originalCompletion:null;if(task.status!=='Complete')task.approval=null;return task;
}
export function completeReminder(task,at){
 if(taskType(task)!=='reminder'||!task.repeat||task.repeat==='none')return task;
 const date=nextOccurrence(task.recurrence_anchor||task.due_date||task.review_date,task.repeat,localDate(new Date(at)));
 task.recurrence_anchor=task.recurrence_anchor||task.due_date||task.review_date;
 task.last_occurrence={...task.completion,due_date:task.review_date||task.due_date};task.occurrence=(task.occurrence||0)+1;task.status='Scheduled';task.completion=null;task.due_date=date;task.review_date=date;
 if(task.reminder_mode==='once')task.reminder_at=date+'T06:00:00.000Z';return task;
}
