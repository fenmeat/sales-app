// Read-only interpretations of archived source rows. These never become native
// punches, approved leave, payroll inputs or payments. Every value keeps its row.
const norm=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const value=c=>c?.effectiveValue?.numberValue??c?.effectiveValue?.stringValue??c?.effectiveValue?.boolValue??c?.formattedValue??'';
const v=(r,i)=>value(r?.cells[i]);
const number=(r,i)=>typeof v(r,i)==='number'&&Number.isFinite(v(r,i))?v(r,i):null;
const rows=(b,n)=>b.sheets.find(s=>s.name===n)?.rows??[];
const epoch=Date.UTC(1899,11,30),dayMs=86400000;
export function sourceTimestamp(input){
 if(typeof input==='number'&&input>1&&input<100000)return new Date(epoch+Math.round(input*dayMs/1000)*1000).toISOString().slice(0,19);
 // Do not guess day/month order from display strings or the browser timezone.
 if(typeof input==='string'&&/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d)?)?$/.test(input)&&Number.isFinite(Date.parse(input)))return input.length===10?input+'T00:00:00':input;
 return null;
}
const date=input=>sourceTimestamp(input)?.slice(0,10)??null;
const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*dayMs).toISOString().slice(0,10);
const monday=d=>shiftDay(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));
const sum=(items,key)=>items.reduce((n,x)=>n+(x[key]??0),0);
const cents=n=>n===null?null:Math.round((n+Number.EPSILON)*100);
const match=(b,s,name,col=0,min=1)=>rows(b,s).filter(r=>r.number>=min&&norm(v(r,col))===norm(name));

export function historyCoverage(bundle){
 const result={};
 for(const [key,sheet,start] of [['clock','Clock Log',2],['leave','Leave Log',4],['uif','UIF Log',2]]){
  const records=rows(bundle,sheet).filter(r=>r.number>=start),dates=records.map(r=>date(v(r,0))).filter(Boolean).sort();
  result[key]={rows:records.length,from:dates[0]??null,to:dates.at(-1)??null,unassigned_rows:records.filter(r=>!norm(v(r,1))).map(r=>r.number),unknown_date_rows:records.filter(r=>!date(v(r,0))).map(r=>r.number)};
 }
 return result;
}

export function clockDays(sourceRows){
 const groups=new Map();
 for(const r of sourceRows){const stamp=sourceTimestamp(v(r,0)),key=stamp?.slice(0,10)??'Unknown date';if(!groups.has(key))groups.set(key,[]);groups.get(key).push({row:r.number,at:stamp,display:r.cells[0]?.formattedValue??String(v(r,0)),kind:String(v(r,2))});}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([day,events])=>{
  events.sort((a,b)=>(a.at??'').localeCompare(b.at??'')||a.row-b.row);
  const issues=new Set(),seen=new Set();let state='out',start=null,breakKind=null,seconds=0;
  for(const e of events){
   if(!e.at){issues.add('Unrecognised date');continue;}
   const key=e.at+'|'+e.kind;if(seen.has(key))issues.add('Duplicate clock entry');seen.add(key);
   const at=Date.parse(e.at+'+02:00');
   if(e.kind==='in'){
    if(state!=='out')issues.add('Clock-in before previous shift ended');
    else {state='in';start=at;}
   }else if(e.kind==='tea_start'||e.kind==='lunch_start'){
    if(state!=='in')issues.add('Break start without working time');
    else {seconds+=(at-start)/1000;state='break';breakKind=e.kind.split('_')[0];start=null;}
   }else if(e.kind==='tea_end'||e.kind==='lunch_end'){
    if(state!=='break'||breakKind!==e.kind.split('_')[0])issues.add('Break end without matching start');
    else {state='in';start=at;breakKind=null;}
   }else if(e.kind==='out'){
    if(state!=='in')issues.add('Clock-out without working time');
    else {seconds+=(at-start)/1000;state='out';start=null;}
   }else issues.add('Unknown clock action');
  }
  if(state!=='out')issues.add('Missing clock-out or overnight shift');
  if(seconds>16*3600)issues.add('More than 16 recorded work hours');
  return {date:day,events,issues:[...issues],recorded_seconds:issues.size?null:seconds};
 });
}

