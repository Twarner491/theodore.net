import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
const variant = { id: "assembled-continuous", label: "Assembled", price: 699, stripePrice: "price_test",
  productionBatchGroup: "avian-visitors", maxQuantity: 20, contents: [] };
const product = { id: "avian-visitors", published: true, defaultBuild: variant.id, variants: [variant] };

function harness({ session = new Map([["tev_sid", "session-existing"], ["tev_src", "instagram"]]), observer = true,
    local = new Map([["tev_aid", "anonymous-existing"]]), storageFails = false, search = "", enabled = true } = {}) {
  const requests = [], observers = [], listeners = {};
  const classList = { add() {}, remove() {} };
  const counter = { hidden: true, innerHTML: "", isConnected: true, classList,
    getBoundingClientRect() { return { left: 10, top: 10, width: 130, height: 30 }; }, contains() { return false; } };
  const fields = { ".pe-batch": counter, ".pe-box-contents": {}, ".pe-qty span": {}, ".pe-price": {},
    ".pe-qty": { style: {} }, ".pe-buy": { style: {}, classList } };
  let current = { group: "avian-visitors", ordinal: 3, remaining: 15, paused: false }, top = counter;
  const style = { visibility: "visible", display: "block", opacity: "1" };
  const document = { readyState: "loading", hidden: false, referrer: "", querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); }, elementFromPoint() { return top; },
    body: { getAttribute() { return null; } }, documentElement: { getAttribute() { return null; } } };
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.disconnected = false; this.observeCount = 0; observers.push(this); }
    observe(target) { this.target = target; this.observeCount += 1; }
    unobserve() { this.unobserved = true; }
    disconnect() { this.disconnected = true; }
    emit(ratio = 1, isIntersecting = true) { this.callback([{ target: this.target, intersectionRatio: ratio, isIntersecting }]); }
  }
  const source = original.replace("const COUNT_EXPERIMENT_ENABLED = true;", "const COUNT_EXPERIMENT_ENABLED = " + enabled + ";").replace(/\}\)\(\);\s*$/, `
    PRODUCTS = [fixtureProduct];
    root = { querySelector: s => fixtureFields[s] || null, querySelectorAll: () => [] };
    P = fixtureProduct; build = P.defaultBuild; qty = 1;
    globalThis.h = { load: loadProductionBatches, render: () => updateVariant(false), resume: resumeBatchExposure, track,
      assignment: batchExperimentAssignment, arm: batchExperimentArm, buyable: () => buyable(fixtureProduct.variants[0]), html: () => productionBatchHTML(fixtureProduct.variants[0]) };
  })();`);
  const context = vm.createContext({ document, window: { addEventListener() {} },
    location: { hostname: "theodore.net", pathname: "/store/avian-visitors/", search },
    sessionStorage: { getItem(key) { return session.get(key) ?? null; }, setItem(key, value) { session.set(key, value); } },
    localStorage: { getItem(key) { if (storageFails) throw new Error("blocked"); return local.get(key) ?? null; },
      setItem(key, value) { if (storageFails) throw new Error("blocked"); local.set(key, value); } },
    navigator: { sendBeacon(url, body) { requests.push({ url, payload: JSON.parse(body) }); return true; } },
    fetch: async () => ({ ok: current !== null, json: async () => current }),
    getComputedStyle: () => style, IntersectionObserver: observer ? Observer : undefined,
    setTimeout, clearTimeout, AbortController, URL, URLSearchParams, fixtureProduct: product, fixtureFields: fields,
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return { ...context.h, requests, observers, counter, style, document, session, local,
    current(value) { current = value; }, cover(value) { top = value ? {} : counter; },
    foreground() { document.hidden = false; (listeners.visibilitychange || []).forEach((fn) => fn()); },
    latest() { return observers.at(-1); },
  };
}

test("only a fully visible real API purchase area emits the experiment exposure for either arm", async () => {
  const h = harness(); h.render();
  assert.equal(h.observers.length, 0, "no fallback count can generate an observation");
  await h.load(); h.render();
  assert.equal(h.latest().options.threshold, 1);
  h.latest().emit(0, false); h.latest().emit(.5);
  assert.equal(h.requests.length, 0);
  h.latest().emit();
  assert.deepEqual(h.requests, [{ url: "/api/ev", payload: {
    t: "batch_exposure", a: "anonymous-existing", s: "session-existing", src: "instagram",
    experiment: "avian-count-v1", arm: "label",
    p: "avian-visitors", b: "assembled-continuous", batch_ordinal: 3, batch_remaining: 15,
  } }]);
});

test("scrolling and rerendering deduplicate a state while a new actual count records once", async () => {
  const h = harness(); await h.load(); h.render();
  h.latest().emit(); h.latest().emit(0, false); h.latest().emit();
  h.render(); h.latest().emit();
  assert.equal(h.requests.length, 1);
  h.current({ group: "avian-visitors", ordinal: 3, remaining: 14, paused: false });
  await h.load(); h.render(); h.latest().emit(); h.latest().emit();
  assert.deepEqual(h.requests.map(({ payload }) => payload.batch_remaining), [15, 14]);
  h.current({ group: "avian-visitors", ordinal: 4, remaining: 14, paused: false });
  await h.load(); h.render(); h.latest().emit();
  assert.deepEqual(h.requests.map(({ payload }) => payload.batch_ordinal), [3, 3, 4]);
});

test("same tab session retains deduplication across page loads but a new session can observe again", async () => {
  const a = harness(); await a.load(); a.render(); a.latest().emit();
  const b = harness({ session: a.session }); await b.load(); b.render(); b.latest().emit();
  assert.equal(b.requests.length, 0);
  a.session.set("tev_sid", "new-session");
  const c = harness({ session: a.session }); await c.load(); c.render(); c.latest().emit();
  assert.equal(c.requests.length, 1);
  assert.equal(c.requests[0].payload.s, "new-session");
});

test("hidden, background, disconnected and covered counters do not count as visible", async () => {
  const h = harness(); await h.load(); h.render();
  h.document.hidden = true; h.latest().emit();
  h.foreground(); assert.equal(h.latest().unobserved, true);
  h.counter.isConnected = false; h.latest().emit(); h.counter.isConnected = true;
  h.counter.hidden = true; h.latest().emit(); h.counter.hidden = false;
  h.style.visibility = "hidden"; h.latest().emit(); h.style.visibility = "visible";
  h.style.opacity = "0"; h.latest().emit(); h.style.opacity = "1";
  h.cover(true); h.latest().emit();
  assert.equal(h.requests.length, 0);
  h.cover(false); h.resume(); h.latest().emit();
  assert.equal(h.requests.length, 1);
});

test("queued callbacks retain their render identity and a failed API read clears observation", async () => {
  const h = harness(); await h.load(); h.render(); const old = h.latest();
  h.current({ group: "avian-visitors", ordinal: 4, remaining: 10, paused: false });
  await h.load(); h.render(); old.emit();
  assert.equal(old.disconnected, true);
  assert.equal(h.requests.length, 0);
  h.latest().emit();
  assert.equal(h.requests[0].payload.batch_ordinal, 4);
  const current = h.latest(); h.current(null); await h.load(); h.render(); current.emit();
  assert.equal(h.counter.hidden, true);
  assert.equal(current.disconnected, true);
  assert.equal(h.requests.length, 1);
});

test("unsupported observation and invalid numeric payloads never invent exposure", async () => {
  const h = harness({ observer: false }); await h.load(); h.render();
  assert.match(h.counter.innerHTML, /15 frames remaining/);
  assert.equal(h.counter.hidden, false);
  assert.equal(h.observers.length, 0);
  h.track("batch_view", { product: product.id, build: variant.id, batch_ordinal: "3", batch_remaining: 15 });
  h.track("batch_view", { product: product.id, build: "assembled", batch_ordinal: 3, batch_remaining: 15 });
  assert.equal(h.requests.length, 0);
});


test("assignment remains stable across reloads, tabs, rollover and URL parameters", async () => {
  const first = harness(); await first.load(); first.render(); first.latest().emit();
  const assignment = JSON.parse(JSON.stringify(first.assignment()));
  const nextTab = harness({ local: first.local, search: "?arm=count&experiment=other" });
  await nextTab.load(); nextTab.render(); nextTab.latest().emit();
  assert.deepEqual(JSON.parse(JSON.stringify(nextTab.assignment())), assignment);
  nextTab.current({ group: "avian-visitors", ordinal: 4, remaining: 15, paused: false });
  await nextTab.load(); nextTab.render(); nextTab.latest().emit();
  assert.deepEqual(nextTab.requests.map(({payload}) => payload.arm), [assignment.arm, assignment.arm]);
  assert.equal(nextTab.requests[0].payload.a, assignment.anon);
});

test("the label arm reserves the count geometry but conceals it visually and from assistive technology", async () => {
  const h = harness(); await h.load(); h.render();
  assert.equal(h.assignment().arm, "label");
  assert.match(h.html(), /pe-batch-remaining pe-batch-remaining--concealed" aria-hidden="true"/);
  assert.match(h.html(), /pe-batch-label pe-batch-label--solo">Batch 3/);
  assert.match(h.html(), /15 frames remaining/);
  const css = readFileSync(new URL("../docs/assets/css/store.css", import.meta.url), "utf8");
  assert.match(css, /\.pe-batch-remaining--concealed\s*\{\s*visibility:\s*hidden;\s*\}/);
  h.latest().emit();
  assert.equal(h.requests[0].payload.batch_remaining, 15, "control records the genuine underlying remainder");
});

test("missing persistent identity cannot enroll or gate buying", async () => {
  const h = harness({ storageFails: true }); await h.load(); h.render();
  assert.equal(h.assignment(), null);
  assert.equal(h.observers.length, 0);
  assert.match(h.counter.innerHTML, /15 frames remaining/);
  assert.doesNotMatch(h.counter.innerHTML, /concealed/);
  assert.equal(h.counter.hidden, false);
  assert.equal(h.requests.length, 0);
});

test("paused intake has no eligible experiment exposure", async () => {
  const h = harness(); h.current({ group: "avian-visitors", ordinal: 3, remaining: 15, paused: true });
  await h.load(); h.render();
  assert.equal(h.observers.length, 0);
  assert.equal(h.requests.length, 0);
});

test("invalid experiment, arm and identity combinations are never sent", () => {
  const h = harness();
  const payload = { product: product.id, build: variant.id, batch_ordinal: 3, batch_remaining: 15,
    experiment: "avian-count-v1", arm: "label" };
  h.track("batch_exposure", { ...payload, arm: "count" });
  h.track("batch_exposure", { ...payload, experiment: "different" });
  h.track("batch_exposure", { ...payload, batch_remaining: "15" });
  assert.equal(h.requests.length, 0);
  h.track("batch_exposure", payload);
  assert.equal(h.requests.length, 1);
  assert.equal(h.arm(""), null);
  assert.equal(h.arm("123"), null);
  assert.equal(h.arm("someone@example.com"), null);
});

test("both arms share exact eligibility while the count arm visibly retains the real remainder", async () => {
  const h = harness({ local: new Map([["tev_aid", "ffffffffffffffffffffffffffffffff"]]) });
  await h.load(); h.render();
  assert.equal(h.assignment().arm, "count");
  assert.doesNotMatch(h.html(), /concealed|aria-hidden/);
  assert.match(h.html(), /15 frames remaining/);
  h.latest().emit(.99);
  assert.equal(h.requests.length, 0);
  h.latest().emit();
  assert.equal(h.requests[0].payload.arm, "count");
  assert.equal(h.requests[0].payload.batch_remaining, 15);
  assert.equal(h.requests[0].payload.experiment, "avian-count-v1");
});

test("assignment matches the collector's independent contract vectors", () => {
  const h = harness();
  for (const [anon, arm] of [
    ["00000000000000000000000000000000", "label"],
    ["ffffffffffffffffffffffffffffffff", "count"],
    ["anonymous-existing", "label"], ["12345678", "label"], ["abcdefgh", "label"], ["ABCDEF_123-xyz", "label"],
  ]) assert.equal(h.arm(anon), arm, anon);
});

test("a new visitor receives one persistent identity shared by eligibility and purchase attribution", async () => {
  const local = new Map();
  const h = harness({ local }); await h.load(); h.render(); h.latest().emit();
  const id = local.get("tev_aid");
  assert.ok(id && id.length >= 8 && id.length <= 40);
  assert.equal(h.assignment().anon, id);
  assert.equal(h.requests[0].payload.a, id);
  const reload = harness({ local }); await reload.load(); reload.render(); reload.latest().emit();
  assert.equal(reload.assignment().anon, id);
  assert.equal(reload.requests[0].payload.arm, h.requests[0].payload.arm);
});


test("forward-disable shows label alone and stops enrollment without changing checkout availability", async () => {
  for (const anon of ["00000000000000000000000000000000", "ffffffffffffffffffffffffffffffff"]) {
    const h = harness({ enabled: false, local: new Map([["tev_aid", anon]]) });
    await h.load(); h.render();
    assert.equal(h.assignment(), null);
    assert.equal(h.observers.length, 0);
    assert.equal(h.buyable(), true);
    assert.match(h.html(), /Batch 3/);
    assert.match(h.html(), /pe-batch-remaining--concealed" aria-hidden="true"/);
    const payload = { product: product.id, build: variant.id, batch_ordinal: 3, batch_remaining: 15,
      experiment: "avian-count-v1", arm: h.arm(anon) };
    h.track("batch_exposure", payload); h.track("batch_view", payload);
    assert.equal(h.requests.length, 0);
  }
});
