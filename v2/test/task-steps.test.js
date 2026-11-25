import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {projectTask,stepReminder} from '../src/task-workflow.js';
import {readTaskWorkspace} from '../src/task-workspace.js';
import {queueTaskReminders} from '../src/tasks-push.js';
const env=db=>({DB:db,APP_ACCESS_KEYS:JSON.stringify(Object.fromEntries(['alex','alinda','xavier','xalinda'].map(u=>[u,'synthetic-'+u+'-'.repeat(40)])))});
const file=()=>({id:crypto.randomUUID(),filename:'synthetic-scan.pdf',mime_type:'application/pdf',base64:btoa('%PDF-1.4\nSynthetic test\n%%EOF')});
const steps=()=>['alex','alinda','xavier','xavier','alex'].map((assigned_to,i)=>({id:'step-'+i,description:'Synthetic step '+i,assigned_to,due_date:'2026-11-18',status:'Pending',reminder_mode:'due',notes:'Note '+i}));
test('five delegated steps retain one task, own lists, evidence, revisions, final approval and reopened history',async t=>{
 const {call,task,db}=await fixture(t),scan=file(),items=steps();items[3].files=[scan];
 const b=task({task_type:'workflow',require_final_approval:true,assigned_to:'alex',steps:items,pa_required:true,reminder_mode:'off'});
 let r=await call('alex','/api/tasks',b);assert.equal(r.status,200,JSON.stringify(r.data));let saved=r.data.task;
 assert.equal(saved.steps.length,5);assert.equal(saved.progress.percent,0);assert.deepEqual(saved.steps[3].attachments,[scan.id]);assert.equal((await call('alex','/api/tasks',b)).data.replayed,true);
 assert.equal((await db.prepare('SELECT COUNT(DISTINCT task_id) n FROM v2_task_events').first()).n,1);
 for(const u of ['alex','alinda','xavier']){const list=(await call(u,'/api/tasks?mine=1')).data;assert.equal(list.tasks.length,1);assert.equal(list.tasks[0].id,saved.id);}
 assert.equal((await call('xalinda','/api/tasks?id='+saved.id)).status,404);
 const save=async(user,action,extra={})=>{const result=await call(user,'/api/tasks',{task_id:saved.id,revision:saved.revision,request_id:crypto.randomUUID(),action,...extra});if(result.status===200)saved=result.data.task;return result;};
 assert.equal((await save('xavier','step_complete',{step_id:'step-0'})).status,403);
 assert.equal((await save('alex','approve_workflow')).status,400);
 await save('xavier','step_start',{step_id:'step-2'});assert.equal(saved.steps.find(s=>s.id==='step-2').status,'In Progress');
 const proof=file();await save('xavier','step_note',{step_id:'step-2',note:'Working with scan',files:[proof]});assert.equal(saved.steps.find(s=>s.id==='step-2').attachments[0],proof.id);
 await save('alex','step_update',{step_id:'step-1',data:{assigned_to:'xavier',due_date:'2026-11-19'}});assert.equal(saved.steps[1].assigned_to,'xavier');
 assert.equal((await call('alinda','/api/tasks?mine=1')).data.tasks.length,0);
 const ordered=['step-4','step-0','step-1','step-2','step-3'];await save('alex','step_reorder',{step_ids:ordered});assert.deepEqual(saved.steps.map(s=>s.id),ordered);
 for(const id of ['step-4','step-0','step-1']){const step=saved.steps.find(s=>s.id===id);await save(step.assigned_to,'step_complete',{step_id:id,note:'Verified'});}
 saved=(await call('alex','/api/tasks?id='+saved.id)).data.task;assert.equal(saved.progress.percent,60);assert.equal(saved.progress.remaining,2);assert.equal(saved.status,'Pending');
 for(const id of ['step-2','step-3'])await save('xavier','step_complete',{step_id:id});
 saved=(await call('alex','/api/tasks?id='+saved.id)).data.task;assert.equal(saved.progress.percent,100);assert.equal(saved.ready_for_approval,true);assert.equal(saved.status,'Pending');assert.equal(saved.completion,null);
 assert.equal((await save('xavier','approve_workflow')).status,403);assert.equal((await save('alinda','approve_workflow')).status,403);
 await save('alex','approve_workflow',{note:'All five checked'});assert.equal(saved.status,'Complete');assert.equal(saved.approval.by,'alex');
 const completion=saved.steps.find(s=>s.id==='step-2').completion;assert.equal(completion.by,'xavier');assert.ok(completion.at);
 await save('alex','step_reopen',{step_id:'step-2',note:'Further check needed'});assert.equal(saved.status,'Pending');assert.equal(saved.approval,null);assert.equal(saved.progress.percent,80);
 const history=(await call('alex','/api/tasks/audit?id='+saved.id)).data.history;assert.ok(history.some(h=>h.task.approval?.note==='All five checked'));assert.ok(history.some(h=>h.task.steps.find(s=>s.id==='step-2')?.completion?.at===completion.at));
 const workspace=await readTaskWorkspace(env(db),{username:'xavier'},{scope:'mine',status:'open'});assert.equal(workspace.pa.workspace.rows.length,1);assert.ok(workspace.pa.workspace.rows[0].steps.every(s=>s.assigned_to==='xavier'));
 const notices=(await db.prepare("SELECT * FROM v2_task_notifications WHERE kind='step_completed'").all()).results;assert.ok(notices.some(n=>n.username==='alex'));assert.ok(!notices.some(n=>n.username==='alinda'));
});
test('step reminders are independent, deduplicated, overdue-aware and invalidated by changed dates',async t=>{
 const {call,task,db}=await fixture(t),items=steps().slice(0,3);items[2].reminder_mode='off';
 const r=await call('alex','/api/tasks',task({task_type:'workflow',require_final_approval:true,assigned_to:'alex',steps:items,reminder_mode:'off'}));assert.equal(r.status,200);
 for(const time of ['2026-11-18T06:00:00Z','2026-11-18T06:05:00Z','2026-11-19T06:00:00Z','2026-11-19T06:05:00Z','2026-11-20T06:05:00Z'])await queueTaskReminders(env(db),new Date(time));
 const notices=(await db.prepare("SELECT * FROM v2_task_notifications WHERE kind IN ('due','step_due','step_overdue')").all()).results;
 assert.equal(notices.filter(n=>n.kind==='step_due').length,2);assert.equal(notices.filter(n=>n.kind==='step_overdue').length,2);assert.equal(notices.filter(n=>n.kind==='due').length,0);
 const now=new Date('2026-11-19T06:05:00Z'),taskView=projectTask(r.data.task,'2026-11-19');assert.equal(taskView.progress.overdue,3);
 assert.notEqual(stepReminder(taskView,{...taskView.steps[0],due_date:'2026-11-19'},now).id,stepReminder(taskView,taskView.steps[0],now).id);
});
test('delete requires confirmation and cannot break dependencies; legacy completion stays closed',async t=>{
 const {call,task,db}=await fixture(t),items=steps().slice(0,2);items[1].dependencies=['step-0'];
 let r=await call('alex','/api/tasks',task({task_type:'workflow',steps:items}));const id=r.data.task.id;
 const save=(revision,action,extra)=>call('alex','/api/tasks',{task_id:id,revision,request_id:crypto.randomUUID(),action,...extra});
 assert.equal((await save(1,'step_delete',{step_id:'step-1',note:'No confirmation'})).status,400);
 assert.equal((await save(1,'step_delete',{step_id:'step-0',confirm:true,note:'Would break dependency'})).status,400);
 r=await save(1,'step_delete',{step_id:'step-1',confirm:true,note:'Duplicate obligation'});assert.equal(r.status,200);assert.equal(r.data.task.steps.length,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_task_events WHERE task_id=?').bind(id).first()).n,2);
 assert.equal(projectTask({task_type:'workflow',status:'Complete',completion:{by:'alex',at:'2026-11-17T12:00:00Z'},steps:[{...items[0],status:'Complete'}]}).status,'Complete');
 const bad=task({task_type:'workflow',assigned_to:'xavier',steps:[{...items[0],assigned_to:'alinda'}]});assert.equal((await call('xavier','/api/tasks',bad)).status,200);
});

test('PA day report reads current workflow progress and approval without an extra PA task',async t=>{
 const {readPaReport}=await import('../src/pa-report-api.js');const {call,task,db}=await fixture(t);
 const r=await call('alex','/api/tasks',task({task_type:'workflow',assigned_to:'alex',steps:steps()}));
 const context=await readPaReport(env(db),{username:'alex'},{resource:'summary',id:'report-context'});
 assert.equal(context.task_steps.items[0].task_id,r.data.task.id);assert.equal(context.task_steps.items[0].steps.length,5);assert.equal(context.task_steps.items[0].progress.remaining,5);
 const page=await readPaReport(env(db),{username:'alex'},{resource:'summary',id:'task-steps',offset:0});assert.deepEqual(page,context.task_steps);
 await assert.rejects(()=>readPaReport(env(db),{username:'alinda'},{resource:'summary',id:'task-steps'}));
});
