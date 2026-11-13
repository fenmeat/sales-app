import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {projectTask,nextOccurrence,stepView} from '../src/task-workflow.js';
import {readTasksForPa,acknowledgeTask,currentTaskNotification} from '../src/tasks-api.js';
import {queueTaskReminders} from '../src/tasks-push.js';
import {savePaReport,readPaReport} from '../src/pa-report-api.js';
import {unifiedWork,selectWork} from '../public/pa-report-model.js';
const envFor=db=>({DB:db,APP_ACCESS_KEYS:JSON.stringify(Object.fromEntries(['alex','alinda','xalinda','xavier'].map(u=>[u,'synthetic-'+u+'-'.repeat(40)])))});
const send=(call,id,revision,action,extra={})=>call('alex','/api/tasks',{task_id:id,revision,action,request_id:crypto.randomUUID(),...extra});
const step=(id,data={})=>({id,description:'Synthetic action '+id,assigned_to:'alinda',status:'Pending',dependencies:[],...data});
test('simple reminders finish immediately, retain history and never enter PA sync',async t=>{
 const {call,task,db}=await fixture(t);const b=task({task_type:'reminder'}),created=await call('alex','/api/tasks',b);assert.equal(created.status,200);assert.equal(created.data.task.pa_sync.status,'app_only');
 const completed=await send(call,b.task_id,1,'complete');assert.equal(completed.data.task.status,'Complete');
 assert.equal((await readTasksForPa(envFor(db),{username:'alex'},{resource:'pending_sync'})).tasks.length,0);
 await assert.rejects(()=>acknowledgeTask(envFor(db),{username:'alex'},{task_id:b.task_id,revision:2,pa_task_id:'TSK-99999',source_url:'https://docs.google.com/spreadsheets/d/synthetic/edit'}));
 const history=(await call('alex','/api/tasks/audit?id='+b.task_id)).data.history;assert.equal(history.length,2);assert.equal(history[0].task.completion.by,'alex');
});
test('recurring reminder retains completed occurrence and schedules exactly one next occurrence despite replay',async t=>{
 const {call,task}=await fixture(t),b=task({task_type:'reminder',repeat:'weekly'});await call('alex','/api/tasks',b);
 const body={task_id:b.task_id,revision:1,action:'complete',request_id:crypto.randomUUID(),note:'Done this week'};
 const first=await call('alex','/api/tasks',body),retry=await call('alex','/api/tasks',body);assert.equal(first.status,200);assert.equal(first.data.task.status,'Scheduled');assert.equal(first.data.task.occurrence,1);assert.equal(first.data.task.last_occurrence.note,'Done this week');assert.equal(retry.data.replayed,true);assert.equal(retry.data.task.occurrence,1);
 assert.equal(nextOccurrence('2027-01-31','monthly','2027-02-28'),'2027-03-31');
});
test('workflow waits three weeks, blocks dependent completion and automatically returns on the South African date',async t=>{
 const {call,task,db}=await fixture(t);const b=task({task_type:'workflow',pa_required:true,assigned_to:'alinda'});let r=await call('alex','/api/tasks',b);assert.equal(r.status,200);
 r=await send(call,b.task_id,1,'step_add',{step_id:'future',data:step('future',{due_date:'2099-11-30',status:'Scheduled',dependencies:['step-1']})});assert.equal(r.status,200);
 r=await send(call,b.task_id,2,'step_add',{step_id:'proof',data:step('proof',{dependencies:['future'],requires_evidence:true})});assert.equal(r.status,200);
 assert.equal((await send(call,b.task_id,3,'step_complete',{step_id:'proof'})).status,400);
 r=await send(call,b.task_id,3,'step_complete',{step_id:'step-1'});assert.equal(r.data.task.status,'Scheduled');assert.equal(r.data.task.steps[2].blocked,true);
 assert.equal(projectTask(r.data.task,'2099-11-29').status,'Scheduled');assert.equal(projectTask(r.data.task,'2099-11-30').status,'Pending');
 await queueTaskReminders(envFor(db),new Date('2099-11-29T06:00:00Z'));assert.equal((await db.prepare("SELECT COUNT(*) n FROM v2_task_notifications WHERE kind='step_due'").first()).n,0);
 await queueTaskReminders(envFor(db),new Date('2099-11-30T06:00:00Z'));await queueTaskReminders(envFor(db),new Date('2099-11-30T06:05:00Z'));
 const notices=(await db.prepare("SELECT * FROM v2_task_notifications WHERE kind='step_due'").all()).results;assert.equal(notices.length,1);assert.equal(currentTaskNotification(r.data.task,notices[0],new Date('2099-11-30T06:05:00Z')),true);
 r=await send(call,b.task_id,4,'step_complete',{step_id:'future'});assert.equal(r.data.task.status,'Pending');assert.equal((await send(call,b.task_id,5,'step_complete',{step_id:'proof'})).status,400);
 r=await send(call,b.task_id,5,'step_complete',{step_id:'proof',proof_url:'https://example.com/synthetic-proof'});assert.equal(r.data.task.status,'Complete');assert.equal(r.data.task.progress.done,3);
 const before=(await readTasksForPa(envFor(db),{username:'alex'},{resource:'pending_sync'})).tasks;assert.equal(before.length,1);
 await acknowledgeTask(envFor(db),{username:'alex'},{task_id:b.task_id,revision:6,pa_task_id:'TSK-99999',source_url:'https://docs.google.com/spreadsheets/d/synthetic/edit'});
 assert.equal((await readTasksForPa(envFor(db),{username:'alex'},{resource:'pending_sync'})).tasks.length,0);
});
test('waiting names the dependency and returns for follow-up; cycles and stale concurrent edits are rejected',async t=>{
 const {call,task}=await fixture(t),b=task({task_type:'workflow'});await call('alex','/api/tasks',b);
 const waiting={step_id:'step-1',data:{status:'Waiting',waiting_reason:'Supplier must confirm the invoice',due_date:'2099-12-01'}};
 const r=await send(call,b.task_id,1,'step_update',waiting);assert.equal(r.status,200);assert.equal(r.data.task.status,'Waiting');assert.equal(projectTask(r.data.task,'2099-12-01').status,'Pending');
 assert.equal((await send(call,b.task_id,1,'step_update',waiting)).status,409);
 assert.equal((await send(call,b.task_id,2,'step_update',{step_id:'step-1',data:{dependencies:['step-1']}})).status,400);
 assert.equal((await send(call,b.task_id,2,'complete')).status,400);
});
test('explicit migration preserves completed dispatch, PO identity, documents and original history',async t=>{
 const {call,task}=await fixture(t);const b=task({kind:'po_dispatch',assigned_to:'alinda',pa_task_id:'TSK-99998',parent_cycle_id:'TSK-99998',po_number:'PO-99998',po_revision:'synthetic-v1',document_url:'https://example.com/po'});await call('alex','/api/tasks',b);
 let r=await send(call,b.task_id,1,'complete',{po_revision:'synthetic-v1',channel:'WhatsApp',sent_at:new Date().toISOString(),note:'Synthetic dispatch confirmation'});assert.equal(r.status,200);
 const completion=r.data.task.completion;
 r=await send(call,b.task_id,2,'start_workflow',{note:'Explicit owner instruction to retain the supplier cycle',steps:[step('sent',{status:'Complete',completion}),step('received',{status:'Complete',completion:{...completion,note:'Owner confirms receipt'}}),step('checked',{status:'Complete',completion:{...completion,note:'Owner confirms checked documents'}}),step('statement',{status:'Scheduled',due_date:'2099-11-30',dependencies:['checked']}),step('payment',{dependencies:['statement'],requires_evidence:true})]});
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.task.status,'Scheduled');assert.equal(r.data.task.pa_task_id,'TSK-99998');assert.equal(r.data.task.po_number,'PO-99998');assert.deepEqual(r.data.task.legacy_completion,completion);
 const h=(await call('alex','/api/tasks/audit?id='+b.task_id)).data.history;assert.equal(h.length,3);assert.equal(h[1].task.status,'Complete');assert.deepEqual(h[1].task.completion,completion);
 const pa={rows:[{id:'TSK-99998',app_task_id:b.task_id,status:'Waiting',title:'Synthetic cycle',assigned_to:'alinda',review_date:'2099-11-30'}],feedback:[]},app={today:'2099-11-12',tasks:[r.data.task]};
 const rows=unifiedWork(app,pa);assert.equal(rows.length,1);assert.equal(rows[0].status,'Scheduled');assert.equal(selectWork(rows,{username:'alinda',status:'open'}).length,0);assert.equal(selectWork(rows,{username:'alinda',status:'scheduled'}).length,1);
});
test('reminder conversion is explicit, preserves ID and can opt into PA without a duplicate task',async t=>{
 const {call,task,db}=await fixture(t),b=task({task_type:'reminder'});await call('alex','/api/tasks',b);
 const r=await send(call,b.task_id,1,'start_workflow',{pa_required:true,note:'Investigation requested'});assert.equal(r.data.task.id,b.task_id);assert.equal(r.data.task.task_type,'workflow');assert.equal((await readTasksForPa(envFor(db),{username:'alex'},{resource:'pending_sync'})).tasks.length,1);
});
test('register patches preserve untouched and completed rows; retries and stale writes cannot create loops',async t=>{
 const {db}=await fixture(t),env=envFor(db),user={username:'alex',via:'pa'},source_url='https://docs.google.com/spreadsheets/d/synthetic/edit';
 const row=(id,status)=>({id,scope:'fenmeat',area:'Fen Meat',title:'Synthetic '+id,status,assigned_to:'alinda',source_url});
 const first={operation:'register',revision:0,request_id:crypto.randomUUID(),reason:'Synthetic register test',data:{source_at:new Date().toISOString(),source_url,rows:[row('TSK-99997','Pending'),row('TSK-99998','Complete')]}};
 await savePaReport(env,user,first);const patch={...first,operation:'register_patch',revision:1,request_id:crypto.randomUUID(),data:{...first.data,rows:[row('TSK-99997','Scheduled')]}};
 await savePaReport(env,user,patch);assert.equal((await savePaReport(env,user,patch)).replayed,true);
 const read=await readPaReport(env,user);assert.equal(read.rows.length,2);assert.equal(read.rows.find(r=>r.id==='TSK-99998').status,'Complete');assert.equal(read.register_revision,2);
 await assert.rejects(()=>savePaReport(env,user,{...patch,request_id:crypto.randomUUID()}));
});
test('step assignees can act on their own steps and unrelated staff cannot read them',async t=>{
 const {call,task}=await fixture(t),b=task({task_type:'workflow',assigned_to:'alinda'});await call('alex','/api/tasks',b);
 await send(call,b.task_id,1,'step_add',{step_id:'delegated',data:step('delegated',{assigned_to:'xavier'})});
 assert.equal((await call('xavier','/api/tasks')).data.tasks.length,1);assert.equal((await call('xalinda','/api/tasks')).data.tasks.length,0);
 const body={task_id:b.task_id,revision:2,action:'step_complete',request_id:crypto.randomUUID(),step_id:'step-1'};assert.equal((await call('xavier','/api/tasks',body)).status,403);
 assert.equal((await call('xavier','/api/tasks',{...body,request_id:crypto.randomUUID(),step_id:'delegated'})).status,200);
});

