// Shipped UI, isolated HTTP fixtures, no live accounts or business writes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium,webkit,devices}=await import(process.env.TEXT_PLAYWRIGHT_MODULE||'playwright');
const publicDir=resolve('public'),folder='/tmp/fenmeat-pa-conversations';await mkdir(folder,{recursive:true});
let stored,posts,loseResponse;
const base={id:'TSK-00991',subject_key:'TSK-00991',subject_hash:'fixture-source',scope:'private',title:'FSA — synthetic conversation',status:'Pending',assigned_to:'alex',next_action:'Vra ’n antwoorddatum.',review_date:'2026-11-12',source_url:'https://example.com/source'};
const history=()=>Array.from({length:4},(_,n)=>({id:'fixture-question-'+n,subject_key:base.id,source_task_ids:[base.id],subject_hash:base.subject_hash,actor:'alex',created_at:'2026-11-12T12:0'+n+':00Z',action:'respond',note:'Oorspronklike vraag '+n,answer_status:'answered',status:'answered',answered_at:'2026-11-12T13:0'+n+':00Z',outcome:n===0?'Vorige ondersoeknota':'',answer:{text:'PA se volledige antwoord '+n,recommendation:'Vra wanneer terugvoer volg.',next_action:base.next_action,responsible:'alex',follow_up_date:'2026-11-13',task_status:'Scheduled'}}));
const pa=()=>({private_report:true,register_revision:1,source_at:'2026-11-12T12:00:00Z',history:[],alerts:[],reminders:[],users:['alex'],feedback:[...history(),...stored.values()].reverse(),rows:[base]});
const app={username:'alex',admin:true,today:'2026-11-12',users:['alex'],suppliers:[],tasks:[],notifications:[],next_offset:null};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'){
   assert.equal(url.pathname,'/api/pa-report/feedback');let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);posts.push(b);
   const old=stored.get(b.request_id);if(old)assert.equal(old.note,b.note);else stored.set(b.request_id,{...b,id:b.request_id,actor:'alex',created_at:new Date().toISOString(),status:'pending',answer_status:'awaiting_answer'});
   if(loseResponse){req.socket.destroy();return;}return res.end(JSON.stringify({saved:true,replayed:!!old}));
  }
  return res.end(JSON.stringify(url.pathname==='/api/pa-report'?pa():url.pathname==='/api/pa-report/conversation'?{subject:base,feedback:[...history(),...stored.values()],next_offset:null}:app));
 }
 const file=resolve(publicDir,'.'+(url.pathname==='/tasks'?'/tasks.html':url.pathname));if(!file.startsWith(publicDir+'/')){res.writeHead(404);return res.end();}
 try{const bytes=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{for(const [name,engine,options] of [['chromium-phone',chromium,devices['Pixel 7']],['webkit-iphone',webkit,devices['iPhone 13']],['webkit-ipad',webkit,devices['iPad Pro 11']]]){
 if(process.env.TEXT_BROWSER&&!name.startsWith(process.env.TEXT_BROWSER))continue;
 stored=new Map();posts=[];loseResponse=false;const browser=await engine.launch({headless:true});
 try{const {defaultBrowserType,...device}=options,context=await browser.newContext({...device,timezoneId:'Africa/Johannesburg'});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+'/tasks');await page.locator('[data-pa-action="respond"]').click();
 assert.equal(await page.locator('#pa-conversation .pa-message').count(),4);assert.ok((await page.locator('#pa-conversation').textContent()).includes('PA se volledige antwoord 3'));
 const note=page.getByLabel('Jou antwoord',{exact:true});await note.fill('Skryf vir my die opvolg-e-pos.');
 await context.setOffline(true);await page.getByRole('button',{name:'Stoor antwoord',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog .error').textContent.length>0);
 assert.equal(await note.inputValue(),'Skryf vir my die opvolg-e-pos.');await context.setOffline(false);await page.getByRole('button',{name:'Kanselleer',exact:true}).click();
 await page.reload();await page.locator('[data-pa-action="respond"]').click();assert.equal(await note.inputValue(),'Skryf vir my die opvolg-e-pos.');
 loseResponse=true;await page.getByRole('button',{name:'Stoor antwoord',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog .error').textContent.length>0);
 assert.equal(stored.size,1);const original=posts[0];await page.getByRole('button',{name:'Kanselleer',exact:true}).click();await page.reload();await page.locator('[data-pa-action="respond"]').click();
 loseResponse=false;await page.getByRole('button',{name:'Stoor antwoord',exact:true}).click();await page.waitForSelector('dialog:not([open])',{state:'attached'});assert.equal(stored.size,1);assert.deepEqual(posts.at(-1),original);assert.equal(original.reply_to,'fixture-question-3');
 assert.ok((await page.locator('#app').textContent()).includes('PA se antwoord is nog uitstaande'));
 await page.locator('[data-pa-action="respond"]').click();assert.equal(await note.inputValue(),'');
 await page.screenshot({path:folder+'/'+name+'.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS '+name+': full conversation, offline draft, reload, lost response, same-ID retry, follow-up linkage and no duplicate question');
 }finally{await browser.close();}
}}finally{await new Promise(r=>server.close(r));}
