import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../docs/assets/js/meta-tracking.js', import.meta.url), 'utf8');
const SECOND = 1794340000, KEY = 'theodore:meta-choice:v1', CLICK = 'theodore:meta-click:v1';
async function harness({ enabled = true, privacyOptOut = false, browserEvents = false, pixelId = '1234567890',
  url = 'https://theodore.net/store/avian-visitors/', referrer = '', respond, choice, storedClick,
  click = { fbclid: 'Real_Click-123', at: SECOND, path: '/store/avian-visitors/' }, navigator = {}, brokenStorage = false, cookie = '' } = {}) {
  const data = new Map(choice ? [[KEY, JSON.stringify(choice)]] : []), events = {}, panels = [];
  data.set('tev_aid', 'anonymous-test-browser');
  if (storedClick) data.set(CLICK, JSON.stringify(storedClick));
  const status = { textContent: '' }, metaToggle = { checked: false, disabled: false, getAttribute: () => 'meta' },
    retry = { hidden: true, disabled: false }, analyticsToggle = {}, analyticsStatus = { textContent: '' }, requests = [], scripts = []; let time = SECOND * 1000;
  const fields = { 'ad-measurement-status': status, 'cookie-meta': metaToggle, 'cookie-meta-retry': retry,
    'cookie-analytics': analyticsToggle, 'cookie-analytics-status': analyticsStatus };
  const document = {
    cookie, referrer, readyState: 'complete', getElementById: (id) => fields[id] || null,
    addEventListener(name, fn) { events['document:' + name] = fn; },
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    body: { appendChild(panel) { panels.push(panel); } },
    head: { appendChild(script) { scripts.push(script); } },
    createElement() { return { offsetHeight: 100, setAttribute() {}, addEventListener(name, fn) { this[name] = fn; }, remove() { this.removed = true; } }; }
  };
  const window = {
    STORE_PRODUCTS: [{ id: 'avian-visitors', published: true, project: '/projects/AvianVisitors/' }],
    TheodorePaidAttribution: { clickContext: () => click, snapshot: () => click ? { first: {} } : null },
    addEventListener(name, fn) { events[name] = fn; }, dispatchEvent(event) { if (events[event.type]) events[event.type](event); }
  };
  class Clock extends Date { static now() { return time; } }
  vm.runInNewContext(source, { document, window, navigator, location: new URL(url), URL,
    localStorage: { getItem(key) { if (brokenStorage) throw Error(); return data.get(key) || null; }, setItem(key, val) { if (brokenStorage) throw Error(); data.set(key, val); }, removeItem(key) { data.delete(key); } },
    sessionStorage: { getItem: () => 'anonymous-test-session' },
    Date: Clock, CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : null; requests.push({ url, body });
      if (respond) { const response = await respond(url, body); if (response) return response; }
      return { ok: true, json: async () => url === '/api/ad-consent' ? { recorded: true, allowed: body.consent } : { metaMeasurementEnabled: enabled, privacyOptOut, metaBrowserEventsEnabled: browserEvents, metaPixelId: pixelId } };
    }
  });
  await new Promise(setImmediate);
  return { data, panels, requests, scripts, navigator, metaToggle, retry, calls: () => JSON.parse(JSON.stringify((window.fbq?.queue || []).map((args) => Array.from(args)))),
    checkout(items) { window.TheodoreMetaTracking.checkoutEvent(items); },
    loadPixel() { scripts.at(-1)?.onload(); }, item(name, value) { window.TheodoreMetaTracking.itemEvent(name, value); },
    setTime(value) { time = value; }, event(name, value = {}) { events[name]?.(value); }, context: (anon) => JSON.parse(JSON.stringify(window.TheodoreMetaTracking.context(anon))),
    async choose(value) { metaToggle.checked = value === 'yes'; events['document:change']?.({ target: { closest: () => metaToggle } }); await new Promise(setImmediate); },
    async retryChoice() { events['document:click']?.({ target: { closest: () => retry } }); await new Promise(setImmediate); },
    revoke() { metaToggle.checked = false; events['document:change']?.({ target: { closest: () => metaToggle } }); }, status };
}
test('no sharing or click storage before choice; opt-in preserves real click time', async () => {
  const h = await harness();
  assert.equal(h.context().consent, false); assert.equal(h.data.has(CLICK), false);
  await h.choose('yes');
  assert.deepEqual(h.context(), { consent: true, version: 'meta-v2', at: SECOND, atMs: SECOND * 1000, fbc: `fb.1.${SECOND * 1000}.Real_Click-123` });
  assert.equal(h.panels.length, 0); assert.equal(h.metaToggle.checked, true);
});
test('decline and later revocation clear matching data without preventing checkout', async () => {
  const h = await harness(); await h.choose('yes'); h.context(); h.revoke();
  assert.equal(h.context().consent, false); assert.equal(h.data.has(CLICK), false);
  const denied = await harness(); await denied.choose('no'); assert.equal(denied.context().consent, false);
});
test('disabled server and browser privacy signals override earlier opt-in', async () => {
  const choice = { allowed: true, version: 'meta-v1', at: SECOND };
  for (const options of [{ enabled: false }, { navigator: { globalPrivacyControl: true } }, { navigator: { doNotTrack: '1' } }]) {
    const h = await harness({ ...options, choice }); assert.equal(h.context().consent, false); assert.equal(h.panels.length, 0);
  }
});
test('expired consent requires a new choice and identifiers are never invented', async () => {
  const h = await harness({ choice: { allowed: true, version: 'meta-v1', at: SECOND - 91 * 86400 } });
  assert.equal(h.context().consent, false); assert.equal(h.panels.length, 0);
  const noClick = await harness({ choice: { allowed: true, version: 'meta-v1', at: SECOND }, click: null });
  assert.deepEqual(noClick.context(), { consent: true, version: 'meta-v1', at: SECOND, atMs: SECOND * 1000 });
});
test('stored choice can work in memory when storage is blocked; malformed cookies stay excluded', async () => {
  const h = await harness({ brokenStorage: true, cookie: '_fbp=bad; _fbc=bad' }); await h.choose('yes');
  assert.equal(h.context().consent, true); assert.equal(h.context().fbp, undefined);
  const old = await harness({ choice: { allowed: true, version: 'meta-v1', at: SECOND }, click: null,
    cookie: `_fbc=fb.1.${(SECOND - 8 * 86400) * 1000}.old; _fbp=fb.1.${SECOND * 1000}.123` });
  assert.equal(old.context().fbc, undefined); assert.ok(old.context().fbp);
});


