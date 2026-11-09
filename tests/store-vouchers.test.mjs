import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequestPost as voucherQuote } from "../functions/api/voucher.js";
import { onRequestPost as paymentIntent } from "../functions/api/payment-intent.js";
import { onRequestPost as stripeWebhook } from "../functions/api/stripe-webhook.js";
import { onRequestGet as inventoryAvailability } from "../functions/api/inventory-availability.js";
import { readInventoryAvailability, readInventoryReservation } from "../lib/store-inventory.js";
import { parseInventoryDemandJson, verifyBoundInventoryMetadata } from "../lib/store-inventory-commerce.js";
import { orderView } from "../lib/order-view.js";
import { buildOrder, receiptHtml } from "../lib/emails.js";

// Deliberately public test fixture. Never use this value in production.
const CODE = "TEST-FAMILY-ONLY-7D4K2P8J";
const CAMPAIGN = "avian-holidays-2026";
const SKU = "avian-gen3-batch-02";
const QUOTA = "voucher-avian-holidays-2026";
const SECRET = "whsec_voucher_fixture";
const SHIPPING = { name: "Test Buyer", address: {
  line1: "1 Test St", line2: "", city: "San Francisco", state: "CA", postal_code: "94107", country: "US",
} };
const CATALOG = {
  "avian-visitors": { title: "Avian Visitors", variants: {
    "assembled-batch-2": { price: "price_frame", weightLb: 4, maxQty: 20,
      label: "Assembled (Batch 2)", priceUsd: 699, shippingProfile: "contiguous-us-ground", inventorySku: SKU },
  } },
  cable: { title: "Cable", variants: { standard: {
    price: "price_cable", weightLb: 0.2, maxQty: 5, label: "Standard", priceUsd: 12,
  } } },
};
const frame = (qty = 1) => ({ id: "avian-visitors", build: "assembled-batch-2", qty });
const cable = () => ({ id: "cable", build: "standard", qty: 1 });
const reply = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const request = (path, body) => new Request("https://example.test/api/" + path, {
  method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify(body),
});

