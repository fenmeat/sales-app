import test from 'node:test';
import assert from 'node:assert/strict';
import {localDay,clockTime,hoursLabel} from '../public/staff-model.js';
test('South African display dates and times are independent of the phone timezone',()=>{
 assert.equal(localDay('2026-10-19T22:30:00Z'),'2026-10-20');assert.equal(clockTime('2026-10-19T12:30:00Z'),'14:30');
 assert.equal(clockTime('2026-10-19T22:00:00Z'),'00:00');
});
test('attendance display preserves long durations and does not round fractional minutes into extra pay',()=>{
 assert.equal(hoursLabel(270*60),'4h 30m');assert.equal(hoursLabel(34*3600),'34h 00m');assert.equal(hoursLabel(3599.999),'0h 59m');assert.equal(hoursLabel(0),'0h 00m');
});