test('server-only privacy signal withdraws a prior opt-in even without a navigator signal', async () => {
  const h = await harness({ privacyOptOut: true, enabled: false, choice: { allowed: true, version: 'meta-v1', at: SECOND - 1,
    anon: 'anonymous-test-browser', acknowledged: true } });
  assert.equal(h.context().consent, false);
  const withdrawal = h.requests.find((r) => r.url === '/api/ad-consent');
  assert.equal(withdrawal.body.consent, false); assert.equal(withdrawal.body.anon, 'anonymous-test-browser');
  assert.equal(h.panels.length, 0); assert.match(h.status.textContent, /privacy preference/);
});

test('acknowledgment is bound to its anonymous identity; revocation still targets that identity after rotation', async () => {
  const h = await harness(); await h.choose('yes');
  assert.equal(h.context().consent, true);
  h.data.set('tev_aid', 'different-browser-identity');
  assert.equal(h.context('different-browser-identity').consent, false);
  h.revoke(); await new Promise(setImmediate);
  const withdrawal = h.requests.filter((r) => r.url === '/api/ad-consent').at(-1);
  assert.equal(withdrawal.body.consent, false); assert.equal(withdrawal.body.anon, 'anonymous-test-browser');
  assert.equal(h.context().consent, false);
});

test('delayed opt-in acknowledgment cannot override a newer denial and never blocks context reads', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = await harness({ respond(url, body) { if (url === '/api/ad-consent' && body.consent) return gate; } });
  await h.choose('yes'); assert.equal(h.context().consent, false);
  h.setTime(SECOND * 1000 + 1); h.revoke(); assert.equal(h.context().consent, false);
  release({ ok: true, json: async () => ({ recorded: true, allowed: true }) });
  await new Promise(setImmediate);
  assert.equal(h.context().consent, false);
  const choices = h.requests.filter((r) => r.url === '/api/ad-consent');
  assert.equal(choices.length, 2); assert.equal(choices[0].body.at, choices[1].body.at);
  assert.equal(choices[1].body.atMs, choices[0].body.atMs + 1); assert.equal(choices[1].body.consent, false);
});

