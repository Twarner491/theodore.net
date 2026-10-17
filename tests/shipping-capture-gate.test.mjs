import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { onRequestPost as stripeWebhook } from "../functions/api/stripe-webhook.js";
import { createCheckoutBinding, taxAddressBinding, verifyCheckoutBinding } from "../lib/shipping-binding.js";
import { canonicalShippingJson, sha256Hex, shippingDestinationError } from "../lib/shipping-profile.js";

const SECRET = "whsec_capture_test";
const ENV = { STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_capture" };
const PROFILED_CATALOG = {
  frame: { title: "Frame", variants: { assembled: {
    price: "price_frame", maxQty: 1, shippingProfile: "contiguous-us-ground",
  } } },
};
const SHIPPING = {
  name: "Test Buyer",
  address: { line1: "1 Test St", line2: "", city: "San Francisco", state: "CA", postal_code: "94107", country: "US" },
};

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function signedRequest(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", SECRET).update(timestamp + "." + body).digest("hex");
  return new Request("https://example.test/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body,
  });
}

async function validPi(overrides = {}) {
  const binding = await createCheckoutBinding([{ id: "frame", build: "assembled", qty: 1 }], PROFILED_CATALOG);
  const addressSha256 = await sha256Hex(canonicalShippingJson(SHIPPING));
  const base = {
    id: "pi_profiled", capture_method: "manual", status: "requires_capture",
    amount: 70000, amount_capturable: 70000, currency: "usd", shipping: SHIPPING,
    metadata: {
      checkout_ready: "1", tax_calculation: "taxcalc_profile", shipping_profile: binding.profile,
      items: binding.legacyItems,
      shipping_items: binding.manifestJson, shipping_items_sha256: binding.manifestSha256,
      shipping_catalog_sha256: binding.catalogSha256, shipping_address_sha256: addressSha256,
      capture_gate: "pending",
    },
  };
  base.metadata.shipping_tax_binding = await taxAddressBinding({
    taxCalculation: base.metadata.tax_calculation, addressSha256,
    manifestSha256: binding.manifestSha256, catalogSha256: binding.catalogSha256,
    profile: binding.profile, amount: base.amount, currency: base.currency,
  });
  return { ...base, ...overrides, metadata: { ...base.metadata, ...(overrides.metadata || {}) } };
}

function eventFor(pi) {
  return { id: "evt_capture_gate", type: "payment_intent.amount_capturable_updated", data: { object: { id: pi.id } } };
}

async function withFetch(mock, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test("profiled authorization is captured only after current PI, catalog, address, and tax bindings match", async () => {
  const pi = await validPi();
  let captured = false;
  const result = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v1/payment_intents/pi_profiled") && !options.method) return response(pi);
    if (target.endsWith("/store-catalog.json")) return response(PROFILED_CATALOG);
    if (target.endsWith("/capture")) {
      captured = true;
      assert.equal(options.body.get("amount_to_capture"), "70000");
      assert.equal(options.headers["idempotency-key"], "shipping-capture-evt_capture_gate");
      return response({ id: pi.id, status: "succeeded", metadata: {
        capture_gate: "approved", capture_gate_event: "evt_capture_gate",
        capture_address_sha256: pi.metadata.shipping_address_sha256,
      } });
    }
    throw new Error("unexpected fetch " + target);
  }, () => stripeWebhook({ request: signedRequest(eventFor(pi)), env: ENV }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { received: true, captured: true });
  assert.equal(captured, true);
});

test("a valid but changed final address leaves authorization uncaptured and records the incident", async () => {
  const pi = await validPi({ shipping: { ...SHIPPING, address: { ...SHIPPING.address, line1: "2 Other St" } } });
  let captureCalls = 0;
  let incident;
  const result = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v1/payment_intents/pi_profiled") && !options.method) return response(pi);
    if (target.endsWith("/store-catalog.json")) return response(PROFILED_CATALOG);
    if (target.endsWith("/capture")) { captureCalls++; return response({}); }
    if (target.endsWith("/v1/payment_intents/pi_profiled") && options.method === "POST") {
      incident = options.body;
      return response({ id: pi.id });
    }
    throw new Error("unexpected fetch " + target);
  }, () => stripeWebhook({ request: signedRequest(eventFor(pi)), env: ENV }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).blocked, "address_or_tax_binding_mismatch");
  assert.equal(captureCalls, 0);
  assert.equal(incident.get("metadata[capture_gate]"), "blocked");
});

