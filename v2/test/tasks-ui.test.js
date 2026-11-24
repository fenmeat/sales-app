import {mountProposal} from '../public/task-mail-proposal.js';
import {createWorkspaceCache} from '../public/task-workspace-cache.js';
import {taskType,projectTask,statusLabel,localDate,taskBrief} from '../src/task-workflow.js';
import {stepsHTML,workflowForms} from '../public/task-workflow-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {workHTML,noticeLabel,workLabel} from '../public/task-pa-work-ui.js';
import {renderReport} from '../public/tasks-report.js';
import {reminderOptions} from '../public/task-report-model.js';
import {attachmentPicker,MAX_TASK_ATTACHMENTS,TASK_FILE_ACCEPT,REPORT_FILE_ACCEPT,fileData} from '../public/task-attachments.js';
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
  constructor(form){this.values=(form.querySelector('fieldset')?.disabled?[]:[...form.querySelectorAll('[name]')]).filter(c=>!c.disabled&&(c.type!=='checkbox'||c.checked)).map(c=>[c.name,c.type==='checkbox'?(c.getAttribute('value')||'on'):c.value]);}
  get(name){return this.values.find(([k])=>k===name)?.[1]??null;}
  getAll(name){return this.values.filter(([k])=>k===name).map(x=>x[1]);}
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
  if(path.startsWith('/api/tasks?id='))return {ok:true,json:async()=>({task:structuredClone(state.tasks.find(t=>t.id===decodeURIComponent(path.split('=')[1])))})};
  if(path.startsWith('/api/tasks/emails'))return {ok:true,json:async()=>mailPages?structuredClone(mailPages[path]):({requests:[],contacts:{from_address:'alex@example.com',recipients:{xavier:'xavier@example.com',xalinda:'xalinda@example.com'}}})};
  return {ok:true,json:async()=>structuredClone(state)};
 };
 const source=(await readFile(new URL('../public/tasks-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/load\(\);\s*$/,'await load();');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('document','window','location','history','fetch','FormData','setTimeout','renderReport','reminderOptions','attachmentPicker','MAX_TASK_ATTACHMENTS','TASK_FILE_ACCEPT','REPORT_FILE_ACCEPT','fileData','taskType','projectTask','localDate','statusLabel','stepsHTML','workflowForms','mountProposal','createWorkspaceCache','workHTML','noticeLabel','workLabel','taskBrief',source)(document,{addEventListener(){}}, {href:'https://ui-test.example/tasks'+view,origin:'https://ui-test.example'},{replaceState(){}},fetch,FormData,()=>0,renderReport,reminderOptions,attachmentPicker,MAX_TASK_ATTACHMENTS,TASK_FILE_ACCEPT,REPORT_FILE_ACCEPT,fileData,taskType,projectTask,localDate,statusLabel,stepsHTML,workflowForms,mountProposal,createWorkspaceCache,workHTML,noticeLabel,workLabel,taskBrief);
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
  const {document,dialog}=await screen(username);assert.match(document.querySelector('#owner').textContent,/Almal/);
  document.querySelector('#new').onclick();const form=dialog.querySelector('form');assert.equal(form.elements.assigned_to.querySelectorAll('option').length,4);assert.equal(form.elements.reminder_mode.value,'daily');
 }
 const own={id:'synthetic-own-task',revision:1,title:'My work',details:'',assigned_to:'xavier',created_by:'xavier',status:'Pending',kind:'general',priority:'Normal',review_date:'2099-11-02',pa_sync:{status:'pending'}};
 const {document,dialog}=await screen('xavier',[own]);document.querySelector('[data-task]').onclick();assert.ok(document.querySelector('#cancel-task'));await document.querySelector('#edit').onclick();assert.equal(dialog.querySelector('form').elements.title.value,'My work');
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

test('creation previews a small PNG and keeps its exact format and full resolution',async t=>{
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
 assert.equal(ui.posts.length,1);assert.equal(ui.posts[0].files[0].mime_type,'image/png');
 const saved=await loadImage(Buffer.from(ui.posts[0].files[0].base64,'base64'));assert.equal(saved.width,2000);assert.equal(saved.height,1000);
});

test('task instruction photos reopen while pending, survive edits and stay separate from completion evidence',async()=>{
 const ids=['instruction-file-one','instruction-file-two'];
 const ui=await screen('xavier',[reportTask({created_by:'xavier',attachments:ids})]);
 ui.document.querySelector('[data-task]').onclick();
 const links=[...ui.dialog.querySelectorAll('a[href^="/api/tasks/file"]')];
 assert.deepEqual(links.map(a=>a.getAttribute('href')),ids.map(id=>'/api/tasks/file?id='+id));
 assert.match(ui.dialog.textContent,/Foto’s en dokumente/);
 await ui.document.querySelector('#edit').onclick();
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
 selectFiles(ui,[new File(['bad'],'unsupported.bin',{type:'application/octet-stream'})]);assert.match(ui.dialog.querySelector('.error').textContent,/kies ’n foto/);
 assert.equal(ui.posts.length,0);
 const ids=['first-file-id','second-file-id','third-file-id'];
 const closed=await screen('xavier',[reportTask({status:'Complete',completion:{by:'xavier',at:'2099-11-02T08:00:00Z',attachments:ids}})]);
 closed.document.querySelector('#filter').onchange({target:{value:'closed'}});
 closed.document.querySelector('[data-task]').onclick();
 const links=[...closed.dialog.querySelectorAll('a[href^="/api/tasks/file"]')];
 assert.deepEqual(links.map(a=>a.getAttribute('href')),ids.map(id=>'/api/tasks/file?id='+id));
 assert.deepEqual(links.map(a=>a.textContent),['Maak bewysstuk 1 van 3 oop','Maak bewysstuk 2 van 3 oop','Maak bewysstuk 3 van 3 oop']);
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

test('multi-MB detailed photo compresses without discarding fine detail, with exact retry bytes',async t=>{
 const ui=await screen('alex');ui.document.querySelector('#new').onclick();const tools=realPhotoTools(ui,t);
 const photo=noisyPhoto();assert.ok(photo.toBuffer('image/jpeg',75).length>500000,'reproduces old rejection');
 const original=photo.toBuffer('image/png');assert.ok(original.length>5000000);
 selectFiles(ui,[new File([original],'large-photo.PNG',{type:'image/png'})]);
 const form=ui.dialog.querySelector('form');form.elements.title.value='Detailed phone photo';ui.failNext();await form.onsubmit({preventDefault(){}});
 assert.equal(ui.posts.length,1);const saved=ui.posts[0].files[0];const bytes=Buffer.from(saved.base64,'base64');
 assert.ok(bytes.length<original.length*.45);assert.match(saved.filename,/^large-photo\.(jpg|webp)$/);assert.match(saved.mime_type,/^image\/(jpeg|webp)$/);
 const image=await loadImage(bytes);assert.equal(image.width,1600);assert.equal(image.width/image.height,4/3);
 assert.ok(tools.calls.length>1);assert.equal(tools.closed(),1);
 const count=tools.calls.length;await form.onsubmit({preventDefault(){}});assert.deepEqual(ui.posts[0],ui.posts[1]);assert.equal(tools.calls.length,count,'does not decode again on retry');assert.equal(ui.dialog.open,false);
});

test('12 MP untyped PNG with a small file size keeps orientation and original pixels',async t=>{
 const ui=await screen('xavier');ui.document.querySelector('#new').onclick();const tools=realPhotoTools(ui,t);
 const photo=createCanvas(3000,4000),ctx=photo.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,3000,2000);ctx.fillStyle='blue';ctx.fillRect(0,2000,3000,2000);
 selectFiles(ui,[new File([photo.toBuffer('image/png')],'IMG_1234.PNG',{type:''})]);
 const form=ui.dialog.querySelector('form');form.elements.title.value='Portrait';await form.onsubmit({preventDefault(){}});
 const saved=ui.posts[0].files[0],image=await loadImage(Buffer.from(saved.base64,'base64'));assert.equal(image.width,3000);assert.equal(image.height,4000);assert.equal(saved.filename,'IMG_1234.PNG');assert.equal(tools.calls.length,0);
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
 assert.match(saved.mime_type,/^image\/(jpeg|webp)$/);assert.match(saved.filename,/^IMG_1234\.(jpg|webp)$/);assert.equal(urls.length,1);
 ui.document.createElement=create;selectFiles(ui,[new File(['synthetic'],'selected.HEIC',{type:'image/heic'})]);assert.equal(ui.dialog.querySelectorAll('.attachment-row').length,1);assert.match(ui.dialog.querySelector('#attachment').getAttribute('accept'),/image\/heic/);
});

test('photo encoding failure keeps task text and selected files, saves nothing and releases bitmap',async t=>{
 const ui=await screen('alex');ui.document.querySelector('#new').onclick();const tools=realPhotoTools(ui,t,{nullBlob:true});
 const photo=noisyPhoto(2200,1350);selectFiles(ui,[new File([photo.toBuffer('image/png')],'broken.png',{type:'image/png'})]);
 const form=ui.dialog.querySelector('form');form.elements.title.value='Do not lose this';await form.onsubmit({preventDefault(){}});
 assert.equal(ui.posts.length,0);assert.equal(form.elements.title.value,'Do not lose this');assert.equal(ui.dialog.open,true);assert.equal(ui.dialog.querySelectorAll('.attachment-row').length,1);assert.match(form.querySelector('.error').textContent,/kon nie gestoor word nie/);assert.equal(tools.closed(),1);assert.equal(form.querySelector('fieldset').disabled,false);
});


test('workflow form adds dependencies and completes only the selected step with a stable save',async()=>{
 const task={id:'workflow-synthetic',task_type:'workflow',kind:'general',status:'Pending',assigned_to:'alex',created_by:'alex',revision:3,title:'Synthetic step workflow',due_date:'2099-11-02',pa_sync:{status:'app_only'},steps:[{id:'step-1',description:'Inspect documents',assigned_to:'alex',status:'Pending',due_date:'2099-11-02',dependencies:[]},{id:'step-2',description:'Arrange later payment',assigned_to:'alinda',status:'Scheduled',due_date:'2099-11-30',dependencies:['step-1']}],progress:{done:0,total:2}};
 const ui=await screen('alex',[task]);ui.document.querySelector('[data-task]').onclick();assert.equal(ui.dialog.querySelectorAll('.step').length,2);assert.ok(ui.dialog.querySelector('[data-step-complete="step-2"]').hasAttribute('disabled'));assert.equal(ui.dialog.querySelector('#complete'),null);
 ui.dialog.querySelector('#add-step').onclick();let f=ui.dialog.querySelector('form');f.elements.description.value='Record proof';f.elements.assigned_to.value='alinda';f.elements.due_date.value='2099-12-01';f.elements.status.value='Scheduled';f.elements.required.checked=true;ui.dialog.querySelector('[name=dependency][value="step-2"]').checked=true;await f.onsubmit({preventDefault(){}});assert.equal(ui.posts[0].action,'step_add');assert.deepEqual(ui.posts[0].data.dependencies,['step-2']);assert.equal(ui.posts[0].data.description,'Record proof');
 ui.document.querySelector('[data-task]').onclick();ui.dialog.querySelector('[data-step-complete="step-1"]').onclick();f=ui.dialog.querySelector('form');f.elements.note.value='Checked';await f.onsubmit({preventDefault(){}});assert.equal(ui.posts[1].action,'step_complete');assert.equal(ui.posts[1].step_id,'step-1');assert.equal(ui.posts[1].note,'Checked');
});


test('converted dispatch workflow shows its steps without obsolete sending instructions',async()=>{
 const steps=[{id:'sent',description:'Bestelling gestuur',assigned_to:'alinda',status:'Complete',completion:{by:'alinda',at:'2099-11-01T08:00:00Z',note:'Confirmed'}},{id:'pay',description:'Kontroleer die staat',assigned_to:'alinda',status:'Scheduled',due_date:'2099-11-30',dependencies:['sent']}];
 const ui=await screen('alex',[reportTask({assigned_to:'alex',kind:'po_dispatch',task_type:'workflow',steps,status:'Scheduled'})]);
 ui.document.querySelector('#filter').onchange({target:{value:'scheduled'}});
 ui.document.querySelector('[data-task]').onclick();
 assert.equal(ui.dialog.textContent.includes('Bevestig wanneer jy die goedgekeurde bestelling gestuur het'),false);
 assert.equal(ui.dialog.querySelector('#complete'),null);
 assert.ok(ui.dialog.querySelector('[data-step-complete="pay"]'));
 assert.match(ui.dialog.textContent,/Kontroleer die staat/);
});

test('existing tasks at every stage expose the shared scanner and retain files on a failed save',async()=>{
 for(const status of ['Pending','Scheduled','Waiting','Complete','Cancelled']){
  const task=reportTask({status,attachments:['existing-reference']});
  const ui=await screen('xavier',[task],'?status=all');ui.document.querySelector('[data-task]').onclick();
  ui.dialog.querySelector('#add-attachments').onclick();
  const form=ui.dialog.querySelector('form');
  assert.deepEqual([...form.querySelectorAll('.attachment-tools button')].map(b=>b.textContent),['Take Photo','Scan Document','Photo Library','Choose Files']);
  assert.equal(typeof form.querySelector('[data-scan]').onclick,'function');
  selectFiles(ui,[pdf('later-scan.pdf')]);ui.failNext();await form.onsubmit({preventDefault(){}});
  assert.equal(ui.dialog.open,true);assert.equal(form.querySelectorAll('.attachment-row').length,1);
  await form.onsubmit({preventDefault(){}});assert.deepEqual(ui.posts[0],ui.posts[1]);
  assert.equal(ui.posts[1].action,'attach');assert.equal(ui.posts[1].files[0].filename,'later-scan.pdf');
  assert.equal(ui.posts[1].data,undefined);assert.equal(ui.posts[1].attachments,undefined);
 }
});

test('task edits, notes and PA followups share the scanner and submit documents with the message',async()=>{
 for(const [button,action] of [['#edit','update'],['#add-note','note'],['#ask-pa','pa_request']]){
  const ui=await screen('xavier',[reportTask({created_by:'xavier'})]);ui.document.querySelector('[data-task]').onclick();await ui.dialog.querySelector(button).onclick();
  const form=ui.dialog.querySelector('form');assert.ok(form.querySelector('[data-scan]'));
  if(form.elements.note)form.elements.note.value='Read this document';
  selectFiles(ui,[pdf('followup.pdf')]);await form.onsubmit({preventDefault(){}});
  assert.equal(ui.posts[0].action,action);assert.equal(ui.posts[0].files[0].filename,'followup.pdf');
  assert.deepEqual(ui.postPaths,['/api/tasks']);
 }
});

test('new workflow form captures five independent steps with scan controls and keeps stable retry IDs',async()=>{
 const {document,dialog,posts,failNext}=await screen('alex');document.querySelector('#new').onclick();let form=dialog.querySelector('form');
 form.elements.title.value='Synthetic five-step Dyna';form.elements.task_type.value='workflow';form.elements.task_type.onchange();
 for(let i=1;i<5;i++)document.querySelector('[data-add-draft]').onclick();
 const boxes=[...document.querySelectorAll('.draft-step')];assert.equal(boxes.length,5);
 for(const [i,box] of boxes.entries()){
  box.querySelector('[data-field=description]').value='Synthetic step '+i;
  for(const option of box.querySelectorAll('[data-field=assigned_to] option'))option.toggleAttribute('selected',option.value===['alex','alinda','xavier','xavier','alex'][i]);
  assert.ok(box.querySelector('[data-scan]'));assert.ok(box.querySelector('[data-photo-input]'));
 }
 failNext();await form.onsubmit({preventDefault(){}});assert.equal(dialog.open,true);await form.onsubmit({preventDefault(){}});
 assert.equal(posts[0].data.steps.length,5);assert.deepEqual(posts[0].data.steps.map(s=>s.assigned_to),['alex','alinda','xavier','xavier','alex']);assert.equal(new Set(posts[0].data.steps.map(s=>s.id)).size,5);assert.deepEqual(posts[0],posts[1]);
 assert.ok(posts[0].data.steps.every(s=>s.reminder_mode==='due'));
});

test('step details display progress, own work, overdue status and final approval without a complete shortcut',async()=>{
 const task={id:'synthetic-workflow-approval',revision:5,title:'Approval test',task_type:'workflow',assigned_to:'alex',created_by:'alex',status:'Pending',kind:'general',priority:'Normal',pa_sync:{status:'app_only'},steps:[{id:'one',description:'Done',assigned_to:'xavier',status:'Complete',completion:{by:'xavier',at:'2099-11-01T08:00:00Z'}},{id:'two',description:'Check',assigned_to:'alex',status:'Complete',completion:{by:'alex',at:'2099-11-01T08:00:00Z'}}]};
 const {document,dialog,posts}=await screen('alex',[task]);document.querySelector('[data-task]').onclick();
 assert.match(dialog.textContent,/2 van 2 stappe voltooi — 100%/);assert.match(dialog.textContent,/Wag vir goedkeuring/);assert.ok(dialog.querySelector('progress'));assert.equal(dialog.querySelector('#complete'),null);
 dialog.querySelector('#approve-workflow').onclick();const form=dialog.querySelector('form');await form.onsubmit({preventDefault(){}});assert.equal(posts[0].action,'approve_workflow');
});

test('simple task choice keeps ordinary work separate from a saved supplier stocktake',async()=>{
 const {document,dialog,posts}=await screen('alex');document.querySelector('#new').onclick();const form=dialog.querySelector('form');
 assert.deepEqual([...form.elements.task_type.querySelectorAll('option')].map(o=>o.textContent),['Gewone taak','Taak met stappe']);
 assert.equal(form.elements.kind.type,'hidden');assert.equal(document.querySelector('#supplier-field').hidden,true);
 form.elements.title.value='Synthetic count';form.elements.repeat.value='weekly';form.elements.requires_evidence.checked=true;
 document.querySelector('#choose-stocktake').onclick();
 assert.equal(document.querySelector('#general-choice').hidden,true);assert.equal(document.querySelector('#stocktake-choice').hidden,false);
 assert.equal(form.elements.supplier.disabled,false);assert.equal(form.elements.supplier.required,true);assert.equal(form.elements.due_date.required,true);
 assert.equal(form.elements.repeat.disabled,true);assert.equal(document.querySelector('#new-steps').hidden,true);assert.equal(document.querySelector('#task-date-label').textContent,'Teldatum');
 form.elements.supplier.value='Crown';await form.onsubmit({preventDefault(){}});
 const d=posts[0].data;assert.equal(d.kind,'stocktake');assert.equal(d.task_type,'legacy');assert.equal(d.supplier,'Crown');assert.equal(d.repeat,'none');assert.equal(d.pa_required,true);assert.equal(d.requires_evidence,false);assert.equal(d.steps,undefined);assert.equal(d.review_date,d.due_date);
});

test('switching back preserves task text and draft steps without submitting hidden supplier fields',async()=>{
 const {document,dialog,posts}=await screen('alex');document.querySelector('#new').onclick();const form=dialog.querySelector('form');form.elements.title.value='Keep my draft';
 form.elements.task_type.value='workflow';form.elements.task_type.onchange();const step=document.querySelector('[data-field=description]');step.value='Keep this step';
 document.querySelector('#choose-stocktake').onclick();form.elements.supplier.value='Crown';document.querySelector('#choose-general').onclick();
 assert.equal(form.elements.task_type.value,'workflow');assert.equal(document.querySelector('[data-field=description]'),step);assert.equal(step.value,'Keep this step');assert.equal(document.querySelector('#supplier-field').hidden,true);
 form.elements.task_type.value='reminder';form.elements.task_type.onchange();form.elements.repeat.value='weekly';await form.onsubmit({preventDefault(){}});
 assert.equal(posts[0].data.title,'Keep my draft');assert.equal(posts[0].data.kind,'general');assert.equal(posts[0].data.task_type,'reminder');assert.equal(posts[0].data.repeat,'weekly');assert.equal(posts[0].data.supplier,undefined);assert.equal(posts[0].data.steps,undefined);
});
