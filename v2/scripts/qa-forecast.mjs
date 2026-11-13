// Real shipped UI, isolated synthetic APIs; never contacts the live app.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {emptyRun,summarise} from '../src/domain.js';
import {applyForecastRefresh} from '../src/forecast-history.js';
const {chromium,webkit,devices}=await import(process.env.TEXT_PLAYWRIGHT_MODULE||'playwright');
const out=process.env.FORECAST_QA_OUTPUT||'/tmp/fenmeat-forecast';await mkdir(out,{recursive:true});
const products=[{code:'A',name:'SYNTHETIC BRAAI WORS',unit:'bag: 10 packs',price_cents:100,active:true,available:true},{code:'B',name:'SYNTHETIC SECOND PRODUCT',unit:'bag: 5 packs',price_cents:100,active:true,available:true}];
const f={qty:34,base:24.423,buffer:9,samples:12,used_samples:8,last_date:'2026-11-09',last_qty:22,last_returned:14,recent_sales_minimum:26,recent_sales_buffer:4,recent_sales_uplift:0,warning:'Provisional actuals: invoice reconciliation unverified.'};
const initial=emptyRun('2026-11-16','R01',products,{A:f,B:{...f,qty:0,base:0,last_qty:0,last_returned:6}});initial.items[0].planned=0;initial.items[1].planned=7;initial.notes='Keep manual choices.';
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
   assert.equal(u.pathname,'/api/run');assert.equal(b.action,'forecast');assert.deepEqual(b.run.items.map(i=>i.planned),[0,7]);
   run=applyForecastRefresh(run,{snapshot:'new',forecasts:{A:f,B:initial.items[1].forecast}});revision++;
  }
  return res.end(JSON.stringify(u.pathname==='/api/health'?{access_configured:true,database:'connected'}:u.pathname==='/api/bootstrap'?bootstrap:{run,revision,summary:summarise(run),forecast_status:{...status,stale:revision===7}}));
 }
 const file=resolve(publicDir,'.'+(u.pathname==='/sales'?'/sales.html':u.pathname));
 if(!file.startsWith(publicDir+'/')){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const profiles=[['chromium-phone',chromium,devices['Pixel 7']],['chromium-small-phone',chromium,{viewport:{width:320,height:740},isMobile:true,hasTouch:true}],['chromium-tablet',chromium,devices['iPad Pro 11']],['webkit-iphone',webkit,devices['iPhone 13']],['webkit-ipad',webkit,devices['iPad Pro 11']]];
try{for(const [name,engine,device]of profiles){
 if(process.env.TEXT_BROWSER&&!name.startsWith(process.env.TEXT_BROWSER))continue;
 run=structuredClone(initial);revision=7;
 const browser=await engine.launch({headless:true,...(engine===chromium&&process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:engine===chromium?['--no-sandbox']:[]});
 try{const {defaultBrowserType,...opts}=device,context=await browser.newContext({...opts,timezoneId:'Africa/Johannesburg'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('fm_sales_selection:alex',JSON.stringify({date:'2026-11-16',route:'R01',tab:'morning'})));
 await page.goto(origin+'/sales');await page.getByRole('heading',{name:'Morning load',exact:true}).waitFor();
 const card=page.locator('tbody tr').filter({hasText:'SYNTHETIC BRAAI WORS'}),summary=card.locator('.forecast-summary');
 assert.match(await summary.innerText(),/Expected sales\s+25/);assert.match(await summary.innerText(),/Safety stock\s+9/);assert.match(await summary.innerText(),/Last visit returned\s+14/);
 assert.equal(await card.locator('.forecast').innerText(),'34');assert.equal(await page.getByLabel('SYNTHETIC BRAAI WORS planned',{exact:true}).inputValue(),'0');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,name+' no horizontal overflow');
 assert.ok((await summary.locator('div').evaluateAll(es=>es.map(e=>e.scrollWidth<=e.clientWidth+1))).every(Boolean),name+' visible figures fit');
 await page.getByRole('button',{name:'Refresh suggestions',exact:true}).click();await page.getByText('Forecast checked · View details',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('SYNTHETIC BRAAI WORS planned',{exact:true}).inputValue(),'0');assert.equal(await page.getByLabel('SYNTHETIC SECOND PRODUCT planned',{exact:true}).inputValue(),'7');
 await page.getByLabel('SYNTHETIC BRAAI WORS planned',{exact:true}).fill('29');assert.equal(await page.getByLabel('SYNTHETIC BRAAI WORS planned',{exact:true}).inputValue(),'29');
 await card.locator('.capture-product-details summary').click();assert.match(await card.innerText(),/allowances are never added together/);
 await card.locator('.capture-product-details summary').click();await card.screenshot({path:out+'/'+name+'-card.png'});await page.screenshot({path:out+'/'+name+'.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log(name+': passed; figures, details, retained plans, editable plan, responsive layout.');
 }finally{await browser.close();}
}}finally{server.close();}
assert.ok(writes.length>0);assert.ok(writes.every(w=>w.action==='forecast'));console.log('Only isolated fixture refreshes; no live API writes.');
