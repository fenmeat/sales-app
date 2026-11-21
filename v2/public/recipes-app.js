import './input-selection.js';
import {today} from './domain.js';
import {stocktakeView} from './stocktake-view.js';
import {supplierGroups} from './stocktake.js';
import {openPrintPreview} from './print-preview.js';
import {printPageOptions} from './print-page-options.js';
import {hasCountChanges,reconcileCountDraft,readCountDraft,writeCountDraft} from './stocktake-state.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>n===null||n===undefined?'Unknown':Number(n).toLocaleString('en-ZA',{maximumFractionDigits:3});
const money=n=>n===null||n===undefined?'Incomplete':'R '+Number(n).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2});
const state={view:new URLSearchParams(location.search).get('view')==='stock'?'stock':'recipes',stockDraft:{supplier:new URLSearchParams(location.search).get('supplier')??undefined},stockDirty:false,result:null,report:null,from:today(),to:today(),search:'',busy:false};
async function api(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error??'Request failed.'),{status:response.status});return data;}
function notice(s){$('#notice').textContent=s;}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const source=s=>/^https:\/\//.test(s)&&!/[\s]/.test(s)?`<a class="source-link" href="${esc(s)}" target="_blank" rel="noopener noreferrer">Source document</a>`:esc(s);
function render(){const r=state.result,reg=r.register;
 if(r.recipes_read_only){recipesReadOnlyView();return;}
 if(r.stocktake_only){
  state.view='stock';
  $('#app').innerHTML=`<header class="app-header"><div class="brand"><em>F</em><div>FEN MEAT<span>Stocktake</span></div></div><div class="head-actions"><a class="nav-link home-link" href="/">Home</a><a class="nav-link" href="/tasks">Tasks</a><a class="nav-link" href="/production">Production</a><a class="nav-link" href="/sales">Sales</a></div></header><main class="register-shell"><h1>Voorraadtelling</h1><p class="muted">${esc(r.current_user)} · App version 0.32.2</p><p class="muted">${r.revision?'Saved revision '+r.revision+' · '+esc(new Date(r.saved_at).toLocaleString('en-ZA')):'Nog geen voorraadregister gestoor nie.'}</p><nav class="register-nav" aria-label="Stocktake actions"><button id="stock-pdf-summary" type="button">PDF Summary</button></nav><section id="register-content"></section></main>`;
  stockView();bindStocktakeSummary();return;
 }
 $('#app').innerHTML=`<header class="app-header"><div class="brand"><em>F</em><div>FEN MEAT<span>Recipes</span></div></div><div class="head-actions"><a class="nav-link home-link" href="/">Home</a><a class="nav-link" href="/tasks">Tasks</a><a class="nav-link" href="/production">Production</a><a class="nav-link" href="/sales">Sales</a></div></header><main class="register-shell"><p class="eyebrow">YOUR CURRENT APP RECORDS</p><h1>Recipes &amp; costs</h1><p class="muted">App version 0.32.2</p><p class="muted">${r.revision?'Saved revision '+r.revision+' · '+esc(new Date(r.saved_at).toLocaleString('en-ZA')):'No recipe register imported yet.'}</p><nav class="register-nav" aria-label="Recipe and stock views">${[['recipes','Recipes'],['materials','Materials & prices'],['packaging','Packaging'],['stock','Stocktake']].map(([v,n])=>`<button data-view="${v}" aria-pressed="${state.view===v}">${n}</button>${v==='stock'&&state.view==='stock'?'<button id="stock-pdf-summary" type="button">PDF Summary</button>':''}`).join('')}</nav><div class="register-actions"><button id="margot-packs" class="primary">Werk Margot Swiss se pakgroottes by</button><button id="documented-update">Review documented packaging update</button></div><section id="register-content"></section><details><summary>Register files &amp; history</summary><p>Import a reviewed register once. Future corrections are saved here with their source and a new revision.</p><div class="register-actions"><button id="import-register">Import register</button><button id="export-register">Download saved register</button><button id="register-history">Saved history</button></div><div id="history-list"></div><p class="muted">${esc(reg.notes)}</p></details></main>`;
 for(const el of document.querySelectorAll('[data-view]'))el.onclick=()=>{if(state.busy||state.stockDirty){notice('Wag tot die stoor klaar is, of stoor eers jou ongestoorde veranderings.');return;}state.view=el.dataset.view;state.search='';notice('');render();};
 $('#margot-packs').onclick=margotPacksDialog;$('#margot-packs').hidden=reg.applied_updates?.includes('margot-packs-2026-10-09-alinda')??false;
 $('#documented-update').onclick=documentedDialog;$('#documented-update').hidden=reg.applied_updates?.includes('packaging-patties-2026-10-09')??false;$('#import-register').onclick=()=>{if(state.stockDirty){notice('Save your supplier count first.');return;}importDialog();};$('#export-register').onclick=()=>download('fenmeat-recipe-register-r'+r.revision+'.json',{...r,exported_at:new Date().toISOString()});$('#register-history').onclick=async()=>{try{const h=await api('/api/recipes/audit');$('#history-list').innerHTML='<ul>'+h.events.map(e=>`<li>Revision ${e.revision} · ${esc(e.saved_at)} · ${esc(e.actor)}<br>${esc(e.reason)}</li>`).join('')+'</ul>';}catch(e){notice(e.message);}};
 if(state.view==='recipes')recipesView();if(state.view==='materials')materialsView();if(state.view==='packaging')packagingView();if(state.view==='stock')stockView();bindStocktakeSummary();
}
// Shared form helpers for the material, packaging and recipe editors.
// Escape stored values before inserting them into form markup.
function field(label,name,value='',type='text',attributes=''){
 return `<label>${esc(label)}<input type="${esc(type)}" name="${esc(name)}" value="${esc(value)}" ${attributes}></label>`;
}
function options(choices,selected){
 return choices.map(value=>`<option value="${esc(value)}"${String(value)===String(selected)?' selected':''}>${esc(value)}</option>`).join('');
}
function select(label,name,choices,selected){
 return `<label>${esc(label)}<select name="${esc(name)}">${options(choices,selected)}</select></label>`;
}
function searchBar(){return `<div class="register-toolbar"><input id="search" type="search" aria-label="Find an item" placeholder="Find a code, name or supplier…" value="${esc(state.search)}"></div>`;}
function bindSearch(){if($('#search'))$('#search').oninput=e=>{state.search=e.target.value;const q=state.search.toLowerCase();for(const el of document.querySelectorAll('[data-search]'))el.hidden=!el.dataset.search.includes(q);};}
function recipesReadOnlyView(){
 const r=state.result,latest=r.register.recipes.filter(x=>!r.register.recipes.some(y=>y.group===x.group&&y.version>x.version));
 const materials=new Map(r.register.materials.map(m=>[m.id,m]));
 const quantity=line=>line.unit==='kg'&&line.qty<1?num(line.qty*1000)+' g':num(line.qty)+' '+esc(line.unit);
 const lines=items=>items.map(line=>{const material=materials.get(line.material),name=line.material==='RM25'&&material?.name==='Dye Red'?"Butcher's Red colour":material?.name??line.material;return `<li>${quantity(line)} ${esc(name)}</li>`;}).join('');
 const status=recipe=>recipe.status==='historical'?'Historical recipe':recipe.status!=='approved'||!recipe.complete||recipe.ingredients.some(line=>line.status!=='approved')?'Needs review — not released for production':'Approved recipe';
 $('#app').innerHTML=`<header class="app-header"><div class="brand"><em>F</em><div>FEN MEAT<span>Recipes</span></div></div><div class="head-actions"><a class="nav-link home-link" href="/">Home</a></div></header><main class="register-shell"><h1>Recipes</h1><p>View and print recipes</p><section id="register-content">${searchBar()}<div class="register-grid">${latest.map(recipe=>`<article class="register-card" data-search="${esc((recipe.group+' '+recipe.name).toLowerCase())}"><span class="tag">${esc(recipe.group)} · v${recipe.version}</span><h2>${esc(recipe.name)}</h2><p>${num(recipe.batch_kg)} kg per full batch · from ${esc(recipe.effective_date)}</p><p class="recipe-cost-status">${status(recipe)}</p><h3>Ingredients per full batch</h3><ul>${lines(recipe.ingredients)}</ul>${recipe.consumables.length?'<details><summary>Manufacturing casings per full batch</summary><ul>'+lines(recipe.consumables)+'</ul></details>':''}<div class="register-actions"><button type="button" class="primary" data-print-recipe="${esc(recipe.group)}" aria-label="Print recipe: ${esc(recipe.name)}">Print recipe</button></div></article>`).join('')||'<p>No saved recipes are available yet.</p>'}</div></section></main>`;
 for(const el of document.querySelectorAll('[data-print-recipe]'))el.onclick=()=>printRecipe(latest.find(recipe=>recipe.group===el.dataset.printRecipe));
 bindSearch();
}
function recipeCostMessage(recipe,cost){
 const approval={approved:'Resep goedgekeur',review:'Resepgoedkeuring uitstaande',historical:'Historiese resep'}[recipe.status]??'Resepstatus onbekend';
 const issues=[];
 if(!recipe.complete)issues.push('bestanddele / vervaardigingsverbruik onvolledig');
 const lines=cost?.lines??[],names=rows=>[...new Set(rows.map(l=>l.name||l.material))];
 const missingPrices=names(lines.filter(l=>l.cost===null||l.cost===undefined));
 if(missingPrices.length===1&&missingPrices[0].toLowerCase()==='water')issues.push('waterkoste uitstaande');
 else if(missingPrices.length)issues.push('geldige pryse uitstaande: '+missingPrices.join(', '));
 const unapproved=names(lines.filter(l=>l.status!=='approved'));
 if(unapproved.length)issues.push('hoeveelhede / spesifikasies moet bevestig word: '+unapproved.join(', '));
 if(!cost)issues.push('kosteberekening ontbreek');
 else if(cost.total==null&&!issues.length&&recipe.status==='approved')issues.push('kosteberekening moet nagegaan word');
 return approval+(issues.length?' — '+issues.join('; '):'');
}
function recipesView(){const r=state.result,latest=r.register.recipes.filter(x=>!r.register.recipes.some(y=>y.group===x.group&&y.version>x.version));
 $('#register-content').innerHTML=searchBar()+`<p class="status-note">Costing includes VAT. An incomplete total stays blank; the known subtotal excludes missing prices. Packing, labour and overhead are separate.</p><div class="register-actions"><button id="new-recipe">Add recipe</button></div><div class="register-grid">${latest.map(x=>{const c=r.costs.find(c=>c.group===x.group&&c.version===x.version);return `<article class="register-card" data-search="${esc((x.group+' '+x.name).toLowerCase())}"><span class="tag">${esc(x.group)} · v${x.version} · ${esc(x.status)}</span><h2>${esc(x.name)}</h2><p>${num(x.batch_kg)} kg per full batch · from ${esc(x.effective_date)}</p><p class="recipe-cost-status">${esc(recipeCostMessage(x,c))}</p>${c.total!==null?'<p class="money">'+money(c.total)+'</p>':''}${c.total===null?'<p>Known subtotal: '+money(c.known_subtotal)+'</p>':''}<p class="muted">${esc(x.notes)}</p><details><summary>Ingredients &amp; source</summary><ul>${c.lines.map(l=>`<li>${num(l.qty)} ${esc(l.unit)} ${esc(l.name)} — ${l.cost===null?'price needed':money(l.cost)}${l.status==='approved'?'':' · '+esc(l.status)}</li>`).join('')}</ul><p>${source(x.source)}</p></details><div class="register-actions"><button type="button" class="primary" data-print-recipe="${esc(x.group)}" aria-label="Print recipe: ${esc(x.name)}">Print recipe</button><button data-recipe="${esc(x.group)}">Review / new version</button></div></article>`;}).join('')||'<p>Import the reconciled register to see recipes and costs.</p>'}</div>`;
 for(const el of document.querySelectorAll('[data-print-recipe]'))el.onclick=()=>printRecipe(latest.find(x=>x.group===el.dataset.printRecipe));
 bindSearch();$('#new-recipe').onclick=()=>recipeDialog();for(const el of document.querySelectorAll('[data-recipe]'))el.onclick=()=>recipeDialog(latest.find(x=>x.group===el.dataset.recipe));
}
function materialsView(){const materials=state.result.register.materials;
 $('#register-content').innerHTML=searchBar()+`<p>Record prices per material unit, <strong>including VAT</strong>. Keep the invoice date and source. Blank stock means not counted.</p><div class="register-actions"><button id="new-material">Add material</button></div><div class="table-wrap"><table><thead><tr><th>Material</th><th>Supplier</th><th>Price / unit</th><th>Purchase pack</th><th>Usable stock</th><th></th></tr></thead><tbody>${materials.map(m=>`<tr data-search="${esc((m.id+' '+m.name+' '+m.supplier).toLowerCase())}"><td>${esc(m.id)} · ${esc(m.name)}<small>${esc(m.unit)}</small></td><td>${esc(m.supplier)}</td><td>${m.price.amount===null?'Unknown':money(m.price.amount)}<small>${esc(m.price.status)} · ${esc(m.price.date??'undated')}${m.price.valid_until?' · expires '+esc(m.price.valid_until):''}</small></td><td>${m.pack_spec?esc(m.pack_spec.label):num(m.pack_qty)+' '+esc(m.unit)}${m.minimum_stock?'<small>Minimum voorraad: '+num(m.minimum_stock)+' '+esc(m.unit)+'</small>':''}</td><td>${num(m.stock.qty)}<small>${esc(m.stock.date??'not counted')}</small></td><td><button data-material="${esc(m.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
 bindSearch();$('#new-material').onclick=()=>materialDialog();for(const el of document.querySelectorAll('[data-material]'))el.onclick=()=>materialDialog(materials.find(m=>m.id===el.dataset.material));
}
function packagingView(){const reg=state.result.register;
 $('#register-content').innerHTML=searchBar()+`<p>Quantities below are per packed sales unit. Manufacturing casings belong to the recipe, so packing existing stock does not use casings twice.</p><div class="register-actions"><button id="new-packaging">Add product packaging</button></div><div class="register-grid">${reg.packaging.map(p=>`<article class="register-card" data-search="${esc(p.product.toLowerCase())}"><h2>${esc(p.product)}</h2><span class="tag">${p.complete?'Complete':'Needs review'}</span><ul>${p.lines.map(l=>`<li>${num(l.qty)} ${esc(l.unit)} ${esc(reg.materials.find(m=>m.id===l.material)?.name)} · ${esc(l.status)}</li>`).join('')}</ul><p>${esc(p.notes)}</p><button data-pack="${esc(p.product)}">Edit packaging</button></article>`).join('')}</div>`;
 bindSearch();$('#new-packaging').onclick=()=>packagingDialog();for(const el of document.querySelectorAll('[data-pack]'))el.onclick=()=>packagingDialog(reg.packaging.find(p=>p.product===el.dataset.pack));
}

