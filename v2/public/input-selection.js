// One policy for every screen, including dynamically rendered and offline forms.
// Text keeps the browser's native caret, selection, clipboard and touch editing.
const installed = new WeakSet();

export function installInputSelection(root = document) {
  if (installed.has(root)) return;
  installed.add(root);
  const pending = new WeakMap();
  const numeric = target => target?.tagName === 'INPUT' &&
    !target.disabled && !target.readOnly &&
    (target.type === 'number' || (target.type === 'text' &&
      ['numeric', 'decimal'].includes(target.inputMode)));

  function selectValue(target) {
    if (!numeric(target)) return;
    target.select();
    // Text-based decimal fields support ranges; native numbers may not.
    try { target.setSelectionRange(0, target.value.length); } catch {}
  }

  function onEntry(event) {
    const target = event.target;
    if (!numeric(target)) return;
    selectValue(target);
    const token = {}, value = target.value;
    pending.set(target, token);
    // Restore numeric selection after native tap/label caret placement, but
    // never after editing, composition, blur or another focus/click event.
    root.defaultView.requestAnimationFrame(() => {
      if (root.activeElement === target && pending.get(target) === token &&
          target.value === value) selectValue(target);
    });
  }

  root.addEventListener('focusin', onEntry);
  root.addEventListener('click', onEntry);
  for (const type of ['beforeinput', 'input', 'compositionstart', 'focusout']) {
    root.addEventListener(type, event => pending.delete(event.target));
  }
}

if (typeof document !== 'undefined') installInputSelection(document);
