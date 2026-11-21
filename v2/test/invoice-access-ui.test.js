import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {signInMarkup,pinExpired,hasDraftWork} from '../public/invoicing/access-ui.js';
import {applyInvoiceCommand,openingAccount,accountSummary,parseAmount,parseQuantity} from '../src/invoice-domain.js';
const html=await readFile(new URL('../public/invoicing/index.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/invoicing/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('void start();','globalThis.ui={ready:start(),get state(){return state;},action,refresh,render,command,persist};');
const date=new Date(Date.now()+7200000).toISOString().slice(0,10),phone='synthetic-phone-1234567890',id='9001001';
const products=[{code:'P1',name:'SYNTHETIC PRODUCT',unit:'bag',active:true,available:true,price_cents:10000}];
const store={id,name:'SYNTHETIC PRIVATE SHOP',stop:1,terms:7,opening:{customer_id:id,complete:true,balance_cents:0,invoices:[],drafts:[],generated_at:new Date().toISOString()}};
const session={id:1,actor:'tapiz',device:phone,date,status:'active',sequence:0,products};
const data=()=>({username:'tapiz',display_name:'Tapiz',admin:false,rep_phone_id:phone,rep_session_expires:Date.now()+86400000,date,route:'R03',route_name:'SYNTHETIC ROUTE',available_routes:[{code:'R03',name:'SYNTHETIC ROUTE'}],stores:[store],accounts:{[id]:openingAccount(store)},products,session:structuredClone(session)});
const saved=()=>({localVersion:1,device:phone,data:data(),selected:id,queue:[],drafts:{},sequence:0});
class FormDataForDOM{constructor(form){this.values=[];for(const e of form.querySelectorAll('[name]'))if(e.type!=='checkbox'||e.checked)this.values.push([e.name,e.value??e.querySelector('option')?.value??'']);}get(name){return this.values.find(([n])=>n===name)?.[1]??null;}getAll(name){return this.values.filter(([n])=>n===name).map(([,v])=>v);}has(name){return this.values.some(([n])=>n===name);}}
async function page(initial,respond,{hash='',online=true,search='?v=0.24.1'}={}){
 const {document}=parseHTML(html),events=new Map(),calls=[],writes=[],replaced=[],navigation=[];let version=initial?.localVersion??0,saveGate=null;
 document.addEventListener=(event,handler)=>events.set(event,handler);const modal=document.querySelector('#modal');modal.close=()=>{modal.open=false;};modal.showModal=()=>{modal.open=true;};
 const location={hash,pathname:'/invoicing/',search,origin:'https://example.test',assign:url=>navigation.push(url)};
 const context={document,window:{addEventListener(){},print(){}},location,history:{replaceState:(...args)=>replaced.push(args)},navigator:{onLine:online},URL,URLSearchParams,crypto,TextEncoder,structuredClone,Date,Intl,setTimeout,clearTimeout,setInterval(){},FormData:FormDataForDOM,installInputSelection(){},signInMarkup,pinExpired,hasDraftWork,applyInvoiceCommand,accountSummary,parseAmount,parseQuantity,
 load:async()=>structuredClone(initial),save:async(value,expected)=>{assert.equal(expected,version);if(saveGate)await saveGate();writes.push(structuredClone(value));return ++version;},
 fetch:async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,body});const r=await respond(path,body);return {ok:r.status===undefined||r.status===200,status:r.status??200,json:async()=>r.data??r};}};
 vm.createContext(context);vm.runInContext(source,context);await context.ui.ready;
 async function submit(id,fields){const f=document.querySelector('#'+id);assert.ok(f,'form '+id+' is visible');for(const [name,value] of Object.entries(fields)){const input=f.querySelector('[name='+name+']');assert.ok(input);input.value=value;}await events.get('submit')({target:f,preventDefault(){}});}
 return {document,calls,writes,replaced,navigation,setSaveGate:fn=>saveGate=fn,submit,navigator:context.navigator,click:target=>events.get('click')({target}),ui:context.ui};
}