function openEditor(title,html,save){const d=$('#editor');d.className='recipe-dialog';d.innerHTML=`<form id="edit-form"><h2>${esc(title)}</h2>${html}<label>Source / reason for this save<input name="reason" required minlength="5" maxlength="500"></label><p id="edit-error" class="error-note" role="alert"></p><div class="register-actions"><button type="button" id="cancel-edit">Cancel</button><button class="primary" id="save-edit">Save revision</button></div></form>`;d.showModal();$('#cancel-edit').onclick=()=>d.close();$('#edit-form').onsubmit=async e=>{e.preventDefault();if(state.busy)return;state.busy=true;$('#save-edit').disabled=true;try{await save(new FormData(e.target));d.close();state.result=await api('/api/recipes');state.report=null;render();notice('Saved successfully.');}catch(e){$('#edit-error').textContent=e.message;}finally{state.busy=false;if($('#save-edit'))$('#save-edit').disabled=false;}};}
async function saveRegister(register,reason){await api('/api/recipes',{register,reason,revision:state.result.revision,request_id:crypto.randomUUID()});}
const number=(f,key)=>{const v=String(f.get(key)??'').trim().replace(',','.');if(!v)return null;const n=Number(v);if(!Number.isFinite(n)||n<0)throw Error('Enter a positive number or zero for '+key+'.');return n;};
const blankStock=()=>({qty:null,date:null,reserve:null,incoming:[],source:''});
function materialDialog(existing){const m=structuredClone(existing??{id:'',name:'',supplier:'',unit:'kg',pack_qty:null,procure:true,notes:'',source:'',price:{amount:null,status:'unknown',date:null,valid_until:null,source:''},stock:blankStock()});
 openEditor(existing?'Edit '+m.name:'Add material',`<div class="edit-grid">${field('Material code','id',m.id,'text',existing?'readonly':'required pattern="[A-Z0-9_-]{1,40}"')}${field('Name','name',m.name,'text','required maxlength="150"')}${field('Supplier','supplier',m.supplier)}${field('Material unit','unit',m.unit,'text',existing?'readonly':'required')}${field('Material units per purchase pack','pack_qty',m.pack_qty,'text','inputmode="decimal"')}${select('Purchased','procure',['yes','no'],m.procure?'yes':'no')}${field('Price per material unit, incl VAT','price',m.price.amount,'text','inputmode="decimal"')}${select('Price status','price_status',['unknown','reference','verified','expired'],m.price.status)}${field('Invoice / quote date','price_date',m.price.date,'date')}${field('Price valid until (if limited)','valid_until',m.price.valid_until,'date')}<label class="wide">Price source<input name="price_source" value="${esc(m.price.source)}"></label><p class="wide">Voorraadtellings word slegs as volle pakke onder Stocktake ingevoer. Hierdie skerm verander nie die gestoorde telling nie.</p>${field('Ordinary reserve, excluding extra 15% (0 if none)','reserve',m.stock.reserve,'text','inputmode="decimal"')}<label class="wide">Incoming deliveries: date, quantity, PO reference — one per line<textarea name="incoming">${esc(m.stock.incoming.map(x=>[x.date,x.qty,x.reference].join(', ')).join('\n'))}</textarea></label><label class="wide">Notes<textarea name="notes">${esc(m.notes)}</textarea></label></div>`,async f=>{
  const oldPack=m.pack_qty;
  Object.assign(m,{id:String(f.get('id')).trim(),name:String(f.get('name')).trim(),supplier:String(f.get('supplier')).trim(),unit:String(f.get('unit')).trim(),pack_qty:number(f,'pack_qty'),procure:f.get('procure')==='yes',notes:String(f.get('notes')),source:m.source||String(f.get('reason'))});
  if(m.pack_qty!==oldPack)delete m.pack_spec;
  m.price={amount:number(f,'price'),status:f.get('price_status'),date:f.get('price_date')||null,valid_until:f.get('valid_until')||null,source:String(f.get('price_source'))};
  m.stock={...m.stock,reserve:number(f,'reserve'),incoming:String(f.get('incoming')).split('\n').filter(s=>s.trim()).map(s=>{const [date,n,...ref]=s.split(',');const qty=Number(n);if(!n?.trim()||!Number.isFinite(qty))throw Error('Use date, quantity, PO reference for each delivery.');return {date:date.trim(),qty,reference:ref.join(',').trim()};})};
  const register=structuredClone(state.result.register);const i=register.materials.findIndex(x=>x.id===m.id);if(!existing&&i>=0)throw Error('This material code already exists.');if(i>=0)register.materials[i]=m;else register.materials.push(m);await saveRegister(register,String(f.get('reason')));
 });
}
function linesHTML(lines,prefix){const materials=state.result.register.materials;return `<div id="${prefix}-lines">${lines.map(l=>lineHTML(l,prefix,materials)).join('')}</div><button type="button" id="${prefix}-add">Add material</button>`;}
function lineHTML(l,prefix,materials){return `<div class="edit-line" data-lines="${prefix}"><select aria-label="Material">${materials.map(m=>`<option value="${esc(m.id)}" ${m.id===l.material?'selected':''}>${esc(m.id+' · '+m.name+' ('+m.unit+')')}</option>`).join('')}</select><input aria-label="Quantity" value="${esc(l.qty??'')}" inputmode="decimal" required><select aria-label="Quantity status">${options(['approved','estimate','review'],l.status??'approved')}</select><button type="button" data-remove>Remove</button><input class="line-note" aria-label="Quantity note" value="${esc(l.note??'')}" placeholder="Quantity note"></div>`;}
function bindLines(prefix){$('#'+prefix+'-add').onclick=()=>{$('#'+prefix+'-lines').insertAdjacentHTML('beforeend',lineHTML({},prefix,state.result.register.materials));bindRemove();};bindRemove();}
function bindRemove(){for(const el of document.querySelectorAll('[data-remove]'))el.onclick=()=>el.closest('.edit-line').remove();}
function readLines(prefix){return [...document.querySelectorAll('[data-lines="'+prefix+'"]')].map(el=>{const material=el.querySelector('select').value,m=state.result.register.materials.find(m=>m.id===material),qty=Number(el.querySelector('input').value.replace(',','.'));if(!(qty>0))throw Error('Material quantities must be positive.');return {material,qty,unit:m.unit,status:el.querySelectorAll('select')[1].value,note:el.querySelector('.line-note').value};});}
function recipeDialog(old){if(!state.result.register.materials.length){notice('Import or add materials first.');return;}const r=structuredClone(old??{group:'',name:'',version:0,effective_date:today(),status:'review',complete:false,batch_kg:0,ingredients:[],consumables:[],source:'',notes:''});
 openEditor(old?'Review '+r.name:'Add recipe',`<p>A quantity change creates a new recipe version. Choose its first production date. Earlier versions remain available for saved plans. The production screen retains its own batch decisions and yields.</p><div class="edit-grid">${field('Production group code','group',r.group,'text',old?'readonly':'required')}${field('Recipe name','name',r.name,'text','required')}${field('Effective production date','effective_date',r.effective_date,'date','required')}${field('Full batch mass (kg)','batch_kg',r.batch_kg,'text','inputmode="decimal" required')}${select('Approval status','status',['review','approved','historical'],r.status)}${select('Manufacturing specification complete','complete',['no','yes'],r.complete?'yes':'no')}${field('Recipe source','source',r.source,'text','required')}</div><h3>Ingredients per full batch</h3>${linesHTML(r.ingredients,'ingredients')}<h3>Manufacturing casings / consumables per full batch</h3>${linesHTML(r.consumables,'consumables')}<h3>Forecast conversion for this recipe</h3><p>Saleable units per complete batch, by product. Use approved only with evidence for this exact recipe version. Unverified planner yields remain estimates.</p><label>One per line: product code, sales units per batch, approved / estimate / review, evidence source<textarea name="forecast_yields">${esc((r.forecast_yields??[]).map(y=>[y.product,y.qty,y.status,y.source].join(", ")).join("\n"))}</textarea></label><label>Notes<textarea name="notes">${esc(r.notes)}</textarea></label>`,async f=>{
  const next={...r,group:String(f.get('group')),name:String(f.get('name')),effective_date:String(f.get('effective_date')),batch_kg:number(f,'batch_kg'),status:f.get('status'),complete:f.get('complete')==='yes',source:String(f.get('source')),notes:String(f.get('notes')),ingredients:readLines('ingredients'),consumables:readLines('consumables')};
  next.forecast_yields=String(f.get("forecast_yields")??"").split("\n").filter(s=>s.trim()).map(s=>{const [product,n,status,...src]=s.split(",");return {product:product.trim(),qty:Number(n),status:status?.trim(),source:src.join(",").trim()};});
  const changed=!old||next.batch_kg!==old.batch_kg||next.effective_date!==old.effective_date||JSON.stringify(next.ingredients)!==JSON.stringify(old.ingredients)||JSON.stringify(next.consumables)!==JSON.stringify(old.consumables);const register=structuredClone(state.result.register);
  if(next.group==='R07')next.plan_version=r.plan_version??(r.version||2);
  if(changed){if(old&&JSON.stringify(next.forecast_yields)===JSON.stringify(old.forecast_yields??[]))next.forecast_yields=next.forecast_yields.map(y=>({...y,status:"review"}));next.version=Math.max(0,...register.recipes.filter(x=>x.group===next.group).map(x=>x.version))+1;register.recipes.push(next);}else register.recipes[register.recipes.findIndex(x=>x.group===r.group&&x.version===r.version)]=next;
  await saveRegister(register,String(f.get('reason')));
 });bindLines('ingredients');bindLines('consumables');
}
function packagingDialog(old){if(!state.result.register.materials.length){notice('Import or add materials first.');return;}const p=structuredClone(old??{product:'',lines:[],source:'',notes:'',complete:false});openEditor('Product packaging',`<div class="edit-grid">${field('Product code','product',p.product,'text',old?'readonly':'required')}${select('Specification complete','complete',['no','yes'],p.complete?'yes':'no')}${field('Source','source',p.source,'text','required')}</div><h3>Per packed sales unit</h3>${linesHTML(p.lines,'packing')}<label>Notes<textarea name="notes">${esc(p.notes)}</textarea></label>`,async f=>{Object.assign(p,{product:String(f.get('product')),complete:f.get('complete')==='yes',source:String(f.get('source')),notes:String(f.get('notes')),lines:readLines('packing')});const reg=structuredClone(state.result.register),i=reg.packaging.findIndex(x=>x.product===p.product);if(!old&&i>=0)throw Error('Packaging for this product already exists.');if(i>=0)reg.packaging[i]=p;else reg.packaging.push(p);await saveRegister(reg,String(f.get('reason')));});bindLines('packing');}
function importDialog(){let draft=null;openEditor('Import reviewed register',`<p>Review the counts and notes before saving. Existing material identities and earlier recipe versions must be retained. Sales and production plans are separate.</p><label>Register file<input id="import-file" type="file" accept=".json,application/json"></label><label>Or paste register JSON<textarea id="import-data"></textarea></label><button type="button" id="preview-import">Review import</button><div id="import-preview"></div>`,async f=>{if(!draft)throw Error('Review the import before saving.');await saveRegister(draft,String(f.get('reason')));});$('#save-edit').textContent='Save reviewed import';const preview=()=>{try{const parsed=JSON.parse($('#import-data').value);draft=parsed.register??parsed;if(draft.schema_version!==1||!Array.isArray(draft.materials)||!Array.isArray(draft.recipes)||!Array.isArray(draft.packaging))throw Error('Use register format 1.');$('#import-preview').innerHTML=`<p class="status-note">${draft.materials.length} materials · ${draft.recipes.length} recipe versions · ${draft.packaging.length} packaging specifications<br>${esc(draft.notes)}</p>`;$('#edit-error').textContent='';}catch(e){draft=null;$('#import-preview').textContent='';$('#edit-error').textContent=e.message;}};$('#preview-import').onclick=preview;$('#import-data').oninput=()=>{draft=null;$('#import-preview').textContent='Review the changed file again.';};$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>700000){$('#edit-error').textContent='Register file is too large.';return;}$('#import-data').value=await file.text();preview();};}
window.addEventListener('beforeunload',e=>{if(state.stockDirty||state.busy){e.preventDefault();e.returnValue='';}});
try{state.result=await api(state.view==='stock'?'/api/stocktake':'/api/recipes');if(!state.result.recipes_read_only)restoreStockDraft();render();}catch(e){$('#app').innerHTML=`<main class="register-shell"><h1>Recipes</h1><p>${esc(e.message)}</p><p><a href="/">Home · Sign in</a>, then open Recipes.</p></main>`;}

