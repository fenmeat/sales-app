// Display only. All clock, leave and permission decisions happen on the server.
export const ZONE='Africa/Johannesburg';
export function localDay(at){return new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
export function clockTime(at){return new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));}
export function hoursLabel(seconds){const mins=Math.floor(seconds/60);return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;}

export const employeeSearchField='<label>Soek werknemer<input type="search" data-employee-search autocomplete="off" placeholder="Naam, van of werknemerkode"></label><p data-no-employees hidden>Geen werknemer pas by jou soektog nie.</p>';
const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
function employeeNames(people){
 return new Map(people.map(p=>[p.id,normalize([p.name,p.code,p.team,p.source_profile?.source_name,p.source_profile?.surname,p.nickname,p.alias].filter(Boolean).join(' '))]));
}
export function bindEmployeeSearch(root,people,initial='',onSearch=()=>{}){
 const input=root.querySelector('[data-employee-search]');
 if(!input)return;
 const names=employeeNames(people);
 function filter(){
  const words=normalize(input.value.trim()).split(/\s+/);
  let count=0;
  for(const row of root.querySelectorAll('[data-search-person]')){
   row.hidden=!words.every(word=>names.get(row.dataset.searchPerson)?.includes(word));
   if(!row.hidden)count++;
  }
  root.querySelector('[data-no-employees]').hidden=count>0||!input.value;
  onSearch(input.value);
 }
 input.value=initial;
 input.addEventListener('input',filter);
 filter();
}
export function currentWeek(){
 const now=new Date(localDay(new Date())+'T12:00:00Z');
 now.setUTCDate(now.getUTCDate()-(now.getUTCDay()+6)%7);
 const from=now.toISOString().slice(0,10);
 now.setUTCDate(now.getUTCDate()+6);
 return {from,to:now.toISOString().slice(0,10)};
}
export function employeePicker(people,selected,allowAll=false){
 const select=document.createElement('select');
 select.name='clock_employee';
 select.setAttribute('aria-label','Kies werknemer');
 if(allowAll)select.add(new Option('Alle werknemers',''));
 for(const p of people)select.add(new Option(p.name+' · '+p.code,p.id));
 select.value=selected;
 return employeeSearchField+'<label>Kies werknemer'+select.outerHTML+'</label>';
}
export function bindPicker(root,people,selected,allowAll,onChange){
 const select=root.querySelector('[name=clock_employee]');
 const options=Array.from(select.options);
 const searchable=employeeNames(people);
 let current=selected;
 select.value=current;
 const input=root.querySelector('[data-employee-search]');
 const apply=()=>{
  const words=normalize(input.value.trim()).split(/\s+/);
  const shown=options.filter(o=>o.value?words.every(w=>searchable.get(o.value)?.includes(w)):allowAll&&!input.value);
  select.replaceChildren(...shown);
  select.value=shown.some(o=>o.value===current)?current:(shown[0]?.value??'');
  root.querySelector('[data-no-employees]').hidden=shown.length>0;
  select.disabled=!shown.length;
  const value=shown.length?select.value:null;
  if(value!==current){current=value;onChange(value);}
 };
 input.addEventListener('input',apply);
 select.onchange=()=>{current=select.value;onChange(current);};
}
