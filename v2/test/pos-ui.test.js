import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {parseQuantity} from '../src/invoice-domain.js';
import {posLines,posPayment} from '../src/pos-domain.js';
import {escapeHTML,money,newDraft,cartLines,paymentAmounts,receiptMessage,draftStore} from '../public/pos-model.js';
const html=await readFile(new URL('../public/pos.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/pos-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/\nstart\(\);\s*$/,'\nglobalThis.ui={ready:start(),get draft(){return draft;},action,complete,pay,remember,render,showPayment,get receipt(){return receipt;}};');
const products=[{code:'P1',name:'SYNTHETIC PRODUCT',unit:'bag: 5 packs',active:true,available:true,price_cents:10000}];
class Storage{data=new Map();get length(){return this.data.size;}key(n){return [...this.data.keys()][n];}getItem(k){return this.data.get(k)??null;}setItem(k,v){this.data.set(k,v);}removeItem(k){this.data.delete(k);}}
async function page({local=new Storage(),session=new Storage(),backend={sales:new Map(),events:new Map(),calls:[],lost:false},username='alex',unauthorized=false}={}){
  const {document}=parseHTML(html),events=new Map();document.addEventListener=(event,fn)=>events.set(event,fn);
  const dialog=document.querySelector('#modal');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const context={document,window:{addEventListener(){}},localStorage:local,sessionStorage:session,crypto,URLSearchParams,Date,Intl,AbortSignal,confirm:()=>true,
    parseQuantity,esc:escapeHTML,money,newDraft,cartLines,paymentAmounts,receiptMessage,draftStore,
    fetch:async(path,options={})=>{
      const body=options.body?JSON.parse(options.body):null;backend.calls.push({path,body});let data,status=200;
      if(unauthorized){status=403;data={error:'Not allowed'};}
      else if(path==='/api/pos/bootstrap')data={username,products,date:'2026-11-03'};
      else if(path.startsWith('/api/pos/sales?'))data={sales:[...backend.sales.values()].filter(s=>s.status==='draft'),more:false};
      else if(path.startsWith('/api/pos/sale?id=')){const id=new URLSearchParams(path.split('?')[1]).get('id');data={sale:backend.sales.get(id)};}
      else if(path==='/api/pos/sale'&&body){
        if(backend.events.has(body.request_id)){assert.equal(backend.events.get(body.request_id),JSON.stringify(body));data={sale:backend.sales.get(body.id),replayed:true};}
        else{
          let sale=backend.sales.get(body.id);
          if(body.action==='save'){const priced=posLines(body.lines,products);sale={id:body.id,revision:body.revision+1,actor:username,date:'2026-11-03',status:'draft',customer:{id:null,name:'Walk-in customer',phone:''},...priced};}
          else if(body.action==='complete'){sale={...sale,status:'paid',number:'POS-SYNTHETIC-1',revision:sale.revision+1,payment:posPayment(body.payment,sale.total)};}
          backend.events.set(body.request_id,JSON.stringify(body));backend.sales.set(body.id,sale);data={sale};
          if(body.action==='complete'&&backend.lost){backend.lost=false;throw Error('Synthetic connection lost after commit.');}
        }
      }else throw Error('Unexpected API '+path);
      return {ok:status===200,status,json:async()=>structuredClone(data)};
    }};
  vm.createContext(context);vm.runInContext(source,context);await context.ui.ready;
  return {ui:context.ui,document,events,local,session,backend};
}
const split={cash_tendered:'50',card:'30',shop2shop:'20',received:true,card_approved:true,card_reference:'SYNTHETIC-CARD',shop2shop_reference:'SYNTHETIC-S2S'};
test('POS checkout uses exact split payments, resets for the next customer and provides Home/PDF/WhatsApp',async()=>{
  const p=await page();assert.ok(p.document.querySelector('#home[href="/"]'));
  p.ui.draft.lines.P1='1';p.ui.remember();p.ui.render();await p.ui.pay();
  assert.ok(p.document.querySelector('[data-payment=card]'));assert.ok(!p.document.querySelector('[data-action=start]'));
  Object.assign(p.ui.draft.payment,split);p.ui.showPayment();await p.ui.complete();
  assert.equal(p.ui.receipt.payment.card,3000);assert.equal(p.ui.receipt.payment.cash,5000);
  assert.ok(p.document.querySelector('a[href^="/print-page?document=pos"]'));assert.ok(p.document.querySelector('[data-action=whatsapp]'));
  await p.ui.action('new');assert.equal(Object.keys(p.ui.draft.lines).length,0);assert.equal(p.ui.draft.customer.id,null);assert.equal(p.ui.draft.pending,null);
});
test('a lost completion response survives reload and retries the identical request without another payment',async()=>{
  const p=await page();p.ui.draft.lines.P1='1';await p.ui.pay();Object.assign(p.ui.draft.payment,split);p.backend.lost=true;
  await assert.rejects(p.ui.complete(),/connection lost/);const pending=structuredClone(p.ui.draft.pending);assert.equal(pending.action,'complete');
  await assert.rejects(p.ui.complete(),/needs confirmation/);
  const reopened=await page({local:p.local,session:p.session,backend:p.backend});assert.equal(reopened.ui.draft.pending.request_id,pending.request_id);assert.ok(reopened.document.querySelector('[data-action=retry]'));
  await reopened.ui.action('retry');assert.equal(reopened.ui.receipt.status,'paid');assert.equal(reopened.backend.sales.size,1);
  const completions=reopened.backend.calls.filter(c=>c.body?.action==='complete');assert.equal(completions.length,2);assert.deepEqual(completions[0].body,completions[1].body);
});
test('payment amount edits remove prior approval, and partial/declined payments stay drafts',async()=>{
  const p=await page();p.ui.draft.lines.P1='1';await p.ui.pay();Object.assign(p.ui.draft.payment,split);p.ui.showPayment();
  const input=p.document.querySelector('[data-payment=card]');input.value='40';p.events.get('input')({target:input});assert.equal(p.ui.draft.payment.card_approved,false);assert.equal(p.ui.draft.payment.received,false);
  await assert.rejects(p.ui.complete(),/Confirm/);
  Object.assign(p.ui.draft.payment,{cash_tendered:'0',card:'0',shop2shop:'0',received:true});await assert.rejects(p.ui.complete(),/full payment/);
  assert.equal(p.backend.calls.filter(c=>c.body?.action==='complete').length,0);assert.equal([...p.backend.sales.values()][0].status,'draft');
});
test('private drafts are isolated by user and denied bootstrap never displays cached data',async()=>{
  const p=await page();p.ui.draft.lines.P1='7';p.ui.remember();
  const other=await page({local:p.local,session:p.session,username:'xavier'});assert.equal(Object.keys(other.ui.draft.lines).length,0);
  const denied=await page({local:p.local,session:p.session,username:'mosa',unauthorized:true});assert.match(denied.document.querySelector('#app').textContent,/Not allowed/);assert.doesNotMatch(denied.document.querySelector('#app').textContent,/SYNTHETIC PRODUCT/);
});
test('basket replacement, decimal commas and receipt messages preserve exact quantities and payment channels',()=>{
  const draft=newDraft();draft.lines.P1='1,25';assert.equal(cartLines(draft,products)[0].qty,1250);assert.equal(cartLines(draft,products)[0].total,12500);
  assert.equal(paymentAmounts({...split,cash_tendered:'50,00'},10000).change,0);
  const message=receiptMessage({number:'POS-TEST',date:'2026-11-03',customer:{name:'Test'},lines:cartLines(draft,products),total:12500,actor:'alex',payment:{cash:5000,card:5500,shop2shop:2000}});assert.match(message,/Card \(Capitec\)/);assert.match(message,/Shop2Shop/);
});
