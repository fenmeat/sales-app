// Local UI acceptance with synthetic data only. Never point this at a live site.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {sourceFixture} from '../test/fixtures/staff-source.js';
const {chromium}=await import(process.env.STAFF_PLAYWRIGHT_MODULE??'playwright');
const directory=await mkdtemp(join(tmpdir(),'fen-import-browser-')),origin='http://localhost:8798',key='synthetic-import-browser-key-'.repeat(3);
const mf=new Miniflare(convertV4MiniflareOptions({name:'staff-import-browser',host:'127.0.0.1',port:8798,modules:['worker','staff-api','payroll-api','payroll-domain','staff-domain','staff-import','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching','zoho-reconcile'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'staff-import-browser'},resourcePersistencePath:directory,bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key})},outboundService:()=>{throw Error('No external traffic');}}));
let browser;const errors=[];
try{
 await mf.ready;browser=await chromium.launch({executablePath:process.env.STAFF_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 assert.equal((await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{username:'alex',key}})).status(),200);
 await page.goto(origin+'/staff');await page.getByRole('button',{name:'Imported records',exact:true}).click();await page.getByText('Import the original records',{exact:true}).click();
 const bundle=sourceFixture();for(let i=0;i<80;i++)bundle.sheets.at(-1).rows.push({number:i+3,cells:[{formattedValue:'Synthetic padded source '+i+' '+'.'.repeat(4000)}]});
 await page.getByLabel('Staff transfer file').setInputFiles({name:'synthetic-staff-transfer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await page.getByText('Ready to import. Records will be private to Alex and Alinda.',{exact:true}).waitFor();
 let dropped=false;await page.route('**/api/staff/imports/finish',async route=>{if(dropped)return route.continue();dropped=true;const r=await route.fetch();assert.equal(r.status(),200);await route.abort('connectionfailed');});
 await page.getByRole('button',{name:'Import all records',exact:true}).click();await page.locator('#source-import-progress').filter({hasText:'Choose the same file to resume safely.'}).waitFor();
 await page.getByRole('button',{name:'Import all records',exact:true}).click();await page.getByText('Import verified and saved',{exact:true}).waitFor();
 const state=await(await page.request.get(origin+'/api/staff')).json();assert.equal(state.revision,1);assert.equal(state.people.length,5);assert.equal(state.state.ledger.length,0);assert.equal(state.pin_secret_configured,false);
 const imports=await(await page.request.get(origin+'/api/staff/imports')).json(),id=imports.imports[0].id;assert.deepEqual((await(await page.request.get(origin+'/api/staff/imports/export?id='+id)).json()).bundle,bundle);
 await page.getByRole('button',{name:'Browse all records',exact:true}).click();await page.getByLabel('Find a name, date or value').fill('Synthetic');await page.getByRole('button',{name:'Find records',exact:true}).click();await page.getByText('Clock Log · 1–3 of 3 matching source rows',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'source view fits mobile');
 await page.getByRole('button',{name:'People',exact:true}).click();await page.getByRole('button',{name:'Imported details',exact:true}).first().click();await page.getByRole('heading',{name:'Imported employee details',exact:true}).waitFor();await page.getByText('Private identity & bank details',{exact:true}).click();await page.getByText('Account: 00001234',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'profile fits mobile');await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Confirm start date',exact:true}).first().click();await page.getByLabel('Verified employment start').fill('2023-03-16');await page.getByLabel('Source / reason').fill('Synthetic verified employment agreement');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Employment start: 2023-03-16',{exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'People',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Imported details',exact:true}).count(),5);assert.deepEqual(errors,[]);
 console.log('PASS: actual private import UI, multiple chunks, lost commit response/retry, complete source readback, source search, profiles, date confirmation, reload and mobile layout.');
}finally{await browser?.close();await mf.dispose();await rm(directory,{recursive:true,force:true});}