test("profile forgery or stale current catalog fails closed before capture", async (t) => {
  for (const [label, catalog] of [
    ["profile removed", { frame: { title: "Frame", variants: { assembled: { price: "price_frame", maxQty: 1 } } } }],
    ["price changed", { frame: { title: "Frame", variants: { assembled: { price: "price_new", maxQty: 1, shippingProfile: "contiguous-us-ground" } } } }],
  ]) await t.test(label, async () => {
    const pi = await validPi();
    let captureCalls = 0;
    const result = await withFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/v1/payment_intents/pi_profiled") && !options.method) return response(pi);
      if (target.endsWith("/store-catalog.json")) return response(catalog);
      if (target.endsWith("/capture")) captureCalls++;
      return response({ id: pi.id });
    }, () => stripeWebhook({ request: signedRequest(eventFor(pi)), env: ENV }));
    assert.equal((await result.json()).blocked, "catalog_or_manifest_mismatch");
    assert.equal(captureCalls, 0);
  });
});

test("mixed carts derive the strictest profile from every server-catalog line", async () => {
  const catalog = {
    ...PROFILED_CATALOG,
    cable: { title: "Cable", variants: { standard: { price: "price_cable", maxQty: 3 } } },
  };
  const binding = await createCheckoutBinding([
    { id: "cable", build: "standard", qty: 2 },
    { id: "frame", build: "assembled", qty: 1 },
  ], catalog);
  assert.equal(binding.profile, "contiguous-us-ground");
  assert.deepEqual(JSON.parse(binding.manifestJson).lines, [
    ["cable", "standard", 2], ["frame", "assembled", 1],
  ]);
});

test("forged profile metadata is rejected against the current catalog", async () => {
  const pi = await validPi({ metadata: { shipping_profile: "" } });
  let captureCalls = 0;
  const result = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v1/payment_intents/pi_profiled") && !options.method) return response(pi);
    if (target.endsWith("/store-catalog.json")) return response(PROFILED_CATALOG);
    if (target.endsWith("/capture")) captureCalls++;
    return response({ id: pi.id });
  }, () => stripeWebhook({ request: signedRequest(eventFor(pi)), env: ENV }));
  assert.equal((await result.json()).blocked, "catalog_or_manifest_mismatch");
  assert.equal(captureCalls, 0);
});

test("catalog outage is safe pending and never calls capture", async () => {
  const pi = await validPi();
  let captureCalls = 0;
  const result = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v1/payment_intents/pi_profiled") && !options.method) return response(pi);
    if (target.endsWith("/store-catalog.json")) return response({}, 503);
    if (target.endsWith("/capture")) captureCalls++;
    return response({});
  }, () => stripeWebhook({ request: signedRequest(eventFor(pi)), env: ENV }));
  assert.equal(result.status, 503);
  assert.equal(captureCalls, 0);
});

test("a distinct delayed capturable event cannot downgrade terminal capture approval", async () => {
  const pi = await validPi({ status: "succeeded", amount_capturable: 0, metadata: {
    capture_gate: "approved",
    capture_gate_event: "evt_original_capture",
  } });
  pi.metadata.capture_address_sha256 = pi.metadata.shipping_address_sha256;
  const calls = [];
  const result = await withFetch(async (url, options = {}) => {
    calls.push([String(url), options.method || "GET"]);
    return response(pi);
  }, () => stripeWebhook({ request: signedRequest(eventFor(pi)), env: ENV }));
  assert.deepEqual(await result.json(), { received: true, captured: true, duplicate: true });
  assert.deepEqual(calls, [["https://api.stripe.com/v1/payment_intents/pi_profiled", "GET"]]);
});

