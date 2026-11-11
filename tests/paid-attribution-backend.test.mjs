import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AD_EXPERIMENT, applyPaidMetadata, applyMetaTrackingMetadata, recordPaidArrival, recordMetaConsent } from '../lib/paid-attribution.js';
import { metaPurchasePayload, queueMetaPurchase, dispatchMetaPurchases, metaMeasurementAvailable } from '../lib/meta-purchase.js';
import { onRequestPost as paymentIntent } from '../functions/api/payment-intent.js';
import { onRequestPost as webhook } from '../functions/api/stripe-webhook.js';
import { onRequestGet as adConfig } from '../functions/api/ad-config.js';
import { onRequestPost as arrival } from '../functions/api/ad-attribution.js';
import metaDeliveryWorker from '../workers/meta-purchase-delivery.js';

const NOW = Math.floor(Date.now() / 1000), ORIGIN = 'http://127.0.0.1:8892', SECRET = 'whsec_meta_fixture';
const ARM_TAGS = { 'reel-a': 'av3-meta-reel-a', species: 'av3-meta-species', photo: 'av3-meta-photo' };
const click = (arm = 'reel-a', at = NOW - 10, id = 'touch0000000001') => ({ id, arm, tag: ARM_TAGS[arm], at, path: '/store/avian-visitors/' });
const attribution = (first = click(), last = first) => ({ v: 1, experiment: AD_EXPERIMENT, first, last, crossover: first.arm !== last.arm });
const context = (more = {}) => ({ consent: true, version: 'meta-v1', at: NOW - 20, fbc: `fb.1.${(NOW - 30) * 1000}.click_fixture`, ...more });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const post = (path, value, headers = {}) => new Request(ORIGIN + '/api/' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'user-agent': 'Browser fixture', ...headers }, body: JSON.stringify(value),
});
class Statement {
  constructor(db, sql, values = []) { Object.assign(this, { db, sql, values }); }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  first() { return this.db.sqlite.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: this.db.sqlite.prepare(this.sql).all(...this.values) }; }
  run() { return { meta: { changes: Number(this.db.sqlite.prepare(this.sql).run(...this.values).changes) } }; }
}
class Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    const dir = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => /^\d.*\.sql$/.test(f)).sort()) this.sqlite.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  prepare(sql) { return new Statement(this, sql); }
  withSession(consistency) { assert.equal(consistency, 'first-primary'); return this; }
  async batch(statements) { this.sqlite.exec('BEGIN'); try { const r = statements.map((s) => s.run()); this.sqlite.exec('COMMIT'); return r; } catch (e) { this.sqlite.exec('ROLLBACK'); throw e; } }
}
function setupDb(t) { const db = new Database(); t.after(() => db.sqlite.close()); return db; }
const envFor = (db, extra = {}) => ({ STORE_INVENTORY: db, PAID_ATTRIBUTION_ENABLED: '1', META_CAPI_ENABLED: '1', META_CAPI_MODE: 'preview', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: SECRET, ...extra });
const fields = (form, prior = {}) => { const result = { ...prior }; for (const [k, v] of form) { const m = /^metadata\[([^\]]+)\]$/.exec(k); if (m) { if (v) result[m[1]] = v; else delete result[m[1]]; } } return result; };
function piFixture(extra = {}) {
  const form = new URLSearchParams(); applyMetaTrackingMetadata(form, context(), post('payment-intent', {}), { now: NOW });
  return { id: 'pi_fixture', object: 'payment_intent', status: 'succeeded', livemode: false, amount: 72400, amount_received: 72400,
    currency: 'usd', metadata: { ...fields(form), anon: 'visitor0001', notified: '1' }, ...extra };
}
const success = (pi, extra = {}) => ({ id: 'evt_fixture', type: 'payment_intent.succeeded', livemode: pi.livemode, created: NOW, data: { object: pi }, ...extra });
const manifest = { v: 1, lines: [['avian-visitors', 'assembled-continuous', 1], ['avian-mic', 'printed', 2]] };

