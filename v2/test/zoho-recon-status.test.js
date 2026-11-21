import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {zohoReconciliationStatus,zohoStatusTime} from '../public/zoho-recon-status.js';
import {routeName} from '../src/domain.js';

function fixture(){
 const run={date:'2026-10-12',route:'R01',phase:'returned',cash:{counted:10000},recon:{date:'2026-10-12',route:'R01',complete:true,zoho_job_id:'test-job',imported_at:'2026-10-14T13:22:54Z',invoice_lines:[],payments:[]}};
 return {run,revision:2,saved_at:'2026-10-14T13:24:23Z'};
}
test('saved exact snapshot survives page reload with no in-memory read job',()=>{
 const result=fixture(),savedRun=structuredClone(result.run),before=structuredClone(result);
 const status=zohoReconciliationStatus(result,savedRun,null);
 assert.equal(status.kind,'saved');assert.equal(status.title,'Zoho-data gestoor');assert.equal(status.button,'Herlaai uit Zoho');
 assert.equal(status.readAt,result.run.recon.imported_at);assert.equal(status.savedAt,result.saved_at);assert.equal(status.revision,2);
 result.run.cash.counted=20000;
 assert.equal(zohoReconciliationStatus(result,savedRun,null).kind,'saved','Unrelated unsaved capture does not change snapshot persistence');
 result.run.cash.counted=10000;assert.deepEqual(result,before,'Status does not mutate business data');
});
test('completed read and failed save cannot masquerade as saved',()=>{
 const result=fixture(),savedRun=structuredClone(result.run),job={done:true,result:{complete:true}};
 result.run.recon.zoho_job_id='new-job';result.run.recon.imported_at='2026-10-14T14:00:00Z';
 const status=zohoReconciliationStatus(result,savedRun,job);
 assert.equal(status.kind,'unsaved');assert.match(status.title,/nog nie gestoor/);assert.match(status.message,/Save draft/);assert.equal(status.savedAt,null);
 assert.equal(zohoReconciliationStatus(result,null,job).kind,'unsaved','An old revision alone is not evidence for this snapshot');
 assert.equal(zohoReconciliationStatus({...result,revision:0},structuredClone(result.run),job).kind,'unsaved');
 assert.equal(zohoReconciliationStatus({...result,revision:3},structuredClone(result.run),job).kind,'saved','Only a successful save updates the acknowledged snapshot');
});
test('same job id with changed contents is still unsaved',()=>{
 const result=fixture(),saved=structuredClone(result.run);result.run.recon.payments.push({id:'new',cents:10});
 assert.equal(zohoReconciliationStatus(result,saved,null).kind,'unsaved');
});
test('no data, manual extracts, incomplete reads and other route/date never claim a saved Zoho read',()=>{
 for(const mutate of [r=>r.recon=null,r=>delete r.recon.zoho_job_id,r=>r.recon.complete=false,r=>r.recon.route='R02',r=>r.recon.date='2026-10-13']){
  const result=fixture();mutate(result.run);const status=zohoReconciliationStatus(result,structuredClone(result.run),null);
  assert.equal(status.kind,'empty');assert.equal(status.readAt,null);assert.equal(status.savedAt,null);assert.equal(status.button,'Load Zoho for this route');
 }
 const result=fixture(),saved=structuredClone(result.run);saved.route='R02';assert.equal(zohoReconciliationStatus(result,saved,null).kind,'unsaved');
});
test('interrupted or incomplete refresh identifies the retained previous snapshot',()=>{
 const result=fixture(),saved=structuredClone(result.run);
 const paused=zohoReconciliationStatus(result,saved,{done:false});assert.equal(paused.kind,'saved');assert.equal(paused.title,'Vorige Zoho-data gestoor');assert.equal(paused.button,'Resume Zoho read');
 const failed=zohoReconciliationStatus(result,saved,{done:true,result:{complete:false}});assert.equal(failed.title,'Vorige Zoho-data gestoor');assert.equal(failed.button,'Herlaai uit Zoho');
});
test('times are explicitly South African and invalid timestamps stay unknown',()=>{
 assert.equal(zohoStatusTime('2026-10-14T13:24:23Z'),'2026/10/14, 15:24 SAST');
 assert.equal(zohoStatusTime(null),'Tyd nie aangeteken nie');assert.equal(zohoStatusTime('invalid'),'Tyd nie aangeteken nie');
});
test('actual read panel displays saved and unsaved status, connection loss and locked days correctly',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const panel=source.slice(source.indexOf('function zohoReconPanel('),source.indexOf('async function loadZohoReconciliation('));
 const result=fixture(),state={date:result.run.date,route:result.run.route,result,savedRun:structuredClone(result.run),zohoRecon:null,bootstrap:{catalog:{routes:[{code:'R01',name:'TEST ROUTE'}]},zoho:{connected:true,can_manage:true}}};
 const context={state,zohoReconciliationStatus,zohoStatusTime,routeName,escape:String};
 const render=()=>runInNewContext(panel+';zohoReconPanel()',context);
 let html=render();assert.match(html,/Zoho-data gestoor/);assert.match(html,/Herlaai uit Zoho/);assert.match(html,/15:22 SAST/);assert.match(html,/15:24 SAST/);assert.doesNotMatch(html,/The saved Zoho connection is available/);
 state.result.run.recon.zoho_job_id='new-job';html=render();assert.match(html,/nog nie gestoor nie/);assert.match(html,/Druk Save draft/);assert.doesNotMatch(html,/Roete gestoor:/);
 state.savedRun=structuredClone(state.result.run);state.bootstrap.zoho.connected=false;html=render();assert.match(html,/Zoho-data gestoor/);assert.match(html,/id="zoho-reconcile" disabled/);assert.match(html,/Reeds gestoorde data bly behoue/);
 state.bootstrap.zoho.connected=true;state.result.run.phase='closed';assert.match(render(),/id="zoho-reconcile" disabled/);
});
