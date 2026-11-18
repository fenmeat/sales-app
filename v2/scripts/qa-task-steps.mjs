// Browser acceptance against isolated Worker/D1 only. Never contacts staff.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const {chromium,webkit,devices}=await import(process.env.TEXT_PLAYWRIGHT_MODULE||'playwright');
const folder='/tmp/fenmeat-task-steps';await mkdir(folder,{recursive:true});
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
try{for(const [name,engine,options] of [['chromium-desktop',chromium,{viewport:{width:1440,height:1000}}],['chromium-android',chromium,devices['Pixel 7']],['webkit-iphone',webkit,devices['iPhone 13']],['webkit-ipad',webkit,devices['iPad Pro 11']]]){
 if(process.env.TEXT_BROWSER&&!name.startsWith(process.env.TEXT_BROWSER))continue;
 const login=await api('/api/login',{username:'alex',key:keys.alex});cookie=login.headers.get('set-cookie').split(';')[0];
 if(!seeded){await api('/api/recipes',{revision:0,request_id:crypto.randomUUID(),reason:'Synthetic chooser fixture',register:{schema_version:1,notes:'Synthetic',materials:[{id:'RM01',name:'Synthetic material',unit:'kg',supplier:'Crown',pack_qty:20,procure:true,notes:'',source:'Synthetic',price:{amount:null,status:'unknown',date:null,valid_until:null,source:''},stock:{qty:null,date:null,reserve:null,incoming:[],source:''}}],recipes:[],packaging:[]}});seeded=true;}
 const actor={'chromium-desktop':'alex','chromium-android':'xavier','webkit-iphone':'xalinda','webkit-ipad':'alinda'}[name];
 const session=await api('/api/login',{username:actor,key:keys[actor]});cookie=session.headers.get('set-cookie').split(';')[0];
 const browser=await engine.launch({headless:true,...(engine===chromium&&process.env.TASKS_BROWSER_EXECUTABLE?{executablePath:process.env.TASKS_BROWSER_EXECUTABLE}:{})});try{
 const {defaultBrowserType,...device}=options,context=await browser.newContext({...device,timezoneId:'Africa/Johannesburg'});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/tasks');await page.locator('#pa-new').click();
 await page.locator('dialog[open] select[name=task_type]').waitFor();
 assert.deepEqual(await page.locator('[name=task_type] option').allTextContents(),['Gewone taak','Taak met stappe']);assert.equal(await page.locator('[name=supplier]').isVisible(),false);
 await page.screenshot({path:folder+'/'+name+'-new-task.png'});
 await page.locator('#choose-stocktake').click();assert.equal(await page.locator('[name=task_type]').isVisible(),false);assert.equal(await page.locator('[name=repeat]').isVisible(),false);assert.equal(await page.locator('[data-scan]').isVisible(),true);
 await page.locator('[name=title]').fill('Synthetic count '+name);await page.locator('[name=supplier]').fill('Crown');await page.locator('[name=due_date]').fill('2099-11-23');
 await page.locator('dialog').evaluate(e=>e.scrollTop=0);await page.screenshot({path:folder+'/'+name+'-stocktake.png'});
 await page.getByRole('button',{name:'Stoor',exact:true}).click();await page.waitForSelector('dialog:not([open])',{state:'attached'});
 const count=(await api('/api/tasks')).data.tasks.find(t=>t.title==='Synthetic count '+name);assert.equal(count.kind,'stocktake');assert.equal(count.task_type,'legacy');assert.deepEqual(count.required_materials,['RM01']);assert.notEqual(count.status,'Complete');
 const blocked=await mf.dispatchFetch(origin+'/api/tasks',{method:'POST',headers:{origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({task_id:count.id,revision:count.revision,request_id:crypto.randomUUID(),action:'complete'})});assert.equal(blocked.status,400,'Stocktake still requires a saved count');
 await page.locator('#pa-new').click();await page.locator('[name=title]').fill('Synthetic ordinary '+name);await page.locator('[name=repeat]').selectOption('weekly');await page.getByRole('button',{name:'Stoor',exact:true}).click();await page.waitForSelector('dialog:not([open])',{state:'attached'});
 const ordinary=(await api('/api/tasks')).data.tasks.find(t=>t.title==='Synthetic ordinary '+name);assert.equal(ordinary.visibility,'operational');assert.equal(ordinary.kind,'general');assert.equal(ordinary.task_type,'reminder');assert.equal(ordinary.repeat,'weekly');
 await page.locator('#pa-new').click();await page.locator('[name=title]').fill('Synthetic workflow '+name);await page.locator('[name=assigned_to]').selectOption('alinda');await page.locator('[name=task_type]').selectOption('workflow');
 for(let i=1;i<5;i++)await page.locator('[data-add-draft]').click();
 const rows=page.locator('.draft-step');assert.equal(await rows.count(),5);assert.deepEqual(errors,[]);
 for(let i=0;i<5;i++){await rows.nth(i).locator('[data-field=description]').fill('Synthetic step '+(i+1));await rows.nth(i).locator('[data-field=assigned_to]').selectOption(['alex','alinda','xavier','xavier','alex'][i]);assert.equal(await rows.nth(i).locator('[data-scan]').count(),1);}
 await rows.nth(3).locator('input[id$="-attachment"]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSynthetic\n%%EOF')});
 await page.locator('#dialog').getByRole('button',{name:'Stoor',exact:true}).click();await page.waitForSelector('#add-step');
 let list=(await api('/api/tasks')).data.tasks,task=list.find(t=>t.title==='Synthetic workflow '+name);assert.equal(task.steps.length,5);assert.equal(task.steps[3].attachments.length,1);
 const refresh=async()=>{task=(await api('/api/tasks?id='+task.id)).data.task;};
 const open=async()=>{await page.goto(origin+'/tasks?task='+task.id);await page.waitForSelector('#add-step');};
 await page.locator('[data-step-delegate="'+task.steps[1].id+'"]').click();await page.locator('[name=assigned_to]').selectOption('xavier');await page.locator('[name=due_date]').fill('2099-11-23');assert.equal(await page.locator('[data-scan]').count(),1);await page.getByRole('button',{name:'Stoor stap',exact:true}).click();await page.waitForSelector('dialog:not([open])',{state:'attached'});await refresh();assert.equal(task.steps[1].assigned_to,'xavier');
 for(let i=0;i<5;i++){await open();await page.locator('[data-step-complete="'+task.steps[i].id+'"]').click();await page.getByRole('button',{name:'Stoor voltooiing',exact:true}).click();await page.waitForSelector('dialog:not([open])',{state:'attached'});await refresh();if(i===2)assert.equal(task.progress.percent,60);}
 assert.equal(task.status,'Pending');assert.equal(task.ready_for_approval,true);await open();assert.match(await page.locator('#dialog').textContent(),/Wag vir goedkeuring/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await page.locator('.step .actions button').evaluateAll(buttons=>buttons.every(b=>b.getBoundingClientRect().width>=120)),'Step buttons must stay readable on narrow screens');await page.screenshot({path:folder+'/'+name+'.png'});
 await page.locator('#approve-workflow').click();await page.getByRole('button',{name:'Stoor',exact:true}).click();await page.waitForSelector('dialog:not([open])',{state:'attached'});await refresh();assert.equal(task.status,'Complete');assert.equal(task.approval.by,actor);assert.deepEqual(errors,[]);
 console.log('PASS '+name+': simplified task chooser, ordinary repeat, stocktake saved-count gate, five steps, delegation, PDF, progress, approval and responsive width');
 }finally{await browser.close();}
}}finally{await new Promise(r=>server.close(r));await mf.dispose();}
