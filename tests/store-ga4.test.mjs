import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const analyticsTemplate = readFileSync(new URL("../overrides/partials/integrations/analytics/google.html", import.meta.url), "utf8");
const privacyScript = analyticsTemplate.match(/<script>([\s\S]*?)<\/script>/)[1];
const source = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
function harness({ hostname = "theodore.net", localMode = false, material = false, privacy = true, confirmation = false } = {}) {
  const injected = source.replace(/\}\)\(\);\s*$/, `
    globalThis.storeAnalytics = ga4;
    globalThis.storeConfirmation = renderConfirmation;
    ${confirmation ? `
      renderOrder = function (host, order) { globalThis.renderedOrder = order; };
      PRODUCTS = [{ id: "avian-visitors", title: "Avian Visitors", variants: [{ id: "assembled-batch-2", price: 999 }] }];
    ` : ""}
    ${localMode ? 'localRecovery = { mode: "local" };' : ""}
  })();`);
  assert.notEqual(injected, source);
  const context = vm.createContext({
    location: new URL("https://" + hostname + "/"),
    document: { readyState: "loading", referrer: "", addEventListener() {}, querySelector(selector) { return confirmation && selector === "#confirmation" ? {} : null; }, querySelectorAll() { return []; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    URL, URLSearchParams, addEventListener() {},
    fetch() { throw new Error("Analytics tests must not make network requests"); },
  });
  context.window = context;
  if (privacy) vm.runInContext(privacyScript, context);
  if (material) initializeMaterial(context);
  vm.runInContext(injected, context, { filename: "store.js" });
  return context;
}

// Material's head script runs synchronously before deferred store.js. Its gtag-like
// function is local to __md_analytics, and the queued commands are Arguments objects.
function initializeMaterial(context, measurementId = "G-TEST123456") {
  context.measurementId = measurementId;
  vm.runInContext(`
    function __md_analytics() {
      function e() { dataLayer.push(arguments); }
      window.dataLayer = window.dataLayer || [];
      e("js", new Date());
      e("config", measurementId);
    }
    __md_analytics();
  `, context);
}

test("Material analytics receives existing ecommerce events without a global gtag", () => {
  const context = harness({ material: true });
  assert.equal(context.gtag, undefined);
  const callback = () => {};
  const params = { currency: "USD", value: 699, items: [{ item_id: "avian-visitors-assembled-batch-2", quantity: 1 }], event_callback: callback };
  for (const name of ["view_item", "add_to_cart", "begin_checkout", "purchase"]) context.storeAnalytics(name, params);
  assert.equal(context.dataLayer.length, 6);
  for (const [index, name] of ["view_item", "add_to_cart", "begin_checkout", "purchase"].entries()) {
    const command = context.dataLayer[index + 2];
    assert.equal(Object.prototype.toString.call(command), "[object Arguments]");
    assert.equal(command[0], "event"); assert.equal(command[1], name);
    assert.notEqual(command[2], params); assert.equal(command[2].event_callback, callback);
    assert.equal(command[2].value, 699); assert.equal(command[2].items, params.items);
    assert.equal(command[2].page_location, "https://theodore.net/");
    assert.equal(params.page_location, undefined);
  }
  assert.equal(context.gtag, undefined, "the bridge must not install a global tracker");
});

test("the existing global gtag path is preserved and never queues a duplicate", () => {
  const context = harness(), calls = [];
  initializeMaterial(context);
  context.gtag = (...args) => calls.push(args);
  const params = { currency: "USD", value: 699 };
  context.storeAnalytics("add_to_cart", params);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["event", "add_to_cart"]);
  assert.equal(calls[0][2].value, params.value);
  assert.equal(calls[0][2].page_location, "https://theodore.net/");
  assert.equal(context.dataLayer.length, 2);
});

test("absent, not-yet-configured, empty-ID and non-GA analytics stay inert", () => {
  const absent = harness();
  absent.storeAnalytics("view_item", {});
  assert.equal(absent.dataLayer, undefined);
  for (const id of ["", "AW-123456", "UA-123456-1"]) {
    const context = harness(); initializeMaterial(context, id);
    context.storeAnalytics("view_item", {});
    assert.equal(context.dataLayer.length, 2);
  }
  const pending = harness(); pending.dataLayer = [];
  pending.storeAnalytics("view_item", {});
  assert.equal(pending.dataLayer.length, 0);
  initializeMaterial(pending);
  pending.storeAnalytics("add_to_cart", {});
  assert.equal(pending.dataLayer.length, 3);
});

test("local hosts and local recovery previews never emit commerce events", () => {
  for (const options of [{ hostname: "localhost" }, { hostname: "127.0.0.1" }, { hostname: "[::1]" }, { localMode: true }]) {
    const context = harness(options), calls = [];
    initializeMaterial(context);
    context.storeAnalytics("view_item", {});
    assert.equal(context.dataLayer.length, 2);
    context.gtag = (...args) => calls.push(args);
    context.storeAnalytics("purchase", { value: 699 });
    assert.deepEqual(calls, []);
  }
});

