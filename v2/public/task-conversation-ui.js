const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name=u=>u==='pa'?'PA':u?u[0].toUpperCase()+u.slice(1):'Naam onbekend';
const safeURL=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
function inline(text){
 const tokens=[],put=html=>{tokens.push(html);return '\u0000'+(tokens.length-1)+'\u0000';};
 let s=String(text).replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|https:\/\/[^\s<>]+/g,(match,label,url)=>{const target=safeURL(url||match.replace(/[.,;]+$/,''));return target?put('<a href="'+esc(target)+'" target="_blank" rel="noopener noreferrer">'+esc(label||target)+'</a>'):match;});
 s=esc(s).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`\n]+)`/g,'<code>$1</code>');
 return s.replace(/\u0000(\d+)\u0000/g,(_,i)=>tokens[i]||'');
}
export function messageMarkdown(text){
 let html='',list='';const close=()=>{if(list){html+='</'+list+'>';list='';}};
 for(const line of String(text||'').split('\n')){
  const item=/^\s*(?:[-*•]|\d+\.)\s+(.+)$/.exec(line),heading=/^#{1,6}\s+(.+)$/.exec(line);
  if(item){const tag=/^\s*\d+\./.test(line)?'ol':'ul';if(list!==tag){close();list=tag;html+='<'+tag+'>';}html+='<li>'+inline(item[1])+'</li>';}
  else{close();html+=heading?'<h4>'+inline(heading[1])+'</h4>':line.trim()?'<p>'+inline(line)+'</p>':'<div class="message-space"></div>';}
 }close();return html;
}
export function messageHTML(m){
 const when=m.at?new Date(m.at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'})+' SAST':'Datum en tyd onbekend';
 return `<article class="task-message ${m.role==='pa'?'from-pa':m.role==='history'?'from-history':'from-user'}" data-message="${esc(m.id)}"><div class="message-meta"><strong>${esc(m.role==='history'?'Oorspronklike geskiedenis':name(m.actor))}</strong><time>${esc(when)}</time></div>${m.review_required?'<p class="message-review">Moet hersien word: deelnemers of boodskapgrense kon nie betroubaar bepaal word nie.</p>':''}<div class="message-body">${messageMarkdown(m.text)}</div>${m.next_action?'<p><strong>Volgende stap:</strong> '+inline(m.next_action)+'</p>':''}${(m.links||[]).filter(l=>safeURL(l.url)).map(l=>'<p><a href="'+esc(safeURL(l.url))+'" target="_blank" rel="noopener noreferrer">'+esc(l.label)+'</a></p>').join('')}${(m.files||[]).map(f=>'<p><a href="/api/'+(f.report?'pa-report':'tasks')+'/file?id='+encodeURIComponent(f.id)+'" target="_blank" rel="noopener">'+esc(f.name||'Dokument')+'</a></p>').join('')}</article>`;
}
export function conversationShell(attachments=''){return `<details id="task-conversation" class="task-conversation"><summary>Gesprek met PA</summary><div class="conversation-toolbar"><button type="button" data-older hidden>Laai ouer boodskappe</button><button type="button" data-refresh>Verfris gesprek</button></div><div class="conversation-messages" role="log" aria-label="Gesprek met PA" aria-live="polite"></div><p data-conversation-status role="status"></p><form class="conversation-compose"><fieldset><label>Jou boodskap aan PA<textarea name="note" maxlength="5000" rows="3" required placeholder="Skryf jou vraag of opdrag…"></textarea></label><p class="error" role="alert"></p>${attachments}<button type="submit" class="primary">Stuur</button><p class="help">PA antwoord met die bestaande uurlikse verwerking. Nuwe antwoorde verskyn wanneer jy verfris.</p></fieldset></form></details>`;}
export function mountConversation(root,{task,user,api,drafts,attachmentPicker,fileData}){
 let disposed=false,loaded=false,loading=false,sending=false,cursor=null,pending=[],attempt=null;
 const box=root.querySelector('.conversation-messages'),form=root.querySelector('form'),input=form.querySelector('[name=note]'),status=root.querySelector('[data-conversation-status]'),older=root.querySelector('[data-older]'),refresh=root.querySelector('[data-refresh]'),key='fenmeat-pa-draft:'+user+':conversation:'+task.id;
 const picker=attachmentPicker?.(form,{taskId:task.id,api,prepareFile:fileData});
 try{const saved=JSON.parse(drafts.getItem(key)||'null');if(saved){input.value=saved.text||'';attempt=saved.attempt;}}catch{}
 const remember=()=>{try{drafts.setItem(key,JSON.stringify({text:input.value,attempt}));}catch{}};
 input.oninput=()=>{if(attempt&&attempt.note!==input.value)attempt=null;remember();};
 if(['Complete','Cancelled'].includes(task.status)){input.disabled=true;form.querySelector('[type=submit]').disabled=true;status.textContent='Die taak is gesluit. Heropen dit om verder te gesels.';}
 async function load(more=false){
  if(loading||disposed)return;loading=true;refresh.disabled=true;older.disabled=true;
  try{const page=await api('/api/tasks/conversation?id='+encodeURIComponent(task.id)+(more&&cursor?'&before='+encodeURIComponent(cursor):''));if(disposed)return;
   const height=box.scrollHeight,top=box.scrollTop;box.insertAdjacentHTML(more?'afterbegin':'beforeend','');
   if(!more)box.innerHTML='';box.insertAdjacentHTML(more?'afterbegin':'beforeend',page.messages.map(messageHTML).join(''));
   cursor=page.next_before;older.hidden=!cursor;pending=page.pending;task.revision=page.revision;loaded=true;
   if(!input.disabled)status.textContent=page.review_required?'Van die ou geskiedenis moet nog hersien word.':pending.length?'Jou boodskap is ontvang. PA se werk is nog oop.':page.messages.length?'':'Geen boodskappe op hierdie taak nie.';
   box.scrollTop=more?top+box.scrollHeight-height:box.scrollHeight;
  }catch(e){if(!disposed)status.textContent=e.message;}finally{loading=false;if(!disposed){refresh.disabled=false;older.disabled=false;}}
 }
 root.ontoggle=()=>{if(root.open&&!loaded)load();};older.onclick=()=>load(true);refresh.onclick=()=>load();
 form.onsubmit=async e=>{
  e.preventDefault();if(sending||!input.value.trim())return;sending=true;form.querySelector('fieldset').disabled=true;
  const note=input.value;
  try{
   if(!attempt){const fresh=await api('/api/tasks?id='+encodeURIComponent(task.id)+'&brief=1');if(disposed)return;task=fresh.task;
    const waiting=(task.pa_work||[]).filter(j=>j.actor===user&&['approval','blocked'].includes(j.status));
    const files=await picker?.prepare()||[];
    attempt={...(files.length?{files}:{}),task_id:task.id,revision:task.revision,request_id:crypto.randomUUID(),action:waiting.length===1?'pa_resume':'pa_request',...(waiting.length===1?{work_id:waiting[0].id}:{}),note};remember();}
   const result=await api('/api/tasks',attempt);if(disposed)return;task=result.task;attempt=null;picker?.clear();input.value='';drafts.removeItem(key);form.removeAttribute('data-unsaved');await load();status.textContent='Boodskap gestoor. PA sal antwoord ná verwerking.';
  }catch(e){if(!disposed){status.textContent=e.message;if(e.status===409){attempt=null;remember();}else remember();}}
  finally{sending=false;if(!disposed)form.querySelector('fieldset').disabled=false;}
 };
 return ()=>{disposed=true;root.ontoggle=null;picker?.dispose();};
}
