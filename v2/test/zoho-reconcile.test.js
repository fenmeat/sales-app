import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleZohoReconciliation} from '../src/zoho-reconcile.js';
import {applyZohoMappings,zohoMatch} from '../src/zoho-matching.js';
import {emptyRun,summarise,validateCatalog} from '../src/domain.js';

const cat=()=>({revision:1,products:[{code:'W01',name:'BRAAI WORS',unit:'bag',price_cents:100,active:true,available:true,zoho_item_ids:['201'],zoho_mapping_source:'Reviewed source'}],routes:[{code:'R01',name:'GEORGE',weekday:1,zoho_salesperson_ids:['501'],zoho_mapping_source:'Reviewed source'},{code:'R02',name:'Other',weekday:1,zoho_salesperson_ids:['502'],zoho_mapping_source:'Reviewed source'}]});
const invoice=(id,date='2026-10-12',salesperson_id='501')=>({id,number:'INV-'+id,date,status:'sent',currency:'ZAR',customer_id:'600',salesperson_id,lines:[{id:'1',item_id:'201',quantity:1.2},{id:'2',item_id:'201',quantity:2.3}]});
function fixture(){const current=invoice('9001'),old=invoice('9002','2026-09-01');return {id:crypto.randomUUID(),date:'2026-10-12',route:'R01',started_at:'2026-10-13T10:00:00Z',finished_at:'2026-10-13T10:01:00Z',invoice_headers:[current],payment_headers:[{id:'8001'}],invoices:{9001:current,9002:old},payments:{8001:{id:'8001',number:'PAY-1',date:'2026-10-12',method:'Cash',amount:300,currency:'ZAR',customer_id:'600',unused_amount:0,refunded:0,bank_charges:0,invoices:[{invoice_id:'9001',applied:100,withheld:0},{invoice_id:'9002',applied:200,withheld:0}]}}};}
test('complete source uses outer quantities once and actual current/old receipts independently of invoice paid status',()=>{
 const job=fixture(),before=structuredClone(job),c=cat(),r=assembleZohoReconciliation(job,c);assert.equal(r.complete,true);assert.deepEqual(job,before);
 const run=emptyRun(job.date,job.route,c.products);run.items[0].loaded=4;run.items[0].returned=0.5;run.recon=r.recon;run.cash.counted=30000;
 const summary=summarise(run);assert.equal(summary.items[0].invoiced,3.5);assert.equal(summary.stock_matches,true);assert.equal(summary.currentCash,10000);assert.equal(summary.oldCash,20000);assert.equal(summary.expected,30000);assert.equal(summary.cashVariance,0);assert.equal(summary.cash_matches,false);assert.equal(run.cash.card,null);
});
test('mixed-route payment allocations go to each route once; draft/void invoice quantities are excluded',()=>{
 const job=fixture();job.invoices['9002'].salesperson_id='502';job.invoice_headers.push({...invoice('9003'),status:'draft'});
 let r=assembleZohoReconciliation(job,cat());assert.equal(r.complete,true);assert.equal(r.recon.payments.length,1);assert.equal(r.recon.payments[0].cents,10000);
 job.route='R02';r=assembleZohoReconciliation(job,cat());assert.equal(r.complete,true);assert.equal(r.recon.invoice_lines.length,0);assert.equal(r.recon.payments.length,1);assert.equal(r.recon.payments[0].cents,20000);
});
test('unknown route/product/method, missing details, duplicates and incomplete allocations never publish partial totals',()=>{
 const changes=[j=>j.invoices['9001'].salesperson_id='999',j=>j.invoices['9001'].lines[0].item_id='999',j=>j.payments['8001'].method='Unreviewed bank',j=>delete j.invoices['9001'],j=>j.invoices['9001'].lines[1].id='1',j=>j.payments['8001'].invoices.push(j.payments['8001'].invoices[0]),j=>j.payments['8001'].invoices.pop(),j=>j.payments['8001'].invoices=[],j=>j.payments['8001'].invoices[0].invoice_id='999',j=>j.invoices['9001'].date='2026-10-11',j=>j.invoices['9001'].status='draft'];
 for(const alter of changes){const j=fixture();alter(j);const r=assembleZohoReconciliation(j,cat());assert.equal(r.complete,false);assert.equal(r.recon,null);assert.ok(r.issues.length);}
});
test('foreign currency, refunds, unused credit, charges, withholding and mismatched receipt totals require review',()=>{
 for(const [key,value] of [['currency','USD'],['date','2026-10-11'],['status','void'],['amount',299.99],['unused_amount',1],['refunded',1],['bank_charges',1]]){const j=fixture();j.payments['8001'][key]=value;assert.equal(assembleZohoReconciliation(j,cat()).complete,false,key);}
 const j=fixture();j.payments['8001'].invoices[0].withheld=1;assert.equal(assembleZohoReconciliation(j,cat()).complete,false);
 j.payments['8001'].invoices[0].withheld=0;j.payments['8001'].customer_id='777';assert.equal(assembleZohoReconciliation(j,cat()).complete,false);
});
test('reviewed stable-ID mappings retain pilot matches and source evidence; duplicate IDs and name-only guesses are refused',()=>{
 const c=cat();delete c.products[0].zoho_item_ids;delete c.products[0].zoho_mapping_source;
 const changed=applyZohoMappings(c,{entries:[{kind:'product',id:'999',code:'W01'},{kind:'method',id:'POS receipt',code:'card'}],route:'R01'});
 assert.deepEqual(changed.products[0].zoho_item_ids,['5173603000000845465','999']);assert.equal(zohoMatch(changed,'product','999').code,'W01');assert.equal(zohoMatch(c,'product','999'),null);
 assert.equal(changed.routes[0].zoho_payment_methods['POS receipt'],'card');assert.ok(changed.products[0].zoho_mapping_source.includes('Owner-reviewed'));assert.equal(c.routes[0].zoho_payment_methods,undefined);
 const duplicate=cat();duplicate.routes[1].zoho_salesperson_ids=['501'];assert.throws(()=>validateCatalog(duplicate),/only one/);
 assert.throws(()=>applyZohoMappings(c,{entries:[{kind:'product',id:'BRAAI WORS',code:'W01'}]}),/real Zoho/);
 const j=fixture();j.payments['8001'].method='POS receipt';assert.equal(assembleZohoReconciliation(j,{...cat(),routes:changed.routes}).complete,true);
});
