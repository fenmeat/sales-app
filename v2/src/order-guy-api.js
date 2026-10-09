import {check,UserError,dateKey,addDays,today,weekday} from './domain.js';
import {hash} from './auth.js';
import {emptyRegister,validateRegister,recipeCost,orderGuyReport} from './order-guy.js';
import {nextProductionTarget,aggregateProductionDemand,buildProductionPlan,normaliseProductionPlan} from './production.js';
import {applySupplierCount} from './stocktake.js';
import {documentedCorrections} from './register-corrections.js';
export async function readRegister(db){const r=await db.prepare('SELECT * FROM v2_recipe_events ORDER BY revision DESC LIMIT 1').first();return r?{register:JSON.parse(r.payload),revision:r.revision,saved_at:r.saved_at,actor:r.actor}:{register:emptyRegister(),revision:0,saved_at:null,actor:null};}
export async function orderGuyApi({request,url,db,user,catalog,bodyOf,readPlan,forecastResult}){
 check(['alex','alinda'].includes(user.username),'Recipes, costs and Order Guy are available to Alex and Alinda.',403);
 const path=url.pathname;
 if(path==='/api/recipes/audit'){check(request.method==='GET','Method not allowed.',405);const r=await db.prepare('SELECT revision,actor,saved_at,reason FROM v2_recipe_events ORDER BY revision DESC LIMIT 50').all();return {events:r.results};}
 if(['/api/recipes','/api/import/recipes','/api/stocktake','/api/recipes/documented-update'].includes(path)){
  if(request.method==='GET'){const r=await readRegister(db);if(path==='/api/recipes/documented-update'){const {changes,skipped,applied}=documentedCorrections(r.register);return {revision:r.revision,changes,skipped,applied};}return {...r,costs:r.register.recipes.map(recipe=>recipeCost(recipe,r.register))};}
  check(request.method==='POST','Method not allowed.',405);
  const b=await bodyOf(request);check(typeof b.request_id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(b.request_id),'Missing save identifier.');const fingerprint=await hash(JSON.stringify(b));
  const replay=await db.prepare('SELECT * FROM v2_recipe_events WHERE request_id=?').bind(b.request_id).first();
  if(replay){check(replay.request_hash===fingerprint,'Save identifier reused for different data.',409);return {revision:replay.revision,saved_at:replay.saved_at,replayed:true};}
  const old=await readRegister(db);check(b.revision===old.revision,'The register changed. Reload before saving; your draft has not replaced it.',409);
  let draft=b.register,reason=b.reason,extra={};
  if(path==='/api/stocktake'){
   const counted=applySupplierCount(old.register,b,user.username);draft=counted.register;
   reason='Supplier stocktake: '+counted.supplier+'; counted '+b.date+'; '+counted.counted+' material(s).';extra={counted:counted.counted};
  }
  if(path==='/api/recipes/documented-update'){
   const update=documentedCorrections(old.register);check(!update.applied&&update.changes.length>0,'This documented update is already saved, or no matching entries remain.');draft=update.register;
   reason='Apply owner-requested documented packaging and patty conversion, 9 October 2026.';extra={changes:update.changes,skipped:update.skipped};
  }
  check(typeof reason==='string'&&reason.trim().length>=5&&reason.length<=500,'Describe the source or reason for the change.');
  const register=validateRegister(draft);
  // Preserve all recorded identities and old recipe versions. Corrections have an audit trail.
  check(old.register.materials.every(m=>register.materials.some(x=>x.id===m.id)),'Existing materials cannot be removed.');
  for(const recipe of old.register.recipes){const next=register.recipes.find(x=>x.group===recipe.group&&x.version===recipe.version);check(next,'Keep earlier recipe versions.');if(JSON.stringify(next.ingredients)!==JSON.stringify(recipe.ingredients)||next.batch_kg!==recipe.batch_kg||next.effective_date!==recipe.effective_date||(next.plan_version??next.version)!==(recipe.plan_version??recipe.version)||JSON.stringify(next.consumables)!==JSON.stringify(recipe.consumables))throw new UserError('Changed recipe quantities need a new version. Keep the earlier version unchanged.');}
  const revision=old.revision+1,saved_at=new Date().toISOString();
  try{await db.prepare('INSERT INTO v2_recipe_events(request_id,request_hash,revision,payload,actor,saved_at,reason) VALUES(?,?,?,?,?,?,?)').bind(b.request_id,fingerprint,revision,JSON.stringify(register),user.username,saved_at,reason.trim()).run();}catch{throw new UserError('Another save changed the register. Reload before retrying.',409);}
  return {revision,saved_at,actor:user.username,...extra};
 }
 check(request.method==='GET','Method not allowed.',405);
 const from=dateKey(url.searchParams.get('from')??today()),to=dateKey(url.searchParams.get('to')??from);check(to>=from&&to<=addDays(from,30),'Choose at most 31 production days.');
 const saved=await db.prepare('SELECT e.* FROM v2_production_events e JOIN (SELECT production_date,MAX(revision) revision FROM v2_production_events WHERE production_date BETWEEN ? AND ? GROUP BY production_date) latest ON latest.production_date=e.production_date AND latest.revision=e.revision ORDER BY e.production_date').bind(from,to).all();
 const plans=[];for(const e of saved.results){try{plans.push(await readPlan(e.production_date));}catch{plans.push({plan:JSON.parse(e.payload),revision:e.revision,saved_at:e.saved_at,actor:e.actor,stale:null,source_warning:'Current route demand could not be verified.'});}}
 // A forecast is a read-only purchasing estimate, never a synthetic saved plan.
 // Confirmed plans claim their route coverage first, including explicit zero.
 const claimed=new Map();for(const p of plans.filter(p=>p.plan.phase==='confirmed'))for(const route of p.plan.routes)claimed.set(p.plan.target_date+'|'+route,p.plan.date);
 const forecast_days=[];
 for(let date=from;date<=to;date=addDays(date,1)){
  const savedPlan=plans.find(p=>p.plan.date===date);if(savedPlan?.plan.phase==='confirmed')continue;
  const target_date=savedPlan?.plan.target_date??nextProductionTarget(date,catalog.routes);
  const requested=savedPlan?.plan.routes??catalog.routes.filter(r=>r.weekday===weekday(target_date)).map(r=>r.code);
  const overlaps=requested.filter(route=>claimed.has(target_date+'|'+route)).map(route=>({route,date:claimed.get(target_date+'|'+route)}));
  const routes=requested.filter(route=>!claimed.has(target_date+'|'+route));
  const base={date,target_date,routes,overlaps,replaced_draft_revision:savedPlan?.revision??null};
  if(!routes.length){forecast_days.push({...base,status:requested.length?'covered_by_other_day':'forecast_unavailable',source_warning:requested.length?null:'No route schedule is available for this production date.'});continue;}
  // Claim even failed reads: a later date must not disguise a gap by shifting it.
  for(const route of routes)claimed.set(target_date+'|'+route,date);
  try{
   const sources=await Promise.all(routes.map(async route=>{const f=await forecastResult(db,target_date,route,catalog);return {route,name:catalog.routes.find(r=>r.code===route)?.name??route,revision:0,run:null,...f};}));
   const recent=savedPlan?null:await db.prepare('SELECT payload FROM v2_production_events WHERE production_date<? ORDER BY production_date DESC,revision DESC LIMIT 1').bind(date).first();
   const settingsPlan=savedPlan?normaliseProductionPlan(savedPlan.plan):recent?normaliseProductionPlan(JSON.parse(recent.payload)):null;
   const items=aggregateProductionDemand(catalog.products.filter(p=>p.active&&p.available),sources);
   const snapshot=await hash(JSON.stringify({target_date,routes,sources:sources.map(s=>s.snapshot)}));
   const plan=buildProductionPlan({date,target_date,routes,items,snapshot,yieldSettings:settingsPlan?.items,settingsPlan});
   forecast_days.push({...base,status:'forecast',plan,sources:sources.map(({run,forecasts,...s})=>s),settings_date:settingsPlan?.date??null});
  }catch{forecast_days.push({...base,status:'forecast_unavailable',source_warning:'The current app forecast could not be read. Requirements remain unresolved.'});}
 }
 const r=await readRegister(db);return {...orderGuyReport({register:r.register,registry_revision:r.revision,plans,forecast_days,from,to,catalog}),register:r.register,registry_saved_at:r.saved_at,plans,catalog};
}
