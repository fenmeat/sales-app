import test from 'node:test';
import assert from 'node:assert/strict';
import {reportFollowup} from '../src/pa-report-api.js';
test('report separates a recent answer, future Deli payment, waiting party and final completion',()=>{
 const rows=[{id:'TSK-00156',status:'Pending',review_date:'2026-11-12',next_action:'Vra ’n antwoorddatum.'},{id:'TSK-00211',status:'Scheduled',review_date:'2026-11-30',next_action:'Kontroleer die staat en betaaldatum.'},{id:'TSK-00003',status:'Waiting',review_date:'2026-11-16',next_action:'Wag op die verskaffer.'},{id:'TSK-00004',status:'Complete'},{id:'TSK-00005',status:'Waiting',review_date:'',next_action:'Wag op ’n ander persoon.'}];
 const f={source_task_ids:['TSK-00156'],id:'question',created_at:'2026-11-12T14:00:00Z',answered_at:'2026-11-12T15:00:00Z',answer:{text:'Volg kortliks op.',recommendation:'Vra ’n datum.'}};
 const r=reportFollowup(rows,[f],'2026-11-12','2026-11-11T14:00:00Z');
 assert.equal(r[0].category,'answered');assert.equal(r[0].include_answer_update,true);assert.equal(r[1].include_in_action_list,false);assert.equal(r[2].include_in_action_list,false);assert.equal(r[3].category,'completed');assert.equal(r[4].category,'waiting');
 assert.equal(reportFollowup(rows,[f],'2026-11-30','2026-11-29T14:00:00Z')[1].include_in_action_list,true);
 assert.deepEqual(rows[1],{id:'TSK-00211',status:'Scheduled',review_date:'2026-11-30',next_action:'Kontroleer die staat en betaaldatum.'});
});
