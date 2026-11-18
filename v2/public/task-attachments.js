import {decodePhoto,canvasBlob} from './scan-image.js';
import {openScanner} from './task-scanner.js';
export const MAX_TASK_ATTACHMENTS=12;
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','image/heic-sequence','image/heif-sequence']);
const extensions={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',pdf:'application/pdf'};
export const REPORT_FILE_ACCEPT='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf';
const MAX_BYTES=500000;
function fileType(file){
 const mime=file.type.toLowerCase(),ext=file.name.split('.').pop().toLowerCase();
 if(ext==='csv'&&mime==='application/vnd.ms-excel')return 'text/csv';
 return mime&&mime!=='application/octet-stream'?mime:(extensions[ext]||'');
}

async function legacyFileData(file){
 const type=fileType(file);let blob=file,filename=file.name;
 if(type==='application/pdf'){
  if(file.size>MAX_BYTES)throw Error('PDFs must be 500 KB or smaller.');
 }else if(imageTypes.has(type)){
  const decoded=await decodePhoto(file),canvas=document.createElement('canvas');
  try{
   if(!decoded.width||!decoded.height)throw Error('This photo could not be opened. Choose it again from Photo Library.');
   // Reduce quality first, then dimensions. Every canvas is small, including
   // for 48 MP originals; process one photo at a time to limit phone memory.
   let edge=Math.min(1600,Math.max(decoded.width,decoded.height)),ready=false;
   while(!ready){
    const ratio=Math.min(1,edge/Math.max(decoded.width,decoded.height));
    canvas.width=Math.max(1,Math.round(decoded.width*ratio));canvas.height=Math.max(1,Math.round(decoded.height*ratio));
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo processing could not start. Keep this task open and try again.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(decoded.image,0,0,canvas.width,canvas.height);
    for(const quality of [.82,.72,.62]){
     blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
     if(blob?.size>0&&blob.type==='image/jpeg'&&blob.size<=MAX_BYTES){ready=true;break;}
    }
    if(!ready){if(edge<=320)throw Error('This photo could not be prepared. Your task is still open; choose the photo again or try a JPG copy.');edge=Math.max(320,Math.floor(edge*.75));}
   }
   filename=file.name.replace(/\.[^.]+$/,'')+'.jpg';
  }finally{decoded.release();canvas.width=canvas.height=1;}
 }else throw Error('Choose a JPG, PNG, HEIC, HEIF, WebP or PDF.');
 if(!blob.size)throw Error('This file is empty. Choose it again.');
 const bytes=new Uint8Array(await blob.arrayBuffer());let raw='';for(const b of bytes)raw+=String.fromCharCode(b);
 return {base64:btoa(raw),mime_type:type==='application/pdf'?'application/pdf':blob.type,filename};
}

const LIMIT=6000000;
const documents=['application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
Object.assign(extensions,{txt:documents[1],csv:documents[2],docx:documents[3],xlsx:documents[4]});
export const TASK_FILE_ACCEPT=REPORT_FILE_ACCEPT+',.txt,.csv,.docx,.xlsx';
const sizeText=n=>n<1000?n+' B':n<1000000?Math.round(n/1000)+' KB':(n/1000000).toFixed(2)+' MB';

async function preserveAnimation(file,type){
  if(!['image/png','image/webp'].includes(type))return false;
  // Both formats advertise animation before the first frame's pixels.
  const header=new Uint8Array(await file.slice(0,32).arrayBuffer());
  if(type==='image/webp')return header[12]===86&&header[15]===88&&!!(header[20]&2);
  let pos=8;
  for(let count=0;pos+8<=file.size;count++){
    if(count>256)return true;
    const chunk=new DataView(await file.slice(pos,pos+8).arrayBuffer());
    const tag=chunk.getUint32(4);
    if(tag===0x6163544c)return true; // acTL
    if(tag===0x49444154)return false; // IDAT
    pos+=chunk.getUint32(0)+12;
  }
  return false;
}
async function photoBlob(file,type){
  const native=['image/jpeg','image/png','image/webp'].includes(type);
  if(native && (file.size<=500000||await preserveAnimation(file,type)))return file;
  let decoded;
  try{decoded=await decodePhoto(file);}catch(e){if(type.includes('hei')&&file.size<=LIMIT)return file;throw e;}
  const canvas=document.createElement('canvas');
  try{
    // Keep the ordinary-photo resolution staff already use. A scan has its
    // own higher resolution for fine print and handwriting.
    const scale=Math.min(1,1600/Math.max(decoded.width,decoded.height));
    canvas.width=Math.max(1,Math.round(decoded.width*scale));canvas.height=Math.max(1,Math.round(decoded.height*scale));
    const ctx=canvas.getContext('2d');ctx.drawImage(decoded.image,0,0,canvas.width,canvas.height);
    let transparent=false;
    if(type==='image/png'||type==='image/webp'){
      const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255){transparent=true;break;}
    }
    let best=type==='image/png'||transparent?await canvasBlob(canvas,'image/png'):null;
    for(const quality of [.82,.76,.72]){
      if(!transparent){
        const jpeg=await canvasBlob(canvas,'image/jpeg',quality);
        if(!best||jpeg.size<best.size)best=jpeg;
      }
      // A browser without a WebP encoder may return PNG for this request.
      const webp=await canvasBlob(canvas,'image/webp',quality).catch(()=>null);
      if(webp?.type==='image/webp'&&webp.size<best.size*.98)best=webp;
      if(best.size<=500000||transparent)break;
    }
    if(native&&file.size<=best.size)return file;
    return best;
  }catch(e){
    if(native&&file.size<=LIMIT)return file;
    throw e;
  }finally{decoded.release();canvas.width=canvas.height=1;}
}
export async function fileData(file,{report=false}={}){
  if(report)return legacyFileData(file);
  const type=fileType(file);
  let blob=imageTypes.has(type)?await photoBlob(file,type):file;
  if(!blob.size)throw Error('Die lêer is leeg. Kies dit weer.');
  if(blob.size>LIMIT)throw Error('Gebruik ’n lêer van hoogstens 6 MB of verdeel die dokument.');
  const mime_type=blob===file?type:blob.type;
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime_type];
  const filename=blob===file||!ext?file.name:file.name.replace(/\.[^.]+$/,'')+'.'+ext;
  let encoding;
  if(documents.includes(type)&&blob.size>=4096&&typeof CompressionStream==='function'){
    const packed=await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    if(packed.size<blob.size*.95){encoding='gzip';blob=packed;}
  }
  const bytes=new Uint8Array(await blob.arrayBuffer()),parts=[];
  for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return {base64:btoa(parts.join('')),mime_type,filename,...(encoding?{encoding}:{})};
}

