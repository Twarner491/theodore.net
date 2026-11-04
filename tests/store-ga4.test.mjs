import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
function harness({ hostname = "theodore.net", localMode = false, material = false } = {}) {
  const injected = source.replace(/\}\)\(\);\s*$/, `
    globalThis.storeAnalytics = ga4;
    ${localMode ? 'localRecovery = { mode: "local" };' : ""}
  })();`);
  assert.notEqual(injected, source);
  const context = vm.createContext({
    location: { hostname, protocol: "https:", pathname: "/", search: "", hash: "" },
    document: { readyState: "loading", referrer: "", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    URL, URLSearchParams, addEventListener() {},
    fetch() { throw new Error("Analytics tests must not make network requests"); },
  });
  context.window = context;
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
    assert.equal(command[2], params); assert.equal(command[2].event_callback, callback);
  }
  assert.equal(context.gtag, undefined, "the bridge must not install a global tracker");
});

test("the existing global gtag path is preserved and never queues a duplicate", () => {
  const context = harness(), calls = [];
  initializeMaterial(context);
  context.gtag = (...args) => calls.push(args);
  const params = { currency: "USD", value: 699 };
  context.storeAnalytics("add_to_cart", params);
  assert.deepEqual(calls, [["event", "add_to_cart", params]]);
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
