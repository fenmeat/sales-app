import {check} from './domain.js';
import {readTasksForPa} from './tasks-api.js';
import {readPaReport} from './pa-report-api.js';
import {unifiedWork,selectWork} from '../public/pa-report-model.js';

// Owner-only, fixed read paths. Never exposes SQL parameters or business content.
export async function taskPerformance(env,user){
 check(user.username==='alex','Only Alex can inspect Tasks performance.',403);
 const samples=[],plans=new Map();
 async function measure(name,operation){
  const calls=[],unwrapped=new WeakMap();
  const wrap=(statement,sql,params=[])=>{
   const record=async(fn,count=1)=>{const at=Date.now(),r=await fn();calls.push({sql,wall_ms:Date.now()-at,sql_ms:r.meta?.duration??null,rows_read:r.meta?.rows_read??null,returned:r.results?.length??null,count});return r;};
   const wrapped={bind:(...values)=>wrap(statement.bind(...values),sql,values),all:()=>record(()=>statement.all()),first:async column=>{const r=await record(()=>statement.all());return column?(r.results[0]?.[column]??null):(r.results[0]??null);},run:()=>record(()=>statement.run())};
   unwrapped.set(wrapped,statement);
   if(/^SELECT/i.test(sql))plans.set(sql,params);
   return wrapped;
  };
  const db={prepare:sql=>wrap(env.DB.prepare(sql),sql),batch:async statements=>{const at=Date.now(),r=await env.DB.batch(statements.map(s=>unwrapped.get(s)));calls.push({sql:'schema/batch',wall_ms:Date.now()-at,sql_ms:r.reduce((n,x)=>n+(x.meta?.duration||0),0),count:statements.length});return r;}};
  const start=Date.now(),data=await operation({...env,DB:db}),elapsed=Date.now()-start;
  const grouped=new Map();for(const c of calls){const g=grouped.get(c.sql)||{query:c.sql,calls:0,wall_ms:0,sql_ms:0,rows_read:0};g.calls++;g.wall_ms+=c.wall_ms;g.sql_ms+=c.sql_ms||0;g.rows_read+=c.rows_read||0;grouped.set(c.sql,g);}
  samples.push({name,total_ms:elapsed,database_round_trips:calls.length,database_wall_ms:calls.reduce((n,c)=>n+c.wall_ms,0),non_database_wall_ms:elapsed-calls.reduce((n,c)=>n+c.wall_ms,0),response_bytes:new TextEncoder().encode(JSON.stringify(data)).length,records:data.tasks?.length??data.rows?.length??0,feedback:data.feedback?.length??0,alerts:data.alerts?.length??0,queries:[...grouped.values()]});
  return data;
 }
 const app=await measure('tasks',env=>readTasksForPa(env,user,{}));
 const pa=await measure('pa_report',env=>readPaReport(env,user,{}));
 const start=Date.now(),rows=unifiedWork(app,pa),pending=selectWork(rows,{username:user.username,admin:true,scope:'mine',status:'open'});const processing_ms=Date.now()-start;
 const selected=[...plans.entries()].slice(0,12),explain=await env.DB.batch(selected.map(([sql,params])=>env.DB.prepare('EXPLAIN QUERY PLAN '+sql).bind(...params)));
 return {version:'0.40.1',measured_at:new Date().toISOString(),read_only:true,samples,model:{app_tasks:app.tasks.length,pa_rows:pa.rows.length,unified:rows.length,pending:pending.length,processing_ms},query_plans:explain.map((r,i)=>({query:selected[i][0],plan:r.results}))};
}
