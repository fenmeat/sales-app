import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createCanvas,DOMMatrix,Path2D,ImageData,loadImage} from '@napi-rs/canvas';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {openPrintPreview} from '../public/print-preview.js';

async function sample(count=2){
 const d=await PDFDocument.create(),font=await d.embedFont(StandardFonts.Helvetica);
 for(let i=1;i<=count;i++){const p=d.addPage();p.drawText('Synthetic page '+i+' | saved quantity 17 | labels 187',{x:30,y:700,size:12,font});}
 return d.save();
}
async function until(fn){for(let n=0;n<500;n++){if(fn())return;await delay(10);}throw Error('Preview did not reach expected state');}

test('real PDF renderer retains every page and text with bundled local fonts',async()=>{
 Object.assign(globalThis,{DOMMatrix,Path2D,ImageData});
 const {renderPDFPages}=await import('../public/pdf-pages.js'),pages=[];
 const count=await renderPDFPages(await sample(),{canvasFactory:()=>createCanvas(1,1),fontUrl:fileURLToPath(new URL('../public/pdfjs/',import.meta.url)),onPage:p=>pages.push(p)});
 assert.equal(count,2);assert.equal(pages.length,2);
 for(const p of pages){assert.match(p.text,/saved quantity 17/);const image=await loadImage(p.dataUrl);assert.ok(image.width>1400);assert.ok(image.height>2000);}
});

test('PDF preview loads with Safari streams that have getReader but no async iterator',async t=>{
 Object.assign(globalThis,{DOMMatrix,Path2D,ImageData});
 const {renderPDFPages}=await import('../public/pdf-pages.js'),pages=[];
 const descriptor=Object.getOwnPropertyDescriptor(ReadableStream.prototype,Symbol.asyncIterator);
 Object.defineProperty(ReadableStream.prototype,Symbol.asyncIterator,{configurable:true,value:undefined});
 t.after(()=>{if(descriptor)Object.defineProperty(ReadableStream.prototype,Symbol.asyncIterator,descriptor);else delete ReadableStream.prototype[Symbol.asyncIterator];});
 assert.equal(typeof new ReadableStream()[Symbol.asyncIterator],'undefined');
 const count=await renderPDFPages(await sample(),{canvasFactory:()=>createCanvas(1,1),fontUrl:fileURLToPath(new URL('../public/pdfjs/',import.meta.url)),onPage:p=>pages.push(p)});
 assert.equal(count,2);assert.equal(pages.length,2);
 for(const p of pages)assert.match(p.text,/saved quantity 17/);
});

