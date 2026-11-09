import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {renderReport} from '../public/tasks-report.js';
import {reminderOptions} from '../public/task-report-model.js';
import {attachmentPicker,MAX_TASK_ATTACHMENTS,TASK_FILE_ACCEPT,fileData} from '../public/task-attachments.js';
import {createCanvas,loadImage} from '@napi-rs/canvas';

async function screen(username,tasks=[],view='',mailPages=null,{expired=false}={}){
 const {document}=parseHTML('<html><body><div id="app"></div><dialog id="dialog"></dialog><div id="message"></div></body></html>');
 globalThis.document=document;
 const dialog=document.querySelector('dialog');dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
 const query=document.querySelector.bind(document);
 const prepare=form=>{
  if(!form||form.localName!=='form')return form;
  const controls=[...form.querySelectorAll('[name]')];
  for(const select of controls.filter(c=>c.localName==='select'))Object.defineProperty(select,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')??this.querySelector('option[selected]')?.textContent??this.querySelector('option')?.getAttribute('value')??this.querySelector('option')?.textContent;},set(value){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',(o.getAttribute('value')??o.textContent)===value);}});
  Object.defineProperty(form,'elements',{configurable:true,value:Object.fromEntries(controls.map(c=>[c.name,c]))});return form;
 };
 const dq=dialog.querySelector.bind(dialog);dialog.querySelector=s=>prepare(dq(s));
 document.querySelector=s=>prepare(query(s));
 class FormData{
  constructor(form){this.values=(form.querySelector('fieldset')?.disabled?[]:[...form.querySelectorAll('[name]')]).filter(c=>c.type!=='checkbox'||c.checked).map(c=>[c.name,c.type==='checkbox'?'on':c.value]);}
  has(name){return this.values.some(([key])=>key===name);}
  [Symbol.iterator](){return this.values[Symbol.iterator]();}
 }
 const state={username,invoice_rep:['tapiz','mosa'].includes(username),admin:['alex','alinda'].includes(username),today:'2099-11-02',users:['alex','alinda'].includes(username)?['alex','alinda','xalinda','xavier']:[username],suppliers:['crown'],tasks,notifications:[],next_offset:null};
 const posts=[],postPaths=[];let failNext=false,failAt=-1;
 const fetch=async(path,options={})=>{
  if(options.method==='POST'){
   if(path==='/api/invoicing/access/login')expired=false;
   const body=JSON.parse(options.body);posts.push(body);postPaths.push(path);
   if(failNext||posts.length===failAt){failNext=false;throw Error('Connection interrupted. Please retry.');}
   return {ok:true,json:async()=>({task:{...body.data,id:body.task_id,revision:1}})};
  }
  if(path==='/api/tasks'&&expired)return {ok:false,status:401,json:async()=>({error:'Enter your PIN again.'})};
  if(path==='/api/invoicing/access/status')return {ok:true,json:async()=>({registered:true,name:username==='tapiz'?'Tapiz':'Musa'})};
  if(path.startsWith('/api/tasks/emails'))return {ok:true,json:async()=>mailPages?structuredClone(mailPages[path]):({requests:[],contacts:{from_address:'alex@example.com',recipients:{xavier:'xavier@example.com',xalinda:'xalinda@example.com'}}})};
  return {ok:true,json:async()=>structuredClone(state)};
 };
 const source=(await readFile(new URL('../public/tasks-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/load\(\);\s*$/,'await load();');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('document','window','location','history','fetch','FormData','setTimeout','renderReport','reminderOptions','attachmentPicker','MAX_TASK_ATTACHMENTS','TASK_FILE_ACCEPT','fileData',source)(document,{addEventListener(){}}, {href:'https://ui-test.example/tasks'+view,origin:'https://ui-test.example'},{replaceState(){}},fetch,FormData,()=>0,renderReport,reminderOptions,attachmentPicker,MAX_TASK_ATTACHMENTS,TASK_FILE_ACCEPT,fileData);
 return {document,dialog,posts,postPaths,failNext:()=>failNext=true,failOnPost:n=>failAt=n};
}

test('road phone Tasks shows only Home and Invoices with own general tasks and reminders',async()=>{
 for(const username of ['tapiz','mosa']){
  const {document,dialog,posts}=await screen(username,[],'?view=report');
  assert.equal(document.querySelector('h1').textContent,'Tasks');
  assert.deepEqual([...document.querySelectorAll('header nav a')].map(a=>a.getAttribute('href')),['/','/invoicing/']);
  assert.equal(document.querySelector('#daily-report'),null);assert.equal(document.querySelector('#owner'),null);
  assert.ok(document.querySelector('#push'));assert.doesNotMatch(document.body.textContent,/PA register could not/);
  document.querySelector('#new').onclick();const form=dialog.querySelector('form');
  assert.equal(form.elements.assigned_to.value,username);assert.equal(form.elements.kind,undefined);assert.equal(form.elements.supplier,undefined);
  assert.ok(form.elements.reminder_mode);assert.ok(document.querySelector('#attachment'));
  form.elements.title.value='Synthetic rep task';await form.onsubmit({preventDefault(){}});
  assert.equal(posts[0].data.assigned_to,username);assert.equal(posts[0].action,'create');assert.equal(dialog.open,false);
 }
});

test('expired road phone Tasks renews the same PIN session without asking for an access key',async()=>{
 const {document,posts,postPaths}=await screen('tapiz',[],'',null,{expired:true});
 const form=document.querySelector('#task-pin');assert.ok(form);
 const input=form.querySelector('[name=pin]');assert.equal(input.getAttribute('inputmode'),'numeric');assert.equal(input.type,'password');
 assert.equal(form.querySelector('[name=key]'),null);input.value='804739';
 await form.onsubmit({target:form,preventDefault(){}});
 assert.equal(input.value,'');assert.equal(document.querySelector('#task-pin'),null);
 assert.ok(document.querySelector('#new'));assert.deepEqual(postPaths,['/api/invoicing/access/login']);assert.deepEqual(posts,[{pin:'804739'}]);
});

test('staff creation UI offers self-assigned tasks, SAST reminders and stable retry identifiers',async()=>{
 for(const username of ['xavier','xalinda']){
  const {document,dialog,posts,failNext}=await screen(username);
  assert.ok(document.querySelector('#new'));assert.equal(document.querySelector('#owner'),null);
  document.querySelector('#new').onclick();let form=dialog.querySelector('form');
  assert.equal(form.elements.assigned_to.value,username);assert.equal(form.elements.assigned_to.type,'hidden');
  assert.equal(form.elements.reminder_mode.value,'daily');assert.equal(document.querySelector('#reminder-time').hidden,true);
  form.elements.reminder_mode.value='once';form.elements.reminder_mode.onchange();assert.equal(form.elements.reminder_at.required,true);
  form.elements.reminder_at.value='2099-11-02T09:45';form.elements.title.value='Own task';
  failNext();await form.onsubmit({preventDefault(){}});assert.match(form.querySelector('.error').textContent,/Connection interrupted/);assert.equal(dialog.open,true);
  await form.onsubmit({preventDefault(){}});assert.equal(dialog.open,false);
  assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1],'lost-response retry keeps task ID, request ID and reminder');
  assert.equal(posts[0].data.assigned_to,username);assert.equal(posts[0].data.reminder_at,'2099-11-02T07:45:00.000Z');
  assert.equal(posts[0].action,'create');
 }
});

