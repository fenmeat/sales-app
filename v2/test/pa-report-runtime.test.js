import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {savePaReport,readPaReport,queuePaReportReminders,reportAlertVisible} from '../src/pa-report-api.js';
import {unifiedWork,workCounts,selectWork} from '../public/pa-report-model.js';

const source='https://docs.google.com/spreadsheets/d/synthetic/edit';
const row=(id,fields={})=>({id,scope:'fenmeat',area:'Fen Meat',title:'Review supplier invoice',status:'Waiting',assigned_to:'alinda',priority:'Normal',next_action:'Confirm the unmatched invoice and payment separately.',review_group:'Supplier — month',due_date:'2026-10-01',review_date:'2026-11-06',source_url:source+'#range=A2:S2',app_task_id:'',outcome:'',...fields});
async function setup(t){const f=await fixture(t),env={DB:f.db,APP_ACCESS_KEYS:JSON.stringify(Object.fromEntries(['alex','alinda','xavier','xalinda'].map(u=>[u,'synthetic-'+u+'-'.repeat(40)])))};
 const rows=[row('TSK-00001'),row('TSK-00002',{assigned_to:'xavier'}),row('TSK-00003',{scope:'private',area:'Finance & Legal',title:'PRIVATE LEGAL CONTENT',assigned_to:'alex'}),row('TSK-00004',{status:'Complete'})];
 const publish=(operation,data,revision=0,request_id=crypto.randomUUID())=>savePaReport(env,{username:'alex',via:'pa'},{operation,data,revision,request_id,reason:'Synthetic authorised report test'});
 await publish('register',{source_at:new Date().toISOString(),source_url:source,rows});
 return {...f,env,rows,publish};
}
const reportData=()=>({date:new Date().toISOString().slice(0,10),source_at:new Date().toISOString(),source_url:'https://mail.google.com/mail/#sent/synthetic',register_revision:1,coverage:'Synthetic source coverage',sections:['emails','activity','tasks','tomorrow','rabbi'].map((id,n)=>({id,title:id,items:[{id:'item-'+n,title:id==='rabbi'?'SHARED SCRIPTURE':'PRIVATE BRIEFING '+id,text:id==='rabbi'?'Shared Scripture reading\nPractical example':'Private report narrative\nSecond paragraph',needs_reply:n===0,question:'What should happen next?',pa_task_ids:n===0?['TSK-00003']:[],links:[{label:'Source',url:source}]}]}))});

