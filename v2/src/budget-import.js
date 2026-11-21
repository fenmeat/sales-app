import {toCents,validateFinancialRecord} from './finance-domain.js';
import {sourceValue,sourceText} from './finance-import.js';
import {emptyBudget,budgetSummary} from './budget-domain.js';

export function deriveBudgetImport(source,month){
 const sheet=source?.sheets?.find(s=>s.properties.title.toUpperCase()==='OKTOBER BESTUURSTELSEL');
 if(!source.spreadsheetId||!sheet||!/^\d{4}-10$/.test(month??''))throw Error('Use the October Bestuurstelsel source and its October budget month.');
 const rows=sheet.data[0].rowData,cell=(r,c)=>rows[r-1]?.values?.[c]??{},str=(r,c)=>sourceText(cell(r,c)).trim(),num=(r,c)=>toCents(sourceValue(cell(r,c)));
 const names={'ALGEMENE UITGAWES':'General expenses','FENMEAT DEBIETORDERS':'FenMeat debit orders','SAVINGS DEBIETORDERS':'Savings debit orders','VERSEKERING DEBIETORDERS':'Insurance debit orders'};
 const data=emptyBudget(month),categoryRows=[];let category='',totalRow=0,actualRow=0,updatesRow=0;
 for(let r=1;r<=rows.length;r++){
  const label=str(r,0),upper=label.toUpperCase();
  if(names[upper]){category=names[upper];categoryRows.push({name:category,row:r,expected:num(r,2)});continue;}
  if(/^Betaling gemaak:/i.test(str(r,1)))actualRow=r;
  if(upper==='MAANDELIKSE OPDATERINGS')updatesRow=r;
  if(category&&upper==='TOTAAL'){category='';totalRow=r;}
  if(category&&label)data.items.push({id:'budget-row-'+r,category,description:label,amount:num(r,1),notes:[str(r,2),...(rows[r-1].values??[]).map(c=>c.note)].filter(Boolean).join('\n')});
 }
 if(categoryRows.length!==4||!actualRow||!totalRow||!updatesRow)throw Error('Budget source layout is incomplete.');
 data.weeks=data.weeks.map((w,i)=>({...w,amount:num(actualRow,i+2),notes:num(actualRow,i+2)==null?'Not entered in the source sheet.':'Imported set-aside entry; actual date and bank evidence were not supplied.'}));
 let updatesTotal=null;
 for(let r=updatesRow+1;r<=rows.length;r++){const label=str(r,0);if(label.toUpperCase()==='TOTAAL'){updatesTotal=num(r,1);break;}if(label)data.allocations.push({label,amount:num(r,1),notes:''});}
 data.notes='October budget from the authorised Bestuurstelsel sheet. Recorded set-aside amounts and monthly account updates are separate from supplier payments. Blank source amounts remain unknown.';
 data.links=[{label:'Original October budget',url:'https://docs.google.com/spreadsheets/d/'+source.spreadsheetId+'/edit#gid='+sheet.properties.sheetId}];
 data.source=[{sheet:sheet.properties.title,sheet_id:sheet.properties.sheetId,row:4,spreadsheet_id:source.spreadsheetId}];
 const record={id:'fin-budget-'+month,type:'budget',data},summary=budgetSummary(data);
 if(summary.total!==num(totalRow,1)||summary.update_total!==updatesTotal||categoryRows.some(c=>summary.categories.find(s=>s.name===c.name)?.total!==c.expected))throw Error('Budget line totals do not match the source control totals.');
 validateFinancialRecord(record,{importing:true});
 return {records:[record],report:{kind:'budget',month,record_id:record.id,records:1,counts:{budget:1},items:data.items.length,known_budget:summary.total,recorded_set_aside:summary.recorded,missing_amounts:summary.missing,source_rows:rows.length,source_sheets:[{id:sheet.properties.sheetId,name:sheet.properties.title,rows:rows.length}],note:'Budget planning and recorded set-aside funds only. Existing Financial records and supplier payments are unchanged.'}};
}
