import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function inventoryHelpers(overrides = {}) {
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__inventoryHelpers = {
      setProducts: function (value) { PRODUCTS = value; },
      setInventory: function (rows, ready) { INVENTORY_ROWS = rows; INVENTORY_READY = ready; },
      statusOf: statusOf,
      buyable: buyable,
      batchAvailabilityText: batchAvailabilityText,
      sanitizeCart: sanitizeCart,
      variantMaxQuantity: variantMaxQuantity,
      loadInventoryAvailability: loadInventoryAvailability
    };
  })();`);
  assert.notEqual(source, original, "store.js must remain one trailing IIFE");
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
    localStorage: { getItem() { return null; }, setItem() {} },
    ...overrides,
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return context.__inventoryHelpers;
}

function detailHelpers() {
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__detailHelpers = { detailHTML: detailHTML };
  })();`);
  const context = vm.createContext({
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getElementById() { return null; },
      body: { getAttribute() { return null; } },
      documentElement: { getAttribute() { return null; } },
    },
    window: { addEventListener() {} },
    URL,
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return context.__detailHelpers;
}

function soldOutDetailState() {
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__soldOutDetailState = function (product) {
      const classes = new Set();
      const buy = {
        classList: {
          add: function (name) { classes.add(name); },
          remove: function (name) { classes.delete(name); }
        },
        disabled: false,
        innerHTML: "",
        style: {},
        textContent: ""
      };
      const elements = {
        ".pe-box-contents": { innerHTML: "" },
        ".pe-qty span": { textContent: "" },
        ".pe-price": { innerHTML: "" },
        ".pe-qty": { style: {} },
        ".pe-buy": buy,
        ".pe-waitlist": { hidden: false, innerHTML: "" }
      };
      root = {
        querySelector: function (selector) { return elements[selector] || null; },
        querySelectorAll: function () { return []; }
      };
      PRODUCTS = [product]; P = product; build = product.defaultBuild; qty = 1;
      updateVariant(false);
      return {
        classes: Array.from(classes),
        label: buy.textContent,
        price: elements[".pe-price"].innerHTML,
        quantityDisplay: elements[".pe-qty"].style.display
      };
    };
  })();`);
  const context = vm.createContext({
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getElementById() { return null; },
      body: { getAttribute() { return null; } },
      documentElement: { getAttribute() { return null; } },
    },
    window: { addEventListener() {} },
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return context.__soldOutDetailState;
}

function inventoryBootHarness(overrides = {}) {
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.__storeBoot = { visible: false };
    evInit = function () {};
    injectHeaderCart = function () {};
    importCartFromUrl = function () {};
    ensureDrawer = function () {};
    renderCart = function () {};
    updateBadge = function () {};
    openCart = function () {};
    reveal = function () { globalThis.__storeBoot.visible = true; };
    wireStoreFilter = function () { reveal(); };
    renderGrid = function () {};
    setupThemeSwap = function () {};
    handleCheckoutReturn = function () {};
    setupLegalBackLink = function () {};
    globalThis.__storeBoot.run = init;
    globalThis.__storeBoot.interact = function () {
      addToCart("cable", "standard", 1);
      return cartCount();
    };
    globalThis.__storeBoot.cart = function () { return JSON.parse(JSON.stringify(cart)); };
  })();`);
  const grid = {};
  const context = vm.createContext({
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector(selector) { return selector === "#store-grid" ? grid : null; },
      querySelectorAll() { return []; },
      body: { getAttribute() { return null; } },
      documentElement: { getAttribute() { return null; } },
    },
    window: { addEventListener() {}, STORE_PRODUCTS: [] },
    location: {
      hostname: "example.test", pathname: "/store/", search: "", hash: "",
      origin: "https://example.test",
    },
    URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
    ...overrides,
  });
  vm.runInContext(source, context, { filename: "store.js" });
  return { boot: context.__storeBoot, window: context.window };
}

const SKU = "avian-gen3-batch-01";
const finiteVariant = {
  id: "assembled", label: "Assembled", price: 699, stripePrice: "price_test",
  maxQuantity: 20, inventorySku: SKU, batchSize: 20,
};
const products = [{
  id: "avian-visitors", published: true, defaultBuild: "assembled", variants: [finiteVariant],
}];

test("finite storefront state fails sold out until a complete availability read succeeds", () => {
  const helpers = inventoryHelpers();
  helpers.setProducts(products);
  assert.equal(helpers.statusOf(finiteVariant), "soldout");
  assert.equal(helpers.buyable(finiteVariant), false);

  helpers.setInventory({ [SKU]: { available: 1, soldOut: false } }, true);
  assert.equal(helpers.statusOf(finiteVariant), "available");
  assert.equal(helpers.buyable(finiteVariant), true);

  helpers.setInventory({ [SKU]: { available: 0, soldOut: true } }, true);
  assert.equal(helpers.statusOf(finiteVariant), "soldout");
  assert.equal(helpers.buyable(finiteVariant), false);
});

