import test from 'node:test';
import assert from 'node:assert/strict';
import {browserPrintURL,printPageOptions,usesAppleHomeScreen} from '../public/print-page-options.js';

test('browser print links retain the document date, route and saved revision without credentials',()=>{
 for(const kind of ['production','stock']){
  const pdf='/api/print/'+kind+'?date=2026-10-28'+(kind==='stock'?'&route=R03':'');
  const link=browserPrintURL(pdf,{revision:'7',unsaved:true}),options=printPageOptions(link.split('?')[1]);
  assert.equal(options.url,pdf+'&revision=7');assert.equal(options.unsaved,true);
  assert.equal(options.returnPath,kind==='production'?'/production':'/');
  assert.equal(options.fitPage,false);
  assert.match(options.filename,/2026-10-28/);assert.match(link,/^\/print-page\?/);
 }
});
test('browser print page rejects arbitrary endpoints and malformed document selectors',()=>{
 assert.doesNotMatch(browserPrintURL('/api/print/production?date=2026-10-28&key=DO-NOT-COPY&token=DO-NOT-COPY'),/key|token|DO-NOT-COPY/);
 for(const url of ['https://external.example/private.pdf','/api/staff','/private.pdf'])assert.throws(()=>browserPrintURL(url));
 for(const search of ['','document=staff&date=2026-10-28','document=stock&date=2026-10-28','document=production&date=bad','document=stock&date=2026-10-28&route=%3Cscript%3E','document=production&date=2026-10-28&revision=0','document=production&date=2026-10-28&revision=1e2'])assert.throws(()=>printPageOptions(search));
});
test('stocktake browser handoff roundtrips supplier keys, dates and saved revisions',()=>{
 for(const [supplier,slug] of [['margot swiss','margot-swiss'],["brito's",'brito-s'],['hartman & seuns','hartman-seuns']]){
  const query=new URLSearchParams({date:'2026-10-27',supplier,revision:'76'});
  const link=browserPrintURL('/api/print/stocktake?'+query+'&key=DO-NOT-COPY&token=DO-NOT-COPY',{unsaved:true});
  const selectors=new URLSearchParams(link.split('?')[1]),options=printPageOptions(selectors);
  assert.equal(selectors.get('supplier'),supplier);
  assert.equal(selectors.get('revision'),'76');
  assert.equal(options.url,'/api/print/stocktake?'+query);
  assert.equal(options.title,'Stocktake Summary');
  assert.equal(options.filename,'FenMeat-Stocktake-'+slug+'-2026-10-27.pdf');
  assert.equal(options.returnPath,'/recipes?view=stock');
  assert.equal(options.fitPage,true);
  assert.equal(options.unsaved,true);
  assert.doesNotMatch(link,/key|token|DO-NOT-COPY/);
 }
 const pinned=browserPrintURL('/api/print/stocktake?date=2026-10-27&supplier=crown&revision=75',{revision:76});
 assert.equal(printPageOptions(pinned.split('?')[1]).url,'/api/print/stocktake?date=2026-10-27&supplier=crown&revision=76');
 assert.equal(printPageOptions(pinned.split('?')[1]).unsaved,false);
});
test('stocktake handoff distinguishes an explicit unassigned supplier from missing or invalid selectors',()=>{
 const link=browserPrintURL('/api/print/stocktake?date=2026-10-27&supplier=&revision=76');
 const options=printPageOptions(link.split('?')[1]);
 assert.equal(options.url,'/api/print/stocktake?date=2026-10-27&supplier=&revision=76');
 assert.equal(options.filename,'FenMeat-Stocktake-unassigned-2026-10-27.pdf');
 assert.equal(options.returnPath,'/recipes?view=stock');
 for(const supplier of [null,'Margot Swiss',' margot swiss','margot  swiss','margot\nswiss','<script>','../private','a'.repeat(151)]){
  const query=new URLSearchParams({document:'stocktake',date:'2026-10-27'});if(supplier!==null)query.set('supplier',supplier);
  assert.throws(()=>printPageOptions(query),/supplier/);
  assert.throws(()=>browserPrintURL('/api/print/stocktake?'+query),/supplier/);
 }
 for(const revision of ['0','-1','1e2','9007199254740992']){
  const query=new URLSearchParams({document:'stocktake',date:'2026-10-27',supplier:'margot swiss',revision});
  assert.throws(()=>printPageOptions(query),/revision/);
 }
});
test('only Apple Home Screen apps select browser handoff, including desktop-mode iPads',()=>{
 assert.equal(usesAppleHomeScreen({userAgent:'iPhone',standalone:true}),true);
 assert.equal(usesAppleHomeScreen({platform:'MacIntel',maxTouchPoints:5},()=>({matches:true})),true);
 assert.equal(usesAppleHomeScreen({userAgent:'iPhone',standalone:false},()=>({matches:false})),false);
 assert.equal(usesAppleHomeScreen({platform:'MacIntel',maxTouchPoints:0,standalone:true}),false);
 assert.equal(usesAppleHomeScreen({userAgent:'Android',standalone:true}),false);
});