test('admin-assigned work offers staff a reminder editor without assignment or instruction fields',async()=>{
 const task={id:'synthetic-assigned-task',revision:7,title:'Assigned work',details:'Keep instructions',assigned_to:'xalinda',created_by:'alex',status:'Pending',kind:'general',priority:'Normal',due_date:'2099-11-02',review_date:'',pa_sync:{status:'synced'}};
 const {document,dialog,posts}=await screen('xalinda',[task]);
 document.querySelector('[data-task]').onclick();assert.equal(document.querySelector('#edit'),null);assert.equal(document.querySelector('#cancel-task'),null);
 document.querySelector('#reminder').onclick();const form=dialog.querySelector('form');
 assert.equal(form.elements.title,undefined);assert.equal(form.elements.assigned_to,undefined);
 form.elements.reminder_mode.value='off';form.elements.reminder_mode.onchange();await form.onsubmit({preventDefault(){}});
 assert.deepEqual(posts[0].data,{reminder_mode:'off',reminder_at:''});assert.equal(posts[0].action,'reminder');assert.equal(posts[0].revision,7);
});

test('both admins keep Everyone, assignments and reminders while staff manage their own instructions',async()=>{
 for(const username of ['alex','alinda']){
  const {document,dialog}=await screen(username);assert.match(document.querySelector('#owner').textContent,/Everyone/);
  document.querySelector('#new').onclick();const form=dialog.querySelector('form');assert.equal(form.elements.assigned_to.querySelectorAll('option').length,4);assert.equal(form.elements.reminder_mode.value,'daily');
 }
 const own={id:'synthetic-own-task',revision:1,title:'My work',details:'',assigned_to:'xavier',created_by:'xavier',status:'Pending',kind:'general',priority:'Normal',review_date:'2099-11-02',pa_sync:{status:'pending'}};
 const {document,dialog}=await screen('xavier',[own]);document.querySelector('[data-task]').onclick();assert.ok(document.querySelector('#cancel-task'));document.querySelector('#edit').onclick();assert.equal(dialog.querySelector('form').elements.title.value,'My work');
});

