// Private input stays outside Git. Output contains aggregate metrics only.
// Usage: node scripts/backtest-stock-policy.mjs PRIVATE_EVIDENCE_DIR OUTPUT.json
import fs from 'node:fs';
import path from 'node:path';
import {addDays,comparableRouteVisit,routeScheduled} from '../src/domain.js';
import {candidateRoute} from '../src/balanced-forecast.js';
const [folder,output]=process.argv.slice(2);
if(!folder||!output)throw Error('Supply private evidence folder and output path');
const catalog=JSON.parse(fs.readFileSync(path.join(folder,'catalog.json'))),policies=['legacy','signed','balanced','empirical'];
const asOf='2026-11-13T08:00:00.000Z';
export function replay(e,cutoff){
 const rows=new Map();
 if(e.import_available_at&&e.import_available_at<cutoff)for(const a of e.imported){
  const [date,product,qty,quality,source,constrained]=a;
  if(source!=='legacy_sales_log')continue; // Reconciled rows must be replayed from events.
  rows.set(date+'|'+product,{date,product,qty,quality,source,constrained:constrained===1||constrained===true,available_at:e.import_available_at});
 }
 for(const event of e.timeline.filter(t=>t.saved_at<cutoff)){
  for(const code of event.captured)rows.delete(event.date+'|'+code);
  for(const [product,qty,quality,constrained,loaded,returned] of event.rows)rows.set(event.date+'|'+product,{date:event.date,product,qty,quality,constrained,loaded,returned,available_at:event.saved_at});
 }
 return [...rows.values()];
}
const bucket=()=>({n:0,sold:0,load:0,excess:0,short:0,short_visits:0,sellout_visits:0,absolute_error:0,known_returns:0,censored:0,verified:0,sensitivity10:0,sensitivity25:0});
function add(m,actual,f){
 m.n++;m.sold+=actual.qty;m.load+=f.qty;m.excess+=Math.max(0,f.qty-actual.qty);m.short+=Math.max(0,actual.qty-f.qty);m.short_visits+=Number(f.qty<actual.qty);m.sellout_visits+=Number(actual.qty>0&&f.qty<=actual.qty);m.absolute_error+=Math.abs(f.base-actual.qty);
 m.known_returns+=actual.returned??0;m.censored+=Number(actual.constrained);m.verified+=Number(actual.quality==='verified');
 m.sensitivity10+=Math.max(0,actual.qty*(actual.constrained?1.10:1)-f.qty);
 m.sensitivity25+=Math.max(0,actual.qty*(actual.constrained?1.25:1)-f.qty);
}
function finish(m){return {...m,mean_excess:m.n?m.excess/m.n:null,short_rate:m.n?m.short_visits/m.n:null,sellout_rate:m.n?m.sellout_visits/m.n:null,mae:m.n?m.absolute_error/m.n:null,wape:m.sold?m.absolute_error/m.sold:null};}
const result={asOf,trainingAvailability:'Legacy import timestamp and each event saved_at, cutoff 05:00 SAST on target date.',evaluationStart:'2026-10-14',holdoutStart:'2026-10-30',end:'2026-11-12',policies:{},routes:{},current:{},coverage:[],cases:[]};
for(const p of policies)result.policies[p]={all:bucket(),development:bucket(),holdout:bucket(),uncensored:bucket()};
for(const route of catalog.routes.filter(r=>r.weekday!==null)){
 const file=path.join(folder,route.code+'.json');if(!fs.existsSync(file))throw Error('Missing route '+route.code);
 const input=JSON.parse(fs.readFileSync(file)),e=input.evidence,final=replay(e,asOf),codes=catalog.products.map(p=>p.code);
 result.coverage.push({route:route.code,import_available_at:e.import_available_at,imported:e.imported.length,timeline:e.timeline.length,current_rows:final.length});
 const metrics=Object.fromEntries(policies.map(p=>[p,bucket()]));
 for(let date='2026-10-14';date<='2026-11-12';date=addDays(date,1)){
  if(!routeScheduled(route,date))continue;
  const past=replay(e,date+'T03:00:00.000Z').filter(r=>comparableRouteVisit(route,date,r.date));
  const predictions=Object.fromEntries(policies.map(p=>[p,candidateRoute(past,date,codes,{policy:p}).forecasts]));
  const targets=final.filter(r=>r.date===date&&r.loaded>0&&r.returned!==null);
  for(const target of targets){
   if(past.filter(r=>r.product===target.product&&r.date<date&&r.date>=addDays(date,-84)).length<4)continue;
   if(policies.some(p=>predictions[p][target.product].qty==null))continue;
   result.cases.push({route:route.code,date,product:target.product,actual:target.qty,returned:target.returned,censored:target.constrained,forecasts:Object.fromEntries(policies.map(p=>[p,{base:predictions[p][target.product].base,qty:predictions[p][target.product].qty}]))});
   for(const p of policies){const f=predictions[p][target.product];add(result.policies[p].all,target,f);add(result.policies[p][date<'2026-10-30'?'development':'holdout'],target,f);add(metrics[p],target,f);if(!target.constrained)add(result.policies[p].uncensored,target,f);}
  }
 }
 result.routes[route.code]={name:route.name,metrics:Object.fromEntries(policies.map(p=>[p,finish(metrics[p])]))};
 let next='2026-11-14';while(!routeScheduled(route,next))next=addDays(next,1);
 const past=final.filter(r=>comparableRouteVisit(route,next,r.date));
 result.current[route.code]={date:next,forecasts:Object.fromEntries(policies.map(p=>[p,candidateRoute(past,next,codes,{policy:p}).forecasts]))};
}
for(const p of policies)for(const split of Object.keys(result.policies[p]))result.policies[p][split]=finish(result.policies[p][split]);
for(const p of policies)for(const split of ['all','development','holdout','uncensored']){
 const cases=result.cases.filter(c=>split==='all'||split==='development'&&c.date<'2026-10-30'||split==='holdout'&&c.date>='2026-10-30'||split==='uncensored'&&!c.censored);
 const groups=new Set(cases.map(c=>c.route+'|'+c.date)),short=new Set(cases.filter(c=>c.forecasts[p].qty<c.actual).map(c=>c.route+'|'+c.date));
 Object.assign(result.policies[p][split],{route_days:groups.size,route_days_with_shortfall:short.size});
}
fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({coverage:result.coverage,policies:result.policies,george:Object.fromEntries(policies.map(p=>[p,result.current.R01.forecasts[p].W01]))},null,2));