test('audited restoration appends a revision without deleting later evidence or history',async t=>{
 const {call,task,db}=await fixture(t),b=task({task_type:'reminder'});await call('alex','/api/tasks',b);await send(call,b.task_id,1,'start_workflow',{note:'Explicit conversion'});
 const restored=await send(call,b.task_id,2,'restore_task_revision',{restore_revision:1,note:'Verified rollback rehearsal'});assert.equal(restored.status,200);assert.equal(restored.data.task.task_type,'reminder');assert.equal(restored.data.task.revision,3);
 const h=(await call('alex','/api/tasks/audit?id='+b.task_id)).data.history;assert.equal(h.length,3);assert.equal(h[1].task.task_type,'workflow');
});
test('personal reminder changes do not requeue an already acknowledged workflow',async t=>{
 const {call,task,db}=await fixture(t),b=task({task_type:'workflow',pa_required:true});await call('alex','/api/tasks',b);
 await acknowledgeTask(envFor(db),{username:'alex'},{task_id:b.task_id,revision:1,pa_task_id:'TSK-99996',source_url:'https://docs.google.com/spreadsheets/d/synthetic/edit'});
 await send(call,b.task_id,1,'reminder',{data:{reminder_mode:'off'}});
 assert.equal((await readTasksForPa(envFor(db),{username:'alex'},{resource:'pending_sync'})).tasks.length,0);
 await send(call,b.task_id,2,'step_update',{step_id:'step-1',data:{description:'Changed meaningful work'}});
 assert.equal((await readTasksForPa(envFor(db),{username:'alex'},{resource:'pending_sync'})).tasks.length,1);
});
