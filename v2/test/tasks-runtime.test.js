import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {today} from '../src/domain.js';
import {allowedPushEndpoint,queueTaskReminders,flushTaskPush} from '../src/tasks-push.js';
import {currentTaskNotification} from '../src/tasks-api.js';
const origin='https://tasks-test.example';
async function fixture(t){
 const output=await build({entryPoints:[new URL('../src/worker.js',import.meta.url).pathname],bundle:true,format:'esm',platform:'browser',write:false});
 const keys=Object.fromEntries(['alex','alinda','xalinda','xavier','tapiz'].map(u=>[u,'synthetic-'+u+'-'.repeat(40)]));
 const mf=new Miniflare(convertV4MiniflareOptions({name:'tasks-test',modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'tasks-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(keys)},outboundService:()=>{throw Error('No external services in task tests');}}));t.after(()=>mf.dispose());
 const cookies={};async function call(user,path,body,headers={}){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookies[user]??'',...headers},body:body?JSON.stringify(body):undefined});const data=await r.json();return {status:r.status,data,headers:r.headers};}
 for(const username of Object.keys(keys)){const r=await call(username,'/api/login',{username,key:keys[username]});assert.equal(r.status,200);cookies[username]=r.headers.get('set-cookie').split(';')[0];}
 const task=(data={})=>({task_id:crypto.randomUUID(),request_id:crypto.randomUUID(),revision:0,action:'create',data:{title:'Synthetic review',assigned_to:'xalinda',review_date:today(),...data}});
 return {mf,call,task,db:await mf.getD1Database('DB')};
}
test('tasks enforce owner privacy, admin assignment, revisions, idempotency, evidence and notifications',async t=>{
 const {call,task,db}=await fixture(t),b=task({requires_evidence:true});
 assert.equal((await call('','/api/tasks')).status,401);assert.equal((await call('tapiz','/api/tasks')).status,403);
 assert.equal((await call('xalinda','/api/tasks',task({assigned_to:'xavier'}))).status,403);
 assert.equal((await call('alinda','/api/tasks',b,{Origin:'https://evil.example'})).status,403);
 assert.equal((await call('alinda','/api/tasks',task({area:'Personal'}))).status,400);
 const first=await call('alinda','/api/tasks',b);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.task.revision,1);
 assert.equal((await call('alinda','/api/tasks',b)).data.replayed,true);
 assert.equal((await call('alinda','/api/tasks',{...b,data:{...b.data,title:'Changed retry'}})).status,409);
 assert.equal((await call('xavier','/api/tasks')).data.tasks.length,0);assert.equal((await call('xavier','/api/tasks/audit?id='+b.task_id)).status,404);
 const own=(await call('xalinda','/api/tasks')).data;assert.equal(own.tasks.length,1);assert.deepEqual(own.users,['xalinda']);assert.equal(own.notifications.length,1);
 const completion={task_id:b.task_id,request_id:crypto.randomUUID(),revision:1,action:'complete'};
 assert.equal((await call('xavier','/api/tasks',completion)).status,404);
 assert.equal((await call('xalinda','/api/tasks',{...completion,revision:0})).status,409);
 assert.equal((await call('xalinda','/api/tasks',completion)).status,400);
 assert.equal((await call('xalinda','/api/tasks',{...completion,proof_url:'javascript:alert(1)'})).status,400);
 assert.equal((await call('xalinda','/api/tasks',{...completion,proof_url:'https://example.com/evidence'})).status,200);
 const admin=(await call('alinda','/api/tasks')).data;assert.equal(admin.notifications.filter(n=>n.kind==='completed').length,1);assert.equal(admin.tasks[0].status,'Complete');assert.equal(admin.tasks[0].pa_sync.status,'pending');
 assert.equal((await call('xalinda','/api/tasks',{...completion,request_id:crypto.randomUUID(),revision:2,action:'reopen',note:'Retry'})).status,403);
 assert.equal((await call('alinda','/api/tasks',{...completion,request_id:crypto.randomUUID(),revision:2,action:'reopen',note:'Evidence needs correction'})).status,200);
 const history=(await call('alinda','/api/tasks/audit?id='+b.task_id)).data.history;assert.deepEqual(history.map(h=>h.action),['reopen','complete','create']);assert.equal(history[1].task.completion.by,'xalinda');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_events').first()).n,0);
});
test('PO sending confirms the approved revision and creates no second supplier cycle or sending',async t=>{
 const {call,task,db}=await fixture(t),b=task({kind:'po_dispatch',assigned_to:'alinda',title:'Send synthetic approved PO',po_number:'PO-00999',po_revision:'approved-v1',document_url:'https://example.com/po.pdf',parent_cycle_id:'TSK-00999'});
 assert.equal((await call('alex','/api/tasks',b)).status,200);
 assert.equal((await call('alex','/api/tasks',{...b,task_id:crypto.randomUUID(),request_id:crypto.randomUUID()})).status,409);
 const c={task_id:b.task_id,request_id:crypto.randomUUID(),revision:1,action:'complete',po_revision:'wrong',channel:'WhatsApp',sent_at:new Date().toISOString()};
 assert.equal((await call('alinda','/api/tasks',c)).status,409);
 assert.equal((await call('alinda','/api/tasks',{...c,po_revision:'approved-v1',sent_at:'2099-01-01'})).status,400);
 const result=await call('alinda','/api/tasks',{...c,po_revision:'approved-v1'});assert.equal(result.status,200);assert.equal(result.data.task.parent_cycle_id,'TSK-00999');assert.equal(result.data.task.completion.owner_confirmation,true);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_task_sync').first()).n,0,'PA must not be acknowledged before its actual write');
});
test('stocktake completion requires the assigned user, date and all requested materials in one saved count',async t=>{
 const {call,task}=await fixture(t),date=today();
 const material=id=>({id,name:id,unit:'kg',supplier:'Crown',pack_qty:20,procure:true,notes:'',source:'Synthetic',price:{amount:null,status:'unknown',date:null,valid_until:null,source:''},stock:{qty:null,date:null,reserve:null,incoming:[],source:''}});
 const register={schema_version:1,notes:'Synthetic',materials:[material('RM01'),material('RM02')],recipes:[],packaging:[]};
 assert.equal((await call('alex','/api/recipes',{revision:0,request_id:crypto.randomUUID(),reason:'Synthetic fixture',register})).status,200);
 assert.equal((await call('alinda','/api/tasks',task({kind:'stocktake',supplier:'crown',due_date:date,requires_evidence:true}))).status,400);
 const b=task({kind:'stocktake',supplier:'crown',due_date:date});const created=await call('alinda','/api/tasks',b);assert.equal(created.status,200,JSON.stringify(created.data));assert.deepEqual(created.data.task.required_materials,['RM01','RM02']);
 const partial={revision:1,request_id:crypto.randomUUID(),supplier:'crown',date,rows:[{material:'RM01',packs:0,reserve:0}]};
 const saved=await call('xalinda','/api/stocktake',partial);assert.equal(saved.status,200);assert.deepEqual(saved.data.completed_tasks,[]);
 assert.equal((await call('xalinda','/api/tasks',{task_id:b.task_id,revision:1,request_id:crypto.randomUUID(),action:'complete',stocktake_request_id:partial.request_id})).status,400);
 const other={...partial,revision:2,request_id:crypto.randomUUID(),rows:[{material:'RM01',packs:0,reserve:0},{material:'RM02',packs:2,reserve:0}]};
 assert.equal((await call('xavier','/api/stocktake',other)).status,200);assert.equal((await call('xalinda','/api/tasks')).data.tasks[0].status,'Pending');
 const full={...other,revision:3,request_id:crypto.randomUUID()};const complete=await call('xalinda','/api/stocktake',full);assert.equal(complete.status,200);assert.deepEqual(complete.data.completed_tasks,[b.task_id]);
 assert.equal((await call('xalinda','/api/stocktake',full)).status,200);const current=(await call('alinda','/api/tasks')).data;assert.equal(current.tasks[0].status,'Complete');assert.equal(current.tasks[0].completion.stocktake.request_id,full.request_id);assert.equal(current.notifications.filter(n=>n.kind==='completed').length,1);
});
test('push destinations cannot be redirected to arbitrary servers or local addresses',()=>{
 for(const url of ['https://fcm.googleapis.com/fcm/send/example','https://web.push.apple.com/example','https://updates.push.services.mozilla.com/wpush/v2/example'])assert.equal(allowedPushEndpoint(url),true);
 for(const url of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.example/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8080/a'])assert.equal(allowedPushEndpoint(url),false);
});

test('each user creates and manages their own task while both admins retain oversight',async t=>{
 const {call,task,db}=await fixture(t);
 const created=[];
 for(const username of ['xalinda','xavier']){
  const b=task({assigned_to:username,title:'My '+username+' work',reminder_mode:'once',reminder_at:'2099-11-02T07:30:00.000Z'});
  let saved=await call(username,'/api/tasks',b);assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.equal(saved.data.task.created_by,username);assert.equal(saved.data.task.assigned_to,username);assert.equal(saved.data.task.reminder_at,'2099-11-02T07:30:00.000Z');
  assert.equal((await call(username,'/api/tasks',b)).data.replayed,true);
  const update={task_id:b.task_id,request_id:crypto.randomUUID(),revision:1,action:'update',data:{title:'Updated own task',due_date:'2099-11-03'}};
  assert.equal((await call(username,'/api/tasks',{...update,data:{assigned_to:'alinda'}})).status,403);
  assert.equal((await call(username,'/api/tasks',update)).status,200);
  assert.equal((await call(username,'/api/tasks',{...update,request_id:crypto.randomUUID(),revision:2,action:'cancel',note:'No longer needed'})).status,200);
  assert.equal((await call(username,'/api/tasks',{...update,request_id:crypto.randomUUID(),revision:3,action:'reopen',note:'Required again'})).status,200);
  created.push(b.task_id);
 }
 for(const admin of ['alex','alinda']){
  const view=(await call(admin,'/api/tasks')).data;assert.equal(view.admin,true);assert.equal(view.tasks.length,2);
  assert.equal((await call(admin,'/api/tasks?mine=1')).data.tasks.length,0);
 }
 for(const [i,username] of ['xalinda','xavier'].entries()){
  const view=(await call(username,'/api/tasks')).data;assert.equal(view.admin,false);assert.deepEqual(view.users,[username]);assert.deepEqual(view.tasks.map(t=>t.id),[created[i]]);
  const other=created[1-i];assert.equal((await call(username,'/api/tasks/audit?id='+other)).status,404);
  assert.equal((await call(username,'/api/tasks',{task_id:other,request_id:crypto.randomUUID(),revision:0,action:'update',data:{title:'Forbidden'}})).status,404);
  assert.equal((await call(username,'/api/tasks',{task_id:other,request_id:crypto.randomUUID(),revision:4,action:'reminder',data:{reminder_mode:'off'}})).status,404);
 }
 for(const data of [{assigned_to:'alex'},{kind:'po_dispatch'},{pa_task_id:'TSK-00999'},{parent_cycle_id:'TSK-00999'},{required_materials:[]},{created_by:'alex'}]){
  const r=await call('xalinda','/api/tasks',task({assigned_to:'xalinda',...data}));assert.ok([400,403].includes(r.status),JSON.stringify(r));
 }
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_task_events').first()).n,8);
});

test('staff can adjust reminders on assigned work without rewriting admin instructions or deadlines',async t=>{
 const {call,task}=await fixture(t),b=task({due_date:'2099-11-03',requires_evidence:true});
 const original=(await call('alex','/api/tasks',b)).data.task;
 const body={task_id:b.task_id,request_id:crypto.randomUUID(),revision:1,action:'update',data:{title:'Changed'}};
 assert.equal((await call('xalinda','/api/tasks',body)).status,403);
 assert.equal((await call('xalinda','/api/tasks',{...body,action:'reminder',data:{reminder_mode:'off',requires_evidence:false}})).status,400);
 const reminder={...body,action:'reminder',data:{reminder_mode:'once',reminder_at:'2099-11-02T11:45:00.000Z'}};
 const saved=await call('xalinda','/api/tasks',reminder);assert.equal(saved.status,200);assert.equal(saved.data.task.revision,2);assert.equal(saved.data.task.pa_sync.status,'pending');
 for(const key of ['title','details','assigned_to','created_by','due_date','requires_evidence'])assert.equal(saved.data.task[key],original[key]);
 assert.equal((await call('xalinda','/api/tasks',reminder)).data.replayed,true);
 assert.equal((await call('xalinda','/api/tasks',{...reminder,request_id:crypto.randomUUID()})).status,409);
 assert.equal((await call('xalinda','/api/tasks',{...body,request_id:crypto.randomUUID(),revision:2,action:'complete'})).status,400,'reminders cannot remove evidence requirements');
 for(const value of ['not-a-date','2099-02-30T07:00:00.000Z','2099-11-02T09:00','2000-01-01T07:00:00.000Z']){
  assert.equal((await call('xalinda','/api/tasks',task({assigned_to:'xalinda',reminder_mode:'once',reminder_at:value}))).status,400,value);
 }
 assert.equal((await call('xalinda','/api/tasks',task({assigned_to:'xalinda',reminder_mode:'unknown'}))).status,400);
});

test('reminders observe SAST, are queued once per chosen time, and stop after closure or rescheduling',async t=>{
 const {call,task,db}=await fixture(t),env={DB:db},date='2099-11-02',when=date+'T07:30:00.000Z';
 const once=task({assigned_to:'xavier',due_date:date,reminder_mode:'once',reminder_at:when});
 const daily=task({assigned_to:'xalinda',due_date:date});
 const off=task({assigned_to:'xalinda',due_date:date,reminder_mode:'off'});
 for(const b of [once,daily,off])assert.equal((await call(b.data.assigned_to,'/api/tasks',b)).status,200);
 const due=async()=> (await db.prepare("SELECT * FROM v2_task_notifications WHERE kind='due' ORDER BY id").all()).results;
 await queueTaskReminders(env,new Date(date+'T05:59:00.000Z'));assert.equal((await due()).length,0);
 await queueTaskReminders(env,new Date(date+'T06:00:00.000Z'));assert.deepEqual((await due()).map(n=>n.task_id),[daily.task_id]);
 await queueTaskReminders(env,new Date(when));await queueTaskReminders(env,new Date(when));
 let rows=await due();assert.equal(rows.length,2);const notification=rows.find(n=>n.task_id===once.task_id);assert.equal(notification.username,'xavier');
 const current=(await call('xavier','/api/tasks')).data.tasks[0];assert.equal(currentTaskNotification(current,notification,new Date(when)),true);
 assert.equal(currentTaskNotification(current,notification,new Date(date+'T07:29:00.000Z')),false);
 const later=date+'T09:00:00.000Z';
 const changed=await call('xavier','/api/tasks',{task_id:once.task_id,request_id:crypto.randomUUID(),revision:1,action:'reminder',data:{reminder_mode:'once',reminder_at:later}});
 assert.equal(changed.status,200);assert.equal(currentTaskNotification(changed.data.task,notification,new Date(later)),false);
 await queueTaskReminders(env,new Date(later));assert.equal((await due()).filter(n=>n.task_id===once.task_id).length,2);
 assert.equal((await call('xavier','/api/tasks',{task_id:once.task_id,request_id:crypto.randomUUID(),revision:2,action:'complete'})).status,200);
 const closed=(await call('xavier','/api/tasks')).data.tasks[0];for(const n of (await due()).filter(n=>n.task_id===once.task_id))assert.equal(currentTaskNotification(closed,n,new Date(later)),false);
 await queueTaskReminders(env,new Date('2099-11-03T06:00:00.000Z'));assert.equal((await due()).filter(n=>n.task_id===once.task_id).length,2);assert.equal((await due()).filter(n=>n.task_id===off.task_id).length,0);
 const oldDaily=(await due()).find(n=>n.task_id===daily.task_id&&n.id.endsWith(date));
 assert.equal(currentTaskNotification((await call('xalinda','/api/tasks')).data.tasks.find(t=>t.id===daily.task_id),oldDaily,new Date('2099-11-03T06:00:00.000Z')),false);
});

test('reassignment removes old-owner task, notification, audit and attachment access',async t=>{
 const {call,task,db}=await fixture(t),b=task({assigned_to:'xalinda'});await call('xalinda','/api/tasks',b);
 const file=crypto.randomUUID();assert.equal((await call('xalinda','/api/tasks/file',{id:file,task_id:b.task_id,mime_type:'application/pdf',filename:'synthetic.pdf',base64:btoa('%PDF-synthetic')})).status,200);
 const move=await call('alinda','/api/tasks',{task_id:b.task_id,request_id:crypto.randomUUID(),revision:1,action:'update',data:{assigned_to:'xavier'}});assert.equal(move.status,200);
 const view=(await call('xalinda','/api/tasks')).data;assert.equal(view.tasks.length,0);assert.equal(view.notifications.length,0);
 assert.equal((await call('xalinda','/api/tasks/audit?id='+b.task_id)).status,404);assert.equal((await call('xalinda','/api/tasks/file?id='+file)).status,404);
 // An old owner's queued push is withdrawn without contacting any push service.
 await db.prepare('INSERT INTO v2_task_push_subscriptions VALUES(?,?,?,?)').bind('synthetic-old-owner','xalinda','{}',new Date().toISOString()).run();
 const keys=Object.fromEntries(['alex','alinda','xalinda','xavier'].map(u=>[u,'synthetic-'+u+'-'.repeat(40)]));
 await flushTaskPush({DB:db,APP_ACCESS_KEYS:JSON.stringify(keys)});
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM v2_task_notifications WHERE username='xalinda'").first()).n,0);
 assert.equal((await call('xavier','/api/tasks')).data.tasks.length,1);
 for(const admin of ['alex','alinda'])assert.equal((await call(admin,'/api/tasks')).data.tasks.length,1);
});
