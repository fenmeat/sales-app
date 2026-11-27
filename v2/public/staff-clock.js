import './input-selection.js';
import {readClockStore,writeClockStore,lockClockGrant,unlockClockGrant,queueClockAction,acceptClockReceipt} from './staff-clock-storage.js';
import {localDay,clockTime} from './staff-model.js';
const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#action-dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateLabels={in:'Clocked in',out:'Clocked out',break:'On break'},actionLabels={in:'Clock in',out:'Clock out',break_start:'Start break',break_end:'End break'};
const pendingKey='fenmeat-clock-pending-v1';let state,offset=0,busy=false,idleTimer,syncing=false,loadFailed=false;
function store(){return readClockStore();}
async function update(fn){if(!navigator.locks)throw Error('Hierdie blaaier kan nie veilige klokberging sluit nie. Gebruik ’n bygewerkte blaaier.');return navigator.locks.request('fenmeat-clock-write',()=>{const next=fn(store());writeClockStore(next);return next;});}
const transitions={out:{in:'in'},in:{out:'out',break_start:'break'},break:{out:'out',break_end:'in'}};
function localStatus(id,fallback){const saved=store(),base=saved.people[id]?.status??fallback;let result={...base};for(const event of saved.queue.filter(e=>e.employee_id===id)){if(event.revision>=result.revision)result={...result,state:transitions[result.state]?.[event.kind]??result.state,revision:event.revision+1,last_at:event.captured_at};}return result;}
function pending(){try{const value=JSON.parse(localStorage.getItem(pendingKey)??'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Error('Clock recovery storage is unavailable. Ask Alex or Alinda to check this phone before clocking.');}}

function notice(message,error=false){$('#notice').textContent=message;$('#notice').className=error?'error':'';clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('#notice').textContent='',10000);}
async function api(path,body){let response;try{response=await fetch('/api/staff-clock/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(12000)});}catch{throw Error('No confirmation yet. Select your name and enter your PIN again to retry the same action.');}let data;try{data=await response.json();}catch{throw Error('No confirmation received. Select your name to retry.');}if(!response.ok){const e=Error(data.error??'Clock is unavailable.');e.status=response.status;throw e;}return data;}
function close(){clearTimeout(idleTimer);dialog.close();dialog.replaceChildren();}
function timeout(){clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(!busy)close();else timeout();},30000);}
dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy)close();});dialog.addEventListener('input',timeout);
document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});window.addEventListener('pagehide',close);
function show(html){close();dialog.innerHTML=html+'<button type="button" id="cancel">Cancel</button>';dialog.showModal();$('#cancel').onclick=()=>{if(!busy)close();};timeout();}
function render(){let waiting={};try{waiting=pending();for(const e of store().queue)waiting[e.employee_id]=e;}catch(e){notice(e.message,true);}
 app.innerHTML=`<header><div class="brand">FEN MEAT<small>${esc(state.device.name)}</small></div><nav class="nav"><a href="/">Home</a></nav><span id="clock-time" class="time">${clockTime(new Date(Date.now()+offset))}</span></header><main><div class="title-row"><div><h1>Clock in / out</h1><p class="sub">${localDay(new Date(Date.now()+offset))} · South African time</p></div><button id="refresh">Refresh</button></div><p id="connection" class="notice-panel">${navigator.onLine&&!loadFailed?'Kies jou naam en vul jou PIN in.':'Verbinding onderbreek. Klokrekords bly op hierdie toestel totdat dit gesinkroniseer is.'}</p><p id="sync-state" class="notice-panel" role="status">${Object.keys(waiting).length?Object.keys(waiting).length+' werknemer(s) se klokrekords wag nog vir bevestiging. Moenie hierdie toestel se data uitvee nie.':'Alle plaaslike klokaksies is bevestig.'}</p><button id="export-clock">Laai herstelrekords af</button><input id="find" type="search" aria-label="Find your name" placeholder="Find your name"><div class="person-grid section-note">${state.people.map(p=>`<button class="person" data-person="${p.id}"><strong>${esc(p.name)}</strong><span class="pill ${p.state}">${waiting[p.id]?'Wag vir stoorbevestiging':p.attendance_state==='missing'?'Geen rekord vandag':p.attendance_state==='review'?'Kontroleer kloktye':stateLabels[p.state]}</span>${waiting[p.id]?'<small>Action awaiting confirmation</small>':''}</button>`).join('')||'<p>No active employees. Ask Alex or Alinda to complete setup.</p>'}</div><p class="small">Forgot to clock, or need a correction? Ask Alex or Alinda. No hours are guessed.</p></main>`;
 $('#find').oninput=e=>{for(const b of document.querySelectorAll('[data-person]'))b.hidden=!state.people.find(p=>p.id===b.dataset.person).name.toLowerCase().includes(e.target.value.toLowerCase());};
 $('#refresh').onclick=()=>load().then(syncQueue).catch(e=>notice(e.message,true));$('#export-clock').onclick=exportRecovery;document.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>choose(b.dataset.person));
}
async function load(){try{state=await api('state');offset=Date.parse(state.server_time)-Date.now();loadFailed=false;await update(s=>({...s,snapshot:{state,offset,saved_at:Date.now()}}));render();}catch(e){loadFailed=true;throw e;}}
async function exportRecovery(){
 try{const r=await fetch('/api/navigation',{cache:'no-store'});const auth=await r.json();if(!r.ok||!['alex','alinda','xalinda'].includes(auth.username))throw Error('Meld eers as bestuurder op hierdie toestel aan om die private herstelrekords af te laai.');}catch(e){notice(e.message,true);return;}
 const s=store();const safe={exported_at:new Date().toISOString(),device:state?.device,queue:s.queue.map(({ticket,...e})=>e),receipts:s.receipts,legacy_pending:pending()};
 const url=URL.createObjectURL(new Blob([JSON.stringify(safe,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='FenMeat-klokherstel-'+localDay(new Date())+'.json';a.click();URL.revokeObjectURL(url);
}
async function syncQueue(){
 if(syncing||!navigator.onLine)return;syncing=true;
 try{
  const blocked=new Set();
  for(const entry of [...store().queue]){
   if(blocked.has(entry.employee_id))continue;
   try{
    const receipt=await api('punch',entry);
    await update(s=>{const next=acceptClockReceipt(s,entry,receipt),person=next.people[entry.employee_id];if(person&&(!person.status||person.status.revision<=receipt.revision))person.status={state:receipt.state,revision:receipt.revision,last_at:receipt.at};return next;});
   }catch(e){
    blocked.add(entry.employee_id);notice(e.message+' Die oorspronklike klokrekord bly bewaar.',true);
    if(!e.status||e.status>=500)break;
   }
  }
 }finally{syncing=false;if(state)render();}
}
async function punch(p,pin,entry){
 if(busy)return;busy=true;dialog.querySelectorAll('button,input').forEach(b=>b.disabled=true);
 try{
  const existing=store().queue.filter(e=>e.employee_id===p.id);
  const at=new Date(Date.now()+offset).toISOString();
  if(existing.length&&at<=existing.at(-1).captured_at)throw Error('Die toestel se tyd het teruggespring. Laat bestuur die klokrekords nagaan.');
  const grant=await unlockClockGrant(pin,store().people[p.id]?.grant);
  if(Date.parse(at)>grant.expires||Date.parse(at)<grant.issued-5000)throw Error('Hierdie werknemer se offline-toegang moet weer aanlyn bevestig word.');
  const ticket=grant.tickets.find(t=>t.revision===entry.revision)?.token;
  if(!ticket)throw Error('Verbind en bevestig die werknemer se PIN weer voordat nog aksies geklok word.');
  await update(s=>queueClockAction(s,{...entry,device_id:state.device.id,captured_at:at,ticket}));
  close();render();notice(`${p.name}: ${actionLabels[entry.kind]} is op die toestel bewaar; wag vir bevestiging.`);
  await syncQueue();
  if(!store().queue.some(e=>e.request_id===entry.request_id)){notice(`${p.name}: ${actionLabels[entry.kind]} is gestoor om ${clockTime(at)}.`);try{await load();}catch{}}
 }catch(e){close();notice(e.message,true);}finally{busy=false;pin='';}
}
function choose(id){if(busy)return;const p=state.people.find(p=>p.id===id);let waiting;try{waiting=pending()[id];}catch(e){notice(e.message,true);return;}
 show(`<h2>${esc(p.name)}</h2><p>${waiting?'’n Ouer klokversoek kort bevestiging. Bestuur moet die herstelrekords nagaan.':'Enter your 4-digit PIN. Use your birthday PIN or the casual PIN given to you by Alex or Alinda.'}</p><form id="pin-form"><label>PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" autocomplete="off" minlength="4" maxlength="4" required></label><p id="pin-error" class="form-error" role="alert"></p><button class="primary">Continue</button></form>`);
 $('#pin-form').onsubmit=async e=>{e.preventDefault();if(busy)return;let pin=new FormData(e.target).get('pin');if(waiting){notice('Daar is ’n ou onbevestigde klokversoek. Laai die herstelrekords af en laat bestuur dit nagaan; geen nuwe tyd word daarvoor geraai nie.',true);pin='';return;}busy=true;const f=e.target;f.querySelector('button').disabled=true;
  try{
   await syncQueue();
   let status;
   if(!store().queue.some(e=>e.employee_id===id)&&navigator.onLine){
    try{status=await api('verify',{employee_id:id,pin});offset=Date.parse(status.server_time)-Date.now();const grant=await lockClockGrant(pin,status.offline);await update(s=>({...s,people:{...s.people,[id]:{grant,status:{state:status.state,revision:status.revision,last_at:status.last_at}}}}));}
    catch(e){if(e.status)throw e;}
   }
   if(!status){const offline=await unlockClockGrant(pin,store().people[id]?.grant);if(Date.now()+offset>offline.expires)throw Error('Verbind met die internet om jou PIN weer te bevestig.');status=localStatus(id,{state:p.state,revision:0});}
   if(!dialog.open)return;const actions=status.state==='out'?['in']:status.state==='in'?['out','break_start']:['break_end','out'];
   // The PIN lives only in this short-lived dialog closure. It is never stored.
   show(`<h2>${esc(p.name)}</h2><p>${stateLabels[status.state]}${status.last_at?' · Last action '+localDay(status.last_at)+' '+clockTime(status.last_at):''}</p>${actions.map(kind=>`<button class="primary" data-action="${kind}">${actionLabels[kind]}</button>`).join('')}`);
   document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>punch(p,pin,{employee_id:id,kind:b.dataset.action,revision:status.revision,request_id:crypto.randomUUID()}));
  }catch(err){if(dialog.open&&$('#pin-error')){$('#pin-error').textContent=err.message;f.querySelector('input').value='';f.querySelector('button').disabled=false;}pin='';}finally{busy=false;}
 };
}
function enrol(message=''){app.innerHTML=`<main><h1>Register clock device</h1><p>${esc(message||'Get a device code from Alex or Alinda under Staff → Devices.')}</p><form id="enrol-form"><label>Device code<input name="code" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="19" required></label><p class="form-error" role="alert"></p><button class="primary">Register this phone</button></form><p class="small">This registers a clock device and signs out management access on this phone.</p></main>`;$('#enrol-form').onsubmit=async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button');button.disabled=true;try{await api('enrol',{code:new FormData(form).get('code').replace(/[\s-]/g,'').toLowerCase()});await load();}catch(err){form.querySelector('.form-error').textContent=err.message;button.disabled=false;}};}
setInterval(()=>{if($('#clock-time'))$('#clock-time').textContent=clockTime(new Date(Date.now()+offset));},1000);
setInterval(()=>{if(state&&!dialog.open&&!busy&&!document.hidden)syncQueue().then(load).catch(e=>notice(e.message,true));},30000);
window.addEventListener('offline',()=>{loadFailed=true;if(state)render();notice('Offline: klokrekords wag op hierdie toestel vir sinkronisering.',true);});window.addEventListener('online',()=>syncQueue().then(load).catch(e=>notice(e.message,true)));
if('serviceWorker' in navigator)navigator.serviceWorker.register('/staff-clock-sw.js',{scope:'/staff-clock'}).catch(()=>notice('Offline-herlaai is nog nie gereed op hierdie toestel nie.',true));
try{await load();await syncQueue();}catch(e){const cached=store().snapshot;if(cached&&!e.status){state=cached.state;offset=cached.offset;render();notice('Offline: die laaste toestelrekords word gewys. Ongestuurde klokaksies is nog nie in Payroll nie.',true);}else if(e.status===401)enrol(e.message);else{app.innerHTML='<main><h1>Staff clock</h1><p id="startup-error"></p><button id="retry">Try again</button></main>';$('#startup-error').textContent=e.message;$('#retry').onclick=()=>location.reload();}}
