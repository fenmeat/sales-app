import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {hash,appNavigation} from '../src/auth.js';
import {accountSummary,recordSummary,toCents,validateFinancialRecord} from '../src/finance-domain.js';
import {deriveFinanceImport} from '../src/finance-import.js';
import {printPageOptions} from '../public/print-page-options.js';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],target:'es2022'});
async function fixture(t){
 const names=['alex','alinda','xavier','xalinda','tapiz','mosa','other'],keys=Object.fromEntries(names.map(n=>[n,'SYNTHETIC-finance-'+n+'-012345678901234567890123456789']));
 const mf=new Miniflare(convertV4MiniflareOptions({name:'finance-isolated-tests',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'finance-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify(keys)},outboundService:()=>{throw Error('No external calls in financial tests.');}}));t.after(()=>mf.dispose());
 const origin='https://finance-test.example',cookies={};
 async function call(path,body,user='alex',extra={}){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookies[user]??'',...extra},body:body?JSON.stringify(body):undefined});const data=r.headers.get('content-type')?.includes('application/pdf')?new Uint8Array(await r.arrayBuffer()):await r.json();return {status:r.status,data,headers:r.headers};}
 for(const username of names){const r=await call('/api/login',{username,key:keys[username]});assert.equal(r.status,200);cookies[username]=r.headers.get('set-cookie').split(';')[0];}
 const body=(type,data,id=crypto.randomUUID(),revision=0)=>({request_id:crypto.randomUUID(),revision,reason:'Synthetic test record',record:{id,type,data:{links:[],...data}}});
 async function add(type,data,user='alex'){const b=body(type,data),r=await call('/api/financial/record',b,user);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.record;}
 return {call,body,add,db:await mf.getD1Database('DB')};
}
const cell=v=>({formattedValue:String(v),userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:v},effectiveValue:typeof v==='number'?{numberValue:v}:{stringValue:v}});
function sampleSource(){const names=['Opsomming','Crown','Deli','Margot Swiss','Weeklikse Betalings','Skuldinvordering','Kredietwaarskuwings','Garden Route Deli'];const sheets=names.map((title,i)=>({properties:{title,sheetId:1000000+i},data:[{rowData:Array.from({length:title==='Garden Route Deli'?115:6},()=>({values:[]}))}]}));
 const weekly=sheets[4].data[0].rowData;weekly.push({values:['2026-09-25','Synthetic supplier','INV-SYN-001',12.34,'Paid','2026-09-25','Owner confirmation'].map(cell)});weekly.push({values:['2026-09-25','Synthetic supplier','INV-SYN-001',12.34,'Paid','2026-09-25','Additional source note'].map(cell)});
 const crown=sheets[1].data[0].rowData;crown[2]={values:['Maandtotaal',10.01,'2.5%',.25].map(cell)};crown[4]={values:['Faktuurdatum','Faktuurnommer','PO','Amount'].map(cell)};crown[5]={values:['01/09/2026','SYN-001','',10.01,'Synthetic invoice'].map(cell)};
 return {spreadsheetId:'synthetic-workbook-test-only',sheets};}

