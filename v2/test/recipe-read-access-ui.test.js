import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {printPageOptions} from '../public/print-page-options.js';
import {today} from '../src/domain.js';

test('Xavier and Xalinda see ingredients and print actions without recipe administration',async()=>{
 const source=(await readFile(new URL('../public/recipes-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)('document','window','location','fetch','today','openPrintPreview','printPageOptions',source);
 for(const username of ['xavier','xalinda']){
  const {document}=parseHTML('<html><body><div id="app"></div><div id="notice"></div><dialog id="editor"></dialog></body></html>');
  const recipes=[{group:'POLONY',version:3,name:'Old polony',status:'approved',complete:true},{group:'POLONY',version:4,name:'Polony - Coastal French',status:'approved',complete:true},{group:'POLONY_REGAL',version:1,name:'Polony - Regal',status:'review',complete:false}].map(recipe=>({...recipe,effective_date:'2026-11-05',batch_kg:100.02,ingredients:[{material:'MDM',qty:100,unit:'kg',status:'approved'},{material:'RM25',qty:.02,unit:'kg',status:'approved'}],consumables:[]}));
  const data={current_user:username,recipes_read_only:true,revision:103,register:{recipes,materials:[{id:'MDM',name:'MDM',unit:'kg'},{id:'RM25',name:'Dye Red',unit:'kg'}],packaging:[]}},before=structuredClone(data),calls=[],previews=[];
  const fetch=async(path,options)=>{calls.push({path,method:options.method});return {ok:true,json:async()=>data};};
  await execute(document,{addEventListener(){}},{search:'?view=materials'},fetch,today,options=>previews.push(options),printPageOptions);
  assert.equal(document.querySelector('h1').textContent,'Recipes');assert.ok(document.querySelector('a[href="/"]'));
  assert.equal(document.querySelectorAll('.register-card').length,2);assert.doesNotMatch(document.body.textContent,/Old polony/);
  assert.match(document.body.textContent,/20 g Butcher's Red colour/);assert.match(document.body.textContent,/Needs review — not released for production/);
  for(const selector of ['#new-recipe','[data-recipe]','#new-material','[data-material]','#import-register','#export-register','#register-history','#documented-update','#margot-packs','[data-view]','form'])assert.equal(document.querySelector(selector),null,selector);
  for(const button of document.querySelectorAll('[data-print-recipe]'))button.onclick();
  assert.deepEqual(previews.map(p=>p.url),['/api/print/recipe?group=POLONY&version=4&revision=103','/api/print/recipe?group=POLONY_REGAL&version=1&revision=103']);
  assert.ok(previews.every(p=>p.returnPath==='/recipes'&&p.fitPage));
  const search=document.querySelector('#search');search.value='regal';search.oninput({target:search});
  const cards=[...document.querySelectorAll('.register-card')];assert.equal(cards[0].hidden,true);assert.equal(cards[1].hidden,false);
  assert.deepEqual(calls,[{path:'/api/recipes',method:'GET'}]);assert.deepEqual(data,before);assert.equal(document.querySelector('#editor').hasAttribute('open'),false);
 }
});
