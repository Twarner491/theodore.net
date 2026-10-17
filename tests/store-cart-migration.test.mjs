import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";


function storeHelpers(storedCart = null) {
  const path = new URL("../docs/assets/js/store.js", import.meta.url);
  const original = fs.readFileSync(path, "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__storeHelpers = {
      setProducts: function (value) { PRODUCTS = value; },
      sanitizeCart: sanitizeCart,
      loadCart: loadCart,
      getCart: function () { return cart; },
      legacyAvianKitDetailTarget: legacyAvianKitDetailTarget,
      ga4Item: ga4Item,
      confLineHTML: confLineHTML
    };
  })();`);
  assert.notEqual(source, original, "store.js must remain a single trailing IIFE");

  let value = storedCart == null ? null : JSON.stringify(storedCart);
  const context = vm.createContext({
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      body: { getAttribute() { return null; } },
      documentElement: { getAttribute() { return null; } },
    },
    window: { addEventListener() {} },
    URLSearchParams,
    localStorage: {
      getItem() { return value; },
      setItem(_key, next) { value = next; },
    },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return {
    helpers: context.__storeHelpers,
    stored: () => value == null ? null : JSON.parse(value),
  };
}


const products = [
  { id: "avian-visitors", title: "Avian Visitors", defaultBuild: "assembled", variants: [{ id: "assembled", label: "Assembled" }] },
  {
    id: "avian-visitors-kit",
    title: "Avian Visitors Kit",
    defaultBuild: "electronics",
    variants: [
      { id: "electronics", label: "Electronics Kit", price: 450 },
      { id: "electronics-printed", label: "+ Frame & Parts", price: 520 },
    ],
  },
  { id: "polargraph", variants: [{ id: "electronics" }] },
];


test("legacy Avian DIY cart lines migrate to the kit without touching assembled", () => {
  const { helpers } = storeHelpers();
  helpers.setProducts(products);
  const sanitized = JSON.parse(JSON.stringify(helpers.sanitizeCart([
    { id: "avian-visitors", build: "electronics", qty: 2 },
    { id: "avian-visitors", build: "electronics-printed", qty: 1 },
    { id: "avian-visitors-kit", build: "electronics-printed", qty: 3 },
    { id: "avian-visitors", build: "assembled", qty: 1 },
    { id: "polargraph", build: "electronics", qty: 1 },
  ])));

  assert.deepEqual(sanitized, [
    { id: "avian-visitors-kit", build: "electronics", qty: 2 },
    { id: "avian-visitors-kit", build: "electronics-printed", qty: 4 },
    { id: "avian-visitors", build: "assembled", qty: 1 },
    { id: "polargraph", build: "electronics", qty: 1 },
  ]);
});


test("loading a legacy cart persists its migrated product identity", () => {
  const state = storeHelpers([
    { id: "avian-visitors", build: "electronics", qty: 1 },
    { id: "avian-visitors", build: "assembled", qty: 1 },
  ]);
  state.helpers.setProducts(products);
  state.helpers.loadCart();

  assert.deepEqual(state.stored(), [
    { id: "avian-visitors-kit", build: "electronics", qty: 1 },
    { id: "avian-visitors", build: "assembled", qty: 1 },
  ]);
});


test("legacy DIY detail links redirect to the corresponding kit variant", () => {
  const { helpers } = storeHelpers();
  assert.equal(
    helpers.legacyAvianKitDetailTarget(
      "avian-visitors",
      "?variant=electronics-printed&utm_source=bookmark",
      "#details",
    ),
    "/store/avian-visitors-kit/?variant=electronics-printed&utm_source=bookmark#details",
  );
  assert.equal(
    helpers.legacyAvianKitDetailTarget("avian-visitors", "?variant=assembled", ""),
    "",
  );
  assert.equal(
    helpers.legacyAvianKitDetailTarget("avian-mic", "?variant=electronics", ""),
    "",
  );
});


test("historical order lines resolve to the kit instead of falling back to assembled", () => {
  const { helpers } = storeHelpers();
  helpers.setProducts(products);

  assert.deepEqual(
    JSON.parse(JSON.stringify(helpers.ga4Item("avian-visitors", "electronics", 2))),
    {
      item_id: "avian-visitors-kit-electronics",
      item_name: "Avian Visitors Kit",
      item_variant: "electronics",
      price: 450,
      quantity: 2,
    },
  );
  const html = helpers.confLineHTML({ id: "avian-visitors", build: "electronics", qty: 1 });
  assert.match(html, /Avian Visitors Kit/);
  assert.match(html, /Electronics Kit/);
  assert.doesNotMatch(html, />Assembled</);
});