test("blocked or broken analytics cannot interrupt the store", () => {
  const context = harness(); initializeMaterial(context);
  context.dataLayer.push = () => { throw new Error("blocked queue"); };
  assert.doesNotThrow(() => context.storeAnalytics("begin_checkout", {}));
  context.gtag = () => { throw new Error("blocked tracker"); };
  assert.doesNotThrow(() => context.storeAnalytics("begin_checkout", {}));
});


test("commerce events redact current and explicit URLs without mutating caller parameters", () => {
  const context = harness({ material: true });
  context.location = new URL("https://theodore.net/store/confirmation/?payment_intent_client_secret=synthetic_secret&utm_source=facebook#restore_cart=synthetic_cart");
  context.document.referrer = "https://theodore.net/store/?restore_cart=synthetic_cart&utm_campaign=birds";
  const originalUrl = context.location.href;
  const params = { currency: "USD", value: 699 };
  context.storeAnalytics("purchase", params);
  const event = context.dataLayer.at(-1)[2];
  assert.equal(event.page_location, "https://theodore.net/store/confirmation/?utm_source=facebook");
  assert.equal(event.page_referrer, "https://theodore.net/store/?utm_campaign=birds");
  assert.equal(context.location.href, originalUrl);
  assert.deepEqual(params, { currency: "USD", value: 699 });
  context.storeAnalytics("purchase", { page_location: "https://theodore.net/?client_secret=synthetic_secret&utm_source=test", page_referrer: "https://theodore.net/?setup_intent_client_secret=synthetic_secret" });
  assert.equal(context.dataLayer.at(-1)[2].page_location, "https://theodore.net/?utm_source=test");
  assert.equal(context.dataLayer.at(-1)[2].page_referrer, "https://theodore.net/");
});

test("commerce tracking fails closed when URL protection is unavailable", () => {
  const context = harness({ material: true, privacy: false });
  context.storeAnalytics("purchase", {});
  assert.equal(context.dataLayer.length, 2);
});

async function confirmedPurchase(breakdown, amount = breakdown?.total) {
  const context = harness({ material: true, confirmation: true });
  context.location = new URL("https://theodore.net/store/confirmation/?payment_intent=pi_synthetic&payment_intent_client_secret=synthetic_secret&redirect_status=succeeded");
  const order = { status: "succeeded", amount, breakdown, items: [{ id: "avian-visitors", build: "assembled-batch-2", qty: 2 }] };
  const requests = [];
  context.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => order };
  };
  await context.storeConfirmation();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/order");
  assert.deepEqual(JSON.parse(requests[0].options.body), { pi: "pi_synthetic", cs: "synthetic_secret" });
  assert.equal(context.renderedOrder, order, "tracking does not change the order passed to rendering");
  assert.equal(context.location.search.includes("synthetic_secret"), true, "checkout credentials stay available to confirmation");
  const command = context.dataLayer.at(-1);
  assert.equal(command[1], "purchase");
  assert.equal(command[2].transaction_id, "pi_synthetic");
  assert.equal(command[2].currency, "USD");
  assert.equal(command[2].items[0].item_id, "avian-visitors-assembled-batch-2");
  assert.equal(command[2].items[0].quantity, 2);
  assert.equal(Object.hasOwn(command[2].items[0], "price"), false, "current catalog prices must not become paid prices");
  assert.doesNotMatch(JSON.stringify(command[2]), /synthetic_secret/);
  return command[2];
}

test("purchase value uses full-price server merchandise subtotal, excluding tax and shipping", async () => {
  const event = await confirmedPurchase({ subtotal: 139800, shipping: 3500, tax: 10136, total: 153436 });
  assert.equal(event.value, 1398); assert.equal(event.shipping, 35); assert.equal(event.tax, 101.36);
});

test("purchase value deducts the server voucher discount and supports zero merchandise value", async () => {
  const event = await confirmedPurchase({ subtotal: 69900, discount: 10000, shipping: 2000, tax: 4343, total: 66243 });
  assert.equal(event.value, 599); assert.equal(event.shipping, 20); assert.equal(event.tax, 43.43);
  const free = await confirmedPurchase({ subtotal: 1000, discount: 1000, shipping: 0, tax: 0, total: 0 });
  assert.equal(free.value, 0);
});

test("unknown or invalid purchase breakdowns keep the conversion but omit monetary estimates", async () => {
  const valid = { subtotal: 69900, shipping: 2000, tax: 4343, total: 76243 };
  const cases = [null, {}, { ...valid, subtotal: "69900" }, { ...valid, subtotal: NaN },
    { ...valid, subtotal: Infinity }, { ...valid, shipping: -1 }, { ...valid, tax: 0.5 },
    { ...valid, discount: null }, { ...valid, discount: 70000 }, { ...valid, discount: -1 },
    { ...valid, total: 1 }, { ...valid, subtotal: Number.MAX_SAFE_INTEGER + 1 }];
  for (const breakdown of cases) {
    const event = await confirmedPurchase(breakdown, 76243);
    for (const key of ["value", "shipping", "tax"]) assert.equal(Object.hasOwn(event, key), false);
  }
  const mismatch = await confirmedPurchase(valid, 123);
  assert.equal(Object.hasOwn(mismatch, "value"), false);
});
