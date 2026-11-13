import {createWorkspaceCache} from './task-workspace-cache.js';
import {taskType,projectTask,statusLabel,localDate} from './task-workflow.js';
import {stepsHTML,workflowForms} from './task-workflow-ui.js';
import './input-selection.js';
import {renderReport} from './tasks-report.js';
import {renderPaWorkspace,conversationHTML} from './pa-report-ui.js';
import {reminderOptions} from './task-report-model.js';
import {attachmentPicker,MAX_TASK_ATTACHMENTS,TASK_FILE_ACCEPT,fileData} from './task-attachments.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={alex:'Alex',alinda:'Alinda',xavier:'Xavier',xalinda:'Xalinda',tapiz:'Tapiz',mosa:'Musa',musa:'Musa'},name=u=>names[u]||u;
const dialog=$('#dialog');let reportMode=new URL(location.href).searchParams.get('view')==='report',rabbiMode=new URL(location.href).searchParams.get('view')==='rabbi',deepLinkHandled=false,mail={requests:[]},quickRetry=null;
const requestedReport=new URL(location.href).searchParams;
let pa=null,paError='',paScope='mine',reportDate=/^\d{4}-\d{2}-\d{2}$/.test(requestedReport.get('date')||'')?requestedReport.get('date'):(/^report-(\d{4}-\d{2}-\d{2}):/.exec(requestedReport.get('case')||'')?.[1]||''),paRetry=null;
let data,filter=new URL(location.href).searchParams.get('status')||'open',owner='mine',search='',busy=false,retry=null,dialogCleanup=()=>{};
const workspaceCache=createWorkspaceCache((...args)=>fetch(...args));
let mutationGeneration=0,legacyMode=false,loadSequence=0,inboxAt=0,inboxFlight=null,reportFlight=null,reportCache=null,searchTimer,detailSequence=0;
const mark=name=>{if(typeof performance!=='undefined'&&performance.mark)performance.mark(name);};
mark('tasks-module-ready');
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=await r.json();if(!r.ok){const e=Error(result.error||'Kon nie stoor nie. Probeer weer.');e.status=r.status;throw e;}if(body){mutationGeneration++;workspaceCache.clear();inboxAt=0;reportCache=null;loadSequence++;}return result;}
function toast(message,undo){const el=$('#message');el.textContent=message;if(undo){const b=document.createElement('button');b.textContent='Maak ongedaan';b.onclick=undo;el.append(' ',b);}el.style.display='block';setTimeout(()=>el.style.display='none',undo?15000:6500);}
function open(t){return !['Complete','Cancelled'].includes(t.status);}
function review(t){if(t.next_action_date)return t.next_action_date;return t.status==='Waiting'?t.review_date:t.due_date||t.review_date;}
function canManage(t){return data.admin||(t.created_by===data.username&&t.assigned_to===data.username&&t.kind!=='po_dispatch');}
function reminderLabel(t){return t.reminder_mode==='off'?'Geen herinnering':t.reminder_mode==='once'?'Herinnering '+new Date(t.reminder_at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'})+' SAST':'Herinner elke dag om 08:00 wanneer dit tyd is';}
function reminderControls(t={}){return `<label>Herinnering<select name="reminder_mode" aria-label="Reminder">${[['daily','Elke dag om 08:00 wanneer dit tyd is'],['once','Een keer op ’n gekose datum en tyd'],['off','Geen herinnering']].map(([v,l])=>`<option value="${v}" ${v===(t.reminder_mode||'daily')?'selected':''}>${l}</option>`).join('')}</select></label><label id="reminder-time" ${t.reminder_mode==='once'?'':'hidden'}>Herinnering se datum en tyd (Suid-Afrika)<input name="reminder_at" type="datetime-local" value="${t.reminder_at?new Date(Date.parse(t.reminder_at)+7200000).toISOString().slice(0,16):''}"></label><p class="help">Suid-Afrikaanse tyd. Die app kyk elke 5 minute vir herinneringe. Skakel kennisgewings op hierdie toestel aan om dit ook te ontvang wanneer die app toe is.</p>`;}
function setupReminder(form){const select=form.elements.reminder_mode,input=form.elements.reminder_at;const change=()=>{const once=select.value==='once';$('#reminder-time').hidden=!once;input.required=once;if(once&&!input.value)input.value=new Date(Date.now()+10800000).toISOString().slice(0,16);};select.onchange=change;change();}
function reminderValues(form){const mode=form.elements.reminder_mode.value;return {reminder_mode:mode,reminder_at:mode==='once'?new Date(form.elements.reminder_at.value+':00+02:00').toISOString():''};}
function dateLabel(t){const d=review(t);return d?(t.status==='Waiting'||!t.due_date?'Opvolg ':'Datum ')+d:'Geen datum';}
function workspaceURL(offset=0){
 const q=new URLSearchParams({status:filter,scope:paScope,search});
 if(offset){q.set('offset',offset);q.set('snapshot',pa.workspace.snapshot);}
 const deep=new URL(location.href).searchParams.get('case')||new URL(location.href).searchParams.get('task');if(deep)q.set('case',deep);
 return '/api/tasks/workspace?'+q;
}
function applyWorkspace(value,append=false){
 if(data&&data.username!==value.app.username){reportCache=null;pa=null;mail={requests:[]};data=null;}
 const old=pa,oldTasks=data?.tasks||[],oldNotifications=data?.notifications||[],extra=reportCache?.username===value.app.username?reportCache.data:null;
 const next=structuredClone(value);data={...next.app,notifications:oldNotifications,workspace_source:true,options_loaded:data?.options_loaded||false,suppliers:data?.suppliers||[]};
 pa={...next.pa,...(extra?{report:extra.report,history:extra.history,rabbi:extra.rabbi,rabbi_history:extra.rabbi_history,feedback:extra.feedback,context_rows:extra.rows}:{}),alerts:old?.alerts||[],reminders:old?.reminders||[]};
 if(append&&old?.workspace.snapshot===pa.workspace.snapshot&&!pa.workspace.reset){data.tasks=[...new Map([...oldTasks,...data.tasks].map(t=>[t.id,t])).values()];pa.workspace.rows=[...new Map([...old.workspace.rows,...pa.workspace.rows].map(r=>[r.id,r])).values()];pa.rows=[...new Map([...old.rows,...pa.rows].map(r=>[r.id,r])).values()];}
 if(data.invoice_rep){reportMode=false;rabbiMode=false;paScope='mine';}
 data.today=localDate();render();mark('tasks-'+filter+'-ready');
}
async function load(options={}){
 if(legacyMode)return legacyLoad();
 const offset=options.offset||0,key=workspaceURL(offset),sequence=++loadSequence,cached=workspaceCache.peek(key),hadData=!!data;
 if(cached)applyWorkspace(cached,!!offset);
 else if(data){const same=pa.workspace?.scope===paScope&&pa.workspace?.status===filter&&pa.workspace?.search===search;pa.workspace={...pa.workspace,...(same||offset?{}:{rows:[],total:0}),loading:true};render();}
 try{
  const result=await workspaceCache.read(key);if(sequence!==loadSequence||result.obsolete)return;
  if(result.unsupported){legacyMode=true;return legacyLoad();}
  if(!result.unchanged||!cached)applyWorkspace(result.value,!!offset);
  if(!hadData&&reportMode&&data.admin&&paScope==='mine'){paScope=data.username==='alex'?'all':'fenmeat';await load();return;}
  loadInbox();
  if(reportMode||rabbiMode)await loadReport();
  const id=new URL(location.href).searchParams.get('task');if(id&&!deepLinkHandled){deepLinkHandled=true;await detailsCurrent({id});}
 }catch(e){
  if(sequence!==loadSequence)return;
  if(e.status===404){legacyMode=true;return legacyLoad();}
  if([401,403].includes(e.status)){data=null;pa=null;workspaceCache.clear();return login(e);}
  if(data){if(pa?.workspace)pa.workspace.loading=false;render();toast(e.message);}
  else{$('#app').innerHTML='<main class="shell"><h1>Tasks</h1><p>'+esc(e.message)+'</p><button id="retry-load">Probeer weer</button></main>';$('#retry-load').onclick=load;}
 }
}
async function loadInbox(){
 if(!data||inboxFlight||Date.now()-inboxAt<60000)return;inboxAt=Date.now();const username=data.username;
 inboxFlight=(async()=>{try{const r=await api('/api/tasks/inbox');if(data?.username!==username)return;data.notifications=r.notifications||[];pa.alerts=r.alerts||[];pa.reminders=r.reminders||[];if(!dialog.open)render();}catch{/* Keep the existing list and retry on refresh/focus. */}finally{inboxFlight=null;}})();
 return inboxFlight;
}
async function loadReport(){
 if(data?.invoice_rep)return;const key=data.username+':'+reportDate;
 if(reportCache?.key===key){render();return;}
 if(reportFlight?.key===key&&reportFlight.generation===mutationGeneration)return reportFlight.promise;
 const username=data.username,selectedDate=reportDate,generation=mutationGeneration;
 const promise=(async()=>{try{const fresh=await api('/api/pa-report?view=report'+(selectedDate?'&date='+encodeURIComponent(selectedDate):''));if(data?.username!==username||reportDate!==selectedDate||generation!==mutationGeneration)return;reportCache={key,username,data:fresh};pa={...pa,report:fresh.report,history:fresh.history,rabbi:fresh.rabbi,rabbi_history:fresh.rabbi_history,feedback:fresh.feedback,context_rows:fresh.rows};render();}catch(e){toast(e.message);}finally{if(reportFlight?.key===key&&reportFlight.generation===generation)reportFlight=null;}})();reportFlight={key,promise,generation};return promise;
}
async function prepareOptions(){if(data?.workspace_source&&!data.options_loaded){const r=await api('/api/tasks/options');data.suppliers=r.suppliers;data.options_loaded=true;}}
async function newTask(){try{await prepareOptions();edit();}catch(e){toast(e.message);}}
async function detailsCurrent(t){
 if(!t)return;const sequence=++detailSequence;show('<h2>'+esc(t.title||'Taak')+'</h2><p>Besonderhede word gelaai…</p><button data-close>Maak toe</button>');
 try{const r=await api('/api/tasks?id='+encodeURIComponent(t.id));if(sequence!==detailSequence||!dialog.open)return;details(r.task);mark('task-details-ready');}catch(e){if(sequence===detailSequence)toast(e.message);}
}
function queryChanged(){return load();}
function searchChanged(value,pos){search=value;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{await load();const el=$('#pa-search');if(el){el.focus();try{el.setSelectionRange(pos,pos);}catch{}}},220);}
async function legacyLoad(){
 try{const first=!data;data=await api('/api/tasks');if(data.invoice_rep){reportMode=false;rabbiMode=false;}if(first&&reportMode&&data.admin)owner='all';let offset=data.next_offset;while(offset!==null){const page=await api('/api/tasks?offset='+offset);data.tasks.push(...page.tasks);offset=page.next_offset;}if(reportMode&&data.username==='alex'){try{mail=await api('/api/tasks/emails');let mailOffset=mail.next_offset;while(mailOffset!=null){const page=await api('/api/tasks/emails?offset='+mailOffset);mail.requests.push(...page.requests);mailOffset=page.next_offset;}}catch{mail={requests:[],error:'Die e-posstatus kon nie laai nie. Verfris en probeer weer.'};}}if(data.invoice_rep){pa=null;paError='';}else try{pa=await api('/api/pa-report'+(reportDate?'?date='+encodeURIComponent(reportDate):''));paError='';if(first&&reportMode)paScope=data.username==='alex'?'all':data.admin?'fenmeat':'mine';}catch(e){pa=null;paError='Die PA-taaklys kon nie laai nie. Hier is die take wat in die app gestoor is. Verfris en probeer weer.';}if(pa?.rabbi_access??pa?.private_report){const key=new URL(location.href).searchParams.get('case');if(key&&(pa.report?.sections.find(s=>s.id==='rabbi')?.items.some(i=>i.subject_key===key)||pa.rabbi?.items.some(i=>'report-'+pa.rabbi.date+':'+i.id===key))){rabbiMode=true;reportMode=false;const url=new URL(location.href);url.searchParams.set('view','rabbi');history.replaceState(null,'',url.pathname+url.search);}}else if(pa){rabbiMode=false;}render();const id=new URL(location.href).searchParams.get('task');if(id&&!deepLinkHandled){deepLinkHandled=true;const t=data.tasks.find(t=>t.id===id);if(t){if(reportMode&&!pa?.register_revision)document.querySelector('[data-report-task="'+t.id+'"]')?.scrollIntoView?.({block:'center'});else details(t);}}
 }catch(e){if(e.status===401||e.status===403)await login(e);else{$('#app').innerHTML='<main class="shell"><h1>Tasks</h1><p>'+esc(e.message)+'</p><button id="retry-load">Probeer weer</button></main>';$('#retry-load').onclick=load;}}
}
async function login(error){
 let phone;try{phone=await api('/api/invoicing/access/status');}catch{}
 if(phone?.registered){
  $('#app').innerHTML=`<main class="login"><h1>FenMeat Tasks</h1><p>Welcome, ${esc(phone.name)}. Enter your road phone PIN.</p><form id="task-pin"><label>Your 6-digit PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="current-password" required></label><p class="error" role="alert"></p><button class="primary">Sign in</button></form><p><a href="/invoicing/">Open Invoices / reset PIN</a></p></main>`;
  $('#task-pin').onsubmit=async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button'),input=form.querySelector('[name=pin]');if(button.disabled)return;button.disabled=true;const pin=input.value;input.value='';try{await api('/api/invoicing/access/login',{pin});await load();}catch(err){form.querySelector('.error').textContent=err.message;}finally{button.disabled=false;}};return;
 }
 $('#app').innerHTML=`<main class="login"><h1>FenMeat Tasks</h1><p>Sign in with your own app account.</p><form><label>Username<input name="username" autocomplete="username" required></label><label>App access key<input name="key" type="password" autocomplete="current-password" required></label><p class="error">${error.status===403?esc(error.message):''}</p><button class="primary">Sign in</button></form><p><a href="/invoicing/">Rep phone setup / PIN sign-in</a></p><p><a href="/">Home</a></p></main>`;$('.login form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api('/api/login',{username:f.get('username'),key:f.get('key')});await load();}catch(err){$('.login .error').textContent=err.message;}};}
function paViewURL(view){return '/tasks'+(view==='tasks'?'':'?view='+view+(reportDate?'&date='+encodeURIComponent(reportDate):''));}
async function showPaView(view){
 rabbiMode=view==='rabbi';reportMode=view==='report';
 if(reportMode)paScope=data.username==='alex'?'all':data.admin?'fenmeat':'mine';
 history.replaceState(null,'',paViewURL(view));await load();
}
function render(){
 if(data){data.tasks=data.tasks.map(t=>t.brief?t:projectTask(t,data.today));}
 if(pa?.workspace||pa?.register_revision||(pa?.rabbi_access||(rabbiMode&&pa?.private_report)))return renderPaWorkspace({app:data,pa,reportMode,rabbiMode,scope:paScope,status:filter,search,onScope:v=>{paScope=v;return pa.workspace?queryChanged():render();},onStatus:v=>{filter=v;return pa.workspace?queryChanged():render();},onSearch:(v,pos)=>{if(pa.workspace)return searchChanged(v,pos);search=v;render();const el=$('#pa-search');el.focus();try{el.setSelectionRange(pos,pos);}catch{}},onReportDate:async v=>{reportDate=v;history.replaceState(null,'',paViewURL(rabbiMode?'rabbi':'report'));await load();},onRefresh:()=>{inboxAt=0;reportCache=null;return load();},onMore:()=>load({offset:pa.workspace.next_offset}),onTasks:()=>showPaView('tasks'),onReport:()=>showPaView('report'),onRabbi:()=>showPaView('rabbi'),onNew:()=>pa.workspace?newTask():edit(),onFeedback:paFeedback,onAppDetails:t=>{if(t)return t.brief?detailsCurrent(t):details(t);},onEditTask:editCurrent,onEnablePush:enablePush,onAppNotification:async n=>{try{await api('/api/tasks/read',{id:n.id});n.read_at=new Date().toISOString();render();const t=data.tasks.find(t=>t.id===n.task_id)||{id:n.task_id};if(t)return detailsCurrent(t);}catch(e){toast(e.message);}},onReadAlert:async a=>{await api('/api/pa-report/read',{id:a.id});pa.alerts=pa.alerts.filter(n=>n.id!==a.id);}});
 if(rabbiMode){$('#app').innerHTML='<main class="shell"><div class="top"><h1>Rabbi</h1><div class="actions"><a class="button" href="/tasks">Tasks</a><a class="button" href="/tasks?view=report">Daily Report</a><button id="retry-rabbi">Verfris</button></div></div><p class="notice">The Rabbi reading could not be loaded. Refresh to try again.</p></main>';$('#retry-rabbi').onclick=load;return;}
 if(reportMode)return renderReport({data,owner,search,mail,onOwner:v=>{owner=v;render();},onSearch:(v,pos)=>{search=v;render();const el=$('#report-search');el.focus();try{el.setSelectionRange(pos,pos);}catch{}},onRefresh:load,onTasks:()=>{reportMode=false;history.replaceState(null,'','/tasks');render();},onNew:()=>edit(),onAction:reportAction,onDetails:details,onNote:t=>noteForm(t),onEmail:emailForm,onCancelEmail:cancelEmail});
 const mine=data.tasks.filter(t=>t.assigned_to===data.username||t.steps?.some(s=>s.assigned_to===data.username)),unread=data.notifications.filter(n=>!n.read_at),pool=(data.admin&&owner==='all'?data.tasks:mine);
 const selected=pool.filter(t=>(filter==='all'||filter==='closed'&&!open(t)||filter==='open'&&t.status==='Pending'||filter==='scheduled'&&t.status==='Scheduled'||filter==='waiting'&&t.status==='Waiting'||filter==='today'&&open(t)&&review(t)<=data.today)&&(!search||(t.title+' '+t.details+' '+t.supplier+' '+name(t.assigned_to)).toLowerCase().includes(search.toLowerCase()))).sort((a,b)=>Number(open(b))-Number(open(a))||(review(a)||'9999').localeCompare(review(b)||'9999')||a.title.localeCompare(b.title));
 $('#app').innerHTML=`<header><strong>FEN MEAT</strong><nav><a href="/" class="home-link">Home</a>${data.invoice_rep?'<a href="/invoicing/">Invoices</a>':'<a href="/sales">Sales</a><a href="/production">Production</a><a href="/recipes?view=stock">Stocktake</a>'}</nav></header><main class="shell"><div class="top"><h1>Tasks</h1><div class="actions"><button class="primary" id="new">Nuwe taak</button>${data.invoice_rep?'':'<button id="daily-report">Daily Report</button>'}<button id="refresh">Verfris</button><button id="push">Skakel kennisgewings aan</button></div></div><p class="sub">${esc(name(data.username))} · ${data.admin?'Wys take toe en volg die vordering':'Skep en bestuur jou eie take'} · Suid-Afrikaanse datums en tye</p>${paError?`<p class="notice">${esc(paError)}</p>`:''}<div class="counts"><span><strong>${mine.filter(open).length}</strong> My onafgehandelde take</span><span><strong>${mine.filter(t=>open(t)&&review(t)<data.today).length}</strong> Moet opgevolg word</span>${data.admin?`<span><strong>${data.tasks.filter(open).length}</strong> Onafgehandelde app-take</span>`:''}</div>${unread.length?`<details class="notifications"><summary>${unread.length} new notification${unread.length===1?'':'s'}</summary>${unread.map(n=>`<button data-notification="${esc(n.id)}">${esc(data.tasks.find(t=>t.id===n.task_id)?.title||'Task update')} · ${esc(n.kind)} <small>${esc(n.created_at.slice(0,10))}</small></button>`).join('')}</details>`:''}<div class="filters">${data.admin?`<select id="owner" aria-label="Task owner"><option value="mine" ${owner==='mine'?'selected':''}>My take</option><option value="all" ${owner==='all'?'selected':''}>Almal</option></select>`:''}<select id="filter" aria-label="Task status">${[['open','Doen nou (Pending)'],['scheduled','Scheduled Tasks · Later'],['today','Vandag en agterstallig'],['waiting','Wag vir iemand'],['closed','Klaar'],['all','Alle take']].map(([v,l])=>`<option value="${v}" ${filter===v?'selected':''}>${l}</option>`).join('')}</select><input id="search" type="search" placeholder="Soek taak, persoon of verskaffer" value="${esc(search)}" aria-label="Search tasks"></div><section class="cards">${selected.length?selected.map(card).join(''):'<p class="empty">Geen take in hierdie lys nie.</p>'}</section><p class="sub">${data.invoice_rep?'Take en herinneringe het internet nodig. Gestoorde fakture bly op hierdie foon.':'Herinneringe en stappe stoor dadelik. Die taak is klaar wanneer al sy vereiste stappe klaar is. PA kry net die toepaslike veranderings.'}</p></main>`;
 if($('#daily-report'))$('#daily-report').onclick=async()=>{reportMode=true;owner=data.admin?'all':'mine';search='';history.replaceState(null,'','/tasks?view=report');await load();};
 $('#refresh').onclick=load;if($('#new'))$('#new').onclick=()=>edit();$('#push').onclick=enablePush;
 $('#filter').onchange=e=>{filter=e.target.value;render();};if($('#owner'))$('#owner').onchange=e=>{owner=e.target.value;render();};$('#search').oninput=e=>{search=e.target.value;const position=e.target.selectionStart;render();$('#search').focus();try{$('#search').setSelectionRange(position,position);}catch{}};
 document.querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>details(data.tasks.find(t=>t.id===b.dataset.task)));
 document.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>complete(data.tasks.find(t=>t.id===b.dataset.complete)));
 document.querySelectorAll('[data-notification]').forEach(b=>b.onclick=async()=>{const n=data.notifications.find(n=>n.id===b.dataset.notification);try{await api('/api/tasks/read',{id:n.id});n.read_at=new Date().toISOString();const t=data.tasks.find(t=>t.id===n.task_id);render();if(t)details(t);}catch(e){toast(e.message);}});
}
function card(t){const late=open(t)&&review(t)<data.today;return `<article class="card ${late?'overdue':''} ${t.status==='Complete'?'complete':''}"><div class="meta"><span class="pill">${esc(statusLabel(t.status))}</span><span>${esc(name(t.assigned_to))}</span>${t.priority!=='Normal'?`<strong>${esc(t.priority)}</strong>`:''}<span class="${late?'overdue-text':''}">${esc(dateLabel(t))}</span></div><h2>${esc(t.title)}</h2><p class="reminder">${esc(reminderLabel(t))}</p>${t.waiting_reason?`<p>${esc(t.waiting_reason)}</p>`:''}<div class="meta"><span>${t.task_type==='workflow'?'Taak met stappe':t.task_type==='reminder'?'Gewone herinnering':t.kind==='po_dispatch'?'Bestellingstap':t.kind==='stocktake'?'Voorraadtelling':'Gekoppelde taak'}</span>${data.admin&&t.pa_sync.status!=='app_only'?`<span>${t.pa_sync.status==='synced'?'PA bygewerk':'PA sal die verandering kry'}</span>`:''}</div><div class="actions"><button data-task="${esc(t.id)}">Maak taak oop</button>${open(t)&&t.task_type!=='workflow'?t.kind==='stocktake'?`<a class="button" href="/recipes?view=stock&supplier=${encodeURIComponent(t.supplier)}&task=${encodeURIComponent(t.id)}">Maak voorraadtelling oop</a>`:`<button class="primary" data-complete="${esc(t.id)}">${t.kind==='po_dispatch'?'Bevestig gestuur':'Merk klaar'}</button>`:''}</div></article>`;}
function show(html){dialogCleanup();dialogCleanup=()=>{};dialog.onclose=()=>dialogCleanup();dialog.oncancel=e=>{if(busy)e.preventDefault();};retry=null;dialog.innerHTML=html;dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());if(!dialog.open)dialog.showModal();}
function base(title,content,submit='Stoor'){return `<h2>${esc(title)}</h2><form><fieldset>${content}<p class="error" role="alert"></p><div class="actions"><button class="primary" type="submit">${submit}</button><button type="button" data-close>Kanselleer</button></div></fieldset></form>`;}
async function submit(form,body,onSuccess=()=>load()){
 if(busy)return;busy=true;form.querySelector('fieldset').disabled=true;
 form.querySelector('.error').textContent='';
 try{const payload=typeof body==='function'?await body():body;const signature=JSON.stringify(payload);if(!retry||retry.signature!==signature)retry={signature,request_id:crypto.randomUUID()};await api('/api/tasks',{...payload,request_id:retry.request_id});dialog.close();retry=null;await onSuccess();toast('Gestoor.');}catch(e){form.querySelector('.error').textContent=e.message;}finally{busy=false;form.querySelector('fieldset').disabled=false;}
}
function taskAttachments(t){const ids=t?.attachments||[];return ids.length?`<section aria-label="Task attachments"><h3>Foto’s en dokumente</h3>${ids.map((id,index)=>`<p><a href="/api/tasks/file?id=${encodeURIComponent(id)}" target="_blank" rel="noopener">Maak aanhegsel ${index+1} van ${ids.length} oop</a></p>`).join('')}</section>`:'';}
function createAttachments(){return `<label>Voeg foto’s / PDF’s by (opsioneel)<input id="attachment" type="file" multiple accept="${TASK_FILE_ACCEPT}" aria-describedby="attachment-help attachment-status"></label><p id="attachment-help" class="help">Kies verskeie lêers, of kies weer om meer by te voeg. Hoogstens ${MAX_TASK_ATTACHMENTS} lêers. Groot foto’s word outomaties kleiner gemaak. PDF’s: hoogstens 500 KB.</p><p id="attachment-status" role="status" aria-live="polite"></p><ul id="attachment-list" aria-label="Selected attachments"></ul>`;}
async function editCurrent(t){
 if(!t)return;
 try{const [fresh]=await Promise.all([api('/api/tasks?id='+encodeURIComponent(t.id)),prepareOptions()]);if(!fresh.task)throw Error('Die oorspronklike taak kon nie laai nie. Verfris en probeer weer.');edit(fresh.task);}catch(e){toast(e.message);}
}
function linkedTasks(item){
 const ids=new Set([item.id,item.subject_key,...(item.pa_task_ids||[])]);
 const linked=data.tasks.filter(t=>t.id===item.app_task_id||t.id===item.workflow_id||t.id===item.id||ids.has(t.pa_task_id));
 for(const row of [item,...(pa?.context_rows||[]),...(pa?.rows||[])])if(row===item||ids.has(row.id)){const id=row.app_task_id||row.workflow_id;if(id&&!linked.some(t=>t.id===id))linked.push({id,title:row.title});}
 return linked;
}
function edit(t){
 const workflow=t?.task_type==='workflow';
 show(base(t?'Wysig oorspronklike taak':'Nuwe taak',`
 ${t?'<p class="help">Wysigings behou hierdie taak se geskiedenis, dokumente en PA-gesprek. Voltooiing is ’n afsonderlike handeling.</p>':''}
 <label>Taaktitel<input name="title" maxlength="180" required value="${esc(t?.title)}"></label>
 ${data.admin?`<label>Verantwoordelik<select name="assigned_to">${data.users.map(u=>`<option value="${esc(u)}" ${u===(t?.assigned_to||data.username)?'selected':''}>${esc(name(u))}</option>`).join('')}</select></label>`:`<p>Verantwoordelik: <strong>${esc(name(data.username))}</strong></p><input name="assigned_to" type="hidden" value="${esc(data.username)}">`}
 ${t||data.invoice_rep?'':'<label>Soort werk<select name="kind"><option value="general">Gewone taak</option><option value="stocktake">Verskaffer se voorraadtelling</option></select></label>'}
 ${!t?'<label>Taaksoort<select name="task_type"><option value="reminder">Gewone herinnering</option><option value="workflow">Taak met stappe</option></select></label>':''}
 <label ${t&&t.task_type!=='reminder'?'hidden':''}>Herhaal<select name="repeat">${[['none','Moenie herhaal nie'],['daily','Elke dag'],['weekly','Elke week'],['monthly','Elke maand']].map(([v,l])=>`<option value="${v}" ${t?.repeat===v?'selected':''}>${l}</option>`).join('')}</select></label>
 ${!t||workflow?`<label><input name="pa_required" type="checkbox" ${t?.pa_required?'checked':''}> PA moet help met ondersoek, dokumente of opvolging</label>`:''}
 <label>Beskrywing<textarea name="details" maxlength="5000">${esc(t?.details)}</textarea></label>${t?taskAttachments(t):createAttachments()}
 ${data.invoice_rep?'':`<label>Verskaffer (vir ’n voorraadtelling)<input name="supplier" list="suppliers" maxlength="120" value="${esc(t?.supplier)}"><datalist id="suppliers">${data.suppliers.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist></label>`}
 <label>Sperdatum / teldatum<input name="due_date" type="date" value="${esc(t?t.due_date||'':data.today)}"></label>
 <label>Volgende opvolgdatum<input name="review_date" type="date" value="${esc(t?t.review_date||'':data.today)}"></label>
 ${reminderControls(t)}<label>Prioriteit<select name="priority">${['Normal','High','Critical','Low'].map(p=>`<option ${p===(t?.priority||'Normal')?'selected':''}>${p}</option>`).join('')}</select></label>
 <label>Dokumentskakel<input name="document_url" type="url" value="${esc(t?.document_url)}" placeholder="https://…"></label>
 ${workflow?'':`<label>Bewysskakel (opsioneel)<input name="evidence_url" type="url" value="${esc(t?.evidence_url)}" placeholder="https://…"></label>`}
 <label id="evidence-option" ${t?.kind==='stocktake'||workflow?'hidden':''}><input name="requires_evidence" type="checkbox" ${t?.requires_evidence?'checked':''}> Vra foto’s, PDF’s of ’n bewysstuk wanneer dit klaar is</label>
 ${workflow?'<p class="notice">Elke stap het sy eie bewysblokkie. Stoor die taakbesonderhede en kies daarna Wysig stap. Dit verander slegs daardie stap; vorige vereiste stappe bly van krag.</p>':''}
 ${t?`<label>Rede vir die wysiging <span class="help">(nodig wanneer ’n vereiste verval of afgehandelde werk verander)</span><textarea name="edit_reason" maxlength="2000" ${!open(t)?'required':''}></textarea></label>`:''}
 `,t?'Stoor taak':'Stoor'));
 const form=dialog.querySelector('form'),id=t?.id||crypto.randomUUID(),picker=t?null:attachmentPicker(form,{taskId:id,api,prepareFile:fileData});if(picker)dialogCleanup=()=>picker.dispose();setupReminder(form);
 if(t){const evidence=form.elements.requires_evidence;const check=()=>{form.elements.edit_reason.required=!open(t)||!!(t.requires_evidence&&!evidence.checked);};evidence.onchange=check;check();}
 if(!t&&form.elements.task_type){const refreshType=()=>{const workflow=form.elements.task_type.value==='workflow';form.elements.repeat.closest('label').hidden=workflow;form.elements.pa_required.closest('label').hidden=!workflow;form.elements.review_date.closest('label').hidden=!workflow;if(workflow)form.elements.repeat.value='none';};form.elements.task_type.onchange=refreshType;refreshType();}
 if(!t&&form.elements.kind)form.elements.kind.onchange=()=>{const stock=form.elements.kind.value==='stocktake';$('#evidence-option').hidden=stock;if(stock)form.elements.requires_evidence.checked=false;};
 form.onsubmit=e=>{e.preventDefault();const f=new FormData(form),fields={...Object.fromEntries(f),...reminderValues(form),requires_evidence:f.has('requires_evidence')},note=fields.edit_reason||'';delete fields.edit_reason;
  if(form.elements.pa_required)fields.pa_required=f.has('pa_required');if(t)delete fields.kind;
  if(workflow)delete fields.requires_evidence;
  if(!t&&(fields.task_type||t?.task_type)==='reminder')fields.review_date=fields.due_date||fields.review_date;
  if(fields.kind==='stocktake'){fields.task_type='legacy';fields.repeat='none';fields.pa_required=true;}if(fields.task_type==='workflow')fields.repeat='none';
  return submit(form,async()=>({task_id:id,revision:t?.revision||0,action:t?'update':'create',data:fields,...(t?{note}:{}),...(picker?{files:await picker.prepare()}:{})}),async()=>{await load();if(t){const saved=await api('/api/tasks?id='+encodeURIComponent(id));details(saved.task);}});
 };
}
function editReminder(t){
 show(base('Wysig herinnering',reminderControls(t)));const form=dialog.querySelector('form');setupReminder(form);
 form.onsubmit=e=>{e.preventDefault();return submit(form,{task_id:t.id,revision:t.revision,action:'reminder',data:reminderValues(form)});};
}
function details(t){
 show(`<h2>${esc(t.title)}</h2>${t.feedback_request?.status==='pending'?`<p class="notice">${esc(name(t.feedback_request.by))}: ${esc(t.feedback_request.question)}</p><button id="reply-report">Gee terugvoer</button>`:''}${t.last_update?`<p>${esc(name(t.last_update.by))}: ${esc(t.last_update.text)}</p>`:''}<p>${esc(t.details).replaceAll('\n','<br>')}</p>${taskAttachments(t)}${t.steps?stepsHTML(t,true,{admin:data.admin,username:data.username}):''}<dl><dt>Verantwoordelik</dt><dd>${esc(name(t.assigned_to))}</dd><dt>Geskep deur</dt><dd>${esc(name(t.created_by))}</dd><dt>Status</dt><dd>${esc(statusLabel(t.status))}</dd><dt>Datum</dt><dd>${esc(dateLabel(t))}</dd><dt>Herinnering</dt><dd>${esc(reminderLabel(t))}</dd>${t.due_date&&t.review_date?`<dt>Oorspronklike sperdatum</dt><dd>${esc(t.due_date)}</dd>`:''}</dl>${t.document_url?`<p><a href="${esc(t.document_url)}" target="_blank" rel="noopener noreferrer">Maak ${t.kind==='po_dispatch'?'goedgekeurde bestelling':'dokument'} oop</a></p>`:''}${t.kind==='po_dispatch'&&t.task_type!=='workflow'?'<p class="notice">Bevestig wanneer jy die goedgekeurde bestelling gestuur het. Ontvangs en betaling moet daarna nog bevestig word.</p>':''}${t.completion?`<p>Klaar gemerk deur ${esc(name(t.completion.by))} · ${esc(new Date(t.completion.at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'}))}</p><p>${esc(t.completion.note)}</p>${t.completion.proof_url?`<p><a href="${esc(t.completion.proof_url)}" target="_blank" rel="noopener noreferrer">Bewys van voltooiing</a></p>`:''}${(t.completion.attachments||[]).map((id,index)=>`<p><a href="/api/tasks/file?id=${encodeURIComponent(id)}" target="_blank" rel="noopener">Maak bewysstuk ${index+1} van ${t.completion.attachments.length} oop</a></p>`).join('')}`:''}<div class="actions">${open(t)&&t.task_type!=='workflow'?`${t.kind!=='stocktake'?'<button class="primary" id="complete">'+(t.kind==='po_dispatch'?'Bevestig gestuur':'Merk hele taak klaar')+'</button>':`<a class="button" href="/recipes?view=stock&supplier=${encodeURIComponent(t.supplier)}&task=${encodeURIComponent(t.id)}">Maak voorraadtelling oop</a><button id="check-count">Gaan gestoorde telling na</button>`}<button id="wait">Wag vir iemand</button>`:''}${open(t)&&!canManage(t)?'<button id="reminder">Wysig herinnering</button>':''}${canManage(t)?`${data.admin||open(t)?'<button id="edit">Wysig oorspronklike taak</button>':''}${open(t)?'<button id="cancel-task">Kanselleer taak</button>':'<button id="reopen">Heropen</button>'}`:''}${data.username==='alex'&&(data.workspace_source||mail.contacts?.recipients?.[t.assigned_to])?'<button id="email-task">Gaan taak se e-pos na</button>':''}${canManage(t)?t.task_type==='workflow'?'<button id="add-step">Voeg stap by</button><button id="fix-status">Korrigeer status</button>':t.kind!=='stocktake'?'<button id="convert-workflow">Maak taak met stappe</button>':'':''}${open(t)?'<button id="add-note">Voeg nota by</button>':''}${t.pa_task_id&&!data.invoice_rep?'<button id="pa-task-conversation">Gee terugvoer aan PA</button>':''}<button id="history">Geskiedenis</button><button data-close>Maak toe</button></div><div id="history-content"></div>`);
 workflowForms({FormDataConstructor:FormData,show,base,submit,getData:()=>data,dialog,attachmentPicker,fileData,createAttachments,api,setCleanup:f=>{dialogCleanup=f;}}).bind(t);
 if($('#reply-report'))$('#reply-report').onclick=()=>{dialog.close();reportMode=true;owner='mine';history.replaceState(null,'','/tasks?view=report');render();};
 if($('#check-count'))$('#check-count').onclick=async()=>{try{await api('/api/tasks/check-count',{task_id:t.id});dialog.close();await load();toast('Gestoorde telling bevestig.');}catch(e){toast(e.message);}};
 if($('#complete'))$('#complete').onclick=()=>complete(t);if($('#wait'))$('#wait').onclick=()=>reasonAction(t,'wait');if($('#edit'))$('#edit').onclick=()=>editCurrent(t);if($('#add-note'))$('#add-note').onclick=()=>noteForm(t);if($('#pa-task-conversation'))$('#pa-task-conversation').onclick=()=>paFeedback(pa?.rows.find(r=>r.id===t.pa_task_id)||{id:t.pa_task_id,subject_key:t.pa_task_id},'respond');if($('#reminder'))$('#reminder').onclick=()=>editReminder(t);if($('#cancel-task'))$('#cancel-task').onclick=()=>reasonAction(t,'cancel');if($('#reopen'))$('#reopen').onclick=()=>reasonAction(t,'reopen');$('#history').onclick=async()=>{try{const r=await api('/api/tasks/audit?id='+encodeURIComponent(t.id));$('#history-content').innerHTML=r.history.map(h=>`<div class="history-entry">Wysiging ${h.revision} · ${esc(h.action)} · ${esc(name(h.actor))} · ${esc(h.saved_at)}<br>${esc(h.reason||h.task.completion?.note||h.task.last_occurrence?.note||h.task.waiting_reason||'')}${historyChanges(h.changes)}${h.task.steps?stepsHTML(h.task,false):''}</div>`).join('');}catch(e){toast(e.message);}};
 if($('#email-task'))$('#email-task').onclick=()=>emailForm(t);
}
function historyChanges(changes=[]){
 const labels={title:'Taaktitel',details:'Beskrywing',assigned_to:'Verantwoordelik',due_date:'Sperdatum',review_date:'Opvolgdatum',priority:'Prioriteit',requires_evidence:'Bewys vereis',document_url:'Dokumentskakel',evidence_url:'Bewysskakel',reminder_mode:'Herinnering',reminder_at:'Herinneringstyd',description:'Stapbeskrywing',required:'Verpligte stap',dependencies:'Vorige stappe',status:'Status',notes:'Notas'};
 const value=v=>v===true?'Ja':v===false?'Nee':v===null||v===''?'Geen':typeof v==='object'?JSON.stringify(v):String(v);
 return changes.length?'<ul class="task-changes">'+changes.map(c=>{const parts=c.field.split('.'),label=(parts[0]==='steps'?'Stap '+parts[1]+' · ':'')+(labels[parts.at(-1)]||c.field);return '<li><strong>'+esc(label)+'</strong><div>Voor: '+esc(value(c.before))+'</div><div>Na: '+esc(value(c.after))+'</div></li>';}).join('')+'</ul>':'';
}
function reasonAction(t,action){show(base(action==='wait'?'Waarvoor wag ons?':action==='cancel'?'Kanselleer taak':'Heropen taak',`<label>Rede<textarea name="note" required maxlength="2000"></textarea></label>${action==='wait'?'<label>Volgende opvolgdatum<input name="review_date" type="date" required value="'+data.today+'"></label>':''}`));const f=dialog.querySelector('form');f.onsubmit=e=>{e.preventDefault();submit(f,{task_id:t.id,revision:t.revision,action,...Object.fromEntries(new FormData(f))});};}
function complete(t){
 if(t.task_type==='workflow')return details(t);
 const sent=t.kind==='po_dispatch';show(base(sent?'Bevestig dat die bestelling gestuur is':'Taak klaar',`${sent?`<p><a href="${esc(t.document_url)}" target="_blank" rel="noopener noreferrer">Maak goedgekeurde ${esc(t.po_number)} oop</a></p><p class="help">Dokumentweergawe: ${esc(t.po_revision)}</p><label>Gestuur per<select name="channel"><option>Email</option><option>WhatsApp</option><option>Other</option></select></label><label>Werklike stuurdatum en -tyd (Suid-Afrika)<input name="sent_at" type="datetime-local" required value="${new Date(Date.now()+7200000).toISOString().slice(0,16)}"></label><label><input type="checkbox" required> Ek het hierdie goedgekeurde bestelling aan die verskaffer gestuur.</label>`:''}<label>Voltooiingsnota<textarea name="note" maxlength="2000"></textarea></label><label>Bewysskakel ${t.requires_evidence?'(of heg ’n lêer aan)':'(opsioneel)'}<input name="proof_url" type="url" value="${esc(t.evidence_url)}" placeholder="https://…"></label><label>Voeg foto’s / PDF’s by ${t.requires_evidence?'':'(opsioneel)'}<input id="attachment" type="file" multiple accept="${TASK_FILE_ACCEPT}" aria-describedby="attachment-help attachment-status"></label><p id="attachment-help" class="help">Kies verskeie lêers, of kies weer om meer by te voeg. Hoogstens ${MAX_TASK_ATTACHMENTS} lêers. Groot foto’s word outomaties kleiner gemaak. PDF’s: hoogstens 500 KB. ${sent?'Ontvangs en betaling moet nog afsonderlik bevestig word.':''}</p><p id="attachment-status" role="status" aria-live="polite"></p><ul id="attachment-list" aria-label="Selected attachments"></ul>`,sent?'Bevestig gestuur':'Merk klaar'));
 const form=dialog.querySelector('form'),picker=attachmentPicker(form,{taskId:t.id,api,prepareFile:fileData});dialogCleanup=()=>picker.dispose();
 form.onsubmit=e=>{e.preventDefault();if(busy)return;const f=Object.fromEntries(new FormData(form));if(sent){f.sent_at=new Date(f.sent_at+':00+02:00').toISOString();f.po_revision=t.po_revision;}return submit(form,async()=>({task_id:t.id,revision:t.revision,action:'complete',...f,attachments:await picker.upload()}));};
}
async function enablePush(){
 try{if(!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('Op iPhone of iPad: voeg FenMeat by jou tuisskerm, maak dit daar oop en skakel kennisgewings aan. Kennisgewings binne die app bly beskikbaar.');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Kennisgewings is nie aangeskakel nie. Verander dit in jou blaaier se instellings; terugvoer bly in Tasks beskikbaar.');
 const reg=await navigator.serviceWorker.register('/tasks-sw.js',{scope:'/tasks'}),keys=await api('/api/tasks/push');await navigator.serviceWorker.ready;
 let sub=await reg.pushManager.getSubscription();if(!sub){const raw=atob(keys.public_key.replaceAll('-','+').replaceAll('_','/'));sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});}await api('/api/tasks/push',sub.toJSON());toast('Kennisgewings aangeskakel vir '+name(data.username)+'.');
 }catch(e){toast(e.message);}
}

async function quick(t,action,fields={},undo=false){
 if(busy)return;busy=true;document.querySelectorAll('[data-quick]').forEach(b=>b.disabled=true);
 const body={task_id:t.id,revision:t.revision,action,...fields},signature=JSON.stringify(body);
 if(!quickRetry||quickRetry.signature!==signature)quickRetry={signature,request_id:crypto.randomUUID()};
 try{const result=await api('/api/tasks',{...body,request_id:quickRetry.request_id});quickRetry=null;await load();toast(action==='request_update'?'Terugvoer aangevra.':['reminder','followup_reminder'].includes(action)?'Herinnering gestoor.':result.task.pa_sync?.status==='app_only'?'Herinnering gestoor.':'Gestoor. Die toepaslike PA-verandering is aangeteken.',undo?()=>quick(result.task,'undo_complete'):null);}
 catch(e){render();toast(e.message);}finally{busy=false;}
}
function reportAction(t,action){
 if(action==='complete')return t.kind==='general'&&!t.requires_evidence?quick(t,'complete',{},true):complete(t);
 if(action==='ask')return quick(t,'request_update',{note:'Gee asseblief terugvoer: is dit klaar, is jy nog besig of het jy hulp nodig?'});
 if(action==='in_progress')return quick(t,'respond',{response:'in_progress'});
 if(action==='blocked')return noteForm(t,'respond');
 if(action==='remind')return quickReminder(t);
 if(action==='wait')return reasonAction(t,'wait');
}
function quickReminder(t){
 const options=reminderOptions(),personal=t.assigned_to!==data.username;
 const save=at=>{dialog.close();return quick(t,personal?'followup_reminder':'reminder',{data:personal?{reminder_at:at}:{reminder_mode:'once',reminder_at:at}});};
 show(`<h2>Herinner my</h2><p>${esc(t.title)}</p><div class="actions">${options.map((o,i)=>`<button class="primary" data-reminder="${i}">${esc(o.label)}</button>`).join('')}<button id="custom-reminder">Kies datum en tyd</button>${personal&&t.followup_reminders?.[data.username]?'<button id="remove-followup">Verwyder my herinnering</button>':''}<button data-close>Kanselleer</button></div><p class="help">${personal?'This reminds you to follow up. '+esc(name(t.assigned_to))+"’s task reminder stays as set.":'This changes your reminder, not the task deadline.'} South African time. Enable notifications in Tasks to receive reminders while the app is closed.</p>`);
 dialog.querySelectorAll('[data-reminder]').forEach(b=>b.onclick=()=>save(options[Number(b.dataset.reminder)].at));
 if($('#remove-followup'))$('#remove-followup').onclick=()=>save('');
 $('#custom-reminder').onclick=()=>{
  if(!personal)return editReminder({...t,reminder_mode:'once',reminder_at:options[0].at});
  show(base('My opvolgherinnering',`<p>${esc(t.title)}</p><label>Herinner my op (Suid-Afrika)<input name="reminder_at" type="datetime-local" required value="${new Date(Date.parse(t.followup_reminders?.[data.username]||options[0].at)+7200000).toISOString().slice(0,16)}"></label>`));
  const form=dialog.querySelector('form');form.onsubmit=e=>{e.preventDefault();return submit(form,{task_id:t.id,revision:t.revision,action:'followup_reminder',data:{reminder_at:new Date(form.elements.reminder_at.value+':00+02:00').toISOString()}});};
 };
}
function noteForm(t,action='note'){
 const blocked=action==='respond';show(base(blocked?'Waarmee het jy hulp nodig?':'Voeg nota by',`${blocked?'<label>Reason<select name="reason"><option>Grondstowwe ontbreek</option><option>Wag vir ’n verskaffer</option><option>Hulp nodig</option><option>Other</option></select></label>':''}<label>${blocked?'Besonderhede (opsioneel)':'Nota'}<textarea name="note" maxlength="2000" ${blocked?'':'required'}></textarea></label>${blocked?`<label>Opvolgdatum<input name="review_date" type="date" required value="${data.today}"></label>`:''}`,blocked?'Stuur terugvoer':'Stoor nota'));
 const form=dialog.querySelector('form');form.onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(form));if(blocked){f.note=f.note?f.reason+': '+f.note:f.reason;delete f.reason;f.response='blocked';}return submit(form,{task_id:t.id,revision:t.revision,action,...f});};
}
async function emailForm(t){
 if(data.workspace_source){try{mail=await api('/api/tasks/emails');}catch(e){return toast(e.message);}}
 const from=mail.contacts?.from_address,to=mail.contacts?.recipients?.[t.assigned_to];if(!from||!to)return toast('The email contact must first be verified by PA.');
 const link=location.origin+'/tasks?view=report&task='+encodeURIComponent(t.id);
 const body=`Hi ${name(t.assigned_to)},\n\nPlease give me an update on: ${t.title}\n\n${t.details||''}\n\nYou can reply on the task here:\n${link}\n\nKind regards,\nAlex Fenwick`;
 show(base('Email '+name(t.assigned_to),`<p><strong>From:</strong> ${esc(from)}<br><strong>To:</strong> ${esc(to)}</p><label>Message<textarea name="body" maxlength="5000" required>${esc(body)}</textarea></label><p class="notice">Send approves this exact message. PA processes email requests hourly. The report shows Email sent only after delivery is verified in Sent.</p>`,'Send'));
 const form=dialog.querySelector('form');form.elements.body.value=body;form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;form.querySelector('fieldset').disabled=true;const payload={task_id:t.id,revision:t.revision,action:'queue_email',from_address:from,to_address:to,confirm_send:true,body:form.elements.body.value},signature=JSON.stringify(payload);if(!retry||retry.signature!==signature)retry={signature,request_id:crypto.randomUUID()};try{await api('/api/tasks',{...payload,request_id:retry.request_id});retry=null;dialog.close();await load();toast('Email queued for PA.');}catch(err){form.querySelector('.error').textContent=err.message;}finally{busy=false;form.querySelector('fieldset').disabled=false;}};
}
async function cancelEmail(email){
 if(busy)return;busy=true;try{await api('/api/tasks',{task_id:email.task_id,revision:email.revision,request_id:crypto.randomUUID(),action:'cancel_email',email_id:email.id});await load();toast('Queued email cancelled.');}catch(e){toast(e.message);}finally{busy=false;}
}
// Task forms are not saved until submitted; warn before navigating away.
dialog.addEventListener('input',event=>{const form=event.target.closest('form');if(form)form.dataset.unsaved='true';});
dialog.addEventListener('change',event=>{const form=event.target.closest('form');if(form)form.dataset.unsaved='true';});
window.addEventListener('beforeunload',event=>{if(busy||(dialog.open&&dialog.querySelector('form[data-unsaved]'))){event.preventDefault();event.returnValue='';}});

function paFeedback(item,action){
 if(!item)return;
 if(!item.subject_hash){api('/api/pa-report/conversation?subject_key='+encodeURIComponent(item.subject_key||item.id)).then(r=>paFeedback(r.subject,action)).catch(e=>toast(e.message));return;}
 const labels={respond:'Gee terugvoer aan PA',complete:'Merk taak klaar',assign:'Wys taak toe',request_update:'Vra terugvoer',remind:'Herinner my'};
 show(base(labels[action],`<h3>${esc(item.title||'Report item')}</h3><p class="pa-prose">${esc(item.next_action||item.text||'')}</p>${action==='complete'?'<p class="notice">Druk Stoor om te bevestig dat jou werk klaar is. \'n Nota of bewys is opsioneel. Bestellings, betalings en voorraadtellings moet steeds nagegaan word.</p>':''}${action==='assign'?`<label>Verantwoordelik<select name="assigned_to">${pa.users.map(u=>`<option value="${u}" ${u===item.assigned_to?'selected':''}>${esc(name(u))}</option>`).join('')}</select></label>`:''}${action==='remind'?'<label>Herinnering se datum en tyd (Suid-Afrika)<input name="remind_at" type="datetime-local" required></label><p class="help">Hierdie herinnering is vir jou. Die ander persoon se sperdatum bly dieselfde.</p>':''}<section id="pa-conversation" aria-label="Gesprek"></section><button type="button" id="pa-conversation-refresh">Verfris gesprek</button><button type="button" id="pa-more" hidden>Laai meer van die gesprek</button><label>${action==='complete'?'Kort nota (opsioneel)':action==='request_update'?'Jou vraag':'Jou antwoord'}<textarea name="note" maxlength="5000" ${['remind','complete'].includes(action)?'':'required'} placeholder="Voeg 'n nota by as jy wil"></textarea></label><label>Bewysskakel<input name="proof_url" type="url" placeholder="https://…"></label><label>Voeg foto’s / PDF’s by<input id="attachment" type="file" accept="${TASK_FILE_ACCEPT}" multiple></label><p id="attachment-status" role="status"></p><ul id="attachment-list"></ul>`,action==='complete'?'Stoor voltooiing':'Stoor antwoord'));
 const form=dialog.querySelector('form');
 const links=linkedTasks(item);
 if(data.admin&&links.length){const box=document.createElement('div');box.className='actions';for(const task of links){const button=document.createElement('button');button.type='button';button.textContent='Wysig oorspronklike taak'+(links.length>1?' · '+task.title:'');button.onclick=()=>editCurrent(task);box.append(button);}form.querySelector('fieldset').prepend(box);}
 const historyBox=form.querySelector('#pa-conversation');
 const related=(pa.feedback||[]).filter(f=>f.subject_key===item.subject_key);
 historyBox.innerHTML=conversationHTML(related);
 let conversation=related,conversationOffset=0;
 const more=form.querySelector('#pa-more');
 async function historyPage(){try{const page=await api('/api/pa-report/conversation?subject_key='+encodeURIComponent(item.subject_key)+'&offset='+conversationOffset);if(!page.feedback)return;conversation=conversationOffset?[...conversation,...page.feedback]:page.feedback;historyBox.innerHTML=conversationHTML(conversation);conversationOffset=page.next_offset;more.hidden=conversationOffset===null;}catch{more.hidden=false;more.textContent='Probeer gesprek weer laai';}}
 more.onclick=historyPage;form.querySelector('#pa-conversation-refresh').onclick=()=>{conversationOffset=0;return historyPage();};historyPage();
 // Drafts and uncertain submissions survive a reload in this tab, scoped to the signed-in user.
 // Never cache the private report or attachment bytes on a shared phone.
 const draftKey='fenmeat-pa-draft:'+data.username+':'+item.subject_key+':'+action;
 const storage=typeof sessionStorage==='undefined'?null:sessionStorage;
 let draft;try{draft=JSON.parse(storage?.getItem(draftKey)||'null');}catch{}
 if(draft?.note)form.elements.note.value=draft.note;
 const saveDraft=extra=>{try{storage?.setItem(draftKey,JSON.stringify({note:form.elements.note.value,proof_url:form.elements.proof_url.value,...extra}));}catch{}};
 form.elements.note.addEventListener('input',()=>saveDraft());
 if(action==='remind')form.elements.remind_at.value=new Date(Date.now()+10800000).toISOString().slice(0,16);
 if(action==='request_update')form.elements.note.value='Gee asseblief kort terugvoer: wat is klaar, wat kort nog en waarmee het jy hulp nodig?';
 const picker=attachmentPicker(form,{taskId:item.subject_key,prepareFile:fileData,api:(_path,b)=>api('/api/pa-report/file',{id:b.id,subject_key:item.subject_key,subject_hash:item.subject_hash,mime_type:b.mime_type,filename:b.filename,base64:b.base64})});dialogCleanup=()=>picker.dispose();paRetry=draft?.retry||null;
 form.onsubmit=async e=>{
  e.preventDefault();if(busy)return;const f=new FormData(form);busy=true;form.querySelector('fieldset').disabled=true;form.querySelector('.error').textContent='';
  try{let payload={subject_key:item.subject_key,subject_hash:item.subject_hash,action,note:f.get('note')||'',proof_url:f.get('proof_url')||'',attachments:await picker.upload(),...(action==='assign'?{assigned_to:f.get('assigned_to')}:{}) ,...(action==='remind'?{remind_at:new Date(f.get('remind_at')+':00+02:00').toISOString()}:{})};
   const previous=[...conversation].reverse().find(f=>f.answer);if(previous&&action==='respond')payload.reply_to=previous.id;
   // Retry the exact uncertain request before adopting a newly published task hash.
   if(draft?.payload&&draft.note===payload.note&&draft.proof_url===payload.proof_url&&!payload.attachments.length)payload=draft.payload;
   const signature=JSON.stringify(payload);if(!paRetry||paRetry.signature!==signature)paRetry={signature,request_id:crypto.randomUUID()};
   saveDraft({payload,retry:paRetry});draft={note:payload.note,proof_url:payload.proof_url,payload,retry:paRetry};
   await api('/api/pa-report/feedback',{...payload,request_id:paRetry.request_id});try{storage?.removeItem(draftKey);}catch{}dialog.close();paRetry=null;await load();toast(action==='remind'?'Jou herinnering is gestoor.':action==='complete'?'Voltooiing aangeteken. PA werk die bestaande register by.':'Jou boodskap is gestoor. PA se antwoord verskyn hier ná die volgende suksesvolle uurlikse kontrole.');
  }catch(err){form.querySelector('.error').textContent=err.status===409?'Die taak het verander. Jou teks is behou. Sluit die venster, verfris en hersien jou boodskap voordat jy weer stoor.':err.message;if(err.status===409){draft=null;paRetry=null;saveDraft();}}finally{busy=false;form.querySelector('fieldset').disabled=false;}
 };
}

let lastPaRefresh=0;
async function refreshPaAnswers(){if(!data||dialog.open||busy||Date.now()-lastPaRefresh<60000)return;lastPaRefresh=Date.now();if(!legacyMode){inboxAt=0;if(reportMode||rabbiMode)reportCache=null;return load();}try{const fresh=await api('/api/pa-report'+(reportDate?'?date='+encodeURIComponent(reportDate):''));if(fresh.register_revision){pa=fresh;data.today=localDate();render();}}catch{/* Keep the last loaded conversation during a temporary outage. */}}
window.addEventListener('focus',refreshPaAnswers);window.addEventListener('online',refreshPaAnswers);
if(typeof document.addEventListener==='function')document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshPaAnswers();});
if(typeof window.setInterval==='function')window.setInterval(()=>{if(data&&!dialog.open&&data.today!==localDate()){data.today=localDate();render();}},60000);
load();
