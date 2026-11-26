import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {savePaReport,visiblePaRows} from '../src/pa-report-api.js';
import {readTasksForPa,acknowledgeTask} from '../src/tasks-api.js';
import {queueTaskReminders} from '../src/tasks-push.js';
import {createTaskDraftStorage} from '../public/task-workspace-cache.js';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('restoring a formerly shared revision cannot remove private protection',async t=>{
 const f=await fixture(t),b=f.task({assigned_to:'alex',visibility:'operational'});
 assert.equal((await f.call('alex','/api/tasks',b)).status,200);
 const change={task_id:b.task_id,revision:1,request_id:crypto.randomUUID(),action:'set_visibility',data:{visibility:'private'},note:'Owner private now'};
 assert.equal((await f.call('alex','/api/tasks',change)).status,200);
 const restore=await f.call('alex','/api/tasks',{task_id:b.task_id,revision:2,request_id:crypto.randomUUID(),action:'restore_task_revision',restore_revision:1,note:'Restore old instructions'});
 assert.equal(restore.status,403);
 assert.equal((await f.call('alinda','/api/tasks?id='+b.task_id)).status,404);
 assert.equal((await f.call('alex','/api/tasks?id='+b.task_id)).data.task.revision,2);
});

test('signed-in owner, managers, registered rep phones, extra account and anonymous access use the full privacy boundary',async t=>{
 const f=await fixture(t,{extraUsers:['musa','mosa','extra_user']});
 for(const rep of ['tapiz','musa']){
  const invite=await f.call('alex','/api/invoicing/phones',{action:'create',rep});assert.equal(invite.status,200);
  const enrolled=await f.call('','/api/invoicing/access/enroll',{code:invite.data.code,pin:'704862',pin_confirm:'704862'});assert.equal(enrolled.status,200);
  f.cookies[rep]=enrolled.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  if(rep==='musa'){assert.equal(enrolled.data.username,'mosa');f.cookies.mosa=f.cookies.musa;}
 }
 const others=['alinda','xavier','xalinda','tapiz','musa','mosa','extra_user'];
 const before=new Map();for(const u of others)before.set(u,(await f.call(u,'/api/tasks/workspace?scope=all&status=all')).data.pa.workspace.counts);
 const marker='SYNTHETIC-OWNER-ONLY-CANARY',id='TSK-99003',source='https://docs.google.com/spreadsheets/d/synthetic/edit';
 const pub=(operation,data,revision=0)=>savePaReport(f.env,{username:'alex',via:'pa'},{operation,data,revision,request_id:crypto.randomUUID(),reason:'Authorised isolated privacy test'});
 await pub('register',{source_at:new Date().toISOString(),source_url:source,rows:[{id,scope:'private',area:'Personal',assigned_to:'alex',title:marker,status:'Pending',source_url:source}]});
 const task=(await pub('private_task',{pa_task_id:id,action:'create',data:{title:marker,details:marker,task_type:'workflow',require_final_approval:true,steps:[{id:'only-owner',description:marker,assigned_to:'alex',status:'Pending'}]}})).task;
 const proof={id:crypto.randomUUID(),task_id:task.id,mime_type:'text/plain',filename:'canary.txt',base64:btoa(marker)};
 assert.equal((await f.call('alex','/api/tasks/file',proof)).status,200);
 const date=new Date().toISOString().slice(0,10);
 await pub('report',{date,source_at:new Date().toISOString(),source_url:source,register_revision:1,sections:['emails','activity','tasks','tomorrow','rabbi'].map((section,n)=>({id:section,title:section,items:[{id:'item-'+n,title:n===4?'Shared reading':marker,text:n===4?'Ordinary reading':marker,requires_action:n===0,pa_task_ids:n===0?[id]:[]},...(n===4?[{id:'private-linked-reading',title:marker,text:marker,requires_action:true,pa_task_ids:[id]}]:[])]}))});
 const pa=(await f.call('alex','/api/pa-report')).data.rows[0];
 const fb={subject_key:id,subject_hash:pa.subject_hash,action:'respond',note:marker,request_id:crypto.randomUUID()};
 assert.equal((await f.call('alex','/api/pa-report/feedback',fb)).status,200);
 const reportProof={...proof,id:crypto.randomUUID(),subject_key:id,subject_hash:pa.subject_hash,mime_type:'application/pdf',filename:'canary.pdf',base64:btoa('%PDF-1.4 '+marker)};
 assert.equal((await f.call('alex','/api/pa-report/file',reportProof)).status,200);
 await queueTaskReminders(f.env);
 const privateReads=['/api/tasks?id='+task.id,'/api/tasks/audit?id='+task.id,'/api/tasks/file?id='+proof.id,'/api/pa-report/conversation?subject_key='+id,'/api/pa-report/file?id='+reportProof.id];
 for(const path of privateReads){const r=await f.call('alex',path);assert.equal(r.status,200,path);assert.match(r.headers.get('Cache-Control'),/no-store/);}
 for(const u of [...others,'']){
  // A guessed real private ID must look exactly like an absent ID.
  for(const [path,hidden] of [['/api/tasks?id=',task.id],['/api/tasks/audit?id=',task.id],['/api/tasks/file?id=',proof.id],['/api/pa-report/file?id=',reportProof.id]]){
   const hiddenResult=await f.call(u,path+hidden),missingResult=await f.call(u,path+crypto.randomUUID());
   assert.equal(hiddenResult.status,missingResult.status,u+path);
   assert.deepEqual(hiddenResult.data,missingResult.data,u+path+' existence');
  }
  for(const path of privateReads){const r=await f.call(u,path);assert.ok([401,403,404].includes(r.status),u+path);assert.ok(!JSON.stringify(r.data).includes(marker));}
  for(const path of ['/api/tasks','/api/tasks/inbox','/api/tasks/workspace?scope=all&status=all&search='+marker,'/api/tasks/workspace?scope=all&case='+id,'/api/pa-report','/api/tasks/emails']){
   const r=await f.call(u,path);if(r.data.pa?.workspace)delete r.data.pa.workspace.search;assert.ok(!JSON.stringify(r.data).includes(marker),u+path);assert.ok(!JSON.stringify(r.data).includes(task.id),u+path);
  }
  for(const action of ['update','complete','cancel','set_visibility','restore_task_revision','step_update','step_complete','step_delete','pa_request']){
   const r=await f.call(u,'/api/tasks',{task_id:task.id,revision:1,request_id:crypto.randomUUID(),action,data:{visibility:'operational',assigned_to:u},step_id:'only-owner',restore_revision:1,confirm:true,note:'Synthetic attempt',username:'alex'});
   assert.ok([401,403,404].includes(r.status),u+action);
   const missing=await f.call(u,'/api/tasks',{task_id:crypto.randomUUID(),revision:1,request_id:crypto.randomUUID(),action,note:'Synthetic attempt'});
   assert.equal(r.status,missing.status,u+action+' existence');assert.deepEqual(r.data,missing.data,u+action+' existence');
  }
  assert.ok([401,403,404].includes((await f.call(u,'/api/pa-report/feedback',{...fb,request_id:crypto.randomUUID()})).status));
 }
 for(const u of others)assert.deepEqual((await f.call(u,'/api/tasks/workspace?scope=all&status=all')).data.pa.workspace.counts,before.get(u),u+' counts');
 assert.ok(!JSON.stringify(await readTasksForPa(f.env,{username:'alinda'},{resource:'pending_sync'})).includes(marker));
 await assert.rejects(acknowledgeTask(f.env,{username:'alinda'},{task_id:task.id,revision:1,pa_task_id:id,source_url:source}),/not found/);
 for(const data of [{visibility:'operational'},{assigned_to:'alinda'}])assert.equal((await f.call('alex','/api/tasks',{task_id:task.id,revision:1,request_id:crypto.randomUUID(),action:'update',data})).status,403);
 assert.equal((await f.call('alex','/api/tasks',{task_id:task.id,revision:1,request_id:crypto.randomUUID(),action:'step_update',step_id:'only-owner',data:{assigned_to:'alinda'}})).status,403);
 assert.equal((await f.call('alex','/api/tasks?id='+task.id)).data.task.revision,1);
});

