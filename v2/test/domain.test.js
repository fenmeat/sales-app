import test from 'node:test';import assert from 'node:assert/strict';
import {emptyRun,summarise,validateRun,validateRecon,CASH_DENOMINATIONS,cashCountTotal,captureItems} from '../src/domain.js';import {forecast} from '../src/forecast.js';
const product={code:'W01',name:'Braai wors',unit:'bag',price_cents:16000,available:true,active:true};
function run(){const r=emptyRun('2026-09-30','R07',[product]);r.rep='Alex';r.items[0].loaded=20;r.items[0].returned=2;r.items[0].planned=22;return r;}
function recon(r){return {date:r.date,route:r.route,complete:true,source:'test',invoice_lines:[{id:'INV1:1',product:'W01',qty:18,status:'sent'}],payments:[{id:'PAY1:1',date:r.date,invoice_date:r.date,method:'cash',cents:1000000},{id:'PAY2:1',date:r.date,invoice_date:'2026-09-23',method:'cash',cents:2000000}]};}
test('20 loaded less 2 returned means 18 sales; plan does not alter sales',()=>{let r=run();assert.equal(summarise(r).items[0].sold,18);r.items[0].planned=200;assert.equal(summarise(r).items[0].sold,18);});
test('missing returns and missing invoice extract remain unknown',()=>{let r=run();r.items[0].returned=null;const s=summarise(r);assert.equal(s.items[0].sold,null);assert.equal(s.items[0].invoiced,null);assert.equal(s.expected,null);assert.equal(s.cash_matches,false);});
test('10000 current cash plus 20000 collected credit equals 30000, once',()=>{const r=run();r.recon=recon(r);r.cash.counted=3000000;const s=summarise(r);assert.equal(s.currentCash,1000000);assert.equal(s.oldCash,2000000);assert.equal(s.expected,3000000);assert.equal(s.cashVariance,0);});
test('float, deposit and expenses are separately accounted for',()=>{const r=run();r.recon=recon(r);Object.assign(r.cash,{float:100000,banked:200000,expenses:5000,extra:2000,counted:2897000});assert.equal(summarise(r).cashVariance,0);});
test('draft and void invoices cannot hide missing stock',()=>{const r=run();r.recon=recon(r);r.recon.invoice_lines.push({id:'INV2:1',product:'W01',qty:20,status:'draft'});assert.equal(summarise(r).items[0].invoiced,18);r.recon.invoice_lines[0].qty=17;assert.equal(summarise(r).items[0].variance,1);});
test('invoice-only products appear as discrepancies',()=>{const r=run();r.recon=recon(r);r.recon.invoice_lines.push({id:'INV2:1',product:'R01',qty:4,status:'paid'});assert.equal(summarise(r).items[1].variance,-4);});
test('cash shortage and card surplus cannot cancel out',()=>{const r=run();r.recon=recon(r);Object.assign(r.cash,{counted:2990000,card:10000,shop2shop:0,eft:0});assert.equal(summarise(r).cash_matches,false);});
test('non-sale stock requires a reason and reduces stock sales',()=>{const r=run();r.items[0].adjustment=1;assert.throws(()=>validateRun(r,null,'load'),/Explain/);r.items[0].adjustment_reason='Damaged pack';assert.equal(summarise(r).items[0].sold,17);});
test('returns larger than load rejected; zero override retained',()=>{const r=run();r.items[0].planned=0;r.items[0].returned=21;assert.throws(()=>validateRun(r,null,'load'),/cannot exceed/);r.items[0].returned=0;validateRun(r,null,'load');assert.equal(r.items[0].planned,0);});
test('cannot close without complete independent reconciliation',()=>{const r=run();assert.throws(()=>validateRun(r,{...r,phase:'returned'},'close'),/Resolve/);r.recon=recon(r);Object.assign(r.cash,{counted:3000000,card:0,shop2shop:0,eft:0});assert.equal(validateRun(r,{...r,phase:'returned'},'close').phase,'closed');});
test('duplicate payment allocations and wrong payment dates rejected',()=>{const r=run();let c=recon(r);c.payments.push(c.payments[0]);assert.throws(()=>validateRecon(c,r),/unique/);c=recon(r);c.payments[0].date='2026-09-29';assert.throws(()=>validateRecon(c,r),/Payment date/);});
test('forecast does not use future data, other weekdays, missing dates or quarantined records',()=>{const rows=[{date:'2026-09-23',qty:10,quality:'verified'},{date:'2026-09-24',qty:1000,quality:'verified'},{date:'2026-10-07',qty:1000,quality:'verified'},{date:'2026-09-16',qty:500,quality:'quarantined'}];const f=forecast(rows,'2026-09-30');assert.equal(f.base,10);assert.equal(f.samples,1);assert.equal(f.qty,13);assert.equal(forecast([],'2026-09-30').qty,null);});
test('explicit zero demand is different from no observation',()=>{const f=forecast([{date:'2026-09-23',qty:0,quality:'verified'}],'2026-09-30');assert.equal(f.qty,0);});
test('provisional and constrained observations disclose their limitations',()=>{const f=forecast([{date:'2026-09-23',qty:10,quality:'provisional',constrained:true}],'2026-09-30');assert.match(f.warning,/unverified/);assert.match(f.warning,/stockouts/);});

