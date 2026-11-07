import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {PDFDocument} from 'pdf-lib';
import {posReceiptPDF} from '../src/pos-pdf.js';
import {receiptMessage} from '../public/pos-model.js';

function fixture(payment,actor='alex'){
  return {number:'POS-SYNTHETIC-1',actor,date:'2026-11-03',captured_at:'2026-11-03T14:15:49.000Z',customer:{name:'Walk-in customer',phone:''},lines:[{name:'SYNTHETIC PRODUCT',unit:'bag: 10 x 409 g',qty:1000,price:16000,total:16000}],total:16000,payment:{cash:0,cash_tendered:0,change:0,card:0,shop2shop:0,...payment}};
}
function pageText(pdf){return pdf.getPages().map(page=>page.node.Contents().asArray().map(ref=>{
  const stream=inflateSync(pdf.context.lookup(ref).getContents()).toString();
  return [...stream.matchAll(/<([A-Fa-f0-9]+)> Tj/g)].map(m=>Buffer.from(m[1],'hex').toString('latin1')).join(' ');
}).join(' '));}
test('receipt PDF and WhatsApp preserve the sale while displaying only used payments and proper cashier names',async()=>{
  const variants=[
    {actor:'alex',name:'Alex',payment:{cash:16000,cash_tendered:20000,change:4000},shown:['Cash','Cash tendered','Change'],hidden:['Card (Capitec)','Shop2Shop']},
    {actor:'alinda',name:'Alinda',payment:{card:16000,card_reference:'SYNTHETIC-CARD'},shown:['Card (Capitec)'],hidden:['Cash','Change','Shop2Shop']},
    {actor:'xalinda',name:'Xalinda',payment:{shop2shop:16000,shop2shop_reference:'SYNTHETIC-S2S'},shown:['Shop2Shop'],hidden:['Cash','Change','Card (Capitec)']},
    {actor:'xavier',name:'Xavier',payment:{cash:6000,cash_tendered:10000,change:4000,card:5000,shop2shop:5000},shown:['Cash','Card (Capitec)','Shop2Shop','Change'],hidden:[]}
  ];
  for(const variant of variants){
    const sale=fixture(variant.payment,variant.actor),before=structuredClone(sale),pdf=await PDFDocument.load(await posReceiptPDF(sale));
    assert.equal(pdf.getPageCount(),1);const text=pageText(pdf).join(' '),message=receiptMessage(sale);
    assert.match(text,/SALES RECEIPT/);assert.match(text,/FOURFORONE/);assert.ok(text.includes(variant.name));assert.ok(message.includes('Served by: '+variant.name));
    assert.ok(pdf.getPage(0).node.Resources().toString().includes('/XObject'),'original logo is embedded');
    for(const label of variant.shown){assert.ok(text.includes(label),label);assert.ok(message.includes(label),label);}
    for(const label of variant.hidden){assert.ok(!text.includes(label),label);assert.ok(!message.includes(label),label);}
    assert.match(text,/03 Nov 2026  16:15:49/);assert.match(text,/160[.,]00/);assert.deepEqual(sale,before);
  }
});
test('long receipts retain every line, repeat table headings, and keep payment summary on the final page',async()=>{
  const sale=fixture({card:16000,card_reference:'SYNTHETIC-'+('X'.repeat(90))});
  sale.customer={name:'SYNTHETIC CUSTOMER '+('long customer name '.repeat(7)),phone:'+27821234567'};
  sale.lines=Array.from({length:34},(_,i)=>({name:'ITEM-'+String(i).padStart(3,'0')+' '+('LONG DESCRIPTION '.repeat(4)),unit:'bag: 10 x 409 g',qty:100000000,price:100000000,total:100000000}));
  const before=structuredClone(sale),pdf=await PDFDocument.load(await posReceiptPDF(sale)),pages=pageText(pdf),all=pages.join(' ');
  assert.ok(pages.length>1);assert.ok(pages.length<10);
  for(let i=0;i<sale.lines.length;i++)assert.equal(all.split('ITEM-'+String(i).padStart(3,'0')).length-1,1);
  for(const [i,text] of pages.entries()){
    assert.match(text,/POS-SYNTHETIC-1/);assert.ok(text.includes('PAGE '+(i+1)+' OF '+pages.length));
    if(text.includes('ITEM-'))assert.match(text,/ITEM \/ SALES UNIT/);
  }
  assert.equal(all.split('TOTAL PAID').length-1,1);assert.match(pages.at(-1),/TOTAL PAID/);assert.deepEqual(sale,before);
});
