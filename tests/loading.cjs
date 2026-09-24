// No live API traffic or writes: run with `node tests/loading.cjs` and Playwright installed.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  const baseline = req.url.startsWith('/baseline/');
  const name = req.url.split('/').pop() || 'index.html';
  try {
    const content = baseline ? execFileSync('git', ['show', 'c729310:'+name], {cwd:root}) : fs.readFileSync(path.join(root,name));
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(content);
  } catch(e) { res.writeHead(404).end(); }
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  async function setup(options={}) {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const calls=[], errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.addInitScript(() => {
      const D=Date; window.Date=class extends D {constructor(...args){super(...(args.length?args:['2026-09-24T08:00:00+02:00']));} static now(){return new D('2026-09-24T08:00:00+02:00').getTime();}};
    });
    await page.route('**/*', async r => {
      const u=new URL(r.request().url());
      if(u.origin===origin) return r.continue();
      calls.push({url:u.href, action:u.searchParams.get('action'), route:u.searchParams.get('route'), date:u.searchParams.get('date')});
      assert.equal(r.request().method(),'GET','Tests must never send writes');
      if(u.hostname==='cdnjs.cloudflare.com') return r.fulfill({contentType:'text/javascript',body:'window.jspdf = { jsPDF: function() {} };'});
      if(u.hostname!=='script.google.com') {
        if(options.slowFonts) await delay(1500);
        return r.fulfill({body:''});
      }
      const action=u.searchParams.get('action'), route=u.searchParams.get('route'), date=u.searchParams.get('date');
      await delay(options.latency ? options.latency(action,route,date) : 150);
      let data={status:'ok',found:true,products:[]};
      if(action==='getStockStatus') data.products=[{code:'W02',inStock:false},{code:'W03',inStock:false}];
      if(action==='getForecast') data.products=[{code:'W01',qty:20},{code:'W02',qty:10},{code:'W03',qty:7}];
      if(action==='getLoadLog') data.products=[{code:'W01',qty:12},{code:'W02',qty:5}];
      if(action==='getSalesLog') data.products=[{code:'W01',sold:9},{code:'W02',sold:3}];
      if(action==='getZohoItemSales') data.products=[{code:'W01',zohoQty:9}];
      if(action==='getCashUpLog'||action==='getCommissionLog'||action==='getZohoSyncForRoute') data={status:'ok',found:false};
      if(options.reply) data=options.reply(action,route,date,data);
      if(data===null) return r.fulfill({status:503,body:'unavailable'});
      return r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    const started=performance.now();
    await page.goto(origin+(options.baseline?'/baseline/':'/'),{waitUntil:'domcontentloaded'});
    return {page,calls,errors,started};
  }
  try {
    const before=await setup({baseline:true});
    await before.page.waitForFunction(()=>state.forecastLoaded);
    const beforeMs=performance.now()-before.started;
    await before.page.close();
    const after=await setup();
    await after.page.waitForFunction(()=>state.forecastLoaded);
    const afterMs=performance.now()-after.started;
    assert.ok(afterMs<beforeMs*0.7,`Expected startup improvement: ${beforeMs} -> ${afterMs}`);
    assert.equal(after.calls.filter(c=>c.action==='ping').length,0);
    assert.equal(after.calls.filter(c=>c.url.includes('jspdf')).length,0);
    const products=await after.page.evaluate(()=>state.routeData[state.activeRoute].products.slice(0,3));
    assert.equal(products[0].out,12);assert.equal(products[0].inQty,3);
    assert.equal(products[1].out,5);assert.equal(products[1].inQty,2);
    assert.equal(products[2].out,0);assert.equal(products[2].suppressedOut,7);
    await after.page.evaluate(()=>Promise.all([ensurePdfLibrary(),ensurePdfLibrary()]));
    assert.equal(after.calls.filter(c=>c.url.includes('jspdf')).length,1);
    await after.page.click('#btnEvening');
    await after.page.waitForFunction(()=>state.routeData[state.activeRoute].products[0].zohoQty===9);
    await after.page.screenshot({path:'/tmp/sales-app-review-mobile.png',fullPage:true});
    assert.deepEqual(after.errors,[]);
    await after.page.close();
    console.log(`PASS startup: baseline ${Math.round(beforeMs)}ms, review ${Math.round(afterMs)}ms (mock 150ms/read; not live timing)`);
    console.log('PASS saved OUT/IN, hidden loaded records, suppressed forecasts, PDF on demand and mobile Evening render');

    const partial=await setup({latency:(a,r)=>r==='PLETT'?1200:80});
    await partial.page.waitForFunction(()=>state.routeData['MOSSEL BAY'].products[0].loaded);
    assert.equal(await partial.page.evaluate(()=>state.routeData.PLETT.products[0].loaded),false);
    await partial.page.evaluate(()=>updateOut(0,33));
    await partial.page.waitForFunction(()=>state.forecastLoaded);
    assert.equal(await partial.page.evaluate(()=>state.routeData['MOSSEL BAY'].products[0].out),33);
    assert.deepEqual(partial.errors,[]);await partial.page.close();
    console.log('PASS first route usable before slow second route; later completion preserves edits');

    let fail=true;
    const failure=await setup({reply:(a,r,d,data)=>a==='getSalesLog'&&r==='MOSSEL BAY'&&fail?null:data});
    await failure.page.getByRole('button',{name:'Retry this route'}).waitFor();
    assert.equal(await failure.page.evaluate(()=>state.routeData['MOSSEL BAY'].products[0].loaded),false);
    fail=false; await failure.page.getByRole('button',{name:'Retry this route'}).click();
    await failure.page.waitForFunction(()=>state.routeData['MOSSEL BAY'].products[0].loaded);
    assert.equal(await failure.page.evaluate(()=>state.routeData['MOSSEL BAY'].products[0].inQty),3);
    await failure.page.close();console.log('PASS failed saved-log read blocks capture and route retry restores data');

    const race=await setup({latency:(a,r,d)=>d==='2026-09-24'?900:30,
      reply:(a,r,d,data)=>a==='getLoadLog'?{status:'ok',found:true,products:[{code:'W01',qty:d==='2026-10-01'?30:12}]}:data});
    await race.page.fill('#dateInput','2026-10-01');
    await race.page.dispatchEvent('#dateInput','change');
    await race.page.waitForFunction(()=>state.forecastLoaded);
    await delay(1100);
    assert.equal(await race.page.evaluate(()=>state.date),'2026-10-01');
    assert.equal(await race.page.evaluate(()=>state.routeData['MOSSEL BAY'].products[0].out),30);
    assert.deepEqual(race.errors,[]);await race.page.close();console.log('PASS obsolete responses cannot overwrite new date (same routes)');

    const fonts=await setup({slowFonts:true});
    await fonts.page.waitForFunction(()=>state.forecastLoaded);
    assert.ok(performance.now()-fonts.started<1000,'Font downloads must not delay route data');
    await fonts.page.close();console.log('PASS slow font service does not hold up startup');

    let stockFails=true;
    const stock=await setup({reply:(a,r,d,data)=>a==='getStockStatus'&&stockFails?null:data});
    await stock.page.getByRole('button',{name:'Retry this route'}).waitFor();
    await stock.page.click('#btnStock');
    await stock.page.getByRole('button',{name:'Retry',exact:true}).waitFor();
    stockFails=false;await stock.page.getByRole('button',{name:'Retry',exact:true}).click();
    await stock.page.waitForFunction(()=>state.stockLoaded);
    assert.deepEqual(stock.errors,[]);await stock.page.close();console.log('PASS stock failure blocks stock edits and retries');

    const fallback=await setup({reply:(a,r,d,data)=>a==='getForecast'?{status:'ok',products:[]}:a==='getNewForecast'?{status:'ok',products:[{code:'W03',avg_qty:6.6}]}:data});
    await fallback.page.waitForFunction(()=>state.forecastLoaded);
    assert.equal(await fallback.page.evaluate(()=>state.routeData['MOSSEL BAY'].products[2].forecast),7);
    await fallback.page.close();console.log('PASS empty dated forecast uses rounded weekly fallback');

    const cash=await setup({latency:(a)=>a==='getCashUpLog'||a==='getCommissionLog'?800:30});
    await cash.page.waitForFunction(()=>state.forecastLoaded);
    await cash.page.click('#btnCashUp');await cash.page.click('#btnMorning');
    await delay(900);assert.deepEqual(cash.errors,[]);
    assert.equal(cash.calls.filter(c=>c.action==='getZohoSyncForRoute').length,0);
    await cash.page.close();console.log('PASS late Cash Up read cannot overwrite another view');

    const missing=await setup({reply:(a,r,d,data)=>a==='getLoadLog'?{status:'ok',found:false}:data});
    await missing.page.waitForFunction(()=>state.forecastLoaded);
    assert.equal(await missing.page.evaluate(()=>state.routeData['MOSSEL BAY'].products[0].out),20);
    await missing.page.close();console.log('PASS confirmed missing load uses forecast');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