test('failed consent delivery retries on reconnect while sharing remains off', async () => {
  let offline = true;
  const h = await harness({ respond(url) { if (url === '/api/ad-consent' && offline) throw new Error('offline'); } });
  await h.choose('yes'); assert.equal(h.context().consent, false);
  await new Promise(setImmediate); offline = false; h.event('online'); await new Promise(setImmediate);
  assert.equal(h.context().consent, true);
  assert.ok(h.requests.filter((r) => r.url === '/api/ad-consent').length >= 2);
});

test('malformed stored truthy consent never enables sharing', async () => {
  const h = await harness({ choice: { allowed: 'false', acknowledged: true, anon: 'anonymous-test-browser', version: 'meta-v1', at: SECOND } });
  assert.equal(h.context().consent, false); assert.equal(h.panels.length, 0);
  assert.equal(h.requests.some((r) => r.url === '/api/ad-consent'), false);
});

test('an old acknowledgment without identity is rechecked rather than trusted', async () => {
  const h = await harness({ choice: { allowed: true, acknowledged: true, version: 'meta-v1', at: SECOND } });
  assert.equal(h.requests.filter((r) => r.url === '/api/ad-consent').length, 1);
  assert.equal(JSON.parse(h.data.get(KEY)).anon, 'anonymous-test-browser');
  assert.equal(h.context().consent, true);
});


test('an older open tab does not overwrite the newer consented ad click from another tab', async () => {
  const newer = `fb.1.${(SECOND - 1) * 1000}.Newer_Click`;
  const h = await harness({ choice: { allowed: true, version: 'meta-v1', at: SECOND - 100,
    anon: 'anonymous-test-browser', acknowledged: true }, storedClick: { fbc: newer },
    click: { fbclid: 'Older_Click', at: SECOND - 10, path: '/store/avian-visitors/' } });
  assert.equal(h.context().fbc, newer);
  assert.equal(JSON.parse(h.data.get(CLICK)).fbc, newer);
});

const frame = { id: 'avian-visitors', quantity: 1, value: 699 };
const pixelEvents = (h) => h.calls().filter((call) => call[0] === 'trackSingle');
const accepted = (version = 'meta-v2') => ({ allowed: true, version, at: SECOND - 10,
  anon: 'anonymous-test-browser', acknowledged: true });

