import './input-selection.js';
const $=selector=>document.querySelector(selector);
const status=$('#staff-access-status');
let generated=null;
const randomKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
$('#create-staff-keys').addEventListener('click',()=>{
 if(generated)return;
 try{
  generated={xavier:randomKey(),xalinda:randomKey()};
  while(generated.xalinda===generated.xavier)generated.xalinda=randomKey();
  for(const [name,key] of Object.entries(generated))$('#'+name+'-key').value=key;
  $('#staff-key-results').hidden=false;
  $('#create-staff-keys').disabled=true;
  $('#create-staff-keys').textContent='Keys created — not activated';
  status.textContent='Save these keys privately. Copying or reopening the app does not activate them.';
 }catch{generated=null;status.textContent='Secure key generation was unavailable. Use an up-to-date browser over HTTPS; no access settings were changed.';}
});
for(const button of document.querySelectorAll('[data-copy-staff]'))button.addEventListener('click',async()=>{
 if(!generated)return;
 const name=button.dataset.copyStaff,input=$('#'+name+'-key');
 try{await navigator.clipboard.writeText(generated[name]);status.textContent='Copied '+name+"'s personal key. Save it privately; it is not activated yet.";}
 catch{input.type='text';input.focus();input.select();status.textContent='Automatic copy was unavailable. Copy the selected '+name+' key manually, then use Hide keys.';$('#show-staff-keys').textContent='Hide keys';$('#show-staff-keys').setAttribute('aria-pressed','true');}
});
$('#show-staff-keys').addEventListener('click',()=>{
 const show=$('#show-staff-keys').getAttribute('aria-pressed')!=='true';
 for(const name of ['xavier','xalinda'])$('#'+name+'-key').type=show?'text':'password';
 $('#show-staff-keys').setAttribute('aria-pressed',String(show));$('#show-staff-keys').textContent=show?'Hide keys':'Show keys';
});
$('#keys-saved').addEventListener('change',()=>{$('#copy-staff-setup').disabled=!generated||!$('#keys-saved').checked;});
$('#copy-staff-setup').addEventListener('click',async()=>{
 if(!generated||!$('#keys-saved').checked)return;
 const value=JSON.stringify(generated,null,2);
 try{await navigator.clipboard.writeText(value);$('#staff-manual-copy').hidden=true;$('#staff-key-json').value='';status.textContent='Setup copied. Add APP_STAFF_ACCESS_KEYS in Cloudflare and Deploy. Leave APP_ACCESS_KEYS unchanged.';}
 catch{$('#staff-key-json').value=value;$('#staff-manual-copy').hidden=false;$('#staff-key-json').focus();$('#staff-key-json').select();status.textContent='Copy the selected whole block manually. It belongs in APP_STAFF_ACCESS_KEYS only. Keys are not activated yet.';}
});
window.addEventListener('beforeunload',event=>{if(generated&&!$('#keys-saved').checked){event.preventDefault();event.returnValue='';}});
