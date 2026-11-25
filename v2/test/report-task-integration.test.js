import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {savePaReport,readPaReport} from '../src/pa-report-api.js';
import {saveTask,readTasksForPa,acknowledgeTask} from '../src/tasks-api.js';
import {readTaskWorkspace} from '../src/task-workspace.js';
const source='https://docs.google.com/spreadsheets/d/synthetic/edit';
test('private workflow, report navigation, one conversation, search, reminders and privacy remain integrated',async t=>{
 const f=await fixture(t),env={DB:f.db,APP_ACCESS_KEYS:JSON.stringify(Object.fromEntries(['alex','alinda','xalinda','xavier','tapiz'].map(u=>[u,'synthetic-'+u+'-'.repeat(40)])))};
 const actor={username:'alex',via:'pa'},id='TSK-00999';
 const publish=(operation,data,revision=0,request_id=crypto.randomUUID())=>savePaReport(env,actor,{operation,data,revision,request_id,reason:'Authorised synthetic integration test'});
 const row={id,scope:'private',area:'Personal',title:'Tandartsstaat — Voorbaai Dental Studio',assigned_to:'alex',status:'Pending',priority:'Normal',next_action:'Kontroleer die staat.',review_group:'Tandarts',source_url:source,app_task_id:'private-'+id};
 await publish('register',{source_at:new Date().toISOString(),source_url:source,rows:[row]});
 const beforeCreate={date:new Date().toISOString().slice(0,10),source_at:new Date().toISOString(),source_url:source,register_revision:1,sections:['emails','activity','tasks','tomorrow','rabbi'].map((section,n)=>({id:section,title:section,items:[{id:'before-'+n,title:'Before native save',text:'Pending task creation',requires_action:n===0,pa_task_ids:n===0?[id]:[]}]}))};
 await assert.rejects(publish('report',beforeCreate),/nie gestoor/);
 const create={pa_task_id:id,action:'create',data:{title:row.title,task_type:'workflow',require_final_approval:true,details:'Persoonlike staat',reminder_mode:'off',steps:[{id:'check',description:'Kontroleer die staat',assigned_to:'pa',status:'Pending'},{id:'confirm',description:'Bevestig afhandeling',assigned_to:'alex',status:'Pending',dependencies:['check']}]}};
 const req=crypto.randomUUID(),created=await publish('private_task',create,0,req);assert.equal(created.task.visibility,'private');assert.equal((await publish('private_task',create,0,req)).replayed,true);
 const taskId=created.task.id;
 await assert.rejects(readTasksForPa(env,{username:'alinda'},{task_id:taskId}),/not found/);
 await assert.rejects(acknowledgeTask(env,{username:'alinda'},{task_id:taskId,revision:1,pa_task_id:id,source_url:source}),/not found/);
 for(const user of ['alinda','xavier','xalinda','tapiz']){
  assert.ok([403,404].includes((await f.call(user,'/api/tasks?id='+taskId)).status));
  assert.ok([403,404].includes((await f.call(user,'/api/tasks/audit?id='+taskId)).status));
  assert.doesNotMatch(JSON.stringify((await f.call(user,'/api/tasks')).data),/Tandartsstaat|Persoonlike staat/);
  assert.doesNotMatch(JSON.stringify((await f.call(user,'/api/tasks/workspace?scope=all&status=all&search=Tandarts')).data),/Tandartsstaat|Persoonlike staat/);
 }
 const report={date:new Date().toISOString().slice(0,10),source_at:new Date().toISOString(),source_url:source,register_revision:1,sections:['emails','activity','tasks','tomorrow','rabbi'].map((section,n)=>({id:section,title:section,items:[{id:'item-'+n,title:n?'Inligting':'Tandarts',text:'Geverifieerde verslaginhoud',requires_action:n===0,pa_task_ids:n===0?[id]:[]}]}))};
 const broken=structuredClone(report);broken.sections[0].items[0].pa_task_ids=[];
 await assert.rejects(publish('report',broken),/koppel eers/);
 const unknown=structuredClone(report);unknown.sections[0].items[0].pa_task_ids=[];unknown.sections[0].items[0].app_task_ids=['nonexistent-task'];
 await assert.rejects(publish('report',unknown),/nie gestoor/);
 await publish('report',report);
 let current=(await f.call('alex','/api/pa-report')).data;
 assert.equal(current.report.sections[0].items[0].linked_tasks[0].app_task_id,taskId);
 const link=current.report.sections[0].items[0],subject=current.rows[0];
 const workspace=await readTaskWorkspace(env,{username:'alex'},{scope:'private',status:'all'});assert.equal(workspace.pa.rows[0].subject_hash,subject.subject_hash);
 assert.equal((await f.call('alex','/api/pa-report/feedback',{subject_key:id,subject_hash:workspace.pa.rows[0].subject_hash,action:'respond',note:'Same task from workspace',request_id:crypto.randomUUID()})).status,200);
 assert.equal((await f.call('alex','/api/pa-report/feedback',{subject_key:link.subject_key,subject_hash:link.subject_hash,action:'respond',note:'Parallel thread must be rejected',request_id:crypto.randomUUID()})).status,400);
 const feedback={subject_key:id,subject_hash:subject.subject_hash,action:'respond',note:'Wat is die volgende stap?',request_id:crypto.randomUUID()};
 assert.equal((await f.call('alex','/api/pa-report/feedback',feedback)).status,200);
 assert.equal((await f.call('alex','/api/pa-report/conversation?subject_key='+id)).data.feedback.at(-1).note,feedback.note);
 const reminder={...feedback,request_id:crypto.randomUUID(),action:'remind',note:'',remind_at:new Date(Date.now()+3600000).toISOString()};
 assert.equal((await f.call('alex','/api/pa-report/feedback',reminder)).status,200);
 assert.equal((await f.call('alex','/api/pa-report')).data.reminders[0].subject_key,id);
 for(const search of [id,'Voorbaai','staat']){const r=await readTaskWorkspace(env,{username:'alex'},{scope:'all',status:'all',search});assert.equal(r.pa.workspace.rows.length,1);assert.equal(r.pa.workspace.rows[0].id,id);}
 const deep=await readTaskWorkspace(env,{username:'alex'},{scope:'fenmeat',status:'closed',search:'nothing',case:id});assert.equal(deep.pa.workspace.rows[0].id,id);
 await assert.rejects(saveTask(env,actor,{task_id:taskId,revision:1,request_id:crypto.randomUUID(),action:'update',data:{visibility:'operational'}}),/bly privaat/);
 await assert.rejects(saveTask(env,actor,{task_id:taskId,revision:1,request_id:crypto.randomUUID(),action:'step_update',step_id:'check',data:{assigned_to:'alinda'}}),/net by Alex/);
 await saveTask(env,actor,{task_id:taskId,revision:1,request_id:crypto.randomUUID(),action:'step_complete',step_id:'check',note:'Kontrole klaar'});
 current=(await f.call('alex','/api/pa-report')).data;assert.equal(current.report.sections[0].items[0].linked_tasks[0].assigned_to,'alex');
 await saveTask(env,actor,{task_id:taskId,revision:2,request_id:crypto.randomUUID(),action:'step_complete',step_id:'confirm',note:'Afhandeling bevestig'});
 await saveTask(env,actor,{task_id:taskId,revision:3,request_id:crypto.randomUUID(),action:'approve_workflow',note:'Volledig nagegaan'});
 current=(await f.call('alex','/api/pa-report')).data;assert.equal(current.report.sections[0].items[0].linked_tasks[0].status,'Complete');
 const open=await readTaskWorkspace(env,{username:'alex'},{scope:'private',status:'open'});assert.equal(open.pa.workspace.total,0);
 assert.equal((await f.db.prepare('SELECT COUNT(DISTINCT task_id) n FROM v2_task_events').first()).n,1);
});


