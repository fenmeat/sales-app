// Offline decision audit only; never imported by the Worker or planning UI.
import {comparableRouteVisit} from './domain.js';
export const auditPolicies=['legacy','signed','balanced','empirical'];

// A service date is not an availability timestamp. Replay the observations that
// the operator could actually have known at the decision time.
export function replayEvidence(e,cutoff){
 const rows=new Map();
 if(e.import_available_at&&e.import_available_at<cutoff)for(const [date,product,qty,quality,source,constrained] of e.imported){
  if(source==='legacy_sales_log')rows.set(date+'|'+product,{date,product,qty,quality,source,constrained:constrained===1||constrained===true,available_at:e.import_available_at});
 }
 for(const event of [...e.timeline].filter(t=>t.saved_at<cutoff).sort((a,b)=>a.saved_at.localeCompare(b.saved_at)||a.revision-b.revision)){
  for(const code of event.captured)rows.delete(event.date+'|'+code);
  for(const [product,qty,quality,constrained,loaded,returned] of event.rows)rows.set(event.date+'|'+product,{date:event.date,product,qty,quality,constrained,loaded,returned,available_at:event.saved_at});
 }
 return [...rows.values()];
}

export function policyMetrics(cases,policy){
 const result={n:cases.length,excess:0,short:0,short_visits:0,stress10:0,stress25:0};
 for(const c of cases){
  const q=c.forecasts[policy].qty;
  result.excess+=Math.max(0,q-c.actual);result.short+=Math.max(0,c.actual-q);result.short_visits+=Number(q<c.actual);
  result.stress10+=Math.max(0,c.actual*(c.censored?1.10:1)-q);
  result.stress25+=Math.max(0,c.actual*(c.censored?1.25:1)-q);
 }
 return result;
}

// Never score earlier predictions against outcomes that only became available
// later. Unknown/invalidated returns do not count as zero or as exact demand.
export function knownCases(cases,knownRows,target,route){
 if(!route||route.code!==target.route)throw Error('Supply the target route schedule');
 const known=new Map(knownRows.map(r=>[r.date+'|'+r.product,r]));
 return cases.filter(c=>c.route===target.route&&c.date<target.date&&comparableRouteVisit(route,target.date,c.date)).flatMap(c=>{
  const r=known.get(c.date+'|'+c.product);
  if(!r||!['verified','provisional'].includes(r.quality)||!Number.isFinite(r.qty)||!(r.loaded>0)||!Number.isFinite(r.returned))return [];
  return [{...c,actual:r.qty,returned:r.returned,censored:r.constrained===true}];
 });
}

const dominates=(a,b)=>a.excess<b.excess&&['short','short_visits','stress10','stress25'].every(k=>a[k]<=b[k]+1e-9);
export function chooseAuditedPolicy(past,target,{scope='product'}={}){
 // Require three distinct comparable visits, not three products on one trip.
 const local=past.filter(c=>c.product===target.product);
 const enough=rows=>new Set(rows.map(c=>c.date)).size>=3;
 if(!enough(past)||(scope==='product'&&!enough(local)))return {policy:'legacy',reason:'insufficient_prior_visits'};
 const baseline=policyMetrics(past,'legacy'),localBaseline=policyMetrics(local,'legacy');
 const eligible=auditPolicies.slice(1).map(policy=>({policy,score:policyMetrics(past,policy),local:policyMetrics(local,policy)}))
  .filter(c=>dominates(c.score,baseline)&&(scope==='route'||dominates(c.local,localBaseline)));
 eligible.sort((a,b)=>a.score.excess-b.score.excess||a.score.short-b.score.short||a.policy.localeCompare(b.policy));
 return eligible.length?{policy:eligible[0].policy,reason:'prior_stock_and_service_dominance'}:{policy:'legacy',reason:'no_prior_dominance'};
}
