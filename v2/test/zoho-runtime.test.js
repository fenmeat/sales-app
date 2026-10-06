import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {ZOHO_ORIGIN as origin,ZOHO_REDIRECT_URI} from '../src/zoho.js';

// Exercise the real Worker, D1 and outbound fetch validation in workerd.
// All outbound requests terminate in this local fake service; no Zoho credentials or network.
async function fixture(t){
 const calls=[],key='local-runtime-access-key-01234567890123456789';
 const fake={tokenRedirect:0,orgRedirect:0,
  invoicePages:{1:{invoices:[{invoice_id:'9001',invoice_number:'INV-TEST-1',date:'2026-10-01',status:'paid',customer_name:'Test customer',currency_code:'ZAR',total:160}],page_context:{page:1,has_more_page:true}},2:{invoices:[],page_context:{page:2,has_more_page:false}}},
  invoice:{invoice_id:'9001',invoice_number:'INV-TEST-1',date:'2026-10-01',status:'paid',customer_name:'Test customer',salesperson_id:'5001',salesperson_name:'07. THURSDAY MOSSEL BAY',currency_code:'ZAR',total:160,billing_address:{address:'private address'},notes:'private notes',
   line_items:[{line_item_id:'101',item_id:'201',name:'BRAAI WORS',sku:'W01',unit:'pack',quantity:1}]}};
 const mf=new Miniflare(convertV4MiniflareOptions({
  name:'zoho-runtime-test',modules:['worker','domain','forecast','forecast-history','auth','schema','zoho','zoho-matching'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+name+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',
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
    return Response.json({code:0,organizations:[{organization_id:'12345',name:'Runtime test company',currency_code:'ZAR'},{organization_id:'852102281',name:'FEN',currency_code:'ZAR'}]});
   }
   if(url.origin==='https://www.zohoapis.com'&&/^\/books\/v3\/invoices(?:\/9001)?$/.test(url.pathname)){
    assert.equal(request.method,'GET');assert.equal(url.searchParams.get('organization_id'),'852102281');
    if(url.pathname.endsWith('/9001'))return Response.json({code:0,invoice:fake.invoice});
    assert.equal(url.searchParams.get('date'),'2026-10-01');assert.equal(url.searchParams.get('per_page'),'20');
    return Response.json({code:0,...fake.invoicePages[url.searchParams.get('page')]});
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

test('workerd forecasts from confirmed returns before cash close and refresh preserves manual plan and audit',async t=>{
 const f=await fixture(t),cat={products:[{code:'W01',name:'Test product',unit:'bag',price_cents:100,active:true,available:true}],routes:[{code:'R07',name:'Test route',weekday:4}]};
 async function call(path,body){const response=await f.call(path,{body,cookie:f.session});return {status:response.status,data:await response.json()};}
 assert.equal((await call('/api/catalog',{revision:0,catalog:cat})).status,200);
 const history={rows:[{date:'2026-09-24',route:'R07',product:'W01',qty:10,quality:'provisional',source:'legacy_sales_log',constrained:false}]};
 assert.equal((await call('/api/import/history',history)).data.accepted,1);
 let plan=(await call('/api/run?date=2026-10-08&route=R07')).data;plan.run.items[0].planned=77;plan.run.notes='Keep this manual quantity';
 plan=(await call('/api/run',{run:plan.run,revision:0,action:'save',request_id:crypto.randomUUID()})).data;
 let actual=(await call('/api/run?date=2026-10-01&route=R07')).data;actual.run.rep='Tester';actual.run.items[0].loaded=20;
 actual=(await call('/api/run',{run:actual.run,revision:0,action:'load',request_id:crypto.randomUUID()})).data;
 actual.run.items[0].returned=2;
 actual=(await call('/api/run',{run:actual.run,revision:actual.revision,action:'returns',request_id:crypto.randomUUID()})).data;
 assert.equal(actual.run.phase,'returned');assert.equal(actual.run.cash.counted,null);
 let loaded=(await call('/api/run?date=2026-10-08&route=R07')).data;
 assert.equal(loaded.forecast_status.stale,true);assert.equal(loaded.run.items[0].planned,77);assert.equal(loaded.run.items[0].forecast.base,10);
 const refresh={run:loaded.run,revision:loaded.revision,action:'forecast',request_id:crypto.randomUUID()};
 const result=await call('/api/run',refresh);assert.equal(result.status,200,JSON.stringify(result));loaded=result.data;
 assert.equal(loaded.run.items[0].forecast.base,14);assert.equal(loaded.run.items[0].forecast.last_qty,18);assert.equal(loaded.run.items[0].planned,77);assert.equal(loaded.run.notes,'Keep this manual quantity');assert.equal(loaded.forecast_status.stale,false);
 assert.equal((await call('/api/run',refresh)).data.replayed,true);
 assert.equal((await call('/api/run',{...refresh,request_id:crypto.randomUUID()})).status,409);
 const stable=(await call('/api/run?date=2026-10-08&route=R07')).data;assert.equal(stable.forecast_status.stale,false);assert.equal(stable.run.items[0].planned,77);
 actual.run.items[0].returned=3;
 actual=(await call('/api/run',{run:actual.run,revision:actual.revision,action:'save',request_id:crypto.randomUUID()})).data;
 const stale=(await call('/api/run?date=2026-10-08&route=R07')).data;assert.equal(stale.forecast_status.stale,true);
 let revised=(await call('/api/run',{run:stale.run,revision:stale.revision,action:'forecast',request_id:crypto.randomUUID()})).data;assert.equal(revised.run.items[0].forecast.base,10);
 actual=(await call('/api/run',{run:actual.run,revision:actual.revision,action:'returns',request_id:crypto.randomUUID()})).data;
 revised=(await call('/api/run',{run:revised.run,revision:revised.revision,action:'forecast',request_id:crypto.randomUUID()})).data;assert.equal(revised.run.items[0].forecast.base,13.5);
 assert.equal((await call('/api/run',{run:actual.run,revision:actual.revision,action:'forecast',request_id:crypto.randomUUID()})).status,400);
 const db=await f.mf.getD1Database('DB');assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_history').first()).n,1);
 const captured=(await call('/api/run?date=2026-10-01&route=R07')).data;assert.equal(captured.run.items[0].loaded,20);assert.equal(captured.run.items[0].returned,3);
});

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

test('FEN invoice preview is paged, owner-only, sanitised and never imports into saved routes or history',async t=>{
 const f=await fixture(t);await f.finish(await f.start());
 const catalog={products:[{code:'W01',name:'Test product',unit:'bag',price_cents:100,active:true,available:true}],routes:[{code:'R07',name:'Test route',weekday:4}]};
 assert.equal((await f.call('/api/catalog',{body:{revision:0,catalog},cookie:f.session})).status,200);
 const existing=await (await f.call('/api/run?date=2026-10-01&route=R07',{cookie:f.session})).json();existing.run.items[0].planned=33;
 assert.equal((await f.call('/api/run',{body:{run:existing.run,revision:0,request_id:crypto.randomUUID(),action:'save'},cookie:f.session})).status,200);
 const status=await (await f.call('/api/zoho/status',{cookie:f.session})).json();assert.equal(status.selected_organisation.id,'852102281');
 const db=await f.mf.getD1Database('DB');
 const before=await db.prepare('SELECT * FROM v2_events').all(),history=await db.prepare('SELECT * FROM v2_history').all();
 for(const path of ['/api/zoho/invoices/preview','/api/zoho/invoice/preview'])assert.equal((await f.call(path,{body:{date:'2026-10-01',invoice_id:'9001'}})).status,401);
 const first=await f.call('/api/zoho/invoices/preview',{body:{date:'2026-10-01',page:1,organization_id:'804365236'},cookie:f.session});assert.equal(first.status,200,await first.clone().text());
 const page=await first.json();assert.equal(page.preview,true);assert.equal(page.organisation.id,'852102281');assert.equal(page.has_more,true);assert.equal(page.invoices[0].id,'9001');assert.equal(page.complete,undefined);
 const next=await (await f.call('/api/zoho/invoices/preview',{body:{date:'2026-10-01',page:2},cookie:f.session})).json();assert.equal(next.has_more,false);assert.deepEqual(next.invoices,[]);
 const detailResponse=await f.call('/api/zoho/invoice/preview',{body:{date:'2026-10-01',invoice_id:'9001'},cookie:f.session});assert.equal(detailResponse.status,200);
 const detail=await detailResponse.json();assert.equal(detail.invoice.salesperson,'07. THURSDAY MOSSEL BAY');assert.deepEqual(detail.invoice.lines,[{id:'101',item_id:'201',name:'BRAAI WORS',sku:'W01',unit:'pack',quantity:1}]);
 assert.ok(!JSON.stringify(detail).includes('private'));assert.ok(!JSON.stringify(detail).includes('token'));assert.equal(detail.invoice.product,undefined);
 assert.deepEqual((await db.prepare('SELECT * FROM v2_events').all()).results,before.results);assert.deepEqual((await db.prepare('SELECT * FROM v2_history').all()).results,history.results);
 const businessCalls=f.calls.filter(c=>c.url.includes('/invoices'));assert.equal(businessCalls.length,3);assert.ok(businessCalls.every(c=>c.method==='GET'&&new URL(c.url).searchParams.get('organization_id')==='852102281'));
});

test('FEN preview rejects missing organisation, invalid dates/pages/IDs and incomplete or wrong-date responses',async t=>{
 const f=await fixture(t);await f.finish(await f.start());const db=await f.mf.getD1Database('DB');
 let before=f.calls.length;
 for(const body of [{date:'not-a-date'},{date:'2026-09-30'},{date:'2026-10-01',page:0},{date:'2026-10-01',page:101}])assert.equal((await f.call('/api/zoho/invoices/preview',{body,cookie:f.session})).status,400);
 assert.equal((await f.call('/api/zoho/invoice/preview',{body:{date:'2026-10-01',invoice_id:'../organizations'},cookie:f.session})).status,400);assert.equal(f.calls.length,before);
 const saved=await db.prepare('SELECT organisations FROM v2_zoho_connection').first();
 await db.prepare('UPDATE v2_zoho_connection SET organisations=?').bind(JSON.stringify([{id:'804365236',name:'FOUR4ONE',active:true,currency:'ZAR'}])).run();
 assert.equal((await f.call('/api/zoho/invoices/preview',{body:{date:'2026-10-01'},cookie:f.session})).status,409);assert.equal(f.calls.length,before);
 await db.prepare('UPDATE v2_zoho_connection SET organisations=?').bind(saved.organisations).run();
 f.fake.invoicePages[1].invoices[0].date='2026-09-30';assert.equal((await f.call('/api/zoho/invoices/preview',{body:{date:'2026-10-01'},cookie:f.session})).status,502);
 f.fake.invoicePages[1].invoices[0].date='2026-10-01';delete f.fake.invoicePages[1].page_context;assert.equal((await f.call('/api/zoho/invoices/preview',{body:{date:'2026-10-01'},cookie:f.session})).status,502);
 f.fake.invoice.organization_id='804365236';assert.equal((await f.call('/api/zoho/invoice/preview',{body:{date:'2026-10-01',invoice_id:'9001'},cookie:f.session})).status,502);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_events').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_history').first()).n,0);
});

test('live Worker matches confirmed FEN IDs using its saved catalogue without changing route captures',async t=>{
 const f=await fixture(t);await f.finish(await f.start());
 const catalog={products:[['W01','BRAAI WORS'],['W02','OUMA'],['W03','CHAKALAKA'],['S01','SIX GUN 20g'],['S02','SIX GUN 200g']].map(([code,name])=>({code,name,unit:'sales unit',price_cents:100,active:true,available:true})),routes:[{code:'R07',name:'MOSSEL BAY',weekday:4}]};
 assert.equal((await f.call('/api/catalog',{body:{revision:0,catalog},cookie:f.session})).status,200);
 const run=await (await f.call('/api/run?date=2026-10-01&route=R07',{cookie:f.session})).json();run.run.items[0].planned=33;
 assert.equal((await f.call('/api/run',{body:{run:run.run,revision:0,request_id:crypto.randomUUID(),action:'save'},cookie:f.session})).status,200);
 const db=await f.mf.getD1Database('DB'),before=await db.prepare('SELECT * FROM v2_events').all();
 f.fake.invoice.salesperson_id='5173603000000932936';
 f.fake.invoice.line_items=[['5173603000000845465',1],['5173603000000845476',1],['5173603000000845487',1],['5173603000000845476',1],['5173603000000845751',1],['5173603000000845762',5]].map(([item_id,quantity],i)=>({line_item_id:String(200+i),item_id,quantity,name:'Zoho product'}));
 const response=await f.call('/api/zoho/invoice/preview',{body:{date:'2026-10-01',invoice_id:'9001',catalog:{products:[],routes:[]}},cookie:f.session});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.matching.all_matched,true);assert.equal(data.matching.route.code,'R07');
 assert.deepEqual(data.matching.quantities.map(p=>[p.code,p.quantity]),[['W01',1],['W02',2],['W03',1],['S01',1],['S02',5]]);
 assert.deepEqual((await db.prepare('SELECT * FROM v2_events').all()).results,before.results);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_history').first()).n,0);
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
