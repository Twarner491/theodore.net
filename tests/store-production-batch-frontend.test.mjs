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
      selectVariant: (value, quantity) => { build = value; qty = quantity; updateVariant(false); },
      load: loadProductionBatches, refresh: refreshProductionBatches, html: productionBatchHTML,
      buyable, statusOf, variantMaxQuantity, sanitizeCart, migratedLine, confLineHTML, coLineHTML, detailHTML,
      loadCart, openCart, checkout, cart: () => cart, canIncreaseQuantity, accAddHTML, syncLineQuantityControls,
      refreshSurfaces: refreshProductionBatchSurfaces, reconcile: reconcileCartToProductionBatches,
      mutations: function (lines) {
        cart = lines;
        renderCart = updateBadge = openCart = function () {};
        return { add: addToCart, set: setCartQty, line: setLineQty, cart: () => cart };
      },
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
      detailState: function (product, selectedQuantity = 1) {
        const classes = new Set();
        const classList = { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } };
        const fields = {
          '.pe-box-contents': { innerHTML: '' }, '.pe-qty span': { textContent: '' },
          '.pe-price': { innerHTML: '' }, '.pe-qty': { style: {} },
          '.pe-buy': { classList, style: {}, innerHTML: '', textContent: '', disabled: false },
          '.pe-batch': { classList, innerHTML: '', hidden: true },
        };
        root = { querySelector: selector => fields[selector] || null, querySelectorAll: () => [] };
        P = product; build = product.defaultBuild; qty = selectedQuantity;
        updateVariant(false);
        return { batch: fields['.pe-batch'], button: fields['.pe-buy'], classes: [...classes], quantity: qty, limit: detailQuantityLimit() };
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

test("the current real remainder caps the cart and rollover permits the next batch up to twenty", async () => {
  let current = { ...row, remaining: 1 };
  const h = harness({ fetch: async () => reply(current) });
  await h.load();
  assert.match(h.html(variant), /1 frame remaining/);
  assert.equal(h.variantMaxQuantity(product.id, variant.id), 1);
  assert.deepEqual(plain(h.sanitizeCart([{ id: product.id, build: variant.id, qty: 4 }])), [{ id: product.id, build: variant.id, qty: 1 }]);
  current = { ...row, ordinal: 4, remaining: 29 };
  await h.load();
  assert.match(h.html(variant), /Batch 4/);
  assert.equal(h.variantMaxQuantity(product.id, variant.id), 20);
  assert.equal(h.buyable(variant), true);
  assert.equal(variant.id, "assembled-continuous");
});

test("Meta cart events use the catalog identity and only actual successful quantity increases", async () => {
  const events = [], listed = { ...product, metaCatalogId: 'avian-visitors' };
  const h = harness({ fetch: async () => reply({ ...row, remaining: 3 }),
    window: { addEventListener() {}, STORE_PRODUCTS: [listed], TheodoreMetaTracking: {
      itemEvent(name, item) { events.push({ name, item: plain(item) }); },
    } } });
  h.setProducts([listed]); await h.load();
  const m = h.mutations([]);
  m.add(product.id, variant.id, 20);
  assert.deepEqual(events, [{ name: 'AddToCart', item: { id: 'avian-visitors', quantity: 3, value: 2097 } }]);
  m.add(product.id, variant.id, 1); m.set(product.id, variant.id, 20); m.line(0, 20);
  assert.equal(events.length, 1, 'blocked or clamped no-op additions do not count');
  m.line(0, 1); m.set(product.id, variant.id, 2); m.line(0, 3);
  assert.deepEqual(events.slice(1), [1, 1].map((quantity) => ({ name: 'AddToCart',
    item: { id: 'avian-visitors', quantity, value: 699 } })));
  m.set(product.id, variant.id, 0);
  assert.equal(events.length, 3, 'removing items never counts as an addition');
});

