import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {saveTask,getTask} from '../src/tasks-api.js';
import {savePaReport,ensurePaReportSchema} from '../src/pa-report-api.js';
import {readTaskConversation,messageStatement} from '../src/task-conversation.js';
import {messageMarkdown,messageHTML} from '../public/task-conversation-ui.js';
const owner={username:'alex',via:'pa'};
const write=(env,id,revision,action,extra={})=>saveTask(env,owner,{task_id:id,revision,action,request_id:crypto.randomUUID(),...extra});
test('messages are retry-safe, paged and protected by current task access',async t=>{
 const {call,task,env,db}=await fixture(t),b=task({visibility:'private',assigned_to:'alex',title:'Private chat'});await call('alex','/api/tasks',b);
 const request={task_id:b.task_id,revision:1,action:'pa_request',request_id:crypto.randomUUID(),note:'Private question'};
 assert.equal((await call('alex','/api/tasks',request)).status,200);assert.equal((await call('alex','/api/tasks',request)).data.replayed,true);
 let page=await call('alex','/api/tasks/conversation?id='+b.task_id);assert.equal(page.status,200);assert.equal(page.data.messages.length,1);assert.equal(page.data.messages[0].actor,'alex');assert.match(page.headers.get('Cache-Control'),/no-store/);
 for(const u of ['alinda','xavier','xalinda','tapiz',''])assert.ok([401,403,404].includes((await call(u,'/api/tasks/conversation?id='+b.task_id)).status),u);
 assert.equal((await call('alex','/api/tasks/conversation?id='+b.task_id+'&before=bad')).status,400);
 assert.ok(!JSON.stringify((await call('alex','/api/tasks?id='+b.task_id+'&brief=1')).data.task).includes('Private question'));
 await db.batch(Array.from({length:75},(_,i)=>messageStatement(db,b.task_id,{id:'synthetic-'+String(i).padStart(3,'0'),role:'pa',actor:'pa',at:'2099-01-01T00:00:00.000Z',text:'Answer '+i})));
 page=await readTaskConversation(env,owner,await getTask(db,b.task_id));assert.equal(page.messages.length,30);assert.equal(page.messages.at(-1).text,'Answer 74');const seen=new Set(page.messages.map(m=>m.id));
 while(page.next_before){page=await readTaskConversation(env,owner,await getTask(db,b.task_id),{before:page.next_before});for(const m of page.messages){assert.ok(!seen.has(m.id));seen.add(m.id);}}assert.equal(seen.size,76);
});
test('PA answer and plan save atomically, keeping completed evidence',async t=>{
 const {call,task,env,db}=await fixture(t),b=task({visibility:'operational',assigned_to:'alex',task_type:'workflow',steps:[{id:'source',description:'Verify source',assigned_to:'alex',status:'Pending'},{id:'next',description:'Decide',assigned_to:'alex',status:'Pending',dependencies:['source']}],require_final_approval:true});await call('alex','/api/tasks',b);
 let r=await write(env,b.task_id,1,'step_complete',{step_id:'source',note:'Verified source'});const completion=structuredClone(r.task.steps[0].completion);
 r=await write(env,b.task_id,2,'pa_request',{note:'Please update the plan'});const work=r.task.pa_work[0],claim=crypto.randomUUID();await saveTask(env,owner,{task_id:b.task_id,revision:3,request_id:claim,action:'pa_claim',work_id:work.id});
 const result={work_id:work.id,claim_id:claim,status:'answered',answer:'Die bron is nagegaan. Die volgende stap wag nou vir Alinda.',next_action:'Alinda bevestig die besluit.',task_updates:[{action:'step_update',step_id:'next',data:{description:'Alinda bevestig die besluit.',assigned_to:'alinda'}}]};
 r=await write(env,b.task_id,4,'pa_result',result);assert.equal(r.task.steps[1].assigned_to,'alinda');assert.deepEqual(r.task.steps[0].completion,completion);assert.notEqual(r.task.status,'Complete');
 const page=await readTaskConversation(env,owner,r.task);assert.equal(page.messages.length,2);assert.equal(page.messages[1].role,'pa');assert.equal(page.messages[1].text,result.answer);
 for(const u of ['alex','alinda','xavier','xalinda'])assert.equal((await call(u,'/api/tasks/conversation?id='+b.task_id)).status,200);
 r=await write(env,b.task_id,5,'pa_request',{note:'Another question'});const job=r.task.pa_work.at(-1),c=crypto.randomUUID();await saveTask(env,owner,{task_id:b.task_id,revision:6,request_id:c,action:'pa_claim',work_id:job.id});
 await assert.rejects(write(env,b.task_id,7,'pa_result',{...result,work_id:job.id,claim_id:c,task_updates:[{action:'step_complete',step_id:'next',note:'Done'}]}),/bevestigde/);assert.equal((await getTask(db,b.task_id)).revision,7);assert.equal((await readTaskConversation(env,owner,await getTask(db,b.task_id))).messages.length,3);
});
test('migration backs up exact task and preserves ambiguous text without invented attribution',async t=>{
 const {call,task,env,db}=await fixture(t);await ensurePaReportSchema(db);const original='Unknown question\nPA se antwoord: old reply\nAnother question\nPA se antwoord: another reply';
 const b=task({assigned_to:'alex',task_type:'workflow',steps:[{id:'one',description:'Verify',assigned_to:'alex',status:'Pending',notes:original}]});await call('alex','/api/tasks',b);
 let r=await write(env,b.task_id,1,'conversation_migrate',{backup_reference:'test-backup'});assert.equal(r.task.conversation_review_required,true);assert.ok(!r.task.steps[0].notes.includes('old reply'));assert.equal(r.task.steps[0].status,'Pending');
 let page=await readTaskConversation(env,owner,r.task);assert.equal(page.messages.length,1);assert.equal(page.messages[0].text,original);assert.equal(page.messages[0].actor,undefined);assert.equal(page.messages[0].at,undefined);
 assert.equal(JSON.parse((await db.prepare('SELECT payload FROM v2_task_conversation_backups WHERE task_id=?').bind(b.task_id).first()).payload).steps[0].notes,original);
 r=await write(env,b.task_id,2,'conversation_migrate',{backup_reference:'test-backup'});assert.equal((await readTaskConversation(env,owner,r.task)).messages.length,1);
});
test('event appends preserve participants and recorded time',async t=>{
 const {call,task,env,db}=await fixture(t);await ensurePaReportSchema(db);const b=task({assigned_to:'alex',task_type:'workflow',steps:[{id:'one',description:'Verify',assigned_to:'alex',status:'Pending'}]});await call('alex','/api/tasks',b);
 await write(env,b.task_id,1,'step_note',{step_id:'one',note:'Wat beteken dit?'});await write(env,b.task_id,2,'step_note',{step_id:'one',note:'PA se antwoord op 26 November: Dit is die oorspronklike verduideliking.'});
 const r=await write(env,b.task_id,3,'conversation_migrate',{backup_reference:'test-backup'}),page=await readTaskConversation(env,owner,r.task);assert.equal(page.messages.length,2);assert.equal(page.messages[0].actor,'alex');assert.equal(page.messages[1].actor,'pa');assert.ok(page.messages.every(m=>m.at));assert.equal(r.task.conversation_review_required,false);
});
test('safe formatting preserves headings, paragraphs, lists, bold and links',()=>{
 const html=messageMarkdown('# Opskrif\n\n**Vet**\n- Een\n- Twee\nhttps://example.com\n<script>alert(1)</script>\n[bad](javascript:alert(1))');assert.match(html,/<h4>Opskrif/);assert.match(html,/<strong>Vet/);assert.match(html,/<ul><li>Een/);assert.match(html,/href="https:\/\/example.com\//);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.match(messageHTML({role:'history',text:'Original',review_required:true}),/Datum en tyd onbekend/);
});
test('legacy report messages recheck current source privacy and private report copies stay owner-only',async t=>{
 const {call,task,env,db}=await fixture(t);await ensurePaReportSchema(db);
 const b=task({visibility:'operational',assigned_to:'alex',pa_task_id:'TSK-99999'});await call('alex','/api/tasks',b);
 await db.prepare('INSERT INTO v2_pa_report_versions VALUES(?,?,?,?,?,?,?)').bind('register',1,'synthetic-register','test',JSON.stringify({rows:[{id:'TSK-99999',scope:'fenmeat'}]}),'alex',new Date().toISOString()).run();
 await db.batch([messageStatement(db,b.task_id,{id:'direct',role:'pa',actor:'pa',source_key:'TSK-99999',text:'Shared source'}),messageStatement(db,b.task_id,{id:'private-report',role:'pa',actor:'pa',owner_only:true,source_key:'report-2026-11-26:private',text:'Private report'})]);
 assert.deepEqual((await readTaskConversation(env,{username:'alinda'},await getTask(db,b.task_id))).messages.map(m=>m.id),['direct']);
 const other=task({visibility:'private',assigned_to:'alex',pa_task_id:'TSK-99999'});await call('alex','/api/tasks',other);
 assert.equal((await readTaskConversation(env,{username:'alinda'},await getTask(db,b.task_id))).messages.length,0);
 assert.equal((await readTaskConversation(env,owner,await getTask(db,b.task_id))).messages.length,2);
});
test('a user document belongs to its message and retries do not duplicate it',async t=>{
 const {call,task}=await fixture(t);const b=task({visibility:'operational',assigned_to:'alex'});await call('alex','/api/tasks',b);
 const request={task_id:b.task_id,revision:1,request_id:crypto.randomUUID(),action:'pa_request',note:'Lees die bewys',files:[{id:crypto.randomUUID(),filename:'proof.txt',mime_type:'text/plain',base64:btoa('Synthetic proof')}]};
 assert.equal((await call('alex','/api/tasks',request)).status,200);await call('alex','/api/tasks',request);
 const page=(await call('alex','/api/tasks/conversation?id='+b.task_id)).data;
 assert.equal(page.messages.length,1);assert.equal(page.messages[0].files[0].name,'proof.txt');assert.equal(page.messages[0].files[0].id,request.files[0].id);
});

test('private task bridge edits only requested task and step fields',async t=>{
 const {env,db}=await fixture(t);await ensurePaReportSchema(db);
 await db.prepare('INSERT INTO v2_pa_report_versions VALUES(?,?,?,?,?,?,?)').bind('register',1,'private-fixture-register','test',JSON.stringify({rows:[{id:'TSK-99998',scope:'private'}]}),'alex',new Date().toISOString()).run();
 const change=(revision,data)=>savePaReport(env,owner,{operation:'private_task',revision,request_id:crypto.randomUUID(),reason:'Verify private conversation plan update',data:{pa_task_id:'TSK-99998',...data}});
 await change(0,{action:'create',data:{title:'Private plan',task_type:'workflow',steps:[{id:'next',description:'Next action',assigned_to:'alex',status:'Pending'}]}});
 let r=await change(1,{action:'update',data:{title:'Current private plan'},note:'Confirmed current facts'});assert.equal(r.task.title,'Current private plan');assert.equal(r.task.visibility,'private');
 r=await change(2,{action:'step_update',step_id:'next',data:{description:'Verify the source',assigned_to:'pa'}});assert.equal(r.task.steps[0].assigned_to,'pa');assert.equal(r.task.visibility,'private');
});

test('older empty feedback retains its action and explicit PA source labels',async t=>{
 const {env,db,call,task}=await fixture(t);await ensurePaReportSchema(db);const b=task({assigned_to:'alex'});await call('alex','/api/tasks',b);
 await db.prepare('INSERT INTO v2_pa_report_feedback(id,fingerprint,subject_key,subject_hash,payload,actor,created_at) VALUES(?,?,?,?,?,?,?)').bind('old-confirmation','test','TSK-99997','test',JSON.stringify({action:'complete',completion_scope:'part'}),'alex','2026-11-26T08:00:00Z').run();
 await db.batch([messageStatement(db,b.task_id,{id:'feedback-old-confirmation',role:'user',actor:'alex',text:''}),messageStatement(db,b.task_id,{id:'legacy-source',role:'user',actor:'alex',text:'PA se bronkontrole: die bron is nagegaan.'})]);
 const page=await readTaskConversation(env,owner,await getTask(db,b.task_id));assert.match(page.messages.find(m=>m.id==='feedback-old-confirmation').text,/My aandeel/);assert.equal(page.messages.find(m=>m.id==='legacy-source').actor,'pa');
});
