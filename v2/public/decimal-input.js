// Keep the user's text while typing: iOS may only offer a decimal comma.
// Never strip separators (0,5 must not become 05) or accept partial garbage.
export function parseDecimal(value) {
  const text = String(value).trim();
  if (text === '') return null;
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return NaN;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : NaN;
}

export function readNumericInput(input) {
  if (input.type === 'number') {
    return input.value === '' ? (input.validity.badInput ? -1 : null) : Number(input.value);
  }
  const value = parseDecimal(input.value);
  let message = '';
  if (Number.isNaN(value)) {
    message = 'Enter a number using one comma or point, for example 0,5 or 0.5.';
  } else if (value !== null) {
    // Text controls accept either separator; a native numeric control still
    // enforces the field's original minimum, maximum and step constraints.
    const check = input.ownerDocument.createElement('input');
    check.type = 'number';
    for (const name of ['min', 'max', 'step']) {
      if (input.hasAttribute(name)) check.setAttribute(name, input.getAttribute(name));
    }
    check.value = String(value);
    if (!check.validity.valid) message = check.validationMessage;
  }
  input.setCustomValidity(message);
  // Existing server quantity validation rejects -1, including after a tab
  // change. Never let NaN become JSON null and erase a saved quantity.
  return message ? -1 : value;
}