test('paid arrivals retain server receipt time, deduplicate retry and preserve first cohort across creative crossover', async (t) => {
  const db = setupDb(t), env = envFor(db), data = { anon: 'visitor0001', session: 'session0001', paidAttribution: attribution() };
  assert.deepEqual(await recordPaidArrival(env, data, { now: NOW }), { recorded: true });
  await recordPaidArrival(env, data, { now: NOW + 50 });
  const later = click('photo', NOW + 100, 'touch0000000002');
  await recordPaidArrival(env, { ...data, paidAttribution: attribution(click(), later) }, { now: NOW + 110 });
  const rows = db.sqlite.prepare('SELECT arm,received_at,client_at FROM paid_ad_arrivals ORDER BY received_at').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ arm: 'reel-a', received_at: NOW, client_at: NOW - 10 }, { arm: 'photo', received_at: NOW + 110, client_at: NOW + 100 }]);
  const invalid = attribution(); invalid.last = { ...invalid.last, tag: 'forged' };
  assert.equal((await recordPaidArrival(env, { ...data, paidAttribution: invalid }, { now: NOW })).recorded, false);
  assert.equal((await recordPaidArrival({ ...env, PAID_ATTRIBUTION_ENABLED: '0' }, data)).recorded, false);
});

test('arrival endpoint rejects cross-origin, oversized, malformed and disabled input without leaking data', async (t) => {
  const env = envFor(setupDb(t));
  const value = { anon: 'visitor0001', session: 'session0001', paidAttribution: attribution() };
  assert.equal((await arrival({ env, request: post('ad-attribution', value, { origin: 'https://evil.example' }) })).status, 403);
  assert.equal((await arrival({ env, request: post('ad-attribution', { fill: 'x'.repeat(6001) }) })).status, 413);
  assert.deepEqual(await (await arrival({ env, request: post('ad-attribution', value) })).json(), { recorded: true });
});

test('PI snapshot preserves original first arm and marks crossover even when stale client tries reenrollment', () => {
  const firstForm = new URLSearchParams(); applyPaidMetadata(firstForm, attribution(), {}, { now: NOW });
  const prior = fields(firstForm), next = new URLSearchParams(), newTouch = click('photo', NOW, 'touch0000000002');
  applyPaidMetadata(next, attribution(newTouch), prior, { now: NOW });
  const md = fields(next);
  assert.equal(JSON.parse(md.ad_first).arm, 'reel-a'); assert.equal(JSON.parse(md.ad_last).arm, 'photo'); assert.equal(md.ad_crossover, '1');
  assert.equal(prior.src, undefined); assert.ok([...next.values()].every((v) => v.length <= 500));
  const expired = new URLSearchParams(); applyPaidMetadata(expired, attribution(), prior, { now: NOW + 7 * 86400 + 1 });
  assert.equal(expired.size, 0);
});

test('matching context requires explicit current consent and browser UA; opt-out and invalid context clear prior metadata', () => {
  const accepted = new URLSearchParams(); applyMetaTrackingMetadata(accepted, context(), post('payment-intent', {}, { 'user-agent': 'Actual browser' }), { now: NOW });
  assert.equal(fields(accepted).meta_ua, 'Actual browser'); assert.equal(fields(accepted).meta_consent, 'meta-v1');
  assert.equal(fields(accepted).email, undefined);
  for (const [value, headers] of [[{ consent: false }, {}], [context(), { 'sec-gpc': '1' }], [context(), { dnt: '1' }], [context({ version: 'unknown' }), {}], [context({ fbc: 'malformed' }), {}]]) {
    const form = new URLSearchParams(); applyMetaTrackingMetadata(form, value, post('payment-intent', {}, headers), { now: NOW });
    assert.deepEqual(fields(form, fields(accepted)), {});
  }
  const absent = new URLSearchParams(); applyMetaTrackingMetadata(absent, undefined, post('payment-intent', {})); assert.equal(absent.size, 0);
});

test('Purchase payload uses one captured order value, catalog-matching IDs, real time and no contact/address/IP data', () => {
  const pi = piFixture(), payload = metaPurchasePayload(success(pi), pi, manifest, { now: NOW });
  assert.equal(payload.event_id, 'Purchase:pi_fixture'); assert.equal(payload.event_time, NOW);
  assert.equal(payload.custom_data.value, 724); assert.equal(payload.custom_data.currency, 'USD');
  assert.deepEqual(payload.custom_data.content_ids, ['avian-visitors', 'avian-mic-printed']); assert.equal(payload.custom_data.num_items, 3);
  assert.deepEqual(Object.keys(payload.user_data).sort(), ['client_user_agent', 'fbc']);
  assert.equal(payload.event_source_url, 'https://theodore.net/store/checkout/');
  for (const changed of [{ status: 'requires_capture' }, { amount_received: 0 }, { amount_received: 72000 }, { currency: 'eur' }, { metadata: {} }]) {
    const invalid = piFixture(changed); assert.equal(metaPurchasePayload(success(invalid), invalid, manifest, { now: NOW }), null);
  }
  assert.equal(metaPurchasePayload(success(pi, { created: NOW - 7 * 86400 }), pi, manifest, { now: NOW }), null);
});

