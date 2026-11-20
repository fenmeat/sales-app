import {addDays,check,UserError,today} from './domain.js';
import {calculateRow,paidDaySeconds,payrollBirthCheck,priorFor} from './payroll-domain.js';
import {scheduledMinutes} from './staff-domain.js';
import {ageIndependentEstimate,weeklyPaye} from './weekly-paye.js';


// A confirmed weekly total never creates five guessed clock entries. A later change
// to any contributing day invalidates it until the manager reconciles the two.
export function weekEvidence(row) {
 return JSON.stringify(row.source.days.map(d => [d.date,d.first_in,d.last_out,d.payable_seconds,d.review_seconds,d.leave_days,d.paid_leave_minutes,d.scheduled_minutes,d.issues,row.day_edits?.[d.date]??null]));
}

export const posted = row => ['Approved','Paid'].includes(row.wage_state);
export function postedRun(run) {
 if (!run.individual_wages || !run.rows) return run;
 const rows=run.rows.filter(posted);
 return {...run,rows,partial_approval:rows.length<run.rows.length,status:rows.length?'Approved':'Draft'};
}

// Public Holidays Act calendar for the supported SARS year, including proclamations.
const holidays=new Set(['2026-03-21','2026-04-03','2026-04-06','2026-04-27','2026-05-01','2026-06-16',
 '2026-08-09','2026-08-10','2026-09-24','2026-11-04','2026-12-16','2026-12-25','2026-12-26','2027-01-01']);
