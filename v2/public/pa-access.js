const $=id=>document.getElementById(id);
const message=text=>{$('message').textContent=text;};
async function api(path,body) {
  const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Die versoek het nie geslaag nie.');return data;
}
async function refresh() {
  try {
    const data=await api('/api/pa/connections');
    $('current-user').textContent='Aangemeld as '+(data.username==='alinda'?'Alinda':'Alex')+'.';
    $('sign-in').hidden=true;$('signed-in').hidden=false;if($('approve'))$('approve').disabled=false;
    if($('connections')) {
      $('connections').hidden=false;const list=$('grants');list.replaceChildren();
      if(!data.grants.length){const p=document.createElement('p');p.textContent='Geen aktiewe verbinding nie.';list.append(p);}
      for(const grant of data.grants){const row=document.createElement('div'),label=document.createElement('p'),button=document.createElement('button');row.className='grant';label.textContent=grant.name+' · '+(grant.write_access?'Lees en skryf':'Slegs lees')+' · '+new Date(grant.created_at).toLocaleDateString('en-ZA');button.textContent='Trek toegang in';button.className='secondary';button.onclick=async()=>{if(!confirm('Trek hierdie ChatGPT-toegang in?'))return;button.disabled=true;try{await api('/api/pa/connections',{grant_id:grant.id});message('Toegang is ingetrek.');await refresh();}catch(e){message(e.message);button.disabled=false;}};row.append(label,button);list.append(row);}
    }
  }catch(error){$('sign-in').hidden=false;$('signed-in').hidden=true;if($('approve'))$('approve').disabled=true;}
}
$('login-form').onsubmit=async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;message('Meld aan…');
  try{await api('/api/login',{username:$('username').value,key:$('key').value});$('key').value='';await refresh();message('Aangemeld. Bevestig nou jou gekose toegang.');}catch(error){message(error.message);}finally{button.disabled=false;}
};
$('switch-account').onclick=async()=>{
  try{await api('/api/logout',{});await refresh();message('Kies jou eie admin-aanmelding.');}catch(error){message(error.message);}
};
refresh();