const reportTask=(overrides={})=>({id:'synthetic-report-task',revision:2,title:'Example task',details:'Some detail',assigned_to:'xavier',created_by:'alex',status:'Pending',kind:'general',priority:'Normal',due_date:'2099-11-02',review_date:'',pa_sync:{status:'synced'},...overrides});
test('report UI shows three contextual actions, asks without a second task and supports direct email review',async()=>{
 const {document,dialog,posts}=await screen('alex',[reportTask()],'?view=report');
 assert.equal(document.querySelector('h1').textContent,'Daily Report');assert.match(document.querySelector('#report-owner').textContent,/Everyone/);
 assert.equal(document.querySelectorAll('[data-quick]').length,3);
 await document.querySelector('[data-quick="ask"]').onclick();assert.equal(posts[0].action,'request_update');assert.equal(posts[0].task_id,'synthetic-report-task');
 document.querySelector('[data-email]').onclick();const form=dialog.querySelector('form');assert.match(dialog.textContent,/xavier@example.com/);assert.match(dialog.textContent,/processes email requests hourly/);
 await form.onsubmit({preventDefault(){}});assert.equal(posts[1].action,'queue_email');assert.equal(posts[1].confirm_send,true);assert.equal(posts[1].to_address,'xavier@example.com');assert.match(posts[1].body,/view=report&task=synthetic-report-task/);
});
test('staff report has only own work and quick feedback uses the existing request',async()=>{
 const own=reportTask({feedback_request:{id:'synthetic-update-request',by:'alex',to:'xavier',status:'pending',question:'How is it going?'}});
 const {document,posts}=await screen('xavier',[own,reportTask({id:'other-private-task',assigned_to:'xalinda',title:'Not for Xavier'})],'?view=report');
 assert.equal(document.querySelector('#report-owner'),null);assert.doesNotMatch(document.querySelector('#app').textContent,/Not for Xavier/);assert.equal(document.querySelector('[data-email]'),null);
 assert.match(document.querySelector('#app').textContent,/How is it going/);await document.querySelector('[data-quick="in_progress"]').onclick();assert.equal(posts[0].response,'in_progress');assert.equal(posts[0].action,'respond');
});
test('quick report actions keep an identical retry after a lost connection and block double taps',async()=>{
 const {document,posts,failNext}=await screen('alex',[reportTask()],'?view=report');failNext();
 await document.querySelector('[data-quick="ask"]').onclick();assert.match(document.querySelector('#message').textContent,/Connection interrupted/);
 const button=document.querySelector('[data-quick="ask"]');await Promise.all([button.onclick(),button.onclick()]);assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);
});
test('Remind me on someone else’s task saves a personal follow-up while own tasks keep their normal reminder',async()=>{
 let ui=await screen('alex',[reportTask()],'?view=report');
 ui.document.querySelector('[data-quick="remind"]').onclick();assert.match(ui.dialog.textContent,/This reminds you to follow up/);
 await ui.dialog.querySelector('[data-reminder="0"]').onclick();
 assert.equal(ui.posts[0].action,'followup_reminder');assert.deepEqual(Object.keys(ui.posts[0].data),['reminder_at']);
 ui=await screen('alex',[reportTask()],'?view=report');ui.document.querySelector('[data-quick="remind"]').onclick();ui.document.querySelector('#custom-reminder').onclick();
 const form=ui.dialog.querySelector('form');form.elements.reminder_at.value='2099-11-02T09:45';await form.onsubmit({preventDefault(){}});
 assert.equal(ui.posts[0].action,'followup_reminder');assert.equal(ui.posts[0].data.reminder_at,'2099-11-02T07:45:00.000Z');
 ui=await screen('xavier',[reportTask()],'?view=report');ui.document.querySelector('[data-quick="remind"]').onclick();await ui.dialog.querySelector('[data-reminder="0"]').onclick();
 assert.equal(ui.posts[0].action,'reminder');assert.equal(ui.posts[0].data.reminder_mode,'once');
});
test('report reads every email-status page before offering another send',async()=>{
 const {document}=await screen('alex',[reportTask()],'?view=report',{
  '/api/tasks/emails':{requests:[],contacts:{from_address:'alex@example.com',recipients:{xavier:'xavier@example.com'}},next_offset:100},
  '/api/tasks/emails?offset=100':{requests:[{id:'synthetic-email-request',task_id:'synthetic-report-task',status:'pending'}],next_offset:null}
 });
 assert.match(document.querySelector('#app').textContent,/Email queued/);assert.ok(document.querySelector('[data-cancel-email]'));assert.equal(document.querySelector('[data-email]'),null);
});

