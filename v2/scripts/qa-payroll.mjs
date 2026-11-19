// Local isolated browser acceptance; synthetic data only. No live cookies.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const fenHourly=process.argv.includes('--fen-hourly');
const {chromium}=await import(process.env.STAFF_PLAYWRIGHT_MODULE??'playwright');
const directory=await mkdtemp(join(tmpdir(),'fen-payroll-browser-')),out=process.env.STAFF_QA_SCREENSHOTS??join(directory,'screenshots');await mkdir(out,{recursive:true});
const key='synthetic-browser-payroll-key-'.repeat(3),origin='http://localhost:8798';
// Simulate Friday in this isolated Worker only so the real future-approval guard stays in place.
const bundle=await build({entryPoints:[new URL('../src/worker.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',
 platform:'browser',define:{'Date.now':'qaNow'},banner:{js:`const qaNow=()=>${Date.parse('2026-11-20T15:00:00Z')};`}});
const mf=new Miniflare(convertV4MiniflareOptions({name:'payroll-browser-test',host:'127.0.0.1',port:8798,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-30',assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'payroll-browser-test'},resourcePersistencePath:directory,bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alinda:key})},outboundService:()=>{throw Error('No external traffic in payroll QA');}}));
let browser;const errors=[];
try{
 await mf.ready;browser=await chromium.launch({executablePath:process.env.STAFF_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/Los_Angeles'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 assert.equal((await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{username:'alinda',key}})).status(),200);
 const id=crypto.randomUUID();assert.equal((await page.request.post(origin+'/api/staff',{headers:{Origin:origin},data:{request_id:crypto.randomUUID(),revision:0,action:'person',person:{id,name:'Synthetic Payroll Worker',code:'QA-PAY-01',team:'Production',start_date:'2026-01-01',birth_date:'1980-01-01',active:true}}})).status(),200);
 if(fenHourly){
  await page.clock.setFixedTime(new Date('2026-11-20T15:00:00Z'));
  const state=await (await page.request.get(origin+'/api/staff')).json();
  assert.equal((await page.request.post(origin+'/api/staff',{headers:{Origin:origin},data:{action:'schedule',request_id:crypto.randomUUID(),revision:state.revision,employee_id:id,from:'2026-11-16',minutes:[540,540,540,540,540,0,0],reason:'Synthetic five-day schedule'}})).status(),200);
  const db=await mf.getD1Database('DB');
  for(const day of ['17','18','19','20']){
   const start=`2026-11-${day}T05:00:00Z`,end=`2026-11-${day}T14:00:00Z`,shiftId=crypto.randomUUID();
   const shift={id:shiftId,employee_id:id,punches:[{kind:'in',at:start},{kind:'out',at:end}]};
   await db.prepare('INSERT INTO v2_staff_time VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,shiftId,Number(day),start,end,'out',JSON.stringify(shift),'synthetic','tester',end).run();
  }
 }
 await page.goto(origin+'/staff');await page.getByRole('button',{name:'Payroll',exact:true}).click();await page.getByRole('button',{name:'Pay setup',exact:true}).click();
 const save=async()=>{await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('#action-dialog').waitFor({state:'hidden'});await page.locator('#payroll-root h2').waitFor();};
 await page.getByRole('button',{name:'Add employer details',exact:true}).click();assert.equal(await page.getByLabel('Legal employer name').getAttribute('inputmode'),'text');await page.getByLabel('Legal employer name').fill('Synthetic Fen Payroll QA');await page.getByLabel('Employer address').fill('1 Synthetic Street, Test Town');await page.getByLabel('First Fen Friday pay date').fill('2026-11-20');await save();
 await page.locator('[data-pay-profile]').click();await page.getByLabel('Effective from').fill('2026-01-01');await page.getByLabel('Hourly rate (R)',{exact:true}).fill('40,00');await page.getByLabel('Fixed weekly amount (R; 0 for hourly)').fill('0');await page.getByLabel('Occupation',{exact:true}).fill('Synthetic packer');await page.getByLabel('UIF default').selectOption('Liable');await page.getByLabel('Rate source / reason').fill('Synthetic verified hourly rate');await save();
 await page.getByRole('button',{name:'Begin vars',exact:true}).click();await save();
 await page.getByText('App payroll from 16 November 2026',{exact:true}).waitFor();
 if(fenHourly){
  await page.getByRole('button',{name:'Pay setup',exact:true}).click();await page.locator('[data-pay-profile]').click();
  await page.getByLabel('Effective from').fill('2026-11-16');await page.getByLabel('Hourly rate (R)',{exact:true}).fill('38,28');
  await page.getByLabel(/FenMeat pays 100% of hourly wages/).check();await save();
 }
 await page.getByRole('button',{name:'Week wages',exact:true}).click();await page.getByLabel('Friday pay date').fill('2026-11-20');await page.getByRole('button',{name:'Load week',exact:true}).click();await page.getByRole('button',{name:'Refresh draft from clock',exact:true}).click();await save();
 if(fenHourly){
  await page.getByRole('button',{name:'Save paid days off'}).click();await page.getByLabel(/2026-11-16/).check();
  await page.getByLabel('Approval or source').fill('Synthetic approved paid day off');await save();
  await page.getByText(/Paid day off: 2026-11-16/).waitFor();
  await page.getByRole('button',{name:'Refresh draft from clock'}).click();await save();
  await page.getByRole('button',{name:'Review pay',exact:true}).click();
  assert.equal(await page.getByLabel('PAYE method').inputValue(),'SARS weekly table');
  assert.equal(await page.getByLabel('Commission (R)',{exact:true}).getAttribute('readonly'),'');
  await page.getByLabel(/Standard full week/).check();await page.getByLabel('November UIF check').selectOption('Full weekly share');
  await page.getByLabel(/I checked each scheduled day/).check();await page.getByLabel(/I checked the hours/).check();
  await page.getByLabel('Review / exclusion note').fill('Synthetic complete week, paid day, breaks and November UIF checked');await save();
 }else{
 await page.getByRole('button',{name:'Review pay',exact:true}).click();const h=page.getByLabel('Ordinary worked hours',{exact:true});await h.fill('45');await page.getByLabel('Overtime hours at 1.5×',{exact:true}).fill('2');await page.getByLabel('Bonus (R)',{exact:true}).fill('100,00');await page.getByLabel('Commission (R)',{exact:true}).fill('0');await page.getByLabel('PAYE method',{exact:true}).selectOption('SARS weekly table');await page.getByLabel(/Standard full week/).check();await page.getByLabel('November UIF check').selectOption('Full weekly share');await page.getByLabel('Meat deduction (R)',{exact:true}).fill('50');await page.getByLabel('Review / exclusion note').fill('Synthetic verified times, approved bonus and deductions; standard weekly PAYE and full UIF headroom');await page.getByLabel(/I checked the hours/).check();await save();
 }
 const expectedNet=fenHourly?170537:192880,expectedUif=fenHourly?1723:2020;
 let result=await (await page.request.get(origin+'/api/staff/payroll?pay_date=2026-11-20')).json();assert.equal(result.run.totals.net_cents,expectedNet);assert.equal(result.run.rows[0].uif_employee_cents,expectedUif);assert.equal(result.run.rows[0].reviewed,true);
 await page.screenshot({path:join(out,'payroll-week-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Approve week',exact:true}).click();await page.getByLabel('Review note',{exact:true}).fill('Synthetic payroll checked and approved');await save();await page.getByRole('button',{name:'Print all payslips',exact:true}).waitFor();
 await page.evaluate(()=>{window.__prints=0;window.print=()=>{window.__prints++;window.dispatchEvent(new Event('beforeprint'));window.dispatchEvent(new Event('afterprint'));};});
 await page.getByRole('button',{name:'Print payslip',exact:true}).click();await page.waitForFunction(()=>window.__prints===1);assert.equal(await page.evaluate(()=>document.body.classList.contains('printing-payroll')),true);
 await page.emulateMedia({media:'print'});assert.match(await page.locator('#payroll-print').innerText(),fenHourly?/1.?705[,.]37/:/1.?928[,.]80/);assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#payroll-print').isVisible(),true);await page.pdf({path:join(out,'synthetic-payslip.pdf'),preferCSSPageSize:true,printBackground:true});await page.screenshot({path:join(out,'payroll-payslip-print.png'),fullPage:true});await page.emulateMedia({media:'screen'});assert.equal(await page.locator('#payroll-print').isVisible(),false,'normal screen restored without clearing print selection');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,'payroll-week-phone.png'),fullPage:true});
 await page.getByRole('button',{name:'Record payment',exact:true}).click();await page.getByLabel('Actual payment date').fill('2026-11-20');await page.getByLabel('Review note',{exact:true}).fill('Synthetic payment completed');await save();
 await page.getByRole('button',{name:'Next Friday',exact:true}).click();await page.getByText('2026-11-23 to 2026-11-27',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Monthly UIF',exact:true}).click();await page.getByText('Monthly wages & UIF',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,'payroll-month-phone.png'),fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV',exact:true}).click();await (await download).saveAs(join(out,'synthetic-month.csv'));assert.match(await readFile(join(out,'synthetic-month.csv'),'utf8'),/Incomplete November report/);
 await page.getByRole('button',{name:'Print report',exact:true}).click();await page.waitForFunction(()=>window.__prints===2);assert.equal(await page.locator('#payroll-print .payslip').count(),0,'monthly print replaces selected payslip');await page.emulateMedia({media:'print'});assert.match(await page.locator('#payroll-print').innerText(),/Incomplete November report/);await page.pdf({path:join(out,'synthetic-month.pdf'),preferCSSPageSize:true});await page.emulateMedia({media:'screen'});
 await page.reload();await page.getByRole('button',{name:'Payroll',exact:true}).click();await page.getByRole('button',{name:'History',exact:true}).last().click();await page.getByRole('button',{name:'Open week',exact:true}).click();await page.getByText('Paid',{exact:true}).waitFor();result=await (await page.request.get(origin+'/api/staff/payroll?pay_date=2026-11-20')).json();assert.equal(result.run.status,'Paid');assert.equal(result.month.rows[0].uif_total_cents,2*expectedUif);assert.deepEqual(errors,[]);
 console.log('PASS: Alinda session, fresh start, existing profiles, weekly SARS PAYE, November UIF, weekly approval/payment, desktop/390px layout, persistent payslip/month print, CSV and reload. Synthetic data only.');
}finally{await browser?.close();await mf.dispose();await rm(directory,{recursive:true,force:true});}
