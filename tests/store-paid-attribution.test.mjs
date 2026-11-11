import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const attributionSource = readFileSync(new URL("../docs/assets/js/attribution.js", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
const NOW = Date.parse("2026-11-10T20:00:00Z"), DAY = 864e5;
const productUrl = "https://theodore.net/store/avian-visitors/";
const tag = (arm) => `?go=av3-meta-${arm}`;
const plain = (value) => JSON.parse(JSON.stringify(value));
function storage(values, blocked = false) {
  return {
    getItem(key) { if (blocked) throw new Error("storage disabled"); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error("storage disabled"); values.set(key, String(value)); },
    removeItem(key) { if (blocked) throw new Error("storage disabled"); values.delete(key); },
  };
}
function harness({ url = productUrl, local = new Map(), session = new Map(), referrer = "", blocked = false, time = NOW, respond, meta, includeStore = false } = {}) {
  let currentTime = time, counter = 0;
  const requests = [];
  const context = vm.createContext({
    location: new URL(url), URL, URLSearchParams, Date: class extends Date { static now() { return currentTime; } },
    document: { referrer, readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: storage(local, blocked), sessionStorage: storage(session, blocked),
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` },
    fetch(url, options) {
      const request = { url, body: JSON.parse(options.body) }; requests.push(request);
      return respond ? respond(request) : Promise.resolve({ ok: true, json: async () => ({ recorded: true }) });
    },
    history: { replaceState(_state, _unused, path) { context.location = new URL(path, context.location); } },
  });
  context.window = context;
  context.addEventListener = () => {};
  if (meta) context.TheodoreMetaTracking = meta;
  vm.runInContext(attributionSource, context);
  if (includeStore) vm.runInContext(storeSource.replace(/\}\)\(\);\s*$/, `
    globalThis.helpers = { evAttribution, evInit, recordPaidArrival, evAnon, evSess, importCartFromUrl,
      setProducts(value) { PRODUCTS = value; }, cart() { return cart; } };
  })();`), context);
  return { context, api: context.TheodorePaidAttribution, helpers: context.helpers, requests, local, session,
    setTime(value) { currentTime = value; }, navigate(value) { context.location = new URL(value); context.TheodorePaidAttribution.capture(); } };
}

test("a paid arrival in an old organic tab is separate from preserved discovery and store source", () => {
  const first = { src: "instagram", l: "/projects/AvianVisitors/", ts: NOW - DAY };
  const local = new Map([["attr:first:v1", JSON.stringify(first)], ["tev_aid", "visitor12345678"]]);
  const session = new Map([["tev_src", "instagram"]]);
  const h = harness({ url: productUrl + tag("reel-a"), local, session, includeStore: true });
  const result = h.helpers.evAttribution();
  assert.equal(result.source, "instagram");
  assert.equal(result.anon, "visitor12345678");
  assert.equal(result.paidAttribution.first.arm, "reel-a");
  assert.deepEqual(JSON.parse(local.get("attr:first:v1")), first);
  assert.equal(session.get("tev_src"), "instagram");
  assert.equal(h.requests[0].url, "/api/ad-attribution");
  assert.equal(h.requests[0].body.paidAttribution.last.arm, "reel-a");
});

test("UTM-only shop handoff captures paid arrival and click context before cart URL cleanup", () => {
  const query = "?products=avian-visitors-assembled-continuous:1&utm_source=instagram&utm_medium=paid_social&utm_campaign=av-meta-nov26-v1&utm_content=photo&fbclid=VALID_click.123&cart_origin=instagram&ad_id=123456";
  const h = harness({ url: "https://theodore.net/store/checkout/" + query, includeStore: true });
  h.helpers.setProducts([{ id: "avian-visitors", published: true, title: "Frame", defaultBuild: "assembled-continuous", variants: [{ id: "assembled-continuous", price: 699, stripePrice: "price_frame" }] }]);
  h.helpers.evInit(); h.helpers.importCartFromUrl();
  assert.equal(h.api.snapshot().last.arm, "photo");
  assert.equal(h.api.snapshot().last.ad_id, "123456");
  assert.equal(h.api.snapshot().last.cart_origin, "instagram");
  assert.equal(h.api.clickContext().fbclid, "VALID_click.123");
  assert.equal(h.context.location.search.includes("fbclid"), false);
  assert.equal(h.context.location.search.includes("utm_"), false);
  assert.equal(h.helpers.cart()[0].id, "avian-visitors");
  const sent = JSON.stringify(h.requests);
  assert.equal(sent.includes("VALID_click.123"), false);
  assert.equal(JSON.stringify([...h.local]).includes("VALID_click.123"), false);
});

test("repeat initialization keeps a touch ID, crossover preserves first assignment, and new tabs reuse it", () => {
  const h = harness({ url: productUrl + tag("reel-a") });
  const original = plain(h.api.snapshot().first);
  h.api.capture(); assert.deepEqual(plain(h.api.snapshot().first), original);
  h.setTime(NOW + 60_000); h.navigate(productUrl + tag("species"));
  assert.deepEqual(plain(h.api.snapshot().first), original);
  assert.equal(h.api.snapshot().last.arm, "species");
  assert.equal(h.api.snapshot().crossover, true);
  const nextTab = harness({ local: h.local, time: NOW + 90_000 });
  assert.deepEqual(plain(nextTab.api.snapshot()), plain(h.api.snapshot()));
});

test("direct returns stop receiving paid credit after seven days; later clicks do not reenroll the experiment", () => {
  const first = harness({ url: productUrl + tag("photo") });
  const original = plain(first.api.snapshot().first);
  const direct = harness({ local: first.local, time: NOW + 8 * DAY });
  assert.equal(direct.api.snapshot(), null);
  assert.equal(direct.api.arrival(), null);
  direct.navigate(productUrl + tag("species"));
  assert.equal(direct.api.snapshot().last.arm, "species");
  assert.deepEqual(plain(direct.api.snapshot().first), original);
  assert.equal(direct.api.snapshot().crossover, true);
});

test("unrecognized, conflicting, organic and malformed tags cannot manufacture a paid arm", () => {
  for (const query of ["?go=not-paid", "?fbclid=abc", "?utm_source=instagram&utm_medium=organic&utm_campaign=av-meta-nov26-v1&utm_content=photo", "?utm_source=instagram&utm_medium=paid_social&utm_campaign=wrong&utm_content=photo", "?go=av3-meta-photo&utm_source=instagram&utm_medium=paid_social&utm_campaign=av-meta-nov26-v1&utm_content=species"]) {
    assert.equal(harness({ url: productUrl + query }).api.snapshot(), null, query);
  }
  const h = harness({ url: productUrl + tag("photo") + "&utm_term=buyer%40example.com&ad_id=%7B%7Bad.id%7D%7D&fbclid=%3Cscript%3E" });
  assert.equal(h.api.snapshot().last.utm_term, undefined);
  assert.equal(h.api.snapshot().last.ad_id, undefined);
  assert.equal(h.api.clickContext(), null);
});

test("storage failure retains the current page attribution and a stable anonymous identity without throwing", () => {
  const h = harness({ url: productUrl + tag("photo"), blocked: true, includeStore: true });
  const a = h.helpers.evAttribution(), b = h.helpers.evAttribution();
  assert.equal(a.anon, b.anon);
  assert.equal(a.paidAttribution.first.id, b.paidAttribution.first.id);
  assert.equal(a.paidAttribution.first.arm, "photo");
});

test("paid arrival acknowledgments survive navigation; a failed delivery retries the same touch", async () => {
  let fail = true;
  const h = harness({ url: productUrl + tag("photo"), includeStore: true,
    respond() { return fail ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true, json: async () => ({ recorded: true }) }); } });
  h.helpers.recordPaidArrival(); await new Promise(setImmediate);
  fail = false; h.helpers.recordPaidArrival(); await new Promise(setImmediate);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].body.paidAttribution.last.id, h.requests[1].body.paidAttribution.last.id);
  const next = harness({ local: h.local, time: NOW + 1000, includeStore: true });
  next.helpers.evInit(); assert.equal(next.requests.length, 0);
});

test("Meta context is fresh on each payment snapshot and optional tracking failure preserves first-party identity", () => {
  let allowed = true;
  const h = harness({ url: productUrl + tag("photo"), includeStore: true, meta: { context() { return { consent: allowed, version: "meta-v1" }; } } });
  assert.equal(h.helpers.evAttribution().metaTracking.consent, true);
  allowed = false; assert.equal(h.helpers.evAttribution().metaTracking.consent, false);
  h.context.TheodoreMetaTracking = { context() { throw new Error("optional failed"); } };
  const result = h.helpers.evAttribution();
  assert.ok(result.anon); assert.equal(result.paidAttribution.first.arm, "photo"); assert.equal(result.metaTracking, undefined);
});
