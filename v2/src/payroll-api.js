import {check,dateKey,addDays,today,UserError} from './domain.js';
import {text,uuid} from './staff-domain.js';
import {isAdmin} from "./auth.js";
import {BREAK_RULE_VERSION,FRESH_START,PAYROLL_RULES,friday,nextFriday,validateCompany,validateProfile,validateOpening,profileAt,calculateRow,priorFor,paidDaySeconds,payrollBirthCheck,suggestRows,totalRows,monthlyReport} from './payroll-domain.js';

export const PAYROLL_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_staff_payroll (revision INTEGER PRIMARY KEY, entity_key TEXT NOT NULL, payload TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS v2_staff_payroll_entity ON v2_staff_payroll(entity_key,revision)`
];
async function savedState(db){
 const all=(await db.prepare(`SELECT p.* FROM v2_staff_payroll p WHERE NOT EXISTS (SELECT 1 FROM v2_staff_payroll n WHERE n.entity_key=p.entity_key AND n.revision>p.revision)`).all()).results;
 const records=all.map(r=>({...JSON.parse(r.payload),saved_revision:r.revision,saved_at:r.saved_at,saved_by:r.actor}));
 return {revision:Math.max(0,...all.map(r=>r.revision)),settings:records.find(r=>r.key==='settings')??{key:'settings',company:null,profiles:[]},openings:records.filter(r=>r.key.startsWith('opening:')),runs:records.filter(r=>r.key.startsWith('run:'))};
}
function carryDraftInputs(row,old){
 if(!old)return row;
 const inputs=['paid_days','paid_days_note','included','sunday_seconds','holiday_seconds','special_cents','bonus_cents','commission_cents','paye_cents','meat_cents','other_deduction_cents','uif','uif_reason','note','paye_method','standard_week_confirmed','cutover_uif','current_employee_cents','current_employer_cents'];
 for(const key of inputs)if(old[key]!==undefined)row[key]=old[key];
 for(const key of Object.keys(row.suggested_hours)){
  if(old.suggested_hours?old[key]!==old.suggested_hours[key]:old.reviewed){
   row[key]=old[key];
   if(old.suggested_hours && old.suggested_hours[key]!==row.suggested_hours[key])
    row.issues.push('Die klokvoorstel het verander. Vergelyk die bewaarde handmatige weekure met die daaglikse ure.');
  }
 }
 return row;
}
export async function payrollApi({request,url,db,user,bodyOf,current,operation,shiftsBetween,env}){
 const state=await savedState(db),timeVersion=(await db.prepare('SELECT COALESCE(MAX(rowid),0) revision FROM v2_staff_time').first()).revision;
 const fresh=state.settings.fresh_start;
 const source={staff_revision:current.revision,time_version:timeVersion,payroll_revision:state.revision};
 const stale=run=>run?.status==='Draft'&&(JSON.stringify(run.source)!==JSON.stringify(source) ||
  (run.pay_date>=FRESH_START.first_pay_date && run.rules?.version!==BREAK_RULE_VERSION));
 const preview=async (date,edits)=>{
  const saved=state.runs.find(r=>r.pay_date===date);
  edits??=Object.fromEntries((saved?.rows??[]).map(r=>[r.employee_id,r.day_edits??{}]));
  const from=fresh && date===fresh.first_pay_date?fresh.start_date:addDays(date,-6);
  const shifts=await shiftsBetween(db,from,date),rows=suggestRows(current.state,shifts,state.settings,date,edits);
  for(const row of rows)row.suggested_hours={ordinary_seconds:row.ordinary_seconds,overtime_seconds:row.overtime_seconds,leave_seconds:row.leave_seconds};
  return {key:'run:'+date,pay_date:date,from:addDays(date,-4),to:date,status:'Draft',source,rules:date>=FRESH_START.first_pay_date?{...PAYROLL_RULES,version:BREAK_RULE_VERSION}:PAYROLL_RULES,company:state.settings.company,rows,totals:totalRows([])};
 };
 const reviewedAmounts=async(raw,profile,person,date,clockRow)=>{
  const operational=!!fresh && date>=fresh.first_pay_date;
  const prior=priorFor(person.id,date,operational?state.runs.filter(r=>r.pay_date>=fresh.first_pay_date):state.runs,operational?[]:state.openings);
  const externalHistory=operational && date.slice(0,7)===fresh.start_date.slice(0,7) && person.start_date<fresh.start_date;
  const options={externalHistory};
  if(profile.fen_hourly_only){
   const identityIssue=payrollBirthCheck(person,profile);check(!identityIssue,identityIssue);
   options.paidOffSeconds=paidDaySeconds(clockRow.paid_days??[],clockRow.source.days);
  }
  if(raw.paye_method==='SARS weekly table'){
   check(operational,'Start the new payroll before using weekly tax tables.');
   const {weeklyPaye}=await import('./weekly-paye.js');
   options.weeklyTax=cents=>weeklyPaye(cents,date,{...person,birth_date:profile.tax_birth_date??person.birth_date},addDays(date,-4));
  }
  return calculateRow(raw,profile,prior,options);
 };
 const payDate=friday(url.searchParams.get('pay_date')??nextFriday());
 if(request.method==='GET'){
  if(url.pathname.endsWith('/history'))return {events:(await db.prepare("SELECT revision,entity_key,action,actor,saved_at,json_extract(payload, '$.change_note') AS reason FROM v2_staff_payroll ORDER BY revision DESC LIMIT 100").all()).results};
  const historical=fresh && payDate<fresh.first_pay_date;
  const stored=state.runs.find(r=>r.pay_date===payDate);
  const run=stored??(historical?{status:'Reference',pay_date:payDate,from:addDays(payDate,-4),to:payDate,rows:[],totals:null}:await preview(payDate));
  if(run.status==='Draft'){
   if(stale(run) && payDate>=FRESH_START.first_pay_date){
    const currentWeek=await preview(payDate);
    run.rows=run.rows.map(old=>{
     const updated=currentWeek.rows.find(r=>r.employee_id===old.employee_id);
     return updated?carryDraftInputs(updated,old):old;
    });
    run.totals=totalRows(run.rows.filter(r=>r.reviewed));
   }
   for(const row of run.rows.filter(r=>r.profile?.fen_hourly_only && !r.reviewed)){
    const person=current.state.people.find(p=>p.id===row.employee_id);
    const issue=payrollBirthCheck(person,row.profile);
    try{
     const paidOffSeconds=paidDaySeconds(row.paid_days??[],row.source.days);
     if(row.paid_days?.length && row.issues.includes('Missing attendance record')){
      const missing=row.source.days.filter(day=>day.issues.includes('Missing attendance record') && !row.paid_days.includes(day.date));
      row.issues=row.issues.filter(issue=>issue!=='Missing attendance record');
      row.issues.push(...missing.map(day=>day.date+': missing attendance record'));
     }
     const prior=priorFor(person.id,payDate,state.runs.filter(r=>!fresh||r.pay_date>=fresh.first_pay_date),fresh?[]:state.openings);
     const amounts=calculateRow({...row,paye_cents:null},row.profile,prior,{paidOffSeconds});
     row.estimate=amounts;
     if(issue)row.issues.push(issue);
     const {weeklyPaye,ageIndependentEstimate}=await import('./weekly-paye.js');
     if(!row.special_cents){
      const tax=issue?ageIndependentEstimate(amounts.gross_cents,payDate,person,run.from):weeklyPaye(amounts.gross_cents,payDate,{...person,birth_date:row.profile.tax_birth_date??person.birth_date},run.from);
      if(tax!==null)row.estimate={...amounts,paye_cents:tax,net_cents:amounts.gross_cents-tax-amounts.uif_employee_cents-amounts.meat_cents-amounts.other_deduction_cents};
     }
    }catch(error){if(!(error instanceof UserError))throw error;row.issues=[...row.issues,error.message];}
   }
  }
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
  if(profile.fen_hourly_only)check(fresh,'Activate the existing payroll start before selecting this arrangement.');
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
   if(existing?.status==='Draft')record.rows=record.rows.map(row=>carryDraftInputs(row,existing.rows.find(x=>x.employee_id===row.employee_id)));
  }else if(b.action==='day_edit'){
   check(date>=FRESH_START.first_pay_date,'Earlier payroll is read-only.');
   check(!existing || existing.status==='Draft','Approved payroll is locked.');
   record=existing??await preview(date);
   check(!stale(record),'Refresh the draft before saving a correction.',409);
   const id=uuid(b.employee_id),day=dateKey(b.day);
   const index=record.rows.findIndex(r=>r.employee_id===id);
   const old=record.rows[index],previous=old?.source.days.find(d=>d.date===day);
   check(previous && day<=today(),'Choose a day in this payroll week that has already occurred.');
   check(['Auto','Route','Factory'].includes(b.workplace),'Choose the workplace.');
   check(b.workplace==='Auto'||previous.monday_rotation,'Workplace overrides apply to rotating Monday staff only.');
   check(Number.isSafeInteger(b.minutes)&&Math.abs(b.minutes)<=1440,'Enter the correction in whole minutes.');
   const reason=text(b.note,'reason for changing the draft',400);
   const edit={workplace:b.workplace==='Auto'?null:b.workplace,minutes:b.minutes,reason,by:user.username,at:stamp};
   const edits={...old.day_edits,[day]:edit};
   const updated=(await preview(date,{[id]:edits})).rows.find(r=>r.employee_id===id);
   const revised=updated.source.days.find(d=>d.date===day);
   check(revised.clock_payable_seconds+b.minutes*60>=0 && revised.clock_payable_seconds+b.minutes*60<=86400,'The correction must leave between 0 and 24 payable hours.');
   edit.baseline_seconds=revised.clock_payable_seconds;
   record.rows[index]=carryDraftInputs(updated,old);
   record.change_note=old.name+' · '+day+' · '+b.workplace+' · '+b.minutes+' min · '+reason;
  }else if(b.action==='paid_days'){
   record=existing??await preview(date);
   check(record.status==='Draft','Approved payroll is locked.');
   const id=uuid(b.employee_id),index=record.rows.findIndex(r=>r.employee_id===id);
   check(index>=0,'This employee is not in the draft.');
   if(stale(record)){
    const updated=(await preview(date)).rows.find(r=>r.employee_id===id);
    check(updated?.profile?.fen_hourly_only,'Confirm the current pay profile first.');
    record.rows[index]=carryDraftInputs(updated,record.rows[index]);
   }
   const row=record.rows[index];
   check(row?.profile?.fen_hourly_only,'Choose the FenMeat hourly arrangement under Pay setup first.');
   paidDaySeconds(b.dates,row.source.days);
   row.paid_days=[...b.dates].sort();row.paid_days_note=text(b.note,'source for paid days off',500);
   row.reviewed=false;delete row.reviewed_by;delete row.reviewed_at;
   for(const key of ['ordinary_cents','overtime_cents','paid_off_cents','paid_off_seconds','leave_cents','gross_cents','uif_base_cents','uif_employee_cents','uif_employer_cents','net_cents','attendance_resolved','standard_week_confirmed','cutover_uif','current_employee_cents','current_employer_cents'])delete row[key];
   row.paye_cents=null;
  }else if(b.action==='row'){
   record=existing??await preview(date);check(record.status==='Draft','Approved payroll is locked.');check(!stale(record),'Payroll inputs changed. Use Refresh draft, then review the rows again.',409);
   const id=uuid(b.row.employee_id),index=record.rows.findIndex(r=>r.employee_id===id);check(index>=0,'This employee is not in the draft.');
   const old=record.rows[index],included=b.row.included===true,note=text(b.row.note,'review / exclusion note',500);
   let row={...old,included,note,reviewed:true,reviewed_by:user.username,reviewed_at:stamp};
   if(included){
    check(!old.source.days.some(d=>d.needs_workplace || d.needs_adjustment_review),'Bevestig die werksplek of gaan die gemerkte dagregstelling na.');
    const profile=profileAt(state.settings,id,record.from);check(profile,'Confirm the pay setup first.');
    const p=current.state.people.find(x=>x.id===id);check(p.start_date&&p.employment_verified!==false,'Confirm this employee’s employment start under People first.');
    for(const key of ['paye_method','standard_week_confirmed','cutover_uif','current_employee_cents','current_employer_cents'])delete row[key];
    if(profile.fen_hourly_only){
     check(date<=today() && !old.issues.includes('Open shift'),'Finish the week and close open shifts before reviewing final pay. Paid days off can be saved as a draft now.');
     check(b.row.attendance_resolved===true,'Check every scheduled day, actual breaks, overtime and exceptions first.');
     row.attendance_resolved=true;
    }
    row={...row,...await reviewedAmounts(b.row,profile,p,date,old),profile};
    check(row.paye_cents!==null,'Enter the PAYE confirmed by the auditors, including an explicit 0 where applicable.');
    check(b.row.confirmed===true,'Confirm the hours, rate, breaks, bonus, deductions and tax treatment.');
   }
   record.rows[index]=row;record.change_note=old.name+' · '+note;
  }else if(b.action==='approve'){
   check(existing?.status==='Draft','Save and review a draft first.');check(!stale(existing),'Payroll inputs changed. Refresh the draft and review it again.',409);
   const company=state.settings.company;check(company,'Save employer details first.');check(date>=company.first_pay_date,'This pay date is before the first Fen payroll date.');check(date<=today(),'Future payroll cannot be approved.');
   check(existing.rows.length&&existing.rows.every(r=>r.reviewed),'Review every employee, including exclusions.');
   check(existing.rows.some(r=>r.included),'Include at least one employee.');
   if(existing.rows.some(r=>r.profile?.fen_hourly_only))check(user.username==='alinda','Alinda must approve this week after checking the hourly arrangement.');
   check(!state.runs.some(r=>['Approved','Paid'].includes(r.status)&&r.pay_date>date),'A later payroll is already approved. Earlier payroll cannot be inserted behind it.');
   const previous=addDays(date,-7);check(previous<company.first_pay_date||state.runs.some(r=>r.pay_date===previous&&['Approved','Paid'].includes(r.status)),'Approve the previous Friday first so the monthly UIF history is complete.');
   check(existing.rows.filter(r=>r.included).every(r=>!r.issues.includes('Open shift')),'Complete or correct open shifts before approving payroll.');
   const rows=await Promise.all(existing.rows.map(async r=>{
    if(!r.included)return r;
    check(!r.source.days.some(d=>d.needs_workplace||d.needs_adjustment_review),'Confirm outstanding daily corrections before approving payroll.');
    check(fresh||date.slice(0,7)!==company.first_pay_date.slice(0,7)||state.openings.some(o=>o.month===date.slice(0,7)&&o.employee_id===r.employee_id),'Record the verified month opening for '+r.name+', including explicit zeros for a new worker.');
    if(r.profile.fen_hourly_only)check(r.reviewed_by==='alinda'&&r.attendance_resolved,'Alinda must review and approve this employee’s pay.');
    return {...r,...await reviewedAmounts(r,r.profile,current.state.people.find(p=>p.id===r.employee_id),date,r)};
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
  record.totals=totalRows(record.status==='Draft'?record.rows.filter(r=>r.reviewed):record.rows);if(record.status==='Draft' && !(b.action==='paid_days' && stale(record)))record.source={...source,payroll_revision:next};
 }
 if(b.action!=='row' && b.action!=='day_edit')delete record.change_note;
 delete record.saved_revision;delete record.saved_at;delete record.saved_by;
 check(JSON.stringify(record).length<650000,'Payroll record is too large.');
 // Serialized global payroll revision protects monthly UIF against two runs
 // approving concurrently. Clock and Staff guards are checked inside D1 batch.
 const guard=db.prepare(`INSERT INTO v2_staff_requests(id,request_hash,result) SELECT ?, '', '' WHERE (SELECT COALESCE(MAX(revision),0) FROM v2_staff_register)!=? OR (SELECT COALESCE(MAX(rowid),0) FROM v2_staff_time)!=?`).bind(op.id,current.revision,timeVersion);
 const insert=db.prepare('INSERT INTO v2_staff_payroll VALUES(?,?,?,?,?,?)').bind(next,record.key,JSON.stringify(record),b.action,user.username,stamp);
 return op.commit([guard,insert],{ok:true,revision:current.revision,payroll_revision:next,status:record.status??'Saved'});
}
