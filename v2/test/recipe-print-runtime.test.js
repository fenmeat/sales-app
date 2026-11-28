import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PDFDocument} from 'pdf-lib';
import {fixture,pdfText} from './recipe-print-fixture.js';

test('named staff can read and print saved recipes but cannot alter recipes or access manager data',async t=>{
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false});
 const users=['alex','alinda','xavier','xalinda','tapiz','mosa','musa','other'],access=Object.fromEntries(users.map(name=>[name,('synthetic-recipe-'+name).padEnd(64,'x')]));
 const mf=new Miniflare(convertV4MiniflareOptions({name:'recipe-print-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'recipe-print'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(access)},outboundService:()=>{throw Error('No external traffic');}}));
 t.after(()=>mf.dispose());
 const origin='https://synthetic-recipes.example',path='/api/print/recipe?group=TEST&version=2&revision=7';
 const raw=(url,cookie='',body)=>mf.dispatchFetch(origin+url,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await raw(path)).status,401);
 assert.equal((await raw('/api/recipes')).status,401);
 const cookies={};for(const user of users){const r=await raw('/api/login','',{username:user,key:access[user]});assert.equal(r.status,200);cookies[user]=r.headers.get('set-cookie').split(';')[0];}
 const db=await mf.getD1Database('DB');
 for(const revision of [7,8]){
  const saved=fixture();saved.register.recipes[0].name='Synthetic revision '+revision;
  saved.register.notes='PRIVATE_REGISTER';saved.register.packaging=[{product:'PRIVATE_PACKAGING'}];
  for(const material of saved.register.materials)Object.assign(material,{price:{amount:99,source:'PRIVATE_PRICE'},source:'PRIVATE_SOURCE',notes:'PRIVATE_NOTE',stock:{qty:500}});
  saved.register.recipes[0].ingredients[0].note='PRIVATE_INGREDIENT_NOTE';
  await db.prepare('INSERT INTO v2_recipe_events(request_id,request_hash,revision,payload,actor,saved_at,reason) VALUES(?,?,?,?,?,?,?)').bind('synthetic-recipe-'+revision,'test',revision,JSON.stringify(saved.register),'alex',saved.saved_at,'Synthetic fixture').run();
 }
 const snapshot=async()=>{
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v2_%' AND name NOT IN ('v2_sessions','v2_auth_limits') ORDER BY name").all()).results;
  return Object.fromEntries(await Promise.all(tables.map(async({name})=>[name,(await db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()).results])));
 };
 const before=await snapshot();
 for(const user of ['alex','alinda','xavier','xalinda']){
  const response=await raw(path,cookies[user]);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('x-fenmeat-print-revision'),'7');
  const pdf=await PDFDocument.load(await response.arrayBuffer());assert.equal(pdf.getPageCount(),1);assert.match(await pdfText(pdf),/Synthetic revision 7/);assert.doesNotMatch(await pdfText(pdf),/revision 8/);
 }
 for(const user of ['xavier','xalinda']){
  const response=await raw('/api/recipes',cookies[user]);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();assert.equal(data.recipes_read_only,true);assert.equal(data.current_user,user);assert.equal(data.revision,8);
  assert.equal(data.register.recipes[0].name,'Synthetic revision 8');assert.equal(data.register.recipes[0].ingredients.at(-1).qty,.02);
  assert.equal(data.costs,undefined);assert.equal(data.register.notes,undefined);assert.deepEqual(data.register.packaging,[]);
  assert.ok(data.register.materials.every(material=>Object.keys(material).sort().join(',')==='id,name,unit'));
  assert.doesNotMatch(JSON.stringify(data),/PRIVATE_|"price"|"stock"|"source"|"notes?"/);
  for(const endpoint of ['/api/recipes','/api/import/recipes','/api/recipes/audit','/api/recipes/documented-update','/api/recipes/margot-packs','/api/order-guy','/api/sync/order-guy']){
   if(endpoint!=='/api/recipes')assert.equal((await raw(endpoint,cookies[user])).status,403,endpoint);
   assert.equal((await raw(endpoint,cookies[user],{register:{},revision:8,request_id:crypto.randomUUID(),reason:'Forbidden synthetic change'})).status,403,endpoint);
  }
  assert.equal((await raw(path,cookies[user],{})).status,405);
  const signedIn=await raw('/api/login','',{username:user,key:access[user]}),fresh=signedIn.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await (await raw('/api/recipes',fresh)).json(),data,'read access persists in a new session');
 }
 for(const user of ['tapiz','mosa','musa','other']){assert.equal((await raw(path,cookies[user])).status,403);assert.equal((await raw('/api/recipes',cookies[user])).status,403);}
 for(const query of ['group=TEST&version=2','group=TEST&version=0&revision=7','group=TEST&version=2&revision=0','group=%3Cscript%3E&version=2&revision=7'])assert.equal((await raw('/api/print/recipe?'+query,cookies.alex)).status,400);
 assert.equal((await raw(path.replace('revision=7','revision=999'),cookies.alex)).status,404);
 assert.equal((await raw(path.replace('version=2','version=9'),cookies.alex)).status,404);
 assert.equal((await raw(path,cookies.alex,{})).status,405);
 assert.deepEqual(await snapshot(),before);
});