test('Pixel waits for expanded opt-in and load; sends only current view and subsequent cart additions', async () => {
  const h = await harness({ browserEvents: true, click: null });
  h.item('ViewContent', frame); h.item('AddToCart', frame);
  assert.equal(h.panels.length, 0, 'store visits do not show an automatic prompt');
  assert.equal(h.scripts.length, 0);
  await h.choose('yes');
  assert.equal(h.scripts.length, 1); assert.equal(pixelEvents(h).length, 0);
  assert.equal(h.scripts[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  assert.equal(h.scripts[0].referrerPolicy, 'no-referrer');
  h.loadPixel();
  assert.deepEqual(h.calls().slice(0, 4), [['consent', 'revoke'], ['set', 'autoConfig', false, '1234567890'], ['init', '1234567890'], ['consent', 'grant']]);
  assert.deepEqual(pixelEvents(h).map((call) => call[2]), ['PageView', 'ViewContent']);
  h.item('AddToCart', { ...frame, email: 'never@example.com', address: 'not transmitted' });
  const added = pixelEvents(h).at(-1);
  assert.deepEqual(added, ['trackSingle', '1234567890', 'AddToCart', {
    content_type: 'product', content_ids: ['avian-visitors'], contents: [{ id: 'avian-visitors', quantity: 1 }], currency: 'USD', value: 699,
  }]);
  h.context(); h.item('ViewContent', frame);
  assert.equal(pixelEvents(h).length, 3, 'no duplicate view from re-render or context reads');
  assert.equal(pixelEvents(h).some((call) => call[2] === 'Purchase'), false);
});

test('v1 opt-in stays purchase-only until a fresh choice; previous denial is respected', async () => {
  const h = await harness({ browserEvents: true, choice: accepted('meta-v1'), click: null });
  assert.equal(h.context().version, 'meta-v1'); assert.equal(h.context().consent, true);
  assert.equal(h.scripts.length, 0); assert.equal(h.panels.length, 0);
  assert.equal(h.requests.some((r) => r.url === '/api/ad-consent'), false, 'no silent server consent upgrade');
  await h.choose('yes');
  assert.equal(h.context().version, 'meta-v2'); assert.equal(h.scripts.length, 1);
  assert.equal(h.requests.find((r) => r.url === '/api/ad-consent').body.version, 'meta-v2');
  const denied = await harness({ browserEvents: true, choice: { ...accepted('meta-v1'), allowed: false }, click: null });
  assert.equal(denied.panels.length, 0); assert.equal(denied.scripts.length, 0);
});

test('a variant switch before consent replaces the pending view rather than replaying its history', async () => {
  const h = await harness({ browserEvents: true });
  h.item('ViewContent', { id: 'avian-mic-electronics', quantity: 1, value: 50 });
  h.item('ViewContent', { id: 'avian-mic-electronics-printed', quantity: 1, value: 60 });
  await h.choose('yes'); h.loadPixel();
  const views = pixelEvents(h).filter((event) => event[2] === 'ViewContent');
  assert.equal(views.length, 1); assert.deepEqual(views[0][3].content_ids, ['avian-mic-electronics-printed']);
  assert.equal(views[0][3].value, 60);
});

test('no browser script until the server acknowledges expanded consent', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const h = await harness({ browserEvents: true, respond(url) { if (url === '/api/ad-consent') return pending; } });
  await h.choose('yes'); assert.equal(h.scripts.length, 0);
  release({ ok: true, json: async () => ({ recorded: true, allowed: true }) });
  await new Promise(setImmediate); assert.equal(h.scripts.length, 1);
});

test('revoking while Pixel loads discards events and never initializes or grants on completion', async () => {
  const h = await harness({ browserEvents: true }); await h.choose('yes');
  h.item('AddToCart', frame); h.revoke(); h.loadPixel();
  assert.equal(pixelEvents(h).length, 0);
  assert.equal(h.calls().some((call) => call[0] === 'init' || call[1] === 'grant'), false);
});

test('cross-tab revocation and newly enabled privacy signals stop further Pixel events', async () => {
  const h = await harness({ browserEvents: true, choice: accepted() }); h.loadPixel();
  const before = pixelEvents(h).length;
  h.data.set(KEY, JSON.stringify({ ...accepted(), allowed: false, at: SECOND }));
  h.event('storage', { key: KEY }); h.item('AddToCart', frame);
  assert.equal(pixelEvents(h).length, before); assert.deepEqual(h.calls().at(-1), ['consent', 'revoke']);
  const gpc = await harness({ browserEvents: true, choice: accepted() }); gpc.loadPixel();
  const count = pixelEvents(gpc).length;
  gpc.navigator.globalPrivacyControl = true; gpc.context(); gpc.item('AddToCart', frame);
  assert.equal(pixelEvents(gpc).length, count); assert.equal(gpc.context().consent, false);
});

test('Pixel never loads on payment, private query, unsafe referrer, preview or disabled pages', async () => {
  for (const options of [
    { url: 'https://theodore.net/store/checkout/' },
    { url: 'https://theodore.net/store/confirmation/?payment_intent_client_secret=secret' },
    { url: 'https://theodore.net/privacy/' },
    { url: 'https://theodore.net/store/?restore=private_token' },
    { url: 'https://theodore.net/store/avian-visitors/?email=private@example.com' },
    { url: 'https://theodore.net/store/#private_token' },
    { referrer: 'https://theodore.net/store/confirmation/?payment_intent_client_secret=secret' },
    { referrer: 'https://theodore.net/private/customer-token/' },
    { referrer: 'https://external.example/profiles/customer-name/' },
    { url: 'http://127.0.0.1:8766/store/' },
    { browserEvents: false }, { pixelId: '' }, { privacyOptOut: true }, { navigator: { doNotTrack: '1' } },
  ]) {
    const h = await harness({ browserEvents: true, choice: accepted(), ...options });
    h.item('ViewContent', frame); h.item('AddToCart', frame);
    assert.equal(h.scripts.length, 0, JSON.stringify(options));
  }
  const safe = await harness({ browserEvents: true, choice: accepted(),
    referrer: 'https://theodore.net/projects/AvianVisitors/',
    url: 'https://theodore.net/store/avian-visitors/?fbclid=Real_123&utm_source=instagram&variant=assembled-continuous' });
  assert.equal(safe.scripts.length, 1);
});

test('invalid event values and unrecognized event types cannot reach Pixel', async () => {
  const h = await harness({ browserEvents: true, choice: accepted() }); h.loadPixel();
  for (const value of [{ ...frame, id: 'private@example.com' }, { ...frame, quantity: 0 },
    { ...frame, quantity: 1.5 }, { ...frame, value: NaN }, { ...frame, value: -1 }]) h.item('AddToCart', value);
  h.item('Purchase', frame); h.item('Lead', frame);
  assert.deepEqual(pixelEvents(h).map((call) => call[2]), ['PageView']);
});


test('current paid landing and tagged referrer URLs permit Pixel only after expanded consent', async () => {
  const tags = ['reel-a', 'species', 'photo'];
  for (const tag of tags) {
    const url = `https://theodore.net/store/avian-visitors/?go=av3-meta-${tag}&utm_source=instagram&utm_medium=paid_social&utm_campaign=av-meta-nov26-v1&utm_content=${tag}&ad_id=120249657837420578&adset_id=120249657837410578&campaign_id=120249657837400578&fbclid=Real_Click-123`;
    const h = await harness({ browserEvents: true, choice: accepted(), url });
    assert.equal(h.scripts.length, 1, tag);
    const next = await harness({ browserEvents: true, choice: accepted(), url: 'https://theodore.net/store/?cart=open', referrer: url });
    assert.equal(next.scripts.length, 1, 'public cart route following a tagged product page');
  }
  for (const query of ['go=private-token', 'cart=private-token', 'cart=open&restore=private-token']) {
    const h = await harness({ browserEvents: true, choice: accepted(), url: 'https://theodore.net/store/?' + query });
    assert.equal(h.scripts.length, 0, query);
  }
});

test('checkout starts send catalog items only after acknowledged v2 consent and never replay earlier clicks', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const h = await harness({ browserEvents: true, respond(url) { if (url === '/api/ad-consent') return pending; } });
  h.checkout([frame]); await h.choose('yes'); h.checkout([frame]);
  assert.equal(h.scripts.length, 0);
  release({ ok: true, json: async () => ({ recorded: true, allowed: true }) });
  await new Promise(setImmediate); h.loadPixel();
  assert.deepEqual(pixelEvents(h).map((event) => event[2]), ['PageView']);
  h.checkout([{ ...frame, quantity: 2, value: 1398, email: 'never@example.com' },
    { id: 'avian-mic-electronics-printed', quantity: 1, value: 60, token: 'private' }]);
  assert.deepEqual(pixelEvents(h).at(-1), ['trackSingle', '1234567890', 'InitiateCheckout', {
    content_type: 'product', content_ids: ['avian-visitors', 'avian-mic-electronics-printed'],
    contents: [{ id: 'avian-visitors', quantity: 2 }, { id: 'avian-mic-electronics-printed', quantity: 1 }],
    currency: 'USD', value: 1458, num_items: 3,
  }]);
  const count = pixelEvents(h).length;
  for (const invalid of [[], null, [frame, { ...frame, quantity: 0 }], [{ ...frame, value: NaN }]]) h.checkout(invalid);
  h.item('Purchase', frame); h.revoke(); h.checkout([frame]);
  assert.equal(pixelEvents(h).length, count);
});