const counts=()=>Object.fromEntries(CASH_DENOMINATIONS.map(d=>[d,null]));
test('denominations use exact cents, distinguish uncounted and zero, reject fractions',()=>{
 const c=counts();assert.equal(cashCountTotal(c),null);c[20000]=0;assert.equal(cashCountTotal(c),0);
 Object.assign(c,{20000:2,10000:3,5000:1,2000:2,1000:1,500:3,200:4,100:2,50:3});
 assert.equal(cashCountTotal(c),82650);
 c[50]=0.5;assert.throws(()=>cashCountTotal(c),/whole numbers/);c[50]=-1;assert.throws(()=>cashCountTotal(c),/whole numbers/);
 c[50]=null;delete c[100];assert.throws(()=>cashCountTotal(c),/denominations/);
});
test('saved total is derived from counts, including zero and cash from older invoices',()=>{
 const r=run();r.recon=recon(r);r.cash.denominations=counts();r.cash.denominations[20000]=150;r.cash.counted=1;
 validateRun(r,null,'load');assert.equal(r.cash.counted,3000000);assert.equal(summarise(r).cashVariance,0);
 r.cash.denominations[20000]=149;assert.equal(summarise(r).cashVariance,-20000);
});
test('unavailable products are hidden from loading but loaded ones remain for returns',()=>{
 const r=run();r.items[0].available=false;assert.equal(captureItems(r,false).length,0);assert.equal(captureItems(r,true).length,1);
 r.items.push({...r.items[0],code:'X',loaded:null,returned:null});r.items[0].returned=0;
 validateRun(r,null,'load');assert.equal(r.items[1].loaded,0);assert.equal(r.items[1].returned,0);
 assert.equal(captureItems(r,true).length,1);
 const current=[{...product,available:false}];r.items[0].available=true;assert.equal(captureItems(r,false,current).length,0);
});
test('removed adjustments cannot be newly entered and historical amounts remain intact',()=>{
 const r=run();r.items[0].adjustment=1;r.items[0].adjustment_reason='Old damage';
 assert.throws(()=>validateRun(structuredClone(r),null,'load'),/no longer supported/);
 r.cash.float=10000;r.cash.banked=2000;r.cash.adjustment_reason='Old bank deposit';
 const previous=structuredClone(r);previous.phase='loaded';validateRun(r,previous,'save');
 assert.equal(summarise(r).items[0].sold,17);assert.equal(r.cash.float,10000);
});
