import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequestPost as paymentIntent } from "../functions/api/payment-intent.js";
import { onRequestPost as stripeWebhook } from "../functions/api/stripe-webhook.js";
import { onRequestPost as recoveryRequest } from "../functions/api/store-recovery.js";
import { reviewRecovery } from "../lib/store-recovery.js";

const ORIGIN = "http://127.0.0.1:8892";
const SECRET = "whsec_recovery_fixture";
const SKU = "avian-gen3-batch-02";
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
const CART = [{ id: "avian-visitors", build: "assembled-batch-2", qty: 1 }];
const CABLE = [{ id: "cable", build: "standard", qty: 1 }];
const reply = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const request = (path, body) => new Request(ORIGIN + "/api/" + path, {
  method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body),
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
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory).filter((name) => /^\d+.*\.sql$/.test(name)).sort())
      this.sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
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
  const intents = new Map(), requests = [];
  let count = 0;
  const fetch = async (url, options = {}) => {
    const target = String(url), form = options.body instanceof URLSearchParams ? options.body : null;
    requests.push({ target, method: options.method || "GET", body: form ? form.toString() : "" });
    if (target.endsWith("/store-catalog.json")) return reply(CATALOG);
    if (target.endsWith("/store-signup-catalog.json")) return reply(Object.fromEntries(Object.entries(CATALOG).map(([id, product]) => [id, Object.keys(product.variants)])));
    if (target.endsWith("/v1/prices/price_frame")) return reply({ active: true, unit_amount: 69900, currency: "usd" });
    if (target.endsWith("/v1/prices/price_cable")) return reply({ active: true, unit_amount: 1200, currency: "usd" });
    if (target.endsWith("/v1/tax/calculations")) {
      const amounts = [...form].filter(([key]) => /^line_items\[\d+\]\[amount\]$/.test(key)).map(([, value]) => Number(value));
      return reply({ id: "taxcalc_recovery", currency: "usd", tax_amount_exclusive: 600,
        amount_total: amounts.reduce((sum, amount) => sum + amount, 0) + Number(form.get("shipping_cost[amount]")) + 600 });
    }
    if (target.endsWith("/v1/tax/transactions/create_from_calculation")) return reply({ id: "tax_recovery_record" });
    if (target.endsWith("/v1/payment_intents")) {
      const id = "pi_recovery_" + ++count;
      const pi = { id, object: "payment_intent", client_secret: id + "_secret_fixture", currency: "usd", livemode: false,
        status: "requires_payment_method", capture_method: form.get("capture_method"), amount: Number(form.get("amount")),
        metadata: metadata(form) };
      intents.set(id, pi); return reply(pi);
    }
    const match = /\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)(?:\/(capture|cancel))?$/.exec(target);
    if (match) {
      const pi = intents.get(match[1]);
      assert.ok(pi, "Only known test intents may be used");
      if (match[2] === "capture") { pi.status = "succeeded"; pi.metadata = metadata(form, pi.metadata); return reply(pi); }
      if (match[2] === "cancel") { pi.status = "canceled"; return reply(pi); }
      if (form) {
        pi.metadata = metadata(form, pi.metadata);
        if (form.has("amount")) pi.amount = Number(form.get("amount"));
        if (form.has("capture_method")) pi.capture_method = form.get("capture_method");
      }
      return reply(pi);
    }
    throw new Error("Unexpected test request: " + target);
  };
  return { fetch, intents, requests };
}
async function setup(t, options = {}) {
  const db = new Database(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db, STORE_RECOVERY_ENABLED: "1", STORE_RECOVERY_MODE: "local",
    STRIPE_SECRET_KEY: "sk_test_recovery_fixture", STRIPE_PUBLISHABLE_KEY: "pk_test_recovery_fixture",
    STRIPE_WEBHOOK_SECRET: SECRET, ...options };
  const stripe = stripeMock(), previous = globalThis.fetch;
  globalThis.fetch = stripe.fetch; t.after(() => { globalThis.fetch = previous; });
  return { db, env, stripe };
}
async function create(env, body = {}) {
  const response = await paymentIntent({ env, request: request("payment-intent", { cart: CART, ...body }) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  return { ...data, id: data.clientSecret.split("_secret_")[0] };
}
async function event(env, pi, type = "payment_intent.succeeded", overrides = {}, badSignature = false) {
  const now = Math.floor(Date.now() / 1000);
  const value = { id: "evt_recovery_" + type.replace(/[^a-z]/g, "_") + "_" + pi.id,
    type, created: now, livemode: false, data: { object: pi }, ...overrides };
  const raw = JSON.stringify(value), signature = createHmac("sha256", SECRET).update(now + "." + raw).digest("hex");
  return stripeWebhook({ env, request: new Request(ORIGIN + "/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": `t=${now},v1=${badSignature ? "0".repeat(64) : signature}` }, body: raw,
  }) });
}
function authorize(stripe, id) {
  const pi = stripe.intents.get(id); pi.status = "requires_capture"; pi.amount_capturable = pi.amount; pi.shipping = SHIPPING; return pi;
}
async function journey(env) {
  const response = await recoveryRequest({ env, request: request("store-recovery", {
    action: "start", anon: "fixture_visitor", session: "session_" + randomUUID(), source: "direct",
  }) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  assert.ok(data.journeyId); assert.ok(data.journeyToken); return data;
}
function count(db, table) { return db.sqlite.prepare("SELECT count(*) AS count FROM " + table).get().count; }

// All provider traffic is intercepted. No email, charge, or external Stripe request occurs.
test("recovery stays inert without its feature flag, including untrusted journey fields", async (t) => {
  const { db, env, stripe } = await setup(t, { STORE_RECOVERY_ENABLED: undefined });
  const draft = await create(env, { cart: CABLE, shipping: SHIPPING, journeyId: "forged", journeyToken: "forged" });
  const pi = stripe.intents.get(draft.id); pi.status = "succeeded"; pi.shipping = SHIPPING;
  assert.equal(pi.metadata.recovery_journey, undefined);
  assert.equal(count(db, "store_recovery_checkouts"), 0);
  assert.equal((await event(env, pi)).status, 200);
  assert.equal(count(db, "store_recovery_purchases"), 0);
});

test("an invalid bearer cannot associate checkout, and does not prevent buying", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  const draft = await create(env, { ...identity, journeyToken: "invalid_token", leadId: identity.journeyId });
  assert.equal(stripe.intents.get(draft.id).metadata.recovery_journey, undefined);
  assert.equal(count(db, "store_recovery_checkouts"), 0);
  assert.equal(draft.total, 69900);
});

test("valid credentials associate create and update without placing bearer or email in recovery metadata", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  const draft = await create(env, identity);
  assert.equal(stripe.intents.get(draft.id).metadata.recovery_journey, identity.journeyId);
  assert.equal(count(db, "store_recovery_checkouts"), 1);
  const updated = await paymentIntent({ env, request: request("payment-intent", {
    cart: CART, shipping: SHIPPING, paymentIntentId: draft.id, updateToken: draft.updateToken,
    email: "fixture@example.com", ...identity,
  }) });
  assert.equal(updated.status, 200);
  const row = db.sqlite.prepare("SELECT * FROM store_recovery_checkouts WHERE payment_intent_id=?").get(draft.id);
  assert.equal(row.journey_id, identity.journeyId);
  assert.deepEqual(JSON.parse(row.cart_json), CART);
  assert.ok(row.email_hash);
  assert.equal(JSON.stringify(stripe.requests).includes(identity.journeyToken), false);
  assert.equal(JSON.stringify(await updated.json()).includes(identity.journeyId), false);
});

