import {check,dateKey,addDays,today,UserError} from './domain.js';
import {text,uuid} from './staff-domain.js';
import {isAdmin} from "./auth.js";
import {FRESH_START,PAYROLL_RULES,friday,nextFriday,validateCompany,validateProfile,validateOpening,profileAt,calculateRow,priorFor,suggestRows,totalRows,monthlyReport} from './payroll-domain.js';

export const PAYROLL_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_staff_payroll (revision INTEGER PRIMARY KEY, entity_key TEXT NOT NULL, payload TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS v2_staff_payroll_entity ON v2_staff_payroll(entity_key,revision)`
];
async function savedState(db){
 const all=(await db.prepare(`SELECT p.* FROM v2_staff_payroll p WHERE NOT EXISTS (SELECT 1 FROM v2_staff_payroll n WHERE n.entity_key=p.entity_key AND n.revision>p.revision)`).all()).results;
 const records=all.map(r=>({...JSON.parse(r.payload),saved_revision:r.revision,saved_at:r.saved_at,saved_by:r.actor}));
 return {revision:Math.max(0,...all.map(r=>r.revision)),settings:records.find(r=>r.key==='settings')??{key:'settings',company:null,profiles:[]},openings:records.filter(r=>r.key.startsWith('opening:')),runs:records.filter(r=>r.key.startsWith('run:'))};
}
export async function payrollApi({request,url,db,user,bodyOf,current,operation,shiftsBetween,env}){
 const state=await savedState(db),timeVersion=(await db.prepare('SELECT COALESCE(MAX(rowid),0) revision FROM v2_staff_time').first()).revision;
 const fresh=state.settings.fresh_start;
 const source={staff_revision:current.revision,time_version:timeVersion,payroll_revision:state.revision};
 const stale=run=>run?.status==='Draft'&&JSON.stringify(run.source)!==JSON.stringify(source);
 const preview=async date=>{
  const from=fresh && date===fresh.first_pay_date?fresh.start_date:addDays(date,-6);
  const shifts=await shiftsBetween(db,from,date),rows=suggestRows(current.state,shifts,state.settings,date);
  for(const row of rows)row.suggested_hours={ordinary_seconds:row.ordinary_seconds,overtime_seconds:row.overtime_seconds,leave_seconds:row.leave_seconds};
  return {key:'run:'+date,pay_date:date,from:addDays(date,-4),to:date,status:'Draft',source,rules:PAYROLL_RULES,company:state.settings.company,rows,totals:totalRows([])};
 };
 const reviewedAmounts=async(raw,profile,person,date)=>{
  const operational=!!fresh && date>=fresh.first_pay_date;
  const prior=priorFor(person.id,date,operational?state.runs.filter(r=>r.pay_date>=fresh.first_pay_date):state.runs,operational?[]:state.openings);
  const externalHistory=operational && date.slice(0,7)===fresh.start_date.slice(0,7) && person.start_date<fresh.start_date;
  const options={externalHistory};
  if(raw.paye_method==='SARS weekly table'){
   check(operational,'Start the new payroll before using weekly tax tables.');
   const {weeklyPaye}=await import('./weekly-paye.js');
   options.weeklyTax=cents=>weeklyPaye(cents,date,person,addDays(date,-4));
  }
  return calculateRow(raw,profile,prior,options);
 };
 const payDate=friday(url.searchParams.get('pay_date')??nextFriday());
 if(request.method==='GET'){
  if(url.pathname.endsWith('/history'))return {events:(await db.prepare('SELECT revision,entity_key,action,actor,saved_at FROM v2_staff_payroll ORDER BY revision DESC LIMIT 100').all()).results};
  const run=state.runs.find(r=>r.pay_date===payDate)??await preview(payDate);
  return {can_start_fresh:isAdmin(user.username),revision:state.revision,source,settings:state.settings,openings:state.openings,run,stale:stale(run),saved:!!run.saved_revision,runs:state.runs.map(({pay_date,status,totals,saved_at})=>({pay_date,status,totals,saved_at})).sort((a,b)=>b.pay_date.localeCompare(a.pay_date)),month:monthlyReport(url.searchParams.get('month')??payDate.slice(0,7),state.runs,state.openings,state.settings.company,current.state.people,fresh)};
 }
 check(request.method==='POST','Not found.',404);
 const b=await bodyOf(request),op=await operation(db,user.username,url.pathname,b,env);if(op.old)return op.old;
 if(b.action==='fresh_start'){
  check(isAdmin(user.username),'Only Alex or Alinda can start the new payroll.',403);
  if(fresh)return {ok:true,status:'Already started',revision:current.revision,payroll_revision:state.revision};
 }
 check(b.payroll_revision===state.revision&&b.revision===current.revision,'Payroll or Staff records changed. Reload Payroll before saving.',409);
 check(b.time_version===timeVersion,'Clock records changed. Reload and refresh the draft before saving.',409);
 const stamp=new Date().toISOString(),next=state.revision+1;let record;
 const date=b.pay_date?friday(b.pay_date):null,existing=date?state.runs.find(r=>r.pay_date===date):null;
 const locked=()=>state.runs.some(r=>['Approved','Paid'].includes(r.status));
 if(b.action==='fresh_start'){
  check(state.settings.company,'Save the employer name and address under Pay setup first.');
  check(!state.runs.some(r=>r.pay_date>=FRESH_START.first_pay_date&&['Approved','Paid'].includes(r.status)),
   'An approved payroll already exists on or after 20 November. Review that run before changing the start.');
  record={...state.settings,company:{...state.settings.company,first_pay_date:FRESH_START.first_pay_date},
   fresh_start:{...FRESH_START,activated_by:user.username,activated_at:stamp}};
 }else if(b.action==='company'){
  const company=validateCompany(b.company);
  check(!(fresh||locked()||state.openings.length)||state.settings.company.first_pay_date===company.first_pay_date,'The first Fen pay date is locked after a payroll approval.');
  record={...state.settings,company};
 }else if(b.action==='profile'){
  const profile={...validateProfile(b.profile,current.state.people),confirmed_by:user.username,confirmed_at:stamp};
  record={...state.settings,profiles:[...state.settings.profiles.filter(p=>!(p.employee_id===profile.employee_id&&p.from===profile.from)),profile]};
 }else if(b.action==='opening'){
  check(!fresh,'Earlier payroll is kept for reference by the auditors.');
  const opening=validateOpening(b.opening,current.state.people,state.settings.company);
  check(!state.runs.some(r=>['Approved','Paid'].includes(r.status)&&r.pay_date.slice(0,7)===opening.month&&r.rows.some(x=>x.included&&x.employee_id===opening.employee_id)),'This opening amount is locked because a payroll using it has been approved.');
  record={...opening,key:'opening:'+opening.month+':'+opening.employee_id};
 }else{
  check(date,'Choose a pay date.');
  check(!fresh||date>=fresh.first_pay_date,'This payroll is historical and read-only.');
  if(b.action==='refresh'){
   check(!existing||['Draft','Voided'].includes(existing.status),'Approved payroll is locked.');
   record=await preview(date);
   // Keep saved manual inputs, but require review against the fresh evidence.
   if(existing?.status==='Draft')record.rows=record.rows.map(row=>{
    const old=existing.rows.find(x=>x.employee_id===row.employee_id);
    if(!old)return row;
    const inputs=['included','sunday_seconds','holiday_seconds','special_cents','bonus_cents','commission_cents','paye_cents','meat_cents','other_deduction_cents','uif','uif_reason','note','paye_method','standard_week_confirmed','cutover_uif','current_employee_cents','current_employer_cents'];
    for(const key of inputs)if(old[key]!==undefined)row[key]=old[key];
    for(const key of Object.keys(row.suggested_hours)){
     if(old.suggested_hours?old[key]!==old.suggested_hours[key]:old.reviewed)row[key]=old[key];
    }
    return row;
   });
  }else if(b.action==='row'){
   record=existing??await preview(date);check(record.status==='Draft','Approved payroll is locked.');check(!stale(record),'Payroll inputs changed. Use Refresh draft, then review the rows again.',409);
   const id=uuid(b.row.employee_id),index=record.rows.findIndex(r=>r.employee_id===id);check(index>=0,'This employee is not in the draft.');
   const old=record.rows[index],included=b.row.included===true,note=text(b.row.note,'review / exclusion note',500);
   let row={...old,included,note,reviewed:true,reviewed_by:user.username,reviewed_at:stamp};
   if(included){
    const profile=profileAt(state.settings,id,record.from);check(profile,'Confirm the pay setup first.');
    const p=current.state.people.find(x=>x.id===id);check(p.start_date&&p.employment_verified!==false,'Confirm this employee’s employment start under People first.');
    for(const key of ['paye_method','standard_week_confirmed','cutover_uif','current_employee_cents','current_employer_cents'])delete row[key];
    row={...row,...await reviewedAmounts(b.row,profile,p,date),profile};
    check(row.paye_cents!==null,'Enter the PAYE confirmed by the auditors, including an explicit 0 where applicable.');
    check(b.row.confirmed===true,'Confirm the hours, rate, breaks, bonus, deductions and tax treatment.');
   }
   record.rows[index]=row;
  }else if(b.action==='approve'){
   check(existing?.status==='Draft','Save and review a draft first.');check(!stale(existing),'Payroll inputs changed. Refresh the draft and review it again.',409);
   const company=state.settings.company;check(company,'Save employer details first.');check(date>=company.first_pay_date,'This pay date is before the first Fen payroll date.');check(date<=today(),'Future payroll cannot be approved.');
   check(existing.rows.length&&existing.rows.every(r=>r.reviewed),'Review every employee, including exclusions.');
   check(existing.rows.some(r=>r.included),'Include at least one employee.');
   check(!state.runs.some(r=>['Approved','Paid'].includes(r.status)&&r.pay_date>date),'A later payroll is already approved. Earlier payroll cannot be inserted behind it.');
   const previous=addDays(date,-7);check(previous<company.first_pay_date||state.runs.some(r=>r.pay_date===previous&&['Approved','Paid'].includes(r.status)),'Approve the previous Friday first so the monthly UIF history is complete.');
   check(existing.rows.filter(r=>r.included).every(r=>!r.issues.includes('Open shift')),'Complete or correct open shifts before approving payroll.');
   const rows=await Promise.all(existing.rows.map(async r=>{
    if(!r.included)return r;
    check(fresh||date.slice(0,7)!==company.first_pay_date.slice(0,7)||state.openings.some(o=>o.month===date.slice(0,7)&&o.employee_id===r.employee_id),'Record the verified month opening for '+r.name+', including explicit zeros for a new worker.');
    return {...r,...await reviewedAmounts(r,r.profile,current.state.people.find(p=>p.id===r.employee_id),date)};
   }));
   record={...existing,rows,status:'Approved',company,approved_by:user.username,approved_at:stamp,approval_note:text(b.note,'approval note',500)};
  }else if(b.action==='paid'){
   check(existing?.status==='Approved','Only approved payroll can be marked paid.');const paid_on=dateKey(b.paid_on);check(paid_on<=today()&&paid_on>=existing.pay_date,'Use a payment date from the pay date through today.');
   record={...existing,status:'Paid',paid_on,payment_reference:text(b.note,'payment reference / note',300),paid_by:user.username,paid_at:stamp};
  }else if(b.action==='void'){
   check(existing?.status==='Approved','Only an approved, unpaid run can be voided. Paid records remain locked.');
   check(!state.runs.some(r=>['Approved','Paid'].includes(r.status)&&r.pay_date>date),'Void later unpaid runs first; subsequent UIF calculations depend on this run.');
   record={...existing,status:'Voided',void_reason:text(b.note,'void reason',500),void_by:user.username,void_at:stamp};
  }else throw new UserError('Unknown payroll action.');
  record.totals=totalRows(record.status==='Draft'?record.rows.filter(r=>r.reviewed):record.rows);if(record.status==='Draft')record.source={...source,payroll_revision:next};
 }
 delete record.saved_revision;delete record.saved_at;delete record.saved_by;
 check(JSON.stringify(record).length<650000,'Payroll record is too large.');
 // Serialized global payroll revision protects monthly UIF against two runs
 // approving concurrently. Clock and Staff guards are checked inside D1 batch.
 const guard=db.prepare(`INSERT INTO v2_staff_requests(id,request_hash,result) SELECT ?, '', '' WHERE (SELECT COALESCE(MAX(revision),0) FROM v2_staff_register)!=? OR (SELECT COALESCE(MAX(rowid),0) FROM v2_staff_time)!=?`).bind(op.id,current.revision,timeVersion);
 const insert=db.prepare('INSERT INTO v2_staff_payroll VALUES(?,?,?,?,?,?)').bind(next,record.key,JSON.stringify(record),b.action,user.username,stamp);
 return op.commit([guard,insert],{ok:true,revision:current.revision,payroll_revision:next,status:record.status??'Saved'});
}
