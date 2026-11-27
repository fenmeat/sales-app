// Synthetic isolated Worker + D1 browser acceptance. Never calls production.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {hash} from '../src/auth.js';
const {chromium,webkit,devices}=await import(process.env.STAFF_PLAYWRIGHT_MODULE??'playwright');
const origin='http://localhost:8798',key='synthetic-admin-key-'.repeat(3);
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,format:'esm',platform:'browser',write:false});
const mf=new Miniflare(convertV4MiniflareOptions({name:'staff-clock-qa',host:'127.0.0.1',port:8798,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'qa-clock'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key}),STAFF_PIN_PEPPER:'synthetic-pepper-'.repeat(4)},assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},outboundService:()=>{throw Error('External traffic blocked');}}));
try{
 await mf.ready;await mf.dispatchFetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'alex',key})});
 const db=await mf.getD1Database('DB');let version=0;
 for(const [profile,engine] of [['Desktop Chrome',chromium],['Pixel 7',chromium],['iPhone 13',webkit],['iPad (gen 7)',webkit]]){
  const browser=await (process.env.STAFF_BROWSER_EXECUTABLE?chromium:engine).launch(process.env.STAFF_BROWSER_EXECUTABLE?{executablePath:process.env.STAFF_BROWSER_EXECUTABLE}:{});
  try{
   const context=await browser.newContext({...devices[profile],timezoneId:'Africa/Johannesburg'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const employee=crypto.randomUUID(),person={id:employee,code:'QA',name:'Synthetic Employee',active:true,start_date:'2026-01-01',employment_type:'Casual',casual_pin_slot:1,schedules:[]};
   await db.prepare('INSERT INTO v2_staff_register VALUES(?,?,?,?,?,?)').bind(++version,JSON.stringify({people:[person],leave:[],ledger:[]}),'fixture','fixture',new Date().toISOString(),'{}').run();
   const code=crypto.randomUUID().replaceAll('-','').slice(0,16),device=crypto.randomUUID();
   await db.prepare('INSERT INTO v2_staff_devices VALUES(?,?,?,?,NULL,0,0,?,?)').bind(device,'Synthetic '+profile,await hash(code),Date.now()+600000,'fixture',new Date().toISOString()).run();
   await page.goto(origin+'/staff-clock');await page.getByLabel('Device code').fill(code);await page.getByRole('button',{name:'Register this phone'}).click();
   await page.getByRole('button',{name:/Synthetic Employee/}).waitFor();await page.evaluate(()=>navigator.serviceWorker.ready);
   const action=async kind=>{await page.getByRole('button',{name:/Synthetic Employee/}).click();await page.getByLabel('PIN',{exact:true}).fill('0001');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:kind,exact:true}).click();await page.locator('#action-dialog').waitFor({state:'hidden'});};
   // Lost response after durable server commit. Reload retries the same UUID.
   let lost=false;await page.route('**/api/staff-clock/punch',async route=>{if(lost)return route.continue();lost=true;const r=await route.fetch();assert.equal(r.status(),200);return route.abort('connectionfailed');});
   await action('Clock in');await page.locator('#sync-state').filter({hasText:'wag nog'}).waitFor();
   await page.reload();await page.locator('#sync-state').filter({hasText:'Alle plaaslike'}).waitFor();
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_staff_time WHERE employee_id=?').bind(employee).first()).n,1);
   await action('Start break');await page.locator('#sync-state').filter({hasText:'Alle plaaslike'}).waitFor();
   await context.setOffline(true);await action('End break');await page.reload();await page.getByRole('button',{name:/Synthetic Employee/}).waitFor();await action('Clock out');
   const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('fenmeat-clock-durable-v2')).queue);assert.equal(queued.length,2);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await context.setOffline(false);await page.locator('#sync-state').filter({hasText:'Alle plaaslike'}).waitFor();
   const rows=(await db.prepare('SELECT payload FROM v2_staff_time WHERE employee_id=? ORDER BY revision').bind(employee).all()).results;assert.equal(rows.length,4);
   const punches=JSON.parse(rows.at(-1).payload).punches;assert.deepEqual(punches.map(p=>p.kind),['in','break_start','break_end','out']);assert.equal(punches[2].at,queued[0].captured_at);assert.equal(punches[3].at,queued[1].captured_at);
   assert.equal((await page.request.get(origin+'/api/staff')).status(),401);assert.deepEqual(errors,[]);
   console.log('PASS '+profile+': PIN, clock, break, lost response, offline reload, original-time sync, isolated access, responsive layout');
  }finally{await browser.close();}
 }
}finally{await mf.dispose();}
