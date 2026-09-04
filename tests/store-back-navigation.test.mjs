import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";


function backHelpers({ referrer = "", navigationType = "navigate" } = {}) {
  const path = new URL("../docs/assets/js/store.js", import.meta.url);
  const original = fs.readFileSync(path, "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__storeBackHelpers = {
      setProducts: function (products) { PRODUCTS = products; },
      setTrail: function (trail) { navTrail = trail; },
      target: backTarget,
      reconcile: reconcileTrail,
      currentEntry: currentProductTrailEntry,
      detailLinkId: detailProductLinkId,
      rememberDetailLink: rememberDetailProductLink,
      wireDetailLinks: wireDetailProductLinks,
      readTrail: readTrail,
      writeTrail: writeTrail
    };
  })();`);
  assert.notEqual(source, original, "store.js must remain a single trailing IIFE");

  const session = new Map();
  const document = {
    readyState: "loading",
    referrer,
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { getAttribute() { return null; } },
    documentElement: { getAttribute() { return null; } },
  };
  const location = {
    origin: "https://theodore.net",
    hostname: "theodore.net",
    pathname: "/store/micron-pens-9/",
    search: "",
    hash: "",
  };
  const context = vm.createContext({
    document,
    location,
    performance: { getEntriesByType() { return [{ type: navigationType }]; } },
    window: { addEventListener() {} },
    URL,
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
    sessionStorage: {
      getItem(key) { return session.has(key) ? session.get(key) : null; },
      setItem(key, value) { session.set(key, String(value)); },
    },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  const helpers = context.__storeBackHelpers;
  helpers.setProducts([
    { id: "avian-visitors", title: "Avian Visitors" },
    { id: "avian-mic", title: "Bird Mic" },
    { id: "polargraph", title: "Polargraph Plotter" },
    { id: "micron-pens-9", title: "Micron Pens", accessory: true, parentId: "polargraph" },
  ]);
  return { helpers, document, location, session };
}


function detailLink(href, attributes = {}) {
  const listeners = {};
  const values = { href, ...attributes };
  return {
    listeners,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(values, name); },
    addEventListener(type, listener) { listeners[type] = listener; },
  };
}


function primaryClick(overrides = {}) {
  return {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}


test("an accessory without a real product-page trail returns to the store", () => {
  const { helpers } = backHelpers();
  helpers.setTrail([]);
  const target = helpers.target();
  assert.equal(target.href, "/store/");
  assert.equal(target.label, "Store");
});


test("an accessory returns to the exact product URL it was opened from", () => {
  const { helpers } = backHelpers();
  helpers.setTrail([{ id: "polargraph", href: "/store/polargraph/?variant=electronics#accessories" }]);
  const target = helpers.target();
  assert.equal(target.href, "/store/polargraph/?variant=electronics#accessories");
  assert.equal(target.label, "Polargraph Plotter");
});


test("a same-tab product link in detail copy records the exact source page", () => {
  const { helpers, location } = backHelpers();
  location.pathname = "/store/avian-visitors/";
  location.search = "?variant=electronics";
  location.hash = "#pairs-with";
  const link = detailLink("/store/avian-mic/");
  const scope = {
    querySelectorAll(selector) {
      assert.equal(selector, ".pe-details a[href]");
      return [link];
    },
  };

  helpers.setTrail([]);
  helpers.wireDetailLinks({ id: "avian-visitors" }, scope);
  link.listeners.click(primaryClick());

  const trail = Array.from(helpers.readTrail());
  assert.equal(trail.length, 1);
  assert.equal(trail[0].id, "avian-visitors");
  assert.equal(trail[0].href, "/store/avian-visitors/?variant=electronics#pairs-with");
  helpers.setTrail(trail);
  assert.equal(helpers.target().href, "/store/avian-visitors/?variant=electronics#pairs-with");
  assert.equal(helpers.target().label, "Avian Visitors");
});


test("detail-copy navigation ignores new-tab, modified, and untrusted links", () => {
  const { helpers, location } = backHelpers();
  location.pathname = "/store/avian-visitors/";
  const product = { id: "avian-visitors" };
  const ignored = [
    [detailLink("https://example.com/store/avian-mic/"), primaryClick()],
    [detailLink("javascript:alert(1)"), primaryClick()],
    [detailLink("/store/%E0%A4%A/"), primaryClick()],
    [detailLink("/store/not-a-product/"), primaryClick()],
    [detailLink("/store/avian-mic/", { target: "_blank" }), primaryClick()],
    [detailLink("/store/avian-mic/", { download: "" }), primaryClick()],
    [detailLink("/store/avian-mic/"), primaryClick({ ctrlKey: true })],
    [detailLink("/store/avian-mic/"), primaryClick({ button: 1 })],
    [detailLink("/store/avian-mic/"), primaryClick({ defaultPrevented: true })],
  ];

  ignored.forEach(([link, event]) => {
    assert.equal(helpers.rememberDetailLink(product, link, event), false);
  });
  assert.equal(Array.from(helpers.readTrail()).length, 0);
});


test("Bird Mic direct entry still returns to Store", () => {
  const { helpers, location } = backHelpers();
  location.pathname = "/store/avian-mic/";
  helpers.writeTrail([{ id: "avian-visitors", href: "/store/avian-visitors/?variant=electronics#pairs-with" }]);
  const trail = Array.from(helpers.reconcile({ id: "avian-mic" }));
  assert.equal(trail.length, 0);
  helpers.setTrail(trail);
  assert.equal(helpers.target().href, "/store/");
  assert.equal(helpers.target().label, "Store");
});


test("the current product entry preserves its path, query, and hash", () => {
  const { helpers, location } = backHelpers();
  location.pathname = "/store/polargraph/";
  location.search = "?variant=electronics";
  location.hash = "#accessories";
  const entry = helpers.currentEntry({ id: "polargraph" });
  assert.equal(entry.id, "polargraph");
  assert.equal(entry.href, "/store/polargraph/?variant=electronics#accessories");
});


test("untrusted trail entries fail closed to the store", () => {
  const { helpers } = backHelpers();
  for (const entry of [
    { id: "polargraph", href: "https://example.com/store/polargraph/" },
    { id: "polargraph", href: "javascript:alert(1)" },
    { id: "polargraph", href: "/store/%E0%A4%A/" },
    { id: "missing", href: "/store/missing/" },
    { id: "micron-pens-9", href: "/store/polargraph/" },
  ]) {
    helpers.setTrail([entry]);
    assert.equal(helpers.target().href, "/store/");
  }
});


test("grid entry clears a stale trail while reload preserves a valid parent", () => {
  const grid = backHelpers({ referrer: "https://theodore.net/store/" });
  grid.helpers.writeTrail([{ id: "polargraph", href: "/store/polargraph/" }]);
  assert.equal(Array.from(grid.helpers.reconcile({ id: "micron-pens-9" })).length, 0);

  const reload = backHelpers({ referrer: "", navigationType: "reload" });
  reload.helpers.writeTrail([{ id: "polargraph", href: "/store/polargraph/" }]);
  const kept = Array.from(reload.helpers.reconcile({ id: "micron-pens-9" }));
  assert.equal(kept.length, 1);
  reload.helpers.setTrail(kept);
  assert.equal(reload.helpers.target().href, "/store/polargraph/");
});


test("a direct product jump cannot inherit an unrelated stored parent", () => {
  const direct = backHelpers({ referrer: "https://theodore.net/store/micron-pens-9/" });
  direct.helpers.writeTrail([{ id: "polargraph", href: "/store/polargraph/" }]);
  assert.equal(Array.from(direct.helpers.reconcile({ id: "micron-pens-9" })).length, 0);
});


test("browser Back to the parent pops that parent and prevents a loop", () => {
  const restored = backHelpers({ referrer: "https://theodore.net/store/micron-pens-9/" });
  restored.helpers.writeTrail([{ id: "polargraph", href: "/store/polargraph/" }]);
  const trail = Array.from(restored.helpers.reconcile({ id: "polargraph" }));
  assert.equal(trail.length, 0);
  restored.helpers.setTrail(trail);
  assert.equal(restored.helpers.target().href, "/store/");
});
