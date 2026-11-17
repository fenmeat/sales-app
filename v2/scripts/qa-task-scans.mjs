// Camera pictures are supplied to each browser's actual file-picker event.
// No physical camera or live business records are used.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createCanvas} from '@napi-rs/canvas';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PDFDocument} from 'pdf-lib';

const pw=await import(process.env.TASKS_PLAYWRIGHT_MODULE||'playwright');
const out=process.env.TASKS_SCAN_QA||'/tmp/fenmeat-scan-qa';
await mkdir(out,{recursive:true});
function cameraPage(number){
  const canvas=createCanvas(1820,2370),c=canvas.getContext('2d');
  c.fillStyle='#404040';c.fillRect(0,0,1820,2370);
  const paper=createCanvas(1420,2020),p=paper.getContext('2d');
  p.fillStyle='#fafafa';p.fillRect(0,0,1420,2020);p.fillStyle='#242424';
  p.font='bold 62px sans-serif';p.fillText('INVOICE '+(7300+number),80,140);
  p.font='32px sans-serif';p.fillText('Delivery record - test copy',80,210);
  for(let i=0;i<19;i++){
    p.fillStyle='#202020';p.font='26px sans-serif';
    p.fillText('Item '+String(i+1).padStart(2,'0')+'   |   Packs received',90,380+i*67);p.fillText('R 125.50',1100,380+i*67);
    p.fillRect(80,395+i*67,1250,1);
  }
  p.font='21px sans-serif';p.fillText('Fine print: batch reference FM-2486',85,1860);
  if(number%2){
    p.strokeStyle='#a52c48';p.lineWidth=6;p.strokeRect(870,150,365,110);
    p.fillStyle='#a52c48';p.font='bold 43px sans-serif';p.fillText('RECEIVED',925,222);
    p.beginPath();p.strokeStyle='#243fae';p.moveTo(290,1760);p.bezierCurveTo(390,1660,365,1840,500,1710);p.stroke();
  }
  // Project a sheet onto the desk. The top and bottom edges differ in length.
  const sheet=p.getImageData(0,0,1420,2020).data,frame=c.getImageData(0,0,canvas.width,canvas.height);
  let seed=number;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const sy=y-.035*x-145,t=sy/2019,sx=(x-240+140*t)*1420/(1310+260*t);
    const onPaper=sx>=0&&sx<1420&&sy>=0&&sy<2020;
    const src=(Math.floor(sy)*1420+Math.floor(sx))*4,dest=(y*canvas.width+x)*4;
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed>>>28)-8;
    for(let ch=0;ch<3;ch++)frame.data[dest+ch]=(onPaper?sheet[src+ch]:64)+noise;
  }
  c.putImageData(frame,0,0);
  return canvas.toBuffer('image/jpeg',96);
}
const pictures=[];
for(let n=1;n<=5;n++)pictures.push({name:'camera-'+n+'.jpg',mimeType:'image/jpeg',buffer:cameraPage(n)});
const existing=await PDFDocument.create(),vector=existing.addPage();vector.drawText('Existing signed-copy fixture. Keep every byte.');
const vectorPdf=Buffer.from(await existing.save());
const samples=new Map();
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,format:'esm',platform:'browser',write:false});
const key='isolated-scan-test-key-'.repeat(3),bindings={APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key})};
const mf=new Miniflare(convertV4MiniflareOptions({name:'scan-qa',host:'127.0.0.1',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'scan-test'},bindings,
  assets:{directory:fileURLToPath(new URL('../public/',import.meta.url)),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},
  outboundService:()=>{throw Error('External service disabled');}}));