test('opening Tasks waits for invoice storage and stays in Invoices on a failed save or offline',async()=>{
 const p=await page(saved(),async()=>data());let release;
 p.setSaveGate(()=>new Promise(resolve=>release=resolve));
 const saving=p.ui.persist(s=>{s.drafts[id]={lines:{P1:{qty:'2',checked:false}}};});
 await Promise.resolve();
 let prevented=false;const event={preventDefault(){prevented=true;},currentTarget:{href:'https://example.test/tasks'}};
 const leaving=p.document.querySelector('#tasks').onclick(event);assert.equal(prevented,true);assert.deepEqual(p.navigation,[]);
 release();await saving;await leaving;
 assert.deepEqual(p.navigation,['https://example.test/tasks']);assert.equal(p.writes.at(-1).drafts[id].lines.P1.qty,'2');
 const failed=await page(saved(),async()=>data());failed.setSaveGate(()=>Promise.reject(Error('Storage unavailable')));
 const rejected=failed.ui.persist(s=>{s.drafts[id]={lines:{P1:{qty:'3',checked:false}}};}).catch(()=>{});
 const blocked=failed.document.querySelector('#tasks').onclick(event);await rejected;await blocked;
 assert.deepEqual(failed.navigation,[]);assert.match(failed.document.querySelector('#error').textContent,/finish saving/);
 p.navigator.onLine=false;await p.document.querySelector('#tasks').onclick(event);assert.equal(p.navigation.length,1);
 assert.match(p.document.querySelector('#error').textContent,/internet connection/);
});
test('registered rep gets a numeric PIN form, and re-login syncs the original queued transaction exactly once',async()=>{
 const initial=saved();initial.needsAuth=true;initial.data.rep_session_expires=Date.now()-1;
 const command={action:'issue',customer_id:id,revision:0,request_id:crypto.randomUUID(),captured_at:new Date().toISOString(),lines:[{code:'P1',qty:1000,checked:true}],cash:10000,shop2shop:0,received:true};
 const after=applyInvoiceCommand(initial.data.accounts[id],command,{actor:'tapiz',admin:false,date,session:1,products,invoiceId:'FM-1-1',invoiceNumber:'SYNTHETIC-INVOICE'});
 const pending={route:'R03',device:phone,session_id:1,sequence:1,command};initial.queue=[pending];initial.sequence=1;initial.data.accounts[id]=after;
 const pageData=data();pageData.accounts[id]=after;pageData.session.sequence=1;
 const p=await page(initial,async(path,body)=>{
  if(path.endsWith('/access/status'))return {registered:true,username:'tapiz',name:'Tapiz',phone_id:phone};
  if(path.endsWith('/access/login')){assert.equal(body.pin,'704862');return {username:'tapiz',phone_id:phone,expires:Date.now()+86400000};}
  if(path.endsWith('/command')){assert.deepEqual(body,pending);return {account:after,sequence:1};}
  if(path.includes('/bootstrap'))return pageData;
  throw Error('Unexpected API '+path);
 });
 assert.equal(p.document.querySelector('#repLogin [name=pin]').getAttribute('inputmode'),'numeric');
 assert.ok(!p.document.querySelector('#app').textContent.includes(store.name));
 await p.submit('repLogin',{pin:'704862'});
 assert.equal(p.ui.state.queue.length,0);assert.equal(p.ui.state.sequence,1);assert.equal(p.ui.state.device,phone);assert.equal(p.ui.state.data.accounts[id].receipts.length,1);
 assert.equal(p.calls.filter(c=>c.path.endsWith('/command')).length,1);
 assert.equal(p.document.querySelector('#error').hidden,true);
 for(const s of p.writes)assert.ok(!JSON.stringify(s).includes('704862'),'PIN never enters persistent state');
});
test('expired offline sign-in hides cached financial records and preserves queued work',async()=>{
 const initial=saved();initial.data.rep_session_expires=Date.now()-1;initial.queue=[{command:{request_id:'synthetic-pending'}}];
 const p=await page(initial,async()=>{throw Error('Offline');},{online:false});
 assert.match(p.document.querySelector('#app').textContent,/Connect to sign in/);assert.ok(!p.document.querySelector('#app').textContent.includes(store.name));assert.equal(p.ui.state.queue.length,1);assert.equal(p.writes.length,0);
});
test('a 24-hour sign-in still opens the route offline after a 16-hour shift; locking waits for sync',async()=>{
 const initial=saved();initial.data.rep_session_expires-=16*3600000;const p=await page(initial,async()=>{throw Error('Offline');},{online:false});
 assert.ok(p.document.querySelector('#app').textContent.includes(store.name));assert.ok(p.document.querySelector('[data-action=complete]'));
 p.ui.state.queue.push({command:{request_id:'synthetic-pending'}});
 await assert.rejects(p.ui.action('lock'),/Sync your pending/);assert.equal(p.ui.state.queue.length,1);assert.ok(!p.calls.some(c=>c.path.endsWith('/access/lock')));
});
test('activation fragment is removed from the URL and registration cannot discard another person’s draft',async()=>{
 const initial=saved();initial.data.username='alex';initial.data.admin=true;initial.data.rep_phone_id=null;initial.drafts[id]={lines:{P1:{qty:'2',checked:true}},cash:'0',shop2shop:'0'};
 const p=await page(initial,async path=>{assert.ok(path.endsWith('/access/status'));return {registered:false};},{hash:'#setup=1234abcd5678ef90'});
 assert.equal(p.replaced.length,1);assert.ok(!p.replaced[0][2].includes('setup='));
 assert.equal(p.document.querySelector('#repEnroll [name=code]').value,'1234abcd5678ef90');
 await p.submit('repEnroll',{code:'1234abcd5678ef90',pin:'704862',pin_confirm:'704862'});
 assert.match(p.document.querySelector('#error').textContent,/Finish and sync/);assert.equal(p.ui.state.drafts[id].lines.P1.qty,'2');assert.equal(p.calls.length,1);
});
test('an identity mismatch cannot clear another person’s offline queue',async()=>{
 const initial=saved();initial.needsAuth=true;initial.queue=[{command:{request_id:'synthetic-pending'}}];
 const p=await page(initial,async path=>path.endsWith('/access/status')?{registered:true,name:'Musa',phone_id:'different-phone'}:{username:'mosa',phone_id:'different-phone',expires:Date.now()+86400000});
 await p.submit('repLogin',{pin:'704862'});assert.match(p.document.querySelector('#error').textContent,/Sign in as tapiz/);assert.equal(p.ui.state.queue.length,1);assert.equal(p.ui.state.data.username,'tapiz');assert.equal(p.writes.length,0);
});
test('another rep occupying the initial route does not hide the other prepared routes',async()=>{
 const initial=saved();initial.data.session.actor='mosa';initial.data.session.device='other-synthetic-phone';
 initial.data.available_routes=[{code:'R03',name:'SYNTHETIC ROUTE'},{code:'R04',name:'OTHER ROUTE'}];
 const next=structuredClone(initial.data);next.route='R04';next.route_name='OTHER ROUTE';next.session=null;
 const other={...store,id:'9001002',name:'OTHER SYNTHETIC SHOP',opening:{...store.opening,customer_id:'9001002'}};
 next.stores=[other];next.accounts={[other.id]:openingAccount(other)};
 const p=await page(initial,async path=>path.includes('route=R04')?next:initial.data);
 assert.equal(p.document.querySelectorAll('#routeChoice option').length,2);
 assert.match(p.document.querySelector('#app').textContent,/Choose another route/);
 await p.ui.refresh('R04');
 assert.equal(p.ui.state.data.route,'R04');assert.equal(p.ui.state.selected,other.id);
 assert.ok(p.document.querySelector('[data-action=prepare]'));
 assert.equal(p.ui.state.device,phone);assert.equal(p.ui.state.queue.length,0);
 assert.equal(p.ui.state.data.accounts[id],undefined);
});
test('cached Factory Sales is excluded from road choices online and offline without changing saved work',async()=>{
 for(const online of [true,false]){
  const initial=saved();initial.data.session=null;
  initial.data.available_routes=[{code:'R03',name:'SYNTHETIC ROUTE'},{code:'R04',name:'OTHER ROUTE'},{code:'R12',name:'Factory Sales'}];
  initial.drafts[id]={lines:{P1:{qty:'2',checked:true}},cash:'0',shop2shop:'0'};
  const p=await page(initial,async()=>initial.data,{online});
  assert.deepEqual([...p.document.querySelectorAll('#routeChoice option')].map(o=>o.value),['R03','R04']);
  assert.doesNotMatch(p.document.querySelector('#routeChoice').textContent,/Factory/);
  assert.equal(p.ui.state.drafts[id].lines.P1.qty,'2');
  assert.equal(p.ui.state.data.accounts[id].revision,0);
 }
});
test('an unfinished route owned by this phone still requires finishing before switching',async()=>{
 const initial=saved();initial.data.session.date='2020-01-01';
 initial.data.available_routes=[{code:'R03',name:'SYNTHETIC ROUTE'},{code:'R04',name:'OTHER ROUTE'}];
 const p=await page(initial,async()=>initial.data);
 assert.equal(p.document.querySelector('#routeChoice'),null);
 assert.ok(p.document.querySelector('[data-action=finish]'));
 assert.match(p.document.querySelector('#app').textContent,/Finish the previous route/);
});
test('Factory Sales opens the separate POS and retains previous records without exposing admin controls',async()=>{
 const initial=saved();Object.assign(initial.data,{username:'xavier',display_name:'Xavier',factory_sales:true,admin:false,rep_phone_id:null,route:'R12',route_name:'Factory Sales',available_routes:[{code:'R12',name:'Factory Sales'}],session:null});
 const p=await page(initial,async()=>initial.data);
 assert.ok(p.document.querySelector('a[href="/pos"]'));assert.ok(p.document.querySelector('a[href="/"]'));assert.equal(p.document.querySelector('[data-action=prepare]'),null);
 assert.match(p.document.querySelector('#app').textContent,/Previous Factory records/);
 await p.ui.action('routeOptions');assert.ok(!p.document.querySelector('a[href*=phones]'));assert.ok(!p.document.querySelector('[data-action=balances]'));
 p.ui.state.data.session={...session,actor:'xavier',device:phone};p.ui.render();
 assert.ok(!p.document.querySelector('[data-action=complete]'));assert.ok(!p.document.querySelector('[data-action=terms]'));
 await p.ui.action('routeOptions');assert.ok(p.document.querySelector('[data-action=finish]'),'legacy pending session can still sync and finish');
});
test('denied factory bootstrap hides cached customer data and never falls back to it online',async()=>{
 const initial=saved();initial.data.route='R12';initial.data.factory_sales=true;
 const p=await page(initial,async path=>path.includes('/bootstrap')?{status:403,data:{error:'Not allowed'}}:{registered:true,username:'mosa',name:'Musa'});
 assert.equal(p.ui.state.needsAuth,true);assert.ok(p.document.querySelector('#repLogin'));assert.ok(!p.document.querySelector('#app').textContent.includes(store.name));
});
test('owner can sign in and create a phone invitation directly on the setup page without choosing the rep PIN',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../public/invoicing/phones.html',import.meta.url),'utf8'));
 const events=new Map(),calls=[];document.addEventListener=(name,fn)=>events.set(name,fn);window.HTMLElement.prototype.scrollIntoView=()=>{};
 let signed=false,created=false,copied='';
 const context={document,location:{origin:'https://example.test'},installInputSelection(){},FormData:FormDataForDOM,Date,confirm:()=>true,navigator:{clipboard:{writeText:async text=>{copied=text;}}},fetch:async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({path,body});let status=200,data;
  if(path==='/api/login'){assert.equal(body.username,'alex');assert.equal(body.key,'SYNTHETIC-owner-key');signed=true;data={username:'alex'};}
  else if(!signed){status=401;data={error:'Sign in'};}
  else if(body){assert.equal(body.action,'create');assert.equal(body.rep,'tapiz');created=true;data={id:'synthetic-id',rep:'tapiz',name:'Tapiz road phone',code:'1234abcd5678ef90',expires:Date.now()+900000};}
  else data={phones:created?[{id:'synthetic-id',rep:'tapiz',name:'Tapiz road phone',revoked:0,enrolled:0,revision:1}]:[]};
  return {ok:status===200,status,json:async()=>data};
 }};
 const code=(await readFile(new URL('../public/invoicing/phones.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('reload().catch(e=>','globalThis.ready=reload().catch(e=>');
 vm.createContext(context);vm.runInContext(code,context);await context.ready;
 const login=document.querySelector('#ownerLogin'),key=login.querySelector('[name=key]');key.value='SYNTHETIC-owner-key';
 await events.get('submit')({target:login,preventDefault(){}});assert.equal(key.value,'');assert.ok(document.querySelector('#create'));
 await events.get('submit')({target:document.querySelector('#create'),preventDefault(){}});
 assert.match(document.querySelector('#code').textContent,/Activate phone/);assert.equal(document.querySelector('#code input').value,'1234-abcd-5678-ef90');
 assert.ok(!document.querySelector('[name=pin]'),'the owner never chooses or sees the rep PIN');
 await events.get('click')({target:document.querySelector('#copy')});assert.equal(copied,'https://example.test/invoicing/?v=0.36.2#setup=1234abcd5678ef90');
 assert.equal(calls.filter(c=>c.body?.action==='create').length,1);assert.equal(document.querySelector('#error').hidden,true);
});

const ownerData=name=>({...data(),username:name,display_name:name==='alex'?'Alex':'Alinda',admin:true,admin_management:true,rep_phone_id:null,rep_session_expires:null,available_routes:[{code:'R03',name:'FIRST ROUTE'},{code:'R04',name:'SECOND ROUTE'}]});
test('both owners entering from Home escape cached Factory Sales and can manage a route open on the rep phone',async()=>{
 for(const username of ['alex','alinda']){
  const initial=saved();Object.assign(initial.data,{username,admin:true,rep_phone_id:null,rep_session_expires:null,route:'R12',factory_sales:true,session:{...session,actor:username}});
  initial.drafts['factory-old-id']={lines:{P1:{qty:'2',checked:true}}};
  const live=ownerData(username),p=await page(initial,async path=>{assert.equal(path,'/api/invoicing/bootstrap');return live;},{search:'?view=routes'});
  assert.equal(p.ui.state.data.route,'R03');assert.equal(p.document.querySelectorAll('#routeChoice option').length,2);assert.doesNotMatch(p.document.querySelector('#routeChoice').textContent,/Factory/);
  assert.equal(p.document.querySelector('[data-action=prepare]'),null);assert.ok(p.document.querySelector('#store'));
  assert.equal(p.document.querySelector('[data-action=terms]').disabled,false);assert.equal(p.document.querySelector('[data-action=name]').disabled,false);
  assert.equal(p.ui.state.data.session.actor,'tapiz');assert.equal(p.ui.state.drafts['factory-old-id'].lines.P1.qty,'2');
 }
});
test('an explicit old Factory ledger keeps its history and gives owners a route navigation exit',async()=>{
 const initial=saved();initial.data={...ownerData('alex'),route:'R12',factory_sales:true,admin_management:false,session:null};
 const p=await page(initial,async path=>path.includes('route=R12')?initial.data:ownerData('alex'),{search:'?route=R12'});
 assert.match(p.document.querySelector('#app').textContent,/Previous Factory records/);assert.ok(p.document.querySelector('[data-action=roadInvoices]'));
 await p.ui.action('roadInvoices');assert.equal(p.ui.state.data.route,'R03');assert.ok(p.document.querySelector('#store'));
});
test('owner can select another route and edit older invoices; offline management cannot submit a change',async()=>{
 const initial=saved();initial.data=ownerData('alinda');
 const a=applyInvoiceCommand(initial.data.accounts[id],{action:'issue',customer_id:id,revision:0,request_id:crypto.randomUUID(),captured_at:'2020-01-01T09:00:00Z',lines:[{code:'P1',qty:1000,checked:true}],cash:0,shop2shop:0},{actor:'tapiz',admin:false,date:'2020-01-01',session:99,products,invoiceId:'FM-OLD-99',invoiceNumber:'OLD-99'});
 initial.data.accounts[id]=a;
 const other={...store,id:'9001002',name:'OTHER SHOP',opening:{...store.opening,customer_id:'9001002'}};
 const next={...ownerData('alinda'),route:'R04',route_name:'SECOND ROUTE',stores:[other],accounts:{[other.id]:openingAccount(other)}};
 const p=await page(initial,async path=>path.includes('route=R04')?next:initial.data);
 const edit=p.document.querySelector('[data-edit="FM-OLD-99"]');assert.equal(edit.disabled,false);await p.click(edit);
 assert.equal(p.ui.state.drafts[id].invoice_id,'FM-OLD-99');assert.ok(p.document.querySelector('[data-draft=reason]'));
 await p.ui.refresh('R04');assert.equal(p.ui.state.selected,other.id);assert.equal(p.ui.state.drafts[id].invoice_id,'FM-OLD-99');
 p.navigator.onLine=false;p.ui.render();assert.equal(p.document.querySelector('[data-action=name]').disabled,true);await assert.rejects(p.ui.command({action:'name',name:'No offline save'}),/Connect/);
 assert.ok(!p.calls.some(c=>c.path.endsWith('/admin/command')));
});
test('interrupted owner saves keep the same request for replay and stale saves retain the draft for review',async()=>{
 const initial=saved();initial.data=ownerData('alex');initial.data.session=null;
 let account=initial.data.accounts[id],fail=true,reject=false;
 const p=await page(initial,async(path,body)=>{
  if(path.includes('/bootstrap'))return {...initial.data,accounts:{[id]:account}};
  assert.equal(path,'/api/invoicing/admin/command');
  if(fail){fail=false;throw Error('Connection interrupted');}
  if(reject)return {status:409,data:{error:'Account changed. Reload shared records.',save_rejected:true}};
  account=applyInvoiceCommand(account,body.command,{actor:'alex',admin:true,management:true,date,products,session:null});return {account};
 });
 await assert.rejects(p.ui.command({action:'name',name:'CONFIRMED NEW NAME'}),/interrupted/);
 const savedRequest=structuredClone(p.ui.state.adminPending);assert.equal(p.ui.state.data.accounts[id].name,store.name);assert.ok(p.document.querySelector('[data-action=sync]'));
 await p.ui.action('sync');assert.equal(p.ui.state.adminPending,undefined);assert.equal(p.ui.state.data.accounts[id].name,'CONFIRMED NEW NAME');
 assert.deepEqual(p.calls.filter(c=>c.body?.command).map(c=>c.body.command.request_id),[savedRequest.body.command.request_id,savedRequest.body.command.request_id]);
 p.ui.state.drafts[id]={lines:{P1:{qty:'3',checked:true}},cash:'0',shop2shop:'0',reference:'',received:false,reason:'Keep this reason',returned:false};reject=true;
 await assert.rejects(p.ui.command({action:'draft',draft:p.ui.state.drafts[id]}),/Account changed/);
 assert.equal(p.ui.state.adminPending,undefined);assert.equal(p.ui.state.drafts[id].reason,'Keep this reason');
 await p.ui.refresh();assert.equal(p.ui.state.drafts[id].lines.P1.qty,'3');
});
test('reopening an interrupted owner save retries before changing routes and never clears the saved draft early',async()=>{
 const initial=saved();initial.data=ownerData('alex');initial.data.session=null;initial.drafts[id]={lines:{P1:{qty:'1',checked:true}},cash:'0',shop2shop:'0',reference:'',received:false,reason:'',returned:false};
 const c={action:'issue',customer_id:id,revision:0,request_id:crypto.randomUUID(),captured_at:new Date().toISOString(),lines:[{code:'P1',qty:1000,checked:true}],cash:10000,shop2shop:0,received:true};
 initial.adminPending={body:{route:'R03',command:c},clearDraft:true};
 const after=applyInvoiceCommand(initial.data.accounts[id],c,{actor:'alex',admin:true,management:true,date,products,session:null,invoiceId:'FM-REPLAY',invoiceNumber:'REPLAY'});
 const p=await page(initial,async path=>path.endsWith('/admin/command')?{account:after,replayed:true}:{...initial.data,accounts:{[id]:after}},{search:'?view=routes'});
 assert.equal(p.calls[0].path,'/api/invoicing/admin/command');assert.equal(p.calls[0].body.command.request_id,c.request_id);assert.equal(p.ui.state.adminPending,undefined);assert.equal(p.ui.state.drafts[id],undefined);assert.equal(p.ui.state.data.accounts[id].receipts.length,1);
});

test('a rep reviews an owner change without losing the offline invoice or duplicating its payment',async()=>{
 const initial=saved(),original=initial.data.accounts[id];
 const c={action:'issue',customer_id:id,revision:0,request_id:crypto.randomUUID(),captured_at:new Date().toISOString(),lines:[{code:'P1',qty:1000,checked:true}],cash:10000,shop2shop:0,received:true};
 const local=applyInvoiceCommand(original,c,{actor:'tapiz',admin:false,date,session:1,products,invoiceId:'FM-1-1',invoiceNumber:'LOCAL'});
 initial.data.accounts[id]=local;initial.sequence=1;initial.queue=[{route:'R03',device:phone,session_id:1,sequence:1,command:c}];
 const owner=applyInvoiceCommand(original,{action:'name',name:'OWNER CONFIRMED NAME',customer_id:id,revision:0,request_id:crypto.randomUUID(),captured_at:new Date().toISOString()},{actor:'alinda',admin:true,management:true,date,session:null,products});
 let latest=owner;
 const p=await page(initial,async(path,body)=>{
  if(path.includes('/bootstrap'))return {...initial.data,accounts:{[id]:latest}};
  assert.equal(path,'/api/invoicing/command');
  if(body.command.revision===0)return {status:409,data:{error:'Shop changed',account_conflict:true,account:owner}};
  latest=applyInvoiceCommand(latest,body.command,{actor:'tapiz',admin:false,date,session:1,products,invoiceId:'FM-1-1',invoiceNumber:'LOCAL'});return {account:latest,sequence:1};
 });
 assert.equal(p.ui.state.queue.length,1);assert.ok(p.ui.state.syncConflict);assert.equal(p.ui.state.queue[0].command.request_id,c.request_id);
 await p.ui.action('reviewConflict');assert.match(p.document.querySelector('#modalBody').textContent,/OWNER CONFIRMED NAME/);
 await p.ui.action('retryConflict');assert.equal(p.ui.state.queue.length,0);assert.equal(p.ui.state.syncConflict,undefined);assert.equal(p.ui.state.data.accounts[id].name,owner.name);assert.equal(p.ui.state.data.accounts[id].receipts.length,1);
 assert.ok(p.calls.filter(x=>x.body?.command).every(x=>x.body.command.request_id===c.request_id));
});
