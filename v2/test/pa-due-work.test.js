import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {saveTask,ensureTaskSchema,getTask} from '../src/tasks-api.js';
import {readPaReport,ensurePaReportSchema} from '../src/pa-report-api.js';
import {paCandidates} from '../src/pa-due-work.js';
import {paFollowupLabel} from '../src/task-workflow.js';
const pa={username:'alex',via:'pa'},uuid=()=>crypto.randomUUID();
async function setup(t,visibility='private'){
 const f=await fixture(t);await ensureTaskSchema(f.db);await ensurePaReportSchema(f.db);
 const task_id=uuid();
 const r=await saveTask(f.env,pa,{task_id,request_id:uuid(),revision:0,action:'create',data:{title:'Synthetic PA follow-up',assigned_to:'alex',visibility,task_type:'workflow',require_final_approval:true,steps:[{id:'check',description:'Read the specified reply',assigned_to:'pa',due_date:'2020-01-01',status:'Pending'}]}});
 return {...f,task_id,task:r.task};
}
async function due(f,id='pa-due-work'){return readPaReport(f.env,pa,{resource:'summary',id});}
async function claim(f){const item=(await due(f)).items.find(i=>i.task_id===f.task_id);assert.ok(item);const request_id=uuid();const r=await saveTask(f.env,pa,{task_id:f.task_id,revision:item.revision,request_id,action:'pa_followup_claim',step_id:item.step_id,source_key:item.source_key});return {item,request_id,task:r.task};}
function result(f,c,outcome='waiting',extra={}){return {task_id:f.task_id,revision:c.task.revision,request_id:uuid(),action:'pa_followup_result',claim_id:c.request_id,step_id:'check',data:{outcome,attempted:'Read the original thread and search newer matching mail.',result:'No newer reply was found in the bounded search.',sources:['https://mail.google.com/mail/u/0/#all/123'],checked_at:new Date().toISOString(),next_action:'PA checks for the reply tomorrow.',next_owner:'pa',next_check_at:new Date(Date.now()+86400000).toISOString(),...extra}};}
test('existing due PA steps execute without new requests, including private tasks; empty sync is irrelevant',async t=>{
 const f=await setup(t);assert.equal(f.task.pa_work,undefined);
 const before=await due(f);assert.equal(before.items.length,1);assert.equal(before.items[0].scope,'private');assert.equal(before.items[0].overdue,true);
 const c=await claim(f);assert.equal((await due(f)).items.length,0);
 assert.equal(paFollowupLabel(c.task),'PA is besig met die werk');
 const b=result(f,c);b.task_updates=[{action:'step_update',step_id:'check',data:{status:'Waiting',waiting_reason:'Awaiting the named correspondent',due_date:new Date(Date.now()+86400000).toISOString().slice(0,10)}}];
 const saved=await saveTask(f.env,pa,b);assert.equal(saved.task.status,'Waiting');assert.equal(saved.task.steps[0].overdue,false);assert.equal((await due(f)).items.length,0);
 assert.match(paFollowupLabel(saved.task),/opgevolg/);assert.equal(saved.task.pa_followups.check.original_due_date,'2020-01-01');
 const replay=await saveTask(f.env,pa,b);assert.equal(replay.replayed,true);
 const conversation=await readPaReport(f.env,pa,{resource:'summary',id:'conversation-'+f.task_id});assert.equal(conversation.messages.length,1);assert.equal(conversation.messages[0].followup.outcome,'waiting');
 const report=await readPaReport(f.env,pa,{resource:'summary',id:'pa-followup-report'});assert.equal(report.items[0].execution.result,b.data.result);
});
test('a received reply can complete the proved step and require human approval without closing the goal',async t=>{
 const f=await setup(t),c=await claim(f),b=result(f,c,'approval',{result:'A reply was received and reviewed. A proposed response awaits approval.',next_owner:'alex',next_action:'Alex reviews the proposed email.',reason:'Sending requires explicit approval.',needed:'Approve this exact proposal.'});
 b.task_updates=[{action:'step_complete',step_id:'check',note:'Reply read.',confirmation:'Verified message source.'},{action:'step_add',step_id:'approve',data:{description:'Approve the proposed reply',assigned_to:'alex',status:'Pending'}}];
 const r=await saveTask(f.env,pa,b);assert.equal(r.task.progress.done,1);assert.notEqual(r.task.status,'Complete');assert.equal(r.task.next_assigned_to,'alex');assert.equal((await due(f)).items.length,0);
 assert.equal(paFollowupLabel(r.task),'PA benodig jou goedkeuring');
 const notices=await f.db.prepare("SELECT * FROM v2_task_notifications WHERE kind='pa_action'").all();assert.equal(notices.results.length,1);
});
test('temporary failure retains the overdue work and becomes eligible at the next hour',async t=>{
 const f=await setup(t),c=await claim(f),b=result(f,c,'failed',{reason:'Gmail returned unavailable.',needed:'The Gmail connection must recover.',sources:[]});
 const r=await saveTask(f.env,pa,b),execution=r.task.pa_followups.check;
 assert.equal(r.task.steps[0].due_date,'2020-01-01');assert.equal(r.task.steps[0].overdue,true);assert.equal(execution.last_success_at,null);
 assert.equal((await due(f)).items.length,0);assert.ok(Date.parse(execution.next_check_at)-Date.now()<3600100);
 assert.ok(paCandidates(r.task,new Date(Date.now()+3601000))[0].due_at<=new Date(Date.now()+3601000).toISOString());
 assert.equal(paFollowupLabel(r.task),'PA kon nie die werk uitvoer nie');
});
test('follow-up delegation notifies every new step owner once while retaining private access rules',async t=>{
 const f=await setup(t,'operational'),c=await claim(f),b=result(f,c,'blocked',{next_owner:'alinda',reason:'Two independent source confirmations are needed.',needed:'Alinda checks price and Xavier checks yield.'});
 b.task_updates=[{action:'step_add',step_id:'price',data:{description:'Confirm price',assigned_to:'alinda',status:'Pending'}},{action:'step_add',step_id:'yield',data:{description:'Confirm yield',assigned_to:'xavier',status:'Pending'}}];
 await saveTask(f.env,pa,b);await saveTask(f.env,pa,b);
 const rows=(await f.db.prepare("SELECT username,kind FROM v2_task_notifications WHERE task_id=? AND kind='step_assigned' AND username IN ('alinda','xavier') ORDER BY username").bind(f.task_id).all()).results;
 assert.deepEqual(rows,[{username:'alinda',kind:'step_assigned'},{username:'xavier',kind:'step_assigned'}]);
 const p=await setup(t),pc=await claim(p),pb=result(p,pc);
 pb.task_updates=[{action:'step_add',step_id:'leak',data:{description:'Private source',assigned_to:'xavier',status:'Pending'}}];
 await assert.rejects(()=>saveTask(p.env,pa,pb));
 assert.equal((await p.db.prepare("SELECT COUNT(*) n FROM v2_task_notifications WHERE username='xavier'").first()).n,0);
});
test('claims enforce ownership, revision, one active worker, evidence and privacy',async t=>{
 const f=await setup(t),item=(await due(f)).items[0],b={task_id:f.task_id,revision:item.revision,request_id:uuid(),action:'pa_followup_claim',step_id:'check',source_key:item.source_key};
 await assert.rejects(()=>saveTask(f.env,{username:'alex'},b));
 await assert.rejects(()=>readPaReport(f.env,{username:'alinda'},{resource:'summary',id:'pa-due-work'}));
 const c=await claim(f);await assert.rejects(()=>saveTask(f.env,pa,b));
 const invalid=result(f,c);invalid.data.sources=[];await assert.rejects(()=>saveTask(f.env,pa,invalid));
 for(const username of ['alinda','xavier','xalinda','tapiz']){
  const r=await f.call(username,'/api/tasks?id='+f.task_id);assert.notEqual(r.status,200);
  await assert.rejects(()=>readPaReport(f.env,{username},{resource:'summary',id:'conversation-'+f.task_id}));
 }
 const saved=await getTask(f.db,f.task_id);assert.equal(saved.revision,c.task.revision);
});
test('all eligible PA steps use their owner and dependencies; future steps unlock by time alone',()=>{
 const raw={id:'synthetic',assigned_to:'alinda',status:'Pending',task_type:'workflow',steps:[
  {id:'human',assigned_to:'alinda',description:'Human work',status:'Pending'},
  {id:'pa-ready',assigned_to:'pa',description:'PA work',status:'Pending',due_date:'2026-11-28'},
  {id:'blocked',assigned_to:'pa',description:'Blocked PA work',status:'Pending',dependencies:['human']}
 ]};
 const before=paCandidates(raw,new Date('2026-11-27T12:00:00Z'));assert.deepEqual(before.map(s=>s.step_id),['pa-ready']);assert.equal(before[0].due_at,'2026-11-27T22:00:00.000Z');
 assert.ok(before[0].due_at<=new Date('2026-11-28T07:00:00Z').toISOString());
});
test('legacy private PA gaps remain visible until the original TSK is linked to native work',async t=>{
 const f=await setup(t);
 const row={id:'TSK-00999',scope:'private',title:'Synthetic legacy task',status:'Pending',review_date:'2020-01-01',responsibility:{owner:'pa',action:'Read reply'}};
 await f.db.prepare('INSERT INTO v2_pa_report_versions(resource_key,revision,request_id,fingerprint,payload,actor,saved_at) VALUES(?,?,?,?,?,?,?)').bind('register',1,uuid(),'synthetic',JSON.stringify({rows:[row]}),'alex',new Date().toISOString()).run();
 assert.equal((await due(f)).legacy[0].pa_task_id,row.id);
 await saveTask(f.env,pa,{task_id:uuid(),request_id:uuid(),revision:0,action:'create',data:{title:row.title,assigned_to:'alex',visibility:'private',pa_task_id:row.id,task_type:'workflow',steps:[{id:'check',description:'Read reply',assigned_to:'pa',status:'Pending',due_date:'2020-01-01'}]}});
 assert.equal((await due(f)).legacy.length,0);
 const plan=await f.db.prepare('EXPLAIN QUERY PLAN SELECT task_id FROM v2_pa_due_index WHERE due_at<=? ORDER BY due_at,task_id,step_id LIMIT 26').bind(new Date().toISOString()).all();
 assert.match(JSON.stringify(plan.results),/v2_pa_due_time/);
});
test('PA can read original task evidence without an email proposal; other users cannot use this owner bridge',async t=>{
 const f=await setup(t),id=uuid();
 const r=await f.call('alex','/api/tasks/file',{id,task_id:f.task_id,mime_type:'text/plain',filename:'synthetic.txt',base64:btoa('Synthetic task evidence')});assert.equal(r.status,200);
 const list=await readPaReport(f.env,pa,{resource:'summary',id:'taskfiles-'+f.task_id});assert.equal(list.items[0].id,id);
 const file=await readPaReport(f.env,pa,{resource:'file',id:'taskfile-'+id});assert.equal(atob(file.base64),'Synthetic task evidence');
 for(const username of ['alinda','xavier','xalinda','tapiz']){
  await assert.rejects(()=>readPaReport(f.env,{username},{resource:'summary',id:'taskfiles-'+f.task_id}));
  await assert.rejects(()=>readPaReport(f.env,{username},{resource:'file',id:'taskfile-'+id}));
 }
 await assert.rejects(()=>readPaReport(f.env,pa,{resource:'file',id:'appfile-'+id}));
});
test('saved count evidence distinguishes incomplete and other-owner receipts without accepting a new count',async t=>{
 const f=await fixture(t),date=new Date().toISOString().slice(0,10);
 const material=id=>({id,name:id,unit:'kg',supplier:'Crown',pack_qty:20,procure:true,notes:'',source:'Synthetic',price:{amount:null,status:'unknown',date:null,valid_until:null,source:''},stock:{qty:null,date:null,reserve:null,incoming:[],source:''}});
 const register={schema_version:1,notes:'Synthetic',materials:[material('RM01'),material('RM02')],recipes:[],packaging:[]};
 assert.equal((await f.call('alex','/api/recipes',{revision:0,request_id:uuid(),reason:'Synthetic fixture',register})).status,200);
 const b=f.task({kind:'stocktake',supplier:'crown',due_date:date});assert.equal((await f.call('alinda','/api/tasks',b)).status,200);
 const partial={revision:1,request_id:uuid(),supplier:'crown',date,rows:[{material:'RM01',packs:0,reserve:0}]};assert.equal((await f.call('xalinda','/api/stocktake',partial)).status,200);
 const other={...partial,revision:2,request_id:uuid(),rows:[...partial.rows,{material:'RM02',packs:2,reserve:0}]};assert.equal((await f.call('xavier','/api/stocktake',other)).status,200);
 let list=await readPaReport(f.env,pa,{resource:'summary',id:'taskcounts-'+b.task_id});assert.equal(list.items.length,2);assert.equal(list.items.some(r=>r.eligible),false);assert.deepEqual(list.items.find(r=>r.request_id===partial.request_id).missing,['RM02']);
 const full={...other,revision:3,request_id:uuid()};assert.equal((await f.call('xalinda','/api/stocktake',full)).status,200);
 list=await readPaReport(f.env,pa,{resource:'summary',id:'taskcounts-'+b.task_id});assert.equal(list.items.filter(r=>r.eligible).length,1);assert.equal(list.items.find(r=>r.eligible).request_id,full.request_id);
 for(const username of ['alinda','xavier','xalinda','tapiz'])await assert.rejects(()=>readPaReport(f.env,{username},{resource:'summary',id:'taskcounts-'+b.task_id}));
});
