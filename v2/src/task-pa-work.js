import {check} from './domain.js';

export const addressedToPa = value => /^\s*(?:@pa\b|pa\s*[-–—,:]|pa\s+(?:bereken|doen|maak|skryf|soek|verifieer|ondersoek|gee|calculate|prepare)\b)/iu.test(value || '');
export const unfinishedWork = task => (task.pa_work || []).some(job => job.status !== 'answered');

function register(task, id, instruction, actor, at) {
  task.pa_work ||= [];
  if (task.pa_work.some(job => job.id === id)) return;
  check(typeof instruction === 'string' && instruction.trim() && instruction.length <= 5000, 'Vul jou opdrag aan PA in.');
  task.pa_work.push({id, instruction:instruction.trim(), actor, asked_at:at, updated_at:at, status:'queued'});
}
export function registerTaskText(task, b, user, at) {
  const fields = b.action === 'note' || b.action === 'respond' ? [b.note] : [b.data?.title, b.data?.details];
  const instruction = fields.filter(addressedToPa).join('\n');
  if (instruction) register(task, b.request_id, instruction, user.username, at);
}
export async function changePaWork(task, b, user, db, at, files, secureUrl) {
  check(!['Complete','Cancelled'].includes(task.status), 'Heropen eers die taak.');
  if (b.action === 'pa_request') return register(task, b.request_id, b.note, user.username, at);
  if (b.action === 'pa_recover') {
    check(user.via === 'pa' && user.username === 'alex', 'Net PA kan ’n vroeëre opdrag herstel.', 403);
    const row = await db.prepare('SELECT request_id,action,actor,saved_at,payload FROM v2_task_events WHERE task_id=? AND revision=?').bind(task.id,b.source_revision).first();
    const note = row && JSON.parse(row.payload).last_update;
    check(row?.action === 'note' && note?.at === row.saved_at && addressedToPa(note.text), 'Kies die oorspronklike PA-nota.');
    return register(task, row.request_id, note.text, row.actor, row.saved_at);
  }
  const job = task.pa_work?.find(job => job.id === b.work_id);
  check(job, 'Die opdrag is nie op hierdie taak gevind nie.', 404);
  if (b.action === 'pa_resume') {
    check(user.username === job.actor, 'Die oorspronklike aanvrager moet antwoord.', 403);
    check(['approval','blocked'].includes(job.status), 'Hierdie opdrag wag nie vir jou antwoord nie.', 409);
    check(typeof b.note === 'string' && b.note.trim() && b.note.length<=2000, 'Gee die ontbrekende inligting of besluit.');
    (job.followups ||= []).push({text:b.note.trim(), by:user.username, at});
    job.status='queued'; job.updated_at=at; return;
  }
  check(user.via === 'pa' && user.username === 'alex', 'Net die PA-koppeling kan hierdie antwoord stoor.', 403);
  if (b.action === 'pa_claim') {
    check(job.status === 'queued' || (job.status === 'working' && job.lease_until <= at), 'Hierdie opdrag word reeds hanteer of het ’n antwoord.', 409);
    job.status='working'; job.claim_id=b.request_id; job.updated_at=at;
    job.lease_until=new Date(Date.parse(at)+3600000).toISOString();
    return;
  }
  check(b.action === 'pa_result' && job.status === 'working' && job.claim_id === b.claim_id && job.lease_until > at, 'Lees die huidige opdrag en neem dit weer in werk.', 409);
  check(['answered','approval','blocked'].includes(b.status), 'Kies die uitkoms van die opdrag.');
  check(typeof b.answer === 'string' && b.answer.trim() && b.answer.length<=16000, 'Gee die werklike antwoord of verduidelik wat kort.');
  check(typeof b.next_action === 'string' && b.next_action.trim() && b.next_action.length<=2000, 'Gee die volgende stap.');
  check(Array.isArray(b.links || []) && (b.links || []).length<=8, 'Gebruik hoogstens agt dokumentskakels.');
  const links=(b.links || []).map(l=>{
    check(l && typeof l.label==='string' && l.label.trim() && l.label.length<=120 && l.url, 'Gee die dokument se naam en skakel.');
    return {label:l.label.trim(),url:secureUrl(l.url)};
  });
  const entry={at,status:b.status,answer:b.answer.trim(),next_action:b.next_action.trim(),links,files:files.map(f=>({id:f.id,name:f.filename}))};
  (job.results ||= []).push(entry);
  job.updated_at=at; job.status=b.status;
  delete job.claim_id; delete job.lease_until;
}

// Query the current task events. A sync acknowledgement never removes unfinished work.
export async function workPage(db, {offset=0, since=null, report=false}={}) {
  check(Number.isSafeInteger(offset) && offset>=0 && offset<=100000, 'Ongeldige bladsy.');
  const at=new Date().toISOString();
  const filter=report ? "json_extract(j.value,'$.updated_at')>=?" :
    "(json_extract(j.value,'$.status')='queued' OR (json_extract(j.value,'$.status')='working' AND json_extract(j.value,'$.lease_until')<=?))";
  const rows=await db.prepare(`SELECT e.task_id,e.revision,json_extract(e.payload,'$.title') title,j.value job
    FROM v2_task_heads h JOIN v2_task_events e ON e.task_id=h.task_id AND e.revision=h.revision JOIN json_each(e.payload,'$.pa_work') j
    WHERE ${report?'1':"json_extract(e.payload,'$.status') NOT IN ('Complete','Cancelled')"} AND ${report?'1':"(COALESCE(json_extract(e.payload,'$.pa_does_work'),0)=0 OR COALESCE(NULLIF(json_extract(e.payload,'$.due_date'),''),json_extract(e.payload,'$.review_date'),'')<=date('now','+2 hours'))"} AND ${filter}
    ORDER BY json_extract(j.value,'$.updated_at'),e.task_id,j.key LIMIT 51 OFFSET ?`).bind(report?(since || '1970-01-01'):at,offset).all();
  return {items:rows.results.slice(0,50).map(({job,...r})=>({...r,work:JSON.parse(job)})),next_offset:rows.results.length>50?offset+50:null};
}
