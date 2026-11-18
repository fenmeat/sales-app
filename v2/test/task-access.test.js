import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {visiblePaRows} from '../src/pa-report-api.js';

const managers=['alex','alinda','xalinda','xavier'];
const file=()=>({id:crypto.randomUUID(),filename:'test-scan.pdf',mime_type:'application/pdf',base64:btoa('%PDF-1.4\nFixture\n%%EOF')});
test('four signed-in managers can run ordinary tasks and steps without sharing admin powers',async t=>{
 const {call,task,db}=await fixture(t);
 const secret=task({visibility:'confidential',assigned_to:'alinda',title:'Protected',pa_task_id:'TSK-00999'});
 assert.equal((await call('alex','/api/tasks',secret)).status,200);
 for(const [index,user] of managers.entries()){
  const other=managers[(index+1)%4];
  const make=task({visibility:'operational',assigned_to:'tapiz',title:'Order labels '+user,priority:'High',due_date:'2099-11-23'});
  const create=await call(user,'/api/tasks',make);assert.equal(create.status,200,JSON.stringify(create.data));
  let saved=create.data.task;
  async function act(action,fields={},actor=user){
   const r=await call(actor,'/api/tasks',{task_id:saved.id,revision:saved.revision,request_id:crypto.randomUUID(),action,...fields});
   assert.equal(r.status,200,JSON.stringify(r.data));saved=r.data.task;
  }
  const list=await call(other,'/api/tasks/workspace?scope=fenmeat&status=all&person=tapiz&date=2099-11-23&priority=High&search='+encodeURIComponent(make.data.title));
  assert.deepEqual(list.data.pa.workspace.rows.map(r=>r.id),[saved.id]);
  assert.ok(list.data.app.users.includes('mosa'));
  assert.equal(list.data.app.admin,['alex','alinda'].includes(other));
  await act('update',{data:{assigned_to:user,review_date:'2099-11-24',reminder_mode:'once',reminder_at:'2099-11-23T06:00:00.000Z'}},other);
  const scan=file();await act('note',{note:'Scan on existing task',files:[scan]},other);
  assert.ok(saved.attachments.includes(scan.id));
  await act('complete');await act('reopen',{note:'New information'},other);await act('cancel',{note:'Cancelled'},other);await act('reopen',{note:'Rescheduled'});
  await act('start_workflow',{note:'Two deliveries',steps:['tapiz','mosa'].map((assigned_to,i)=>({id:'step-'+i,assigned_to,description:'Delivery '+i,status:'Pending'}))});
  await act('step_update',{step_id:'step-0',data:{assigned_to:other,due_date:'2099-11-25'}});
  const proof=file();await act('step_note',{step_id:'step-1',note:'Package scanned',files:[proof]},other);
  for(const step of saved.steps)await act('step_complete',{step_id:step.id});
  await act('approve_workflow',{},other);assert.equal(saved.status,'Complete');
  const finishedSteps=structuredClone(saved.steps),approval=structuredClone(saved.approval);
  const reopened={task_id:saved.id,revision:saved.revision,request_id:crypto.randomUUID(),action:'reopen',note:'Check final approval again'};
  let result=await call(user,'/api/tasks',reopened);
  assert.equal(result.status,200,JSON.stringify(result.data));
  saved=result.data.task;
  assert.equal(saved.status,'Pending');assert.equal(saved.ready_for_approval,true);
  assert.equal(saved.approval,null);assert.deepEqual(saved.steps,finishedSteps);
  assert.equal((await call(user,'/api/tasks',reopened)).data.replayed,true);
  await act('approve_workflow',{},other);
  await act('cancel',{note:'Cancelled after approval'},other);
  await act('reopen',{note:'Resume the task'},other);
  assert.equal(saved.status,'Pending');assert.equal(saved.ready_for_approval,true);
  assert.equal(saved.approval,null);assert.deepEqual(saved.steps,finishedSteps);
  const audit=(await call(user,'/api/tasks/audit?id='+saved.id)).data;
  assert.ok(audit.history.some(h=>h.task.approval?.at===approval.at));
  await act('step_reopen',{step_id:'step-1',note:'Another check needed'});
  assert.equal(saved.progress.percent,50);assert.equal(saved.id,make.task_id);
  assert.ok((await call(user,'/api/tasks/audit?id='+saved.id)).data.history.some(r=>r.action==='approve_workflow'));
  const admin=['alex','alinda'].includes(user);
  assert.equal((await call(user,'/api/tasks?id='+secret.task_id)).status,admin?200:404);
  if(!admin){
   assert.equal((await call(user,'/api/financial')).status,403);
   assert.equal((await call(user,'/api/tasks/emails')).status,403);
   assert.equal((await call(user,'/api/tasks',{action:'set_visibility',revision:saved.revision,task_id:saved.id,request_id:crypto.randomUUID(),data:{visibility:'assigned'},note:'Change access'})).status,403);
   assert.deepEqual(await visiblePaRows({DB:db},{username:user},[{scope:'fenmeat',id:'TSK-00999',assigned_to:user}]),[]);
  }
 }
 assert.equal((await db.prepare('SELECT COUNT(DISTINCT task_id) n FROM v2_task_events').first()).n,5);
});
