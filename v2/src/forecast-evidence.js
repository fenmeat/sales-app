import {addDays} from './domain.js';
import {effectiveHistory} from './forecast-history.js';

// Admin read-only audit for reproducible, point-in-time forecast comparisons.
// No customer, payment, staff, note or credential data leaves this projection.
export async function forecastEvidence(db,date,route) {
 const from=addDays(date,-168);
 const imported=await db.prepare('SELECT service_date AS date,product,qty,quality,source,constrained FROM v2_history WHERE route=? AND service_date>=? AND service_date<? ORDER BY service_date,product').bind(route,from,date).all();
 const sync=await db.prepare("SELECT saved_at FROM v2_sync WHERE id='history'").first();
 const events=await db.prepare('SELECT run_id,revision,action,payload,saved_at FROM v2_events WHERE route=? AND service_date>=? AND service_date<? ORDER BY run_id,revision').bind(route,from,date).all();
 return {from,to:date,import_available_at:sync?.saved_at??null,
  imported_columns:['date','product','qty','quality','source','constrained'],
  imported:imported.results.map(r=>[r.date,r.product,r.qty,r.quality,r.source,r.constrained]),
  observation_columns:['product','qty','quality','constrained','loaded','returned'],
  timeline:compactForecastTimeline(events.results),
  limitation:'Legacy rows have no per-row import timestamp. Use import_available_at conservatively; never treat them as available earlier. Current schedule definitions are not a historical catalogue archive.'};
}

export function compactForecastTimeline(events) {
 const confirmations=new Map(),signatures=new Map(),timeline=[];
 for(const event of events) {
  const run=JSON.parse(event.payload);
  if(['returns','close','reopen','load'].includes(event.action))confirmations.set(event.run_id,event);
  const confirmation=confirmations.get(event.run_id);
  const effective=effectiveHistory([],[{...event,confirmation_action:confirmation?.action,confirmation_payload:confirmation?.payload}],{from:run.date,to:addDays(run.date,1),asOf:run.date});
  const rows=effective.rows.map(r=>{const item=run.items.find(i=>i.code===r.product);return [r.product,r.qty,r.quality,r.constrained,item.loaded,item.returned];});
  const excluded=effective.excluded.map(r=>[r.product,r.reason]);
  const captured=run.phase==='plan'?[]:run.items.map(i=>i.code);
  const signature=JSON.stringify({rows,excluded,captured});
  if(signatures.get(event.run_id)===signature)continue;
  signatures.set(event.run_id,signature);
  timeline.push({date:run.date,revision:event.revision,saved_at:event.saved_at,phase:run.phase,captured,rows,excluded});
 }
 return timeline;
}
