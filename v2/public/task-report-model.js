export const isOpen=t=>['Pending','Waiting'].includes(t.status);
export const reviewDate=t=>t.status==='Waiting'?t.review_date:t.due_date||t.review_date;
export const localDay=iso=>iso?new Date(Date.parse(iso)+7200000).toISOString().slice(0,10):'';
export function reportGroups(tasks,{username,admin,today,owner='mine',search=''}){
 const pool=tasks.filter(t=>(admin&&owner==='all'||t.assigned_to===username)&&(!search||[t.title,t.details,t.assigned_to,t.supplier].join(' ').toLowerCase().includes(search.toLowerCase())));
 const score=t=>(t.feedback_request?.status==='pending'&&t.feedback_request.to===username?100:0)+({Critical:80,High:40,Normal:10,Low:0}[t.priority]??10)+(reviewDate(t)&&reviewDate(t)<=today?30:0)+(t.status==='Waiting'?5:0);
 const active=pool.filter(isOpen).sort((a,b)=>score(b)-score(a)||(reviewDate(a)||'9999').localeCompare(reviewDate(b)||'9999')||a.title.localeCompare(b.title));
 return {priorities:active.slice(0,3),other:active.slice(3),completed:pool.filter(t=>t.status==='Complete'&&localDay(t.completion?.at)===today),open:active.length,overdue:active.filter(t=>reviewDate(t)&&reviewDate(t)<today).length};
}
export function reportActions(t,{username,admin}){
 if(!isOpen(t))return [];
 const done={action:t.kind==='stocktake'?'stocktake':'complete',label:t.kind==='stocktake'?'Open stocktake':t.kind==='po_dispatch'?'Confirm sent':t.requires_evidence?'Add proof & finish':'Resolved'};
 if(t.feedback_request?.status==='pending'&&t.feedback_request.to===username)return [done,{action:'in_progress',label:'In progress'},{action:'blocked',label:'Need help'}];
 return [done,{action:'remind',label:'Remind me'},admin&&t.assigned_to!==username?{action:'ask',label:t.feedback_request?.status==='pending'?'Update requested':'Ask '+t.assigned_to[0].toUpperCase()+t.assigned_to.slice(1),disabled:t.feedback_request?.status==='pending'}:{action:'wait',label:'Waiting / blocked'}];
}
export function reminderOptions(now=new Date()){
 const local=new Date(now.getTime()+7200000),day=local.toISOString().slice(0,10);
 const tomorrow=new Date(day+'T08:00:00+02:00');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
 const monday=new Date(tomorrow);while(monday.getUTCDay()!==1)monday.setUTCDate(monday.getUTCDate()+1);
 return [{label:'Tomorrow · 08:00',at:tomorrow.toISOString()},...(monday.getTime()!==tomorrow.getTime()?[{label:'Monday · 08:00',at:monday.toISOString()}]:[]),{label:'In 1 hour',at:new Date(now.getTime()+3600000).toISOString()}];
}
