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
    attrs: {},
    setAttribute(k,v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() { this.focused = true; },
    closest() { return this; },
    querySelector() { return null; },
  };
}

async function harness({ respond, fetchUpdates, recoveryContext, sessionValues = new Map() } = {}) {
  const fields = {};
  for (const name of [".co-summary", ".co-voucher", ".co-voucher input", ".co-voucher button", ".co-voucher-msg", "[data-remove-voucher]", ".co-discount-row", ".co-discount", ".co-error", ".co-submit", ".co-total-val", ".co-tax", ".co-ship", "#co-email", "#co-news", "#co-form", "#co-gift", "#co-gift-from", "#co-gift-details", "#co-gift-error"]) fields[name] = element();
  fields["#co-email"].value = "buyer@example.com";
  fields["#co-email"].reportValidity = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields["#co-email"].value);
  let summaryHtml = "";
  Object.defineProperty(fields[".co-summary"], "innerHTML", {
    get() { return summaryHtml; },
    set(value) {
      summaryHtml = value;
      for (const key of ["#co-gift", "#co-gift-from", "#co-gift-details", "#co-gift-error"]) fields[key] = element();
    },
  });
  fields[".co-submit"].span = element();
  fields[".co-submit"].querySelector = () => fields[".co-submit"].span;
  fields[".co-voucher"].querySelector = (selector) => fields[".co-voucher " + selector];
  const shipping = element(), payment = element();
  shipping.classList.toggle("is-open", true);
  shipping.dataset = { sec: "shipping" }; payment.dataset = { sec: "payment" };
  fields['.co-section[data-sec="payment"]'] = payment;
  const host = { innerHTML: "", querySelector(selector) {
    if (selector === ".co-error") {
      const first = this.innerHTML.match(/<p[^>]*class="[^"]*\bco-error\b[^"]*"[^>]*>/);
      const id = first && first[0].match(/id="([^"]+)"/);
      if (id) return fields["#" + id[1]];
    }
    return fields[selector] || null;
  }, querySelectorAll: (selector) => selector === ".co-section" ? [shipping, payment] : [] };
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
    globalThis.removeLastLine = function () { setLineQty(0, 0); coRefreshSummary(globalThis.host); };
    globalThis.rebuildSummary = function () { $(".co-summary", globalThis.host).innerHTML = coSummaryHTML(); coWireSummary(globalThis.host); };
  })();`);
  const context = vm.createContext({
    document: {
      readyState: "loading", addEventListener() {},
      querySelector(selector) { return selector === "#checkout" ? host : selector === "#confirmation" ? confirmation : null; },
      querySelectorAll() { return []; }, body: {}, documentElement: {},
    },
    window: { addEventListener() {}, Stripe() { return { elements: () => stripeElements, confirmPayment: async () => { confirmations += 1; return { error: { message: "Test confirmation complete" } }; } }; } },
    sessionStorage: { getItem(key) { return sessionValues.get(key) || null; }, setItem(key,value) { sessionValues.set(key,value); }, removeItem(key) { sessionValues.delete(key); } },
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
    host, fields, requests, telemetry, stored, confirmation, sessionValues,
    gift(enabled, from = "") { fields["#co-gift"].checked = enabled; fields["#co-gift"].handlers.change(); if (enabled) { fields["#co-gift-from"].value = from; fields["#co-gift-from"].handlers.input(); } },
    apply: (code) => host.__applyVoucher(code),
    edit(code) { fields[".co-voucher input"].value = code; host.__editVoucher(); },
    shipping(address = {}) { addressHandlers.change({ complete: true, value: { name: "Test", address: { country: "US", state: "CA", postal_code: "94110", line1: "Test", ...address } } }); },
    changeCart: (lines) => context.changeCart(lines),
    removeLastLine: () => context.removeLastLine(),
    rebuildSummary: () => context.rebuildSummary(),
    pay: () => fields["#co-form"].handlers.submit({ preventDefault() {} }),
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
