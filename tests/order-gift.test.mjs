import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGiftInput, orderGift } from '../lib/order-gift.js';
import { orderView } from '../lib/order-view.js';
import { buildOrder, receiptHtml, operatorHtml } from '../lib/emails.js';
import { onRequestPost } from '../functions/api/payment-intent.js';

const names = 'Alec and Darci';
test('gift input is opt-in, optional, normalized and bounded by Unicode characters', () => {
  assert.deepEqual(parseGiftInput({}), { gift: false, giftFrom: '' });
  assert.deepEqual(parseGiftInput({ gift: false, giftFrom: 'stale' }), { gift: false, giftFrom: '' });
  assert.deepEqual(parseGiftInput({ gift: true }), { gift: true, giftFrom: '' });
  assert.equal(parseGiftInput({ gift: true, giftFrom: '  Alec  and Darci ' }).giftFrom, names);
  assert.equal(parseGiftInput({ gift: true, giftFrom: 'Jose\u0301' }).giftFrom, 'José');
  assert.equal(parseGiftInput({ gift: true, giftFrom: '😀'.repeat(80) }).giftFrom.length, 160);
  for (const gift of ['true', 1, null]) assert.throws(() => parseGiftInput({ gift }));
  for (const giftFrom of ['x'.repeat(81), '😀'.repeat(81), 'Alec\nDarci', '\x1b@', 'A\u0085B', 'A\u2028B', 20, null])
    assert.throws(() => parseGiftInput({ gift: true, giftFrom }));
});
test('legacy metadata has no gift; damaged sender metadata cannot reach slip readers', () => {
  assert.deepEqual(orderGift({ gift_from: names }), { gift: false, giftFrom: '' });
  assert.deepEqual(orderGift({ gift: '1', gift_from: '\x1b@' }), { gift: true, giftFrom: '' });
  assert.equal(orderView({ id: 'pi_test', metadata: { gift: '1', gift_from: names } }).giftFrom, names);
});
test('buyer and packing email previews escape the sender and keep the buyer email', () => {
  const o = buildOrder({ id: 'pi_test', amount: 69900, metadata: { gift: '1', gift_from: '<Alec & Darci>', email: 'buyer@example.test' } }, {});
  assert.equal(o.email, 'buyer@example.test');
  for (const html of [receiptHtml(o), operatorHtml(o)]) {
    assert.match(html, /From: &lt;Alec &amp; Darci&gt;/);
    assert.ok(!html.includes('<Alec & Darci>'));
  }
  assert.ok(!receiptHtml({ ...o, gift: false }).includes('From:'));
  assert.ok(!operatorHtml({ ...o, gift: false }).includes('From:'));
});
test('PaymentIntent creation, repricing, removal and legacy retries use only gift metadata', async (t) => {
  const prior = globalThis.fetch; t.after(() => { globalThis.fetch = prior; });
  let metadata = {}, calls = 0;
  const reply = (d) => new Response(JSON.stringify(d));
  const apply = (form) => { for (const [k,v] of form) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) { if (v) metadata[m[1]] = v; else delete metadata[m[1]]; } } };
  globalThis.fetch = async (url, options={}) => {
    calls++;
    if (String(url).endsWith('/store-catalog.json')) return reply({ cable: { title: 'Cable', variants: { standard: { price: 'price_test', weightLb: 1 } } } });
    if (String(url).endsWith('/prices/price_test')) return reply({ active: true, unit_amount: 1000, currency: 'usd' });
    if (String(url).endsWith('/tax/calculations')) return reply({ id: 'taxcalc_test', currency: 'usd', tax_amount_exclusive: 0, amount_total: 1650 });
    if (String(url).includes('/payment_intents')) { apply(options.body); return reply({ id: 'pi_gift', client_secret: 'pi_gift_secret_test', metadata }); }
    throw Error('Unexpected provider request');
  };
  const env = { STRIPE_SECRET_KEY: 'sk_test_gift_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_test_gift_fixture' };
  const cart = [{ id: 'cable', build: 'standard', qty: 1 }];
  const shipping = { name: 'Recipient', address: { line1: '1 Test St', city: 'San Francisco', state: 'CA', postal_code: '94107', country: 'US' } };
  const request = async (body) => { const r = await onRequestPost({ env, request: new Request('http://localhost/api/payment-intent', { method:'POST', body:JSON.stringify({cart,...body}) }) }); return {status:r.status,data:await r.json()}; };
  const created = await request({ gift: true, giftFrom: ' Alec  and Darci ' });
  assert.equal(created.status, 200); assert.equal(metadata.gift, '1'); assert.equal(metadata.gift_from, names);
  const update = { paymentIntentId: 'pi_gift', updateToken: created.data.updateToken, shipping };
  assert.equal((await request({...update,gift:true,giftFrom:names})).status,200);
  assert.equal(metadata.gift_from,names);
  assert.equal((await request({...update,gift:false,giftFrom:names})).status,200);
  assert.equal(metadata.gift,undefined); assert.equal(metadata.gift_from,undefined);
  await request({...update,gift:true,giftFrom:names}); await request(update);
  assert.equal(metadata.gift_from,undefined,'old clients cannot retain stale attribution');
  const before=calls;
  const invalid=await request({gift:true,giftFrom:'Alec\nDarci'});
  assert.equal(invalid.status,400); assert.equal(invalid.data.field,'giftFrom'); assert.equal(calls,before);
});
