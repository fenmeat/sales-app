import './input-selection.js';
import {wageMessage,label as afLabel} from './wage-messages.js';
import {payrollPanel,bindPayroll,refreshPayroll} from './payroll-ui.js';
import {parseDecimal} from './decimal-input.js';
import {localDay,clockTime,hoursLabel,employeeSearchField,bindEmployeeSearch,employeePicker,bindPicker,currentWeek} from './staff-model.js';
import {sourcePanel,bindSourcePanel,sourceProfile} from './staff-import-ui.js';
import {historyPanel,bindHistory,chooseHistoryEmployee} from './staff-history-ui.js';
const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#action-dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types=['Annual','Sick','Family responsibility','Unpaid'],days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const labels={in:'Ingeklok',out:'Uitgeklok',break:'Op pouse'};
let data,hours,view=(new URLSearchParams(location.search).get('view')==='payroll'||new Date(localDay(new Date())+'T12:00Z').getUTCDay()===5)?'payroll':'today',dirty=false,busy=false,{from,to}=currentWeek();
let clockEmployee='',historyMode='live',hoursRequest=0;
const listQueries={};
const person=id=>data.people.find(p=>p.id===id),pill=s=>`<span class="pill ${esc(s)}">${esc(afLabel(labels[s]??s))}</span>`;
const isCasual=p=>p.employment_type==='Casual';
const casualCandidate=p=>isCasual(p)||(!p.employment_type&&p.source_profile?.kind==='Casual');
const pinLabel=p=>isCasual(p)?p.casual_pin?'Loswerker-PIN '+p.casual_pin:'Geen aktiewe PIN nie':p.pin_ready?'PIN is gereed':p.birth_date?'PIN moet nog opgestel word':'Geboortedatum nodig';
const options=(items,value)=>items.map(x=>`<option value="${esc(x)}" ${x===value?'selected':''}>${esc(afLabel(x))}</option>`).join('');
const employeeField=()=>`<label>Werknemer<select name="employee_id">${data.people.map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.code)}</option>`).join('')}</select></label>`;
const field=(label,name,value='',extra='')=>`<label>${label}<input name="${name}" value="${esc(value)}" ${extra} required></label>`;
const select=(label,name,items,value)=>`<label>${label}<select name="${name}">${options(items,value)}</select></label>`;
const reason=()=>field('Hoekom verander jy dit?','reason','','maxlength="300"');
const birthDateField=(value='',required=false)=>`<label>Geboortedatum<input name="birth_date" type="date" value="${esc(value)}" max="${localDay(new Date())}" ${required?'required':''}></label>`;
const birthdayHelp='<p class="small">Die klok-PIN gebruik die geboortemaand en dag. Vir 15 Junie is dit 0615. Die PIN verander wanneer jy die geboortedatum regstel.</p>';
const empty=message=>`<p class="empty">${message}</p>`;
const btn=(attr,id,label)=>`<button ${attr}="${id}">${label}</button>`;
function notice(message,error=false){$('#notice').textContent=wageMessage(message);$('#notice').className=error?'error':'';clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('#notice').textContent='',10000);}
async function api(path,body){let r;try{r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});}catch{throw Error('Die verbinding is onderbreek. Kies Bevestig weer om te kyk of die verandering reeds gestoor is.');}let b;try{b=await r.json();}catch{throw Error('Die app het nog geen bevestiging ontvang nie. Kies Bevestig weer.');}if(!r.ok){const e=Error(wageMessage(b.error??'Die verandering kon nie gestoor word nie. Probeer weer.'));e.status=r.status;throw e;}return b;}
async function readStaff(revision=0){const latest=await api('/api/staff');if(latest.revision<revision)throw Error('Die nuwe rekord kon nog nie gelees word nie. Probeer weer.');data=latest;hours=null;}
async function reload(){await readStaff();render();}
function closeDialog(){if(busy)return;if(dirty&&!confirm('Wil jy toemaak en jou ongestoorde veranderinge weggooi?'))return;dirty=false;dialog.close();dialog.replaceChildren();}
dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});dialog.addEventListener('input',()=>dirty=true);
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
function show(title,html){dialog.innerHTML=`<h2>${title}</h2>${html}<button type="button" data-close>Maak toe</button>`;dirty=false;if(!dialog.open)dialog.showModal();dialog.querySelector('[data-close]').onclick=closeDialog;}
function form(title,html,path,build,after,verify){
 show(title,`<form id="editor" novalidate>${html}<p class="form-error" role="alert"></p><button type="submit" class="primary">Stoor</button></form>`);
 const el=$('#editor'),button=el.querySelector('[type=submit]'),error=el.querySelector('.form-error');
 let pending=null,receipt=null,disabledBefore;
 el.onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  if(!pending){
   const invalid=[...el.elements].find(x=>x.willValidate&&!x.validity.valid);
   if(invalid){const name=invalid.labels?.[0]?.childNodes[0]?.textContent?.trim()||'hierdie veld';error.textContent='Kontroleer die veld “'+name+'”. Vul ’n geldige waarde in en kies Stoor.';invalid.focus();return;}
  }
  try{
   if(!pending){const payload=build(new FormData(el));disabledBefore=new Map([...el.elements].map(x=>[x,x.disabled]));pending={...payload,revision:data.revision,request_id:crypto.randomUUID()};}
   dirty=true;busy=true;for(const x of el.elements)x.disabled=true;dialog.querySelector('[data-close]').disabled=true;button.textContent='Stoor tans…';error.textContent='';
   receipt??=await api(path,pending);
   if(verify)await verify(receipt,pending);
   else {await readStaff(receipt.revision);if(view==='payroll')await refreshPayroll(receipt);else render();}
   busy=false;dirty=false;dialog.close();dialog.replaceChildren();notice('Gestoor');await after?.(receipt);
  }catch(err){
   busy=false;if(err.status&&!receipt)pending=null;
   for(const x of el.elements)x.disabled=!!pending||disabledBefore?.get(x)===true;
   button.disabled=false;button.textContent=pending?'Bevestig weer':'Stoor';dialog.querySelector('[data-close]').disabled=false;
   error.textContent=wageMessage(err.message);if(err.status===409)error.textContent+=' Maak toe en kies Herlaai as die rekord intussen verander het.';
  }
 };
}
function todayView(){const active=data.people.filter(p=>p.active);return `<div class="stats">${[['Aan diens',active.filter(p=>p.state==='in').length],['Op pouse',active.filter(p=>p.state==='break').length],['Uitgeklok',active.filter(p=>p.state==='out').length],['Verlof wat wag',data.state.leave.filter(r=>r.status==='Pending').length]].map(([label,n])=>`<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join('')}</div><div class="layout"><section class="panel"><h2>Wie is hier?</h2>${employeeSearchField}${active.map(p=>`<div class="row" data-search-person="${p.id}"><div><button data-edit="${p.id}">${esc(p.name)}</button><p>${esc(afLabel(p.team))}</p></div>${pill(p.state)}</div>`).join('')||empty('Voeg die werknemers onder Werknemers by.')}</section><div class="stack"><section class="panel"><h2>Werknemersbesonderhede</h2><p>${active.filter(p=>!isCasual(p)&&!p.birth_date).length} vaste werknemers kort ’n geboortedatum vir hul PIN.</p><p>${active.filter(p=>!p.schedules.length).length} werknemers kort ’n rooster.</p>${btn('data-view','people','Bestuur werknemers')}${btn('data-view','casuals','Bestuur los werkers')}${btn('data-view','hours','Gaan ure na')}</section><section class="panel"><h2>Lone</h2><p>Kyk wat elke werknemer Vrydag moet kry en teken die betaling aan.</p><button data-view="payroll">Betaal werknemers</button></section></div></div>`;}
function personRow(p){return `<div class="row person-row" data-person-row="${p.id}" data-search-person="${p.id}"><div><strong>${esc(p.name)}</strong> ${p.active?'':pill('Inactive')}<p>${esc(p.code)} · ${esc(afLabel(p.team))}</p><p><strong>${esc(pinLabel(p))}</strong></p><p>${p.start_date?'In diens vanaf '+p.start_date:'Bevestig die aanstellingsdatum'}</p><p>${p.schedules.length?'Rooster vanaf '+p.schedules.at(-1).from:'Rooster nog onbekend'}</p></div><div class="row-actions">${btn('data-person-history',p.id,'Geskiedenis')}${p.source_profile?btn('data-source-profile',p.id,'Ou besonderhede'):''}${p.employment_verified===false?btn('data-employment-date',p.id,'Bevestig begindatum'):''}${btn('data-edit',p.id,'Wysig')}${btn('data-schedule',p.id,'Rooster')}${isCasual(p)?btn('data-casual-pin',p.id,'Loswerker-PIN')+btn('data-status',p.id,p.active?'Maak onaktief':'Aktiveer weer'):casualCandidate(p)?btn('data-assign-casual',p.id,'Ken PIN toe'):btn('data-pin',p.id,'Geboortedatum en PIN')}</div></div>`;}
function peopleView(){return `<section class="panel"><div class="title-row"><h2>Werknemers</h2><div class="row-actions"><button id="new-person" class="primary">Voeg werknemer by</button><button id="new-casual">Voeg los werker by</button></div></div>${employeeSearchField}${data.people.map(personRow).join('')||empty('Daar is nog geen werknemers nie.')}</section>`;}
function casualsView(){const people=data.people.filter(casualCandidate),active=people.filter(p=>p.active),inactive=people.filter(p=>!p.active);return `<section class="panel"><div class="title-row"><h2>Los werkers</h2><button id="new-casual" class="primary">Voeg los werker by</button></div><p>PINs begin by 0001. Nadat ’n los werker uitgeklok het, kan jy hulle onaktief maak. Hul ure en geskiedenis bly bewaar.</p><p>As iemand terugkom, soek hul naam en kies Aktiveer weer.</p>${employeeSearchField}${active.map(personRow).join('')||empty('Geen aktiewe los werkers nie.')}<details><summary>Onaktiewe los werkers (${inactive.length})</summary>${inactive.map(personRow).join('')||empty('Geen onaktiewe los werkers nie.')}</details></section>`;}
function leaveView(){return `<div class="layout"><section class="panel"><div class="title-row"><h2>Verlof</h2><button id="new-leave" ${data.people.length?'':'disabled'}>Teken verlof aan</button></div>${[...data.state.leave].reverse().map(r=>`<div class="row"><div><strong>${esc(person(r.employee_id)?.name)}</strong><p>${r.date} · ${esc(afLabel(r.type))} · ${r.units} dag</p>${pill(r.status)}${r.status==='Approved'?`<p>${hoursLabel(r.paid_minutes*60)} betaalde verlof</p>`:''}</div>${['Pending','Approved'].includes(r.status)?btn('data-review',r.id,'Gaan na'):''}</div>`).join('')||empty('Geen verlofinskrywings nie.')}</section><section class="panel"><div class="title-row"><h2>Verlofsaldo’s</h2><button id="new-balance" ${data.people.length?'':'disabled'}>Teken saldo aan</button></div><p class="small">Kyk na die ou verlofsaldo’s onder <button data-view="history">Werknemergeskiedenis</button><br>Saldo’s op ${localDay(new Date())}. Goedgekeurde toekomstige verlof is reeds gereserveer. Vul verdiende verlof uit die bevestigde rekord in.</p>${data.people.map(p=>`<div class="row"><div><strong>${esc(p.name)}</strong>${Object.entries(p.balances).map(([type,n])=>`<p>${esc(afLabel(type))}: ${n===null?'Nog onbekend':n+' dae'}</p>`).join('')}</div></div>`).join('')}<button id="leave-ledger">Sien saldogeskiedenis</button></section></div>`;}
function devicesView(){return `<div class="layout"><section class="panel"><div class="title-row"><h2>Kloktoestelle</h2><button id="new-device" ${data.pin_secret_configured?'':'disabled'}>Registreer toestel</button></div>${data.devices.map(d=>`<div class="row"><div><strong>${esc(d.name)}</strong><p>${d.revoked?'Revoked':d.enrolled?(d.expires>Date.now()?'Registered · expires '+localDay(d.expires):'Expired'):(d.code_expires>Date.now()?'Waiting for setup':'Setup code expired')}</p></div>${d.revoked?'':btn('data-revoke',d.id,'Revoke')}</div>`).join('')||empty('Geen geregistreerde kloktoestelle nie.')}</section><section class="panel"><h2>Stel die fabriek se foon op</h2><ol><li>Skep hier ’n toestelkode.</li><li>Maak <strong>${esc(location.origin)}/staff-clock</strong> op die fabriek se foon oop.</li><li>Vul die kode binne 10 minute in.</li><li>Elke werknemer kies hul naam en vul hul PIN in.</li></ol><p class="notice-panel">Sodra die toestel as klok opgestel is, word bestuur uitgeteken. Bestuur lone op jou eie toestel.</p><p class="small">Die klok het internet nodig om die tyd te stoor.</p></section></div>`;}
function shiftRow(shift){
 const x=shift.exclusion,c=shift.correction;
 const punches=shift.punches.map(p=>localDay(p.at)+' '+clockTime(p.at)+' '+esc(({in:'In',out:'Uit',break_start:'Begin pouse',break_end:'Einde pouse'})[p.kind])).join('<br>');
 const excluded=x?`<p><strong>Uitgesluit by loonberekening</strong> · ${esc(x.reason)} · ${esc(x.actor)} · ${localDay(x.at)} ${clockTime(x.at)}</p>`:'';
 const corrected=c?`<p>Reggestel deur ${esc(c.actor)} · ${esc(c.reason)}. Die oorspronklike tye bly in die ouditgeskiedenis.</p>`:'';
 const actions=x?'':btn('data-correction',shift.id,'Verander kloktye')+(data.can_exclude_shifts&&shift.punches.at(-1).kind==='out'?btn('data-exclude',shift.id,'Sluit uit by loonberekening'):'');
 return `<div class="row"><div><strong>${esc(person(shift.employee_id)?.name)}</strong><p>${punches}</p>${excluded}${corrected}</div><div class="row-actions">${actions}</div></div>`;
}
function hoursView(){
 if(view==='hours'&&clockEmployee===null)clockEmployee='';
 if(view==='history'&&!clockEmployee)clockEmployee=data.people[0]?.id??'';
 return `<section class="panel" id="native-hours"><h2>Huidige klokure</h2><p>Hier is die fabriek se klokinskrywings. Voltooide ure, ná pouses, gaan na die loonkonsep.</p>
 ${employeePicker(data.people,clockEmployee,view==='hours')}
 <form id="period" class="toolbar">${field('Van','from',from,'type="date"')}${field('Tot','to',to,'type="date"')}<button>Wys tydperk</button></form>
 <label>Spring na datum<input type="date" id="clock-day"></label><button id="clock-week">Huidige week</button>
 <div id="clock-results" aria-live="polite"></div></section>`;
}
function historyControls(){
 return `<div class="toolbar"><button data-history-mode="live" aria-pressed="${historyMode==='live'}">Huidige klokure</button><button data-history-mode="archive" aria-pressed="${historyMode==='archive'}">Ou geskiedenis</button></div>`;
}
function displayHours(h){
 const withTime=h.rows;
 const totals=withTime.map(r=>`<details ${clockEmployee?'open':''}><summary>${esc(person(r.employee_id)?.name)} · ${hoursLabel(r.completed_seconds)} voltooi · ${hoursLabel(r.review_seconds)} om na te gaan · ${hoursLabel(r.paid_leave_minutes*60)} verlof</summary>${r.days.filter(d=>d.completed_seconds||d.review_seconds||d.paid_leave_minutes||d.issues.length).map(d=>`<p>${d.date} · <strong>${hoursLabel(d.completed_seconds)}</strong> voltooi · ${hoursLabel(d.review_seconds)} om na te gaan · ${hoursLabel(d.paid_leave_minutes*60)} verlof ${esc(d.issues.map(wageMessage).join(' · '))}</p>`).join('')}</details>`).join('');
 const navigation=[['previous','Vorige klokdag','Geen vroeër klokdag nie.'],['next','Volgende klokdag','Geen later klokdag nie.']].map(([key,label,why])=>`<div><button data-clock-jump="${h[key]??''}" ${h[key]?'':'disabled'}>${label}</button>${h[key]?'':'<small> '+why+'</small>'}</div>`).join('');
 return `<p>${h.from} – ${h.to}</p>${h.shifts.length?'':'<p>Geen huidige klokinskrywings vir dié datums nie.</p>'}${totals}${h.shifts.map(shiftRow).join('')}<div class="row-actions">${navigation}</div>`;
}
function bindHours(){
 const root=$('#native-hours'),result=$('#clock-results'),period=$('#period');
 async function load(){
  const request=++hoursRequest;
  hours=null;
  if(clockEmployee===null){result.replaceChildren();return;}
  result.textContent='Laai klokure…';
  const query=new URLSearchParams({from,to,navigation:'1'});
  if(clockEmployee)query.set('employee_id',clockEmployee);
  try{
   const response=await api('/api/staff/hours?'+query);
   if(!root.isConnected||request!==hoursRequest)return;
   hours=response;result.innerHTML=displayHours(hours);
   for(const b of result.querySelectorAll('[data-correction]'))b.onclick=()=>correctionForm(b.dataset.correction);
   for(const b of result.querySelectorAll('[data-exclude]'))b.onclick=()=>excludeForm(b.dataset.exclude);
   for(const b of result.querySelectorAll('[data-clock-jump]'))b.onclick=()=>setDates(b.dataset.clockJump,b.dataset.clockJump);
  }catch(e){if(root.isConnected&&request===hoursRequest)result.textContent=e.message;}
 }
 function setDates(f,t){
  from=f;to=t;period.elements.from.value=f;period.elements.to.value=t;
  $('#clock-day').value=f===t?f:'';load();
 }
 bindPicker(root,data.people,clockEmployee,view==='hours',id=>{clockEmployee=id;load();});
 period.onsubmit=e=>{e.preventDefault();setDates(period.elements.from.value,period.elements.to.value);};
 $('#clock-day').onchange=e=>{if(e.target.value)setDates(e.target.value,e.target.value);};
 $('#clock-week').onclick=()=>{const week=currentWeek();setDates(week.from,week.to);};
 load();
}
function excludeForm(id){
 const s=hours.shifts.find(s=>s.id===id),clockRevision=hours.revisions.find(r=>r.employee_id===s.employee_id).revision;
 form('Sluit uit by loonberekening',`<p><strong>${esc(person(s.employee_id).name)}</strong> · ${localDay(s.punches[0].at)} ${clockTime(s.punches[0].at)} – ${localDay(s.punches.at(-1).at)} ${clockTime(s.punches.at(-1).at)}</p><p>Hierdie skof sal nie na die loonkonsep gaan nie. Die oorspronklike klokinskrywings bly bewaar.</p>`+field('Rede vir uitsluiting','reason','','maxlength="300"'),'/api/staff/exclude-shift',f=>({shift_id:id,employee_id:s.employee_id,clock_revision:clockRevision,reason:f.get('reason')}));
}
function render(){app.innerHTML=`<header><div class="brand">FEN MEAT<small>Personeel</small></div><nav class="nav" aria-label="Fen Meat sections"><a class="home-link" href="/">Tuis</a><a href="/tasks">Take</a><a href="/sales">Verkope</a><a href="/production">Produksie</a><a class="active" href="/staff" aria-current="page">Personeel</a></nav></header><main><div class="title-row"><div><h1>Personeel</h1><p class="sub">Klokure, verlof en lone</p></div><button id="refresh">Herlaai</button></div>${data.pin_secret_configured?'':'<p class="notice-panel">Die kloktoestel se PIN moet nog opgestel word. Jy kan reeds werknemers en roosters invul.</p>'}<nav class="tabs" aria-label="Staff views">${[['today','Vandag'],['people','Werknemers'],['casuals','Los werkers'],['hours','Klokure'],['leave','Verlof'],['payroll','Lone'],['history','Werknemergeskiedenis'],['source','Ou rekords'],['devices','Kloktoestelle']].map(([v,label])=>`<button data-view="${v}" ${view===v?'aria-current="page"':''}>${label}</button>`).join('')}</nav>${({today:todayView,people:peopleView,casuals:casualsView,hours:hoursView,leave:leaveView,payroll:payrollPanel,history:()=>historyControls()+(historyMode==='live'?hoursView():historyPanel(data.people)),source:()=>sourcePanel({history:!!data.state.source_import}),devices:devicesView})[view]()}<footer>${esc(data.username)} · Suid-Afrikaanse tyd <button id="audit">Sien geskiedenis</button></footer></main>`;bind();}
function personForm(id){const p=id?person(id):{id:crypto.randomUUID(),name:'',code:'',team:'Production',active:true,start_date:localDay(new Date())};form(id?'Wysig werknemer':'Voeg werknemer by',field('Naam','name',p.name,'maxlength="80"')+field('Werknemerkode','code',p.code,`maxlength="24" pattern="[A-Za-z0-9_-]+" ${id?'readonly':''}`)+field('Span','team',p.team,'maxlength="60"')+field('In diens vanaf','start_date',p.start_date,`type="date" ${id&&p.start_date?'readonly':''}`)+select('Soort werknemer','employment_type',['Regular','Casual'],p.employment_type??'Regular')+`<div id="birthday-fields">${birthDateField(p.birth_date??'')}${birthdayHelp}</div><p id="casual-help">A casual gets the lowest available 4-digit PIN, starting at 0001. No birthday is nodig to clock.</p>`+select('Status','active',['Active','Inactive'],p.active?'Active':'Inactive'),'/api/staff',f=>({action:'person',person:{id:p.id,name:f.get('name'),code:f.get('code')??'',team:f.get('team'),start_date:f.get('start_date'),employment_type:f.get('employment_type'),...(f.get('employment_type')==='Regular'?{birth_date:f.get('birth_date')||null}:{}),active:f.get('active')==='Active'}}),()=>{if(isCasual(person(p.id)))showCasualPin(p.id);});
 const type=dialog.querySelector('[name=employment_type]'),sync=()=>{const casual=type.value==='Casual';$('#birthday-fields').hidden=casual;$('#casual-help').hidden=!casual;dialog.querySelector('[name=birth_date]').disabled=casual;if(!id){const code=dialog.querySelector('[name=code]');code.disabled=casual;code.closest('label').hidden=casual;}};type.onchange=sync;sync();
}
function showCasualPin(id){const p=person(id);show('Loswerker-PIN',`<p><strong>${esc(p.name)}</strong></p>${p.casual_pin?`<p class="setup-code">${esc(p.casual_pin)}</p><p>Select your name on the yard phone, then enter these four digits.</p>${p.employment_verified===false?'<p class="notice-panel">Confirm the employment start date before clocking.</p>':''}`:'<p>No active PIN. Activate this person to assign an available PIN.</p>'}`);}
function casualForm(){const id=crypto.randomUUID();form('Add casual',field('Name and surname','name','','maxlength="80"')+field('Work / team','team','Production','maxlength="60"')+field('In diens vanaf','start_date',localDay(new Date()),'type="date"')+'<p>The employee number and the next available PIN are assigned when you save. A birthday is not nodig to clock.</p>','/api/staff',f=>({action:'person',person:{id,name:f.get('name'),team:f.get('team'),start_date:f.get('start_date'),active:true,employment_type:'Casual'}}),()=>showCasualPin(id));}
function assignCasualForm(id){const p=person(id);form('Ken PIN toe',`<p>${esc(p.name)}</p><p>Use an available PIN from 0001 upwards. Keep this person’s existing record and all saved hours.</p>`,'/api/staff',()=>({action:'clock_type',employee_id:id,employment_type:'Casual'}),()=>showCasualPin(id));}
function statusForm(id){const p=person(id);form(p.active?'Make casual inactive':'Activate casual again',`<p><strong>${esc(p.name)}</strong></p><p>${p.active?'Clock out first. Their PIN will become available for another casual. Saved hours and history are kept.':'This keeps their original record and assigns an available PIN. Check the PIN shown after saving; it may have changed.'}</p>`,'/api/staff',()=>({action:'status',employee_id:id,active:!p.active}),()=>{if(!p.active)showCasualPin(id);});}
function scheduleForm(id){const p=person(id);form('Werkrooster',`<p>${esc(p.name)}</p><p class="small">Vul die gewone betaalbare ure vir elke dag in. Gebruik 0 vir ’n afdag.</p>`+field('Geldig vanaf','from',localDay(new Date()),'type="date"')+`<div class="schedule-grid">${days.map((d,i)=>field(d,'d'+i,p.schedules.at(-1)?.minutes[i]!==undefined?p.schedules.at(-1).minutes[i]/60:'','inputmode="decimal"')).join('')}</div>`+reason(),'/api/staff',f=>{const mins=days.map((_,i)=>parseDecimal(f.get('d'+i))*60);if(mins.some(n=>!Number.isFinite(n)||Math.abs(n-Math.round(n))>1e-7))throw Error('Vul die tyd tot die naaste hele minuut in.');return {action:'schedule',employee_id:id,from:f.get('from'),minutes:mins.map(Math.round),reason:f.get('reason')};});}
function pinForm(id){const p=person(id);form('Geboortedatum en PIN',`<p>${esc(p.name)}</p>`+birthDateField(p.birth_date??'',true)+birthdayHelp+(data.pin_secret_configured?'':'<p class="notice-panel">You can save the date now. Clocking becomes available when the secure Staff PIN configuration is complete.</p>'),'/api/staff',f=>({action:'birth_date',employee_id:id,birth_date:f.get('birth_date')}));}
function leaveForm(){form('Teken verlof aan',employeeField()+select('Type','type',types)+field('Date','date',localDay(new Date()),'type="date"')+select('Aantal roosterdae','units',['1','0.5'])+reason()+'<p class="small">Kies die werkdag en die soort verlof. Die saldo verander sodra die verlof goedgekeur is.</p>','/api/staff',f=>({...Object.fromEntries(f),action:'leave_request',units:Number(f.get('units')),record_id:crypto.randomUUID()}));}
function reviewLeave(id){const r=data.state.leave.find(r=>r.id===id);form('Gaan verlof na',`<p>${esc(person(r.employee_id).name)} · ${r.date} · ${esc(afLabel(r.type))} · ${r.units} dag</p><p>${esc(r.reason)}</p>`+select('Besluit','decision',r.status==='Pending'?['Approved','Declined','Cancelled']:['Cancelled'])+reason()+'<p class="small">Vul die werkrooster en die beskikbare verlofsaldo in voordat jy verlof goedkeur.</p>','/api/staff',f=>({...Object.fromEntries(f),action:'leave_decision',record_id:id,employee_id:r.employee_id}));}
function balanceForm(){form('Record verified balance',employeeField()+select('Type','type',types.filter(t=>t!=='Unpaid'))+select('Entry','kind',['opening','adjustment'])+field('Effective date','date',localDay(new Date()),'type="date"')+field('Days (negative for a reduction)','units','','inputmode="decimal"')+reason()+'<p class="small">Use a reconciled opening balance. Do not enter historical totals again as individual leave days.</p>','/api/staff',f=>{const raw=String(f.get('units')).trim(),n=parseDecimal(raw.replace(/^-/,'') )*(raw.startsWith('-')?-1:1);if(!Number.isFinite(n))throw Error('Enter valid days using a comma or point.');return {...Object.fromEntries(f),units:n,action:'balance',record_id:crypto.randomUUID()};});}
function deviceForm(){const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');form('Register clock device',field('Device name','name','','maxlength="60" placeholder="Yard phone"'),'/api/staff/device',f=>({action:'create',device_id:crypto.randomUUID(),name:f.get('name'),code}),()=>show('Stel die fabriek se foon op',`<p>Maak <strong>${esc(location.origin)}/staff-clock</strong> on that phone and enter:</p><p class="setup-code">${code}</p><p>Single use · expires after 10 minutes.</p>`));}
function revokeForm(id){form('Revoke clock device?',`<p>${esc(data.devices.find(d=>d.id===id).name)} will stop accepting clock actions. Saved clock records are kept.</p>`,'/api/staff/device',()=>({action:'revoke',device_id:id}));}
function correctionForm(id){const s=hours.shifts.find(s=>s.id===id),rev=hours.revisions.find(r=>r.employee_id===s.employee_id)?.revision??0;
 const row=(p={kind:'out'})=>`<div class="punch-row"><select aria-label="Soort klokinskrywing">${options(['in','break_start','break_end','out'],p.kind)}</select><input aria-label="Plaaslike kloktyd" type="datetime-local" step="0.001" value="${p.at?new Date(Date.parse(p.at)+7200000).toISOString().slice(0,23):''}" required><button type="button" class="remove-punch">Verwyder</button></div>`;
 form('Verander kloktye en pouses',`<p>${esc(person(s.employee_id).name)} · Suid-Afrikaanse tyd</p><p class="small">Die vorige tye bly in die geskiedenis.</p><div id="punches">${s.punches.map(row).join('')}</div><button type="button" id="add-punch">Voeg inklok, uitklok of pouse by</button>`+reason()+'<label class="check"><input type="checkbox" name="confirm_review">Ek het hierdie tye nagegaan, ook as die skof lank was of oor middernag geloop het.</label>','/api/staff/correction',f=>({employee_id:s.employee_id,shift_id:id,clock_revision:rev,reason:f.get('reason'),confirm_review:f.get('confirm_review')==='on',punches:[...$('#punches').children].map(el=>({kind:el.querySelector('select').value,at:new Date(el.querySelector('input').value+'+02:00').toISOString()}))}));
 $('#add-punch').onclick=()=>{$('#punches').insertAdjacentHTML('beforeend',row());dirty=true;};$('#punches').onclick=e=>{if(e.target.matches('.remove-punch')){e.target.closest('.punch-row').remove();dirty=true;}};
}
function auditDetail(raw){const d=JSON.parse(raw);return [d.employee_id?person(d.employee_id)?.name:'',d.name,d.reason].filter(Boolean).join(' · ');}
function bind(){
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});
 for(const [attr,fn]of Object.entries({'data-edit':personForm,'data-schedule':scheduleForm,'data-pin':pinForm,'data-casual-pin':showCasualPin,'data-assign-casual':assignCasualForm,'data-status':statusForm,'data-review':reviewLeave,'data-revoke':revokeForm,'data-correction':correctionForm}))document.querySelectorAll(`[${attr}]`).forEach(b=>b.onclick=()=>fn(b.getAttribute(attr)));
 document.querySelectorAll('[data-source-profile]').forEach(b=>b.onclick=()=>show('Oorspronklike werknemerbesonderhede',sourceProfile(person(b.dataset.sourceProfile))));
 document.querySelectorAll('[data-employment-date]').forEach(b=>b.onclick=()=>{const p=person(b.dataset.employmentDate);form('Bevestig aanstellingsdatum',`<p>${esc(p.name)}</p><p>Kontroleer die aanstellingsdatum op die oorspronklike rekord.</p>`+field('Bevestigde aanstellingsdatum','date',p.start_date??'','type="date"')+reason(),'/api/staff',f=>({action:'employment_date',employee_id:p.id,date:f.get('date'),reason:f.get('reason')}));});
 if(view==='payroll')bindPayroll({api,form,notice,show,people:data.people,leave:()=>data.state.leave,readStaff,clockDay:async(id,date)=>{
  hours=await api('/api/staff/hours?employee_id='+encodeURIComponent(id)+'&from='+date+'&to='+date);
  const active=hours.shifts.filter(s=>!s.exclusion);
  if(active.length===1){correctionForm(active[0].id);return;}
  show('Kies die skof',active.length?active.map(s=>btn('data-choose-shift',s.id,clockTime(s.punches[0].at)+' – '+clockTime(s.punches.at(-1).at))).join(''):'Geen skof is op dié dag aangeteken nie. Gebruik Verander hierdie dag om die betaalbare ure in te vul.');
  for(const button of dialog.querySelectorAll('[data-choose-shift]'))button.onclick=()=>correctionForm(button.dataset.chooseShift);
 }});
 if(['today','people','casuals'].includes(view))bindEmployeeSearch(app,data.people,listQueries[view],value=>{listQueries[view]=value;});
 for(const b of document.querySelectorAll('[data-history-mode]'))b.onclick=()=>{historyMode=b.dataset.historyMode;if(clockEmployee)chooseHistoryEmployee(clockEmployee);render();};
 if(view==='history'&&historyMode==='archive')bindHistory({api,people:data.people,onEmployee:id=>{clockEmployee=id;}});
 if($('#native-hours'))bindHours();
 document.querySelectorAll('[data-person-history]').forEach(b=>b.onclick=()=>{clockEmployee=b.dataset.personHistory;historyMode='live';chooseHistoryEmployee(clockEmployee);view='history';render();});
 if(view==='source')bindSourcePanel({api,history:!!data.state.source_import,revision:data.revision,onSaved:reload,setBusy:value=>{busy=value;}});
 const on=(selector,fn)=>$(selector)?.addEventListener('click',fn);
 on('#refresh',()=>reload().catch(e=>notice(e.message,true)));on('#new-person',()=>personForm());on('#new-casual',casualForm);on('#new-leave',leaveForm);on('#new-balance',balanceForm);on('#new-device',deviceForm);
 on('#leave-ledger',()=>show('Leave balance history',[...data.state.ledger].reverse().map(r=>`<div class="row"><div><strong>${esc(person(r.employee_id)?.name)}</strong><p>${r.date} · ${esc(afLabel(r.type))} · ${r.units} days · ${esc(r.kind)}</p><p>${esc(r.reason)} · ${esc(r.actor)}</p></div></div>`).join('')||empty('No verified ledger entries.')));
 on('#audit',async()=>{try{const a=await api('/api/staff/audit');show('Onlangse personeelveranderings',a.register.map(r=>`<div class="row"><div><strong>${esc(r.action.replaceAll('_',' '))}</strong><p>Revision ${r.revision} · ${esc(r.actor)} · ${localDay(r.saved_at)} ${clockTime(r.saved_at)}</p><p>${esc(auditDetail(r.detail))}</p></div></div>`).join('')+'<h3>Klokgeskiedenis</h3>'+a.clock.map(r=>`<div class="row"><div><strong>${esc(person(r.employee_id)?.name)} · ${esc(r.action)}</strong><p>${esc(r.actor)} · ${localDay(r.saved_at)} ${clockTime(r.saved_at)}</p><p>${JSON.parse(r.payload).punches.map(p=>`${esc(p.kind)} ${localDay(p.at)} ${clockTime(p.at)}`).join('<br>')}</p></div></div>`).join(''));}catch(e){notice(e.message,true);}});

}
try{await reload();}catch(e){app.innerHTML=`<main><h1>Personeel</h1><p>${esc(e.message)}</p><p>Meld met jou Fen Meat-rekening aan om personeel te bestuur.</p><a href="/">Meld aan by Fen Meat</a></main>`;}
