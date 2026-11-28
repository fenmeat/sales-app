import {check} from './domain.js';
import {invoiceMoney} from './invoice-domain.js';

export const posId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
export function posText(value, max = 160) {
  check(typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), 'Enter valid text.');
  return value.trim();
}
export function posPhone(value) {
  const phone = posText(value ?? '', 30).replace(/[\s()-]/g, '');
  const normalized = /^0\d{9}$/.test(phone) ? '+27' + phone.slice(1) : phone;
  check(!normalized || /^\+[1-9]\d{7,14}$/.test(normalized), 'Enter a valid phone number, for example 0821234567.');
  return normalized;
}
export function posLines(input, products) {
  check(Array.isArray(input) && input.length <= 200, 'Choose valid sale items.');
  const seen = new Set();
  const lines = input.map(line => {
    check(line && !seen.has(line.code), 'A product appears twice.');
    seen.add(line.code);
    const product = products.find(p => p.code === line.code);
    check(product?.active && product.available, 'A selected product is unavailable. Remove it or reload Products.');
    check(Number.isSafeInteger(line.qty) && line.qty > 0 && line.qty <= 100000000, 'Enter a valid quantity.');
    check(invoiceMoney(product.price_cents), 'This product has no approved price.');
    const total = Math.round(product.price_cents * line.qty / 1000);
    check(invoiceMoney(total), 'The item amount is too large.');
    return {code:product.code, name:product.name, unit:product.unit, price:product.price_cents, qty:line.qty, total};
  });
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  check(invoiceMoney(total), 'The sale amount is too large.');
  return {lines, total};
}
export function posPayment(input, total) {
  check(input && invoiceMoney(total) && total > 0, 'Add products before taking payment.');
  const {cash_tendered: tendered, card, shop2shop} = input;
  check([tendered, card, shop2shop].every(invoiceMoney), 'Enter valid payment amounts.');
  check(card + shop2shop <= total, 'Card and Shop2Shop cannot exceed the sale total.');
  const cash = total - card - shop2shop;
  check(tendered >= cash, 'Receive the full payment before completing the sale.');
  check(input.received === true, 'Confirm that the full payment was actually received.');
  check(!card || input.card_approved === true, 'Confirm Approved on the Capitec machine first.');
  const card_reference = posText(input.card_reference ?? '', 100);
  const shop2shop_reference = posText(input.shop2shop_reference ?? '', 100);
  check(!shop2shop || shop2shop_reference.length > 0, 'Enter the successful Shop2Shop payment reference.');
  return {cash, cash_tendered:tendered, change:tendered-cash, card, shop2shop,
    card_approved:card > 0, card_reference:card ? card_reference : '',
    shop2shop_reference:shop2shop ? shop2shop_reference : '', received:true};
}
