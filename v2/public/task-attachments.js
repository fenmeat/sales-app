export const MAX_TASK_ATTACHMENTS=12;
const allowedTypes=new Set(['image/jpeg','image/png','application/pdf']);

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
   if(!allowedTypes.has(file.type)){error.textContent=`${file.name}: choose a JPG, PNG or PDF.`;return;}
   if(file.type==='application/pdf'&&file.size>500000){error.textContent=`${file.name}: PDFs must be 500 KB or smaller.`;return;}
   known.add(key(file));added.push(file);
  }
  if(entries.length+added.length>MAX_TASK_ATTACHMENTS){error.textContent=`Choose up to ${MAX_TASK_ATTACHMENTS} files. Your earlier selections are still here.`;return;}
  for(const file of added)entries.push({file,id:crypto.randomUUID(),preview:file.type.startsWith('image/')?URL.createObjectURL(file):null});
  render();
 };
 render();
 return {
  async upload(){
   // Validate and resize every file before writing any of this selection.
   for(const entry of entries){
    try{entry.payload??=await prepareFile(entry.file);}catch(e){throw Error(entry.file.name+': '+e.message);}
   }
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
