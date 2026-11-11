import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { onRequestPost as paymentIntent } from "../functions/api/payment-intent.js";
import { onRequestPost as stripeWebhook } from "../functions/api/stripe-webhook.js";
import { readInventoryAvailability, readInventoryReservation } from "../lib/store-inventory.js";
import { verifyCheckoutBinding } from "../lib/shipping-binding.js";
import { verifyBoundInventoryMetadata } from "../lib/store-inventory-commerce.js";

// Synthetic provider fixture. These tests exercise the actual HTTP handlers,
// catalog/tax bindings, signature verification, and inventory migration/functions.
const SKU = "avian-gen3-batch-01", SECRET = "whsec_scope_replacement_fixture";
const SHIPPING = { name: "Test Buyer", address: { line1: "1 Test St", line2: "Unit 3", city: "San Francisco", state: "CA", postal_code: "94107", country: "US" } };
const CATALOG = {
  frame: { title: "Frame", variants: { assembled: { price: "price_frame", weightLb: 4, maxQty: 5, label: "Batch 1", priceUsd: 699, shippingProfile: "contiguous-us-ground", inventorySku: SKU } } },
  mic: { title: "Bird Mic", variants: { printed: { price: "price_mic", weightLb: 0.75, maxQty: 10, label: "With printed case", priceUsd: 210 } } },
};
const frame = (qty = 1) => ({ id: "frame", build: "assembled", qty });
const mic = () => ({ id: "mic", build: "printed", qty: 1 });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class Statement {
  constructor(db, sql, values = []) { Object.assign(this, { db, sql, values }); }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  run() { const result = this.db.sqlite.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
}
class Database {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec(readFileSync(new URL("../migrations/0001_store_inventory.sql", import.meta.url), "utf8")); }
  prepare(sql) { return new Statement(this, sql); }
  withSession(mode) { assert.equal(mode, "first-primary"); return this; }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try { const result = statements.map(s => s.run()); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
function applyMetadata(form, prior = {}) {
  const result = { ...prior };
  for (const [key, value] of form) {
    const match = /^metadata\[([^\]]+)\]$/.exec(key);
    if (match) { if (value) result[match[1]] = value; else delete result[match[1]]; }
  }
  return result;
}
function fixture(t) {
  const db = new Database(), intents = new Map(), captures = [], mutations = [];
  const env = { STORE_INVENTORY: db, STRIPE_SECRET_KEY: "sk_test_scope_replacement", STRIPE_PUBLISHABLE_KEY: "pk_test_scope_replacement", STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_fixture" };
  let sequence = 0;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; db.sqlite.close(); });
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url), form = options.body instanceof URLSearchParams ? options.body : null;
    if (target.endsWith("/store-catalog.json")) return response(CATALOG);
    if (target.endsWith("/v1/prices/price_frame")) return response({ active: true, unit_amount: 69900, currency: "usd" });
    if (target.endsWith("/v1/prices/price_mic")) return response({ active: true, unit_amount: 21000, currency: "usd" });
    if (target.endsWith("/v1/tax/calculations")) {
      const subtotal = [...form].filter(([key]) => /^line_items\[\d+\]\[amount\]$/.test(key)).reduce((sum, [, value]) => sum + Number(value), 0);
      return response({ id: "taxcalc_scope", currency: "usd", tax_amount_exclusive: 600, amount_total: subtotal + Number(form.get("shipping_cost[amount]")) + 600 });
    }
    if (target.endsWith("/v1/tax/transactions/create_from_calculation")) return response({ id: "tax_scope" });
    if (target === "https://api.resend.com/emails") return response({ id: "email_scope" });
    if (target.endsWith("/v1/payment_intents")) {
      const id = "pi_scope_" + ++sequence;
      const pi = { id, object: "payment_intent", client_secret: id + "_secret_fixture", livemode: false, status: "requires_payment_method", amount: Number(form.get("amount")), currency: "usd", capture_method: form.get("capture_method"), metadata: applyMetadata(form) };
      intents.set(id, pi); mutations.push(target); return response(pi);
    }
    const match = /\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)(?:\/(capture|cancel))?$/.exec(target);
    if (match) {
      const pi = intents.get(match[1]); assert.ok(pi, "Only known fixture intents may be read or changed");
      if (options.method === "POST") mutations.push(target);
      if (match[2] === "capture") {
        assert.equal(pi.status, "requires_capture");
        assert.equal(Number(form.get("amount_to_capture")), pi.amount);
        captures.push(pi.id); pi.status = "succeeded";
      } else if (match[2] === "cancel") pi.status = "canceled";
      if (form) {
        pi.metadata = applyMetadata(form, pi.metadata);
        if (form.has("amount")) pi.amount = Number(form.get("amount"));
        if (form.has("capture_method")) pi.capture_method = form.get("capture_method");
      }
      return response(pi);
    }
    throw new Error("Unexpected fixture request: " + target);
  };
  const post = body => paymentIntent({ env, request: new Request("https://example.test/api/payment-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  async function create(cart) {
    const r = await post({ cart }); assert.equal(r.status, 200);
    const body = await r.json(); return { ...body, id: body.clientSecret.split("_secret_")[0] };
  }
  async function event(type, pi, eventId) {
    const at = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: eventId, type, created: at, livemode: false, data: { object: pi } });
    const sig = createHmac("sha256", SECRET).update(at + "." + body).digest("hex");
    return stripeWebhook({ env, request: new Request("https://example.test/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": `t=${at},v1=${sig}` }, body }) });
  }
  return { db, env, intents, captures, mutations, post, create, event };
}

