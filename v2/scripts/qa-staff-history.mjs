// Isolated browser coverage for employee search and native/archive date navigation.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {employeeHistory} from '../src/staff-history.js';
import {sourceFixture} from '../test/fixtures/staff-source.js';
const {chromium,webkit,devices}=await import(process.env.STAFF_PLAYWRIGHT_MODULE??'playwright');
const origin='http://127.0.0.1:8796',key='isolated-staff-history-test-'.repeat(3);
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,platform:'browser',format:'esm',write:false});
const mf=new Miniflare(convertV4MiniflareOptions({
 name:'staff-history-browser',host:'127.0.0.1',port:8796,modules:true,script:bundle.outputFiles[0].text,
 compatibilityDate:'2026-09-30',d1Databases:{DB:'history-qa'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alinda:key})},
 assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},
 outboundService:()=>{throw Error('External traffic disabled in Staff QA');}
}));
try{
 await mf.ready;
 const login=await mf.dispatchFetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'alinda',key})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const employees=['First Example','Second Test'].map((name,i)=>({id:crypto.randomUUID(),code:'QA-'+i,name,active:true,team:'Factory',start_date:'2026-01-01',schedules:[]}));
 const db=await mf.getD1Database('DB');
 await db.prepare('INSERT INTO v2_staff_register VALUES(?,?,?,?,?,?)').bind(1,JSON.stringify({people:employees,leave:[],ledger:[]}),'fixture','fixture',new Date().toISOString(),'{}').run();
 const settings={key:'settings',profiles:[{employee_id:employees[0].id,from:'2026-11-16',basis:'Hourly',rate_cents:4000,break_rule:'60 minutes if no break recorded',uif:'Liable'}]};
 await db.prepare('INSERT INTO v2_staff_payroll VALUES(?,?,?,?,?,?)').bind(1,'settings',JSON.stringify(settings),'fixture','fixture',new Date().toISOString()).run();
 for(const [index,day] of ['13','16'].entries()){
  const start='2026-11-'+day+'T06:01:00.000Z',end='2026-11-'+day+'T14:02:00.000Z';
  const shift={id:crypto.randomUUID(),employee_id:employees[0].id,punches:[{kind:'in',at:start},{kind:'out',at:end}]};
  await db.prepare('INSERT INTO v2_staff_time VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),shift.employee_id,shift.id,index+1,start,end,'out',JSON.stringify(shift),'fixture','fixture',end).run();
 }
 for(const [device,engine] of [['iPhone 13',webkit],['iPad (gen 7)',webkit],['Pixel 7',chromium],['Desktop Chrome',chromium]]){
  const browser=process.env.STAFF_BROWSER_EXECUTABLE?await chromium.launch({executablePath:process.env.STAFF_BROWSER_EXECUTABLE}):await engine.launch();
  try{
   const context=await browser.newContext({...devices[device],timezoneId:'Africa/Johannesburg'});
   const [name,value]=cookie.split('=');
   await context.addCookies([{name,value,url:origin}]);
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/staff');
   const button=name=>page.getByRole('button',{name,exact:true});
   const search=page.locator('[data-employee-search]');
   await button('Werknemers').click();
   await search.pressSequentially('Second Test');
   assert.equal(await search.inputValue(),'Second Test');
   assert.equal(await page.locator('[data-person-row]:visible').count(),1);
   await button('Wysig').click();
   assert.equal(await page.getByLabel('Naam',{exact:true}).inputValue(),'Second Test');
   await button('Maak toe').click();
   await search.fill('First');
   await button('Geskiedenis').click();
   await page.locator('#clock-day').fill('2026-11-13');
   await button('Volgende klokdag').click();
   await page.getByText('2026-11-16 – 2026-11-16',{exact:true}).waitFor();
   assert.equal(await button('Volgende klokdag').isDisabled(),true);
   assert.equal(await page.locator('#clock-day').inputValue(),'2026-11-16');
   await button('Vorige klokdag').click();
   await page.getByText('2026-11-13 – 2026-11-13',{exact:true}).waitFor();
   await page.locator('#clock-day').fill('2026-11-11');
   await page.getByText(/Geen huidige klokinskrywings/).waitFor();
   await button('Huidige week').click();
   const archive=employeeHistory(sourceFixture(),{...employees[0],source_profile:{source_name:'Synthetic worker'}},'fixture');
   await page.route('**/api/staff/imports/history?*',route=>route.fulfill({json:archive}));
   await button('Ou geskiedenis').click();
   await button('Klokgeskiedenis').click();
   await page.locator('#archive-day').fill('2026-11-16');
   await page.getByText(/Geen klokdae vir dié datums/).waitFor();
   assert.equal(await button('Volgende dae').isDisabled(),true);
   await button('Klokure').click();
   await search.pressSequentially('QA-0');
   assert.equal(await page.getByLabel('Kies werknemer').inputValue(),employees[0].id);
   await button('Lone').click();
   await search.pressSequentially('Second');
   assert.equal(await page.locator('[data-pay-person]:visible').count(),1);
   assert.equal(await page.locator('[data-pay-person]:visible h3').innerText(),'Second Test');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await search.fill('First');
   await page.getByLabel('Betaaldatum').fill('2026-11-20');await button('Wys week').click();
   const card=page.locator('[data-pay-person]').first();
   const details=card.locator('.daily-breaks');
   await details.locator('summary').click();
   const monday=details.locator('.daily-pay').first();
   await monday.getByRole('button',{name:'Werkplek of ure wysig'}).click();
   await page.getByLabel('Werkplek',{exact:true}).selectOption('Factory');
   await page.getByLabel(/Uurregstelling in minute/).fill('12');
   await page.getByLabel('Rede vir die regstelling').fill('Synthetic adjustment '+device);
   await button('Stoor').click();await page.locator('#action-dialog').waitFor({state:'hidden'});
   await button('Herlees klokure').click();await button('Stoor').click();
   await page.locator('#action-dialog').waitFor({state:'hidden'});
   await details.locator('summary').click();
   await monday.getByText('8h 13m',{exact:true}).waitFor();
   await monday.getByText('Synthetic adjustment '+device,{exact:false}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(errors,[]);
   console.log('PASS '+device+' employee search, profile, native and archive periods, pagination and payroll');
  }finally{await browser.close();}
 }
}finally{await mf.dispose();}
