import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('real Cloudflare assets follow HTML redirects through the Worker to the production screen',async t=>{
 const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 const mf=new Miniflare(convertV4MiniflareOptions({
  name:'asset-routing-test',
  modules:['worker','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),
  compatibilityDate:config.compatibility_date,
  assets:{directory:fileURLToPath(new URL('../'+config.assets.directory+'/',import.meta.url)),binding:config.assets.binding,run_worker_first:config.assets.run_worker_first,routerConfig:{has_user_worker:true}},
  d1Databases:{DB:'asset-routing-test'},
  bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:'test-only-assets-key-012345678901234567890'})}
 }));
 t.after(()=>mf.dispose());
 const origin='http://asset-routing.example';
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const link=app.match(/location\.assign\('(\/production(?:\.html)?)'\)/)?.[1];
 assert.ok(link,'Production navigation destination exists');
 for(const [path,title] of [[link,'Production Plan'],['/production.html','Production Plan'],['/production/','Production Plan'],['/access-setup.html','Access'],['/access-setup/','Access'],['/staff-access','Staff access'],['/staff-access.html','Staff access'],['/staff-access/','Staff access'],['/','Sales Pilot']]){
  let url=origin+path,response;
  for(let redirects=0;redirects<4;redirects++){
   response=await mf.dispatchFetch(url,{redirect:'manual'});
   if(![301,302,307,308].includes(response.status))break;
   const target=new URL(response.headers.get('location'),url);
   assert.equal(target.origin,origin,'Page redirects stay on the app origin');
   url=target.href;
  }
  assert.equal(response.status,200,path+' reaches its HTML screen: '+(response.status===200?'OK':await response.text()));
  assert.match(response.headers.get('content-type'),/text\/html/);
  assert.match(await response.text(),new RegExp('<title>[^<]*'+title,'i'));
  assert.match(response.headers.get('cache-control'),/(?:^|,\s*)no-store(?:,|$)/);
 }
 for(const path of ['/decimal-input.js','/production-app.js','/production-trolleys.js','/production-staff-print.js','/production.js','/production.css','/staff-access.js','/staff-access.css'])assert.equal((await mf.dispatchFetch(origin+path)).status,200,path);
 assert.equal((await mf.dispatchFetch(origin+'/not-a-page')).status,404);
 assert.equal((await mf.dispatchFetch(origin+'/api/production?date=2026-10-07')).status,401,'HTML routing does not open business data');
});
