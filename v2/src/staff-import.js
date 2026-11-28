import {check,dateKey} from './domain.js';
import {hash} from './auth.js';
import {employeeHistory,historyCoverage} from './staff-history.js';

export const IMPORT_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_staff_imports (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, status TEXT NOT NULL, result TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT)`,
 `CREATE TABLE IF NOT EXISTS v2_staff_import_chunks (import_id TEXT NOT NULL, part INTEGER NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(import_id,part))`
];
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const norm=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const cellValue=c=>c?.effectiveValue?.numberValue??c?.effectiveValue?.stringValue??c?.effectiveValue?.boolValue??c?.formattedValue??'';
export const cellText=c=>String(c?.formattedValue??cellValue(c));
const value=(r,n)=>cellValue(r?.cells[n]);
const str=(r,n)=>cellText(r?.cells[n]);
const rows=(b,name)=>b.sheets.find(s=>s.name===name)?.rows??[];
const rowFor=(b,name,person,column=0)=>rows(b,name).find(r=>norm(value(r,column))===norm(person));
function sourceDate(cell){
 const v=cellValue(cell);if(v==='')return null;
 let d;if(typeof v==='number'&&v>1&&v<100000)d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000).toISOString().slice(0,10);
 else if(/^\d{4}-\d\d-\d\d$/.test(String(v)))d=String(v);
 else {const m=String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m&&Number(m[1])>12&&Number(m[2])<=12)d=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
 try{return d?dateKey(d):null;}catch{return null;}
}
export function validateBundle(b){
 check(b?.format==='fen-staff-transfer-v1','Choose a Fen Staff transfer file.');
 check(b.source&&typeof b.source.spreadsheet_id==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(b.source.spreadsheet_id),'Invalid source identity.');
 check(typeof b.source.captured_at==='string'&&Number.isFinite(Date.parse(b.source.captured_at)),'Invalid source capture date.');
 check(b.source.timezone==='Africa/Johannesburg','The source timezone must be Africa/Johannesburg.');
 check(Array.isArray(b.sheets)&&b.sheets.length>0&&b.sheets.length<=40,'Invalid source sheets.');
 const names=new Set(),ids=new Set();let count=0;
 for(const s of b.sheets){
  check(typeof s.name==='string'&&s.name.length>0&&s.name.length<=100&&!names.has(s.name),'Duplicate or invalid source sheet.');names.add(s.name);
  check(Number.isInteger(s.id)&&s.id>=0&&!ids.has(s.id),'Duplicate or invalid sheet ID.');ids.add(s.id);
  check(Array.isArray(s.rows)&&s.rows.length<=30000,'Invalid source rows.');let last=0;
  for(const r of s.rows){check(Number.isInteger(r.number)&&r.number>last&&r.number<=1000000,'Source row order is invalid.');last=r.number;
   check(Array.isArray(r.cells)&&r.cells.length<=100,'Invalid source cells.');
   for(const c of r.cells){check(c===null||(typeof c==='object'&&!Array.isArray(c)),'Invalid cell.');check(JSON.stringify(c).length<=60000,'Source cell is too large.');}
  }count+=s.rows.length;
 }
 check(count<=40000,'Split larger source archives before importing.');
 for(const name of ['Employees','Casuals','UIF Werknemers','Clock Log','Leave Log','Leave','Week'])check(names.has(name),'Missing source sheet: '+name);
 check(rows(b,'Employees').some(r=>value(r,0)==='Name'&&value(r,1)==='Hourly Rate (R)'),'Employee columns do not match the reviewed source.');
 check(value(rows(b,'Clock Log')[0],0)==='Timestamp'&&value(rows(b,'Clock Log')[0],1)==='Name','Clock columns do not match the reviewed source.');
 return b;
}
async function identity(source,name){const h=await hash(source+'|'+norm(name));return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
export async function deriveImport(bundle,importId){
 const b=validateBundle(bundle),names=new Map(),source=b.source.spreadsheet_id;
 const add=(name,kind,ref)=>{if(typeof name!=='string'||!name.trim())return;const key=norm(name);if(!names.has(key))names.set(key,{name:name.trim(),kind,refs:[]});const p=names.get(key);p.refs.push(ref);if(kind!=='Historical')p.kind=kind;};
 for(const r of rows(b,'Employees'))if(r.number>=4&&typeof value(r,1)==='number')add(value(r,0),'Regular',{sheet:'Employees',row:r.number});
 for(const r of rows(b,'Casuals'))if(r.number>1)add(value(r,0),'Casual',{sheet:'Casuals',row:r.number});
 for(const [sheet,col,start] of [['Clock Log',1,2],['Leave Log',1,4],['UIF Log',1,2],['UIF Werknemers',0,2],['Clock Warnings',1,2],['Hours Warnings',1,2]]){
  const seen=new Set();for(const r of rows(b,sheet))if(r.number>=start){const n=value(r,col);if(!seen.has(norm(n))){add(n,'Historical',{sheet,row:r.number});seen.add(norm(n));}}
 }
 check(names.size<=200,'The source contains more than 200 distinct employee names.');
 const people=[];
 for(const n of names.values()){
  const employee=rowFor(b,'Employees',n.name),casual=rowFor(b,'Casuals',n.name),uif=rowFor(b,'UIF Werknemers',n.name),leave=rowFor(b,'Leave',n.name),week=rowFor(b,'Week',n.name);
  const start=sourceDate(uif?.cells[4]),id=await identity(source,n.name),generic=/^casual(?:\s*\((?:pad|winkel)\))?$/i.test(n.name),issues=[];
  if(!start)issues.push('Employment start date missing or ambiguous');
  else issues.push('Source employment date copied; verify the date format before clock activation');
  if(n.kind==='Historical')issues.push('Historical name: confirm identity and current status');
  if(generic)issues.push('Shared casual label: identify the individual before activating');
  const rate=employee?value(employee,1):casual?value(casual,4):null;
  const leaveSnapshot=leave?{Annual:value(leave,4),'Family responsibility':value(leave,5),Sick:value(leave,6)}:null;
  if(leaveSnapshot){issues.push('Imported leave balances await reconciliation');if(Object.values(leaveSnapshot).some(v=>typeof v==='number'&&v<0))issues.push('Source has a negative leave balance');}
  if(typeof rate==='number')issues.push('Current rate copied; original effective date is not supplied');
  const profile={import_id:importId,kind:n.kind,source_name:n.name,source_refs:n.refs,rate:typeof rate==='number'?rate:null,rate_effective_from:null,rate_as_of:b.source.captured_at.slice(0,10),surname:uif?str(uif,1):'',initials:uif?str(uif,2):'',identity_number:uif?str(uif,3):'',start_date_source:uif?str(uif,4):'',uif_contributor:uif?value(uif,5):null,bank:employee?{account_number:str(employee,2),bank:str(employee,3),branch_code:str(employee,4)}:null,casual_type:casual?str(casual,1):null,leave_snapshot:leaveSnapshot,week_snapshot:week?{normal_hours:value(week,1),overtime_hours:value(week,2),commission:value(week,4),gross:value(week,5),uif:value(week,6),meat_deduction:value(week,7),net:value(week,8),status:str(week,9)}:null,issues};
  people.push({id,code:'LEG-'+id.replaceAll('-','').slice(0,12).toUpperCase(),name:n.name,team:n.kind==='Regular'?'Team to confirm':n.kind==='Casual'?'Casual · '+(profile.casual_type||'type to confirm'):'Historical',active:n.kind!=='Historical'&&!generic,start_date:start,employment_verified:false,schedules:[],source_profile:profile});
 }
 const summary={source:b.source,sheets:b.sheets.map(s=>({id:s.id,name:s.name,rows:s.rows.length,last_row:s.rows.at(-1)?.number??0})),rows:b.sheets.reduce((n,s)=>n+s.rows.length,0),people:people.length,active:people.filter(p=>p.active).length,historical:people.filter(p=>!p.active).length,missing_start_dates:people.filter(p=>!p.start_date).length,clock_rows:rows(b,'Clock Log').filter(r=>r.number>1).length,leave_rows:rows(b,'Leave Log').filter(r=>r.number>3).length,uif_rows:rows(b,'UIF Log').filter(r=>r.number>1).length,payroll_ready:false,uif_workflow:{calculation:'Fen Meat',payment_to_auditors:'Alex',submission:'Auditors'}};
 return {people,summary};
}
export async function loadBundle(db,id){
 const batch=await db.prepare('SELECT * FROM v2_staff_imports WHERE id=?').bind(id).first();check(batch,'Import not found.',404);
 const manifest=JSON.parse(batch.manifest),parts=(await db.prepare('SELECT part,digest,payload FROM v2_staff_import_chunks WHERE import_id=? ORDER BY part').bind(id).all()).results;
 check(parts.length===manifest.parts.length&&parts.every((p,i)=>p.part===i&&p.digest===manifest.parts[i]),'Some import parts are missing. Choose the same file to resume.',409);
 const raw=parts.map(p=>p.payload).join('');check(await hash(raw)===id,'The stored source checksum does not match.',409);
 return {batch,manifest,raw,bundle:validateBundle(JSON.parse(raw))};
}
export async function staffImportApi({request,url,db,user,bodyOf,current}){
 const path=url.pathname,stamp=new Date().toISOString();
 if(request.method==='GET'){
  if(path==='/api/staff/imports')return {imports:(await db.prepare('SELECT id,status,result,actor,created_at,completed_at FROM v2_staff_imports ORDER BY created_at DESC LIMIT 20').all()).results.map(r=>({...r,result:r.result?JSON.parse(r.result):null}))};
  const id=url.searchParams.get('id')||(path==='/api/staff/imports/history'?(current.state.latest_history_import??current.state.source_import):null);check(hex(id),'No completed source import is available.');const loaded=await loadBundle(db,id);check(loaded.batch.status==='complete','Import is not complete.',409);
  if(path==='/api/staff/imports/history'){
   const p=current.state.people.find(p=>p.id===url.searchParams.get('employee_id'));check(p,'Employee not found.',404);
   return employeeHistory(loaded.bundle,p,id);
  }
  if(path==='/api/staff/imports/export')return {id,bundle:loaded.bundle};
  if(path==='/api/staff/imports/rows'){
   const s=loaded.bundle.sheets.find(s=>String(s.id)===url.searchParams.get('sheet'));check(s,'Source sheet not found.',404);
   const q=(url.searchParams.get('q')??'').trim().toLowerCase();check(q.length<=100,'Search up to 100 characters.');
   const offset=Number(url.searchParams.get('offset')??0);check(Number.isInteger(offset)&&offset>=0,'Invalid page.');
   const matches=q?s.rows.filter(r=>r.cells.some(c=>cellText(c).toLowerCase().includes(q))):s.rows;
   return {id,sheet:s.name,total:matches.length,offset,rows:matches.slice(offset,offset+50),columns:Math.max(0,...s.rows.map(r=>r.cells.length)),read_only:true};
  }
  check(false,'Not found.',404);
 }
 check(request.method==='POST','Not found.',404);const b=await bodyOf(request);check(hex(b.import_id),'Invalid import checksum.');
 if(path==='/api/staff/imports/start'){
  const m=b.manifest;check(m&&m.id===b.import_id&&Array.isArray(m.parts)&&m.parts.length>0&&m.parts.length<=120&&m.parts.every(hex),'Invalid import manifest.');
  const old=await db.prepare('SELECT manifest,status,result FROM v2_staff_imports WHERE id=?').bind(b.import_id).first();
  if(old){check(old.manifest===JSON.stringify(m),'This checksum has a different manifest.',409);return {ok:true,status:old.status,result:old.result?JSON.parse(old.result):null};}
  const count=await db.prepare('SELECT COUNT(*) n FROM v2_staff_imports').first();check(count.n<20,'Review existing imports before adding more.',409);
  await db.prepare('INSERT INTO v2_staff_imports(id,manifest,status,actor,created_at) VALUES(?,?,\'uploading\',?,?) ON CONFLICT(id) DO NOTHING').bind(b.import_id,JSON.stringify(m),user.username,stamp).run();
  return {ok:true,status:'uploading'};
 }
 const batch=await db.prepare('SELECT * FROM v2_staff_imports WHERE id=?').bind(b.import_id).first();check(batch,'Start the import first.',404);
 if(path==='/api/staff/imports/chunk'){
  const m=JSON.parse(batch.manifest);check(Number.isInteger(b.part)&&b.part>=0&&b.part<m.parts.length,'Invalid part number.');check(typeof b.payload==='string'&&b.payload.length<=120000,'Invalid import part size.');
  const digest=await hash(b.payload);check(digest===m.parts[b.part],'Import part checksum does not match.');
  await db.prepare('INSERT INTO v2_staff_import_chunks VALUES(?,?,?,?) ON CONFLICT(import_id,part) DO NOTHING').bind(b.import_id,b.part,digest,b.payload).run();
  const saved=await db.prepare('SELECT digest FROM v2_staff_import_chunks WHERE import_id=? AND part=?').bind(b.import_id,b.part).first();check(saved.digest===digest,'Saved import part differs.',409);return {ok:true,part:b.part,digest};
 }
 if(path==='/api/staff/imports/finish'){
  if(batch.status==='complete')return {ok:true,replayed:true,...JSON.parse(batch.result)};
  check(b.revision===current.revision,'Staff changed. Refresh and resume this import.',409);
  check(b.mode===undefined||b.mode==='initial'||b.mode==='history','Invalid import mode.');
  const history=b.mode==='history';
  if(!history)check(current.state.people.length===0&&current.state.leave.length===0&&current.state.ledger.length===0,'Initial source import requires an empty Staff register. Existing records will not be overwritten.',409);
  const {bundle}=await loadBundle(db,b.import_id),derived=await deriveImport(bundle,b.import_id);
  let state,newPeople=[];
  if(history){
   check(current.state.source_import,'Complete the initial Staff source import first.',409);
   const previous=await loadBundle(db,current.state.latest_history_import??current.state.source_import);
   check(previous.batch.status==='complete'&&previous.bundle.source.spreadsheet_id===bundle.source.spreadsheet_id,'History must come from the same original spreadsheet.',409);
   const used=new Map(current.state.people.map(p=>[p.id,p]));
   for(const p of derived.people){
    const existing=used.get(p.id);
    if(existing){check(norm(existing.source_profile?.source_name)===norm(p.source_profile.source_name),'An employee identity differs from its source mapping. Review before importing.',409);continue;}
    check(!current.state.people.some(x=>norm(x.name)===norm(p.name)||norm(x.source_profile?.source_name)===norm(p.name)),'A new source name matches another employee record. Review the identity before importing.',409);
    // New identities remain inactive until a person verifies them. Existing
    // birthdays, PIN assignments, schedules, pay setup and balances stay intact.
    newPeople.push({...p,active:false});
   }
   check(current.state.people.length+newPeople.length<=200,'The register would exceed 200 employee identities.');
   const newer=Date.parse(bundle.source.captured_at)>=Date.parse(previous.bundle.source.captured_at);
   state={...current.state,people:[...current.state.people,...newPeople],latest_history_import:newer?b.import_id:(current.state.latest_history_import??current.state.source_import),source_history_imports:[...new Set([current.state.source_import,...(current.state.source_history_imports??[]),b.import_id])]};
  }else state={...current.state,people:derived.people,source_import:b.import_id,uif_workflow:derived.summary.uif_workflow};
  check(JSON.stringify(state).length<600000,'The imported register is too large.');const result={...derived.summary,revision:current.revision+1,checksum:b.import_id,mode:history?'history':'initial',history_coverage:historyCoverage(bundle),...(history?{existing_people_preserved:current.state.people.length,new_inactive_people:newPeople.length,latest_history_import:state.latest_history_import}:{})};
  try{await db.batch([
   db.prepare('INSERT INTO v2_staff_register VALUES(?,?,?,?,?,?)').bind(current.revision+1,JSON.stringify(state),history?'source_history_import':'source_import',user.username,stamp,JSON.stringify({import_id:b.import_id,people:derived.people.length,rows:derived.summary.rows,...(history?{existing_people_preserved:current.state.people.length,new_inactive_people:newPeople.length}:{})})),
   db.prepare('UPDATE v2_staff_imports SET status=\'complete\',result=?,completed_at=? WHERE id=?').bind(JSON.stringify(result),stamp,b.import_id)
  ]);}catch{const done=await db.prepare('SELECT status,result FROM v2_staff_imports WHERE id=?').bind(b.import_id).first();check(done?.status==='complete','Staff changed. Refresh and resume this import.',409);return {ok:true,replayed:true,...JSON.parse(done.result)};}
  return {ok:true,...result};
 }
 check(false,'Not found.',404);
}