test('preview queues once and never sends, including duplicates, mode mismatch and missing configuration', async (t) => {
  const db = setupDb(t), env = envFor(db), pi = piFixture(), event = success(pi), opts = { now: NOW, requestUrl: ORIGIN + '/api/stripe-webhook' };
  assert.equal((await queueMetaPurchase(env, event, pi, manifest, opts)).queued, true);
  await queueMetaPurchase(env, { ...event, id: 'evt_duplicate' }, pi, manifest, opts);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM meta_purchase_outbox').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT status FROM meta_purchase_outbox').get().status, 'preview');
  let calls = 0; assert.equal((await dispatchMetaPurchases(env, { fetch: async () => { calls++; throw new Error(); } })).disabled, true); assert.equal(calls, 0);
  assert.equal((await dispatchMetaPurchases(liveEnv(db), { now: NOW, fetch: async () => { calls++; return response({ events_received: 1 }); } })).sent, 0);
  assert.equal(calls, 0, 'switching configuration to live cannot deliver preview fixtures');
  assert.equal((await queueMetaPurchase(env, { ...event, livemode: true }, { ...pi, livemode: true }, manifest, opts)).queued, false);
  assert.equal((await queueMetaPurchase({ ...env, META_CAPI_MODE: 'live' }, event, pi, manifest, opts)).reason, 'disabled');
  assert.equal((await queueMetaPurchase(env, event, pi, manifest, { ...opts, requestUrl: 'https://preview.example/api/stripe-webhook' })).queued, false);
  assert.equal(metaMeasurementAvailable(env, post('ad-config', {})), true);
  assert.equal(metaMeasurementAvailable(env, post('ad-config', {}, { dnt: '1' })), false);
});

const liveEnv = (db) => envFor(db, { META_CAPI_MODE: 'live', META_DATASET_ID: '1234567890', META_CAPI_ACCESS_TOKEN: 'mock-only-token', STRIPE_SECRET_KEY: 'sk_live_mock_only' });
async function queueLive(db) { const env = liveEnv(db), pi = piFixture({ livemode: true }); await queueMetaPurchase(env, success(pi), pi, manifest, { now: NOW, requestUrl: 'https://theodore.net/api/stripe-webhook' }); return env; }

test('mocked delivery retries a lost acknowledgement with same event ID then scrubs context; replay stays deduplicated', async (t) => {
  const db = setupDb(t), env = await queueLive(db), attempts = [];
  const fake = async (url, options) => { const body = JSON.parse(options.body); attempts.push(body); assert.equal(url, 'https://graph.facebook.com/v27.0/1234567890/events'); assert.equal(body.test_event_code, undefined); if (attempts.length === 1) throw new Error('lost acknowledgement'); return response({ events_received: 1 }); };
  assert.equal((await dispatchMetaPurchases(env, { now: NOW, fetch: fake })).failed, 1);
  assert.equal((await dispatchMetaPurchases(env, { now: NOW + 30, fetch: fake })).sent, 0);
  assert.equal((await dispatchMetaPurchases(env, { now: NOW + 61, fetch: fake })).sent, 1);
  assert.equal(attempts[0].data[0].event_id, attempts[1].data[0].event_id);
  assert.equal(db.sqlite.prepare('SELECT payload_json FROM meta_purchase_outbox').get().payload_json, '');
  await queueLive(db); assert.equal((await dispatchMetaPurchases(env, { now: NOW + 90, fetch: fake })).sent, 0);
  assert.equal(attempts.length, 2);
});

