import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMailTag, ensureMailTags, mailTagId } from '../src/mailTags.ts';

test('mail categories recognize carriers, payment and appointments', () => {
  assert.equal(classifyMailTag('Paket', 'DHL', 'Kosten: 19,99 €'), 'delivery');
  assert.equal(classifyMailTag('Zahlung', 'PayPal', ''), 'payment');
  assert.equal(classifyMailTag('Bestätigung', '', 'Gesamtbetrag 29,90 €'), 'payment');
  assert.equal(classifyMailTag('Besprechung', '', 'Am Montag'), 'appointment');
  assert.equal(classifyMailTag('', '', '', true), 'delivery');
});

test('payment and amount outweigh incidental shipping references', () => {
  assert.equal(classifyMailTag('Ihre Zahlung', 'PayPal <service@paypal.com>', 'Zahlung 39,90 EUR. Lieferadresse und Versand.'), 'payment');
  assert.equal(classifyMailTag('Bestätigung', 'notice@klarna.com', 'Zahlung Zahlung Zahlung. Paket 20 €'), 'payment');
  assert.equal(classifyMailTag('Ihre Rechnung', 'billing@ups.com', 'Zahlung: 12,50 €'), 'payment');
  assert.equal(classifyMailTag('Sendung unterwegs', 'pkginfo@ups.com', 'Ihr Paket wird morgen zugestellt.'), 'delivery');
  assert.equal(classifyMailTag('Paketankündigung', 'noreply@information.dpd.fr', 'Zustellung morgen'), 'delivery');
  assert.equal(classifyMailTag('Treffen', 'DHL <person@example.com>', 'Besprechung morgen'), 'appointment');
  assert.equal(classifyMailTag('Treffen', 'person@paypal.com.example.org', 'Besprechung morgen'), 'appointment');
});

test('base tags keep identity and colors across language changes and reuse existing tags', () => {
  const german = ensureMailTags([], 'de');
  const english = ensureMailTags(german, 'en');
  assert.deepEqual(english.map(tag => tag.name), ['Delivery', 'Payment', 'Appointments']);
  assert.deepEqual(english.map(tag => tag.id), german.map(tag => tag.id));
  assert.equal(new Set(english.map(tag => tag.color)).size, 3);
  const existing = { id: 'custom', name: 'Lieferung', color: '#123456' };
  const reused = ensureMailTags([existing], 'en');
  assert.equal(mailTagId(reused, 'delivery'), 'custom');
  assert.equal(reused.length, 3);
});

test('without create, mail tags are only renamed, never added', () => {
  assert.deepEqual(ensureMailTags([], 'en', false), []);
  const german = ensureMailTags([], 'de');
  assert.deepEqual(ensureMailTags(german, 'en', false).map(tag => tag.name), ['Delivery', 'Payment', 'Appointments']);
});
