import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";


function filterHelpers(storage = new Map()) {
  const path = new URL("../docs/assets/js/store.js", import.meta.url);
  const original = fs.readFileSync(path, "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__storeFilterHelpers = {
      preferred: preferredStoreFilters,
      set: setStoreFilters,
      toggle: toggleStoreFilter,
      normalize: normalizeStoreFilters,
      label: storeFilterLabel,
      current: function () { return storeFilters.slice(); }
    };
  })();`);
  assert.notEqual(source, original, "store.js must remain a single trailing IIFE");

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
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return { helpers: context.__storeFilterHelpers, storage };
}


const values = (items) => Array.from(items);


test("store filter defaults to products and kits when no valid preference exists", () => {
  assert.deepEqual(values(filterHelpers().helpers.preferred()), ["products", "kits"]);
  assert.deepEqual(values(filterHelpers(new Map([["store:filter:v1", "unknown"]])).helpers.preferred()), ["products", "kits"]);
});


test("store filter migrates each valid v1 scalar only when v2 is absent", () => {
  for (const [legacy, expected] of [
    ["products", ["products"]],
    ["kits", ["kits"]],
    ["accessories", ["accessories"]],
    ["all", ["products", "kits", "accessories"]],
  ]) {
    const helpers = filterHelpers(new Map([["store:filter:v1", legacy]])).helpers;
    assert.deepEqual(values(helpers.preferred()), expected);
  }
});


test("valid v2 wins and malformed or empty v2 resets to the fresh default", () => {
  const valid = new Map([
    ["store:filter:v1", "all"],
    ["store:filter:v2", JSON.stringify(["accessories", "products", "unknown"])],
  ]);
  assert.deepEqual(values(filterHelpers(valid).helpers.preferred()), ["products", "accessories"]);

  for (const invalid of ["not-json", "[]", JSON.stringify(["unknown"])]) {
    const storage = new Map([["store:filter:v1", "all"], ["store:filter:v2", invalid]]);
    assert.deepEqual(values(filterHelpers(storage).helpers.preferred()), ["products", "kits"]);
  }
});


test("store filter preference survives a fresh page context", () => {
  const storage = new Map();
  const first = filterHelpers(storage).helpers;
  first.set(["accessories"], false, true);

  assert.deepEqual(values(first.current()), ["accessories"]);
  assert.equal(storage.get("store:filter:v2"), '["accessories"]');
  assert.deepEqual(values(filterHelpers(storage).helpers.preferred()), ["accessories"]);
});


test("all is computed by checking every category and at least one remains selected", () => {
  const helpers = filterHelpers().helpers;
  helpers.set(["products", "kits"], false, false);
  assert.equal(helpers.toggle("accessories", false), true);
  assert.deepEqual(values(helpers.current()), ["products", "kits", "accessories"]);
  assert.equal(helpers.label(helpers.current()), "all");

  helpers.set(["accessories"], false, false);
  assert.equal(helpers.toggle("accessories", false), false);
  assert.deepEqual(values(helpers.current()), ["accessories"]);
});


test("store index markup exposes a three-item checked menu with products and kits selected", () => {
  const markup = fs.readFileSync(new URL("../docs/store/index.md", import.meta.url), "utf8");
  assert.match(markup, /store-filter-current">products \+ kits</);
  assert.match(markup, /role="menu" aria-label="Store categories"/);
  assert.match(markup, /data-filter="products" aria-checked="true"/);
  assert.match(markup, /data-filter="kits" aria-checked="true"/);
  assert.match(markup, /data-filter="accessories" aria-checked="false"/);
  assert.doesNotMatch(markup, /data-filter="all"/);
});
