import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';
import {ZOHO_ORIGIN as origin,ZOHO_REDIRECT_URI,ZOHO_SCOPES} from '../src/zoho.js';

class D1{
 constructor(){this.db=new DatabaseSync(':memory:');}
 prepare(sql){const db=this.db;let values=[];const s={bind(...v){values=v;return s;},async first(){return db.prepare(sql).get(...values)??null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){return {meta:{changes:db.prepare(sql).run(...values).changes}};}};return s;}
 async batch(statements){this.db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());this.db.exec('COMMIT');return results;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const key='local-test-access-key-01234567890123456789';
const testSecret='local-zoho-client-secret-01234567890123456789';
async function fixture(){
 const env={APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key,alinda:key+'a'}),DB:new D1(),ZOHO_CLIENT_ID:'1000.LOCAL_TEST_CLIENT_ID',ZOHO_CLIENT_SECRET:testSecret};
 async function call(path,{body,cookie='',headers={}}={}){return worker.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined}),env);}
 const login=await call('/api/login',{body:{username:'alex',key}});assert.equal(login.status,200);
 const session=login.headers.get('set-cookie').split(';')[0];
 async function start(){const response=await call('/api/zoho/connect',{body:{},cookie:session});assert.equal(response.status,200,await response.clone().text());const data=await response.json();return {url:new URL(data.authorization_url),cookie:response.headers.get('set-cookie').split(';')[0],response};}
 const callback=(pending,extra={})=>'/api/zoho/callback?'+new URLSearchParams({state:pending.url.searchParams.get('state'),code:'1000.local-code','accounts-server':'https://accounts.zoho.com',...extra});
 return {env,call,session,start,callback};
}
function mockZoho(t,{tokenError=false,orgError=false,apiDomain='https://www.zohoapis.com',networkError=false,invalidJson=false}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'manual');
  assert.ok(!url.includes(testSecret));assert.ok(!url.includes('local-access-token'));assert.ok(!url.includes('local-refresh-token'));
  if(url==='https://accounts.zoho.com/oauth/v2/token'){
   assert.equal(options.method,'POST');const params=new URLSearchParams(options.body);
   assert.equal(params.get('client_secret'),testSecret);
   if(networkError)throw new Error(testSecret);
   if(invalidJson)return new Response(testSecret,{status:502});
   if(tokenError)return Response.json({error:tokenError===true?'unknown_error':tokenError,message:testSecret},{status:400});
   if(params.get('grant_type')==='refresh_token'){assert.equal(params.get('refresh_token'),'local-refresh-token');return Response.json({access_token:'local-renewed-access-token',expires_in:3600,api_domain:apiDomain});}
   assert.equal(params.get('grant_type'),'authorization_code');assert.equal(params.get('redirect_uri'),ZOHO_REDIRECT_URI);
   assert.match(params.get('code_verifier'),/^[a-f0-9]{64}$/);
   return Response.json({access_token:'local-access-token',refresh_token:'local-refresh-token',expires_in:1,api_domain:apiDomain});
  }
  assert.equal(url,'https://www.zohoapis.com/books/v3/organizations');assert.equal(options.method,'GET');
  assert.match(options.headers.Authorization,/^Zoho-oauthtoken local-(renewed-)?access-token$/);
  if(orgError)return Response.json({code:999,message:'private-upstream-error'},{status:503});
  return Response.json({code:0,organizations:[{organization_id:'12345',name:'Local test company',currency_code:'ZAR',is_org_active:true}]});
 });return calls;
}
test('Zoho requires Alex, a session and same-origin initiation; unavailable configuration stays closed',async()=>{
 const f=await fixture();assert.equal((await f.call('/api/zoho/status')).status,401);
 assert.equal((await f.call('/api/zoho/connect',{body:{},cookie:f.session,headers:{Origin:'https://evil.example'}})).status,403);
 const staff=await f.call('/api/login',{body:{username:'alinda',key:key+'a'}});const staffCookie=staff.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.call('/api/zoho/connect',{body:{},cookie:staffCookie})).status,403);
 assert.equal((await f.call('/api/zoho/check',{body:{},cookie:staffCookie})).status,403);
 delete f.env.ZOHO_CLIENT_SECRET;const status=await (await f.call('/api/zoho/status',{cookie:f.session})).json();assert.equal(status.configured,false);
 assert.equal((await f.call('/api/zoho/connect',{body:{},cookie:f.session})).status,503);
});
test('Zoho uses read-only scopes, PKCE, browser-bound expiring state and encrypted tokens; refresh keeps route records intact',async t=>{
 const calls=mockZoho(t),f=await fixture();
 const catalog={products:[{code:'W01',name:'Test product',unit:'bag',price_cents:100,active:true,available:true}],routes:[{code:'R07',name:'Test route',weekday:4}]};
 await f.call('/api/catalog',{body:{revision:0,catalog},cookie:f.session});
 const existing=await (await f.call('/api/run?date=2026-10-01&route=R07',{cookie:f.session})).json();
 existing.run.items[0].planned=17;const saved=await f.call('/api/run',{body:{run:existing.run,revision:0,request_id:crypto.randomUUID(),action:'save'},cookie:f.session});assert.equal(saved.status,200);
 const before=f.env.DB.db.prepare('SELECT * FROM v2_events').all();
 const pending=await f.start(),params=pending.url.searchParams;
 assert.equal(pending.url.origin,'https://accounts.zoho.com');assert.equal(params.get('redirect_uri'),ZOHO_REDIRECT_URI);
 assert.deepEqual(params.get('scope').split(','),ZOHO_SCOPES);assert.ok(ZOHO_SCOPES.every(s=>s.endsWith('.READ')));
 assert.equal(params.get('access_type'),'offline');assert.equal(params.get('code_challenge_method'),'S256');
 assert.match(pending.response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax; Path=\/api\/zoho; Max-Age=600/);
 const storedState=f.env.DB.db.prepare('SELECT * FROM v2_zoho_states').get();assert.notEqual(storedState.state_hash,params.get('state'));assert.ok(storedState.expires>Date.now());
 // A cross-site OAuth return does not include the main SameSite=Strict session cookie.
 const finished=await f.call(f.callback(pending),{cookie:pending.cookie});assert.equal(finished.status,303);
 assert.equal(finished.headers.get('location'),origin+'/?zoho=connected#setup');assert.match(finished.headers.get('set-cookie'),/Max-Age=0/);
 const codeVerifier=new URLSearchParams(calls[0].options.body).get('code_verifier');
 assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(codeVerifier))).toString('base64url'),params.get('code_challenge'));
 assert.ok(!storedState.verifier.includes(codeVerifier));
 const row=f.env.DB.db.prepare('SELECT * FROM v2_zoho_connection').get();for(const value of ['local-access-token','local-refresh-token',testSecret])assert.ok(!JSON.stringify(row).includes(value));
 const statusResponse=await f.call('/api/zoho/status',{cookie:f.session});const status=await statusResponse.json();assert.equal(status.connected,true);assert.equal(status.sync_enabled,false);assert.equal(status.organisations[0].id,'12345');
 const bootstrapText=await (await f.call('/api/bootstrap',{cookie:f.session})).text();for(const value of ['encrypted_tokens','local-access-token','local-refresh-token',testSecret])assert.ok(!bootstrapText.includes(value));
 const replay=await f.call(f.callback(pending),{cookie:pending.cookie});assert.match(replay.headers.get('location'),/zoho=expired/);assert.equal(calls.length,2);
 const checked=await f.call('/api/zoho/check',{body:{},cookie:f.session});assert.equal(checked.status,200);assert.equal(calls.length,4);assert.match(calls[3].options.headers.Authorization,/renewed/);
 assert.equal((await f.call('/api/zoho/connect',{body:{},cookie:f.session})).status,409);
 assert.deepEqual(f.env.DB.db.prepare('SELECT * FROM v2_events').all(),before);assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) n FROM v2_history').get().n,0);
 assert.equal(JSON.parse(f.env.APP_ACCESS_KEYS).alex,key);
 f.env.ZOHO_CLIENT_SECRET+='changed';const changed=await (await f.call('/api/zoho/status',{cookie:f.session})).json();assert.equal(changed.credentials_changed,true);assert.equal(changed.connected,false);
 assert.equal((await f.call('/api/zoho/check',{body:{},cookie:f.session})).status,409);assert.equal(calls.length,4);
});
test('missing/wrong browser state, expiry, logout, denied consent and untrusted hosts cannot exchange a code',async t=>{
 const calls=mockZoho(t);
 for(const scenario of ['missing-cookie','wrong-state','expired','logout','denied','host','credentials']){
  const f=await fixture(),pending=await f.start();let path=f.callback(pending),cookie=pending.cookie;
  if(scenario==='missing-cookie')cookie='';
  if(scenario==='wrong-state')path=f.callback(pending,{state:'a'.repeat(64)});
  if(scenario==='expired')f.env.DB.db.exec('UPDATE v2_zoho_states SET expires=0');
  if(scenario==='logout')await f.call('/api/logout',{body:{},cookie:f.session});
  if(scenario==='denied')path=f.callback(pending,{error:'access_denied'});
  if(scenario==='host')path=f.callback(pending,{'accounts-server':'https://accounts.zoho.com.evil.example'});
  if(scenario==='credentials')f.env.ZOHO_CLIENT_SECRET+='changed';
  const response=await f.call(path,{cookie});assert.equal(response.status,303,scenario);assert.doesNotMatch(response.headers.get('location'),/zoho=connected/);
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) n FROM v2_zoho_connection').get().n,0,scenario);
 }assert.equal(calls.length,0);
});
test('a second initiation invalidates the previous state; token errors are not reflected or stored',async t=>{
 const calls=mockZoho(t,{tokenError:true}),f=await fixture(),old=await f.start(),current=await f.start();
 assert.match((await f.call(f.callback(old),{cookie:old.cookie})).headers.get('location'),/expired/);assert.equal(calls.length,0);
 const response=await f.call(f.callback(current),{cookie:current.cookie});assert.equal(response.headers.get('location'),origin+'/?zoho=token_rejected#setup');
 assert.ok(!(await response.text()).includes(testSecret));assert.equal(calls.length,1);
 assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) n FROM v2_zoho_connection').get().n,0);
});
test('a temporary Books failure retains the encrypted authorisation and shows a pending check',async t=>{
 const calls=mockZoho(t,{orgError:true}),f=await fixture(),pending=await f.start();
 const response=await f.call(f.callback(pending),{cookie:pending.cookie});assert.match(response.headers.get('location'),/check_pending/);
 const status=await (await f.call('/api/zoho/status',{cookie:f.session})).json();assert.equal(status.connected,true);assert.equal(status.last_checked,null);assert.deepEqual(status.organisations,[]);
 const checked=await f.call('/api/zoho/check',{body:{},cookie:f.session});assert.equal(checked.status,502);assert.ok(!(await checked.text()).includes('private-upstream-error'));
 assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) n FROM v2_zoho_connection').get().n,1);assert.equal(calls.length,4);
});