test('private drafts leave browser storage, remain in memory and clear on identity loss',()=>{
 const key='fenmeat-pa-draft:alex:TSK-99000:respond',shared='fenmeat-pa-draft:alinda:TSK-99001:respond';
 const values=new Map([[key,'private draft'],[shared,'ordinary draft']]);
 const storage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const safe=createTaskDraftStorage(storage);
 assert.equal(values.has(key),false);assert.equal(safe.getItem(key),'private draft');
 safe.setItem(key,'edited private draft');assert.equal(values.has(key),false);
 safe.setItem(shared,'edited shared draft');assert.equal(values.get(shared),'edited shared draft');
 safe.clearPrivate();assert.equal(safe.getItem(key),undefined);assert.equal(safe.getItem(shared),'edited shared draft');
});

test('push delivery on a shared device requires the current recipient session',async()=>{
 const source=await readFile(new URL('../public/tasks-sw.js',import.meta.url),'utf8');
 for(const scenario of ['alex','alinda','signed-out','offline']){
  const handlers={},shown=[];
  runInNewContext(source,{URL,fetch:async()=>{if(scenario==='offline')throw Error('offline');return {ok:scenario!=='signed-out',json:async()=>({username:scenario})};},self:{location:{origin:'https://synthetic.example'},addEventListener:(type,fn)=>handlers[type]=fn,registration:{showNotification:async(...args)=>shown.push(args)}}});
  let work;handlers.push({data:{json:()=>({username:'alex',url:'/tasks?task=private-canary',tag:'private-canary'})},waitUntil:p=>work=p});await work;
  assert.equal(shown.length,scenario==='alex'?1:0,scenario);
 }
});

