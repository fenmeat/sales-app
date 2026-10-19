const cell=v=>({userEnteredValue:{[typeof v==='number'?'numberValue':typeof v==='boolean'?'boolValue':'stringValue']:v},effectiveValue:{[typeof v==='number'?'numberValue':typeof v==='boolean'?'boolValue':'stringValue']:v},formattedValue:String(v)});
const sheet=(id,name,values)=>({id,name,rows:values.map((v,i)=>({number:i+1,cells:v.map(cell)}))});
export function sourceFixture(){return {format:'fen-staff-transfer-v1',source:{spreadsheet_id:'synthetic-sheet-identity-001',title:'Synthetic payroll',timezone:'Africa/Johannesburg',captured_at:'2026-10-19T12:00:00.000Z'},sheets:[
 sheet(1,'Employees',[['Employee setup'],[],['Name','Hourly Rate (R)'],['Synthetic worker',40,'00001234','Test Bank','000001'],['Second worker',35,'00100','Test Bank','000001']]),
 sheet(2,'UIF Werknemers',[['App Naam','Van','Voorletters','ID Nommer','Indiensdatum','Betaal UIF'],['Synthetic worker','Example','SE','synthetic-only',45000,true],['Second worker','Example','TE','','',false]]),
 sheet(3,'Casuals',[['Name','Tipe (Pad/Winkel)','Normal Hours','Overtime Hours','Rate (R/hr)'],['Named casual','Winkel',0,0,30],['Casual (Pad)','Pad',0,0,32]]),
 sheet(4,'Clock Log',[['Timestamp','Name','Type'],[46200.3,'Synthetic worker','in'],[46200.6,'Synthetic worker','out'],[46201.2,'Earlier name','in'],[46201.3,'Synthetic worker ','in']]),
 sheet(5,'Leave Log',[['Leave'],['Historical aggregates'],['Date','Name','Leave Type','Days'],[46199,'Synthetic worker','Annual',7],[46201,'Synthetic worker','Annual',-1]]),
 sheet(6,'Leave',[['Balances'],['Annual entitlement per year:','', 'NL',15],[],['Name','Annual','Family','Sick','Annual balance','Family balance','Sick balance'],['Synthetic worker',6,0,13,9,3,-3]]),
 sheet(7,'Week',[['Pay'],['Pay Date (Friday):',46318],[],['Name','Normal','Overtime','Rate','Commission','Gross','UIF','Meat','Net','Status'],['Synthetic worker',40,0,40,0,1600,16,0,1584,'Paid']]),
 sheet(8,'UIF Log',[['Pay date','Employee','Gross','Employee UIF','Employer UIF','Total'],[46297,'Synthetic worker',1600,16,16,32]]),
 sheet(9,'Notes',[['A <script>literal</script> & non-ASCII value 😀'],['Formula source']])
]};}