test('mocked delivery recovers abandoned lease, excludes concurrent claims and expires original seven-day deadline', async (t) => {
  const db = setupDb(t), env = await queueLive(db);
  db.sqlite.prepare("UPDATE meta_purchase_outbox SET status='sending',lease_token='abandoned',lease_until=?").run(NOW + 100);
  let calls = 0; const fake = async () => { calls++; return response({ events_received: 1 }); };
  assert.equal((await dispatchMetaPurchases(env, { now: NOW, fetch: fake })).sent, 0);
  assert.equal((await dispatchMetaPurchases(env, { now: NOW + 101, fetch: fake })).sent, 1); assert.equal(calls, 1);
  db.sqlite.prepare("UPDATE meta_purchase_outbox SET status='queued',next_attempt_at=?,payload_json='sensitive'").run(NOW);
  assert.equal((await dispatchMetaPurchases(env, { now: NOW + 7 * 86400, fetch: fake })).expired, 1); assert.equal(calls, 1);
  assert.equal(db.sqlite.prepare('SELECT payload_json FROM meta_purchase_outbox').get().payload_json, '');
});

const CATALOG = { 'avian-visitors': { title: 'Avian Visitors', variants: { assembled: { price: 'price_frame', priceUsd: 699, maxQty: 2, weightLb: 4 } } } };
const SHIPPING = { name: 'Test Buyer', address: { country: 'US', state: 'CA', postal_code: '94107', city: 'San Francisco', line1: '1 Test St' } };
function stripeFixture(t) {
  const requests = [], intents = new Map(); let counter = 0; const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url), form = options.body instanceof URLSearchParams ? options.body : null; requests.push(target);
    if (target.endsWith('/store-catalog.json')) return response(CATALOG);
    if (target.endsWith('/prices/price_frame')) return response({ active: true, unit_amount: 69900, currency: 'usd' });
    if (target.endsWith('/tax/calculations')) return response({ id: 'taxcalc_fixture', tax_amount_exclusive: 600, currency: 'usd', amount_total: 69900 + Number(form.get('shipping_cost[amount]')) + 600 });
    if (target.endsWith('/payment_intents')) { const id = 'pi_test_' + ++counter, pi = { id, object: 'payment_intent', livemode: false, status: 'requires_payment_method', amount: Number(form.get('amount')), currency: 'usd', client_secret: id + '_secret_fixture', metadata: fields(form) }; intents.set(id, pi); return response(pi); }
    const id = /\/payment_intents\/(pi_[\w]+)$/.exec(target)?.[1];
    if (id) { const pi = intents.get(id); assert.ok(pi); if (form) { pi.metadata = fields(form, pi.metadata); if (form.has('amount')) pi.amount = Number(form.get('amount')); } return response(pi); }
    throw new Error('Unexpected external request: ' + target);
  };
  t.after(() => { globalThis.fetch = original; }); return { intents, requests };
}
async function signedWebhook(env, pi, overrides = {}, badSignature = false) {
  const event = success(pi, overrides), raw = JSON.stringify(event), time = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', SECRET).update(time + '.' + raw).digest('hex');
  return webhook({ env, request: new Request(ORIGIN + '/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${time},v1=${badSignature ? '0'.repeat(64) : signature}` }, body: raw }) });
}

test('real handler flow refreshes organic draft, freezes paid state, handles duplicate signed success and ignores refund/forgery', async (t) => {
  const db = setupDb(t), env = envFor(db), stripe = stripeFixture(t), cart = [{ id: 'avian-visitors', build: 'assembled', qty: 1 }];
  const first = await paymentIntent({ env, request: post('payment-intent', { cart, source: 'instagram', anon: 'visitor0001' }) });
  assert.equal(first.status, 200); const draft = await first.json(), pi = [...stripe.intents.values()][0];
  const update = { cart, paymentIntentId: pi.id, updateToken: draft.updateToken, shipping: SHIPPING, email: 'fixture@example.com', finalize: true, paidAttribution: attribution(), metaTracking: context() };
  assert.equal((await paymentIntent({ env, request: post('payment-intent', update) })).status, 200);
  assert.equal(pi.metadata.src, 'instagram'); assert.equal(JSON.parse(pi.metadata.ad_first).arm, 'reel-a'); assert.equal(pi.metadata.meta_ua, 'Browser fixture');
  pi.status = 'succeeded'; pi.amount_received = pi.amount; pi.metadata.notified = '1'; pi.shipping = SHIPPING;
  assert.equal((await paymentIntent({ env, request: post('payment-intent', { ...update, paidAttribution: attribution(click('photo')) }) })).status, 409);
  assert.equal((await signedWebhook(env, pi, {}, true)).status, 400);
  assert.equal((await signedWebhook(env, pi, { type: 'charge.refunded' })).status, 200);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM meta_purchase_outbox').get().n, 0);
  assert.equal((await signedWebhook(env, pi)).status, 200);
  assert.equal((await signedWebhook(env, pi, { id: 'evt_again' })).status, 200);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM meta_purchase_outbox').get().n, 1);
  assert.ok(stripe.requests.every((url) => !url.includes('facebook.com')));
});

test('explicit opt-out clears earlier unpaid matching context; ordinary missing context preserves it', async (t) => {
  const env = envFor(setupDb(t)), stripe = stripeFixture(t), cart = [{ id: 'avian-visitors', build: 'assembled', qty: 1 }];
  const draft = await (await paymentIntent({ env, request: post('payment-intent', { cart, metaTracking: context() }) })).json();
  const pi = [...stripe.intents.values()][0], update = { cart, paymentIntentId: pi.id, updateToken: draft.updateToken, shipping: SHIPPING };
  assert.equal(pi.metadata.meta_consent, 'meta-v1');
  assert.equal((await paymentIntent({ env, request: post('payment-intent', update) })).status, 200); assert.equal(pi.metadata.meta_consent, 'meta-v1');
  assert.equal((await paymentIntent({ env, request: post('payment-intent', { ...update, metaTracking: { consent: false } }) })).status, 200);
  assert.equal(pi.metadata.meta_consent, undefined); assert.equal(pi.metadata.meta_fbc, undefined); assert.equal(pi.metadata.meta_ua, undefined);
});


test('withdrawal suppresses pending consented purchases and cannot revive old context after re-opt-in', async (t) => {
  const db = setupDb(t), env = await queueLive(db);
  const denied = { anon: 'visitor0001', consent: false, version: 'meta-v1', at: NOW + 10 };
  assert.deepEqual(await recordMetaConsent(env, denied, post('ad-consent', denied), { now: NOW + 10 }), { recorded: true, allowed: false });
  assert.equal(db.sqlite.prepare('SELECT status FROM meta_purchase_outbox').get().status, 'suppressed');
  assert.equal(db.sqlite.prepare('SELECT payload_json FROM meta_purchase_outbox').get().payload_json, '');
  const optedIn = { ...denied, consent: true, at: NOW + 20 };
  await recordMetaConsent(env, optedIn, post('ad-consent', optedIn), { now: NOW + 20 });
  let calls = 0; await dispatchMetaPurchases(env, { now: NOW + 21, fetch: async () => { calls++; return response({ events_received: 1 }); } });
  assert.equal(calls, 0);
  const old = piFixture({ id: 'pi_old_context', livemode: true });
  assert.equal((await queueMetaPurchase(env, success(old, { created: NOW + 21 }), old, manifest, { now: NOW + 21, requestUrl: 'https://theodore.net/api/stripe-webhook' })).reason, 'consent_withdrawn');
  const fresh = piFixture({ id: 'pi_new_context', livemode: true }); fresh.metadata.meta_consent_at = String(NOW + 20); fresh.metadata.meta_consent_at_ms = String((NOW + 20) * 1000);
  assert.equal((await queueMetaPurchase(env, success(fresh, { created: NOW + 21 }), fresh, manifest, { now: NOW + 21, requestUrl: 'https://theodore.net/api/stripe-webhook' })).queued, true);
});

test('GPC overrides consent endpoint input and stale delayed allow cannot undo a newer choice', async (t) => {
  const db = setupDb(t), env = envFor(db);
  const value = { anon: 'visitor0001', consent: true, version: 'meta-v1', at: NOW };
  const request = post('ad-consent', value, { 'sec-gpc': '1' });
  assert.equal((await recordMetaConsent(env, value, request, { now: NOW })).allowed, false);
  assert.equal((await recordMetaConsent(env, { ...value, at: NOW - 10 }, post('ad-consent', {}), { now: NOW + 10 })).allowed, false);
});

test('a crash after Meta acceptance retries after the lease with the same stable event ID', async (t) => {
  const db = setupDb(t), env = await queueLive(db), prepare = db.prepare.bind(db), ids = [];
  db.prepare = (sql) => { if (sql.includes("status='sent'")) throw new Error('simulated post-ack storage failure'); return prepare(sql); };
  const fake = async (_url, options) => { ids.push(JSON.parse(options.body).data[0].event_id); return response({ events_received: 1 }); };
  await assert.rejects(dispatchMetaPurchases(env, { now: NOW, fetch: fake }), /post-ack/);
  db.prepare = prepare;
  assert.equal((await dispatchMetaPurchases(env, { now: NOW + 121, fetch: fake })).sent, 1);
  assert.deepEqual(ids, ['Purchase:pi_fixture', 'Purchase:pi_fixture']);
});

test('concurrent dispatchers claim one row once', async (t) => {
  const db = setupDb(t), env = await queueLive(db); let calls = 0;
  const fake = async () => { calls++; await Promise.resolve(); return response({ events_received: 1 }); };
  const summaries = await Promise.all([dispatchMetaPurchases(env, { now: NOW, fetch: fake }), dispatchMetaPurchases(env, { now: NOW, fetch: fake })]);
  assert.equal(calls, 1); assert.equal(summaries.reduce((sum, x) => sum + x.sent, 0), 1);
});

test('slow sequential delivery keeps later leases live against an overlapping dispatcher', async (t) => {
  const db = setupDb(t), env = liveEnv(db), requests = [];
  for (let i = 0; i < 15; i++) {
    const pi = piFixture({ id: 'pi_slow_' + String(i).padStart(2, '0'), livemode: true });
    await queueMetaPurchase(env, success(pi, { id: 'evt_slow_' + i }), pi, manifest,
      { now: NOW, requestUrl: 'https://theodore.net/api/stripe-webhook' });
  }
  let current = NOW, calls = 0, overlapping;
  t.mock.method(Date, 'now', () => current * 1000);
  const fake = async (_url, options) => {
    requests.push(JSON.parse(options.body).data[0]); calls++;
    if (calls === 15) {
      overlapping = await dispatchMetaPurchases(env, { fetch: async (_url, options) => {
        requests.push(JSON.parse(options.body).data[0]); return response({ events_received: 1 });
      } });
    }
    current += 9;
    return response({ events_received: 1 });
  };
  const summary = await dispatchMetaPurchases(env, { fetch: fake });
  assert.equal(requests.length, 15, 'a later claim must not inherit an already-expired batch-start lease');
  assert.equal(new Set(requests.map((event) => event.event_id)).size, 15);
  assert.equal(summary.sent, 15); assert.equal(overlapping.sent, 0);
  assert.ok(requests.every((event) => event.event_time === NOW));
  const last = db.sqlite.prepare("SELECT status,sent_at,attempts FROM meta_purchase_outbox WHERE payment_intent_id='pi_slow_14'").get();
  assert.deepEqual({ ...last }, { status: 'sent', sent_at: NOW + 135, attempts: 1 });
});

test('delivery retry backoff starts when the failed request finishes, using an advancing injected clock', async (t) => {
  const db = setupDb(t), env = await queueLive(db); let current = NOW, calls = 0;
  const options = { now: () => current, fetch: async () => {
    calls++; current += 9;
    return calls === 1 ? response({}, 503) : response({ events_received: 1 });
  } };
  assert.equal((await dispatchMetaPurchases(env, options)).failed, 1);
  assert.equal(db.sqlite.prepare('SELECT next_attempt_at FROM meta_purchase_outbox').get().next_attempt_at, NOW + 69);
  current = NOW + 60;
  assert.equal((await dispatchMetaPurchases(env, options)).sent, 0); assert.equal(calls, 1);
  current = NOW + 69;
  assert.equal((await dispatchMetaPurchases(env, options)).sent, 1); assert.equal(calls, 2);
  assert.equal(db.sqlite.prepare('SELECT sent_at FROM meta_purchase_outbox').get().sent_at, NOW + 78);
});

test('a slow batch expires later purchases at their original seven-day deadline', async (t) => {
  const db = setupDb(t), env = await queueLive(db);
  const later = piFixture({ id: 'pi_later', livemode: true });
  await queueMetaPurchase(env, success(later, { id: 'evt_later' }), later, manifest,
    { now: NOW, requestUrl: 'https://theodore.net/api/stripe-webhook' });
  let current = NOW + 7 * 86400 - 1; const events = [];
  t.mock.method(Date, 'now', () => current * 1000);
  const summary = await dispatchMetaPurchases(env, { fetch: async (_url, options) => {
    events.push(JSON.parse(options.body).data[0]); current += 2;
    return response({ events_received: 1 });
  } });
  assert.equal(events.length, 1); assert.equal(events[0].event_time, NOW);
  assert.equal(summary.sent, 1); assert.equal(summary.expired, 1);
  const expired = db.sqlite.prepare("SELECT event_time,payload_json,lease_token,lease_until,last_error FROM meta_purchase_outbox WHERE status='expired'").get();
  assert.deepEqual({ ...expired }, { event_time: NOW, payload_json: '', lease_token: null, lease_until: null, last_error: 'event_too_old' });
});

test('a delayed scheduled worker uses actual execution time instead of its scheduled timestamp', async (t) => {
  const db = setupDb(t), env = await queueLive(db); let pending;
  t.mock.method(Date, 'now', () => (NOW + 20) * 1000);
  t.mock.method(globalThis, 'fetch', async () => response({ events_received: 1 }));
  await metaDeliveryWorker.scheduled({ scheduledTime: (NOW - 300) * 1000 }, env, { waitUntil(work) { pending = work; } });
  await pending;
  const row = db.sqlite.prepare('SELECT status,event_time,sent_at FROM meta_purchase_outbox').get();
  assert.deepEqual({ ...row }, { status: 'sent', event_time: NOW, sent_at: NOW + 20 });
});

test('outbox storage failure asks Stripe to retry without changing payment or bypassing an already-sent receipt', async (t) => {
  const db = setupDb(t), env = envFor(db), stripe = stripeFixture(t), cart = [{ id: 'avian-visitors', build: 'assembled', qty: 1 }];
  const draft = await paymentIntent({ env, request: post('payment-intent', { cart, shipping: SHIPPING, email: 'fixture@example.com', anon: 'visitor0001', metaTracking: context() }) });
  assert.equal(draft.status, 200);
  const pi = [...stripe.intents.values()][0]; pi.status = 'succeeded'; pi.amount_received = pi.amount; pi.metadata.notified = '1'; pi.shipping = SHIPPING;
  const broken = { ...env, STORE_INVENTORY: { prepare() { throw new Error('storage outage'); } } };
  const pending = await signedWebhook(broken, pi); assert.equal(pending.status, 503); assert.equal((await pending.json()).blocked, 'meta_purchase_queue_pending');
  assert.equal(pi.status, 'succeeded'); assert.equal(pi.metadata.notified, '1');
  assert.equal((await signedWebhook(env, pi)).status, 200);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM meta_purchase_outbox').get().n, 1);
});

test('a delayed purchase drops a stale click identifier and can retain a fresh genuine browser identifier', () => {
  const pi = piFixture(); pi.metadata.meta_fbc = `fb.1.${(NOW - 7 * 86400 - 1) * 1000}.old_click`;
  assert.equal(metaPurchasePayload(success(pi), pi, manifest, { now: NOW }), null);
  pi.metadata.meta_fbp = `fb.1.${(NOW - 10) * 1000}.123456`;
  const payload = metaPurchasePayload(success(pi), pi, manifest, { now: NOW });
  assert.equal(payload.user_data.fbc, undefined); assert.equal(payload.user_data.fbp, pi.metadata.meta_fbp);
});

test('same-second withdrawal and later re-opt-in are ordered by milliseconds; stale retries do not revive old consent', async (t) => {
  const db = setupDb(t), env = liveEnv(db);
  const denied = { anon: 'visitor0001', consent: false, version: 'meta-v1', at: NOW, atMs: NOW * 1000 + 100 };
  const allowed = { ...denied, consent: true, atMs: NOW * 1000 + 101 };
  assert.equal((await recordMetaConsent(env, denied, post('ad-consent', denied), { now: NOW })).allowed, false);
  assert.equal((await recordMetaConsent(env, allowed, post('ad-consent', allowed), { now: NOW })).allowed, true);
  assert.equal((await recordMetaConsent(env, denied, post('ad-consent', denied), { now: NOW + 10 })).allowed, true);
  const pi = piFixture({ livemode: true }); pi.metadata.meta_consent_at = String(NOW); pi.metadata.meta_consent_at_ms = String(allowed.atMs);
  assert.equal((await queueMetaPurchase(env, success(pi), pi, manifest, { now: NOW, requestUrl: 'https://theodore.net/api/stripe-webhook' })).queued, true);
  const old = piFixture({ id: 'pi_old_same_second', livemode: true }); old.metadata.meta_consent_at = String(NOW); old.metadata.meta_consent_at_ms = String(denied.atMs);
  assert.equal((await queueMetaPurchase(env, success(old), old, manifest, { now: NOW, requestUrl: 'https://theodore.net/api/stripe-webhook' })).reason, 'consent_withdrawn');
  const tiedDenial = { ...allowed, consent: false };
  assert.equal((await recordMetaConsent(env, tiedDenial, post('ad-consent', tiedDenial), { now: NOW })).allowed, false);
  assert.equal((await recordMetaConsent(env, allowed, post('ad-consent', allowed), { now: NOW })).allowed, false);
  assert.equal((await recordMetaConsent(env, { ...allowed, atMs: (NOW + 1) * 1000 }, post('ad-consent', {}), { now: NOW })).recorded, false);
});

test('header-only privacy signals are exposed to the client and override even a newer stored allow', async (t) => {
  const db = setupDb(t), env = envFor(db);
  const allowed = { anon: 'visitor0001', consent: true, version: 'meta-v1', at: NOW, atMs: NOW * 1000 + 100 };
  await recordMetaConsent(env, allowed, post('ad-consent', allowed), { now: NOW });
  for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }]) {
    const request = post('ad-config', {}, headers), result = await adConfig({ env, request });
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await result.json(), { metaMeasurementEnabled: false, metaBrowserEventsEnabled: false, metaPixelId: '', privacyOptOut: true });
    assert.equal((await recordMetaConsent(env, { ...allowed, atMs: NOW * 1000 + 50 }, request, { now: NOW })).allowed, false);
  }
});

