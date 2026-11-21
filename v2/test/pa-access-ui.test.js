import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('Connection UI logs in the selected admin, displays the real identity and switches without sharing credentials',async()=>{
 const elements=Object.fromEntries(['message','sign-in','signed-in','current-user','approve','username','key','login-form','switch-account'].map(id=>[id,{hidden:false,disabled:false,textContent:'',value:''}]));
 const requests=[];let signedIn=null;
 const context={document:{getElementById:id=>elements[id]??null},fetch:async(path,options)=>{
  const body=options.body?JSON.parse(options.body):null;requests.push({path,body});
  if(path==='/api/login'){signedIn=body.username;return {ok:true,json:async()=>({username:signedIn})};}
  if(path==='/api/logout'){signedIn=null;return {ok:true,json:async()=>({ok:true})};}
  assert.equal(path,'/api/pa/connections');return {ok:!!signedIn,json:async()=>signedIn?{username:signedIn,grants:[]}:{error:'Sign in'}};
 }};
 vm.runInNewContext(readFileSync(new URL('../public/pa-access.js',import.meta.url),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elements.approve.disabled,true);const button={disabled:false};
 for(const username of ['alinda','alex']){
  elements.username.value=username;elements.key.value='synthetic-not-real-credential';
  await elements['login-form'].onsubmit({preventDefault(){},currentTarget:{querySelector:()=>button}});
  assert.equal(requests.filter(r=>r.path==='/api/login').at(-1).body.username,username);
  assert.equal(elements.key.value,'');assert.equal(elements.approve.disabled,false);assert.equal(elements['sign-in'].hidden,true);
  assert.equal(elements['current-user'].textContent,'Aangemeld as '+(username==='alinda'?'Alinda':'Alex')+'.');
  await elements['switch-account'].onclick();assert.equal(elements.approve.disabled,true);assert.equal(elements['sign-in'].hidden,false);
 }
});
