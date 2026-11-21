import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {money,toCents} from '../src/finance-domain.js';
import {BUDGET_CATEGORIES,budgetSummary,emptyBudget,copyBudget} from '../src/budget-domain.js';
import {deriveBudgetImport} from '../src/budget-import.js';
import {budgetSource} from './fixtures/budget-source.js';

const source=(await readFile(new URL('../public/financial-budget.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export function /g,'function ');
const execute=new Function('document','location','money','toCents','BUDGET_CATEGORIES','budgetSummary','emptyBudget','copyBudget',source+';return {renderBudget,budgetCSV};');
function page({retry=false}={}){
 const {document}=parseHTML('<html><body><main></main></body></html>'),calls=[],navigations=[],downloads=[],sources=[],messages=[];
 const {renderBudget,budgetCSV}=execute(document,{assign:p=>navigations.push(p)},money,toCents,BUDGET_CATEGORIES,budgetSummary,emptyBudget,copyBudget);
 const record={...deriveBudgetImport(budgetSource(),'2026-10').records[0],revision:1,actor:'alinda',saved_at:'2026-11-05T10:00:00Z'};
 const state={records:[record],today:'2026-11-05'};let failures=retry?1:0,dirty=false;
 const ctx={container:document.querySelector('main'),state,
  api:async(path,body)=>{calls.push({path,body:structuredClone(body)});if(path.includes('/audit'))return {history:[{...state.records[0],reason:'Synthetic history'}]};
   if(failures-->0)throw Object.assign(Error('Connection interrupted. Retry the same save.'),{uncertain:true});
   const saved={...structuredClone(body.record),revision:body.revision+1,actor:'alex',saved_at:'2026-11-05T11:00:00Z'},index=state.records.findIndex(r=>r.id===saved.id);
   if(index<0)state.records.push(saved);else state.records[index]=saved;return {record:saved};},
  dialog:(title,body)=>{const el=document.createElement('dialog');el.innerHTML='<h2>'+title+'</h2>'+body;document.body.append(el);return el;},
  notify:m=>messages.push(m),onSaved:async()=>renderBudget(ctx),onSource:r=>sources.push(r.id),setDirty:b=>{dirty=b;},setBusy:()=>{},download:(...args)=>downloads.push(args)};
 renderBudget(ctx);return {document,state,calls,navigations,downloads,sources,messages,budgetCSV,isDirty:()=>dirty};
}
test('Budget renders known/unknown amounts, source, history, print and CSV without counting monthly updates as funding',async()=>{
 const p=page(),text=p.document.body.textContent;
 assert.equal(p.document.querySelectorAll('[data-budget-week]').length,4);
 assert.match(text,/1 expense amounts are not entered/);assert.match(text,/Known monthly budgetR\s*10.01/);
 assert.match(text,/Recorded set asideR\s*3.33/);assert.match(text,/Still to set asideR\s*6.68/);
 assert.match(text,/Monthly account updates/);assert.match(text,/1 amount\(s\) not entered/);
 p.document.querySelector('#budget-print').onclick();assert.equal(p.navigations[0],'/print-page?document=financial&type=budget&month=2026-10');
 p.document.querySelector('#budget-source').onclick();assert.deepEqual(p.sources,['fin-budget-2026-10']);
 p.document.querySelector('#budget-csv').onclick();assert.match(p.downloads[0][1],/"Set aside","","","","2","2.5",""/);
 await p.document.querySelector('#budget-history').onclick();assert.match(p.document.querySelector('dialog').textContent,/Synthetic history/);
});
test('Budget retains a decimal-comma set-aside draft on uncertain network response and retries the exact save',async()=>{
 const p=page({retry:true});p.document.querySelector('[data-budget-week="2"]').onclick();
 const form=p.document.querySelector('form');form.querySelector('[name=amount]').value='4,56';form.querySelector('[name=date]').value='2026-10-09';
 await form.onsubmit({preventDefault(){}});assert.equal(form.querySelector('fieldset').disabled,true);assert.match(form.textContent,/Retry same save/);assert.equal(p.state.records[0].data.weeks[1].amount,null);assert.equal(p.isDirty(),true);
 await form.onsubmit({preventDefault(){}});assert.deepEqual(p.calls[0],p.calls[1]);assert.equal(p.state.records[0].data.weeks[1].amount,456);assert.equal(p.state.records[0].data.weeks[1].date,'2026-10-09');assert.equal(p.document.querySelector('dialog'),null);assert.equal(p.isDirty(),false);
});
test('Editing expenses preserves recorded funds; copying to another month resets actuals and preserves October',async()=>{
 const p=page(),funding=structuredClone(p.state.records[0].data.weeks);
 p.document.querySelector('#budget-edit').onclick();let form=p.document.querySelector('form');
 form.querySelector('[data-amount]').value='22,50';await form.onsubmit({preventDefault(){}});
 assert.equal(p.state.records[0].data.items[0].amount,2250);assert.deepEqual(p.state.records[0].data.weeks,funding);
 const october=structuredClone(p.state.records[0]);p.document.querySelector('#budget-new').onclick();form=p.document.querySelector('form');assert.equal(form.querySelector('[name=month]').value,'2026-11');
 await form.onsubmit({preventDefault(){}});assert.equal(p.state.records.length,2);assert.deepEqual(p.state.records[0],october);
 const november=p.state.records[1].data;assert.deepEqual(november.items,october.data.items);assert.ok(november.weeks.every(w=>w.amount===null&&w.date===null));assert.ok(november.allocations.every(a=>a.amount===null));assert.equal(november.month,'2026-11');
});
