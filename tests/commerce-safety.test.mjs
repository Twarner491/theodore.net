import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { onRequestPost as hostedCheckout } from "../functions/api/checkout.js";
import { onRequestPost as paymentIntent } from "../functions/api/payment-intent.js";
import { onRequestPost as stripeWebhook } from "../functions/api/stripe-webhook.js";
import { createCheckoutBinding } from "../lib/shipping-binding.js";

const ENV = { STRIPE_SECRET_KEY: "sk_test_checkout", STRIPE_PUBLISHABLE_KEY: "pk_test_checkout" };
const CATALOG = {
  "avian-visitors": {
    title: "Avian Visitors",
    variants: {
      assembled: {
        price: "price_assembled",
        weightLb: 4,
        maxQty: 1,
        label: "Assembled",
        priceUsd: 699,
      },
    },
  },
};
const PROFILED_CATALOG = {
  "avian-visitors": {
    title: "Avian Visitors",
    variants: {
      assembled: {
        ...CATALOG["avian-visitors"].variants.assembled,
        shippingProfile: "contiguous-us-ground",
      },
    },
  },
};

function post(body, url = "https://example.test/api/payment-intent") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch(mock, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await fn(); }
  finally { globalThis.fetch = original; }
}

const line = (qty = 1) => ({ id: "avian-visitors", build: "assembled", qty });
const shipping = {
  name: "Test Buyer",
  address: { country: "US", state: "CA", postal_code: "94107", city: "San Francisco", line1: "1 Test St" },
};
const destination = (changes = {}) => ({
  name: "Test Buyer",
  address: { ...shipping.address, ...changes },
});

test("payment-intent rejects a quantity above the trusted catalog cap before Stripe calls", async () => {
  const calls = [];
  const response = await withFetch(async (url) => {
    calls.push(String(url));
    return okJson(CATALOG);
  }, () => paymentIntent({ request: post({ cart: [line(2)] }), env: ENV }));

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /at most 1/);
  assert.deepEqual(calls, ["https://example.test/store-catalog.json"]);
});

test("payment-intent aggregates duplicate lines before enforcing the variant cap", async () => {
  const response = await withFetch(async () => okJson(CATALOG), () =>
    paymentIntent({ request: post({ cart: [line(1), line(1)] }), env: ENV }));

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /at most 1/);
});

test("payment-intent fails closed when Stripe Tax is unavailable", async () => {
  const calls = [];
  const response = await withFetch(async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/store-catalog.json")) return okJson(CATALOG);
    if (String(url).includes("/v1/prices/")) return okJson({ active: true, unit_amount: 69900, currency: "usd" });
    if (String(url).endsWith("/v1/tax/calculations")) return new Response("unavailable", { status: 503 });
    throw new Error("unexpected fetch: " + url);
  }, () => paymentIntent({ request: post({ cart: [line()], shipping }), env: ENV }));

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Sales tax could not be calculated/);
  assert.equal(calls.some((url) => /\/v1\/payment_intents(?:\/|$)/.test(url)), false);
});

test("payment-intent marks only a successful server-side Tax calculation ready", async () => {
  let intentForm;
  const response = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/store-catalog.json")) return okJson(CATALOG);
    if (target.includes("/v1/prices/")) return okJson({ active: true, unit_amount: 69900, currency: "usd" });
    if (target.endsWith("/v1/tax/calculations")) {
      assert.equal(options.body.get("line_items[0][tax_behavior]"), "exclusive");
      assert.equal(options.body.get("shipping_cost[tax_behavior]"), "exclusive");
      return okJson({ id: "taxcalc_launch", currency: "usd", tax_amount_exclusive: 6031, amount_total: 76831 });
    }
    if (target.endsWith("/v1/payment_intents")) {
      intentForm = options.body;
      return okJson({ id: "pi_launch", client_secret: "pi_launch_secret_test" });
    }
    throw new Error("unexpected fetch: " + url);
  }, () => paymentIntent({ request: post({ cart: [line()], shipping }), env: ENV }));

  assert.equal(response.status, 200);
  assert.equal(intentForm.get("amount"), "76831");
  assert.equal(intentForm.get("metadata[tax_calculation]"), "taxcalc_launch");
  assert.equal(intentForm.get("metadata[checkout_ready]"), "1");
  assert.equal(intentForm.get("capture_method"), "automatic");
});

