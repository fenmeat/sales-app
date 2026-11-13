// Follow-up exploratory audit: the November holdout has already been inspected.
// It must NOT be relabelled as fresh independent validation of these selectors.
import fs from 'node:fs';
import path from 'node:path';
import {replayEvidence,knownCases,chooseAuditedPolicy,policyMetrics,auditPolicies} from '../src/forecast-policy-audit.js';
const [folder,baselineFile,output]=process.argv.slice(2);
if(!output)throw Error('Usage: audit-adaptive-stock.mjs PRIVATE_DIR BASELINE.json OUTPUT.json');
const baseline=JSON.parse(fs.readFileSync(baselineFile)),catalog=JSON.parse(fs.readFileSync(path.join(folder,'catalog.json')));
const input=Object.fromEntries(catalog.routes.filter(r=>r.weekday!==null).map(r=>[r.code,JSON.parse(fs.readFileSync(path.join(folder,r.code+'.json'))).evidence]));
const cache=new Map();
function available(route,date){const key=route+'|'+date;if(!cache.has(key))cache.set(key,replayEvidence(input[route],date+'T03:00:00.000Z'));return cache.get(key);}
function select(target,scope){
 const route=catalog.routes.find(r=>r.code===target.route);
 const past=knownCases(baseline.cases,available(target.route,target.date),target,route);
 return chooseAuditedPolicy(past,target,{scope});
}
const policies=[...auditPolicies,'adaptive_product','adaptive_route'];
const cases=baseline.cases.map(c=>{
 const decisions=Object.fromEntries(['product','route'].map(scope=>['adaptive_'+scope,select(c,scope)]));
 return {...c,decisions,forecasts:{...c.forecasts,...Object.fromEntries(Object.entries(decisions).map(([name,d])=>[name,c.forecasts[d.policy]]))}};
});
const result={asOf:baseline.asOf,qualification:'Exploratory follow-up on previously inspected data; not new independent confirmation. Policy choices use only prior available comparable outcomes.',minimumPriorVisits:3,policies:{},routes:{},current:{},cases};
for(const p of policies){result.policies[p]={};for(const split of ['all','development','holdout']){
 const subset=cases.filter(c=>split==='all'||split==='development'&&c.date<baseline.holdoutStart||split==='holdout'&&c.date>=baseline.holdoutStart);
 result.policies[p][split]=policyMetrics(subset,p);
}}
for(const route of catalog.routes.filter(r=>r.weekday!==null)){
 result.routes[route.code]={name:route.name,holdout:Object.fromEntries(policies.map(p=>[p,policyMetrics(cases.filter(c=>c.route===route.code&&c.date>=baseline.holdoutStart),p)]))};
 const cur=baseline.current[route.code];result.current[route.code]={date:cur.date,products:{}};
 for(const product of Object.keys(cur.forecasts.legacy)){
  const target={route:route.code,date:cur.date,product};
  result.current[route.code].products[product]=Object.fromEntries(['product','route'].map(scope=>{const d=select(target,scope);return [scope,{...d,qty:cur.forecasts[d.policy][product].qty}];}));
 }
}
// Paired route-cluster bootstrap: preserve within-route dependence. Eleven
// routes and shared calendar shocks limit interpretation; this is exploratory.
let seed=20261113;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
result.clusterIntervals={};const routeList=Object.values(result.routes),n=routeList.length;
for(const policy of policies.filter(p=>p!=='legacy')){
 const deltas=routeList.map(r=>Object.fromEntries(['excess','short','short_visits'].map(k=>[k,r.holdout[policy][k]-r.holdout.legacy[k]])));
 const draws={excess:[],short:[],short_visits:[]};
 for(let iteration=0;iteration<10000;iteration++){
  const total={excess:0,short:0,short_visits:0};for(let i=0;i<n;i++){const d=deltas[Math.floor(rand()*n)];for(const k of Object.keys(total))total[k]+=d[k];}
  for(const k of Object.keys(draws))draws[k].push(total[k]);
 }
 result.clusterIntervals[policy]=Object.fromEntries(Object.entries(draws).map(([k,v])=>{v.sort((a,b)=>a-b);return [k,{lower:v[249],upper:v[9749],estimate:deltas.reduce((s,d)=>s+d[k],0)}];}));
}
fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({policies:result.policies,intervals:result.clusterIntervals,george:result.current.R01.products.W01},null,2));
