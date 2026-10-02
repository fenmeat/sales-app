import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {ZOHO_ORIGIN as origin,ZOHO_REDIRECT_URI} from '../src/zoho.js';

// Exercise the real Worker, D1 and outbound fetch validation in workerd.
// All outbound requests terminate in this local fake service; no Zoho credentials or network.
async function fixture(t){
 const calls=[],key='local-runtime-access-key-01234567890123456789';
 const fake={tokenRedirect:0,orgRedirect:0};
 const mf=new Miniflare(convertV4MiniflareOptions({
  name:'zoho-runtime-test',modules:['worker','domain','forecast','auth','schema','zoho'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+name+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',
  d1Databases:{DB:'zoho-runtime-test'},
  bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key}),ZOHO_CLIENT_ID:'1000.LOCAL_RUNTIME_CLIENT_ID',ZOHO_CLIENT_SECRET:'local-runtime-client-secret-01234567890123456789'},
  outboundService:async request=>{
   const url=new URL(request.url);calls.push({url:request.url,method:request.method});
   if(url.origin==='https://accounts.zoho.com'&&url.pathname==='/oauth/v2/token'){
    assert.equal(request.method,'POST');assert.equal(url.search,'');
    if(fake.tokenRedirect)return new Response(null,{status:fake.tokenRedirect,headers:{Location:'https://blocked.example/token'}});
    const form=new URLSearchParams(await request.text());
    assert.equal(form.get('client_id'),'1000.LOCAL_RUNTIME_CLIENT_ID');
    assert.equal(form.get('client_secret'),'local-runtime-client-secret-01234567890123456789');
    if(form.get('grant_type')==='refresh_token'){
     assert.equal(form.get('refresh_token'),'synthetic-refresh-token');
     return Response.json({access_token:'synthetic-renewed-token',expires_in:3600,api_domain:'https://api.zoho.com'});
    }
    assert.equal(form.get('grant_type'),'authorization_code');assert.equal(form.get('redirect_uri'),ZOHO_REDIRECT_URI);
    assert.match(form.get('code_verifier'),/^[a-f0-9]{64}$/);
    return Response.json({access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',expires_in:1,api_domain:'https://api.zoho.com'});
   }
   if(url.origin==='https://www.zohoapis.com'&&url.pathname==='/books/v3/organizations'){
    assert.equal(request.method,'GET');assert.match(request.headers.get('Authorization'),/^Zoho-oauthtoken synthetic-(access|renewed)-token$/);
    if(fake.orgRedirect)return new Response(null,{status:fake.orgRedirect,headers:{Location:'https://blocked.example/organizations'}});
    return Response.json({code:0,organizations:[{organization_id:'12345',name:'Runtime test company',currency_code:'ZAR'}]});
   }
   throw new Error('Unexpected outbound destination in runtime test');
  }
 }));
 t.after(()=>mf.dispose());
 const call=(path,{body,cookie=''}={})=>mf.dispatchFetch(origin+path,{method:body?'POST':'GET',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});
 const login=await call('/api/login',{body:{username:'alex',key}});assert.equal(login.status,200,await login.clone().text());
 const session=login.headers.get('set-cookie').split(';')[0];
 const start=async()=>{
  const response=await call('/api/zoho/connect',{body:{},cookie:session});assert.equal(response.status,200,await response.clone().text());
  const url=new URL((await response.json()).authorization_url);
  return {state:url.searchParams.get('state'),cookie:response.headers.get('set-cookie').split(';')[0]};
 };
 const finish=pending=>call('/api/zoho/callback?'+new URLSearchParams({state:pending.state,code:'1000.synthetic-code','accounts-server':'https://accounts.zoho.com'}),{cookie:pending.cookie});
 return {mf,call,session,start,finish,calls,fake};
}

test('workerd completes OAuth, encrypted D1 storage and token refresh while keeping a saved route',async t=>{
 const f=await fixture(t);
 const catalog={products:[{code:'W01',name:'Test product',unit:'bag',price_cents:100,active:true,available:true}],routes:[{code:'R07',name:'Test route',weekday:4}]};
 assert.equal((await f.call('/api/catalog',{body:{revision:0,catalog},cookie:f.session})).status,200);
 const before=await (await f.call('/api/run?date=2026-10-01&route=R07',{cookie:f.session})).json();before.run.items[0].planned=17;
 assert.equal((await f.call('/api/run',{body:{run:before.run,revision:0,request_id:crypto.randomUUID(),action:'save'},cookie:f.session})).status,200);
 const pending=await f.start(),response=await f.finish(pending);
 assert.equal(response.headers.get('location'),origin+'/?zoho=connected#setup');assert.equal(f.calls.length,2);
 const status=await (await f.call('/api/zoho/status',{cookie:f.session})).json();assert.equal(status.connected,true);assert.equal(status.sync_enabled,false);assert.equal(status.organisations[0].id,'12345');
 const db=await f.mf.getD1Database('DB'),row=await db.prepare('SELECT * FROM v2_zoho_connection').first();
 assert.equal(row.api_domain,'https://www.zohoapis.com');assert.ok(!JSON.stringify(row).includes('synthetic-access-token'));assert.ok(!JSON.stringify(row).includes('synthetic-refresh-token'));
 const checked=await f.call('/api/zoho/check',{body:{},cookie:f.session});assert.equal(checked.status,200,await checked.clone().text());assert.equal(f.calls.length,4);
 const after=await (await f.call('/api/run?date=2026-10-01&route=R07',{cookie:f.session})).json();assert.equal(after.revision,1);assert.equal(after.run.items[0].planned,17);
 assert.match((await f.finish(pending)).headers.get('location'),/zoho=expired/);assert.equal(f.calls.length,4);
});

test('workerd refuses all token redirects and preserves authorisation on a redirected Books check without following either',async t=>{
 const f=await fixture(t),db=await f.mf.getD1Database('DB');
 for(const code of [301,302,303,307,308]){
  f.fake.tokenRedirect=code;const before=f.calls.length,pending=await f.start(),response=await f.finish(pending);
  assert.equal(response.headers.get('location'),origin+'/?zoho=unexpected_redirect#setup');assert.equal(f.calls.length,before+1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_zoho_connection').first()).n,0);
 }
 f.fake.tokenRedirect=0;f.fake.orgRedirect=302;
 assert.equal((await f.finish(await f.start())).headers.get('location'),origin+'/?zoho=check_pending#setup');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_zoho_connection').first()).n,1);
 const checked=await f.call('/api/zoho/check',{body:{},cookie:f.session});assert.equal(checked.status,502);assert.match((await checked.json()).error,/unexpected redirect/);
 assert.ok(f.calls.every(c=>!c.url.includes('blocked.example')));
});
