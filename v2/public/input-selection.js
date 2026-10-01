// Delegate once so login, tabs, searches and save/reload renders behave alike.
// Keep native number inputs: min/step validation and numeric keyboards still apply.
function selectInputContents(event) {
  const input = event.target;
  const textEntry = input instanceof HTMLTextAreaElement ||
    (input instanceof HTMLInputElement &&
      ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(input.type));
  if (!textEntry || input.disabled || input.readOnly) return;
  input.select();
}

// Focus covers keyboard navigation; click runs after pointer caret placement,
// including a touch-generated click or another tap on the already focused field.
document.addEventListener('focusin', selectInputContents);
document.addEventListener('click', selectInputContents);
