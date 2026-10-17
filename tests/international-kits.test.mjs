import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost as paymentIntent } from "../functions/api/payment-intent.js";

// The two kits ship to Canada, Australia and the UK; everything else stays US-only.
const ENV = { STRIPE_SECRET_KEY: "sk_test_intl", STRIPE_PUBLISHABLE_KEY: "pk_test_intl" };
const CATALOG = {
  "avian-visitors-kit": { title: "Avian Visitors Kit", variants: { "electronics-printed": { price: "price_kit", weightLb: 3.2, maxQty: 5, label: "+ Frame & Parts", priceUsd: 520 } } },
  "avian-mic": { title: "Bird Mic Kit", variants: { electronics: { price: "price_mic", weightLb: 0.6, maxQty: 5, label: "Electronics Kit", priceUsd: 180 } } },
  "mic-mount": { title: "Mic Mount", variants: { default: { price: "price_mount", weightLb: 0.2, maxQty: 5, label: "Mic Mount", priceUsd: 15 } } },
};
const PRICES = { price_kit: 52000, price_mic: 18000, price_mount: 1500 };
const ADDR = {
  CA: { country: "CA", state: "ON", postal_code: "M5V 3L9", city: "Toronto", line1: "290 Bremner Blvd" },
  AU: { country: "AU", state: "NSW", postal_code: "2000", city: "Sydney", line1: "Bennelong Point" },
  GB: { country: "GB", state: "", postal_code: "SW9 9RZ", city: "London", line1: "20 Stansfield Road" },
};

const post = (body) => new Request("https://example.test/api/payment-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const okJson = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });

async function run(cart, address) {
  const seen = { taxCountry: null, intent: null };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith("/store-catalog.json")) return okJson(CATALOG);
    if (u.includes("/v1/prices/")) return okJson({ active: true, unit_amount: PRICES[u.split("/").pop()], currency: "usd" });
    if (u.endsWith("/v1/tax/calculations")) {
      const f = new URLSearchParams(options.body);
      seen.taxCountry = f.get("customer_details[address][country]");
      let sum = Number(f.get("shipping_cost[amount]"));
      for (let i = 0; f.get(`line_items[${i}][amount]`); i++) sum += Number(f.get(`line_items[${i}][amount]`));
      return okJson({ id: "taxcalc_intl", currency: "usd", tax_amount_exclusive: 0, amount_total: sum });
    }
    if (u.endsWith("/v1/payment_intents")) { seen.intent = new URLSearchParams(options.body); return okJson({ id: "pi_intl", client_secret: "pi_intl_secret_test" }); }
    throw new Error("unexpected fetch: " + u);
  };
  try {
    const res = await paymentIntent({ request: post({ cart, shipping: { name: "Test Buyer", address } }), env: ENV });
    return { status: res.status, body: await res.json(), ...seen };
  } finally { globalThis.fetch = original; }
}
const kit = (qty = 1) => ({ id: "avian-visitors-kit", build: "electronics-printed", qty });
const mic = { id: "avian-mic", build: "electronics", qty: 1 };

test("a kit to Canada: one box plus 1.5% for the international card fee; Stripe Tax sees Canada", async () => {
  const r = await run([kit()], ADDR.CA);
  assert.equal(r.status, 200);
  assert.equal(r.body.shipping, 3500, "$27 box + $7.80, rounded up to the dollar");
  assert.equal(r.taxCountry, "CA");
  assert.equal(r.intent.get("metadata[checkout_ready]"), "1");
  assert.equal(r.body.total, 52000 + 3500);
});

test("an international order is one box of up to 4 lb (Asendia's tracked service stops at 4.4 lb)", async () => {
  const two = await run([kit(2)], ADDR.AU);
  assert.equal(two.status, 400);
  assert.match(two.body.error, /one box of up to 4 lb/);
  assert.equal(two.intent, null);
  const au = await run([kit()], ADDR.AU);
  assert.equal(au.body.shipping, 3600, "$28 box + $7.80");
  const mics = await run([{ ...mic, qty: 4 }], ADDR.CA);
  assert.equal(mics.status, 200, "four mic kits fit one box");
});

test("anything but the two kits ships within the US only", async () => {
  const r = await run([kit(), { id: "mic-mount", build: "default", qty: 1 }], ADDR.CA);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Mic Mount ships within the US only.");
});

test("UK orders stay above GBP 135, where VAT is collected at the border, not by us", async () => {
  const low = await run([mic], ADDR.GB);
  assert.equal(low.status, 400);
  assert.equal(low.body.error, "UK orders need a subtotal of at least $210.");
  const ok = await run([kit()], ADDR.GB);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.shipping, 3100, "$23 box + $7.80");
  assert.equal(ok.taxCountry, "GB");
});

test("other countries and malformed addresses are refused before any price is set", async () => {
  const fr = await run([kit()], { country: "FR", postal_code: "75007", city: "Paris", line1: "5 Avenue Anatole France" });
  assert.equal(fr.status, 400);
  assert.equal(fr.intent, null);
  const badZip = await run([kit()], { ...ADDR.CA, postal_code: "12345" });
  assert.equal(badZip.status, 400);
  assert.equal(badZip.body.error, "Enter a valid shipping address.");
  const noState = await run([kit()], { ...ADDR.AU, state: "" });
  assert.equal(noState.status, 400);
  const named = await run([kit()], { ...ADDR.AU, state: "New South Wales" });
  assert.equal(named.status, 200, "a state name works as well as its code");
});

test("US orders keep their existing price", async () => {
  const r = await run([kit()], { country: "US", state: "CA", postal_code: "94107", city: "San Francisco", line1: "1 Test St" });
  assert.equal(r.status, 200);
  assert.equal(r.taxCountry, "US");
  assert.ok(r.body.shipping < 1500);
});
