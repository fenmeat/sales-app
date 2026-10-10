import {check,UserError,dateKey,addDays,today,validateCatalog,validateRun,emptyRun,summarise,isQty,effectiveAvailability} from './domain.js';
import {orderGuyApi} from './order-guy-api.js';
import {productionApi} from './production-api.js';
import {forecastRoute} from './month-cycle.js';
import {effectiveHistory,applyForecastRefresh} from './forecast-history.js';
import {zohoStatus,beginZoho,completeZoho,checkZoho,previewZohoInvoices,previewZohoInvoice} from './zoho.js';
import {ensureSchema} from './schema.js';
import {keys,authenticate,login,sameOrigin,hash} from './auth.js';
const initialized=new WeakMap();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{...headers,...extra}});
async function init(db){if(!initialized.has(db))initialized.set(db,ensureSchema(db).catch(e=>{initialized.delete(db);throw e;}));await initialized.get(db);}
async function bodyOf(req){check(Number(req.headers.get('Content-Length')??0)<=750000,'Upload too large.',413);const text=await req.text();check(text.length<=750000,'Upload too large.',413);try{return JSON.parse(text);}catch{throw new UserError('Invalid JSON.');}}
async function catalog(db){const r=await db.prepare('SELECT * FROM v2_catalog WHERE id=1').first();return effectiveAvailability(r?{...JSON.parse(r.payload),revision:r.revision}:{products:[],routes:[],revision:0});}
const idFor=(d,r)=>`${d}|${r}`;
async function lastEvent(db,date,route){return db.prepare('SELECT * FROM v2_events WHERE run_id=? ORDER BY revision DESC LIMIT 1').bind(idFor(date,route)).first();}
async function runResult(db,date,route){const e=await lastEvent(db,date,route);if(e){const run=JSON.parse(e.payload);return {run,revision:e.revision,saved_at:e.saved_at,actor:e.actor,summary:summarise(run)};}return null;}
async function forecastResult(db,date,route,c){
 const from=addDays(date,-168),asOf=today();
 const history=await db.prepare('SELECT service_date AS date,product,qty,quality,source,constrained FROM v2_history WHERE route=? AND service_date>=? AND service_date<? ORDER BY service_date,product').bind(route,from,date).all();
 const events=await db.prepare(`SELECT e.*,
 (SELECT action FROM v2_events a WHERE a.run_id=e.run_id AND a.action IN ('returns','close','reopen','load') ORDER BY revision DESC LIMIT 1) AS confirmation_action,
 (SELECT payload FROM v2_events a WHERE a.run_id=e.run_id AND a.action IN ('returns','close','reopen','load') ORDER BY revision DESC LIMIT 1) AS confirmation_payload
 FROM v2_events e JOIN (SELECT run_id,MAX(revision) revision FROM v2_events WHERE route=? AND service_date>=? AND service_date<? GROUP BY run_id) latest ON e.run_id=latest.run_id AND e.revision=latest.revision`).bind(route,from,date).all();
 const effective=effectiveHistory(history.results,events.results,{from,to:date,asOf});
 const {forecasts,month_cycle}=forecastRoute(effective.rows,date,c.products.map(p=>p.code));
 let expected=addDays(date,-7);while(expected>=asOf)expected=addDays(expected,-7);
 const expectedRows=effective.rows.filter(r=>r.date===expected);
 const snapshot=await hash(JSON.stringify({version:'1.2-month-phase',date,route,products:c.products.map(p=>p.code).sort(),rows:effective.rows,excluded:effective.excluded}));
 return {forecasts,snapshot,model:'8/12-week baseline with measured route month phase',month_cycle,expected_visit:expected,latest_actual:effective.rows.at(-1)?.date??null,expected_visit_present:expectedRows.length>0,excluded_count:effective.excluded.length,provisional_count:effective.rows.filter(r=>r.quality==='provisional').length};
}
async function health(env){try{const r=await env.DB.prepare("SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table' AND name IN ('products','routes','route_runs','route_run_items','cash_ups')").first();return json({environment:'test',sales_app_ready:false,pilot_build:'0.14.4',database:'connected',core_tables_ready:Number(r?.table_count)===5,access_configured:Object.keys(keys(env)).length>0});}catch{return json({environment:'test',sales_app_ready:false,database:'unavailable'},503);}}
async function handle(request,env){
 check(env.APP_ENV==='test','Test environment is not configured.',503);const url=new URL(request.url),path=url.pathname,method=request.method;
 if(path==='/api/health'&&['GET','HEAD'].includes(method))return health(env);
 // Cloudflare redirects standalone .html pages to extensionless canonical URLs.
 const assetPaths=new Set(['/','/index.html','/app.js','/styles.css','/domain.js','/forecast.js','/forecast-history.js','/access-setup','/access-setup/','/access-setup.html','/access-setup.js','/staff-access','/staff-access/','/staff-access.html','/staff-access.js','/staff-access.css','/production','/production/','/production.html','/production-app.js','/production-trolleys.js','/production-staff-print.js','/production.css','/production.js','/input-selection.js','/decimal-input.js','/availability-controls.js','/zoho-page-check.js','/recipes','/recipes/','/recipes.html','/recipes-app.js','/recipes.css','/stocktake.js','/stocktake-view.js','/stocktake-state.js']);
 if(assetPaths.has(path)&&['GET','HEAD'].includes(method)){const r=await env.ASSETS.fetch(request);return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...headers}});}
 check(path.startsWith('/api/'),'Not found.',404);check(['GET','POST'].includes(method),'Method not allowed.',405);
 check(Object.keys(keys(env)).length>0,'Access is not configured. Use the setup instructions on the sign-in screen.',503);
 await init(env.DB);
 if(path==='/api/zoho/callback'&&method==='GET')return completeZoho(request,env);
 if(path==='/api/login'&&method==='POST'){const result=await login(request,env,await bodyOf(request));return json({username:result.username},200,{'Set-Cookie':result.cookie});}
 const allowKey=path.startsWith('/api/sync/')||path.startsWith('/api/import/');const user=await authenticate(request,env,{allowKey});
 if(method==='POST'&&!(allowKey&&request.headers.get('Authorization')?.startsWith('Bearer ')))sameOrigin(request);
 if(['/api/recipes','/api/recipes/audit','/api/import/recipes','/api/order-guy','/api/sync/order-guy','/api/stocktake','/api/recipes/documented-update','/api/recipes/margot-packs'].includes(path))return json(await orderGuyApi({request,url,db:env.DB,user,catalog:await catalog(env.DB),bodyOf,forecastResult,readPlan:async date=>productionApi({request:new Request(url.origin+'/api/production?date='+date),url:new URL(url.origin+'/api/production?date='+date),db:env.DB,user,catalog:await catalog(env.DB),forecastResult,runResult,bodyOf})}));
 if((path==='/api/production'||path==='/api/production/audit')&&['GET','POST'].includes(method))return json(await productionApi({request,url,db:env.DB,user,catalog:await catalog(env.DB),forecastResult,runResult,bodyOf}));
 if(path==='/api/logout'&&method==='POST'){const token=request.headers.get('Cookie')?.match(/fm_session=([a-f0-9]{64})/)?.[1];if(token)await env.DB.prepare('DELETE FROM v2_sessions WHERE token_hash=?').bind(await hash(token)).run();return json({ok:true},200,{'Set-Cookie':'fm_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});}
 if(path==='/api/zoho/status'&&method==='GET')return json(await zohoStatus(env,user));
 if(path==='/api/zoho/connect'&&method==='POST'){const result=await beginZoho(request,env,user);return json({authorization_url:result.authorization_url},200,{'Set-Cookie':result.cookie});}
 if(path==='/api/zoho/check'&&method==='POST')return json(await checkZoho(env,user));
 if(path==='/api/zoho/invoices/preview'&&method==='POST')return json(await previewZohoInvoices(env,user,await bodyOf(request)));
 if(path==='/api/zoho/invoice/preview'&&method==='POST')return json(await previewZohoInvoice(env,user,await bodyOf(request),await catalog(env.DB)));
 if(path==='/api/bootstrap'&&method==='GET'){const c=await catalog(env.DB);const counts=await env.DB.prepare('SELECT COUNT(*) AS rows, MAX(service_date) AS latest FROM v2_history').first();const sync=await env.DB.prepare('SELECT id,saved_at FROM v2_sync').all();const zoho=await zohoStatus(env,user);return json({username:user.username,today:today(),catalog:c,history:counts,sync:sync.results,zoho_connected:zoho.connected,zoho});}
 if(path==='/api/products/availability'&&method==='POST'){
  check(['alex','alinda'].includes(user.username),'Only Alex or Alinda can change product availability.',403);
  const b=await bodyOf(request),old=await catalog(env.DB);
  check(Number.isSafeInteger(b.revision)&&b.revision===old.revision,'Product availability changed. Close Products and open it again before changing a switch.',409);
  check(typeof b.available==='boolean'&&typeof b.code==='string','Choose a product and its availability.');
  const product=old.products.find(p=>p.code===b.code);check(product&&product.active,'Choose an active catalogue product.');
  const stamp=new Date().toISOString();product.available=b.available;product.availability_override=b.available;product.availability_updated_at=stamp;product.availability_updated_by=user.username;
  const result=await env.DB.prepare('UPDATE v2_catalog SET revision=revision+1,payload=?,actor=?,saved_at=? WHERE id=1 AND revision=?').bind(JSON.stringify({products:old.products,routes:old.routes}),user.username,stamp,old.revision).run();
  check(result.meta.changes===1,'The product list changed. Close Products and reopen it.',409);
  return json({catalog:{...old,revision:old.revision+1}});
 }
 if(path==='/api/catalog'&&method==='POST'){const b=await bodyOf(request);const c=validateCatalog(b.catalog);const old=await catalog(env.DB);for(const p of c.products){const saved=old.products.find(x=>x.code===p.code);for(const key of ['availability_override','availability_updated_at','availability_updated_by']){delete p[key];if(saved&&Object.hasOwn(saved,key))p[key]=saved[key];}}check(b.revision===old.revision,'The catalogue changed. Reload before saving.',409);let sql=old.revision?'UPDATE v2_catalog SET revision=revision+1,payload=?,actor=?,saved_at=? WHERE id=1 AND revision=?':'INSERT INTO v2_catalog(payload,actor,saved_at,revision,id) VALUES(?,?,?,1,1)';const args=[JSON.stringify({products:c.products,routes:c.routes}),user.username,new Date().toISOString()];if(old.revision)args.push(old.revision);try{const result=await env.DB.prepare(sql).bind(...args).run();check(result.meta.changes===1,'The catalogue changed. Reload.',409);}catch(e){if(e instanceof UserError)throw e;throw new UserError('Catalogue conflict. Reload.',409);}return json({revision:old.revision+1});}
 if(path==='/api/import/history'&&method==='POST'){const b=await bodyOf(request);check(Array.isArray(b.rows)&&b.rows.length>0&&b.rows.length<=250,'Import 1–250 history rows at a time.');const c=await catalog(env.DB),seen=new Set();for(const r of b.rows){dateKey(r.date);check(r.date<today()&&c.routes.some(x=>x.code===r.route)&&c.products.some(x=>x.code===r.product)&&isQty(r.qty),'Invalid history date, code or quantity.');check(r.quality==='provisional'&&r.source==='legacy_sales_log','This endpoint accepts provisional legacy actuals only.');const key=[r.date,r.route,r.product].join('|');check(!seen.has(key),'Duplicate history key in upload.');seen.add(key);}
 for(const r of b.rows)check(r.constrained===undefined||typeof r.constrained==='boolean','Invalid stockout marker.');
 const statements=b.rows.map(r=>env.DB.prepare("INSERT INTO v2_history VALUES(?,?,?,?,?,'legacy_sales_log',?) ON CONFLICT(route,product,service_date) DO UPDATE SET qty=excluded.qty,quality=excluded.quality,constrained=excluded.constrained WHERE v2_history.source='legacy_sales_log'").bind(r.date,r.route,r.product,r.qty,'provisional',r.constrained===undefined?null:r.constrained?1:0));
 statements.push(env.DB.prepare('INSERT INTO v2_sync VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,payload=excluded.payload').bind('history',new Date().toISOString(),JSON.stringify({actor:user.username,last_batch:b.rows.length})));
 const results=await env.DB.batch(statements);return json({accepted:results.slice(0,-1).reduce((s,r)=>s+(r.meta?.changes??0),0),protected_rows:results.slice(0,-1).filter(r=>!r.meta?.changes).length});}
 if(path==='/api/day'&&method==='GET'){const date=dateKey(url.searchParams.get('date'));const rows=await env.DB.prepare('SELECT e.* FROM v2_events e JOIN (SELECT run_id,MAX(revision) revision FROM v2_events WHERE service_date=? GROUP BY run_id) latest ON e.run_id=latest.run_id AND e.revision=latest.revision').bind(date).all();return json({runs:rows.results.map(e=>({route:e.route,revision:e.revision,phase:JSON.parse(e.payload).phase,saved_at:e.saved_at}))});}
 if(path==='/api/run'&&method==='GET'){const date=dateKey(url.searchParams.get('date')),route=url.searchParams.get('route'),c=await catalog(env.DB);check(c.routes.some(r=>r.code===route),'Choose an imported route.');const old=await runResult(env.DB,date,route);if(old&&old.run.phase!=='plan')return json(old);const latest=await forecastResult(env.DB,date,route,c);const {forecasts,...status}=latest;if(old)return json({...old,forecast_status:{...status,stale:old.run.forecast_snapshot!==latest.snapshot}});const run=applyForecastRefresh(emptyRun(date,route,c.products),latest);return json({run,revision:0,summary:summarise(run),forecast_status:{...status,stale:false}});}
 if(path==='/api/run'&&method==='POST'){
 const b=await bodyOf(request);check(typeof b.request_id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(b.request_id),'Missing save identifier.');const fingerprint=await hash(JSON.stringify(b));const replay=await env.DB.prepare('SELECT * FROM v2_events WHERE request_id=?').bind(b.request_id).first();if(replay){check(replay.request_hash===fingerprint,'Save identifier was reused for different data.',409);return json({run:JSON.parse(replay.payload),revision:replay.revision,saved_at:replay.saved_at,actor:replay.actor,summary:summarise(JSON.parse(replay.payload)),replayed:true});}
 const old=await lastEvent(env.DB,dateKey(b.run.date),b.run.route);check(b.revision===(old?.revision??0),'Another person saved this route. Reload before making further changes.',409);const previous=old?JSON.parse(old.payload):null;
 const c=await catalog(env.DB);check(c.routes.some(r=>r.code===b.run.route),'Unknown route.');check(Array.isArray(b.run.items),'Missing route items.');for(const i of b.run.items)check(c.products.some(p=>p.code===i.code),'Unknown product.');
 if(previous)check(previous.items.every(p=>b.run.items.some(i=>i.code===p.code)),'Saved products cannot be removed from a run.');
 let latest=null;
 if(b.action==='forecast'){check((previous?.phase??'plan')==='plan','Forecast refresh is only available before confirming the load.');latest=await forecastResult(env.DB,b.run.date,b.run.route,c);b.run=applyForecastRefresh(b.run,latest);}
 if(b.run.date>=today())for(const i of b.run.items){const p=c.products.find(p=>p.code===i.code);if(p.active&&p.available)continue;const loaded=previous?.items.find(x=>x.code===i.code)?.loaded??0;check((i.loaded??0)<=loaded,'A product is no longer available. Reload the product list before adding a load.',409);if(i.loaded===null)i.loaded=0;if(i.loaded===0&&i.returned===null)i.returned=0;}
 const run=validateRun(b.run,previous,b.action==='forecast'?'save':b.action),revision=b.revision+1,stamp=new Date().toISOString();
 const statements=[env.DB.prepare('INSERT INTO v2_events(request_id,request_hash,run_id,service_date,route,revision,action,payload,actor,saved_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(b.request_id,fingerprint,idFor(run.date,run.route),run.date,run.route,revision,b.action,JSON.stringify(run),user.username,stamp)];
 if(b.action==='close'){statements.push(env.DB.prepare('DELETE FROM v2_history WHERE route=? AND service_date=?').bind(run.route,run.date));for(const i of summarise(run).items.filter(i=>i.loaded>0))statements.push(env.DB.prepare('INSERT INTO v2_history VALUES(?,?,?,?,?,?,?)').bind(run.date,run.route,i.code,i.sold,'verified','v2_reconciled',i.sold_out===true?1:0));}
 if(b.action==='reopen')statements.push(env.DB.prepare("DELETE FROM v2_history WHERE route=? AND service_date=? AND source='v2_reconciled'").bind(run.route,run.date));
 try{await env.DB.batch(statements);}catch{throw new UserError('Save conflict or database error. Reload the route to check the last saved version.',409);}
 if(!latest&&run.phase==='plan')latest=await forecastResult(env.DB,run.date,run.route,c);
 const status=latest?Object.fromEntries(Object.entries(latest).filter(([k])=>k!=='forecasts')):null;
 return json({run,revision,saved_at:stamp,actor:user.username,summary:summarise(run),...(status?{forecast_status:{...status,stale:run.forecast_snapshot!==latest.snapshot}}:{})});}
 if(path==='/api/audit'&&method==='GET'){const date=dateKey(url.searchParams.get('date'));const r=await env.DB.prepare('SELECT revision,action,actor,saved_at,payload FROM v2_events WHERE run_id=? ORDER BY revision DESC LIMIT 50').bind(idFor(date,url.searchParams.get('route'))).all();return json({events:r.results});}
 if(path==='/api/sync/export'&&method==='GET'){
 const from=dateKey(url.searchParams.get('from')??addDays(today(),-30)),to=dateKey(url.searchParams.get('to')??today());check(from<=to&&to<=addDays(from,93),'Export up to 93 days at a time.');
 const r=await env.DB.prepare('SELECT e.* FROM v2_events e JOIN (SELECT run_id,MAX(revision) revision FROM v2_events WHERE service_date BETWEEN ? AND ? GROUP BY run_id) latest ON latest.run_id=e.run_id AND latest.revision=e.revision ORDER BY e.service_date,e.route').bind(from,to).all();return json({generated_at:new Date().toISOString(),from,to,runs:r.results.map(e=>({run:JSON.parse(e.payload),revision:e.revision,actor:e.actor,saved_at:e.saved_at,summary:summarise(JSON.parse(e.payload))}))});}
 if(path==='/api/sync/ack'&&method==='POST'){const b=await bodyOf(request);check(typeof b.spreadsheet_id==='string'&&/^[a-zA-Z0-9_-]{20,100}$/.test(b.spreadsheet_id),'Invalid spreadsheet.');await env.DB.prepare('INSERT INTO v2_sync VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,payload=excluded.payload').bind('spreadsheet',new Date().toISOString(),JSON.stringify({spreadsheet_id:b.spreadsheet_id})).run();return json({ok:true});}
 throw new UserError('Not found.',404);
}
export default {async fetch(request,env){try{const r=await handle(request,env);return request.method==='HEAD'?new Response(null,{status:r.status,headers:r.headers}):r;}catch(e){return json({error:e instanceof UserError?e.message:'The request could not be completed. Your existing saved data is unchanged.'},e instanceof UserError?e.status:500);}}};
