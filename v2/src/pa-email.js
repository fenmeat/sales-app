import {originalFileBytes} from './task-files.js';
import {check,dateKey,today} from './domain.js';
import {cleanMailHtml} from './mail-html-bundle.js';
import {hash} from './auth.js';

// One immutable revision per action. A thread may be shared, but an individual
// Gmail message can be attributed only once. The task and its history stay intact.
export const EMAIL_SCHEMA = [
 `CREATE TABLE IF NOT EXISTS v2_pa_followup_mail (
 subject_key TEXT NOT NULL, revision INTEGER NOT NULL, request_id TEXT UNIQUE NOT NULL,
 fingerprint TEXT NOT NULL, event TEXT NOT NULL, gmail_id TEXT UNIQUE, dispatch_key TEXT UNIQUE,
 payload TEXT NOT NULL, summary TEXT NOT NULL, saved_at TEXT NOT NULL,
 PRIMARY KEY(subject_key,revision))`,
 `CREATE TABLE IF NOT EXISTS v2_pa_mail_checks(subject_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, checked_at TEXT, check_after TEXT NOT NULL)`
];
const latestRows = `SELECT m.* FROM v2_pa_followup_mail m WHERE m.revision=
 (SELECT MAX(n.revision) FROM v2_pa_followup_mail n WHERE n.subject_key=m.subject_key)`;
