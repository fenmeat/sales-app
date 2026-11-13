import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {printPageOptions} from '../public/print-page-options.js';
import {today} from '../src/domain.js';

test('material Edit buttons and related recipe register editors open without saving data',async()=>{
 const source=(await readFile(new URL('../public/recipes-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const {document}=parseHTML('<html><body><div id="app"></div><div id="notice"></div><dialog id="editor"></dialog></body></html>');
 const dialog=document.querySelector('#editor');
 dialog.showModal=()=>dialog.setAttribute('open','');
 dialog.close=()=>dialog.removeAttribute('open');
 const material=(id,name,amount,status)=>({
  id,name,unit:'kg',supplier:'Crown',pack_qty:2,procure:true,notes:'',source:'',
  price:{amount,status,date:amount===null?null:'2026-10-07',valid_until:null,source:''},
  stock:{qty:amount===null?null:90,date:amount===null?null:'2026-11-11',reserve:0,incoming:[],source:''}
 });
 const materials=[material('RM18','Regal Russian Spice',70.85,'verified'),material('RM57','Regal French Polony Spice',null,'unknown')];
 const recipes=[{group:'RUSSIAN',name:'Russian',version:1,status:'approved',complete:true,batch_kg:108,
  effective_date:'2026-11-01',ingredients:[{material:'RM18',qty:2,unit:'kg',status:'approved',note:''}],
  consumables:[],forecast_yields:[],source:'Reviewed recipe',notes:''}];
 const packaging=[{product:'RUSSIAN',lines:[{material:'RM18',qty:1,unit:'kg',status:'approved',note:''}],
  source:'Reviewed packaging',notes:'',complete:true}];
 const data={current_user:'alex',revision:116,saved_at:'2026-11-11T07:21:55Z',
  register:{materials,recipes,packaging},costs:[{group:'RUSSIAN',version:1,total:0,known_subtotal:0,lines:[]}]};
 const before=structuredClone(data),calls=[];
 const fetch=async(path,opts={})=>{calls.push({path,method:opts.method??'GET'});return {ok:true,json:async()=>data};};
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)(
  'document','window','location','fetch','today','readCountDraft','openPrintPreview','printPageOptions',source);
 await execute(document,{addEventListener(){},sessionStorage:{getItem:()=>null}},{search:''},
  fetch,today,()=>null,()=>{},printPageOptions);
 document.querySelector('[data-view="materials"]').onclick();
 assert.equal(document.querySelectorAll('[data-material]').length,2);
 document.querySelector('[data-material="RM18"]').onclick();
 assert.equal(dialog.hasAttribute('open'),true);
 assert.match(dialog.querySelector('h2').textContent,/Edit Regal Russian Spice/);
 assert.equal(dialog.querySelector('input[name="id"]').value,'RM18');
 assert.equal(dialog.querySelector('input[name="id"]').hasAttribute('readonly'),true);
 assert.equal(dialog.querySelector('input[name="price"]').value,'70.85');
 assert.equal(dialog.querySelector('select[name="price_status"] option[value="verified"]').hasAttribute('selected'),true);
 dialog.querySelector('#cancel-edit').onclick();
 assert.equal(dialog.hasAttribute('open'),false);
 document.querySelector('[data-material="RM57"]').onclick();
 assert.match(dialog.querySelector('h2').textContent,/Edit Regal French Polony Spice/);
 assert.equal(dialog.querySelector('input[name="price"]').value,'');
 dialog.querySelector('#cancel-edit').onclick();
 document.querySelector('#new-material').onclick();
 assert.match(dialog.querySelector('h2').textContent,/Add material/);
 assert.equal(dialog.querySelector('input[name="id"]').hasAttribute('required'),true);
 dialog.querySelector('#cancel-edit').onclick();
 document.querySelector('[data-view="packaging"]').onclick();
 document.querySelector('[data-pack="RUSSIAN"]').onclick();
 assert.equal(dialog.hasAttribute('open'),true);
 assert.ok(dialog.querySelector('select[name="complete"]'));
 assert.ok(dialog.querySelector('[data-lines="packing"] select[aria-label="Quantity status"] option[value="approved"]'));
 dialog.querySelector('#cancel-edit').onclick();
 document.querySelector('[data-view="recipes"]').onclick();
 document.querySelector('[data-recipe="RUSSIAN"]').onclick();
 assert.match(dialog.querySelector('h2').textContent,/Review Russian/);
 assert.ok(dialog.querySelector('select[name="status"]'));
 dialog.querySelector('#cancel-edit').onclick();
 assert.deepEqual(calls,[{path:'/api/recipes',method:'GET'}]);
 assert.deepEqual(data,before);
});
