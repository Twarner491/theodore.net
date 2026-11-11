import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const CODE = "PRIVATE_TEST_ONLY";
const cartLine = { id: "avian-visitors", build: "assembled-batch-2", qty: 1 };
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
    focus() { this.focused = true; },
    closest() { return this; },
    querySelector() { return null; },
  };
}

async function harness({ respond, fetchUpdates, recoveryContext } = {}) {
  const fields = {};
  for (const name of [".co-summary", ".co-voucher", ".co-voucher input", ".co-voucher button", ".co-voucher-msg", "[data-remove-voucher]", ".co-discount-row", ".co-discount", ".co-error", ".co-submit", ".co-total-val", ".co-tax", ".co-ship", "#co-email", "#co-news", "#co-form"]) fields[name] = element();
  fields["#co-email"].value = "buyer@example.com";
  fields["#co-email"].reportValidity = () => true;
  fields[".co-submit"].span = element();
  fields[".co-submit"].querySelector = () => fields[".co-submit"].span;
  fields[".co-voucher"].querySelector = (selector) => fields[".co-voucher " + selector];
  const shipping = element(), payment = element();
  shipping.classList.toggle("is-open", true);
  shipping.dataset = { sec: "shipping" }; payment.dataset = { sec: "payment" };
  fields['.co-section[data-sec="payment"]'] = payment;
  const host = { innerHTML: "", querySelector: (selector) => fields[selector] || null, querySelectorAll: (selector) => selector === ".co-section" ? [shipping, payment] : [] };
  const confirmation = { innerHTML: "" };
  const addressHandlers = {};
  const requests = [], telemetry = [], stored = [];
  let confirmations = 0;
  const stripeElements = {
    create(type) { return { mount() {}, on(event, handler) { if (type === "address") addressHandlers[event] = handler; else if (event === "ready") handler(); } }; },
    fetchUpdates: fetchUpdates || (async () => {}), update() {},
  };
  const original = readFileSync(new URL("../docs/assets/js/store.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, `
    PRODUCTS = [{ id: "avian-visitors", title: "Avian Visitors", published: true, imageBase: "", images: [], variants: [{ id: "assembled-batch-2", label: "Assembled", price: 699, stripePrice: "price_test" }] }];
    cart = [globalThis.cartLine];
    renderCart = function () {}; swapProductImages = function () {}; reveal = function () {}; updateBadge = function () {};
    track = function (...args) { globalThis.telemetry.push(args); }; ga4 = function (...args) { globalThis.telemetry.push(args); }; evAttribution = function () { return {}; };
    checkoutAppearance = function () { return {}; };
    if (globalThis.recoveryContext) localRecovery = { checkoutContext: globalThis.recoveryContext, recordCart() {} };
    globalThis.runCheckout = renderCheckout;
    globalThis.runConfirmation = renderConfirmation;
    globalThis.runOrder = function (data) { renderOrder(globalThis.confirmation, data); };
    globalThis.changeCart = function (lines) { cart = lines; coRefreshSummary(globalThis.host); };
  })();`);
  const context = vm.createContext({
    document: {
      readyState: "loading", addEventListener() {},
      querySelector(selector) { return selector === "#checkout" ? host : selector === "#confirmation" ? confirmation : null; },
      querySelectorAll() { return []; }, body: {}, documentElement: {},
    },
    window: { addEventListener() {}, Stripe() { return { elements: () => stripeElements, confirmPayment: async () => { confirmations += 1; return { error: { message: "Test confirmation complete" } }; } }; } },
    localStorage: { getItem(key) { return key === "store:cart:v3" ? JSON.stringify([cartLine]) : null; }, setItem(...args) { stored.push(args); } },
    location: { origin: "https://example.test", pathname: "/store/checkout/", search: "", hostname: "example.test" },
    URLSearchParams, setTimeout, clearTimeout, MutationObserver: class { observe() {} },
    host, cartLine: { ...cartLine }, confirmation, telemetry, recoveryContext,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); requests.push({ url, body });
      if (respond) { const response = await respond(url, body); if (response) return response; }
      if (url === "/api/voucher") return json({ discount: 10000, discountLabel: "Friends and family" });
      if (url === "/api/payment-intent") {
        const discount = body.voucherCode ? 10000 : 0;
        const subtotal = body.cart.reduce((total, line) => total + 69900 * line.qty, 0);
        return json({ clientSecret: "pi_test_secret_example", publishableKey: "pk_test", updateToken: "token", subtotal, discount, shipping: body.shipping ? 1500 : null, tax: body.shipping ? 0 : null, total: subtotal - discount + (body.shipping ? 1500 : 0) });
      }
      throw new Error("Unexpected request " + url);
    },
  });
  vm.runInContext(source, context, { filename: "store.js" });
  await context.runCheckout();
  assert.equal(typeof host.__applyVoucher, "function", fields[".co-error"].textContent || "checkout initialization should finish before using the voucher field");
  return {
    host, fields, requests, telemetry, stored, confirmation,
    apply: (code) => host.__applyVoucher(code),
    edit(code) { fields[".co-voucher input"].value = code; host.__editVoucher(); },
    shipping(address = {}) { addressHandlers.change({ complete: true, value: { name: "Test", address: { country: "US", state: "CA", postal_code: "94110", line1: "Test", ...address } } }); },
    changeCart: (lines) => context.changeCart(lines),
    async pay() {
      if (!payment.classList.contains("is-open")) await fields["#co-form"].handlers.submit({ preventDefault() {} });
      return fields["#co-form"].handlers.submit({ preventDefault() {} });
    },
    confirmations: () => confirmations,
    async canceledOrder() { context.location.search = "?payment_intent=pi_test&payment_intent_client_secret=pi_test_secret_example&redirect_status=succeeded"; await context.runConfirmation(); },
    order: (data) => context.runOrder(data),
  };
}

test("the existing field quotes before shipping and carries its discount through final payment", async () => {
  const checkout = await harness();
  checkout.edit(CODE);
  checkout.fields[".co-voucher"].handlers.submit({ preventDefault() {} });
  await settle();
  assert.equal(checkout.requests.filter((request) => request.url === "/api/payment-intent").length, 1, "no addressless PaymentIntent update");
  assert.equal(checkout.fields[".co-discount"].textContent, "-$100.00");
  assert.equal(checkout.fields[".co-discount-row"].hidden, false);
  checkout.shipping(); await settle();
  assert.equal(checkout.fields[".co-total-val"].innerHTML, "$614.00");
  await checkout.pay();
  const updates = checkout.requests.filter((request) => request.body.paymentIntentId);
  assert.equal(updates.length, 2);
  assert.ok(updates.every((request) => request.body.voucherCode === CODE));
  assert.equal(checkout.confirmations(), 1);
  assert.ok(!JSON.stringify(checkout.telemetry).includes(CODE));
  assert.ok(!JSON.stringify(checkout.stored).includes(CODE));
});

test("editing or rejection blocks payment until explicit removal, which reprices at full price", async () => {
  const checkout = await harness({ respond(url, body) {
    if (url === "/api/voucher" && body.voucherCode === "INVALID_TEST_ONLY") return json({ error: "That code is not available for this order.", code: "discount_unavailable" }, 409);
  } });
  await checkout.apply(CODE); checkout.shipping(); await settle();
  checkout.edit("INVALID_TEST_ONLY"); await checkout.pay();
  assert.equal(checkout.confirmations(), 0);
  assert.equal(checkout.fields[".co-submit"].disabled, true);
  await checkout.apply("INVALID_TEST_ONLY"); await checkout.pay();
  assert.equal(checkout.confirmations(), 0);
  assert.match(checkout.fields[".co-voucher-msg"].textContent, /not available/);
  await checkout.apply("");
  assert.equal(checkout.fields[".co-discount-row"].hidden, true);
  assert.equal(checkout.fields[".co-total-val"].innerHTML, "$714.00");
  assert.equal(checkout.requests.at(-1).body.voucherCode, "");
});

test("stale voucher responses cannot restore a removed voucher", async () => {
  const quote = deferred();
  const checkout = await harness({ respond(url) { if (url === "/api/voucher") return quote.promise; } });
  const applying = checkout.apply(CODE);
  await checkout.apply("");
  quote.resolve(json({ discount: 10000 })); await applying;
  assert.equal(checkout.fields[".co-discount-row"].hidden, true);
  assert.equal(checkout.fields[".co-voucher-msg"].textContent, "");
});

test("cart changes revalidate the voucher and keep the one-order discount at $100", async () => {
  const checkout = await harness();
  await checkout.apply(CODE);
  checkout.changeCart([{ ...cartLine, qty: 2 }]); await settle();
  assert.equal(checkout.requests.at(-1).url, "/api/voucher");
  assert.equal(checkout.requests.at(-1).body.cart[0].qty, 2);
  assert.equal(checkout.fields[".co-discount"].textContent, "-$100.00");
});

test("final quota rejection never falls back to a full-price charge", async () => {
  let updates = 0;
  const checkout = await harness({ respond(url, body) {
    if (url === "/api/payment-intent" && body.paymentIntentId && ++updates > 1) return json({ error: "That code is not available for this order.", code: "discount_unavailable" }, 409);
  } });
  await checkout.apply(CODE); checkout.shipping(); await settle();
  await checkout.pay();
  assert.equal(checkout.confirmations(), 0);
  assert.equal(checkout.fields[".co-submit"].disabled, true);
  assert.match(checkout.fields[".co-voucher-msg"].textContent, /not available/);
});

test("a voucher removed during repricing cannot be overwritten by the old PaymentIntent update", async () => {
  const oldUpdate = deferred();
  let updates = 0;
  const checkout = await harness({ respond(url, body) {
    if (url === "/api/payment-intent" && body.paymentIntentId && ++updates === 1) return oldUpdate.promise;
  } });
  await checkout.apply(CODE); checkout.shipping(); await settle();
  const removed = checkout.apply("");
  assert.equal(updates, 1, "second Stripe mutation waits for the first");
  oldUpdate.resolve(json({ subtotal: 69900, discount: 10000, total: 61400, shipping: 1500, tax: 0 }));
  await removed;
  assert.equal(updates, 2);
  assert.equal(checkout.fields[".co-discount-row"].hidden, true);
  assert.equal(checkout.fields[".co-total-val"].innerHTML, "$714.00");
});

test("quota cancellation says the voucher is unavailable without advertising a sold-out batch", async () => {
  const checkout = await harness({ respond(url) {
    if (url === "/api/order") return json({ status: "canceled", discountUnavailable: true, soldOut: false, items: [cartLine] });
  } });
  await checkout.canceledOrder();
  assert.match(checkout.confirmation.innerHTML, /voucher is no longer available/);
  assert.match(checkout.confirmation.innerHTML, /card was not charged/);
  assert.doesNotMatch(checkout.confirmation.innerHTML, /batch sold out|join=1/);
});


test("receipts expose the discount amount without the private code", async () => {
  const checkout = await harness();
  checkout.order({ status: "succeeded", items: [cartLine], breakdown: { subtotal: 69900, discount: 10000, shipping: 1500, tax: 0, total: 61400 } });
  assert.match(checkout.confirmation.innerHTML, /Discount<\/span><span>-\$100.00/);
  assert.match(checkout.confirmation.innerHTML, /Total paid \$614.00/);
  assert.ok(!checkout.confirmation.innerHTML.includes(CODE));
  checkout.order({ status: "canceled", discountUnavailable: true, items: [cartLine] });
  assert.match(checkout.confirmation.innerHTML, /voucher is no longer available/);
  assert.doesNotMatch(checkout.confirmation.innerHTML, /Order confirmed/);
});


test("an address changed while Stripe refreshes prevents confirmation of the earlier tax binding", async () => {
  const refresh = deferred();
  let refreshes = 0;
  const checkout = await harness({ fetchUpdates() {
    refreshes += 1;
    return refreshes === 2 ? refresh.promise : Promise.resolve();
  } });
  await checkout.apply(CODE); checkout.shipping(); await settle();
  const paying = checkout.pay(); await settle();
  assert.equal(refreshes, 2, "final payment is waiting for Stripe's element refresh");
  checkout.shipping({ postal_code: "94111", line1: "New test address" });
  refresh.resolve(); await paying; await settle();
  assert.equal(checkout.confirmations(), 0);
  assert.match(checkout.fields[".co-error"].textContent, /order changed/);
  assert.equal(checkout.requests.at(-1).body.shipping.address.postal_code, "94111");
});


test("a changed final total requires review and a second click before payment", async () => {
  let updates = 0;
  const checkout = await harness({ respond(url, body) {
    if (url === "/api/payment-intent" && body.paymentIntentId && ++updates > 1) {
      return json({ subtotal: 69900, discount: 10000, shipping: 1600, tax: 0, total: 61500 });
    }
  } });
  await checkout.apply(CODE); checkout.shipping(); await settle();
  assert.equal(checkout.fields[".co-total-val"].innerHTML, "$614.00");
  await checkout.pay();
  assert.equal(checkout.confirmations(), 0);
  assert.equal(checkout.fields[".co-total-val"].innerHTML, "$615.00");
  assert.match(checkout.fields[".co-error"].textContent, /total changed/);
  assert.equal(checkout.fields[".co-submit"].span.textContent, "Pay $615.00");
  await checkout.pay();
  assert.equal(checkout.confirmations(), 1);
});


test("all PaymentIntent creates and updates carry the same local recovery credentials", async () => {
  const identity = { journeyId: "a".repeat(64), journeyToken: "b".repeat(64) };
  const checkout = await harness({ recoveryContext: async () => identity });
  checkout.shipping(); await settle(); await checkout.pay();
  const requests = checkout.requests.filter((request) => request.url === "/api/payment-intent");
  assert.equal(requests.length, 3);
  for (const { body } of requests) {
    assert.equal(body.journeyId, identity.journeyId); assert.equal(body.journeyToken, identity.journeyToken);
  }
  assert.ok(!JSON.stringify(checkout.telemetry).includes(identity.journeyToken));
  assert.ok(!JSON.stringify(checkout.stored).includes(identity.journeyToken));
});