const pdf=name=>new File(['%PDF-1.4 synthetic test evidence'],name,{type:'application/pdf',lastModified:1});
function selectFiles(ui,files){const input=ui.dialog.querySelector('#attachment');Object.defineProperty(input,'files',{configurable:true,value:files});input.onchange();}

test('new task photos are selected, removed and saved atomically with instructions for admins and staff',async()=>{
 for(const user of ['alex','alinda','xavier','xalinda']){
  const ui=await screen(user);ui.document.querySelector('#new').onclick();
  const a=pdf('instructions.pdf'),b=pdf('wrong.pdf'),c=pdf('example.pdf');
  selectFiles(ui,[a,b]);selectFiles(ui,[a,c]);
  ui.dialog.querySelector('[aria-label="Remove wrong.pdf"]').onclick();
  const form=ui.dialog.querySelector('form');form.elements.title.value='Check these examples';form.elements.details.value='Keep these instructions';
  await Promise.all([form.onsubmit({preventDefault(){}}),form.onsubmit({preventDefault(){}})]);
  assert.deepEqual(ui.postPaths,['/api/tasks'],'photos and task have one save, with no pre-existing task required');
  assert.equal(ui.posts[0].action,'create');assert.equal(ui.posts[0].data.details,'Keep these instructions');
  assert.deepEqual(ui.posts[0].files.map(f=>f.filename),['instructions.pdf','example.pdf']);
  assert.ok(ui.posts[0].files.every(f=>atob(f.base64).startsWith('%PDF-')));
  assert.equal(ui.dialog.open,false);
 }
});

test('lost new-task save keeps all photo bytes, task ID, request ID and instructions for retry',async()=>{
 const ui=await screen('alex');ui.document.querySelector('#new').onclick();
 selectFiles(ui,[pdf('first.pdf'),pdf('second.pdf')]);
 const form=ui.dialog.querySelector('form');form.elements.title.value='With photos';form.elements.assigned_to.value='xavier';
 ui.failNext();await form.onsubmit({preventDefault(){}});
 assert.equal(ui.dialog.open,true);assert.equal(ui.dialog.querySelectorAll('.attachment-row').length,2);
 assert.match(form.querySelector('.error').textContent,/Connection interrupted/);
 await form.onsubmit({preventDefault(){}});
 assert.deepEqual(ui.posts[0],ui.posts[1]);assert.equal(ui.posts.length,2);
 assert.equal(ui.posts[1].data.assigned_to,'xavier');assert.equal(ui.dialog.open,false);
});