function printRecipe(recipe){
 if(state.busy){notice('Wait until saving is complete, then print the saved recipe.');return;}
 if(!recipe||!state.result.revision){notice('Save the recipe before printing.');return;}
 try{
  const options=printPageOptions(new URLSearchParams({document:'recipe',group:recipe.group,version:String(recipe.version),revision:String(state.result.revision)}));
  notice('');openPrintPreview({...options,title:recipe.name+' — staff recipe'});
 }catch(e){notice(e.message);}
}

function printStocktakeSummary(){
 if(state.busy){notice('Wait until the stocktake has finished saving, then open PDF Summary.');return;}
 if(state.stockDirty||hasCountChanges(state.stockDraft)){notice('Save your stocktake changes before opening PDF Summary. Your entries stay on this screen.');return;}
 const r=state.result,draft=state.stockDraft;
 const group=supplierGroups(r.register.materials).find(g=>g.key===draft.supplier);
 if(!group){notice('Choose a supplier in Stocktake first.');return;}
 if(!r.revision){notice('Save a stocktake before opening PDF Summary.');return;}
 try{
  const options=printPageOptions(new URLSearchParams({document:'stocktake',date:draft.date,supplier:group.key,revision:String(r.revision)}));
  notice('');openPrintPreview({...options,title:'Stocktake Summary - '+group.name});
 }catch(e){notice(e.message);}
}
function bindStocktakeSummary(){const button=$('#stock-pdf-summary');if(button)button.onclick=printStocktakeSummary;}

