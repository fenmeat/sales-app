const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const workLabel=status=>({queued:'Opdrag ontvang',working:'PA is besig',answered:'PA se antwoord is gereed',approval:'Jou goedkeuring is nodig',blocked:'PA wag vir inligting'}[status]||'');
export const noticeLabel=kind=>({pa_result:'PA se antwoord is gereed',pa_action:'PA het geantwoord · Jou inset is nodig'}[kind]||kind);
export function workHTML(task,user){
 return (task.pa_work||[]).map(job=>`<section class="notice"><h3>${esc(workLabel(job.status))}</h3><strong>Opdrag aan PA</strong><p class="pa-prose">${esc(job.instruction)}</p>
 ${(job.followups||[]).map(f=>`<p class="pa-prose">${esc(f.by)} · ${esc(f.text)}</p>`).join('')}
 ${(job.results||[]).map(result=>`<strong>PA se antwoord</strong><p class="pa-prose">${esc(result.answer)}</p><p><strong>Volgende stap</strong> · ${esc(result.next_action)}</p>
 ${result.files.map(f=>`<p><a href="/api/tasks/file?id=${encodeURIComponent(f.id)}" target="_blank" rel="noopener">${esc(f.name)}</a></p>`).join('')}
 ${result.links.map(l=>`<p><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></p>`).join('')}`).join('')}
 ${['approval','blocked'].includes(job.status)&&job.actor===user&&!['Complete','Cancelled'].includes(task.status)?`<button data-pa-resume="${esc(job.id)}">Gee jou antwoord</button>`:''}</section>`).join('');
}
