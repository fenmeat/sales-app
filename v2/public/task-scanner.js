import {wholePage,validCorners,paperCorners,scanSource,encodePage} from './scan-image.js';
import {pagesToPdf} from './scan-pdf.js';

export function openScanner({attach,limit}){
  const dialog=document.createElement('dialog');
  dialog.className='scan-dialog';dialog.setAttribute('aria-labelledby','scan-heading');
  dialog.innerHTML=`<h2 id="scan-heading">Scan Document</h2>
    <input type="file" accept="image/*" capture="environment" hidden>
    <p data-msg role="status"></p><div data-edit hidden>
      <p>Skuif die vier hoeke tot die hele bladsy binne die lyne is.</p>
      <div class="scan-frame"><div class="scan-crop"></div></div>
      <div class="actions"><button type="button" data-full>Hele foto</button><button type="button" data-auto>Soek rande</button></div>
      <label>Kleur<select data-colour><option value="auto">Outomaties</option><option value="color">Behou kleur</option><option value="gray">Grysskaal</option></select></label>
      <div class="actions"><button type="button" class="primary" data-use>Gebruik bladsy</button><button type="button" data-back>Terug</button></div>
    </div><section data-review><p data-count></p><div data-pages></div>
      <div class="actions"><button type="button" data-add>Voeg bladsy by</button><button type="button" class="primary" data-save>Heg PDF aan</button></div>
    </section><p class="error" role="alert"></p><button type="button" data-exit>Kanselleer skandering</button>`;
  document.body.append(dialog);
  const find=s=>dialog.querySelector(s),camera=find('input'),edit=find('[data-edit]'),review=find('[data-review]'),crop=find('.scan-crop');
  const pages=[],handles=[];
  let source=null,corners,detected,replace=-1,working=false,closed=false,outline;
  function release(){if(source){source.width=source.height=1;source=null;}crop.replaceChildren();handles.length=0;}
  function close(){if(closed)return;closed=true;release();for(const p of pages)URL.revokeObjectURL(p.url);dialog.close();dialog.remove();}
  function cancel(){if(!working&&(!pages.length&&!source||confirm('Gooi hierdie ongestoorde skandering weg?')))close();}
  dialog.oncancel=e=>{e.preventDefault();cancel();};find('[data-exit]').onclick=cancel;
  function message(text=''){find('[data-msg]').textContent=text;}
  function error(text=''){find('.error').textContent=text;}
  function busy(value){working=value;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('button,select').forEach(el=>el.disabled=value);if(!value)find('[data-save]').disabled=!pages.length;}
  function pick(index){if(working)return;replace=index;error();camera.value='';camera.click();}
  function reviewPages(){
    release();edit.hidden=true;review.hidden=false;error();message();
    find('[data-count]').textContent=pages.length?'Gaan elke bladsy na voordat jy die PDF aanheg.':'Neem ’n foto van die eerste bladsy.';
    find('[data-pages]').replaceChildren();
    pages.forEach((page,index)=>{
      const row=document.createElement('article');row.className='scan-page';
      const title=document.createElement('strong');title.textContent='Bladsy '+(index+1);
      const picture=document.createElement('img');picture.src=page.url;picture.alt=title.textContent;
      const zoom=document.createElement('button');zoom.type='button';zoom.className='scan-thumb';zoom.setAttribute('aria-label','Vergroot '+title.textContent);
      zoom.append(picture);zoom.onclick=()=>{const viewer=document.createElement('dialog');viewer.className='scan-zoom';viewer.setAttribute('aria-label',title.textContent);
        const done=document.createElement('button');done.type='button';done.textContent='Terug';done.onclick=()=>viewer.close();
        const img=picture.cloneNode();viewer.append(done,img);document.body.append(viewer);viewer.onclose=()=>viewer.remove();viewer.showModal();};
      const actions=document.createElement('div');actions.className='actions';actions.append(title);
      for(const [label,action] of [['Herskandeer',()=>pick(index)],['Verwyder',()=>{URL.revokeObjectURL(page.url);pages.splice(index,1);reviewPages();}]]){
        const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;actions.append(b);
      }
      row.append(zoom,actions);find('[data-pages]').append(row);
    });
    find('[data-save]').disabled=!pages.length;
  }
  function position(){
    outline.setAttribute('points',corners.map(([x,y])=>(x*100)+','+(y*100)).join(' '));
    handles.forEach((handle,i)=>{handle.style.left=corners[i][0]*100+'%';handle.style.top=corners[i][1]*100+'%';});
  }
  function showCrop(){
    edit.hidden=false;review.hidden=true;crop.replaceChildren(source);
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
    outline=document.createElementNS(ns,'polygon');svg.append(outline);crop.append(svg);
    ['Links bo','Regs bo','Regs onder','Links onder'].forEach((label,i)=>{
      const handle=document.createElement('button');handle.type='button';handle.className='scan-handle';handle.setAttribute('aria-label',label);
      function move(x,y){const next=corners.slice();next[i]=[Math.min(1,Math.max(0,x)),Math.min(1,Math.max(0,y))];if(validCorners(next)){corners=next;position();}}
      handle.onpointerdown=e=>{handle.setPointerCapture(e.pointerId);e.preventDefault();};
      handle.onpointermove=e=>{if(handle.hasPointerCapture(e.pointerId)){const r=crop.getBoundingClientRect();move((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);}};
      handle.onkeydown=e=>{const delta={ArrowLeft:[-.005,0],ArrowRight:[.005,0],ArrowUp:[0,-.005],ArrowDown:[0,.005]}[e.key];if(delta){e.preventDefault();move(corners[i][0]+delta[0],corners[i][1]+delta[1]);}};
      handles.push(handle);crop.append(handle);
    });
    position();find('[data-colour]').value='auto';dialog.scrollTop=0;
  }
  camera.onchange=async()=>{
    const file=camera.files?.[0];if(!file||working)return;
    busy(true);error();message('Soek dokumentrande…');
    try{source=await scanSource(file);detected=paperCorners(source);corners=detected;showCrop();message();}
    catch{release();message();error('Die foto kon nie oopmaak nie. Neem dit weer of kies ’n JPG-foto.');}
    finally{busy(false);}
  };
  find('[data-auto]').onclick=()=>{corners=detected;position();};
  find('[data-full]').onclick=()=>{corners=wholePage();position();};
  find('[data-back]').onclick=reviewPages;
  find('[data-use]').onclick=async()=>{
    if(working||!source)return;busy(true);error();message('Maak die bladsy reguit…');
    try{
      await new Promise(resolve=>setTimeout(resolve,25));
      const page=await encodePage(source,corners,find('[data-colour]').value);
      const total=pages.reduce((s,p,i)=>s+(i===replace?0:p.image.size),page.image.size);
      if(total>limit)throw Error('Hierdie PDF is te groot. Heg die eerste bladsye aan en begin ’n tweede skandering.');
      page.url=URL.createObjectURL(page.preview);
      if(replace>=0){URL.revokeObjectURL(pages[replace].url);pages[replace]=page;}else pages.push(page);
      reviewPages();find('[data-save]').focus();
    }catch(e){message();error(e.message||'Die bladsy kon nie voorberei word nie. Probeer weer.');}finally{busy(false);}
  };
  find('[data-add]').onclick=()=>pick(-1);
  find('[data-save]').onclick=()=>{
    const pdf=pagesToPdf(pages);
    if(pdf.size>limit){error('Hierdie PDF is te groot. Verwyder ’n bladsy en heg dit apart aan.');return;}
    const stamp=new Date().toISOString().replace(/[-:.]/g,'').replace('T','-').slice(0,15);
    if(attach(new File([pdf],'Scan-'+stamp+'.pdf',{type:'application/pdf'})))close();
    else error('Die taak is vol. Verwyder eers ’n aanhegsel.');
  };
  dialog.showModal();reviewPages();pick(-1);return close;
}