test('creation resizes real photo pixels and sends the resulting JPEG with its preview',async t=>{
 const ui=await screen('xavier');ui.document.querySelector('#new').onclick();
 const bitmap=globalThis.createImageBitmap;
 globalThis.createImageBitmap=async file=>{const image=await loadImage(Buffer.from(await file.arrayBuffer()));image.close=()=>{};return image;};
 t.after(()=>{globalThis.createImageBitmap=bitmap;});
 const create=ui.document.createElement.bind(ui.document);
 ui.document.createElement=name=>{
  if(name!=='canvas')return create(name);
  const canvas=createCanvas(1,1);canvas.toBlob=(callback,mime)=>callback(new Blob([canvas.toBuffer(mime)],{type:mime}));return canvas;
 };
 const photo=createCanvas(2000,1000);photo.getContext('2d').fillRect(0,0,2000,1000);
 selectFiles(ui,[new File([photo.toBuffer('image/png')],'photo.png',{type:'image/png'})]);
 assert.ok(ui.dialog.querySelector('.attachment-row img'));
 const form=ui.dialog.querySelector('form');form.elements.title.value='Photo example';await form.onsubmit({preventDefault(){}});
 assert.equal(ui.posts.length,1);assert.equal(ui.posts[0].files[0].mime_type,'image/jpeg');
 const saved=await loadImage(Buffer.from(ui.posts[0].files[0].base64,'base64'));assert.equal(saved.width,1600);assert.equal(saved.height,800);
});

test('task instruction photos reopen while pending, survive edits and stay separate from completion evidence',async()=>{
 const ids=['instruction-file-one','instruction-file-two'];
 const ui=await screen('xavier',[reportTask({created_by:'xavier',attachments:ids})]);
 ui.document.querySelector('[data-task]').onclick();
 const links=[...ui.dialog.querySelectorAll('a[href^="/api/tasks/file"]')];
 assert.deepEqual(links.map(a=>a.getAttribute('href')),ids.map(id=>'/api/tasks/file?id='+id));
 assert.match(ui.dialog.textContent,/Task photos \/ documents/);
 ui.document.querySelector('#edit').onclick();
 assert.equal(ui.dialog.querySelectorAll('a[href^="/api/tasks/file"]').length,2);
 const form=ui.dialog.querySelector('form');form.elements.title.value='Updated instructions';await form.onsubmit({preventDefault(){}});
 assert.equal(ui.posts[0].action,'update');assert.equal(ui.posts[0].files,undefined);assert.equal(ui.posts[0].data.attachments,undefined);
});

test('completion accepts multiple selections, adds more, ignores duplicate choices and removes one file',async()=>{
 const ui=await screen('xavier',[reportTask({requires_evidence:true})]);
 ui.document.querySelector('[data-complete]').onclick();
 assert.equal(ui.dialog.querySelector('#attachment').hasAttribute('multiple'),true);
 const a=pdf('first.pdf'),b=pdf('second.pdf'),c=pdf('third.pdf');
 selectFiles(ui,[a,b]);selectFiles(ui,[a,c]);assert.equal(ui.dialog.querySelectorAll('.attachment-row').length,3);
 ui.dialog.querySelector('[aria-label="Remove second.pdf"]').onclick();
 assert.equal(ui.dialog.querySelectorAll('.attachment-row').length,2);
 const form=ui.dialog.querySelector('form');form.elements.note.value='Two evidence files';
 await Promise.all([form.onsubmit({preventDefault(){}}),form.onsubmit({preventDefault(){}})]);
 assert.deepEqual(ui.postPaths,['/api/tasks/file','/api/tasks/file','/api/tasks']);
 assert.deepEqual(ui.posts.slice(0,2).map(p=>p.filename),['first.pdf','third.pdf']);
 assert.deepEqual(ui.posts[2].attachments,ui.posts.slice(0,2).map(p=>p.id));
 assert.equal(ui.posts[2].note,'Two evidence files');assert.equal(ui.dialog.open,false);
});

test('partial upload and lost completion responses retry the same IDs without duplicating successful files',async()=>{
 const ui=await screen('xalinda',[reportTask({assigned_to:'xalinda',requires_evidence:true})]);
 ui.document.querySelector('[data-complete]').onclick();selectFiles(ui,[pdf('a.pdf'),pdf('b.pdf'),pdf('c.pdf')]);
 const form=ui.dialog.querySelector('form');ui.failOnPost(2);await form.onsubmit({preventDefault(){}});
 assert.equal(ui.dialog.open,true);assert.equal(ui.posts.some(p=>p.action==='complete'),false);
 assert.match(form.querySelector('.error').textContent,/b.pdf.*Connection interrupted/);
 assert.equal(form.querySelector('fieldset').disabled,false);
 ui.failOnPost(5);await form.onsubmit({preventDefault(){}});
 assert.deepEqual(ui.posts[1],ui.posts[2],'retry the uncertain upload with the same ID and bytes');
 assert.equal(ui.posts[4].attachments.length,3);assert.equal(ui.dialog.open,true);
 await form.onsubmit({preventDefault(){}});
 assert.deepEqual(ui.postPaths,['/api/tasks/file','/api/tasks/file','/api/tasks/file','/api/tasks/file','/api/tasks','/api/tasks']);
 assert.deepEqual(ui.posts[4],ui.posts[5],'completion retries exactly once with its original request ID');
 assert.equal(ui.dialog.open,false);
});

