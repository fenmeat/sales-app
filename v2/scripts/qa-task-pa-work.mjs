// Exercise the shipped task form, worker, D1 and delayed inbox on an isolated database.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {saveTask} from '../src/tasks-api.js';
import {readPaReport} from '../src/pa-report-api.js';

const playwright=await import(process.env.TEXT_PLAYWRIGHT_MODULE||'playwright');
const engine=playwright[process.env.TEXT_BROWSER||'chromium'];
const assetRoot=resolve('public');
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,platform:'browser',format:'esm',write:false});
const key='local-fixture-'.repeat(4);
const bindings={APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key})};
const mf=new Miniflare(convertV4MiniflareOptions({
 name:'task-work-test',modules:true,script:bundle.outputFiles[0].text,
 compatibilityDate:'2026-09-30',d1Databases:{DB:'isolated'},bindings,
 outboundService:()=>{throw Error('External connection in a local test');}
}));
const env={...bindings,DB:await mf.getD1Database('DB')};
const service=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+service.address().port);
  if(url.pathname.startsWith('/api/')){
   let raw='';for await(const chunk of req)raw+=chunk;
   const reply=await mf.dispatchFetch(url.href,{
    method:req.method,headers:{origin:url.origin,'Content-Type':'application/json',Cookie:req.headers.cookie||''},
    body:req.method==='POST'?raw:undefined
   });
   res.writeHead(reply.status,Object.fromEntries(reply.headers));
   return res.end(Buffer.from(await reply.arrayBuffer()));
  }
  const file=resolve(assetRoot,'.'+(url.pathname==='/tasks'?'/tasks.html':url.pathname));
  if(!file.startsWith(assetRoot+'/')){res.writeHead(404);return res.end();}
  const bytes=await readFile(file);
  const type={'.js':'application/javascript','.html':'text/html','.css':'text/css'}[extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type});res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>service.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+service.address().port;
let browser;
try{
 browser=await engine.launch({headless:true,...(process.env.QA_BROWSER_EXECUTABLE?{executablePath:process.env.QA_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:820,height:1180},hasTouch:true});
 const login=await page.request.post(origin+'/api/login',{data:{username:'alex',key},headers:{Origin:origin}});
 assert.equal(login.status(),200);
 const pair=login.headers()['set-cookie'].split(';')[0],cut=pair.indexOf('=');
 await page.context().addCookies([{name:pair.slice(0,cut),value:pair.slice(cut+1),url:origin}]);
 const id=crypto.randomUUID();
 const create=await page.request.post(origin+'/api/tasks',{headers:{Origin:origin},data:{
  task_id:id,request_id:crypto.randomUUID(),revision:0,action:'create',
  data:{title:'Plaaslike proef',assigned_to:'alex',task_type:'reminder',due_date:'2099-11-17'}
 }});
 assert.equal(create.status(),200,await create.text());
 await page.goto(origin+'/tasks?task='+id);
 await page.locator('#ask-pa').click();
 await page.locator('textarea[name=note]').fill('Bereken hoeveel rolle ons nodig het.');
 await page.getByRole('button',{name:'Stuur aan PA',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('dialog').open);
 const actor={username:'alex',via:'pa'};
 const queue=await readPaReport(env,actor,{resource:'summary',id:'task-work'});
 assert.equal(queue.items.length,1);
 const job=queue.items[0],claim=crypto.randomUUID();
 assert.equal(job.task_id,id);
 const claimed=await saveTask(env,actor,{task_id:id,revision:job.revision,request_id:claim,action:'pa_claim',work_id:job.work.id});
 await saveTask(env,actor,{
  task_id:id,revision:claimed.task.revision,request_id:crypto.randomUUID(),action:'pa_result',
  work_id:job.work.id,claim_id:claim,status:'answered',answer:'Ons het twee rolle nodig.',
  next_action:'Lees die dokument.',links:[{label:'Proefverslag',url:'https://example.com/report.pdf'}]
 });

 // A user can open the task before the separate inbox request finishes.
 let releaseInbox;
 const inboxGate=new Promise(r=>{releaseInbox=r;});
 await page.route('**/api/tasks/inbox',async route=>{await inboxGate;await route.continue();});
 await page.reload();
 await page.getByText('Ons het twee rolle nodig.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Proefverslag'}).getAttribute('href'),'https://example.com/report.pdf');
 const inboxReply=page.waitForResponse(r=>r.url().endsWith('/api/tasks/inbox'));
 releaseInbox();
 const payload=await (await inboxReply).json();
 assert.equal(payload.notifications.find(n=>n.kind==='pa_result')?.task_id,id);
 await page.locator('dialog [data-close]').last().click();
 await page.locator('.notifications summary').click();
 await page.getByRole('button',{name:/Plaaslike proef.*PA se antwoord is gereed/}).click();
 await page.getByText('Ons het twee rolle nodig.',{exact:true}).waitFor();
 console.log('Task instruction, original answer, document and delayed inbox verified.');
}finally{
 await browser?.close();await new Promise(r=>service.close(r));await mf.dispose();
}
