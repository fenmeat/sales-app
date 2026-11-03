import {parseAmount,parseQuantity} from './invoice-domain.js';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=value=>new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(value/100);
export const newDraft=()=>({id:crypto.randomUUID(),revision:0,lines:{},customer:{id:null,name:'Walk-in customer',phone:''},pending:null,payment:null});
export function cartLines(draft,products){return Object.entries(draft.lines).filter(([,value])=>value!==''&&parseQuantity(value)!==0).map(([code,value])=>{const qty=parseQuantity(value),product=products.find(p=>p.code===code);if(qty===null||!product)throw Error('Enter a valid quantity for every item.');return {code,qty,name:product.name,unit:product.unit,price:product.price_cents,total:Math.round(qty*product.price_cents/1000)};});}
export function paymentAmounts(fields,total){
  const cash_tendered=parseAmount(fields.cash_tendered),card=parseAmount(fields.card),shop2shop=parseAmount(fields.shop2shop);
  if([cash_tendered,card,shop2shop].some(n=>n===null))throw Error('Enter valid payment amounts.');
  if(card+shop2shop>total)throw Error('Card and Shop2Shop exceed the sale total.');
  const cash=total-card-shop2shop,short=Math.max(0,cash-cash_tendered),change=Math.max(0,cash_tendered-cash);
  return {cash_tendered,card,shop2shop,cash,short,change,received:fields.received===true,card_approved:fields.card_approved===true,card_reference:fields.card_reference??'',shop2shop_reference:fields.shop2shop_reference??''};
}
export function receiptMessage(sale){return ['FenMeat · '+sale.number,sale.customer.name,'Date: '+sale.date,...sale.lines.map(l=>`${l.name}: ${l.qty/1000} × ${money(l.price)} = ${money(l.total)}`),'Total: '+money(sale.total),'Paid in full','Cash: '+money(sale.payment.cash),'Card (Capitec): '+money(sale.payment.card),'Shop2Shop: '+money(sale.payment.shop2shop),'Served by: '+sale.actor].join('\n');}
// A separate storage key per sale avoids overwriting another tab's basket.
export function draftStore(storage,username){
  const prefix='fm-pos:draft:'+username+':';
  return {
    save(draft){storage.setItem(prefix+draft.id,JSON.stringify(draft));},
    get(id){const raw=storage.getItem(prefix+id);return raw?JSON.parse(raw):null;},
    remove(id){storage.removeItem(prefix+id);},
    list(){const values=[];for(let n=0;n<storage.length;n++){const key=storage.key(n);if(key?.startsWith(prefix)){try{values.push(JSON.parse(storage.getItem(key)));}catch{throw Error('A saved draft cannot be read. Keep this browser data and ask Alex or Alinda to check it.');}}}return values;}
  };
}
