import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRow,priorFor,monthlyReport,validateOpening,validateProfile,suggestRows,nextFriday,friday} from '../src/payroll-domain.js';
const id='11111111-1111-4111-a111-111111111111';
const profile={employee_id:id,from:'2026-01-01',basis:'Hourly',rate_cents:4000,fixed_cents:0,occupation:'Test worker',break_rule:'Recorded breaks',payment_method:'Bank',uif:'Liable',reason:'Synthetic confirmed rate'};
const row={employee_id:id,included:true,ordinary_seconds:45*3600,overtime_seconds:5*3600,leave_seconds:0,sunday_seconds:0,holiday_seconds:0,special_cents:0,bonus_cents:10000,commission_cents:20000,paye_cents:0,meat_cents:5000,other_deduction_cents:0,uif:'Liable',uif_reason:''};
const person={id,name:'Synthetic worker',code:'QA-001',active:true,start_date:'2026-01-01',employment_verified:true,schedules:[{from:'2026-01-01',minutes:[540,540,540,540,540,0,0]}]};
test('weekly ordinary, 1.5x overtime, bonus and commission; integer cents; employer UIF never deducted from net',()=>{
 const r=calculateRow(row,profile);assert.equal(r.ordinary_cents,180000);assert.equal(r.overtime_cents,30000);assert.equal(r.gross_cents,240000);assert.equal(r.uif_base_cents,220000);assert.equal(r.uif_employee_cents,2200);assert.equal(r.uif_employer_cents,2200);assert.equal(r.net_cents,232800);
 assert.equal(calculateRow({...row,paye_cents:null},profile).net_cents,null,'unknown PAYE is not silently zero');
 assert.throws(()=>calculateRow({...row,paye_cents:0.1},profile));assert.throws(()=>calculateRow({...row,paye_cents:10000000},profile));
 assert.throws(()=>calculateRow({...row,uif:'Exempt'},profile));assert.equal(calculateRow({...row,uif:'Exempt',uif_reason:'Confirmed less than 24 monthly hours'},profile).uif_employee_cents,0);
});
test('five Friday month reconciles cents and caps both UIF shares; next month resets; draft/voided runs never count',()=>{
 const runs=[];for(const pay_date of ['2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30']){const r={...row,...calculateRow({...row,ordinary_seconds:100*3600,overtime_seconds:0,bonus_cents:1,commission_cents:0,meat_cents:0},profile,priorFor(id,pay_date,runs,[]))};runs.push({pay_date,status:'Approved',rows:[r]});}
 const m=monthlyReport('2026-10',runs,[],{first_pay_date:'2026-10-02'},[person]);assert.equal(m.rows[0].uif_employee_cents,17712);assert.equal(m.rows[0].uif_employer_cents,17712);assert.equal(runs.at(-1).rows[0].uif_employee_cents,1712);
 assert.equal(priorFor(id,'2026-11-06',runs,[]).uif_base_cents,0);
 const again=monthlyReport('2026-10',[...runs,{...runs[0],status:'Draft'},{...runs[0],status:'Voided'}],[],{first_pay_date:'2026-10-02'},[person]);assert.deepEqual(again.totals,m.totals);
});
test('openings contribute once; cents round cumulatively; employee under-deductions are not recovered without review',()=>{
 const opening=validateOpening({employee_id:id,gross_cents:1500000,net_cents:1485000,uif_base_cents:1500000,uif_employee_cents:15000,uif_employer_cents:15000,reason:'Reconciled synthetic source'},[person],{first_pay_date:'2026-10-23'});
 const p=priorFor(id,'2026-10-23',[],[opening]),r=calculateRow({...row,ordinary_seconds:100*3600,overtime_seconds:0,bonus_cents:0,commission_cents:0},profile,p);assert.equal(r.uif_employee_cents,2712);
 const m=monthlyReport('2026-10',[{pay_date:'2026-10-23',status:'Paid',rows:[{...row,...r}]}],[opening],{first_pay_date:'2026-10-23'},[person]);assert.equal(m.totals.gross_cents,1900000);assert.equal(m.rows[0].paid_net_cents,opening.net_cents+r.net_cents);
 assert.ok(calculateRow(row,profile,{uif_base_cents:100000,uif_employee_cents:0,uif_employer_cents:0}).uif_employee_cents<=2200);
 assert.throws(()=>validateOpening({...opening,uif_employee_cents:17713},[person],{first_pay_date:'2026-10-23'}));
});
test('fixed weekly wages do not double-pay leave; special earnings and PAYE are explicit',()=>{
 const r=calculateRow({...row,ordinary_seconds:0,overtime_seconds:0,leave_seconds:9*3600,bonus_cents:0,commission_cents:0,special_cents:12000,paye_cents:10000,meat_cents:0},{...profile,basis:'Fixed weekly',fixed_cents:250000});assert.equal(r.gross_cents,262000);assert.equal(r.leave_cents,0);assert.equal(r.net_cents,249380);
});
test('native clock draft preserves half-day paid leave, unpaid leave and one break deduction; no inferred attendance',()=>{
 const shift=(date,breaks=false)=>({employee_id:id,punches:[{kind:'in',at:date+'T05:00:00Z'},...(breaks?[{kind:'break_start',at:date+'T10:00:00Z'},{kind:'break_end',at:date+'T11:00:00Z'}]:[]),{kind:'out',at:date+'T15:00:00Z'}]});
 const staff={people:[person],leave:[{employee_id:id,date:'2026-10-21',status:'Approved',type:'Annual',units:0.5,paid_minutes:270},{employee_id:id,date:'2026-10-22',status:'Approved',type:'Unpaid',units:1,paid_minutes:0}]};
 const r=suggestRows(staff,[shift('2026-10-19'),shift('2026-10-20',true)],{profiles:[{...profile,break_rule:'60 minutes if no break recorded'}]},'2026-10-23')[0];assert.equal(r.ordinary_seconds,18*3600);assert.equal(r.source.automatic_break_seconds,3600);assert.equal(r.leave_seconds,4.5*3600);assert.equal(r.paye_cents,null);assert.equal(r.reviewed,false);
});
test('dates and confirmed pay profiles reject ambiguity',()=>{assert.equal(nextFriday('2026-10-23'),'2026-10-23');assert.equal(nextFriday('2026-10-24'),'2026-10-30');assert.throws(()=>friday('2026-10-22'));assert.throws(()=>validateProfile({...profile,rate_cents:0},[person]));assert.equal(validateProfile(profile,[person]).rate_cents,4000);});