test("sold-out product detail offers notification without purchase controls", () => {
  const state = soldOutDetailState()({
    id: "avian-mic",
    defaultBuild: "electronics",
    variants: [{
      id: "electronics", label: "Electronics Kit", price: 180,
      stripePrice: "price_test", status: "soldout", contents: [],
    }],
  });

  assert.equal(state.label, "Notify me");
  assert.deepEqual(JSON.parse(JSON.stringify(state.classes)), ["is-waitlist"]);
  assert.match(state.price, /Sold out/);
  assert.equal(state.quantityDisplay, "none");
});

test("explicit local preview shows the finished finite product without weakening production", () => {
  const previewVariant = { ...finiteVariant, localPreview: true };
  const local = inventoryHelpers({ location: { hostname: "localhost" } });
  local.setProducts([{ ...products[0], published: false, variants: [previewVariant] }]);
  assert.equal(local.statusOf(previewVariant), "available");
  assert.equal(local.buyable(previewVariant), true);

  const production = inventoryHelpers({ location: { hostname: "theodore.net" } });
  production.setProducts([{ ...products[0], published: false, variants: [previewVariant] }]);
  assert.equal(production.statusOf(previewVariant), "soldout");
  assert.equal(production.buyable(previewVariant), false);
});

test("batch copy uses authoritative remaining inventory with a safe unpublished local preview", () => {
  const previewVariant = { ...finiteVariant, localPreview: true };
  const previewProduct = { ...products[0], published: false, variants: [previewVariant] };
  const local = inventoryHelpers({ location: { hostname: "localhost" } });
  local.setProducts([previewProduct]);
  assert.equal(local.batchAvailabilityText(previewVariant, previewProduct), "20 of 20 remaining");

  const production = inventoryHelpers({ location: { hostname: "theodore.net" } });
  production.setProducts(products);
  assert.equal(production.batchAvailabilityText(finiteVariant, products[0]), "");
  production.setInventory({ [SKU]: { available: 13, soldOut: false } }, true);
  assert.equal(production.batchAvailabilityText(finiteVariant, products[0]), "13 of 20 remaining");
  production.setInventory({ [SKU]: { available: 0, soldOut: true } }, true);
  assert.equal(production.batchAvailabilityText(finiteVariant, products[0]), "0 of 20 remaining");
});

test("product detail omits the second paragraph when no variant has a description", () => {
  const html = detailHelpers().detailHTML({
    title: "Avian Visitors",
    sub: "One concise paragraph.",
    variants: [{ id: "assembled", label: "Assembled", contents: ["Frame"], batchSize: 20 }],
    sections: [
      { label: "How it works", items: ["Connect it."] },
      { label: "Pairs with", items: ["Bird Mic", "BirdWeather PUC"] },
      { label: "Dimensions", html: "11.75 × 14.75 × 0.96 in" },
    ],
  });
  assert.equal((html.match(/<p class="pe-sub">/g) || []).length, 1);
  assert.equal((html.match(/<summary>/g) || []).length, 4);
  assert.doesNotMatch(html, /pe-variant-desc|pe-softnote|Software &amp; licenses/);
  assert.match(html, /<div class="pe-batch" aria-live="polite" hidden><\/div>/);
});

test("assembled batch supports multiple frames but never exceeds its order or inventory cap", () => {
  const helpers = inventoryHelpers();
  helpers.setProducts(products);
  assert.equal(helpers.variantMaxQuantity("avian-visitors", "assembled"), 20);
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.sanitizeCart([
    { id: "avian-visitors", build: "assembled", qty: 99 },
    { id: "avian-visitors", build: "assembled", qty: 99 },
  ]))), [{ id: "avian-visitors", build: "assembled", qty: 20 }]);

  helpers.setInventory({ [SKU]: { available: 7, soldOut: false } }, true);
  assert.equal(helpers.variantMaxQuantity("avian-visitors", "assembled"), 7);
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.sanitizeCart([
    { id: "avian-visitors", build: "assembled", qty: 12 },
  ]))), [{ id: "avian-visitors", build: "assembled", qty: 7 }]);
});

