import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {renderReport} from '../public/tasks-report.js';
import {reminderOptions} from '../public/task-report-model.js';
import {attachmentPicker,MAX_TASK_ATTACHMENTS} from '../public/task-attachments.js';

import {renderPaWorkspace} from '../public/pa-report-ui.js';
async function screen(username,tasks=[],view='',mailPages=null,paState=null){
 const {document}=parseHTML('<html><body><div id="app"></div><dialog id="dialog"></dialog><div id="message"></div></body></html>');
 globalThis.document=document;globalThis.location={href:'https://ui-test.example/tasks'+view};
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
  get(name){return this.values.find(([key])=>key===name)?.[1]??null;}
  has(name){return this.values.some(([key])=>key===name);}
  [Symbol.iterator](){return this.values[Symbol.iterator]();}
 }
 const state={username,admin:['alex','alinda'].includes(username),today:'2099-11-02',users:['alex','alinda'].includes(username)?['alex','alinda','xalinda','xavier']:[username],suppliers:['crown'],tasks,notifications:[],next_offset:null};
 const posts=[],postPaths=[];let failNext=false,failAt=-1;
 const fetch=async(path,options={})=>{
  if(options.method==='POST'){
   const body=JSON.parse(options.body);posts.push(body);postPaths.push(path);
   if(failNext||posts.length===failAt){failNext=false;throw Error('Connection interrupted. Please retry.');}
   return {ok:true,json:async()=>({task:{...body.data,id:body.task_id,revision:1}})};
  }
  if(path.startsWith('/api/pa-report'))return {ok:true,json:async()=>structuredClone(paState||{register_revision:0})};
  if(path.startsWith('/api/tasks/emails'))return {ok:true,json:async()=>mailPages?structuredClone(mailPages[path]):({requests:[],contacts:{from_address:'alex@example.com',recipients:{xavier:'xavier@example.com',xalinda:'xalinda@example.com'}}})};
  return {ok:true,json:async()=>structuredClone(state)};
 };
 const source=(await readFile(new URL('../public/tasks-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/load\(\);\s*$/,'await load();');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('document','window','location','history','fetch','FormData','setTimeout','renderReport','reminderOptions','attachmentPicker','MAX_TASK_ATTACHMENTS','renderPaWorkspace',source)(document,{addEventListener(){}}, {href:'https://ui-test.example/tasks'+view,origin:'https://ui-test.example'},{replaceState(){}},fetch,FormData,()=>0,renderReport,reminderOptions,attachmentPicker,MAX_TASK_ATTACHMENTS,renderPaWorkspace);
 return {document,dialog,posts,postPaths,failNext:()=>failNext=true,failOnPost:n=>failAt=n};
}


const paState=()=>({private_report:true,register_revision:3,source_at:new Date().toISOString(),history:[{date:'2026-11-05'}],alerts:[],reminders:[],users:['alex','alinda','xavier','xalinda'],feedback:[],rows:[{id:'TSK-00001',subject_key:'TSK-00001',subject_hash:'hash-one',scope:'fenmeat',title:'Invoice follow-up',status:'Waiting',assigned_to:'alinda',review_group:'Supplier — November',next_action:'Confirm receipt and payment.',source_url:'https://docs.google.com/spreadsheets/d/test/edit'},{id:'TSK-00002',subject_key:'TSK-00002',subject_hash:'hash-two',scope:'private',title:'Private matter',status:'Pending',assigned_to:'alex',next_action:'Reply to private letter.',source_url:'https://docs.google.com/spreadsheets/d/test/edit'}],report:{date:'2026-11-05',source_at:'2026-11-05T14:14:12Z',task_summary:{open:141},source_url:'https://mail.google.com/mail/#sent/test',coverage:'One verified mailbox; unavailable sources stated.',sections:['emails','activity','tasks','tomorrow','rabbi'].map((id,n)=>({id,title:id,items:[{id:'report-item-'+n,subject_key:'report-2026-11-05:report-item-'+n,subject_hash:'hash-item-'+n,title:'Section '+id,text:'Practical detail <script>blocked</script>',needs_reply:n===0,question:'Please choose the next step.',links:[],pa_task_ids:n===0?['TSK-00002']:[]}]}))}});
test('full report shows five sections, dated counts, grouped PA obligations and closed app steps',async()=>{
 const ui=await screen('alex',[{id:'step',pa_task_id:'TSK-00001',status:'Complete',title:'PO sent',assigned_to:'alinda'}],'?view=report',null,paState());
 const app=ui.document.querySelector('#app');assert.equal(app.querySelectorAll('.pa-full-report .pa-section').length,6);assert.match(app.textContent,/task count was 141/);assert.match(app.textContent,/2 All PA open/);assert.match(app.textContent,/remaining PA work above stays open/);assert.match(app.textContent,/Private matter/);assert.equal(app.querySelector('script'),null);
 app.querySelector('[data-jump-item]').onclick();assert.equal(ui.document.getElementById('report-item-0').parentElement.open,true);
 app.querySelector('[data-open-case]').onclick();assert.match(ui.dialog.textContent,/Private matter/);
});
test('reply survives a lost response with the same request and captures form values before disabling',async()=>{
 const ui=await screen('alex',[],'?view=report',null,paState());ui.document.querySelector('[data-pa-action="respond"]').onclick();
 const form=ui.dialog.querySelector('form');form.elements.note.value='Please prepare the reply for me.';ui.failNext();await form.onsubmit({preventDefault(){}});assert.equal(ui.dialog.open,true);assert.equal(form.elements.note.value,'Please prepare the reply for me.');assert.match(form.querySelector('.error').textContent,/Connection interrupted/);
 await Promise.all([form.onsubmit({preventDefault(){}}),form.onsubmit({preventDefault(){}})]);assert.equal(ui.posts.length,2);assert.deepEqual(ui.posts[0],ui.posts[1]);assert.equal(ui.posts[0].note,'Please prepare the reply for me.');assert.equal(ui.postPaths[0],'/api/pa-report/feedback');assert.equal(ui.dialog.open,false);
});
test('staff presentation has no full private report or assignment controls and reminders preserve task ownership',async()=>{
 const p=paState();p.private_report=false;p.report=null;p.history=[];p.rows=[{...p.rows[0],assigned_to:'xavier'}];p.users=['xavier'];
 const ui=await screen('xavier',[],'?view=report',null,p);assert.equal(ui.document.querySelector('.pa-full-report'),null);assert.equal(ui.document.querySelector('[data-pa-action="assign"]'),null);assert.doesNotMatch(ui.document.querySelector('#app').textContent,/Private matter|All PA open/);
 ui.document.querySelector('[data-pa-action="remind"]').onclick();const form=ui.dialog.querySelector('form');form.elements.remind_at.value='2099-11-02T09:45';await form.onsubmit({preventDefault(){}});assert.equal(ui.posts[0].remind_at,'2099-11-02T07:45:00.000Z');assert.equal(ui.posts[0].assigned_to,undefined);
});
