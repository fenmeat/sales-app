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
const {chromium,webkit,devices}=await import(process.env.STAFF_PLAYWRIGHT_MODULE??'playwright');
const directory=await mkdtemp(join(tmpdir(),'fen-payroll-browser-')),out=process.env.STAFF_QA_SCREENSHOTS??join(directory,'screenshots');await mkdir(out,{recursive:true});
const key='synthetic-browser-payroll-key-'.repeat(3),origin='http://localhost:8798';
// Simulate Friday in this isolated Worker only so the real future-approval guard stays in place.
const bundle=await build({entryPoints:[new URL('../src/worker.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',
 platform:'browser',define:{'Date.now':'qaNow'},banner:{js:`const qaNow=()=>${Date.parse('2026-11-20T15:00:00Z')};`}});
const mf=new Miniflare(convertV4MiniflareOptions({name:'payroll-browser-test',host:'127.0.0.1',port:8798,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-30',assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'payroll-browser-test'},resourcePersistencePath:directory,bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alinda:key,alex:'separate-synthetic-owner-key-'+key})},outboundService:()=>{throw Error('No external traffic in payroll QA');}}));
let browser;const errors=[];
try{
 await mf.ready;const ipadSafari=process.env.STAFF_QA_WEBKIT==='1';browser=await (ipadSafari?webkit:chromium).launch({executablePath:process.env.STAFF_BROWSER_EXECUTABLE,headless:true,args:ipadSafari?[]:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({...(ipadSafari?devices['iPad (gen 7)']:{}),viewport:{width:820,height:1180},hasTouch:true,isMobile:true,deviceScaleFactor:2,timezoneId:'Africa/Johannesburg'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 assert.equal((await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:fenHourly?{username:'alinda',key}:{username:'alex',key:'separate-synthetic-owner-key-'+key}})).status(),200);
 const id=crypto.randomUUID();assert.equal((await page.request.post(origin+'/api/staff',{headers:{Origin:origin},data:{request_id:crypto.randomUUID(),revision:0,action:'person',person:{id,name:'Synthetic Payroll Worker',code:'QA-PAY-01',team:'Production',start_date:'2026-01-01',birth_date:'1980-01-01',active:true}}})).status(),200);
 {
  await page.clock.setFixedTime(new Date('2026-11-20T15:00:00Z'));
  const state=await (await page.request.get(origin+'/api/staff')).json();
  assert.equal((await page.request.post(origin+'/api/staff',{headers:{Origin:origin},data:{action:'schedule',request_id:crypto.randomUUID(),revision:state.revision,employee_id:id,from:'2026-11-16',minutes:[540,540,540,540,540,0,0],reason:'Synthetic five-day schedule'}})).status(),200);
  const db=await mf.getD1Database('DB');
  for(const day of (fenHourly?['17','18','19','20']:['16','17','18','19','20'])){
   const start=`2026-11-${day}T05:00:00Z`,end=`2026-11-${day}T${fenHourly?'14':day==='16'?'14':'15'}:00:00Z`,shiftId=crypto.randomUUID();
   const shift={id:shiftId,employee_id:id,punches:[{kind:'in',at:start},{kind:'out',at:end}]};
   await db.prepare('INSERT INTO v2_staff_time VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,shiftId,Number(day),start,end,'out',JSON.stringify(shift),'synthetic','tester',end).run();
  }
 }
 await page.goto(origin+'/staff');await page.getByRole('button',{name:'Payroll',exact:true}).click();await page.getByRole('button',{name:'Pay setup',exact:true}).click();
 const save=async()=>{await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('#action-dialog').waitFor({state:'hidden'});await page.locator('#payroll-root h2').waitFor();};
 await page.getByRole('button',{name:'Add employer details',exact:true}).click();assert.equal(await page.getByLabel('Legal employer name').getAttribute('inputmode'),'text');await page.getByLabel('Legal employer name').fill('Synthetic Fen Payroll QA');await page.getByLabel('Employer address').fill('1 Synthetic Street, Test Town');await page.getByLabel('First Fen Friday pay date').fill('2026-11-20');await save();
 await page.locator('[data-pay-profile]').click();await page.getByLabel('Effective from').fill('2026-01-01');await page.getByLabel('Hourly rate (R)',{exact:true}).fill('40,00');await page.getByLabel('Fixed weekly amount (R; 0 for hourly)').fill('0');await page.getByLabel('Occupation',{exact:true}).fill('Synthetic packer');await page.getByLabel(/Written compressed-week agreement/).fill('Synthetic signed agreement');await page.getByLabel('UIF default').selectOption('Liable');await page.getByLabel('Rate source / reason').fill('Synthetic verified hourly rate');await save();
 await page.getByRole('button',{name:'Begin vars',exact:true}).click();await save();
 await page.getByRole('heading',{name:'Pay Wages',exact:true}).waitFor();
 if(fenHourly){
  await page.getByRole('button',{name:'Pay setup',exact:true}).click();await page.locator('[data-pay-profile]').click();
  await page.getByLabel('Effective from').fill('2026-11-16');await page.getByLabel('Hourly rate (R)',{exact:true}).fill('38,28');
  await page.getByLabel(/FenMeat pays 100% of hourly wages/).check();await save();
 }
 await page.getByRole('button',{name:'Pay Wages',exact:true}).click();
 const incompleteId=crypto.randomUUID();
 let current=await (await page.request.get(origin+'/api/staff')).json();
 const inactiveFacts=await page.request.post(origin+'/api/staff',{headers:{Origin:origin},data:{action:'person',revision:current.revision,request_id:crypto.randomUUID(),person:{id:incompleteId,name:'Synthetic second worker',code:'QA-PAY-02',team:'Factory',start_date:'2026-11-16',birth_date:'1990-04-03',active:true}}});
 assert.equal(inactiveFacts.status(),200);
 await page.reload();await page.getByRole('button',{name:'Payroll',exact:true}).click();
 const open=async()=>{if(!await page.locator('[data-facts="'+id+'"]').count() && !await page.locator('[data-slip="'+id+'"]').count())await page.locator('[data-toggle="'+id+'"]').first().click();};
 await open();
 if(fenHourly){
  await page.getByRole('button',{name:'Paid days off',exact:true}).click();await page.getByLabel('2026-11-16').check();await page.getByLabel('Source or reason').fill('Verified paid Monday');await save();
 }
 await open();await page.locator('[data-facts="'+id+'"]').click();await page.getByLabel('November UIF').selectOption('Full weekly share');
 await page.getByLabel('Source or reason').fill('Verified room under the November ceiling');
 await save();
 const get=async()=>await (await page.request.get(origin+'/api/staff/payroll?view=wages&pay_date=2026-11-20')).json();
 let result=await get(),paidRow=result.run.rows.find(r=>r.employee_id===id);
 const expectedNet=fenHourly?170537:Math.round(204000-2040-2400),expectedUif=fenHourly?1723:2040;
 assert.equal(paidRow.gross_cents,fenHourly?172260:204000);
 assert.equal(paidRow.net_cents,expectedNet,JSON.stringify(paidRow.issues));assert.equal(paidRow.ready,true);
 assert.equal(result.run.rows.find(r=>r.employee_id===incompleteId).net_cents,null);
 assert.equal(await page.locator('[data-wage="'+incompleteId+'"]').getByText('Needs Attention').count(),1);
 await page.getByRole('button',{name:'Approve Ready Employees',exact:true}).click();await save();
 result=await get();assert.equal(result.run.rows.find(r=>r.employee_id===id).wage_state,'Approved');assert.equal(result.run.status,'Draft');
 await page.evaluate(()=>{window.__prints=0;window.print=()=>{window.__prints++;window.dispatchEvent(new Event('beforeprint'));window.dispatchEvent(new Event('afterprint'));};});
 await page.getByRole('button',{name:'Print payment list'}).click();await page.waitForFunction(()=>window.__prints===1);
 assert.ok(!(await page.locator('#payroll-print').innerText()).includes('Synthetic second worker'));
 await open();await page.locator('[data-one-paid="'+id+'"]').click();await page.getByLabel('Actual method').selectOption('Cash');await save();
 await open();await page.locator('[data-slip="'+id+'"]').click();await page.waitForFunction(()=>window.__prints===2);
 assert.match(await page.locator('#payroll-print').innerText(),/Cash/);await page.emulateMedia({media:'print'});if(!ipadSafari)await page.pdf({path:join(out,'synthetic-payslip.pdf')});await page.emulateMedia({media:'screen'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(out,'pay-wages-ipad.png'),fullPage:true});
 await page.getByRole('button',{name:'Monthly UIF',exact:true}).click();await page.getByText('Monthly wages & UIF',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,'payroll-month-phone.png'),fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV',exact:true}).click();await (await download).saveAs(join(out,'synthetic-month.csv'));assert.match(await readFile(join(out,'synthetic-month.csv'),'utf8'),/Incomplete November report/);
 await page.getByRole('button',{name:'Print report',exact:true}).click();await page.waitForFunction(()=>window.__prints===3);assert.equal(await page.locator('#payroll-print .payslip').count(),0,'monthly print replaces selected payslip');await page.emulateMedia({media:'print'});assert.match(await page.locator('#payroll-print').innerText(),/Incomplete November report/);if(!ipadSafari)await page.pdf({path:join(out,'synthetic-month.pdf'),preferCSSPageSize:true});await page.emulateMedia({media:'screen'});
 await page.reload();await page.getByRole('button',{name:'Payroll',exact:true}).click();await page.getByRole('button',{name:'History',exact:true}).last().click();await page.getByRole('button',{name:'Open week',exact:true}).click();await page.getByText('Paid',{exact:true}).waitFor();result=await (await page.request.get(origin+'/api/staff/payroll?pay_date=2026-11-20')).json();assert.equal(result.run.rows.find(r=>r.employee_id===id).wage_state,'Paid');assert.equal(result.run.status,'Draft');assert.equal(result.month.rows[0].uif_total_cents,2*expectedUif);assert.deepEqual(errors,[]);
 console.log('PASS: Alinda session, fresh start, existing profiles, weekly SARS PAYE, November UIF, weekly approval/payment, desktop/390px layout, persistent payslip/month print, CSV and reload. Synthetic data only.');
}finally{await browser?.close();await mf.dispose();await rm(directory,{recursive:true,force:true});}
