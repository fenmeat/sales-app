import {money,toCents} from './finance-domain.js';
import {BUDGET_CATEGORIES,budgetSummary,emptyBudget,copyBudget} from './budget-domain.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=n=>n==null?'':(n/100).toFixed(2);
let selectedMonth='';
export function budgetCSV(record){
 const d=record.data,s=budgetSummary(d),rows=[['Section','Category','Description','Monthly budget','Week','Planned set aside','Recorded set aside','Actual date','Notes']];
 for(const x of d.items)rows.push(['Budget',x.category,x.description,x.amount==null?'':x.amount/100,'','','','',x.notes]);
 for(const w of s.weeks)rows.push(['Set aside','','','',w.week,w.planned/100,w.amount==null?'':w.amount/100,w.date??'',[w.reference,w.notes].filter(Boolean).join(' · ')]);
 for(const a of d.allocations)rows.push(['Monthly account update','',a.label,a.amount==null?'':a.amount/100,'','','','',a.notes]);
 const cell=x=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
export function renderBudget(ctx){
 const {container,state,api,dialog,notify,onSaved,onSource,setDirty,setBusy,download}=ctx;
 const records=state.records.filter(r=>r.type==='budget'&&!r.data.archived).sort((a,b)=>b.data.month.localeCompare(a.data.month));
 if(!records.some(r=>r.data.month===selectedMonth))selectedMonth=records[0]?.data.month??'';
 const record=records.find(r=>r.data.month===selectedMonth),d=record?.data,s=record?budgetSummary(d):null;
 const rowHtml=x=>`<div class="budget-item"><strong>${esc(x.description)}</strong><span class="budget-amount">${money(x.amount)}</span>${x.notes?`<p>${esc(x.notes)}</p>`:''}</div>`;
 container.innerHTML=`<div class="finance-heading"><div><h1>Budget</h1><p>Put money aside over four weeks for the month's accounts.</p></div><div class="finance-actions"><button id="budget-new" class="primary">${record?'Copy to new month':'Create budget'}</button>${record?'<button id="budget-edit">Edit budget</button><button id="budget-print">Print PDF</button><button id="budget-csv">Export CSV</button>':''}</div></div>${record?`
 <div class="finance-toolbar"><label>Budget month<select id="budget-month">${records.map(r=>`<option value="${r.data.month}" ${r.data.month===selectedMonth?'selected':''}>${r.data.month}</option>`).join('')}</select></label><button id="budget-history">Change history</button>${d.source?'<button id="budget-source">Source history</button>':''}</div>
 ${s.missing?`<p class="review-banner"><b>${s.missing} expense amounts are not entered.</b> Totals and weekly targets below cover the known amounts. Blank amounts are not zero.</p>`:''}
 <div class="finance-cards budget-totals"><section class="finance-stat"><h2>${s.missing?'Known monthly budget':'Monthly budget'}</h2><strong>${money(s.total)}</strong><p>${d.items.length} expense items</p></section><section class="finance-stat"><h2>Weekly plan × 4</h2><strong>${money(s.targets[0])}</strong><p>${s.targets.every(n=>n===s.targets[0])?'Each of four weeks':'Cents are distributed across the four weeks so the total stays exact.'}</p></section><section class="finance-stat"><h2>Recorded set aside</h2><strong>${money(s.recorded)}</strong><p>${s.unentered_weeks} week(s) not entered</p></section><section class="finance-stat"><h2>${s.surplus?'Recorded surplus':'Still to set aside'}</h2><strong>${money(s.surplus||s.remaining)}</strong><p>${s.missing||s.unentered_weeks?'Based on known entries only':'Against this monthly budget'}</p></section></div>
 <h2>Four-week set-aside plan</h2><p class="finance-help">Record money reserved for the monthly accounts here. Paying a supplier is recorded separately in Monthly accounts or Weekly payments. Adding a set-aside entry does not send money or mark an invoice paid.</p>
 <div class="budget-weeks">${s.weeks.map(w=>`<section class="finance-card"><h3>Week ${w.week}</h3><p>Planned: <b>${money(w.planned)}</b></p><p>Recorded: <b>${w.amount==null?'Not entered':money(w.amount)}</b></p>${w.date?`<p>Actual date: ${esc(w.date)}</p>`:''}<p>${w.surplus?'Surplus after this week':'Still needed after this week'}: <b>${money(w.surplus||w.remaining)}</b></p>${w.next_targets.length?`<p class="meta">Known balance ÷ ${w.next_targets.length} remaining week(s): ${money(w.next_targets[0])}${w.next_targets.some(n=>n!==w.next_targets[0])?' (final cents adjusted)':''}</p>`:''}${w.unentered_to_date?'<p class="meta">Earlier blank entries remain unconfirmed.</p>':''}<button data-budget-week="${w.week}">${w.amount==null?'Record set aside':'Edit set aside'}</button></section>`).join('')}</div>
 <div class="finance-heading"><h2>Monthly expenses</h2><button id="budget-edit-bottom">Edit amounts / add expense</button></div>
 <div class="budget-categories">${s.categories.map(c=>`<section class="finance-card"><header class="budget-category"><h3>${esc(c.name)}</h3><b>${money(c.total)}</b></header>${c.missing?`<p class="review">${c.missing} amount(s) not entered</p>`:''}${c.items.map(rowHtml).join('')}</section>`).join('')||'<p>No expenses entered yet.</p>'}</div>
 <div class="finance-heading"><h2>Monthly account updates</h2><button id="budget-updates">Edit account updates</button></div><p>These reference amounts are separate from the expense budget and the weekly set-aside entries.</p><section class="finance-card">${d.allocations.map(a=>rowHtml({description:a.label,amount:a.amount,notes:a.notes})).join('')||'<p>No account updates entered.</p>'}<p><b>Known total: ${money(s.update_total)}</b>${s.missing_updates?' · '+s.missing_updates+' amount(s) not entered':''}</p></section>
 ${d.notes?`<details class="budget-notes"><summary>Budget notes</summary><p>${esc(d.notes)}</p></details>`:''}<p class="meta">Saved by ${esc(record.actor)} · ${esc(record.saved_at)} · Revision ${record.revision}</p>`:'<div class="finance-empty">No budget has been saved yet. Create a month to plan the expenses and four weekly set-aside amounts.</div>'}`;
 const $=sel=>container.querySelector(sel);
 $('#budget-new').onclick=()=>newMonth(record);
 if(!record)return;
 $('#budget-month').onchange=e=>{selectedMonth=e.target.value;renderBudget(ctx);};
 $('#budget-edit').onclick=$('#budget-edit-bottom').onclick=()=>editLines(record,'items');
 $('#budget-updates').onclick=()=>editLines(record,'allocations');
 $('#budget-print').onclick=()=>location.assign('/print-page?'+new URLSearchParams({document:'financial',type:'budget',month:d.month}));
 $('#budget-csv').onclick=()=>download('FenMeat-Budget-'+d.month+'.csv',budgetCSV(record),'text/csv;charset=utf-8');
 container.querySelectorAll('[data-budget-week]').forEach(b=>b.onclick=()=>editWeek(record,Number(b.dataset.budgetWeek)));
 if($('#budget-source'))$('#budget-source').onclick=()=>onSource(record);
 $('#budget-history').onclick=async()=>{try{const h=await api('/api/financial/audit?id='+record.id);dialog('Budget change history',h.history.map(x=>`<details><summary>Revision ${x.revision} · ${esc(x.actor)} · ${esc(x.saved_at)}</summary><p>${esc(x.reason)}</p><pre class="source-note">${esc(JSON.stringify(x.data,null,2))}</pre></details>`).join(''));}catch(e){notify(e.message);}};

 function formDialog(title,body){return dialog(title,`<form class="budget-form"><fieldset>${body}</fieldset><p class="error" role="alert"></p><div class="budget-save"><button type="submit" class="primary">Save</button><span>Changes are saved only when you press Save.</span></div></form>`);}
 function bindSave(el,r,collect,reason){
  const form=el.querySelector('form'),field=form.querySelector('fieldset'),button=form.querySelector('[type=submit]'),error=form.querySelector('.error');let pending=null,saving=false;
  form.oninput=()=>setDirty(true);
  form.onsubmit=async e=>{e.preventDefault();if(saving)return;saving=true;setBusy(true);button.disabled=true;field.disabled=true;error.textContent='';
   try{if(!pending){const data=collect();pending={record:{id:r.id,type:'budget',data},revision:r.revision,request_id:crypto.randomUUID(),reason};}await api('/api/financial/record',pending);selectedMonth=pending.record.data.month;setDirty(false);el.remove();await onSaved();notify('Budget saved.');}
   catch(err){error.textContent=err.message;setDirty(true);if(err.uncertain&&pending){button.textContent='Retry same save';}else{pending=null;field.disabled=false;button.textContent='Save';}}
   finally{saving=false;setBusy(false);button.disabled=false;}
  };
 }
 function cents(input){const raw=input.value.trim();if(!raw)return null;const n=toCents(raw);if(n===null||n<0)throw Error('Enter a valid amount of zero or more. Leave unknown amounts blank.');return n;}
 function newMonth(base){
  const next=base?new Date(Date.UTC(Number(base.data.month.slice(0,4)),Number(base.data.month.slice(5)),1)).toISOString().slice(0,7):state.today.slice(0,7);
  const el=formDialog(base?'Copy budget to a new month':'Create a monthly budget',`<label>New budget month<input name="month" type="month" required value="${next}"></label><p>${base?'Copy the expense plan from '+esc(base.data.month)+'. All recorded set-aside amounts and monthly account updates start empty. The original month stays saved.':'Start an empty expense plan, then add the amounts you need to reserve.'}</p>`);
  bindSave(el,{id:crypto.randomUUID(),revision:0},()=>{const month=el.querySelector('[name=month]').value;if(state.records.some(r=>r.type==='budget'&&!r.data.archived&&r.data.month===month))throw Error('That budget month already exists. Select it from Budget month.');return base?copyBudget(base.data,month):emptyBudget(month);},base?'Copy expense plan to a new month; do not carry forward actual set-aside funds.':'Create a monthly four-week budget.');
 }
 function editWeek(r,week){
  const w=r.data.weeks[week-1],el=formDialog('Week '+week+' — record money set aside',`<div class="finance-fields"><label>Amount actually set aside<input name="amount" inputmode="decimal" value="${value(w.amount)}" placeholder="Not entered"></label><label>Actual date (optional)<input name="date" type="date" value="${esc(w.date??'')}" max="${state.today}"></label><label class="wide">Reference<input name="reference" value="${esc(w.reference)}"></label><label class="wide">Notes<textarea name="notes">${esc(w.notes)}</textarea></label></div><p>Enter the total for this week. To correct an entry, replace its amount. Leave blank only when it is unknown.</p>`);
  bindSave(el,r,()=>{const data=structuredClone(r.data),get=n=>el.querySelector('[name='+n+']');data.weeks[week-1]={week,amount:cents(get('amount')),date:get('date').value||null,reference:get('reference').value.trim(),notes:get('notes').value.trim()};return data;},'Record / correct money set aside for budget '+r.data.month+', Week '+week+'.');
 }
 function editLines(r,key){
  const expenses=key==='items',el=formDialog(expenses?'Edit monthly budget':'Edit monthly account updates',`<p>Leave unknown amounts blank. Enter 0 when the amount is confirmed as zero.</p><div data-budget-lines></div><button type="button" data-add-line>Add ${expenses?'expense':'account update'}</button>${expenses?`<label class="budget-notes">Budget notes<textarea name="budget_notes">${esc(r.data.notes)}</textarea></label>`:''}`),list=el.querySelector('[data-budget-lines]');
  const append=x=>{const row=document.createElement('div');row.className='budget-edit-row';row.dataset.id=x.id??crypto.randomUUID();row.innerHTML=`${expenses?`<label>Category<input data-category list="budget-category-options" value="${esc(x.category??BUDGET_CATEGORIES[0])}"></label>`:''}<label>${expenses?'Expense':'Account'}<input data-label value="${esc(expenses?x.description:x.label)}" required></label><label>Amount<input data-amount inputmode="decimal" value="${value(x.amount)}" placeholder="Unknown"></label><label class="budget-line-note">Notes<input data-notes value="${esc(x.notes)}"></label><button type="button" data-remove>Remove</button>`;row.querySelector('[data-remove]').onclick=()=>{row.remove();setDirty(true);};list.append(row);};
  r.data[key].forEach(append);if(expenses){const options=document.createElement('datalist');options.id='budget-category-options';options.innerHTML=[...new Set([...BUDGET_CATEGORIES,...r.data.items.map(x=>x.category)])].map(c=>`<option value="${esc(c)}">`).join('');list.append(options);}
  el.querySelector('[data-add-line]').onclick=()=>{append(expenses?{id:crypto.randomUUID(),category:BUDGET_CATEGORIES[0],description:'',amount:null,notes:''}:{label:'',amount:null,notes:''});setDirty(true);};
  bindSave(el,r,()=>{const data=structuredClone(r.data);data[key]=[...list.querySelectorAll('.budget-edit-row')].map(row=>{const label=row.querySelector('[data-label]').value.trim(),amount=cents(row.querySelector('[data-amount]')),notes=row.querySelector('[data-notes]').value.trim();return expenses?{id:row.dataset.id,category:row.querySelector('[data-category]').value.trim(),description:label,amount,notes}:{label,amount,notes};});if(expenses)data.notes=el.querySelector('[name=budget_notes]').value;return data;},expenses?'Update monthly budget expense plan; preserve recorded set-aside amounts.':'Update the separate monthly account reference figures.');
 }
}
