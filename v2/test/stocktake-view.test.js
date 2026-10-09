import test from 'node:test';
import assert from 'node:assert/strict';
import {stocktakeView} from '../public/stocktake-view.js';
import {reconcileCountDraft} from '../public/stocktake-state.js';
import {applySupplierCount} from '../src/stocktake.js';
import {today,addDays} from '../src/domain.js';

// A small DOM test double exercises the real view's event handlers and rendered
// input values. It is not a layout engine or a substitute for visual browser QA.
class Surface{
 set innerHTML(html){
  this.html=html;this.nodes=[];
  for(const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)){
   const attrs={};for(const a of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';
   const dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));
   const el={tag:match[1],attrs,dataset,value:attrs.value??'',disabled:Object.hasOwn(attrs,'disabled'),checked:Object.hasOwn(attrs,'checked'),hidden:Object.hasOwn(attrs,'hidden'),textContent:'',events:{},addEventListener(name,fn){(this.events[name]??=[]).push(fn);},input(value){this.value=value;for(const f of this.events.input??[])f({target:this});},focus(){this.focused=true;}};
   this.nodes.push(el);
  }
 }
 get innerHTML(){return this.html;}
 querySelectorAll(selector){return this.nodes.filter(el=>selector.split(',').some(raw=>{
  let s=raw.trim();if(s.endsWith(':checked')){if(!el.checked)return false;s=s.slice(0,-8);}
  if(s[0]==='#')return el.attrs.id===s.slice(1);
  if(s[0]==='.')return (el.attrs.class??'').split(' ').includes(s.slice(1));
  if(s[0]==='[')return [...s.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([,k,v])=>Object.hasOwn(el.attrs,k)&&(v===undefined||el.attrs[k]===v));
  return el.tag===s;
 }));}
 querySelector(s){const el=this.querySelectorAll(s)[0];if(!el)throw Error('Missing DOM target '+s);return el;}
}
const fixture=()=>({revision:2,current_user:'alex',saved_at:new Date().toISOString(),register:{materials:[{id:'BAGS',name:'Bags',unit:'unit',supplier:'Margot Swiss',pack_qty:25,procure:true,stock:{qty:53,date:today(),available_from:addDays(today(),3),availability_confirmed:true,reserve:0,incoming:[],source:'Count',count:{packs:2,loose:3,unit:'unit',pack_qty:25}}}],recipes:[],packaging:[]}});
const escape=s=>String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function viewHarness(supplier='margot swiss',extraMaterials=[]){
 const root=new Surface(),draft={supplier},h={root,draft,result:fixture(),calls:0,working:false,dirty:false};
 h.result.register.materials.push(...extraMaterials);
 h.render=()=>stocktakeView({root,draft,result:h.result,esc:escape,notice:()=>{},onWorking:v=>h.working=v,onDirty:v=>h.dirty=v,onOrders:date=>h.orderDate=date,
  api:async(path,body)=>{h.calls++;h.lastRequest=structuredClone(body);if(h.saveError)throw h.saveError;const counted=applySupplierCount(h.result.register,body,'alex');return {...h.result,revision:h.result.revision+1,request_id:body.request_id,register:counted.register};},
  onSaved:async saved=>{h.result=saved;draft.rows={};draft.metaDirty=false;draft.request=null;h.dirty=false;h.render();},
  onReload:async()=>{if(h.reloadError)throw h.reloadError;reconcileCountDraft(h.result,draft);h.render();}
 });h.render();return h;
}
test('saved packs remain visible after save and reload; unchanged fields are not resubmitted; Order Guy receives their date',async()=>{
 const h=viewHarness(),field=n=>h.root.querySelector('[data-stock-field="'+n+'"][data-material="BAGS"]');
 assert.equal(field('packs').value,'2');assert.equal(field('loose').value,'3');
 await h.root.querySelector('#save-stock').onclick();assert.equal(h.calls,0);
 field('packs').input('4');assert(h.dirty);await h.root.querySelector('#save-stock').onclick();
 assert.equal(h.result.register.materials[0].stock.qty,103);assert.equal(field('packs').value,'4');assert.equal(field('loose').value,'3');assert.equal(h.working,false);
 await h.root.querySelector('#reload-stock').onclick();assert.equal(field('packs').value,'4');assert.equal(field('loose').value,'3');
 h.root.querySelector('#stock-orders').onclick();assert.equal(h.orderDate,addDays(today(),3));
});
test('a refused save and failed reload keep typed quantities and show the precise error beside the save button',async()=>{
 const h=viewHarness(),field=()=>h.root.querySelector('[data-stock-field="packs"][data-material="BAGS"]');field().input('7');h.saveError=Error('Connection interrupted');
 await h.root.querySelector('#save-stock').onclick();assert.equal(field().value,'7');assert.equal(h.draft.rows.BAGS.packs,'7');assert.match(h.root.querySelector('#stock-error').textContent,/Connection interrupted/);assert(h.root.querySelector('#stock-error').focused);assert.equal(h.working,false);
 h.reloadError=Error('Offline');await h.root.querySelector('#reload-stock').onclick();assert.equal(field().value,'7');assert.match(h.root.querySelector('#stock-error').textContent,/Offline/);assert.equal(h.root.querySelector('#reload-stock').disabled,false);
 h.reloadError=null;await h.root.querySelector('#reload-stock').onclick();assert.equal(field().value,'7');
});
test('future physical count dates are rejected visibly before sending a save',async()=>{
 const h=viewHarness(),date=h.root.querySelector('#stock-date');date.value=addDays(today(),1);date.onchange({target:date});
 await h.root.querySelector('#save-stock').onclick();assert.equal(h.calls,0);assert.match(h.root.querySelector('#stock-error').textContent,/toekoms/);assert.equal(h.root.querySelector('[data-stock-field="packs"][data-material="BAGS"]').value,'2');
});
const britos=()=>({id:'MEAT',name:'Meat',unit:'kg',supplier:"Brito's",pack_qty:20,procure:true,stock:{qty:20,date:today(),available_from:today(),reserve:0,incoming:[],source:'Count',count:{packs:1,loose:0,unit:'kg',pack_qty:20}}});
test('supplier name, selected button, stock cards and save destination stay aligned across switching and reload',async()=>{
 const h=viewHarness("brito's",[britos()]),choose=key=>h.root.querySelector('[data-supplier="'+key+'"]').onclick();
 assert.equal(h.root.querySelector('#stock-supplier-summary').attrs['aria-label'],"Verskaffer: Brito's");
 choose('margot swiss');assert.equal(h.draft.supplier,'margot swiss');
 assert.equal(h.root.querySelector('#stock-supplier-summary').attrs['aria-label'],'Verskaffer: Margot Swiss');assert.equal(h.root.querySelector('[data-supplier="margot swiss"]').attrs['aria-pressed'],'true');
 assert.equal(h.root.querySelector('[data-supplier="brito\'s"]').attrs['aria-pressed'],'false');assert.match(h.root.innerHTML,/<h2>Voorraadtelling: Margot Swiss<\/h2>/);assert.match(h.root.innerHTML,/Stoor Margot Swiss se telling/);
 assert.equal(h.root.querySelectorAll('[data-stock-card="MEAT"]').length,0);assert.equal(h.root.querySelector('[data-stock-field="packs"][data-material="BAGS"]').value,'2');
 h.root.querySelector('[data-stock-field="packs"][data-material="BAGS"]').input('3');await h.root.querySelector('#save-stock').onclick();assert.equal(h.lastRequest.supplier,'margot swiss');assert.deepEqual(h.lastRequest.rows.map(r=>r.material),['BAGS']);assert.equal(h.result.register.materials.find(m=>m.id==='MEAT').stock.qty,20);
 await h.root.querySelector('#reload-stock').onclick();assert.equal(h.root.querySelector('#stock-supplier-summary').attrs['aria-label'],'Verskaffer: Margot Swiss');
 choose("brito's");assert.equal(h.draft.supplier,"brito's");assert.equal(h.root.querySelector('[data-stock-field="packs"][data-material="MEAT"]').value,'1');assert.equal(h.root.querySelectorAll('[data-stock-card="BAGS"]').length,0);
});
test('direct supplier opening uses its stable key even when another supplier sorts first',()=>{
 const h=viewHarness('margot swiss',[britos()]);assert.equal(h.root.querySelectorAll('[data-supplier]')[0].dataset.supplier,"brito's");assert.equal(h.root.querySelector('#stock-supplier-summary').attrs['aria-label'],'Verskaffer: Margot Swiss');assert.equal(h.root.querySelector('[data-supplier="margot swiss"]').attrs['aria-pressed'],'true');
});
test('switching cannot discard unsaved quantities; the reason appears beside the supplier picker',()=>{
 const h=viewHarness('margot swiss',[britos()]);h.root.querySelector('[data-stock-field="packs"][data-material="BAGS"]').input('8');
 h.root.querySelector('[data-supplier="brito\'s"]').onclick();assert.equal(h.draft.supplier,'margot swiss');assert.equal(h.draft.rows.BAGS.packs,'8');assert.match(h.root.querySelector('#stock-supplier-note').textContent,/ongestoorde veranderings vir Margot Swiss/);
 const menu=h.root.querySelector('#stock-supplier');menu.open=true;let prevented=false;menu.events.keydown[0]({key:'Escape',preventDefault(){prevented=true;}});assert.equal(menu.open,false);assert(prevented);
});