test('documented generic OAuth API domain connects and refreshes through the canonical Books origin',async t=>{
 const calls=mockZoho(t,{apiDomain:'https://api.zoho.com'}),f=await fixture(),pending=await f.start();
 const response=await f.call(f.callback(pending),{cookie:pending.cookie});assert.equal(response.headers.get('location'),origin+'/?zoho=connected#setup');
 const row=f.env.DB.db.prepare('SELECT * FROM v2_zoho_connection').get();assert.equal(row.api_domain,'https://www.zohoapis.com');
 const checked=await f.call('/api/zoho/check',{body:{},cookie:f.session});assert.equal(checked.status,200);
 assert.equal((await checked.json()).organisations[0].id,'12345');assert.equal(calls.length,4);
 assert.ok(calls.every(c=>c.url==='https://accounts.zoho.com/oauth/v2/token'||c.url==='https://www.zohoapis.com/books/v3/organizations'));
});

test('token API origins reject cross-region hosts, host tricks, ports, paths and queries without forwarding tokens',async t=>{
 for(const apiDomain of ['https://www.zohoapis.eu','https://api.zoho.eu','https://api.zoho.com.evil.example','https://evil.example','https://api.zoho.com@evil.example','http://api.zoho.com','https://api.zoho.com:443','https://api.zoho.com/','https://api.zoho.com?x=1','https://api.zoho.com#fragment']){
  const calls=mockZoho(t,{apiDomain}),f=await fixture(),pending=await f.start();
  const response=await f.call(f.callback(pending),{cookie:pending.cookie});assert.equal(response.headers.get('location'),origin+'/?zoho=api_region#setup',apiDomain);
  assert.equal(calls.length,1);assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) n FROM v2_zoho_connection').get().n,0);
  t.mock.restoreAll();
 }
});