test('full report and private PA are server-isolated; staff see only their existing assignments',async t=>{
 const {call,publish}=await setup(t);await publish('report',reportData());
 let r=await call('alex','/api/pa-report');assert.equal(r.status,200);assert.equal(r.data.summary.open,3);assert.equal(r.data.summary.private,1);assert.equal(r.data.report.sections.length,5);
 r=await call('alinda','/api/pa-report');assert.equal(r.status,200);assert.equal(r.data.rows.length,3);assert.equal(r.data.report,null);assert.deepEqual(r.data.history,[]);assert.equal(r.data.rabbi_access,true);assert.equal(r.data.rabbi.items[0].title,'SHARED SCRIPTURE');assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE LEGAL|PRIVATE BRIEFING/);
 r=await call('xavier','/api/pa-report');assert.deepEqual(r.data.rows.map(r=>r.id),['TSK-00002']);assert.equal(r.data.summary.open,1);
 assert.equal((await call('xalinda','/api/pa-report')).data.rows.length,0);
 assert.equal((await call('tapiz','/api/pa-report')).status,403);
});
test('publication preserves identities, validates five sections and rejects stale and concurrent writes',async t=>{
 const {env,rows,publish}=await setup(t),data={source_at:new Date().toISOString(),source_url:source,rows},id=crypto.randomUUID();
 await assert.rejects(savePaReport(env,{username:'alinda',via:'pa'},{operation:'register',data,revision:1,request_id:id,reason:'Synthetic instruction'}),/Only the authorised Alex/);
 await assert.rejects(publish('register',data,0),/changed/);await assert.rejects(publish('register',{...data,rows:rows.slice(1)},1),/drop existing/);
 await assert.rejects(publish('register',{...data,source_at:'2000-01-01T00:00:00Z'},1),/older/);
 await assert.rejects(publish('report',{...reportData(),sections:[]}),/five/);
 await assert.rejects(publish('report',{...reportData(),register_revision:0}),/current register/);
 const r=await publish('register',data,1,id);assert.equal(r.revision,2);assert.equal((await publish('register',data,1,id)).replayed,true);
 await assert.rejects(publish('register',{...data,rows:rows.map(r=>({...r,title:r.title+' changed'}))},1,id),/different content/);
 const parallel=await Promise.allSettled([publish('register',data,2),publish('register',data,2)]);assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1);
});
test('answers are durable and idempotent, complete only records evidence, and changed subjects need review',async t=>{
 const {env,call,publish,rows}=await setup(t),s=(await call('xavier','/api/pa-report')).data.rows[0];
 const body={request_id:crypto.randomUUID(),subject_key:s.subject_key,subject_hash:s.subject_hash,action:'complete',note:'Work finished; please verify the saved evidence.'};
 let r=await call('xavier','/api/pa-report/feedback',body);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.feedback.status,'pending');
 assert.equal((await call('xavier','/api/pa-report/feedback',body)).data.replayed,true);
 assert.equal((await call('xavier','/api/pa-report/feedback',{...body,note:'Different answer'})).status,409);
 assert.equal((await call('xalinda','/api/pa-report/feedback',{...body,request_id:crypto.randomUUID()})).status,404);
 r=await call('alex','/api/pa-report');assert.equal(r.data.summary.open,3);assert.equal(r.data.feedback.length,1);
 const pending=await readPaReport(env,{username:'alex'},{resource:'pending_feedback'});assert.equal(pending.feedback[0].subject_hash,s.subject_hash);assert.equal(pending.feedback[0].current_subject.id,s.id);
 await publish('register',{source_at:new Date().toISOString(),source_url:source,rows:rows.map(r=>r.id===s.id?{...r,status:'Complete'}:r)},1);
 assert.equal((await call('xavier','/api/pa-report/feedback',{...body,request_id:crypto.randomUUID()})).status,409);
 const ack={operation:'acknowledge',request_id:crypto.randomUUID(),reason:'PA update read back',feedback_id:body.request_id,subject_hash:s.subject_hash,outcome:'Verified and closed the existing task.',source_url:source};
 await savePaReport(env,{username:'alex',via:'pa'},ack);assert.equal((await readPaReport(env,{username:'alex'},{resource:'pending_feedback'})).feedback.length,0);
 assert.equal((await savePaReport(env,{username:'alex',via:'pa'},ack)).replayed,true);
 assert.equal((await call('alex','/api/pa-report')).data.summary.open,2);
});
test('report item replies use a verified source hash and do not leak to other users',async t=>{
 const {call,publish}=await setup(t);await publish('report',reportData());
 const item=(await call('alex','/api/pa-report')).data.report.sections[0].items[0],body={request_id:crypto.randomUUID(),subject_key:item.subject_key,subject_hash:item.subject_hash,action:'respond',note:'Draft a response for my review.'};
 assert.equal((await call('alex','/api/pa-report/feedback',body)).status,200);
 assert.equal((await call('alinda','/api/pa-report/feedback',{...body,request_id:crypto.randomUUID()})).status,404);
 assert.equal((await call('alinda','/api/pa-report')).data.feedback.length,0);
 assert.equal((await call('alex','/api/pa-report')).data.feedback[0].source_task_ids[0],'TSK-00003');
});
test('attachments retain exact retry bytes and are protected by current case access',async t=>{
 const {call,env}=await setup(t),s=(await call('alex','/api/pa-report')).data.rows.find(r=>r.scope==='private');
 const b={id:crypto.randomUUID(),subject_key:s.subject_key,subject_hash:s.subject_hash,mime_type:'application/pdf',filename:'proof.pdf',base64:btoa('%PDF-1.7 synthetic')};
 assert.equal((await call('alex','/api/pa-report/file',b)).status,200);
 assert.equal((await call('alex','/api/pa-report/file',b)).data.replayed,true);
 assert.equal((await call('alex','/api/pa-report/file',{...b,base64:btoa('%PDF-other')})).status,409);
 assert.equal((await call('alinda','/api/pa-report/file',b)).status,404);
 const f=await readPaReport(env,{username:'alex'},{resource:'file',id:b.id});assert.equal(atob(f.base64),'%PDF-1.7 synthetic');
 const x=(await call('xavier','/api/pa-report')).data.rows[0];assert.equal((await call('xavier','/api/pa-report/feedback',{request_id:crypto.randomUUID(),subject_key:x.id,subject_hash:x.subject_hash,action:'respond',note:'test',attachments:[b.id]})).status,404);
});
test('reminders belong to the requester; superseded, closed and reassigned reminders withdraw',async t=>{
 const {call,env,publish,rows}=await setup(t),s=(await call('alex','/api/pa-report')).data.rows[0];
 const time=new Date(Date.now()+3600000),later=new Date(Date.now()+7200000),body={request_id:crypto.randomUUID(),subject_key:s.id,subject_hash:s.subject_hash,action:'remind',note:'',remind_at:time.toISOString()};
 assert.equal((await call('alex','/api/pa-report/feedback',body)).status,200);
 await queuePaReportReminders(env,time);let a=(await env.DB.prepare('SELECT * FROM v2_pa_report_alerts').all()).results.find(a=>a.kind==='remind');assert.equal(a.username,'alex');assert.equal(await reportAlertVisible(env,a,time),true);
 await call('alex','/api/pa-report/feedback',{...body,request_id:crypto.randomUUID(),remind_at:later.toISOString()});assert.equal(await reportAlertVisible(env,a,later),false);
 assert.equal((await call('alinda','/api/pa-report')).data.reminders.length,0);
 await publish('register',{source_at:new Date().toISOString(),source_url:source,rows:rows.map(r=>r.id===s.id?{...r,status:'Complete'}:r)},1);await queuePaReportReminders(env,later);a=(await env.DB.prepare('SELECT * FROM v2_pa_report_alerts ORDER BY created_at DESC').all()).results[0];assert.equal(await reportAlertVisible(env,a,later),false);
});
test('canonical counts join stages once, include unpublished app work, and keep closed steps in open cycles',()=>{
 const pa={rows:[row('TSK-00001'),row('TSK-00002',{scope:'private',assigned_to:'alex'}),row('TSK-00003',{status:'Complete'})]},app={tasks:[{id:'step',pa_task_id:'TSK-00001',status:'Complete'},{id:'old-duplicate',pa_task_id:'TSK-00001',status:'Cancelled'},{id:'newtask',pa_task_id:'',status:'Pending',assigned_to:'xavier',title:'New app work'}]};
 const rows=unifiedWork(app,pa);assert.equal(rows.length,4);assert.equal(rows[0].status,'Pending');assert.equal(rows[0].stages.length,2);assert.equal(workCounts(rows,'alex').open,3);
 assert.equal(selectWork(rows,{username:'alex',admin:true,scope:'private',status:'open'}).length,1);
 assert.equal(selectWork(rows,{username:'alex',admin:true,scope:'fenmeat',status:'open'}).length,2);
});