test('selection limits and invalid files keep earlier choices and completed tasks display every attachment',async()=>{
 const ui=await screen('xavier',[reportTask()]);ui.document.querySelector('[data-complete]').onclick();
 selectFiles(ui,Array.from({length:12},(_,i)=>pdf(`file-${i}.pdf`)));
 assert.match(ui.dialog.querySelector('#attachment-status').textContent,/12 of 12/);
 selectFiles(ui,[pdf('extra.pdf')]);assert.match(ui.dialog.querySelector('.error').textContent,/up to 12/);assert.equal(ui.dialog.querySelectorAll('.attachment-row').length,12);
 selectFiles(ui,[new File(['bad'],'unsupported.txt',{type:'text/plain'})]);assert.match(ui.dialog.querySelector('.error').textContent,/JPG, PNG, HEIC, HEIF, WebP or PDF/);
 assert.equal(ui.posts.length,0);
 const ids=['first-file-id','second-file-id','third-file-id'];
 const closed=await screen('xavier',[reportTask({status:'Complete',completion:{by:'xavier',at:'2099-11-02T08:00:00Z',attachments:ids}})]);
 closed.document.querySelector('#filter').onchange({target:{value:'closed'}});
 closed.document.querySelector('[data-task]').onclick();
 const links=[...closed.dialog.querySelectorAll('a[href^="/api/tasks/file"]')];
 assert.deepEqual(links.map(a=>a.getAttribute('href')),ids.map(id=>'/api/tasks/file?id='+id));
 assert.deepEqual(links.map(a=>a.textContent),['Open attachment 1 of 3','Open attachment 2 of 3','Open attachment 3 of 3']);
});

function realPhotoTools(ui,t,{failBitmap=false,nullBlob=false}={}){
 const previous=globalThis.createImageBitmap,calls=[];let closed=0;
 globalThis.createImageBitmap=async(file,options)=>{assert.equal(options.imageOrientation,'from-image');if(failBitmap)throw Error('Unsupported bitmap decoder');const image=await loadImage(Buffer.from(await file.arrayBuffer()));image.close=()=>closed++;return image;};
 t.after(()=>{globalThis.createImageBitmap=previous;});
 const create=ui.document.createElement.bind(ui.document);
 ui.document.createElement=name=>{
  if(name!=='canvas')return create(name);
  const canvas=createCanvas(1,1);
  canvas.toBlob=(callback,mime,quality)=>{const bytes=canvas.toBuffer(mime,Math.round(quality*100));calls.push({width:canvas.width,height:canvas.height,bytes:bytes.length,quality});callback(nullBlob?null:new Blob([bytes],{type:mime}));};
  return canvas;
 };
 return {calls,closed:()=>closed};
}
function noisyPhoto(width=1600,height=1200){
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(width,height);let seed=1;
 for(let i=0;i<pixels.data.length;i+=4){for(let j=0;j<3;j++){seed=(1664525*seed+1013904223)>>>0;pixels.data[i+j]=seed>>>24;}pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);return canvas;
}

