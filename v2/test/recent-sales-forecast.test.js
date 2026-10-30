import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {addDays,emptyRun,comparableRouteVisit} from '../src/domain.js';
import {forecast,applyRecentSalesFloor} from '../src/forecast.js';
import {forecastRoute,monthPhase} from '../src/month-cycle.js';
import {effectiveHistory,applyForecastRefresh} from '../src/forecast-history.js';

const target='2026-10-21';
const observations=(quantities,constrained=false)=>quantities.map((qty,i)=>({date:addDays(target,(i-quantities.length)*7),qty,quality:'provisional',constrained:i===quantities.length-1&&constrained}));

test('latest comparable sales protect a loading suggestion even when some stock returned',()=>{
 const rows=observations([7,8,10,9,8,10,5,23]),before=structuredClone(rows);
 const result=forecast(rows,target);
 assert.equal(result.qty,27);assert.equal(result.last_qty,23);assert.equal(result.last_constrained,false);
 assert.equal(result.recent_sales_buffer,4);assert.equal(result.recent_sales_minimum,27);
 assert.ok(result.recent_sales_uplift>0);assert.doesNotMatch(result.warning,/below the latest/);
 assert.match(result.warning,/unverified/);assert.deepEqual(rows,before);
});
test('stockouts add one minimum margin and a higher normal forecast remains unchanged',()=>{
 const result=forecast(observations([10,10,10,10,10,10,10,30],true),target);
 assert.equal(result.qty,35);assert.equal(result.recent_sales_buffer,5);assert.match(result.warning,/unmet demand remains unknown/);
 const high=forecast(observations([50,50,50,50,50,50,50,15],true),target);
 assert.ok(high.qty>high.recent_sales_minimum);assert.equal(high.recent_sales_uplift,0);
 assert.equal(high.qty,Math.ceil(high.base+high.buffer));
});
test('successive real sold-out visits can raise the minimum without treating suggestions as sales',()=>{
 const rows=observations([8,8,8,8,8,8,8,15],true),first=forecast(rows,target);
 assert.equal(first.recent_sales_minimum,18);
 assert.equal(forecast(rows,target).recent_sales_minimum,18);
 rows.push({date:target,qty:18,quality:'verified',constrained:true});
 assert.equal(forecast(rows,addDays(target,7)).recent_sales_minimum,21);
});
test('missing, zero, stale, wrong-weekday and invalid evidence cannot invent a minimum',()=>{
 assert.equal(forecast([],target).qty,null);assert.equal(forecast(observations([0]),target).qty,0);
 const zero=forecast(observations([30,0]),target);assert.equal(zero.recent_sales_minimum,null);
 const rows=observations([10]),before=forecast(rows,target);
 const invalid=[{date:target,qty:1000,quality:'verified'},{date:'2026-10-13',qty:1000,quality:'verified'},{date:'2026-10-14',qty:1000,quality:'quarantined'},{date:'2026-06-03',qty:1000,quality:'verified'}];
 assert.deepEqual(forecast([...rows,...invalid],target),before);
 assert.equal(forecast([{date:'2026-07-01',qty:100,quality:'verified'}],target).qty,null);
 assert.equal(applyRecentSalesFloor({qty:5,last_qty:null}).recent_sales_minimum,null);
});
test('a lower month factor cannot undo either safety minimum; a higher seasonal model is retained',()=>{
 const codes=['A','B','C','D','E'],rows=[];
 for(let date='2026-04-01';date<'2026-10-01';date=addDays(date,7))for(const product of codes)rows.push({date,product,qty:[40,30,10][monthPhase(date)],quality:'verified'});
 rows.push({date:'2026-10-14',product:'A',qty:40,quality:'verified',constrained:true},{date:'2026-10-14',product:'B',qty:23,quality:'verified',constrained:false});
 const out=forecastRoute(rows,target,codes);assert.equal(out.month_cycle.applied,true);assert.ok(out.month_cycle.factor<1);
 assert.equal(out.forecasts.A.qty,46);assert.equal(out.forecasts.B.qty,27);
 for(const code of ['A','B']){const f=out.forecasts[code];assert.equal(f.recent_sales_uplift,f.qty-Math.ceil(f.base+f.buffer));}
 rows.push({date:'2026-09-30',product:'NEW',qty:40,quality:'verified',constrained:true});
 const early=forecastRoute(rows,'2026-10-07',[...codes,'NEW']).forecasts.NEW;
 assert.ok(early.month_cycle.factor>1);assert.equal(early.qty,Math.ceil(early.base+early.buffer));assert.equal(early.recent_sales_uplift,0);
});
test('the minimum uses the matching fortnightly service cycle, never an adjacent route variant',()=>{
 const route={weekday:3,schedule:{anchor_date:'2026-10-07',weeks:2,active_weeks:[0,1],names:['Variant A','Variant B']}};
 const rows=observations([5,10,500,12,600]);
 const comparable=rows.filter(r=>comparableRouteVisit(route,target,r.date));
 const f=forecast(comparable,target);assert.equal(f.last_date,'2026-10-07');assert.equal(f.last_qty,12);assert.equal(f.recent_sales_minimum,15);
});
test('confirmed physical returns feed the minimum while refresh preserves actuals and manual choices',()=>{
 const run=emptyRun('2026-10-14','TEST',[{code:'A',name:'Synthetic A',unit:'unit',price_cents:100,active:true,available:true},{code:'B',name:'Synthetic B',unit:'unit',price_cents:100,active:true,available:true}]);
 run.phase='returned';Object.assign(run.items[0],{loaded:25,returned:2,planned:0});Object.assign(run.items[1],{loaded:30,returned:0,planned:99,sold_out:true});run.cash.counted=12300;run.notes='Keep';
 const before=structuredClone(run),payload=JSON.stringify(run);
 const history=effectiveHistory([],[{payload,confirmation_action:'returns',confirmation_payload:payload}],{from:'2026-07-01',to:target,asOf:target});
 const latest=forecastRoute(history.rows,target,['A','B']);
 assert.equal(latest.forecasts.A.qty,27);assert.equal(latest.forecasts.B.qty,35);
 const next=applyForecastRefresh(run,{snapshot:'new',...latest});
 const withoutForecast=r=>{const c=structuredClone(r);delete c.forecast_snapshot;for(const i of c.items)delete i.forecast;return c;};
 assert.deepEqual(withoutForecast(next),withoutForecast(before));assert.deepEqual(run,before);
});
test('compact product details explain the allowance once and distinguish old saved suggestions',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context={number:x=>String(x),escape:x=>String(x),state:{result:{}}};vm.createContext(context);
 for(const name of ['forecastDetails','forecastWarnings']){const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end),context);}
 const item={forecast:forecast(observations([10,10,10,10,30],true),target)};
 assert.match(context.forecastDetails(item),/30 sold \+ 5 safety units = 35/);
 assert.match(context.forecastWarnings(item),/Stockout allowance included · minimum 35/);
 assert.doesNotMatch(context.forecastWarnings(item),/review quantity/);
 assert.match(context.forecastWarnings({forecast:{qty:21,last_qty:30,last_constrained:true}}),/Historical suggestion/);
});