test('financial amounts preserve unknown and zero, apply discount once and separate confirmation from payable estimates',()=>{
 assert.equal(toCents('1 234,56'),123456);assert.equal(toCents('R1,234.56'),123456);assert.equal(toCents(''),null);assert.equal(toCents('0'),0);
 const a={id:'synthetic-account',type:'account',data:{supplier:'Synthetic',month:'2026-09',discount_bps:250,discount_state:'Conditional',opening_paid:null,status:'Unknown'}};
 const rows=[a,{id:'synthetic-invoice',type:'invoice',data:{supplier:'Synthetic',month:'2026-09',amount:10001}},{id:'synthetic-credit',type:'invoice',data:{supplier:'Synthetic',month:'2026-09',amount:-100}},{id:'synthetic-missing',type:'invoice',data:{supplier:'Synthetic',month:'2026-09',amount:null}}];
 assert.deepEqual(accountSummary(a,rows),{total:9901,discount:248,net:9653,paid:0,outstanding:null,payment_status:'Unknown',missing:1,documents:3,statement_difference:null,conditional:true,review:0});
 a.data.opening_paid=9653;a.data.status='Paid';assert.equal(accountSummary(a,rows).outstanding,0);rows.push({id:'synthetic-extra',type:'invoice',data:{supplier:'Synthetic',month:'2026-09',amount:2000}});assert.equal(accountSummary(a,rows).outstanding,1950,'new documents do not become paid by inheriting old status');
 const stock={type:'stock',data:{opening:null,received:10,sold:1,other_out:0,closing:9}};assert.equal(recordSummary(stock,[]).expected,null);stock.data.opening=0;assert.equal(recordSummary(stock,[]).difference,0);
 assert.equal(recordSummary({type:'profit',data:{sales:100,cost:30,expenses:0}},[]).profit,70);
 assert.throws(()=>validateFinancialRecord({id:'synthetic-record',type:'weekly',data:{supplier:'A',reference:'B',amount:12.2}}));
});
test('only Alex and Alinda can read, edit, export, import or print Financial; all other roles are denied',async t=>{
 const f=await fixture(t);for(const user of ['xavier','xalinda','tapiz','mosa','other','unsigned']){
  for(const path of ['/api/financial','/api/financial/source?sheet=1','/api/financial/export','/api/financial/audit?id=synthetic-entry','/api/financial/pdf?type=weekly','/api/financial/file?id=synthetic-file'])assert.equal((await f.call(path,null,user)).status,user==='unsigned'?401:403,user+' '+path);
  for(const path of ['/api/financial/record','/api/financial/import','/api/financial/file'])assert.equal((await f.call(path,{},user)).status,user==='unsigned'?401:403);
  assert.equal(appNavigation(user).some(s=>s.id==='financial'),false);
 }
 for(const user of ['alex','alinda']){assert.equal((await f.call('/api/financial',null,user)).status,200);assert.equal(appNavigation(user).some(s=>s.id==='financial'),true);}
 assert.equal((await f.call('/api/financial/record',f.body('weekly',{supplier:'S',reference:'A'}),'alex',{Origin:'https://other.example'})).status,403);
});
test('versioned financial changes preserve history and survive reload with atomic conflict and replay protection',async t=>{
 const f=await fixture(t),b=f.body('weekly',{supplier:'Synthetic',reference:'SYN-1',amount:10001,status:'To Pay',opening_paid:0});
 const result=await f.call('/api/financial/record',b);assert.equal(result.status,200);assert.equal((await f.call('/api/financial/record',b)).data.replayed,true);
 assert.equal((await f.call('/api/financial/record',{...b,reason:'Different data'})).status,409);
 assert.equal((await f.call('/api/financial/record',{...b,request_id:crypto.randomUUID(),record:{...b.record,id:crypto.randomUUID()}})).status,409,'duplicate supplier invoice rejected');
 const edit={...b,request_id:crypto.randomUUID(),revision:1,record:{...b.record,data:{...b.record.data,amount:20002}}};
 const race=await Promise.all([f.call('/api/financial/record',edit,'alinda'),f.call('/api/financial/record',{...edit,request_id:crypto.randomUUID()},'alex')]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
 const reload=await f.call('/api/financial?resource=record&id='+b.record.id,null,'alinda');assert.equal(reload.data.record.revision,2);assert.equal(reload.data.record.data.amount,20002);
 const audit=await f.call('/api/financial/audit?id='+b.record.id);assert.equal(audit.data.history.length,2);assert.equal(audit.data.history[1].data.amount,10001);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM v2_events').first()).n,0,'financial operations leave sales untouched');
});
test('actual payments support partial amounts, idempotent retries and audited corrections without implying a bank transfer',async t=>{
 const f=await fixture(t),target=await f.add('weekly',{supplier:'Synthetic',reference:'SYN-2',amount:12000,status:'To Pay',opening_paid:0});
 const p=f.body('payment',{target_id:target.id,date:'2026-01-01',amount:4000,method:'EFT',reference:'SYN-P1',evidence:'Owner confirmation',notes:'Synthetic received confirmation'});
 assert.equal((await f.call('/api/financial/record',p,'alinda')).status,200);assert.equal((await f.call('/api/financial/record',p,'alinda')).data.replayed,true);
 let state=(await f.call('/api/financial')).data;assert.equal(state.summaries[target.id].outstanding,8000);
 for(const data of [{...p.record.data,date:'2099-01-01'},{...p.record.data,amount:0},{...p.record.data,evidence:'Unknown'},{...p.record.data,evidence:'Bank proof'}])assert.equal((await f.call('/api/financial/record',f.body('payment',data))).status,400);
 const saved=(await f.call('/api/financial?resource=record&id='+p.record.id)).data.record;
 assert.equal((await f.call('/api/financial/record',{...p,request_id:crypto.randomUUID(),revision:1,reason:'Correct mistaken payment record',record:{...saved,data:{...saved.data,archived:true}}})).status,200);
 state=(await f.call('/api/financial')).data;assert.equal(state.summaries[target.id].outstanding,12000);
});
test('initial import is checksum checked, duplicate-safe and atomic, and preserves the original source separately',async t=>{
 const f=await fixture(t),source=sampleSource(),derived=deriveFinanceImport(source);assert.equal(derived.report.duplicates.length,1);assert.equal(derived.report.counts.weekly,1);assert.equal(derived.records.find(r=>r.type==='weekly').data.source.length,2);
 const raw=JSON.stringify(source),id=await hash(raw),pieces=[raw.slice(0,1000),raw.slice(1000)],manifest={id,parts:await Promise.all(pieces.map(hash))};
 const send=(operation,extra={})=>f.call('/api/financial/import',{operation,import_id:id,...extra});
 assert.equal((await send('import_start',{manifest})).status,200);assert.equal((await send('import_finish')).status,409);assert.equal((await f.call('/api/financial')).data.records.length,0);
 assert.equal((await send('import_chunk',{part:0,payload:'changed'})).status,400);
 for(let part=0;part<pieces.length;part++)assert.equal((await send('import_chunk',{part,payload:pieces[part]})).status,200);
 const result=await send('import_finish');assert.equal(result.status,200,JSON.stringify(result));assert.equal((await send('import_finish')).data.replayed,true);
 const state=(await f.call('/api/financial')).data;assert.equal(state.records.length,derived.records.length);
 const archive=(await f.call('/api/financial/source?sheet=1000004')).data;assert.equal(archive.total,2);assert.equal(archive.rows[0].cells[2].formattedValue,'INV-SYN-001');
 const secondRaw=raw+' ',other=await hash(secondRaw);assert.equal((await f.call('/api/financial/import',{operation:'import_start',import_id:other,manifest:{id:other,parts:[other]}})).status,409);
});
test('credit alerts count distinct invoices within 60 days per route and keep payment and credit decisions separate',()=>{
 const make=(id,date,route='Synthetic route',reference=id)=>({id,type:'credit',data:{date,route,customer:'Synthetic customer',reference,verification:'Not verified'}});
 const now=make('S3','2026-10-31'),records=[make('S1','2026-09-01'),make('S2','2026-10-01'),now,make('DUP','2026-10-02','Synthetic route','S2'),make('OTHER','2026-10-01','Other route'),make('OLD','2026-08-01')];
 assert.deepEqual(recordSummary(now,records),{cases:3,warning:'Consider cash only'});assert.equal(now.data.verification,'Not verified');assert.equal(now.data.decision,undefined);
});
test('financial PDF uses saved records and the existing Print / Share / Back flow',async t=>{
 const f=await fixture(t);await f.add('weekly',{supplier:'Synthetic supplier',reference:'SYN-PDF',amount:12345,status:'To Pay',opening_paid:0});
 const pdf=await f.call('/api/financial/pdf?type=weekly');assert.equal(pdf.status,200);assert.equal((await PDFDocument.load(pdf.data)).getPageCount(),1);
 const options=printPageOptions('document=financial&type=weekly');assert.equal(options.returnPath,'/financial');assert.equal(options.url,'/api/financial/pdf?type=weekly');
});
