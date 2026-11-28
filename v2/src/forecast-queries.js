import {addDays,today,routeName,comparableRouteVisit,previousRouteVisit,routeScheduled} from './domain.js';
import {hash} from './auth.js';
import {forecastRoute} from './month-cycle.js';
import {effectiveHistory} from './forecast-history.js';

export async function forecastResult(db,date,route,c){
 const from=addDays(date,-168),asOf=today();
 const history=await db.prepare('SELECT service_date AS date,product,qty,quality,source,constrained FROM v2_history WHERE route=? AND service_date>=? AND service_date<? ORDER BY service_date,product').bind(route,from,date).all();
 const events=await db.prepare(`SELECT e.*, confirmed.action AS confirmation_action, confirmed.payload AS confirmation_payload
 FROM v2_events e JOIN (SELECT run_id,MAX(revision) revision FROM v2_events WHERE route=? AND service_date>=? AND service_date<? GROUP BY run_id) latest ON e.run_id=latest.run_id AND e.revision=latest.revision
 LEFT JOIN v2_events confirmed ON confirmed.run_id=e.run_id AND confirmed.revision=(
  SELECT MAX(a.revision) FROM v2_events a WHERE a.run_id=e.run_id AND a.action IN ('returns','close','reopen','load')
 )`).bind(route,from,date).all();
 const effective=effectiveHistory(history.results,events.results,{from,to:date,asOf});
 const definition=c.routes.find(r=>r.code===route),rows=effective.rows.filter(r=>comparableRouteVisit(definition,date,r.date));
 const {forecasts,month_cycle}=forecastRoute(rows,date,c.products.map(p=>p.code));
 for(const f of Object.values(forecasts)){if(f.missing_dates)f.missing_dates=f.missing_dates.filter(d=>comparableRouteVisit(definition,date,d));if(!routeScheduled(definition,date))f.warning='This route is not scheduled for this date. Choose a scheduled date, or enter an explicit exceptional load.';}
 const expected=previousRouteVisit(definition,date,asOf),expectedRows=rows.filter(r=>r.date===expected);
 const snapshot=await hash(JSON.stringify({version:'1.5-explained-safety-stock',date,route,schedule:definition?.schedule??null,products:c.products.map(p=>p.code).sort(),rows,excluded:effective.excluded}));
 return {forecasts,snapshot,route_name:routeName(definition,date),scheduled:routeScheduled(definition,date),model:'8/12-week baseline with measured month phase and latest comparable sales safety minimum',month_cycle,expected_visit:expected,latest_actual:rows.at(-1)?.date??null,expected_visit_present:expectedRows.length>0,excluded_count:effective.excluded.length,cycle_excluded_count:effective.rows.length-rows.length,provisional_count:rows.filter(r=>r.quality==='provisional').length};
}
