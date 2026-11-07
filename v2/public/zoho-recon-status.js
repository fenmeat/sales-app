// Persisted business state, not connection status or completion of a read job,
// determines whether this exact route/date snapshot has been saved.
const hasZohoRead=run=>run?.recon?.complete===true&&typeof run.recon.zoho_job_id==='string'&&run.recon.zoho_job_id.length>0&&run.recon.date===run.date&&run.recon.route===run.route;
export function zohoReconciliationStatus(result,savedRun,job){
 const run=result?.run,loaded=hasZohoRead(run);
 const saved=loaded&&result.revision>0&&hasZohoRead(savedRun)&&savedRun.date===run.date&&savedRun.route===run.route&&JSON.stringify(savedRun.recon)===JSON.stringify(run.recon);
 const reading=!!job&&!job.done,needsAttention=job?.done&&job.result?.complete===false;
 const kind=saved?'saved':loaded?'unsaved':'empty';
 return {kind,
  title:saved?(reading||needsAttention?'Vorige Zoho-data gestoor':'Zoho-data gestoor'):loaded?'Zoho-data gelees — nog nie gestoor nie':'Nog geen Zoho-data gelaai nie',
  message:saved?(reading||needsAttention?'Die vorige gestoorde lesing bly behoue totdat ’n nuwe volledige lesing gestoor word.':'Jy hoef nie weer te laai nie, tensy fakture of betalings in Zoho verander het.'):loaded?'Druk Save draft om hierdie Zoho-lesing te bewaar.':run?.recon?'Hierdie vergelyking gebruik ’n handmatige invoer. Laai Zoho om ’n nuwe Zoho-lesing te kry.':'Laai die fakture en betalings vir hierdie roete en datum.',
  readAt:loaded?run.recon.imported_at:null,
  savedAt:saved?result.saved_at:null,
  revision:saved?result.revision:null,
  button:reading?'Resume Zoho read':loaded?'Herlaai uit Zoho':'Load Zoho for this route'
 };
}
export function zohoStatusTime(value){
 const stamp=value?new Date(value):null;
 return stamp&&Number.isFinite(stamp.getTime())?stamp.toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})+' SAST':'Tyd nie aangeteken nie';
}
