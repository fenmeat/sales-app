import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {stocktakeView} from '../public/stocktake-view.js';
import {supplierGroups} from '../src/stocktake.js';
import {hasCountChanges,reconcileCountDraft,readCountDraft,writeCountDraft} from '../public/stocktake-state.js';
import {printPageOptions} from '../public/print-page-options.js';
import {today,addDays} from '../src/domain.js';

async function screen(user='alex'){
 const source=(await readFile(new URL('../public/recipes-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const {document,window}=parseHTML('<html><body><div id="app"></div><div id="notice"></div><dialog id="editor"></dialog></body></html>');
 const storage=new Map(),browser={addEventListener(){},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 const date=addDays(today(),-1),material={id:'SALT',name:'Synthetic Salt',unit:'kg',supplier:'Margot Swiss',procure:true,pack_qty:50,stock:{qty:50,date,available_from:today(),availability_confirmed:true,reserve:0,incoming:[],count:{packs:1,pack_qty:50,unit:'kg',loose:0}}};
 const result={revision:7,saved_at:new Date().toISOString(),current_user:user,stocktake_only:['xavier','xalinda'].includes(user),register:{materials:[material],recipes:[],packaging:[]},costs:[]};
 const initial=structuredClone(result),requests=[],previews=[];
 const fetch=async(path,options)=>{requests.push({path,...options});assert.equal(path,'/api/stocktake');assert.equal(options.method,'GET');return {ok:true,json:async()=>result};};
 const names=['document','window','location','fetch','today','stocktakeView','supplierGroups','openPrintPreview','printPageOptions','hasCountChanges','reconcileCountDraft','readCountDraft','writeCountDraft'];
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)(...names,source);
 await execute(document,browser,{search:'?view=stock&supplier=margot%20swiss'},fetch,today,stocktakeView,supplierGroups,x=>previews.push(x),printPageOptions,hasCountChanges,reconcileCountDraft,readCountDraft,writeCountDraft);
 return {document,window,result,initial,requests,previews,storage,date,click:()=>document.getElementById('stock-pdf-summary').onclick()};
}

test('PDF Summary opens the selected saved supplier and count date, unaffected by search, without saving or changing the screen',async()=>{
 const h=await screen(),button=h.document.getElementById('stock-pdf-summary');
 assert.equal(button.textContent,'PDF Summary');assert.equal(button.previousElementSibling.textContent,'Stocktake');
 assert.equal(button.nextElementSibling.textContent,'Order Guy');
 const search=h.document.getElementById('stock-search');search.value='does not match';search.oninput({target:search});
 assert.equal(h.document.querySelector('[data-stock-card]').hidden,true);
 h.click();assert.equal(h.previews.length,1);
 const options=h.previews[0],url=new URL(options.url,'https://synthetic.example');
 assert.equal(url.pathname,'/api/print/stocktake');assert.equal(url.searchParams.get('supplier'),'margot swiss');
 assert.equal(url.searchParams.get('date'),h.date,'count date, not available-from date');assert.equal(url.searchParams.get('revision'),'7');
 assert.equal(options.filename,'FenMeat-Stocktake-margot-swiss-'+h.date+'.pdf');
 assert.equal(search.value,'does not match');assert.equal(h.requests.length,1);assert.deepEqual(h.result,h.initial);
});

test('unsaved counts and date edits block summary without losing entries; discard restores the saved summary',async()=>{
 const h=await screen(),input=h.document.querySelector('[data-stock-field="packs"]');
 input.value='9';input.dispatchEvent(new h.window.Event('input'));
 h.click();assert.equal(h.previews.length,0);assert.match(h.document.getElementById('notice').textContent,/Save your stocktake changes/);
 assert.equal(input.value,'9');assert.equal(h.storage.size,1);assert.equal(h.requests.length,1);assert.deepEqual(h.result,h.initial);
 h.document.getElementById('discard-stock').onclick();h.click();assert.equal(h.previews.length,1);
 const date=h.document.getElementById('stock-date');date.value=today();date.onchange({target:date});
 h.click();assert.equal(h.previews.length,1,'editing the count date must not print old quantities under a new date');
 assert.equal(date.value,today());assert.equal(h.requests.length,1);assert.deepEqual(h.result,h.initial);
});

test('both stocktake staff accounts receive PDF Summary without manager controls',async()=>{
 for(const user of ['xavier','xalinda']){
  const h=await screen(user);h.click();assert.equal(h.previews.length,1);
  assert.equal(h.document.getElementById('import-register'),null);assert.equal(h.document.getElementById('margot-packs'),null);
  assert.equal(h.requests.length,1);assert.deepEqual(h.result,h.initial);
 }
});
