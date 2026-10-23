const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function openAvailability({api,onChange}) {
  document.querySelector('#product-availability')?.remove();
  const bootstrap=await api('/api/bootstrap');
  let catalog=bootstrap.catalog,busy=false;
  const canManage=['alex','alinda'].includes(bootstrap.username);
  onChange(catalog);
  const dialog=document.createElement('dialog');dialog.id='product-availability';
  dialog.setAttribute('aria-labelledby','availability-heading');
  dialog.innerHTML='<div class="availability-heading"><h2 id="availability-heading">Products</h2><button id="close-availability">Done</button></div><p>Available products appear in new Sales and Production plans and staff printouts. Recorded loads, returns and history are retained.</p><label>Find a product<input type="search" id="availability-search" placeholder="Product name…"></label><p id="availability-message" role="status"></p><div id="availability-list"></div>';
  document.body.append(dialog);
  const message=dialog.querySelector('#availability-message'),list=dialog.querySelector('#availability-list'),search=dialog.querySelector('#availability-search');
  function render(){
    list.innerHTML=catalog.products.filter(p=>(p.name+' '+p.code).toLowerCase().includes(search.value.toLowerCase())).map(p=>`<div class="availability-product"><div><strong>${escape(p.name)}</strong><small>${escape(p.code)} · ${p.active?(p.available?'Available':'Not available'):'Inactive catalogue item'}</small></div><button type="button" role="switch" aria-label="${escape(p.name)} available" aria-checked="${p.active&&p.available}" data-availability-code="${p.code}" ${!canManage||!p.active||busy?'disabled':''}><span aria-hidden="true">${p.active&&p.available?'ON':'OFF'}</span></button></div>`).join('');
    list.querySelectorAll('[data-availability-code]').forEach(button=>button.onclick=async()=>{
      if(busy)return;const product=catalog.products.find(p=>p.code===button.dataset.availabilityCode);
      busy=true;render();message.textContent='Saving…';
      try{const result=await api('/api/products/availability',{code:product.code,available:!product.available,revision:catalog.revision});catalog=result.catalog;onChange(catalog);message.textContent=product.name+': '+(catalog.products.find(p=>p.code===product.code).available?'Available':'Not available')+' · Saved';}
      catch(error){message.textContent=error.message;}
      finally{busy=false;render();}
    });
  }
  search.oninput=render;
  dialog.querySelector('#close-availability').onclick=()=>{if(!busy)dialog.close();};
  dialog.oncancel=e=>{if(busy)e.preventDefault();};
  dialog.onclose=()=>dialog.remove();render();dialog.showModal();
  if(!canManage)message.textContent='Alex or Alinda can change these switches.';
}
