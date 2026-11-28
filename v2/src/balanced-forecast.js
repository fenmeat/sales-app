import {addDays,weekday,roundQty} from './domain.js';
import {forecast,applyRecentSalesFloor} from './forecast.js';
import {forecastRoute,routeMonthProfile,monthPhase} from './month-cycle.js';

const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
export function quantile(values,p=.85) {
 if(!values.length)return 0;
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
}
const usable=(r,date)=>r.date<date&&r.date>=addDays(date,-168)&&weekday(r.date)===weekday(date)&&Number.isFinite(r.qty)&&r.qty>=0&&['verified','provisional'].includes(r.quality)&&(!r.available_at||r.available_at<date+'T03:00:00.000Z');
// Three phases are fitted only to completed months and uncensored observations.
// Require a consistent effect across months; a small/noisy calendar effect stays neutral.
export function supportedMonthProfile(rows,date) {
 const profiles=[0,1,2].map(phase=>{
  const d=date.slice(0,8)+['01','08','15'][phase];
  // Keep the target weekday when choosing a date inside the requested phase.
  let target=d;while(weekday(target)!==weekday(date))target=addDays(target,1);
  const profile=routeMonthProfile(rows.filter(r=>!r.constrained),target);
  const indices=profile.evidence.map(m=>m.index),avg=indices.length?mean(indices):1;
  const se=indices.length>1?Math.sqrt(mean(indices.map(v=>(v-avg)**2))/(indices.length-1)):Infinity;
  const supported=profile.applied&&Math.abs(avg-1)>2*se&&Math.abs(profile.factor-1)>=.05;
  return {...profile,applied:supported,factor:supported?profile.factor:1,reason:supported?'consistent_completed_month_pattern':'calendar_effect_not_supported'};
 });
 return {profiles,...profiles[monthPhase(date)]};
}
function estimate(rows,date,mode,cycle) {
 const cutoff=addDays(date,mode==='average8'?-56:-84),past=rows.filter(r=>usable(r,date)&&r.date>=cutoff);
 if(!past.length)return null;
 const w=past.map(r=>mode==='average8'?1:.5**((Date.parse(date)-Date.parse(r.date))/86400000/28));
 const target=cycle?.profiles[monthPhase(date)].factor??1;
 return target*past.reduce((s,r,i)=>s+w[i]*r.qty/(cycle?.profiles[monthPhase(r.date)].factor??1),0)/w.reduce((s,v)=>s+v,0);
}

// Alternative policies remain explicit for offline comparison and safe rollback.
// The default live policy is selected by the caller only after a dated backtest.
export function candidateRoute(routeRows,date,codes,{policy='balanced',service=.85}={}) {
 const rows=routeRows.filter(r=>usable(r,date)).sort((a,b)=>a.date.localeCompare(b.date)||a.product.localeCompare(b.product));
 const legacy=forecastRoute(rows,date,codes);
 if(policy==='legacy')return legacy;
 const cycle=supportedMonthProfile(rows,date),pastCycles=new Map(),forecasts={};
 const cycleAt=d=>{if(!pastCycles.has(d))pastCycles.set(d,supportedMonthProfile(rows.filter(r=>usable(r,d)),d));return pastCycles.get(d);};
 for(const product of codes){
  const pr=rows.filter(r=>r.product===product),old=legacy.forecasts[product];
  if(old.base===null){forecasts[product]={...old,policy};continue;}
  const samples=pr.filter(r=>r.date>=addDays(date,-84)),last=samples.at(-1);
  if(policy==='signed'){
   const basic=forecast(pr,date),mode=basic.method,errors=[];
   for(const t of samples.slice(-8)){
    const past=pr.filter(r=>usable(r,t.date)&&r.date>=addDays(t.date,-84));
    if(past.length<4||t.constrained)continue;
    const p=estimate(past,t.date,mode);if(p!==null)errors.push(t.qty-p);
   }
   const buffer=old.base===0?0:Math.ceil(Math.max(3,old.base*.15,errors.length>=4?quantile(errors,service):0));
   forecasts[product]=applyRecentSalesFloor({...old,buffer,qty:Math.ceil(old.base+buffer),policy,calibration_errors:errors});continue;
  }
  if(policy==='empirical'){
   const base=mean(samples.map(r=>r.qty)),q=quantile(samples.map(r=>r.qty),service),buffer=Math.ceil(Math.max(3,base*.15,q-base));
   forecasts[product]=applyRecentSalesFloor({...old,base:roundQty(base),buffer,qty:Math.ceil(base+buffer),policy});continue;
  }
  const scores={average8:[],weighted12:[]};
  for(const t of samples.slice(-8)){
   const past=pr.filter(r=>usable(r,t.date)&&r.date>=addDays(t.date,-84));
   if(past.length<4)continue;
   for(const mode of Object.keys(scores)){
    const p=estimate(past,t.date,mode,cycleAt(t.date));
    if(p!==null)scores[mode].push({error:t.qty-p,constrained:t.constrained===true});
   }
  }
  let method='average8';
  const ae=scores.average8.filter(r=>!r.constrained),we=scores.weighted12.filter(r=>!r.constrained);
  if(ae.length>=4&&we.length>=4&&mean(we.map(r=>Math.abs(r.error)))<mean(ae.map(r=>Math.abs(r.error)))*.95)method='weighted12';
  let base=estimate(pr,date,method,cycle);
  if(base===null){method='weighted12';base=estimate(pr,date,method,cycle);}
  const exact=scores[method].filter(r=>!r.constrained).map(r=>r.error);
  // A sold-out day's sales are a lower bound. They cannot supply a negative
  // demand error or evidence for reducing the reserve. Positive misses protect it.
  const lowerBounds=scores[method].filter(r=>r.constrained&&r.error>0).map(r=>r.error);
  const residual=exact.length>=4?quantile(exact,service):0;
  const stockoutReserve=lowerBounds.length?quantile(lowerBounds,service):0;
  const buffer=base===0?0:Math.ceil(Math.max(3,base*.15,residual,stockoutReserve));
  let f=applyRecentSalesFloor({...old,base:roundQty(base),buffer,qty:Math.ceil(base+buffer),method:method+'+calibrated',policy,
   backtest_count:exact.length,mae:exact.length?roundQty(mean(exact.map(Math.abs))):null,
   month_cycle:{...cycle,profiles:undefined,baseline_base:estimate(pr,date,method)},
   calibration_errors:exact,stockout_lower_bounds:lowerBounds,
   last_loaded:last.loaded??null,last_returned:last.returned??null,
   safety_basis:'Signed errors from comparable uncensored visits; positive sold-out errors are lower bounds. Latest sales minimum applied once.'});
  forecasts[product]=f;
 }
 return {forecasts,month_cycle:{...cycle,profiles:undefined}};
}
