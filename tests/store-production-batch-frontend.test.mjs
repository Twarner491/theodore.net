import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
const variant = { id: "assembled-continuous", label: "Assembled", price: 699, stripePrice: "price_frame",
  maxQuantity: 20, shippingProfile: "contiguous-us-ground", productionBatchGroup: "avian-visitors", contents: [] };
const product = { id: "avian-visitors", title: "Avian Visitors", published: true,
  defaultBuild: variant.id, variants: [variant], images: [], imageBase: "/assets/images/" };
const row = { group: "avian-visitors", ordinal: 3, remaining: 12, paused: false };
const reply = (body, ok = true) => ({ ok, json: async () => body });
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness(overrides = {}) {
  const source = original.replace(/\}\)\(\);\s*$/, `
    globalThis.h = {
      setProducts: value => { PRODUCTS = value; },
      load: loadProductionBatches, refresh: refreshProductionBatches, html: productionBatchHTML,
      buyable, statusOf, variantMaxQuantity, sanitizeCart, migratedLine, confLineHTML, coLineHTML, detailHTML,
      loadCart, openCart, cart: () => cart,
      drawerState: function (line) {
        const classes = new Set();
        const classList = { add(name) { classes.add(name); }, contains(name) { return classes.has(name); } };
        const items = { innerHTML: '', querySelectorAll: () => [] };
        const fields = { '.cart-items': items, '.cart-sub-val': {}, '.cart-checkout': {} };
        drawer = { classList, querySelector: selector => fields[selector] || null };
        scrim = { classList };
        ensureDrawer = updateBadge = syncAccCards = function () {};
        cart = [line]; renderCart();
        return { items, classes };
      },
      detailState: function (product) {
        const classes = new Set();
        const classList = { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } };
        const fields = {
          '.pe-box-contents': { innerHTML: '' }, '.pe-qty span': { textContent: '' },
          '.pe-price': { innerHTML: '' }, '.pe-qty': { style: {} },
          '.pe-buy': { classList, style: {}, innerHTML: '', textContent: '', disabled: false },
          '.pe-batch': { classList, innerHTML: '', hidden: true },
        };
        root = { querySelector: selector => fields[selector] || null, querySelectorAll: () => [] };
        P = product; build = product.defaultBuild; qty = 1;
        updateVariant(false);
        return { batch: fields['.pe-batch'], button: fields['.pe-buy'], classes: [...classes] };
      },
      boot: function () {
        globalThis.bootState = { visible: false, checkoutRenders: 0 };
        evInit = function () {};
        injectHeaderCart = ensureDrawer = renderCart = updateBadge = setupThemeSwap = handleCheckoutReturn = setupLegalBackLink = function () {};
        renderGrid = function () {};
        reveal = function () { bootState.visible = true; };
        wireStoreFilter = reveal;
        renderCheckout = function () { bootState.checkoutRenders += 1; };
        coRefreshSummary = function () { throw new Error('must not replace payment summary'); };
        init();
        return bootState;
      },
    };
  })();`);
  const context = vm.createContext({
    document: { readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      body: { getAttribute() { return null; } }, documentElement: { getAttribute() { return null; } } },
    window: { addEventListener() {}, STORE_PRODUCTS: [product] },
    location: { hostname: "localhost", pathname: "/store/", search: "", hash: "", origin: "http://localhost" },
    localStorage: { getItem() { return null; }, setItem() {} },
    sessionStorage: { getItem() { return null; }, removeItem() {} },
    URLSearchParams, setTimeout, clearTimeout, AbortController,
    ...overrides,
  });
  vm.runInContext(source, context, { filename: "store.js" });
  context.h.setProducts([product]);
  return context.h;
}

test("production label starts empty even on localhost and renders only ledger data", async () => {
  const calls = [];
  const h = harness({ fetch: async (url, options) => { calls.push({ url, options }); return reply(row); } });
  assert.equal(h.html(variant), "");
  assert.equal(h.detailState(product).batch.hidden, true);
  assert.match(h.detailHTML(product), /pe-batch/);
  await h.load();
  assert.equal(calls[0].url, "/api/production-batch?group=avian-visitors");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(h.html(variant), '<span class="pe-batch-label">Batch 3</span><span class="pe-batch-remaining">12 frames remaining</span>');
  assert.equal(h.detailState(product).batch.hidden, false);
  assert.equal(h.buyable(variant), true);
});

