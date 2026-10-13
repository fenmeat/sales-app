import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readOnlyDatabase} from '../src/pa-reads.js';
import {SCHEMA} from '../src/schema.js';
import {emptyRun} from '../src/domain.js';

const origin='https://fenmeat-sales-test.alexander-fenwick.workers.dev';
const key='synthetic-test-alex-key-01234567890123456789', staff='synthetic-test-staff-key-01234567890123456789';
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
const compiled=await build({stdin:{contents:`import app from './src/connected-worker.js';export default {fetch(r,e,c){if(r.headers.has('X-Test-Rotate-Key'))e={...e,APP_ACCESS_KEYS:JSON.stringify({alex:'synthetic-rotated-key-01234567890123456789'})};return app.fetch(r,e,c)}}`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'test-entry.js'},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],target:'es2022'});
const cookies=headers=>(headers.getSetCookie?.()??[headers.get('set-cookie')]).filter(Boolean).map(s=>s.split(';')[0]);
const pkce=async verifier=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
async function fixture(t) {
  const mf=new Miniflare(convertV4MiniflareOptions({name:'pa-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'pa-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key,alinda:staff})},outboundService:()=>{throw Error('Unexpected outbound traffic');}}));
  t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');await db.batch(SCHEMA.map(sql=>db.prepare(sql)));
  const catalog={products:[{code:'W01',name:'Braai wors',unit:'bag',price_cents:16000,active:true,available:true}],routes:[{code:'MB',name:'Mossel Bay',weekday:2}]};
  await db.prepare('INSERT INTO v2_catalog VALUES(1,1,?,?,?)').bind(JSON.stringify(catalog),'test','2026-10-12T00:00:00Z').run();
  async function req(path,{body,form,headers={},method}={}) {
    return mf.dispatchFetch(origin+path,{method:method??(body||form?'POST':'GET'),headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},body:body?JSON.stringify(body):form?new URLSearchParams(form).toString():undefined,redirect:'manual'});
  }
  async function login(username='alex') {const r=await req('/api/login',{body:{username,key:username==='alex'?key:staff}});assert.equal(r.status,200);return cookies(r.headers).join('; ');}
  async function client(redirect=callback) {const r=await req('/oauth/register',{body:{client_name:'ChatGPT test',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'}});assert.equal(r.status,201);return r.json();}
  async function begin(client,{scope='fenmeat:read offline_access',resource=origin+'/mcp',verifier='p'.repeat(64),redirect=callback}={}) {
    const query=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirect,scope,state:'synthetic-state',code_challenge:await pkce(verifier),code_challenge_method:'S256',resource});
    const r=await req('/oauth/authorize?'+query);const html=await r.text();
    return {response:r,html,verifier,handle:html.match(/name="handle" value="([^"]+)"/)?.[1],cookie:cookies(r.headers).join('; '),query};
  }
  async function approve(start,session,write=false) {return req('/oauth/authorize',{form:{handle:start.handle,decision:'approve',...(write?{write_access:'yes'}:{})},headers:{Cookie:[start.cookie,session].filter(Boolean).join('; ')}});}
  async function exchange(client,code,verifier='p'.repeat(64),extra={}) {return req('/oauth/token',{form:{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:callback,resource:origin+'/mcp',...extra}});}
  async function connect(write=false) {const session=await login(),c=await client(),start=await begin(c);assert.equal(start.response.status,200,start.html);assert.equal(start.response.headers.get('referrer-policy'),'same-origin');const response=await approve(start,session,write);assert.equal(response.status,302,await response.clone().text());const location=new URL(response.headers.get('location'));assert.equal(location.origin,'https://chatgpt.com');assert.equal(location.searchParams.get('iss'),origin);assert.equal(location.searchParams.get('state'),'synthetic-state');const code=location.searchParams.get('code'),r=await exchange(c,code);assert.equal(r.status,200,await r.clone().text());const tokens=await r.json();assert.ok(tokens.refresh_token);return {session,client:c,tokens,code,start};}
  async function rpc(tokens,method,params={}) {const r=await req('/mcp',{body:{jsonrpc:'2.0',id:1,method,params},headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18',...(tokens?{Authorization:'Bearer '+tokens.access_token}:{})}});const text=await r.text();if(r.ok)assert.ok(text,'Empty RPC response: '+method+' '+(params.name??''));return {response:r,data:text?JSON.parse(text):{}};}
  return {mf,db,req,login,client,begin,approve,exchange,connect,rpc};
}
async function businessSnapshot(db) {const result={};for(const table of ['v2_catalog','v2_events','v2_production_events','v2_recipe_events','v2_history','v2_sync','v2_zoho_connection'])result[table]=(await db.prepare('SELECT * FROM '+table).all()).results;return result;}
const change=(target,revision,data,extra={})=>({target,revision,data,request_id:crypto.randomUUID(),reason:'Synthetic owner instruction for isolated test',...extra});
async function call(f,tokens,name,args={}){const r=await f.rpc(tokens,'tools/call',{name,arguments:args});assert.equal(r.response.status,200,JSON.stringify(r.data));return r.data.result;}
async function ok(f,tokens,name,args={}){const r=await call(f,tokens,name,args);assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;}
async function seedRegister(f,session){
 const material={id:'M1',name:'Synthetic meat',unit:'kg',supplier:'Synthetic Supplier',pack_qty:3,procure:true,source:'Synthetic source',notes:'',price:{amount:30,status:'verified',date:'2026-10-01',valid_until:null,source:'Synthetic invoice'},stock:{qty:11,date:'2026-10-12',reserve:0,incoming:[{qty:3,date:'2026-10-15',reference:'SYNTHETIC-PO'}],source:'Synthetic count'}};
 const recipe={group:'W01',version:1,name:'Synthetic recipe',effective_date:'2026-10-01',status:'approved',batch_kg:1,complete:true,source:'Synthetic approved recipe',notes:'',ingredients:[{material:'M1',qty:1,unit:'kg',status:'approved',note:''}],consumables:[]};
 const r=await f.req('/api/recipes',{headers:{Cookie:session},body:{request_id:crypto.randomUUID(),revision:0,reason:'Synthetic initial register',register:{schema_version:1,materials:[material],recipes:[recipe],packaging:[],notes:''}}});assert.equal(r.status,200,await r.clone().text());return {material,recipe};
}

test('Old read grants never gain writes; only explicit owner write consent grants and refreshes that scope',async t=>{
 const f=await fixture(t),old=await f.connect(),before=await businessSnapshot(f.db);
 for(const name of ['save_app_data','restore_app_change','test_app_write_access']){const denied=await f.rpc(old.tokens,'tools/call',{name,arguments:{}});assert.equal(denied.response.status,403);assert.match(denied.response.headers.get('www-authenticate'),/fenmeat:write/);}
 const refreshed=await f.req('/oauth/token',{form:{grant_type:'refresh_token',client_id:old.client.client_id,refresh_token:old.tokens.refresh_token,resource:origin+'/mcp'}});assert.equal(refreshed.status,200);const readTokens=await refreshed.json();assert.ok(!readTokens.scope.includes('fenmeat:write'));
 const status=await ok(f,readTokens,'get_access_status');assert.equal(status.write_access,false);
 const write=await f.connect(true);assert.ok(write.tokens.scope.includes('fenmeat:write'));assert.equal((await ok(f,write.tokens,'get_access_status')).write_access,true);
 const testResult=await ok(f,write.tokens,'test_app_write_access');assert.equal(testResult.write_access_verified,true);assert.equal(testResult.business_data_changed,false);assert.equal((await f.db.prepare('SELECT count(*) n FROM v2_pa_write_probes').first()).n,0);
 assert.deepEqual(await businessSnapshot(f.db),before);
 const renewed=await f.req('/oauth/token',{form:{grant_type:'refresh_token',client_id:write.client.client_id,refresh_token:write.tokens.refresh_token,resource:origin+'/mcp'}});assert.equal(renewed.status,200);assert.ok((await renewed.json()).scope.includes('fenmeat:write'));
 const grants=(await(await f.req('/api/pa/connections',{headers:{Cookie:write.session}})).json()).grants;assert.equal(grants.filter(g=>g.write_access).length,1);
 await f.req('/api/pa/connections',{body:{grant_id:grants.find(g=>g.write_access).id},headers:{Cookie:write.session}});assert.equal((await f.rpc(write.tokens,'tools/call',{name:'test_app_write_access',arguments:{}})).response.status,401);
});

test('Register patches retain stock, record before/after, reject invalid versions and support idempotent save/restore',async t=>{
 const f=await fixture(t),{tokens,session}=await f.connect(true),{recipe}=await seedRegister(f,session);
 const args=change('register',1,{materials:[{id:'M1',price:{amount:35}}]});const saved=await ok(f,tokens,'save_app_data',args);assert.equal(saved.revision,2);assert.equal(saved.saved_value.materials[0].price.amount,35);assert.equal(saved.saved_value.materials[0].stock.incoming.length,1);assert.equal(saved.saved_value.materials[0].price.source,'Synthetic invoice');
 const replay=await ok(f,tokens,'save_app_data',args);assert.equal(replay.replayed,true);assert.equal(replay.revision,2);
 assert.equal((await call(f,tokens,'save_app_data',{...args,data:{notes:'Different'}})).isError,true);
 assert.equal((await call(f,tokens,'save_app_data',change('register',1,{notes:'Stale'}))).isError,true);
 assert.equal((await call(f,tokens,'save_app_data',change('register',2,{recipes:[{group:'W01',version:1,batch_kg:2,ingredients:[{...recipe.ingredients[0],qty:2}]}]}))).isError,true);
 const history=await ok(f,tokens,'get_app_change_history',{request_id:args.request_id});assert.equal(history.change.before_value.materials[0].price.amount,30);assert.equal(history.change.saved_value.materials[0].price.amount,35);
 const restore={change_id:args.request_id,revision:2,request_id:crypto.randomUUID(),reason:'Synthetic correction: restore prior price'};
 const restored=await ok(f,tokens,'restore_app_change',restore);assert.equal(restored.revision,3);assert.equal(restored.saved_value.materials[0].price.amount,30);assert.equal((await ok(f,tokens,'restore_app_change',restore)).replayed,true);
 const read=await ok(f,tokens,'get_recipes');assert.equal(read.revision,3);assert.equal(read.register.materials[0].price.amount,30);
 const results=await Promise.all([call(f,tokens,'save_app_data',change('register',3,{notes:'Concurrent A'})),call(f,tokens,'save_app_data',change('register',3,{notes:'Concurrent B'}))]);assert.equal(results.filter(r=>!r.isError).length,1);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM v2_pa_changes').first()).n,3);assert.equal((await f.db.prepare('SELECT count(*) n FROM v2_recipe_events').first()).n,4);
 assert.equal((await call(f,tokens,'restore_app_change',{...restore,request_id:crypto.randomUUID()})).isError,true);
});

test('Catalogue and stocktake writes use native validation, preserve null/zero and never double-receive deliveries',async t=>{
 const f=await fixture(t),{tokens,session}=await f.connect(true);await seedRegister(f,session);
 const args=change('catalog',1,{products:[{code:'W01',price_cents:17000}]});const saved=await ok(f,tokens,'save_app_data',args);assert.equal(saved.revision,2);assert.equal(saved.saved_value.products[0].name,'Braai wors');
 const changed=await ok(f,tokens,'save_app_data',change('availability',2,{code:'W01',available:false}));assert.equal(changed.revision,3);assert.equal((await ok(f,tokens,'get_catalog')).catalog.products[0].available,false);
 await ok(f,tokens,'restore_app_change',{change_id:changed.request_id,revision:3,request_id:crypto.randomUUID(),reason:'Synthetic restore availability'});assert.equal((await ok(f,tokens,'get_catalog')).catalog.products[0].available,true);
 const rows=[{material:'M1',packs:0,loose:0,reserve:0,included_incoming:['SYNTHETIC-PO']}];const count=change('stocktake',1,{supplier:'synthetic supplier',date:'2026-10-12',rows});const counted=await ok(f,tokens,'save_app_data',count);assert.equal(counted.saved_value.materials[0].stock.qty,0);assert.equal(counted.saved_value.materials[0].stock.incoming.length,0);assert.equal((await ok(f,tokens,'save_app_data',count)).replayed,true);
 assert.equal((await call(f,tokens,'save_app_data',change('stocktake',2,{supplier:'synthetic supplier',date:'2099-01-01',rows}))).isError,true);
 assert.equal((await call(f,tokens,'save_app_data',change('stocktake',2,{supplier:'synthetic supplier',date:'2026-10-12',rows}))).isError,true);
 const before=await businessSnapshot(f.db);
 await f.db.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON v2_pa_changes BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.equal((await call(f,tokens,'save_app_data',change('catalog',4,{products:[{code:'W01',price_cents:18000}]}))).isError,true);assert.deepEqual(await businessSnapshot(f.db),before);
 await f.db.exec('DROP TRIGGER synthetic_audit_failure');
 const concurrent=await Promise.all([call(f,tokens,'save_app_data',change('catalog',4,{products:[{code:'W01',price_cents:19000}]})),call(f,tokens,'save_app_data',change('catalog',4,{products:[{code:'W01',price_cents:20000}]}))]);assert.equal(concurrent.filter(x=>!x.isError).length,1);assert.equal((await ok(f,tokens,'get_catalog')).catalog.revision,5);
});

test('Sales and production saves share native workflow rules and preserve other business areas',async t=>{
 const f=await fixture(t),{tokens}=await f.connect(true);
 const sales=await ok(f,tokens,'get_app_edit_context',{target:'sales',date:'2026-10-12',route:'MB'});sales.run.items[0].planned=0;sales.run.notes='Synthetic route note';
 const saved=await ok(f,tokens,'save_app_data',change('sales',sales.revision,sales.run));assert.equal(saved.revision,1);assert.equal(saved.saved_value.items[0].planned,0);assert.equal(saved.saved_value.items[0].loaded,null);
 const before=await businessSnapshot(f.db);assert.equal((await call(f,tokens,'save_app_data',change('sales',1,saved.saved_value,{action:'close'}))).isError,true);assert.deepEqual(await businessSnapshot(f.db),before);
 const prod=await ok(f,tokens,'get_app_edit_context',{target:'production',date:'2026-10-12'});prod.plan.groups[0].planned=0;
 const production=await ok(f,tokens,'save_app_data',change('production',0,prod.plan));assert.equal(production.revision,1);assert.equal(production.saved_value.groups[0].planned,0);
 assert.equal((await call(f,tokens,'save_app_data',change('production',1,production.saved_value,{action:'actuals'}))).isError,true);
 const after=await businessSnapshot(f.db);assert.deepEqual(after.v2_history,before.v2_history);assert.deepEqual(after.v2_events,before.v2_events);assert.deepEqual(after.v2_zoho_connection,before.v2_zoho_connection);
 // Ordinary browser writes still work, but must prevent a stale connector save.
 const browserSession=await f.login();sales.run.notes='Newer browser edit';assert.equal((await f.req('/api/run',{headers:{Cookie:browserSession},body:{request_id:crypto.randomUUID(),revision:1,action:'save',run:sales.run}})).status,200);
 assert.equal((await call(f,tokens,'save_app_data',change('sales',1,sales.run))).isError,true);
});

test('OAuth discovery, owner consent, SDK handshake, all seven read tools and database immutability',async t=>{
  const f=await fixture(t),before=await businessSnapshot(f.db);
  const metadata=await(await f.req('/.well-known/oauth-authorization-server')).json();assert.ok(metadata.scopes_supported.includes('offline_access'));assert.ok(metadata.code_challenge_methods_supported.includes('S256'));assert.ok(metadata.authorization_response_iss_parameter_supported);
  const unauth=await f.rpc(null,'tools/list');assert.equal(unauth.response.status,401);assert.match(unauth.response.headers.get('www-authenticate'),/oauth-protected-resource/);
  const {tokens,session}=await f.connect();
  const init=await f.rpc(tokens,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic',version:'1'}});assert.equal(init.response.status,200);assert.equal(init.data.result.serverInfo.name,'fenmeat-read-access');
  const list=await f.rpc(tokens,'tools/list');assert.equal(list.data.result.tools.length,14);for(const tool of list.data.result.tools){const write=['save_app_data','restore_app_change','test_app_write_access'].includes(tool.name);assert.equal(tool.annotations.readOnlyHint,!write);assert.deepEqual(tool._meta.securitySchemes[0].scopes,write?['fenmeat:read','fenmeat:write']:['fenmeat:read']);}
  for(const [name,args] of [['get_catalog',{}],['get_sales',{from:'2026-10-12',to:'2026-10-12'}],['get_forecast',{date:'2026-10-13',route:'MB'}],['get_production',{date:'2026-10-12'}],['get_recipes',{}],['get_material_stock',{}],['get_order_requirements',{from:'2026-10-12',to:'2026-10-12'}]]) {
    const r=await f.rpc(tokens,'tools/call',{name,arguments:args});assert.equal(r.response.status,200);assert.equal(r.data.result?.isError,undefined,JSON.stringify(r.data));assert.equal(r.data.result.structuredContent.connection.access,'read_only');
    if(name==='get_production')assert.equal(r.data.result.structuredContent.source_kind,'unsaved_suggestion');
  }
  assert.deepEqual(await businessSnapshot(f.db),before);
  const connections=await(await f.req('/api/pa/connections',{headers:{Cookie:session}})).json();assert.equal(connections.grants.length,1);assert.ok(!JSON.stringify(connections).includes(tokens.access_token));
  const stored=JSON.stringify((await f.db.prepare('SELECT * FROM v2_pa_oauth').all()).results);assert.ok(!stored.includes(tokens.access_token));assert.ok(!stored.includes(tokens.refresh_token));assert.ok(!stored.includes(key));
});

test('OAuth tokens cannot call business write APIs, arbitrary tools, SQL, or other audiences',async t=>{
  const f=await fixture(t),{tokens}=await f.connect(),before=await businessSnapshot(f.db);
  for(const path of ['/api/run','/api/production','/api/stocktake','/api/catalog','/api/import/recipes','/api/sync/ack']){
    const r=await f.req(path,{body:{action:'save'},headers:{Authorization:'Bearer '+tokens.access_token}});assert.equal(r.status,401,path);
  }
  const unknown=await f.rpc(tokens,'tools/call',{name:'update_stock',arguments:{sql:'DELETE FROM v2_catalog'}});assert.ok(unknown.data.error||unknown.data.result?.isError);
  const range=await f.rpc(tokens,'tools/call',{name:'get_sales',arguments:{from:'2026-01-01',to:'2026-12-31'}});assert.equal(range.data.result.isError,true);
  const injected=await f.rpc(tokens,'tools/call',{name:'get_forecast',arguments:{date:'2026-10-13',route:"MB'; DELETE FROM v2_catalog; --"}});assert.equal(injected.data.result.isError,true);
  const wrongOrigin=await f.req('/mcp',{body:{jsonrpc:'2.0',id:1,method:'tools/list'},headers:{Origin:'https://evil.example',Authorization:'Bearer '+tokens.access_token}});assert.equal(wrongOrigin.status,403);
  assert.equal((await f.req('/mcp/admin',{headers:{Authorization:'Bearer '+tokens.access_token}})).status,404);
  assert.deepEqual(await businessSnapshot(f.db),before);
  const readonly=readOnlyDatabase(f.db);assert.throws(()=>readonly.prepare('DELETE FROM v2_catalog'),/read-only/);assert.throws(()=>readonly.prepare('SELECT 1; DELETE FROM v2_catalog'),/read-only/);assert.throws(()=>readonly.batch([]),/read-only/);assert.throws(()=>readonly.prepare('SELECT 1').run(),/read-only/);
});

test('PKCE, exact callback, owner identity, browser-bound consent and code replay are enforced',async t=>{
  const f=await fixture(t),session=await f.login(),c=await f.client();
  assert.equal((await f.req('/oauth/register',{body:{redirect_uris:['https://evil.example/steal']}})).status,400);
  const wrongTarget=await f.begin(c,{resource:'https://evil.example/mcp'});assert.ok([400,302].includes(wrongTarget.response.status));assert.ok(!wrongTarget.handle);
  const changedRedirect=await f.begin(c,{redirect:'https://evil.example/steal'});assert.equal(changedRedirect.response.status,400);
  const noBrowser=await f.begin(c);assert.equal((await f.req('/oauth/authorize',{form:{handle:noBrowser.handle,decision:'approve'},headers:{Cookie:session}})).status,400);
  const staffSession=await f.login('alinda'),staffStart=await f.begin(c);assert.equal((await f.approve(staffStart,staffSession)).status,403);
  const start=await f.begin(c),approved=await f.approve(start,session);assert.equal(approved.status,302);const code=new URL(approved.headers.get('location')).searchParams.get('code');
  assert.equal((await f.exchange(c,code,'q'.repeat(64))).status,400);
  const valid=await f.exchange(c,code);assert.equal(valid.status,200);
  assert.equal((await f.exchange(c,code)).status,400);
  assert.equal((await f.approve(start,session)).status,400);
});

test('Refresh survives app logout; explicit revoke and owner-key rotation stop existing tokens',async t=>{
  const f=await fixture(t),connected=await f.connect();
  await f.req('/api/logout',{body:{},headers:{Cookie:connected.session}});
  const refreshed=await f.req('/oauth/token',{form:{grant_type:'refresh_token',client_id:connected.client.client_id,refresh_token:connected.tokens.refresh_token,resource:origin+'/mcp'}});assert.equal(refreshed.status,200);const tokens=await refreshed.json();assert.ok(tokens.refresh_token);
  assert.equal((await f.rpc(tokens,'tools/list')).response.status,200);
  const session=await f.login(),grants=await(await f.req('/api/pa/connections',{headers:{Cookie:session}})).json();
  assert.equal((await f.req('/api/pa/connections',{body:{grant_id:grants.grants[0].id},headers:{Cookie:session,Origin:'https://evil.example'}})).status,403);
  assert.equal((await f.req('/api/pa/connections',{body:{grant_id:grants.grants[0].id},headers:{Cookie:session}})).status,200);
  assert.equal((await f.rpc(tokens,'tools/list')).response.status,401);
  assert.equal((await f.req('/oauth/token',{form:{grant_type:'refresh_token',client_id:connected.client.client_id,refresh_token:tokens.refresh_token,resource:origin+'/mcp'}})).status,400);
  const again=await f.connect();assert.equal((await f.req('/mcp',{headers:{Authorization:'Bearer '+again.tokens.access_token,'X-Test-Rotate-Key':'yes'}})).status,401);
});

test('Stored grant/token expiry and consent denial do not expose business data',async t=>{
  const f=await fixture(t),{tokens}=await f.connect();
  await f.db.prepare("UPDATE v2_pa_oauth SET expires=1 WHERE key LIKE 'token:%'").run();assert.equal((await f.rpc(tokens,'tools/list')).response.status,401);
  const c=await f.client(),start=await f.begin(c),denied=await f.req('/oauth/authorize',{form:{handle:start.handle,decision:'deny'},headers:{Cookie:start.cookie}});assert.equal(denied.status,302);const url=new URL(denied.headers.get('location'));assert.equal(url.searchParams.get('error'),'access_denied');assert.equal(url.searchParams.get('iss'),origin);
  assert.equal((await f.req('/api/pa/connections')).status,401);
});

test('Saved sales, explicit-zero production decisions and count timestamps read back exactly without writes',async t=>{
  const f=await fixture(t),{tokens,session}=await f.connect();
  const c=JSON.parse((await f.db.prepare('SELECT payload FROM v2_catalog').first()).payload),run=emptyRun('2026-10-12','MB',c.products);
  run.items[0].loaded=7;run.items[0].returned=2;
  await f.db.prepare('INSERT INTO v2_events VALUES(?,?,?,?,?,?,?,?,?,?)').bind('synthetic-run-id','hash','2026-10-12|MB','2026-10-12','MB',3,'save',JSON.stringify(run),'alex','2026-10-12T07:00:00Z').run();
  const prod=await(await f.req('/api/production?date=2026-10-12',{headers:{Cookie:session}})).json();prod.plan.groups[0].planned=0;
  assert.equal((await f.req('/api/production',{headers:{Cookie:session},body:{plan:prod.plan,revision:0,action:'save',request_id:crypto.randomUUID()}})).status,200);
  const register={schema_version:1,materials:[{id:'M1',supplier:'Test',stock:{qty:0,date:'2026-10-12',incoming:[]}},{id:'M2',supplier:'Test',stock:{qty:null,date:null,incoming:[]}}],recipes:[],packaging:[],notes:'Synthetic'};
  await f.db.prepare('INSERT INTO v2_recipe_events VALUES(?,?,?,?,?,?,?)').bind('synthetic-register-id','hash',5,JSON.stringify(register),'alex','2026-10-12T07:00:00Z','Synthetic test count').run();
  const before=await businessSnapshot(f.db);
  const sales=(await f.rpc(tokens,'tools/call',{name:'get_sales',arguments:{from:'2026-10-12',to:'2026-10-12'}})).data.result.structuredContent;
  assert.equal(sales.runs[0].revision,3);assert.equal(sales.runs[0].summary.items[0].sold,5);
  const production=(await f.rpc(tokens,'tools/call',{name:'get_production',arguments:{date:'2026-10-12'}})).data.result.structuredContent;
  assert.equal(production.source_kind,'saved_plan');assert.equal(production.plan.groups[0].planned,0);assert.equal(production.revision,1);
  const stock=(await f.rpc(tokens,'tools/call',{name:'get_material_stock',arguments:{supplier:'Test'}})).data.result.structuredContent;
  assert.equal(stock.revision,5);assert.equal(stock.materials[0].stock.qty,0);assert.equal(stock.materials[1].stock.qty,null);assert.equal(stock.materials[0].stock.date,'2026-10-12');
  assert.deepEqual(await businessSnapshot(f.db),before);
});