test("optional checkout tracking failure leaves the validated payment usable", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  db.sqlite.exec("DROP TABLE store_recovery_checkouts");
  const draft = await create(env, identity);
  assert.equal(draft.total, 69900);
  assert.equal(stripe.intents.get(draft.id).metadata.recovery_journey, identity.journeyId);
});

test("only verified succeeded events after the capture gate record a purchase, idempotently", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  const draft = await create(env, { ...identity, shipping: SHIPPING, email: "fixture@example.com" });
  const pi = authorize(stripe, draft.id);
  assert.equal(count(db, "store_recovery_purchases"), 0);
  assert.equal((await event(env, pi, "payment_intent.amount_capturable_updated")).status, 200);
  assert.equal(pi.status, "succeeded");
  assert.equal(count(db, "store_recovery_purchases"), 0, "authorization/capture response is not a succeeded event");
  assert.equal((await event(env, pi)).status, 200);
  assert.equal(count(db, "store_recovery_purchases"), 1);
  assert.equal((await event(env, pi)).status, 200);
  assert.equal((await event(env, pi, "payment_intent.succeeded", { id: "evt_recovery_replay" })).status, 200);
  assert.equal(count(db, "store_recovery_purchases"), 1);
  const purchase = db.sqlite.prepare("SELECT * FROM store_recovery_purchases").get();
  assert.equal(purchase.journey_id, identity.journeyId);
  assert.deepEqual(JSON.parse(purchase.cart_json), CART);
});

test("forged signatures, wrong modes and non-succeeded objects never mark an ordinary order paid", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  const draft = await create(env, { ...identity, cart: CABLE, shipping: SHIPPING });
  const pi = stripe.intents.get(draft.id); pi.status = "succeeded"; pi.shipping = SHIPPING;
  assert.equal((await event(env, pi, "payment_intent.succeeded", {}, true)).status, 400);
  assert.equal((await event(env, pi, "payment_intent.succeeded", { livemode: true })).status, 400);
  pi.livemode = true;
  assert.equal((await event(env, pi)).status, 400);
  pi.livemode = false; pi.status = "requires_capture";
  assert.equal((await event(env, pi)).status, 400);
  assert.equal(count(db, "store_recovery_purchases"), 0);
  assert.equal(stripe.requests.some((r) => r.target.includes("transactions/create_from_calculation")), false);
});

