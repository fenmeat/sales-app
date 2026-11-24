// Real shipped UI, isolated synthetic APIs; never contacts the live app.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {emptyRun,summarise} from '../src/domain.js';
import {applyForecastRefresh} from '../src/forecast-history.js';
const {chromium,webkit,devices}=await import(process.env.TEXT_PLAYWRIGHT_MODULE||'playwright');
const out=process.env.FORECAST_QA_OUTPUT||'/tmp/fenmeat-forecast';await mkdir(out,{recursive:true});
const product=(code,name,unit)=>({code,name,unit,price_cents:8500,active:true,available:true});
const products=[
 product('A','SYNTHETIC CHAKALAKA','bag: 5 x 400 g'),
 product('B','SYNTHETIC BOX','box: 10 packs'),
 product('C','SYNTHETIC NEW PRODUCT','2 kg pack'),
 ...Array.from({length:56},(_,n)=>product('T'+n,'Test product '+n,'sales unit'))
];
const f={qty:22,base:14.479,buffer:7,samples:11,used_samples:7,last_date:'2026-11-09',last_qty:12,last_returned:11,recent_sales_minimum:15,recent_sales_buffer:3,recent_sales_uplift:0,month_cycle:{label:'Days 15–end',applied:true,factor:0.947,months:5},warning:'Provisional actuals: invoice reconciliation unverified.'};
const forecasts=Object.fromEntries(products.map(p=>[p.code,f]));
forecasts.B={qty:13,base:4.2,buffer:3,samples:1,used_samples:1,last_qty:10,last_returned:0,recent_sales_minimum:13,recent_sales_buffer:3,recent_sales_uplift:5,warning:'Limited history.'};
forecasts.C={qty:null,base:null,samples:0,warning:'No usable actual sales for this route and weekday.'};
const initial=emptyRun('2026-11-16','R01',products,forecasts);
initial.items[0].planned=0;initial.items[1].planned=7;initial.items[1].loaded=4;initial.notes='Keep manual choices.';
let run=structuredClone(initial),revision=7;
const bootstrap={username:'alex',today:'2026-11-13',capabilities:{},history:{rows:1,latest:'2026-11-09'},sync:[],zoho_connected:false,zoho:{},catalog:{products,routes:[{code:'R01',name:'SYNTHETIC ROUTE',weekday:1}]}};
const status={stale:true,expected_visit:'2026-11-09',latest_actual:'2026-11-09',expected_visit_present:true,excluded_count:0};
const writes=[],publicDir=resolve('public');
const server=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(u.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'){
   let text='';for await(const chunk of req)text+=chunk;const b=JSON.parse(text);writes.push(b);
   assert.equal(u.pathname,'/api/run');assert.equal(b.action,'forecast');assert.deepEqual(b.run.items.map(i=>i.planned),initial.items.map(i=>i.planned));
   assert.equal(b.run.items[1].loaded,4);assert.equal(b.run.notes,initial.notes);
   run=applyForecastRefresh(run,{snapshot:'new',forecasts});revision++;
  }
  return res.end(JSON.stringify(u.pathname==='/api/health'?{access_configured:true,database:'connected'}:u.pathname==='/api/bootstrap'?bootstrap:{run,revision,summary:summarise(run),forecast_status:{...status,stale:revision===7}}));
 }
 const file=resolve(publicDir,'.'+(u.pathname==='/sales'?'/sales.html':u.pathname));
 if(!file.startsWith(publicDir+'/')){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const profiles=[['chromium-phone',chromium,devices['Pixel 7']],['chromium-small-phone',chromium,{viewport:{width:320,height:740},isMobile:true,hasTouch:true}],['chromium-tablet',chromium,devices['iPad Pro 11']],['chromium-desktop',chromium,{viewport:{width:1440,height:900}}],['webkit-iphone',webkit,devices['iPhone 13']],['webkit-ipad',webkit,devices['iPad Pro 11']]];
try{for(const [name,engine,device]of profiles){
 if(process.env.TEXT_BROWSER&&!name.startsWith(process.env.TEXT_BROWSER))continue;
 run=structuredClone(initial);revision=7;
 const browser=await engine.launch({headless:true,...(engine===chromium&&process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:engine===chromium?['--no-sandbox']:[]});
 try{const {defaultBrowserType,...opts}=device,context=await browser.newContext({...opts,timezoneId:'Africa/Johannesburg'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('fm_sales_selection:alex',JSON.stringify({date:'2026-11-16',route:'R01',tab:'morning'})));
 await page.goto(origin+'/sales',{waitUntil:'commit'});await page.getByRole('heading',{name:'Morning load',exact:true}).waitFor();
 const loadMs=Math.round(await page.evaluate(()=>performance.now()));
 const cards=page.locator('.morning-table tbody tr'),card=cards.filter({hasText:'SYNTHETIC CHAKALAKA'});
 const rows=card.locator('.forecast-summary dd'),details=card.locator('.forecast-details'),forecast=card.locator('.forecast-breakdown');
 const plan=card.locator('[data-qty=planned]'),loaded=card.locator('[data-qty=loaded]');
 assert.equal(await cards.count(),products.length);
 assert.equal(await cards.locator('details[open]').count(),0);
 assert.equal(await rows.first().isVisible(),false);
 await forecast.locator('summary').click();
 assert.equal(await rows.first().isVisible(),true);
 assert.deepEqual(await rows.allTextContents(),['15','7','22','12','11']);
 assert.match(await card.innerText(),/Why 22 bags\?\s+15 expected sales \+ 7 extra bags to avoid running short/);
 assert.match(await card.innerText(),/Based on 7 similar visits. Sales not yet checked against invoices/);
 assert.equal(await details.locator('p').first().isVisible(),false);
 assert.equal(await plan.inputValue(),'0');
 const box=cards.filter({hasText:'SYNTHETIC BOX'}),newProduct=cards.filter({hasText:'SYNTHETIC NEW PRODUCT'});
 assert.deepEqual(await box.locator('.forecast-summary dd').allTextContents(),['5','8','13','10','0']);
 assert.match(await box.locator('.forecast-why').textContent(),/Why 13 boxes/);
 assert.match(await newProduct.locator('.forecast-why').textContent(),/No suggested load. Enter your own plan/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,name+' no horizontal overflow');
 assert.ok((await card.locator('.forecast-summary div').evaluateAll(es=>es.map(e=>e.scrollWidth<=e.clientWidth+1))).every(Boolean),name+' figures fit');
 assert.ok(await rows.first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=15));
 const beforeOpen=writes.length;
 await details.locator('summary').click();
 assert.match(await details.innerText(),/Recent-sales minimum: 12 sold \+ 3 extra = 15/);
 assert.equal(await rows.first().isVisible(),true);
 await forecast.locator('summary').click();
 assert.equal(await rows.first().isVisible(),false);
 assert.equal(await details.locator('p').first().isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,name+' open details fit');
 await details.locator('summary').click();
 assert.equal(writes.length,beforeOpen);
 await page.getByRole('button',{name:'Refresh suggestions',exact:true}).click();
 await page.getByText('Forecast checked · More details',{exact:true}).waitFor();
 assert.equal(await cards.locator('details[open]').count(),0);
 assert.equal(await plan.inputValue(),'0');assert.equal(await box.locator('[data-qty=planned]').inputValue(),'7');
 assert.equal(await box.locator('[data-qty=loaded]').inputValue(),'4');
 await plan.fill('29');await card.locator('[data-copy-plan]').click();
 assert.equal(await cards.locator('details[open]').count(),0);
 assert.equal(await loaded.inputValue(),'29');assert.equal(await rows.nth(2).textContent(),'22');
 // Choosing the whole-route suggestion is explicit; cancel keeps the edit.
 await page.locator('.capture-actions summary').click();
 page.once('dialog',d=>d.dismiss());await page.locator('#use-forecast').click();
 assert.equal(await plan.inputValue(),'29');
 page.once('dialog',d=>d.accept());await page.locator('#use-forecast').click();
 assert.equal(await plan.inputValue(),'22');assert.equal(await loaded.inputValue(),'29');
 await page.locator('.capture-actions summary').click();page.once('dialog',d=>d.accept());
 await page.locator('#use-plan').click();assert.equal(await loaded.inputValue(),'22');
 await card.screenshot({path:out+'/'+name+'-card.png'});await page.screenshot({path:out+'/'+name+'.png'});
 assert.deepEqual(errors,[]);console.log(name+': passed; '+products.length+' products, morning screen ready in '+loadMs+' ms; numbers, notes, retained plans, manual edits, copy controls and responsive layout.');
 }finally{await browser.close();}
}}finally{server.close();}
assert.ok(writes.length>0);assert.ok(writes.every(w=>w.action==='forecast'));console.log('Only isolated fixture refreshes; no live API writes.');
