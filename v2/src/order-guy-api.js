import {check,UserError,dateKey,addDays,today} from './domain.js';
import {hash} from './auth.js';
import {emptyRegister,validateRegister,recipeCost,orderGuyReport} from './order-guy.js';
export async function readRegister(db){const r=await db.prepare('SELECT * FROM v2_recipe_events ORDER BY revision DESC LIMIT 1').first();return r?{register:JSON.parse(r.payload),revision:r.revision,saved_at:r.saved_at,actor:r.actor}:{register:emptyRegister(),revision:0,saved_at:null,actor:null};}
export async function orderGuyApi({request,url,db,user,catalog,bodyOf,readPlan}){
 check(['alex','alinda'].includes(user.username),'Recipes, costs and Order Guy are available to Alex and Alinda.',403);
 const path=url.pathname;
 if(path==='/api/recipes/audit'){check(request.method==='GET','Method not allowed.',405);const r=await db.prepare('SELECT revision,actor,saved_at,reason FROM v2_recipe_events ORDER BY revision DESC LIMIT 50').all();return {events:r.results};}
 if(path==='/api/recipes'||path==='/api/import/recipes'){
  if(request.method==='GET'){const r=await readRegister(db);return {...r,costs:r.register.recipes.map(recipe=>recipeCost(recipe,r.register))};}
  const b=await bodyOf(request);check(typeof b.request_id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(b.request_id),'Missing save identifier.');check(typeof b.reason==='string'&&b.reason.trim().length>=5&&b.reason.length<=500,'Describe the source or reason for the change.');const fingerprint=await hash(JSON.stringify(b));
  const replay=await db.prepare('SELECT * FROM v2_recipe_events WHERE request_id=?').bind(b.request_id).first();
  if(replay){check(replay.request_hash===fingerprint,'Save identifier reused for different data.',409);return {revision:replay.revision,saved_at:replay.saved_at,replayed:true};}
  const old=await readRegister(db);check(b.revision===old.revision,'The register changed. Reload before saving; your draft has not replaced it.',409);
  const register=validateRegister(b.register);
  // Preserve all recorded identities and old recipe versions. Corrections have an audit trail.
  check(old.register.materials.every(m=>register.materials.some(x=>x.id===m.id)),'Existing materials cannot be removed.');
  for(const recipe of old.register.recipes){const next=register.recipes.find(x=>x.group===recipe.group&&x.version===recipe.version);check(next,'Keep earlier recipe versions.');if(JSON.stringify(next.ingredients)!==JSON.stringify(recipe.ingredients)||next.batch_kg!==recipe.batch_kg||next.effective_date!==recipe.effective_date||(next.plan_version??next.version)!==(recipe.plan_version??recipe.version)||JSON.stringify(next.consumables)!==JSON.stringify(recipe.consumables))throw new UserError('Changed recipe quantities need a new version. Keep the earlier version unchanged.');}
  const revision=old.revision+1,saved_at=new Date().toISOString();
  try{await db.prepare('INSERT INTO v2_recipe_events(request_id,request_hash,revision,payload,actor,saved_at,reason) VALUES(?,?,?,?,?,?,?)').bind(b.request_id,fingerprint,revision,JSON.stringify(register),user.username,saved_at,b.reason.trim()).run();}catch{throw new UserError('Another save changed the register. Reload before retrying.',409);}
  return {revision,saved_at,actor:user.username};
 }
 check(request.method==='GET','Method not allowed.',405);
 const from=dateKey(url.searchParams.get('from')??today()),to=dateKey(url.searchParams.get('to')??from);check(to>=from&&to<=addDays(from,30),'Choose at most 31 production days.');
 const saved=await db.prepare('SELECT e.* FROM v2_production_events e JOIN (SELECT production_date,MAX(revision) revision FROM v2_production_events WHERE production_date BETWEEN ? AND ? GROUP BY production_date) latest ON latest.production_date=e.production_date AND latest.revision=e.revision ORDER BY e.production_date').bind(from,to).all();
 const plans=[];for(const e of saved.results){try{plans.push(await readPlan(e.production_date));}catch{plans.push({plan:JSON.parse(e.payload),revision:e.revision,saved_at:e.saved_at,actor:e.actor,stale:null,source_warning:'Current route demand could not be verified.'});}}
 const r=await readRegister(db);return {...orderGuyReport({register:r.register,registry_revision:r.revision,plans,from,to,catalog}),register:r.register,registry_saved_at:r.saved_at,plans,catalog};
}