test("rollover changes only display; current-batch quota never caps a multi-frame cart", async () => {
  let current = { ...row, remaining: 1 };
  const h = harness({ fetch: async () => reply(current) });
  await h.load();
  assert.match(h.html(variant), /1 frame remaining/);
  assert.equal(h.variantMaxQuantity(product.id, variant.id), 20);
  assert.deepEqual(plain(h.sanitizeCart([{ id: product.id, build: variant.id, qty: 4 }])), [{ id: product.id, build: variant.id, qty: 4 }]);
  current = { ...row, ordinal: 4, remaining: 29 };
  await h.load();
  assert.match(h.html(variant), /Batch 4/);
  assert.equal(h.buyable(variant), true);
  assert.equal(variant.id, "assembled-continuous");
});

test("errors and malformed projections omit stale counts instead of inventing a batch", async () => {
  let current = row, ok = true;
  const h = harness({ fetch: async () => reply(current, ok) });
  for (const invalid of [{ ...row, group: "other" }, { ...row, ordinal: 0 }, { ...row, remaining: -1 },
    { ...row, remaining: "12" }, { ...row, paused: "false" }, null]) {
    current = row; await h.load(); assert.notEqual(h.html(variant), "");
    current = invalid; await h.load(); assert.equal(h.html(variant), "");
    assert.equal(h.buyable(variant), true, "backend separately enforces new-intake availability");
  }
  current = row; ok = false; await h.load(); assert.equal(h.html(variant), "");
});

test("pause uses a disabled purchase button without a waitlist or deleting the cart", async () => {
  let current = { ...row, paused: true };
  const h = harness({ fetch: async () => reply(current) });
  await h.load();
  const state = h.detailState(product);
  assert.equal(h.statusOf(variant), "paused");
  assert.equal(state.button.textContent, "Orders paused");
  assert.equal(state.button.disabled, true);
  assert.ok(!state.classes.includes("is-waitlist"));
  assert.equal(h.sanitizeCart([{ id: product.id, build: variant.id, qty: 2 }]).length, 1);
  current = { ...row, paused: false }; await h.load();
  assert.equal(h.buyable(variant), true);
});

test("a hung production read cannot delay store rendering and is bounded", async () => {
  let finishTimeout, timeoutMs, aborted = false;
  const h = harness({
    document: { readyState: "loading", addEventListener() {}, querySelector(s) { return s === "#store-grid" ? {} : null; }, querySelectorAll() { return []; },
      body: { getAttribute() { return null; } }, documentElement: { getAttribute() { return null; } } },
    fetch: () => new Promise(() => {}),
    AbortController: class { constructor() { this.signal = {}; } abort() { aborted = true; } },
    setTimeout(fn, ms) { finishTimeout = fn; timeoutMs = ms; return 1; }, clearTimeout() {},
  });
  const state = h.boot();
  assert.equal(state.visible, true);
  assert.equal(h.buyable(variant), true);
  assert.equal(h.html(variant), "");
  assert.equal(timeoutMs, 2500);
  finishTimeout();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborted, true);
  assert.equal(h.html(variant), "");
});

test("checkout refresh updates only batch subtitle nodes through rollover and read failure", async () => {
  let calls = 0, current = row, failed = false;
  const labels = Array.from({ length: 2 }, () => ({
    dataset: { productionBatchLabel: "avian-visitors", variantLabel: "Assembled" }, textContent: "Assembled",
  }));
  const checkout = { querySelector() { return null; }, __cartChanged() { throw new Error("must not requote payment"); } };
  const h = harness({
    document: { readyState: "loading", addEventListener() {}, querySelector(s) { return s === "#checkout" ? checkout : null; },
      querySelectorAll(s) { assert.equal(s, "[data-production-batch-label]"); return labels; },
      body: { getAttribute() { return null; } }, documentElement: { getAttribute() { return null; } } },
    fetch: async () => { calls += 1; if (failed) throw new Error("offline"); return reply(current); },
  });
  const state = h.boot(); h.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "an in-flight read is shared by the initial checkout and refresh");
  assert.deepEqual(labels.map((label) => label.textContent), ["Batch 3", "Batch 3"]);
  current = { ...row, ordinal: 4, remaining: 15 }; h.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(labels.map((label) => label.textContent), ["Batch 4", "Batch 4"]);
  failed = true; h.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(labels.map((label) => label.textContent), ["Assembled", "Assembled"]);
  assert.equal(calls, 3);
  assert.equal(state.checkoutRenders, 1);
});

