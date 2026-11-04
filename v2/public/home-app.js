import './input-selection.js';
import {openAvailability} from './availability-controls.js';

const app=document.querySelector('#app');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
  sales:'M3 5h11v12H3z M14 10h4l3 4v3h-7 M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  pos:'M4 10h16v11H4z M3 10l2-7h14l2 7 M9 21v-7h6v7 M3 10h18',
  invoices:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3',
  production:'M3 21V9l6 4V9l6 4V3h4l2 18z M6 17h1 M11 17h1 M16 17h1',
  stocktake:'M9 3h6v4H9z M9 5H5v16h14V5h-4 M8 13l3 3 5-6',
  staff:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M16 3a4 4 0 0 1 0 8 M22 21v-3a4 4 0 0 0-4-4',
  tasks:'M9 5h12 M9 12h12 M9 19h12 M2 5l2 2 3-4 M2 12l2 2 3-4 M2 19l2 2 3-4',
  report:'M5 3h10l4 4v14H5z M14 3v5h5 M8 17v-3 M12 17v-6 M16 17v-4',
  recipes:'M12 5C8 2 5 2 2 3v16c3-1 6-1 10 2 4-3 7-3 10-2V3c-3-1-6-1-10 2z M12 5v16',
  products:'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10 M7 5l10 4',
  setup:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6'
};
const icon=id=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[id]??paths.tasks}"/></svg>`;
function header(user=''){return `<header class="app-header home-header"><div class="brand"><em>F</em><div>FEN MEAT<span>Home</span></div></div>${user?`<div class="home-account"><span>${esc(user[0].toUpperCase()+user.slice(1))}</span><button id="sign-out">Sign out</button></div>`:''}</header>`;}
function notice(message){document.querySelector('#notice').textContent=message;}
async function api(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(30000)});
  let data;try{data=await response.json();}catch{throw Error('Connection interrupted. Please try again.');}
  if(!response.ok)throw Object.assign(Error(data.error??'Could not connect. Please try again.'),{status:response.status});
  return data;
}
function signIn(){
  app.innerHTML=header()+`<main class="home-signin"><p class="eyebrow">WELCOME TO FEN MEAT</p><h1>Sign in</h1><p>Use your own app account.</p><form id="home-login"><label>Username<input name="username" autocomplete="username" required></label><label>Personal access key<input name="key" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign in</button><p id="login-error" role="alert"></p></form><a class="rep-signin" href="/invoicing/">Rep PIN sign-in → Invoices</a><p class="home-help"><a href="/access-setup">Access setup</a></p></main>`;
  document.querySelector('#home-login').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('button');if(button.disabled)return;
    const values=new FormData(form);button.disabled=true;document.querySelector('#login-error').textContent='';
    try{const result=await api('/api/login',{username:values.get('username'),key:values.get('key')});if(result.redirect){location.assign(result.redirect);return;}await start();}
    catch(error){document.querySelector('#login-error').textContent=error.message;}
    finally{button.disabled=false;}
  };
}
function render(data){
  app.innerHTML=header(data.username)+`<main class="home-shell"><div class="home-heading"><h1>Home</h1><p>Choose where you want to work.</p></div><nav class="home-grid" aria-label="Fen Meat sections">${data.sections.map(section=>{
    const content=`<span class="home-icon">${icon(section.id)}</span><span class="home-tile-title">${esc(section.title)}</span><span class="home-tile-description">${esc(section.description)}</span>`;
    return section.id==='products'?`<button class="home-tile" id="home-products">${content}</button>`:`<a class="home-tile" href="${esc(section.href)}">${content}</a>`;
  }).join('')}</nav></main>`;
  const products=document.querySelector('#home-products');
  if(products)products.onclick=async()=>{if(products.disabled)return;products.disabled=true;notice('');try{await openAvailability({api,onChange(){}});}catch(error){notice(error.message);}finally{products.disabled=false;}};
  document.querySelector('#sign-out').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await api('/api/logout',{});notice('');signIn();}catch(error){notice(error.message);button.disabled=false;}};
}
async function start(){
  try{render(await api('/api/navigation'));}
  catch(error){if(error.status===401){signIn();return;}app.innerHTML=header()+`<main class="home-signin"><h1>Home</h1><p role="alert">${esc(error.message)}</p><button id="home-retry">Try again</button><p><a href="/invoicing/">Open Invoices</a></p></main>`;document.querySelector('#home-retry').onclick=start;}
}
// Keep existing Zoho return links and saved setup bookmarks working.
if(new URL(location.href).searchParams.has('zoho')||location.hash==='#setup')location.replace('/sales'+location.search+location.hash);
else await start();
