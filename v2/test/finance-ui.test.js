import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {FINANCE_TYPES,money,decimal,toCents,recordTitle,recordSummary,validLink,matchesFinanceFilter} from '../src/finance-domain.js';
const html=await readFile(new URL('../public/financial.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/financial-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const execute=new (Object.getPrototypeOf(async function(){}).constructor)('document','window','location','fetch','FINANCE_TYPES','money','decimal','toCents','recordTitle','validLink','matchesFinanceFilter','confirm',source);
async function page({failure=false,retry=false}={}){
 const {document,window}=parseHTML(html),calls=[],navigations=[];let failures=retry?1:0;
 const create=document.createElement.bind(document);document.createElement=(tag,...args)=>{const el=create(tag,...args);if(tag==='dialog')el.showModal=()=>el.setAttribute('open','');return el;};
 const records=[{id:'synthetic-weekly-001',type:'weekly',revision:1,data:{supplier:'Synthetic supplier',reference:'SYN-1',amount:12345,opening_paid:0,status:'To Pay',date:'2026-11-06',links:[]},actor:'alinda',saved_at:'2026-11-05T10:00:00Z'}];
 const fetch=async(path,opt={})=>{calls.push({path,...opt});if(failure)return {ok:false,status:403,json:async()=>({error:'Only Alex and Alinda have Financial access.'})};
  if(path==='/api/financial/record'){if(failures-->0)throw Error('lost response');const b=JSON.parse(opt.body),row={...b.record,revision:b.revision+1,actor:'alex',saved_at:'2026-11-05T12:00:00Z'};records.splice(records.findIndex(r=>r.id===row.id),1,row);return {ok:true,status:200,json:async()=>({record:row})};}
  return {ok:true,status:200,json:async()=>({username:'alex',today:'2026-11-05',records:structuredClone(records),summaries:Object.fromEntries(records.map(r=>[r.id,recordSummary(r,records)])),imports:[]})};
 };
 await execute(document,window,{assign:s=>navigations.push(s)},fetch,FINANCE_TYPES,money,decimal,toCents,recordTitle,validLink,matchesFinanceFilter,()=>true);
 return {document,calls,navigations,records};
}
test('Financial routes navigate to real registers and PDF; access errors never render financial data',async()=>{
 const denied=await page({failure:true});assert.match(denied.document.body.textContent,/Only Alex and Alinda/);assert.doesNotMatch(denied.document.body.textContent,/SYN-1/);
 const p=await page();assert.match(p.document.body.textContent,/Financial overview/);await p.document.querySelector('[data-group="weekly"]').onclick();assert.match(p.document.body.textContent,/SYN-1/);assert.match(p.document.body.textContent,/123.45/);
 p.document.querySelector('#print').onclick();assert.match(p.navigations[0],/^\/print-page\?document=financial&type=weekly/);
 p.document.querySelector('[data-group="source"]').onclick();assert.match(p.document.body.textContent,/No source workbook/);
});
test('failed save keeps the draft and retries the exact request once, then renders saved data',async()=>{
 const p=await page({retry:true});p.document.querySelector('[data-group="weekly"]').onclick();p.document.querySelector('[data-edit]').onclick();
 const form=p.document.querySelector('#record-form');Object.defineProperty(form,'elements',{value:{namedItem:n=>form.querySelector('[name="'+n+'"]')}});
 for(const select of form.querySelectorAll('select'))Object.defineProperty(select,'value',{get:()=>select.querySelector('option[selected]')?.textContent??select.querySelector('option')?.textContent??''});
 form.querySelector('[name=amount]').value='456,78';form.querySelector('[name=reason]').value='Correct amount from synthetic invoice';
 await form.onsubmit({preventDefault(){}});assert.match(form.querySelector('.error').textContent,/Connection interrupted/);assert.equal(form.querySelector('[name=amount]').value,'456,78');assert.equal(form.querySelector('fieldset').disabled,true);
 await form.onsubmit({preventDefault(){}});const saves=p.calls.filter(c=>c.path==='/api/financial/record');assert.equal(saves.length,2);assert.equal(saves[0].body,saves[1].body);assert.equal(p.records[0].data.amount,45678);assert.equal(p.document.querySelector('dialog'),null);assert.match(p.document.body.textContent,/456.78/);
});