test('Monday workplace follows local punches and overrides; split shifts retain sub-minute precision across the week',()=>{
 const route={...profile,break_rule:'60 minutes if no break recorded'};
 const shifts=(day,periods)=>periods.map(([start,end])=>({employee_id:id,punches:[
  {kind:'in',at:new Date(day+'T'+start+'+02:00').toISOString()},
  {kind:'out',at:new Date(day+'T'+end+'+02:00').toISOString()}]}));
 const monday='2026-11-16';
 const week=(clock,p=route,edits={})=>suggestRows({people:[person],leave:[]},clock,{profiles:[p]},'2026-11-20',edits)[0];
 let d=week(shifts(monday,[['05:30:00','16:30:00']])).source.days[0];
 assert.deepEqual([d.workplace,d.automatic_break_seconds,d.payable_seconds],['Route',3600,36000]);
 d=week(shifts(monday,[['05:30:00','10:00:00'],['10:20:00','15:00:00']])).source.days[0];
 assert.equal(d.recorded_break_seconds,1200);assert.equal(d.automatic_break_seconds,0);
 const factory=shifts(monday,[['07:55:30.125','10:07:20.500'],['10:17:40.750','12:40:13.875'],['13:20:10.250','15:35:33.550']]);
 const full=[...factory,...['17','18','19','20'].flatMap(n=>shifts('2026-11-'+n,[['05:00:00','16:00:00']]))];
 const row=week(full);d=row.source.days[0];
 assert.equal(d.workplace,'Factory');assert.ok(Math.abs(d.recorded_break_seconds-3016.625)<0.001);
 assert.equal(d.automatic_break_seconds,0);assert.equal(Math.round(d.payable_seconds*1000),24586800);
 assert.equal(row.source.automatic_break_seconds,14400);assert.equal(row.ordinary_seconds,162000);
 assert.equal(row.overtime_seconds,6587);
 const amounts=calculateRow({...row,paye_cents:0},route);
 assert.equal(amounts.gross_cents,180000+Math.round(6587*4000*1.5/3600));
 d=week(shifts(monday,[['07:12:00','16:00:00']])).source.days[0];
 assert.equal(d.needs_workplace,true);assert.equal(d.automatic_break_seconds,0);
 assert.equal(week(factory,route,{[id]:{[monday]:{workplace:'Route'}}}).source.days[0].workplace_basis,'Confirmed');
 const normal=week(shifts(monday,[['05:30:00','16:30:00']]),profile).source.days[0];
 assert.equal(normal.workplace,'Factory');assert.equal(normal.automatic_break_seconds,0);
 const tuesday=week(shifts('2026-11-17',[['08:00:00','16:00:00']])).source.days[1];
 assert.equal(tuesday.workplace,'Route');assert.equal(tuesday.automatic_break_seconds,3600);
});