test('expanded consent preserves its version through acknowledged choice and server-only Purchase', async (t) => {
  const db = setupDb(t), env = envFor(db), input = { anon: 'visitor0001', ...context({ version: 'meta-v2' }) };
  const result = await recordMetaConsent(env, input, post('ad-consent', input), { now: NOW });
  assert.deepEqual(result, { recorded: true, allowed: true });
  const form = new URLSearchParams();
  applyMetaTrackingMetadata(form, input, post('payment-intent', {}, { 'user-agent': 'Actual browser' }), { now: NOW });
  assert.equal(fields(form).meta_consent, 'meta-v2');
  const pi = piFixture({ metadata: { ...piFixture().metadata, ...fields(form) } });
  const payload = metaPurchasePayload(success(pi), pi, manifest, { now: NOW });
  assert.equal(payload.event_id, 'Purchase:pi_fixture'); assert.equal(payload.event_name, 'Purchase');
  assert.equal(metaPurchasePayload(success(pi), { ...pi, metadata: { ...pi.metadata, meta_consent: 'meta-v3' } }, manifest, { now: NOW }), null);
});

test('browser config requires its own flag, reveals no secret and never gives a live Pixel to preview', async (t) => {
  const db = setupDb(t), request = new Request('https://theodore.net/api/ad-config');
  const read = async (env, req = request) => (await adConfig({ env, request: req })).json();
  const off = await read(liveEnv(db));
  assert.equal(off.metaMeasurementEnabled, true); assert.equal(off.metaBrowserEventsEnabled, false); assert.equal(off.metaPixelId, '');
  const live = await read({ ...liveEnv(db), META_PIXEL_ENABLED: '1' });
  assert.deepEqual(live, { metaMeasurementEnabled: true, metaBrowserEventsEnabled: true, metaPixelId: '1234567890', privacyOptOut: false });
  assert.equal(JSON.stringify(live).includes('mock-only-token'), false);
  const preview = await read({ ...envFor(db), META_PIXEL_ENABLED: '1' }, new Request(ORIGIN + '/api/ad-config'));
  assert.equal(preview.metaBrowserEventsEnabled, true); assert.equal(preview.metaPixelId, '');
  const optedOut = await read({ ...liveEnv(db), META_PIXEL_ENABLED: '1' }, new Request(request, { headers: { 'sec-gpc': '1' } }));
  assert.equal(optedOut.metaBrowserEventsEnabled, false); assert.equal(optedOut.metaPixelId, '');
  const staging = await read({ ...liveEnv(db), META_PIXEL_ENABLED: '1' }, new Request('https://preview.example/api/ad-config'));
  assert.equal(staging.metaBrowserEventsEnabled, false); assert.equal(staging.metaPixelId, '');
});
