import {addDays,weekday,roundQty} from './domain.js';
const average = list => list.reduce((s,x)=>s+x,0)/list.length;
function estimate(rows,date,mode) {
  const cutoff=addDays(date,mode==='average8'?-56:-84);
  const eligible=rows.filter(r=>r.date>=cutoff&&r.date<date&&weekday(r.date)===weekday(date));
  if(!eligible.length)return null;
  if(mode==='average8')return average(eligible.map(r=>r.qty));
  const weights=eligible.map(r=>Math.pow(.5,(Date.parse(date)-Date.parse(r.date))/86400000/28));
  return eligible.reduce((s,r,i)=>s+r.qty*weights[i],0)/weights.reduce((s,w)=>s+w,0);
}
export function forecast(rows,date,{bufferMin=3,bufferRate=.15,mode='auto'}={}) {
  // Missing observations stay missing. Exclude quarantined rows and all future data.
  rows=rows.filter(r=>r.date<date&&r.date>=addDays(date,-168)&&Number.isFinite(r.qty)&&r.qty>=0&&['verified','provisional'].includes(r.quality)).sort((a,b)=>a.date.localeCompare(b.date));
  const samples=rows.filter(r=>r.date>=addDays(date,-84)&&weekday(r.date)===weekday(date));
  if(!samples.length)return {qty:null,base:null,buffer:null,samples:0,method:'no_history',warning:'No usable actual sales for this route and weekday.'};
  const scores={average8:[],weighted12:[]};
  for(const target of samples.slice(-8)){const past=rows.filter(r=>r.date<target.date&&weekday(r.date)===weekday(date)&&r.date>=addDays(target.date,-84));if(past.length<4||target.constrained===true)continue;for(const m of Object.keys(scores)){const pred=estimate(past,target.date,m);if(pred!==null)scores[m].push(target.qty-pred);}}
  let method=mode==='auto'?'average8':mode;
  if(mode==='auto'&&scores.average8.length>=4&&scores.weighted12.length>=4){const a=average(scores.average8.map(Math.abs)),b=average(scores.weighted12.map(Math.abs));if(b<a*.95)method='weighted12';}
  let base=estimate(rows,date,method);if(base===null){method='weighted12';base=estimate(rows,date,method);}
  const errors=scores[method].filter(x=>x>0).sort((a,b)=>a-b);const residual=errors.length>=4?errors[Math.ceil(errors.length*.85)-1]:0;
  const buffer=base===0?0:Math.ceil(Math.max(bufferMin,base*bufferRate,residual));
  const constrained=samples.filter(r=>r.constrained===true).length,last=samples.at(-1),qty=Math.ceil(base+buffer);
  const missing=[];for(let d=addDays(date,-7);d>=(method==='average8'?addDays(date,-56):addDays(date,-84));d=addDays(d,-7))if(!samples.some(r=>r.date===d))missing.push(d);
  return {qty,base:roundQty(base),buffer,samples:samples.length,used_samples:samples.filter(r=>r.date>=addDays(date,method==='average8'?-56:-84)).length,method,last_date:last.date,last_qty:last.qty,last_constrained:last.constrained===true,missing_dates:missing,backtest_count:scores[method].length,mae:scores[method].length?roundQty(average(scores[method].map(Math.abs))):null,warning:[samples.length<4?'Limited history.':'',samples.some(r=>r.quality==='provisional')?'Provisional actuals: invoice reconciliation unverified.':'',constrained?'Recent stockouts may understate demand.':'',qty<last.qty?'Suggested load is below the latest comparable sales.':'',last.constrained?'Latest comparable visit may have sold out; actual demand is unknown.':''].filter(Boolean).join(' ')};
}
