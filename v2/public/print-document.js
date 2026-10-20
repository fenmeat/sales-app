// A native print preview may paginate again after window.print() returns or
// afterprint fires. Keep its chosen document and print-only CSS until the next
// explicit print action; @media print already restores the normal screen.
const modes=['printing-stock','printing-production','printing-production-staff'];
let selected=null,preparing=false;
function applySelection(){
 document.body.classList.remove(...modes);
 if(selected)document.body.classList.add(selected);
}
window.addEventListener('beforeprint',applySelection);

export async function printDocument(mode,prepare){
 if(preparing)return;
 if(mode!==null&&!modes.includes(mode))throw new Error('Unknown print document.');
 preparing=true;
 try{
  const sheet=await prepare?.();
  // A missing saved plan or failed fit must never fall through to screen print.
  if(mode&&!sheet)return;
  await document.fonts.ready;
  selected=mode;
  applySelection();
  // Give the mounted document and its selected styles a layout/paint turn.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  window.print();
 }finally{preparing=false;}
}
