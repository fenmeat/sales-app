import test from 'node:test';
import assert from 'node:assert/strict';
import {blankStaff,applyStaffAction,periodHours,shiftSummary,appendPunch,balance,dayAt,birthdayPin} from '../src/staff-domain.js';
const id=crypto.randomUUID();
const person={id,code:'SYN-001',name:'Synthetic worker',team:'Test',start_date:'2026-01-01',active:true};
const act=(state,b)=>applyStaffAction(state,b,'alinda','2026-10-19T09:00:00.000Z').state;
function setup(){let s=act(blankStaff(),{action:'person',person});return act(s,{action:'schedule',employee_id:id,from:'2026-01-01',minutes:[540,540,540,540,540,480,0],reason:'Synthetic verified schedule'});}
const punch=(kind,at)=>({kind,at:new Date(at+'+02:00').toISOString()});
const shift=(...punches)=>({id:crypto.randomUUID(),employee_id:id,punches});
const request=(type,units,date='2026-10-19')=>({action:'leave_request',employee_id:id,record_id:crypto.randomUUID(),type,units,date,reason:'Synthetic request'});
const decide=(r,decision='Approved')=>({action:'leave_decision',employee_id:id,record_id:r.record_id,decision,reason:'Verified synthetic evidence'});
test('half-day paid leave is 270 minutes on a 9-hour schedule; unpaid leave pays zero',()=>{
 let s=setup();s=act(s,{action:'balance',employee_id:id,type:'Annual',kind:'opening',units:15,date:'2026-01-01',record_id:crypto.randomUUID(),reason:'Verified synthetic balance'});
 const half=request('Annual',0.5);s=act(s,half);assert.equal(balance(s,id,'Annual','2026-10-19'),15);s=act(s,decide(half));assert.equal(s.leave[0].paid_minutes,270);assert.equal(balance(s,id,'Annual','2026-10-19'),14.5);
 const unpaid=request('Unpaid',0.5);s=act(s,unpaid);s=act(s,decide(unpaid));assert.equal(s.leave[1].paid_minutes,0);
 const rows=periodHours(s.people,[],s.leave,'2026-10-19','2026-10-19');assert.equal(rows[0].paid_leave_minutes,270);assert.equal(rows[0].payroll_ready,false);
 s=act(s,decide(half,'Cancelled'));assert.equal(balance(s,id,'Annual','2026-10-19'),15);assert.equal(s.ledger.filter(x=>x.kind==='reversal').length,1);assert.throws(()=>act(s,decide(half,'Cancelled')),/already been reviewed/);
});
test('unknown schedules/balances, non-working days, overlapping leave and future overdraw cannot be approved',()=>{
 let s=act(blankStaff(),{action:'person',person}),r=request('Annual',1);s=act(s,r);assert.throws(()=>act(s,decide(r)),/working schedule/);
 s=act(s,{action:'schedule',employee_id:id,from:'2026-01-01',minutes:[540,540,540,540,540,480,0],reason:'Schedule'});assert.throws(()=>act(s,decide(r)),/opening leave balance/);
 s=act(s,{action:'balance',employee_id:id,type:'Annual',kind:'opening',units:1,date:'2026-01-01',record_id:crypto.randomUUID(),reason:'Verified balance'});
 const future=request('Annual',1,'2026-10-20');s=act(s,future);s=act(s,decide(future));assert.throws(()=>act(s,decide(r)),/overdraw/);
 const sunday=request('Unpaid',1,'2026-10-18');s=act(s,sunday);assert.throws(()=>act(s,decide(sunday)),/working schedule/);
 const extra=request('Unpaid',0.5,'2026-10-20');s=act(s,extra);assert.throws(()=>act(s,decide(extra)),/exceeds one/);
});
test('Saturday and recorded breaks count; no implicit lunch, overtime or holiday multipliers',()=>{
 const s=setup(),a=shift(punch('in','2026-10-17T07:00:00'),punch('break_start','2026-10-17T12:00:00'),punch('break_end','2026-10-17T12:30:00'),punch('out','2026-10-17T17:00:00'));
 const rows=periodHours(s.people,[a],[],'2026-10-17','2026-10-17');assert.equal(rows[0].completed_seconds,9.5*3600);assert.equal(rows[0].days[0].break_seconds,1800);
 assert.equal(shiftSummary(shift(punch('in','2026-10-17T07:00:00'),punch('out','2026-10-17T17:00:00'))).worked_seconds,10*3600);
});
test('duplicate and out-of-order punches fail, including invalid dates; clock-out during break counts the break once',()=>{
 const s=shift(punch('in','2026-10-19T07:00:00'));
 assert.throws(()=>appendPunch(s,'in',punch('in','2026-10-19T07:06:00').at),/one clock-in/);
 assert.throws(()=>appendPunch(s,'out',s.punches[0].at),/chronological/);
 assert.throws(()=>shiftSummary(shift({kind:'in',at:'2026-02-30T07:00:00Z'})),/valid UTC/);
 const a=shift(...s.punches,punch('break_start','2026-10-19T12:00:00'),punch('out','2026-10-19T13:00:00'));assert.equal(shiftSummary(a).worked_seconds,5*3600);assert.equal(shiftSummary(a).break_seconds,3600);
});
test('open and next-day shifts remain in review; verified overnight time splits across local calendar days',()=>{
 const s=setup(),overnight=shift(punch('in','2026-10-19T22:00:00'),punch('out','2026-10-20T06:00:00'));
 let r=periodHours(s.people,[overnight],[],'2026-10-19','2026-10-20')[0];assert.equal(r.completed_seconds,0);assert.equal(r.review_seconds,8*3600);assert.ok(r.issues.includes('Spans midnight'));
 overnight.reviewed={actor:'alinda',reason:'Verified overnight duty'};r=periodHours(s.people,[overnight],[],'2026-10-19','2026-10-20')[0];assert.equal(r.completed_seconds,8*3600);assert.deepEqual(r.days.map(d=>d.completed_seconds),[2*3600,6*3600]);
 const missing=shift(punch('in','2026-10-19T07:00:00'),punch('out','2026-10-20T17:00:00'));r=periodHours(s.people,[missing],[],'2026-10-19','2026-10-20')[0];assert.equal(r.completed_seconds,0);assert.ok(r.issues.includes('Long shift'));
 const open=shift(punch('in','2026-10-19T07:00:00'));r=periodHours(s.people,[open],[],'2026-10-19','2026-10-19')[0];assert.equal(r.completed_seconds,0);assert.ok(r.issues.includes('Open shift'));
});
test('missing attendance and work/leave overlap stay visible rather than becoming automatic absence or double pay',()=>{
 const s=setup(),r=periodHours(s.people,[],[],'2026-10-19','2026-10-19',Date.parse('2026-10-21T12:00:00Z'))[0];assert.ok(r.issues.includes('Missing attendance record'));assert.equal(s.ledger.length,0);
 const a=shift(punch('in','2026-10-19T07:00:00'),punch('out','2026-10-19T12:00:00'));const result=periodHours(s.people,[a],[{employee_id:id,date:'2026-10-19',status:'Approved',units:0.5,paid_minutes:270}],'2026-10-19','2026-10-19')[0];assert.ok(result.issues.includes('Work and leave on the same day'));assert.equal(result.payroll_ready,false);
 assert.equal(dayAt('2026-10-19T22:30:00Z'),'2026-10-20');assert.throws(()=>periodHours(s.people,[],[],'2026-01-01','2026-02-01'),/31 days/);
});

