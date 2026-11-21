import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {savePaReport} from '../src/pa-report-api.js';
import {taskBrief} from '../src/task-workflow.js';
import {today} from '../src/domain.js';

test('canonical owner, private answers, partial completion and older publishers', async t=>{
 const {call,db}=await fixture(t);
 const env={DB:db,APP_ACCESS_KEYS:JSON.stringify(Object.fromEntries(['alex','alinda','xalinda','xavier'].map(u=>[u,'synthetic'.repeat(6)])))};
 const source='https://docs.google.com/spreadsheets/d/example/edit';
 const r={id:'TSK-00991',title:'Vergelyk drie pryse',scope:'fenmeat',area:'Fen Meat',status:'Pending',assigned_to:'alex',source_url:source,
  next_action:'Vergelyk die drie pryse.',responsibility:{owner:'pa',action:'Vergelyk die drie pryse.',situation:'Ons benodig ’n prys vir die begroting.',version:1}};
 const s={...r,id:'TSK-00992',assigned_to:'xavier',responsibility:{...r.responsibility,owner:'xavier'}};
 const publish=(revision,rows,operation='register')=>savePaReport(env,{username:'alex',via:'pa'},{operation,revision,reason:'Test existing row',request_id:crypto.randomUUID(),data:{source_at:new Date().toISOString(),source_url:source,rows}});
 await publish(0,[r,s]);
 const list=async(user,scope)=>(await call(user,'/api/tasks/workspace?scope='+scope)).data.pa.workspace.rows;
 assert.equal((await list('alex','mine')).length,0);
 assert.equal((await list('alex','pa'))[0].id,r.id);
 assert.equal(taskBrief((await list('alex','pa'))[0],'alex').action,'Niks op hierdie stadium nie');
 assert.equal((await list('xavier','mine'))[0].id,s.id);
 assert.equal((await list('xavier','pa')).length,0);
 for(const op of ['register','register_patch']){
  const old={...r,title:'Old words'};delete old.responsibility;
  await assert.rejects(publish(1,op==='register'?[old,s]:[old],op),/bygewerkte taakbeskrywing/);
 }
 const sourceRow=(await list('xavier','mine'))[0];
 const part=await call('xavier','/api/pa-report/feedback',{subject_key:s.id,subject_hash:sourceRow.subject_hash,action:'complete',completion_scope:'part',request_id:crypto.randomUUID()});
 assert.equal(part.status,200);
 assert.equal((await list('xavier','mine')).length,0);
 assert.equal((await list('xavier','pa'))[0].part_pending,true);
 assert.equal((await list('xavier','pa'))[0].status,'Pending');
});

test('new PA work waits for its turn, human tasks stay personal and a reported share stays open',async t=>{
 const {call,task}=await fixture(t);
 const created=await call('alex','/api/tasks',task({task_type:'reminder',assigned_to:'alex',due_date:today(),details:'Vergelyk pryse.',pa_does_work:true}));
 assert.equal(created.status,200,JSON.stringify(created.data));
 assert.equal(created.data.task.pa_work[0].status,'queued');
 const list=async(scope)=>(await call('alex','/api/tasks/workspace?scope='+scope)).data.pa.workspace.rows;
 assert.equal((await list('mine')).length,0);
 assert.equal((await list('pa'))[0].title,created.data.task.title);
 const other=(await call('alex','/api/tasks',task({task_type:'reminder',assigned_to:'alex',due_date:today()}))).data.task;
 const part=await call('alex','/api/tasks',{action:'note',task_id:other.id,revision:other.revision,request_id:crypto.randomUUID(),completion_scope:'part',note:'Dokument is geteken.'});
 assert.equal(part.status,200,JSON.stringify(part.data));
 assert.equal(part.data.task.status,'Pending');assert.equal(part.data.task.part_confirmation.note,'Dokument is geteken.');
 assert.equal((await list('mine')).length,0);
 const denied=await call('alinda','/api/tasks',{action:'note',task_id:other.id,revision:part.data.task.revision,request_id:crypto.randomUUID(),completion_scope:'part',note:'Signed.'});
 assert.equal(denied.status,403);
});

import {unifiedWork} from '../public/pa-report-model.js';
import {taskOwner} from '../src/task-workflow.js';
test('keep ownership through wording edits and show outstanding dispatch evidence on a closed case',()=>{
 const r={id:'TSK-00993',scope:'fenmeat',area:'Fen Meat',title:'Confirm old delivery',status:'Pending',assigned_to:'alex',responsibility:{owner:'pa',version:1}};
 const task={id:'example-stage',kind:'general',title:'Edited words',status:'Pending',assigned_to:'alex',pa_task_id:r.id,pa_sync:{status:'pending'},last_edit:{changes:[{field:'title'}]}};
 const combine=(r,t)=>unifiedWork({tasks:[t]}, {rows:[r]});
 assert.equal(taskOwner(combine(r,task)[0]),'pa');
 const rows=combine({...r,status:'Complete'},{...task,kind:'po_dispatch'});
 assert.equal(rows.length,2);assert.equal(rows[0].status,'Complete');assert.equal(rows[1].id,task.id);
});