test('in-app preview supports ready print, share/cancel/retry and back without losing edits or navigating to PDFs',async t=>{
 const {document,window}=parseHTML('<html><body><main id="app"><input id="draft" value="17"><button id="opener">Print</button></main></body></html>');
 const descriptors=new Map();
 const set=(k,v)=>{descriptors.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});};
 const bytes=await sample(),calls=[],shares=[],states=[{view:'production'}];let index=0,focused=null,fetcher=async()=>new Response(bytes,{headers:{'Content-Type':'application/pdf','X-FenMeat-Print-Revision':'7'}});
 const history={get state(){return states[index];},pushState(v){states.splice(++index);states[index]=v;},back(){if(index>0)index--;window.dispatchEvent(new window.Event('popstate'));}};
 Object.defineProperty(document,'activeElement',{get:()=>focused});
 window.HTMLElement.prototype.focus=function(){focused=this;};
 window.HTMLImageElement.prototype.decode=async function(){await loadImage(this.src);};
 const create=document.createElement.bind(document);document.createElement=name=>name==='canvas'?createCanvas(1,1):create(name);
 window.print=()=>calls.push({selected:document.body.classList.contains('printing-file-preview'),pages:document.querySelectorAll('.file-print-page img').length});
 const nav={canShare:()=>true,share:data=>{shares.push(data);return Promise.reject(new DOMException('Cancelled','AbortError'));}};
 set('window',window);set('document',document);set('history',history);set('navigator',nav);set('requestAnimationFrame',fn=>setImmediate(fn));set('fetch',(...args)=>fetcher(...args));
 t.after(()=>{document.getElementById('file-print-back')?.onclick();for(const [k,d] of descriptors){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}});
 const input=document.getElementById('draft'),opener=document.getElementById('opener');input.value='41,5';opener.focus();
 const options={url:'/api/print/production?date=2026-10-28',title:'Staff test',filename:'staff.pdf',unsaved:true};
 const open=()=>openPrintPreview(options);
 const el=id=>document.getElementById(id);
 const ready=()=>el('file-print-go')&&!el('file-print-go').disabled;
 open();open();assert.equal(document.querySelectorAll('#file-print-preview').length,1);assert.equal(el('file-print-go').disabled,true);assert.equal(el('file-print-back').disabled,false);
 assert.equal(el('file-print-fit').hidden,true);assert.equal(el('file-print-preview').classList.contains('file-print-fit'),false);
 await until(ready);assert.equal(el('app').inert,true);assert.equal(document.querySelectorAll('iframe,object,embed,a[href$=".pdf"]').length,0);
 assert.equal(new URL(el('file-print-browser').href,'https://test.invalid').searchParams.get('revision'),'7');
 assert.equal(calls.length,0,'preparation never launches native print');
 el('file-print-go').onclick();assert.deepEqual(calls,[{selected:true,pages:2}],'Print executes synchronously in the tap, after images are ready');
 window.dispatchEvent(new window.Event('afterprint'));assert.ok(el('file-print-back'));el('file-print-go').onclick();assert.equal(calls.length,2,'cancel/retry retains the prepared document');
 el('file-print-share').onclick();assert.equal(shares.length,1,'share executes before returning from the tap');assert.deepEqual(new Uint8Array(await shares[0].files[0].arrayBuffer()),bytes);
 await until(()=>!el('file-print-share').disabled);assert.match(el('file-print-status').textContent,/cancelled/);
 el('file-print-back').onclick();assert.equal(el('file-print-preview'),null);assert.equal(input.value,'41,5');assert.equal(document.activeElement,opener);assert.ok(!el('app').inert);assert.deepEqual(history.state,{view:'production'});
 // Browser Back and Escape also close the preview, including pending loads.
 let release;fetcher=()=>new Promise(r=>release=r);open();history.back();release(new Response(bytes,{headers:{'Content-Type':'application/pdf'}}));await delay(20);assert.equal(el('file-print-preview'),null);
 // A failed private read keeps Back usable and offers a genuine retry.
 fetcher=async()=>Response.json({error:'Sign in to continue.'},{status:401});open();await until(()=>!el('file-print-retry').hidden);assert.equal(el('file-print-go').disabled,true);assert.match(el('file-print-status').textContent,/Sign in/);
 nav.canShare=()=>{throw new Error('File sharing unavailable');};fetcher=async()=>new Response(bytes,{headers:{'Content-Type':'application/pdf'}});el('file-print-retry').onclick();await until(ready);assert.equal(el('file-print-share').disabled,true);assert.match(el('file-print-status').textContent,/not supported/);
 const escape=new window.Event('keydown');escape.key='Escape';el('file-print-preview').dispatchEvent(escape);assert.equal(el('file-print-preview'),null);assert.equal(input.value,'41,5');
 // A silent no-op is different from successful printing or cancellation.
 open();await until(ready);el('file-print-go').onclick();await until(()=>!el('file-print-browser').hidden);
 assert.match(el('file-print-status').textContent,/If no print window appeared/);el('file-print-back').onclick();
 // iPad's desktop user agent still needs the Home Screen handoff. The link
 // executes in the original tap, without a fetch or timeout before navigation.
 Object.assign(nav,{platform:'MacIntel',maxTouchPoints:5,standalone:true});
 open();await until(ready);const beforeCalls=calls.length,handoffs=[];
 el('file-print-browser').click=()=>handoffs.push(el('file-print-browser').href);
 el('file-print-go').onclick();assert.equal(handoffs.length,1);assert.equal(calls.length,beforeCalls);
 assert.match(handoffs[0],/^\/print-page\?/);assert.match(el('file-print-status').textContent,/tap Print/);
 assert.equal(shares.length,1,'Print never silently invokes Share PDF');el('file-print-back').onclick();assert.equal(input.value,'41,5');
 // The browser page cannot recursively open another print page, even when
 // an iOS container still reports standalone. Closing leaves app history alone.
 let closes=0;window.close=()=>closes++;window.print=()=>{calls.push('browser');window.dispatchEvent(new window.Event('beforeprint'));};
 openPrintPreview({...options,browserPage:true});await until(ready);
 assert.equal(el('file-print-back').textContent,'Close print page');el('file-print-go').onclick();assert.equal(calls.at(-1),'browser');
 assert.ok(el('file-print-browser').hidden);el('file-print-back').onclick();assert.equal(closes,1);assert.deepEqual(history.state,{view:'production'});
 // A browser with a separate cookie jar gets a usable sign-in link in the
 // toolbar, without copying credentials from the Home Screen app.
 fetcher=async()=>Response.json({error:'Sign in to continue.'},{status:401});
 openPrintPreview({...options,browserPage:true});await until(()=>!el('file-print-retry').hidden);
 assert.equal(el('file-print-signin').hidden,false);assert.equal(el('file-print-signin').href,'/production');assert.equal(el('file-print-go').disabled,true);
 fetcher=async()=>new Response(bytes,{headers:{'Content-Type':'application/pdf'}});el('file-print-retry').onclick();await until(ready);
 assert.ok(el('file-print-signin').hidden);el('file-print-back').onclick();assert.equal(input.value,'41,5');
});

