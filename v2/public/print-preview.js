import {browserPrintURL,usesAppleHomeScreen} from './print-page-options.js';
let active=null;

export function openPrintPreview({url,title,filename,unsaved=false,browserPage=false,fitPage=false}){
 if(active){active.back.focus();return;}
 const opener=document.activeElement,app=document.getElementById('app'),wasInert=app?.inert;
 const root=document.createElement('section');root.id='file-print-preview';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','file-print-title');
 root.innerHTML='<div class="file-print-toolbar"><h1 id="file-print-title"></h1><div class="file-print-actions"><button id="file-print-back">Back to app</button><button id="file-print-go" disabled>Print</button><button id="file-print-share" disabled>Share PDF</button><button id="file-print-fit" aria-controls="file-print-pages" hidden disabled>Zoom in</button></div><p id="file-print-status" role="status" aria-live="polite"></p><a id="file-print-browser" class="file-print-help" target="_blank" rel="noopener noreferrer external" hidden>Open print page</a><a id="file-print-signin" class="file-print-help" target="_blank" rel="noopener noreferrer" hidden>Open FenMeat in this browser</a><button id="file-print-retry" hidden>Retry</button></div><div id="file-print-pages" tabindex="0" aria-label="Document preview"></div>';
 const find=id=>root.querySelector('#'+id),back=find('file-print-back'),print=find('file-print-go'),share=find('file-print-share'),fit=find('file-print-fit'),status=find('file-print-status'),pages=find('file-print-pages'),retry=find('file-print-retry');
 if(fitPage){root.classList.add('file-print-fit');fit.hidden=false;}
 find('file-print-title').textContent=title;
 const browserLink=find('file-print-browser'),signIn=find('file-print-signin'),handOff=!browserPage&&usesAppleHomeScreen(navigator,window.matchMedia?.bind(window));
 if(browserPage)back.textContent='Close print page';
 const token=crypto.randomUUID();let controller,epoch=0,file=null,ready=false,sharing=false,closed=false,printTimer,nativePrintStarted=false;
 const session={back};active=session;
 fit.onclick=()=>{
  if(!fitPage||!ready||closed)return;
  fit.textContent=root.classList.toggle('file-print-fit')?'Zoom in':'Fit page';
  pages.scrollTop=0;pages.scrollLeft=0;
 };
 document.body.append(root);document.body.classList.add('file-preview-open');if(app)app.inert=true;
 if(!browserPage)history.pushState({...history.state,filePrintPreview:token},'');
 const close=(fromHistory=false)=>{
  if(closed)return;closed=true;epoch++;controller?.abort();clearTimeout(printTimer);
  window.removeEventListener('popstate',pop);window.removeEventListener('beforeprint',beforePrint);root.removeEventListener('keydown',keys);
  document.body.classList.remove('file-preview-open','printing-file-preview');root.remove();file=null;
  if(app)app.inert=wasInert;if(active===session)active=null;
  opener?.focus?.({preventScroll:true});
  if(browserPage){window.close();return;}
  if(!fromHistory&&history.state?.filePrintPreview===token)history.back();
 };
 const pop=()=>{if(history.state?.filePrintPreview!==token)close(true);};
 const keys=e=>{
  if(e.key==='Escape'){e.preventDefault();close();}
  if(e.key==='Tab'){
   const controls=[...root.querySelectorAll('button:not([disabled]):not([hidden]),a[href]:not([hidden]),[tabindex="0"]')];
   const first=controls[0],last=controls.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
 };
 const beforePrint=()=>{nativePrintStarted=true;clearTimeout(printTimer);};
 window.addEventListener('beforeprint',beforePrint);
 if(!browserPage)window.addEventListener('popstate',pop);root.addEventListener('keydown',keys);back.onclick=()=>close();back.focus();
 const printHelp=()=>{
  if(closed)return;
  if(!browserPage&&browserLink.hasAttribute('href')){browserLink.hidden=false;status.textContent='If no print window appeared, open the print page in your browser, then tap Print there.';}
  else status.textContent='If no print window appeared, open this page in Safari and tap Print, or use Share PDF.';
 };
 print.onclick=()=>{
  if(!ready||closed)return;
  if(handOff&&browserLink.hasAttribute('href')){
   // Home Screen Web.app can silently ignore window.print. Use a separate
   // browser page with its own explicit Print tap; never enter a bare PDF viewer.
   browserLink.hidden=false;browserLink.click();
   status.textContent='In the browser print page, tap Print. If it did not open, tap Open print page below. Your entries stay here.';
   return;
  }
  // Already rendered, decoded and selected before this second, explicit tap.
  // Do not await fetch/fonts/frames here: native print keeps user activation.
  nativePrintStarted=false;clearTimeout(printTimer);
  try{window.print();if(!nativePrintStarted)printTimer=setTimeout(printHelp,1800);}catch{printHelp();}
 };
 share.onclick=()=>{
  if(!file||sharing||closed)return;
  sharing=true;share.disabled=true;
  try{
   // The File is prepared before the tap, so Safari keeps user activation.
   const pending=navigator.share({files:[file],title});
   Promise.resolve(pending).catch(e=>{if(!closed)status.textContent=e.name==='AbortError'?'Sharing cancelled. You can print or go back.':'Sharing could not open. Use Print or Back to app.';}).finally(()=>{sharing=false;if(!closed)share.disabled=false;});
  }catch{sharing=false;share.disabled=false;status.textContent='Sharing is unavailable here. Use Print or Back to app.';}
 };
 const load=async()=>{
  controller?.abort();controller=new AbortController();const {signal}=controller,id=++epoch;
  const current=()=>!closed&&epoch===id;
  ready=false;file=null;print.disabled=true;share.disabled=true;fit.disabled=true;retry.hidden=true;browserLink.hidden=true;browserLink.removeAttribute('href');signIn.hidden=true;clearTimeout(printTimer);pages.replaceChildren();
  document.body.classList.remove('printing-file-preview');
  status.textContent='Preparing saved document…'+(unsaved?' Your unsaved entries stay in the app.':'');
  try{
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});
   if(!current())return;
   if(browserPage&&response.status===401){signIn.href=url.startsWith('/api/print/production?')?'/production':url.startsWith('/api/print/stocktake?')?'/recipes?view=stock':'/';signIn.hidden=false;throw Error('Open FenMeat in this browser to sign in, then return to this page and tap Retry.');}
   if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'The saved document could not be loaded.');}
   if(!response.headers.get('content-type')?.includes('application/pdf'))throw Error('The server did not return a PDF.');
   const blob=await response.blob();if(!current())return;
   file=new File([blob],filename,{type:'application/pdf'});
   if(!browserPage){try{browserLink.href=browserPrintURL(url,{revision:response.headers.get('x-fenmeat-print-revision'),unsaved});}catch{/* Unknown document types keep native printing. */}}
   let canShare=false;
   try{canShare=typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]});}catch{/* Sharing support must never block Print or Back. */}
   share.disabled=!canShare;
   const {renderPDFPages}=await import('./pdf-pages.js');
   const count=await renderPDFPages(new Uint8Array(await blob.arrayBuffer()),{signal,onPage:async page=>{
    if(!current())return;
    const sheet=document.createElement('div');sheet.className='file-print-page';
    const img=document.createElement('img');img.alt='Page '+page.number+' of '+page.total;img.src=page.dataUrl;
    const accessible=document.createElement('p');accessible.className='file-print-text';accessible.textContent=page.text;
    sheet.append(img,accessible);await img.decode();if(!current())return;
    pages.append(sheet);status.textContent='Preparing page '+page.number+' of '+page.total+'…';
   }});
   if(!current())return;
   document.body.classList.add('printing-file-preview');
   // The print layout is mounted and images decoded before Print is enabled.
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   if(!current())return;
   ready=true;print.disabled=false;fit.disabled=!fitPage;
   status.textContent=count+' page'+(count===1?'':'s')+' ready. '+(handOff?'Print opens a browser print page; tap Print there.':'Tap Print to open printer options.')+(unsaved?' Unsaved changes are excluded.':'')+(!canShare?' PDF sharing is not supported in this browser.':'');
  }catch(e){if(!current())return;status.textContent=e.name==='AbortError'?'Loading cancelled. Try again or go back.':e.message;retry.hidden=false;}
 };
 retry.onclick=()=>{void load();};void load();
}
