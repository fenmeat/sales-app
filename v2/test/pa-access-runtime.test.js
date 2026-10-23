import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readOnlyDatabase} from '../src/pa-reads.js';
import {SCHEMA} from '../src/schema.js';
import {emptyRun} from '../src/domain.js';
import {hash} from '../src/auth.js';
import {sourceFixture} from './fixtures/staff-source.js';
import {readStaffData,STAFF_READ_SCOPE} from '../src/pa-staff-reads.js';

const origin='https://fenmeat-sales-test.alexander-fenwick.workers.dev';
const key='synthetic-test-alex-key-01234567890123456789', staff='synthetic-test-staff-key-01234567890123456789';
const adminKey='synthetic-test-alinda-key-01234567890123456789';
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
const compiled=await build({stdin:{contents:`import app from './src/connected-worker.js';export default {fetch(r,e,c){if(r.headers.has('X-Test-Rotate-Key')){const accounts=JSON.parse(e.APP_ACCESS_KEYS);accounts[r.headers.get('X-Test-Rotate-Key')==='alinda'?'alinda':'alex']='synthetic-rotated-key-01234567890123456789';e={...e,APP_ACCESS_KEYS:JSON.stringify(accounts)}}return app.fetch(r,e,c)}}`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'test-entry.js'},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],target:'es2022'});
const cookies=headers=>(headers.getSetCookie?.()??[headers.get('set-cookie')]).filter(Boolean).map(s=>s.split(';')[0]);
const pkce=async verifier=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
async function fixture(t) {
  const mf=new Miniflare(convertV4MiniflareOptions({name:'pa-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'pa-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key,alinda:adminKey,xavier:staff,xalinda:staff+'x'})},outboundService:()=>{throw Error('Unexpected outbound traffic');}}));
  t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');await db.batch(SCHEMA.map(sql=>db.prepare(sql)));
  const catalog={products:[{code:'W01',name:'Braai wors',unit:'bag',price_cents:16000,active:true,available:true}],routes:[{code:'MB',name:'Mossel Bay',weekday:2}]};
  await db.prepare('INSERT INTO v2_catalog VALUES(1,1,?,?,?)').bind(JSON.stringify(catalog),'test','2026-10-12T00:00:00Z').run();
  async function req(path,{body,form,headers={},method}={}) {
    return mf.dispatchFetch(origin+path,{method:method??(body||form?'POST':'GET'),headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},body:body?JSON.stringify(body):form?new URLSearchParams(form).toString():undefined,redirect:'manual'});
  }
  async function login(username='alex') {const r=await req('/api/login',{body:{username,key:{alex:key,alinda:adminKey,xavier:staff,xalinda:staff+'x'}[username]}});assert.equal(r.status,200);return cookies(r.headers).join('; ');}
  async function client(redirect=callback) {const r=await req('/oauth/register',{body:{client_name:'ChatGPT test',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'}});assert.equal(r.status,201);return r.json();}
  async function begin(client,{scope='fenmeat:read offline_access',resource=origin+'/mcp',verifier='p'.repeat(64),redirect=callback}={}) {
    const query=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirect,scope,state:'synthetic-state',code_challenge:await pkce(verifier),code_challenge_method:'S256',resource});
    const r=await req('/oauth/authorize?'+query);const html=await r.text();
    return {response:r,html,verifier,handle:html.match(/name="handle" value="([^"]+)"/)?.[1],cookie:cookies(r.headers).join('; '),query};
  }
  async function approve(start,session,write=false,staffRead=false) {return req('/oauth/authorize',{form:{handle:start.handle,decision:'approve',...(write?{write_access:'yes'}:{}),...(staffRead?{staff_read_access:'yes'}:{})},headers:{Cookie:[start.cookie,session].filter(Boolean).join('; ')}});}
  async function exchange(client,code,verifier='p'.repeat(64),extra={}) {return req('/oauth/token',{form:{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:callback,resource:origin+'/mcp',...extra}});}
  async function connect(write=false,username='alex',staffRead=false) {const session=await login(username),c=await client(),start=await begin(c);assert.equal(start.response.status,200,start.html);assert.equal(start.response.headers.get('referrer-policy'),'same-origin');const response=await approve(start,session,write,staffRead);assert.equal(response.status,302,await response.clone().text());const location=new URL(response.headers.get('location'));assert.equal(location.origin,'https://chatgpt.com');assert.equal(location.searchParams.get('iss'),origin);assert.equal(location.searchParams.get('state'),'synthetic-state');const code=location.searchParams.get('code'),r=await exchange(c,code);assert.equal(r.status,200,await r.clone().text());const tokens=await r.json();assert.ok(tokens.refresh_token);return {session,client:c,tokens,code,start};}
  async function rpc(tokens,method,params={}) {const r=await req('/mcp',{body:{jsonrpc:'2.0',id:1,method,params},headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18',...(tokens?{Authorization:'Bearer '+tokens.access_token}:{})}});const text=await r.text();if(r.ok)assert.ok(text,'Empty RPC response: '+method+' '+(params.name??''));return {response:r,data:text?JSON.parse(text):{}};}
  return {mf,db,req,login,client,begin,approve,exchange,connect,rpc};
}
async function businessSnapshot(db) {const result={};for(const table of ['v2_catalog','v2_events','v2_production_events','v2_recipe_events','v2_history','v2_sync','v2_zoho_connection'])result[table]=(await db.prepare('SELECT * FROM '+table).all()).results;return result;}
const change=(target,revision,data,extra={})=>({target,revision,data,request_id:crypto.randomUUID(),reason:'Synthetic owner instruction for isolated test',...extra});
async function seedStaff(f,session){
 const bundle=sourceFixture();for(let n=3;n<=65;n++)bundle.sheets.at(-1).rows.push({number:n,cells:[{formattedValue:'Synthetic source line '+n}]});
 const raw=JSON.stringify(bundle),id=await hash(raw),headers={Cookie:session};
 for(const [path,body]of [['start',{import_id:id,manifest:{id,parts:[id]}}],['chunk',{import_id:id,part:0,payload:raw}],['finish',{import_id:id,revision:0}]]){
  const r=await f.req('/api/staff/imports/'+path,{headers,body});assert.equal(r.status,200,await r.clone().text());
 }
 return {id,bundle,raw};
}
async function staffSnapshot(db){const out={};for(const table of ['v2_staff_register','v2_staff_imports','v2_staff_import_chunks','v2_staff_requests','v2_staff_time','v2_staff_pins','v2_staff_devices'])out[table]=(await db.prepare('SELECT * FROM '+table).all()).results;return out;}
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
  const list=await f.rpc(tokens,'tools/list');assert.equal(list.data.result.tools.length,15);for(const tool of list.data.result.tools){const write=['save_app_data','restore_app_change','test_app_write_access'].includes(tool.name);assert.equal(tool.annotations.readOnlyHint,!write);assert.deepEqual(tool._meta.securitySchemes[0].scopes,write?['fenmeat:read','fenmeat:write']:tool.name==='get_staff_data'?['fenmeat:read',STAFF_READ_SCOPE]:['fenmeat:read']);}
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
  for(const username of ['xavier','xalinda']){const staffSession=await f.login(username),staffStart=await f.begin(c);assert.equal((await f.approve(staffStart,staffSession,true)).status,403);assert.equal((await f.req('/api/pa/connections',{headers:{Cookie:staffSession}})).status,403);}
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

test('Alinda authorises her own admin connection, reads and saves all app areas with her own audit identity',async t=>{
 const f=await fixture(t),{tokens,session,start}=await f.connect(true,'alinda');
 assert.match(start.html,/<select id="username"/);assert.match(start.html,/value="alinda"/);
 const status=await ok(f,tokens,'get_access_status');assert.equal(status.owner,'alinda');assert.equal(status.role,'admin');assert.equal(status.write_access,true);assert.equal(status.zoho.can_manage,true);
 const before=await businessSnapshot(f.db);assert.equal((await ok(f,tokens,'test_app_write_access')).owner,'alinda');assert.deepEqual(await businessSnapshot(f.db),before);
 for(const[name,args]of [['get_catalog',{}],['get_sales',{from:'2026-10-12',to:'2026-10-12'}],['get_forecast',{date:'2026-10-13',route:'MB'}],['get_production',{date:'2026-10-12'}],['get_recipes',{}],['get_material_stock',{}],['get_order_requirements',{from:'2026-10-12',to:'2026-10-12'}]])await ok(f,tokens,name,args);
 await seedRegister(f,session);
 const saved=await ok(f,tokens,'save_app_data',change('register',1,{materials:[{id:'M1',price:{amount:35}}]}));assert.equal(saved.actor,'alinda');
 const restored=await ok(f,tokens,'restore_app_change',{change_id:saved.request_id,revision:2,request_id:crypto.randomUUID(),reason:'Alinda synthetic correction'});assert.equal(restored.actor,'alinda');assert.equal(restored.saved_value.materials[0].price.amount,30);
 await ok(f,tokens,'save_app_data',change('catalog',1,{products:[{code:'W01',price_cents:17000}]}));
 await ok(f,tokens,'save_app_data',change('availability',2,{code:'W01',available:true}));
 await ok(f,tokens,'save_app_data',change('stocktake',3,{supplier:'synthetic supplier',date:'2026-10-12',rows:[{material:'M1',packs:2,loose:0,reserve:0}]}));
 const sales=await ok(f,tokens,'get_app_edit_context',{target:'sales',date:'2026-10-12',route:'MB'});sales.run.notes='Alinda synthetic save';await ok(f,tokens,'save_app_data',change('sales',0,sales.run));
 const prod=await ok(f,tokens,'get_app_edit_context',{target:'production',date:'2026-10-12'});prod.plan.groups[0].planned=0;await ok(f,tokens,'save_app_data',change('production',0,prod.plan));
 const history=await ok(f,tokens,'get_app_change_history');assert.equal(history.changes.length,7);assert(history.changes.every(e=>e.actor==='alinda'));
 assert.equal((await ok(f,tokens,'get_recipes')).register.materials[0].stock.qty,6);
 const browserStatus=await(await f.req('/api/bootstrap',{headers:{Cookie:session}})).json();assert.equal(browserStatus.zoho.can_manage,true);
 const read=await ok(f,tokens,'get_access_status',{zoho:{resource:'reconciliation',date:'2026-10-12',route:'MB'}});assert.equal(read.zoho.stage,'invoices');
});

test('Admin grants, key rotation, read-only scope, revocation and write replay remain isolated by identity',async t=>{
 const f=await fixture(t),alex=await f.connect(true),alinda=await f.connect(true,'alinda'),read=await f.connect(false,'alinda');
 assert.equal((await ok(f,read.tokens,'get_access_status')).write_access,false);
 assert.equal((await f.rpc(read.tokens,'tools/call',{name:'test_app_write_access',arguments:{}})).response.status,403);
 const list=async session=>(await(await f.req('/api/pa/connections',{headers:{Cookie:session}})).json()).grants;
 const a=await list(alex.session),b=await list(alinda.session);assert.equal(a.length,1);assert.equal(b.length,2);assert(!a.some(g=>b.some(h=>h.id===g.id)));
 await f.req('/api/pa/connections',{body:{grant_id:a[0].id},headers:{Cookie:alinda.session}});assert.equal((await f.rpc(alex.tokens,'tools/list')).response.status,200);
 for(const[who,grant,expected]of [['alex',alex,401],['alex',alinda,200],['alinda',alex,200],['alinda',alinda,401]]){const r=await f.req('/mcp',{body:{jsonrpc:'2.0',id:1,method:'tools/list'},headers:{Accept:'application/json, text/event-stream',Authorization:'Bearer '+grant.tokens.access_token,'X-Test-Rotate-Key':who}});assert.equal(r.status,expected);}
 const args=change('catalog',1,{products:[{code:'W01',price_cents:17000}]});await ok(f,alinda.tokens,'save_app_data',args);assert.equal((await call(f,alex.tokens,'save_app_data',args)).isError,true);
 const renewal=await f.req('/oauth/token',{form:{grant_type:'refresh_token',client_id:alinda.client.client_id,refresh_token:alinda.tokens.refresh_token,resource:origin+'/mcp'}});assert.equal(renewal.status,200);const renewed=await renewal.json();assert.equal((await ok(f,renewed,'get_access_status')).owner,'alinda');
 const own=b.find(g=>g.write_access);assert.equal((await f.req('/api/pa/connections',{body:{grant_id:own.id},headers:{Cookie:alinda.session}})).status,200);assert.equal((await f.rpc(renewed,'tools/list')).response.status,401);assert.equal((await f.rpc(alex.tokens,'tools/list')).response.status,200);
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

test('Staff requires independent consent: old read/write tokens and ordinary app accounts cannot acquire it',async t=>{
 const f=await fixture(t),old=await f.connect(true);await seedStaff(f,old.session);
 const status=await ok(f,old.tokens,'get_access_status');assert.equal(status.staff_read_access,false);assert.equal(status.staff_write_access,false);assert.equal(status.write_access,true);assert.equal(status.staff,undefined);
 assert.match(old.start.html,/name="staff_read_access" value="yes" >/);
 const before=await staffSnapshot(f.db);
 for(const [name,args]of [['get_staff_data',{query:{resource:'summary'}}],['get_access_status',{staff:{resource:'summary'}}]]){
  const r=await f.rpc(old.tokens,'tools/call',{name,arguments:args});assert.equal(r.response.status,403);assert.match(r.response.headers.get('www-authenticate'),/fenmeat:staff:read/);assert.match(r.response.headers.get('www-authenticate'),/fenmeat:write/);assert.ok(!JSON.stringify(r.data).includes('Synthetic worker'));
 }
 const renewal=await f.req('/oauth/token',{form:{grant_type:'refresh_token',client_id:old.client.client_id,refresh_token:old.tokens.refresh_token,resource:origin+'/mcp',scope:'fenmeat:read fenmeat:write fenmeat:staff:read offline_access'}});
 if(renewal.ok){const renewed=await renewal.json();assert.equal((await ok(f,renewed,'get_access_status')).staff_read_access,false);}else assert.equal(renewal.status,400);
 for(const username of ['xavier','xalinda']){const session=await f.login(username),c=await f.client(),start=await f.begin(c,{scope:'fenmeat:read fenmeat:staff:read offline_access'});assert.equal((await f.approve(start,session,false,true)).status,403);}
 await assert.rejects(()=>readStaffData({resource:'summary'},{DB:f.db},'xavier',['fenmeat:read',STAFF_READ_SCOPE]),/Approve separate Staff/);
 assert.deepEqual(await staffSnapshot(f.db),before);
});

test('Separate Staff consent verifies original import, private read boundaries and paged source history without mutation',async t=>{
 const f=await fixture(t),connected=await f.connect(true,'alex',true),{tokens,session}=connected,source=await seedStaff(f,session);
 const c=await f.client(),requested=await f.begin(c,{scope:'fenmeat:read fenmeat:staff:read offline_access'});assert.match(requested.html,/name="staff_read_access" value="yes" checked/);assert.match(requested.html,/ID- en bankbesonderhede/);
 const before=await staffSnapshot(f.db),business=await businessSnapshot(f.db),status=await ok(f,tokens,'get_access_status');assert.equal(status.staff_read_access,true);assert.equal(status.staff_write_access,false);assert.equal(status.write_access,true);assert.equal(status.staff,undefined);
 const summary=await ok(f,tokens,'get_staff_data',{query:{resource:'summary'}});assert.equal(summary.import_verified,true);assert.equal(summary.verified_import.checksum,source.id);assert.equal(summary.verified_import.original_register_verified,true);assert.equal(summary.current.people,5);assert.equal(summary.current.active,3);assert.equal(summary.current.leave_ledger_entries,0);assert.equal(summary.payroll_ready,false);assert.equal(summary.uif_workflow.submission,'Auditors');assert.equal(summary.connection.owner,'alex');assert.equal(summary.verified_import.summary.rows,source.bundle.sheets.reduce((n,s)=>n+s.rows.length,0));
 const fallback=await ok(f,tokens,'get_access_status',{staff:{resource:'summary'}});assert.equal(fallback.staff.verified_import.checksum,source.id);
 const people=await ok(f,tokens,'get_staff_data',{query:{resource:'people'}});assert.equal(people.people.length,5);assert.equal(people.private_profile_included,false);assert.ok(!JSON.stringify(people).includes('00001234'));assert.ok(!JSON.stringify(people).includes('identity_number'));
 const person=people.people.find(p=>p.name==='Synthetic worker');assert.equal(person.balances.Annual,null);assert.equal(person.employment_verified,false);
 const detail=await ok(f,tokens,'get_staff_data',{query:{resource:'people',employee_id:person.id}});assert.equal(detail.people[0].source_profile.bank.account_number,'00001234');assert.equal(detail.people[0].source_profile.identity_number,'synthetic-only');
 const page=await ok(f,tokens,'get_staff_data',{query:{resource:'source_rows',sheet_id:9}});assert.deepEqual(page.rows,source.bundle.sheets.at(-1).rows.slice(0,50));assert.equal(page.total,65);
 const next=await ok(f,tokens,'get_staff_data',{query:{resource:'source_rows',sheet_id:9,offset:50}});assert.deepEqual(next.rows,source.bundle.sheets.at(-1).rows.slice(50));
 const search=await ok(f,tokens,'get_staff_data',{query:{resource:'source_rows',sheet_id:9,q:'source line 63'}});assert.equal(search.rows.length,1);assert.equal(search.rows[0].number,63);
 const hours=await ok(f,tokens,'get_staff_data',{query:{resource:'hours',from:'2026-10-12',to:'2026-10-19'}});assert.equal(hours.shifts.length,0);assert.equal(hours.source_kind,'native_clock_and_approved_leave');
 const leave=await ok(f,tokens,'get_staff_data',{query:{resource:'leave',employee_id:person.id}});assert.equal(leave.ledger_total,0);assert.equal(leave.leave_total,0);
 for(const query of [{resource:'source_rows'},{resource:'source_rows',sheet_id:9,offset:-1},{resource:'source_rows',sheet_id:9,q:'a'.repeat(101)},{resource:'people',employee_id:'invalid'},{resource:'people',sql:'SELECT * FROM v2_staff_pins'},{resource:'leave'},{resource:'hours',from:'2026-01-01',to:'2026-10-19'}])assert.equal((await call(f,tokens,'get_staff_data',{query})).isError,true);
 for(const path of ['/api/staff','/api/staff/imports','/api/staff/pin','/api/staff/device'])assert.equal((await f.req(path,{method:'POST',body:{},headers:{Authorization:'Bearer '+tokens.access_token}})).status,401);
 assert.equal((await call(f,tokens,'save_app_data',change('staff',1,{}))).isError,true);
 const serialized=JSON.stringify([summary,people,detail,hours,leave]);for(const s of ['keyFingerprint','code_hash','token_hash','pepper_id','pin_ready',tokens.access_token,key])assert.ok(!serialized.includes(s),s);
 assert.deepEqual(await staffSnapshot(f.db),before);assert.deepEqual(await businessSnapshot(f.db),business);
 const grants=(await(await f.req('/api/pa/connections',{headers:{Cookie:session}})).json()).grants;assert.equal(grants[0].staff_read_access,true);assert.equal(grants[0].write_access,true);
});

test('Staff import verification fails closed on corrupt source or original revision and permits audited later revisions',async t=>{
 const f=await fixture(t),{tokens,session}=await f.connect(false,'alinda',true),source=await seedStaff(f,session);
 const summary=()=>call(f,tokens,'get_staff_data',{query:{resource:'summary'}});
 assert.equal((await summary()).structuredContent.import_verified,true);
 await f.db.prepare('UPDATE v2_staff_import_chunks SET payload=? WHERE import_id=?').bind(source.raw+' ',source.id).run();assert.equal((await summary()).isError,true);
 await f.db.prepare('UPDATE v2_staff_import_chunks SET payload=? WHERE import_id=?').bind(source.raw,source.id).run();
 const row=await f.db.prepare('SELECT * FROM v2_staff_register WHERE revision=1').first(),state=JSON.parse(row.payload);state.people[0].name='Synthetic changed identity';
 await f.db.prepare('UPDATE v2_staff_register SET payload=? WHERE revision=1').bind(JSON.stringify(state)).run();assert.equal((await summary()).isError,true);
 await f.db.prepare('UPDATE v2_staff_register SET payload=? WHERE revision=1').bind(row.payload).run();
 const original=JSON.parse(row.payload),person=original.people[0];
 const saved=await f.req('/api/staff',{headers:{Cookie:session},body:{request_id:crypto.randomUUID(),revision:1,action:'employment_date',employee_id:person.id,date:'2023-03-16',reason:'Synthetic confirmed employment date'}});assert.equal(saved.status,200,await saved.clone().text());
 const verified=(await summary()).structuredContent;assert.equal(verified.revision,2);assert.equal(verified.verified_import.import_revision,1);assert.equal(verified.import_verified,true);assert.equal(verified.connection.owner,'alinda');
 const resultRow=await f.db.prepare('SELECT result FROM v2_staff_imports WHERE id=?').bind(source.id).first(),bad=JSON.parse(resultRow.result);bad.rows++;
 await f.db.prepare('UPDATE v2_staff_imports SET result=? WHERE id=?').bind(JSON.stringify(bad),source.id).run();assert.equal((await summary()).isError,true);
});

test('Staff-only consent preserves read-only business rights, refresh, owner isolation and revocation',async t=>{
 const f=await fixture(t),alex=await f.connect(false,'alex',true),alinda=await f.connect(false,'alinda',true);await seedStaff(f,alex.session);
 const status=await ok(f,alex.tokens,'get_access_status');assert.equal(status.staff_read_access,true);assert.equal(status.write_access,false);
 assert.equal((await f.rpc(alex.tokens,'tools/call',{name:'test_app_write_access',arguments:{}})).response.status,403);
 assert.equal((await ok(f,alinda.tokens,'get_staff_data',{query:{resource:'summary'}})).connection.owner,'alinda');
 const r=await f.req('/oauth/token',{form:{grant_type:'refresh_token',client_id:alex.client.client_id,refresh_token:alex.tokens.refresh_token,resource:origin+'/mcp'}});assert.equal(r.status,200);const tokens=await r.json();assert.equal((await ok(f,tokens,'get_access_status')).staff_read_access,true);
 const grants=(await(await f.req('/api/pa/connections',{headers:{Cookie:alex.session}})).json()).grants;
 await f.req('/api/pa/connections',{body:{grant_id:grants[0].id},headers:{Cookie:alinda.session}});assert.equal((await ok(f,tokens,'get_staff_data',{query:{resource:'summary'}})).import_verified,true);
 await f.req('/api/pa/connections',{body:{grant_id:grants[0].id},headers:{Cookie:alex.session}});assert.equal((await f.rpc(tokens,'tools/call',{name:'get_staff_data',arguments:{query:{resource:'summary'}}})).response.status,401);
 assert.equal((await ok(f,alinda.tokens,'get_staff_data',{query:{resource:'summary'}})).import_verified,true);
});
