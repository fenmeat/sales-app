import {openAttendance,clockReceipt} from './pa-attendance.js';
import {check,dateKey,addDays,today} from './domain.js';
import {isAdmin,keys} from './auth.js';
import {readOnlyDatabase} from './pa-reads.js';
import {staffState,staffApi,shiftsBetween} from './staff-api.js';
import {loadBundle,deriveImport,staffImportApi} from './staff-import.js';
import {FRESH_START,nextFriday,profileAt} from './payroll-domain.js';
import {LEAVE_TYPES,balance,periodHours,staffPerson} from './staff-domain.js';

export const STAFF_READ_SCOPE='fenmeat:staff:read';
export const needsStaffRead=(name,args)=>name==='get_staff_data'||(name==='get_access_status'&&args?.staff!==undefined);
const warnings=[
 'Imported source records are a dated snapshot; later Google Sheet changes are not synchronized.',
 'Source rates, employment dates and leave balances are evidence awaiting reconciliation, not approved payroll inputs.',
 'Historical source clock and leave rows are separate from native shifts and the approved leave ledger.',
 'Payroll is available in Staff administration. Confirm pay setup and current deductions and approve each week; source records alone are not payroll-ready. Fen calculates UIF; Alex pays the auditors; the auditors submit it.'
];

// This adapter has no schema initializer, write action, credential query or raw SQL input.
// All downstream database calls also pass through the SELECT-only database wrapper.
export async function readStaffData(args,env,username,scopes,attempt=0){
 check(isAdmin(username)&&scopes.includes(STAFF_READ_SCOPE),'Approve separate Staff read access using your own Alex or Alinda admin account.',403);
 const db=readOnlyDatabase(env.DB),resource=args.resource??'summary';
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_staff_register'").first();
 const connection={app:'FenMeat Staff',owner:username,access:'read_only',scope:STAFF_READ_SCOPE,generated_at:new Date().toISOString(),timezone:'Africa/Johannesburg'};
 if(!exists){check(resource==='summary','Staff has not been initialized.',409);return {initialized:false,import_verified:false,payroll_ready:false,connection};}
 const current=await staffState(db),state=current.state;
 const result=data=>({...data,revision:current.revision,saved_at:current.saved_at,payroll_ready:false,payroll_feature_enabled:true,warnings,connection});
 const bodyOf=()=>{throw Error('Staff connector is read-only');};
 if(resource==='open')return {...await openAttendance(db,current),connection};
 if(resource==='clock_receipt')return {...await clockReceipt(db,args.request_id,username),connection};
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
  let latestHistory=null;
  if(state.latest_history_import&&state.latest_history_import!==state.source_import){
   const latest=await loadBundle(db,state.latest_history_import),saved=JSON.parse(latest.batch.result??'null');
   check(latest.batch.status==='complete'&&saved?.checksum===state.latest_history_import,'Latest source history has not been verified.',409);
   const derived=await deriveImport(latest.bundle,state.latest_history_import);
   check(Object.entries(derived.summary).every(([k,v])=>JSON.stringify(saved[k])===JSON.stringify(v)),'Latest history summary differs from its source archive.',409);
   const register=await db.prepare('SELECT payload,action FROM v2_staff_register WHERE revision=?').bind(saved.revision).first();
   check(register?.action==='source_history_import'&&JSON.parse(register.payload).source_history_imports?.includes(state.latest_history_import),'The history import revision is missing.',409);
   latestHistory={...saved,checksum_verified:true,completed_at:latest.batch.completed_at};
  }
  const payrollTable=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_staff_payroll'").first();
  const latestSettings=payrollTable?await db.prepare("SELECT payload,revision FROM v2_staff_payroll WHERE entity_key='settings' ORDER BY revision DESC LIMIT 1").first():null;
  const settings=JSON.parse(latestSettings?.payload??'{}');
  const active=state.people.filter(p=>p.active && (!p.start_date||p.start_date<=FRESH_START.first_pay_date));
  const setup={
   configured_payroll_admins:Object.keys(keys(env)).filter(isAdmin),
   week_start:FRESH_START.start_date, first_friday_configured:settings.company?.first_pay_date??null,
   fresh_start_active:!!settings.fresh_start, settings_revision:latestSettings?.revision??null,
   saved_profiles:settings.profiles?.length??0, active_people:active.length,
   active_with_effective_profile:active.filter(p=>profileAt(settings,p.id,FRESH_START.start_date)).length,
   active_needing_employment_check:active.filter(p=>!p.start_date||p.employment_verified===false).length
  };
  return result({initialized:true,first_week_setup:setup,import_verified:!!verified?.linked_to_current_register,verified_import:verified,latest_history:latestHistory,imports,
   current:{people:state.people.length,active:state.people.filter(p=>p.active).length,inactive:state.people.filter(p=>!p.active).length,
    employment_dates_unconfirmed:state.people.filter(p=>p.employment_verified===false).length,missing_start_dates:state.people.filter(p=>!p.start_date).length,
    without_schedules:state.people.filter(p=>p.active&&!p.schedules.length).length,leave_requests:state.leave.length,leave_ledger_entries:state.ledger.length},
   uif_workflow:state.uif_workflow??{calculation:'Fen Meat',payment_to_auditors:'Alex',submission:'Auditors'}});
 }
 if(resource==='people'){
  const q=(args.q??'').trim().toLowerCase(),offset=args.offset??0;
  const selected=state.people.filter(p=>(!args.employee_id||p.id===args.employee_id)&&(!q||(p.name+' '+p.code).toLowerCase().includes(q)));
  if(args.employee_id)check(selected.length,'Employee not found.',404);
  return result({total:selected.length,offset,people:selected.slice(offset,offset+50).map(p=>({id:p.id,code:p.code,name:p.name,team:p.team,employment_type:p.employment_type,active:p.active,start_date:p.start_date,employment_verified:p.employment_verified!==false,schedules:p.schedules,
   balances_as_of:today(),balances:Object.fromEntries(LEAVE_TYPES.filter(t=>t!=='Unpaid').map(t=>[t,balance(state,p.id,t,today())])),
   source_import:p.source_profile?.import_id??null,source_issues:p.source_profile?.issues??[],...(args.employee_id?{source_profile:p.source_profile??null}:{})})),
   private_profile_included:!!args.employee_id});
 }
 if(resource==='source_rows'){
  const id=args.import_id??state.latest_history_import??state.source_import;check(id,'No source import is linked. Read summary first.',409);check(Number.isInteger(args.sheet_id),'Choose a sheet ID from summary.');
  const url=new URL('https://fenmeat.invalid/api/staff/imports/rows');for(const[k,v]of Object.entries({id,sheet:args.sheet_id,q:args.q??'',offset:args.offset??0}))url.searchParams.set(k,String(v));
  return result(await staffImportApi({request:new Request(url),url,db,user:{username},bodyOf,current}));
 }
 if(resource==='attendance'){
  const from=dateKey(args.from),to=dateKey(args.to);
  check(from<=to&&to<=addDays(from,30),'Choose at most 31 calendar days.');
  const name=args.q?.trim().toLowerCase();
  const candidates=name?state.people.filter(p=>[p.name,p.code,p.name.split(/\s+/)[0]].some(value=>value?.toLowerCase()===name)):[];
  if(!args.employee_id&&candidates.length!==1){
   check(false,candidates.length?'Meer as een werknemer pas. Kies die werknemer uit die personeellys.':'Kies ’n werknemer of soek die volle naam in die personeellys.');
  }
  const person=staffPerson(state,args.employee_id??candidates[0].id);
  const shifts=await shiftsBetween(db,from,to,person.id);
  const [row]=periodHours([person],shifts,state.leave,from,to);
  return {from,to,name:person.name,...row,attendance_complete:row.issues.length===0,
   source_kind:'native_clock_and_approved_leave',revision:current.revision,saved_at:current.saved_at,connection};
 }
 if(resource==='hours'||resource==='wages'){
  const timeBefore=(await db.prepare('SELECT COALESCE(MAX(rowid),0) revision FROM v2_staff_time').first()).revision;
  const from=dateKey(args.from),to=dateKey(args.to);check(from<=to&&to<=addDays(from,30),'Choose at most 31 calendar days.');
  const url=new URL('https://fenmeat.invalid/api/staff/hours');url.searchParams.set('from',from);url.searchParams.set('to',to);if(args.employee_id)url.searchParams.set('employee_id',args.employee_id);
  const hours=resource==='wages'?{}:await staffApi({request:new Request(url),url,env:{DB:db},user:{username},bodyOf,registerSnapshot:current});
  // A bounded week read can reconcile the displayed payroll hours with punches.
  // Use the same live wage preview as Staff, including completeness and deductions.
  const friday=nextFriday(from);
  if(resource==='wages'){
   check(from===addDays(friday,-4)&&to===friday&&from>=FRESH_START.start_date,'Kies die betaalweek van Maandag tot Vrydag.');
   if(args.employee_id)staffPerson(state,args.employee_id);
  }
  if(from>=FRESH_START.start_date && from>=addDays(friday,-4) && to<=friday &&
    await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_staff_payroll'").first()){
   const payrollUrl=new URL('/api/staff/payroll',url);payrollUrl.searchParams.set('pay_date',friday);payrollUrl.searchParams.set('view','wages');
   const week=await staffApi({request:new Request(payrollUrl),url:payrollUrl,env:{DB:db},user:{username},bodyOf,registerSnapshot:current,payrollRunOnly:true});
   hours.payroll={pay_date:friday,from:week.run.from,to:week.run.to,source:week.source,generated_at:connection.generated_at,
    rows:week.run.rows.filter(r=>!args.employee_id||r.employee_id===args.employee_id).map(r=>({
     employee_id:r.employee_id,name:r.name,employment_type:r.employment_type,ready:r.ready===true,
     status:r.wage_state??'Draft',issues:r.issues??[],rate_cents:r.profile?.rate_cents??null,
     ordinary_seconds:r.ordinary_seconds,overtime_seconds:r.overtime_seconds,leave_seconds:r.leave_seconds,
     gross_cents:r.gross_cents??null,paye_cents:r.paye_cents??null,uif_employee_cents:r.uif_employee_cents??null,
     meat_cents:r.meat_cents??null,other_deduction_cents:r.other_deduction_cents??null,net_cents:r.net_cents??null,
     days:r.source.days.map(d=>({date:d.date,first_in:d.first_in,last_out:d.last_out,payable_seconds:d.payable_seconds,
      recorded_break_seconds:d.recorded_break_seconds,automatic_break_seconds:d.automatic_break_seconds,
      paid_leave_minutes:d.paid_leave_minutes,issues:d.issues})),
     amount_is_final:r.ready===true||['Approved','Paid'].includes(r.wage_state)
    }))};
   if(resource==='hours')hours.payroll_hours={status:week.run.status,refresh_needed:week.stale,saved:week.saved,rows:week.run.rows
    .filter(r=>!args.employee_id||r.employee_id===args.employee_id)
    .map(r=>({employee_id:r.employee_id,rotating:r.profile?.monday_rotation??(r.profile?.break_rule==='60 minutes if no break recorded'),
     days:r.source.days.filter(d=>d.date>=from&&d.date<=to).map(d=>({date:d.date,workplace:d.workplace,
      basis:d.workplace_basis,confirm:d.needs_workplace,first_in:d.first_in,last_out:d.last_out,
      recorded_break_seconds:d.recorded_break_seconds,clock_gap_seconds:d.clock_gap_seconds,automatic_break_seconds:d.automatic_break_seconds,
      adjustment_minutes:d.adjustment_minutes,payable_seconds:d.payable_seconds,paid_day_off:r.paid_days?.includes(d.date)??false}))}))};
  }
  const timeAfter=(await db.prepare('SELECT COALESCE(MAX(rowid),0) revision FROM v2_staff_time').first()).revision;
  if(timeBefore!==timeAfter){check(attempt<1,'Clock records changed during reading. Read the week again before calculating wages.',409);return readStaffData(args,env,username,scopes,attempt+1);}
  if(resource==='wages'){
   check(hours.payroll,'Payroll is nog nie gereed vir hierdie week nie.',409);
   const complete=hours.payroll.rows.length>0&&hours.payroll.rows.every(row=>row.amount_is_final);
   return result({payroll:hours.payroll,payroll_complete:complete,time_version:timeAfter});
  }
  hours.payroll_complete=!!hours.payroll?.rows.length&&hours.payroll.rows.every(r=>r.amount_is_final);
  hours.attendance_complete=hours.rows.filter(r=>state.people.some(p=>p.id===r.employee_id&&p.active)).every(r=>r.issues.length===0);
  hours.attendance_warnings=hours.payroll?hours.payroll.rows.filter(r=>!r.amount_is_final).map(r=>({employee_id:r.employee_id,name:r.name,issues:r.issues})):hours.rows.filter(r=>r.issues.length).map(r=>({employee_id:r.employee_id,issues:r.issues}));
  hours.time_version=timeAfter;
  return result({...hours,source_kind:'native_clock_and_approved_leave'});
 }
 if(resource==='leave'){
  check(args.employee_id,'Choose an employee ID to read private leave details.');check(state.people.some(p=>p.id===args.employee_id),'Employee not found.',404);
  const offset=args.offset??0,leave=state.leave.filter(r=>r.employee_id===args.employee_id),ledger=state.ledger.filter(r=>r.employee_id===args.employee_id);
  return result({employee_id:args.employee_id,offset,leave_total:leave.length,ledger_total:ledger.length,leave:leave.slice(offset,offset+50),ledger:ledger.slice(offset,offset+50),source_kind:'native_leave_only'});
 }
 check(false,'Unknown Staff read resource.',404);
}