export function payHistory(sourceRows){
 const groups=new Map();
 for(const r of sourceRows){const day=date(v(r,0)),key=day??'Unknown date';if(!groups.has(key))groups.set(key,[]);groups.get(key).push({row:r.number,date:day,gross_cents:cents(number(r,2)),employee_uif_cents:cents(number(r,3)),employer_uif_cents:cents(number(r,4)),total_uif_cents:cents(number(r,5))});}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([day,entries])=>{
  const variants=new Map();for(const e of entries){const key=JSON.stringify([e.gross_cents,e.employee_uif_cents,e.employer_uif_cents,e.total_uif_cents]);if(!variants.has(key))variants.set(key,{...e,rows:[]});variants.get(key).rows.push(e.row);}
  const unique=[...variants.values()],invalid=day==='Unknown date'||unique.some(e=>Object.entries(e).some(([k,n])=>k.endsWith('_cents')&&n===null));
  return {date:day,rows:entries.map(e=>e.row),variants:unique,duplicates:entries.length-unique.length,status:invalid?'Incomplete':unique.length>1?'Conflict':'Recorded',amount:!invalid&&unique.length===1?unique[0]:null};
 });
}

export function employeeHistory(bundle,person,importId){
 const name=person.source_profile?.source_name;
 const selected=(sheet,col=0,min=1)=>name?match(bundle,sheet,name,col,min):[];
 const clocks=selected('Clock Log',1,2),days=clockDays(clocks),pay=payHistory(selected('UIF Log',1,2));
 const leave=selected('Leave Log',1,4).map(r=>({row:r.number,date:date(v(r,0)),source_date:r.cells[0]?.formattedValue??v(r,0),type:String(v(r,2)),days:number(r,3)}));
 const balances=selected('Leave',0,5)[0],lastLeaveRow=rows(bundle,'Leave Log').at(-1)?.number??0;
 const leaveBalances=['Annual','Family Responsibility','Sick'].map((type,i)=>{
  const matching=leave.filter(r=>norm(r.type)===norm(type)),valid=matching.every(r=>r.days!==null),total=valid?Math.round(sum(matching,'days')*10000)/10000:null;
  const taken=number(balances,i+1),remaining=number(balances,i+4),formula=balances?.cells[i+1]?.userEnteredValue?.formulaValue??'';
  const ends=[...formula.matchAll(/\$?D\$?\d+:\$?D\$?(\d+)/gi)].map(m=>Number(m[1]));
  return {type,source_taken:taken,source_balance:remaining,log_days:total,row:balances?.number??null,range_ends_before_log:ends.some(n=>n<lastLeaveRow),difference:total!==null&&taken!==null?Math.round((total-taken)*10000)/10000:null};
 });
 const weekDate=date(v(rows(bundle,'Week').find(r=>r.number===2),1)),week=selected('Week',0,5)[0],casual=selected('Casuals',0,2)[0],employee=selected('Employees',0,4)[0];
 const paySnapshot=week?{kind:'Week',row:week.number,date:weekDate,normal_hours:number(week,1),overtime_hours:number(week,2),hourly_rate:number(week,3),bonus:number(week,4),gross:number(week,5),employee_uif:number(week,6),meat_deduction:number(week,7),net:number(week,8),source_status:String(v(week,9)),holiday_extra:number(week,12)}:casual?{kind:'Casuals',row:casual.number,date:weekDate,normal_hours:number(casual,2),overtime_hours:number(casual,3),hourly_rate:number(casual,4),bonus:null,gross:number(casual,5),employee_uif:number(casual,6),meat_deduction:null,net:number(casual,7),source_status:String(v(casual,8)),holiday_extra:null}:null;
 const weeks=new Map();
 const getWeek=d=>{const from=monday(d);if(!weeks.has(from))weeks.set(from,{from,to:shiftDay(from,6),pay_date:shiftDay(from,4),recorded_seconds:0,clock_days:0,review_days:0,pay:null});return weeks.get(from);};
 for(const d of days)if(d.date!=='Unknown date'){const w=getWeek(d.date);w.clock_days++;if(d.recorded_seconds===null)w.review_days++;else w.recorded_seconds+=d.recorded_seconds;}
 for(const p of pay)if(p.date!=='Unknown date')getWeek(p.date).pay=p;
 const months=new Map();for(const p of pay)if(p.date!=='Unknown date'){
  const month=p.date.slice(0,7);if(!months.has(month))months.set(month,{month,recorded_periods:0,unresolved_periods:0,gross_cents:0,employee_uif_cents:0,employer_uif_cents:0,total_uif_cents:0});const m=months.get(month);
  if(!p.amount)m.unresolved_periods++;else {m.recorded_periods++;for(const k of ['gross_cents','employee_uif_cents','employer_uif_cents','total_uif_cents'])m[k]+=p.amount[k];}
 }
 const recordSpecs=[['Employees',0,4],['UIF Werknemers',0,2],['Casuals',0,2],['Week',0,5],['Payments',0,5],['Payment batch',0,2],['Clock Log',1,2],['Clock Warnings',1,2],['Hours Warnings',1,2],['Leave Log',1,4],['Leave',0,5],['UIF Log',1,2],['Warnings Log',1,2]];
 const sourceRecords=recordSpecs.map(([sheet,col,min])=>({sheet,rows:selected(sheet,col,min)})).filter(s=>s.rows.length);
 const slips=rows(bundle,'Payslips'),names=slips.filter(r=>v(r,0)==='Employee Name:');
 for(let i=0;i<names.length;i++)if(name&&norm(v(names[i],1))===norm(name))sourceRecords.push({sheet:'Payslips',rows:slips.filter(r=>r.number>=names[i].number-12&&r.number<(names[i+1]?.number-12||Infinity))});
 const dated=[...days.map(d=>d.date),...leave.map(d=>d.date),...pay.map(d=>d.date)].filter(d=>d&&d!=='Unknown date').sort();
 return {import_id:importId,source:bundle.source,employee:{id:person.id,name:person.name,source_name:name??null,active:person.active},read_only:true,
  coverage:{from:dated[0]??null,to:dated.at(-1)??null,clock_rows:clocks.length,leave_rows:leave.length,uif_rows:sum(pay.map(p=>({n:p.rows.length})),'n'),pay_periods:pay.length,conflicting_pay_periods:pay.filter(p=>p.status==='Conflict').length,duplicate_pay_rows:sum(pay,'duplicates')},source_coverage:historyCoverage(bundle),
  rate:{value:employee?number(employee,1):casual?number(casual,4):null,captured_at:bundle.source.captured_at,effective_from:null},
  days,weeks:[...weeks.values()].sort((a,b)=>a.from.localeCompare(b.from)),pay,months:[...months.values()],leave,leave_balances:leaveBalances,pay_snapshot:paySnapshot,source_records:sourceRecords,
  leave_note:String(v(rows(bundle,'Leave Log').find(r=>r.number===2),0)),
  notes:[
   'This is the complete captured source history for this exact source name. Other spellings remain separate employee identities until verified.',
   'Recorded work time uses complete same-day clock sequences and recorded breaks. Automatic lunch deductions, paid leave and holiday hours are not reconstructed; this is not historical paid time. Days with clock problems are excluded from time subtotals.',
   'The UIF Log records gross pay and UIF only. Historical net payments, rate effective dates and the ordinary/overtime split are not supplied there. Current rates are not applied to earlier weeks.',
   'The Week, Casuals, Payments, payment batch and Payslips sheets are dated snapshots that can change. A source Paid/Yes flag is retained as evidence, not verified payment proof.',
   'Exact duplicate UIF amounts count once per date. Conflicting amounts are excluded from subtotals and all original rows remain visible.',
   'Source leave balances are preserved separately from the full leave log. They are not approved opening balances and do not deduct leave again.'
  ]};
}
