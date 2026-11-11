import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const template = readFileSync(new URL('../overrides/partials/integrations/analytics/google.html', import.meta.url), 'utf8');
const KEY = 'theodore_analytics_preference_v1', NOW = 1794435000000, TTL = 90 * 86400000;
const preference = (allowed, at = NOW) => JSON.stringify({ v: 1, allowed, at });
function harness({ stored = null, property = 'G-TEST123456', storageFails = false, readyState = 'loading' } = {}) {
  const values = new Map(stored === null ? [] : [[KEY, stored]]);
  const listeners = new Map(), documentListeners = [], navigation = [], searches = [], inserted = [], changes = [], cookieWrites = [];
  const storage = {
    getItem(key) { if (storageFails) throw new Error('blocked storage'); return values.get(key) ?? null; },
    setItem(key, value) { if (storageFails) throw new Error('blocked storage'); values.set(key, value); },
    removeItem(key) { if (storageFails) throw new Error('blocked storage'); values.delete(key); },
  };
  const document = {
    readyState, referrer: '',
    forms: { search: { query: { addEventListener(_name, callback) { searches.push(callback); } } } },
    addEventListener(name, callback) { assert.equal(name, 'DOMContentLoaded'); documentListeners.push(callback); },
    createElement(tag) { assert.equal(tag, 'script'); return {}; },
    getElementById(id) { assert.equal(id, '__analytics'); return { insertAdjacentElement(_position, script) { inserted.push(script); } }; },
    get cookie() { return '_ga=visitor; _ga_TEST123456=session; cart=keep; _fbp=keep'; },
    set cookie(value) { cookieWrites.push(value); },
  };
  const context = vm.createContext({
    URL, location: new URL('https://www.theodore.net/store/confirmation/?client_secret=private&utm_source=ig#private'),
    document, localStorage: storage, document$: { subscribe() {} },
    location$: { subscribe(callback) { navigation.push(callback); } },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent(event) { changes.push(event); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch() { throw new Error('Analytics tests must not contact a provider'); },
  });
  context.window = context;
  vm.runInContext(`Date.now = () => ${NOW}`, context);
  for (const match of template.matchAll(/<script(?: id="__analytics")?>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(match[1].replaceAll('{{ property }}', property), context);
  }
  const state = () => JSON.parse(JSON.stringify(context.TheodoreAnalyticsPreference.state()));
  const dispatchStorage = (value, key = KEY) => listeners.get('storage')({ key, newValue: value, storageArea: storage });
  const storageEvent = (value, key = KEY) => { if (value === null) values.delete(key); else values.set(key, value); dispatchStorage(value, key); };
  return { context, values, inserted, changes, cookieWrites, documentListeners, navigation, searches, state, storageEvent, dispatchStorage };
}

test('the real GA provider exposes a default-on preference without bypassing Material initialization', () => {
  const h = harness();
  assert.equal(typeof h.context.TheodoreAnalyticsPreference, 'object');
  assert.deepEqual(h.state(), { allowed: true, persisted: false, available: true });
  assert.equal(h.context.dataLayer, undefined); assert.equal(h.inserted.length, 0);
  h.context.__md_analytics(); h.context.__md_analytics();
  assert.equal(h.inserted.length, 1); assert.equal(h.context.dataLayer.length, 2);
  assert.equal(h.context.dataLayer[1][2].page_location, 'https://www.theodore.net/store/confirmation/?utm_source=ig');
});

test('opting out immediately disables GA, saves the choice and only clears GA cookies', () => {
  const h = harness();
  h.context.__md_analytics(); h.documentListeners.forEach((listener) => listener());
  const before = h.context.dataLayer.length;
  h.context.TheodoreAnalyticsPreference.setAllowed(false);
  assert.equal(h.context['ga-disable-G-TEST123456'], true);
  assert.deepEqual(h.state(), { allowed: false, persisted: true, available: true });
  assert.deepEqual(JSON.parse(h.values.get(KEY)), { v: 1, allowed: false, at: NOW });
  h.navigation[0](new URL('https://www.theodore.net/store/'));
  h.searches[0].call({ value: 'private search' });
  h.context.__md_analytics();
  assert.equal(h.context.dataLayer.length, before); assert.equal(h.inserted.length, 1);
  assert.ok(h.cookieWrites.length > 0);
  assert.ok(h.cookieWrites.every((value) => /^_ga(?:_|=)/.test(value) && /max-age=0/i.test(value)));
  for (const domain of ['www.theodore.net', '.www.theodore.net', 'theodore.net', '.theodore.net']) {
    assert.ok(h.cookieWrites.some((value) => value.includes('domain=' + domain + ';') && value.includes('path=/;')));
  }
  assert.ok(h.cookieWrites.some((value) => !value.includes('domain=')), 'host-only cookies are cleared too');
  assert.equal(h.changes.at(-1).type, 'theodore:analytics-preference');
  assert.equal(h.changes.at(-1).detail.allowed, false);
});

test('a persisted opt-out blocks bootstrap after reload; enabling initializes once at the current page', () => {
  const h = harness({ stored: preference(false), readyState: 'complete' });
  h.context.__md_analytics();
  assert.deepEqual(h.state(), { allowed: false, persisted: true, available: true });
  assert.equal(h.context['ga-disable-G-TEST123456'], true);
  assert.equal(h.context.dataLayer, undefined); assert.equal(h.inserted.length, 0);
  h.context.location = new URL('https://www.theodore.net/privacy/');
  h.context.TheodoreAnalyticsPreference.setAllowed(true);
  h.context.TheodoreAnalyticsPreference.setAllowed(true); h.context.__md_analytics();
  assert.equal(h.inserted.length, 1); assert.equal(h.context.dataLayer.length, 2);
  assert.equal(h.context.dataLayer[1][2].page_location, 'https://www.theodore.net/privacy/');
  assert.equal(h.navigation.length, 1, 'enabling after DOMContentLoaded still binds navigation');
});

test('cross-tab choices take effect without replaying events collected while off or duplicating bootstrap', () => {
  const h = harness();
  h.context.__md_analytics(); h.documentListeners.forEach((listener) => listener());
  const before = h.context.dataLayer.length;
  h.storageEvent(preference(false));
  h.navigation[0](new URL('https://www.theodore.net/private-path/'));
  h.searches[0].call({ value: 'do not queue' });
  assert.equal(h.context.dataLayer.length, before); assert.equal(h.state().allowed, false);
  h.storageEvent(preference(true));
  assert.equal(h.context['ga-disable-G-TEST123456'], false);
  assert.equal(h.context.dataLayer.length, before); assert.equal(h.inserted.length, 1);
  h.navigation[0](new URL('https://www.theodore.net/store/'));
  assert.equal(h.context.dataLayer.length, before + 1);
  h.storageEvent(preference(false), 'unrelated-preference');
  assert.equal(h.state().allowed, true);
});

test('missing, expired or invalid preferences keep the configured default-on behavior', () => {
  for (const stored of [null, preference(false, NOW - TTL), 'broken', preference(false, NOW + 120000), JSON.stringify({ v: 1, allowed: 'false', at: NOW })]) {
    const h = harness({ stored });
    assert.deepEqual(h.state(), { allowed: true, persisted: false, available: true });
    h.context.__md_analytics(); assert.equal(h.inserted.length, 1);
  }
  const active = harness({ stored: preference(false, NOW - TTL + 1) });
  assert.equal(active.state().allowed, false);
});

test('a delayed cross-tab notification cannot restore an older choice over the latest saved preference', () => {
  const h = harness();
  h.context.__md_analytics();
  h.storageEvent(preference(false));
  h.context.TheodoreAnalyticsPreference.setAllowed(true);
  h.dispatchStorage(preference(false, NOW - 1));
  assert.equal(h.state().allowed, true);
  h.context.TheodoreAnalyticsPreference.setAllowed(false);
  h.dispatchStorage(preference(true, NOW - 1));
  assert.equal(h.state().allowed, false);
  assert.equal(h.context['ga-disable-G-TEST123456'], true);
});

test('blocked storage still honors the in-memory opt-out and reports that it was not persisted', () => {
  const h = harness({ storageFails: true });
  assert.doesNotThrow(() => h.context.TheodoreAnalyticsPreference.setAllowed(false));
  assert.deepEqual(h.state(), { allowed: false, persisted: false, available: true });
  h.context.__md_analytics(); assert.equal(h.inserted.length, 0);
  h.context.TheodoreAnalyticsPreference.setAllowed(true);
  assert.equal(h.inserted.length, 1); assert.equal(h.state().persisted, false);
});

test('an unconfigured GA property is unavailable and cannot load tracking', () => {
  for (const property of ['', 'UA-123-1', 'G-bad id']) {
    const h = harness({ property });
    assert.deepEqual(h.state(), { allowed: false, persisted: false, available: false });
    h.context.__md_analytics(); h.context.TheodoreAnalyticsPreference.setAllowed(true);
    assert.equal(h.inserted.length, 0); assert.equal(h.context.dataLayer, undefined);
  }
});
