import {check,dateKey,addDays,today,UserError} from './domain.js';
import {text,uuid} from './staff-domain.js';
import {posted,postedRun,rebuildWages,selectWageRows,wageTotals} from './pay-wages.js';
import {isAdmin} from "./auth.js";
import {BREAK_RULE_VERSION,FRESH_START,PAYROLL_RULES,friday,nextFriday,validateCompany,validateProfile,validateOpening,profileAt,calculateRow,priorFor,paidDaySeconds,payrollBirthCheck,suggestRows,totalRows,monthlyReport} from './payroll-domain.js';

export const PAYROLL_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_staff_payroll (revision INTEGER PRIMARY KEY, entity_key TEXT NOT NULL, payload TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS v2_staff_payroll_entity ON v2_staff_payroll(entity_key,revision)`
];
async function savedState(db,view=null){
 // Seek to each distinct entity using the existing (entity_key, revision) index.
 // Opening the wage table needs full rows only for the selected month(s) and the
 // previous Friday. Older payslips stay addressable through the history picker.
 const latest=`WITH RECURSIVE names(k) AS (
  SELECT MIN(entity_key) FROM v2_staff_payroll UNION ALL
  SELECT (SELECT MIN(entity_key) FROM v2_staff_payroll WHERE entity_key>names.k)
  FROM names WHERE k IS NOT NULL
 ), ids(revision) AS (SELECT (SELECT revision FROM v2_staff_payroll WHERE entity_key=k ORDER BY revision DESC LIMIT 1) FROM names WHERE k IS NOT NULL)`;
 const range=view ? "CASE WHEN entity_key LIKE 'run:%' AND substr(entity_key,5,7) NOT IN (?,?) AND entity_key!=? THEN json_object('key',entity_key,'pay_date',substr(entity_key,5),'status',json_extract(payload,'$.status'),'totals',json_extract(payload,'$.totals')) ELSE payload END" : 'payload';
 const sql=latest+` SELECT p.revision,p.actor,p.saved_at,${range} AS payload FROM v2_staff_payroll p JOIN ids USING(revision) ORDER BY p.revision`;
 const query=db.prepare(sql);
 const all=(await (view?query.bind(view.date.slice(0,7),view.month,'run:'+addDays(view.date,-7)):query).all()).results;
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
 if(request.method==='GET' && url.pathname.endsWith('/history'))return {events:(await db.prepare("SELECT revision,entity_key,action,actor,saved_at,json_extract(payload, '$.change_note') AS reason FROM v2_staff_payroll ORDER BY revision DESC LIMIT 100").all()).results};
 const targetDate=friday(url.searchParams.get('pay_date')??nextFriday()),view=request.method==='GET'&&url.searchParams.get('view')==='wages'?{date:targetDate,month:url.searchParams.get('month')??targetDate.slice(0,7)}:null;
 const state=await savedState(db,view),timeVersion=(await db.prepare('SELECT COALESCE(MAX(rowid),0) revision FROM v2_staff_time').first()).revision;
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
 const wages=async(date,stored,edits)=>rebuildWages(await preview(date,edits),stored,current.state,state.settings,state.runs,state.openings);
 const payDate=friday(url.searchParams.get('pay_date')??nextFriday());
 if(request.method==='GET'){
  const historical=fresh && payDate<fresh.first_pay_date;
  const stored=state.runs.find(r=>r.pay_date===payDate);
  const operational=fresh && payDate>=fresh.first_pay_date;
  const wageView=operational && (url.searchParams.get('view')==='wages'||stored?.individual_wages) && (!stored||stored.individual_wages||['Draft','Voided'].includes(stored.status));
  const run=wageView?await wages(payDate,stored):stored??(historical?{status:'Reference',pay_date:payDate,from:addDays(payDate,-4),to:payDate,rows:[],totals:null}:await preview(payDate));
  if(!wageView && run.status==='Draft'){
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
  return {can_start_fresh:isAdmin(user.username),revision:state.revision,source,settings:state.settings,openings:state.openings,run,stale:!wageView&&stale(run),saved:!!run.saved_revision,runs:state.runs.map(({pay_date,status,totals,saved_at})=>({pay_date,status,totals,saved_at})).sort((a,b)=>b.pay_date.localeCompare(a.pay_date)),month:monthlyReport(url.searchParams.get('month')??payDate.slice(0,7),state.runs.map(postedRun),state.openings,state.settings.company,current.state.people,fresh)};
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
  if(b.action.startsWith('wages_')){
   check(isAdmin(user.username),'Only Alex or Alinda may change wages.',403);
   check(fresh && date>=fresh.first_pay_date,'Start the new payroll first.');
   check(!existing||existing.individual_wages||['Draft','Voided'].includes(existing.status),'This payroll is already closed.');
   record=await wages(date,existing);
   const allEdits=Object.fromEntries(record.rows.map(x=>[x.employee_id,{...x.day_edits}]));
   if(b.action==='wages_uif_bound'){
    check(date.slice(0,7)===fresh.start_date.slice(0,7),'Choose the first app payroll month.');
    const rows=selectWageRows(record,b.employee_ids);
    check(Number.isSafeInteger(b.upper_cents)&&b.upper_cents>=0,'Enter a verified upper limit for earlier UIF remuneration.');
    const reason=text(b.note,'source of the earlier remuneration limit',400);
    for(const r of rows){check(!posted(r),'This employee already has an approved wage.');r.wage_facts={...r.wage_facts,opening_bound:b.upper_cents,opening_source:reason};}
    record=await wages(date,record,allEdits);record.change_note=reason;
   }else if(b.action==='wages_approve'||b.action==='wages_paid'||b.action==='wages_reopen'){
    const rows=selectWageRows(record,b.employee_ids);
    check(date<=today() && state.settings.company,'Check the pay date and employer details.');
    for(const r of rows){
     if(b.action==='wages_approve'){
      check(r.ready && !posted(r),r.name+' is not ready. Reload this week.',409);
      check(!state.runs.some(other=>other.pay_date>date && postedRun(other).rows.some(x=>x.employee_id===r.employee_id && (posted(x)||(!other.individual_wages&&['Approved','Paid'].includes(other.status))))),'A later pay week for '+r.name+' has already been approved.');
      r.wage_state='Approved';r.approved_by=user.username;r.approved_at=stamp;r.reviewed=true;
      r.employer=state.settings.company;
     }else if(b.action==='wages_paid'){
      check(r.wage_state==='Approved','Record only approved, unpaid wages.',409);
      const paid=dateKey(b.paid_on);check(paid>=date&&paid<=today(),'Enter the actual payment date.');
      check(['Bank','Cash'].includes(b.method),'Choose the actual payment method.');
      Object.assign(r,{wage_state:'Paid',paid_on:paid,paid_by:user.username,paid_at:stamp,payment_method:b.method,payment_reference:String(b.note??'').trim().slice(0,300)});
     }else{
      check(r.wage_state==='Approved','Only an unpaid approval can be reopened.');
      check(!state.runs.some(other=>other.pay_date>date && postedRun(other).rows.some(x=>x.employee_id===r.employee_id&&(posted(x)||(!other.individual_wages&&['Approved','Paid'].includes(other.status))))),'A later approval already uses these amounts.');
      record.change_note=r.name+' · '+text(b.note,'correction reason',300);
      delete r.wage_state;delete r.approved_at;delete r.approved_by;r.reviewed=false;
     }
    }
   }else{
    const [row]=selectWageRows(record,[uuid(b.employee_id)]);
    check(!posted(row),'Reopen the unpaid approval first. Paid payslips are frozen.');
    const reason=text(b.note,'source or reason',400);
    if(b.action==='wages_day'){
     const day=row.source.days.find(d=>d.date===b.day);
     check(day && day.date<=today(),'Choose a completed day in this week.');
     check(['hours','absent','workplace','sick_paid','sick_unpaid'].includes(b.kind),'Choose a correction.');
     const edit={...row.day_edits[b.day],reason,by:user.username,at:stamp};
     if(b.kind!=='workplace'){delete edit.sick_type;delete edit.sick_minutes;delete edit.absent;}
     if(b.kind==='workplace'){
      check(day.monday_rotation && ['Factory','Route'].includes(b.workplace),'Choose the Monday workplace.');edit.workplace=b.workplace;
     }else if(b.kind==='sick_paid'||b.kind==='sick_unpaid'){
      check(!day.first_in&&!day.review_seconds&&!day.leave_days&&day.scheduled_minutes>0,'Use a scheduled day with no attendance or approved leave.');
      edit.sick_type=b.kind;edit.sick_minutes=b.kind==='sick_paid'?day.scheduled_minutes:0;edit.absent=true;edit.minutes=0;edit.baseline_seconds=day.clock_payable_seconds;
     }else{
      check(Number.isInteger(b.minutes)&&b.minutes>=0&&b.minutes<=1440,'Enter total paid minutes for this day.');
      check(b.kind!=='absent'||(!day.first_in&&!day.review_seconds&&!day.leave_days&&b.minutes===0),'A clocked or leave day cannot be marked absent.');
      edit.absent=b.kind==='absent';edit.minutes=(b.minutes*60-day.clock_payable_seconds)/60;
      edit.baseline_seconds=day.clock_payable_seconds;
     }
     allEdits[row.employee_id][b.day]=edit;
    }else if(b.action==='wages_facts'){
     const f={...row.wage_facts};
     if(b.extra_cents!=null){check(Number.isSafeInteger(b.extra_cents)&&b.extra_cents>=0,'Enter the extra pay in cents.');row.special_cents=b.extra_cents;row.entered_special_cents=b.extra_cents;}
     for(const k of ['special_checked','short_day_checked','daily_resolved','legacy_checked','fixed_checked','weekly_bonus'])if(b[k]===true)f[k]=true;
     if(b.uif){check(['Liable','Exempt'].includes(b.uif),'Choose UIF treatment.');row.uif=b.uif;row.input_uif=b.uif;row.uif_reason=reason;}
     if(b.cutover_uif){check(['Full weekly share','Confirmed current amounts'].includes(b.cutover_uif),'Choose the current UIF treatment.');row.cutover_uif=b.cutover_uif;if(b.cutover_uif==='Confirmed current amounts'){row.current_employee_cents=b.employee_uif;row.current_employer_cents=b.employer_uif;}}
     for(const k of ['bonus_cents','commission_cents','meat_cents','other_deduction_cents'])if(b[k]!=null){check(Number.isSafeInteger(b[k])&&b[k]>=0,'Enter a valid amount.');row[k]=b[k];if(k==='other_deduction_cents')row.entered_deduction_cents=b[k];}
     if(b.paid_days){check(row.profile?.fen_hourly_only,'Check the paid day arrangement.');paidDaySeconds(b.paid_days,row.source.days);row.paid_days=b.paid_days;row.paid_days_note=reason;}
     row.wage_facts=f;
    }else if(b.action==='wages_amend'){
     const origin=friday(b.original_friday),prior=state.runs.find(r=>r.pay_date===origin);
     const original=prior?.rows.find(r=>r.employee_id===row.employee_id&&r.included);
     check(origin<date && origin>=fresh.first_pay_date && original && (original.wage_state==='Paid'||(!prior.individual_wages&&prior.status==='Paid')),'Select an earlier paid payslip for this employee.');
     check(['Earnings','Authorised repayment'].includes(b.kind),'Select the type of correction.');
     check(Number.isSafeInteger(b.cents)&&b.cents>0,'Enter a positive correction amount.');
     if(b.kind==='Authorised repayment')check(b.authorised===true,'Confirm the legal authority for this wage deduction.');
     const reference=text(b.reference,'correction reference',120);
     const duplicate=state.runs.some(r=>r.rows.some(x=>x.employee_id===row.employee_id&&x.wage_facts?.amendments?.some(a=>a.reference===reference)));
     check(!duplicate,'This correction reference is already on a payslip.');
     const amendment={original_friday:origin,kind:b.kind,cents:b.cents,reference,reason,actor:user.username,at:stamp};
     row.wage_facts={...row.wage_facts,amendments:[...(row.wage_facts?.amendments??[]),amendment]};
    }else if(b.action==='wages_tax'){
     check(row.gross_cents!=null && Number.isSafeInteger(b.paye_cents)&&b.paye_cents>=0&&b.paye_cents<=row.gross_cents,'Check gross and PAYE first.');
     row.wage_facts={...row.wage_facts,paye_cents:b.paye_cents,taxable_snapshot:row.gross_cents,tax_source:reason};
    }else throw new UserError('Unknown wage action.');
    record.change_note=row.name+' · '+(b.day??'')+' · '+reason;
    record=Object.assign(await wages(date,record,allEdits),{change_note:record.change_note});
   }
   record.status=record.rows.every(r=>r.wage_state==='Paid')?'Paid':record.rows.every(posted)?'Approved':'Draft';
   record.totals=wageTotals(record.rows);
  }else if(existing?.individual_wages){throw new UserError('Open Pay Wages to change this week.',409);
  }else if(b.action==='refresh'){
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
  if(!record.individual_wages)record.totals=totalRows(record.status==='Draft'?record.rows.filter(r=>r.reviewed):record.rows);if(record.status==='Draft' && !(b.action==='paid_days' && stale(record)))record.source={...source,payroll_revision:next};
 }
 if(!b.action.startsWith('wages_') && b.action!=='row' && b.action!=='day_edit')delete record.change_note;
 delete record.saved_revision;delete record.saved_at;delete record.saved_by;
 check(JSON.stringify(record).length<650000,'Payroll record is too large.');
 // Serialized global payroll revision protects monthly UIF against two runs
 // approving concurrently. Clock and Staff guards are checked inside D1 batch.
 const guard=db.prepare(`INSERT INTO v2_staff_requests(id,request_hash,result) SELECT ?, '', '' WHERE (SELECT COALESCE(MAX(revision),0) FROM v2_staff_register)!=? OR (SELECT COALESCE(MAX(rowid),0) FROM v2_staff_time)!=?`).bind(op.id,current.revision,timeVersion);
 const insert=db.prepare('INSERT INTO v2_staff_payroll VALUES(?,?,?,?,?,?)').bind(next,record.key,JSON.stringify(record),b.action,user.username,stamp);
 return op.commit([guard,insert],{ok:true,revision:current.revision,payroll_revision:next,status:record.status??'Saved'});
}
