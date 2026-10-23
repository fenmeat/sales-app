import {check,dateKey,addDays,summarise,UserError} from './domain.js';
import {catalog,runResult,forecastResult} from './worker.js';
import {productionApi} from './production-api.js';
import {orderGuyApi,readRegister} from './order-guy-api.js';
import {recipeCost} from './order-guy.js';
import {isAdmin} from './auth.js';

// A second boundary: even a future mistake in a business read cannot write D1.
export function readOnlyDatabase(db) {
  const denied = () => { throw new Error('PA access is read-only'); };
  function statement(s) { return {bind:(...args)=>statement(s.bind(...args)),first:(...args)=>s.first(...args),all:(...args)=>s.all(...args),raw:(...args)=>s.raw(...args),run:denied}; }
  return {prepare(sql) { if (!/^\s*SELECT\b/i.test(sql) || /;/.test(sql)) return denied(); return statement(db.prepare(sql)); },batch:denied,exec:denied};
}

export async function readPaData(name, args, env, username) {
  check(isAdmin(username),'Admin-authorised read access is required.',403);
  const db=readOnlyDatabase(env.DB), c=await catalog(db), user={username};
  const source={app:'FenMeat Sales V2',generated_at:new Date().toISOString(),timezone:'Africa/Johannesburg',access:'read_only',catalog_revision:c.revision};
  // Keep business `source` fields intact (Order Guy already has one).
  const result=data=>({...data,connection:source});
  const date=()=>dateKey(args.date);
  const bodyOf=()=>{throw new UserError('PA access is read-only.',403);};
  const production=async d=>{
    const url=new URL('https://fenmeat.invalid/api/production');url.searchParams.set('date',dateKey(d));
    return productionApi({request:new Request(url),url,db,user,catalog:c,forecastResult,runResult,bodyOf});
  };
  if(name==='get_catalog') return result({catalog:c});
  if(name==='get_sales') {
    const from=dateKey(args.from),to=dateKey(args.to);check(from<=to&&to<=addDays(from,30),'Choose at most 31 calendar days.');
    if(args.route)check(c.routes.some(r=>r.code===args.route),'Unknown route.');
    const rows=await db.prepare('SELECT e.* FROM v2_events e JOIN (SELECT run_id,MAX(revision) revision FROM v2_events WHERE service_date BETWEEN ? AND ? GROUP BY run_id) latest ON latest.run_id=e.run_id AND latest.revision=e.revision ORDER BY e.service_date,e.route').bind(from,to).all();
    return result({from,to,route:args.route??null,missing_is_zero:false,runs:rows.results.filter(e=>!args.route||e.route===args.route).map(e=>({run:JSON.parse(e.payload),revision:e.revision,saved_at:e.saved_at,actor:e.actor,summary:summarise(JSON.parse(e.payload))}))});
  }
  if(name==='get_forecast') {
    check(c.routes.some(r=>r.code===args.route),'Choose a route code from get_catalog.');
    const d=date(),[forecast,saved]=await Promise.all([forecastResult(db,d,args.route,c),runResult(db,d,args.route)]);
    return result({date:d,route:args.route,forecast,saved,saved_plan_changed:false});
  }
  if(name==='get_production') {
    const plan=await production(date());return result({...plan,source_kind:plan.revision?'saved_plan':'unsaved_suggestion'});
  }
  if(name==='get_recipes'||name==='get_material_stock') {
    const r=await readRegister(db,c);
    if(name==='get_recipes')return result({...r,costs:r.register.recipes.map(recipe=>recipeCost(recipe,r.register))});
    const materials=r.register.materials.filter(m=>!args.supplier||m.supplier?.toLowerCase()===args.supplier.toLowerCase());
    return result({revision:r.revision,saved_at:r.saved_at,actor:r.actor,materials,missing_is_zero:false});
  }
  if(name==='get_order_requirements') {
    const from=dateKey(args.from),to=dateKey(args.to);check(from<=to&&to<=addDays(from,30),'Choose at most 31 production days.');
    const url=new URL('https://fenmeat.invalid/api/order-guy');url.searchParams.set('from',from);url.searchParams.set('to',to);
    const data=await orderGuyApi({request:new Request(url),url,db,user,catalog:c,bodyOf,readPlan:production,forecastResult});
    return result(data);
  }
  throw new UserError('Unknown read tool.',404);
}
