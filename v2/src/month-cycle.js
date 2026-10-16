import {addDays,weekday,roundQty} from './domain.js';
import {forecast} from './forecast.js';

const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
export function monthPhase(date){const day=Number(date.slice(8,10));return day<=7?0:day<=14?1:2;}
const phaseLabels=['Days 1–7','Days 8–14','Days 15–end'];
const usable=(row,date)=>row.date<date&&Number.isFinite(row.qty)&&row.qty>=0&&['verified','provisional'].includes(row.quality)&&weekday(row.date)===weekday(date);

// A route index pools product-relative sales, never unlike products' raw quantities.
// Only completed months are fitted. Each product/month needs >=3 visits and >=2 phases;
// each month/phase needs >=5 products. The neutral pseudo-month shrinks sparse evidence.
export function routeMonthProfile(rows,date){
 const groups=new Map(),cutoff=addDays(date,-168);
 for(const row of rows){
  if(!usable(row,date)||row.date<cutoff||row.date.slice(0,7)>=date.slice(0,7))continue;
  const key=row.product+'|'+row.date.slice(0,7),group=groups.get(key)||[];group.push(row);groups.set(key,group);
 }
 const monthly=new Map();
 for(const group of groups.values()){
  if(group.length<3||new Set(group.map(row=>monthPhase(row.date))).size<2)continue;
  const average=mean(group.map(row=>row.qty));if(average<3)continue;
  for(let phase=0;phase<3;phase++){
   const matching=group.filter(row=>monthPhase(row.date)===phase);if(!matching.length)continue;
   const key=group[0].date.slice(0,7)+'|'+phase,ratios=monthly.get(key)||[];
   ratios.push(mean(matching.map(row=>row.qty))/average);monthly.set(key,ratios);
  }
 }
 const phase=monthPhase(date),months=[];
 for(const [key,ratios]of monthly)if(key.endsWith('|'+phase)&&ratios.length>=5)months.push({month:key.slice(0,7),products:ratios.length,index:median(ratios)});
 months.sort((a,b)=>a.month.localeCompare(b.month));
 const applied=months.length>=3;
 const factor=applied?Math.max(.65,Math.min(1.75,(months.reduce((sum,m)=>sum+m.index,0)+1)/(months.length+1))):1;
 return {phase,label:phaseLabels[phase],applied,factor,months:months.length,evidence:months,source:'route_same_weekday',reason:applied?'measured_route_pattern':'insufficient_comparable_months'};
}

// The baseline stays 8/12 weeks; 168 days provides completed calendar-month evidence.
// Preserve the existing calibrated reserve during this pilot. Do not sum another buffer,
// or cut the reserve merely because the expected-sales component acquired seasonality.
export function forecastRoute(routeRows,date,productCodes){
 const rows=routeRows.filter(row=>usable(row,date)&&row.date>=addDays(date,-168)).sort((a,b)=>a.date.localeCompare(b.date)||a.product.localeCompare(b.product));
 const cycle=routeMonthProfile(rows,date),forecasts={};
 for(const code of productCodes){
  const productRows=rows.filter(row=>row.product===code),original=forecast(productRows,date);
  if(!cycle.applied||original.base===null){forecasts[code]={...original,month_cycle:{...cycle,baseline_base:original.base}};continue;}
  const base=original.base*cycle.factor;
  const buffer=base===0?0:Math.ceil(Math.max(original.buffer,base*.15)),qty=Math.ceil(base+buffer);
  const warnings=(original.warning||'').replace('Suggested load is below the latest comparable sales.','').trim();
  forecasts[code]={...original,base:roundQty(base),buffer,qty,method:original.method+'+month_phase',mae:null,backtest_count:0,month_cycle:{...cycle,factor:roundQty(cycle.factor),baseline_base:original.base,baseline_mae:original.mae,baseline_backtest_count:original.backtest_count},warning:[warnings,qty<original.last_qty?'Suggested load is below the latest comparable sales.':''].filter(Boolean).join(' ')};
 }
 return {forecasts,month_cycle:{...cycle,factor:roundQty(cycle.factor)}};
}
