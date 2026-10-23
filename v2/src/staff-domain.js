import {check,dateKey} from './domain.js';

export const STAFF_ZONE='Africa/Johannesburg';
export const LEAVE_TYPES=['Annual','Sick','Family responsibility','Unpaid'];
export const dayAt=at=>new Date((typeof at==='number'?at:Date.parse(at))+7200000).toISOString().slice(0,10);
export const dayStart=day=>Date.parse(dateKey(day)+'T00:00:00+02:00');
export const blankStaff=()=>({people:[],leave:[],ledger:[]});
export function text(value,name,max=100){check(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max,`Enter ${name} (up to ${max} characters).`);return value.trim();}
export function uuid(value){check(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),'Invalid action or record ID.');return value;}
export function staffPerson(state,id){const p=state.people.find(p=>p.id===id);check(p,'Employee not found.',404);return p;}
export function validateBirthDate(value,asOf=dayAt(Date.now())){const date=dateKey(value);check(date<=asOf,'Date of birth cannot be in the future.');return date;}
export function birthdayPin(value){const date=dateKey(value);return date.slice(5,7)+date.slice(8,10);}
export const isCasual=p=>p.employment_type==='Casual';
const validSlot=n=>Number.isInteger(n)&&n>=1&&n<=9999;
export function casualPin(p){return isCasual(p)&&p.active&&validSlot(p.casual_pin_slot)?String(p.casual_pin_slot).padStart(4,'0'):null;}
export function clockPin(p){return isCasual(p)?casualPin(p):p.birth_date?birthdayPin(p.birth_date):null;}
function assignCasualPin(state,p,old){
 // Slots are reusable credentials, never employee identifiers. Only active
 // casuals reserve slots; immutable register revisions retain assignment history.
 p.casual_pin_slot=null;
 if(!isCasual(p)||!p.active)return;
 check(!(old?.source_profile?.issues??[]).some(x=>x.startsWith('Shared casual label:')),'This imported record combines different casuals. Add a separate person under Add casual; keep the shared history unchanged.');
 const used=new Set(state.people.filter(x=>x.id!==p.id&&isCasual(x)&&x.active).map(x=>x.casual_pin_slot));
 if(old?.active&&isCasual(old)&&validSlot(old.casual_pin_slot)&&!used.has(old.casual_pin_slot)){p.casual_pin_slot=old.casual_pin_slot;return;}
 let slot=1;while(used.has(slot)&&slot<=9999)slot++;
 check(slot<=9999,'All casual PINs are in use. Make a finished casual inactive first.');p.casual_pin_slot=slot;
}
export function validatePerson(raw,old,asOf){
 check(raw&&typeof raw==='object','Enter an employee.');
 const kind=raw.employment_type??old?.employment_type??'Regular';check(['Regular','Casual'].includes(kind),'Choose Regular or Casual.');
 const id=uuid(raw.id),code=!old&&kind==='Casual'&&!raw.code?'CAS-'+id.replaceAll('-','').slice(0,12).toUpperCase():raw.code;
 const p={id,code:text(code,'employee code',24).toUpperCase(),name:text(raw.name,'employee name',80),team:text(raw.team,'team',60),start_date:dateKey(raw.start_date),active:raw.active,employment_type:kind};
 check(/^[A-Z0-9_-]+$/.test(p.code),'Use letters, numbers, - or _ in the employee code.');
 check(typeof p.active==='boolean','Choose active or inactive.');
 if(old){check(old.code===p.code,'The permanent employee code cannot change.');check(old.start_date===null||old.start_date===p.start_date,'The employment start date cannot change after the record is created.');}
 const birth=raw.birth_date===undefined?old?.birth_date:raw.birth_date;
 p.birth_date=birth===undefined||birth===null||birth===''?null:validateBirthDate(birth,asOf);
 p.schedules=old?.schedules??[];return p;
}
export function addSchedule(p,b){
 const from=dateKey(b.from);check(from>=p.start_date,'A schedule cannot start before employment.');
 check(Array.isArray(b.minutes)&&b.minutes.length===7&&b.minutes.every(n=>Number.isInteger(n)&&n>=0&&n<=960),'Enter scheduled paid minutes for Monday to Sunday (0–960).');
 check(!p.schedules.some(s=>s.from===from),'A schedule already starts on this date. Choose a new effective date.');
 p.schedules.push({from,minutes:[...b.minutes]});p.schedules.sort((a,b)=>a.from.localeCompare(b.from));
}
export function scheduledMinutes(p,date){const s=p.schedules.filter(s=>s.from<=date).at(-1);return s?s.minutes[(new Date(date+'T12:00:00Z').getUTCDay()+6)%7]:null;}
export function balance(state,id,type,date){
 const rows=state.ledger.filter(r=>r.employee_id===id&&r.type===type&&r.date<=date);
 return rows.some(r=>r.kind==='opening')?rows.reduce((n,r)=>n+r.units,0):null;
}
export function applyStaffAction(state,b,actor,stamp){
 const next=structuredClone(state);let detail={};
 if(b.action==='person'){
  const old=next.people.find(p=>p.id===b.person?.id),p=validatePerson(b.person,old,dayAt(stamp));
  check(!next.people.some(x=>x.id!==p.id&&x.code===p.code),'That employee code is already in use.');
  check(old||next.people.length<200,'The employee register is full.');
  assignCasualPin(next,p,old);
  if(old)Object.assign(old,p);else next.people.push(p);detail={employee_id:p.id};
 }else{
  const p=staffPerson(next,b.employee_id);detail={employee_id:p.id};
  if(b.action==='status'||b.action==='clock_type'){
   const old={...p};
   if(b.action==='status'){check(typeof b.active==='boolean','Choose active or inactive.');p.active=b.active;}
   else{check(['Regular','Casual'].includes(b.employment_type),'Choose Regular or Casual.');p.employment_type=b.employment_type;}
   assignCasualPin(next,p,old);detail.active=p.active;detail.employment_type=p.employment_type??'Regular';
  }
  else if(b.action==='birth_date'){
   p.birth_date=validateBirthDate(b.birth_date,dayAt(stamp));
  }
  else if(b.action==='employment_date'){
   check(p.source_profile&&p.employment_verified===false,'The imported employment date has already been confirmed.',409);
   const date=dateKey(b.date);check(p.schedules.every(s=>s.from>=date),'The employment date cannot follow an existing schedule.');
   detail.reason=text(b.reason,'employment date source',300);detail.previous_date=p.start_date;p.start_date=date;p.employment_verified=true;
  }
  else if(b.action==='schedule'){check(p.employment_verified!==false,'Confirm the imported employment date first.');addSchedule(p,b);detail.reason=text(b.reason,'schedule source or reason',300);p.schedules.find(s=>s.from===b.from).source=detail.reason;}
  else if(b.action==='balance'){
   check(LEAVE_TYPES.includes(b.type)&&b.type!=='Unpaid','Choose a paid leave type.');
   check(['opening','adjustment'].includes(b.kind),'Choose opening balance or adjustment.');
   const date=dateKey(b.date);check(Number.isFinite(b.units)&&Math.abs(b.units)<=366&&Number.isInteger(b.units*2),'Enter days in half-day increments, up to 366.');
   const rows=next.ledger.filter(r=>r.employee_id===p.id&&r.type===b.type);
   check(b.kind!=='opening'||!rows.some(r=>r.kind==='opening'),'An opening balance already exists. Add a documented adjustment.');
   check(b.kind==='opening'||balance(next,p.id,b.type,date)!==null,'Verify an opening balance first.');
   if(b.kind==='opening')check(b.units>=0,'Opening balance cannot be negative; reconcile this source balance first.');
   check(!next.ledger.some(r=>r.id===b.record_id),'This balance entry ID already exists.');
   next.ledger.push({id:uuid(b.record_id),employee_id:p.id,type:b.type,date,units:b.units,kind:b.kind,reason:text(b.reason,'balance source or reason',300),actor,at:stamp});
  }else if(b.action==='leave_request'){
   check(p.active,'Employee is inactive.');check(LEAVE_TYPES.includes(b.type),'Choose a leave type.');
   const date=dateKey(b.date);check(date>=p.start_date,'Leave cannot precede employment.');
   check(b.units===0.5||b.units===1,'Choose half a day or a full day.');
   check(!next.leave.some(r=>r.id===b.record_id),'This leave ID already exists.');
   next.leave.push({id:uuid(b.record_id),employee_id:p.id,type:b.type,date,units:b.units,status:'Pending',reason:text(b.reason,'leave note',300),requested_by:actor,requested_at:stamp});
  }else if(b.action==='leave_decision'){
   const r=next.leave.find(r=>r.id===b.record_id&&r.employee_id===p.id);check(r,'Leave request not found.',404);
   check(['Approved','Declined','Cancelled'].includes(b.decision),'Invalid leave decision.');
   check(b.decision==='Cancelled'?['Pending','Approved'].includes(r.status):r.status==='Pending','This request has already been reviewed.',409);
   const reason=text(b.reason,'review reason',300);
   if(b.decision==='Approved'){
    check(p.active,'Employee is inactive.');const mins=scheduledMinutes(p,r.date);check(mins!==null&&mins>0,'Verify a working schedule for this date before approval.');
    check(next.leave.filter(x=>x.id!==r.id&&x.employee_id===p.id&&x.date===r.date&&x.status==='Approved').reduce((n,x)=>n+x.units,0)+r.units<=1,'Approved leave exceeds one scheduled day.');
    if(r.type!=='Unpaid'){const available=balance(next,p.id,r.type,r.date);check(available!==null,'Verify the opening leave balance first.');check(available>=r.units,'Insufficient verified leave balance for this date.');}
    r.scheduled_minutes=mins;r.paid_minutes=r.type==='Unpaid'?0:mins*r.units;
    if(r.type!=='Unpaid')next.ledger.push({id:crypto.randomUUID(),employee_id:p.id,type:r.type,date:r.date,units:-r.units,kind:'usage',leave_id:r.id,actor,at:stamp,reason});
   }
   if(b.decision==='Cancelled'&&r.status==='Approved'&&r.type!=='Unpaid')next.ledger.push({id:crypto.randomUUID(),employee_id:p.id,type:r.type,date:r.date,units:r.units,kind:'reversal',leave_id:r.id,actor,at:stamp,reason});
   r.status=b.decision;r.reviewed_by=actor;r.reviewed_at=stamp;r.review_reason=reason;
  }else check(false,'Unsupported Staff action.');
 }
 // Backdated approvals/adjustments may not consume balances reserved for later leave.
 for(const p of next.people)for(const type of LEAVE_TYPES.filter(t=>t!=='Unpaid')){
  let running=0;const byDate=new Map();for(const r of next.ledger.filter(r=>r.employee_id===p.id&&r.type===type))byDate.set(r.date,(byDate.get(r.date)??0)+r.units);
  for(const [,units] of [...byDate].sort(([a],[b])=>a.localeCompare(b))){running+=units;check(running>=0,'This change would overdraw an approved leave balance. Reconcile the ledger first.');}
 }
 check(JSON.stringify(next).length<600000,'Staff history needs archiving before further changes.',409);
 return {state:next,detail};
}

