import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const CODE = "PRIVATE_TEST_ONLY";
const cartLine = { id: "avian-visitors", build: "assembled-batch-2", qty: 1 };
const frameProduct = { id: "avian-visitors", title: "Avian Visitors", published: true, imageBase: "", images: [], variants: [{ id: "assembled-batch-2", label: "Assembled", price: 699, stripePrice: "price_test" }] };
const micProduct = { id: "avian-mic", title: "Bird Mic Kit", published: true, imageBase: "", images: [], defaultBuild: "electronics", variants: [
  { id: "electronics", label: "Electronics Kit", price: 180, stripePrice: "price_mic" },
  { id: "electronics-printed", label: "Kit with printed parts", price: 210, stripePrice: "price_printed" },
] };
const json = (body, status = 200) => ({ ok: status < 400, json: async () => body });
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

function element() {
  const classes = new Set();
  return {
    handlers: {}, value: "", textContent: "", innerHTML: "", hidden: false, disabled: false, style: {},
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
    },
    addEventListener(type, handler) { this.handlers[type] = handler; },
    attrs: {},
    setAttribute(k,v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() { this.focused = true; },
    closest() { return this; },
    querySelector() { return null; },
  };
}

async function harness({ respond, fetchUpdates, recoveryContext, attributionContext, stripeGate, products = [frameProduct], initialCart = [cartLine], sessionValues = new Map(), startPending = false } = {}) {
  const fields = {};
  for (const name of [".co-summary", ".co-voucher", ".co-voucher input", ".co-voucher button", ".co-voucher-msg", "[data-remove-voucher]", ".co-discount-row", ".co-discount", ".co-error", ".co-submit", ".co-total-val", ".co-tax", ".co-ship", "#co-email", "#co-news", "#co-form", "#co-gift", "#co-gift-from", "#co-gift-details", "#co-gift-error"]) fields[name] = element();
  fields["#co-email"].value = "buyer@example.com";
  fields[".co-cart-status"] = element();
  fields[".co-voucher-details"] = element();
  fields['.co-line-remove[data-rm="1"]'] = element();
  fields["#co-email"].reportValidity = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields["#co-email"].value);
  let summaryHtml = "";
  Object.defineProperty(fields[".co-summary"], "innerHTML", {
    get() { return summaryHtml; },
    set(value) {
      summaryHtml = value;
      rowsDirty = true;
      fields[".co-voucher-details"] = element();
      for (const key of ["#co-gift", "#co-gift-from", "#co-gift-details", "#co-gift-error"]) fields[key] = element();
    },
  });
  fields[".co-submit"].span = element();
  fields[".co-submit"].querySelector = () => fields[".co-submit"].span;
  fields[".co-voucher"].querySelector = (selector) => fields[".co-voucher " + selector];
  const shipping = element(), payment = element();
  shipping.classList.toggle("is-open", true);
  shipping.dataset = { sec: "shipping" }; payment.dataset = { sec: "payment" };
  for (const section of [shipping, payment]) {
    section.head = element(); section.body = element(); section.head.parentElement = section;
    section.body.inert = section === payment;
    section.querySelector = (selector) => selector === ".co-section-head" ? section.head : selector === ".co-section-body" ? section.body : null;
  }
  fields['.co-section[data-sec="payment"]'] = payment;
  let accessoryRows = [], rowsDirty = true;
  function makeAccessoryRows() {
    if (!rowsDirty) return accessoryRows;
    rowsDirty = false;
    const html = summaryHtml || host.innerHTML;
    accessoryRows = html.split('<div class="product-card product-card--mini co-accessory"').slice(1).map((markup) => {
      const id = markup.match(/data-acc="([^"]+)"/)[1], build = markup.match(/data-build="([^"]+)"/)[1];
      const buttons = Array.from(markup.matchAll(/<button\b([^>]*)>/g), ([, attrs]) => {
        const button = element(), q = attrs.match(/data-q="([^"]+)"/);
        button.dataset = q ? { q: q[1] } : {};
        return button;
      });
      return { dataset: { acc: id, build }, buttons, button: buttons.at(-1), querySelector(selector) {
        if (selector === ".pc-add") return buttons.find((b) => !b.dataset.q) || null;
        const q = selector.match(/data-q="([^"]+)"/);
        return q ? buttons.find((b) => b.dataset.q === q[1]) || null : null;
      }, querySelectorAll() { return buttons; } };
    });
    return accessoryRows;
  }
  const host = { innerHTML: "", querySelector(selector) {
    if (selector === ".co-error") {
      const first = this.innerHTML.match(/<p[^>]*class="[^"]*\bco-error\b[^"]*"[^>]*>/);
      const id = first && first[0].match(/id="([^"]+)"/);
      if (id) return fields["#" + id[1]];
    }
    return fields[selector] || null;
  }, querySelectorAll(selector) {
    if (selector === ".co-section") return [shipping, payment];
    if (selector === ".co-section-head") return [shipping.head, payment.head];
    if (selector === ".co-accessory") return makeAccessoryRows();
    return [];
  } };
  let hostHtml = "", fullRenders = 0;
  Object.defineProperty(host, "innerHTML", { get() { return hostHtml; }, set(value) {
    hostHtml = value; summaryHtml = ""; rowsDirty = true;
    if (++fullRenders > 1) { fields["#co-email"].value = ""; fields["#co-news"].checked = false; }
  } });
  const confirmation = { innerHTML: "" };
  const addressHandlers = {}, windowHandlers = {};
  const requests = [], telemetry = [], stored = [], createdElements = [];
  let savedCart = JSON.stringify(initialCart);
  let confirmations = 0, intents = 0;
  const stripeElements = {
    create(type, options) {
      const instance = { type, options, handlers: {}, mount() {}, destroy() { this.destroyed = true; }, on(event, handler) {
        this.handlers[event] = handler;
        if (type === "address") addressHandlers[event] = handler; else if (event === "ready") handler();
      } };
      createdElements.push(instance); return instance;
    },
    fetchUpdates: fetchUpdates || (async () => {}), update() {},
  };
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    PRODUCTS = globalThis.products;
    cart = [globalThis.cartLine];
    renderCart = function () {}; swapProductImages = function () {}; reveal = function () {}; updateBadge = function () {};
    track = function (...args) { globalThis.telemetry.push(args); }; ga4 = function (...args) { globalThis.telemetry.push(args); }; evAttribution = function () { return globalThis.attributionContext ? globalThis.attributionContext() : {}; };
    checkoutAppearance = function () { return {}; };
    if (globalThis.stripeGate) loadStripe = function () { return globalThis.stripeGate; };
    if (globalThis.recoveryContext) localRecovery = { checkoutContext: globalThis.recoveryContext, recordCart() {} };
    globalThis.runCheckout = renderCheckout;
    globalThis.runConfirmation = renderConfirmation;
    globalThis.runOrder = function (data) { renderOrder(globalThis.confirmation, data); };
    globalThis.changeCart = function (lines) { cart = lines; saveCart(); coRefreshSummary(globalThis.host); };
    globalThis.removeLastLine = function () { setLineQty(0, 0); coRefreshSummary(globalThis.host); };
    globalThis.rebuildSummary = function () { $(".co-summary", globalThis.host).innerHTML = coSummaryHTML(); coWireSummary(globalThis.host); };
    globalThis.refreshStock = function (rows) { INVENTORY_ROWS = rows; INVENTORY_READY = true; refreshInventorySurfaces(); };
    globalThis.refreshBatch = async function () { await loadProductionBatches(); refreshProductionBatchSurfaces(); };
    globalThis.readCart = () => cart;
  })();`);
  const context = vm.createContext({
    document: {
      readyState: "loading", addEventListener() {},
      querySelector(selector) { return selector === "#checkout" ? host : selector === "#confirmation" ? confirmation : null; },
      querySelectorAll() { return []; }, body: {}, documentElement: {},
    },
    window: { addEventListener(name, fn) { windowHandlers[name] = fn; }, Stripe() { return { elements: () => stripeElements, confirmPayment: async () => { confirmations += 1; return { error: { message: "Test confirmation complete" } }; } }; } },
    sessionStorage: { getItem(key) { return sessionValues.get(key) || null; }, setItem(key,value) { sessionValues.set(key,value); }, removeItem(key) { sessionValues.delete(key); } },
    localStorage: { getItem(key) { return key === "store:cart:v3" ? savedCart : null; }, setItem(...args) { stored.push(args); if (args[0] === "store:cart:v3") savedCart = args[1]; } },
    location: { origin: "https://example.test", pathname: "/store/checkout/", search: "", hostname: "example.test" },
    URLSearchParams, setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} },
    host, cartLine: { ...cartLine }, products, confirmation, telemetry, recoveryContext, attributionContext, stripeGate,
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : {}; requests.push({ url, body });
      if (respond) { const response = await respond(url, body); if (response) return response; }
      if (url === "/api/voucher") return json({ discount: 10000, discountLabel: "Friends and family" });
      if (url === "/api/payment-intent") {
        const intentId = body.paymentIntentId || "pi_test" + (++intents);
        const discount = body.voucherCode ? 10000 : 0;
        const subtotal = body.cart.reduce((total, line) => total + products.find((p) => p.id === line.id).variants.find((v) => v.id === line.build).price * 100 * line.qty, 0);
        return json({ clientSecret: intentId + "_secret_example", publishableKey: "pk_test", updateToken: "token_" + intentId, subtotal, discount, shipping: body.shipping ? 1500 : null, tax: body.shipping ? 0 : null, total: subtotal - discount + (body.shipping ? 1500 : 0) });
      }
      throw new Error("Unexpected request " + url);
    },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  const ready = context.runCheckout();
  if (!stripeGate && !startPending) {
    await ready;
    for (let i = 0; i < 5 && typeof host.__applyVoucher !== "function"; i++) await settle();
    assert.equal(typeof host.__applyVoucher, "function", fields[".co-error"].textContent || "checkout initialization should finish before using the voucher field");
  }
  return {
    host, fields, requests, telemetry, stored, confirmation, sessionValues, createdElements, ready, shippingSection: shipping, paymentSection: payment,
    gift(enabled, from = "") { fields["#co-gift"].checked = enabled; fields["#co-gift"].handlers.change(); if (enabled) { fields["#co-gift-from"].value = from; fields["#co-gift-from"].handlers.input(); } },
    apply: (code) => host.__applyVoucher(code),
    edit(code) { fields[".co-voucher input"].value = code; host.__editVoucher(); },
    shipping(address = {}) { addressHandlers.change({ complete: true, value: { name: "Test", address: { country: "US", state: "CA", postal_code: "94110", line1: "Test", ...address } } }); },
    partialShipping(address = {}) { addressHandlers.change({ complete: false, value: { name: "Test", address: { country: "US", state: "CA", postal_code: "", line1: "Test", ...address } } }); },
    changeCart: (lines) => context.changeCart(lines),
    accessoryRows: () => accessoryRows,
    addAccessory(id) {
      const row = accessoryRows.find((row) => row.dataset.acc === id);
      row.button.handlers.click();
    },
    subtractAccessory(id) { accessoryRows.find((row) => row.dataset.acc === id).buttons.find((b) => b.dataset.q === "-1").handlers.click(); },
    removeLastLine: () => context.removeLastLine(),
    rebuildSummary: () => context.rebuildSummary(),
    refreshStock: (rows) => context.refreshStock(rows),
    refreshBatch: () => context.refreshBatch(),
    cart: () => JSON.parse(JSON.stringify(context.readCart())),
    storageCart(lines) { savedCart = JSON.stringify(lines); windowHandlers.storage({ key: "store:cart:v3" }); },
    continueToPayment: () => fields["#co-form"].handlers.submit({ preventDefault() {} }),
    async pay() {
      if (!payment.classList.contains("is-open")) await fields["#co-form"].handlers.submit({ preventDefault() {} });
      return fields["#co-form"].handlers.submit({ preventDefault() {} });
    },
    confirmations: () => confirmations,
    async canceledOrder() { context.location.search = "?payment_intent=pi_test&payment_intent_client_secret=pi_test_secret_example&redirect_status=succeeded"; await context.runConfirmation(); },
    order: (data) => context.runOrder(data),
  };
}

test("checkout stops at the receipt field and only confirms after saving a valid email", async () => {
  const h = await harness();
  h.fields["#co-email"].value = "";
  h.shipping();
  await settle();
  await h.pay();
  assert.equal(h.confirmations(), 0);
  assert.equal(h.requests.some((r) => r.body.finalize), false);
  h.fields["#co-email"].value = "buyer@example";
  await h.pay();
  assert.equal(h.confirmations(), 0);
  h.fields["#co-email"].value = "buyer@example.com";
  await h.pay();
  assert.equal(h.confirmations(), 1);
  assert.equal(h.requests.at(-1).body.finalize, true);
  assert.equal(h.requests.at(-1).body.email, "buyer@example.com");
});

test("summary and initial quote do not wait for Stripe, and finite edits during SDK loading discard stale scope", async () => {
  const sdk = deferred();
  const finiteFrame = { ...frameProduct, variants: frameProduct.variants.map((v) => ({ ...v, inventorySku: "frame-batch" })) };
  const micLine = { id: micProduct.id, build: "electronics", qty: 1 };
  const checkout = await harness({ stripeGate: sdk.promise, products: [finiteFrame, micProduct], initialCart: [micLine] });
  await settle();
  assert.match(checkout.host.innerHTML, /Bird Mic Kit/);
  assert.equal(checkout.requests.length, 1, "the first PI request runs while the SDK loads");
  assert.equal(checkout.createdElements.length, 0);
  assert.equal(checkout.fields[".co-submit"].disabled, true);
  checkout.refreshStock({ "frame-batch": { available: 4, soldOut: false } });
  checkout.changeCart([micLine, cartLine]);
  checkout.gift(true, "Alec and Darci");
  sdk.resolve(true); await checkout.ready; await settle();
  const creates = checkout.requests.filter((r) => r.url === "/api/payment-intent" && !r.body.paymentIntentId);
  assert.equal(creates.length, 2);
  assert.equal(creates[1].body.cart.length, 2);
  assert.equal(checkout.createdElements.length, 2, "the old PI never mounts payment or address Elements");
  assert.equal(checkout.fields["#co-gift-from"].value, "Alec and Darci");
  checkout.shipping(); await settle();
  assert.equal(checkout.requests.at(-1).body.paymentIntentId, "pi_test2");
});

test("Stripe load failure keeps the summary editable and payment disabled", async () => {
  const sdk = deferred();
  const checkout = await harness({ stripeGate: sdk.promise });
  sdk.resolve(false); await checkout.ready;
  assert.match(checkout.host.innerHTML, /Avian Visitors/);
  assert.match(checkout.fields[".co-error"].textContent, /Payment could not load/);
  assert.equal(checkout.fields[".co-submit"].disabled, true);
  assert.equal(checkout.createdElements.length, 0);
  checkout.changeCart([{ ...cartLine, qty: 2 }]);
  assert.match(checkout.fields[".co-summary"].innerHTML, /2 &times;/);
});

test("address quotes leave shipping open until explicit Continue and closed sections are inert", async () => {
  const checkout = await harness();
  assert.equal(checkout.fields[".co-submit"].disabled, true);
  assert.equal(checkout.paymentSection.body.inert, true);
  checkout.shipping(); await settle();
  assert.equal(checkout.shippingSection.classList.contains("is-open"), true);
  assert.equal(checkout.paymentSection.body.inert, true);
  assert.equal(checkout.fields[".co-submit"].disabled, false);
  checkout.shipping({ line2: "Unit 2" }); await settle();
  assert.equal(checkout.shippingSection.classList.contains("is-open"), true);
  await checkout.continueToPayment();
  assert.equal(checkout.confirmations(), 0);
  assert.equal(checkout.shippingSection.body.inert, true);
  assert.equal(checkout.shippingSection.head.attrs["aria-expanded"], "false");
  assert.equal(checkout.paymentSection.body.inert, false);
  assert.equal(checkout.paymentSection.head.attrs["aria-expanded"], "true");
  assert.equal(checkout.fields["#co-email"].focused, true);
  checkout.shippingSection.head.handlers.click();
  checkout.shipping({ line2: "Unit 3" }); await settle();
  assert.equal(checkout.shippingSection.body.inert, false);
  assert.equal(checkout.paymentSection.body.inert, true);
});

const restrictedFrame = () => ({ ...frameProduct, variants: frameProduct.variants.map((v) => ({ ...v, shippingProfile: "contiguous-us-ground" })) });

test("assembled checkout starts with US-only countries and narrowing preserves a partial US draft", async () => {
  const initial = await harness({ products: [restrictedFrame()] });
  assert.deepEqual(Array.from(initial.createdElements.find((el) => el.type === "address").options.allowedCountries), ["US"]);
  const checkout = await harness({ products: [restrictedFrame(), { ...micProduct, related: [frameProduct.id] }], initialCart: [{ id: micProduct.id, build: "electronics", qty: 1 }] });
  checkout.partialShipping({ line2: "Unit 4" });
  checkout.addAccessory(frameProduct.id);
  const addresses = checkout.createdElements.filter((el) => el.type === "address");
  assert.equal(addresses.length, 2);
  assert.equal(addresses[0].destroyed, true);
  assert.deepEqual(Array.from(addresses[1].options.allowedCountries), ["US"]);
  assert.equal(addresses[1].options.defaultValues.name, "Test");
  assert.equal(addresses[1].options.defaultValues.address.line2, "Unit 4");
  assert.equal(addresses[1].options.defaultValues.address.postal_code, "");
  assert.equal(checkout.createdElements.filter((el) => el.type === "payment").length, 1);
  assert.equal(checkout.fields[".co-submit"].disabled, true);
});

test("a foreign draft is blocked intact until US is chosen, while only Address remounts", async () => {
  const micLine = { id: micProduct.id, build: "electronics", qty: 1 };
  const checkout = await harness({ products: [restrictedFrame(), { ...micProduct, related: [frameProduct.id] }], initialCart: [micLine] });
  checkout.shipping({ country: "CA", state: "ON", postal_code: "M5V 2T6", line2: "Unit 7" }); await settle();
  await checkout.apply(CODE);
  const foreignAddress = checkout.createdElements.find((el) => el.type === "address");
  const paymentUpdates = () => checkout.requests.filter((r) => r.url === "/api/payment-intent" && r.body.paymentIntentId);
  const previousUpdates = paymentUpdates().length;
  checkout.addAccessory(frameProduct.id); await settle();
  assert.equal(foreignAddress.destroyed, undefined);
  assert.equal(checkout.createdElements.filter((el) => el.type === "address").length, 1);
  assert.equal(paymentUpdates().length, previousUpdates);
  assert.equal(checkout.fields[".co-submit"].disabled, true);
  assert.match(checkout.fields[".co-error"].textContent, /Choose a US shipping address/);
  assert.equal(checkout.fields[".co-error"].hidden, false);
  assert.equal(checkout.requests.filter((r) => r.url === "/api/voucher").at(-1).body.cart.length, 2);
  checkout.shipping({ country: "US", state: "CA", postal_code: "94110", line2: "Unit 7" });
  assert.equal(foreignAddress.destroyed, true);
  const narrowed = checkout.createdElements.filter((el) => el.type === "address").at(-1);
  assert.equal(narrowed.options.defaultValues.address.line2, "Unit 7");
  assert.equal(narrowed.options.defaultValues.address.country, "US");
  foreignAddress.handlers.change({ complete: true, value: { name: "Stale", address: { country: "CA" } } });
  assert.equal(paymentUpdates().length, previousUpdates, "events from the destroyed Address cannot restore a quote");
  checkout.shipping({ line2: "Unit 7" }); await settle();
  assert.equal(paymentUpdates().at(-1).body.shipping.address.country, "US");
  checkout.changeCart([micLine]);
  const widened = checkout.createdElements.filter((el) => el.type === "address").at(-1);
  assert.deepEqual(Array.from(widened.options.allowedCountries), ["US", "CA", "AU", "GB"]);
  assert.equal(widened.options.defaultValues.address.line2, "Unit 7");
  assert.equal(widened.options.defaultValues.address.country, "US");
  assert.equal(checkout.createdElements.filter((el) => el.type === "payment").length, 1);
  assert.equal(checkout.requests.filter((r) => r.url === "/api/payment-intent" && !r.body.paymentIntentId).length, 1);
});

test("gift selection persists through a reload and reaches final payment without telemetry", async () => {
  const checkout = await harness();
  assert.equal(checkout.fields["#co-gift"].checked, false);
  assert.equal(checkout.fields["#co-gift-details"].hidden, true);
  checkout.gift(true, "  Alec and Darci  ");
  assert.equal(checkout.fields["#co-gift-details"].hidden, false);
  assert.equal(checkout.fields["#co-gift-from"].disabled, false);
  const reloaded = await harness({sessionValues: checkout.sessionValues});
  assert.equal(reloaded.fields["#co-gift"].checked, true);
  assert.equal(reloaded.fields["#co-gift-from"].value, "  Alec and Darci  ");
  reloaded.shipping(); await settle(); await reloaded.pay();
  assert.equal(reloaded.confirmations(), 1);
  const updates=reloaded.requests.filter(r=>r.body.paymentIntentId);
  assert.ok(updates.every(r=>r.body.gift===true && r.body.giftFrom==="Alec and Darci"));
  assert.ok(!JSON.stringify(reloaded.telemetry).includes("Darci"));
  assert.ok(!JSON.stringify(reloaded.stored).includes("Darci"));
});
test("unchecking erases the draft and clears gift metadata on the next payment attempt", async () => {
  const checkout=await harness(); checkout.gift(true,"Alec and Darci");
  checkout.shipping(); await settle();
  checkout.gift(false); await checkout.pay();
  const final=checkout.requests.filter(r=>r.body.paymentIntentId).at(-1).body;
  assert.equal(final.gift,false); assert.equal(final.giftFrom,"");
  assert.equal(checkout.fields["#co-gift-from"].disabled,true);
  assert.equal(checkout.sessionValues.has("store:gift:v1"),false);
});
test("sender validation blocks payment, focuses the field, and allows correction", async () => {
  const checkout=await harness(); checkout.shipping(); await settle();
  checkout.gift(true,"x".repeat(81)); await checkout.pay();
  assert.equal(checkout.confirmations(),0);
  assert.equal(checkout.fields["#co-gift-from"].attrs["aria-invalid"],"true");
  assert.equal(checkout.fields["#co-gift-from"].focused,true);
  assert.match(checkout.fields["#co-gift-error"].textContent,/80 characters/);
  checkout.gift(true,"Alec and Darci"); await checkout.pay();
  assert.equal(checkout.confirmations(),1);
  assert.equal(checkout.fields["#co-gift-error"].hidden,true);
});
test("changing gift names during an address quote keeps payment available and final sync current", async () => {
  const quote=deferred(); let count=0;
  const checkout=await harness({respond(url,body) { if(body.paymentIntentId && ++count===1) return quote.promise; }});
  checkout.shipping(); await settle(); checkout.gift(true,"Alec and Darci");
  quote.resolve(json({subtotal:69900,shipping:1500,tax:0,total:71400})); await settle();
  assert.equal(checkout.fields[".co-submit"].disabled,false);
  await checkout.pay();
  assert.equal(checkout.confirmations(),1);
  assert.equal(checkout.requests.filter(r=>r.body.paymentIntentId).at(-1).body.giftFrom,"Alec and Darci");
});
test("order confirmation escapes attribution and omits it for ordinary orders", async () => {
  const checkout=await harness();
  checkout.order({items:[],gift:true,giftFrom:"<Alec & Darci>"});
  assert.match(checkout.confirmation.innerHTML,/From: &lt;Alec &amp; Darci&gt;/);
  checkout.order({items:[],gift:false,giftFrom:"Alec and Darci"});
  assert.ok(!checkout.confirmation.innerHTML.includes("From:"));
});

test("unfinished sender names do not deadlock the address quote or show errors before submit", async () => {
  const checkout=await harness(); checkout.gift(true,"x".repeat(81));
  checkout.shipping(); await settle();
  assert.equal(checkout.fields[".co-submit"].disabled,false);
  assert.equal(checkout.fields["#co-gift-error"].hidden,true);
  await checkout.pay(); assert.equal(checkout.confirmations(),0);
  checkout.gift(true,"Alec and Darci"); await checkout.pay();
  assert.equal(checkout.confirmations(),1);
  assert.equal(checkout.requests.filter(r=>r.body.paymentIntentId).at(-1).body.giftFrom,"Alec and Darci");
});

test("removing the final cart item clears its sender before a later cart", async () => {
  const checkout=await harness(); checkout.gift(true,"Alec and Darci");
  checkout.removeLastLine();
  assert.equal(checkout.sessionValues.has("store:gift:v1"),false);
  const later=await harness({sessionValues:checkout.sessionValues});
  assert.equal(later.fields["#co-gift"].checked,false);
  assert.equal(later.fields["#co-gift-from"].value,"");
});
test("ordinary checkout errors remain visible outside the collapsed gift field", async () => {
  const checkout=await harness(); await checkout.pay();
  assert.equal(checkout.fields["#co-gift-details"].hidden,true);
  assert.equal(checkout.fields[".co-error"].hidden,false);
  assert.match(checkout.fields[".co-error"].textContent,/shipping address/);
  assert.equal(checkout.fields["#co-gift-error"].textContent,"");
});

test("gift controls are below the voucher in the summary and belong to the payment form", async () => {
  const checkout = await harness();
  const summary = checkout.host.innerHTML.split('<aside class="co-summary">')[1].split('</aside>')[0];
  assert.ok(summary.indexOf('class="co-gift"') > summary.indexOf('data-remove-voucher'));
  assert.match(summary, /id="co-gift" name="gift" form="co-form"/);
  assert.match(summary, /id="co-gift-from" name="giftFrom" form="co-form"/);
  assert.equal((checkout.host.innerHTML.match(/id="co-gift"/g) || []).length, 1);
});
test("quantity changes rebuild gift controls while retaining names and live handlers", async () => {
  const checkout = await harness(); checkout.gift(true, "Alec and Darci");
  checkout.shipping(); await settle();
  const oldInput = checkout.fields["#co-gift-from"];
  checkout.changeCart([{...cartLine, qty: 2}]); await settle();
  assert.notEqual(checkout.fields["#co-gift-from"], oldInput, "summary DOM is recreated");
  assert.equal(checkout.fields["#co-gift"].checked, true);
  assert.equal(checkout.fields["#co-gift-from"].value, "Alec and Darci");
  checkout.gift(false);
  assert.equal(checkout.fields["#co-gift-from"].value, "");
  checkout.gift(true, "Darci and Alec"); await checkout.pay();
  assert.equal(checkout.confirmations(), 1);
  const final = checkout.requests.filter(r=>r.body.paymentIntentId).at(-1).body;
  assert.equal(final.giftFrom, "Darci and Alec"); assert.equal(final.cart[0].qty, 2);
});
test("sender errors survive summary replacement and clear through the replacement checkbox", async () => {
  const checkout = await harness(); checkout.shipping(); await settle();
  checkout.gift(true, "x".repeat(81)); await checkout.pay();
  const oldError = checkout.fields["#co-gift-error"];
  checkout.changeCart([{...cartLine, qty: 2}]); await settle();
  assert.notEqual(checkout.fields["#co-gift-error"], oldError);
  assert.equal(checkout.fields["#co-gift-error"].hidden, false);
  assert.match(checkout.fields["#co-gift-error"].textContent, /80 characters/);
  assert.equal(checkout.fields["#co-gift-from"].attrs["aria-invalid"], "true");
  checkout.gift(false);
  assert.equal(checkout.fields["#co-gift-error"].hidden, true);
  assert.equal(checkout.fields["#co-gift-from"].attrs["aria-invalid"], undefined);
  checkout.gift(true); assert.equal(checkout.fields["#co-gift-from"].value, "");
});
test("replacement gift controls stay disabled until final payment sync finishes", async () => {
  const refresh = deferred(); let updates = 0;
  const checkout = await harness({fetchUpdates() { return ++updates === 2 ? refresh.promise : Promise.resolve(); }});
  checkout.gift(true, "Alec and Darci"); checkout.shipping(); await settle();
  const payment = checkout.pay(); await settle();
  checkout.rebuildSummary();
  assert.equal(checkout.fields["#co-gift"].disabled, true);
  assert.equal(checkout.fields["#co-gift-from"].disabled, true);
  assert.equal(checkout.fields["#co-gift-from"].value, "Alec and Darci");
  refresh.resolve(); await payment;
  assert.equal(checkout.fields["#co-gift"].disabled, false);
  assert.equal(checkout.fields["#co-gift-from"].disabled, false);
  assert.equal(checkout.confirmations(), 1);
});

test("a checkout accessory adds the printed build and requotes the existing address and voucher", async () => {
  const checkout = await harness({ products: [{ ...frameProduct, related: [micProduct.id] }, micProduct] });
  checkout.gift(true, "Alec and Darci");
  checkout.shipping(); await settle();
  await checkout.apply(CODE);
  checkout.addAccessory("avian-mic"); await settle();
  const update = checkout.requests.filter((r) => r.body.paymentIntentId).at(-1).body;
  assert.deepEqual(JSON.parse(JSON.stringify(update.cart)), [cartLine, { id: "avian-mic", build: "electronics-printed", qty: 1 }]);
  assert.equal(update.shipping.address.postal_code, "94110");
  assert.equal(update.voucherCode, CODE);
  assert.equal(update.gift, true);
  assert.equal(update.giftFrom, "Alec and Darci");
  assert.equal(checkout.fields["#co-email"].value, "buyer@example.com");
  assert.equal(checkout.fields[".co-total-val"].innerHTML, "$824.00");
  assert.equal(checkout.accessoryRows()[0].button.focused, true);
  assert.match(checkout.fields[".co-cart-status"].textContent, /Bird Mic Kit added.*\$909\.00/);
  assert.equal(checkout.accessoryRows().length, 1, "the chosen add-on keeps its quantity control");
  assert.deepEqual(checkout.accessoryRows()[0].buttons.map((b) => b.dataset.q), ["-1", "1"]);
  const addEvents = checkout.telemetry.filter(([name]) => name === "add_to_cart");
  assert.equal(addEvents.length, 2, "one first-party event and one GA event");
  assert.equal(addEvents[0][1].build, "electronics-printed");
  await checkout.pay();
  assert.equal(checkout.confirmations(), 1);
});

test("checkout accessory controls cannot mutate the cart while payment is being finalized", async () => {
  const final = deferred();
  const checkout = await harness({ products: [{ ...frameProduct, related: [micProduct.id] }, micProduct], respond: async (_url, body) => body.finalize ? final.promise : null });
  checkout.shipping(); await settle();
  const row = checkout.accessoryRows()[0];
  const payment = checkout.pay(); await settle();
  assert.equal(row.button.disabled, true);
  row.button.handlers.click();
  assert.equal(checkout.telemetry.some(([name]) => name === "add_to_cart"), false);
  final.resolve(json({ subtotal: 69900, discount: 0, shipping: 1500, tax: 0, total: 71400 }));
  await payment;
  assert.equal(checkout.confirmations(), 1);
});

test("checkout mini-card quantities add multiple, obey the cap, and return to plus at zero", async () => {
  const products = [{ ...frameProduct, related: [micProduct.id] }, { ...micProduct, variants: micProduct.variants.map((v) => ({ ...v, maxQuantity: 2 })) }];
  const checkout = await harness({ products });
  checkout.gift(true, "Alec and Darci"); checkout.shipping(); await settle();
  await checkout.apply(CODE);
  checkout.addAccessory("avian-mic"); await settle();
  checkout.addAccessory("avian-mic"); await settle();
  assert.equal(checkout.requests.at(-1).body.cart[1].qty, 2);
  assert.equal(checkout.fields[".co-total-val"].innerHTML, "$1,034.00");
  assert.equal(checkout.accessoryRows()[0].button.disabled, true);
  const cappedRequests = checkout.requests.length;
  checkout.addAccessory("avian-mic"); await settle();
  assert.equal(checkout.requests.length, cappedRequests);
  checkout.subtractAccessory("avian-mic"); await settle();
  assert.equal(checkout.requests.at(-1).body.cart[1].qty, 1);
  assert.equal(checkout.accessoryRows()[0].buttons[0].focused, true);
  checkout.subtractAccessory("avian-mic"); await settle();
  assert.equal(checkout.requests.at(-1).body.cart.length, 1);
  assert.equal(checkout.accessoryRows()[0].buttons.length, 1);
  assert.equal(checkout.accessoryRows()[0].button.dataset.q, undefined);
  assert.equal(checkout.accessoryRows()[0].button.focused, true);
  assert.equal(checkout.fields["#co-gift-from"].value, "Alec and Darci");
  assert.equal(checkout.fields[".co-voucher input"].value, CODE);
  assert.equal(checkout.fields[".co-voucher-details"].open, true);
  assert.equal(checkout.requests.filter((r) => r.url === "/api/payment-intent" && !r.body.paymentIntentId).length, 1, "ordinary add-on quantities keep their original PaymentIntent");
  assert.equal(checkout.createdElements.filter((el) => el.type === "payment").length, 1);
});

test("adding an add-on keeps the original recommendation set instead of introducing its accessories", async () => {
  const mount = { id: "mic-mount", title: "Mount", published: true, accessory: true, parentId: micProduct.id, order: 1, variants: [{ id: "default", label: "Mount", price: 15, stripePrice: "price_mount" }] };
  const extra = { ...mount, id: "mic-extra", title: "Extra", order: 2 };
  const checkout = await harness({ products: [{ ...frameProduct, related: [micProduct.id] }, micProduct, mount, extra] });
  const ids = () => checkout.accessoryRows().map((row) => row.dataset.acc);
  assert.deepEqual(ids(), [micProduct.id, mount.id]);
  checkout.addAccessory(micProduct.id); await settle();
  checkout.addAccessory(micProduct.id); await settle();
  assert.deepEqual(ids(), [micProduct.id, mount.id]);
});

test("finite-demand changes replace the PI while restoring checkout drafts and retaining recommendations", async () => {
  const finiteFrame = { ...restrictedFrame(), variants: restrictedFrame().variants.map((v) => ({ ...v, inventorySku: "frame-batch" })) };
  const micLine = { id: micProduct.id, build: "electronics", qty: 1 };
  const checkout = await harness({ products: [finiteFrame, { ...micProduct, related: [frameProduct.id] }], initialCart: [micLine] });
  checkout.refreshStock({ "frame-batch": { available: 4, soldOut: false } }); await settle();
  checkout.shipping({ line2: "Unit 7" }); await settle();
  checkout.gift(true, "Alec and Darci"); checkout.fields["#co-news"].checked = true;
  await checkout.apply(CODE); await checkout.continueToPayment();
  const originalPayment = checkout.createdElements.find((el) => el.type === "payment");
  checkout.addAccessory(frameProduct.id); await settle();
  const creates = () => checkout.requests.filter((r) => r.url === "/api/payment-intent" && !r.body.paymentIntentId);
  assert.equal(creates().length, 2);
  assert.equal(originalPayment.destroyed, true);
  assert.equal(checkout.fields["#co-email"].value, "buyer@example.com");
  assert.equal(checkout.fields["#co-news"].checked, true);
  assert.equal(checkout.fields["#co-gift-from"].value, "Alec and Darci");
  assert.equal(checkout.fields[".co-voucher input"].value, CODE);
  assert.match(checkout.host.innerHTML, /Please enter your payment details again/);
  assert.equal(checkout.createdElements.filter((el) => el.type === "address").at(-1).options.defaultValues.address.line2, "Unit 7");
  checkout.shipping({ line2: "Unit 7" }); await settle();
  const update = checkout.requests.filter((r) => r.body.paymentIntentId).at(-1).body;
  assert.equal(update.paymentIntentId, "pi_test2");
  assert.equal(update.updateToken, "token_pi_test2");
  assert.equal(update.voucherCode, CODE);
  assert.equal(update.cart.length, 2);
  checkout.addAccessory(frameProduct.id); await settle();
  assert.equal(creates().length, 3, "finite quantity is part of the signed scope");
  assert.equal(creates().at(-1).body.cart[1].qty, 2);
  checkout.changeCart([micLine]); await settle();
  assert.equal(creates().length, 4, "removing finite demand also replaces the scope");
  assert.deepEqual(checkout.accessoryRows().map((row) => row.dataset.acc), [frameProduct.id]);
});

test("finite replacement before payment preserves a voucher draft without a re-entry notice", async () => {
  const finiteFrame = { ...frameProduct, variants: frameProduct.variants.map((v) => ({ ...v, inventorySku: "frame-batch" })) };
  const checkout = await harness({ products: [finiteFrame, { ...micProduct, related: [frameProduct.id] }], initialCart: [{ id: micProduct.id, build: "electronics", qty: 1 }] });
  checkout.refreshStock({ "frame-batch": { available: 2, soldOut: false } }); await settle();
  checkout.edit("UNAPPLIED_DRAFT"); checkout.addAccessory(frameProduct.id); await settle();
  assert.equal(checkout.fields[".co-voucher input"].value, "UNAPPLIED_DRAFT");
  assert.equal(checkout.fields[".co-voucher-details"].open, true);
  assert.equal(checkout.fields[".co-submit"].disabled, true);
  assert.doesNotMatch(checkout.host.innerHTML, /Please enter your payment details again/);
});

test("an add-on becoming unavailable cannot silently add a different build", async () => {
  const products = [{ ...frameProduct, related: [micProduct.id] }, { ...micProduct, variants: micProduct.variants.map((v) => ({ ...v })) }];
  const checkout = await harness({ products });
  products[1].variants[1].status = "soldout";
  checkout.addAccessory("avian-mic");
  assert.equal(checkout.telemetry.some(([name]) => name === "add_to_cart"), false);
  assert.equal(checkout.requests.length, 1);
});

test("a finite recommendation appears after stock loads without restarting an ordinary checkout", async () => {
  const checkout = await harness({
    products: [
      { ...frameProduct, variants: [{ ...frameProduct.variants[0], inventorySku: "frame-stock" }] },
      { ...micProduct, related: [frameProduct.id] },
    ],
    initialCart: [{ id: "avian-mic", build: "electronics", qty: 1 }],
  });
  assert.equal(checkout.accessoryRows().length, 0);
  checkout.gift(true, "Alec and Darci");
  checkout.shipping(); await settle();
  checkout.refreshStock({ "frame-stock": { available: 1, soldOut: false } }); await settle();
  assert.deepEqual(checkout.accessoryRows().map((row) => row.dataset.acc), ["avian-visitors"]);
  assert.equal(checkout.fields["#co-gift-from"].value, "Alec and Darci");
  assert.equal(checkout.fields["#co-email"].value, "buyer@example.com");
  assert.equal(checkout.fields[".co-total-val"].innerHTML, "$195.00");
  assert.equal(checkout.requests.filter((r) => r.url === "/api/payment-intent" && !r.body.paymentIntentId).length, 1);
  assert.equal(checkout.requests.at(-1).body.shipping.address.postal_code, "94110");
});

test("the voucher disclosure starts closed and survives a checkout summary refresh", async () => {
  const checkout = await harness();
  assert.equal(checkout.fields[".co-voucher-details"].open, false);
  checkout.fields[".co-voucher-details"].open = true;
  checkout.fields[".co-voucher-details"].handlers.toggle();
  checkout.rebuildSummary();
  assert.equal(checkout.fields[".co-voucher-details"].open, true);
  await checkout.apply(CODE);
  checkout.rebuildSummary();
  assert.equal(checkout.fields[".co-voucher-details"].open, true);
  assert.equal(checkout.fields[".co-voucher input"].value, CODE);
  checkout.edit("MY_DRAFT"); checkout.rebuildSummary();
  assert.equal(checkout.fields[".co-voucher input"].value, "MY_DRAFT");
  assert.equal(checkout.fields[".co-voucher-details"].open, true);
});


const continuousProduct = { ...frameProduct, defaultBuild: "assembled-continuous", variants: [{
  ...frameProduct.variants[0], id: "assembled-continuous", maxQuantity: 20, productionBatchGroup: "avian-visitors",
}] };
const continuousLine = qty => ({ id: "avian-visitors", build: "assembled-continuous", qty });
const batchSnapshot = remaining => ({ group: "avian-visitors", ordinal: 3, remaining, paused: false });
const quantityError = remaining => json({ code: "production_quantity_limit", error: "Only " + remaining + " frames remain in the current batch. Please update your cart.",
  item: { id: "avian-visitors", build: "assembled-continuous" }, maxQuantity: remaining, currentOrdinal: 3 }, 409);

test("a restored continuous cart renders immediately but waits for the bounded batch read before creating its capped payment", async () => {
  const authority = deferred();
  const h = await harness({ products: [continuousProduct], initialCart: [continuousLine(20)], startPending: true,
    respond: (url) => url.startsWith("/api/production-batch?") ? authority.promise : null });
  assert.match(h.host.innerHTML, /Avian Visitors/);
  assert.equal(h.cart()[0].qty, 20);
  assert.equal(h.requests.filter(r => r.url === "/api/payment-intent").length, 0);
  const refresh = h.refreshBatch();
  assert.equal(h.requests.filter(r => r.url.startsWith("/api/production-batch?")).length, 1, "checkout and refresh share the in-flight authority read");
  authority.resolve(json(batchSnapshot(7))); await h.ready; await refresh;
  assert.equal(h.cart()[0].qty, 7);
  assert.equal(h.requests.find(r => r.url === "/api/payment-intent").body.cart[0].qty, 7);
  assert.equal(typeof h.host.__applyVoucher, "function");
});

test("a newer create-time limit reconciles the cart and restarts setup without a false sold-out error", async () => {
  let remaining = 15, rejected = false;
  const h = await harness({ products: [continuousProduct], initialCart: [continuousLine(10)], respond: (url, body) => {
    if (url.startsWith("/api/production-batch?")) return json(batchSnapshot(remaining));
    if (url === "/api/payment-intent" && !body.paymentIntentId && !rejected) { rejected = true; remaining = 3; return quantityError(3); }
  } });
  assert.equal(h.cart()[0].qty, 3);
  assert.deepEqual(h.requests.filter(r => r.url === "/api/payment-intent").map(r => r.body.cart[0].qty), [10, 3]);
  assert.doesNotMatch(h.fields[".co-error"].textContent, /no longer available/);
  assert.equal(h.createdElements.filter(e => e.type === "payment").length, 1);
});

test("a rejected final quantity stops confirmation, refreshes and requotes, then requires another reviewed payment click", async () => {
  let remaining = 4, rejected = false;
  const h = await harness({ products: [continuousProduct], initialCart: [continuousLine(4)], respond: (url, body) => {
    if (url.startsWith("/api/production-batch?")) return json(batchSnapshot(remaining));
    if (body.finalize && !rejected) { rejected = true; remaining = 2; return quantityError(2); }
  } });
  h.shipping(); await settle(); await h.pay(); await settle();
  assert.equal(h.confirmations(), 0); assert.equal(h.cart()[0].qty, 2);
  assert.ok(h.requests.some(r => r.body.paymentIntentId && !r.body.finalize && r.body.cart[0].qty === 2));
  assert.equal(h.createdElements.filter(e => e.type === "payment").length, 1, "continuous quantity correction keeps the same Payment Element");
  assert.doesNotMatch(h.fields[".co-error"].textContent, /no longer available/);
  await h.pay(); assert.equal(h.confirmations(), 1);
  assert.equal(h.requests.filter(r => r.body.finalize).at(-1).body.cart[0].qty, 2);
});

test("a processing payment ignores batch clamp and other-tab replacement; idle replacements reprice the current payment", async () => {
  let remaining = 4; const gate = deferred();
  const h = await harness({ products: [continuousProduct], initialCart: [continuousLine(4)], respond: (url, body) => {
    if (url.startsWith("/api/production-batch?")) return json(batchSnapshot(remaining));
    if (body.finalize) return gate.promise;
  } });
  h.shipping(); await settle(); const paying = h.pay(); await settle();
  remaining = 2; await h.refreshBatch(); h.storageCart([continuousLine(1)]);
  assert.equal(h.cart()[0].qty, 4);
  gate.resolve(json({ total: 69900 * 4 + 1500, subtotal: 69900 * 4, shipping: 1500, tax: 0, discount: 0 }));
  await paying; assert.equal(h.confirmations(), 1);
  h.storageCart([continuousLine(2)]); await settle();
  assert.equal(h.cart()[0].qty, 2);
  assert.ok(h.requests.some(r => r.body.paymentIntentId && !r.body.finalize && r.body.cart[0].qty === 2));
});


test("a rejected quote followed by rollover requotes unchanged quantities instead of leaving payment disabled", async () => {
  let current = batchSnapshot(4), rejected = false;
  const h = await harness({ products: [continuousProduct], initialCart: [continuousLine(4)], respond: (url, body) => {
    if (url.startsWith("/api/production-batch?")) return json(current);
    if (body.finalize && !rejected) { rejected = true; current = { ...batchSnapshot(15), ordinal: 4 }; return quantityError(2); }
  } });
  h.shipping(); await settle(); await h.pay(); await settle();
  assert.equal(h.confirmations(), 0); assert.equal(h.cart()[0].qty, 4);
  assert.ok(h.requests.filter(r => r.body.paymentIntentId && !r.body.finalize && r.body.cart[0].qty === 4).length >= 2);
  assert.equal(h.fields[".co-submit"].disabled, false, "the replacement batch permits a reviewed retry");
  await h.pay(); assert.equal(h.confirmations(), 1);
});


test("paid and Meta context are refreshed on initial creation, shipping quote, voucher, and final payment", async () => {
  let lastArm = "reel-a", consent = true;
  const context = () => ({ anon: "visitor12345678", source: "instagram",
    paidAttribution: { v: 1, experiment: "av-meta-nov26-v1", first: { arm: "reel-a" }, last: { arm: lastArm } },
    metaTracking: { consent, version: "meta-v1" } });
  const h = await harness({ attributionContext: context });
  const payments = () => h.requests.filter((request) => request.url === "/api/payment-intent");
  assert.equal(payments()[0].body.paidAttribution.last.arm, "reel-a");
  lastArm = "species";
  h.shipping(); await settle();
  assert.equal(payments().at(-1).body.paidAttribution.last.arm, "species");
  await h.apply(CODE);
  assert.equal(payments().at(-1).body.paidAttribution.first.arm, "reel-a");
  assert.equal(payments().at(-1).body.voucherCode, CODE);
  consent = false; lastArm = "photo";
  await h.pay();
  const final = payments().at(-1).body;
  assert.equal(final.finalize, true);
  assert.equal(final.paidAttribution.last.arm, "photo");
  assert.equal(final.metaTracking.consent, false);
  assert.equal(h.confirmations(), 1);
});
