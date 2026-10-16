import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRun} from '../src/domain.js';
import {effectiveHistory,applyForecastRefresh} from '../src/forecast-history.js';
import {forecast} from '../src/forecast.js';
const product={code:'W01',name:'Test product',unit:'bag',price_cents:100,available:true,active:true};
const options={from:'2026-07-01',to:'2026-10-08',asOf:'2026-10-06'};
function sample(){const r=emptyRun('2026-10-01','R07',[product]);r.phase='returned';r.items[0].loaded=20;r.items[0].returned=2;return r;}
function event(r,confirmed=r,action='returns'){return {payload:JSON.stringify(r),confirmation_payload:JSON.stringify(confirmed),confirmation_action:action};}
const legacy=[{date:'2026-10-01',product:'W01',qty:99,quality:'provisional',source:'legacy_sales_log'}];
test('confirmed physical counts override legacy once, before cash close, without editing either source',()=>{
 const r=sample(),e=event(r),before=JSON.stringify({legacy,e});const out=effectiveHistory(legacy,[e],options);
 assert.equal(out.rows.length,1);assert.equal(out.rows[0].qty,18);assert.equal(out.rows[0].quality,'provisional');assert.equal(out.rows[0].source,'v2_confirmed_returns');assert.equal(JSON.stringify({legacy,e}),before);
});
test('draft stock edits, reopen and reload cannot reuse an earlier approval or stale imported sales',()=>{
 const r=sample(),approved=structuredClone(r);r.items[0].returned=3;
 for(const e of [event(r,approved),event(r,r,'reopen'),event({...r,phase:'loaded'},r,'load')])assert.equal(effectiveHistory(legacy,[e],options).rows.length,0);
 assert.equal(effectiveHistory(legacy,[event(r)],options).rows[0].qty,17);
});
test('matching invoices establish stock verification without claiming cash reconciliation',()=>{
 const r=sample();r.recon={complete:true,invoice_lines:[{id:'x',product:'W01',qty:18,status:'sent'}],payments:[]};
 assert.equal(effectiveHistory(legacy,[event(r)],options).rows[0].quality,'verified');assert.equal(r.cash.counted,null);
 r.recon.invoice_lines[0].qty=17;assert.equal(effectiveHistory(legacy,[event(r)],options).rows.length,0);
});
test('zero carried is unknown demand, fully returned is zero sales, zero returns is constrained',()=>{
 const r=sample();r.items[0].loaded=0;r.items[0].returned=0;assert.equal(effectiveHistory([], [event(r)],options).rows.length,0);
 r.items[0].loaded=20;r.items[0].returned=20;assert.equal(effectiveHistory([], [event(r)],options).rows[0].qty,0);
 r.items[0].returned=0;const out=effectiveHistory([], [event(r)],options);assert.equal(out.rows[0].qty,20);assert.equal(out.rows[0].constrained,true);
});
test('practice, future and adjusted movements cannot become forecast sales',()=>{
 const r=sample();r.date='2026-09-30';assert.equal(effectiveHistory([], [event(r)],options).rows.length,0);
 r.date='2026-10-07';assert.equal(effectiveHistory([], [event(r)],options).rows.length,0);
 r.date='2026-10-01';r.items[0].adjustment=1;assert.equal(effectiveHistory([], [event(r)],options).rows.length,0);
});
test('refresh suggestions preserves custom plans including zero, captured quantities, cash and notes',()=>{
 const r=sample();r.items[0].planned=0;r.notes='Custom plan';r.cash.counted=12300;const before=structuredClone(r);
 const next=applyForecastRefresh(r,{snapshot:'new',forecasts:{W01:{qty:25,base:20,buffer:5}}});
 assert.equal(next.items[0].planned,0);assert.equal(next.items[0].loaded,20);assert.equal(next.items[0].returned,2);assert.deepEqual(next.cash,before.cash);assert.equal(next.notes,before.notes);assert.deepEqual(r,before);assert.equal(next.items[0].forecast.qty,25);
});
test('forecast discloses source dates, gaps and a load below the latest observation without fabricating demand',()=>{
 const rows=[['2026-08-27',10],['2026-09-03',10],['2026-09-10',10],['2026-09-17',10],['2026-10-01',30]].map(([date,qty])=>({date,qty,quality:'provisional'}));
 const f=forecast(rows,'2026-10-08');assert.equal(f.last_date,'2026-10-01');assert.equal(f.last_qty,30);assert.ok(f.missing_dates.includes('2026-09-24'));assert.ok(f.qty<30);assert.match(f.warning,/below the latest/);assert.equal(f.used_samples,5);
});
