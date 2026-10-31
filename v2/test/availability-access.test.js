import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {parseHTML} from 'linkedom';
import {openAvailability} from '../public/availability-controls.js';

const origin='https://availability-access.example';
const primary={alex:'a'.repeat(64),alinda:'b'.repeat(64)};
const staff=Object.fromEntries(['xavier','xalinda','other_staff','tapiz','mosa','musa'].map((name,i)=>[name,String(i+2).repeat(64)]));
const initialCatalog={
 products:[
  {code:'W01',name:'Braai wors',unit:'bag',price_cents:16000,active:true,available:true},
  {code:'W02',name:'Ouma wors',unit:'bag',price_cents:17000,active:true,available:true},
  {code:'P01',name:'Inactive product',unit:'bag',price_cents:8000,active:false,available:false}
 ],
 routes:[{code:'R07',name:'MOSSEL BAY',weekday:4,invoice_stores:[{id:'9001001',name:'SYNTHETIC PRIVATE SHOP',stop:1,terms:7,opening:{source:'SYNTHETIC-INVOICE-CANARY',balance_cents:12345}}]}]
};

test('real Worker persists Xavier and Xalinda availability changes with their own audit and narrow permission',async t=>{
 const modules=['worker','invoice-auth','invoice-api','invoice-domain','staff-api','payroll-api','payroll-domain','staff-domain','staff-import','staff-history','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','tasks-api','tasks-mail','tasks-push','webpush-bundle','zoho','zoho-matching','zoho-reconcile'];
 const mf=new Miniflare(convertV4MiniflareOptions({
  name:'availability-access-test',
  modules:modules.map(name=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+name+'.js',import.meta.url))})),
  compatibilityDate:'2026-09-30',d1Databases:{DB:'availability-access-test'},
  bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(primary),APP_STAFF_ACCESS_KEYS:JSON.stringify(staff)},
  outboundService:()=>{throw Error('No external requests in availability access tests');}
 }));
 t.after(()=>mf.dispose());
 async function call(path,{body,cookie='',headers={}}={}){
  const response=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),headers:response.headers};
 }
 async function login(username){
  const response=await call('/api/login',{body:{username,key:primary[username]??staff[username]}});
  assert.equal(response.status,200,JSON.stringify(response.data));
  return response.headers.get('set-cookie').split(';')[0];
 }
 const cookies={alex:await login('alex'),alinda:await login('alinda')};
 assert.equal((await call('/api/catalog',{cookie:cookies.alex,body:{revision:0,catalog:initialCatalog}})).status,200);
 assert.equal((await call('/api/catalog',{cookie:cookies.alinda,body:{revision:1,catalog:initialCatalog}})).status,200,'both existing admins retain full catalogue access');
 const db=await mf.getD1Database('DB');
 const untouched=async()=>({sales:(await db.prepare('SELECT * FROM v2_events').all()).results,production:(await db.prepare('SELECT * FROM v2_production_events').all()).results});
 const historyBefore=await untouched();
 for(const username of ['alex','alinda'])assert.equal((await call('/api/bootstrap',{cookie:cookies[username]})).data.capabilities.manage_product_availability,true);

 for(const username of ['xavier','xalinda']){
  cookies[username]=await login(username);
  let bootstrap=await call('/api/bootstrap',{cookie:cookies[username]});
  assert.equal(bootstrap.status,200);
  assert.equal(bootstrap.data.capabilities.manage_product_availability,true);
  assert.equal(bootstrap.data.catalog.routes[0].invoice_stores,undefined);
  assert.equal(bootstrap.data.catalog.routes[0].invoice_enabled,true);
  assert.doesNotMatch(JSON.stringify(bootstrap.data.catalog),/SYNTHETIC-INVOICE-CANARY|SYNTHETIC PRIVATE SHOP/);
  let catalog=bootstrap.data.catalog;
  for(const available of [false,true]){
   const priorRevision=catalog.revision;
   const response=await call('/api/products/availability',{cookie:cookies[username],body:{code:'W01',available,revision:priorRevision}});
   assert.equal(response.status,200,JSON.stringify(response.data));
   assert.equal(response.data.catalog.revision,priorRevision+1);
   assert.equal(response.data.catalog.routes[0].invoice_stores,undefined);
   assert.equal(response.data.catalog.routes[0].invoice_enabled,true);
   assert.doesNotMatch(JSON.stringify(response.data.catalog),/SYNTHETIC-INVOICE-CANARY|SYNTHETIC PRIVATE SHOP/,'availability saves must not expose invoice/customer details');
   const product=response.data.catalog.products.find(p=>p.code==='W01');
   assert.equal(product.available,available);
   assert.equal(product.availability_updated_by,username);
   assert.ok(Number.isFinite(Date.parse(product.availability_updated_at)));
   assert.equal((await call('/api/products/availability',{cookie:cookies[username],body:{code:'W01',available:!available,revision:priorRevision}})).status,409,'stale edits must not overwrite another saved revision');
   // Reloading through another authenticated session proves the value was stored.
   catalog=(await call('/api/bootstrap',{cookie:cookies.alinda})).data.catalog;
   assert.deepEqual(catalog,response.data.catalog);
   const saved=await db.prepare('SELECT revision,actor,payload FROM v2_catalog WHERE id=1').first();
   assert.equal(saved.actor,username);assert.equal(saved.revision,catalog.revision);
   assert.equal(JSON.parse(saved.payload).products.find(p=>p.code==='W01').available,available);
   assert.deepEqual(JSON.parse(saved.payload).routes,initialCatalog.routes,'response projection does not remove stored invoice data');
  }
  for(const code of ['P01','NO_SUCH_PRODUCT'])assert.equal((await call('/api/products/availability',{cookie:cookies[username],body:{code,available:true,revision:catalog.revision}})).status,400,'only existing active products may be toggled');
  assert.equal((await call('/api/products/availability',{cookie:cookies[username],body:{code:'W01',available:'false',revision:catalog.revision}})).status,400);
  assert.equal((await call('/api/products/availability',{cookie:cookies[username],headers:{Origin:'https://outside.example'},body:{code:'W01',available:false,revision:catalog.revision}})).status,403);
  for(const path of ['/api/recipes','/api/order-guy?from=2026-10-29&to=2026-10-29','/api/staff'])assert.equal((await call(path,{cookie:cookies[username]})).status,403,path+' remains protected');
  assert.equal((await call('/api/zoho/connect',{cookie:cookies[username],body:{}})).status,403);
  assert.equal((await call('/api/catalog',{cookie:cookies[username],body:{revision:catalog.revision,catalog:initialCatalog}})).status,403,'availability permission cannot edit prices or the full catalogue');
 }

 const current=(await call('/api/bootstrap',{cookie:cookies.alex})).data.catalog;
 const beforeDenied=await db.prepare('SELECT * FROM v2_catalog WHERE id=1').first();
 const payload={code:'W01',available:false,revision:current.revision};
 assert.equal((await call('/api/products/availability',{body:payload})).status,401);
 cookies.other_staff=await login('other_staff');
 assert.equal((await call('/api/bootstrap',{cookie:cookies.other_staff})).data.capabilities.manage_product_availability,false);
 assert.equal((await call('/api/products/availability',{cookie:cookies.other_staff,body:payload})).status,403);
 for(const username of ['tapiz','mosa','musa']){
  const cookie=await login(username);
  assert.equal((await call('/api/bootstrap',{cookie})).status,403);
  assert.equal((await call('/api/products/availability',{cookie,body:payload})).status,403,'invoice-only accounts must not gain product access');
 }
 assert.deepEqual(await db.prepare('SELECT * FROM v2_catalog WHERE id=1').first(),beforeDenied,'denied/invalid writes do not alter catalogue data');
 assert.deepEqual(current.routes,[{code:'R07',name:'MOSSEL BAY',weekday:4,invoice_enabled:true}]);
 for(const original of initialCatalog.products){
  const product=current.products.find(p=>p.code===original.code);
  for(const field of ['code','name','unit','price_cents','active'])assert.equal(product[field],original[field],field+' is outside the availability change');
 }
 assert.deepEqual(await untouched(),historyBefore,'availability does not create or rewrite saved sales/production');
});