test("payment-intent carries the trusted ground profile after accepting a contiguous-US street address", async () => {
  let intentForm;
  const response = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/store-catalog.json")) return okJson(PROFILED_CATALOG);
    if (target.includes("/v1/prices/")) return okJson({ active: true, unit_amount: 69900, currency: "usd" });
    if (target.endsWith("/v1/tax/calculations")) {
      return okJson({ id: "taxcalc_profile", currency: "usd", tax_amount_exclusive: 6031, amount_total: 76831 });
    }
    if (target.endsWith("/v1/payment_intents")) {
      intentForm = options.body;
      return okJson({ id: "pi_profile", client_secret: "pi_profile_secret_test" });
    }
    throw new Error("unexpected fetch: " + url);
  }, () => paymentIntent({ request: post({ cart: [line()], shipping }), env: ENV }));

  assert.equal(response.status, 200);
  assert.equal(intentForm.get("metadata[shipping_profile]"), "contiguous-us-ground");
  assert.equal(intentForm.get("metadata[checkout_ready]"), "1");
  assert.equal(intentForm.get("capture_method"), "manual");
  assert.match(intentForm.get("metadata[shipping_items]"), /avian-visitors/);
  assert.match(intentForm.get("metadata[shipping_address_sha256]"), /^[a-f0-9]{64}$/);
  assert.match(intentForm.get("metadata[shipping_tax_binding]"), /^[a-f0-9]{64}$/);
});

test("payment-intent rejects non-contiguous and non-US destinations for a profiled line before Stripe calls", async (t) => {
  const cases = [
    ["Alaska", { state: "AK", postal_code: "99501", city: "Anchorage" }],
    ["Hawaii", { state: "HI", postal_code: "96813", city: "Honolulu" }],
    ["territory", { state: "PR", postal_code: "00901", city: "San Juan" }],
    ["non-US", { country: "CA", state: "BC", postal_code: "V6B 1A1", city: "Vancouver" }],
  ];
  for (const [label, address] of cases) {
    await t.test(label, async () => {
      const calls = [];
      const response = await withFetch(async (url) => {
        calls.push(String(url));
        return okJson(PROFILED_CATALOG);
      }, () => paymentIntent({ request: post({ cart: [line()], shipping: destination(address) }), env: ENV }));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /contiguous US/);
      assert.deepEqual(calls, ["https://example.test/store-catalog.json"]);
    });
  }
});

test("payment-intent rejects PO boxes in either address line for a profiled line", async (t) => {
  for (const address of [
    { line1: "P.O. Box 123" },
    { line1: "1 Test St", line2: "Post Office Box 123" },
  ]) {
    await t.test(JSON.stringify(address), async () => {
      const response = await withFetch(async () => okJson(PROFILED_CATALOG), () =>
        paymentIntent({ request: post({ cart: [line()], shipping: destination(address) }), env: ENV }));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /PO box/);
    });
  }
});

test("ordinary products keep their existing Alaska and PO-box behavior", async () => {
  let intentForm;
  const alaskaPoBox = destination({
    state: "AK",
    postal_code: "99501",
    city: "Anchorage",
    line1: "PO Box 123",
  });
  const response = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/store-catalog.json")) return okJson(CATALOG);
    if (target.includes("/v1/prices/")) return okJson({ active: true, unit_amount: 69900, currency: "usd" });
    if (target.endsWith("/v1/tax/calculations")) {
      assert.equal(options.body.get("shipping_cost[amount]"), "1700");
      return okJson({ id: "taxcalc_ordinary", currency: "usd", tax_amount_exclusive: 0, amount_total: 71600 });
    }
    if (target.endsWith("/v1/payment_intents")) {
      intentForm = options.body;
      return okJson({ id: "pi_ordinary", client_secret: "pi_ordinary_secret_test" });
    }
    throw new Error("unexpected fetch: " + url);
  }, () => paymentIntent({ request: post({ cart: [line()], shipping: alaskaPoBox }), env: ENV }));

  assert.equal(response.status, 200);
  assert.equal(intentForm.get("metadata[shipping_profile]"), "none");
  assert.match(intentForm.get("metadata[shipping_items_sha256]"), /^[a-f0-9]{64}$/);
  assert.equal(intentForm.get("metadata[checkout_ready]"), "1");
});

test("the initial addressless PaymentIntent remains an explicitly unfulfillable draft", async () => {
  let intentForm;
  const response = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/store-catalog.json")) return okJson(CATALOG);
    if (target.includes("/v1/prices/")) return okJson({ active: true, unit_amount: 69900, currency: "usd" });
    if (target.endsWith("/v1/payment_intents")) {
      intentForm = options.body;
      return okJson({ id: "pi_draft", client_secret: "pi_draft_secret_test" });
    }
    throw new Error("unexpected fetch: " + url);
  }, () => paymentIntent({ request: post({ cart: [line()] }), env: ENV }));

  assert.equal(response.status, 200);
  assert.equal(intentForm.get("metadata[checkout_ready]"), "0");
  assert.equal(intentForm.has("metadata[tax_calculation]"), false);
  assert.equal(intentForm.get("capture_method"), "manual");
});

