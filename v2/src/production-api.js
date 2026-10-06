import {check,UserError,dateKey,weekday} from './domain.js';
import {hash} from './auth.js';
import {productionContext,nextProductionTarget,aggregateProductionDemand,buildProductionPlan,validateProductionEdits,productionSummary,normaliseProductionPlan} from './production.js';
export async function productionApi({request,url,db,user,catalog,forecastResult,runResult,bodyOf}){
 const last=date=>db.prepare('SELECT * FROM v2_production_events WHERE production_date=? ORDER BY revision DESC LIMIT 1').bind(date).first();
 async function needs(target,routes){
  const sources=await Promise.all(routes.map(async route=>{const [saved,f]=await Promise.all([runResult(db,target,route),forecastResult(db,target,route,catalog)]);return {route,name:catalog.routes.find(r=>r.code===route).name,revision:saved?.revision??0,run:saved?.run??null,forecasts:f.forecasts,forecast_snapshot:f.snapshot};}));
  const products=catalog.products.filter(p=>p.active&&(p.available||sources.some(s=>s.run?.items.some(i=>i.code===p.code&&i.planned>0))));
  const items=aggregateProductionDemand(products,sources);check(items.length>0,'No available products in the catalogue.');
  return {items,snapshot:await hash(JSON.stringify({target,routes,items}))};
 }
 const result=e=>{const plan=normaliseProductionPlan(JSON.parse(e.payload));return {plan,revision:e.revision,saved_at:e.saved_at,actor:e.actor,summary:productionSummary(plan)};};
 if(url.pathname==='/api/production/audit'){
  check(request.method==='GET','Method not allowed.',405);
  const rows=await db.prepare('SELECT revision,action,actor,saved_at,payload FROM v2_production_events WHERE production_date=? ORDER BY revision DESC LIMIT 50').bind(dateKey(url.searchParams.get('date'))).all();return {events:rows.results};
 }
 if(request.method==='GET'){
  const date=dateKey(url.searchParams.get('date')),old=await last(date);
  if(old){const r=result(old);try{const fresh=await needs(r.plan.target_date,r.plan.routes);r.stale=fresh.snapshot!==r.plan.demand_snapshot;}catch{r.stale=true;r.source_warning='Current route needs could not be checked. Saved plan retained.';}return r;}
  const target_date=nextProductionTarget(date,catalog.routes),routes=catalog.routes.filter(r=>r.weekday===weekday(target_date)).map(r=>r.code);productionContext({date,target_date,routes},catalog);
  const fresh=await needs(target_date,routes),recent=await db.prepare('SELECT payload FROM v2_production_events WHERE production_date<? ORDER BY production_date DESC,revision DESC LIMIT 1').bind(date).first();
  const settingsPlan=recent?normaliseProductionPlan(JSON.parse(recent.payload)):null;
  const plan=buildProductionPlan({date,target_date,routes,...fresh,yieldSettings:settingsPlan?.items,settingsPlan});return {plan,revision:0,summary:productionSummary(plan),stale:false};
 }
 const b=await bodyOf(request);check(['save','refresh','confirm','actuals'].includes(b.action),'Unknown production action.');check(typeof b.request_id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(b.request_id),'Missing save identifier.');check(Number.isSafeInteger(b.revision)&&b.revision>=0,'Invalid revision.');
 const fingerprint=await hash(JSON.stringify(b)),replay=await db.prepare('SELECT * FROM v2_production_events WHERE request_id=?').bind(b.request_id).first();
 if(replay){check(replay.request_hash===fingerprint,'Save identifier reused for different data.',409);return {...result(replay),replayed:true};}
 productionContext(b.plan,catalog);const old=await last(b.plan.date);check(b.revision===(old?.revision??0),'Another person saved this production day. Download your draft, then reload the saved plan.',409);
 const previous=old?normaliseProductionPlan(JSON.parse(old.payload)):null;
 if(previous&&b.action!=='refresh')check(previous.target_date===b.plan.target_date&&JSON.stringify(previous.routes)===JSON.stringify(b.plan.routes),'Refresh route needs after changing dates or routes.');
 let base=previous;
 if(!base){const fresh=await needs(b.plan.target_date,b.plan.routes);base=buildProductionPlan({date:b.plan.date,target_date:b.plan.target_date,routes:b.plan.routes,...fresh});}
 let plan=validateProductionEdits(b.plan,base);
 if(b.action==='refresh'){const fresh=await needs(b.plan.target_date,b.plan.routes);plan=buildProductionPlan({date:b.plan.date,target_date:b.plan.target_date,routes:b.plan.routes,...fresh,previous:plan});}
 if(b.action==='actuals'){check(previous?.phase==='confirmed','Confirm the production plan before recording actual output.');const withoutActual=p=>{const v=structuredClone(p);delete v.phase;for(const i of v.items)delete i.actual;return v;};check(JSON.stringify(withoutActual(plan))===JSON.stringify(withoutActual(previous)),'Save and confirm planning changes before recording actual output.');plan.phase='confirmed';}
 if(b.action==='confirm'){const summary=productionSummary(plan);check(summary.groups.every(g=>g.has_decision),'Choose My plan for every group, including roll cutting and each polony casing size; use zero where needed.');const warnings=summary.warnings;check(!warnings.length||b.acknowledge_warnings===true,'Review the displayed shortages or missing counts before confirming.');plan.phase='confirmed';}
 const revision=(old?.revision??0)+1,saved_at=new Date().toISOString();
 try{await db.batch([db.prepare('INSERT INTO v2_production_events(request_id,request_hash,production_date,revision,action,payload,actor,saved_at) VALUES(?,?,?,?,?,?,?,?)').bind(b.request_id,fingerprint,plan.date,revision,b.action,JSON.stringify(plan),user.username,saved_at)]);}catch{throw new UserError('Save conflict or database error. Your draft is still on screen; reload saved history to check.',409);}
 return {plan,revision,saved_at,actor:user.username,summary:productionSummary(plan),stale:undefined};
}
