import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestRows,monthlyReport} from '../src/payroll-domain.js';
import {rebuildWages,postedRun} from '../src/pay-wages.js';

function week(durations,options={}) {
 const from=options.from??'2026-11-16',dates=durations.map((_,i)=>new Date(Date.parse(from+'T12:00Z')+i*86400000).toISOString().slice(0,10));
 const person={id:'test-worker',name:'Test Worker',active:true,employment_type:'Casual',start_date:from,birth_date:'1980-05-01',schedules:[{from,minutes:[540,540,540,540,540,0,0]}]};
 const profile={employee_id:person.id,basis:'Hourly',from,rate_cents:3200,fixed_cents:0,uif:'Liable',break_rule:'Recorded breaks',payment_method:'Cash',hours_agreement:'Signed test arrangement',...options.profile};
 const settings={profiles:[profile],fresh_start:{start_date:'2026-11-16',first_pay_date:'2026-11-20'}},staff={people:[person],leave:[]};
 const shifts=durations.flatMap((hours,i)=>hours==null?[]:[{employee_id:person.id,punches:[{kind:'in',at:dates[i]+'T06:00:00.000Z'},{kind:'out',at:new Date(Date.parse(dates[i]+'T06:00Z')+hours*3600000).toISOString()}]}]);
 const date=dates.at(-1),clock={pay_date:date,from,to:date,rows:suggestRows(staff,shifts,settings,date)};
 return rebuildWages(clock,null,staff,settings,[],[]).rows[0];
}
test('weekly allocation, known zero PAYE, both UIF shares, statutory floor and higher agreed rate',()=>{
 const r=week([10,8,7,7,7]);assert.deepEqual([r.ready,r.overtime_seconds,r.net_cents],[true,0,123552]);
 const half=week([10,10,10,9,9]);assert.deepEqual([half.ordinary_seconds,half.overtime_seconds,half.gross_cents,half.paye_cents,half.uif_employee_cents,half.uif_employer_cents,half.net_cents],[162000,10800,158400,0,1584,1584,156816]);
 const taxable=week([9,9,9,9,9],{profile:{rate_cents:4400}});assert.equal(taxable.paye_cents,1300);assert.equal(taxable.ready,true);
 const floor=week([8,8,8,8,8],{profile:{rate_cents:3000}});assert.equal(floor.profile.rate_cents,3023);assert.equal(floor.gross_cents,120920);
});
test('unknown clock and unconfirmed long day remain local to the person',()=>{
 assert.equal(week([8,8,null,8,8]).net_cents,null);
 assert.equal(week([8,8,8,8,9/3600]).net_cents,null);
 const unresolved=week([10,8,7,7,7],{profile:{hours_agreement:null}});assert.equal(unresolved.ready,false);assert.match(unresolved.issues.join(' '),/agreement/);
 const directed=week([8,8,8,8,8],{profile:{tax_treatment:'Directive',directive_from:'2026-11-16',directive_to:'2027-01-01',directive_bps:1200}});assert.equal(directed.paye_cents,15360);
});
test('approved and paid people enter the monthly report independently of other unapproved wages',()=>{
 const ready=week([8,8,8,8,8]);const frozen={...ready,wage_state:'Paid'};
 const run={pay_date:'2026-11-20',status:'Draft',individual_wages:true,rows:[frozen,{...ready,employee_id:'other'}]};
 const month=monthlyReport('2026-11',[postedRun(run)],[],{first_pay_date:run.pay_date},[],{start_date:'2026-11-16',first_pay_date:run.pay_date});
 assert.equal(month.rows.length,1);assert.equal(month.rows[0].paid_net_cents,126720);assert.equal(month.partial,true);
});