test('private register identities cannot be republished as shared, even without a native task link',async t=>{
 const f=await fixture(t),env={DB:f.db,APP_ACCESS_KEYS:JSON.stringify({alex:'a'.repeat(40),alinda:'b'.repeat(40)})};
 const row={id:'TSK-99001',scope:'private',area:'Personal',assigned_to:'alex',title:'Synthetic private identity',status:'Pending',source_url:'https://docs.google.com/spreadsheets/d/synthetic/edit'};
 const data={source_at:new Date().toISOString(),source_url:'https://docs.google.com/spreadsheets/d/synthetic/edit',rows:[row]};
 const pub=(operation,data,revision)=>savePaReport(env,{username:'alex',via:'pa'},{operation,data,revision,request_id:crypto.randomUUID(),reason:'Authorised isolated security test'});
 await pub('register',data,0);
 for(const operation of ['register','register_patch'])await assert.rejects(pub(operation,{...data,rows:[{...row,scope:'fenmeat',area:'Fen Meat'}]},1),/privaat/);
});

test('a stale shared register row cannot expose a linked private task or conversation to an administrator',async t=>{
 const f=await fixture(t),b=f.task({assigned_to:'alex',visibility:'private',pa_task_id:'TSK-99002'});
 assert.equal((await f.call('alex','/api/tasks',b)).status,200);
 const rows=[{id:'TSK-99002',scope:'fenmeat',assigned_to:'alinda',app_task_id:b.task_id,title:'Synthetic private marker'}];
 for(const username of ['alinda','xavier','xalinda','tapiz','mosa','musa','extra_user'])
  assert.deepEqual(await visiblePaRows({DB:f.db},{username},rows),[],username);
 assert.equal((await visiblePaRows({DB:f.db},{username:'alex'},rows)).length,1);
});
