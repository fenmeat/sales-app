import {getDocument,GlobalWorkerOptions} from './pdfjs/pdf.min.mjs';

GlobalWorkerOptions.workerSrc=new URL('./pdfjs/pdf.worker.min.mjs',import.meta.url).href;
// Render the same private PDF that Share receives. Never navigate to a native
// PDF viewer: installed iOS apps may provide no viewer toolbar or way back.
export async function renderPDFPages(bytes,{signal,onPage,canvasFactory=()=>document.createElement('canvas'),fontUrl=new URL('./pdfjs/',import.meta.url).href}={}){
 const task=getDocument({data:bytes,standardFontDataUrl:fontUrl,useSystemFonts:false,disableFontFace:true,isEvalSupported:false,useWasm:false,stopAtErrors:true});
 const abort=()=>{void task.destroy().catch(()=>{});};
 signal?.addEventListener('abort',abort,{once:true});
 const check=()=>{if(signal?.aborted)throw new DOMException('Preview closed','AbortError');};
 try{
  check();const pdf=await task.promise;
  for(let number=1;number<=pdf.numPages;number++){
   check();const page=await pdf.getPage(number),viewport=page.getViewport({scale:2.5}),canvas=canvasFactory();
   canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   try{
    await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white',intent:'print'}).promise;
    // PDF.js getTextContent uses for-await on ReadableStream. Shipping Safari
    // versions may support getReader without implementing Symbol.asyncIterator.
    // Consume the text stream explicitly so a rendered page is not discarded.
    check();const reader=page.streamTextContent().getReader(),parts=[];
    try{
     for(;;){
      check();const {done,value}=await reader.read();check();if(done)break;
      for(const item of value.items)if(typeof item.str==='string')parts.push(item.str);
     }
    }finally{reader.releaseLock();}
    const text=parts.join(' ');
    await onPage({number,total:pdf.numPages,dataUrl:canvas.toDataURL('image/png'),text});
   }finally{canvas.width=0;canvas.height=0;page.cleanup();}
  }
  return pdf.numPages;
 }finally{signal?.removeEventListener('abort',abort);await task.destroy().catch(()=>{});}
}