test('checkout starts obey v1, privacy, withdrawal during load and private route exclusions', async () => {
  for (const options of [{ choice: accepted('meta-v1') }, { choice: undefined },
    { navigator: { globalPrivacyControl: true } }, { navigator: { doNotTrack: '1' } },
    { url: 'https://theodore.net/store/checkout/' },
    { url: 'https://theodore.net/store/?restore=private-token' }]) {
    const h = await harness({ browserEvents: true, choice: accepted(), ...options });
    h.checkout([frame]); h.loadPixel();
    assert.equal(h.scripts.length, 0); assert.equal(pixelEvents(h).length, 0);
  }
  const h = await harness({ browserEvents: true, choice: accepted() });
  h.checkout([frame]); h.revoke(); h.loadPixel();
  assert.equal(pixelEvents(h).length, 0);
});


test('the same consented fbclid preserves its stored creation time instead of renewing the seven-day window', async () => {
  const originalAt = SECOND - 6 * 86400;
  const fbc = `fb.1.${originalAt * 1000}.Same_Click.with-dots`;
  for (const incomingAt of [SECOND, originalAt - 10]) {
    const h = await harness({ choice: accepted(), storedClick: { fbc },
      click: { fbclid: 'Same_Click.with-dots', at: incomingAt, path: '/store/avian-visitors/' } });
    assert.equal(h.context().fbc, fbc);
    assert.equal(JSON.parse(h.data.get(CLICK)).fbc, fbc);
    h.setTime((originalAt + 7 * 86400 + 1) * 1000);
    assert.equal(h.context().fbc, undefined);
    assert.equal(h.context().fbc, undefined, 'repeated context reads cannot resurrect the same arrival');
    assert.equal(h.data.has(CLICK), false, 'expired matching data keeps the existing deletion policy');
  }
});

