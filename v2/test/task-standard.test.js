import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {stepProgress,standardSteps,projectTask,supplierSteps} from '../src/task-workflow.js';

test('a sourced dispatch remains complete when the overdue payment moves to Alinda',()=>{
 const task={kind:'po_dispatch',task_type:'workflow',assigned_to:'alinda',status:'Pending'};
 task.steps=supplierSteps(task).map((s,i)=>({...s,status:i<3?'Complete':'Pending',due_date:i===3?'2026-11-20':''}));
 const current=projectTask(task,'2026-11-24');
 assert.deepEqual(current.progress,{done:3,total:5,remaining:2,percent:60,overdue:1});
 assert.equal(current.next_assigned_to,'alinda');assert.equal(current.steps[4].blocked,true);
 task.steps[3].due_date='2026-11-30';assert.equal(projectTask(task,'2026-11-24').status,'Scheduled');
});
test('migration preserves recurrence and a waiver unlocks dependent work without recording performance',async t=>{
 const {call,task,db}=await fixture(t);
 const b=task({task_type:'reminder',repeat:'monthly'});
 await call('alex','/api/tasks',b);
 await db.prepare("UPDATE v2_task_events SET payload=json_remove(payload,'$.step_format','$.native_step') WHERE task_id=?").bind(b.task_id).run();
 const change={task_id:b.task_id,revision:1,request_id:crypto.randomUUID(),action:'standardize_task',note:'Bestaande herinnering met dieselfde skedule.'};
 const migrated=await call('alex','/api/tasks',change);assert.equal(migrated.status,200);
 assert.equal(migrated.data.task.repeat,'monthly');assert.equal(migrated.data.task.native_step.id,'current');
 assert.equal((await call('alex','/api/tasks',change)).data.task.revision,2);
 assert.equal(stepProgress(standardSteps(migrated.data.task)).total,1);
 const w=task({task_type:'workflow',steps:['a','b'].map((id,i)=>({id,description:id,assigned_to:'alex',status:'Pending',dependencies:i?['a']:[]}))});
 await call('alex','/api/tasks',w);
 const waive={action:'step_waive',task_id:w.task_id,step_id:'a',revision:1,request_id:crypto.randomUUID(),note:'Kliënt het dié deel gekanselleer.'};
 const saved=await call('alex','/api/tasks',waive);assert.equal(saved.status,200);
 const result=saved.data.task;assert.equal(result.steps[0].completion,null);assert.equal(result.steps[0].waiver.reason,waive.note);
 assert.equal(result.progress.done,0);assert.equal(result.progress.remaining,1);assert.equal(result.next_action,'b');
});