test('birthday PINs keep month/day order, leading zeros and leap-day birthdays; private dates survive other edits',()=>{
 for(const [date,pin] of [['1988-06-15','0615'],['1990-01-01','0101'],['2000-02-29','0229'],['1985-11-11','1111'],['1995-12-31','1231']])assert.equal(birthdayPin(date),pin);
 for(const date of ['2001-02-29','2000-13-01','15/06/1988',null])assert.throws(()=>birthdayPin(date),/valid/);
 let s=act(blankStaff(),{action:'person',person:{...person,birth_date:'1988-06-15'}});assert.equal(s.people[0].birth_date,'1988-06-15');
 s=act(s,{action:'person',person:{...person,name:'Changed name'}});assert.equal(s.people[0].birth_date,'1988-06-15');
 s=act(s,{action:'birth_date',employee_id:id,birth_date:'2000-02-29'});assert.equal(birthdayPin(s.people[0].birth_date),'0229');
 assert.throws(()=>act(s,{action:'birth_date',employee_id:id,birth_date:'2026-10-20'}),/future/);
 assert.throws(()=>act(s,{action:'person',person:{...person,birth_date:'2099-06-15'}}),/future/);
 s=act(s,{action:'person',person:{...person,birth_date:null}});assert.equal(s.people[0].birth_date,null);
 const imported={...blankStaff(),people:[{...person,start_date:null,employment_verified:false,source_profile:{identity_number:'synthetic-only'},schedules:[]}]};
 s=act(imported,{action:'birth_date',employee_id:id,birth_date:'1988-06-15'});assert.equal(s.people[0].start_date,null);assert.equal(s.people[0].employment_verified,false);assert.equal(s.people[0].source_profile.identity_number,'synthetic-only');
});
