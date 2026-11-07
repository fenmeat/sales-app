import test from 'node:test';
import assert from 'node:assert/strict';
import {matchZohoInvoice} from '../src/zoho-matching.js';
import {checkInvoicePage} from '../public/zoho-page-check.js';

const catalog={products:[['W01','BRAAI WORS'],['W02','OUMA'],['W03','CHAKALAKA'],['S01','SIX GUN 20g'],['S02','SIX GUN 200g']].map(([code,name])=>({code,name})),routes:[{code:'R07',name:'MOSSEL BAY'}]};
const invoice=()=>({id:'9001',date:'2026-10-01',status:'sent',currency:'ZAR',salesperson_id:'5173603000000932936',salesperson:'07. THURSDAY MOSSEL BAY',lines:[
 ['5173603000000845465',1],['5173603000000845476',1],['5173603000000845487',1],['5173603000000845476',1],['5173603000000845751',1],['5173603000000845762',5]
].map(([item_id,quantity],i)=>({id:String(100+i),item_id,quantity,name:'Sorting prefix or renamed product',unit:''}))});

test('confirmed FEN IDs match 1:1 and separate Ouma lines total two outer bags, not ten inner packs',()=>{
 const input=invoice(),before=structuredClone(input),result=matchZohoInvoice(input,catalog);
 assert.equal(result.all_matched,true);assert.deepEqual(result.route,{code:'R07',name:'MOSSEL BAY'});
 assert.deepEqual(result.quantities.map(p=>[p.code,p.quantity]),[['W01',1],['W02',2],['W03',1],['S01',1],['S02',5]]);
 assert.ok(result.lines.every(l=>l.quantity_factor===1));assert.deepEqual(input,before);
});
test('matching never guesses from a name, SKU, customer, date or sort prefix',()=>{
 const input=invoice();input.lines[0]={...input.lines[0],item_id:'999',name:'01. BRAAI WORS',sku:'W01'};
 input.salesperson_id='999';input.customer='MOSSEL BAY 001';
 const result=matchZohoInvoice(input,catalog);
 assert.equal(result.all_matched,false);assert.equal(result.lines[0].product_code,null);assert.equal(result.route,null);
 assert.ok(!result.quantities.some(p=>p.code==='W01'));
 const absent=matchZohoInvoice(invoice(),{products:[],routes:[]});assert.equal(absent.all_matched,false);assert.deepEqual(absent.quantities,[]);
});
test('incomplete quantities, duplicate lines, unknown statuses and non-ZAR invoices cannot pass matching',()=>{
 for(const quantity of [null,-1,NaN,0.0001,100001]){const input=invoice();input.lines[1].quantity=quantity;const result=matchZohoInvoice(input,catalog);assert.equal(result.all_matched,false);assert.equal(result.quantities.find(p=>p.code==='W02').quantity,null);}
 const duplicate=invoice();duplicate.lines[3].id=duplicate.lines[1].id;assert.equal(matchZohoInvoice(duplicate,catalog).all_matched,false);
 const input=invoice();input.lines[1].quantity=0.1;input.lines[3].quantity=0.2;assert.equal(matchZohoInvoice(input,catalog).quantities.find(p=>p.code==='W02').quantity,0.3);
 for(const status of ['draft','void'])assert.equal(matchZohoInvoice({...invoice(),status},catalog).excluded,true);
 assert.equal(matchZohoInvoice({...invoice(),status:'unknown'},catalog).all_matched,false);
 assert.equal(matchZohoInvoice({...invoice(),currency:'USD'},catalog).all_matched,false);
});

const page=()=>({preview:true,organisation:{id:'852102281',name:'FEN'},date:'2026-10-01',page:1,has_more:true,invoices:[{id:'9001'},{id:'9002'}]});
const detail=id=>({preview:true,organisation:{id:'852102281'},invoice:{...invoice(),id}});
test('page check reads serially, spaces requests and labels a checked page without claiming the day is complete',async()=>{
 const order=[],input=page(),before=structuredClone(input);
 const report=await checkInvoicePage(input,async id=>{order.push(id);return detail(id);},{wait:async ms=>order.push(ms)});
 assert.deepEqual(order,[1200,'9001',1200,'9002']);assert.equal(report.page_checked,true);assert.equal(report.has_more_pages,true);
 assert.equal(report.complete,undefined);assert.equal(report.scope,'invoice_page_product_check');assert.equal(report.invoices.length,2);assert.deepEqual(input,before);
});
test('a failed or wrong invoice yields a clearly partial report; duplicate page IDs and cancellation are handled',async()=>{
 const report=await checkInvoicePage(page(),async id=>{if(id==='9002')throw Error('Zoho request limit reached.');return detail(id);},{wait:async()=>{}});
 assert.equal(report.page_checked,false);assert.equal(report.invoices.length,1);assert.match(report.error,/limit/);
 for(const altered of [{...detail('999')},{...detail('9001'),organisation:{id:'804365236'}},{...detail('9001'),invoice:{...invoice(),date:'2026-09-30'}}]){
  const wrong=await checkInvoicePage(page(),async()=>altered,{wait:async()=>{}});assert.equal(wrong.page_checked,false);assert.equal(wrong.invoices.length,0);
 }
 const duplicate=page();duplicate.invoices.push({id:'9001'});await assert.rejects(checkInvoicePage(duplicate,async()=>{throw Error('Must not read');}),/fresh/);
 let stopped=false,reads=0;
 const cancelled=await checkInvoicePage(page(),async()=>{reads++;return detail('9001');},{wait:async()=>{stopped=true;},shouldStop:()=>stopped});
 assert.equal(reads,0);assert.equal(cancelled.page_checked,false);assert.match(cancelled.error,/stopped/);
});
