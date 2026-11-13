// Keep the workflow dock at the screen bottom, behind the software keyboard.
// Never add a keyboard-height bottom offset: Safari already moves its viewport.
const root = document.documentElement;
const viewport = window.visualViewport;
let keyboardOpen = false;
let fullHeight = window.innerHeight;
let frame = 0;

function update() {
  frame = 0;
  const active = document.activeElement;
  const editing = active?.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), textarea, [contenteditable=true]') && !active.readOnly && !active.disabled;
  const touch = window.matchMedia('(any-pointer: coarse)').matches;
  // Multiplying by scale avoids treating pinch zoom as a keyboard. Do not
  // subtract offsetTop: Safari pans the viewport as the next field is selected.
  const visibleHeight = viewport ? viewport.height * viewport.scale : window.innerHeight;
  const obscuredHeight = Math.max(window.innerHeight, fullHeight) - visibleHeight;
  keyboardOpen = touch && Boolean(editing || keyboardOpen) && obscuredHeight > 120;
  root.classList.toggle('workflow-keyboard-open', keyboardOpen);
  if (!keyboardOpen && !editing) fullHeight = window.innerHeight;
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(update);
}

viewport?.addEventListener('resize', schedule);
viewport?.addEventListener('scroll', schedule);
window.addEventListener('resize', schedule);
window.addEventListener('orientationchange', () => {
  fullHeight = 0;
  schedule();
});
document.addEventListener('focusin', schedule);
document.addEventListener('focusout', schedule);
window.addEventListener('pageshow', schedule);
schedule();
