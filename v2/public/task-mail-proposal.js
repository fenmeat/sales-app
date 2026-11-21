const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phases = {draft:'Konsep',approval:'Wag op jou goedkeuring',approved:'Goedgekeur · wag vir PA se uurlikse versending',processing:'PA wag vir Gmail se bevestiging',failed:'Gmail het die versending nog nie bevestig nie',cancelled:'Gekanselleer',sent:'Gestuur',reply:'Antwoord ontvang'};
const actions = {draft:'Konsep gestoor',edit:'E-pos gewysig',submit:'Gereed vir hersiening',cancel:'Versending gekanselleer',approve:'Goedgekeur deur Alex',adopt:'Goedgekeur deur Alex',claim:'Versending begin',bind_draft:'Gmail-konsep gekoppel',gmail_unavailable:'Gmail onbeskikbaar',sent:'Versending bevestig',observe_sent:'Versending bevestig',failed:'Gmail het nog nie bevestig nie',reply:'Antwoord ontvang',review:'Opvolging bygewerk'};
const localTime = date => new Date(date).toLocaleString('af-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'});
const splitAddresses = value => value.split(/[,;\n]/).map(a=>a.trim()).filter(Boolean);
const button = (id,label,primary=false) => '<button type="button" data-mail="'+id+'"'+(primary?' class="primary"':'')+'>'+label+'</button>';

