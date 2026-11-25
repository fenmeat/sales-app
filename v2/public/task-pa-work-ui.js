const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const workLabel=status=>({queued:'Opdrag ontvang',working:'PA is besig',answered:'PA se antwoord is gereed',approval:'Jou goedkeuring is nodig',blocked:'PA wag vir inligting'}[status]||'');
export const noticeLabel=kind=>({step_assigned:'Stap aan jou gedelegeer',step_completed:'Stap voltooi',step_update:'Stap bygewerk',step_due:'Stap vandag verskuldig',step_overdue:'Stap agterstallig',assigned:'Taak gedelegeer',completed:'Taak afgehandel',pa_result:'PA se antwoord is gereed',pa_action:'PA het geantwoord · Jou inset is nodig'}[kind]||kind);
export const currentWorkStatus=job=>job.status==='working'&&job.lease_until&&Date.parse(job.lease_until)<=Date.now()?'queued':job.status;
export function workHTML(task,user,visibleAnswer){
 const jobs=task.pa_work||[];
 const latest=[...jobs].sort((a,b)=>(b.updated_at||b.asked_at||'').localeCompare(a.updated_at||a.asked_at||''))[0];
 return jobs.map(job=>{const archived=job!==latest&&job.status==='answered';return `${archived?'<details><summary>Vorige PA-gesprek</summary>':''}<section class="notice"><h3>${esc(workLabel(currentWorkStatus(job)))}</h3><strong>Opdrag aan PA</strong><p class="pa-prose">${esc(job.instruction)}</p>
 ${(job.followups||[]).map(f=>`<p class="pa-prose">${esc(f.by)} · ${esc(f.text)}</p>`).join('')}
 ${(job.results||[]).map((result,i,all)=>`${i<all.length-1?'<details><summary>Vorige antwoord en dokumente</summary>':''}${result.answer===visibleAnswer?'':'<strong>PA se antwoord</strong><p class="pa-prose">'+esc(result.answer)+'</p>'}<p><strong>Volgende stap</strong> · ${esc(result.next_action)}</p>
 ${result.files.map(f=>`<p><a href="/api/tasks/file?id=${encodeURIComponent(f.id)}" target="_blank" rel="noopener">${esc(f.name)}</a></p>`).join('')}
 ${result.links.map(l=>`<p><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></p>`).join('')}${i<all.length-1?'</details>':''}`).join('')}
 ${['approval','blocked'].includes(job.status)&&job.actor===user&&!['Complete','Cancelled'].includes(task.status)?`<button data-pa-resume="${esc(job.id)}">Gee jou antwoord</button>`:''}</section>${archived?'</details>':''}`;}).join('');
}
