import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/report-fixture.js';
import {readPaReport} from '../src/pa-report-api.js';
test('owner diagnostics measure fixed reads without exposing task content or changing events',async t=>{
 const {call,task,db}=await fixture(t),env={DB:db,APP_ACCESS_KEYS:JSON.stringify({alex:'synthetic-key'.repeat(4),alinda:'synthetic-key'.repeat(4),xalinda:'synthetic-key'.repeat(4)})};
 await call('alex','/api/tasks',task({title:'PRIVATE DIAGNOSTIC CONTENT'}));
 const before=await db.prepare('SELECT COUNT(*) n FROM v2_task_events').first();
 await assert.rejects(readPaReport(env,{username:'alinda'},{resource:'summary',id:'tasks-performance'}),/Only Alex/);
 const r=await readPaReport(env,{username:'alex'},{resource:'summary',id:'tasks-performance'});
 assert.equal(r.samples.length,2);assert.equal(r.model.app_tasks,1);assert.ok(r.samples.every(s=>s.database_round_trips>0));assert.ok(r.query_plans.length>0);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE DIAGNOSTIC CONTENT|synthetic-key/);
 assert.deepEqual(await db.prepare('SELECT COUNT(*) n FROM v2_task_events').first(),before);
});