test('an already-expired stored fbclid is not renewed, while a genuinely different later click updates matching', async () => {
  const originalAt = SECOND - 8 * 86400;
  const click = { fbclid: 'Same_Click', at: SECOND, path: '/store/avian-visitors/' };
  const h = await harness({ choice: accepted(), storedClick: { fbc: `fb.1.${originalAt * 1000}.Same_Click` }, click });
  assert.equal(h.context().fbc, undefined);
  assert.equal(h.context().fbc, undefined);
  assert.equal(h.data.has(CLICK), false);
  click.fbclid = 'Different_Click';
  assert.equal(h.context().fbc, `fb.1.${SECOND * 1000}.Different_Click`);
});


test('privacy controls show pending acknowledgement, confirmed status and persistent choice without a banner', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = await harness({ browserEvents: true, url: 'https://theodore.net/privacy/',
    respond(url) { if (url === '/api/ad-consent') return gate; } });
  assert.equal(h.panels.length, 0); assert.equal(h.metaToggle.checked, false);
  await h.choose('yes');
  assert.equal(h.metaToggle.checked, true); assert.match(h.status.textContent, /Saving/);
  assert.equal(h.context().consent, false); assert.equal(h.scripts.length, 0);
  release({ ok: true, json: async () => ({ recorded: true, allowed: true }) });
  await new Promise(setImmediate);
  assert.equal(h.status.textContent, 'On'); assert.equal(h.context().consent, true);
  const reload = await harness({ url: 'https://theodore.net/privacy/', choice: JSON.parse(h.data.get(KEY)) });
  assert.equal(reload.metaToggle.checked, true); assert.equal(reload.scripts.length, 0);
});

