import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../docs/assets/js/meta-tracking.js', import.meta.url), 'utf8');
const SECOND = 1794340000, KEY = 'theodore:meta-choice:v1', CLICK = 'theodore:meta-click:v1';
async function harness({ enabled = true, privacyOptOut = false, respond, choice, storedClick, click = { fbclid: 'Real_Click-123', at: SECOND, path: '/store/avian-visitors/' }, navigator = {}, brokenStorage = false, cookie = '' } = {}) {
  const data = new Map(choice ? [[KEY, JSON.stringify(choice)]] : []), events = {}, panels = [];
  data.set('tev_aid', 'anonymous-test-browser');
  if (storedClick) data.set(CLICK, JSON.stringify(storedClick));
  const status = { textContent: '' }, requests = []; let time = SECOND * 1000;
  const document = {
    cookie, readyState: 'complete', getElementById: () => status,
    addEventListener(name, fn) { events['document:' + name] = fn; },
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    body: { appendChild(panel) { panels.push(panel); } },
    createElement() { return { offsetHeight: 100, setAttribute() {}, addEventListener(name, fn) { this[name] = fn; }, remove() { this.removed = true; } }; }
  };
  const window = {
    TheodorePaidAttribution: { clickContext: () => click, snapshot: () => click ? { first: {} } : null },
    addEventListener(name, fn) { events[name] = fn; }, dispatchEvent(event) { if (events[event.type]) events[event.type](event); }
  };
  class Clock extends Date { static now() { return time; } }
  vm.runInNewContext(source, { document, window, navigator, location: { pathname: '/store/avian-visitors/' },
    localStorage: { getItem(key) { if (brokenStorage) throw Error(); return data.get(key) || null; }, setItem(key, val) { if (brokenStorage) throw Error(); data.set(key, val); }, removeItem(key) { data.delete(key); } },
    sessionStorage: { getItem: () => 'anonymous-test-session' },
    Date: Clock, CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : null; requests.push({ url, body });
      if (respond) { const response = await respond(url, body); if (response) return response; }
      return { ok: true, json: async () => url === '/api/ad-consent' ? { recorded: true, allowed: body.consent } : { metaMeasurementEnabled: enabled, privacyOptOut } };
    }
  });
  await new Promise(setImmediate);
  return { data, panels, requests, setTime(value) { time = value; }, event(name, value = {}) { events[name]?.(value); }, context: (anon) => JSON.parse(JSON.stringify(window.TheodoreMetaTracking.context(anon))),
    async choose(value) { panels.at(-1).click({ target: { closest: () => ({ getAttribute: () => value }) } }); await new Promise(setImmediate); },
    reopen() { events['document:click']({ target: { closest: () => ({ getAttribute: () => 'choose' }) } }); },
    revoke() { events['document:click']({ target: { closest: () => ({ getAttribute: () => 'off' }) } }); }, status };
}
test('no sharing or click storage before choice; opt-in preserves real click time', async () => {
  const h = await harness();
  assert.equal(h.context().consent, false); assert.equal(h.data.has(CLICK), false);
  await h.choose('yes');
  assert.deepEqual(h.context(), { consent: true, version: 'meta-v1', at: SECOND, atMs: SECOND * 1000, fbc: `fb.1.${SECOND * 1000}.Real_Click-123` });
  assert.equal(h.panels[0].removed, true);
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
  assert.equal(h.context().consent, false); assert.equal(h.panels.length, 1);
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
  assert.equal(h.context().consent, false); assert.equal(h.panels.length, 1);
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