function testDocument(){
 const {document}=parseHTML('<html><body></body></html>');
 const createElement=document.createElement.bind(document);
 document.createElement=name=>{
  const element=createElement(name);
  if(name==='dialog'){
   element.showModal=()=>{element.open=true;};
   element.close=()=>{element.open=false;element.onclose?.();};
  }
  return element;
 };
 return document;
}

test('Products enables Xavier and Xalinda switches, blocks a second click while saving and shows the persisted result',async()=>{
 const previousDocument=globalThis.document;
 try{
  for(const username of ['xavier','xalinda']){
   globalThis.document=testDocument();
   let catalog={...structuredClone(initialCatalog),revision:7},pending,posts=0;
   const changes=[];
   const api=async(path,body)=>{
    if(path==='/api/bootstrap')return {username,capabilities:{manage_product_availability:true},catalog:structuredClone(catalog)};
    assert.equal(path,'/api/products/availability');posts++;
    assert.deepEqual(body,{code:'W01',available:false,revision:7});
    return new Promise(resolve=>{pending=()=>{
     catalog={...catalog,revision:8,products:catalog.products.map(p=>p.code===body.code?{...p,available:body.available}:p)};
     resolve({catalog:structuredClone(catalog)});
    };});
   };
   await openAvailability({api,onChange:value=>changes.push(structuredClone(value))});
   const switchFor=code=>document.querySelector('[data-availability-code="'+code+'"]');
   assert.equal(switchFor('W01').disabled,false);
   assert.equal(switchFor('P01').disabled,true);
   assert.equal(switchFor('W01').getAttribute('aria-checked'),'true');
   const firstButton=switchFor('W01');
   const saving=firstButton.onclick();
   assert.equal(document.querySelector('#availability-message').textContent,'Saving…');
   assert.ok([...document.querySelectorAll('[data-availability-code]')].every(button=>button.disabled));
   await firstButton.onclick();assert.equal(posts,1,'a second action while saving cannot duplicate the request');
   pending();await saving;
   assert.equal(switchFor('W01').getAttribute('aria-checked'),'false');
   assert.equal(switchFor('W01').disabled,false);
   assert.match(document.querySelector('#availability-message').textContent,/Not available.*Saved/);
   assert.equal(changes.length,2);assert.equal(changes.at(-1).revision,8);
   document.querySelector('#close-availability').onclick();
   assert.equal(document.querySelector('#product-availability'),null);
  }
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});

test('Products stays read-only when the server does not grant availability permission',async()=>{
 const previousDocument=globalThis.document;
 try{
  for(const bootstrap of [{username:'xavier',capabilities:{manage_product_availability:false}},{username:'alex'}]){
   globalThis.document=testDocument();
   await openAvailability({api:async path=>{assert.equal(path,'/api/bootstrap');return {...bootstrap,catalog:{...structuredClone(initialCatalog),revision:1}};},onChange(){}});
   assert.ok([...document.querySelectorAll('[data-availability-code]')].every(button=>button.disabled));
  }
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});
