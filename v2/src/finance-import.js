import {toCents,decimal,norm,recordKey,validateFinancialRecord} from './finance-domain.js';

export const sourceValue=c=>c?.effectiveValue?.numberValue??c?.effectiveValue?.stringValue??c?.effectiveValue?.boolValue??c?.formattedValue??'';
export const sourceText=c=>String(c?.formattedValue??sourceValue(c));
export function sourceDate(c){const v=sourceValue(c),s=sourceText(c);let d;
 if(typeof v==='number'&&v>20000&&v<100000)d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000).toISOString().slice(0,10);
 else if(/^\d{4}-\d\d-\d\d$/.test(s))d=s;
 else{const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);if(m)d=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
 return d&&Number.isFinite(Date.parse(d+'T12:00Z'))?d:null;
}
const months={SEPTEMBER:'09',OKTOBER:'10',NOVEMBER:'11',DESEMBER:'12',JANUARIE:'01',FEBRUARIE:'02',MAART:'03',APRIL:'04',MEI:'05',JUNIE:'06',JULIE:'07',AUGUSTUS:'08'};
const status=s=>/^Paid\b|^Betaal\b/i.test(s)?'Paid':/^To Pay|^Still to pay|^Beplan/i.test(s)?'To Pay':/Navraag/i.test(s)?'Query':'Unknown';
function evidence(cells){const text=cells.map(c=>sourceText(c)+' '+(c?.note??'')).join(' ');return /Bankgegenereerde.*nog nie|gemerkte staat|EFT bevestig — staat/i.test(text)?'Marked statement':cells.some(c=>c?.hyperlink&&/bewys|EFT|deposito|proof/i.test(sourceText(c)))?'Bank proof':/Paid|Betaal/i.test(text)?'Owner confirmation':'Unknown';}
function links(cells){const found=new Map();for(const c of cells){const urls=[c?.hyperlink,...(c?.userEnteredValue?.formulaValue?.match(/https:\/\/[^"\s)]+/g)??[]),...(sourceText(c).match(/https:\/\/[^\s"<>]+/g)??[]),...(c?.textFormatRuns??[]).map(r=>r.format?.link?.uri)];for(const url of urls.filter(Boolean)){if(!found.has(url))found.set(url,{url,label:(sourceText(c).startsWith('https:')?'Source document':sourceText(c)).slice(0,160)||'Source document'});}}return [...found.values()];}

