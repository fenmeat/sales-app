import test from 'node:test';
import assert from 'node:assert/strict';
import {clockDays,payHistory,employeeHistory,historyCoverage,sourceTimestamp} from '../src/staff-history.js';
import {deriveImport} from '../src/staff-import.js';
import {sourceFixture} from './fixtures/staff-source.js';
const c=v=>({effectiveValue:{[typeof v==='number'?'numberValue':'stringValue']:v},formattedValue:String(v)});
const row=(n,values)=>({number:n,cells:values.map(c)});
test('Historical work time keeps SAST, deducts recorded breaks and refuses duplicate, missing or overnight sequences',()=>{
 const d=46318;assert.equal(sourceTimestamp(d),'2026-10-23T00:00:00');
 const good=clockDays([row(2,[d+6/24,'A','in']),row(3,[d+9/24,'A','tea_start']),row(4,[d+9.5/24,'A','tea_end']),row(5,[d+14/24,'A','out'])])[0];
 assert.equal(good.recorded_seconds,7.5*3600);assert.equal(good.events[0].at,'2026-10-23T06:00:00');assert.deepEqual(good.issues,[]);
 assert.equal(clockDays([row(2,[d+6/24,'A','in']),row(3,[d+6/24,'A','in']),row(4,[d+14/24,'A','out'])])[0].recorded_seconds,null);
 assert.equal(clockDays([row(2,[d+6/24,'A','in'])])[0].recorded_seconds,null);
 assert.ok(clockDays([row(2,[d+22/24,'A','in']),row(3,[d+1+6/24,'A','out'])]).every(d=>d.recorded_seconds===null));
 assert.equal(clockDays([row(2,[d,'A','out'])])[0].recorded_seconds,null);
});
test('UIF date variants preserve zero and missing amounts; duplicates count once and conflicts never sum',()=>{
 const p=payHistory([row(2,[46318,'A',1000,0,0,0]),row(3,[46318,'A',1000,0,0,0]),row(4,[46325,'A',1200,12,12,24]),row(5,[46325,'A',1300,13,13,26]),row(6,[46332,'A',1400,'',14,28])]);
 assert.equal(p[0].status,'Recorded');assert.equal(p[0].amount.employee_uif_cents,0);assert.equal(p[0].duplicates,1);assert.deepEqual(p[0].amount.rows,[2,3]);
 assert.equal(p[1].status,'Conflict');assert.equal(p[1].amount,null);assert.equal(p[1].variants.length,2);
 assert.equal(p[2].status,'Incomplete');assert.equal(p[2].amount,null);
});
test('Employee history uses exact source identities, preserves snapshots and exposes incomplete leave formulas',async()=>{
 const b=sourceFixture(),clock=b.sheets.find(s=>s.name==='Clock Log'),leave=b.sheets.find(s=>s.name==='Leave');
 clock.rows.push(row(6,[46318.3,'Synthetic worker two','in']),row(7,[46318.3,'   ','in']));
 leave.rows.at(-1).cells[1].userEnteredValue={formulaValue:"=SUMIF('Leave Log'!B4:B4,A5,'Leave Log'!D4:D4)"};
 leave.rows.at(-1).cells[1].effectiveValue.numberValue=7;
 const derived=await deriveImport(b,'archive'),p=derived.people[0];p.name='Confirmed new display name';
 const h=employeeHistory(b,p,'archive');assert.equal(h.employee.source_name,'Synthetic worker');assert.equal(h.employee.name,p.name);assert.equal(h.coverage.clock_rows,3);
 assert.equal(h.leave_balances[0].log_days,6);assert.equal(h.leave_balances[0].source_taken,7);assert.equal(h.leave_balances[0].source_balance,9);assert.equal(h.leave_balances[0].difference,-1);assert.equal(h.leave_balances[0].range_ends_before_log,true);
 assert.equal(h.rate.effective_from,null);assert.equal(h.pay_snapshot.normal_hours,40);assert.equal(h.pay_snapshot.net,1584);assert.equal(h.pay_snapshot.source_status,'Paid');assert.equal(h.pay[0].amount.gross_cents,160000);assert.equal(h.pay[0].amount.net,undefined);assert.equal(h.months[0].gross_cents,160000);
 assert.deepEqual(historyCoverage(b).clock.unassigned_rows,[7]);assert.equal(historyCoverage(b).leave.from,'2026-06-26');
 assert.equal(employeeHistory(b,{id:'native',name:'Synthetic worker'},'archive').coverage.clock_rows,0,'a matching display name alone does not link a native employee');
 assert.ok(h.source_records.find(s=>s.sheet==='Employees').rows[0].cells[2].formattedValue==='00001234');
});
