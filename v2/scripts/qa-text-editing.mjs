// Real browser acceptance against shipped assets and synthetic read-only APIs.
// No live credentials, database, business data or external network requests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
const {chromium, webkit, devices} = await import(process.env.TEXT_PLAYWRIGHT_MODULE || 'playwright');
const folder = process.env.TEXT_QA_OUTPUT || '/tmp/fenmeat-text-editing';
await mkdir(folder, {recursive:true});
const original = 'Dis n ou rekening.';
const app = {username:'alex',admin:true,today:'2026-11-12',users:['alex'],suppliers:[],tasks:[],notifications:[],next_offset:null};
const pa = {private_report:true,register_revision:1,source_at:'2026-11-12T12:00:00Z',history:[],alerts:[],reminders:[],users:['alex'],feedback:[],rows:[{id:'TSK-TEST',subject_key:'TSK-TEST',subject_hash:'synthetic',scope:'fenmeat',title:'Synthetic editing check',status:'Pending',assigned_to:'alex',next_action:'Check text editing only.'}]};
const publicDir = resolve('public'), writes = [];
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:20px sans-serif;margin:16px}input,textarea{font:20px sans-serif;width:260px;display:block;margin:8px 0;padding:8px}label,button{display:block;margin:12px 0}</style><script type="module">import {installInputSelection} from '/invoicing/input-selection.js';installInputSelection();document.querySelector('button').onclick=()=>document.querySelector('main').insertAdjacentHTML('beforeend','<label>Dynamic note<textarea>Dis n ou rekening.</textarea></label>');</script></head><body><h1>Numeric and text checks</h1><main><label>Amount<input inputmode="decimal" value="1250,75"></label><label>Quantity<input inputmode="numeric" value="27"></label><label>Native number<input type="number" value="12.5"></label><label>Product description<input value="Dis n ou rekening."></label><label>Notes<textarea>Dis n ou rekening.</textarea></label><button>Add field</button></main></body></html>`;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){writes.push(req.url);res.writeHead(405);return res.end('Read-only test server');}
  if(url.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify(url.pathname==='/api/pa-report'?pa:url.pathname==='/api/tasks/emails'?{requests:[]}:app));
  }
  if(url.pathname==='/selection-qa'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
  const path=resolve(publicDir,'.'+(url.pathname==='/tasks'?'/tasks.html':url.pathname));
  if(!path.startsWith(publicDir+'/')){res.writeHead(404);return res.end();}
  try{const bytes=await readFile(path);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profiles=[['chromium-desktop',chromium,{}],['chromium-android',chromium,devices['Pixel 7']],['webkit-desktop',webkit,{}],['webkit-iphone',webkit,devices['iPhone 13']],['webkit-ipad',webkit,devices['iPad Pro 11']]];
const selected=process.env.TEXT_BROWSER;
try{
 for(const [name,engine,device] of profiles){
  if(selected&&!name.startsWith(selected))continue;
  const browser=await engine.launch({headless:true});
  try{
   const {defaultBrowserType,...options}=device;
   const context=await browser.newContext({...options,timezoneId:'Africa/Johannesburg'});
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{window.testPointers=[];document.addEventListener('pointerdown',e=>window.testPointers.push(e.pointerType));});
   async function frames(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
   async function caret(field,index){
    await field.scrollIntoViewIfNeeded();
    const point=await field.evaluate((e,index)=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),c=document.createElement('canvas').getContext('2d');c.font=s.font;return {x:r.x+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft)+c.measureText(e.value.slice(0,index)).width+0.1,y:r.y+parseFloat(s.borderTopWidth)+parseFloat(s.paddingTop)+parseFloat(s.fontSize)/2};},index);
    if(device.hasTouch)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
    await frames();assert.deepEqual(await field.evaluate(e=>[e.selectionStart,e.selectionEnd]),[index,index],name+' exact caret');
   }
   async function editWord(field){
    assert.equal(await field.inputValue(),original);
    await page.getByRole('heading').first().click();
    await caret(field,6);
    await field.press('Shift+ArrowRight');await field.press('Shift+ArrowRight');
    assert.deepEqual(await field.evaluate(e=>[e.selectionStart,e.selectionEnd]),[6,8],name+' manual selection');
    await page.keyboard.insertText('nuut');
    assert.equal(await field.inputValue(),'Dis n nuut rekening.',name+' one-word replacement');
    await caret(field,6);await page.keyboard.insertText('baie ');
    assert.equal(await field.inputValue(),'Dis n baie nuut rekening.',name+' insert in sentence');
    await field.press('Backspace');
    assert.equal(await field.inputValue(),'Dis n baienuut rekening.',name+' delete one character');
   }
   // This is the actual PA answer dialog and its normal shared input module.
   await page.goto(origin+'/tasks');
   await page.locator('[data-pa-action="respond"]').click();
   const reply=page.getByLabel('Jou antwoord',{exact:true});
   await reply.fill(original); // Existing, unsaved draft; no save action is used.
   await editWord(reply);
   assert.deepEqual(writes,[]);
   page.on('dialog',dialog=>dialog.accept());
   await page.goto(origin+'/selection-qa');
   for(const label of ['Product description','Notes'])await editWord(page.getByLabel(label,{exact:true}));
   await page.getByRole('button',{name:'Add field'}).click();await editWord(page.getByLabel('Dynamic note'));
   for(const label of ['Amount','Quantity']){
    const field=page.getByLabel(label,{exact:true}),value=await field.inputValue();
    if(device.hasTouch)await field.tap();else await field.click();await frames();
    assert.deepEqual(await field.evaluate(e=>[e.selectionStart,e.selectionEnd]),[0,value.length],name+' numeric select-all');
    await page.keyboard.insertText(label==='Amount'?'75,25':'9');
    assert.equal(await field.inputValue(),label==='Amount'?'75,25':'9');
   }
   const native=page.getByLabel('Native number');
   if(device.hasTouch)await native.tap();else await native.click();await frames();await page.keyboard.insertText('7');assert.equal(await native.inputValue(),'7');
   // Native copy/paste via the browser clipboard, with no clipboard mock.
   const notes=page.getByLabel('Notes',{exact:true});await notes.fill('Copy this word.');await notes.press('Home');
   for(let i=0;i<4;i++)await notes.press('Shift+ArrowRight');
   await notes.press('Control+c');await notes.press('End');await notes.press('Control+v');
   assert.equal(await notes.inputValue(),'Copy this word.Copy',name+' native copy and paste');
   if(device.hasTouch)assert.ok((await page.evaluate(()=>window.testPointers)).includes('touch'),name+' touch events sent');
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   await page.screenshot({path:folder+'/'+name+'.png',fullPage:true});
   console.log('PASS '+name+': PA draft, exact tap caret, word replacement, insertion/deletion, manual selection, native copy/paste, dynamic fields, decimal/integer/native-number replacement, zero API writes');
  }finally{await browser.close();}
 }
}finally{await new Promise(resolve=>server.close(resolve));}
