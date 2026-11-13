// Real shipped browser forms against an isolated Worker/D1 database. No live writes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const {chromium,webkit,devices}=await import(process.env.TEXT_PLAYWRIGHT_MODULE||'playwright');
const folder='/tmp/fenmeat-task-editing';await mkdir(folder,{recursive:true});
const publicDir=resolve('public'),output=await build({entryPoints:['src/worker.js'],bundle:true,format:'esm',platform:'browser',write:false});
const keys={alex:'synthetic-alex-'.repeat(5),alinda:'synthetic-alinda-'.repeat(5),xalinda:'synthetic-xalinda-'.repeat(5)};
const mf=new Miniflare(convertV4MiniflareOptions({name:'editing-qa',modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'editing-qa'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(keys)},outboundService:()=>{throw Error('External request blocked');}}));
let cookie='',port,taskId,pa,revision=0;
const api=async(path,body)=>{const r=await mf.dispatchFetch('http://127.0.0.1:'+port+path,{method:body?'POST':'GET',headers:{origin:'http://127.0.0.1:'+port,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return {data,headers:r.headers};};
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1:'+port);res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/api/pa-report'||url.pathname==='/api/pa-report/conversation'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(url.pathname.endsWith('conversation')?{subject:pa.rows[0],feedback:[],next_offset:null}:pa));}
 if(url.pathname.startsWith('/api/')){let raw='';for await(const chunk of req)raw+=chunk;const r=await mf.dispatchFetch(url.href,{method:req.method,headers:{origin:url.origin,'Content-Type':'application/json',Cookie:cookie},body:req.method==='POST'?raw:undefined});res.writeHead(r.status,{'Content-Type':'application/json'});return res.end(await r.text());}
 const file=resolve(publicDir,'.'+(url.pathname==='/tasks'?'/tasks.html':url.pathname));if(!file.startsWith(publicDir+'/')){res.writeHead(404);return res.end();}const bytes=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(bytes);
 }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;const origin='http://127.0.0.1:'+port;
try{for(const [name,engine,options] of [['chromium-desktop',chromium,{viewport:{width:1440,height:1000}}],['chromium-phone',chromium,devices['Pixel 7']],['webkit-iphone',webkit,devices['iPhone 13']],['webkit-ipad',webkit,devices['iPad Pro 11']]]){
 if(process.env.TEXT_BROWSER&&!name.startsWith(process.env.TEXT_BROWSER))continue;
 const paId='TSK-0098'+(++revision);cookie='';const login=await api('/api/login',{username:'alex',key:keys.alex});cookie=login.headers.get('set-cookie').split(';')[0];taskId=crypto.randomUUID();
 const created=await api('/api/tasks',{task_id:taskId,revision:0,request_id:crypto.randomUUID(),action:'create',data:{title:'Synthetic original task',details:'Die oorspronklike sin bly behoue.',assigned_to:'alinda',kind:'general',pa_task_id:paId,review_date:'2099-11-13',requires_evidence:true,document_url:'https://example.com/document.pdf'}});
 const row={id:paId,subject_key:paId,subject_hash:'fixture',scope:'fenmeat',title:'Synthetic original task',status:'Waiting',assigned_to:'alinda',priority:'High',next_action:'Correct the specific task evidence setting.',review_date:'2099-11-13',app_task_id:taskId};
 pa={private_report:true,register_revision:1,source_at:new Date().toISOString(),rows:[row],feedback:[],alerts:[],reminders:[],history:[],users:Object.keys(keys),report:{date:'2099-11-13',source_at:new Date().toISOString(),task_summary:{open:1},source_url:'https://example.com/report',coverage:'Synthetic fixture only',sections:[{id:'tasks',title:'Tasks',items:[{id:'one',subject_key:'report-2099-11-13:one',title:'Follow up',text:'Open the existing task.',pa_task_ids:[row.id],links:[]}]}]}};
 const browser=await engine.launch({headless:true,...(process.env.QA_BROWSER_EXECUTABLE?{executablePath:process.env.QA_BROWSER_EXECUTABLE}: {})});try{
 const {defaultBrowserType,...device}=options,context=await browser.newContext({...device,timezoneId:'Africa/Johannesburg'});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+'/tasks?view=report');await page.locator('[data-edit-task="'+taskId+'"]').first().click();
 assert.equal(await page.getByLabel('Taaktitel',{exact:true}).inputValue(),'Synthetic original task');assert.equal(await page.getByLabel('Sperdatum / teldatum',{exact:true}).inputValue(),'');
 const description=page.locator('textarea[name=details]');await description.click();assert.equal(await description.evaluate(e=>e.selectionEnd-e.selectionStart),0);
 await page.getByLabel('Vra foto’s, PDF’s of ’n bewysstuk wanneer dit klaar is',{exact:true}).uncheck();await page.locator('[name=edit_reason]').fill('Owner accepts the confirmation for this synthetic task.');
 await page.getByRole('button',{name:'Stoor taak',exact:true}).click();await page.waitForSelector('#history');
 let saved=(await api('/api/tasks?id='+taskId)).data.task;assert.equal(saved.requires_evidence,false);assert.equal(saved.revision,2);assert.equal(saved.due_date,'');assert.equal(saved.document_url,'https://example.com/document.pdf');
 await page.locator('#history').click();await page.waitForSelector('.task-changes');assert.match(await page.locator('#history-content').textContent(),/Voor: Ja.*Na: Nee/s);
 await page.locator('#complete').click();await page.locator('#dialog').getByRole('button',{name:'Merk klaar',exact:true}).click();await page.waitForSelector('dialog:not([open])',{state:'attached'});
 saved=(await api('/api/tasks?id='+taskId)).data.task;assert.equal(saved.status,'Complete');assert.equal(saved.completion.attachments.length,0);
 await page.locator('#pa-status').selectOption('closed');await page.locator('[data-edit-task="'+taskId+'"]').first().click();assert.equal(await page.getByLabel('Taaktitel',{exact:true}).inputValue(),saved.title);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:folder+'/'+name+'.png'});assert.deepEqual(errors,[]);
 console.log('PASS '+name+': Daily Report -> original editor -> real Worker/D1 save/read -> before/after audit -> no-file completion -> completed edit, text caret and mobile width');
 }finally{await browser.close();}
}}finally{await new Promise(r=>server.close(r));await mf.dispose();}