const transitions={out:{in:'in'},in:{break_start:'break',out:'out'},break:{break_end:'in',out:'out'}};
export function shiftSummary(shift,{from=-Infinity,to=Infinity}={}){
 check(Array.isArray(shift.punches)&&shift.punches.length>0&&shift.punches.length<=100,'A shift needs 1–100 clock entries.');
 let state='out',last=-Infinity,work=0,breaks=0;const intervals=[];
 for(const [i,e] of shift.punches.entries()){
  const time=Date.parse(e.at);check(typeof e.at==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(e.at)&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,19)===e.at.slice(0,19),'Use a valid UTC clock timestamp.');
  check(time>last,'Clock entries must be in chronological order.');check(i===0?e.kind==='in':e.kind!=='in','A shift starts with one clock-in.',409);
  const next=transitions[state]?.[e.kind];check(next,'This clock action does not match the current status.',409);
  if(i>0){const ms=Math.max(0,Math.min(time,to)-Math.max(last,from));if(state==='in'){work+=ms;intervals.push({from:last,to:time});}else if(state==='break')breaks+=ms;}
  state=next;last=time;
 }
 const start=Date.parse(shift.punches[0].at),end=state==='out'?last:null,issues=[];
 if(state!=='out')issues.push('Open shift');
 if(dayAt(start)!==dayAt(last))issues.push('Spans midnight');
 if(last-start>16*3600000)issues.push('Long shift');
 return {state,start_at:new Date(start).toISOString(),end_at:end===null?null:new Date(end).toISOString(),worked_seconds:work/1000,break_seconds:breaks/1000,issues,intervals};
}
export function appendPunch(shift,kind,at){const next={...shift,punches:[...shift.punches,{kind,at}]};shiftSummary(next);return next;}
export function periodHours(people,shifts,leave,from,to,now=Date.now()){
 const start=dayStart(from),end=dayStart(to)+86400000;check(from<=to&&end-start<=31*86400000,'Review up to 31 days at a time.');
 return people.map(p=>{
  const own=shifts.filter(s=>s.employee_id===p.id),days=[];
  for(let day=start;day<end;day+=86400000){const date=dayAt(day),issues=new Set();let seconds=0,breakSeconds=0,reviewSeconds=0;
   for(const s of own){const z=shiftSummary(s,{from:day,to:day+86400000});if(Date.parse(z.start_at)>=day+86400000||(z.end_at?Date.parse(z.end_at)<=day:now<day))continue;
    const unresolved=z.issues.filter(x=>x==='Open shift'||!s.reviewed);unresolved.forEach(x=>issues.add(x));if(z.state==='out'&&!unresolved.length)seconds+=z.worked_seconds;else reviewSeconds+=z.worked_seconds;breakSeconds+=z.break_seconds;
   }
   const approved=leave.filter(r=>r.employee_id===p.id&&r.date===date&&r.status==='Approved');const paid=approved.reduce((n,r)=>n+r.paid_minutes,0);
   if(approved.length&&(seconds+reviewSeconds)>0)issues.add('Work and leave on the same day');
   const scheduled=scheduledMinutes(p,date);if(scheduled===null&&date>=p.start_date)issues.add('Schedule not verified');
   if(scheduled>0&&date<dayAt(now)&&!own.some(s=>Date.parse(s.punches[0].at)<day+86400000&&Date.parse(s.punches.at(-1).at)>=day)&&approved.reduce((n,r)=>n+r.units,0)<1)issues.add('Missing attendance record');
   days.push({date,completed_seconds:seconds,review_seconds:reviewSeconds,break_seconds:breakSeconds,paid_leave_minutes:paid,leave_days:approved.reduce((n,r)=>n+r.units,0),scheduled_minutes:scheduled,issues:[...issues]});
  }
  return {employee_id:p.id,days,completed_seconds:days.reduce((n,d)=>n+d.completed_seconds,0),review_seconds:days.reduce((n,d)=>n+d.review_seconds,0),paid_leave_minutes:days.reduce((n,d)=>n+d.paid_leave_minutes,0),issues:[...new Set(days.flatMap(d=>d.issues))],payroll_ready:false};
 });
}
