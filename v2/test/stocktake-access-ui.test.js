import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('existing staff open the register page directly into their working stock screen',async()=>{
 const source=(await readFile(new URL('../public/recipes-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)('document','window','location','fetch','stocktakeView','today','readCountDraft',source);
 for(const name of ['xavier','xalinda']){
  const elements=new Map(['#app','#notice','#register-content'].map(id=>[id,{innerHTML:'',textContent:''}]));
  const document={querySelector:selector=>elements.get(selector)};
  const window={addEventListener(){},sessionStorage:{}};
  const result={current_user:name,stocktake_only:true,revision:2,saved_at:'2026-10-14T07:00:00Z',register:{materials:[],recipes:[],packaging:[]}};
  let rendered=0;
  const fetch=async path=>{assert.equal(path,'/api/stocktake','staff must not call the manager-only recipes endpoint');return {ok:true,json:async()=>result};};
  await execute(document,window,{search:'?view=materials'},fetch,options=>{assert.equal(options.result,result);assert.equal(options.root,elements.get('#register-content'));assert.equal(typeof options.onSaved,'function');assert.equal(typeof options.onReload,'function');rendered++;},()=> '2026-10-14',()=>null);
  assert.equal(rendered,1);const html=elements.get('#app').innerHTML;
  assert.match(html,/<h1>Voorraadtelling<\/h1>/);assert.match(html,new RegExp(name));
  assert.doesNotMatch(html,/import-register|new-recipe|margot-packs|data-view="orders"|Materials &amp; prices/);
  assert.equal(elements.get('#notice').textContent,'');
 }
});
