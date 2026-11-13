import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateRoute,quantile,supportedMonthProfile} from '../src/balanced-forecast.js';
import {addDays,comparableRouteVisit} from '../src/domain.js';
import {applyForecastRefresh} from '../src/forecast-history.js';
const date='2026-11-16';
const history=qs=>qs.map((qty,i)=>({date:addDays(date,(i-qs.length)*7),product:'A',qty,quality:'verified',loaded:qty+10,returned:10,constrained:false}));
test('signed percentile includes overpredictions and does not mutate observations',()=>{
 assert.equal(quantile([-8,-5,-2,0,2,4,7,9]),7);
 assert.equal(quantile([2,4,7,9]),9);
 const rows=history([30,10,22,9,30,12,25,15,28,26,14,28,31,22]),before=structuredClone(rows);
 const r=candidateRoute(rows,date,['A'],{policy:'balanced'}).forecasts.A;
 assert.ok(r.qty>=r.last_qty);assert.ok(r.buffer>=3);assert.deepEqual(rows,before);
});
test('missing, invalid, late recorded and future evidence never invents zero demand',()=>{
 const rows=history([10,12,8,11]),expected=candidateRoute(rows,date,['A','NEW']);
 const poisoned=[...rows,{...rows[0],qty:9999,date:'2026-11-16'},{...rows[0],qty:9999,quality:'quarantined'},{...rows[0],qty:9999,available_at:'2026-11-17T01:00:00Z'}];
 assert.deepEqual(candidateRoute(poisoned,date,['A','NEW']),expected);assert.equal(expected.forecasts.NEW.qty,null);
 assert.equal(candidateRoute(history([0,0,0,0]),date,['A']).forecasts.A.qty,0);
});
test('a stockout is a lower bound, never a negative demand error or an invented sale',()=>{
 const rows=history([30,30,30,30,30,30,30,30]);Object.assign(rows.at(-1),{qty:5,loaded:5,returned:0,constrained:true});
 const f=candidateRoute(rows,date,['A']).forecasts.A;
 assert.equal(f.last_returned,0);assert.equal(f.last_constrained,true);assert.ok(f.calibration_errors.every(x=>x>=0));assert.ok(f.qty>=8);
 Object.assign(rows.at(-1),{qty:60,loaded:60});const high=candidateRoute(rows,date,['A']).forecasts.A;assert.ok(high.qty>=69);assert.equal(high.last_qty,60);
});
test('only stable completed-month patterns change seasonality',()=>{
 const rows=[];for(let d='2026-05-04';d<'2026-11-01';d=addDays(d,7))for(const product of ['A','B','C','D','E'])rows.push({date:d,product,qty:Number(d.slice(8))<=7?40:Number(d.slice(8))<=14?30:10,quality:'verified'});
 assert.ok(supportedMonthProfile(rows,'2026-11-02').factor>1);assert.ok(supportedMonthProfile(rows,date).factor<1);
 assert.equal(supportedMonthProfile(rows.map(r=>({...r,constrained:true})),date).factor,1);
 const f=candidateRoute(rows,date,['A']).forecasts.A;assert.ok(f.base<30);
});
test('fortnightly variants remain isolated and explicit plans survive refresh',()=>{
 const route={code:'R',weekday:1,schedule:{anchor_date:'2026-11-02',weeks:2,active_weeks:[0,1],names:['A','B']}};
 const rows=history([10,999,10,999,10,999,10,999]).filter(r=>comparableRouteVisit(route,date,r.date));
 const latest=candidateRoute(rows,date,['A']);assert.equal(latest.forecasts.A.base,10);
 const run={forecast_snapshot:'old',items:[{code:'A',planned:0,loaded:12,returned:3,forecast:{qty:999}}],notes:'keep',cash:{counted:800}};
 const out=applyForecastRefresh(run,{...latest,snapshot:'new'});assert.equal(out.items[0].planned,0);assert.equal(out.items[0].loaded,12);assert.equal(out.items[0].returned,3);assert.deepEqual(out.cash,run.cash);
});
