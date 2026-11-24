import {statusLabel,taskType,standardSteps,stepProgress,stepClosed} from './task-workflow.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const person=s=>s==='pa'?'PA':s?s[0].toUpperCase()+s.slice(1):'Kies ’n persoon';
const label=s=>({'Pending':'Nog uitstaande','In Progress':'Besig','Complete':'Klaar'}[s]||statusLabel(s));
const reminders=value=>`<label>Herinnering<select name="reminder_mode">${[['due','Op die sperdatum en wanneer dit agterstallig raak'],['daily','Elke dag vanaf die sperdatum'],['off','Geen herinnering']].map(([v,l])=>`<option value="${v}" ${(value||'due')===v?'selected':''}>${l}</option>`).join('')}</select></label>`;
const documents=ids=>(ids||[]).map((id,i)=>`<a href="/api/tasks/file?id=${encodeURIComponent(id)}" target="_blank" rel="noopener">Dokument ${i+1}</a>`).join(' ');
export function stepsHTML(task,controls=true,access=null,summary=false,listOnly=false){
 const steps=standardSteps(task,access?.today);
 const {done,total,percent,remaining,overdue,waived=0}=task.progress||stepProgress(steps);
 const manage=access?access.admin||(!task.step_only&&task.created_by===access.username&&task.assigned_to===access.username&&steps.every(s=>s.assigned_to===access.username)):true;
 const head=`<section class="workflow"><p><strong>Vordering: ${done} van ${total} stappe voltooi — ${percent}%.</strong></p><progress value="${percent}" max="100" aria-label="Taakvordering">${percent}%</progress><p>${remaining} uitstaande${waived?' · '+waived+' verval':''}${overdue?` · <strong class="overdue-text">${overdue} agterstallig</strong>`:''}</p>${task.ready_for_approval?'<p class="notice">Wag vir goedkeuring</p>':''}`;
 if(summary)return head+'</section>';
 const rows=steps.map((s,i)=>{
  const closed=stepClosed(s)||s.status==='Cancelled';
  const act=!access||access.admin||s.assigned_to===access.username;
  const status=s.status==='Waived'?'Verval':s.blocked?'Wag vir vorige stap':label(s.effective_status||s.status);
  const button=(key,title,disabled=false)=>`<button type="button" data-step-${key}="${esc(s.id)}" ${disabled?'disabled':''}>${title}</button>`;
  const actions=[];
  if(controls&&task.task_type==='workflow'&&task.status!=='Cancelled'){
   if(!closed&&act)actions.push(button('complete','Merk huidige stap klaar',s.blocked),button('start','Begin stap',s.blocked));
   if(manage){
    if(closed)actions.push(button('reopen','Heropen stap'));
    actions.push(button('edit','Wysig stap'));
    if(!closed)actions.push(button('delegate','Delegeer'),button('waive','Laat stap met rede verval'));
    actions.push(...[-1,1].map((dir)=>`<button type="button" data-step-move="${esc(s.id)}" data-direction="${dir}" ${i+dir<0||i+dir>=steps.length?'disabled':''}>Skuif ${dir<0?'op':'af'}</button>`),button('delete','Verwyder stap'));
   }
   if(act)actions.push(button('note','Voeg nota by / Scan Document'));
  }
  return `<li class="step ${s.status==='Complete'?'step-done':''} ${s.overdue?'overdue':''}"><div class="step-heading"><span>${s.status==='Complete'?'✓':closed?'–':'○'}</span><strong>${i+1}. ${esc(s.description)}</strong></div><p>${esc(person(s.assigned_to))}${s.due_date?' · Opvolg '+esc(s.due_date):''} · ${esc(status)}${s.required===false?' · Opsioneel':''}${s.overdue?' · <strong>Agterstallig</strong>':''}</p>${s.waiting_reason?'<p>'+esc(s.waiting_reason)+'</p>':''}${s.notes?'<p>'+esc(s.notes)+'</p>':''}${s.waiver?'<p>Verval: '+esc(s.waiver.reason)+'</p>':''}${s.document_url?'<a target="_blank" rel="noopener" href="'+esc(s.document_url)+'">Dokument</a>':''}${documents(s.attachments)}${s.completion?`<p>${s.completion.at?'Aangeteken '+esc(s.completion.at.slice(0,10))+' · ':''}${esc(s.completion.by||'')}</p><p>${esc(s.completion.note)}</p>${s.completion.proof_url?'<a target="_blank" rel="noopener" href="'+esc(s.completion.proof_url)+'">Bewys</a>':''}${documents(s.completion.attachments)}`:''}<div class="actions">${actions.join('')}</div></li>`;
 }).join('');
 const finish=controls&&task.task_type==='workflow'&&!task.step_only&&!['Complete','Cancelled'].includes(task.status)&&(!access||access.username==='alex'||access.username===task.assigned_to||(task.can_manage&&task.kind==='general'&&task.visibility==='operational'));
 return (listOnly?'':head)+'<ol class="step-list">'+rows+'</ol>'+(finish?`<button type="button" id="approve-workflow">${task.ready_for_approval?'Keur goed en sluit taak':'Merk hele taak klaar'}</button>`:'')+(listOnly?'':'</section>');
}
export function workflowForms(ctx){
 const FormData=ctx.FormDataConstructor||globalThis.FormData;
 const {show,base,submit,getData,dialog,attachmentPicker,fileData,createAttachments}=ctx;
 const attach=(f,taskId)=>attachmentPicker(f,{taskId,api:ctx.api,prepareFile:fileData});
 function step(task,old){
  const data=getData(),steps=task.steps||[],stepId=old?.id||crypto.randomUUID();
  show(base(old?'Wysig stap':'Voeg stap by',`<label>Wat moet gedoen word?<textarea name="description" required maxlength="3000">${esc(old?.description)}</textarea></label><label>Verantwoordelik<select name="assigned_to">${data.users.map(u=>`<option value="${u}" ${u===(old?.assigned_to||task.assigned_to)?'selected':''}>${esc(person(u))}</option>`).join('')}</select></label><label>Sperdatum<input name="due_date" type="date" value="${esc(old?.due_date||task.due_date)}"></label><label>Status<select name="status">${(old?.status==='Complete'?['Complete']:['Pending','In Progress','Scheduled','Waiting']).map(v=>`<option value="${v}" ${old?.status===v?'selected':''}>${label(v)}</option>`).join('')}</select></label>${reminders(old?.reminder_mode)}<details><summary>Vorige stappe en vereistes</summary><label>Waarvoor wag ons?<textarea name="waiting_reason">${esc(old?.waiting_reason)}</textarea></label><fieldset class="dependencies" ${old?.status==='Complete'?'disabled':''}><legend>Voltooi eers hierdie stappe</legend>${steps.filter(s=>s.id!==old?.id).map(s=>`<label><input type="checkbox" name="dependency" value="${esc(s.id)}" ${old?.dependencies?.includes(s.id)?'checked':''}> ${esc(s.description)}</label>`).join('')||'<p>Geen vorige stappe nie.</p>'}</fieldset><label><input type="checkbox" name="required" ${old?.status==='Complete'?'disabled':''} ${old?.required!==false?'checked':''}> Hierdie stap moet klaar wees voordat die taak afgehandel is</label><label><input name="requires_evidence" type="checkbox" ${old?.requires_evidence?'checked':''}> Vra bewys wanneer die stap voltooi word</label></details><label>Notas<textarea name="notes" maxlength="5000">${esc(old?.notes)}</textarea></label><label>Dokumentskakel<input name="document_url" type="url" value="${esc(old?.document_url)}"></label>${documents(old?.attachments)}${createAttachments()}<label>Rede vir die wysiging<textarea name="edit_reason" maxlength="2000" ${old?.status==='Complete'||task.status==='Complete'?'required':''}></textarea></label><p class="help">Om ’n bewys- of stapvereiste te verminder, gee ’n rede.</p>`,'Stoor stap'));
  const f=dialog.querySelector('form'),picker=attach(f,task.id);ctx.setCleanup(()=>picker.dispose());
  f.onsubmit=e=>{e.preventDefault();const raw=new FormData(f);return submit(f,async()=>({task_id:task.id,revision:task.revision,action:old?'step_update':'step_add',step_id:stepId,note:raw.get('edit_reason')||'',files:await picker.prepare(),data:{description:raw.get('description'),assigned_to:raw.get('assigned_to'),due_date:raw.get('due_date'),status:raw.get('status'),reminder_mode:raw.get('reminder_mode'),waiting_reason:raw.get('waiting_reason'),dependencies:old?.status==='Complete'?old.dependencies:raw.getAll('dependency'),required:old?.status==='Complete'?old.required:raw.has('required'),requires_evidence:raw.has('requires_evidence'),notes:raw.get('notes'),document_url:raw.get('document_url')}}));};
 }
 function finish(task,s){
  const dispatch=task.dispatch_step_id===s.id;
  show(base('Merk stap klaar',`${dispatch?'<label>Gestuur per<select name="channel"><option>Email</option><option>WhatsApp</option><option>Other</option></select></label><label>Werklike stuurtyd (Suid-Afrika)<input type="datetime-local" name="sent_at" required></label>':''}<p>${esc(s.description)}</p><label>Nota<textarea name="note" maxlength="3000"></textarea></label><label>Bewysskakel<input name="proof_url" type="url"></label>${createAttachments()}`,'Stoor voltooiing'));
  const f=dialog.querySelector('form'),picker=attach(f,task.id);ctx.setCleanup(()=>picker.dispose());f.onsubmit=e=>{e.preventDefault();const fields=Object.fromEntries(new FormData(f));return submit(f,async()=>({task_id:task.id,revision:task.revision,action:'step_complete',step_id:s.id,...fields,...(dispatch?{sent_at:new Date(fields.sent_at+':00+02:00').toISOString(),po_revision:task.po_revision}:{}),attachments:await picker.upload()}));};
 }
 function note(task,s){
  show(base('Voeg nota by',`<p>${esc(s.description)}</p><label>Nota<textarea name="note" maxlength="3000"></textarea></label>${createAttachments()}`,'Stoor nota'));
  const f=dialog.querySelector('form'),picker=attach(f,task.id);ctx.setCleanup(()=>picker.dispose());f.onsubmit=e=>{e.preventDefault();const text=f.elements.note.value;return submit(f,async()=>({task_id:task.id,revision:task.revision,action:'step_note',step_id:s.id,note:text,files:await picker.prepare()}));};
 }
 function reason(task,action,extra={}){
  const titles={start_workflow:'Maak ’n taak met stappe',step_waive:'Laat stap verval',step_reopen:'Heropen stap',step_delete:'Verwyder stap',approve_workflow:'Keur goed en sluit taak'};
  show(base(titles[action],`${action==='step_delete'?'<p>Die stap word uit die werklys verwyder. Vorige weergawes en dokumente bly in die geskiedenis.</p><label><input type="checkbox" name="confirm" required> Ek bevestig hierdie verwydering</label>':''}${action==='approve_workflow'?'<p>Bevestig dat jy die werk nagegaan het. Die taak skuif daarna na Completed.</p>':''}<label>${action==='approve_workflow'?'Nota (opsioneel)':'Rede'}<textarea name="note" ${action==='approve_workflow'?'':'required'}></textarea></label>${action==='start_workflow'?'<label><input type="checkbox" name="pa_required"> PA moet help met ondersoek, dokumente of opvolging</label>':''}`,'Stoor'));
  const f=dialog.querySelector('form');f.onsubmit=e=>{e.preventDefault();return submit(f,{task_id:task.id,revision:task.revision,action,...extra,note:f.elements.note.value,...(action==='step_delete'?{confirm:f.elements.confirm.checked}:{}),...(action==='start_workflow'?{pa_required:f.elements.pa_required.checked}:{})});};
 }
 function override(task){show(base('Korrigeer taakstatus',`<label>Status<select name="status"><option value="auto">Bereken weer uit die stappe</option><option value="Pending">Doen nou</option><option value="Scheduled">Later</option><option value="Waiting">Wag vir iemand</option></select></label><label>Volgende opvolgdatum<input name="until" type="date"></label><label>Rede<textarea name="note" required></textarea></label>`,'Stoor'));const f=dialog.querySelector('form');f.onsubmit=e=>{e.preventDefault();return submit(f,{task_id:task.id,revision:task.revision,action:'status_override',...Object.fromEntries(new FormData(f))});};}
 function bind(task){
  for(const [attr,fn] of [['edit',step],['delegate',step],['complete',finish],['note',note]])dialog.querySelectorAll('[data-step-'+attr+']').forEach(b=>b.onclick=()=>fn(task,task.steps.find(s=>s.id===b.getAttribute('data-step-'+attr))));
  for(const action of ['reopen','delete','waive'])dialog.querySelectorAll('[data-step-'+action+']').forEach(b=>b.onclick=()=>reason(task,'step_'+action,{step_id:b.getAttribute('data-step-'+action)}));
  dialog.querySelectorAll('[data-step-start]').forEach(b=>b.onclick=()=>{show(base('Begin stap','<p>Merk hierdie stap as In Progress.</p>','Begin'));const f=dialog.querySelector('form');f.onsubmit=e=>{e.preventDefault();return submit(f,{task_id:task.id,revision:task.revision,action:'step_start',step_id:b.dataset.stepStart});};});
  dialog.querySelectorAll('[data-step-move]').forEach(b=>b.onclick=()=>{const ids=task.steps.map(s=>s.id),i=ids.indexOf(b.dataset.stepMove),j=i+Number(b.dataset.direction);[ids[i],ids[j]]=[ids[j],ids[i]];show(base('Herrangskik stappe','<p>Stoor die nuwe volgorde.</p>','Stoor volgorde'));const f=dialog.querySelector('form');f.onsubmit=e=>{e.preventDefault();return submit(f,{task_id:task.id,revision:task.revision,action:'step_reorder',step_ids:ids});};});
  const add=dialog.querySelector('#add-step'),convert=dialog.querySelector('#convert-workflow'),fix=dialog.querySelector('#fix-status'),approve=dialog.querySelector('#approve-workflow');
  if(add)add.onclick=()=>step(task);if(convert)convert.onclick=()=>reason(task,'start_workflow');if(fix)fix.onclick=()=>override(task);if(approve)approve.onclick=()=>{
   const open=task.steps.filter(s=>s.required!==false&&!stepClosed(s));
   if(open.length)show('<h2>Hierdie stappe bly oor</h2><ul>'+open.map(s=>'<li>'+esc(s.description)+' · '+esc(person(s.assigned_to))+'</li>').join('')+'</ul><button data-close>Maak toe</button>');
   else reason(task,'approve_workflow');
  };
 }
 function draft(form,taskId){
  const root=form.querySelector('#new-steps'),list=root.querySelector('[data-draft-list]'),entries=[];
  function add(){
   if(entries.length>=100)return;
   const id=crypto.randomUUID(),box=document.createElement('div');box.className='draft-step';box.dataset.stepId=id;
   const data=getData();box.innerHTML=`<h3>Stap</h3><label>Stapnaam<textarea data-field="description" required maxlength="3000"></textarea></label><label>Delegeer<select data-field="assigned_to">${data.users.map(u=>`<option value="${u}" ${u===form.elements.assigned_to.value?'selected':''}>${esc(person(u))}</option>`).join('')}</select></label><label>Sperdatum<input data-field="due_date" type="date" value="${esc(form.elements.due_date.value)}"></label><label>Status<select data-field="status"><option value="Pending">Nog uitstaande</option><option value="In Progress">Besig</option></select></label>${reminders()}<label>Notas<textarea data-field="notes" maxlength="5000"></textarea></label>${createAttachments().replaceAll('id="','id="'+id+'-')}<button type="button" data-remove-draft>Verwyder stap</button>`;
   const reminder=box.querySelector('[name=reminder_mode]');reminder.removeAttribute('name');reminder.dataset.field='reminder_mode';
   list.append(box);
   const scope={querySelector:selector=>selector==='fieldset'||selector==='.error'?form.querySelector(selector):box.querySelector(selector.startsWith('#')?'[id="'+id+'-'+selector.slice(1)+'"]':selector),querySelectorAll:selector=>box.querySelectorAll(selector)};
   const picker=attach(scope,taskId),entry={id,box,picker};entries.push(entry);
   box.querySelector('[data-remove-draft]').onclick=()=>{picker.dispose();entries.splice(entries.indexOf(entry),1);box.remove();renumber();};renumber();
  }
  function renumber(){entries.forEach((e,i)=>{e.box.querySelector('h3').textContent='Stap '+(i+1);e.box.querySelector('[data-remove-draft]').disabled=entries.length===1;});}
  root.querySelector('[data-add-draft]').onclick=add;
  return {show(active){root.hidden=!active;if(active&&!entries.length)add();for(const {box} of entries)for(const c of box.querySelectorAll('input,textarea,select,button'))c.disabled=!active;renumber();},async prepare(){const steps=[];for(const e of entries){const values=Object.fromEntries([...e.box.querySelectorAll('[data-field]')].map(c=>[c.dataset.field,c.value]));steps.push({id:e.id,...values,files:await e.picker.prepare()});}return steps;},dispose(){entries.forEach(e=>e.picker.dispose());}};
 }
 return {bind,step,finish,draft};
}
