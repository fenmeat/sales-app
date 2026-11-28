import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {inflateSync} from 'node:zlib';
import {parseHTML} from 'linkedom';
import {shopDeliveryRows,compareShopDeliveries,validateShopDeliveries,emptyRun,validateRun} from '../src/domain.js';
import {shopListPDF} from '../src/shop-list-pdf.js';
import {deliveryCount,shopDeliveryView,updateShopDeliveryView} from '../public/shop-deliveries.js';
import {browserPrintURL,printPageOptions} from '../public/print-page-options.js';
const stores=[{id:'1001',name:'Same shop name',stop:1},{id:'1002',name:'Same shop name',stop:2},{id:'1003',name:'No count yet',stop:3}];
function fixture(){return {date:'2026-11-04',route:'R01',shop_deliveries:shopDeliveryRows(stores),recon:{complete:true,date:'2026-11-04',route:'R01',invoice_lines:[{id:'a',invoice_id:'1',customer_id:'1001',product:'R01',qty:3,status:'sent'},{id:'b',invoice_id:'1',customer_id:'1001',product:'P04',qty:1,status:'sent'},{id:'c',customer_id:'1002',qty:8,status:'void'},{id:'d',customer_id:'1002',qty:5,status:'draft'}]}};}
test('independent counts compare quantity sums by identity, excluding drafts and voids',()=>{
 const run=fixture();run.shop_deliveries[0].delivered=6;run.shop_deliveries[1].delivered=0;const before=structuredClone(run),c=compareShopDeliveries(run);
 assert.deepEqual(c.rows.map(s=>[s.invoiced,s.delivered,s.difference]),[[4,6,2],[0,0,0],[0,null,null]]);
 assert.equal(c.counted,2);assert.equal(c.entered_total,6);assert.equal(c.differences,1);assert.deepEqual(run,before);
 run.recon.invoice_lines[0].qty=5;assert.equal(compareShopDeliveries(run).rows[0].difference,0);assert.equal(run.shop_deliveries[0].delivered,6);
});
test('missing identities are unknown and invoiced shops outside the list remain visible',()=>{
 const run=fixture();run.recon.invoice_lines.push({id:'x',customer_id:'9999',customer_name:'Unlisted',qty:2,status:'paid'});assert.equal(compareShopDeliveries(run).rows.at(-1).not_on_list,true);
 delete run.recon.invoice_lines[0].customer_id;assert.equal(compareShopDeliveries(run).identified,false);assert.ok(compareShopDeliveries(run).rows.every(s=>s.invoiced===null));
 run.recon.date='2026-11-03';assert.equal(compareShopDeliveries(run).invoiced_total,null);
});
test('saved shop identity, order and counts survive older clients; invalid counts are rejected',()=>{
 const run=fixture();run.shop_deliveries[0].delivered=6;const old=structuredClone(run);delete run.shop_deliveries;validateShopDeliveries(run,old,stores);assert.deepEqual(run.shop_deliveries,old.shop_deliveries);
 for(const value of [-1,1.5,NaN,Infinity,'2',100001]){const next=structuredClone(old);next.shop_deliveries[0].delivered=value;assert.throws(()=>validateShopDeliveries(next,old,stores),/whole number/);}
 const changed=structuredClone(old);changed.shop_deliveries[0].customer_id='1009';assert.throws(()=>validateShopDeliveries(changed,old,stores),/identities/);
 assert.throws(()=>validateShopDeliveries({...old,shop_deliveries:[]},old,stores));
});
test('matched product totals cannot close a route with a recorded shop delivery difference',()=>{
 const p={code:'R01',name:'Product',unit:'bag',price_cents:1000,active:true,available:true};
 const run=emptyRun('2026-11-04','R01',[p]);run.items[0].loaded=4;run.items[0].returned=0;run.cash={...run.cash,counted:0,shop2shop:0,card:0,eft:0};run.phase='returned';run.shop_deliveries=shopDeliveryRows(stores);run.shop_deliveries[0].delivered=6;run.recon={...fixture().recon,payments:[],source:'Synthetic complete ledger',invoice_lines:[{id:'a',customer_id:'1001',product:'R01',qty:4,status:'sent'}]};
 assert.throws(()=>validateRun(structuredClone(run),run,'close'),/delivery differences/);
 run.shop_deliveries[0].delivered=4;assert.equal(validateRun(structuredClone(run),run,'close').phase,'closed');
});
test('entry and compact reconciliation view keep zero separate from blank and update the difference',()=>{
 assert.equal(deliveryCount(''),null);assert.equal(deliveryCount('0'),0);assert.equal(deliveryCount('6'),6);for(const v of ['-1','1.2','1e2','100001'])assert.ok(Number.isNaN(deliveryCount(v)));
 const run=fixture(),{document}=parseHTML(shopDeliveryView(run));assert.equal(document.querySelector('[data-delivery="1001"]').getAttribute('value'),'');
 run.shop_deliveries[0].delivered=6;updateShopDeliveryView(document,run);assert.equal(document.querySelector('[data-delivery-diff="1001"]').textContent,'2');assert.match(document.querySelector('#shop-delivery-summary').textContent,/1 \/ 3/);
 run.phase='closed';const closed=parseHTML(shopDeliveryView(run)).document;assert.ok(closed.querySelector('[data-delivery]').hasAttribute('disabled'));
});
test('Shop List handoff is allowlisted and carries only route/date selectors',()=>{
 const link=browserPrintURL('/api/invoicing/shop-list/pdf?date=2026-11-04&route=R01&key=DO-NOT-COPY'),opts=printPageOptions(link.split('?')[1]);
 assert.equal(opts.url,'/api/invoicing/shop-list/pdf?date=2026-11-04&route=R01');assert.equal(opts.fitPage,true);assert.doesNotMatch(link,/key|DO-NOT-COPY/);
 assert.equal(printPageOptions('document=shops&date=2026-11-04&route=R01&from=invoicing').returnPath,'/invoicing/');
 for(const route of ['R12','<script>',''])assert.throws(()=>printPageOptions('document=shops&date=2026-11-04&route='+route));
});
function pdfText(pdf){return pdf.getPages().flatMap(p=>p.node.Contents().asArray().flatMap(ref=>[...inflateSync(pdf.context.lookup(ref).getContents()).toString().matchAll(/<([a-f0-9]+)> Tj/gi)].map(m=>Buffer.from(m[1],'hex').toString('latin1')))).join(' ');}
test('one A4 page contains every shop, including repeated names, with blank counts',async()=>{
 for(const n of [1,26,99,107,120,250]){
  const rows=Array.from({length:n},(_,i)=>({id:String(10000+i),stop:i+1,name:'SHOP-'+String(i+1).padStart(3,'0')+(n<=120?' LONG DISPLAY NAME':''),delivered:98765}));
  const before=structuredClone(rows),pdf=await PDFDocument.load(await shopListPDF({date:'2026-11-04',route:'R01',route_name:'GEORGE',catalog_revision:35,rows}));
  assert.equal(pdf.getPageCount(),1,'count '+n);assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<.1);const text=pdfText(pdf);
  for(let i=1;i<=n;i++)assert.equal(text.split('SHOP-'+String(i).padStart(3,'0')).length-1,1,'shop '+i+' of '+n);
  assert.doesNotMatch(text,/98765/);assert.deepEqual(rows,before);
 }
});
