import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {emptyRun,summarise,validateRun,CASH_DENOMINATIONS} from '../src/domain.js';

function fixture(){
 const r=emptyRun('2026-10-12','R01',[{code:'W01',name:'Test product',active:true,available:true,price_cents:100,unit:'pack'}]);
 Object.assign(r,{rep:'Test rep',phase:'returned'});Object.assign(r.items[0],{loaded:1,returned:0});
 r.cash.counted=10000;r.cash.card=0;r.cash.eft=0;
 r.recon={date:r.date,route:r.route,complete:true,source:'Synthetic Zoho read',zoho_job_id:'synthetic-job',imported_at:'2026-10-13T16:00:00Z',invoice_lines:[{id:'i1:l1',product:'W01',qty:1,status:'paid'}],payments:[{id:'p1:i1',date:r.date,invoice_date:r.date,method:'cash',cents:10000},{id:'p2:i2',date:r.date,invoice_date:'2026-10-05',method:'shop2shop',cents:12345},{id:'p3:i1',date:r.date,invoice_date:r.date,method:'shop2shop',cents:5500}]};
 return r;
}
test('Shop2Shop fills from current and older-invoice allocations without changing saved captures or cash',()=>{
 const r=fixture(),before=structuredClone(r),s=summarise(r);
 assert.equal(s.received.shop2shop,17845);assert.equal(s.receipt_sources.shop2shop,'zoho');
 assert.equal(s.expected,10000);assert.equal(s.cashVariance,0);assert.equal(s.variances.shop2shop,null);assert.equal(s.cash_matches,false);
 assert.deepEqual(r,before);assert.throws(()=>validateRun(structuredClone(r),r,'close'),/Resolve/);
 assert.deepEqual(summarise(JSON.parse(JSON.stringify(r))),s,'Reload derives the same labelled amount');
 r.recon.payments[1].cents=20000;assert.equal(summarise(r).received.shop2shop,25500,'A refreshed snapshot updates the derived total');
});
test('manual amounts including zero take precedence; clearing restores automatic mode',()=>{
 const r=fixture();for(const value of [0,17845,19000]){r.cash.shop2shop=value;const s=summarise(r);assert.equal(s.received.shop2shop,value);assert.equal(s.receipt_sources.shop2shop,'manual');assert.equal(s.variances.shop2shop,value-17845);}
 r.cash.shop2shop=null;assert.equal(summarise(r).receipt_sources.shop2shop,'zoho');
 r.cash.shop2shop=17845;assert.equal(summarise(r).cash_matches,true,'Independent capture keeps the existing close checks');
});
test('only a complete same-route/date Zoho snapshot can autofill, and a verified zero is distinct from missing data',()=>{
 for(const mutate of [r=>r.recon=null,r=>r.recon.complete=false,r=>delete r.recon.zoho_job_id,r=>r.recon.route='R02',r=>r.recon.date='2026-10-11']){
  const r=fixture();mutate(r);assert.equal(summarise(r).received.shop2shop,null);assert.equal(summarise(r).receipt_sources.shop2shop,null);
 }
 const r=fixture();r.recon.payments=r.recon.payments.filter(p=>p.method==='cash');assert.equal(summarise(r).received.shop2shop,0);assert.equal(summarise(r).receipt_sources.shop2shop,'zoho');
 r.cash.card=null;r.cash.eft=null;const s=summarise(r);assert.equal(s.received.card,null);assert.equal(s.received.eft,null);
});
test('Cash-up and Reconcile render the amount, source, read date and unverified statement status',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),r=fixture();
 const views=source.slice(source.indexOf('function shop2shopField('),source.indexOf('function printStock('))+source.slice(source.indexOf('function reconView('),source.indexOf('function zohoReconPanel('));
 const context={state:{result:{run:r}},summarise,CASH_DENOMINATIONS,escape:String,money:v=>v==null?'—':(v/100).toFixed(2),number:String,zohoReconPanel:()=>'',appInvoiceRoute:()=>false};
 const html=runInNewContext(views+';cashView()+reconView()',context);
 assert.match(html,/readonly value="178.45"/);assert.match(html,/Volgens Zoho/);assert.match(html,/SAST/);assert.match(html,/Statement not checked/);assert.match(html,/not an independent statement match/);
 assert.match(html,/data-cash="shop2shop" value=""/,'Independent statement entry stays blank');
 r.cash.shop2shop=500;const manual=runInNewContext(views+';cashView()',context);assert.match(manual,/data-cash="shop2shop" value="5.00"/);assert.match(manual,/Handmatig ingevul/);assert.doesNotMatch(manual,/readonly value="178.45"/);
});