for (const scenario of [
  { name: "adding a finite frame to a mic", before: [mic()], after: [mic(), frame()], units: 1 },
  { name: "removing the finite frame from a mixed order", before: [mic(), frame()], after: [mic()], units: 0 },
  { name: "changing finite frame quantity", before: [frame()], after: [frame(2)], units: 2 },
]) {
  test(`${scenario.name} requires a new intent, then settles exactly the replacement cart`, async (t) => {
    const h = fixture(t), old = await h.create(scenario.before);
    const oldSnapshot = structuredClone(h.intents.get(old.id)), mutationCount = h.mutations.length;
    const rejected = await h.post({ cart: scenario.after, paymentIntentId: old.id, updateToken: old.updateToken, shipping: SHIPPING, email: "buyer@example.com", finalize: true });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, "Could not update checkout.");
    assert.equal(h.mutations.length, mutationCount, "A mismatched scope must fail before any Stripe mutation");
    assert.deepEqual(h.intents.get(old.id), oldSnapshot);

    const replacement = await h.create(scenario.after);
    assert.notEqual(replacement.id, old.id);
    const wrongOwner = await h.post({ cart: scenario.after, paymentIntentId: replacement.id, updateToken: old.updateToken, shipping: SHIPPING, email: "buyer@example.com" });
    assert.equal(wrongOwner.status, 400, "The predecessor's token cannot authorize the replacement intent");
    const [beforePayment] = await readInventoryAvailability(h.env, [SKU]);
    assert.equal(beforePayment.reserved, 0); assert.equal(beforePayment.sold, 0);
    assert.equal(await readInventoryReservation(h.env, old.id), null);
    assert.equal(await readInventoryReservation(h.env, replacement.id), null);

    const finalized = await h.post({ cart: scenario.after, paymentIntentId: replacement.id, updateToken: replacement.updateToken, shipping: SHIPPING, email: "buyer@example.com", finalize: true });
    assert.equal(finalized.status, 200);
    const pi = h.intents.get(replacement.id);
    assert.ok(await verifyCheckoutBinding(pi.metadata, CATALOG), "Replacement retains exact catalog, manifest and profile binding");
    if (scenario.units) assert.equal((await verifyBoundInventoryMetadata(pi)).demand[0].quantity, scenario.units);
    else assert.equal(pi.metadata.inventory_state, undefined);
    pi.shipping = structuredClone(SHIPPING);

    if (scenario.units) {
      pi.status = "requires_capture"; pi.amount_capturable = pi.amount;
      const captured = await h.event("payment_intent.amount_capturable_updated", pi, "evt_scope_authorized");
      assert.equal(captured.status, 200); assert.equal((await captured.json()).captured, true);
      assert.equal(pi.status, "succeeded");
      assert.equal((await readInventoryReservation(h.env, replacement.id)).status, "active");
      const admittedSnapshot = structuredClone(pi), admittedMutations = h.mutations.length;
      const admittedUpdate = await h.post({ cart: scenario.after, paymentIntentId: replacement.id, updateToken: replacement.updateToken, shipping: SHIPPING, email: "buyer@example.com" });
      assert.equal(admittedUpdate.status, 409, "Once inventory is admitted, even its valid token cannot rewrite payment terms");
      assert.equal(h.mutations.length, admittedMutations);
      assert.deepEqual(pi, admittedSnapshot);
      const repeated = await h.event("payment_intent.amount_capturable_updated", pi, "evt_scope_authorized_again");
      assert.equal((await repeated.json()).duplicate, true);
      assert.deepEqual(h.captures, [replacement.id]);
    } else {
      assert.equal(pi.capture_method, "automatic");
      pi.status = "succeeded"; // Fixture for Stripe's normal automatic-confirm result.
    }
    const paid = await h.event("payment_intent.succeeded", pi, "evt_scope_paid");
    assert.equal(paid.status, 200);
    const repeatedPaid = await h.event("payment_intent.succeeded", pi, "evt_scope_paid_again");
    assert.equal(repeatedPaid.status, 200);
    const [afterPayment] = await readInventoryAvailability(h.env, [SKU]);
    assert.equal(afterPayment.reserved, 0); assert.equal(afterPayment.sold, scenario.units);
    assert.equal(await readInventoryReservation(h.env, old.id), null);
    assert.deepEqual(h.intents.get(old.id), oldSnapshot, "Replacement neither confirms nor mutates its abandoned predecessor");
    assert.equal(pi.metadata.notified, "1");
  });
}
