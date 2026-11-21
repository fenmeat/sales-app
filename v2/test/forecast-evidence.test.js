import test from 'node:test';
import assert from 'node:assert/strict';
import {compactForecastTimeline} from '../src/forecast-evidence.js';
import {emptyRun} from '../src/domain.js';
test('audit retains availability, invalidation and reconfirmation without private payloads',()=>{
 const run=emptyRun('2026-10-05','R01',[{code:'A',name:'A',price_cents:100,unit:'bag',active:true,available:true}]);
 run.notes='PRIVATE';run.phase='loaded';run.items[0].loaded=30;
 const events=[];function save(action){events.push({run_id:'test',revision:events.length+1,action,saved_at:`2026-10-0${events.length+5}T12:00:00Z`,payload:JSON.stringify(run)});}
 save('load');run.phase='returned';run.items[0].returned=5;save('returns');run.notes='OTHER PRIVATE';save('save');run.items[0].returned=6;save('save');save('returns');
 const out=compactForecastTimeline(events);
 assert.equal(out.length,4);assert.deepEqual(out.map(e=>e.rows.length),[0,1,0,1]);
 assert.equal(out[1].rows[0][1],25);assert.equal(out[3].rows[0][1],24);
 assert.equal(out[1].saved_at,events[1].saved_at);assert.equal(out[3].revision,5);
 assert.doesNotMatch(JSON.stringify(out),/PRIVATE|notes|cash/);
});
