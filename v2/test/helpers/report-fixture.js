import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {today} from '../../src/domain.js';
import {allowedPushEndpoint,queueTaskReminders,flushTaskPush} from '../../src/tasks-push.js';
import {currentTaskNotification} from '../../src/tasks-api.js';
const origin='https://tasks-test.example';
export async function fixture(t){
 const output=await build({entryPoints:[new URL('../../src/worker.js',import.meta.url).pathname],bundle:true,format:'esm',platform:'browser',write:false});
 const keys=Object.fromEntries(['alex','alinda','xalinda','xavier','tapiz'].map(u=>[u,'synthetic-'+u+'-'.repeat(40)]));
 const mf=new Miniflare(convertV4MiniflareOptions({name:'tasks-test',modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'tasks-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(keys)},outboundService:()=>{throw Error('No external services in task tests');}}));t.after(()=>mf.dispose());
 const cookies={};async function call(user,path,body,headers={}){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookies[user]??'',...headers},body:body?JSON.stringify(body):undefined});const data=await r.json();return {status:r.status,data,headers:r.headers};}
 for(const username of Object.keys(keys)){const r=await call(username,'/api/login',{username,key:keys[username]});assert.equal(r.status,200);cookies[username]=r.headers.get('set-cookie').split(';')[0];}
 const task=(data={})=>({task_id:crypto.randomUUID(),request_id:crypto.randomUUID(),revision:0,action:'create',data:{title:'Synthetic review',assigned_to:'xalinda',review_date:today(),...data}});
 return {mf,call,task,db:await mf.getD1Database('DB')};
}