export const isPayHoliday=date=>holidays.has(date);
const sum=(items,f)=>items.reduce((a,i)=>a+f(i),0);
const minimumRate=3023;
// Frozen payslips may already cover every Friday before the new payroll began.
function verifiedPreStartUIF(person,month,firstPayDate,runs) {
 if(!firstPayDate?.startsWith(month)||!person.start_date)return null;
 let date=addDays(firstPayDate,-7);
 const total={employee:0,employer:0};
 let counted=false;
 while(date.startsWith(month)&&date>=person.start_date){
  const run=runs.find(r=>r.pay_date===date&&r.status!=='Voided');
  const row=run?.rows?.find(r=>r.employee_id===person.id&&r.included&&(posted(r)||['Approved','Paid'].includes(run.status)));
  if(!row||!Number.isInteger(row.uif_employee_cents)||!Number.isInteger(row.uif_employer_cents))return null;
  total.employee+=row.uif_employee_cents;total.employer+=row.uif_employer_cents;
  counted=true;date=addDays(date,-7);
 }
 return counted?total:null;
}
export function wagePreview(row,person,run,settings,runs,openings) {
 if(posted(row))return row;
 let profile=row.profile;
 const issues=[],facts=row.wage_facts??{},days=row.source.days;
 const answer={...row,employment_type:person.employment_type??person.source_profile?.kind,issues,ready:false,net_cents:null,gross_cents:null,paye_cents:null,uif_employee_cents:null,uif_employer_cents:null};
 const stop=msg=>issues.push(msg);
 let hoursKnown=true;
 const missing=(date,msg)=>{hoursKnown=false;stop(date+' · '+msg);};
 const ordinaryDays=(person.schedules??[]).filter(s=>s.from<=run.from).at(-1)?.minutes??[];
 const confirmedWeek=facts.worked_week;
 const useWeek=confirmedWeek && confirmedWeek.evidence===weekEvidence(row);
 if(confirmedWeek && !useWeek)stop('Die dagure het sedert die weekbevestiging verander. Vergelyk die nuwe ure en bevestig die week weer.');
 if(useWeek){
  const worked=confirmedWeek.minutes*60;
  row={...row,ordinary_seconds:Math.min(worked,45*3600),overtime_seconds:Math.max(0,worked-45*3600)};
  answer.ordinary_seconds=row.ordinary_seconds;answer.overtime_seconds=row.overtime_seconds;
 }
 let shortDayGuarantee=0,weeklyWorked=0,holidayWeeklyOt=0;
 for(const day of days){
  const edit=row.day_edits?.[day.date],payable=day.payable_seconds??day.completed_seconds;
  const resolved=edit?.reason && !day.needs_adjustment_review && (edit.absent===true||Number.isFinite(edit.minutes)&&edit.minutes!==0);
  if(edit?.pending_kind==='worked_pending')missing(day.date,'Worked with the team. Confirm the actual payable hours.'+(edit.estimate_minutes?' Provisional '+Math.floor(edit.estimate_minutes/60)+'h '+edit.estimate_minutes%60+'m.':''));
  if(edit?.pending_kind==='sick_pending')missing(day.date,'Reported sick. Confirm paid sick leave or unpaid sick leave.');
  if(day.needs_workplace||day.needs_adjustment_review)missing(day.date,'Check the workplace or previous hours correction.');
  for(const issue of day.issues){
   if(issue==='Missing attendance record'||issue==='Schedule not verified')continue;
   missing(day.date,issue);
  }
  if(!useWeek && day.scheduled_minutes>0 && day.date<=today() && !day.first_in && !day.leave_days &&
    !resolved && !edit?.pending_kind && !row.paid_days?.includes(day.date) && !holidays.has(day.date))missing(day.date,'Correct hours or mark absent.');
  if(!useWeek&&!day.first_in&&!resolved&&!day.leave_days&&!day.scheduled_minutes&&day.scheduled_minutes==null&&!payable&&!row.paid_days?.includes(day.date))missing(day.date,'Confirm attendance or mark absent.');
  if(day.first_in && payable<60 && !resolved && !edit?.pending_kind)missing(day.date,'The clock entry is under one minute. Correct the hours.');
  if(day.overlap)missing(day.date,'Clock sessions overlap. Correct the attendance record.');
  if(day.date>today())hoursKnown=false;
  if(day.review_seconds)hoursKnown=false;
  if(holidays.has(day.date)){
   holidayWeeklyOt+=Math.max(0,payable-Math.max(0,45*3600-weeklyWorked));
  }else if(payable>=60 && payable<4*3600)shortDayGuarantee+=4*3600-payable;
  weeklyWorked+=payable;
 }
 if(!useWeek&&!days.some(d=>d.payable_seconds>0||d.leave_days||row.day_edits?.[d.date]?.absent||row.paid_days?.includes(d.date)||holidays.has(d.date)))hoursKnown=false;
 for(const issue of row.source_flags??row.issues){
  if(/Rate changes inside|handmatige weekure/.test(issue))stop(issue);
 }
 if(row.included===false){stop('Excluded from this week.');return answer;}
 if(!profile){stop('Enter the agreed pay rate.');return answer;}
 if(profile.basis==='Hourly'){
  if(!Number.isSafeInteger(profile.rate_cents)||profile.rate_cents<=0){stop('Enter the agreed hourly rate.');return answer;}
  if(run.pay_date>='2026-03-01' && run.pay_date<'2027-03-01' && profile.rate_cents<minimumRate){
   profile={...profile,agreed_rate_cents:profile.rate_cents,rate_cents:minimumRate,rate_basis:'2026 national minimum wage'};
   answer.profile=profile;
  }
 }
 if(profile.basis==='Fixed weekly' && !facts.fixed_checked && (!ordinaryDays.length || row.ordinary_seconds>0 && profile.fixed_cents<row.ordinary_seconds/3600*minimumRate))stop('Check the fixed wage against agreed hours and the minimum wage.');
 const month=run.pay_date.slice(0,7);
 const payrollStart=settings.fresh_start?.first_pay_date;
 const operational=payrollStart?runs.filter(r=>r.pay_date>=payrollStart):runs;
 const prior=priorFor(person.id,run.pay_date,operational.map(postedRun),settings.fresh_start?[]:openings);
 const previous=operational.filter(r=>r.pay_date<run.pay_date&&r.pay_date.slice(0,7)===month);
 if(previous.some(r=>r.rows.some(x=>x.employee_id===person.id && x.included) && r.pay_date>=person.start_date && !r.rows.some(x=>x.employee_id===person.id&&(posted(x)||(['Approved','Paid'].includes(r.status)&&x.included)))))stop('Confirm the earlier unpaid week for this employee before finalising monthly UIF.');

 const priorWeekend=row.source.weekend_days??[];
 const monthlyWorked=row.ordinary_seconds+row.overtime_seconds+sum(priorWeekend,d=>d.payable_seconds??0)
  +prior.ordinary_seconds+prior.overtime_seconds+prior.holiday_seconds+prior.sunday_seconds;
 let uif=row.uif;
 const regularRoster=person.employment_verified!==false && (person.employment_type??person.source_profile?.kind)!=='Casual' && (ordinaryDays.reduce((sum,n)=>sum+n,0)>=24*60) && person.active;
 if(uif==='Review' && (monthlyWorked>=86400 || regularRoster))uif='Liable';
 const uifKnown=['Liable','Exempt'].includes(uif);
 if(row.uif==='Exempt' && monthlyWorked>=86400 && /24 hour|24 uur/i.test(row.uif_reason??''))stop('The monthly hours now reach 24. Correct the UIF treatment.');
 if(!uifKnown)stop('Confirm whether this employee works at least 24 hours this month for Fen Meat.');
 const priorBound=runs.filter(r=>r.pay_date<run.pay_date && r.pay_date.slice(0,7)===month).sort((a,b)=>b.pay_date.localeCompare(a.pay_date)).flatMap(r=>r.rows.filter(x=>x.employee_id===person.id)).find(x=>x.wage_facts?.opening_bound!=null)?.wage_facts.opening_bound;
 const bound=facts.opening_bound??priorBound;
 const earlierUif=facts.earlier_uif??previous.filter(r=>r.pay_date>=settings.fresh_start?.first_pay_date).sort((a,b)=>b.pay_date.localeCompare(a.pay_date)).flatMap(r=>r.rows.filter(x=>x.employee_id===person.id)).find(x=>x.wage_facts?.earlier_uif)?.wage_facts.earlier_uif??verifiedPreStartUIF(person,month,payrollStart,runs);
 const cutover=settings.fresh_start && month===settings.fresh_start.start_date.slice(0,7) && (!person.start_date||person.start_date<settings.fresh_start.start_date);
 let uifAvailable=uifKnown;
 const hasCutoverChoice=['Full weekly share','Confirmed current amounts'].includes(row.cutover_uif);
 if(cutover && uif==='Liable' && !hasCutoverChoice && bound==null && !earlierUif){
  uifAvailable=false;stop('Confirm whether earlier November pay leaves room for both UIF shares this week.');
 }
 let amounts;
 try {
  const raw={...row,uif:uifKnown?uif:'Liable',paye_cents:null};
  let holidaySeconds=0,weekendHolidaySeconds=0,holidayPay=0,weekendOrdinary=0,weekendOvertime=0,sundaySeconds=0;
  const dailyWageSeconds=ordinaryDays.filter(n=>n>0).length?sum(ordinaryDays,n=>n*60)/ordinaryDays.filter(n=>n>0).length:null;
  const weekend=[...priorWeekend];
  for(const offset of [-2,-1]){
   const date=addDays(run.from,offset);
   if(!holidays.has(date) || date<(settings.fresh_start?.start_date??'') || date<(person.start_date??'') || weekend.some(d=>d.date===date))continue;
   const scheduled=scheduledMinutes({...person,schedules:person.schedules??[]},date);
   if(scheduled>0)weekend.push({date,scheduled_minutes:scheduled,payable_seconds:0,issues:[]});
  }
  for(const d of [...days,...weekend].filter(d=>holidays.has(d.date))){
   const previousWeekend=d.date<run.from;
   const work=Math.round(d.payable_seconds??0),scheduled=(d.scheduled_minutes??0)*60;
   if(!scheduled&&!work)continue;
   if(d.scheduled_minutes==null||!profile.rate_cents||d.leave_days){stop(d.date+' · Confirm the holiday entitlement including any overlapping leave.');continue;}
   if(work&&!scheduled&&dailyWageSeconds==null){stop(d.date+' · Confirm the ordinary daily wage for public holiday work.');continue;}
   if(previousWeekend)weekendHolidaySeconds+=work;else holidaySeconds+=work;
   const dayBase=scheduled||dailyWageSeconds;
   const entitlement=work?(scheduled?Math.max(2*scheduled,scheduled+work):dayBase+work):scheduled;
   holidayPay+=Math.round((entitlement-(profile.basis==='Fixed weekly'?scheduled:0))*profile.rate_cents/3600);
  }
  const prevDate=addDays(run.pay_date,-7);
  const earlier=runs.find(r=>r.pay_date===prevDate);
  const previousRow=earlier?.rows.find(x=>x.employee_id===person.id&&(posted(x)||(!earlier.individual_wages&&['Approved','Paid'].includes(earlier.status))));
  let priorOrdinary=previousRow?.ordinary_seconds;
  for(const d of weekend){
   if(d.issues.some(i=>i!=='Missing attendance record')||d.overlap||d.review_seconds){missing(d.date,'Correct the weekend clock record.');continue;}
   const work=Math.round(d.payable_seconds);
   if(!work)continue;
   const sunday=new Date(d.date+'T12:00Z').getUTCDay()===0;
   if(holidays.has(d.date))continue;
   if(sunday){
    if(d.scheduled_minutes==null||dailyWageSeconds==null||!profile.rate_cents){stop(d.date+' · Confirm the Sunday roster and daily wage.');continue;}
    sundaySeconds+=work;
    const normal=d.scheduled_minutes>0;
    const guaranteed=normal?d.scheduled_minutes*60:dailyWageSeconds;
    holidayPay+=Math.round(Math.max(guaranteed,work*(normal?1.5:2))*profile.rate_cents/3600);
    if(profile.basis==='Fixed weekly' && normal)holidayPay-=Math.round(guaranteed*profile.rate_cents/3600);
   }else{
    if(priorOrdinary==null){stop(d.date+' · Confirm the previous week’s ordinary hours before allocating Saturday pay.');continue;}
    const ordinary=Math.min(work,Math.max(0,45*3600-priorOrdinary));
    weekendOrdinary+=ordinary;weekendOvertime+=work-ordinary;priorOrdinary+=ordinary;
    if(profile.basis==='Fixed weekly'&&ordinary)stop(d.date+' · Confirm Saturday pay under the fixed wage agreement.');
   }
  }
  // Remove holiday work from the ordinary/OT earnings buckets once. Apply the separate statutory payment.
  for(const d of days){
   const edit=row.day_edits?.[d.date];
   if(!edit?.sick_type)continue;
   if(d.first_in || (d.leave_days && d.paid_leave_minutes!==(edit.sick_minutes??0)))missing(d.date,'Reconcile the sick day with the new attendance or leave entry.');
   if(!d.leave_days && edit.sick_type==='sick_paid')raw.leave_seconds+=edit.sick_minutes*60;
  }
  const holidayOt=Math.min(holidaySeconds,Math.round(holidayWeeklyOt));
  raw.ordinary_seconds+=weekendOrdinary-(holidaySeconds-holidayOt);
  raw.overtime_seconds+=weekendOvertime-holidayOt;
  raw.holiday_seconds=holidaySeconds+weekendHolidaySeconds;raw.sunday_seconds=sundaySeconds;
  if(profile.basis==='Hourly' && shortDayGuarantee)holidayPay+=Math.round(shortDayGuarantee*profile.rate_cents/3600);
  const adjustments=facts.amendments??[];
  answer.extra_hours_minutes=facts.extra_minutes??0;
  answer.extra_hours_cents=Math.round(answer.extra_hours_minutes*profile.rate_cents/60);
  raw.special_cents+=answer.extra_hours_cents+holidayPay+sum(adjustments.filter(a=>a.kind==='Earnings'),a=>a.cents);
  answer.entered_deduction_cents=row.other_deduction_cents;
  raw.other_deduction_cents+=sum(adjustments.filter(a=>a.kind==='Authorised repayment'),a=>a.cents);
  answer.entered_special_cents=row.special_cents;
  answer.statutory_special_cents=holidayPay;
  amounts=calculateRow(raw,profile,prior,{paidOffSeconds:paidDaySeconds(row.paid_days??[],days),
   externalHistory:cutover && !earlierUif && uifAvailable && hasCutoverChoice && uif==='Liable'});
  if(cutover && earlierUif && uif==='Liable'){
   for(const side of ['employee','employer']){
    const key='uif_'+side+'_cents';
    amounts[key]=Math.min(amounts[key],Math.max(0,17712-earlierUif[side]-prior[key]));
   }
  }
 }catch(e){if(!(e instanceof UserError))throw e;stop(e.message);return answer;}
 if(cutover && uif==='Liable' && !hasCutoverChoice && !earlierUif && bound!=null && bound+prior.uif_base_cents+amounts.uif_base_cents>1771200){
  uifAvailable=false;stop('Earlier November earnings may reach the ceiling. Enter the current UIF shares.');
 }
 answer.recorded_gross_cents=amounts.gross_cents;
 if(!hoursKnown)return answer;
 Object.assign(answer,amounts);
 answer.input_uif=row.uif;
 if(!uifAvailable){answer.uif_employee_cents=null;answer.uif_employer_cents=null;}
 let tax=null;
 const taxProfile=profile.tax_treatment;
 try{
  if(facts.paye_cents!=null && facts.taxable_snapshot===amounts.gross_cents)tax=facts.paye_cents;
  else if(taxProfile==='Directive' && profile.directive_from<=run.pay_date && profile.directive_to>=run.pay_date && profile.directive_bps!=null)
   tax=Math.round(amounts.gross_cents*profile.directive_bps/10000);
  else if((facts.amendments??[]).some(a=>a.kind==='Earnings') || taxProfile==='Other' || taxProfile==='Directive' || row.commission_cents || (row.bonus_cents&&!facts.weekly_bonus) ||
    (!taxProfile && sum(ordinaryDays,n=>n)<22*60))
   stop('Confirm the applicable PAYE basis or this week’s directive amount.');
  else {
   const taxPerson={...person,birth_date:profile.tax_birth_date??person.birth_date};
   tax=payrollBirthCheck(person,profile)?ageIndependentEstimate(amounts.gross_cents,run.pay_date,taxPerson,run.from):weeklyPaye(amounts.gross_cents,run.pay_date,taxPerson,run.from);
   if(tax===null)stop('Confirm the date of birth for the SARS weekly table.');
  }
 }catch(e){if(!(e instanceof UserError))throw e;stop(e.message);}
 answer.paye_cents=tax;
 if(tax===null){
  answer.before_tax_cents=amounts.gross_cents-amounts.meat_cents-amounts.other_deduction_cents-(uifAvailable?answer.uif_employee_cents:0);
 }
 if(tax!=null && !uifAvailable)answer.estimate_net_cents=amounts.gross_cents-tax-amounts.uif_employee_cents-amounts.meat_cents-amounts.other_deduction_cents;
 if(tax!=null && uifAvailable)answer.net_cents=amounts.gross_cents-tax-answer.uif_employee_cents-amounts.meat_cents-amounts.other_deduction_cents;
 if(answer.net_cents<0)stop('Deductions exceed gross pay.');
 if(issues.length && answer.net_cents!=null){answer.estimate_net_cents=answer.net_cents;answer.net_cents=null;}
 answer.ready=issues.length===0 && answer.net_cents!=null && run.pay_date<=today();
 return answer;
}

