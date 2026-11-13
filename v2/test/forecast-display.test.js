import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context={number:x=>String(x),escape:x=>String(x),state:{result:{}}};vm.createContext(context);
for(const name of ['forecastSummary','forecastDetails','forecastWarnings']){const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end),context);}
test('visible expected sales and one safety total reconcile to the final suggestion',()=>{
 for(const [base,qty,expected,safety] of [[24.423,34,25,9],[10.5,27,11,16],[0,0,0,0]]){
  const item={forecast:{base,qty,last_qty:22,last_returned:14}},before=structuredClone(item),html=context.forecastSummary(item);
  assert.match(html,new RegExp('Expected sales</dt><dd>'+expected));assert.match(html,new RegExp('Safety stock</dt><dd>'+safety));assert.equal((html.match(/Safety stock/g)||[]).length,1);assert.equal(expected+safety,qty);assert.deepEqual(item,before);
 }
});
test('last returns preserve unknown versus an explicit zero and unavailable history is not a zero suggestion',()=>{
 assert.match(context.forecastSummary({forecast:{base:10,qty:13,last_returned:null}}),/Last visit returned<\/dt><dd>Unknown/);
 assert.match(context.forecastSummary({forecast:{base:10,qty:13,last_returned:0}}),/Last visit returned<\/dt><dd>0/);
 assert.match(context.forecastSummary({forecast:{qty:null,base:null}}),/Sales history unavailable/);
});
test('minimum rule explains an uplift without showing a second reserve on the main card',()=>{
 const item={forecast:{samples:8,base:10.5,qty:27,last_qty:23,recent_sales_buffer:4,recent_sales_minimum:27,recent_sales_uplift:13}};
 assert.match(context.forecastWarnings(item),/Minimum load rule applied/);assert.doesNotMatch(context.forecastWarnings(item),/4|27/);
 assert.match(context.forecastDetails(item),/This minimum raised the suggestion/);assert.match(context.forecastDetails(item),/never added together/);
});
