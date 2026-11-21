// Browser acceptance against an isolated Worker/D1. No Gmail or external traffic.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readMail} from '../src/pa-email.js';
import {savePaReport} from '../src/pa-report-api.js';
import {today} from '../src/domain.js';

const pw=await import(process.env.TASKS_PLAYWRIGHT_MODULE||'playwright');
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,format:'esm',platform:'browser',write:false});
const bindings={APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:'synthetic-browser-'.repeat(3)})};
const mf=new Miniflare(convertV4MiniflareOptions({name:'mail-review-qa',host:'127.0.0.1',modules:true,script:bundle.outputFiles[0].text,
 compatibilityDate:'2026-09-30',d1Databases:{DB:'mail-review-qa'},bindings,
 assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},
 outboundService:()=>{throw Error('External services disabled');}}));
const origin=(await mf.ready).origin,env={...bindings,DB:await mf.getD1Database('DB')};
const pa={username:'alex',via:'pa'},source='https://docs.google.com/spreadsheets/d/synthetic/edit',errors=[];
const devices=[
 {label:'Phone',engine:pw.webkit,options:pw.devices['iPhone 13'],executablePath:process.env.TASKS_WEBKIT_EXECUTABLE},
 {label:'Tablet',engine:pw.webkit,options:pw.devices['iPad (gen 7)'],executablePath:process.env.TASKS_WEBKIT_EXECUTABLE},
 {label:'Desktop',engine:pw.chromium,options:{viewport:{width:1280,height:900}},executablePath:process.env.TASKS_BROWSER_EXECUTABLE}
];
const keys=devices.map((_,i)=>'TSK-8800'+i),legacy='TSK-88003';
const write=(key,action,revision,data)=>savePaReport(env,pa,{operation:'email_followup',subject_key:key,action,revision,data,reason:'Isolated acceptance test',request_id:crypto.randomUUID()});
let browser;
try{
 const rows=[...keys,legacy].map(id=>({id,title:'Review '+id,area:'Admin',scope:'private',assigned_to:'alex',status:'Pending',source_url:source,review_date:today(),next_action:'Lees die voorstel.'}));
 await savePaReport(env,pa,{operation:'register',revision:0,data:{source_at:new Date().toISOString(),source_url:source,rows},request_id:crypto.randomUUID(),reason:'Isolated test register'});
 const legacyFile=process.env.MAIL_READONLY_FIXTURE;let legacyGreeting;
 if(legacyFile){
  const m=JSON.parse(await readFile(legacyFile,'utf8'));
  legacyGreeting=m.envelope.body.split('\n')[0];
  await env.DB.prepare('INSERT INTO v2_pa_followup_mail VALUES(?,?,?,?,?,?,?,?,?,?)').bind(legacy,m.revision,crypto.randomUUID(),'fixture','submit',null,null,JSON.stringify(m),JSON.stringify({phase:m.phase,revision:m.revision,review_date:today(),recipient:m.envelope.to.join(', '),next_action:'Lees die voorstel.'}),new Date().toISOString()).run();
 }
 for(const [i,device] of devices.entries()){
  const key=keys[i],e={from:'owner@example.com',to:['office@example.com'],cc:[],bcc:['archive@example.com'],scope:'Synthetic check',subject:'Status confirmation',body:'Please confirm the date.',html:'<p>Please confirm the date.</p><table style="width:100%;max-width:480px"><tr><td>Signature</td></tr></table>'};
  await write(key,'draft',0,{envelope:e,review_date:today(),next_action:'Lees die voorstel.'});await write(key,'submit',1,{});
  browser=await device.engine.launch({headless:true,executablePath:device.executablePath,...(device.engine===pw.chromium?{args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote']}: {})});
  const page=await browser.newPage({...device.options,timezoneId:'Africa/Johannesburg'});
  page.on('pageerror',err=>errors.push(err.message));
  const login=await page.request.post(origin+'/api/login',{data:{username:'alex',key:JSON.parse(bindings.APP_ACCESS_KEYS).alex},headers:{Origin:origin}});
  assert.equal(login.status(),200);
  const cookie=login.headers()['set-cookie'].split(';')[0],eq=cookie.indexOf('=');
  await page.context().addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:origin}]);
  const panel=page.locator('.mail-proposal:visible'),button=name=>panel.getByRole('button',{name,exact:true});
  if(legacyFile){
   await page.goto(origin+'/tasks?task='+legacy);
   await panel.frameLocator('iframe').getByText(legacyGreeting,{exact:true}).waitFor();
   await panel.frameLocator('iframe').locator('table').waitFor();
   await button('Goedkeur en stuur').waitFor();
   assert.equal((await readMail(env.DB,legacy)).phase,'approval');
  }
  await page.goto(origin+'/tasks?task='+key);
  await panel.frameLocator('iframe').getByText('Please confirm the date.').waitFor();
  assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Mail fits '+device.label);
  await button('Wysig e-pos').click();await panel.getByLabel('Aan',{exact:true}).fill('changed@example.com');
  await panel.getByLabel('Onderwerp').fill('Updated subject');
  await panel.getByRole('textbox',{name:'E-posinhoud'}).fill('Updated content.');
  await button('Stoor wysigings').click();await panel.frameLocator('iframe').getByText('Updated content.').waitFor();
  await page.reload();await panel.getByText('Updated subject',{exact:true}).waitFor();await button('Goedkeur en stuur').click();
  assert.equal((await readMail(env.DB,key)).phase,'approval');
  if(i===0){
   await button('Terug na voorstel').click();await button('Moenie stuur nie').click();await panel.getByText('Gekanselleer',{exact:true}).waitFor();
   assert.equal((await readMail(env.DB,key)).phase,'cancelled');
  }else{
   await button('Ja, stuur hierdie e-pos').evaluate(el=>{el.click();el.click();});
   await panel.getByText(/Goedgekeur · wag vir PA/).waitFor();
   const m=await readMail(env.DB,key);assert.equal(m.revision,4);assert.equal(m.envelope.body,'Updated content.');
   await write(key,'gmail_unavailable',m.revision,{});await page.reload();await panel.getByText(/Gmail is nie beskikbaar/).first().waitFor();
   assert.equal((await readMail(env.DB,key)).phase,'approved');
  }
  console.log(device.label,device.engine.name(),browser.version(),JSON.stringify(page.viewportSize()),'PASS');
  await browser.close();browser=null;
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();await mf.dispose();}