test('historical linking retains original replies, files and a single current reminder',async t=>{
 const f=await fixture(t),env={DB:f.db,APP_ACCESS_KEYS:JSON.stringify({alex:'synthetic-alex-'+ '-'.repeat(40),alinda:'synthetic-alinda-'+ '-'.repeat(40)})},actor={username:'alex',via:'pa'};
 const pub=(operation,data,revision=0)=>savePaReport(env,actor,{operation,data,revision,request_id:crypto.randomUUID(),reason:'Repair existing report links'});
 const id='TSK-00888',row={id,scope:'private',area:'Personal',title:'Private follow-up',assigned_to:'alex',status:'Pending',source_url:source};
 await pub('register',{source_at:new Date().toISOString(),source_url:source,rows:[row]});
 const date=new Date().toISOString().slice(0,10),report={date,source_at:new Date().toISOString(),source_url:source,register_revision:1,sections:['emails','activity','tasks','tomorrow','rabbi'].map(section=>({id:section,title:section,items:[{id:section,title:'Original text',text:'Original dated narrative',requires_action:false}]}))};
 await pub('report',report);
 const point=(await f.call('alex','/api/pa-report')).data.report.sections[0].items[0];
 const old={subject_key:point.subject_key,subject_hash:point.subject_hash,request_id:crypto.randomUUID(),action:'respond',note:'Original conversation'};
 assert.equal((await f.call('alex','/api/pa-report/feedback',old)).status,200);
 const reminder={...old,request_id:crypto.randomUUID(),action:'remind',remind_at:new Date(Date.now()+3600000).toISOString()};assert.equal((await f.call('alex','/api/pa-report/feedback',reminder)).status,200);
 const fileId=crypto.randomUUID();assert.equal((await f.call('alex','/api/pa-report/file',{id:fileId,subject_key:point.subject_key,subject_hash:point.subject_hash,mime_type:'application/pdf',filename:'proof.pdf',base64:btoa('%PDF-1.4 synthetic')})).status,200);
 await pub('report_links',{date,items:[{id:'emails',pa_task_ids:[id]}]},1);
 const current=(await f.call('alex','/api/pa-report')).data;
 assert.equal(current.report.sections[0].items[0].text,'Original dated narrative');assert.equal(current.reminders.length,1);assert.equal(current.reminders[0].subject_key,id);
 const conversation=(await f.call('alex','/api/pa-report/conversation?subject_key='+id)).data;
 assert.ok(conversation.feedback.some(f=>f.note==='Original conversation'));
 assert.equal((await readPaReport(env,actor,{resource:'file',id:fileId})).filename,'proof.pdf');
 assert.equal((await f.call('alinda','/api/pa-report/conversation?subject_key='+id)).status,404);
 assert.equal((await f.call('alinda','/api/pa-report/file?id='+fileId)).status,404);
});
