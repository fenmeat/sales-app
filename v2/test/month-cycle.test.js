import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays} from '../src/domain.js';
import {forecast} from '../src/forecast.js';
import {forecastRoute,monthPhase,routeMonthProfile} from '../src/month-cycle.js';
const date='2026-10-07',codes=['W01','W02','W03','W04','W05'];
function history(){const rows=[];for(let d='2026-04-01';d<'2026-10-01';d=addDays(d,7))for(const [i,product]of codes.entries())rows.push({date:d,product,qty:[40,30,10][monthPhase(d)]*(i+1),quality:'verified',constrained:false});return rows;}

test('calendar phases respect actual month boundaries, including leap day',()=>{
 for(const [d,p]of [['2026-10-01',0],['2026-10-07',0],['2026-10-08',1],['2026-10-14',1],['2026-10-15',2],['2026-10-31',2],['2028-02-29',2]])assert.equal(monthPhase(d),p);
});
test('learns strong early-month demand independently for three phases and retains one buffer',()=>{
 const rows=history(),first=forecastRoute(rows,date,codes),second=routeMonthProfile(rows,'2026-10-14'),late=routeMonthProfile(rows,'2026-10-21');
 assert.equal(first.month_cycle.applied,true);assert.ok(first.month_cycle.factor>1);assert.ok(second.factor>late.factor);assert.ok(late.factor<1);
 const f=first.forecasts.W01,base=forecast(rows.filter(r=>r.product==='W01'),date);
 assert.ok(f.base>base.base);assert.equal(f.buffer,Math.ceil(Math.max(base.buffer,f.base*.15)));assert.equal(f.qty,Math.ceil(f.base+f.buffer));assert.ok(f.qty>base.qty);
 assert.equal(f.mae,null);assert.equal(f.month_cycle.baseline_mae,base.mae);
});
test('no current-month, target/future, wrong-weekday or quarantined data can change the learned profile',()=>{
 const rows=history(),before=routeMonthProfile(rows,date);
 const poison=codes.flatMap(product=>['2026-10-07','2026-11-04','2026-09-29','2026-10-01'].map(d=>({date:d,product,qty:999999,quality:'verified'})));
 poison.push(...codes.map(product=>({date:'2026-09-09',product,qty:999999,quality:'quarantined'})));
 assert.deepEqual(routeMonthProfile([...rows,...poison],date),before);
 assert.deepEqual(routeMonthProfile([...rows,...codes.map(product=>({date:'2026-10-07',product,qty:999999,quality:'verified'}))],'2026-10-14'),routeMonthProfile(rows,'2026-10-14'));
 assert.deepEqual(forecastRoute([...rows,...poison.filter(r=>r.date>=date)],date,codes),forecastRoute(rows,date,codes));
});
test('relative sales pooling is scale invariant and needs three months plus five products',()=>{
 const rows=history(),before=routeMonthProfile(rows,date);
 const scaled=routeMonthProfile(rows.map(r=>r.product==='W01'?{...r,qty:r.qty*1000}:r),date);
 assert.ok(Math.abs(before.factor-scaled.factor)<1e-12);
 assert.equal(routeMonthProfile(rows.filter(r=>r.product!=='W05'),date).applied,false);
 assert.equal(routeMonthProfile(rows.filter(r=>r.date>='2026-08-01'),date).applied,false);
 const limited=rows.filter(r=>r.date>='2026-08-01'),actual=forecastRoute(limited,date,codes).forecasts.W01,original=forecast(limited.filter(r=>r.product==='W01'),date);
 assert.equal(actual.qty,original.qty);assert.equal(actual.base,original.base);assert.equal(actual.month_cycle.applied,false);
});
test('missing products remain blank, explicit zero remains zero, and source warnings survive',()=>{
 const rows=history().map(r=>({...r,quality:'provisional',constrained:true}));
 rows.push(...history().filter(r=>r.product==='W01').map(r=>({...r,product:'ZERO',qty:0})));
 const out=forecastRoute(rows,date,[...codes,'MISSING','ZERO']);
 assert.equal(out.forecasts.MISSING.qty,null);assert.equal(out.forecasts.ZERO.qty,0);
 assert.match(out.forecasts.W01.warning,/unverified/);assert.match(out.forecasts.W01.warning,/stockouts/);
 assert.deepEqual(out,forecastRoute([...rows].reverse(),date,[...codes,'MISSING','ZERO']));
});
