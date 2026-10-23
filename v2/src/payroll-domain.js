import {check,dateKey,addDays,today} from './domain.js';
import {text,uuid,periodHours,dayStart} from './staff-domain.js';

// All posted amounts are integer cents; hours are integer seconds. Round each
// earnings line once, then add. Never derive historical pay from current rates.
export const PAYROLL_RULES={version:'2026-10-23.1',uif_bps:100,uif_monthly_ceiling_cents:1771200,ordinary_week_seconds:45*3600,overtime_bps:15000};
export const MONEY_KEYS=['ordinary_cents','overtime_cents','leave_cents','special_cents','bonus_cents','commission_cents','gross_cents','uif_base_cents','uif_employee_cents','uif_employer_cents','paye_cents','meat_cents','other_deduction_cents','net_cents'];
export const HOUR_KEYS=['ordinary_seconds','overtime_seconds','leave_seconds','sunday_seconds','holiday_seconds'];
export const integer=(n,label,max=100000000)=>{check(Number.isSafeInteger(n)&&n>=0&&n<=max,'Enter a valid '+label+'.');return n;};
export function friday(date){dateKey(date);check(new Date(date+'T12:00Z').getUTCDay()===5,'Choose a Friday pay date.');return date;}
export function nextFriday(date=today()){return addDays(date,(5-new Date(date+'T12:00Z').getUTCDay()+7)%7);}
export function monthKey(value){check(typeof value==='string'&&/^\d{4}-\d{2}$/.test(value),'Choose a month.');dateKey(value+'-01');return value;}
export function profileAt(settings,id,date){return (settings.profiles??[]).filter(p=>p.employee_id===id&&p.from<=date).sort((a,b)=>a.from.localeCompare(b.from)).at(-1)??null;}
export function validateProfile(raw,people){
 const employee_id=uuid(raw.employee_id);check(people.some(p=>p.id===employee_id),'Employee not found.');
 const from=dateKey(raw.from),basis=raw.basis;check(['Hourly','Fixed weekly'].includes(basis),'Choose the pay basis.');
 const rate_cents=integer(raw.rate_cents,'hourly rate',100000),fixed_cents=integer(raw.fixed_cents,'weekly amount');
 check(basis==='Hourly'?rate_cents>0:fixed_cents>0,'Confirm a positive wage rate.');
 check(['Recorded breaks','60 minutes if no break recorded'].includes(raw.break_rule),'Choose the break rule.');
 check(['Bank','Cash'].includes(raw.payment_method),'Choose a payment method.');
 check(['Liable','Review each week'].includes(raw.uif),'Choose the UIF treatment.');
 return {employee_id,from,basis,rate_cents,fixed_cents,occupation:text(raw.occupation,'occupation',80),break_rule:raw.break_rule,payment_method:raw.payment_method,uif:raw.uif,reason:text(raw.reason,'rate source / reason',300)};
}
export function validateCompany(raw){return {name:text(raw.name,'employer name',150),address:text(raw.address,'employer address',300),first_pay_date:friday(raw.first_pay_date),reference:String(raw.reference??'').trim().slice(0,80)};}
export function validateOpening(raw,people,company){
 check(company,'Save employer details first.');const employee_id=uuid(raw.employee_id);check(people.some(p=>p.id===employee_id),'Employee not found.');
 const month=company.first_pay_date.slice(0,7),through=addDays(company.first_pay_date,-1);
 const row={employee_id,month,through,reason:text(raw.reason,'opening source / reason',300)};
 for(const k of MONEY_KEYS)row[k]=integer(raw[k]??0,k.replaceAll('_',' '));
 for(const k of HOUR_KEYS)row[k]=integer(raw[k]??0,k.replaceAll('_',' '),31*24*3600);
 check(row.uif_base_cents<=row.gross_cents,'UIF remuneration cannot exceed gross pay.');
 check(row.uif_employee_cents<=17712&&row.uif_employer_cents<=17712,'Opening UIF exceeds the monthly limit. Reconcile the source before continuing.');
 check(row.net_cents<=row.gross_cents,'Opening net pay cannot exceed gross pay.');
 return row;
}
const zeroTotals=()=>Object.fromEntries([...MONEY_KEYS,...HOUR_KEYS].map(k=>[k,0]));
export function priorFor(id,date,runs,openings){
 const rows=[...openings.filter(o=>o.employee_id===id&&o.month===date.slice(0,7)),...runs.filter(r=>['Approved','Paid'].includes(r.status)&&r.pay_date<date&&r.pay_date.slice(0,7)===date.slice(0,7)).flatMap(r=>r.rows.filter(x=>x.employee_id===id&&x.included))];
 return rows.reduce((a,r)=>{for(const k of MONEY_KEYS)a[k]+=r[k]??0;return a;},zeroTotals());
}
export function calculateRow(raw,profile,prior=zeroTotals()){
 const r={};for(const k of HOUR_KEYS)r[k]=integer(raw[k],k.replaceAll('_',' '),7*24*3600);
 check(r.ordinary_seconds+r.overtime_seconds+r.sunday_seconds+r.holiday_seconds<=7*24*3600,'Worked hours exceed the period.');
 for(const k of ['bonus_cents','commission_cents','special_cents','paye_cents','meat_cents','other_deduction_cents'])r[k]=raw[k]===null&&k==='paye_cents'?null:integer(raw[k],k.replaceAll('_',' '));
 check(['Liable','Exempt'].includes(raw.uif),'Review UIF treatment.');r.uif=raw.uif;
 check(!r.overtime_seconds||profile.rate_cents>0,'Confirm an hourly rate before paying overtime.');
 check(!(r.sunday_seconds+r.holiday_seconds)||r.special_cents>0,'Enter the reviewed Sunday / public-holiday payment under Special pay.');
 r.uif_reason=String(raw.uif_reason??'').trim().slice(0,300);check(r.uif!=='Exempt'||r.uif_reason.length>=5,'Give the reason for UIF exemption, including the monthly hours check for casuals.');
 r.ordinary_cents=profile.basis==='Fixed weekly'?profile.fixed_cents:Math.round(r.ordinary_seconds*profile.rate_cents/3600);
 r.overtime_cents=Math.round(r.overtime_seconds*profile.rate_cents*PAYROLL_RULES.overtime_bps/(3600*10000));
 r.leave_cents=profile.basis==='Fixed weekly'?0:Math.round(r.leave_seconds*profile.rate_cents/3600);
 r.gross_cents=r.ordinary_cents+r.overtime_cents+r.leave_cents+r.bonus_cents+r.commission_cents+r.special_cents;
 integer(r.gross_cents,'gross pay');r.uif_base_cents=r.uif==='Liable'?r.gross_cents-r.commission_cents:0;
 // Cumulative monthly ceiling and cent reconciliation across 4/5 Friday months.
 // Commission is excluded from UIF remuneration; bonuses remain included.
 const liable=Math.min(PAYROLL_RULES.uif_monthly_ceiling_cents,prior.uif_base_cents+r.uif_base_cents),target=Math.round(liable/100);
 r.uif_employee_cents=r.uif==='Liable'?Math.max(0,target-prior.uif_employee_cents):0;
 r.uif_employer_cents=r.uif==='Liable'?Math.max(0,target-prior.uif_employer_cents):0;
 // Do not silently recover prior under-deductions from this week's employee.
 r.uif_employee_cents=Math.min(r.uif_employee_cents,Math.ceil(r.uif_base_cents/100));
 r.uif_employer_cents=Math.min(r.uif_employer_cents,Math.ceil(r.uif_base_cents/100));
 r.net_cents=r.paye_cents===null?null:r.gross_cents-r.uif_employee_cents-r.paye_cents-r.meat_cents-r.other_deduction_cents;
 check(r.net_cents===null||r.net_cents>=0,'Deductions exceed gross pay.');return r;
}
export function suggestRows(staff,shifts,settings,payDate){
 const from=addDays(payDate,-4),rows=periodHours(staff.people,shifts,staff.leave,from,payDate);
 return rows.filter(r=>{const p=staff.people.find(p=>p.id===r.employee_id);return (p.active&&(!p.start_date||p.start_date<=payDate))||r.completed_seconds||r.review_seconds||r.paid_leave_minutes||shifts.some(s=>s.employee_id===p.id);}).map(source=>{
  const p=staff.people.find(p=>p.id===source.employee_id),profile=profileAt(settings,p.id,from),issues=[...source.issues];
  let worked=0,automatic_break_seconds=0;
  for(const d of source.days){let seconds=d.completed_seconds;if(profile?.break_rule==='60 minutes if no break recorded'&&seconds>=4*3600&&d.break_seconds===0){seconds-=3600;automatic_break_seconds+=3600;}worked+=seconds;}
  if(!profile)issues.push('Confirm pay setup');
  if(!p.start_date||p.employment_verified===false)issues.push('Confirm employment start');
  if(!worked&&!source.paid_leave_minutes)issues.push('No completed hours; verify attendance or fixed pay');
  if(worked>45*3600)issues.push('Verify overtime against the work schedule');
  if(source.days.some(d=>d.completed_seconds>9*3600))issues.push('Daily hours above 9; review overtime allocation');
  const weekend=shifts.filter(s=>s.employee_id===p.id&&s.punches[0].at<new Date(dayStart(from)).toISOString());
  if(weekend.length)issues.push('Prior weekend clock records: review separate Sunday / special pay');
  if(shifts.some(s=>s.employee_id===p.id&&s.punches.at(-1).kind!=='out'))issues.push('Open shift');
  if(settings.profiles?.some(x=>x.employee_id===p.id&&x.from>from&&x.from<=payDate))issues.push('Rate changes inside this week; review special pay adjustment');
  return {employee_id:p.id,name:p.name,code:p.code,included:true,profile,source:{...source,automatic_break_seconds},issues:[...new Set(issues)],ordinary_seconds:Math.min(Math.round(worked),45*3600),overtime_seconds:Math.max(0,Math.round(worked)-45*3600),leave_seconds:source.paid_leave_minutes*60,sunday_seconds:0,holiday_seconds:0,special_cents:0,bonus_cents:0,commission_cents:0,paye_cents:null,meat_cents:0,other_deduction_cents:0,uif:profile?.uif==='Liable'?'Liable':'Review',uif_reason:'',reviewed:false,note:''};
 });
}
export function totalRows(rows){const out=zeroTotals();for(const r of rows.filter(x=>x.included!==false))for(const k of Object.keys(out))out[k]+=r[k]??0;return out;}
export function monthlyReport(month,runs,openings,company,people){
 monthKey(month);const selected=runs.filter(r=>r.pay_date.slice(0,7)===month&&['Approved','Paid'].includes(r.status));
 const ids=new Set([...selected.flatMap(r=>r.rows.filter(x=>x.included).map(x=>x.employee_id)),...openings.filter(o=>o.month===month).map(o=>o.employee_id)]);
 const rows=[...ids].map(id=>{const native=selected.flatMap(r=>r.rows.filter(x=>x.employee_id===id&&x.included).map(x=>({...x,status:r.status}))),opening=openings.find(o=>o.employee_id===id&&o.month===month),p=people.find(p=>p.id===id),totals=totalRows([...native,...(opening?[opening]:[])]);return {employee_id:id,name:native.at(-1)?.name??p?.name??id,code:native.at(-1)?.code??p?.code??'',...totals,paid_net_cents:native.filter(r=>r.status==='Paid').reduce((s,r)=>s+r.net_cents,0)+(opening?.net_cents??0),opening:!!opening,uif_total_cents:totals.uif_employee_cents+totals.uif_employer_cents,uif_expected_cents:Math.round(Math.min(totals.uif_base_cents,1771200)/100),exemption_review:native.some(r=>r.uif==='Exempt')};});
 const approvedDates=selected.map(r=>r.pay_date),missing=[];for(let d=nextFriday(month+'-01');d.slice(0,7)===month;d=addDays(d,7)){if(d>today())continue;if(company&&d<company.first_pay_date)continue;if(!approvedDates.includes(d))missing.push(d);}
 return {month,company,rows,totals:totalRows(rows),approved_dates:approvedDates,missing_fridays:missing,drafts:runs.filter(r=>r.pay_date.slice(0,7)===month&&r.status==='Draft').map(r=>r.pay_date),opening_through:month===company?.first_pay_date.slice(0,7)?addDays(company.first_pay_date,-1):null,opening_missing:month===company?.first_pay_date.slice(0,7)?people.filter(p=>p.active&&!openings.some(o=>o.employee_id===p.id&&o.month===month)).map(p=>p.name):[],coverage:'Approved Fen runs by Friday pay date, plus verified opening amounts. Drafts excluded.'};
}
