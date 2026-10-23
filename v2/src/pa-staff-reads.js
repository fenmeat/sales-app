import {check,dateKey,addDays,today} from './domain.js';
import {isAdmin} from './auth.js';
import {readOnlyDatabase} from './pa-reads.js';
import {staffState,staffApi} from './staff-api.js';
import {loadBundle,deriveImport,staffImportApi} from './staff-import.js';
import {LEAVE_TYPES,balance} from './staff-domain.js';

export const STAFF_READ_SCOPE='fenmeat:staff:read';
export const needsStaffRead=(name,args)=>name==='get_staff_data'||(name==='get_access_status'&&args?.staff!==undefined);
const warnings=[
 'Imported source records are a dated snapshot; later Google Sheet changes are not synchronized.',
 'Source rates, employment dates and leave balances are evidence awaiting reconciliation, not approved payroll inputs.',
 'Historical source clock and leave rows are separate from native shifts and the approved leave ledger.',
 'Payroll is available in Staff administration. Confirm pay setup and opening amounts and approve each week; source records alone are not payroll-ready. Fen calculates UIF; Alex pays the auditors; the auditors submit it.'
];

// This adapter has no schema initializer, write action, credential query or raw SQL input.
// All downstream database calls also pass through the SELECT-only database wrapper.
export async function readStaffData(args,env,username,scopes){
 check(isAdmin(username)&&scopes.includes(STAFF_READ_SCOPE),'Approve separate Staff read access using your own Alex or Alinda admin account.',403);
 const db=readOnlyDatabase(env.DB),resource=args.resource??'summary';
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_staff_register'").first();
 const connection={app:'FenMeat Staff',owner:username,access:'read_only',scope:STAFF_READ_SCOPE,generated_at:new Date().toISOString(),timezone:'Africa/Johannesburg'};
 if(!exists){check(resource==='summary','Staff has not been initialized.',409);return {initialized:false,import_verified:false,payroll_ready:false,connection};}
 const current=await staffState(db),state=current.state;
 const result=data=>({...data,revision:current.revision,saved_at:current.saved_at,payroll_ready:false,payroll_feature_enabled:true,warnings,connection});
 const bodyOf=()=>{throw Error('Staff connector is read-only');};
 if(resource==='summary'){
  const hasImports=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_staff_imports'").first();
  const imports=hasImports?(await db.prepare('SELECT id,status,result,actor,created_at,completed_at FROM v2_staff_imports ORDER BY created_at DESC LIMIT 20').all()).results.map(r=>({...r,result:r.result?JSON.parse(r.result):null})):[];
  const id=args.import_id??state.source_import;
  let verified=null;
  if(id){
   const loaded=await loadBundle(db,id);check(loaded.batch.status==='complete','The source import is not complete.',409);
   const {people,summary}=await deriveImport(loaded.bundle,id),recorded=JSON.parse(loaded.batch.result);
   check(recorded?.checksum===id&&Object.entries(summary).every(([k,v])=>JSON.stringify(recorded[k])===JSON.stringify(v)),'Stored import summary differs from its source archive.',409);
   const register=(await db.prepare('SELECT payload,action FROM v2_staff_register WHERE revision=?').bind(recorded.revision).first());
   check(register?.action==='source_import','The original Staff import revision is missing.',409);
   const imported=JSON.parse(register.payload);
   check(imported.source_import===id&&JSON.stringify(imported.people)===JSON.stringify(people),'The original employee import differs from its verified source.',409);
   verified={checksum:id,checksum_verified:true,original_register_verified:true,linked_to_current_register:state.source_import===id,import_revision:recorded.revision,completed_at:loaded.batch.completed_at,summary};
  }
  return result({initialized:true,import_verified:!!verified?.linked_to_current_register,verified_import:verified,imports,
   current:{people:state.people.length,active:state.people.filter(p=>p.active).length,inactive:state.people.filter(p=>!p.active).length,
    employment_dates_unconfirmed:state.people.filter(p=>p.employment_verified===false).length,missing_start_dates:state.people.filter(p=>!p.start_date).length,
    without_schedules:state.people.filter(p=>p.active&&!p.schedules.length).length,leave_requests:state.leave.length,leave_ledger_entries:state.ledger.length},
   uif_workflow:state.uif_workflow??{calculation:'Fen Meat',payment_to_auditors:'Alex',submission:'Auditors'}});
 }
 if(resource==='people'){
  const q=(args.q??'').trim().toLowerCase(),offset=args.offset??0;
  const selected=state.people.filter(p=>(!args.employee_id||p.id===args.employee_id)&&(!q||(p.name+' '+p.code).toLowerCase().includes(q)));
  if(args.employee_id)check(selected.length,'Employee not found.',404);
  return result({total:selected.length,offset,people:selected.slice(offset,offset+50).map(p=>({id:p.id,code:p.code,name:p.name,team:p.team,active:p.active,start_date:p.start_date,employment_verified:p.employment_verified!==false,schedules:p.schedules,
   balances_as_of:today(),balances:Object.fromEntries(LEAVE_TYPES.filter(t=>t!=='Unpaid').map(t=>[t,balance(state,p.id,t,today())])),
   source_import:p.source_profile?.import_id??null,source_issues:p.source_profile?.issues??[],...(args.employee_id?{source_profile:p.source_profile??null}:{})})),
   private_profile_included:!!args.employee_id});
 }
 if(resource==='source_rows'){
  const id=args.import_id??state.source_import;check(id,'No source import is linked. Read summary first.',409);check(Number.isInteger(args.sheet_id),'Choose a sheet ID from summary.');
  const url=new URL('https://fenmeat.invalid/api/staff/imports/rows');for(const[k,v]of Object.entries({id,sheet:args.sheet_id,q:args.q??'',offset:args.offset??0}))url.searchParams.set(k,String(v));
  return result(await staffImportApi({request:new Request(url),url,db,user:{username},bodyOf,current}));
 }
 if(resource==='hours'){
  const from=dateKey(args.from),to=dateKey(args.to);check(from<=to&&to<=addDays(from,30),'Choose at most 31 calendar days.');
  const url=new URL('https://fenmeat.invalid/api/staff/hours');url.searchParams.set('from',from);url.searchParams.set('to',to);
  return result({...await staffApi({request:new Request(url),url,env:{DB:db},user:{username},bodyOf}),source_kind:'native_clock_and_approved_leave'});
 }
 if(resource==='leave'){
  check(args.employee_id,'Choose an employee ID to read private leave details.');check(state.people.some(p=>p.id===args.employee_id),'Employee not found.',404);
  const offset=args.offset??0,leave=state.leave.filter(r=>r.employee_id===args.employee_id),ledger=state.ledger.filter(r=>r.employee_id===args.employee_id);
  return result({employee_id:args.employee_id,offset,leave_total:leave.length,ledger_total:ledger.length,leave:leave.slice(offset,offset+50),ledger:ledger.slice(offset,offset+50),source_kind:'native_leave_only'});
 }
 check(false,'Unknown Staff read resource.',404);
}
