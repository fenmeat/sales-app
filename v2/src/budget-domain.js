// Money is stored in cents. Blank entries remain unknown, including weekly actuals.
export const BUDGET_CATEGORIES=['General expenses','FenMeat debit orders','Savings debit orders','Insurance debit orders'];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const text=(s,max=200,required=false)=>typeof s==='string'&&s.length<=max&&(!required||s.trim().length>0);
const amount=n=>n===null||Number.isSafeInteger(n)&&n>=0&&n<=100000000000;
export function validateBudget(d){
 check(/^\d{4}-(0[1-9]|1[012])$/.test(d.month??''),'Choose the budget month.');
 check(Array.isArray(d.items)&&d.items.length<=250,'Use up to 250 budget items.');
 const ids=new Set();
 for(const x of d.items){check(x&&Object.keys(x).every(k=>['id','category','description','amount','notes'].includes(k)),'Invalid budget item.');check(/^[a-zA-Z0-9-]{4,100}$/.test(x.id??'')&&!ids.has(x.id),'Budget item identities must be unique.');ids.add(x.id);check(text(x.category,150,true)&&text(x.description,200,true)&&amount(x.amount)&&text(x.notes??'',2000),'Check the category, description and non-negative budget amount.');}
 check(Array.isArray(d.weeks)&&d.weeks.length===4,'The budget must have four weeks.');
 for(const [i,w]of d.weeks.entries()){
  check(w&&Object.keys(w).every(k=>['week','amount','date','reference','notes'].includes(k))&&w.week===i+1&&amount(w.amount),'Check all four set-aside amounts.');
  if(w.date)check(/^\d{4}-\d\d-\d\d$/.test(w.date)&&Number.isFinite(Date.parse(w.date+'T12:00Z'))&&new Date(w.date+'T12:00Z').toISOString().slice(0,10)===w.date,'Enter a valid actual set-aside date.');
  check(text(w.reference??'',300)&&text(w.notes??'',2000),'Set-aside reference or notes are too long.');
 }
 check(Array.isArray(d.allocations)&&d.allocations.length<=50,'Use up to 50 monthly account updates.');
 for(const a of d.allocations)check(a&&Object.keys(a).every(k=>['label','amount','notes'].includes(k))&&text(a.label,200,true)&&amount(a.amount)&&text(a.notes??'',2000),'Check the monthly account update.');
 check(d.copied_from==null||text(d.copied_from,100),'Invalid source budget.');
 return d;
}
export function splitBudget(total,weeks=4){const n=Math.max(0,total);if(!weeks)return [];const base=Math.floor(n/weeks),extra=n%weeks;return Array.from({length:weeks},(_,i)=>base+(i<extra?1:0));}
export function emptyBudget(month){return {month,items:[],weeks:Array.from({length:4},(_,i)=>({week:i+1,amount:null,date:null,reference:'',notes:''})),allocations:[],notes:'',links:[]};}
export function copyBudget(data,month){return {...emptyBudget(month),items:structuredClone(data.items),allocations:data.allocations.map(a=>({label:a.label,amount:null,notes:''})),copied_from:data.month,notes:'Plan copied from '+data.month+'. Set-aside amounts and monthly account updates start empty.'};}
export function budgetSummary(d){
 const total=d.items.reduce((n,x)=>n+(x.amount??0),0),missing=d.items.filter(x=>x.amount==null).length,targets=splitBudget(total),categories=[];
 for(const item of d.items){let c=categories.find(c=>c.name===item.category);if(!c){c={name:item.category,total:0,missing:0,items:[]};categories.push(c);}c.total+=item.amount??0;c.missing+=item.amount==null?1:0;c.items.push(item);}
 let cumulative=0,unentered=0;
 const weeks=d.weeks.map((w,i)=>{cumulative+=w.amount??0;unentered+=w.amount==null?1:0;const balance=total-cumulative;return {...w,planned:targets[i],cumulative_recorded:cumulative,unentered_to_date:unentered,remaining:Math.max(0,balance),surplus:Math.max(0,-balance),next_targets:splitBudget(balance,3-i)};});
 return {total,missing,targets,categories,weeks,recorded:cumulative,unentered_weeks:unentered,remaining:Math.max(0,total-cumulative),surplus:Math.max(0,cumulative-total),update_total:d.allocations.reduce((n,a)=>n+(a.amount??0),0),missing_updates:d.allocations.filter(a=>a.amount==null).length};
}
