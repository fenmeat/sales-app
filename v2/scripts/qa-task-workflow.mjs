// Isolated synthetic Worker and browser acceptance. Never uses live credentials/data.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const {chromium}=await import(process.env.TASKS_PLAYWRIGHT_MODULE||'playwright');
const origin='http://localhost:8798',key='synthetic-browser-key-'.repeat(3),errors=[];
const output=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser'});
const mf=new Miniflare(convertV4MiniflareOptions({name:'workflow-browser',host:'127.0.0.1',port:8798,modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-09-30',assets:{directory:new URL('../public/',import.meta.url).pathname,binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'workflow-browser'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key,alinda:key+'a',xavier:key+'x'})}}));
let browser;const folder='/tmp/fm-workflow-qa';await mkdir(folder,{recursive:true});
try{
 await mf.ready;browser=await chromium.launch({executablePath:process.env.TASKS_BROWSER_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:834,height:1112},timezoneId:'Africa/Johannesburg'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 assert.equal((await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{username:'alex',key}})).status(),200);
 await page.goto(origin+'/tasks');await page.locator('#new').click();await page.locator('[name=title]').fill('Synthetic diesel reminder');await page.locator('dialog button[type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.locator('[data-complete]').click();await page.locator('dialog button[type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.locator('#filter').selectOption('closed');await page.getByRole('heading',{name:'Synthetic diesel reminder'}).waitFor();
 await page.locator('#new').click();await page.locator('[name=title]').fill('Synthetic supplier workflow');await page.locator('[name=task_type]').selectOption('workflow');await page.locator('[name=details]').fill('Check synthetic documents');await page.locator('dialog button[type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.locator('#filter').selectOption('open');await page.locator('[data-task]').click();
 await page.locator('#add-step').click();await page.locator('[name=description]').fill('Review the supplier statement on the agreed future date');await page.locator('[name=due_date]').fill('2099-11-30');await page.locator('[name=status]').selectOption('Scheduled');await page.locator('[name=dependency]').check();await page.locator('dialog button[type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.locator('[data-task]').click();await page.locator('[data-step-complete="step-1"]').click();await page.locator('[name=note]').fill('Documents verified in this synthetic test');await page.locator('dialog button[type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 assert.equal(await page.getByRole('heading',{name:'Synthetic supplier workflow'}).count(),0);await page.locator('#filter').selectOption('scheduled');await page.getByRole('heading',{name:'Synthetic supplier workflow'}).waitFor();await page.locator('[data-task]').click();await page.getByRole('heading',{name:'Stappe · 1 van 2 klaar'}).waitFor();
 for(const width of [320,390,834,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.screenshot({path:folder+'/workflow-'+width+'.png',fullPage:true});}
 await page.locator('[data-close]').click();await page.reload();await page.locator('#filter').selectOption('scheduled');await page.getByRole('heading',{name:'Synthetic supplier workflow'}).waitFor();
 await page.locator('[data-task]').click();await page.locator('[data-step-edit]').click();const field=page.locator('[name=description]');await field.focus();assert.deepEqual(await field.evaluate(e=>[e.selectionStart,e.selectionEnd]),[0,(await field.inputValue()).length]);
 assert.deepEqual(errors,[]);console.log('Browser PASS: create/complete reminder; create/add/edit/complete workflow steps; Scheduled exclusion; reload persistence; input selection; no overflow at 320/390/834/1280; no page errors.');
}finally{await browser?.close();await mf.dispose();}
