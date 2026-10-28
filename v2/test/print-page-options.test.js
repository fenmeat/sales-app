import test from 'node:test';
import assert from 'node:assert/strict';
import {browserPrintURL,printPageOptions,usesAppleHomeScreen} from '../public/print-page-options.js';

test('browser print links retain the document date, route and saved revision without credentials',()=>{
 for(const kind of ['production','stock']){
  const pdf='/api/print/'+kind+'?date=2026-10-28'+(kind==='stock'?'&route=R03':'');
  const link=browserPrintURL(pdf,{revision:'7',unsaved:true}),options=printPageOptions(link.split('?')[1]);
  assert.equal(options.url,pdf+'&revision=7');assert.equal(options.unsaved,true);
  assert.equal(options.returnPath,kind==='production'?'/production':'/');
  assert.match(options.filename,/2026-10-28/);assert.match(link,/^\/print-page\?/);
 }
});
test('browser print page rejects arbitrary endpoints and malformed document selectors',()=>{
 assert.doesNotMatch(browserPrintURL('/api/print/production?date=2026-10-28&key=DO-NOT-COPY&token=DO-NOT-COPY'),/key|token|DO-NOT-COPY/);
 for(const url of ['https://external.example/private.pdf','/api/staff','/private.pdf'])assert.throws(()=>browserPrintURL(url));
 for(const search of ['','document=staff&date=2026-10-28','document=stock&date=2026-10-28','document=production&date=bad','document=stock&date=2026-10-28&route=%3Cscript%3E','document=production&date=2026-10-28&revision=0','document=production&date=2026-10-28&revision=1e2'])assert.throws(()=>printPageOptions(search));
});
test('only Apple Home Screen apps select browser handoff, including desktop-mode iPads',()=>{
 assert.equal(usesAppleHomeScreen({userAgent:'iPhone',standalone:true}),true);
 assert.equal(usesAppleHomeScreen({platform:'MacIntel',maxTouchPoints:5},()=>({matches:true})),true);
 assert.equal(usesAppleHomeScreen({userAgent:'iPhone',standalone:false},()=>({matches:false})),false);
 assert.equal(usesAppleHomeScreen({platform:'MacIntel',maxTouchPoints:0,standalone:true}),false);
 assert.equal(usesAppleHomeScreen({userAgent:'Android',standalone:true}),false);
});
