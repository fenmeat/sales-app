import './input-selection.js';
import {parseQuantity} from './invoice-domain.js';
import {escapeHTML as esc,money,newDraft,cartLines,paymentAmounts,receiptMessage,draftStore} from './pos-model.js';

const $=s=>document.querySelector(s),app=$('#app'),modal=$('#modal');
let boot=null,store=null,draft=null,view='sale',busy=false,search='',receipt=null,historyPage=0,draftPage=0,historyCustomer=null,reportDate=new Date(Date.now()+7200000).toISOString().slice(0,10);
const activeKey=()=> 'fm-pos:active:'+boot.username;
function notice(message){$('#notice').textContent=message??'';}
function error(e){const el=modal.open?$('#modalError'):$('#notice');el.textContent=e.message??String(e);}
async function api(path,body){
  const response=await fetch('/api/pos/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(30000)});
  let data;try{data=await response.json();}catch{throw Error('Connection interrupted. Use Check saved sale; do not charge the customer again.');}
  if(!response.ok){const e=Error(data.error??'The request failed.');e.status=response.status;throw e;}return data;
}
function remember(){store.save(draft);sessionStorage.setItem(activeKey(),draft.id);}
function hasItems(){return Object.values(draft.lines).some(v=>v!==''&&parseQuantity(v)!==0);}
function lines(){return cartLines(draft,boot.products);}
function total(){try{return lines().reduce((sum,line)=>sum+line.total,0);}catch{return null;}}
function show(html){$('#modalBody').innerHTML=html;$('#modalError').textContent='';if(!modal.open)modal.showModal();}
function buttonsDisabled(value){document.querySelectorAll('button').forEach(el=>el.disabled=value||el.dataset.disabled==='true');}
async function safe(fn){if(busy)return;busy=true;buttonsDisabled(true);try{await fn();}catch(e){error(e);}finally{busy=false;buttonsDisabled(false);}}
function selectDraft(next){draft=next;remember();view='sale';search='';render();}
function fromSale(sale){return {id:sale.id,revision:sale.revision,lines:Object.fromEntries(sale.lines.map(l=>[l.code,String(l.qty/1000)])),customer:sale.customer,payment:null,pending:null,server:sale};}
function newSale(){if(draft&&(hasItems()||draft.pending||draft.revision))remember();else if(draft)store.remove(draft.id);selectDraft(newDraft());modal.close();notice('');}
function render(){
  document.querySelectorAll('.dock').forEach(el=>el.remove());
  $('#identity').textContent=boot.username;$('#nav').hidden=false;
  if(view!=='sale')return;
  const currentTotal=total();
  app.innerHTML=`<h1>Factory POS</h1>${draft.pending?'<section class="warning">This save needs confirmation. Do not charge the customer again.<div class="actions"><button data-action="retry">Check saved sale</button></div></section>':''}<div class="layout"><section class="panel"><label>Find a product<input id="search" type="search" value="${esc(search)}" placeholder="Name or product code"></label><div class="products" id="products"></div></section><section class="panel cart"><div class="row"><div><h2>${esc(draft.customer.name)}</h2>${draft.customer.phone?'<p>'+esc(draft.customer.phone)+'</p>':''}</div><button data-action="customer">Choose customer</button></div>${draft.customer.id?'<button data-action="customerHistory">Customer history</button>':''}<div id="cart"></div>${!hasItems()?'<p>Choose products to start a sale.</p>':''}<p class="muted">Full payment required · quantities use the sales unit shown. Connect to the internet to save and complete sales.</p><p class="muted">${draft.revision?'Draft saved in FenMeat. Changes save on this device until Save draft or Pay.':'Draft kept on this device. Save draft to make it available on your other devices.'}</p><div class="actions"><button data-action="cancel" class="danger">Cancel draft</button></div></section></div><aside class="dock"><strong id="total" class="amount">${currentTotal===null?'Check quantities':money(currentTotal)}</strong><div class="actions"><button data-action="save">Save draft</button><button data-action="pay" class="primary">Pay</button></div></aside>`;
  drawProducts();drawCart();
  if(draft.pending)app.querySelectorAll('button:not([data-action=retry]),input').forEach(el=>{el.disabled=true;el.dataset.disabled='true';});
  if(draft.pending)document.querySelectorAll('.dock button').forEach(el=>{el.disabled=true;el.dataset.disabled='true';});
}
function drawProducts(){
  const q=search.trim().toLowerCase();$('#products').innerHTML=boot.products.filter(p=>p.available&&(!q||(p.name+' '+p.code).toLowerCase().includes(q))).map(p=>`<button class="product" data-add="${esc(p.code)}"><strong>${esc(p.name)}</strong><span>${esc(p.unit)}</span><strong>${money(p.price_cents)}</strong></button>`).join('')||'<p>No available products match.</p>';
}
function drawCart(){
  $('#cart').innerHTML=Object.entries(draft.lines).map(([code,value])=>{const p=boot.products.find(p=>p.code===code);return `<div class="cart-item"><div><strong>${esc(p?.name??code)}</strong><span>${esc(p?.unit??'')} · ${p?money(p.price_cents):'Unavailable'}</span></div><label><span>Qty</span><input inputmode="decimal" data-qty="${esc(code)}" aria-label="${esc(p?.name??code)} quantity" value="${esc(value)}"></label><button data-remove="${esc(code)}" aria-label="Remove ${esc(p?.name??code)}">×</button></div>`;}).join('');
}
function updateTotal(){const n=total();$('#total').textContent=n===null?'Check quantities':money(n);}
async function applyResult(result){
  const sale=result.sale;
  if(sale.status==='paid'){store.remove(sale.id);sessionStorage.removeItem(activeKey());draft=null;receipt=sale;view='receipt';render();app.innerHTML='<h1>Sale completed</h1><p class="paid">'+esc(sale.number)+' · Paid in full · '+money(sale.total)+'</p><button class="primary" data-action="new">New sale</button>';showReceipt(sale);}
  else if(sale.status==='cancelled'){store.remove(sale.id);draft=null;newSale();notice('Draft cancelled. No payment or stock movement recorded.');}
  else {const payment=draft?.payment;draft=fromSale(sale);draft.payment=payment;remember();render();}
  return sale;
}
async function send(body){
  draft.pending=body;remember();
  try{return await applyResult(await api('sale',body));}
  catch(e){
    // A timeout is ambiguous: retain the exact request before any retry.
    if([400,409].includes(e.status)){
      try{const result=await api('sale?id='+encodeURIComponent(body.id));if(result.sale.status==='paid')return await applyResult(result);if(result.sale.status==='draft'&&result.sale.revision===body.revision){draft.pending=null;remember();render();}}
      catch(readError){if(readError.status===404&&body.action==='save'&&body.revision===0){draft.pending=null;remember();render();}}
    }
    if(draft?.pending)render();throw e;
  }
}
async function saveDraft(){
  if(draft.pending)throw Error('Use Check saved sale first.');
  return send({id:draft.id,revision:draft.revision,request_id:crypto.randomUUID(),action:'save',customer_id:draft.customer.id,lines:lines().map(({code,qty})=>({code,qty}))});
}
async function pay(){
  if(!hasItems()||!total())throw Error('Add products before taking payment.');
  const before=total(),saved=await saveDraft();
  if(saved.total!==before){boot=await api('bootstrap');render();notice('Prices changed. Review the updated total, then choose Pay.');return;}
  draft.payment=draft.payment??{cash_tendered:(saved.total/100).toFixed(2),card:'0',shop2shop:'0',received:false,card_approved:false,card_reference:'',shop2shop_reference:''};remember();showPayment();
}
function showPayment(){
  const p=draft.payment;
  show(`<h2>Pay · ${money(draft.server.total)}</h2><p>${esc(draft.customer.name)}</p><div class="actions">${['Cash','Card','Shop2Shop','Split payment'].map(m=>'<button data-method="'+m+'">'+m+'</button>').join('')}</div><div class="pay-grid">${[['cash_tendered','Cash tendered (R)'],['card','Card · Capitec (R)'],['shop2shop','Shop2Shop (R)']].map(([key,label])=>`<label>${label}<input data-payment="${key}" inputmode="decimal" value="${esc(p[key])}"></label>`).join('')}</div><div id="payment-summary"></div><section id="card-details" ${Number(p.card.replace(',','.'))>0?'':'hidden'}><label class="check"><input type="checkbox" data-payment="card_approved" ${p.card_approved?'checked':''}> The Capitec machine shows Approved for this amount.</label><label>Card reference (optional)<input maxlength="100" data-payment="card_reference" value="${esc(p.card_reference)}"></label></section><section id="shop-details" ${Number(p.shop2shop.replace(',','.'))>0?'':'hidden'}><label>Successful Shop2Shop reference<input maxlength="100" data-payment="shop2shop_reference" value="${esc(p.shop2shop_reference)}"></label></section><label class="check"><input type="checkbox" data-payment="received" ${p.received?'checked':''}> I have received the full payment above.</label><p class="muted">Card payments are processed on the Capitec machine. FenMeat records the approved payment; it does not charge the card.</p><button data-action="complete" class="primary">Complete sale</button>`);updatePayment();
}
function updatePayment(){
  try{const p=paymentAmounts(draft.payment,draft.server.total);$('#payment-summary').innerHTML=`<div class="payment-row"><strong>${p.short?'Still to receive':'Change'}</strong><strong class="amount">${money(p.short||p.change)}</strong></div>`;$('#card-details').hidden=!p.card;$('#shop-details').hidden=!p.shop2shop;}catch(e){$('#payment-summary').textContent=e.message;}
}
async function complete(){
  if(draft.pending)throw Error('This payment save needs confirmation. Close this window and use Check saved sale; do not charge again.');
  const payment=paymentAmounts(draft.payment,draft.server.total);
  if(payment.short)throw Error('Receive the full payment before completing the sale.');
  if(!payment.received)throw Error('Confirm that the full payment was received.');
  if(payment.card&&!payment.card_approved)throw Error('Confirm Approved on the Capitec machine first.');
  if(payment.shop2shop&&!payment.shop2shop_reference.trim())throw Error('Enter the successful Shop2Shop reference.');
  await send({id:draft.id,revision:draft.revision,request_id:crypto.randomUUID(),action:'complete',captured_at:new Date().toISOString(),payment});
}
function showReceipt(sale){
  receipt=sale;
  show(`<h2>${esc(sale.number)}</h2><p class="paid">Paid in full · ${money(sale.total)}</p><p>${esc(sale.customer.name)} · ${esc(sale.date)} · ${esc(sale.actor)}</p><ul class="receipt-lines">${sale.lines.map(l=>`<li><strong>${esc(l.name)}</strong><br>${l.qty/1000} × ${money(l.price)} · ${esc(l.unit)}<br><strong>${money(l.total)}</strong></li>`).join('')}</ul>${[['cash','Cash'],['card','Card (Capitec)'],['shop2shop','Shop2Shop'],['change','Change']].map(([key,label])=>`<div class="payment-row"><span>${label}</span><strong>${money(sale.payment[key])}</strong></div>`).join('')}<div class="actions"><a class="button" target="_blank" rel="noopener" href="/print-page?document=pos&id=${encodeURIComponent(sale.id)}">Print / Share PDF</a><button data-action="whatsapp">WhatsApp</button><button data-action="new" class="primary">New sale</button></div>`);
}
async function customers(query=''){
  const r=await api('customers?q='+encodeURIComponent(query));
  show(`<h2>Choose customer</h2><div class="actions"><button data-action="walkin">Walk-in customer</button><button data-action="addCustomer">Add customer</button></div><label>Find a customer<input id="customer-search" value="${esc(query)}" type="search"></label><button data-action="searchCustomers">Search</button><div>${r.customers.map(c=>`<div class="record"><strong>${esc(c.name)}</strong><p>${esc(c.phone)}</p><button data-customer="${esc(c.id)}">Choose</button></div>`).join('')||'<p>No matching customers.</p>'}</div>${r.more?'<p>More customers match. Enter a more specific name.</p>':''}`);
  for(const c of r.customers)$('[data-customer="'+c.id+'"]').onclick=()=>{draft.customer=c;draft.payment=null;remember();modal.close();render();};
}
function addCustomer(){show(`<h2>Add customer</h2><form id="customer-form" data-id="${crypto.randomUUID()}" class="customer-form"><label>Customer / shop name<input name="name" required maxlength="160"></label><label>Phone / WhatsApp (optional)<input name="phone" type="tel" maxlength="30"></label><button class="primary">Save customer</button></form>`);}
async function drafts(){
  if(draft)remember();const r=await api('sales?status=draft&page='+draftPage),saved=new Map(r.sales.map(s=>[s.id,fromSale(s)]));
  for(const d of store.list())if(d.pending||Object.keys(d.lines).length||d.revision)saved.set(d.id,d);
  view='drafts';render();app.innerHTML='<h1>My drafts</h1>'+([...saved.values()].map(d=>`<section class="panel"><strong>${esc(d.customer.name)}</strong><p>${d.pending?'Save needs confirmation':d.revision?'Saved draft':'Draft on this device'} · ${Object.keys(d.lines).length} product(s)</p><button data-draft="${esc(d.id)}">Open draft</button></section>`).join('')||'<p>No drafts.</p>')+`<div class="actions">${draftPage?'<button data-action="prevDrafts">Previous saved drafts</button>':''}${r.more?'<button data-action="nextDrafts">More saved drafts</button>':''}</div>`;
  for(const d of saved.values())$('[data-draft="'+d.id+'"]').onclick=()=>safe(async()=>{if(!d.pending&&d.revision){const latest=await api('sale?id='+encodeURIComponent(d.id));if(latest.sale.status!=='draft'){store.remove(d.id);if(latest.sale.status==='paid')showReceipt(latest.sale);else notice('This draft was cancelled.');return;}if(latest.sale.revision!==d.revision){selectDraft(fromSale(latest.sale));notice('Loaded the newer saved draft.');return;}}selectDraft(d);});
}
async function daily(){
  if(draft)remember();const r=await api('daily?date='+reportDate);view='daily';render();
  const cards=[['sales','Sales'],['total','Sales total'],['cash','Cash expected'],['card','Card (Capitec)'],['shop2shop','Shop2Shop'],['change','Change given']];
  app.innerHTML=`<h1>Daily totals</h1><div class="row"><label>Date<input id="report-date" type="date" value="${reportDate}"></label><button data-action="daily">Refresh totals</button></div><section class="totals-grid">${cards.map(([key,label])=>`<div class="panel"><strong>${label}</strong><p class="amount">${key==='sales'?r.totals[key]:money(r.totals[key])}</p></div>`).join('')}</section><section class="panel"><h2>Compare money received</h2><p>Cash expected is after change. Compare Card with the Capitec machine's daily total and Shop2Shop with its successful receipts.</p><div class="pay-grid">${[['cash','Cash counted'],['card','Capitec total'],['shop2shop','Shop2Shop total']].map(([key,label])=>`<label>${label} (R)<input data-compare="${key}" data-expected="${r.totals[key]}" inputmode="decimal" placeholder="Not checked"><span id="compare-${key}"></span></label>`).join('')}</div><p class="muted">Comparison fields are a check on this screen; the saved payment totals above stay unchanged.</p></section><section class="panel"><h2>By person</h2>${r.staff.map(s=>`<div class="record"><strong>${esc(s.actor)} · ${s.sales} sale(s) · ${money(s.total)}</strong><p>Cash ${money(s.cash)} · Card ${money(s.card)} · Shop2Shop ${money(s.shop2shop)}</p></div>`).join('')||'<p>No completed sales.</p>'}</section><section class="panel"><h2>Stock sold</h2>${r.stock.items.map(i=>`<div class="payment-row"><span>${esc(i.name)}<br><span class="muted">${esc(i.unit)}</span></span><strong>${i.qty/1000}</strong></div>`).join('')||'<p>No stock issued.</p>'}<p class="muted">One stock issue per completed sale. Drafts do not move stock. Physical counts remain separate.</p></section><p><a href="/invoicing/?route=R12">Previous Factory records</a></p>`;
}
async function history(){
  if(draft)remember();const r=await api('sales?date='+reportDate+'&page='+historyPage+(historyCustomer?'&customer='+encodeURIComponent(historyCustomer):''));view='history';render();
  app.innerHTML=`<h1>${historyCustomer?'Customer history':'Sales history'}</h1>${historyCustomer?'':`<label>Date<input id="report-date" type="date" value="${reportDate}"></label>`}${r.sales.map(s=>`<section class="panel"><strong>${esc(s.number)} · ${money(s.total)}</strong><p>${esc(s.customer.name)} · ${esc(s.date)} · ${esc(s.actor)}</p><button data-receipt="${esc(s.id)}">Open receipt</button></section>`).join('')||'<p>No completed sales.</p>'}<div class="actions">${historyPage?'<button data-action="prevHistory">Previous</button>':''}${r.more?'<button data-action="nextHistory">Next</button>':''}</div>`;
  for(const s of r.sales)$('[data-receipt="'+s.id+'"]').onclick=()=>showReceipt(s);
}
async function retry(){if(!draft?.pending)throw Error('There is no pending save.');const action=draft.pending.action;const sale=await send(draft.pending);if(sale.status==='draft')notice(action==='save'?'Draft saved. Choose Pay when ready.':'Draft is still unpaid. Review before continuing.');}
async function action(name){
  if(name==='new'){newSale();return;}
  if(name==='save'){await saveDraft();notice('Draft saved in FenMeat.');return;}
  if(name==='pay')return pay();if(name==='complete')return complete();if(name==='retry')return retry();
  if(name==='drafts'){draftPage=0;modal.close();return drafts();}if(name==='prevDrafts'||name==='nextDrafts'){draftPage+=name==='prevDrafts'?-1:1;return drafts();}if(name==='daily'){modal.close();return daily();}
  if(name==='history'){historyCustomer=null;historyPage=0;modal.close();return history();}
  if(name==='customerHistory'){historyCustomer=draft.customer.id;historyPage=0;return history();}
  if(name==='prevHistory'||name==='nextHistory'){historyPage+=name==='prevHistory'?-1:1;return history();}
  if(name==='customer')return customers();if(name==='searchCustomers')return customers($('#customer-search').value);
  if(name==='addCustomer')return addCustomer();
  if(name==='walkin'){draft.customer={id:null,name:'Walk-in customer',phone:''};draft.payment=null;remember();modal.close();render();return;}
  if(name==='cancel'){if(draft.pending)throw Error('Check the pending save before cancelling.');if(!confirm('Cancel this draft? No payment will be recorded.'))return;if(draft.revision)await send({id:draft.id,revision:draft.revision,request_id:crypto.randomUUID(),action:'cancel'});else{store.remove(draft.id);draft=null;newSale();}return;}
  if(name==='whatsapp'){show(`<h2>WhatsApp receipt</h2><label>Recipient phone<input id="whatsapp-phone" type="tel" value="${esc(receipt.customer.phone)}"></label><textarea id="whatsapp-text" rows="9" readonly>${esc(receiptMessage(receipt))}</textarea><button data-action="prepareWhatsApp">Prepare WhatsApp</button>`);return;}
  if(name==='prepareWhatsApp'){let phone=$('#whatsapp-phone').value.replace(/[\s()+-]/g,'');if(/^0\d{9}$/.test(phone))phone='27'+phone.slice(1);if(!/^[1-9]\d{7,14}$/.test(phone))throw Error('Enter a valid WhatsApp phone number.');const link='https://wa.me/'+phone+'?text='+encodeURIComponent(receiptMessage(receipt));show('<h2>Receipt ready</h2><p>Review and send in WhatsApp.</p><a class="button primary" target="_blank" rel="noopener noreferrer" href="'+esc(link)+'">Open WhatsApp</a>');}
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.action)return void safe(()=>action(button.dataset.action));
  if(button.dataset.add)return void safe(async()=>{if(draft.pending)throw Error('Check the pending save first.');const code=button.dataset.add,n=parseQuantity(draft.lines[code]??'0');if(n===null)throw Error('Correct the current quantity first.');draft.lines[code]=String(n/1000+1);draft.payment=null;remember();drawCart();updateTotal();});
  if(button.dataset.remove)return void safe(async()=>{if(draft.pending)throw Error('Check the pending save first.');delete draft.lines[button.dataset.remove];draft.payment=null;remember();drawCart();updateTotal();});
  if(button.dataset.method)return void safe(async()=>{const method=button.dataset.method,amount=(draft.server.total/100).toFixed(2);draft.payment={cash_tendered:method==='Cash'?amount:'0',card:method==='Card'?amount:'0',shop2shop:method==='Shop2Shop'?amount:'0',received:false,card_approved:false,card_reference:'',shop2shop_reference:''};remember();showPayment();});
});
document.addEventListener('input',event=>{
  const el=event.target;try{
    if(el.id==='search'){search=el.value;drawProducts();}
    if(el.dataset.qty){if(draft.pending)throw Error('Check the pending save first.');draft.lines[el.dataset.qty]=el.value;draft.payment=null;remember();updateTotal();}
    if(el.dataset.payment){if(draft.pending)throw Error('The payment save is pending. Close this window and use Check saved sale.');const key=el.dataset.payment;draft.payment[key]=el.type==='checkbox'?el.checked:el.value;if(['cash_tendered','card','shop2shop'].includes(key)){draft.payment.received=false;draft.payment.card_approved=false;document.querySelectorAll('[data-payment=received],[data-payment=card_approved]').forEach(c=>c.checked=false);}remember();updatePayment();}
    if(el.dataset.compare){const value=Number(el.value.replace(',','.'));$('#compare-'+el.dataset.compare).textContent=el.value.trim()&&Number.isFinite(value)?'Difference: '+money(Math.round(value*100)-Number(el.dataset.expected)):'Not checked';}
  }catch(e){error(e);}
});
document.addEventListener('change',event=>{if(event.target.id==='report-date'){reportDate=event.target.value;historyPage=0;void safe(()=>view==='daily'?daily():history());}});
document.addEventListener('submit',event=>{if(event.target.id!=='customer-form')return;event.preventDefault();const form=event.target;void safe(async()=>{const r=await api('customers',{id:form.dataset.id,name:form.elements.name.value,phone:form.elements.phone.value});draft.customer=r.customer;remember();modal.close();render();});});
$('#closeModal').onclick=()=>modal.close();
window.addEventListener('offline',()=>notice('Offline. Keep this screen open; drafts stay on this device. Reconnect to save or complete sales.'));
window.addEventListener('online',()=>notice(draft?.pending?'Connected. Use Check saved sale; do not charge the customer again.':'Connected.'));
window.addEventListener('beforeunload',event=>{if(draft?.pending){event.preventDefault();event.returnValue='';}});
async function start(){
  try{boot=await api('bootstrap');store=draftStore(localStorage,boot.username);const id=sessionStorage.getItem(activeKey());draft=id?store.get(id):null;draft=draft??newDraft();remember();render();}
  catch(e){$('#nav').hidden=true;app.innerHTML='<h1>Factory POS</h1><p>'+esc(e.message)+'</p>'+(e.status===401?'<p><a class="button" href="/">Home · Sign in</a></p>':'<button id="try-again">Try again</button>');$('#try-again')?.addEventListener('click',start);}
}
start();
