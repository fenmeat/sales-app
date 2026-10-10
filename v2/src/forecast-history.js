import {itemSales, summarise, isQty} from './domain.js';

// Forecast provenance is derived from saved events, never supplied by the browser.
export function stockSignature(run) {
  return JSON.stringify(run.items.map(i=>[i.code,i.loaded,i.returned,i.adjustment,i.sold_out]).sort((a,b)=>a[0].localeCompare(b[0])));
}

export function effectiveHistory(imported, events, {from, to, asOf}) {
  const rows=new Map(imported.filter(r=>r.date>=from&&r.date<to&&r.date<=asOf).map(r=>[r.date+'|'+r.product,{...r,constrained:r.constrained===true||r.constrained===1}]));
  const excluded=[];
  for(const event of events) {
    const run=JSON.parse(event.payload);
    if(run.date<from||run.date>=to||run.date>asOf||run.date<'2026-10-01')continue;
    if(run.phase==='plan')continue;
    // A later draft edit, reload or reopening invalidates the earlier physical approval.
    const approved=['returned','closed'].includes(run.phase)&&['returns','close'].includes(event.confirmation_action)&&event.confirmation_payload&&stockSignature(run)===stockSignature(JSON.parse(event.confirmation_payload));
    const summary=summarise(run);
    for(const item of run.items) {
      const key=run.date+'|'+item.code;
      rows.delete(key); // Never fall back to a stale legacy copy of this captured item.
      if(!approved){if(item.loaded>0)excluded.push({date:run.date,product:item.code,reason:'Confirm returns again after stock changes.'});continue;}
      if(!(item.loaded>0))continue; // Not carried does not establish zero demand.
      const qty=itemSales(item),comparison=summary.items.find(i=>i.code===item.code);
      if(!isQty(qty)||item.returned===null||item.adjustment!==0){excluded.push({date:run.date,product:item.code,reason:'Incomplete or adjusted stock movement.'});continue;}
      if(run.recon?.complete&&comparison?.variance!==0){excluded.push({date:run.date,product:item.code,reason:'Stock and invoice quantities differ.'});continue;}
      const matched=run.recon?.complete&&comparison?.variance===0;
      rows.set(key,{date:run.date,product:item.code,qty,quality:matched?'verified':'provisional',source:matched?'v2_stock_matched':'v2_confirmed_returns',constrained:item.sold_out===true||item.returned===0});
    }
  }
  return {rows:[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.product.localeCompare(b.product)),excluded};
}

// An explicit refresh updates suggestions only. Plans (including zero), physical
// loads, returns, cash, product snapshots and notes are never rewritten.
export function applyForecastRefresh(run, latest) {
  return {...run,forecast_snapshot:latest.snapshot,items:run.items.map(i=>({...i,forecast:latest.forecasts[i.code]??null}))};
}