test("a never-resolving inventory read cannot block ordinary visibility or interaction", async () => {
  let timeoutMs = null;
  let aborted = false;
  const helpers = inventoryHelpers({
    AbortController: class {
      constructor() { this.signal = {}; }
      abort() { aborted = true; }
    },
    fetch() { return new Promise(() => {}); },
    setTimeout(callback, milliseconds) {
      timeoutMs = milliseconds;
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
  });
  const ordinaryVariant = {
    id: "standard", label: "Standard", price: 12, stripePrice: "price_ordinary",
  };
  const mixedProducts = products.concat([{
    id: "cable", published: true, defaultBuild: "standard", variants: [ordinaryVariant],
  }]);
  helpers.setProducts(mixedProducts);

  const pendingInventory = helpers.loadInventoryAvailability();
  assert.equal(helpers.statusOf(finiteVariant), "soldout");
  assert.equal(helpers.buyable(finiteVariant), false);
  assert.equal(helpers.statusOf(ordinaryVariant), "available");
  assert.equal(helpers.buyable(ordinaryVariant), true);
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.sanitizeCart([
    { id: "cable", build: "standard", qty: 1 },
  ]))), [{ id: "cable", build: "standard", qty: 1 }]);

  assert.equal(await pendingInventory, false);
  assert.equal(timeoutMs, 2500);
  assert.equal(aborted, true);

  const source = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const initSource = source.slice(source.indexOf("function init()"), source.indexOf("let booted", source.indexOf("function init()")));
  assert.match(initSource, /const inventoryRefresh = loadInventoryAvailability\(\);/);
  assert.doesNotMatch(initSource, /await\s+loadInventoryAvailability/);
  assert.ok(initSource.indexOf("injectHeaderCart()") < initSource.indexOf("inventoryRefresh.then"));
});

test("store boot reveals and accepts an ordinary add before a hung finite read settles", () => {
  const harness = inventoryBootHarness({
    AbortController: class {
      constructor() { this.signal = {}; }
      abort() {}
    },
    fetch() { return new Promise(() => {}); },
    setTimeout(callback) { queueMicrotask(callback); return 1; },
    clearTimeout() {},
  });
  harness.window.STORE_PRODUCTS = products.concat([{
    id: "cable", published: true, defaultBuild: "standard", variants: [{
      id: "standard", label: "Standard", price: 12, stripePrice: "price_ordinary",
    }],
  }]);
  assert.equal(harness.boot.run(), undefined);
  assert.equal(harness.boot.visible, true);
  assert.equal(harness.boot.interact(), 1);
});

test("authoritative inventory immediately reconciles a persisted finite cart", async () => {
  let stored = JSON.stringify([{ id: "avian-visitors", build: "assembled", qty: 20 }]);
  const harness = inventoryBootHarness({
    fetch: async () => ({
      ok: true,
      json: async () => ({ inventory: [{ sku: SKU, available: 7, soldOut: false }] }),
    }),
    setTimeout() { return 1; },
    clearTimeout() {},
    localStorage: {
      getItem(key) { return key === "store:cart:v3" ? stored : null; },
      setItem(key, value) { if (key === "store:cart:v3") stored = value; },
    },
  });
  harness.window.STORE_PRODUCTS = products;
  harness.boot.run();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(harness.boot.cart())), [
    { id: "avian-visitors", build: "assembled", qty: 7 },
  ]);
  assert.deepEqual(JSON.parse(stored), [
    { id: "avian-visitors", build: "assembled", qty: 7 },
  ]);
});

test("authoritative sold-out inventory removes a persisted finite cart line", async () => {
  let stored = JSON.stringify([{ id: "avian-visitors", build: "assembled", qty: 20 }]);
  const harness = inventoryBootHarness({
    fetch: async () => ({
      ok: true,
      json: async () => ({ inventory: [{ sku: SKU, available: 0, soldOut: true }] }),
    }),
    setTimeout() { return 1; },
    clearTimeout() {},
    localStorage: {
      getItem(key) { return key === "store:cart:v3" ? stored : null; },
      setItem(key, value) { if (key === "store:cart:v3") stored = value; },
    },
  });
  harness.window.STORE_PRODUCTS = products;
  harness.boot.run();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(harness.boot.cart())), []);
  assert.deepEqual(JSON.parse(stored), []);
});

test("a failed availability read is retried instead of leaving the batch looking sold out", async () => {
  let stored = JSON.stringify([{ id: "avian-visitors", build: "assembled", qty: 20 }]);
  let calls = 0;
  const harness = inventoryBootHarness({
    fetch: async () => {
      calls += 1;
      if (calls === 1) throw new Error("edge blip");
      return { ok: true, json: async () => ({ inventory: [{ sku: SKU, available: 7, soldOut: false }] }) };
    },
    // fire the retry timers at once, but never the 2.5s read timeout
    setTimeout(callback, milliseconds) { if (milliseconds !== 2500) queueMicrotask(callback); return 1; },
    clearTimeout() {},
    localStorage: {
      getItem(key) { return key === "store:cart:v3" ? stored : null; },
      setItem(key, value) { if (key === "store:cart:v3") stored = value; },
    },
  });
  harness.window.STORE_PRODUCTS = products;
  harness.boot.run();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.boot.cart())), [
    { id: "avian-visitors", build: "assembled", qty: 7 },
  ]);
});