test('named Rabbi readers receive only the reading, including history, without private replies or write access',async t=>{
 const {call,env,publish}=await setup(t),current=reportData(),older={...reportData(),date:'2026-10-01'};
 older.sections[4].items[0].text='Earlier shared lesson';
 // Even sensitive metadata inside a Rabbi item must not enter its shared projection.
 current.sections[4].items[0].pa_task_ids=['TSK-00003'];
 current.sections[4].items[0].question='PRIVATE QUESTION';
 current.sections[4].items[0].links=[{label:'PRIVATE SOURCE',url:'https://mail.google.com/mail/#sent/private'}];
 await publish('report',older);await publish('report',current);
 const before=await call('alex','/api/pa-report'),item=before.data.report.sections[4].items[0];
 const feedback={request_id:crypto.randomUUID(),subject_key:item.subject_key,subject_hash:item.subject_hash,action:'respond',note:'PRIVATE RABBI REPLY'};
 assert.equal((await call('alex','/api/pa-report/feedback',feedback)).status,200);
 const upload={id:crypto.randomUUID(),subject_key:item.subject_key,subject_hash:item.subject_hash,mime_type:'application/pdf',filename:'private.pdf',base64:btoa('%PDF-1.7 private')};
 assert.equal((await call('alex','/api/pa-report/file',upload)).status,200);
 for(const username of ['alinda','xalinda','xavier']){
  const r=await call(username,'/api/pa-report');assert.equal(r.status,200);assert.equal(r.data.rabbi_access,true);assert.equal(r.data.private_report,false);
  assert.deepEqual(r.data.rabbi,{date:current.date,title:'rabbi',items:[{id:'item-4',title:'SHARED SCRIPTURE',text:'Shared Scripture reading\nPractical example'}]});
  assert.deepEqual(r.data.rabbi_history,[{date:current.date},{date:older.date}]);
  assert.equal(r.data.report,null);assert.deepEqual(r.data.history,[]);assert.deepEqual(r.data.feedback,[]);
  assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE|Private report narrative|mail.google.com|Synthetic source coverage/);
  const historical=await call(username,'/api/pa-report?date='+older.date);assert.equal(historical.data.rabbi.items[0].text,'Earlier shared lesson');
  assert.equal((await call(username,'/api/pa-report?date=2026-09-01')).data.rabbi,null);
  assert.equal((await call(username,'/api/pa-report/feedback',{...feedback,request_id:crypto.randomUUID()})).status,404);
  assert.equal((await call(username,'/api/pa-report/file?id='+upload.id)).status,404);
  assert.equal((await call(username,'/api/pa-report/file',{...upload,id:crypto.randomUUID()})).status,404);
  await assert.rejects(readPaReport(env,{username},{resource:'pending_feedback'}),/Only Alex/);
 }
 assert.equal((await call('tapiz','/api/pa-report')).status,403);
 const otherEnv={...env,APP_ACCESS_KEYS:JSON.stringify({...JSON.parse(env.APP_ACCESS_KEYS),other:'synthetic-other-'+'.'.repeat(40)})};
 const other=await readPaReport(otherEnv,{username:'other'});assert.equal(other.rabbi_access,false);assert.equal(other.rabbi,null);assert.deepEqual(other.rabbi_history,[]);
 const after=await call('alex','/api/pa-report');assert.deepEqual(after.data.report,before.data.report);assert.deepEqual(after.data.rows,before.data.rows);assert.equal(after.data.feedback.length,1);
});

