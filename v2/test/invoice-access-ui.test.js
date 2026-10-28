import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {signInMarkup,pinExpired,hasDraftWork} from '../public/invoicing/access-ui.js';
import {applyInvoiceCommand,openingAccount,accountSummary,parseAmount,parseQuantity} from '../src/invoice-domain.js';
const html=await readFile(new URL('../public/invoicing/index.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/invoicing/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('void start();','globalThis.ui={ready:start(),get state(){return state;},action,refresh,render};');
const date=new Date(Date.now()+7200000).toISOString().slice(0,10),phone='synthetic-phone-1234567890',id='9001001';
const products=[{code:'P1',name:'SYNTHETIC PRODUCT',unit:'bag',active:true,available:true,price_cents:10000}];
const store={id,name:'SYNTHETIC PRIVATE SHOP',stop:1,terms:7,opening:{customer_id:id,complete:true,balance_cents:0,invoices:[],drafts:[],generated_at:new Date().toISOString()}};
const session={id:1,actor:'tapiz',device:phone,date,status:'active',sequence:0,products};
const data=()=>({username:'tapiz',display_name:'Tapiz',admin:false,rep_phone_id:phone,rep_session_expires:Date.now()+43200000,date,route:'R03',route_name:'SYNTHETIC ROUTE',available_routes:[{code:'R03',name:'SYNTHETIC ROUTE'}],stores:[store],accounts:{[id]:openingAccount(store)},products,session:structuredClone(session)});
const saved=()=>({localVersion:1,device:phone,data:data(),selected:id,queue:[],drafts:{},sequence:0});
class FormDataForDOM{constructor(form){this.values=[];for(const e of form.querySelectorAll('[name]'))if(e.type!=='checkbox'||e.checked)this.values.push([e.name,e.value??e.querySelector('option')?.value??'']);}get(name){return this.values.find(([n])=>n===name)?.[1]??null;}getAll(name){return this.values.filter(([n])=>n===name).map(([,v])=>v);}has(name){return this.values.some(([n])=>n===name);}}
async function page(initial,respond,{hash='',online=true}={}){
 const {document}=parseHTML(html),events=new Map(),calls=[],writes=[],replaced=[];let version=initial?.localVersion??0;
 document.addEventListener=(event,handler)=>events.set(event,handler);const modal=document.querySelector('#modal');modal.close=()=>{modal.open=false;};modal.showModal=()=>{modal.open=true;};
 const location={hash,pathname:'/invoicing/',search:'?v=0.24.0',origin:'https://example.test'};
 const context={document,window:{addEventListener(){},print(){}},location,history:{replaceState:(...args)=>replaced.push(args)},navigator:{onLine:online},URL,URLSearchParams,crypto,TextEncoder,structuredClone,Date,Intl,setTimeout,clearTimeout,setInterval(){},FormData:FormDataForDOM,installInputSelection(){},signInMarkup,pinExpired,hasDraftWork,applyInvoiceCommand,accountSummary,parseAmount,parseQuantity,
 load:async()=>structuredClone(initial),save:async(value,expected)=>{assert.equal(expected,version);writes.push(structuredClone(value));return ++version;},
 fetch:async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,body});const r=await respond(path,body);return {ok:r.status===undefined||r.status===200,status:r.status??200,json:async()=>r.data??r};}};
 vm.createContext(context);vm.runInContext(source,context);await context.ui.ready;
 async function submit(id,fields){const f=document.querySelector('#'+id);assert.ok(f,'form '+id+' is visible');for(const [name,value] of Object.entries(fields)){const input=f.querySelector('[name='+name+']');assert.ok(input);input.value=value;}await events.get('submit')({target:f,preventDefault(){}});}
 return {document,calls,writes,replaced,submit,ui:context.ui};
}
test('registered rep gets a numeric PIN form, and re-login syncs the original queued transaction exactly once',async()=>{
 const initial=saved();initial.needsAuth=true;initial.data.rep_session_expires=Date.now()-1;
 const command={action:'issue',customer_id:id,revision:0,request_id:crypto.randomUUID(),captured_at:new Date().toISOString(),lines:[{code:'P1',qty:1000,checked:true}],cash:10000,shop2shop:0,received:true};
 const after=applyInvoiceCommand(initial.data.accounts[id],command,{actor:'tapiz',admin:false,date,session:1,products,invoiceId:'FM-1-1',invoiceNumber:'SYNTHETIC-INVOICE'});
 const pending={route:'R03',device:phone,session_id:1,sequence:1,command};initial.queue=[pending];initial.sequence=1;initial.data.accounts[id]=after;
 const pageData=data();pageData.accounts[id]=after;pageData.session.sequence=1;
 const p=await page(initial,async(path,body)=>{
  if(path.endsWith('/access/status'))return {registered:true,username:'tapiz',name:'Tapiz',phone_id:phone};
  if(path.endsWith('/access/login')){assert.equal(body.pin,'704862');return {username:'tapiz',phone_id:phone,expires:Date.now()+43200000};}
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
test('valid signed-in route can cold-start offline; locking waits for a successful sync',async()=>{
 const initial=saved();const p=await page(initial,async()=>{throw Error('Offline');},{online:false});
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
 const p=await page(initial,async path=>path.endsWith('/access/status')?{registered:true,name:'Musa',phone_id:'different-phone'}:{username:'mosa',phone_id:'different-phone',expires:Date.now()+43200000});
 await p.submit('repLogin',{pin:'704862'});assert.match(p.document.querySelector('#error').textContent,/Sign in as tapiz/);assert.equal(p.ui.state.queue.length,1);assert.equal(p.ui.state.data.username,'tapiz');assert.equal(p.writes.length,0);
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
 await events.get('click')({target:document.querySelector('#copy')});assert.equal(copied,'https://example.test/invoicing/?v=0.24.0#setup=1234abcd5678ef90');
 assert.equal(calls.filter(c=>c.body?.action==='create').length,1);assert.equal(document.querySelector('#error').hidden,true);
});