export function mountProposal(host,key,api,onChange=()=>{}){
 const endpoint='/api/pa-report/email',url=endpoint+'?subject_key='+encodeURIComponent(key);
 let record,mode='read',pending=false,sequence=0,attempt=null,timer;
 const field=name=>host.querySelector('[data-field="'+name+'"]');
 const active=()=>host.isConnected&&host.closest('dialog')?.open!==false;
 function status(message){const el=host.querySelector('[role="alert"]');if(el)el.textContent=message;}
 function bind(id,fn){const el=host.querySelector('[data-mail="'+id+'"]');if(el)el.onclick=fn;}
 async function refresh(revision){
  const generation=++sequence;clearTimeout(timer);
  try{
   const next=await api(url+(revision?'&revision='+encodeURIComponent(revision):''));
   if(generation!==sequence||!active())return;
   if(!next.email){host.hidden=true;host.replaceChildren();return;}
   record=next;mode=revision?'history':'read';attempt=null;draw();
  }catch(e){
   if(generation!==sequence||!active())return;
   host.hidden=false;host.innerHTML='<h3>E-posvoorstel</h3><p role="alert">Die voorstel kon nie laai nie. '+esc(e.message)+'</p>'+button('reload','Probeer weer');
   bind('reload',()=>refresh());
  }
 }
 function draw(){
  clearTimeout(timer);host.hidden=false;
  const {email:m,review_html:html,history,available_actions}=record,d=m.envelope;
  const edit=mode==='edit',confirm=mode==='confirm',archived=mode==='history',editable=available_actions.includes('edit')&&!archived;
  const addressLine=(label,value)=>'<dt>'+label+'</dt><dd>'+esc(value||'Geen')+'</dd>';
  const input=(label,id,value)=>'<label>'+label+'<input data-field="'+id+'" type="text" value="'+esc(value)+'"></label>';
  const preview=html?'<iframe sandbox="" title="HTML-e-posvoorvertoning"></iframe>'+(d.body?'<details><summary>Gewone teks</summary><div class="pa-prose">'+esc(d.body)+'</div></details>':''):'<div class="mail-plain">'+esc(d.body)+'</div>';
  const editing=html?'<label>Inhoud</label><div data-field="rich" contenteditable="true" role="textbox" aria-label="E-posinhoud" aria-multiline="true"></div><details><summary>Gewone teks wysig</summary><textarea aria-label="Gewone teks" data-field="body">'+esc(d.body)+'</textarea></details>':'<label>Inhoud<textarea data-field="body">'+esc(d.body)+'</textarea></label>';
  host.innerHTML='<h3>E-posvoorstel</h3><p class="mail-state" role="status">'+esc(m.failure||phases[m.phase]||m.phase)+(archived?' · Vorige weergawe':'')+'</p>'+
   (edit?'<dl>'+addressLine('Van',d.from)+'</dl>'+input('Aan','to',d.to.join(', '))+input('Cc','cc',d.cc.join(', '))+input('Bcc','bcc',d.bcc.join(', '))+input('Onderwerp','subject',d.subject)+editing:
    '<dl>'+addressLine('Van',d.from)+addressLine('Aan',d.to.join(', '))+addressLine('Cc',d.cc.join(', '))+addressLine('Bcc',d.bcc.join(', '))+addressLine('Onderwerp',d.subject)+'</dl>'+preview)+
   '<p><strong>Bylaes</strong> '+(d.attachments?.length?d.attachments.map(f=>'<a href="'+(f.source==='task'?'/api/tasks/file':'/api/pa-report/file')+'?id='+encodeURIComponent(f.id)+'" target="_blank" rel="noopener">'+esc(f.filename)+'</a>').join(', '):'Geen')+'</p>'+
   (m.message_id?'<p>Gmail het versending bevestig op '+esc(localTime(m.sent_at))+' SAST. Boodskap-ID <code>'+esc(m.message_id)+'</code>.</p>':'')+
   (confirm?'<p class="notice">Bevestig jy dat PA hierdie e-pos aan die ontvangers hierbo mag stuur?</p>':'')+
   '<div class="actions">'+(archived?button('reload','Terug na jongste voorstel'):edit?button('save','Stoor wysigings',true)+button('back','Los wysigings'):confirm?button('send','Ja, stuur hierdie e-pos',true)+button('back','Terug na voorstel'):editable?button('edit','Wysig e-pos')+(m.phase==='approved'?'':button('confirm','Goedkeur en stuur',true))+button('cancel','Moenie stuur nie'):'')+'</div><p role="alert" class="error"></p>'+
   (!edit&&!confirm&&!archived?'<details><summary>E-posgeskiedenis</summary>'+history.map(h=>'<p><button type="button" data-revision="'+h.revision+'">'+esc(actions[h.event]||h.event)+' · '+esc(localTime(h.saved_at))+'</button></p>').join('')+'</details>':'');
  const frame=host.querySelector('iframe');
  if(frame)frame.srcdoc='<meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>body{margin:10px;font:16px/1.5 Arial,sans-serif;overflow-wrap:anywhere;color:#20262b}table{max-width:100%}a{pointer-events:none}</style>'+html;
  const rich=field('rich');
  if(rich){
   rich.innerHTML=html;
   rich.oninput=()=>{rich.dataset.changed='1';field('body').value=rich.innerText.trim();};
   rich.onpaste=e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));};
   rich.ondrop=e=>e.preventDefault();
   rich.onclick=e=>{if(e.target.closest('a'))e.preventDefault();};
  }
  bind('edit',()=>{mode='edit';draw();field('to').focus();});
  bind('back',()=>{mode='read';draw();});
  bind('confirm',()=>{mode='confirm';draw();host.querySelector('[data-mail="send"]').focus();});
  bind('send',()=>save('approve',{}));
  bind('cancel',()=>save('cancel',{}));
  bind('save',()=>{
   const changes={subject:field('subject').value,body:field('body').value};
   for(const k of ['to','cc','bcc'])changes[k]=splitAddresses(field(k).value);
   if(rich?.dataset.changed)changes.html=rich.innerHTML;
   return save('edit',{changes});
  });
  bind('reload',()=>refresh());
  host.querySelectorAll('[data-revision]').forEach(el=>el.onclick=()=>refresh(el.dataset.revision));
  if(mode==='read'&&['approved','processing','failed'].includes(m.phase))timer=setTimeout(()=>{if(active())refresh();},30000);
 }
 async function save(action,details){
  if(pending)return;
  const m=record.email,body={action,subject_key:key,revision:m.revision,data:{...details,envelope_hash:m.envelope_hash}};
  const signature=JSON.stringify(body);
  if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};
  pending=true;host.querySelectorAll('button').forEach(el=>el.disabled=true);
  try{
   await api(endpoint,{...body,request_id:attempt.id});
   await refresh();await onChange();
  }catch(e){
   status(e.status===409?'Die voorstel het verander. Lees die jongste weergawe. Jou wysigings bly hier totdat jy dit herlaai.':e.message||'Die verbinding is onderbreek. Probeer weer.');
   if(e.status===409){const reload=document.createElement('button');reload.type='button';reload.textContent='Laai jongste voorstel';reload.onclick=()=>refresh();host.querySelector('[role="alert"]').append(' ',reload);}
  }finally{pending=false;host.querySelectorAll('button').forEach(el=>el.disabled=false);}
 }
 refresh();
 return {refresh:()=>{if(mode==='read'&&!pending)return refresh();}};
}
