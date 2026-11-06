import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {appNavigation} from '../src/auth.js';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/home-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const execute=new (Object.getPrototypeOf(async function(){}).constructor)('document','location','fetch','openAvailability','FormData','AbortSignal',source);
class FormDataForDOM{
  constructor(form){this.form=form;}
  get(name){return this.form.querySelector('[name="'+name+'"]').value;}
}
async function page({username='alex',status=200,search='',hash='',failProducts=false}={}){
  const {document}=parseHTML(html),calls=[],redirects=[],opened=[];
  const location={href:'https://test.example/'+search+hash,search,hash,assign:x=>redirects.push(x),replace:x=>redirects.push(x)};
  const fetch=async(path,options={})=>{
    calls.push({path,...options});let data;
    if(path==='/api/login'){status=200;data={username};}
    else if(path==='/api/logout'){status=401;data={ok:true};}
    else{assert.equal(path,'/api/navigation');data=status===200?{username,sections:appNavigation(username)}:{error:status===401?'Sign in to continue.':'Connection unavailable.'};}
    return {ok:path==='/api/navigation'?status===200:true,status,json:async()=>data};
  };
  await execute(document,location,fetch,async options=>{opened.push(options);if(failProducts)throw Error('Products unavailable. Try again.');},FormDataForDOM,AbortSignal);
  return {document,calls,redirects,opened};
}
test('Home opens real section destinations, keeps Sales separate, and offers Products without loading sales',async()=>{
  const p=await page();
  assert.equal(p.document.querySelector('h1').textContent,'Home');
  assert.equal(p.document.querySelectorAll('.home-tile').length,12);
  assert.equal(p.document.querySelector('a[href="/sales"]').textContent.includes('Sales'),true);
  assert.ok(p.document.querySelector('a[href="/recipes"]'));assert.ok(p.document.querySelector('a[href="/recipes?view=stock"]'));
  assert.ok(p.document.querySelector('a[href="/invoicing/?view=routes"]'));
  assert.doesNotMatch(p.document.body.textContent,/Order Guy|Print current view/);
  assert.deepEqual(p.calls.map(x=>x.path),['/api/navigation']);
  const button=p.document.querySelector('#home-products');await button.onclick();assert.equal(p.opened.length,1);assert.equal(button.disabled,false);
});
test('staff Home includes read-only Recipes, stocktake and Products, while reps see only Invoices and Tasks',async()=>{
  for(const username of ['xavier','xalinda']){
    const p=await page({username});assert.equal(p.document.querySelectorAll('.home-tile').length,9);
    assert.match(p.document.querySelector('a[href="/recipes"]').textContent,/View & print recipes/);
    for(const path of ['/staff','/sales#setup'])assert.equal(p.document.querySelector('a[href="'+path+'"]'),null);
    assert.ok(p.document.querySelector('a[href="/recipes?view=stock"]'));
  }
  for(const username of ['tapiz','mosa','musa']){
    const p=await page({username});assert.equal(p.document.querySelectorAll('.home-tile').length,2);
    assert.ok(p.document.querySelector('a[href="/invoicing/"]'));assert.ok(p.document.querySelector('a[href="/tasks"]'));assert.equal(p.document.querySelector('#home-products'),null);
  }
});
test('expired sessions show sign-in without module data; successful sign-in reaches Home and sign-out clears it',async()=>{
  const p=await page({status:401});assert.equal(p.document.querySelector('.home-grid'),null);
  const form=p.document.querySelector('#home-login');form.querySelector('[name=username]').value='alex';form.querySelector('[name=key]').value='synthetic-test-only';
  await form.onsubmit({target:form,preventDefault(){}});assert.ok(p.document.querySelector('.home-grid'));
  assert.deepEqual(JSON.parse(p.calls.find(x=>x.path==='/api/login').body),{username:'alex',key:'synthetic-test-only'});
  const signOut=p.document.querySelector('#sign-out');await signOut.onclick({currentTarget:signOut});assert.equal(p.document.querySelector('.home-grid'),null);assert.ok(p.document.querySelector('#home-login'));
});
test('connection and Products failures remain visible and retryable',async()=>{
  const offline=await page({status:503});assert.ok(offline.document.querySelector('#home-retry'));assert.match(offline.document.querySelector('main').textContent,/Connection unavailable/);
  const p=await page({failProducts:true}),button=p.document.querySelector('#home-products');await button.onclick();assert.equal(button.disabled,false);assert.match(p.document.querySelector('#notice').textContent,/Products unavailable/);
});
test('existing setup bookmarks and Zoho callback URLs reach Sales with their original context',async()=>{
  for(const options of [{hash:'#setup'},{search:'?zoho=connected'},{search:'?zoho=check_pending',hash:'#setup'}]){
    const p=await page(options);assert.deepEqual(p.redirects,['/sales'+(options.search??'')+(options.hash??'')]);assert.equal(p.calls.length,0);
  }
});