// The original workbook remains a complete, immutable source archive. Only
// reviewed table rows become operational records; headings and historical
// control totals are never counted as transactions.
export function deriveFinanceImport(source){
 if(!source?.spreadsheetId||!Array.isArray(source.sheets))throw Error('Choose the captured Google workbook.');
 const required=['Opsomming','Crown','Deli','Margot Swiss','Weeklikse Betalings','Skuldinvordering','Kredietwaarskuwings','Garden Route Deli'];
 if(!required.every(n=>source.sheets.some(s=>s.properties.title===n)))throw Error('The workbook is missing a required section.');
 const records=[],duplicates=[],warnings=[],keys=new Map();
 const add=(sheet,row,type,data,extraCells=[])=>{
  const cells=sheet.data[0].rowData[row-1]?.values??[],all=[...cells,...extraCells],notes=[data.notes,...all.map(c=>c?.note)].filter(Boolean);
  const item={id:`fin-${sheet.properties.sheetId}-${row}-${type}`,type,data:{...data,links:links(all),source:[{sheet:sheet.properties.title,sheet_id:sheet.properties.sheetId,row}],...(notes.length?{notes:[...new Set(notes)].join('\n')}:{})}};
  const key=recordKey(item),old=key&&keys.get(key);
  if(old){
   old.data.source.push(...item.data.source);old.data.links=[...new Map([...old.data.links,...item.data.links].map(l=>[l.url,l])).values()];
   if(item.data.notes&&!old.data.notes?.includes(item.data.notes))old.data.notes=[old.data.notes,item.data.notes].filter(Boolean).join('\n');
   if(item.data.amount!==old.data.amount){old.data.review=[old.data.review,'Conflicting amounts on duplicate source rows; inspect source history before payment.'].filter(Boolean).join('\n');warnings.push(key+': conflicting source amounts');}
   duplicates.push({type,sources:item.data.source,kept_id:old.id});return old;
  }
  records.push(item);if(key)keys.set(key,item);return item;
 };
 for(const s of source.sheets){const title=s.properties.title,rows=s.data[0].rowData;const c=(r,n)=>rows[r-1]?.values?.[n]??{},v=(r,n)=>sourceValue(c(r,n)),t=(r,n)=>sourceText(c(r,n));
  if(['Crown','Deli','Margot Swiss'].includes(title)){
   const supplier=title==='Crown'?'Crown National':title==='Deli'?'Deli Spices':title;let month='2026-09';
   for(let r=1;r<=rows.length;r++){
    const heading=t(r,0).match(/^(SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER|JANUARIE|FEBRUARIE|MAART|APRIL|MEI|JUNIE|JULIE|AUGUSTUS)\s+(\d{4})/);if(heading)month=heading[2]+'-'+months[heading[1]];
    if(/^Maandtotaal/.test(t(r,0))){
     const paid=status(t(r+1,4)),amount=toCents(v(r,1)),rate=title==='Crown'?250:title==='Margot Swiss'?500:0;
     const discount=rate?toCents(v(r,3)):0,net=amount===null?null:amount-(discount??Math.round(amount*rate/10000));
     const paidMatch=t(r+1,4).match(/(\d\d)\/(\d\d)\/(\d{4})/);
     const [year,mo]=month.split('-').map(Number);const due=new Date(Date.UTC(year,mo+1,0)).toISOString().slice(0,10);
     add(s,r,'account',{supplier,month,due_date:due,discount_bps:rate,discount_state:rate?(paid==='Paid'?'Confirmed':'Conditional'):'None',statement_total:null,opening_paid:paid==='Paid'?net:null,paid_date:paidMatch?`${paidMatch[3]}-${paidMatch[2]}-${paidMatch[1]}`:null,evidence:paid==='Paid'?'Marked statement':'Unknown',status:paid,notes:`Imported source month total: ${t(r,1)}. ${t(r+1,0)}. ${t(r+1,4)}`},rows[r]?.values??[]);
    }
    const ref=t(r,1),docdate=sourceDate(c(r,0));
    if((docdate&&ref&&!/^Faktuur/.test(ref))||(!t(r,0).trim()&&ref&&(toCents(v(r,3))!==null||/^\d{8,}$/.test(ref)))){
     const amt=toCents(v(r,3));const review=[amt===null?'Document amount is unknown; excluded from known totals.':'',!docdate?'Document date is unverified.':'',/^[R\s]*\d+[,.]/.test(ref)?'Source invoice-reference cell contains a money value; invoice identity needs review.':''].filter(Boolean).join(' ');
     add(s,r,'invoice',{supplier,month,date:docdate,reference:ref,order:t(r,2),amount:amt,notes:t(r,4),review});
    }
   }
  }else if(title==='Weeklikse Betalings'){
   let period='';for(let r=1;r<=rows.length;r++){
    if(/^(Week van|Bykomende fakture)/.test(t(r,0)))period=t(r,0);
    if(!t(r,2)||t(r,2)==='Faktuur nr.'||toCents(v(r,3))===null)continue;
    const paid=status(t(r,4)),amt=toCents(v(r,3));
    add(s,r,'weekly',{supplier:t(r,1)||'Supplier to confirm',reference:t(r,2),date:sourceDate(c(r,0)),period,amount:amt,status:paid,opening_paid:paid==='Paid'?amt:paid==='To Pay'?0:null,paid_date:sourceDate(c(r,5)),evidence:evidence(rows[r-1]?.values??[]),order:t(r,9),notes:[t(r,6),!sourceDate(c(r,0))?'Planned date source: '+t(r,0):''].filter(Boolean).join('\n'),review:c(r,1).userEnteredValue?.formulaValue?'Supplier name is copied by a source formula; verify supplier identity before further payment.':''});
   }
  }else if(title==='Skuldinvordering'){
   for(let r=6;r<=rows.length;r++)if(sourceDate(c(r,0))&&t(r,1)&&toCents(v(r,3))!==null)add(s,r,'debt',{date:sourceDate(c(r,0)),route:t(r,1),accounts:decimal(v(r,2)),amount:toCents(v(r,3)),driver:t(r,4),status:'Historical',notes:t(r,7)});
  }else if(title==='Kredietwaarskuwings'){
   for(let r=7;r<=rows.length;r++)if(t(r,3)&&sourceDate(c(r,0))){const verify=t(r,6);add(s,r,'credit',{date:sourceDate(c(r,0)),route:t(r,1),customer:t(r,2),reference:t(r,3),amount:toCents(v(r,4)),feedback:t(r,5),verification:'Not verified',verification_note:verify,decision:({'Behou 7 dae':'Keep 7 days','Waarsku kliënt':'Warn customer','Slegs kontant':'Cash only','Onder bespreking':'Under review'})[t(r,9)]||'Under review',checked_date:null,notes:`Source warning: ${t(r,8)}; source 60-day cases: ${t(r,7)}. Imported historical balance, not a fresh collection instruction.`});}
  }else if(title==='Garden Route Deli'){
   let purchase='',section='';
   for(let r=1;r<=rows.length;r++){
    if(r<29&&sourceDate(c(r,0))&&/^INV\d/.test(t(r,1))){purchase=t(r,1);add(s,r,'purchase',{date:sourceDate(c(r,0)),reference:purchase,amount:toCents(v(r,3)),recovered_date:/beplan/i.test(t(r,4))?null:sourceDate(c(r,4)),recovered:toCents(v(r,5)),complete:false,notes:/beplan/i.test(t(r,4))?'Planned recovery: '+t(r,4):''});}
    if((r<29||r>=38&&r<=40)&&/^(Superbraai|Nyama Choma|Pork Stew)/.test(t(r,0))&&decimal(v(r,1))!==null)add(s,r,'stock',{reference:r>=38?'Historical overall count':purchase,product:t(r,0),bought:decimal(v(r,1)),opening:null,received:null,sold:null,other_out:null,closing:decimal(v(r,2)),date:sourceDate(c(r,3)),review:decimal(v(r,2))===null?t(r,2):'',notes:r>=38?'Historical overall count retained separately; do not add this to the individual purchase counts.':''});
    if(r>=31&&r<=35&&sourceDate(c(r,1))&&toCents(v(r,2))!==null)add(s,r,'settlement',{period:t(r,0),date:sourceDate(c(r,1)),amount:toCents(v(r,2)),status:toCents(v(r,5))!==null?'Paid':'To Pay',received_date:sourceDate(c(r,4)),received:toCents(v(r,5)),reference:'',notes:[t(r,3),t(r,8)].filter(Boolean).join('\n')});
    if(r>=145&&sourceDate(c(r,0))&&/^INV-/.test(t(r,1))){const st=t(r,5);add(s,r,'sale',{date:sourceDate(c(r,0)),period:r>=391?'Older sales collected in later week':'19–25 October 2026',reference:t(r,1),customer:'',product:t(r,2),quantity:decimal(v(r,3)),unit_price:null,amount:toCents(v(r,4)),status:/gedeelt|partial/i.test(st)?'Part paid - allocation pending':/Ontvang|volledig betaal/i.test(st)?'Paid':/draft|konsep/i.test(st)?'Draft':/sent|overdue/i.test(st)?'Unpaid':'Unverified',line_id:/^\d{10,}$/.test(t(r,8))?t(r,8):'',payment_reference:t(r,6),settlement_id:'',notes:[st,t(r,8)].filter(Boolean).join('\n')});}
   }
   add(s,115,'profit',{period:t(115,0),sales:toCents(v(115,1)),cost:toCents(v(115,2)),expenses:toCents(v(115,3)),notes:'Source profit remains incomplete until sales, cost of sold stock and expenses are verified.'});
  }
 }
 for(const r of records)validateFinancialRecord(r,{importing:true});
 const counts=Object.fromEntries([...new Set(records.map(r=>r.type))].map(t=>[t,records.filter(r=>r.type===t).length]));
 return {records,report:{counts,records:records.length,duplicates,warnings,source_rows:source.sheets.reduce((n,s)=>n+s.data[0].rowData.length,0),source_sheets:source.sheets.map(s=>({id:s.properties.sheetId,name:s.properties.title,rows:s.data[0].rowData.length})),note:'Original cells, formulas, hyperlinks and notes remain in Source history. Imported balances retain their source dates. Known duplicate document rows are consolidated; original rows are preserved. No bank transaction, customer credit change or stock movement is performed.'}};
}
