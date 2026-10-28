import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {today} from '../src/domain.js';
import {invoiceApi} from '../src/invoice-api.js';
const origin='https://invoice-access.example',pin='704862';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],target:'es2022'});
function cookies(r){return (r.headers.getSetCookie?.()??r.headers.get('set-cookie').split(/, (?=[a-zA-Z_-]+=)/)).map(s=>s.split(';')[0]).filter(s=>!s.endsWith('=')).join('; ');}
async function fixture(t){
 const keys=Object.fromEntries(['alex','alinda','tapiz','mosa','musa','xavier'].map(n=>[n,'SYNTHETIC-invoice-auth-key-012345678901234567890-'+n]));
 const mf=new Miniflare(convertV4MiniflareOptions({name:'invoice-auth-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'invoice-auth-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(keys)},outboundService:()=>{throw Error('No external traffic in access tests');}}));t.after(()=>mf.dispose());
 async function req(path,body,cookie='',headers={}){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});const text=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text,headers:r.headers};}
 const login=async name=>{const r=await req('/api/login',{username:name,key:keys[name]});assert.equal(r.status,200,JSON.stringify(r.data));return cookies(r);};
 const admin=await login('alex'),db=await mf.getD1Database('DB');
 const products=[{code:'P1',name:'SYNTHETIC PRODUCT',unit:'bag',active:true,available:true,price_cents:10000}];
 const routes=['R03','R04'].map((code,i)=>{const id=String(9001001+i);return {code,name:'SYNTHETIC ROUTE '+code,weekday:2,invoice_stores:[{id,name:'SYNTHETIC SHOP '+code,stop:1,terms:7,opening:{customer_id:id,complete:true,balance_cents:0,invoices:[],drafts:[],generated_at:new Date().toISOString()}}]};});
 const catalog={products,routes,revision:1};assert.equal((await req('/api/catalog',{revision:0,catalog},admin)).status,200);
 const list=async()=>(await req('/api/invoicing/phones',null,admin)).data.phones;
 const create=async(rep='tapiz')=>{const r=await req('/api/invoicing/phones',{action:'create',rep},admin);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const enroll=async(inv,device='',value=pin)=>{const r=await req('/api/invoicing/access/enroll',{code:inv.code,pin:value,pin_confirm:value},device);assert.equal(r.status,200,JSON.stringify(r.data));return {...r.data,cookie:cookies(r),response:r};};
 const paired=async(rep='tapiz')=>enroll(await create(rep));
 const update=async(id,action)=>{const p=(await list()).find(p=>p.id===id);return req('/api/invoicing/phones',{action,id,revision:p.revision},admin);};
 return {mf,db,req,login,keys,admin,list,create,enroll,paired,update,catalog};
}
test('owner enrolls two distinct phones; PIN alone, copied session alone and reused codes cannot sign in',async t=>{
 const f=await fixture(t),inv=await f.create();
 assert.equal((await f.req('/api/invoicing/access/enroll',{code:inv.code,pin,pin_confirm:pin},'',{Origin:'https://other.example'})).status,403);
 assert.equal((await f.req('/api/invoicing/access/enroll',{code:inv.code,pin:'123456',pin_confirm:'123456'})).status,400);
 const tapiz=await f.enroll(inv),musa=await f.paired('musa');assert.notEqual(tapiz.phone_id,musa.phone_id);assert.equal(musa.username,'mosa');
 for(const setCookie of tapiz.response.headers.getSetCookie())for(const flag of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(setCookie.includes(flag));
 assert.equal((await f.req('/api/invoicing/access/enroll',{code:inv.code,pin,pin_confirm:pin})).status,401);
 assert.equal((await f.req('/api/invoicing/access/login',{pin})).status,401);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,tapiz.cookie.split('; ').find(c=>c.startsWith('__Host-fm_invoice_session=')))).status,401);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,tapiz.cookie.split('; ').find(c=>c.startsWith('__Host-fm_invoice_phone=')))).status,401);
 for(const p of [tapiz,musa]){const r=await f.req('/api/invoicing/bootstrap',null,p.cookie);assert.equal(r.status,200);assert.equal(r.data.username,p.username);assert.equal(r.data.rep_phone_id,p.phone_id);assert.equal(r.data.admin,false);assert.equal(r.data.available_routes.length,2);assert.ok(r.data.rep_session_expires>Date.now());}
 assert.equal((await f.req('/api/invoicing/bootstrap',null,musa.cookie)).data.display_name,'Musa');
 assert.equal((await f.req('/api/invoicing/phones',{action:'create',rep:'tapiz'},f.admin)).status,409);
 const stored=(await f.db.prepare('SELECT * FROM v2_invoice_phones').all()).results;assert.notEqual(stored[0].pin_verifier,stored[1].pin_verifier);
 const serialized=JSON.stringify(stored);assert.ok(!serialized.includes(inv.code));assert.ok(!serialized.includes(pin));for(const p of [tapiz,musa])for(const token of p.cookie.split('; ').map(s=>s.split('=')[1]))assert.ok(!serialized.includes(token));
 assert.ok(!(await f.list()).some(p=>Object.keys(p).some(k=>/hash|verifier|salt/.test(k))));
});
test('PIN and legacy rep identities cannot reach other APIs, direct pages, owner operations or bearer imports',async t=>{
 const f=await fixture(t),legacy=await f.login('tapiz'),legacyMusa=await f.login('mosa');
 const pinUser=await f.paired();
 for(const cookie of [legacyMusa,pinUser.cookie]){
  for(const path of ['/api/bootstrap','/api/production','/api/order-guy','/api/recipes','/api/stocktake','/api/staff','/api/staff-clock/state','/api/print/production?date='+today(),'/api/zoho/status','/api/audit']){
   const r=await f.req(path,null,cookie);assert.equal(r.status,403,path+' must deny read');
   assert.equal((await f.req(path,{action:'anything'},cookie)).status,403,path+' must deny write');
  }
  for(const path of ['/api/invoicing/phones','/api/invoicing/export'])assert.equal((await f.req(path,null,cookie)).status,403,path);
  assert.equal((await f.req('/api/invoicing/phones',{action:'create',rep:'mosa'},cookie)).status,403);
  assert.equal((await f.req('/api/invoicing/balance',{route:'R03',customer_id:'9001001'},cookie)).status,403);
  for(const path of ['/','/production','/production.html','/recipes/','/staff','/staff-clock','/access-setup','/print-page']){const r=await f.req(path,null,cookie);assert.equal(r.status,302,path);assert.equal(r.headers.get('location'),'/invoicing/');}
 }
 assert.equal((await f.req('/api/invoicing/bootstrap',null,legacy)).status,401,'old long key cannot bypass registered-phone access');
 assert.equal((await f.req('/api/import/history',{rows:[]},'',{Authorization:'Bearer '+f.keys.mosa})).status,403);
 assert.equal((await f.req('/api/bootstrap',null,f.admin)).status,200);
 assert.equal((await f.req('/api/bootstrap',null,await f.login('xavier'))).status,200);
 const unauthorized=await f.req('/api/invoicing/phones',null,await f.login('xavier'));assert.equal(unauthorized.status,403);
});
test('five bad PINs are throttled; one-time reset requires the original device and invalidates old sessions',async t=>{
 const f=await fixture(t),p=await f.paired();
 for(let i=0;i<5;i++)assert.equal((await f.req('/api/invoicing/access/login',{pin:'806429'},p.cookie)).status,401);
 assert.equal((await f.req('/api/invoicing/access/login',{pin},p.cookie)).status,429);
 const reset=await f.update(p.phone_id,'code');assert.equal(reset.status,200);
 const newPin='951704',body={code:reset.data.code,pin:newPin,pin_confirm:newPin};
 assert.equal((await f.req('/api/invoicing/access/enroll',body)).status,403);
 const resetPhone=await f.enroll(reset.data,p.cookie,newPin);assert.equal(resetPhone.phone_id,p.phone_id);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,p.cookie)).status,401);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,resetPhone.cookie)).status,200);
 // Move beyond the synthetic rate-limit state without waiting in a test.
 await f.db.prepare('DELETE FROM v2_auth_limits').run();
 assert.equal((await f.req('/api/invoicing/access/login',{pin},resetPhone.cookie)).status,401);
 const signed=await f.req('/api/invoicing/access/login',{pin:newPin},resetPhone.cookie);assert.equal(signed.status,200);
 const device=resetPhone.cookie.split('; ').find(c=>c.startsWith('__Host-fm_invoice_phone=')),fresh=device+'; '+cookies(signed);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,resetPhone.cookie)).status,401);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,fresh)).status,200);
 assert.equal((await f.req('/api/invoicing/access/lock',{},fresh)).status,200);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,fresh)).status,401);
 assert.equal((await f.req('/api/invoicing/access/status',null,fresh)).data.registered,true);
});
test('invoice actor and phone are fixed server-side; PIN renewal preserves ordered offline replay',async t=>{
 const f=await fixture(t),p=await f.paired(),start={route:'R03',date:today(),device:p.phone_id,cutover_ack:true};
 assert.equal((await f.req('/api/invoicing/start',{...start,device:'another-synthetic-device'},p.cookie)).status,403);
 const r=await f.req('/api/invoicing/start',start,p.cookie);assert.equal(r.status,200,JSON.stringify(r.data));const session=r.data.session;assert.equal(session.actor,'tapiz');
 assert.equal((await f.req('/api/invoicing/start',{...start,route:'R04'},p.cookie)).status,409);
 const user2=await f.paired('mosa');assert.equal((await f.req('/api/invoicing/start',{...start,device:user2.phone_id},user2.cookie)).status,409);
 const b={route:'R03',session_id:session.id,device:p.phone_id,sequence:1,command:{action:'issue',customer_id:'9001001',revision:0,request_id:crypto.randomUUID(),captured_at:new Date().toISOString(),actor:'alex',lines:[{code:'P1',qty:1000,checked:true}],cash:10000,shop2shop:0,received:true}};
 const renew=await f.req('/api/invoicing/access/login',{pin},p.cookie),fresh=p.cookie.split('; ').find(c=>c.startsWith('__Host-fm_invoice_phone='))+'; '+cookies(renew);
 assert.equal((await f.req('/api/invoicing/command',b,p.cookie)).status,401);
 const saved=await f.req('/api/invoicing/command',b,fresh);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.account.invoices[0].actor,'tapiz');
 assert.equal((await f.req('/api/invoicing/command',b,fresh)).data.replayed,true);
 assert.equal((await f.req('/api/invoicing/command',b,user2.cookie)).status,403);
 assert.equal((await f.req('/api/invoicing/bootstrap?route=R04',null,fresh)).data.route,'R03','resume the already-open route');
 assert.equal((await f.req('/api/invoicing/bootstrap?route=R99',null,user2.cookie)).status,409);
 const reset=await f.update(p.phone_id,'code'),newPhone=await f.enroll(reset.data,fresh,'951704');assert.equal(newPhone.phone_id,p.phone_id);
 assert.equal((await f.req('/api/invoicing/command',b,newPhone.cookie)).data.replayed,true);
 assert.equal((await f.req('/api/invoicing/finish',{...start,session_id:session.id,sequence:1},newPhone.cookie)).status,200);
 assert.equal((await f.req('/api/invoicing/start',{...start,route:'R04'},newPhone.cookie)).status,200);
});
test('revocation stops sessions, PIN login and already-authorised in-flight writes without changing financial data',async t=>{
 const f=await fixture(t),p=await f.paired(),start={route:'R03',date:today(),device:p.phone_id,cutover_ack:true};
 const session=(await f.req('/api/invoicing/start',start,p.cookie)).data.session;
 const record=await f.db.prepare('SELECT * FROM v2_invoice_phones WHERE id=?').bind(p.phone_id).first();
 const user={username:'tapiz',phone_id:p.phone_id,phone_token_hash:record.token_hash,phone_session_hash:record.session_hash};
 assert.equal((await f.update(p.phone_id,'revoke')).status,200);
 for(const path of ['/api/invoicing/bootstrap','/api/production'])assert.equal((await f.req(path,null,p.cookie)).status,401);
 assert.equal((await f.req('/api/invoicing/access/login',{pin},p.cookie)).status,401);
 const b={...start,session_id:session.id,sequence:1,command:{action:'name',name:'MUST NOT SAVE',customer_id:'9001001',revision:0,request_id:crypto.randomUUID(),captured_at:new Date().toISOString()}};
 const url=new URL(origin+'/api/invoicing/command');
 await assert.rejects(invoiceApi({request:new Request(url,{method:'POST'}),url,env:{DB:f.db},user,catalog:f.catalog,bodyOf:async()=>b}),/Route changed/);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM v2_invoice_events').first()).n,0);
 assert.equal((await f.db.prepare('SELECT sequence FROM v2_invoice_sessions WHERE id=?').bind(session.id).first()).sequence,0);
 const actions=(await f.db.prepare('SELECT action FROM v2_invoice_phone_audit WHERE phone_id=?').bind(p.phone_id).all()).results.map(r=>r.action);assert.deepEqual(actions,['invited','enrolled','revoked']);
 const invite=await f.req('/api/invoicing/phones',{action:'create',rep:'tapiz'},f.admin);assert.equal(invite.status,409,'no silent takeover of a route with potentially unsynced money');
});
test('expired invitation and expired session fail closed, while a valid phone can renew its PIN session',async t=>{
 const f=await fixture(t),inv=await f.create();await f.db.prepare('UPDATE v2_invoice_phones SET code_expires=? WHERE id=?').bind(Date.now()-1,inv.id).run();
 assert.equal((await f.req('/api/invoicing/access/enroll',{code:inv.code,pin,pin_confirm:pin})).status,401);
 const reissued=await f.update(inv.id,'code'),p=await f.enroll(reissued.data);
 await f.db.prepare('UPDATE v2_invoice_phones SET session_expires=? WHERE id=?').bind(Date.now()-1,p.phone_id).run();
 assert.equal((await f.req('/api/invoicing/bootstrap',null,p.cookie)).status,401);
 assert.equal((await f.req('/api/invoicing/access/login',{pin},p.cookie)).status,200);
 await f.db.prepare('UPDATE v2_invoice_phones SET expires=? WHERE id=?').bind(Date.now()-1,p.phone_id).run();
 assert.equal((await f.req('/api/invoicing/access/login',{pin},p.cookie)).status,401);
});
test('rep sessions cover a 16-hour route day and expire after 24 hours without a silent extension',async t=>{
 const f=await fixture(t),p=await f.paired();
 async function checkWindow(response){
  assert.match(response.headers.getSetCookie().find(c=>c.startsWith('__Host-fm_invoice_session=')),/Max-Age=86400(?:;|$)/);
  const row=await f.db.prepare('SELECT session_expires,last_login FROM v2_invoice_phones WHERE id=?').bind(p.phone_id).first();
  assert.equal(row.session_expires-Date.parse(row.last_login),24*3600000);
  assert.equal(response.data.expires,row.session_expires);return row;
 }
 await checkWindow(p.response);
 const login=await f.req('/api/invoicing/access/login',{pin},p.cookie);assert.equal(login.status,200);
 const row=await checkWindow(login),cookie=p.cookie.split('; ').find(c=>c.startsWith('__Host-fm_invoice_phone='))+'; '+cookies(login);
 // Backdate the issued expiry to represent time spent on the route; no real wait.
 const lateShift=row.session_expires-16*3600000;
 await f.db.prepare('UPDATE v2_invoice_phones SET session_expires=? WHERE id=?').bind(lateShift,p.phone_id).run();
 for(let i=0;i<3;i++){const r=await f.req('/api/invoicing/bootstrap',null,cookie);assert.equal(r.status,200);assert.equal(r.data.rep_session_expires,lateShift,'intermittent online use does not alter the fixed expiry');}
 await f.db.prepare('UPDATE v2_invoice_phones SET session_expires=? WHERE id=?').bind(row.session_expires-24*3600000-1000,p.phone_id).run();
 assert.equal((await f.req('/api/invoicing/bootstrap',null,cookie)).status,401);
 const reset=await f.update(p.phone_id,'code'),resetPhone=await f.enroll(reset.data,cookie,'951704');await checkWindow(resetPhone.response);
});
test('concurrent activation consumes one code once; a blocked registration can be replaced without clearing phone storage',async t=>{
 const f=await fixture(t),inv=await f.create(),body={code:inv.code,pin,pin_confirm:pin};
 const results=await Promise.all([f.req('/api/invoicing/access/enroll',body),f.req('/api/invoicing/access/enroll',body)]);
 assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.some(r=>[401,409].includes(r.status)));
 const first=results.find(r=>r.status===200),original=cookies(first);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM v2_invoice_phone_audit WHERE action='enrolled'").first()).n,1);
 assert.equal((await f.update(first.data.phone_id,'revoke')).status,200);
 const next=await f.enroll(await f.create(),original);assert.notEqual(next.phone_id,first.data.phone_id);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,original)).status,401);
 assert.equal((await f.req('/api/invoicing/bootstrap',null,next.cookie)).status,200);
});
