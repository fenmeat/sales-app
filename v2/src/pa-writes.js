import {check,UserError,dateKey} from './domain.js';
import {hash,isAdmin} from './auth.js';
import {catalog,paBusinessRequest} from './worker.js';

export const WRITE_TOOLS=new Set(['save_app_data','restore_app_change','test_app_write_access']);
const paths={register:'/api/recipes',catalog:'/api/catalog',availability:'/api/products/availability',stocktake:'/api/stocktake',production:'/api/production',sales:'/api/run'};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
function safeKeys(value) {
  if(!value||typeof value!=='object')return;
  for(const [key,v] of Object.entries(value)){check(!['__proto__','constructor','prototype'].includes(key),'Invalid field name.');safeKeys(v);}
}
function merge(old,patch) {
  const result=structuredClone(old??{});
  for(const [k,v] of Object.entries(patch))result[k]=plain(v)&&plain(result[k])?merge(result[k],v):structuredClone(v);
  return result;
}
function entries(old,updates,key) {
  check(Array.isArray(updates)&&updates.length>0&&updates.length<=500,'Supply 1–500 changed entries.');
  const next=structuredClone(old),seen=new Set();
  for(const update of updates){check(plain(update),'Each changed entry must be an object.');const id=key(update);check(id&&!seen.has(id),'Missing or duplicate entry identity.');seen.add(id);const index=next.findIndex(x=>key(x)===id);if(index<0)next.push(update);else next[index]=merge(next[index],update);}
  return next;
}
const family=target=>['register','stocktake'].includes(target)?'register':target==='availability'?'catalog':target;
function resource(target,data) {
  if(target==='sales'){dateKey(data.date);check(typeof data.route==='string'&&/^[A-Z0-9_-]{1,25}$/.test(data.route),'Choose a valid route code.');return data.date+'|'+data.route;}
  if(target==='production')return dateKey(data.date);
  return 'main';
}
function source(target,key) {
  if(target==='register')return {table:'v2_recipe_events',where:'1=1',values:[]};
  if(target==='catalog')return {table:'v2_catalog',where:'id=1',values:[]};
  if(target==='sales')return {table:'v2_events',where:'run_id=?',values:[key]};
  check(target==='production','Unsupported data target.');return {table:'v2_production_events',where:'production_date=?',values:[key]};
}
async function snapshot(db,target,key) {
  const s=source(target,key);return db.prepare(`SELECT revision,payload,actor,saved_at FROM ${s.table} WHERE ${s.where} ORDER BY revision DESC LIMIT 1`).bind(...s.values).first();
}
async function app(request,env,username,db) {
  const response=await paBusinessRequest(request,env,{username},db);return response.json();
}
const request=(path,body)=>new Request('https://fenmeat.invalid'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
function receipt(row,replayed=false) {
  return {saved:true,request_id:row.request_id,target:row.target,resource_key:row.resource_key,revision:row.revision,actor:row.actor,saved_at:row.saved_at,reason:row.reason,replayed,saved_value:JSON.parse(row.after_payload),note:'Receipt for this saved revision. Read the current data again before a further change.'};
}

// Reuse the app's existing validation and mutation code. Commit its statements
// AND the audit snapshot in one D1 transaction; a failed audit rolls back both.
function auditedDatabase(db,change,before) {
  let committed=false;
  const s=source(change.target,change.resource_key),next=(before?.revision??0)+1;
  const latest=`SELECT payload FROM ${s.table} WHERE ${s.where} AND revision=?`;
  async function commit(statements) {
    check(!committed,'Only one app save is allowed per request.');committed=true;
    // Catalogue uses compare-and-swap UPDATE; changes() must be 1, otherwise a
    // concurrent browser save could leave a misleading audit at the same revision.
    const guard=change.target==='catalog'?'changes()':'1';
    const audit=db.prepare(`INSERT INTO v2_pa_changes(request_id,request_hash,target,resource_key,revision,action,reason,actor,saved_at,before_payload,after_payload,write_guard) VALUES(?,?,?,?,?,?,?,?,?,?,(${latest}),${guard})`).bind(change.request_id,change.request_hash,change.target,change.resource_key,next,change.action,change.reason,change.actor,new Date().toISOString(),before?.payload??null,...s.values,next);
    const results=await db.batch([...statements.map(x=>x.inner),audit]);return results.slice(0,-1);
  }
  const wrap=inner=>({inner,bind:(...args)=>wrap(inner.bind(...args)),first:(...args)=>inner.first(...args),all:(...args)=>inner.all(...args),raw:(...args)=>inner.raw(...args),run:async()=> (await commit([{inner}]))[0]});
  return {prepare:sql=>wrap(db.prepare(sql)),batch:commit};
}

export async function getEditContext(args,env,username) {
  check(isAdmin(username),'Admin access is required.',403);
  if(args.target==='catalog')return {target:'catalog',catalog:await catalog(env.DB),editing:'Supply products/routes keyed by code. Omitted entries and fields stay unchanged. Use availability target for availability switches.'};
  const path=paths[args.target];check(path,'Unsupported data target.');
  if(['register','stocktake'].includes(args.target))return {target:args.target,...await app(request('/api/recipes'),env,username),editing:args.target==='stocktake'?'Count full purchase packs only: rows contain material, packs (non-negative integer), reserve and optional included_incoming. A known pack_qty is required. No loose quantities. Preserve existing allocations unless authorised to change them. Mixed historical counts need physical confirmation; never infer zero loose stock or round old totals.':'Register patches merge materials by id, recipes by group + version, packaging by product; nested objects merge and arrays replace. Existing recipe quantities require a new version. Use the stocktake target for new full-pack physical counts, not a raw stock quantity patch.'};
  check(['production','sales'].includes(args.target),'Read catalogue for availability changes.');
  const query=new URLSearchParams({date:dateKey(args.date)});if(args.target==='sales'){check(typeof args.route==='string','Choose a route.');query.set('route',args.route);}
  return {target:args.target,...await app(request(path+'?'+query),env,username),editing:'Supply the complete plan/run object from this response, with only authorised changes, plus the returned revision.'};
}

export async function getChangeHistory(args,env,username) {
  check(isAdmin(username),'Admin access is required.',403);
  if(args.request_id){const row=await env.DB.prepare('SELECT * FROM v2_pa_changes WHERE request_id=?').bind(args.request_id).first();check(row,'Change not found.',404);return {change:{...receipt(row),before_value:row.before_payload===null?null:JSON.parse(row.before_payload),action:row.action}};}
  const rows=await env.DB.prepare('SELECT request_id,target,resource_key,revision,action,reason,actor,saved_at FROM v2_pa_changes ORDER BY saved_at DESC,request_id DESC LIMIT 50').all();return {changes:rows.results};
}

export async function saveAppData(args,env,username,{fingerprintArgs=args,restore=false}={}) {
  check(isAdmin(username),'Admin access is required.',403);
  check(Object.hasOwn(paths,args.target),'Unsupported data target.');
  check(typeof args.request_id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(args.request_id),'Use a unique save identifier.');
  check(Number.isSafeInteger(args.revision)&&args.revision>=0,'Read the current revision before saving.');
  check(typeof args.reason==='string'&&args.reason.trim().length>=5&&args.reason.length<=500,'Record the instruction or evidence for this change.');
  check(plain(args.data),'Supply the changed data.');safeKeys(args.data);
  const fingerprint=await hash(JSON.stringify(fingerprintArgs)),replay=await env.DB.prepare('SELECT * FROM v2_pa_changes WHERE request_id=?').bind(args.request_id).first();
  if(replay){check(replay.actor===username&&replay.request_hash===fingerprint,'Save identifier reused for different data or user.',409);return receipt(replay,true);}
  const target=family(args.target),key=resource(target,args.data);
  // Ensure the original app schema exists before querying a never-used database.
  const context=await getEditContext({target,date:args.data.date,route:args.data.route},env,username);
  check((target==='catalog'?context.catalog.revision:context.revision)===args.revision,'The app data changed. Read it again before saving.',409);
  const before=await snapshot(env.DB,target,key);
  check((before?.revision??0)===args.revision,'The app data changed. Read it again before saving.',409);
  const action=args.action??'save';
  const allowed={register:['save'],catalog:['save'],availability:['save'],stocktake:['save'],production:['save','refresh','confirm','actuals','update_recipe'],sales:['save','forecast','load','returns','reconcile','close','reopen']};
  check(allowed[args.target].includes(action),'Invalid action for this data target.');
  const body={request_id:args.request_id,revision:args.revision,reason:args.reason,action};
  if(args.target==='register') {
    const input=args.data;check(Object.keys(input).every(k=>['materials','recipes','packaging','notes','schema_version','applied_updates'].includes(k)),'Unknown register field.');
    let r=structuredClone(context.register);
    if(restore)r=input;
    else {
      if(input.materials)r.materials=entries(r.materials,input.materials,m=>m.id);
      if(input.recipes)r.recipes=entries(r.recipes,input.recipes,r=>r.group&&Number.isSafeInteger(r.version)?r.group+'@'+r.version:null);
      if(input.packaging)r.packaging=entries(r.packaging,input.packaging,p=>p.product);
      if(Object.hasOwn(input,'notes'))r.notes=input.notes;
      check(!Object.hasOwn(input,'applied_updates')&&!Object.hasOwn(input,'schema_version'),'System fields cannot be patched.');
    }
    body.register=r;
  } else if(args.target==='catalog') {
    check(Object.keys(args.data).every(k=>['products','routes'].includes(k)),'Supply products and/or routes.');
    const c=structuredClone(context.catalog);delete c.revision;
    if(restore)body.catalog=args.data;
    else {
      for(const p of args.data.products??[]){const old=c.products.find(x=>x.code===p.code);check(!old||!Object.hasOwn(p,'available')||p.available===old.available,'Use the availability target to change a saved product switch.');check(!Object.keys(p).some(k=>k.startsWith('availability_')),'Availability metadata is managed by the app.');}
      if(args.data.products)c.products=entries(c.products,args.data.products,p=>p.code);
      if(args.data.routes)c.routes=entries(c.routes,args.data.routes,r=>r.code);
      body.catalog=c;
    }
  } else if(args.target==='availability') {
    check(Object.keys(args.data).every(k=>['code','available'].includes(k)),'Supply product code and available only.');Object.assign(body,args.data);
  } else if(args.target==='stocktake') {
    check(Object.keys(args.data).every(k=>['supplier','date','available_from','availability_confirmed','rows'].includes(k)),'Unknown stocktake field.');Object.assign(body,args.data);
  } else {
    body[target==='sales'?'run':'plan']=args.data;
    if(args.acknowledge_warnings!==undefined)body.acknowledge_warnings=args.acknowledge_warnings;
  }
  const db=auditedDatabase(env.DB,{request_id:args.request_id,request_hash:fingerprint,target,resource_key:key,action,reason:args.reason.trim(),actor:username},before);
  await app(request(paths[args.target],body),env,username,db);
  const saved=await env.DB.prepare('SELECT * FROM v2_pa_changes WHERE request_id=?').bind(args.request_id).first();
  check(saved,'Save receipt unavailable. Read the app and change history before retrying.',409);
  return receipt(saved);
}

export async function restoreAppChange(args,env,username) {
  check(isAdmin(username),'Admin access is required.',403);
  const replay=await env.DB.prepare('SELECT * FROM v2_pa_changes WHERE request_id=?').bind(args.request_id).first();
  if(replay){check(replay.actor===username&&replay.request_hash===await hash(JSON.stringify(args)),'Save identifier reused for different data or user.',409);return receipt(replay,true);}
  const row=await env.DB.prepare('SELECT * FROM v2_pa_changes WHERE request_id=?').bind(args.change_id).first();check(row,'Change not found.',404);
  check(row.before_payload!==null,'There is no earlier saved record to restore. Make a correction through the normal save tool.');
  check(args.revision===row.revision,'A restore must start from the changed revision. Review later changes first.',409);
  const data=JSON.parse(row.before_payload);
  // Availability is controlled by a separate app route; restore its saved switch
  // through that route so preserved override metadata cannot mask the correction.
  let target=row.target;
  if(target==='catalog'){
    const after=JSON.parse(row.after_payload),switched=after.products.filter(p=>p.availability_updated_at!==data.products.find(x=>x.code===p.code)?.availability_updated_at);
    if(switched.length){check(switched.length===1,'Review catalogue switches before restoring.');const p=data.products.find(x=>x.code===switched[0].code);check(p,'Product did not exist before this change.');target='availability';return saveAppData({...args,target,data:{code:p.code,available:typeof p.availability_override==='boolean'?p.availability_override:['C01','C02','C03'].includes(p.code)?false:p.available},action:'save'},env,username,{fingerprintArgs:args});}
  }
  return saveAppData({...args,target,data,action:'save'},env,username,{fingerprintArgs:args,restore:true});
}

export async function testWriteAccess(env,username) {
  check(isAdmin(username),'Admin access is required.',403);
  const id=crypto.randomUUID(),value=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO v2_pa_write_probes(id,payload) VALUES(?,?)').bind(id,value).run();
  let readBack;
  try{readBack=await env.DB.prepare('SELECT payload FROM v2_pa_write_probes WHERE id=?').bind(id).first();}
  finally{await env.DB.prepare('DELETE FROM v2_pa_write_probes WHERE id=?').bind(id).run();}
  const removed=await env.DB.prepare('SELECT id FROM v2_pa_write_probes WHERE id=?').bind(id).first();
  check(readBack?.payload===value&&!removed,'The write/read/remove test did not complete.',500);
  return {write_access_verified:true,owner:username,checked_at:new Date().toISOString(),database:'connected',business_data_changed:false,checks:['write','read_back','remove','removal_read_back']};
}
