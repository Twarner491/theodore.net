import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_WORKER_SOURCE = readFileSync(resolve(ROOT, 'docs/sw.js'), 'utf8');
const ORIGIN = 'https://theodore.net';
const CURRENT_CACHE = 'teddywarner-static-v2';

function keyOf(request) {
  return typeof request === 'string' ? request : request.url;
}

function createHarness({ fetchImpl } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const calls = {
    claim: 0,
    delete: [],
    fetch: [],
    match: [],
    open: [],
    put: [],
    skipWaiting: 0,
    storageMatch: []
  };

  function storeFor(name) {
    if (!stores.has(name)) {
      stores.set(name, new Map());
    }
    return stores.get(name);
  }

  function cacheFor(name) {
    const store = storeFor(name);
    return {
      async match(request) {
        const key = keyOf(request);
        calls.match.push({ cache: name, key });
        const response = store.get(key);
        return response ? response.clone() : undefined;
      },
      async put(request, response) {
        const key = keyOf(request);
        calls.put.push({ cache: name, key });
        store.set(key, response.clone());
      }
    };
  }

  const caches = {
    async keys() {
      return [...stores.keys()];
    },
    async open(name) {
      calls.open.push(name);
      return cacheFor(name);
    },
    async delete(name) {
      calls.delete.push(name);
      return stores.delete(name);
    },
    async match(request) {
      const key = keyOf(request);
      calls.storageMatch.push(key);
      for (const store of stores.values()) {
        const response = store.get(key);
        if (response) return response.clone();
      }
      return undefined;
    }
  };

  const self = {
    location: { origin: ORIGIN },
    clients: {
      async claim() {
        calls.claim += 1;
      }
    },
    async skipWaiting() {
      calls.skipWaiting += 1;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };

  async function controlledFetch(request, options) {
    calls.fetch.push({ request, options });
    if (fetchImpl) return fetchImpl(request, options);
    return new Response('network:' + keyOf(request), { status: 200 });
  }

  vm.runInNewContext(SERVICE_WORKER_SOURCE, {
    URL,
    caches,
    fetch: controlledFetch,
    self
  }, { filename: 'docs/sw.js' });

  function dispatchFetch(url, init = {}) {
    const request = init.request || new Request(url, init);
    let response;
    let respondWithCalls = 0;
    listeners.get('fetch')({
      request,
      respondWith(value) {
        respondWithCalls += 1;
        response = Promise.resolve(value);
      }
    });
    return { intercepted: respondWithCalls > 0, response };
  }

  async function dispatchLifecycle(type) {
    const waits = [];
    listeners.get(type)({ waitUntil(value) { waits.push(Promise.resolve(value)); } });
    await Promise.all(waits);
  }

  function seed(cacheName, url, body = 'stale') {
    storeFor(cacheName).set(url, new Response(body, { status: 200 }));
  }

  return { calls, dispatchFetch, dispatchLifecycle, seed, stores };
}

test('same-origin API requests bypass the worker without any cache access', () => {
  const harness = createHarness();
  const urls = [
    `${ORIGIN}/api/inventory-availability?sku=avian-gen3-batch-01`,
    `${ORIGIN}/api/order?payment_intent=pi_sensitive`,
    `${ORIGIN}/api`
  ];

  for (const url of urls) {
    harness.seed('teddywarner-v1', url, 'stale API response');
    const result = harness.dispatchFetch(url);
    assert.equal(result.intercepted, false, url);
    assert.equal(result.response, undefined, url);
  }

  const post = harness.dispatchFetch(`${ORIGIN}/api/payment-intent`, { method: 'POST' });
  assert.equal(post.intercepted, false);
  assert.deepEqual(harness.calls.fetch, []);
  assert.deepEqual(harness.calls.open, []);
  assert.deepEqual(harness.calls.match, []);
  assert.deepEqual(harness.calls.storageMatch, []);
  assert.deepEqual(harness.calls.put, []);
});

test('store pages and mutable commerce resources are network-only and never cached', async () => {
  const harness = createHarness();
  const urls = [
    `${ORIGIN}/store/`,
    `${ORIGIN}/store/avian-visitors-kit/`,
    `${ORIGIN}/store/checkout/?cart=open`,
    `${ORIGIN}/store/confirmation/?payment_intent_client_secret=secret`,
    `${ORIGIN}/store-catalog.json`,
    `${ORIGIN}/assets/js/store-data.js`,
    `${ORIGIN}/assets/js/store.js`
  ];

  for (const url of urls) {
    harness.seed('teddywarner-v1', url, 'stale commerce response');
    const result = harness.dispatchFetch(url);
    assert.equal(result.intercepted, true, url);
    const response = await result.response;
    assert.equal(await response.text(), 'network:' + url, url);
  }

  assert.equal(harness.calls.fetch.length, urls.length);
  for (const call of harness.calls.fetch) {
    assert.equal(call.options.cache, 'no-store', keyOf(call.request));
  }
  assert.deepEqual(harness.calls.open, []);
  assert.deepEqual(harness.calls.match, []);
  assert.deepEqual(harness.calls.storageMatch, []);
  assert.deepEqual(harness.calls.put, []);
});

test('network-only commerce requests fail closed instead of replaying stale data', async () => {
  const harness = createHarness({
    fetchImpl: async () => { throw new Error('offline'); }
  });
  const urls = [
    `${ORIGIN}/store/checkout/`,
    `${ORIGIN}/store/confirmation/`,
    `${ORIGIN}/store-catalog.json`,
    `${ORIGIN}/assets/js/store-data.js`
  ];

  for (const url of urls) {
    harness.seed(CURRENT_CACHE, url, 'must not be replayed');
    const result = harness.dispatchFetch(url);
    assert.equal(result.intercepted, true, url);
    await assert.rejects(result.response, /offline/, url);
  }

  assert.deepEqual(harness.calls.open, []);
  assert.deepEqual(harness.calls.match, []);
  assert.deepEqual(harness.calls.storageMatch, []);
  assert.deepEqual(harness.calls.put, []);
});

test('content-hashed static assets remain cache-first', async () => {
  const harness = createHarness();
  const queryHashed = `${ORIGIN}/assets/js/store.js?h=0123abcd`;
  const filenameHashed = `${ORIGIN}/assets/css/app.a1b2c3d4.css`;

  harness.seed(CURRENT_CACHE, queryHashed, 'cached store runtime');
  const hit = harness.dispatchFetch(queryHashed);
  assert.equal(hit.intercepted, true);
  assert.equal(await (await hit.response).text(), 'cached store runtime');
  assert.equal(harness.calls.fetch.length, 0);

  const miss = harness.dispatchFetch(filenameHashed);
  assert.equal(miss.intercepted, true);
  assert.equal(await (await miss.response).text(), 'network:' + filenameHashed);
  assert.deepEqual(harness.calls.put, [{ cache: CURRENT_CACHE, key: filenameHashed }]);

  const secondHit = harness.dispatchFetch(filenameHashed);
  assert.equal(await (await secondHit.response).text(), 'network:' + filenameHashed);
  assert.equal(harness.calls.fetch.length, 1);
});

test('unversioned static assets and cross-origin Stripe assets bypass the worker', () => {
  const harness = createHarness();
  const unversioned = harness.dispatchFetch(`${ORIGIN}/assets/js/index.js`);
  const stripe = harness.dispatchFetch('https://js.stripe.com/v3/');

  assert.equal(unversioned.intercepted, false);
  assert.equal(stripe.intercepted, false);
  assert.deepEqual(harness.calls.fetch, []);
  assert.deepEqual(harness.calls.open, []);
  assert.deepEqual(harness.calls.match, []);
  assert.deepEqual(harness.calls.put, []);
});

test('install does not precache mutable URLs', async () => {
  const harness = createHarness();
  await harness.dispatchLifecycle('install');

  assert.equal(harness.calls.skipWaiting, 1);
  assert.deepEqual(harness.calls.open, []);
  assert.deepEqual(harness.calls.put, []);
});

test('activate removes old owned caches but preserves the current and unrelated caches', async () => {
  const harness = createHarness();
  harness.seed('teddywarner-v1', `${ORIGIN}/api/inventory-availability`);
  harness.seed('teddywarner-static-v1', `${ORIGIN}/assets/js/old.0123abcd.js`);
  harness.seed(CURRENT_CACHE, `${ORIGIN}/assets/js/current.0123abcd.js`);
  harness.seed('another-app-v1', `${ORIGIN}/unrelated`);

  await harness.dispatchLifecycle('activate');

  assert.deepEqual(harness.calls.delete.sort(), ['teddywarner-static-v1', 'teddywarner-v1']);
  assert.equal(harness.stores.has('teddywarner-v1'), false);
  assert.equal(harness.stores.has('teddywarner-static-v1'), false);
  assert.equal(harness.stores.has(CURRENT_CACHE), true);
  assert.equal(harness.stores.has('another-app-v1'), true);
  assert.equal(harness.calls.claim, 1);
});