test("hosted Checkout safety fuse refuses every cart before body, catalog, or Stripe access", async () => {
  const calls = [];
  const request = new Request("https://example.test/api/checkout", { method: "POST", body: "not json" });
  const response = await withFetch(async (url) => {
    calls.push(String(url));
    throw new Error("hosted checkout must not call fetch");
  }, () => hostedCheckout({ request, env: ENV }));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Hosted checkout is unavailable/);
  assert.deepEqual(calls, []);
});

test("hosted Checkout rejects duplicate lines that exceed the catalog cap", async () => {
  const response = await withFetch(async () => { throw new Error("must not fetch"); }, () =>
    hostedCheckout({ request: post({ cart: [line(), line()] }, "https://example.test/api/checkout"), env: ENV }));
  assert.equal(response.status, 409);
});

test("hosted Checkout refuses profiled carts before redirect because it cannot prevalidate the street address", async () => {
  const calls = [];
  const response = await withFetch(async (url) => {
    calls.push(String(url));
    throw new Error("must not fetch");
  }, () => hostedCheckout({ request: post({ cart: [line()] }, "https://example.test/api/checkout"), env: ENV }));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /on-site checkout/);
  assert.deepEqual(calls, []);
});

test("webhook refuses fulfillment for a subtotal-only untaxed PaymentIntent", async () => {
  const secret = "whsec_commerce_test";
  const event = JSON.stringify({
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_draft", amount: 69900, currency: "usd", metadata: { checkout_ready: "0" } } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(timestamp + "." + event).digest("hex");
  const request = new Request("https://example.test/api/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: event,
  });

  const response = await stripeWebhook({ request, env: { STRIPE_WEBHOOK_SECRET: secret } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    received: true,
    fulfilled: false,
    blocked: "tax_not_finalized",
  });
});

test("webhook accepts a PaymentIntent carrying the server tax-finalization proof", async () => {
  const secret = "whsec_commerce_test";
  const binding = await createCheckoutBinding([line()], CATALOG);
  const event = JSON.stringify({
    type: "payment_intent.succeeded",
    data: { object: {
      id: "pi_ready",
      amount: 76831,
      currency: "usd",
      metadata: {
        checkout_ready: "1",
        tax_calculation: "taxcalc_launch",
        items: binding.legacyItems,
        breakdown: "69900|900|6031|76831",
        shipping_profile: binding.metadataProfile,
        shipping_items: binding.manifestJson,
        shipping_items_sha256: binding.manifestSha256,
        shipping_catalog_sha256: binding.catalogSha256,
      },
    } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(timestamp + "." + event).digest("hex");
  const request = new Request("https://example.test/api/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: event,
  });

  const response = await withFetch(async (url) => {
    assert.equal(String(url), "https://example.test/store-catalog.json");
    return okJson(CATALOG);
  }, () => stripeWebhook({ request, env: { STRIPE_WEBHOOK_SECRET: secret } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).received, true);
});

test("webhook blocks fulfillment if the confirmed address violates the server-stamped profile", async () => {
  const secret = "whsec_commerce_test";
  const binding = await createCheckoutBinding([line()], PROFILED_CATALOG);
  const event = JSON.stringify({
    type: "payment_intent.succeeded",
    data: { object: {
      id: "pi_profile_changed",
      amount: 76831,
      currency: "usd",
      shipping: destination({ line1: "PO Box 123" }),
      metadata: {
        checkout_ready: "1",
        tax_calculation: "taxcalc_profile",
        items: binding.legacyItems,
        shipping_profile: binding.metadataProfile,
        shipping_items: binding.manifestJson,
        shipping_items_sha256: binding.manifestSha256,
        shipping_catalog_sha256: binding.catalogSha256,
      },
    } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(timestamp + "." + event).digest("hex");
  const request = new Request("https://example.test/api/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: event,
  });

  const response = await withFetch(async (url) => {
    assert.equal(String(url), "https://example.test/store-catalog.json");
    return okJson(PROFILED_CATALOG);
  }, () => stripeWebhook({ request, env: { STRIPE_WEBHOOK_SECRET: secret } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    received: true,
    fulfilled: false,
    blocked: "shipping_destination_not_allowed",
  });
});
