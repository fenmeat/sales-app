import {hoursLabel,localDay,clockTime,employeeSearchField} from './staff-model.js';
import {parseDecimal} from './decimal-input.js';
import {wageMessage,label} from './wage-messages.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number.isSafeInteger(n)?'R '+(n/100).toLocaleString('af-ZA',{minimumFractionDigits:2,maximumFractionDigits:2}):'Nog onbekend';
const memo='<label>Hoekom verander jy dit?<textarea name="note" maxlength="300" required></textarea></label>';
const box=(title,name,checked=false)=>`<label class="check"><input type="checkbox" name="${h(name)}" ${checked?'checked':''}>${h(title)}</label>`;
const input=(title,name,value='',required=false)=>`<label>${h(title)}<input name="${name}" inputmode="decimal" value="${h(value)}" ${required?'required':''}></label>`;
const whole=(f,k,max)=>{const raw=String(f.get(k)??'').trim(),n=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n>max)throw Error('Vul ’n geldige aantal ure of minute in.');return n;};
const cents=(f,k)=>{const raw=String(f.get(k)??'').trim();if(!raw)return undefined;const value=parseDecimal(raw);if(!Number.isFinite(value)||value<0||Math.abs(value*100-Math.round(value*100))>0.000001)throw Error('Vul ’n positiewe randbedrag of nul in, met hoogstens twee desimale.');return Math.round(value*100);};
const total=(rows,key)=>rows.reduce((sum,r)=>sum+(r[key]??0),0);
const expanded=new Set();
let group='all';
const visible=run=>group==='casual'?run.rows.filter(r=>r.employment_type==='Casual'):run.rows;
const status=r=>r.wage_state==='Paid'?'Betaal':r.ready||r.wage_state==='Approved'?'Gereed':'Kort inligting';
const needsPrior=r=>!r.wage_state && (r.issues??[]).some(i=>/earlier November|Earlier November/.test(i));
const confirmed=r=>status(r)!=='Kort inligting' && Number.isSafeInteger(r.net_cents);
const provisional=r=>r.estimate_net_cents??r.net_cents;
const netLabel=r=>confirmed(r)?'Bedrag om te betaal':provisional(r)!=null?'Voorlopige bedrag':r.before_tax_cents!=null?'Voorlopig vóór ontbrekende aftrekkings':'Bedrag om te betaal';
const displayNet=r=>confirmed(r)?r.net_cents:provisional(r)??r.before_tax_cents;
function readyAmount(rows){
 const due=rows.filter(r=>confirmed(r)&&r.wage_state!=='Paid');
 return due.length||!rows.some(r=>!confirmed(r))?money(total(due,'net_cents')):'Nog geen finale bedrag';
}
function uifAmount(row,side){
 const actual=row['uif_'+side+'_cents'],estimate=row['estimate_uif_'+side+'_cents'];
 return actual==null&&Number.isSafeInteger(estimate)?'Voorlopig '+money(estimate):money(actual);
}
const item=(title,value)=>`<div><dt>${h(title)}</dt><dd>${h(value)}</dd></div>`;
const when=at=>new Date(at).toLocaleString('af-ZA',{timeZone:'Africa/Johannesburg'});
const entries=(leave,id,date)=>leave.filter(x=>x.employee_id===id&&x.date===date&&['Approved','Pending'].includes(x.status));
const dayName=date=>new Intl.DateTimeFormat('af-ZA',{timeZone:'Africa/Johannesburg',weekday:'long',day:'numeric',month:'short'}).format(new Date(date+'T12:00Z'));
function employeeIssue(row,leave,issue){
 const missing=issue.match(/^(\d{4}-\d\d-\d\d) · (?:Correct hours or mark absent|Confirm attendance or mark absent)\.$/);
 if(missing){
  const pending=entries(leave,row.employee_id,missing[1]).find(x=>x.status==='Pending');
  if(pending)return dayName(missing[1])+' se '+label(pending.type).toLocaleLowerCase('af-ZA')+' wag op goedkeuring. Dié dag is nog nie by die loon ingereken nie. Kies Verlof en dan Gaan na by die aansoek.';
 }
 return wageMessage(issue);
}
function dayDetails(r,leave) {
 return r.source.days.map(d=>{
  const edit=r.day_edits?.[d.date];
  const records=entries(leave,r.employee_id,d.date);
  const absence=records.map(x=>label(x.type)+(x.funding==='Employer'?' deur Fen Meat betaal':'')+' · '+label(x.status)).join(', ') || (edit?.sick_type==='sick_paid'?'Betaalde siekdag op vorige looninskrywing':edit?.sick_type==='sick_unpaid'?'Onbetaalde siekdag':'Geen');
  return `<section class="wage-day"><h4>${h(dayName(d.date))}</h4><dl class="wage-values">${item('Inklok',d.first_in?clockTime(d.first_in):'—')}${item('Uitklok',d.last_out?clockTime(d.last_out):'—')}${item('Pouse',hoursLabel((d.recorded_break_seconds??0)+(d.automatic_break_seconds??0)))}${item('Gewerk ná pouses',hoursLabel(d.payable_seconds??d.completed_seconds))}${item('Verlof',absence)}${item('Betaalde verlof',hoursLabel((d.paid_leave_minutes||edit?.sick_minutes||0)*60))}</dl>
  ${edit?.reason?`<p>${h(edit.reason)}</p>`:''}
  ${!r.wage_state&&d.date<=localDay(new Date())?`<div class="row-actions"><button data-correct="${d.date}" data-id="${r.employee_id}">Verander hierdie dag</button>${d.first_in?`<button data-clock-day="${d.date}" data-id="${r.employee_id}">Verander kloktye of pouse</button>`:''}</div>`:''}</section>`;
 }).join('');
}
function detail(r,leave) {
 const id=r.employee_id,issues=[...new Set((r.issues??[]).map(i=>employeeIssue(r,leave,i)))];
 const actions=r.wage_state?`<button data-slip="${id}">Druk loonstrokie</button> ${r.wage_state==='Approved'?`<button data-reopen="${id}">Heropen onbetaalde loon</button>`:''}`:
 `<button data-absence="${id}">Teken verlof aan of verander dit</button><button data-week="${id}">Bevestig gewerkte weekure</button>${r.wage_facts?.worked_week?`<button data-clear-week="${id}">Gebruik weer die dagure</button>`: ''}<button data-pay-profile="${id}">Loonkoers</button><button data-facts="${id}">Aftrekkings en ekstra betaling</button>
 ${r.paye_cents==null&&r.gross_cents!=null?`<button data-tax="${id}">Vul bevestigde belasting in</button>`:''}
 ${r.issues?.some(i=>/earlier November|Earlier November earnings/.test(i))?`<button data-prior-uif="${id}">Vul vorige UIF in</button>`:''}
 ${r.profile?.fen_hourly_only?`<button data-off="${id}">Ander goedgekeurde afdae</button>`:''}<button data-amend="${id}">Stel ’n vorige loonstrokie reg</button>`;
 return `<div class="wage-detail">
 ${r.profile?`<p>${h(label(r.profile.basis))} · ${money(r.profile.basis==='Hourly'?r.profile.rate_cents:r.profile.fixed_cents)}${r.profile.rate_basis?' · minimumloon vir dié week':''}</p>`:''}
 <dl class="wage-values">${item('Fen Meat se eie UIF',uifAmount(r,'employer'))}${item('Ekstra betaling',money(r.special_cents))}${r.extra_hours_minutes?item('Waarvan ekstra goedgekeurde ure',hoursLabel(r.extra_hours_minutes*60)+' · '+money(r.extra_hours_cents)):''}${item('Bonus',money(r.bonus_cents))}${item('Kommissie',money(r.commission_cents))}</dl>
 ${issues.length?`<section class="wage-warning"><strong>Kyk asseblief hierna</strong><ul>${issues.map(i=>'<li>'+h(i)+'</li>').join('')}</ul></section>`:''}
 ${r.estimate_net_cents!=null&&!confirmed(r)?`<p>${r.estimate_note?h(wageMessage(r.estimate_note)):r.estimate_uif_employee_cents!=null?'Die voorlopige bedrag trek '+money(r.estimate_uif_employee_cents)+' vir UIF af. Die vorige loonstaat sal wys of minder afgetrek moet word.':'Die voorlopige bedrag gebruik die beskikbare ure en aftrekkings. Die finale bedrag kan verander.'}</p>`:''}
 ${r.gross_cents==null&&r.recorded_gross_cents!=null?`<p>Bruto vir die ure wat reeds aangeteken is · ${money(r.recorded_gross_cents)}</p>`:''}
 ${r.wage_facts?.worked_week?`<p>Bevestigde weekure · ${hoursLabel(r.wage_facts.worked_week.minutes*60)} · ${h(r.wage_facts.worked_week.reason)}</p>`:''}
 <div class="row-actions">${actions}</div><details class="daily-breaks"><summary>Dagure, pouses en verlof</summary>${dayDetails(r,leave)}</details></div>`;
}
function employeeCard(r,leave) {
 const id=h(r.employee_id),paid=r.wage_state==='Paid',ready=confirmed(r);
 const other=(r.other_deduction_cents??0)+(r.meat_cents??0);
 return `<article class="wage-card" data-wage="${id}" data-search-person="${id}">
 <div class="wage-head"><div><button class="wage-name" data-toggle="${id}" aria-expanded="${expanded.has(r.employee_id)}">${h(r.name)}</button> <span class="wage-status" data-state="${paid?'paid':ready?'ready':'open'}">${status(r)}</span></div>
 <div class="wage-net"><small>${netLabel(r)}</small><strong>${money(displayNet(r))}</strong></div></div>
 <dl class="wage-values">${item('Gewone ure',hoursLabel(r.ordinary_seconds))}${item('Oortydure',hoursLabel(r.overtime_seconds))}${item('Betaalde verlof',hoursLabel(r.leave_seconds))}${item('Bruto loon',money(r.gross_cents))}${item('UIF-aftrekking',uifAmount(r,'employee'))}${item('Belasting (PAYE)',money(r.paye_cents))}${item('Ander aftrekkings',money(other))}</dl>
 ${!ready&&r.issues?.length?`<p class="wage-next">${h(employeeIssue(r,leave,r.issues[0]))}</p>`:''}
 <div class="wage-foot"><button data-toggle="${id}" aria-expanded="${expanded.has(r.employee_id)}">${expanded.has(r.employee_id)?'Vou toe':'Maak oop'}</button>
 ${ready&&!paid?`<label>Betaalmetode <select aria-label="Betaalmetode vir ${h(r.name)}" data-method="${id}">${['Bank','Cash'].map(m=>`<option value="${m}" ${m===r.profile?.payment_method?'selected':''}>${label(m)}</option>`).join('')}</select></label>`:''}
 <label class="check wage-check"><input type="checkbox" data-paid="${id}" aria-label="Betaal ${h(r.name)}" ${paid?'checked disabled':ready?'':'disabled'}> Betaal</label>
 ${paid?`<small>${h(r.paid_by??r.approved_by)} · ${h(r.paid_at?when(r.paid_at):r.paid_on)} · ${h(label(r.payment_method??r.profile.payment_method))}</small>`:''}</div>
 ${expanded.has(r.employee_id)?detail(r,leave):''}</article>`;
}
export function wagesPanel(run,leave) {
 const rows=visible(run),due=rows.filter(r=>confirmed(r)&&r.wage_state!=='Paid');
 return `<section class="panel"><h2>Betaal werknemers</h2><form id="pay-period" class="toolbar"><label>Betaaldatum<input name="pay_date" type="date" value="${run.pay_date}" required></label><button>Wys week</button></form>
 <div class="stats payroll-stats">${[['Gereed om te betaal',readyAmount(rows)],['Gereed',due.length],['Kort inligting',rows.filter(r=>!confirmed(r)).length],['Betaal',rows.filter(r=>r.wage_state==='Paid').length]].map(([k,v])=>`<div class="stat"><strong>${v}</strong><span>${k}</span></div>`).join('')}</div>
 <div class="toolbar"><label>Wys werknemers<select id="wage-group"><option value="all">Alle werknemers</option><option value="casual" ${group==='casual'?'selected':''}>Los werkers</option></select></label>${employeeSearchField}</div>
 <div class="row-actions"><button id="wage-list">Druk betaalstaat</button><button id="wage-pdf">Laai PDF af</button></div>
 ${run.pay_date.startsWith('2026-11')&&run.rows.some(needsPrior)?'<details><summary>Vorige UIF vir November</summary><p>As die ou loonstate wys wat elke werknemer hoogstens van 1 tot 15 November verdien het, kan jy die werknemers saam kies. Die app kyk self of hierdie week se volle UIF binne die maand se maksimum val.</p><button id="wage-earlier">Gebruik die ou loonstate</button></details>':''}
 <p>Merk Betaal sodra jy die werknemer betaal het.</p><div class="wage-list">${rows.map(r=>employeeCard(r,leave)).join('')}</div></section>`;
}
const headings=['Naam','Gewone ure','Oortyd','Verlof','Bruto','UIF','PAYE','Ander','Bedrag','Status'];
function sheetRow(r){
 return [r.name,hoursLabel(r.ordinary_seconds),hoursLabel(r.overtime_seconds),hoursLabel(r.leave_seconds),money(r.gross_cents),r.uif_employee_cents==null&&Number.isInteger(r.estimate_uif_employee_cents)?money(r.estimate_uif_employee_cents)+' *':money(r.uif_employee_cents),money(r.paye_cents),money((r.meat_cents??0)+(r.other_deduction_cents??0)),displayNet(r)==null?'Onbekend':money(displayNet(r))+(confirmed(r)?'':' *'),status(r)];
}
export function bindWages({run,leave,render,editor,save,printSheet,payslip,clockDay,notice,initialLeave}){
 const root=document.querySelector('#payroll-root'),rows=visible(run);
 const row=id=>run.rows.find(r=>r.employee_id===id);
 const actions=(attr,fn)=>root.querySelectorAll('['+attr+']').forEach(b=>b.onclick=()=>Promise.resolve().then(()=>fn(b.getAttribute(attr),b)).catch(e=>notice(wageMessage(e.message),true)));
 root.querySelector('#wage-group').onchange=e=>{group=e.target.value;render();};
 actions('data-toggle',id=>{if(expanded.has(id))expanded.delete(id);else expanded.add(id);render();});
 const earlier=root.querySelector('#wage-earlier');
 if(earlier)earlier.onclick=()=>{
  const candidates=run.rows.filter(needsPrior);
  editor('Lone van 1 tot 15 November','<p>Kies die werknemers wie se ou loonstate jy nagegaan het. Vul die hoogste totale bruto loon vir een van hulle oor die hele tydperk in. Die app gebruik dit om die maand se UIF te toets.</p>'+candidates.map(r=>box(r.name,r.employee_id)).join('')+input('Hoogste bevestigde bruto loon oor die hele tydperk (R)','upper','',true)+memo,
   f=>({action:'wages_uif_bound',employee_ids:candidates.filter(r=>f.has(r.employee_id)).map(r=>r.employee_id),upper_cents:cents(f,'upper'),note:f.get('note')}));
 };
 actions('data-paid',async(id,b)=>{
  const r=row(id),method=root.querySelector('[data-method="'+id+'"]').value;
  b.disabled=true;b.checked=false;
  try {await save({action:'wages_pay_now',employee_ids:[id],expected_cents:r.net_cents,method,paid_on:localDay(new Date())});}
  finally {if(b.isConnected)b.disabled=!!row(id).wage_state&&row(id).wage_state==='Paid';}
 });
 function report(){return {title:'Betaalstaat · '+run.pay_date,headers:headings,rows:rows.map(sheetRow),note:'* Voorlopig. As belasting of UIF ontbreek, kan hierdie bedrag verander. Gebruik die finale bedrag sodra die aftrekkings vasstaan.',total:'Gereed en nog onbetaal · '+readyAmount(rows)};}
 root.querySelector('#wage-list').onclick=()=>{const s=report();printSheet(`<section class="payroll-report"><h1>${h(s.title)}</h1><table><thead><tr>${s.headers.map(v=>'<th>'+h(v)+'</th>').join('')}</tr></thead><tbody>${s.rows.map(r=>'<tr>'+r.map(v=>'<td>'+h(v)+'</td>').join('')+'</tr>').join('')}</tbody></table><p>${h(s.note)}</p><strong>${h(s.total)}</strong></section>`,s.title);};
 root.querySelector('#wage-pdf').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const {downloadWages}=await import('./wage-pdf-bundle.js');await downloadWages(report(),run.pay_date);}catch{notice('Die PDF kon nie afgelaai word nie. Probeer weer of kies Druk betaalstaat.',true);}finally{b.disabled=false;}};
 actions('data-slip',id=>{const r=row(id);printSheet(payslip({...run,status:r.wage_state,company:r.employer??run.company,paid_on:r.paid_on,approved_by:r.approved_by,approved_at:r.approved_at},{...r,profile:{...r.profile,payment_method:r.payment_method??r.profile.payment_method}}),'Loonstrokie');});
 actions('data-reopen',id=>editor('Heropen onbetaalde loon',memo,f=>({action:'wages_reopen',employee_ids:[id],note:f.get('note')})));
 function absence(r,selected){
  const id=r.employee_id,days=r.source.days.filter(d=>d.scheduled_minutes>0&&d.date<=localDay(new Date()));
  const prior=days.filter(d=>entries(leave,id,d.date).length||r.day_edits?.[d.date]||r.paid_days?.includes(d.date));
  const conflicts=prior.map(d=>{const saved=entries(leave,id,d.date).map(e=>label(e.type)+' · '+label(e.status));const edit=r.day_edits?.[d.date];if(edit)saved.push(edit.sick_type==='sick_paid'?'Betaalde siekdag':edit.reason);if(r.paid_days?.includes(d.date))saved.push('Goedgekeurde afdag');return dayName(d.date)+' · '+saved.join(', ');});
  editor(h(r.name)+' · Verlof',`<label>Soort afwesigheid<select name="type"><option value="Sick">Siekverlof — betaal</option><option value="Annual">Jaarlikse verlof — betaal</option><option value="Unpaid">Onbetaalde verlof</option><option value="Other paid">Ander betaalde afwesigheid</option></select></label>
  <fieldset><legend>Watter dae?</legend>${days.map(d=>box(dayName(d.date)+' · '+hoursLabel(d.scheduled_minutes*60),d.date,d.date===selected||!selected)).join('')}</fieldset>
  ${conflicts.length?`<p>Reeds aangeteken</p><ul>${conflicts.map(c=>'<li>'+h(c)+'</li>').join('')}</ul>${box('Vervang die vorige inskrywing op die dae wat ek gekies het.','replace')}`:''}
  ${box('As die siekverlof op of onbekend is, keur ek betaling deur Fen Meat vir die oorblywende siekdae goed.','cover')}
  ${input('Ekstra goedgekeurde ure bo die rooster vir hierdie hele week (opsioneel)','extra',r.wage_facts?.extra_minutes!=null?r.wage_facts.extra_minutes/60:'')}${memo}`,
  f=>{const extra=String(f.get('extra')??'').trim();const mins=extra?parseDecimal(extra)*60:undefined;if(extra&&(!Number.isInteger(mins)||mins<0))throw Error('Vul die ekstra ure in, byvoorbeeld 5.');return {action:'wages_absence',employee_id:id,dates:days.filter(d=>f.has(d.date)).map(d=>d.date),type:f.get('type'),replace:f.has('replace'),employer_cover:f.has('cover'),extra_minutes:mins,note:f.get('note')};});
 }
 actions('data-absence',id=>absence(row(id)));
 if(initialLeave){
  const entry=row(initialLeave.id);
  if(entry&&!entry.wage_state)absence(entry,initialLeave.date);
  else notice('Hierdie loon is reeds goedgekeur of lê buite die betaalweek. Kyk na die vorige betaalstaat voordat jy verlof verander.',true);
 }
 actions('data-clear-week',id=>editor(h(row(id).name)+' · Gebruik weer die dagure','<p>Die loon sal weer uit die afsonderlike dagure en verlof bereken word.</p>'+memo,f=>({action:'wages_clear_week',employee_id:id,note:f.get('note')})));
 actions('data-week',id=>{const r=row(id),mins=r.wage_facts?.worked_week?.minutes;
  editor(h(r.name)+' · Gewerkte weekure',`<p>Die vyf daginskrywings wys saam ${hoursLabel(r.source.days.reduce((n,d)=>n+d.payable_seconds,0))}. Vul die bevestigde totaal ná pouses in. Verlof en ekstra betaling tel afsonderlik.</p>${input('Ure','hours',mins!=null?Math.floor(mins/60):'',true)}${input('Minute','mins',mins!=null?mins%60:0,true)}${r.source.days.some(d=>d.payable_seconds)?box('Gebruik die bevestigde weekure indien dit van die dagure verskil.','replace'):''}${memo}`,f=>({action:'wages_worked_week',employee_id:id,minutes:whole(f,'hours',120)*60+whole(f,'mins',59),replace:f.has('replace'),note:f.get('note')}));});
 actions('data-clock-day',(day,b)=>clockDay(b.dataset.id,day));
 actions('data-correct',(day,b)=>{const r=row(b.dataset.id),d=r.source.days.find(x=>x.date===day);
  editor(h(r.name)+' · '+dayName(day),`<p>Gewerk ná pouses · ${hoursLabel(d.payable_seconds)}. Rooster · ${d.scheduled_minutes==null?'onbekend':hoursLabel(d.scheduled_minutes*60)}.</p>
  <label>Wat wil jy verander?<select name="kind"><option value="hours">Gewerkte ure ná pouses</option><option value="leave">Teken verlof aan of verander dit</option>${!d.first_in?'<option value="absent">Afwesig sonder betaling</option>':''}${d.monday_rotation?'<option value="workplace">Werkplek op Maandag</option>':''}</select></label>
  ${input('Betaalbare ure','hours',Math.floor(d.payable_seconds/3600))}${input('Bykomende minute','mins',Math.floor(d.payable_seconds/60)%60)}${d.monday_rotation?'<label>Werkplek<select name="workplace"><option value="Factory">Fabriek</option><option value="Route">Roete</option></select></label>':''}${memo}`,
  f=>({action:'wages_day',employee_id:r.employee_id,day,kind:f.get('kind'),minutes:f.get('kind')==='absent'?0:whole(f,'hours',24)*60+whole(f,'mins',59),workplace:f.get('workplace'),note:f.get('note')}));
  document.querySelector('#editor [name=kind]').onchange=e=>{if(e.target.value==='leave')absence(r,day);};
 });
 actions('data-prior-uif',id=>editor(h(row(id).name)+' · UIF vir November',`<p>Hoeveel UIF is vir hierdie werknemer van 1 tot 15 November aangeteken? Die app gebruik dit om hierdie maand se maksimum toe te pas. Gebruik nul net as die vorige loonstaat dit bevestig.</p>${input('Werknemer se UIF reeds afgetrek (R)','emp','',true)}${input('Fen Meat se eie UIF reeds aangeteken (R)','org','',true)}${memo}`,f=>({action:'wages_prior_uif',employee_id:id,employee_cents:cents(f,'emp'),employer_cents:cents(f,'org'),note:f.get('note')})));
 actions('data-off',id=>{const r=row(id);editor(h(r.name)+' · Goedgekeurde afdae',r.source.days.filter(d=>d.scheduled_minutes>0&&!d.first_in&&!d.leave_days).map(d=>box(d.date,d.date,r.paid_days?.includes(d.date))).join('')+memo,f=>({action:'wages_facts',employee_id:id,paid_days:r.source.days.filter(d=>f.has(d.date)).map(d=>d.date),note:f.get('note')}));});
 actions('data-facts',id=>{const r=row(id),fields=[['bonus_cents','Weekbonus'],['commission_cents','Kommissie'],['meat_cents','Vleis op rekening'],['other_deduction_cents','Ander goedgekeurde aftrekking'],['extra_cents','Ander ekstra betaling']];
  editor(h(r.name)+' · Aftrekkings en ekstra betaling',fields.map(([k,title])=>input(title+' (R)',k,((k==='extra_cents'?(r.entered_special_cents??r.special_cents):k==='other_deduction_cents'?(r.entered_deduction_cents??r[k]):r[k])??0)/100)).join('')+
   '<label>UIF vir die maand<select name="uif"><option value="">Gebruik die bestaande inligting</option><option value="Liable">UIF is betaalbaar</option><option value="Exempt">Werknemer is vrygestel</option></select></label>'+
   (r.issues?.some(i=>/earlier November|Earlier November/.test(i))?box('Die vorige loonstaat bevestig dat die volle 1% vir albei betaalbaar is.','full'):'')+
   box('Hierdie bonus is vir werk in dieselfde week.','bonus',r.wage_facts?.weekly_bonus)+(r.profile?.basis==='Fixed weekly'?box('Die vaste weekloon en gewone ure is nagegaan.','fixed',r.wage_facts?.fixed_checked):'')+(r.legacy_review?box('Ek het die ou weekure en aftrekkings met die dagure vergelyk.','legacy'):'')+memo,
   f=>({action:'wages_facts',employee_id:id,...Object.fromEntries(fields.map(([k])=>[k,cents(f,k)])),uif:f.get('uif'),cutover_uif:f.has('full')?'Full weekly share':undefined,weekly_bonus:f.has('bonus'),fixed_checked:f.has('fixed'),legacy_checked:f.has('legacy'),note:f.get('note')}));});
 actions('data-tax',id=>editor(h(row(id).name)+' · Belasting vir hierdie week',input('Bevestigde belastingbedrag (R)','paye','',true)+memo,f=>({action:'wages_tax',employee_id:id,paye_cents:cents(f,'paye'),note:f.get('note')})));
 actions('data-amend',id=>editor(h(row(id).name)+' · Vorige loonstrokie','<label>Vorige betaaldatum<input type="date" name="original" required></label><label>Regstelling<select name="kind"><option value="Earnings">Bykomende loon</option><option value="Authorised repayment">Goedgekeurde terugbetaling</option></select></label>'+input('Bedrag (R)','amount','',true)+'<label>Verwysing<input name="reference" required></label>'+box('Ek het skriftelike toestemming of ’n ander geldige rede vir hierdie aftrekking.','authorised')+memo,f=>({action:'wages_amend',employee_id:id,original_friday:f.get('original'),kind:f.get('kind'),cents:cents(f,'amount'),reference:f.get('reference'),authorised:f.has('authorised'),note:f.get('note')})));
}
