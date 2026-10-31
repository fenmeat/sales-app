import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {renderReport} from '../public/tasks-report.js';
import {reminderOptions} from '../public/task-report-model.js';

async function screen(username,tasks=[],view=''){
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
  constructor(form){this.values=[...form.querySelectorAll('[name]')].filter(c=>c.type!=='checkbox'||c.checked).map(c=>[c.name,c.type==='checkbox'?'on':c.value]);}
  has(name){return this.values.some(([key])=>key===name);}
  [Symbol.iterator](){return this.values[Symbol.iterator]();}
 }
 const state={username,admin:['alex','alinda'].includes(username),today:'2099-11-02',users:['alex','alinda'].includes(username)?['alex','alinda','xalinda','xavier']:[username],suppliers:['crown'],tasks,notifications:[],next_offset:null};
 const posts=[];let failNext=false;
 const fetch=async(path,options={})=>{
  if(options.method==='POST'){
   const body=JSON.parse(options.body);posts.push(body);
   if(failNext){failNext=false;throw Error('Connection interrupted. Please retry.');}
   return {ok:true,json:async()=>({task:{...body.data,id:body.task_id,revision:1}})};
  }
  if(path==='/api/tasks/emails')return {ok:true,json:async()=>({requests:[],contacts:{from_address:'alex@example.com',recipients:{xavier:'xavier@example.com',xalinda:'xalinda@example.com'}}})};
  return {ok:true,json:async()=>structuredClone(state)};
 };
 const source=(await readFile(new URL('../public/tasks-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/load\(\);\s*$/,'await load();');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('document','window','location','history','fetch','FormData','setTimeout','renderReport','reminderOptions',source)(document,{}, {href:'https://ui-test.example/tasks'+view,origin:'https://ui-test.example'},{replaceState(){}},fetch,FormData,()=>0,renderReport,reminderOptions);
 return {document,dialog,posts,failNext:()=>failNext=true};
}

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