test("catalog binding covers every current fulfillment field", async () => {
  const catalog = {
    frame: { title: "Frame", variants: { assembled: {
      price: "price_frame", maxQty: 1, weightLb: 4, label: "Assembled",
      priceUsd: 699, shippingProfile: "contiguous-us-ground", inventorySku: "avian-gen3-b01",
    } } },
  };
  const binding = await createCheckoutBinding([{ id: "frame", build: "assembled", qty: 1 }], catalog);
  const metadata = {
    items: binding.legacyItems, shipping_profile: binding.metadataProfile,
    shipping_items: binding.manifestJson, shipping_items_sha256: binding.manifestSha256,
    shipping_catalog_sha256: binding.catalogSha256,
  };
  assert.ok(await verifyCheckoutBinding(metadata, catalog));
  for (const mutate of [
    (copy) => { copy.frame.title = "Different Frame"; },
    (copy) => { copy.frame.variants.assembled.weightLb = 5; },
    (copy) => { copy.frame.variants.assembled.label = "Different"; },
    (copy) => { copy.frame.variants.assembled.priceUsd = 700; },
    (copy) => { copy.frame.variants.assembled.inventorySku = "other-sku"; },
  ]) {
    const changed = structuredClone(catalog);
    mutate(changed);
    assert.equal(await verifyCheckoutBinding(metadata, changed), null);
  }
});

test("stale automatic success cannot bypass a newly profiled catalog item", async () => {
  const oldCatalog = { frame: { title: "Frame", variants: { assembled: {
    price: "price_frame", maxQty: 1, weightLb: 4, label: "Assembled", priceUsd: 699,
  } } } };
  const oldBinding = await createCheckoutBinding([{ id: "frame", build: "assembled", qty: 1 }], oldCatalog);
  const currentCatalog = structuredClone(oldCatalog);
  currentCatalog.frame.variants.assembled.shippingProfile = "contiguous-us-ground";
  const pi = {
    id: "pi_stale_automatic", amount: 70000, currency: "usd",
    shipping: { ...SHIPPING, address: { ...SHIPPING.address, line1: "P.O. #123" } },
    metadata: {
      checkout_ready: "1", tax_calculation: "taxcalc_old", items: oldBinding.legacyItems,
      shipping_items: oldBinding.manifestJson,
      shipping_items_sha256: oldBinding.manifestSha256,
      shipping_catalog_sha256: oldBinding.catalogSha256,
    },
  };
  const event = { id: "evt_stale_success", type: "payment_intent.succeeded", data: { object: pi } };
  const calls = [];
  const result = await withFetch(async (url) => {
    calls.push(String(url));
    return response(currentCatalog);
  }, () => stripeWebhook({ request: signedRequest(event), env: ENV }));
  assert.deepEqual(await result.json(), {
    received: true, fulfilled: false, blocked: "catalog_or_manifest_mismatch",
  });
  assert.deepEqual(calls, ["https://example.test/store-catalog.json"]);
});

test("shipping profile rejects disguised postal locations in every free-text address field", () => {
  for (const [field, value] of [
    ["line1", "P/O Box 1"], ["line2", "P-O Box 1"], ["line1", "P.O.B. 1"],
    ["city", "Post Office #1"], ["line2", "General Delivery"], ["line1", "Ｐ．Ｏ．Ｂ． 1"],
    ["line1", "P.O. #123"], ["line2", "P O #123"], ["city", "P.O. Number 123"],
    ["line1", "PO BX 123"], ["line2", "Ｐ　Ｏ　＃１２３"],
  ]) {
    const candidate = { ...SHIPPING, address: { ...SHIPPING.address, [field]: value } };
    assert.equal(shippingDestinationError("contiguous-us-ground", candidate), "shipping_po_box_not_allowed");
  }
});

test("lower-48 state labels cannot disguise noncontiguous, territory, or military ZIPs", () => {
  for (const postal_code of ["99501", "96813", "00901", "96950", "09012", "96201", "34001"]) {
    const candidate = { ...SHIPPING, address: { ...SHIPPING.address, postal_code } };
    assert.equal(shippingDestinationError("contiguous-us-ground", candidate), "shipping_region_not_allowed");
  }
});

test("legacy hosted checkout completion is acknowledged but never fulfilled", async () => {
  const event = { id: "evt_hosted", type: "checkout.session.completed", data: { object: { id: "cs_legacy" } } };
  const result = await stripeWebhook({ request: signedRequest(event), env: { STRIPE_WEBHOOK_SECRET: SECRET } });
  assert.deepEqual(await result.json(), { received: true, fulfilled: false, blocked: "legacy_hosted_checkout_unbound" });
});
