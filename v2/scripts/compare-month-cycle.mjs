// Private inputs only; never commit source sales, loads or generated results.
// Usage: node scripts/compare-month-cycle.mjs SETUP_JSON HISTORY_UPDATE_JSON LOAD_ROWS_JSON...
import fs from 'node:fs';
import {forecast} from '../src/forecast.js';
import {forecastRoute,monthPhase} from '../src/month-cycle.js';
import {addDays,weekday} from '../src/domain.js';
const [setupFile,updateFile,...loadFiles]=process.argv.slice(2);
if(!setupFile||!updateFile)throw Error('Provide private setup and history-update JSON files.');
const setup=JSON.parse(fs.readFileSync(setupFile)),update=JSON.parse(fs.readFileSync(updateFile));
const routeCodes=Object.fromEntries(setup.routes.map(route=>[route.name,route.code])),loads=new Map();
for(const row of loadFiles.flatMap(path=>JSON.parse(fs.readFileSync(path)))){const key=[row[0],routeCodes[row[1]],row[2]].join('|'),values=loads.get(key)||new Set();values.add(Number(row[3]));loads.set(key,values);}
const byKey=new Map([...setup.history,...update.history].map(row=>[[row.date,row.route,row.product].join('|'),row]));
const rows=[...byKey.values()].sort((a,b)=>a.date.localeCompare(b.date));
// External stock/load evidence excludes suspected stockouts as scoring targets only.
// Model inputs preserve the actual imported metadata so the comparison matches the app.
const censored=row=>{const values=loads.get([row.date,row.route,row.product].join('|'));return row.constrained===true||(values?.size===1&&[...values][0]>0&&[...values][0]===row.qty);};
const predictions=[],codes=setup.products.map(p=>p.code);
for(const route of setup.routes){
 const routeRows=rows.filter(row=>row.route===route.code),dates=[...new Set(routeRows.filter(row=>row.date>='2026-06-01'&&row.date<='2026-09-30').map(row=>row.date))];
 for(const date of dates){
  const past=routeRows.filter(row=>row.date<date&&row.date>=addDays(date,-252));
  const revised=forecastRoute(past,date,codes);
  for(const target of routeRows.filter(row=>row.date===date)){
   const productPast=past.filter(row=>row.product===target.product&&weekday(row.date)===weekday(date));if(productPast.length<8)continue;
   const baseline=forecast(productPast,date),adjusted=revised.forecasts[target.product];
   if(baseline.base===null||adjusted?.base==null)continue;
   predictions.push({route:route.code,product:target.product,date,phase:monthPhase(date),actual:target.qty,censored:censored(target),baseline,adjusted});
  }
 }
}
function metric(ps,model){const m={n:ps.length,sold:0,absError:0,bias:0,shortDays:0,shortUnits:0,excessUnits:0};for(const p of ps){const f=p[model];m.sold+=p.actual;m.absError+=Math.abs(f.base-p.actual);m.bias+=f.base-p.actual;m.shortDays+=f.qty<p.actual?1:0;m.shortUnits+=Math.max(0,p.actual-f.qty);m.excessUnits+=Math.max(0,f.qty-p.actual);}return {...m,wape:m.absError/m.sold};}
const periods={};for(const [name,from,to]of [['development','2026-06-01','2026-07-31'],['august','2026-08-01','2026-08-31'],['september','2026-09-01','2026-09-30']]){
 const ps=predictions.filter(p=>p.date>=from&&p.date<=to&&!p.censored);
 periods[name]={excluded:predictions.filter(p=>p.date>=from&&p.date<=to&&p.censored).length};
 for(const model of ['baseline','adjusted'])periods[name][model]={all:metric(ps,model),phases:[0,1,2].map(phase=>metric(ps.filter(p=>p.phase===phase),model))};
}
const upcoming={};for(const route of setup.routes.filter(r=>r.weekday===3)){
 const r=forecastRoute(rows.filter(row=>row.route===route.code),'2026-10-07',codes);
 upcoming[route.name]={month_cycle:r.month_cycle,products:Object.fromEntries(Object.entries(r.forecasts).map(([code,f])=>[code,{base:f.base,buffer:f.buffer,qty:f.qty,baseline:forecast(rows.filter(row=>row.route===route.code&&row.product===code),'2026-10-07').qty}]))};
}
console.log(JSON.stringify({periods,upcoming},null,2));
