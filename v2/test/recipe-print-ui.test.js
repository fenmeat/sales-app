import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {printPageOptions} from '../public/print-page-options.js';
import {today} from '../src/domain.js';

test('each latest recipe card opens its own saved PDF without changing recipes or entering the editor',async()=>{
 const source=(await readFile(new URL('../public/recipes-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const {document}=parseHTML('<html><body><div id="app"></div><div id="notice"></div><dialog id="editor"></dialog></body></html>');
 const recipes=[{group:'FIRST',version:1,name:'Old saved recipe'},{group:'FIRST',version:2,name:'Current saved recipe'},{group:'V01',version:1,name:'Synthetic Vienna'}].map(r=>({...r,status:'approved',complete:true,effective_date:'2026-11-05',batch_kg:50,ingredients:[],consumables:[],notes:'',source:''}));
 const result={revision:7,saved_at:new Date().toISOString(),current_user:'alex',register:{materials:[],recipes,packaging:[]},costs:recipes.map(r=>({...r,total:0,known_subtotal:0,lines:[]}))},before=structuredClone(result),requests=[],previews=[];
 const fetch=async(path,options)=>{requests.push({path,method:options.method});return {ok:true,json:async()=>result};};
 const browser={addEventListener(){},sessionStorage:{getItem:()=>null}};
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)('document','window','location','fetch','today','readCountDraft','openPrintPreview','printPageOptions',source);
 await execute(document,browser,{search:''},fetch,today,()=>null,x=>previews.push(x),printPageOptions);
 const buttons=[...document.querySelectorAll('[data-print-recipe]')];assert.equal(buttons.length,2);
 for(const button of buttons){assert.equal(button.textContent,'Print recipe');button.onclick();}
 assert.equal(previews[0].url,'/api/print/recipe?group=FIRST&version=2&revision=7');
 assert.equal(previews[1].url,'/api/print/recipe?group=V01&version=1&revision=7');
 assert.equal(previews[0].fitPage,true);assert.equal(previews[0].returnPath,'/recipes');
 assert.deepEqual(requests,[{path:'/api/stocktake',method:'GET'}]);assert.deepEqual(result,before);
 assert.equal(document.querySelector('#editor').hasAttribute('open'),false);
});
