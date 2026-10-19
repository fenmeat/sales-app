// Local-only browser acceptance test. Uses synthetic records and an isolated D1.
// Run with STAFF_BROWSER_EXECUTABLE and (if needed) STAFF_PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const {chromium}=await import(process.env.STAFF_PLAYWRIGHT_MODULE??'playwright');
const directory=await mkdtemp(join(tmpdir(),'fen-staff-browser-'));
const screenshots=process.env.STAFF_QA_SCREENSHOTS??join(directory,'screenshots');await mkdir(screenshots,{recursive:true});
const key='synthetic-browser-admin-key-'.repeat(3),origin='http://localhost:8797';
const mf=new Miniflare(convertV4MiniflareOptions({name:'staff-browser-test',host:'127.0.0.1',port:8797,modules:['worker','staff-api','staff-domain','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching','zoho-reconcile'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'staff-browser-test'},resourcePersistencePath:directory,bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key}),STAFF_PIN_PEPPER:'synthetic-browser-test-pepper-'.repeat(3)},outboundService:()=>{throw Error('No external traffic in Staff browser QA');}}));
let browser;const errors=[];
try{
 await mf.ready;browser=await chromium.launch({executablePath:process.env.STAFF_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/Los_Angeles'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const login=await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{username:'alex',key}});assert.equal(login.status(),200);
 await page.goto(origin+'/staff');await page.getByRole('button',{name:'People',exact:true}).click();await page.getByRole('button',{name:'Add employee',exact:true}).click();
 await page.getByLabel('Name',{exact:true}).fill('Synthetic Worker');await page.getByLabel('Permanent code').fill('QA-001');await page.getByLabel('Employment start').fill('2026-01-01');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).waitFor();
 await page.getByRole('button',{name:'Edit',exact:true}).click();const name=page.getByLabel('Name',{exact:true});await name.click();assert.deepEqual(await name.evaluate(e=>[e.selectionStart,e.selectionEnd]),[0,16]);await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Schedule',exact:true}).click();await page.getByLabel('Effective from').fill('2026-01-01');
 for(const d of ['Mon','Tue','Wed','Thu','Fri'])await page.getByLabel(d,{exact:true}).fill('9');await page.getByLabel('Sat',{exact:true}).fill('0,5');await page.getByLabel('Sun',{exact:true}).fill('0');await page.getByLabel('Source / reason').fill('Synthetic verified schedule');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'PIN',exact:true}).waitFor();
 await page.getByRole('button',{name:'PIN',exact:true}).click();await page.getByLabel('New PIN',{exact:true}).fill('726481');await page.getByLabel('Repeat PIN').fill('726481');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('QA-001 · Production · PIN ready',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Leave',exact:true}).click();await page.getByRole('button',{name:'Record balance',exact:true}).click();await page.getByLabel('Effective date').fill('2026-01-01');await page.getByLabel('Days (negative for a reduction)').fill('15');await page.getByLabel('Source / reason').fill('Synthetic verified opening balance');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Annual: 15 days',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Add request',exact:true}).click();await page.getByLabel('Date',{exact:true}).fill('2026-10-19');await page.getByLabel('Scheduled days').selectOption('0.5');await page.getByLabel('Source / reason').fill('Synthetic half-day request');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'Review',exact:true}).click();await page.getByLabel('Source / reason').fill('Verified half day');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('4h 30m paid leave',{exact:true}).waitFor();
 await page.screenshot({path:join(screenshots,'staff-leave-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Devices',exact:true}).click();await page.getByRole('button',{name:'Register device',exact:true}).click();await page.getByLabel('Device name').fill('QA Yard Phone');await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('.setup-code').waitFor();const code=await page.locator('.setup-code').innerText();await page.getByRole('button',{name:'Close',exact:true}).click();
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Tokyo'}),phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));
 await phone.goto(origin+'/staff-clock');await phone.getByLabel('Device code').fill(code);await phone.getByRole('button',{name:'Register this phone'}).click();await phone.getByRole('button',{name:/Synthetic Worker/}).waitFor();
 // Receive a committed clock response, then simulate losing it before the UI sees it.
 let intercepted=false;await phone.route('**/api/staff-clock/punch',async route=>{if(intercepted)return route.continue();intercepted=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('connectionfailed');});
 await phone.getByRole('button',{name:/Synthetic Worker/}).click();await phone.getByLabel('PIN',{exact:true}).fill('726481');await phone.getByRole('button',{name:'Continue',exact:true}).click();await phone.getByRole('button',{name:'Clock in',exact:true}).click();await phone.locator('#notice').filter({hasText:'No confirmation'}).waitFor();
 await phone.reload();await phone.getByRole('button',{name:/Synthetic Worker/}).click();await phone.getByLabel('PIN',{exact:true}).fill('726481');await phone.getByRole('button',{name:'Continue',exact:true}).click();await phone.locator('#notice').filter({hasText:'saved at'}).waitFor();
 const db=await mf.getD1Database('DB');assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_staff_time').first()).n,1,'response loss/reload/retry creates one event');
 await phone.screenshot({path:join(screenshots,'staff-clock-mobile.png'),fullPage:true});
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'phone layout must not scroll horizontally');
 assert.equal(await phone.getByRole('link',{name:'Sales',exact:true}).count(),0);
 assert.equal((await phone.request.get(origin+'/api/staff')).status(),401);
 await phone.getByRole('button',{name:/Synthetic Worker/}).click();await phone.getByLabel('PIN',{exact:true}).fill('726481');await phone.getByRole('button',{name:'Continue',exact:true}).click();await phone.getByRole('button',{name:'Clock out',exact:true}).click();await phone.locator('#notice').filter({hasText:'Clock out saved'}).waitFor();
 await page.getByRole('button',{name:'Hours',exact:true}).click();await page.getByRole('button',{name:'Load period',exact:true}).click();await page.getByRole('button',{name:'Review / correct'}).waitFor();
 await page.getByRole('button',{name:'Review / correct'}).click();await page.getByLabel('Source / reason').fill('Verified synthetic clock entries');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'Load period',exact:true}).waitFor();
 await page.getByRole('button',{name:'Leave',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(screenshots,'staff-leave-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'admin mobile layout must not overflow');
 const staffState=await (await page.request.get(origin+'/api/staff')).json();assert.equal(staffState.people[0].schedules[0].minutes[5],30);assert.equal(staffState.state.leave[0].paid_minutes,270);assert.deepEqual(errors,[]);
 console.log('PASS: desktop/mobile Staff, comma decimals, select-all, leave, PIN, device enrolment, lost response/reload/retry, isolation and correction.');
}finally{await browser?.close();await mf.dispose();await rm(directory,{recursive:true,force:true});}