test('Stocktake fits the page initially and can zoom without printing, changing app state or losing the return path',async t=>{
 const {document,window}=parseHTML('<html><body><main id="app"><input id="draft" value="9"><button id="opener">PDF Summary</button></main></body></html>');
 const descriptors=new Map(),set=(k,v)=>{descriptors.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});};
 const bytes=await sample(1),states=[{view:'stock'}];let index=0,focused=null,prints=0,shares=0,closes=0,fetcher=async()=>new Response(bytes,{headers:{'Content-Type':'application/pdf','X-FenMeat-Print-Revision':'76'}});
 const history={get state(){return states[index];},pushState(v){states.splice(++index);states[index]=v;},back(){if(index>0)index--;window.dispatchEvent(new window.Event('popstate'));}};
 Object.defineProperty(document,'activeElement',{get:()=>focused});window.HTMLElement.prototype.focus=function(){focused=this;};
 window.HTMLImageElement.prototype.decode=async function(){await loadImage(this.src);};
 const create=document.createElement.bind(document);document.createElement=name=>name==='canvas'?createCanvas(1,1):create(name);
 window.print=()=>prints++;window.close=()=>closes++;
 set('window',window);set('document',document);set('history',history);set('navigator',{canShare:()=>true,share:()=>{shares++;return Promise.resolve();}});set('requestAnimationFrame',fn=>setImmediate(fn));set('fetch',(...args)=>fetcher(...args));
 t.after(()=>{document.getElementById('file-print-back')?.onclick();for(const [k,d] of descriptors){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}});
 const el=id=>document.getElementById(id),opener=el('opener'),options={url:'/api/print/stocktake?date=2026-10-27&supplier=margot+swiss&revision=76',title:'Stocktake Summary',filename:'stocktake.pdf',fitPage:true};
 opener.focus();el('draft').value='12';openPrintPreview(options);
 assert.equal(el('file-print-fit').hidden,false);assert.equal(el('file-print-fit').disabled,true);
 assert.equal(el('file-print-preview').classList.contains('file-print-fit'),true);
 await until(()=>!el('file-print-go').disabled);
 assert.equal(document.querySelectorAll('.file-print-page img').length,1);assert.equal(el('file-print-fit').disabled,false);assert.equal(el('file-print-fit').textContent,'Zoom in');
 el('file-print-fit').onclick();assert.equal(el('file-print-preview').classList.contains('file-print-fit'),false);assert.equal(el('file-print-fit').textContent,'Fit page');
 el('file-print-pages').scrollTop=80;el('file-print-pages').scrollLeft=20;
 el('file-print-fit').onclick();assert.equal(el('file-print-preview').classList.contains('file-print-fit'),true);assert.equal(el('file-print-fit').textContent,'Zoom in');
 assert.equal(el('file-print-pages').scrollTop,0);assert.equal(el('file-print-pages').scrollLeft,0);assert.equal(prints,0);assert.equal(shares,0);
 const handoff=new URL(el('file-print-browser').href,'https://test.invalid');assert.equal(handoff.searchParams.get('supplier'),'margot swiss');assert.equal(handoff.searchParams.get('revision'),'76');
 el('file-print-back').onclick();assert.equal(el('file-print-preview'),null);assert.equal(el('draft').value,'12');assert.equal(document.activeElement,opener);assert.deepEqual(history.state,{view:'stock'});
 fetcher=async()=>Response.json({error:'Sign in to continue.'},{status:401});openPrintPreview({...options,browserPage:true});
 await until(()=>!el('file-print-retry').hidden);assert.equal(el('file-print-signin').href,'/recipes?view=stock');assert.equal(el('file-print-go').disabled,true);
 el('file-print-back').onclick();assert.equal(closes,1);assert.equal(prints,0);assert.equal(shares,0);assert.equal(el('draft').value,'12');
});

test('both app shells load the print-only overlay styles and renderer remains self-hosted',async()=>{
 for(const name of ['index.html','production.html'])assert.match(await readFile(new URL('../public/'+name,import.meta.url),'utf8'),/print-preview.css/);
 const css=await readFile(new URL('../public/print-preview.css',import.meta.url),'utf8');
 assert.match(css,/@page file-preview\{size:A4;margin:0\}/);assert.match(css,/printing-file-preview>:not\(#file-print-preview\)\{display:none!important\}/);
 const source=await readFile(new URL('../public/pdf-pages.js',import.meta.url),'utf8');assert.doesNotMatch(source,/https?:\/\//);assert.match(source,/pdf\.worker\.min\.mjs/);
});