test("Meta product views follow the displayed variant and not the selected purchase quantity", () => {
  const events = [], mic = { id: 'avian-mic', title: 'Bird Mic', published: true, defaultBuild: 'electronics',
    variants: [{ id: 'electronics', price: 50, contents: [] }, { id: 'electronics-printed', price: 60, contents: [] }] };
  const h = harness({ window: { addEventListener() {}, STORE_PRODUCTS: [mic], TheodoreMetaTracking: {
    itemEvent(name, item) { events.push({ name, item: plain(item) }); },
  } } });
  h.setProducts([mic]); h.detailState(mic, 3); h.selectVariant('electronics-printed', 4);
  assert.deepEqual(events, [
    { name: 'ViewContent', item: { id: 'avian-mic-electronics', quantity: 1, value: 50 } },
    { name: 'ViewContent', item: { id: 'avian-mic-electronics-printed', quantity: 1, value: 60 } },
  ]);
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
  const checkout = { querySelector() { return null; }, querySelectorAll() { return []; }, __cartChanged() { throw new Error("must not requote payment"); } };
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


test("all quantity entry points cap accumulated additions and product selection at remaining room", async () => {
  const h = harness({ fetch: async () => reply({ ...row, remaining: 3 }) });
  await h.load();
  const edit = h.mutations([{ id: product.id, build: variant.id, qty: 1 }]);
  assert.equal(h.detailState(product, 20).quantity, 2, "product quantity accounts for frames already in the cart");
  edit.add(product.id, variant.id, 20);
  assert.equal(edit.cart()[0].qty, 3);
  edit.add(product.id, variant.id, 1); edit.line(0, 4); edit.set(product.id, variant.id, 4);
  assert.equal(edit.cart()[0].qty, 3);
  assert.equal(h.detailState(product).button.disabled, true);
  assert.match(h.accAddHTML(product, variant.id), /data-q="1"[^>]* disabled/);
  assert.match(h.coLineHTML(edit.cart()[0], 0), /data-q="1"[^>]* disabled/);
  const plus = { dataset: { i: "0", q: "1" }, disabled: false }, minus = { dataset: { i: "0", q: "-1" }, disabled: false };
  h.syncLineQuantityControls({ querySelectorAll: () => [minus, plus] });
  assert.equal(plus.disabled, true); assert.equal(minus.disabled, false);
  edit.line(0, 2); assert.equal(edit.cart()[0].qty, 2);
  assert.equal(h.detailState(product, 20).quantity, 1);
  assert.equal(h.canIncreaseQuantity(product.id, variant.id), true);
});

test("failed authority preserves saved quantities but blocks all additions until a genuine snapshot returns", async () => {
  let current = null;
  const h = harness({ fetch: async () => reply(current) });
  const line = { id: product.id, build: variant.id, qty: 4 }, edit = h.mutations([line]);
  await h.load();
  assert.equal(h.reconcile(), false);
  assert.equal(edit.cart()[0].qty, 4);
  edit.add(product.id, variant.id, 1); edit.line(0, 5); edit.set(product.id, variant.id, 6);
  assert.equal(edit.cart()[0].qty, 4);
  edit.line(0, 3); assert.equal(edit.cart()[0].qty, 3, "decrease and removal remain available");
  current = { ...row, remaining: 2 }; await h.load();
  assert.equal(h.reconcile(), true); assert.equal(edit.cart()[0].qty, 2);
  current = null; await h.load();
  assert.equal(h.reconcile(), false); assert.equal(edit.cart()[0].qty, 2);
  current = { ...row, ordinal: 4, remaining: 15 }; await h.load(); h.reconcile();
  edit.add(product.id, variant.id, 30); assert.equal(edit.cart()[0].qty, 15);
});

test("restored duplicate lines clamp to a new snapshot, persist changes, and zero never produces a phantom quantity", async () => {
  let stored = JSON.stringify([{ id: product.id, build: variant.id, qty: 8 }, { id: product.id, build: variant.id, qty: 8 }]);
  let current = { ...row, remaining: 5 };
  const h = harness({ fetch: async () => reply(current), localStorage: {
    getItem(key) { return key === "store:cart:v3" ? stored : null; },
    setItem(key, value) { if (key === "store:cart:v3") stored = value; },
  } });
  h.loadCart(); assert.equal(h.cart()[0].qty, 16, "initial missing data cannot erase a real cart");
  await h.load(); assert.equal(h.reconcile(), true);
  assert.equal(h.cart()[0].qty, 5); assert.equal(JSON.parse(stored)[0].qty, 5);
  current = { ...row, remaining: 0 }; await h.load(); h.reconcile();
  assert.deepEqual(plain(h.cart()), []); assert.equal(h.variantMaxQuantity(product.id, variant.id), 0);
  const edit = h.mutations([]); edit.add(product.id, variant.id, 1); edit.set(product.id, variant.id, 1);
  assert.deepEqual(plain(edit.cart()), []);
});

test("a processing checkout keeps its accepted quantity while ordinary refreshes reconcile and requote", async () => {
  let busy = false, requotes = 0;
  const summary = { innerHTML: "" }, host = { __checkoutBusy: () => busy, querySelector: s => s === ".co-summary" ? summary : null, querySelectorAll: () => [] };
  const h = harness({ fetch: async () => reply({ ...row, remaining: 2 }), document: {
    readyState: "loading", addEventListener() {}, querySelector: s => s === "#checkout" ? host : null, querySelectorAll: () => [],
    body: { getAttribute() { return null; } }, documentElement: { getAttribute() { return null; } },
  } });
  const edit = h.mutations([{ id: product.id, build: variant.id, qty: 4 }]);
  await h.load(); busy = true;
  h.refreshSurfaces(); edit.line(0, 1); edit.set(product.id, variant.id, 1);
  assert.equal(edit.cart()[0].qty, 4);
  busy = false; host.__cartChanged = () => { requotes++; };
  h.refreshSurfaces();
  assert.equal(edit.cart()[0].qty, 2); assert.equal(requotes, 1);
  h.refreshSurfaces(); assert.equal(requotes, 1, "unchanged snapshots do not continually invalidate payment");
});


test('the public cart checkout action reports catalog items before navigation without delaying or breaking it', async () => {
  const order = [], listed = { ...product, metaCatalogId: 'avian-visitors' };
  const mic = { id: 'avian-mic', published: true, defaultBuild: 'electronics-printed', variants: [{ id: 'electronics-printed', price: 60 }] };
  const location = { pathname: '/store/', search: '', hash: '', origin: 'https://theodore.net',
    set href(value) { order.push(['navigate', value]); } };
  const tracker = { checkoutEvent(items) { order.push(['checkout', plain(items)]); } };
  const h = harness({ location, window: { addEventListener() {}, STORE_PRODUCTS: [listed, mic], TheodoreMetaTracking: tracker } });
  h.setProducts([listed, mic]);
  h.mutations([{ id: listed.id, build: variant.id, qty: 2 }, { id: mic.id, build: mic.defaultBuild, qty: 1 }]);
  await h.checkout();
  assert.deepEqual(order, [['checkout', [{ id: 'avian-visitors', quantity: 2, value: 1398 },
    { id: 'avian-mic-electronics-printed', quantity: 1, value: 60 }]], ['navigate', '/store/checkout/']]);
  order.length = 0; tracker.checkoutEvent = () => { throw Error('optional tracker unavailable'); };
  await h.checkout(); assert.deepEqual(order, [['navigate', '/store/checkout/']]);
  order.length = 0; h.mutations([]); await h.checkout(); assert.deepEqual(order, []);
});
