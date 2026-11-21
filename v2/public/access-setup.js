import './input-selection.js';

const alex = document.querySelector('#alex-key');
const alinda = document.querySelector('#alinda-key');
const status = document.querySelector('#key-status');
const manual = document.querySelector('#manual-copy');
const output = document.querySelector('#key-json');

for (const input of [alex, alinda]) input.addEventListener('input', () => {
  status.textContent = '';
  manual.hidden = true;
  output.value = '';
  input.setCustomValidity('');
});

document.querySelector('#copy-saved-keys').addEventListener('click', async () => {
  for (const input of [alex, alinda]) {
    input.value = input.value.trim();
    input.setCustomValidity(/^[a-f0-9]{64}$/.test(input.value) ? '' : 'Paste the complete original 64-character key, without quotation marks.');
    if (!input.reportValidity()) return;
  }
  if (alex.value === alinda.value) {
    status.textContent = 'Alex and Alinda have different personal keys. Check that you entered each person’s own saved key.';
    return;
  }
  const value = JSON.stringify({alex: alex.value, alinda: alinda.value}, null, 2);
  try {
    await navigator.clipboard.writeText(value);
    status.textContent = 'Copied both saved keys. They are NOT activated yet. Now paste into the Cloudflare runtime Secret using the steps below.';
  } catch {
    output.value = value;
    manual.hidden = false;
    output.focus();
    output.select();
    status.textContent = 'Automatic copying was unavailable. Copy the selected block, then follow the Cloudflare steps below. The keys are NOT activated yet.';
  }
});
