import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {installInputSelection} from '../public/input-selection.js';
import {installInputSelection as invoiceSelection} from '../public/invoicing/input-selection.js';

function screen() {
  const {document, window} = parseHTML('<html><body></body></html>');
  const frames = [];
  window.requestAnimationFrame = callback => frames.push(callback);
  installInputSelection(document);
  return {
    document,
    flush() { while (frames.length) frames.shift()(); },
    event(target, type) { target.dispatchEvent(new window.Event(type, {bubbles: true})); },
    field({tag = 'input', type = 'text', mode = '', value = 'Dis n 30 dae rekening', ...props} = {}) {
      const field = document.createElement(tag);
      Object.assign(field, {type, inputMode: mode, value, selectionStart: 6, selectionEnd: 6, calls: 0, ...props});
      field.select = () => { field.calls++; field.selectionStart = 0; field.selectionEnd = field.value.length; };
      field.setSelectionRange = (start, end) => { field.selectionStart = start; field.selectionEnd = end; };
      document.body.append(field);
      Object.defineProperty(document, 'activeElement', {configurable: true, value: field});
      return field;
    }
  };
}

test('ordinary text preserves a mid-sentence caret and manual selection through focus and repeated taps', () => {
  const ui = screen();
  for (const props of [{tag:'textarea'}, {}, ...['search','tel','url','email','password'].map(type=>({type})), {value:'12345'}, {mode:'tel'}, {tag:'textarea',mode:'decimal'}]) {
    const field = ui.field(props), original = field.value;
    for (const type of ['focusin','click','click']) ui.event(field,type);
    ui.flush();
    assert.deepEqual([field.selectionStart,field.selectionEnd], [6,6]);
    // Native selection/copy/paste ranges must not be replaced by app handlers.
    field.setSelectionRange(6,8);
    ui.event(field,'click'); ui.flush();
    assert.deepEqual([field.selectionStart,field.selectionEnd], [6,8]);
    assert.equal(field.calls,0);
    assert.equal(field.value,original);
  }
});

test('amounts, prices, quantities and native number fields still select all without changing values', () => {
  const ui = screen();
  for (const props of [{mode:'decimal',value:'158833,12'}, {mode:'numeric',value:'27'}, {type:'number',value:'12.5'}]) {
    const field = ui.field(props), original = field.value;
    for (const type of ['focusin','click','click']) {
      field.setSelectionRange(2,2);
      ui.event(field,type); ui.flush();
      assert.deepEqual([field.selectionStart,field.selectionEnd], [0,original.length]);
      assert.equal(field.value,original);
    }
  }
});

test('label/touch caret placement is restored only for the active unchanged numeric field', () => {
  const ui=screen(), field=ui.field({mode:'decimal',value:'120,50'});
  ui.event(field,'focusin'); ui.event(field,'click');
  field.setSelectionRange(2,2); ui.flush();
  assert.deepEqual([field.selectionStart,field.selectionEnd],[0,6]);
  assert.equal(field.calls,3,'only the latest scheduled selection runs');
});

test('queued numeric selection cannot clobber typing, paste, composition, blur or changed values', () => {
  for (const cancel of ['beforeinput','input','compositionstart','focusout','changed','disabled','readOnly']) {
    const ui=screen(), field=ui.field({mode:'decimal',value:'12,50'});
    ui.event(field,'click');
    if(cancel==='changed')field.value='7';
    else if(['disabled','readOnly'].includes(cancel))field[cancel]=true;
    else ui.event(field,cancel);
    field.setSelectionRange(1,1); ui.flush();
    assert.deepEqual([field.selectionStart,field.selectionEnd],[1,1],cancel);
  }
});

test('dynamic inputs share one installer; disabled, read-only and non-entry controls are untouched', () => {
  assert.equal(invoiceSelection,installInputSelection);
  const ui=screen(); invoiceSelection(ui.document);
  const field=ui.field({mode:'decimal'}); ui.event(field,'click'); ui.flush();
  assert.equal(field.calls,2,'repeat installation adds no duplicate handlers');
  for(const props of [{disabled:true},{readOnly:true},...['date','checkbox','radio','file','range','button','hidden'].map(type=>({type}))]) {
    const field=ui.field({mode:'numeric',...props});ui.event(field,'focusin');ui.event(field,'click');ui.flush();
    assert.equal(field.calls,0);
  }
});

test('offline invoice shell includes the shared selection module in its new cache', async () => {
  const source=await readFile(new URL('../public/invoicing/sw.js',import.meta.url),'utf8');
  assert.match(source,/shell-v0382/);
  assert.match(source,/'\/input-selection\.js'/);
});
