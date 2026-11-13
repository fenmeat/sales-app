import test from 'node:test';
import assert from 'node:assert/strict';
import {replayEvidence,knownCases,chooseAuditedPolicy} from '../src/forecast-policy-audit.js';
const forecasts=(legacy,signed)=>Object.fromEntries(['legacy','signed','balanced','empirical'].map(p=>[p,{qty:p==='signed'?signed:legacy}]));
const cases=[5,12,19].map(n=>({route:'R01',date:'2026-10-'+String(n).padStart(2,'0'),product:'A',actual:10,returned:5,censored:false,forecasts:forecasts(20,13)}));
const target={route:'R01',date:'2026-11-02',product:'A'};
const route={code:'R01',weekday:1};
test('late confirmations and invalidations are replayed at the decision time',()=>{
 const e={imported:[],timeline:[{date:'2026-10-01',saved_at:'2026-10-02T00:00:00Z',revision:1,captured:['A'],rows:[['A',10,'provisional',false,15,5]]},{date:'2026-10-01',saved_at:'2026-10-03T00:00:00Z',revision:2,captured:['A'],rows:[]}]};
 assert.equal(replayEvidence(e,'2026-10-01T03:00:00Z').length,0);
 assert.equal(replayEvidence(e,'2026-10-02T03:00:00Z')[0].qty,10);
 assert.equal(replayEvidence(e,'2026-10-03T03:00:00Z').length,0);
});
test('selection uses then-known outcomes, never corrected future targets',()=>{
 const known=cases.map(c=>({date:c.date,product:c.product,qty:10,quality:'provisional',loaded:15,returned:5}));
 const poison=cases.map(c=>({...c,actual:9999}));
 const past=knownCases(poison,known,target,route);
 assert.equal(chooseAuditedPolicy(past,target).policy,'signed');
 assert.equal(knownCases(poison,known.map(r=>({...r,returned:null})),target,route).length,0);
 assert.equal(knownCases(poison,known,{...target,date:'2026-10-01'},route).length,0);
});
test('alternating service variants cannot borrow the other visit results',()=>{
 const alternating={...route,schedule:{anchor_date:'2026-10-05',weeks:2,active_weeks:[0,1],names:['First','Second']}};
 const known=cases.map(c=>({date:c.date,product:c.product,qty:10,quality:'provisional',loaded:15,returned:5}));
 assert.deepEqual(knownCases(cases,known,target,alternating).map(c=>c.date),['2026-10-05','2026-10-19']);
 assert.throws(()=>knownCases(cases,known,target),/route schedule/);
});
test('three products on one date do not establish three visits',()=>{
 const past=cases.map((c,i)=>({...c,date:'2026-10-01',product:String(i)}));
 assert.equal(chooseAuditedPolicy(past,target,{scope:'route'}).policy,'legacy');
});
test('one newly observed shortfall vetoes a previously attractive reduction',()=>{
 assert.equal(chooseAuditedPolicy(cases,target).policy,'signed');
 const bad=[...cases,{...cases[0],date:'2026-10-22',actual:18,censored:true,returned:0}];
 assert.equal(chooseAuditedPolicy(bad,target).policy,'legacy');
});