test('privacy controls explain unavailable and browser-blocked states instead of leaving a dead change button', async () => {
  for (const options of [{ enabled: false }, { privacyOptOut: true }, { navigator: { globalPrivacyControl: true } }, { navigator: { doNotTrack: '1' } }]) {
    const h = await harness({ url: 'https://theodore.net/privacy/', ...options });
    assert.equal(h.metaToggle.disabled, true);
    assert.match(h.status.textContent, options.enabled === false ? /not enabled/ : /browser privacy preference/);
    await h.choose('yes'); assert.equal(h.context().consent, false); assert.equal(h.metaToggle.checked, false);
    assert.equal(h.requests.some((r) => r.url === '/api/ad-consent' && r.body.consent), false);
  }
});

test('failed configuration and consent saves have working inline retries', async () => {
  let configFails = true;
  const config = await harness({ url: 'https://theodore.net/privacy/', respond(url) {
    if (url === '/api/ad-config' && configFails) throw Error('offline');
  } });
  assert.equal(config.metaToggle.disabled, true); assert.equal(config.retry.hidden, false);
  assert.match(config.status.textContent, /Could not load/);
  configFails = false; await config.retryChoice();
  assert.equal(config.metaToggle.disabled, false); assert.equal(config.retry.hidden, true);
  let saveFails = true;
  const save = await harness({ url: 'https://theodore.net/privacy/', respond(url) {
    if (url === '/api/ad-consent' && saveFails) throw Error('offline');
  } });
  await save.choose('yes'); assert.equal(save.context().consent, false);
  await new Promise(setImmediate); assert.match(save.status.textContent, /Could not save/); assert.equal(save.retry.hidden, false);
  saveFails = false; await save.retryChoice();
  assert.equal(save.context().consent, true); assert.equal(save.status.textContent, 'On');
  saveFails = true; save.revoke(); await new Promise(setImmediate);
  assert.equal(save.context().consent, false); assert.match(save.status.textContent, /Off.*retry/i);
});

test('legacy purchase-only permission is visible and never silently upgraded on Privacy', async () => {
  const h = await harness({ url: 'https://theodore.net/privacy/', browserEvents: true, choice: accepted('meta-v1') });
  assert.equal(h.metaToggle.checked, true); assert.equal(h.status.textContent, 'Purchases only');
  assert.equal(h.context().version, 'meta-v1'); assert.equal(h.requests.some((r) => r.url === '/api/ad-consent'), false);
  h.revoke(); await new Promise(setImmediate); await h.choose('yes');
  assert.equal(h.context().version, 'meta-v2'); assert.equal(h.scripts.length, 0);
});

test('Privacy opt-in works on the next public store page without loading Pixel on Privacy', async () => {
  const privacy = await harness({ browserEvents: true, url: 'https://theodore.net/privacy/' });
  await privacy.choose('yes');
  assert.equal(privacy.scripts.length, 0);
  const choice = JSON.parse(privacy.data.get(KEY));
  const store = await harness({ browserEvents: true, choice, referrer: 'https://theodore.net/privacy/' });
  assert.equal(store.scripts.length, 1);
  for (const referrer of ['https://external.example/privacy/', 'https://theodore.net/privacy/?email=private@example.com']) {
    const unsafe = await harness({ browserEvents: true, choice, referrer });
    assert.equal(unsafe.scripts.length, 0);
  }
});
