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
const key='synthetic-browser-payroll-key-'.repeat(3),origin='https://localhost:8798';
// Simulate Friday in this isolated Worker only so the real future-approval guard stays in place.
const bundle=await build({entryPoints:[new URL('../src/worker.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',
 platform:'browser',define:{'Date.now':'qaNow'},banner:{js:`const qaNow=()=>${Date.parse('2026-11-20T15:00:00Z')};`}});
const mf=new Miniflare(convertV4MiniflareOptions({name:'payroll-browser-test',host:'127.0.0.1',port:8798,https:true,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-30',assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'payroll-browser-test'},resourcePersistencePath:directory,bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alinda:key,alex:'separate-synthetic-owner-key-'+key})},outboundService:()=>{throw Error('No external traffic in payroll QA');}}));
let browser,page;const errors=[];
try{
 await mf.ready;const ipadSafari=process.env.STAFF_QA_WEBKIT==='1';const device=process.env.STAFF_QA_DEVICE??(ipadSafari?'iPad (gen 7)':'Desktop Chrome');browser=await (ipadSafari?webkit:chromium).launch({executablePath:process.env.STAFF_BROWSER_EXECUTABLE,headless:true,args:ipadSafari?[]:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({...devices[device],ignoreHTTPSErrors:true,timezoneId:'Africa/Johannesburg'});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('response',response=>{if(response.status()>=400)console.error('QA request:',response.status(),new URL(response.url()).pathname);});
 await page.goto(origin+'/api/health');
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
 await page.goto(origin+'/staff');await page.getByRole('button',{name:'Lone',exact:true}).click();await page.locator('[data-pay-tab=setup]').click();
 const save=async()=>{await page.getByRole('button',{name:'Stoor',exact:true}).click();await page.locator('#action-dialog').waitFor({state:'hidden'});await page.locator('#payroll-root h2').waitFor();};
 await page.getByRole('button',{name:'Voeg werkgewerbesonderhede by',exact:true}).click();assert.equal(await page.getByLabel('Geregistreerde werkgewernaam').getAttribute('inputmode'),'text');await page.getByLabel('Geregistreerde werkgewernaam').fill('Synthetic Fen Payroll QA');await page.getByLabel('Werkgeweradres').fill('1 Synthetic Street, Test Town');await page.getByLabel('Eerste betaaldatum op ’n Vrydag').fill('2026-11-20');await save();
 await page.locator('[data-pay-profile]').click();await page.getByLabel('Loonkoers geldig vanaf',{exact:true}).fill('2026-01-01');await page.getByLabel('Uurtarief (R)',{exact:true}).fill('40,00');await page.getByLabel('Vaste weekloon in rand (0 vir uurloon)').fill('0');await page.getByLabel('Werk wat die persoon doen',{exact:true}).fill('Synthetic packer');await page.getByLabel(/Verwysing na ’n getekende ooreenkoms/).fill('Synthetic signed agreement');await page.getByLabel('Gewone UIF-reëling').selectOption('Liable');await page.getByLabel('Waar kom die tarief vandaan?').fill('Synthetic verified hourly rate');await save();
 await page.getByRole('button',{name:'Begin vars',exact:true}).click();await save();
 await page.getByRole('heading',{name:'Betaal werknemers',exact:true}).waitFor();
 if(fenHourly){
  await page.locator('[data-pay-tab=setup]').click();await page.locator('[data-pay-profile]').click();
  await page.getByLabel('Loonkoers geldig vanaf',{exact:true}).fill('2026-11-16');await page.getByLabel('Uurtarief (R)',{exact:true}).fill('38,28');
  await page.getByLabel(/Fen Meat betaal die volle uurloon/).check();await save();
 }
 await page.getByRole('button',{name:'Betaal werknemers',exact:true}).click();
 const incompleteId=crypto.randomUUID();
 let current=await (await page.request.get(origin+'/api/staff')).json();
 const inactiveFacts=await page.request.post(origin+'/api/staff',{headers:{Origin:origin},data:{action:'person',revision:current.revision,request_id:crypto.randomUUID(),person:{id:incompleteId,name:'Synthetic second worker',code:'QA-PAY-02',team:'Factory',start_date:'2026-11-16',birth_date:'1990-04-03',active:true}}});
 assert.equal(inactiveFacts.status(),200);
 current=await (await page.request.get(origin+'/api/staff')).json();
 const schedule=await page.request.post(origin+'/api/staff',{headers:{Origin:origin},data:{action:'schedule',request_id:crypto.randomUUID(),revision:current.revision,employee_id:incompleteId,from:'2026-11-16',minutes:[480,480,480,480,480,0,0],reason:'Contracted hours in the test fixture'}});
 assert.equal(schedule.status(),200);
 await page.reload();await page.getByRole('button',{name:'Lone',exact:true}).click();
 const open=async()=>{await page.locator('[data-wage="'+id+'"]').waitFor({state:'visible'});if(!await page.locator('[data-facts="'+id+'"]').count() && !await page.locator('[data-slip="'+id+'"]').count())await page.locator('[data-toggle="'+id+'"]').first().click();};
 await page.getByText('Nog geen finale bedrag',{exact:true}).waitFor();
 await page.locator('[data-toggle="'+incompleteId+'"]').first().click();
 await page.locator('[data-absence="'+incompleteId+'"]').click();
 await page.getByRole('button',{name:'Stoor',exact:true}).click();
 await page.getByRole('alert').filter({hasText:/Kontroleer die veld/}).waitFor();
 await page.locator('#editor [name=cover]').check();
 await page.locator('#editor [name=extra]').fill('5');
 await page.getByLabel('Hoekom verander jy dit?').fill('Synthetic employer paid illness and five extra hours');
 // The second employee deliberately has no pay profile. The failed save must
 // preserve the form and explain the rate needed for the extra hours.
 await page.getByRole('button',{name:'Stoor',exact:true}).click();
 await page.getByRole('alert').filter({hasText:/uurtarief/}).waitFor();
 await page.locator('#editor [name=extra]').fill('');
 await save();
 const checkedStaff=await (await page.request.get(origin+'/api/staff')).json();
 assert.equal(checkedStaff.state.leave.filter(l=>l.employee_id===incompleteId&&l.paid_minutes===480).length,5);
 await open();
 const wageCard=page.locator('[data-wage="'+id+'"]');
 await wageCard.locator('.daily-breaks summary').click();
 const clockDay=fenHourly?'2026-11-17':'2026-11-16';
 const changeClock=async delta=>{
  await wageCard.locator('[data-clock-day="'+clockDay+'"]').click();
  const time=page.getByLabel('Plaaslike kloktyd').last();
  const at=await time.inputValue(),hour=at.slice(0,14);
  await time.fill(hour+(delta?'01':'00'));
  await page.locator('#editor [name=reason]').fill('Verified synthetic clock correction');
  await save();
 };
 await changeClock(true);
 let evidence=await (await page.request.get(origin+'/api/staff/hours?employee_id='+id+'&from='+clockDay+'&to='+clockDay)).json();
 assert.equal(new Date(evidence.shifts[0].punches.at(-1).at).getUTCMinutes(),1);
 await wageCard.locator('.daily-breaks summary').click();
 await changeClock(false);
 await open();
 if(fenHourly){
  await page.getByRole('button',{name:'Ander goedgekeurde afdae',exact:true}).click();await page.getByLabel('2026-11-16').check();await page.getByLabel('Hoekom verander jy dit?').fill('Verified paid Monday');await save();
 }
 await open();await page.locator('[data-facts="'+id+'"]').click();await page.getByLabel(/Die vorige loonstaat bevestig/).check();
 await page.getByLabel('Hoekom verander jy dit?').fill('Verified room under the November ceiling');
 await save();
 const get=async()=>await (await page.request.get(origin+'/api/staff/payroll?view=wages&pay_date=2026-11-20')).json();
 let result=await get(),paidRow=result.run.rows.find(r=>r.employee_id===id);
 const expectedNet=fenHourly?170537:Math.round(204000-2040-2400),expectedUif=fenHourly?1723:2040;
 assert.equal(paidRow.gross_cents,fenHourly?172260:204000);
 assert.equal(paidRow.net_cents,expectedNet,JSON.stringify(paidRow.issues));assert.equal(paidRow.ready,true);
 assert.equal(result.run.rows.find(r=>r.employee_id===incompleteId).net_cents,null);
 await page.locator('[data-wage="'+incompleteId+'"]').getByText('Kort inligting',{exact:true}).waitFor({state:'visible'});
 assert.equal(paidRow.wage_state,undefined);
 await page.evaluate(()=>{window.__prints=0;window.print=()=>{window.__prints++;window.dispatchEvent(new Event('beforeprint'));window.dispatchEvent(new Event('afterprint'));};});
 await page.getByRole('button',{name:'Druk betaalstaat'}).click();await page.waitForFunction(()=>window.__prints===1);
 const printText=await page.locator('#payroll-print').innerText();assert.ok(printText.includes('Synthetic second worker')&&printText.includes('Kort inligting'));
 const pdfDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Laai PDF af'}).click();await (await pdfDownload).saveAs(join(out,'betaalstaat.pdf'));assert.equal((await readFile(join(out,'betaalstaat.pdf'))).subarray(0,5).toString(),'%PDF-');
 const payCommand=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/staff/payroll'));
 await page.locator('[data-method="'+id+'"]').selectOption('Cash');await page.locator('[data-paid="'+id+'"]').click();
 await page.locator('[data-wage="'+id+'"] [data-state=paid]').waitFor();const sent=(await payCommand).postDataJSON();
 const paid=await get();assert.equal(paid.run.rows.find(r=>r.employee_id===id).paid_by,fenHourly?'alinda':'alex');
 const retry=await page.request.post(origin+'/api/staff/payroll',{headers:{Origin:origin},data:sent});assert.equal(retry.status(),200);assert.equal((await retry.json()).replayed,true);
 const duplicate=await page.request.post(origin+'/api/staff/payroll',{headers:{Origin:origin},data:{...sent,request_id:crypto.randomUUID(),payroll_revision:paid.revision}});assert.equal(duplicate.status(),409);
 assert.equal((await get()).revision,paid.revision);
 await open();await page.locator('[data-slip="'+id+'"]').click();await page.waitForFunction(()=>window.__prints===2);
 assert.match(await page.locator('#payroll-print').innerText(),/Kontant/);await page.emulateMedia({media:'print'});if(!ipadSafari)await page.pdf({path:join(out,'synthetic-payslip.pdf')});await page.emulateMedia({media:'screen'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(out,'pay-wages-ipad.png'),fullPage:true});
 await page.getByRole('button',{name:'Maand se UIF',exact:true}).click();await page.getByText('Die maand se lone en UIF',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,'payroll-month-phone.png'),fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Laai sigblad af',exact:true}).click();await (await download).saveAs(join(out,'synthetic-month.csv'));assert.match(await readFile(join(out,'synthetic-month.csv'),'utf8'),/November is onvolledig/);
 await page.getByRole('button',{name:'Druk verslag',exact:true}).click();await page.waitForFunction(()=>window.__prints===3);assert.equal(await page.locator('#payroll-print .payslip').count(),0,'monthly print replaces selected payslip');await page.emulateMedia({media:'print'});assert.match(await page.locator('#payroll-print').innerText(),/November is onvolledig/);if(!ipadSafari)await page.pdf({path:join(out,'synthetic-month.pdf'),preferCSSPageSize:true});await page.emulateMedia({media:'screen'});
 await page.reload();await page.getByRole('button',{name:'Lone',exact:true}).click();await page.getByRole('button',{name:'Vorige weke',exact:true}).last().click();await page.getByRole('button',{name:'Maak week oop',exact:true}).click();await page.locator('[data-wage="'+id+'"] [data-state=paid]').waitFor();result=await (await page.request.get(origin+'/api/staff/payroll?pay_date=2026-11-20')).json();assert.equal(result.run.rows.find(r=>r.employee_id===id).wage_state,'Paid');assert.equal(result.run.status,'Draft');assert.equal(result.month.rows[0].uif_total_cents,2*expectedUif);assert.deepEqual(errors,[]);
 console.log('PASS: Alinda session, fresh start, existing profiles, weekly SARS PAYE, November UIF, weekly approval/payment, desktop/390px layout, persistent payslip/month print, CSV and reload. Synthetic data only.');
}catch(error){console.error('Browser errors:',errors);
 if(page)console.error('Synthetic screen at failure:',await page.locator('#action-dialog[open], #notice, #payroll-root h2').allTextContents().catch(()=>[]));
 throw error;}finally{await browser?.close();await mf.dispose();await rm(directory,{recursive:true,force:true});}
