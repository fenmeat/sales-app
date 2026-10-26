// Shared entry rule, including product fields recreated after filtering.
export function installInputSelection(root=document){
  const textTypes=new Set(['text','search','tel','url','email','password','number']);
  const pending=new WeakMap();
  function editable(target){
    return target && !target.disabled && !target.readOnly &&
      (target.tagName==='TEXTAREA' || (target.tagName==='INPUT' && textTypes.has(target.type)));
  }
  function selectValue(target){
    if(!editable(target))return;
    target.select();
    // Numeric fields use type=text plus inputmode so selection is supported.
    try{target.setSelectionRange(0,target.value.length);}catch{}
  }
  function onEntry(event){
    const target=event.target;if(!editable(target))return;
    selectValue(target);
    const token={},value=target.value;pending.set(target,token);
    // Re-apply after native tap/caret placement; never after typing or blur.
    root.defaultView.requestAnimationFrame(()=>{
      if(root.activeElement===target&&pending.get(target)===token&&target.value===value)selectValue(target);
    });
  }
  root.addEventListener('focusin',onEntry);
  root.addEventListener('click',onEntry);
  root.addEventListener('input',event=>pending.delete(event.target));
  root.addEventListener('focusout',event=>pending.delete(event.target));
}
