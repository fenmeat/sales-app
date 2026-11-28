import {effectiveAvailability,FACTORY_ROUTE,summarise} from './domain.js';

export async function catalog(db){const r=await db.prepare('SELECT * FROM v2_catalog WHERE id=1').first();return effectiveAvailability(r?{...JSON.parse(r.payload),revision:r.revision}:{products:[],routes:[],revision:0});}
export function catalogForBrowser(c){return {...c,routes:c.routes.filter(r=>r.code!==FACTORY_ROUTE).map(r=>{const {invoice_stores,...publicRoute}=r;return {...publicRoute,invoice_enabled:!!invoice_stores?.length};})};}
export const idFor=(d,r)=>`${d}|${r}`;
export async function lastEvent(db,date,route){return db.prepare('SELECT * FROM v2_events WHERE run_id=? ORDER BY revision DESC LIMIT 1').bind(idFor(date,route)).first();}
export async function runResult(db,date,route){const e=await lastEvent(db,date,route);if(e){const run=JSON.parse(e.payload);return {run,revision:e.revision,saved_at:e.saved_at,actor:e.actor,summary:summarise(run)};}return null;}

export async function readSalesRuns(db,from,to,route){
 const filter=route?' AND route=?':'';
 const latest=db.prepare(`SELECT e.payload,e.revision,e.actor,e.saved_at FROM v2_events e
  JOIN (SELECT run_id,MAX(revision) revision FROM v2_events WHERE service_date BETWEEN ? AND ?${filter} GROUP BY run_id) head
  ON e.run_id=head.run_id AND e.revision=head.revision ORDER BY e.service_date,e.route`);
 const {results}=await latest.bind(from,to,...(route?[route]:[])).all();
 return results.map(row=>{
  const run=JSON.parse(row.payload);
  return {run,revision:row.revision,actor:row.actor,saved_at:row.saved_at,summary:summarise(run)};
 });
}
