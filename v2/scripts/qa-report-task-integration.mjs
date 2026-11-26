import {savePaReport} from '../src/pa-report-api.js';
// Browser acceptance against isolated Worker/D1 only. Never contacts staff.
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const {chromium,webkit,devices}=await import(process.env.TEXT_PLAYWRIGHT_MODULE||'playwright');
const folder='/tmp/fenmeat-report-tasks';await mkdir(folder,{recursive:true});
const publicDir=resolve('public'),output=await build({entryPoints:['src/worker.js'],bundle:true,format:'esm',platform:'browser',write:false});
const keys=Object.fromEntries(['alex','alinda','xavier','xalinda'].map(u=>[u,'synthetic-'+u+'-'.repeat(40)]));
const mf=new Miniflare(convertV4MiniflareOptions({name:'steps-qa',modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'steps-qa'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(keys)},outboundService:()=>{throw Error('External request blocked');}}));
let cookie='',port,seeded=false;
const api=async(path,body)=>{const r=await mf.dispatchFetch('http://127.0.0.1:'+port+path,{method:body?'POST':'GET',headers:{origin:'http://127.0.0.1:'+port,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return {data,headers:r.headers};};
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1:'+port);res.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/')){let raw='';for await(const chunk of req)raw+=chunk;const r=await mf.dispatchFetch(url.href,{method:req.method,headers:{origin:url.origin,'Content-Type':'application/json',Cookie:cookie},body:req.method==='POST'?raw:undefined});res.writeHead(r.status,Object.fromEntries(r.headers));return res.end(Buffer.from(await r.arrayBuffer()));}
 const file=resolve(publicDir,'.'+(url.pathname==='/tasks'?'/tasks.html':url.pathname));if(!file.startsWith(publicDir+'/')){res.writeHead(404);return res.end();}const bytes=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(bytes);
 }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;const origin='http://127.0.0.1:'+port;

const db=await mf.getD1Database('DB'),env={DB:db,APP_ACCESS_KEYS:JSON.stringify(keys)},source='https://docs.google.com/spreadsheets/d/synthetic/edit';
const publish=(operation,data,revision=0)=>savePaReport(env,{username:'alex',via:'pa'},{operation,data,revision,request_id:crypto.randomUUID(),reason:'Synthetic report integration acceptance'});
try{
 const ids=['TSK-00991','TSK-00992'],titles=['Tandartsstaat — Voorbaai Dental Studio','PathCare — Bloedtoetse'];
 await publish('register',{source_at:new Date().toISOString(),source_url:source,rows:ids.map((id,i)=>({id,scope:'private',area:'Personal',title:titles[i],assigned_to:'alex',status:'Pending',priority:'Normal',next_action:'Bevestig die volgende stap',app_task_id:'private-'+id,source_url:source}))});
 for(const [i,id] of ids.entries())await publish('private_task',{pa_task_id:id,action:'create',data:{title:titles[i],task_type:'workflow',require_final_approval:true,details:'Private synthetic source',reminder_mode:'off',steps:[{id:'source',description:'Lees die oorspronklike antwoord',assigned_to:'pa',status:'Pending'},{id:'confirm',description:'Bevestig die volgende stap',assigned_to:'alex',status:'Pending',dependencies:['source']}]}});
 await publish('report',{date:new Date().toISOString().slice(0,10),source_at:new Date().toISOString(),source_url:source,register_revision:1,sections:['emails','activity','tasks','tomorrow','rabbi'].map((id,n)=>({id,title:id,items:[{id:'item-'+n,title:n?'Inligting':'Tandartsstaat en PathCare',text:'Synthetic verified report',requires_action:n===0,pa_task_ids:n===0?ids:[]}]}))});
 for(const [name,engine,options] of [['chromium-desktop',chromium,{viewport:{width:1440,height:1000}}],['chromium-android',chromium,devices['Pixel 7']],['webkit-iphone',webkit,devices['iPhone 13']],['webkit-ipad',webkit,devices['iPad Pro 11']]]){
  if(process.env.TEXT_BROWSER&&!name.startsWith(process.env.TEXT_BROWSER))continue;
  const login=await api('/api/login',{username:'alex',key:keys.alex});cookie=login.headers.get('set-cookie').split(';')[0];
  const browser=await engine.launch({headless:true,...(engine===chromium&&process.env.TASKS_BROWSER_EXECUTABLE?{executablePath:process.env.TASKS_BROWSER_EXECUTABLE}:{})});
  try{
   const {defaultBrowserType,...device}=options,context=await browser.newContext({...device,timezoneId:'Africa/Johannesburg'});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/tasks?view=report&scope=fenmeat&status=closed');
   for(const [i,id] of ids.entries()){
    await page.locator('[data-open-case="'+id+'"]').click();await page.locator('#pa-task-conversation').waitFor();
    assert.equal(await page.locator('#dialog h2').first().textContent(),titles[i]);
    assert.ok((await page.locator('#dialog').textContent()).includes('Wat gaan aan?'));
    assert.ok(await page.locator('#dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+2));
    await page.screenshot({path:folder+'/'+name+'-'+i+'.png'});
    await page.locator('#pa-task-conversation').click();await page.locator('#task-conversation').waitFor();
    await page.locator('textarea[name=note]').fill('Report reply '+name+' '+i);
    await page.getByRole('button',{name:'Stuur',exact:true}).click();await page.locator('[data-conversation-status]').getByText('Boodskap gestoor. PA sal antwoord ná verwerking.',{exact:true}).waitFor();
    await page.goto(origin+'/tasks?task='+id+'&scope=fenmeat&status=closed');await page.locator('#pa-task-conversation').click();
    await page.locator('#task-conversation').getByText('Report reply '+name+' '+i,{exact:true}).waitFor();
    await page.locator('textarea[name=note]').fill('Tasks reply '+name+' '+i);await page.getByRole('button',{name:'Stuur',exact:true}).click();await page.locator('[data-conversation-status]').getByText('Boodskap gestoor. PA sal antwoord ná verwerking.',{exact:true}).waitFor();
    await page.goto(origin+'/tasks?view=report');await page.locator('[data-open-case="'+id+'"]').click();await page.locator('#pa-task-conversation').click();await page.locator('#task-conversation').getByText('Tasks reply '+name+' '+i,{exact:true}).waitFor();
    await page.locator('[data-close]').last().click();
   }
   await page.goto(origin+'/tasks?scope=private&status=all');await page.locator('#pa-search').fill('Voorbaai');await page.locator('[data-case="TSK-00991"]').waitFor();
   assert.ok(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[]);
   console.log('PASS '+name+': direct opening through filters; both private tasks; same conversation both ways; Deli steps; no horizontal overflow');
  }finally{await browser.close();}
 }
 for(const user of ['alinda','xavier','xalinda']){const login=await api('/api/login',{username:user,key:keys[user]});cookie=login.headers.get('set-cookie').split(';')[0];assert.doesNotMatch(JSON.stringify((await api('/api/tasks/workspace?scope=all&status=all')).data),/Tandartsstaat|PathCare|Private synthetic/);}
 console.log('PASS authorised scope excludes both private cases for all other managers');
}finally{await mf.dispose();await new Promise(r=>server.close(r));}
