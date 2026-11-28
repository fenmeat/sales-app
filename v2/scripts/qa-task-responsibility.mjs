const {chromium,webkit,devices}=await import(process.env.TEXT_PLAYWRIGHT_MODULE||'playwright');
import {fixture} from '../test/helpers/report-fixture.js';
import {savePaReport} from '../src/pa-report-api.js';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const after=[];const {call,db}=await fixture({after:fn=>after.push(fn)});
const env={DB:db,APP_ACCESS_KEYS:JSON.stringify({alex:'a'.repeat(40),alinda:'b'.repeat(40),xavier:'c'.repeat(40),xalinda:'d'.repeat(40)})};
const via={username:'alex',via:'pa'},url='https://docs.google.com/spreadsheets/d/example/edit',id='TSK-00990';
const row={id,area:'Fen Meat',scope:'fenmeat',title:'Vergelyk die kwotasies',status:'Pending',assigned_to:'alex',next_action:'Gee die twee kwotasies.',source_url:url,responsibility:{owner:'alex',action:'Heg die twee kwotasies aan.',situation:'Twee verskaffers het verskillende pryse gegee.',version:1}};
await savePaReport(env,via,{operation:'register',revision:0,reason:'Synthetic tablet test',request_id:crypto.randomUUID(),data:{source_at:new Date().toISOString(),source_url:url,rows:[row]}});
const engine=process.env.TEXT_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch({headless:true,...(process.env.QA_BROWSER_EXECUTABLE?{executablePath:process.env.QA_BROWSER_EXECUTABLE}:{})});
try{
 const {defaultBrowserType,...device}=devices['iPad Pro 11'];
 const page=await browser.newPage({...device,timezoneId:'Africa/Johannesburg'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url()),p=u.pathname;
  if(p.startsWith('/api/')){
   const res=await call('alex',p+u.search,route.request().postDataJSON()||undefined);
   return route.fulfill({status:res.status,contentType:'application/json',body:JSON.stringify(res.data)});
  }
  if(p==='/favicon.ico')return route.fulfill({status:204});
  try{let file=p==='/tasks'?'tasks.html':p.slice(1);return await route.fulfill({body:await readFile(resolve('public',file)),contentType:({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404});}
 });
 await page.goto('https://tasks-test.example/tasks');
 const card=page.locator('[data-case="'+id+'"]');
 await card.waitFor();await card.getByText('Wat moet ek doen?',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await card.getByRole('button',{name:'Antwoord / Vra PA'}).click();
 const dialog=page.locator('dialog[open]');
 async function saved(){await page.locator('dialog[open]').waitFor({state:'hidden'});}
 await dialog.locator('[name=note]').fill('Wie moet die kwotasies vergelyk?');await dialog.getByRole('button',{name:'Stoor antwoord',exact:true}).click();await saved();
 const convo=async()=>(await call('alex','/api/pa-report/conversation?subject_key='+id)).data;
 let history=await convo(),q=history.feedback.at(-1);
 await savePaReport(env,via,{operation:'answer',revision:1,request_id:crypto.randomUUID(),reason:'Synthetic tablet answer',feedback_id:q.id,subject_hash:q.subject_hash,current_subject_hash:history.subject.subject_hash,source_url:url,answer:{kind:'question',text:'PA vergelyk die pryse nadat jy die twee kwotasies gegee het.',recommendation:'Gee albei kwotasies.',next_action:row.next_action,responsible:'alex',follow_up_date:'',task_status:'Pending'}});
 await page.reload();await card.getByText('PA vergelyk die pryse nadat jy die twee kwotasies gegee het.',{exact:true}).waitFor();
 await card.getByRole('button',{name:'Herinner my'}).click();await dialog.locator('[name=remind_at]').fill('2027-01-05T10:00');await dialog.getByRole('button',{name:'Stoor antwoord',exact:true}).click();await saved();
 await card.getByRole('button',{name:'Delegeer',exact:true}).click();await dialog.locator('[name=assigned_to]').selectOption('alinda');await dialog.locator('[name=note]').fill('Gaan die kwotasies na.');await dialog.getByRole('button',{name:'Stoor antwoord',exact:true}).click();await saved();
 await card.getByRole('button',{name:'Merk huidige stap klaar',exact:true}).click();assert.equal(await dialog.locator('[name=completion_scope]').inputValue(),'part');await dialog.getByRole('button',{name:'Stoor voltooiing',exact:true}).click();await saved();
 await page.locator('#pa-scope').selectOption('pa');await card.waitFor();await card.getByText('Niks op hierdie stadium nie',{exact:true}).waitFor();
 for(const size of [{width:834,height:1194},{width:1194,height:834}]){await page.setViewportSize(size);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 history=await convo();assert.equal(history.subject.status,'Pending');
 assert.ok(history.feedback.some(f=>f.completion_scope==='part'));assert.ok(history.feedback.some(f=>f.assigned_to==='alinda'));assert.ok(history.feedback.some(f=>f.remind_at));
 assert.deepEqual(errors,[]);console.log('PASS iPad dimensions portrait and landscape, visible answer, question and reply, personal reminder, delegation request, partial completion, retained history.');
}finally{await browser.close();for(const f of after)await f();}