function persistStockDraft(){
 try{return writeCountDraft(window.sessionStorage,state.result.current_user,state.stockDraft);}catch{return false;}
}
function restoreStockDraft(){
 try{const draft=readCountDraft(window.sessionStorage,state.result.current_user);if(draft){state.stockDraft=draft;state.stockDraft.feedback=reconcileCountDraft(state.result,draft);state.stockDirty=hasCountChanges(draft);state.view='stock';persistStockDraft();}}catch{}
}

function stockView(){stocktakeView({root:$('#register-content'),result:state.result,draft:state.stockDraft,api,esc,notice,onWorking:value=>{state.busy=value;},onDirty:value=>{
 state.stockDirty=value;if(!persistStockDraft()&&value)notice('Die blaaier kon nie ’n tydelike kopie hou nie. Hou hierdie oortjie oop totdat die bediener die stoor bevestig.');
},onReload:async()=>{
 const fresh=await api('/api/stocktake');state.stockDraft.feedback=reconcileCountDraft(fresh,state.stockDraft);state.result=fresh;state.report=null;state.stockDirty=hasCountChanges(state.stockDraft);persistStockDraft();render();notice(state.stockDraft.feedback);
},onSaved:async(saved,supplier,count)=>{
 const fresh=saved.register?saved:await api('/api/stocktake');
 state.result=fresh;state.report=null;state.stockDraft.rows={};state.stockDraft.metaDirty=false;state.stockDraft.request=null;state.stockDirty=false;
 state.stockDraft.feedback=count+' tellings vir '+supplier+' is op die bediener gestoor. Die hoeveelhede bly in die blokkies sigbaar.';persistStockDraft();render();notice(state.stockDraft.feedback);
}});}

