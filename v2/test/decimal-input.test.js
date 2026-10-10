import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDecimal} from '../public/decimal-input.js';

test('comma and point represent the same quantity without stripping the separator', () => {
  for (const [text, expected] of [['0,5', .5], ['1,5', 1.5], [',5', .5], ['.5', .5], ['1250,75', 1250.75], ['0,001', .001], [' 1,50 ', 1.5], ['0', 0]]) {
    assert.equal(parseDecimal(text), expected);
    assert.equal(parseDecimal(text.replace(',', '.')), expected);
  }
});

test('blank stays unknown and an unfinished decimal retains its numeric prefix', () => {
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('  '), null);
  assert.equal(parseDecimal('0,'), 0);
  assert.equal(parseDecimal('1.'), 1);
});

test('ambiguous separators, negatives and invalid text cannot become zero or a truncated number', () => {
  for (const text of [',', '.', '1,2,3', '1.2.3', '1,234.56', '1.234,56', '1 234,56', '5kg', '-0,5', '1e3', 'Infinity', 'NaN', '0x10', '9'.repeat(400)]) {
    assert.ok(Number.isNaN(parseDecimal(text)), text);
  }
});
