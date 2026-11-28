// Isolated D1/workerd. No external calls or real business data.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {fixture} from '../test/helpers/report-fixture.js';
import {readStaffData,STAFF_READ_SCOPE} from '../src/pa-staff-reads.js';

const cleanup=[];
const {call,db,env,task}=await fixture({after:action=>cleanup.push(action)});
const from='2026-11-23',to='2026-11-27';
async function request(path,body){
  const result=await call('alex',path,body);
  assert.equal(result.status,200);
  return result.data;
}
async function measure(operation,action){
  await action();
  const samples=[];
  let bytes;
  for(let i=0;i<7;i++){
    const start=performance.now();
    const result=await action();
    samples.push(performance.now()-start);
    bytes=Buffer.byteLength(JSON.stringify(result));
  }
  samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({operation,samples:samples.length,median_ms:+samples[3].toFixed(1),max_ms:+samples[6].toFixed(1),bytes}));
}
try{
  const people=Array.from({length:40},(_,index)=>({
    id:crypto.randomUUID(),name:'Test '+index,code:'TEST'+index,active:true,
    employment_type:'Casual',start_date:'2026-11-16',employment_verified:true,
    schedules:[{from:'2026-11-16',minutes:[480,480,480,480,480,0,0]}]
  }));
  await db.prepare('INSERT INTO v2_staff_register VALUES(?,?,?,?,?,?)')
    .bind(1,JSON.stringify({people,leave:[],ledger:[]}),'fixture','fixture',new Date().toISOString(),'{}').run();
  const item=task();await request('/api/tasks',item);
  const staff=resource=>readStaffData({resource,from,to,employee_id:people[0].id},env,'alex',[STAFF_READ_SCOPE]);
  await measure('combined_hours',()=>staff('hours'));
  await measure('attendance',()=>staff('attendance'));
  await measure('task_list',()=>request('/api/tasks/workspace?scope=all&compact=1'));
  await measure('task_detail',()=>request('/api/tasks?id='+item.task_id+'&brief=1'));
  await measure('pos_daily',()=>request('/api/pos/daily?date='+to));
  await measure('save_task',()=>request('/api/tasks',task()));
}finally{
  for(const dispose of cleanup)await dispose();
}