const gmailId = v => typeof v==='string' && /^[0-9a-f]{8,40}$/.test(v);
const address = v => typeof v==='string' && v.length<=254 && !/[\x00-\x1f\x7f]/.test(v) && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(v);
function string(v,max) {
 check(typeof v==='string' && v.trim().length>0 && v.length<=max,'Vul die e-posbesonderhede in.');
 return v;
}
async function envelope(db,key,d,observed=false) {
 check(d && address(d.from) && Array.isArray(d.to) && d.to.length>0,'Bevestig die afsender en ontvanger.');
 const lists=[d.to,d.cc??[],d.bcc??[]];
 check(lists.every(a=>Array.isArray(a)&&a.length<=25&&a.every(address)),'Bevestig die e-posadresse.');
 check(!/[\x00-\x1f\x7f]/.test(d.subject) && (!d.thread_id||gmailId(d.thread_id)) && (!d.parent_id||gmailId(d.parent_id)) && Boolean(d.thread_id)===Boolean(d.parent_id),'Bevestig die onderwerp en gesprek.');
 const refs=d.attachments??[];
 check(Array.isArray(refs)&&refs.length<=12,'Kies hoogstens 12 bylaes.');
 const attachments=[];
 for(const ref of refs){
  const id=typeof ref==='string'?ref:ref?.id;
  check(/^[a-zA-Z0-9-]{8,90}$/.test(id||'')&&!attachments.some(f=>f.id===id),'Kies ’n geldige bylaag.');
  const owned=await db.prepare('SELECT filename,mime_type,bytes FROM v2_pa_report_files WHERE id=? AND subject_key IN (?,?)').bind(id,'private-mail:'+key,key).first();
  let file=owned,source='report';
  if(!file&&key.startsWith('app-')){
   file=await db.prepare('SELECT id,filename,mime_type,bytes FROM v2_task_attachments WHERE task_id=? AND id=?').bind(key.slice(4),id).first();
   source='task';
  }
  check(file,'Die bylaag behoort nie aan hierdie taak nie.');
  const bytes=source==='task'?await originalFileBytes(db,file):new Uint8Array(file.bytes);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  attachments.push({id,source,filename:file.filename,mime_type:file.mime_type,size:bytes.length,sha256});
 }
 const rawHtml=d.html?string(d.html,64000):'';
 const html=observed?rawHtml:cleanMailHtml(rawHtml);
 check(!d.html||html.trim(),'Die HTML-inhoud is leeg ná skoonmaak.');
 check(html||d.body?.trim(),'Vul die e-posinhoud in.');
 return {from:d.from,to:d.to,cc:lists[1],bcc:lists[2],subject:string(d.subject,900),body:d.body?string(d.body,32000):'',
  html,scope:string(d.scope,2000),thread_id:d.thread_id||'',parent_id:d.parent_id||'',...(attachments.length?{attachments}:{})};
}
function approvalPreview(e,digest) {
 return ['Van: '+e.from,'Aan: '+e.to.join(', '),'Cc: '+(e.cc.join(', ')||'Geen'),'Bcc: '+(e.bcc.join(', ')||'Geen'),
  'Onderwerp: '+e.subject,'Doel: '+e.scope,e.attachments?.length?'Bylaes: '+e.attachments.map(f=>f.filename).join(', '):'Geen aanhegsels.',e.body,'Konsepverwysing '+digest].join('\n');
}
const directConsent = s => /^(?:(?:ja|dis reg|yes)[,!. ]+)?(?:stuur (?:dit|die e-pos|die email|e-pos|email)|send (?:it|the email))[.! ]*$/i.test(String(s).trim());
async function approvalPair(db,key,data){
 const proof=await db.prepare(`SELECT f.actor,f.subject_key,f.payload,f.created_at,p.subject_key proposal_key,p.payload proposal_payload,a.payload answer,a.created_at answered_at
 FROM v2_pa_report_feedback f JOIN v2_pa_report_feedback p ON p.id=json_extract(f.payload,'$.reply_to')
 JOIN v2_pa_report_answers a ON a.feedback_id=p.id WHERE f.id=? AND p.id=?`).bind(data.approval_feedback_id,data.proposal_feedback_id).first();
 // A private report item can display several tasks. Only a single explicit
 // task link may carry consent across the report and task screens.
 const belongs=(subject,payload)=>subject===key || (subject?.startsWith('report-') &&
  JSON.stringify(JSON.parse(payload).source_task_ids)===JSON.stringify([key]));
 check(proof?.actor==='alex'&&belongs(proof.subject_key,proof.payload)&&belongs(proof.proposal_key,proof.proposal_payload)&&proof.created_at>=proof.answered_at&&directConsent(JSON.parse(proof.payload).note),'Lees Alex se oorspronklike stuurinstruksie en die presiese konsep.',409);
 return proof;
}
function instant(v) {
 check(typeof v==='string' && /T.*(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) && Date.parse(v)<=Date.now()+60000,'Bevestig die tyd in Gmail.');
 return new Date(v).toISOString();
}
function evidence(m,d) {
 check(d && gmailId(d.message_id) && gmailId(d.thread_id) && (!m.envelope.thread_id||d.thread_id===m.envelope.thread_id)
 && d.envelope_hash===m.envelope_hash && d.labels?.includes('SENT') && !d.labels.includes('DRAFT'),'Lees die presiese gestuurde e-pos in Gmail terug.');
 return {message_id:d.message_id,thread_id:d.thread_id,sent_at:instant(d.sent_at),rfc_id:string(d.rfc_id,400)};
}
function compact(m) {
 const {phase,review_date,next_action,message_id,thread_id,sent_at,reply_id,reply_at,revision,envelope_hash,checked_at,check_after}=m;
 return {phase,review_date,next_action,message_id,thread_id,sent_at,reply_id,reply_at,revision,envelope_hash,checked_at,check_after,recipient:m.envelope.to.join(', '),...(m.failure?{failure:m.failure}:{})};
}
export async function mailSummaries(db) {
 const q=latestRows.replace('SELECT m.*','SELECT m.subject_key,m.summary');
 const {results}=await db.prepare(q).all();
 return new Map(results.map(r=>[r.subject_key,JSON.parse(r.summary)]));
}
export function projectMail(row,m,day=today()) {
 if(!m)return row;
 const closed=['Complete','Archived','Cancelled'].includes(row.status);
 const waiting=m.phase==='sent',due=waiting && m.review_date<=day;
 const phase=closed?'completed':due?'due':m.phase;
 const labels={draft:'Konsep gereed.',approval:'Wag op jou goedkeuring.',approved:'Goedgekeur. Die opvolg-e-pos is nog nie as gestuur bevestig nie.',
  processing:'PA kontroleer of die e-pos gestuur is.',failed:m.failure||'Gmail het die versending nog nie bevestig nie.',cancelled:'Gekanselleer. Die e-pos is nie gestuur nie.',
  sent:m.reply_at?'Antwoord ontvang. Wag op verdere terugvoer.':'E-pos gestuur. Wag op antwoord.',due:'Die opvolgdatum het aangebreek.',reply:'Antwoord ontvang. PA moet die uitkoms nagaan.',completed:'Taak afgehandel.'};
 const email={...m,phase,label:m.failure||labels[phase]};
 return {...row,email,status:closed||m.phase==='cancelled'?row.status:waiting&&!due?'Scheduled':'Pending',review_date:closed?row.review_date:m.review_date,next_action:closed?row.next_action:m.next_action};
}
export async function mailWork(db,offset=0) {
 offset=Number(offset);check(Number.isSafeInteger(offset)&&offset>=0,'Kies ’n geldige bladsy.');
 const work=latestRows.replace('SELECT m.*','SELECT m.subject_key,m.summary,c.checked_at,c.check_after').replace(' WHERE m.revision=', ' LEFT JOIN v2_pa_mail_checks c ON c.subject_key=m.subject_key AND c.revision=m.revision WHERE m.revision=');
 const {results}=await db.prepare(work+` AND json_extract(m.summary,'$.phase') IN ('approved','processing','failed','sent','reply')
 AND COALESCE(c.check_after,'') <= ? AND (json_extract(m.summary,'$.phase') IN ('processing','failed') OR EXISTS (SELECT 1 FROM json_each((SELECT payload FROM v2_pa_report_versions WHERE resource_key='register' ORDER BY revision DESC LIMIT 1),'$.rows') r WHERE json_extract(r.value,'$.id')=m.subject_key AND json_extract(r.value,'$.status') IN ('Waiting','Pending','Scheduled')) OR EXISTS (SELECT 1 FROM v2_task_events t WHERE 'app-'||t.task_id=m.subject_key AND t.revision=(SELECT MAX(revision) FROM v2_task_events WHERE task_id=t.task_id) AND json_extract(t.payload,'$.status') IN ('Waiting','Pending','Scheduled')))
 ORDER BY m.subject_key LIMIT 26 OFFSET ?`).bind(new Date().toISOString(),offset).all();
 return {items:results.slice(0,25).map(r=>({id:r.subject_key,...JSON.parse(r.summary),checked_at:r.checked_at,check_after:r.check_after})),next_offset:results.length>25?offset+25:null};
}
export async function readMail(db,key) {
 const r=await db.prepare('SELECT payload FROM v2_pa_followup_mail WHERE subject_key=? ORDER BY revision DESC LIMIT 1').bind(key).first();
 return r?JSON.parse(r.payload):null;
}
export function mailActions(m,open){
 if(!open||!m)return [];
 return ['draft','approval'].includes(m.phase)?['edit','approve','cancel']:m.phase==='approved'?['edit','cancel']:[];
}
export async function mailReview(db,key,open,revision){
 let email;
 if(revision){
  check(/^\d{1,9}$/.test(revision),'Kies ’n geldige wysiging.');
  const row=await db.prepare('SELECT payload FROM v2_pa_followup_mail WHERE subject_key=? AND revision=?').bind(key,Number(revision)).first();
  check(row,'Hierdie wysiging bestaan nie.',404);email=JSON.parse(row.payload);open=false;
 }else email=await readMail(db,key);
 if(!email)return {email:null};
 const {results}=await db.prepare('SELECT event,revision,saved_at FROM v2_pa_followup_mail WHERE subject_key=? ORDER BY revision DESC').bind(key).all();
 return {email,review_html:cleanMailHtml(email.envelope.html),open,available_actions:mailActions(email,open),history:results};
}
export async function changeMail(db,user,b,row) {
 check(user.username==='alex' && row.id===b.subject_key && /^(?:TSK-\d{5,}|app-[\w-]{8,90})$/.test(row.id),'Slegs Alex kan hierdie opvolg bestuur.',403);
 const human=user.via!=='pa',action=b.action,data=b.data||{};
 check(human?['edit','approve','cancel'].includes(action):['draft','submit','adopt','claim','bind_draft','gmail_unavailable','failed','sent','observe_sent','reply','review','checked'].includes(action),'Dié handeling is nie beskikbaar nie.',403);
 check(/^[\w-]{8,90}$/.test(b.request_id||''),'Lees die taak weer.');
 const fingerprint=await hash(JSON.stringify({...b,actor:human?'alex':'pa'}));
 const replay=await db.prepare('SELECT fingerprint FROM v2_pa_followup_mail WHERE request_id=?').bind(b.request_id).first();
 if(replay){check(replay.fingerprint===fingerprint,'Die gestoorde handeling verskil.',409);return {replayed:true};}
 check(['Pending','Scheduled','Waiting'].includes(row.status)||['sent','failed','observe_sent','checked'].includes(action),'Die taak is reeds gesluit.',409);
 let m=await readMail(db,row.id);
 check((m?.revision||0)===b.revision,'Die opvolg het verander. Lees dit weer.',409);
 const at=new Date().toISOString();
 let eventId=null,dispatchKey=null;
 if(action==='draft'||action==='edit'||action==='observe_sent'){
  if(action==='edit'){
   check(['draft','approval','approved'].includes(m?.phase)&&data.envelope_hash===m.envelope_hash,'Die voorstel het verander. Lees dit weer.',409);
   const allowed=['to','cc','bcc','subject','body','html'];
   check(data.changes&&Object.keys(data.changes).every(k=>allowed.includes(k)),'Wysig slegs ontvangers, onderwerp en inhoud.');
   data.envelope={...m.envelope,...data.changes};data.review_date=m.review_date;data.next_action='Alex lees die gewysigde voorstel en besluit oor versending.';
  }
  check(m?.phase!=='processing' && m?.phase!=='failed','Bevestig eers die vorige versending.',409);
  const e=await envelope(db,row.id,data.envelope,action==='observe_sent'),digest=await hash(JSON.stringify(e));
  if(action==='edit'&&JSON.stringify(data.envelope)===JSON.stringify(m.envelope))return {unchanged:true,revision:m.revision};
  if(action!=='observe_sent'&&m?.envelope_hash===digest && ['draft','approval','approved'].includes(m.phase))return {unchanged:true,revision:m.revision};
  const delivery_step=action==='edit'?m.delivery_step:data.delivery_step;
  m={...(delivery_step?{delivery_step}:{}),envelope:e,envelope_hash:digest,approval_preview:approvalPreview(e,digest),phase:action==='edit'?'approval':'draft',review_date:dateKey(data.review_date),next_action:string(data.next_action,2000)};
  if(action==='observe_sent'){
   // Evidence-only import for mail already sent through a separately authorised workflow.
   Object.assign(m,evidence(m,data.evidence),{phase:'sent',followup_required:data.followup_required===true});eventId=m.message_id;
   if(data.approval_feedback_id){
    const f=await approvalPair(db,row.id,data);
    const original=JSON.parse(f.answer).text;
    check(original.includes(e.body)&&e.to.concat(e.cc,e.bcc).every(a=>original.toLowerCase().includes(a.toLowerCase()))&&original.includes(e.subject),'Bevestig die goedgekeurde ontvangers en inhoud.');
    m.approval_evidence={feedback_id:data.approval_feedback_id,proposal_id:data.proposal_feedback_id,at:f.created_at};
   }
  }
 }else{
  check(m,'Lees die bestaande konsep.',404);
  if(action==='submit'){check(m.phase==='draft','Lees die huidige konsep.',409);m.phase='approval';}
  if(action==='cancel'){
   check(['draft','approval','approved'].includes(m.phase)&&data.envelope_hash===m.envelope_hash,'Dié versending het reeds verander.',409);
   delete m.approval;delete m.failure;m.phase='cancelled';m.next_action='Alex het die voorstel gekanselleer. Hersien die oorblywende taak.';
  }
  if(action==='approve'){
   check(['draft','approval'].includes(m.phase) && data.envelope_hash===m.envelope_hash,'Lees en keur die presiese konsep goed.',409);
   // Older drafts keep their original revision. Bind approval to exactly the cleaned HTML shown in the review.
   m.envelope.html=cleanMailHtml(m.envelope.html);
   m.envelope_hash=await hash(JSON.stringify(m.envelope));m.approval_preview=approvalPreview(m.envelope,m.envelope_hash);
   m.phase='approved';m.approval={actor:'alex',at,envelope_hash:m.envelope_hash};
   m.next_action='PA stuur die goedgekeurde e-pos by die volgende uurlikse kontrole.';
  }
  if(action==='adopt'){
   check(m.phase==='approval','Lees die huidige konsep.',409);
   const proof=await approvalPair(db,row.id,data);
   const changed=await db.prepare("SELECT MAX(saved_at) AS at FROM v2_pa_followup_mail WHERE subject_key=? AND event IN ('draft','edit','cancel')").bind(row.id).first();
   check(proof.answered_at>=changed.at&&JSON.parse(proof.answer).text.includes(m.approval_preview),'Die goedkeuring behoort aan ’n ander konsep.',409);
   m.phase='approved';m.approval={actor:'alex',at:proof.created_at,envelope_hash:m.envelope_hash,feedback_id:data.approval_feedback_id};
  }
  if(action==='gmail_unavailable'){
   check(m.phase==='approved','Lees die huidige versending.',409);
   const message='Gmail is nie beskikbaar nie. Jou goedkeuring is gestoor. PA probeer by die volgende kontrole.';
   if(m.failure===message)return {unchanged:true,revision:m.revision};
   m.failure=message;m.next_action=message;
  }
  if(action==='claim'){
   check(m.phase==='approved' && m.approval?.envelope_hash===m.envelope_hash && data.envelope_hash===m.envelope_hash,'Geen geldige goedkeuring vir hierdie e-pos nie.',409);
   delete m.failure;m.phase='processing';m.claim_id=b.request_id;m.next_action='PA wag vir Gmail se bevestiging.';
  }
  if(action==='bind_draft'){
   check(m.phase==='processing' && data.claim_id===m.claim_id && !m.gmail_draft_id && /^r[\w-]{4,100}$/.test(data.draft_id),'Lees die bestaande Gmail-konsep en versending.',409);
   m.gmail_draft_id=data.draft_id;
  }
  if(action==='failed'){check(m.phase==='processing','Lees die huidige versending.',409);m.phase='failed';m.failure=data.reason==='unavailable'?'Gmail is nie beskikbaar nie. PA sal weer nagaan.':'Gmail het die versending nog nie bevestig nie. PA kyk of dit gestuur is.';m.next_action=m.failure;}
  if(action==='sent'){
   check(['processing','failed'].includes(m.phase),'Lees die versending weer.',409);
   delete m.failure;Object.assign(m,evidence(m,data.evidence),{phase:'sent',followup_required:data.followup_required===true,review_date:dateKey(data.review_date),next_action:string(data.next_action,2000)});eventId=m.message_id;
  }
  if(action==='reply'){
   const d=data.evidence;
   check(['sent','reply'].includes(m.phase)&&d&&gmailId(d.message_id)&&d.thread_id===m.thread_id && d.message_id!==m.message_id && d.in_reply_to===m.rfc_id
    && [m.envelope.to,m.envelope.cc,m.envelope.bcc].flat().some(a=>a.toLowerCase()===String(d.from).toLowerCase()),'Bevestig die antwoord op hierdie spesifieke e-pos.');
   const received=instant(d.received_at);check(received>=(m.reply_at||m.sent_at),'Lees die nuwe antwoord.');
   Object.assign(m,{phase:'reply',reply_id:d.message_id,reply_at:received,review_date:dateKey(data.review_date),next_action:string(data.next_action,2000)});eventId=d.message_id;
  }
  if(action==='checked'){
   check(['sent','reply','processing','failed'].includes(m.phase),'Lees die huidige opvolg.');
   const after=Date.parse(data.check_after);check(Number.isFinite(after)&&after>Date.now()&&after<=Date.now()+86400000,'Kies ’n volgende kontrole binne een dag.');
   const stamp=data.checked_at?instant(data.checked_at):null;
   if(stamp)check(stamp>=(m.sent_at||m.approval?.at),'Lees die nuwe pos.');
   await db.prepare(`INSERT INTO v2_pa_mail_checks VALUES(?,?,?,?) ON CONFLICT(subject_key) DO UPDATE SET
    revision=excluded.revision,checked_at=CASE WHEN revision=excluded.revision THEN COALESCE(MAX(COALESCE(checked_at,''),COALESCE(excluded.checked_at,'')),'') ELSE excluded.checked_at END,
    check_after=excluded.check_after WHERE excluded.revision>=revision`).bind(row.id,m.revision,stamp,new Date(after).toISOString()).run();
   return {checked:true,revision:m.revision};
  }
  if(action==='review'){
   check(['reply','sent'].includes(m.phase),'Lees die korrespondensie weer.');
   m.review_date=dateKey(data.review_date);m.next_action=string(data.next_action,2000);
   if(data.waiting===true)m.phase='sent';
  }
 }
 if(action==='claim'||action==='observe_sent'){
  const {scope,...content}=m.envelope;
  dispatchKey=await hash(JSON.stringify(content));
 }
 if(action!=='checked')delete m.check_after;
 m.revision=b.revision+1;
 try{await db.prepare('INSERT INTO v2_pa_followup_mail VALUES(?,?,?,?,?,?,?,?,?,?)').bind(row.id,m.revision,b.request_id,fingerprint,action,eventId,dispatchKey,JSON.stringify(m),JSON.stringify(compact(m)),at).run();}
 catch(err){if(!/constraint|unique/i.test(String(err)))throw err;check(false,'Dié boodskap of handeling is reeds aangeteken. Lees die taak weer.',409);}
 return {saved:true,revision:m.revision,email:compact(m)};
}