export function attachmentPicker(form,{taskId,api,prepareFile,report=false}){
  const input=form.querySelector('#attachment'),list=form.querySelector('#attachment-list'),status=form.querySelector('#attachment-status'),error=form.querySelector('.error');
  const entries=[];let closeScanner=null;
  const key=f=>JSON.stringify([f.name,f.type,f.size,f.lastModified]);
  function render(){
    list.replaceChildren();status.textContent=entries.length?`${entries.length} of ${MAX_TASK_ATTACHMENTS} files selected`:'';
    for(const entry of entries){
      const row=document.createElement('li');row.className='attachment-row';
      if(entry.preview){const img=document.createElement('img');img.src=entry.preview;img.alt='';row.append(img);}
      const label=document.createElement('span');label.textContent=entry.file.name+' · '+sizeText(entry.file.size);row.append(label);
      const remove=document.createElement('button');remove.type='button';remove.textContent='Verwyder';remove.setAttribute('aria-label','Remove '+entry.file.name);
      remove.onclick=()=>{if(form.querySelector('fieldset').disabled)return;entries.splice(entries.indexOf(entry),1);if(entry.preview)URL.revokeObjectURL(entry.preview);error.textContent='';render();};
      row.append(remove);list.append(row);
    }
  }
  function add(selected){
    error.textContent='';const known=new Set(entries.map(e=>key(e.file))),added=[];
    for(const file of selected){
      if(known.has(key(file)))continue;
      const type=fileType(file);
      if(!(report?['application/pdf']:documents).includes(type)&&!imageTypes.has(type)){
        error.textContent=file.name+(report?': choose a JPG, PNG, HEIC, HEIF, WebP or PDF.':': kies ’n foto, PDF, Word-, Excel-, CSV- of tekslêer.');return false;
      }
      if(!imageTypes.has(type)&&file.size>(report?MAX_BYTES:LIMIT)){error.textContent=file.name+': hoogstens '+(report?'500 KB.':'6 MB.');return false;}
      known.add(key(file));added.push(file);
    }
    if(entries.length+added.length>MAX_TASK_ATTACHMENTS){error.textContent='Choose up to 12 files. Jou vorige keuses is nog hier.';return false;}
    for(const file of added)entries.push({file,id:crypto.randomUUID(),preview:imageTypes.has(fileType(file))?URL.createObjectURL(file):null});
    render();return true;
  }
  for(const field of [input,...form.querySelectorAll('[data-photo-input]')]){
    field.onchange=()=>{if(!form.querySelector('fieldset').disabled)add(Array.from(field.files||[]));field.value='';};
  }
  form.querySelectorAll('[data-pick]').forEach(button=>button.onclick=()=>form.querySelector('#'+button.dataset.pick).click());
  const scan=form.querySelector('[data-scan]');
  if(scan)scan.onclick=()=>{
    if(entries.length>=MAX_TASK_ATTACHMENTS){error.textContent='Verwyder eers ’n lêer. Hoogstens 12 per taak.';return;}
    closeScanner=openScanner({attach:file=>add([file]),limit:report?MAX_BYTES:LIMIT});
  };
  render();
  async function prepare(){
    for(const [index,entry] of entries.entries()){
      status.textContent=`Berei lêer ${index+1} van ${entries.length} voor…`;
      try{entry.payload??=await prepareFile(entry.file,{report});}
      catch(e){status.textContent='Jou keuses is nog hier.';throw Error(entry.file.name+': '+e.message);}
    }
    status.textContent=entries.length?'Laai lêers op…':'';
    return entries.map(entry=>({id:entry.id,...entry.payload}));
  }
  return {
    async prepare(){
      const files=await prepare();
      if(files.reduce((n,f)=>n+f.base64.length,0)>8000048)throw Error('Die lêers saam is groter as 6 MB. Verwyder een of voeg ’n dokumentskakel by.');
      return files;
    },
    async upload(){
      await prepare();
      for(const [index,entry] of entries.entries()){
        if(entry.uploaded)continue;
        const caption=`Laai lêer ${index+1} van ${entries.length} op`;
        status.textContent=caption+'…';
        try{await api('/api/tasks/file',{id:entry.id,task_id:taskId,...entry.payload},pct=>{status.textContent=caption+' · '+pct+'%';});entry.uploaded=true;}
        catch(e){status.textContent='Jou keuses is nog hier. Probeer weer.';throw Error(entry.file.name+': '+e.message);}
      }
      status.textContent=entries.length?'Stoor taak…':'';return entries.map(e=>e.id);
    },
    dispose(){closeScanner?.();for(const entry of entries)if(entry.preview)URL.revokeObjectURL(entry.preview);}
  };
}