test("cart and checkout use the current batch subtitle without counts or changing the cart", async () => {
  let current = row;
  const h = harness({ fetch: async () => reply(current) });
  const line = { id: product.id, build: variant.id, qty: 2 };
  for (const [snapshot, expected] of [[null, "Assembled"], [row, "Batch 3"], [{ ...row, ordinal: 4 }, "Batch 4"], [null, "Assembled"]]) {
    current = snapshot; await h.load();
    for (const html of [h.drawerState(line).items.innerHTML, h.coLineHTML(line, 0)]) {
      assert.match(html, new RegExp('data-production-batch-label="avian-visitors" data-variant-label="Assembled">' + expected + '</span>'));
      assert.doesNotMatch(html, /frames? remaining|pe-batch-remaining|productionBatches/);
    }
    assert.deepEqual(plain(h.cart()), [line], "display refresh never binds a cart to an ordinal");
  }
});

test("opening the drawer off the store loads a fresh batch without delaying its opening", async () => {
  let resolveRead, calls = 0;
  const label = { dataset: { productionBatchLabel: "avian-visitors", variantLabel: "Assembled" }, textContent: "Assembled" };
  const h = harness({
    location: { hostname: "localhost", pathname: "/projects/avian-visitors/", search: "", hash: "", origin: "http://localhost" },
    document: { readyState: "loading", addEventListener() {}, querySelector() { return null; },
      querySelectorAll() { return [label]; }, body: { getAttribute() { return null; } }, documentElement: { getAttribute() { return null; } } },
    fetch: () => { calls += 1; return new Promise((resolve) => { resolveRead = resolve; }); },
  });
  const state = h.drawerState({ id: product.id, build: variant.id, qty: 1 });
  h.openCart();
  assert.equal(state.classes.has("is-open"), true);
  assert.equal(calls, 1);
  assert.equal(label.textContent, "Assembled");
  resolveRead(reply(row));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(label.textContent, "Batch 3");
});

test("fixed legacy batch variants keep their own labels on cart and checkout", async () => {
  const h = harness({ fetch: async () => reply({ ...row, ordinal: 9 }) });
  const legacy = [1, 2].map((ordinal) => ({ ...variant, id: "assembled-batch-" + ordinal,
    label: "Assembled (Batch " + ordinal + ")", productionBatchGroup: undefined }));
  h.setProducts([{ ...product, variants: [variant, ...legacy] }]);
  await h.load();
  for (const fixed of legacy) {
    const line = { id: product.id, build: fixed.id, qty: 1 };
    for (const html of [h.drawerState(line).items.innerHTML, h.coLineHTML(line, 0)]) {
      assert.ok(html.includes(fixed.label));
      assert.doesNotMatch(html, /Batch 9|data-production-batch-label/);
    }
  }
});

test("unbound old frame carts migrate and merge without rewriting historical receipts", () => {
  let stored = JSON.stringify([{ id: product.id, build: "assembled-batch-2", qty: 2 }, { id: product.id, build: variant.id, qty: 1 }]);
  const h = harness({ localStorage: { getItem() { return stored; }, setItem(_key, value) { stored = value; } } });
  h.loadCart();
  assert.deepEqual(JSON.parse(stored), [{ id: product.id, build: variant.id, qty: 3 }]);
  assert.equal(h.migratedLine({ id: product.id, build: "assembled-batch-2", qty: 2 }).build, "assembled-batch-2");
  assert.match(h.confLineHTML({ id: product.id, build: "assembled-batch-2", qty: 2 }), /Assembled \(Batch 2\)/);
});

test("paid allocations stay attached to their order when the public run advances", async () => {
  const h = harness({ fetch: async () => reply({ ...row, ordinal: 9 }) });
  await h.load();
  const html = h.confLineHTML({ id: product.id, build: variant.id, qty: 3,
    productionBatches: [{ ordinal: 3, label: "Batch 3", quantity: 1 }, { ordinal: 4, label: "Batch 4", quantity: 2 }] });
  assert.match(html, /Assembled &times; 3/);
  assert.match(html, /Batch 3 &times; 1 · Batch 4 &times; 2/);
  assert.doesNotMatch(html, /Batch 9/);
});