async function ask(f,key='TSK-00003',note='Moet ek dit opvolg of wag?'){
 const s=(await readPaReport(f.env,{username:'alex'},{resource:'summary',id:key})).subject;
 const b={request_id:crypto.randomUUID(),subject_key:key,subject_hash:s.subject_hash,action:'respond',note};
 assert.equal((await f.call('alex','/api/pa-report/feedback',b)).status,200);return {b,s};
}
async function answer(f,b){
 const s=(await readPaReport(f.env,{username:'alex'},{resource:'summary',id:b.subject_key})).subject;
 return {operation:'answer',request_id:crypto.randomUUID(),reason:'Explicit synthetic PA response',revision:s.register_revision,feedback_id:b.request_id,subject_hash:b.subject_hash,current_subject_hash:s.subject_hash,source_url:source,answer:{kind:'question',text:'Ek beveel ’n kort opvolg aan om ’n antwoorddatum te vra.',recommendation:'Vra wanneer jy ’n antwoord kan verwag.',next_action:s.next_action,responsible:s.assigned_to,follow_up_date:s.review_date,task_status:s.status}};
}
test('PA answer is atomic, unique, readable after returning, and never changes the task',async t=>{
 const f=await setup(t),{b}=await ask(f),before=(await f.call('alex','/api/pa-report')).data.rows;
 const a=await answer(f,b);const outcomes=await Promise.all([savePaReport(f.env,{username:'alex',via:'pa'},a),savePaReport(f.env,{username:'alex',via:'pa'},a)]);
 assert.ok(outcomes.every(r=>r.saved));assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM v2_pa_report_answers').first()).n,1);
 const history=await readPaReport(f.env,{username:'alex'},{resource:'summary',id:b.subject_key});assert.equal(history.feedback[0].note,b.note);assert.equal(history.feedback[0].answer.text,a.answer.text);assert.equal(history.feedback[0].status,'answered');
 assert.deepEqual((await f.call('alex','/api/pa-report')).data.rows,before);
 assert.equal((await readPaReport(f.env,{username:'alex'},{resource:'pending_feedback'})).feedback.length,0);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM v2_pa_report_alerts WHERE kind='pa_answer'").first()).n,1);
 assert.equal((await f.call('alinda','/api/pa-report/conversation?subject_key='+b.subject_key)).status,404);
 await assert.rejects(savePaReport(f.env,{username:'alex',via:'pa'},{...a,answer:{...a.answer,text:'A different answer that must not replace the original.'}}),/reeds/);
});
test('generic notes, missing next steps, stale sources and failed processing never answer a question',async t=>{
 const f=await setup(t),{b}=await ask(f),a=await answer(f,b);
 await assert.rejects(savePaReport(f.env,{username:'alex',via:'pa'},{...a,operation:'acknowledge',outcome:'PA het dit nagegaan'}),/werklike antwoord/);
 await assert.rejects(savePaReport(f.env,{username:'alex',via:'pa'},{...a,answer:{...a.answer,text:'PA review pending'}}),/werklike antwoord/);
 await assert.rejects(savePaReport(f.env,{username:'alex',via:'pa'},{...a,answer:{...a.answer,next_action:''}}),/required/);
 await assert.rejects(savePaReport(f.env,{username:'alex',via:'pa'},{...a,current_subject_hash:'stale'}),/verander/);
 await assert.rejects(savePaReport(f.env,{username:'alex',via:'pa'},{...a,answer:{...a.answer,follow_up_date:'2099-01-01'}}),/Werk eers/);
 const fail={operation:'feedback_error',feedback_id:b.request_id,subject_hash:b.subject_hash,request_id:crypto.randomUUID(),reason:'Synthetic unavailable source',message:'Die bron kon nie gelees word nie. PA probeer weer.'};
 await savePaReport(f.env,{username:'alex',via:'pa'},fail);await savePaReport(f.env,{username:'alex',via:'pa'},fail);
 let pending=await readPaReport(f.env,{username:'alex'},{resource:'pending_feedback'});assert.equal(pending.feedback[0].answer_status,'retry');assert.equal(pending.feedback[0].note,b.note);
 await savePaReport(f.env,{username:'alex',via:'pa'},a);await savePaReport(f.env,{username:'alex',via:'pa'},{...fail,request_id:crypto.randomUUID()});
 assert.equal((await readPaReport(f.env,{username:'alex'},{resource:'pending_feedback'})).feedback.length,0);
});
test('legacy review notes remain intact and return for an actual answer; follow-up stays in the same task',async t=>{
 const f=await setup(t),{b}=await ask(f);
 await f.db.prepare('UPDATE v2_pa_report_feedback SET acknowledged_at=?,outcome=? WHERE id=?').bind(new Date().toISOString(),'Oorspronklike ondersoeknota',b.request_id).run();
 const pending=await readPaReport(f.env,{username:'alex'},{resource:'pending_feedback'});assert.equal(pending.feedback.length,1);assert.equal(pending.feedback[0].outcome,'Oorspronklike ondersoeknota');
 await savePaReport(f.env,{username:'alex',via:'pa'},await answer(f,b));
 const next={...b,request_id:crypto.randomUUID(),reply_to:b.request_id,note:'Skryf die opvolg-e-pos vir my.'};assert.equal((await f.call('alex','/api/pa-report/feedback',next)).status,200);
 const history=(await f.call('alex','/api/pa-report/conversation?subject_key='+b.subject_key)).data;assert.equal(history.feedback.length,2);assert.equal(history.feedback[0].outcome,'Oorspronklike ondersoeknota');assert.equal(history.feedback[1].reply_to,b.request_id);assert.equal(history.subject.id,b.subject_key);
});
test('conversation pagination keeps more than three messages and rejects private report cross-links',async t=>{
 const f=await setup(t),s=(await readPaReport(f.env,{username:'alex'},{resource:'summary',id:'TSK-00003'})).subject;
 for(let n=0;n<52;n++)await f.db.prepare('INSERT INTO v2_pa_report_feedback(id,fingerprint,subject_key,subject_hash,payload,actor,created_at) VALUES(?,?,?,?,?,?,?)').bind('synthetic-message-'+String(n).padStart(3,'0'),'test',s.id,s.subject_hash,JSON.stringify({action:'respond',note:'Question '+n,source_task_ids:[s.id]}),'alex',new Date(n*1000).toISOString()).run();
 const first=await readPaReport(f.env,{username:'alex'},{resource:'summary',id:s.id});assert.equal(first.feedback.length,50);assert.equal(first.next_offset,50);
 const second=await readPaReport(f.env,{username:'alex'},{resource:'summary',id:s.id,offset:first.next_offset});assert.equal(second.feedback.length,2);assert.equal(second.next_offset,null);
 assert.equal((await f.call('xavier','/api/pa-report/conversation?subject_key='+s.id)).status,404);
});


