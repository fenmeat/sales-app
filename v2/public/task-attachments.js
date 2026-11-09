export const MAX_TASK_ATTACHMENTS=12;
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','image/heic-sequence','image/heif-sequence']);
const extensions={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',pdf:'application/pdf'};
export const TASK_FILE_ACCEPT='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf';
const MAX_BYTES=500000;
function fileType(file){return file.type&&file.type!=='application/octet-stream'?file.type.toLowerCase():(extensions[file.name.split('.').pop().toLowerCase()]||'');}

async function decodePhoto(file){
 // Use the browser's EXIF orientation. Some Safari photo formats only decode
 // through an image element, even when createImageBitmap exists.
 if(typeof createImageBitmap==='function'){
  try{const image=await createImageBitmap(file,{imageOrientation:'from-image'});return {image,width:image.width,height:image.height,release:()=>image.close()};}catch{}
 }
 const url=URL.createObjectURL(file),image=document.createElement('img');
 try{
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('This photo could not be opened. Try choosing it from Photo Library, or use a JPG or PNG copy.'));image.src=url;});
  return {image,width:image.naturalWidth,height:image.naturalHeight,release:()=>{image.src='';URL.revokeObjectURL(url);}};
 }catch(e){URL.revokeObjectURL(url);throw e;}
}

export async function fileData(file){
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

// Keep each upload ID and its exact bytes across retries, including lost responses.
export function attachmentPicker(form,{taskId,api,prepareFile}){
 const input=form.querySelector('#attachment'),list=form.querySelector('#attachment-list'),status=form.querySelector('#attachment-status'),error=form.querySelector('.error');
 const entries=[];
 function render(){
  list.replaceChildren();
  status.textContent=entries.length?`${entries.length} of ${MAX_TASK_ATTACHMENTS} files selected`:'No files selected';
  for(const entry of entries){
   const row=document.createElement('li');row.className='attachment-row';
   if(entry.preview){const img=document.createElement('img');img.src=entry.preview;img.alt='';row.append(img);}
   const label=document.createElement('span');label.textContent=entry.file.name;row.append(label);
   const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+entry.file.name);
   remove.onclick=()=>{if(form.querySelector('fieldset').disabled)return;entries.splice(entries.indexOf(entry),1);if(entry.preview)URL.revokeObjectURL(entry.preview);error.textContent='';render();};
   row.append(remove);list.append(row);
  }
 }
 input.onchange=()=>{
  if(form.querySelector('fieldset').disabled)return;
  error.textContent='';
  const selected=Array.from(input.files||[]);input.value='';
  const key=f=>JSON.stringify([f.name,f.type,f.size,f.lastModified]);
  const known=new Set(entries.map(e=>key(e.file))),added=[];
  for(const file of selected){
   if(known.has(key(file)))continue;
   const type=fileType(file);
   if(!imageTypes.has(type)&&type!=='application/pdf'){error.textContent=`${file.name}: choose a JPG, PNG, HEIC, HEIF, WebP or PDF.`;return;}
   if(type==='application/pdf'&&file.size>MAX_BYTES){error.textContent=`${file.name}: PDFs must be 500 KB or smaller.`;return;}
   known.add(key(file));added.push(file);
  }
  if(entries.length+added.length>MAX_TASK_ATTACHMENTS){error.textContent=`Choose up to ${MAX_TASK_ATTACHMENTS} files. Your earlier selections are still here.`;return;}
  for(const file of added)entries.push({file,id:crypto.randomUUID(),preview:imageTypes.has(fileType(file))?URL.createObjectURL(file):null});
  render();
 };
 render();
 async function prepare(){
  for(const [index,entry] of entries.entries()){
   status.textContent=`Preparing ${index+1} of ${entries.length}… Large photos are resized automatically.`;
   try{entry.payload??=await prepareFile(entry.file);}catch(e){status.textContent='Could not prepare this file. Your selection is kept.';throw Error(entry.file.name+': '+e.message);}
  }
  status.textContent=entries.length?`${entries.length} files ready. Saving…`:'';
  return entries.map(entry=>({id:entry.id,...entry.payload}));
 }
 return {
  // New-task photos are committed with the task in one atomic save.
  prepare,
  async upload(){
   // Validate and resize every file before writing any of this selection.
   await prepare();
   for(const [index,entry] of entries.entries()){
    if(entry.uploaded)continue;
    status.textContent=`Uploading ${index+1} of ${entries.length}…`;
    try{await api('/api/tasks/file',{id:entry.id,task_id:taskId,...entry.payload});entry.uploaded=true;}
    catch(e){status.textContent='Upload interrupted. Your selection is kept for retry.';throw Error(entry.file.name+': '+e.message);}
   }
   status.textContent=entries.length?`${entries.length} files uploaded. Saving task…`:'';
   return entries.map(e=>e.id);
  },
  dispose(){for(const entry of entries)if(entry.preview)URL.revokeObjectURL(entry.preview);}
 };
}