test('callback diagnostics distinguish fixed upstream errors and reachability without exposing upstream content',async t=>{
 for(const [options,reason] of [
  ...['invalid_client','invalid_client_secret','invalid_redirect_uri','invalid_code'].map(tokenError=>[{tokenError},tokenError]),
  [{tokenError:testSecret},'token_rejected'],[{tokenError:'toString'},'token_rejected'],[{networkError:true},'unreachable'],[{invalidJson:true},'invalid_response']
 ]){
  const calls=mockZoho(t,options),f=await fixture(),pending=await f.start();
  const response=await f.call(f.callback(pending),{cookie:pending.cookie});
  assert.equal(response.headers.get('location'),origin+'/?zoho='+reason+'#setup');assert.equal(calls.length,1);
  assert.ok(!JSON.stringify([...response.headers]).includes(testSecret));assert.equal(await response.text(),'');
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) n FROM v2_zoho_connection').get().n,0);
  t.mock.restoreAll();
 }
});

test('callback app failures report the safe stage and keep raw database/encryption details private',async t=>{
 for(const stage of ['state_read','session_check','connection_read','state_decrypt','connection_save']){
  const calls=mockZoho(t),f=await fixture(),pending=await f.start();
  if(stage==='state_decrypt')f.env.DB.db.prepare('UPDATE v2_zoho_states SET verifier=?').run(testSecret);
  else{
   const prepare=f.env.DB.prepare.bind(f.env.DB);
   const match={state_read:'DELETE FROM v2_zoho_states WHERE state_hash',session_check:'SELECT username,key_hash,expires FROM v2_sessions',connection_read:'SELECT * FROM v2_zoho_connection',connection_save:'INSERT INTO v2_zoho_connection'}[stage];
   t.mock.method(f.env.DB,'prepare',sql=>{if(sql.startsWith(match))throw new Error(testSecret);return prepare(sql);});
  }
  const response=await f.call(f.callback(pending),{cookie:pending.cookie});assert.equal(response.headers.get('location'),origin+'/?zoho='+stage+'#setup');
  assert.equal(await response.text(),'');assert.ok(!JSON.stringify([...response.headers]).includes(testSecret));
  assert.equal(calls.length,stage==='connection_save'?1:0);t.mock.restoreAll();
 }
});
