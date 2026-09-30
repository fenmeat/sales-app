import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import worker from '../src/worker.js';import {emptyRun} from '../src/domain.js';
class D1 {constructor(){this.db=new DatabaseSync(':memory:');}prepare(sql){const db=this.db;let values=[];const stmt={bind(...v){values=v;return stmt;},async first(){return db.prepare(sql).get(...values)??null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:r.changes}};},sql,values:()=>values};return stmt;}async batch(statements){this.db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}}
const key='test-only-local-key-012345678901234567890123456789';const origin='https://test.example';
const catalog={products:[{code:'W01',name:'Braai wors',unit:'bag',price_cents:16000,available:true,active:true}],routes:[{code:'R07',name:'MOSSEL BAY',weekday:4}]};
test('protected pilot: sign-in, save, idempotency, concurrent edit, reconciliation and close',async()=>{const env={APP_ENV:'test',DB:new D1(),APP_ACCESS_KEYS:JSON.stringify({alex:key})};let cookie='';async function call(path,body,extra={}){const r=await worker.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:body?JSON.stringify(body):undefined}),env);return {r,data:await r.json()};}
 assert.equal((await call('/api/bootstrap')).r.status,401);assert.equal((await call('/api/login',{username:'alex',key:'wrong'})).r.status,401);
 const auth=await call('/api/login',{username:'alex',key});assert.equal(auth.r.status,200);cookie=auth.r.headers.get('set-cookie').split(';')[0];assert.match(auth.r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await call('/api/catalog',{revision:0,catalog})).r.status,200);
 let r=emptyRun('2026-09-30','R07',catalog.products);r.rep='Alex';r.items[0].loaded=20;r.items[0].returned=null;
 const first={run:structuredClone(r),revision:0,action:'load',request_id:crypto.randomUUID()};let saved=await call('/api/run',first);assert.equal(saved.r.status,200,JSON.stringify(saved.data));assert.equal(saved.data.revision,1);
 assert.equal((await call('/api/run',first)).data.replayed,true);
 assert.equal((await call('/api/run',{...first,request_id:crypto.randomUUID()})).r.status,409);
 r=saved.data.run;r.items[0].returned=2;let returns=await call('/api/run',{run:r,revision:1,action:'returns',request_id:crypto.randomUUID()});assert.equal(returns.r.status,200);r=returns.data.run;
 r.recon={date:r.date,route:r.route,complete:true,source:'Test invoices and payments',invoice_lines:[{id:'INV1:1',product:'W01',qty:18,status:'sent'}],payments:[{id:'PAY1:1',date:r.date,invoice_date:r.date,method:'cash',cents:3000000}]};Object.assign(r.cash,{counted:3000000,shop2shop:0,card:0,eft:0});
 let closed=await call('/api/run',{run:r,revision:2,action:'close',request_id:crypto.randomUUID()});assert.equal(closed.r.status,200,JSON.stringify(closed.data));assert.equal(closed.data.run.phase,'closed');assert.equal((await call('/api/bootstrap')).data.history.rows,1);
 assert.equal((await call('/api/run',{run:closed.data.run,revision:3,action:'save',request_id:crypto.randomUUID()})).r.status,400);
 r=closed.data.run;r.notes='Reopening to correct returns';let reopened=await call('/api/run',{run:r,revision:3,action:'reopen',request_id:crypto.randomUUID()});assert.equal(reopened.r.status,200);assert.equal((await call('/api/bootstrap')).data.history.rows,0);
 assert.equal((await call('/api/audit?date=2026-09-30&route=R07')).data.events.length,4);
 assert.equal((await call('/api/catalog',{revision:1,catalog},{Origin:'https://evil.example',Authorization:'random'})).r.status,403);
 env.APP_ACCESS_KEYS=JSON.stringify({alex:key+'rotated'});assert.equal((await call('/api/bootstrap')).r.status,401);
});
test('missing access configuration denies business endpoints and writes',async()=>{const env={APP_ENV:'test',DB:new D1()};for(const path of ['/api/bootstrap','/api/run','/api/sync/export']){const r=await worker.fetch(new Request(origin+path),env);assert.equal(r.status,503);}env.APP_ENV='production';assert.equal((await worker.fetch(new Request(origin+'/api/health'),env)).status,503);});
