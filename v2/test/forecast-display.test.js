import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {addDays} from '../src/domain.js';
import {forecast} from '../src/forecast.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const escape='),source.indexOf('const zohoReturn=')),context);
vm.runInContext(source.slice(source.indexOf('function forecastWarningText('),source.indexOf('function captureProduct(')),context);
function card(f,unit='bag: 5 x 400 g'){
 const item={name:'Test product',code:'TEST',forecast:f,unit,price_cents:8500,planned:0,loaded:11};
 const before=structuredClone(item);
 const html=context.morningProduct(item,'2026-11-09','2026-11-16-R01');
 assert.deepEqual(item,before);
 const {document}=parseHTML('<html><body>'+html+'</body></html>');
 const values=Array.from(document.querySelectorAll('.forecast-summary dd'),el=>el.textContent);
 return {values,why:document.querySelector('.forecast-why').textContent,evidence:document.querySelector('.forecast-evidence')?.textContent,details:document.querySelector('.forecast-details').textContent,document};
}

test('Chakalaka card reconciles the five figures and places the calculation in closed details',()=>{
 const f={qty:22,base:14.479,buffer:7,last_qty:12,last_returned:11,samples:11,used_samples:7,warning:'Provisional actuals: invoice reconciliation unverified.',recent_sales_minimum:15,recent_sales_buffer:3,recent_sales_uplift:0,month_cycle:{applied:true,label:'Days 15–end',factor:.947}};
 const c=card(f);
 assert.deepEqual(c.values,['15','7','22','12','11']);
 assert.equal(c.why,'Why 22 bags? 15 expected sales + 7 extra bags to avoid running short.');
 assert.equal(c.evidence,'Based on 7 similar visits. Sales not yet checked against invoices.');
 assert.match(c.document.querySelector('.forecast-meta').textContent,/TEST · 5 × 400 g · R\s?85[,.]00/);
 const panels=[...c.document.querySelectorAll('.product-disclosures > details')];
 assert.deepEqual(panels.map(el=>el.querySelector('summary').textContent),['Forecast','More details']);
 assert.ok(panels.every(el=>!el.hasAttribute('open')));
 for(const selector of ['.forecast-columns','.forecast-summary','.forecast-why','.forecast-evidence'])assert.ok(panels[0].querySelector(selector));
 assert.match(c.details,/14[,.]479/);assert.match(c.details,/Similar visits used: 7/);
 assert.match(c.details,/12 sold \+ 3 extra = 15/);assert.match(c.details,/already covers this minimum/);
 assert.match(c.details,/0[,.]947/);
});
test('the displayed whole-unit totals agree with the shipped forecast including a raised minimum',()=>{
 const target='2026-11-16';
 for(const quantities of [[10,10,10,10,30],[0],[0,1],[2,4,11,3,8],[2,5.5],[.05,7.25,2.5]]){
  const rows=quantities.map((qty,i)=>({date:addDays(target,(i-quantities.length)*7),qty,quality:'verified'}));
  const f=forecast(rows,target),c=card(f,'box: 10 packs');
  const [expected,extra,load]=c.values.map(Number);
  assert.equal(expected,Math.ceil(f.base));assert.equal(expected+extra,load);assert.equal(load,f.qty);
  if(quantities.at(-1)===30){
   assert.equal(load,35);assert.match(c.details,/30 sold \+ 5 extra = 35/);
   assert.match(c.details,/This minimum raised the suggested load/);assert.match(c.why,/Why 35 boxes/);
  }
 }
});
test('empty, sparse and old saved forecasts distinguish missing counts from zero',()=>{
 const empty=card(forecast([],'2026-11-16'));
 assert.deepEqual(empty.values,Array(5).fill('Unknown'));assert.match(empty.why,/Enter your own plan/);
 const single=card({qty:1,base:1,last_qty:1,last_returned:0,used_samples:1},'2 kg pack');
 assert.deepEqual(single.values,['1','0','1','1','0']);assert.match(single.evidence,/1 similar visit\./);assert.match(single.why,/Why 1 pack/);
 assert.doesNotMatch(single.evidence,/invoices/);
 const zero=card({qty:0,base:0,last_qty:0});
 assert.deepEqual(zero.values,['0','0','0','0','Unknown']);assert.match(zero.why,/Why 0 bags/);
 const saved=card({qty:21,last_qty:30,last_constrained:true});
 assert.equal(saved.values[2],'21');assert.match(saved.why,/breakdown was not saved/);
 assert.match(saved.details,/earlier forecast/);assert.match(saved.details,/below the last recorded sales/);
 const unknownWarning=card({qty:3,base:2,warning:'Saved note <example>'});
 assert.match(unknownWarning.details,/Saved note <example>/);assert.equal(unknownWarning.document.querySelector('example'),null);
});