async function documentedDialog(){
 if(state.stockDirty){notice('Save your supplier count first.');return;}
 try{const preview=await api('/api/recipes/documented-update');if(preview.applied||!preview.changes.length){notice('The documented update is already saved, or no matching entries remain.');return;}
 openEditor('Documented packaging and patty calculation',`<p>These changes use the existing Recipe Costing Summary and your 9 October instructions. Current ingredient formulas, prices and stock counts are retained. Earlier recipe versions remain in the history.</p><ul>${preview.changes.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul><details><summary>Entries kept for separate review</summary><ul>${preview.skipped.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></details><p>Outer label types, film estimates and other unresolved specifications remain visible against the affected materials.</p>`,async()=>{await api('/api/recipes/documented-update',{revision:preview.revision,request_id:crypto.randomUUID()});});
 $('#edit-form [name="reason"]').value='Owner instructions and existing recipe costing document, 9 October 2026';$('#save-edit').textContent='Save documented update';
 }catch(e){notice(e.message);}
}

async function margotPacksDialog(){
 if(state.stockDirty){notice('Stoor eers jou huidige voorraadtelling. Daarna kan jy die pakgroottes bywerk.');return;}
 try{
  const preview=await api('/api/recipes/margot-packs');
  if(preview.applied||!preview.changes.length){notice('Die Margot Swiss-pakgroottes is reeds gestoor, of geen passende produkte bly oor nie.');return;}
  const request={revision:preview.revision,request_id:crypto.randomUUID()};
  openEditor('Margot Swiss se pakgroottes',`<p>Hierdie groottes kom uit die voorraadblad wat Alinda op 9 Oktober gestuur het. Alex het bevestig dat 1 liter asyn as 1 kg tel, en dat saaglemme, ribbon-elemente en Teflon-band enkel gekoop word met minimum voorraad van 2 elk.</p><p>Jou gestoorde voorraadtellings, datums en pryse bly behoue. Die nuwe pakgroottes word vir nuwe tellings en bestellings gebruik.</p><ul>${preview.changes.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul>${preview.skipped.length?'<details open><summary>Besonderhede wat nog nie verander is nie</summary><ul>'+preview.skipped.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>':''}`,async()=>{await api('/api/recipes/margot-packs',request);});
  $('#edit-form [name="reason"]').value='Alinda se voorraadblad en Alex se bevestiging, 9 Oktober 2026';
  $('#save-edit').textContent='Stoor Margot Swiss se pakgroottes';
 }catch(e){notice(e.message);}
}
