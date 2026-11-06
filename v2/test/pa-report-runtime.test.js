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
const reportData=()=>({date:new Date().toISOString().slice(0,10),source_at:new Date().toISOString(),source_url:'https://mail.google.com/mail/#sent/synthetic',register_revision:1,coverage:'Synthetic source coverage',sections:['emails','activity','tasks','tomorrow','rabbi'].map((id,n)=>({id,title:id,items:[{id:'item-'+n,title:'PRIVATE BRIEFING '+id,text:'Private report narrative\nSecond paragraph',needs_reply:n===0,question:'What should happen next?',pa_task_ids:n===0?['TSK-00003']:[],links:[{label:'Source',url:source}]}]}))});

test('full report and private PA are server-isolated; staff see only their existing assignments',async t=>{
 const {call,publish}=await setup(t);await publish('report',reportData());
 let r=await call('alex','/api/pa-report');assert.equal(r.status,200);assert.equal(r.data.summary.open,3);assert.equal(r.data.summary.private,1);assert.equal(r.data.report.sections.length,5);
 r=await call('alinda','/api/pa-report');assert.equal(r.status,200);assert.equal(r.data.rows.length,3);assert.equal(r.data.report,null);assert.deepEqual(r.data.history,[]);assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE LEGAL|PRIVATE BRIEFING/);
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
 const rows=unifiedWork(app,pa);assert.equal(rows.length,4);assert.equal(rows[0].status,'Waiting');assert.equal(rows[0].stages.length,2);assert.equal(workCounts(rows,'alex').open,3);
 assert.equal(selectWork(rows,{username:'alex',admin:true,scope:'private',status:'open'}).length,1);
 assert.equal(selectWork(rows,{username:'alex',admin:true,scope:'fenmeat',status:'open'}).length,2);
});