test('multi-MB detailed photo that failed the old 500 KB limit now fits, with exact retry bytes',async t=>{
 const ui=await screen('alex');ui.document.querySelector('#new').onclick();const tools=realPhotoTools(ui,t);
 const photo=noisyPhoto();assert.ok(photo.toBuffer('image/jpeg',75).length>500000,'reproduces old rejection');
 const original=photo.toBuffer('image/png');assert.ok(original.length>5000000);
 selectFiles(ui,[new File([original],'large-photo.PNG',{type:'image/png'})]);
 const form=ui.dialog.querySelector('form');form.elements.title.value='Detailed phone photo';ui.failNext();await form.onsubmit({preventDefault(){}});
 assert.equal(ui.posts.length,1);const saved=ui.posts[0].files[0];const bytes=Buffer.from(saved.base64,'base64');
 assert.ok(bytes.length<=500000);assert.equal(saved.filename,'large-photo.jpg');assert.equal(saved.mime_type,'image/jpeg');
 const image=await loadImage(bytes);assert.ok(image.width>=900);assert.equal(image.width/image.height,4/3);
 assert.ok(tools.calls.length>1);assert.ok(tools.calls.some(c=>c.width<1600),'also reduces dimensions when quality alone is insufficient');assert.equal(tools.closed(),1);
 const count=tools.calls.length;await form.onsubmit({preventDefault(){}});assert.deepEqual(ui.posts[0],ui.posts[1]);assert.equal(tools.calls.length,count,'does not decode again on retry');assert.equal(ui.dialog.open,false);
});

test('12 MP portrait keeps orientation, small canvas and correct JPEG name for an untyped photo',async t=>{
 const ui=await screen('xavier');ui.document.querySelector('#new').onclick();const tools=realPhotoTools(ui,t);
 const photo=createCanvas(3000,4000),ctx=photo.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,3000,2000);ctx.fillStyle='blue';ctx.fillRect(0,2000,3000,2000);
 selectFiles(ui,[new File([photo.toBuffer('image/png')],'IMG_1234.PNG',{type:''})]);
 const form=ui.dialog.querySelector('form');form.elements.title.value='Portrait';await form.onsubmit({preventDefault(){}});
 const saved=ui.posts[0].files[0],image=await loadImage(Buffer.from(saved.base64,'base64'));assert.equal(image.width,1200);assert.equal(image.height,1600);assert.equal(saved.filename,'IMG_1234.jpg');assert.ok(tools.calls.every(c=>c.width<=1600&&c.height<=1600));
});

test('HEIC selection uses native image fallback when bitmap decoding fails',async t=>{
 const ui=await screen('alex');ui.document.querySelector('#new').onclick();realPhotoTools(ui,t,{failBitmap:true});
 const photo=createCanvas(1200,1600);photo.getContext('2d').fillRect(0,0,1200,1600);
 // This tests the Safari fallback contract; the test runtime has no HEIC codec.
 const image=await loadImage(photo.toBuffer('image/png'));
 Object.defineProperty(image,'src',{set(value){if(value)queueMicrotask(()=>image.onload());}});
 const create=ui.document.createElement.bind(ui.document);ui.document.createElement=name=>name==='img'?image:create(name);
 const urls=[],oldRevoke=URL.revokeObjectURL;URL.revokeObjectURL=url=>{urls.push(url);oldRevoke(url);};t.after(()=>URL.revokeObjectURL=oldRevoke);
 const saved=await fileData(new File(['synthetic codec input'],'IMG_1234.HEIC',{type:'image/heic'}));
 assert.equal(saved.mime_type,'image/jpeg');assert.equal(saved.filename,'IMG_1234.jpg');assert.equal(urls.length,1);
 ui.document.createElement=create;selectFiles(ui,[new File(['synthetic'],'selected.HEIC',{type:'image/heic'})]);assert.equal(ui.dialog.querySelectorAll('.attachment-row').length,1);assert.match(ui.dialog.querySelector('#attachment').getAttribute('accept'),/image\/heic/);
});

test('photo encoding failure keeps task text and selected files, saves nothing and releases bitmap',async t=>{
 const ui=await screen('alex');ui.document.querySelector('#new').onclick();const tools=realPhotoTools(ui,t,{nullBlob:true});
 const photo=createCanvas(100,100);selectFiles(ui,[new File([photo.toBuffer('image/png')],'broken.png',{type:'image/png'})]);
 const form=ui.dialog.querySelector('form');form.elements.title.value='Do not lose this';await form.onsubmit({preventDefault(){}});
 assert.equal(ui.posts.length,0);assert.equal(form.elements.title.value,'Do not lose this');assert.equal(ui.dialog.open,true);assert.equal(ui.dialog.querySelectorAll('.attachment-row').length,1);assert.match(form.querySelector('.error').textContent,/could not be prepared/);assert.equal(tools.closed(),1);assert.equal(form.querySelector('fieldset').disabled,false);
});
