// Delegate once so login, tabs, searches and save/reload renders behave alike.
// Decimal text controls retain the same select-all behavior as native numbers.
function selectInputContents(event) {
  const input = event.target;
  const textEntry = input instanceof HTMLTextAreaElement ||
    (input instanceof HTMLInputElement &&
      ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(input.type));
  if (!textEntry || input.disabled || input.readOnly) return;
  input.select();
  // Label activation can focus the input again after click dispatch and collapse
  // the selection. Restore it after the browser's default action has completed.
  if (event.type === 'click') requestAnimationFrame(() => {
    if (document.activeElement === input && !input.disabled && !input.readOnly) input.select();
  });
}

// Focus covers keyboard navigation; click runs after pointer caret placement,
// including a touch-generated click or another tap on the already focused field.
document.addEventListener('focusin', selectInputContents);
document.addEventListener('click', selectInputContents);
