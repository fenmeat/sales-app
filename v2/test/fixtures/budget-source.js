const cell=v=>v==null?{}:{formattedValue:String(v),userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:v},effectiveValue:typeof v==='number'?{numberValue:v}:{stringValue:v}};
export function budgetSource(){
 const rows=Array.from({length:50},()=>({values:[]}));
 const put=(row,values)=>rows[row-1]={values:values.map(cell)};
 put(4,['Beskrywing','Bedrag','OKTOBER']);put(6,['ALGEMENE UITGAWES',null,10.01]);put(7,['Synthetic expense',10.01]);
 put(22,['FENMEAT DEBIETORDERS',null,0]);put(23,['Synthetic debit',0]);
 put(27,['SAVINGS DEBIETORDERS',null,0]);put(28,['Synthetic savings',0,'25th']);
 put(32,['VERSEKERING DEBIETORDERS',null,0]);put(33,['Synthetic insurance',null]);
 put(40,[null,null,'Betaling 1','Betaling 2','Betaling 3','Betaling 4']);put(41,[null,'Betaling gemaak:',3.33,null,0,0]);
 put(42,['Totaal',10.01]);put(43,['Weeklikse betaling',2.5025]);
 put(46,['MAANDELIKSE OPDATERINGS']);put(47,['Savings',null]);put(48,['Maintenance',0]);put(49,['Synthetic call account',2]);put(50,['TOTAAL',2]);
 return {spreadsheetId:'synthetic-budget-only',sheets:[{properties:{sheetId:9876543,title:'OKTOBER Bestuurstelsel'},data:[{rowData:rows}]}]};
}