const devices=[
  ['iPhone',pw.webkit,pw.devices['iPhone 13'],process.env.TASKS_WEBKIT_EXECUTABLE],
  ['iPad',pw.webkit,pw.devices['iPad (gen 7)'],process.env.TASKS_WEBKIT_EXECUTABLE],
  ['Android',pw.chromium,pw.devices['Pixel 7'],process.env.TASKS_BROWSER_EXECUTABLE],
];
let browser;
try{
 const origin=(await mf.ready).origin,db=await mf.getD1Database('DB');
 for(const [device,engine,options,executablePath] of devices){
  if(process.env.TEXT_BROWSER&&engine.name()!==process.env.TEXT_BROWSER)continue;
  browser=await engine.launch({headless:true,executablePath,...(engine===pw.chromium?{args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote']}: {})});
  const ctx=await browser.newContext({...options,timezoneId:'Africa/Johannesburg'});
  ctx.setDefaultTimeout(90000);
  const page=await ctx.newPage(),errors=[],fileRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/tasks/file?'))fileRequests.push(r.url());});
  const login=await ctx.request.post(origin+'/api/login',{headers:{Origin:origin},data:{username:'alex',key}});assert.equal(login.status(),200);
  const cookie=login.headers()['set-cookie'].split(';')[0],eq=cookie.indexOf('=');
  await ctx.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:origin}]);
  await page.goto(origin+'/tasks');
  await page.getByRole('button',{name:'Nuwe taak',exact:true}).click();const form=page.locator('#dialog form'),scanner=page.locator('.scan-dialog');
  assert.deepEqual(await form.locator('.attachment-tools button').allTextContents(),['Take Photo','Scan Document','Photo Library','Choose Files']);
  await form.locator('[name=title]').fill(device+' Scan QA');await form.locator('[name=details]').fill('Keep this description through a lost response.');
  async function choose(button,files,camera=false){
    const [event]=await Promise.all([page.waitForEvent('filechooser'),button.click()]);
    assert.equal(await event.element().getAttribute('capture'),camera?'environment':null);
    await event.setFiles(files);
  }
  async function scan(button,n){
    await choose(button,pictures[n-1],true);
    await scanner.locator('[data-use]').waitFor({state:'visible'});
    const edges=await scanner.locator('polygon').getAttribute('points');
    assert.notEqual(edges,'0,0 100,0 100,100 0,100','automatic paper detection');
    const points=edges.split(' ').map(pair=>pair.split(',').map(Number));
    assert.ok(Math.abs(points[0][0]-13)<3&&Math.abs(points[2][0]-92)<3,'edge estimate follows the skewed sheet');
    const handle=scanner.getByRole('button',{name:'Links bo',exact:true});await handle.focus();await handle.press('ArrowRight');
    assert.notEqual(await scanner.locator('polygon').getAttribute('points'),edges);
    await scanner.locator('[data-auto]').click();assert.equal(await scanner.locator('polygon').getAttribute('points'),edges);
    await scanner.locator('[data-use]').click();await scanner.locator('[data-review]').waitFor({state:'visible'});
  }
  await scan(form.getByRole('button',{name:'Scan Document'}),1);
  await scanner.locator('.scan-thumb').first().click();await page.locator('.scan-zoom button').click();
  await scanner.locator('[data-save]').click();await form.locator('.attachment-row').first().waitFor();
  await scan(form.getByRole('button',{name:'Scan Document'}),2);
  await scan(scanner.getByRole('button',{name:'Herskandeer'}),1);
  await scan(scanner.locator('[data-add]'),2);
  await scanner.locator('.scan-page').last().getByRole('button',{name:'Verwyder'}).click();
  for(let i=2;i<=5;i++)await scan(scanner.locator('[data-add]'),i);
  assert.equal(await scanner.locator('.scan-page').count(),5);
  await scanner.locator('[data-save]').click();
  await choose(form.getByRole('button',{name:'Take Photo'}),pictures[0],true);
  await choose(form.getByRole('button',{name:'Photo Library'}),pictures[1]);
  await choose(form.getByRole('button',{name:'Choose Files'}),[
    {name:'existing.pdf',mimeType:'application/pdf',buffer:vectorPdf},
    {name:'remove.txt',mimeType:'text/plain',buffer:Buffer.from('remove me')}]);
  await form.getByRole('button',{name:'Remove remove.txt'}).click();
  assert.equal(await form.locator('.attachment-row').count(),5);
  assert.ok(await form.locator('.attachment-row').first().textContent().then(t=>/KB|MB/.test(t)));
  const oldPhotoBytes=await page.evaluate(async bytes=>{
    const {fileData}=await import('/task-attachments.js');
    const file=new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'baseline.jpg',{type:'image/jpeg'});
    return atob((await fileData(file,{report:true})).base64).length;
  },pictures[0].buffer.toString('base64'));
  const postBodies=[];let attempts=0;
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    postBodies.push(route.request().postDataJSON());attempts++;
    if(attempts===1)return route.abort('internetdisconnected');
    if(attempts===2){const actual=await route.fetch();assert.equal(actual.status(),200,(await actual.text()).slice(0,300));return route.abort('connectionreset');}
    return route.continue();
  });
  const save=form.locator('[type=submit]');
  await save.click();await form.locator('.error').getByText(/verbinding/).waitFor();
  assert.equal(await form.locator('[name=details]').inputValue(),'Keep this description through a lost response.');
  assert.equal(await form.locator('.attachment-row').count(),5);
  await save.click();await form.locator('.error').getByText(/verbinding/).waitFor();
  await save.click();await form.waitFor({state:'hidden'});
  assert.equal(attempts,2,'a confirmed write is not uploaded a third time');
  assert.deepEqual(postBodies[0],postBodies[1],'retry reuses the prepared bytes and identifiers');
  const payload=postBodies[0],id=payload.task_id;
  await page.reload();await page.getByRole('button',{name:'Nuwe taak',exact:true}).waitFor();
  assert.equal(fileRequests.length,0,'task list never requests attachment bodies');
  const saved=await (await ctx.request.get(origin+'/api/tasks?id='+id)).json();
  assert.equal(saved.task.attachments.length,5);
  for(const [i,fid] of saved.task.attachments.entries()){
    const r=await ctx.request.get(origin+'/api/tasks/file?id='+fid,{timeout:90000});assert.equal(r.status(),200);const bytes=await r.body();
    const input=payload.files[i],filename=input.filename;
    if(i<2){
      const count=i===0?1:5;assert.equal((await PDFDocument.load(bytes)).getPageCount(),count);
      await writeFile(out+'/'+device+'-'+count+'.pdf',bytes);
      samples.set(device+' '+count+'p',[pictures.slice(0,count).reduce((n,p)=>n+p.buffer.length,0),bytes.length]);
    }else if(i===4)assert.deepEqual(bytes,vectorPdf,'pre-existing PDF is byte-identical');
    else samples.set(device+' '+filename,[pictures[i-2].buffer.length,bytes.length]);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_task_events WHERE task_id=?').bind(id).first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM v2_task_attachments WHERE task_id=?').bind(id).first()).n,5);
  assert.deepEqual(errors,[]);console.log(device,engine.name(),browser.version(),'PASS','previous photo bytes',oldPhotoBytes,JSON.stringify(Object.fromEntries(samples)));
  await browser.close();browser=null;
 }
}finally{await browser?.close();await mf.dispose();}