test('a question in an older completion note stays answerable without changing the task',async t=>{
 const {env,call}=await setup(t),s=(await call('alex','/api/pa-report')).data.rows.find(r=>r.id==='TSK-00003');
 const b={request_id:crypto.randomUUID(),subject_key:s.id,subject_hash:s.subject_hash,action:'complete',note:'Die eerste stap is klaar. Moet ek wag vir betaling?'};
 assert.equal((await call('alex','/api/pa-report/feedback',b)).status,200);
 await env.DB.prepare("UPDATE v2_pa_report_feedback SET acknowledged_at=?,outcome=? WHERE id=?").bind('2026-11-12T12:00:00Z','Vorige ondersoeknota',b.request_id).run();
 const pending=await readPaReport(env,{username:'alex'},{resource:'pending_feedback'}),f=pending.feedback.find(f=>f.id===b.request_id);
 assert.equal(f.answer_status,'awaiting_answer');assert.equal(f.outcome,'Vorige ondersoeknota');assert.equal(f.current_subject.status,'Waiting');
 await assert.rejects(savePaReport(env,{username:'alex',via:'pa'},{operation:'acknowledge',request_id:crypto.randomUUID(),reason:'Synthetic verification',feedback_id:b.request_id,subject_hash:s.subject_hash,outcome:'Processed',source_url:source}),/werklike antwoord/);
 const conversation=(await call('alex','/api/pa-report/conversation?subject_key='+s.id)).data;
 assert.equal(conversation.feedback[0].status,'pending');assert.equal(conversation.subject.status,'Waiting');
});