class Statement {
  constructor(owner, sql, values = []) { Object.assign(this, { owner, sql, values }); }
  bind(...values) { return new Statement(this.owner, this.sql, values); }
  run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  all() { return { success: true, results: this.owner.sqlite.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  first() { return this.owner.sqlite.prepare(this.sql).get(...this.values) || null; }
}
class Database {
  constructor({ active = 1, expired = false } = {}) {
    this.sqlite = new DatabaseSync(":memory:");
    for (const file of ["0001_store_inventory.sql", "0002_avian_batch_2.sql", "0003_store_vouchers.sql"])
      this.sqlite.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
    this.sqlite.prepare("UPDATE store_vouchers SET code_sha256 = ?, active = ?, expires_at = ? WHERE id = ?")
      .run(createHash("sha256").update(CODE).digest("hex"), active,
        Math.floor(Date.now() / 1000) + (expired ? -60 : 86400), CAMPAIGN);
  }
  prepare(sql) { return new Statement(this, sql); }
  withSession(consistency) { assert.equal(consistency, "first-primary"); return this; }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try { const result = statements.map((statement) => statement.run()); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}
function metadata(form, prior = {}) {
  const result = { ...prior };
  for (const [key, value] of form) {
    const match = /^metadata\[([^\]]+)\]$/.exec(key);
    if (match) { if (value) result[match[1]] = value; else delete result[match[1]]; }
  }
  return result;
}
function stripeMock() {
  const intents = new Map(), requests = [], captures = [], canceled = [], taxLines = [];
  let count = 0, failCapture = false;
  const fetch = async (url, options = {}) => {
    const target = String(url), form = options.body instanceof URLSearchParams ? options.body : null;
    requests.push({ target, method: options.method || "GET", body: form ? form.toString() : "" });
    if (target === "https://api.resend.com/emails") return reply({ id: "resend_voucher_fixture" });
    if (target.endsWith("/store-catalog.json")) return reply(CATALOG);
    if (target.endsWith("/v1/prices/price_frame")) return reply({ active: true, unit_amount: 69900, currency: "usd" });
    if (target.endsWith("/v1/prices/price_cable")) return reply({ active: true, unit_amount: 1200, currency: "usd" });
    if (target.endsWith("/v1/tax/calculations")) {
      const amounts = [...form].filter(([key]) => /^line_items\[\d+\]\[amount\]$/.test(key)).map(([, value]) => Number(value));
      taxLines.push(amounts);
      return reply({ id: "taxcalc_voucher_" + taxLines.length, currency: "usd", tax_amount_exclusive: 600,
        amount_total: amounts.reduce((sum, amount) => sum + amount, 0) + Number(form.get("shipping_cost[amount]")) + 600 });
    }
    if (target.endsWith("/v1/tax/transactions/create_from_calculation")) return reply({ id: "tax_voucher_record" });
    if (target.endsWith("/v1/payment_intents")) {
      const id = "pi_voucher_" + ++count;
      const pi = { id, object: "payment_intent", client_secret: id + "_secret_fixture", currency: "usd",
        status: "requires_payment_method", capture_method: form.get("capture_method"), amount: Number(form.get("amount")),
        metadata: metadata(form) };
      intents.set(id, pi); return reply(pi);
    }
    const match = /\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)(?:\/(capture|cancel))?$/.exec(target);
    if (match) {
      const pi = intents.get(match[1]);
      assert.ok(pi, "Only known test intents may be used");
      if (match[2] === "capture") {
        captures.push({ id: pi.id, key: options.headers["idempotency-key"] });
        if (failCapture) return reply({ error: "temporary failure" }, 500);
        pi.status = "succeeded"; pi.metadata = metadata(form, pi.metadata); return reply(pi);
      }
      if (match[2] === "cancel") { canceled.push(pi.id); pi.status = "canceled"; return reply(pi); }
      if (form) {
        pi.metadata = metadata(form, pi.metadata);
        if (form.has("amount")) pi.amount = Number(form.get("amount"));
        if (form.has("capture_method")) pi.capture_method = form.get("capture_method");
      }
      return reply(pi);
    }
    throw new Error("Unexpected test request: " + target);
  };
  return { fetch, intents, requests, captures, canceled, taxLines, setFailCapture(value) { failCapture = value; } };
}
async function setup(t, options) {
  const db = new Database(options); t.after(() => db.close());
  const env = { STORE_INVENTORY: db, STRIPE_SECRET_KEY: "sk_test_voucher_fixture",
    STRIPE_PUBLISHABLE_KEY: "pk_test_voucher_fixture", STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_fixture" };
  const stripe = stripeMock(), previous = globalThis.fetch;
  globalThis.fetch = stripe.fetch; t.after(() => { globalThis.fetch = previous; });
  return { db, env, stripe };
}
async function counts(env) {
  return Object.fromEntries((await readInventoryAvailability(env, [SKU, QUOTA]))
    .map((row) => [row.sku, { reserved: row.reserved, sold: row.sold, available: row.available }]));
}
async function create(env, body = {}) {
  const response = await paymentIntent({ env, request: request("payment-intent", {
    cart: [frame()], voucherCode: CODE, ...(body.shipping ? { email: "buyer@example.com" } : {}), ...body,
  }) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  return { ...data, id: data.clientSecret.split("_secret_")[0] };
}
async function event(env, pi, type, suffix = "") {
  const now = Math.floor(Date.now() / 1000);
  const value = { id: "evt_" + type.replace(/[^a-z]/g, "_") + "_" + pi.id + suffix,
    type, created: now, livemode: false, data: { object: pi } };
  const raw = JSON.stringify(value), signature = createHmac("sha256", SECRET).update(now + "." + raw).digest("hex");
  return stripeWebhook({ env, request: new Request("https://example.test/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": `t=${now},v1=${signature}` }, body: raw,
  }) });
}
function authorize(stripe, id) {
  const pi = stripe.intents.get(id); pi.status = "requires_capture"; pi.amount_capturable = pi.amount; pi.shipping = SHIPPING; return pi;
}

test("voucher quote is private, case-normalized, and never reserves redemption or frame stock", async (t) => {
  const { env, stripe } = await setup(t);
  for (let index = 0; index < 12; index++) {
    const res = await voucherQuote({ env, request: request("voucher", { cart: [frame()], voucherCode: "  " + CODE.toLowerCase() + "  " }) });
    assert.equal(res.status, 200);
    const data = await res.json(); assert.equal(data.discount, 10000); assert.equal(data.discountLabel, "Friends and family");
    assert.equal(JSON.stringify(data).includes(CODE), false);
    assert.equal(JSON.stringify(data).includes(QUOTA), false);
  }
  assert.deepEqual(await counts(env), { [SKU]: { reserved: 0, sold: 0, available: 100 }, [QUOTA]: { reserved: 0, sold: 0, available: 10 } });
  assert.equal(stripe.requests.some((r) => r.target.includes("api.stripe.com")), false);
});

test("wrong, expired, disabled, exhausted, and ineligible vouchers fail closed", async (t) => {
  const { env, db, stripe } = await setup(t);
  for (const body of [
    { cart: [frame()], voucherCode: "WRONG-CODE" },
    { cart: [cable()], voucherCode: CODE },
    { cart: [frame()], voucherCode: CODE, discount: 999999, voucher_campaign: "forged" },
  ]) {
    const res = await voucherQuote({ env, request: request("voucher", body) });
    if (body.discount) { assert.equal(res.status, 200); assert.equal((await res.json()).discount, 10000); }
    else { assert.equal(res.status, 409); assert.equal((await res.json()).code, "discount_unavailable"); }
  }
  for (const change of ["active = 0", "active = 1, expires_at = 1", "expires_at = 9999999999"]) {
    db.sqlite.exec("UPDATE store_vouchers SET " + change);
    if (change.startsWith("expires_at")) db.sqlite.exec("UPDATE store_inventory_batches SET sold_quantity = 10 WHERE sku = '" + QUOTA + "'");
    const res = await voucherQuote({ env, request: request("voucher", { cart: [frame()], voucherCode: CODE }) });
    assert.equal(res.status, 409); assert.equal((await res.json()).code, "discount_unavailable");
  }
  assert.equal(stripe.requests.some((r) => r.target.includes("api.stripe.com")), false);
});

test("discounted drafts do not consume quota and payment amounts ignore client-supplied discount amounts", async (t) => {
  const { env, stripe } = await setup(t);
  for (let index = 0; index < 12; index++) {
    const draft = await create(env, { discount: 60000, amount: 1 });
    assert.equal(draft.subtotal, 69900); assert.equal(draft.discount, 10000); assert.equal(draft.total, 59900);
    assert.equal(await readInventoryReservation(env, draft.id), null);
    const pi = stripe.intents.get(draft.id);
    assert.equal(pi.metadata.voucher_campaign, CAMPAIGN); assert.equal(pi.metadata.voucher_discount, "10000");
    assert.equal(JSON.stringify(pi).includes(CODE), false);
    assert.equal((await verifyBoundInventoryMetadata(pi)).demand.some((line) => line.sku === QUOTA && line.quantity === 1), true);
  }
  assert.deepEqual(await counts(env), { [SKU]: { reserved: 0, sold: 0, available: 100 }, [QUOTA]: { reserved: 0, sold: 0, available: 10 } });
  assert.equal(JSON.stringify(stripe.requests).includes(CODE), false);
});

test("one $100 discount applies before tax to mixed carts and quantity two, and can be removed with the same token", async (t) => {
  const { env, stripe } = await setup(t);
  const cart = [frame(2), cable()];
  const draft = await create(env, { cart, voucherCode: "" });
  const update = await paymentIntent({ env, request: request("payment-intent", {
    cart, paymentIntentId: draft.id, updateToken: draft.updateToken, shipping: SHIPPING, voucherCode: CODE,
  }) });
  assert.equal(update.status, 200); const discounted = await update.json();
  assert.equal(discounted.subtotal, 141000); assert.equal(discounted.discount, 10000);
  assert.deepEqual(stripe.taxLines.at(-1), [129800, 1200]);
  assert.equal(discounted.total, 131000 + discounted.shipping + discounted.tax);
  const removal = await paymentIntent({ env, request: request("payment-intent", {
    cart, paymentIntentId: draft.id, updateToken: draft.updateToken, shipping: SHIPPING, voucherCode: "",
  }) });
  assert.equal(removal.status, 200); assert.equal((await removal.json()).discount || 0, 0);
  const pi = stripe.intents.get(draft.id);
  assert.equal(pi.metadata.voucher_campaign || "", ""); assert.equal(pi.metadata.voucher_discount || "", "");
  assert.equal(parseInventoryDemandJson(pi.metadata.inventory_demand).some((line) => line.sku === QUOTA), false);
  assert.deepEqual(stripe.taxLines.at(-1), [139800, 1200]);
});

test("eleven concurrent discounted authorizations admit ten, cancel one, and commit each redemption once", async (t) => {
  const { env, stripe } = await setup(t);
  const drafts = await Promise.all(Array.from({ length: 11 }, () => create(env, { shipping: SHIPPING })));
  const intents = drafts.map((draft) => authorize(stripe, draft.id));
  const results = await Promise.all(intents.map((pi) => event(env, pi, "payment_intent.amount_capturable_updated")));
  const bodies = await Promise.all(results.map((res) => res.json()));
  assert.equal(bodies.filter((b) => b.captured).length, 10);
  assert.equal(bodies.filter((b) => b.canceled && b.blocked === "discount_unavailable").length, 1);
  assert.equal(stripe.canceled.length, 1);
  assert.deepEqual(await counts(env), { [SKU]: { reserved: 10, sold: 0, available: 90 }, [QUOTA]: { reserved: 10, sold: 0, available: 0 } });
  for (const pi of intents.filter((item) => item.status === "succeeded")) {
    const first = await event(env, pi, "payment_intent.succeeded"); assert.equal(first.status, 200);
    const duplicate = await event(env, pi, "payment_intent.succeeded"); assert.equal(duplicate.status, 200);
    const delayed = await event(env, pi, "payment_intent.amount_capturable_updated", "_late");
    assert.equal((await delayed.json()).duplicate, true);
  }
  assert.equal(stripe.captures.length, 10);
  assert.deepEqual(await counts(env), { [SKU]: { reserved: 0, sold: 10, available: 90 }, [QUOTA]: { reserved: 0, sold: 10, available: 0 } });
  const refundedPi = intents.find((pi) => pi.status === "succeeded");
  const refunded = await event(env, { id: "ch_voucher_refund", object: "charge", payment_intent: refundedPi.id, refunded: true }, "charge.refunded");
  assert.equal(refunded.status, 200);
  assert.equal((await counts(env))[QUOTA].available, 0);
});

test("ambiguous capture retains one quota hold; signed cancellation releases it once", async (t) => {
  const { env, stripe } = await setup(t);
  const draft = await create(env, { shipping: SHIPPING }); const pi = authorize(stripe, draft.id);
  stripe.setFailCapture(true);
  const failed = await event(env, pi, "payment_intent.amount_capturable_updated"); assert.equal(failed.status, 503);
  const retry = await event(env, pi, "payment_intent.amount_capturable_updated"); assert.equal(retry.status, 503);
  assert.equal((await counts(env))[QUOTA].reserved, 1);
  assert.equal((await counts(env))[SKU].reserved, 1);
  const failedPayment = await event(env, pi, "payment_intent.payment_failed");
  assert.equal((await failedPayment.json()).inventory, "retained");
  pi.status = "canceled";
  const canceled = await event(env, pi, "payment_intent.canceled"); assert.equal((await canceled.json()).duplicate, false);
  const twice = await event(env, pi, "payment_intent.canceled"); assert.equal((await twice.json()).duplicate, true);
  assert.deepEqual(await counts(env), { [SKU]: { reserved: 0, sold: 0, available: 100 }, [QUOTA]: { reserved: 0, sold: 0, available: 10 } });
});

test("the public inventory API never exposes private redemption inventory", async (t) => {
  const { env } = await setup(t);
  const all = await inventoryAvailability({ env, request: new Request("https://example.test/api/inventory-availability") });
  assert.equal(all.status, 200); assert.equal(JSON.stringify(await all.json()).includes(QUOTA), false);
  const explicit = await inventoryAvailability({ env, request: new Request("https://example.test/api/inventory-availability?sku=" + QUOTA) });
  assert.notEqual(explicit.status, 200); assert.equal(JSON.stringify(await explicit.json()).includes(QUOTA), false);
});

test("order views and receipts show the discount without disclosing the code", async (t) => {
  const { env, stripe } = await setup(t);
  const draft = await create(env, { shipping: SHIPPING }); const pi = stripe.intents.get(draft.id);
  const view = orderView(pi); assert.equal(view.breakdown.subtotal, 69900); assert.equal(view.breakdown.discount, 10000);
  assert.equal(JSON.stringify(view).includes(CODE), false);
  const html = receiptHtml(buildOrder(pi, CATALOG));
  assert.match(html, /Discount/); assert.match(html, /100\.00/); assert.equal(html.includes(CODE), false);
  pi.metadata.capture_block_reason = "discount_unavailable";
  assert.equal(orderView(pi).discountUnavailable, true); assert.equal(orderView(pi).soldOut, false);
});

test("expiry between checkout and authorization cancels rather than charging full price", async (t) => {
  const { env, db, stripe } = await setup(t);
  const draft = await create(env, { shipping: SHIPPING }); const pi = authorize(stripe, draft.id);
  db.sqlite.exec("UPDATE store_vouchers SET expires_at = 1");
  const res = await event(env, pi, "payment_intent.amount_capturable_updated");
  assert.equal(res.status, 200); assert.equal((await res.json()).blocked, "discount_unavailable");
  assert.equal(stripe.captures.length, 0); assert.equal(stripe.canceled.length, 1);
  assert.equal(pi.amount, draft.total);
  assert.equal((await counts(env))[QUOTA].available, 10);
});

test("a held authorization can safely retry and settle after the campaign expires", async (t) => {
  const { env, db, stripe } = await setup(t);
  const draft = await create(env, { shipping: SHIPPING }); const pi = authorize(stripe, draft.id);
  stripe.setFailCapture(true);
  assert.equal((await event(env, pi, "payment_intent.amount_capturable_updated")).status, 503);
  db.sqlite.exec("UPDATE store_vouchers SET expires_at = 1, active = 0");
  stripe.setFailCapture(false);
  const captured = await event(env, pi, "payment_intent.amount_capturable_updated");
  assert.equal((await captured.json()).captured, true);
  const succeeded = await event(env, pi, "payment_intent.succeeded");
  assert.equal(succeeded.status, 200);
  assert.equal((await succeeded.json()).blocked, undefined);
  assert.deepEqual((await counts(env))[QUOTA], { reserved: 0, sold: 1, available: 9 });
});

test("forged campaign metadata or a missing redemption binding cannot pass capture", async (t) => {
  const { env, stripe } = await setup(t);
  const forged = await create(env, { shipping: SHIPPING });
  const pi = authorize(stripe, forged.id); pi.metadata.voucher_discount = "20000";
  const rejected = await event(env, pi, "payment_intent.amount_capturable_updated");
  assert.equal((await rejected.json()).blocked, "discount_unavailable");
  assert.equal(stripe.captures.length, 0);

  const omitted = await create(env, { shipping: SHIPPING });
  const withoutCampaign = authorize(stripe, omitted.id);
  delete withoutCampaign.metadata.voucher_campaign; delete withoutCampaign.metadata.voucher_discount;
  const rejectedBinding = await event(env, withoutCampaign, "payment_intent.amount_capturable_updated");
  assert.equal((await rejectedBinding.json()).captured, false);
  assert.equal(stripe.captures.length, 0);
  assert.equal((await counts(env))[QUOTA].reserved, 0);
});

test("normal checkout remains independent of voucher configuration and client discount claims", async (t) => {
  const { env, db, stripe } = await setup(t);
  db.sqlite.exec("DROP TABLE store_vouchers");
  const draft = await create(env, { shipping: SHIPPING, voucherCode: "", voucher_campaign: CAMPAIGN, discount: 10000 });
  assert.equal(draft.discount || 0, 0);
  assert.deepEqual(stripe.taxLines.at(-1), [69900]);
  const pi = authorize(stripe, draft.id);
  assert.equal(pi.metadata.voucher_campaign || "", "");
  assert.equal(parseInventoryDemandJson(pi.metadata.inventory_demand).some((line) => line.sku === QUOTA), false);
  const captured = await event(env, pi, "payment_intent.amount_capturable_updated");
  assert.equal((await captured.json()).captured, true);
  const succeeded = await event(env, pi, "payment_intent.succeeded");
  assert.equal((await succeeded.json()).blocked, undefined);
  assert.equal((await counts(env))[QUOTA].available, 10);
});

test("an admitted authorization cannot remove its code or change the price before settlement", async (t) => {
  const { env, stripe } = await setup(t);
  const draft = await create(env, { shipping: SHIPPING }); const pi = authorize(stripe, draft.id);
  stripe.setFailCapture(true);
  assert.equal((await event(env, pi, "payment_intent.amount_capturable_updated")).status, 503);
  const previousAmount = pi.amount, previousMetadata = { ...pi.metadata };
  const stripeUpdatesBefore = stripe.requests.filter((r) => r.method === "POST" && r.target.endsWith("/" + draft.id)).length;
  const removal = await paymentIntent({ env, request: request("payment-intent", {
    cart: [frame()], paymentIntentId: draft.id, updateToken: draft.updateToken, shipping: SHIPPING, voucherCode: "",
  }) });
  assert.equal(removal.status, 409);
  assert.equal(stripe.requests.filter((r) => r.method === "POST" && r.target.endsWith("/" + draft.id)).length, stripeUpdatesBefore);
  assert.equal(pi.amount, previousAmount); assert.deepEqual(pi.metadata, previousMetadata);
  assert.deepEqual((await counts(env))[QUOTA], { reserved: 1, sold: 0, available: 9 });
});
