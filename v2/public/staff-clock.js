import './input-selection.js';
import {localDay,clockTime} from './staff-model.js';
const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#action-dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateLabels={in:'Clocked in',out:'Clocked out',break:'On break'},actionLabels={in:'Clock in',out:'Clock out',break_start:'Start break',break_end:'End break'};
const pendingKey='fenmeat-clock-pending-v1';let state,offset=0,busy=false,idleTimer;
function pending(){try{const value=JSON.parse(localStorage.getItem(pendingKey)??'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Error('Clock recovery storage is unavailable. Ask Alex or Alinda to check this phone before clocking.');}}
function savePending(id,entry){const all=pending();if(entry)all[id]=entry;else delete all[id];try{localStorage.setItem(pendingKey,JSON.stringify(all));}catch{throw Error('This phone could not keep the action for a safe retry. No new clock action was sent. Ask Alex or Alinda for help.');}}
function notice(message,error=false){$('#notice').textContent=message;$('#notice').className=error?'error':'';clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('#notice').textContent='',10000);}
async function api(path,body){let response;try{response=await fetch('/api/staff-clock/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});}catch{throw Error('No confirmation yet. Select your name and enter your PIN again to retry the same action.');}let data;try{data=await response.json();}catch{throw Error('No confirmation received. Select your name to retry.');}if(!response.ok){const e=Error(data.error??'Clock is unavailable.');e.status=response.status;throw e;}return data;}
function close(){clearTimeout(idleTimer);dialog.close();dialog.replaceChildren();}
function timeout(){clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(!busy)close();else timeout();},30000);}
dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy)close();});dialog.addEventListener('input',timeout);
document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});window.addEventListener('pagehide',close);
function show(html){close();dialog.innerHTML=html+'<button type="button" id="cancel">Cancel</button>';dialog.showModal();$('#cancel').onclick=()=>{if(!busy)close();};timeout();}
function render(){let waiting={};try{waiting=pending();}catch(e){notice(e.message,true);}
 app.innerHTML=`<header><div class="brand">FEN MEAT<small>${esc(state.device.name)}</small></div><span id="clock-time" class="time">${clockTime(new Date(Date.now()+offset))}</span></header><main><div class="title-row"><div><h1>Clock in / out</h1><p class="sub">${localDay(new Date(Date.now()+offset))} · South African time</p></div><button id="refresh">Refresh</button></div><p id="connection" class="notice-panel">${navigator.onLine?'Select your name and enter your PIN.':'Offline. Connect to the internet before clocking.'}</p><input id="find" type="search" aria-label="Find your name" placeholder="Find your name"><div class="person-grid section-note">${state.people.map(p=>`<button class="person" data-person="${p.id}"><strong>${esc(p.name)}</strong><span class="pill ${p.state}">${stateLabels[p.state]}</span>${waiting[p.id]?'<small>Action awaiting confirmation</small>':''}</button>`).join('')||'<p>No active employees. Ask Alex or Alinda to complete setup.</p>'}</div><p class="small">Forgot to clock, or need a correction? Ask Alex or Alinda. No hours are guessed.</p></main>`;
 $('#find').oninput=e=>{for(const b of document.querySelectorAll('[data-person]'))b.hidden=!state.people.find(p=>p.id===b.dataset.person).name.toLowerCase().includes(e.target.value.toLowerCase());};
 $('#refresh').onclick=()=>load().catch(e=>notice(e.message,true));document.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>choose(b.dataset.person));
}
async function load(){state=await api('state');offset=Date.parse(state.server_time)-Date.now();render();}
async function punch(p,pin,entry){
 if(busy)return;if(!navigator.onLine){notice('Connect to the internet before clocking.',true);return;}
 busy=true;dialog.querySelectorAll('button,input').forEach(b=>b.disabled=true);
 try{savePending(p.id,entry);const r=await api('punch',{...entry,pin});try{savePending(p.id,null);}catch{}close();notice(`${p.name}: ${actionLabels[r.kind]} saved at ${clockTime(r.at)}.`);try{await load();}catch{notice('Clock action saved. Use Refresh when the connection returns.');}}
 catch(e){if(e.status&&e.status!==401&&e.status!==429&&e.status<500){try{savePending(p.id,null);}catch{}}close();notice(e.message,true);}finally{busy=false;pin='';}
}
function choose(id){if(busy)return;const p=state.people.find(p=>p.id===id);let waiting;try{waiting=pending()[id];}catch(e){notice(e.message,true);return;}
 show(`<h2>${esc(p.name)}</h2><p>${waiting?'Your last action needs confirmation. Enter your 4-digit PIN to retry it.':'Enter your 4-digit PIN. Use your birthday PIN or the casual PIN given to you by Alex or Alinda.'}</p><form id="pin-form"><label>PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" autocomplete="off" minlength="4" maxlength="4" required></label><p id="pin-error" class="form-error" role="alert"></p><button class="primary">Continue</button></form>`);
 $('#pin-form').onsubmit=async e=>{e.preventDefault();if(busy)return;let pin=new FormData(e.target).get('pin');if(waiting){await punch(p,pin,waiting);pin='';return;}busy=true;const f=e.target;f.querySelector('button').disabled=true;
  try{const status=await api('verify',{employee_id:id,pin});if(!dialog.open)return;const actions=status.state==='out'?['in']:status.state==='in'?['out','break_start']:['break_end','out'];
   // The PIN lives only in this short-lived dialog closure. It is never stored.
   show(`<h2>${esc(p.name)}</h2><p>${stateLabels[status.state]}${status.last_at?' · Last action '+localDay(status.last_at)+' '+clockTime(status.last_at):''}</p>${actions.map(kind=>`<button class="primary" data-action="${kind}">${actionLabels[kind]}</button>`).join('')}`);
   document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>punch(p,pin,{employee_id:id,kind:b.dataset.action,revision:status.revision,request_id:crypto.randomUUID()}));
  }catch(err){if(dialog.open&&$('#pin-error')){$('#pin-error').textContent=err.message;f.querySelector('input').value='';f.querySelector('button').disabled=false;}pin='';}finally{busy=false;}
 };
}
function enrol(message=''){app.innerHTML=`<main><h1>Register clock device</h1><p>${esc(message||'Get a device code from Alex or Alinda under Staff → Devices.')}</p><form id="enrol-form"><label>Device code<input name="code" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="19" required></label><p class="form-error" role="alert"></p><button class="primary">Register this phone</button></form><p class="small">This registers a clock device and signs out management access on this phone.</p></main>`;$('#enrol-form').onsubmit=async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button');button.disabled=true;try{await api('enrol',{code:new FormData(form).get('code').replace(/[\s-]/g,'').toLowerCase()});await load();}catch(err){form.querySelector('.form-error').textContent=err.message;button.disabled=false;}};}
setInterval(()=>{if($('#clock-time'))$('#clock-time').textContent=clockTime(new Date(Date.now()+offset));},1000);
setInterval(()=>{if(state&&!dialog.open&&!busy&&!document.hidden)load().catch(e=>notice(e.message,true));},30000);
window.addEventListener('offline',()=>notice('Offline. Connect to the internet before clocking.',true));window.addEventListener('online',()=>load().catch(e=>notice(e.message,true)));
try{await load();}catch(e){if(e.status===401)enrol(e.message);else{app.innerHTML='<main><h1>Staff clock</h1><p id="startup-error"></p><button id="retry">Try again</button></main>';$('#startup-error').textContent=e.message;$('#retry').onclick=()=>location.reload();}}