export function wageTotals(rows){
 const keys=['gross_cents','net_cents','uif_employee_cents','uif_employer_cents'];
 return Object.fromEntries(keys.map(k=>{const known=rows.filter(r=>r.included && Number.isSafeInteger(r[k]));return [k,known.length?sum(known,r=>r[k]):null];}));
}

export function rebuildWages(clockRun,stored,staff,settings,runs,openings) {
 const oldRows=new Map((stored?.status==='Voided'?[]:stored?.rows??[]).map(r=>[r.employee_id,r]));
 const people=new Map(staff.people.map(p=>[p.id,p]));
 const rows=clockRun.rows.map(row=>{
  const old=oldRows.get(row.employee_id);
  if(old && posted(old))return old;
  if(old){
   for(const key of ['paid_days','paid_days_note','included','sunday_seconds','holiday_seconds','special_cents','bonus_cents','commission_cents','meat_cents','other_deduction_cents','uif','uif_reason','cutover_uif','current_employee_cents','current_employer_cents','wage_facts','note'])
    if(old[key]!=null)row[key]=key==='special_cents'?(old.entered_special_cents??old.special_cents):key==='uif'?(old.input_uif??old.uif):key==='other_deduction_cents'?(old.entered_deduction_cents??old.other_deduction_cents):old[key];
   // A legacy explicitly reviewed exception is evidence, never a new blanket approval.
   if(!old.wage_facts && !old.source_flags && (old.reviewed || ['ordinary_seconds','overtime_seconds','leave_seconds'].some(k=>old.suggested_hours && old.suggested_hours[k]!==old[k])) && !posted(old)){
    row.issues.push('Check the saved manual week against the current clock.');
    row.legacy_review={hours:old.suggested_hours,ordinary_seconds:old.ordinary_seconds,overtime_seconds:old.overtime_seconds,paye_cents:old.paye_cents,note:old.note};
   }else if(old.legacy_review && !row.wage_facts?.legacy_checked)row.legacy_review=old.legacy_review;
  }
  row.source_flags=row.issues;
  const person=people.get(row.employee_id);
  const preview=input=>wagePreview(input,person,clockRun,settings,runs,openings);
  const result=preview(row);
  const pending=row.source.days.filter(d=>row.day_edits?.[d.date]?.pending_kind);
  if(pending.length && result.net_cents==null){
   const scenario=structuredClone(row),assumptions=[];
   for(const day of scenario.source.days){
    const edit=scenario.day_edits?.[day.date];
    if(!edit?.pending_kind)continue;
    if(edit.pending_kind==='worked_pending' && edit.estimate_minutes){
     assumptions.push(day.date+' estimated at '+edit.estimate_minutes+' payable minutes');
     day.payable_seconds=edit.estimate_minutes*60;
     edit.minutes=(day.payable_seconds-day.clock_payable_seconds)/60;
    }else if(edit.pending_kind==='sick_pending' && day.scheduled_minutes>0){
     assumptions.push(day.date+' paid as '+day.scheduled_minutes+' minutes of sick leave');
     Object.assign(edit,{absent:true,minutes:0,sick_type:'sick_paid',sick_minutes:day.scheduled_minutes});
    }else continue;
    delete edit.pending_kind;
   }
   if(assumptions.length===pending.length){
    const seconds=Math.round(sum(scenario.source.days,d=>d.payable_seconds));
    scenario.ordinary_seconds=Math.min(seconds,45*3600);scenario.overtime_seconds=seconds-scenario.ordinary_seconds;
    const estimate=preview(scenario);
    result.estimate_net_cents=estimate.net_cents??estimate.estimate_net_cents??null;
    result.estimate_note=assumptions.join(', ')+(estimate.net_cents==null?' · assumes full UIF':'');
   }
  }
  if(row.legacy_review && !row.wage_facts?.legacy_checked){result.ready=false;result.issues.push('Check the saved manual week against current hours and deductions.');}
  return result;
 });
 for(const old of oldRows.values())if(posted(old)&&!rows.some(r=>r.employee_id===old.employee_id))rows.push(old);
 const status=rows.length&&rows.every(r=>r.wage_state==='Paid')?'Paid':rows.length&&rows.every(posted)?'Approved':'Draft';
 return {...clockRun,status,individual_wages:true,rows,totals:wageTotals(rows)};
}

export function selectWageRows(run,ids){
 check(Array.isArray(ids)&&ids.length>0&&ids.length<=run.rows.length&&new Set(ids).size===ids.length,'Select employees once.');
 const rows=ids.map(id=>run.rows.find(r=>r.employee_id===id));check(rows.every(Boolean),'Reload the week.');return rows;
}
