import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveImport,validateBundle} from '../src/staff-import.js';
import {applyStaffAction} from '../src/staff-domain.js';
import {sourceFixture} from './fixtures/staff-source.js';
test('Staff source import preserves raw evidence, dates, zero-prefixed banking and separate historical names',async()=>{
 const b=sourceFixture(),before=JSON.stringify(b),r=await deriveImport(b,'a'.repeat(64));
 assert.equal(r.people.length,5);assert.equal(r.summary.active,3);assert.equal(r.summary.historical,2);
 const worker=r.people.find(p=>p.name==='Synthetic worker');assert.equal(worker.start_date,'2023-03-15');assert.equal(worker.employment_verified,false);assert.equal(worker.source_profile.bank.account_number,'00001234');assert.equal(worker.source_profile.leave_snapshot.Sick,-3);assert.equal(worker.source_profile.week_snapshot.status,'Paid');assert.equal(worker.source_profile.rate_effective_from,null);
 assert.equal(r.people.find(p=>p.name==='Second worker').start_date,null);assert.equal(r.people.find(p=>p.name==='Casual (Pad)').active,false);assert.equal(r.people.find(p=>p.name==='Earlier name').active,false);
 assert.equal(JSON.stringify(b),before);assert.equal((await deriveImport(b,'a'.repeat(64))).people[0].id,r.people[0].id);
 const state={people:r.people,leave:[],ledger:[]};assert.throws(()=>applyStaffAction(state,{action:'schedule',employee_id:worker.id,from:'2026-10-19',minutes:[540,540,540,540,540,0,0],reason:'Test'},'alex',b.source.captured_at),/Confirm the imported employment date/);
 const confirmed=applyStaffAction(state,{action:'employment_date',employee_id:worker.id,date:'2023-03-16',reason:'Synthetic employment record verified'},'alex',b.source.captured_at);
 assert.equal(confirmed.state.people[0].start_date,'2023-03-16');assert.equal(confirmed.state.people[0].employment_verified,true);assert.equal(confirmed.detail.previous_date,'2023-03-15');assert.equal(confirmed.state.ledger.length,0);
 assert.throws(()=>applyStaffAction(confirmed.state,{action:'employment_date',employee_id:worker.id,date:'2023-03-17',reason:'Test'},'alex',b.source.captured_at),/already been confirmed/);
});
test('Staff source validation rejects missing or duplicate sheets and reordered rows',()=>{
 let b=sourceFixture();b.sheets.splice(0,1);assert.throws(()=>validateBundle(b),/Missing source sheet/);
 b=sourceFixture();b.sheets.push(b.sheets[0]);assert.throws(()=>validateBundle(b),/Duplicate/);
 b=sourceFixture();b.sheets[0].rows[1].number=1;assert.throws(()=>validateBundle(b),/row order/);
});
