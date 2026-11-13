import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {savePaReport,readPaReport} from '../src/pa-report-api.js';
import {createWorkspaceCache} from '../public/task-workspace-cache.js';
const source='https://docs.google.com/spreadsheets/d/synthetic/edit';
async function setup(t){
 const f=await fixture(t),env={DB:f.db,APP_ACCESS_KEYS:JSON.stringify(Object.fromEntries(['alex','alinda','xavier','xalinda'].map(u=>[u,'synthetic-'.repeat(5)])))};
 const rows=Array.from({length:222},(_,i)=>({id:'TSK-'+String(i+1).padStart(5,'0'),scope:i===221?'private':'fenmeat',area:i===221?'Personal':'Fen Meat',title:i===221?'PRIVATE ONLY ALEX':'Task '+i,status:i<70?'Pending':i<75?'Scheduled':i<215?'Complete':'Waiting',assigned_to:i===221?'alex':i===0?'xavier':'alinda',priority:'Normal',next_action:'Synthetic next action.',review_group:'Synthetic',due_date:'',review_date:i<70?'2020-01-01':'2099-12-01',source_url:source+'#range=A'+(i+2)+':S'+(i+2),app_task_id:'',outcome:''}));
 const publish=(rows,revision)=>savePaReport(env,{username:'alex',via:'pa'},{operation:'register',data:{rows,source_at:new Date().toISOString(),source_url:source},revision,request_id:crypto.randomUUID(),reason:'Synthetic workspace regression'});
 await publish(rows,0);return {...f,env,rows,publish};
}
test('workspace pages only the requested list, authenticates conditional reads and preserves private scope',async t=>{
 const {call,rows}=await setup(t),url='/api/tasks/workspace?scope=all&status=open';
 const r=await call('alex',url);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.pa.workspace.total,70);assert.equal(r.data.pa.workspace.rows.length,25);assert.equal(r.data.pa.workspace.next_offset,25);
 assert.equal(r.data.pa.feedback.length,0);assert.equal(r.data.pa.report,null);
 assert.equal((await call('alex',url,undefined,{'If-None-Match':r.data.etag})).status,304);
 const next=await call('alex',url+'&offset=25&snapshot='+r.data.pa.workspace.snapshot);assert.equal(next.data.pa.workspace.rows.length,25);assert.equal(new Set([...r.data.pa.workspace.rows,...next.data.pa.workspace.rows].map(r=>r.id)).size,50);
 const scheduled=(await call('alex','/api/tasks/workspace?scope=all&status=scheduled')).data;assert.equal(scheduled.pa.workspace.total,5);assert.equal(scheduled.pa.workspace.rows.length,5);
 const closed=(await call('alex','/api/tasks/workspace?scope=all&status=closed')).data;assert.equal(closed.pa.workspace.total,140);assert.equal(closed.pa.workspace.rows.length,25);
 const staff=await call('xavier','/api/tasks/workspace');assert.equal(staff.data.pa.workspace.total,1);assert.doesNotMatch(JSON.stringify(staff.data),/PRIVATE ONLY ALEX/);
 const alinda=await call('alinda','/api/tasks/workspace?scope=all&status=all',undefined,{'If-None-Match':r.data.etag});assert.equal(alinda.status,200);assert.doesNotMatch(JSON.stringify(alinda.data),/PRIVATE ONLY ALEX/);
 assert.equal((await call('xavier','/api/tasks/workspace?scope=all')).status,403);assert.equal((await call('alinda','/api/tasks/workspace?scope=private')).status,403);
 assert.equal(rows.length,222);
});
test('app edits override older PA data, cursor resets after changes and details/audit are fetched separately',async t=>{
 const {call,task,rows,publish,db}=await setup(t),body=task({assigned_to:'alinda',pa_task_id:rows[0].id,requires_evidence:true,details:'PRIVATE DETAIL NOT A CARD AUDIT'});
 await call('alex','/api/tasks',body);rows[0]={...rows[0],assigned_to:'alinda',app_task_id:body.task_id};await publish(rows,1);
 const before=(await call('alex','/api/tasks/workspace?scope=all&status=open')).data;
 const write=await call('alinda','/api/tasks',{task_id:body.task_id,revision:1,request_id:crypto.randomUUID(),action:'update',data:{title:'Newest title',requires_evidence:false},note:'Owner approves the task-specific change.'});assert.equal(write.status,200);
 const fresh=(await call('alex','/api/tasks/workspace?scope=all&status=open&offset=25&snapshot='+before.pa.workspace.snapshot)).data;
 assert.equal(fresh.pa.workspace.reset,true);assert.equal(fresh.pa.workspace.offset,0);
 const target=(await call('alex','/api/tasks/workspace?scope=all&status=open&case='+rows[0].id)).data;
 assert.equal(target.pa.workspace.rows.find(r=>r.id===rows[0].id).title,'Newest title');assert.doesNotMatch(JSON.stringify(target),/previous_revision|Owner approves/);
 const current=(await call('alex','/api/tasks?id='+body.task_id)).data.task;assert.equal(current.requires_evidence,false);assert.equal(current.last_edit.previous_revision,1);
 await call('alinda','/api/tasks',{task_id:body.task_id,revision:2,request_id:crypto.randomUUID(),action:'complete',note:'Confirmed.'});
 const complete=(await call('alex','/api/tasks/workspace?scope=all&status=closed&case='+rows[0].id)).data.pa.workspace.rows.find(r=>r.id===rows[0].id);assert.equal(complete.status,'Complete');
 const audit=(await call('alex','/api/tasks/audit?id='+body.task_id)).data.history;assert.equal(audit.length,3);assert.equal(audit.at(-1).task.requires_evidence,true);
 assert.equal((await db.prepare('SELECT COUNT(DISTINCT task_id) n FROM v2_task_events').first()).n,1);
});
test('workspace cache deduplicates, validates ETags, rejects old replies after a write and isolates new identities',async()=>{
 let calls=0,resolve;const value=(user='alex',snapshot='one')=>({app:{username:user},pa:{workspace:{snapshot,scope:'all',status:'open',search:''}},etag:'"'+user+snapshot+'"'});
 let handler=()=>new Promise(r=>resolve=r);const cache=createWorkspaceCache(async(...args)=>{calls++;return handler(...args);});
 const a=cache.read('/page'),b=cache.read('/page');assert.equal(calls,1);resolve({ok:true,json:async()=>value()});assert.equal((await a).value.app.username,'alex');await b;
 handler=async(_key,options)=>{assert.equal(options.headers['If-None-Match'],'"alexone"');return {status:304};};assert.equal((await cache.read('/page')).unchanged,true);
 handler=()=>new Promise(r=>resolve=r);const old=cache.read('/other');cache.clear();resolve({ok:true,json:async()=>value()});assert.equal((await old).obsolete,true);assert.equal(cache.peek('/other'),undefined);
 handler=async()=>({ok:true,json:async()=>value()});await cache.read('/old-user');handler=async()=>({ok:true,json:async()=>value('alinda')});await cache.read('/new-user');assert.equal(cache.peek('/old-user'),undefined);
 handler=async()=>({ok:false,status:401,json:async()=>({error:'Sign in'})});await assert.rejects(cache.read('/expired'),/Sign in/);assert.equal(cache.peek('/new-user'),undefined);
});
test('many report alerts reuse bounded source reads and workspace diagnostics never mutate events',async t=>{
 const {env,db,rows,call}=await setup(t);
 await db.batch(rows.slice(0,26).map((r,i)=>db.prepare('INSERT INTO v2_pa_report_alerts(id,username,subject_key,kind,created_at) VALUES(?,?,?,?,?)').bind('synthetic-alert-'+i,'alex',r.id,'feedback','2026-01-01T08:00:00Z')));
 const before=await db.prepare('SELECT COUNT(*) n FROM v2_task_events').first();
 const profiled=await readPaReport(env,{username:'alex'},{resource:'summary',id:'tasks-performance'}),report=profiled.samples.find(s=>s.name==='pa_report');
 assert.equal(report.alerts,26);assert.ok(report.database_round_trips<=3,JSON.stringify(report));
 const inbox=await call('alex','/api/tasks/inbox');assert.equal(inbox.status,200);assert.equal(inbox.data.alerts.length,26);assert.equal(inbox.data.feedback,undefined);assert.equal(inbox.data.rows,undefined);
 const diagnostic=await readPaReport(env,{username:'alex'},{resource:'summary',id:'tasks-workspace-open'});assert.equal(diagnostic.records,25);assert.equal(diagnostic.total,70);assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE ONLY ALEX|Synthetic next action/);
 await assert.rejects(readPaReport(env,{username:'alinda'},{resource:'summary',id:'tasks-workspace-open'}),/Only Alex/);assert.deepEqual(await db.prepare('SELECT COUNT(*) n FROM v2_task_events').first(),before);
});
