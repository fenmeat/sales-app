import {deriveBudgetImport} from './budget-import.js';
import {check,UserError,today} from './domain.js';
import {hash,isAdmin} from './auth.js';
import {FINANCE_TYPES,validateFinancialRecord,recordKey,recordSummary} from './finance-domain.js';
import {deriveFinanceImport,sourceText} from './finance-import.js';

export const FINANCE_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_finance_records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,unique_key TEXT UNIQUE,revision INTEGER NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,saved_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS v2_finance_events(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,record_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,saved_at TEXT NOT NULL,write_guard INTEGER NOT NULL CHECK(write_guard=1),UNIQUE(record_id,revision))`,
 `CREATE TABLE IF NOT EXISTS v2_finance_imports(id TEXT PRIMARY KEY,manifest TEXT NOT NULL,status TEXT NOT NULL,result TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT)`,
 `CREATE TABLE IF NOT EXISTS v2_finance_parts(import_id TEXT NOT NULL,part INTEGER NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(import_id,part))`,
 `CREATE TABLE IF NOT EXISTS v2_finance_files(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,digest TEXT NOT NULL,bytes BLOB NOT NULL,actor TEXT NOT NULL,saved_at TEXT NOT NULL)`
];
export async function ensureFinanceSchema(db){await db.batch(FINANCE_SCHEMA.map(s=>db.prepare(s)));}
const parseRow=r=>({id:r.id,type:r.kind,revision:r.revision,data:JSON.parse(r.payload),actor:r.actor,saved_at:r.saved_at});
export async function financeRecords(db){return (await db.prepare('SELECT * FROM v2_finance_records ORDER BY saved_at DESC,id').all()).results.map(parseRow);}
const idValid=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{12,100}$/.test(id);
const hex=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
async function importedSource(db,id){
 const batch=await db.prepare('SELECT * FROM v2_finance_imports WHERE id=?').bind(id).first();check(batch,'Import not found.',404);const manifest=JSON.parse(batch.manifest);
 const parts=(await db.prepare('SELECT * FROM v2_finance_parts WHERE import_id=? ORDER BY part').bind(id).all()).results;
 check(parts.length===manifest.parts.length&&parts.every((p,i)=>p.part===i&&p.digest===manifest.parts[i]),'Some import parts are missing.',409);
 const raw=parts.map(p=>p.payload).join('');check(await hash(raw)===id,'Source checksum does not match.',409);
 return {batch,source:JSON.parse(raw)};
}
export async function readFinance(db,query={}){
 const resource=query.resource??'summary';
 const imports=(await db.prepare('SELECT id,status,result,created_at,completed_at FROM v2_finance_imports ORDER BY created_at DESC').all()).results.map(r=>({...r,result:r.result?JSON.parse(r.result):null}));
 if(resource==='source'){
  const item=imports.find(i=>i.status==='complete'&&(query.import_id?i.id===query.import_id:i.result?.source_sheets?.some(s=>String(s.id)===String(query.sheet))));check(item,'No completed source import.',404);const {source}=await importedSource(db,item.id);
  const sheet=source.sheets.find(s=>String(s.properties.sheetId)===String(query.sheet));check(sheet,'Choose a source section.');
  const q=String(query.q??'').toLowerCase(),offset=Number(query.offset??0);check(Number.isInteger(offset)&&offset>=0&&offset<100000,'Invalid page.');
  const rows=sheet.data[0].rowData.map((r,i)=>({row:i+1,cells:r.values??[]})).filter(r=>r.cells.some(c=>sourceText(c)||c.note)).filter(r=>!q||r.cells.some(c=>(sourceText(c)+' '+(c.note??'')).toLowerCase().includes(q)));
  return {sheet:sheet.properties.title,rows:rows.slice(offset,offset+30),total:rows.length,next_offset:offset+30<rows.length?offset+30:null,source_id:item.id};
 }
 if(resource==='audit'){check(idValid(query.id),'Choose a financial record.');return {history:(await db.prepare('SELECT revision,action,reason,payload,actor,saved_at FROM v2_finance_events WHERE record_id=? ORDER BY revision DESC LIMIT 100').bind(query.id).all()).results.map(r=>({...r,data:JSON.parse(r.payload),payload:undefined}))};}
 const records=await financeRecords(db);
 if(resource==='export')return {format:'fen-financial-records-v1',generated_at:new Date().toISOString(),records,imports};
 if(resource==='record'){const record=records.find(r=>r.id===query.id);check(record,'Record not found.',404);return {record,summary:recordSummary(record,records)};}
 const summaries=Object.fromEntries(records.filter(r=>!r.data.archived).map(r=>[r.id,recordSummary(r,records)]));
 return {records,summaries,imports,today:today(),counts:Object.fromEntries(Object.keys(FINANCE_TYPES).map(t=>[t,records.filter(r=>r.type===t&&!r.data.archived).length]))};
}
export async function saveFinance(db,user,b){
 check(isAdmin(user.username),'Only Alex and Alinda have Financial access.',403);
 check(idValid(b.request_id),'Use a unique save identifier.');check(typeof b.reason==='string'&&b.reason.trim().length>=5&&b.reason.length<=2000,'Enter the reason / source for this change.');
 const fingerprint=await hash(JSON.stringify(b));
 const replay=async()=>{const e=await db.prepare('SELECT * FROM v2_finance_events WHERE request_id=?').bind(b.request_id).first();if(!e)return null;check(e.request_hash===fingerprint&&e.actor===user.username,'Save identifier was used for a different change.',409);return {saved:true,replayed:true,record:{id:e.record_id,type:b.record.type,revision:e.revision,data:JSON.parse(e.payload),actor:e.actor,saved_at:e.saved_at}};};
 const prior=await replay();if(prior)return prior;
 const record=b.record;try{validateFinancialRecord(record);}catch(e){throw new UserError(e.message);}
 const old=await db.prepare('SELECT * FROM v2_finance_records WHERE id=?').bind(record.id).first();
 check(Number.isSafeInteger(b.revision)&&b.revision===(old?.revision??0),'This record changed. Keep your draft and refresh the saved version before editing.',409);
 check(!old||old.kind===record.type,'A saved record cannot change type.');
 if(old)check(JSON.stringify(record.data.source??null)===JSON.stringify(JSON.parse(old.payload).source??null),'Original source references cannot be changed.');
 else check(!record.data.source,'Source references are set by the import only.');
 if(record.type==='budget'){
  if(old)check(record.data.month===JSON.parse(old.payload).month,'Use Copy to new month to preserve the original budget.');
  check(record.data.weeks.every(w=>!w.date||w.date<=today()),'Actual set-aside date cannot be in the future.');
 }
 if(record.type==='payment'){
  const target=await db.prepare('SELECT kind,payload FROM v2_finance_records WHERE id=?').bind(record.data.target_id).first();
  check(target&&['account','weekly'].includes(target.kind)&&!JSON.parse(target.payload).archived,'Choose an active monthly account or weekly invoice.');
  check(record.data.date<=today(),'Actual payment date cannot be in the future.');
 }
 for(const link of record.data.links??[])if(link.url.startsWith('/api/financial/file')){const file=await db.prepare('SELECT record_id FROM v2_finance_files WHERE id=?').bind(new URL(link.url,'https://fen.invalid').searchParams.get('id')).first();check(file&&file.record_id===record.id,'That attachment belongs to a different record.');}
 const revision=b.revision+1,stamp=new Date().toISOString(),payload=JSON.stringify(record.data),key=recordKey(record);
 const statement=old?db.prepare('UPDATE v2_finance_records SET unique_key=?,revision=?,payload=?,actor=?,saved_at=? WHERE id=? AND revision=?').bind(key,revision,payload,user.username,stamp,record.id,b.revision):db.prepare('INSERT INTO v2_finance_records VALUES(?,?,?,?,?,?,?)').bind(record.id,record.type,key,revision,payload,user.username,stamp);
 const event=db.prepare('INSERT INTO v2_finance_events VALUES(?,?,?,?,?,?,?,?,?,changes())').bind(b.request_id,fingerprint,record.id,revision,record.data.archived?'archive':'save',b.reason.trim(),payload,user.username,stamp);
 try{await db.batch([statement,event]);}catch{const retry=await replay();if(retry)return retry;throw new UserError('Save conflict or duplicate invoice. Check the latest record before trying again; your draft is kept.',409);}
 return {saved:true,record:{...record,revision,actor:user.username,saved_at:stamp}};
}
export async function financeImport(db,user,b){
 check(isAdmin(user.username),'Only Alex and Alinda have Financial access.',403);check(hex(b.import_id),'Invalid source checksum.');
 if(b.operation==='import_start'){
  check(b.manifest?.id===b.import_id&&Array.isArray(b.manifest.parts)&&b.manifest.parts.length>=1&&b.manifest.parts.length<=80&&b.manifest.parts.every(hex),'Invalid import manifest.');
  check(!b.manifest.kind||b.manifest.kind==='budget','Unknown import kind.');
  if(b.manifest.kind==='budget')check(/^\d{4}-10$/.test(b.manifest.month??''),'Choose the October source month.');
  const existing=await db.prepare('SELECT * FROM v2_finance_imports WHERE id=?').bind(b.import_id).first();
  if(existing){check(existing.manifest===JSON.stringify(b.manifest),'Import manifest changed.',409);return {status:existing.status};}
  if(b.manifest.kind==='budget')check(!(await db.prepare('SELECT id FROM v2_finance_records WHERE unique_key=?').bind('budget|'+b.manifest.month).first()),'This budget month already exists; it will not be overwritten.',409);
  else check((await db.prepare('SELECT COUNT(*) n FROM v2_finance_records').first()).n===0,'Financial already contains records. Initial import cannot overwrite them.',409);
  await db.prepare("INSERT INTO v2_finance_imports VALUES(?,?,'uploading',NULL,?,?,NULL)").bind(b.import_id,JSON.stringify(b.manifest),user.username,new Date().toISOString()).run();return {status:'uploading'};
 }
 const batch=await db.prepare('SELECT * FROM v2_finance_imports WHERE id=?').bind(b.import_id).first();check(batch,'Start the import first.',404);
 if(b.operation==='import_chunk'){
  const m=JSON.parse(batch.manifest);check(Number.isInteger(b.part)&&b.part>=0&&b.part<m.parts.length&&typeof b.payload==='string'&&b.payload.length<=100000,'Invalid source part.');
  const digest=await hash(b.payload);check(digest===m.parts[b.part],'Source part checksum changed.');
  await db.prepare('INSERT INTO v2_finance_parts VALUES(?,?,?,?) ON CONFLICT(import_id,part) DO NOTHING').bind(b.import_id,b.part,digest,b.payload).run();
  const read=await db.prepare('SELECT digest FROM v2_finance_parts WHERE import_id=? AND part=?').bind(b.import_id,b.part).first();check(read.digest===digest,'Saved source differs.',409);return {part:b.part,digest};
 }
 check(b.operation==='import_finish','Unknown financial import operation.');
 if(batch.status==='complete')return {replayed:true,...JSON.parse(batch.result)};
 const manifest=JSON.parse(batch.manifest);
 if(manifest.kind!=='budget')check((await db.prepare('SELECT COUNT(*) n FROM v2_finance_records').first()).n===0,'Financial contains records; nothing was overwritten.',409);
 const {source}=await importedSource(db,b.import_id);let derived;try{derived=manifest.kind==='budget'?deriveBudgetImport(source,manifest.month):deriveFinanceImport(source);}catch(e){throw new UserError(e.message);}
 check(derived.records.length<=3000,'This initial import is too large.');
 const stamp=new Date().toISOString(),statements=[];
 // The entire initial dataset and completion marker commit in one transaction.
 // JSON batches keep statement and parameter counts bounded.
 for(let i=0;i<derived.records.length;i+=25){const part=derived.records.slice(i,i+25).map(r=>({...r,key:recordKey(r)})),raw=JSON.stringify(part);
  statements.push(db.prepare("INSERT INTO v2_finance_records SELECT json_extract(value,'$.id'),json_extract(value,'$.type'),json_extract(value,'$.key'),1,json_extract(value,'$.data'),?,? FROM json_each(?)").bind(user.username,stamp,raw));
  statements.push(db.prepare("INSERT INTO v2_finance_events SELECT ?||'-'||json_extract(value,'$.id'),?,json_extract(value,'$.id'),1,'import','Import from the authorised financial workbook',json_extract(value,'$.data'),?,?,1 FROM json_each(?)").bind(b.import_id,b.import_id,user.username,stamp,raw));
 }
 statements.push(db.prepare("UPDATE v2_finance_imports SET status='complete',result=?,completed_at=? WHERE id=? AND status='uploading'").bind(JSON.stringify(derived.report),stamp,b.import_id));
 try{await db.batch(statements);}catch{const after=await db.prepare('SELECT status,result FROM v2_finance_imports WHERE id=?').bind(b.import_id).first();if(after.status==='complete')return {replayed:true,...JSON.parse(after.result)};throw new UserError('Import could not finish. The source is retained; retry the same import.',409);}
 return derived.report;
}
export async function financeApi({request,url,db,user,bodyOf}){
 check(isAdmin(user.username),'Only Alex and Alinda have Financial access.',403);
 const action=url.pathname.replace('/api/financial','')||'/';
 if(action==='/file'){
  if(request.method==='GET'){const r=await db.prepare('SELECT * FROM v2_finance_files WHERE id=?').bind(url.searchParams.get('id')).first();check(r,'Document not found.',404);return new Response(r.bytes,{headers:{'Content-Type':r.mime_type,'Content-Disposition':`inline; filename="${r.filename.replace(/[^a-zA-Z0-9._-]/g,'_')}"`}});}
  const b=await bodyOf(request);check(idValid(b.id)&&idValid(b.record_id),'Invalid document identity.');check(['application/pdf','image/jpeg','image/png'].includes(b.mime_type),'Use a PDF, JPG or PNG.');check(typeof b.filename==='string'&&b.filename.length<=180&&typeof b.base64==='string'&&b.base64.length<=670000,'Use a document smaller than 500 KB.');
  let bytes;try{bytes=Uint8Array.from(atob(b.base64),c=>c.charCodeAt(0));}catch{throw new UserError('Document encoding is invalid.');}check(bytes.length<=500000,'Document must be 500 KB or smaller.');
  const valid=b.mime_type==='application/pdf'?new TextDecoder().decode(bytes.slice(0,5))==='%PDF-':b.mime_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;check(valid,'File content does not match its type.');
  const digest=await hash(b.base64),old=await db.prepare('SELECT digest,record_id FROM v2_finance_files WHERE id=?').bind(b.id).first();if(old){check(old.digest===digest&&old.record_id===b.record_id,'Document identifier was already used.',409);return {id:b.id};}
  await db.prepare('INSERT INTO v2_finance_files VALUES(?,?,?,?,?,?,?,?)').bind(b.id,b.record_id,b.filename,b.mime_type,digest,bytes,user.username,new Date().toISOString()).run();return {id:b.id};
 }
 if(request.method==='GET'){
  if(action==='/pdf'){const state=await readFinance(db);const {financePDF}=await import('./finance-pdf.js');return new Response(await financePDF(state,Object.fromEntries(url.searchParams)),{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="FenMeat-Financial.pdf"'}});}
  const data=await readFinance(db,{...Object.fromEntries(url.searchParams),resource:action==='/source'?'source':action==='/audit'?'audit':action==='/export'?'export':url.searchParams.get('resource')??'summary'});return {...data,username:user.username};
 }
 const b=await bodyOf(request);if(action==='/import')return financeImport(db,user,b);
 check(action==='/'||action==='/record','Unknown financial operation.',404);return saveFinance(db,user,b);
}