test("a profiled success without capture approval cannot mark a journey purchased", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  const draft = await create(env, { ...identity, shipping: SHIPPING });
  const pi = authorize(stripe, draft.id);
  await event(env, pi, "payment_intent.amount_capturable_updated");
  pi.metadata.capture_gate = "pending";
  const result = await event(env, pi);
  assert.equal((await result.json()).blocked, "capture_gate_not_approved");
  assert.equal(count(db, "store_recovery_purchases"), 0);
});

test("purchase tracking failure retries before receipts and repairs even an already-notified order", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  const draft = await create(env, { ...identity, cart: CABLE, shipping: SHIPPING });
  const pi = stripe.intents.get(draft.id); pi.status = "succeeded"; pi.shipping = SHIPPING;
  db.sqlite.exec("DROP TABLE store_recovery_purchases");
  const pending = await event(env, pi);
  assert.equal(pending.status, 503); assert.equal((await pending.json()).blocked, "recovery_purchase_pending");
  assert.equal(pi.metadata.notified, undefined);
  assert.equal(stripe.requests.some((r) => r.target.includes("transactions/create_from_calculation")), false);
  db.sqlite.exec(readFileSync(new URL("../migrations/0004_store_recovery.sql", import.meta.url), "utf8"));
  // A previous fulfillment run can already have sent mail. Tracking must still repair.
  pi.metadata.notified = "1";
  const repaired = await event(env, pi);
  assert.equal(repaired.status, 200); assert.equal((await repaired.json()).duplicate, true);
  assert.equal(count(db, "store_recovery_purchases"), 1);
  assert.equal(stripe.requests.some((r) => r.target.includes("transactions/create_from_calculation")), false);
});

test("a verified purchase matches the same contact and product in another journey", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identities = [await journey(env), await journey(env)];
  for (const identity of identities) {
    const signup = await recoveryRequest({ env, request: request("store-recovery", {
      action: "newsletter", ...identity, requestId: randomUUID(), email: "same-buyer@example.com",
      product: "avian-visitors", build: "assembled-batch-2", copyVersion: "avian-newsletter-v1",
    }) });
    assert.equal(signup.status, 200, JSON.stringify(await signup.json()));
  }
  const draft = await create(env, { shipping: SHIPPING, email: "SAME-BUYER@example.com" });
  const pi = authorize(stripe, draft.id);
  assert.equal(pi.metadata.recovery_journey, undefined, "the purchase may happen in a fresh browser");
  await event(env, pi, "payment_intent.amount_capturable_updated");
  assert.equal((await event(env, pi)).status, 200);
  assert.equal(count(db, "store_recovery_purchases"), 1);
  const review = await reviewRecovery(env, { requestUrl: ORIGIN + "/api/store-recovery" });
  assert.equal(review.visits.length, 2);
  assert.ok(review.visits.every((visit) => visit.purchaseStatus === "purchased" && visit.followUpEligible === false));
});

test("an unusable optional email cannot trap verified purchase tracking in permanent retry", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  const draft = await create(env, { ...identity, cart: CABLE, shipping: SHIPPING, email: "fixture@localhost" });
  const pi = stripe.intents.get(draft.id); pi.status = "succeeded"; pi.shipping = SHIPPING;
  const response = await event(env, pi);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(count(db, "store_recovery_purchases"), 1);
  assert.equal(db.sqlite.prepare("SELECT journey_id FROM store_recovery_purchases").get().journey_id, identity.journeyId);
});

test("an existing payment keeps its validated journey when another valid journey updates the cart", async (t) => {
  const { db, env, stripe } = await setup(t);
  const first = await journey(env), other = await journey(env);
  const draft = await create(env, first);
  const response = await paymentIntent({ env, request: request("payment-intent", {
    cart: CART, shipping: SHIPPING, paymentIntentId: draft.id, updateToken: draft.updateToken, ...other,
  }) });
  assert.equal(response.status, 200);
  assert.equal(stripe.intents.get(draft.id).metadata.recovery_journey, first.journeyId);
  assert.equal(db.sqlite.prepare("SELECT journey_id FROM store_recovery_checkouts WHERE payment_intent_id=?").get(draft.id).journey_id, first.journeyId);
});

test("verified success repairs a missing checkout map using the server-stamped journey", async (t) => {
  const { db, env, stripe } = await setup(t);
  const identity = await journey(env);
  const draft = await create(env, { ...identity, cart: CABLE, shipping: SHIPPING });
  db.sqlite.prepare("DELETE FROM store_recovery_checkouts WHERE payment_intent_id=?").run(draft.id);
  const pi = stripe.intents.get(draft.id); pi.status = "succeeded"; pi.shipping = SHIPPING;
  assert.equal((await event(env, pi)).status, 200);
  assert.equal(db.sqlite.prepare("SELECT journey_id FROM store_recovery_purchases").get().journey_id, identity.journeyId);
});
