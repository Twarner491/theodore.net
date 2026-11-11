import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { onRequestPost as paymentIntent } from "../functions/api/payment-intent.js";
import { onRequestPost as stripeWebhook } from "../functions/api/stripe-webhook.js";
import { onRequestGet as productionBatch } from "../functions/api/production-batch.js";
import { readProductionBatch } from "../lib/store-production-batches.js";
import { createCheckoutBinding, verifyCheckoutBinding } from "../lib/shipping-binding.js";
import { buildOrder, receiptHtml } from "../lib/emails.js";
import { orderView } from "../lib/order-view.js";
import { productionBatchesForItem } from "../lib/order-production-batches.js";
import { readInventoryAvailability, readInventoryReservation } from "../lib/store-inventory.js";
import { resolveVoucher, voucherFromMetadata } from "../lib/store-vouchers.js";

const SECRET = "whsec_production_fixture";
const VOUCHER_CODE = "TEST-CONTINUOUS-FAMILY-ONLY";
const VOUCHER_CAMPAIGN = "avian-holidays-2026", VOUCHER_QUOTA = "voucher-avian-holidays-2026";
const SHIPPING = { name: "Test Buyer", address: { line1: "1 Test St", city: "San Francisco", state: "CA", postal_code: "94107", country: "US" } };
const BUILD = "assembled-continuous", GROUP = "avian-visitors";
const frame = (qty = 1, build = BUILD) => ({ id: GROUP, build, qty });
const mic = { id: "avian-mic", build: "printed", qty: 1 };
const BASE = { price: "price_frame", weightLb: 4, maxQty: 20, label: "Assembled", priceUsd: 699, shippingProfile: "contiguous-us-ground" };
const CATALOG = {
  [GROUP]: { title: "Avian Visitors", variants: {
    assembled: { ...BASE, label: "Assembled (Batch 1)", inventorySku: "avian-gen3-batch-01" },
    "assembled-batch-2": { ...BASE, label: "Assembled (Batch 2)", inventorySku: "avian-gen3-batch-02" },
    [BUILD]: { ...BASE, productionBatchGroup: GROUP },
  } },
  "avian-mic": { title: "Bird Mic", variants: { printed: { price: "price_mic", weightLb: 0.75, maxQty: 20, label: "Printed", priceUsd: 210 } } },
};
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class Statement {
  constructor(db, sql, values = []) { Object.assign(this, { db, sql, values }); }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  async run() { const result = this.db.sqlite.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
}
class Database {
  constructor(productionSchema = true) {
    this.sqlite = new DatabaseSync(":memory:");
    for (const name of ["0001_store_inventory.sql", "0002_avian_batch_2.sql", "0003_store_vouchers.sql", "0005_avian_batch_2_capacity_30.sql", ...(productionSchema ? ["0007_production_batches.sql"] : [])]) this.sqlite.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
    this.sqlite.exec("UPDATE store_inventory_batches SET sold_quantity=20 WHERE sku='avian-gen3-batch-01'; UPDATE store_inventory_batches SET sold_quantity=29 WHERE sku='avian-gen3-batch-02'");
    // Synthetic signed-history fixtures reconcile all 49 legacy units. Ten
    // recent dates have two units each, so either calendar's recent median is 2.
    const day = 86400, noon = Math.floor(Date.now() / 1000 / day) * day + 12 * 3600;
    const history = (id, sku, quantity, daysAgo) => {
      const paidAt = noon - daysAgo * day;
      this.sqlite.prepare(`INSERT INTO store_inventory_reservations
        (payment_intent_id,status,expires_at,created_at,updated_at,sold_at,provider_event_id,provider_event_created_at,provider_outcome)
        VALUES (?,'sold',?,?,?,?,?,?,'succeeded')`).run(id, paidAt + day, paidAt - 60, paidAt + 1, paidAt + 1, "evt_" + id, paidAt);
      this.sqlite.prepare("INSERT INTO store_inventory_reservation_lines VALUES (?,?,?,?,?)").run(id, sku, quantity, quantity, quantity);
    };
    history("pi_history_batch_1", "avian-gen3-batch-01", 20, 25);
    history("pi_history_batch_2", "avian-gen3-batch-02", 9, 20);
    for (let i = 1; i <= 10; i++) history("pi_history_recent_" + i, "avian-gen3-batch-02", 2, i);
  }
  prepare(sql) { return new Statement(this, sql); }
  withSession(mode) { assert.equal(mode, "first-primary"); return this; }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(s => { const result = this.sqlite.prepare(s.sql).run(...s.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; });
      this.sqlite.exec("COMMIT"); return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
function applyMetadata(form, metadata = {}) {
  const result = { ...metadata };
  for (const [key, value] of form) { const match = /^metadata\[([^\]]+)\]$/.exec(key); if (match) { if (value) result[match[1]] = value; else delete result[match[1]]; } }
  return result;
}
function fixture(t, { productionSchema = true, voucher = false } = {}) {
  const db = new Database(productionSchema), catalog = structuredClone(CATALOG), intents = new Map(), emails = [], requests = [], taxLines = [];
  if (voucher) db.sqlite.prepare("UPDATE store_vouchers SET code_sha256=?,active=1 WHERE id=?")
    .run(createHash("sha256").update(VOUCHER_CODE).digest("hex"), VOUCHER_CAMPAIGN);
  const env = { STORE_INVENTORY: db, STRIPE_SECRET_KEY: "sk_test_production_fixture", STRIPE_PUBLISHABLE_KEY: "pk_test_production_fixture", STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_fixture" };
  let sequence = 0, failMetadata = false, failCapture = false, failIntentRead = false;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; db.sqlite.close(); });
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url), form = options.body instanceof URLSearchParams ? options.body : null;
    requests.push(target);
    if (target.endsWith("/store-catalog.json")) return response(catalog);
    if (target.endsWith("/v1/prices/price_frame")) return response({ active: true, unit_amount: 69900, currency: "usd" });
    if (target.endsWith("/v1/prices/price_mic")) return response({ active: true, unit_amount: 21000, currency: "usd" });
    if (target.endsWith("/v1/tax/calculations")) {
      const amounts = [...form].filter(([key]) => /^line_items\[\d+\]\[amount\]$/.test(key)).map(([, value]) => Number(value));
      taxLines.push(amounts);
      const subtotal = amounts.reduce((sum, value) => sum + value, 0);
      return response({ id: "taxcalc_production", currency: "usd", tax_amount_exclusive: 600, amount_total: subtotal + Number(form.get("shipping_cost[amount]")) + 600 });
    }
    if (target.endsWith("/v1/tax/transactions/create_from_calculation")) return response({ id: "tax_fixture" });
    if (target === "https://api.resend.com/emails") { emails.push(JSON.parse(options.body)); return response({ id: "email_fixture" }); }
    if (target.endsWith("/v1/payment_intents")) {
      const id = "pi_production_" + ++sequence;
      const pi = { id, object: "payment_intent", client_secret: id + "_secret_fixture", livemode: false, status: "requires_payment_method", amount: Number(form.get("amount")), currency: "usd", capture_method: form.get("capture_method"), metadata: applyMetadata(form) };
      intents.set(id, pi); return response(pi);
    }
    const match = /\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)(?:\/(capture|cancel))?$/.exec(target.split("?")[0]);
    if (match) {
      if (!form && failIntentRead) return response({}, 503);
      const pi = intents.get(match[1]); assert.ok(pi);
      if (form?.has("metadata[production_batches]") && failMetadata) { failMetadata = false; return response({}, 503); }
      if (match[2] === "capture") {
        if (failCapture) return response({}, 503);
        assert.equal(pi.status, "requires_capture"); pi.status = "succeeded"; pi.amount_received = pi.amount;
        pi.latest_charge = { id: "ch_" + pi.id, object: "charge", payment_intent: pi.id, status: "succeeded", paid: true, captured: true,
          livemode: false, currency: pi.currency, amount: pi.amount, amount_captured: pi.amount, created: Math.floor(Date.now() / 1000) - 3 };
      }
      else if (match[2] === "cancel") pi.status = "canceled";
      if (form) {
        pi.metadata = applyMetadata(form, pi.metadata);
        if (form.has("amount")) pi.amount = Number(form.get("amount"));
        if (form.has("capture_method")) pi.capture_method = form.get("capture_method");
      }
      return response(pi);
    }
    throw new Error("Unexpected fixture request: " + target);
  };
  const post = body => paymentIntent({ env, request: new Request("https://example.test/api/payment-intent", { method: "POST", body: JSON.stringify(body) }) });
  async function create(cart, extra = {}) { const r = await post({ cart, ...extra }); assert.equal(r.status, 200, await r.clone().text()); const data = await r.json(); return { ...data, id: data.clientSecret.split("_secret_")[0] }; }
  async function finalize(intent, cart, extra = {}) { const r = await post({ cart, paymentIntentId: intent.id, updateToken: intent.updateToken, shipping: SHIPPING, email: "buyer@example.test", finalize: true, ...extra }); assert.equal(r.status, 200, await r.clone().text()); const pi = intents.get(intent.id); pi.shipping = structuredClone(SHIPPING); return pi; }
  async function event(type, pi, id, created = Math.floor(Date.now() / 1000)) {
    const timestamp = Math.floor(Date.now() / 1000), body = JSON.stringify({ id, type, created, livemode: false, data: { object: pi } });
    const signature = createHmac("sha256", SECRET).update(timestamp + "." + body).digest("hex");
    return stripeWebhook({ env, request: new Request("https://example.test/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body }) });
  }
  async function authorize(pi, id = "evt_authorized") { pi.status = "requires_capture"; pi.amount_capturable = pi.amount; const r = await event("payment_intent.amount_capturable_updated", pi, id); assert.equal(r.status, 200, await r.clone().text()); assert.equal((await r.json()).captured, true); }
  const publicState = () => productionBatch({ env, request: new Request("https://example.test/api/production-batch?group=avian-visitors") });
  return { db, env, catalog, intents, emails, requests, taxLines, create, post, finalize, event, authorize, publicState, failNextMetadata() { failMetadata = true; }, failCapture(value) { failCapture = value; }, failIntentRead(value) { failIntentRead = value; } };
}

test("real checkout and signed paid handlers allocate only paid frames, split rollover, and preserve original receipt batches", async t => {
  const h = fixture(t), initial = await h.publicState();
  assert.match(initial.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await initial.json(), { group: GROUP, ordinal: 3, remaining: 15, paused: false });
  const one = await h.create([frame(5)]), two = await h.create([frame(15)]);
  const p1 = await h.finalize(one, [frame(5)]), p2 = await h.finalize(two, [frame(15)]);
  assert.equal((await readProductionBatch(h.env)).remaining, 15, "views, drafts and tax quotes allocate nothing");
  await h.event("payment_intent.payment_failed", p1, "evt_failed");
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  await h.authorize(p1);
  assert.equal((await readProductionBatch(h.env)).remaining, 15, "capture authorization is not counted as a paid webhook");
  assert.equal(orderView(p1).status, "processing", "confirmation waits for the allocation to be recorded");
  const paidAt = Math.floor(Date.now() / 1000) - 2;
  assert.equal((await h.event("payment_intent.succeeded", p1, "evt_paid_one", paidAt)).status, 200);
  assert.equal(p1.metadata.production_paid_at, String(paidAt));
  assert.equal((await readProductionBatch(h.env)).remaining, 10);
  const firstReceipt = p1.metadata.production_batches, sent = h.emails.length;
  h.env.PRODUCTION_BATCH_PAUSED = "1";
  await h.authorize(p2, "evt_authorized_two");
  assert.equal((await h.event("payment_intent.succeeded", p2, "evt_paid_two")).status, 200, "accepted callbacks finish during an intake pause");
  const current = await readProductionBatch(h.env);
  assert.equal(current.ordinal, 4); assert.equal(current.remaining, current.capacity - 5);
  assert.deepEqual(productionBatchesForItem(p2.metadata, frame(15)), [{ ordinal: 3, label: "Batch 3", quantity: 10 }, { ordinal: 4, label: "Batch 4", quantity: 5 }]);
  assert.equal((await h.event("payment_intent.succeeded", p1, "evt_paid_one_duplicate", paidAt + 1)).status, 200);
  assert.equal(p1.metadata.production_batches, firstReceipt);
  assert.equal(p1.metadata.production_paid_at, String(paidAt), "distinct callback retries preserve the first paid timestamp");
  assert.equal((await readProductionBatch(h.env)).remaining, current.remaining);
  assert.equal(h.emails.length, sent + 1, "duplicate distinct event cannot send the old receipt again");
  const order = buildOrder(p2, h.catalog);
  assert.match(receiptHtml(order), /Batch 3 × 10, Batch 4 × 5/);
  assert.equal(orderView(p2).status, "succeeded");
});

test("pause rejects new intake and ordinary-PI bypasses but lets accepted frame quantities finish", async t => {
  const h = fixture(t), existing = await h.create([frame(2)]), ordinary = await h.create([mic]);
  h.env.PRODUCTION_BATCH_PAUSED = "1";
  assert.equal((await h.post({ cart: [frame()] })).status, 409);
  const update = (pi, cart) => h.post({ cart, paymentIntentId: pi.id, updateToken: pi.updateToken, shipping: SHIPPING, email: "buyer@example.test" });
  assert.equal((await update(ordinary, [mic, frame()])).status, 409);
  assert.equal((await update(existing, [frame(3)])).status, 409);
  assert.equal((await update(existing, [frame(2), mic])).status, 200);
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  assert.equal((await (await h.publicState()).json()).paused, true);
});

test("new frame checkouts enforce real remaining quantity, including duplicate cart lines, without reserving slots", async t => {
  const h = fixture(t);
  for (const cart of [[frame(16)], [frame(8), frame(8)]]) {
    const before = h.requests.length;
    const result = await h.post({ cart });
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), {
      error: "Only 15 frames remain in the current batch. Please update your cart.",
      code: "production_quantity_limit", item: { id: GROUP, build: BUILD }, maxQuantity: 15, currentOrdinal: 3,
    });
    assert.deepEqual(h.requests.slice(before), ["https://example.test/store-catalog.json"], "reject before any Stripe price, tax or mutation request");
    assert.equal(h.intents.size, 0);
  }
  await h.create([frame(15), mic]);
  assert.equal((await readProductionBatch(h.env)).remaining, 15, "an admitted draft holds no units");
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) n FROM production_paid_orders").get().n, 0);
});

test("draft quotes and finalization reject increases over remaining; exact sellout immediately admits the next batch", async t => {
  const h = fixture(t), stale = await h.create([frame()]);
  const other = await h.create([frame(14)]), otherPi = await h.finalize(other, [frame(14)]);
  await h.authorize(otherPi);
  assert.equal((await h.event("payment_intent.succeeded", otherPi, "evt_cap_other_paid")).status, 200);
  const beforePi = structuredClone(h.intents.get(stale.id));
  for (const finalize of [false, true]) {
    const before = h.requests.length;
    const result = await h.post({ cart: [frame(3)], paymentIntentId: stale.id, updateToken: stale.updateToken,
      shipping: SHIPPING, email: "buyer@example.test", finalize });
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), {
      error: "Only 1 frame remains in the current batch. Please update your cart.",
      code: "production_quantity_limit", item: { id: GROUP, build: BUILD }, maxQuantity: 1, currentOrdinal: 3,
    });
    assert.deepEqual(h.requests.slice(before), ["https://example.test/store-catalog.json", "https://api.stripe.com/v1/payment_intents/" + stale.id]);
    assert.deepEqual(h.intents.get(stale.id), beforePi, "rejection must not alter the existing intent");
  }
  const corrected = await h.finalize(stale, [frame()]);
  await h.authorize(corrected);
  assert.equal((await h.event("payment_intent.succeeded", corrected, "evt_cap_last_paid")).status, 200);
  const next = await readProductionBatch(h.env);
  assert.deepEqual([next.ordinal, next.capacity, next.remaining], [4, 15, 15]);
  await h.create([frame(15)]);
});

test("a quantity rejection cannot change an accepted authorization, including during an intake pause", async t => {
  const h = fixture(t), accepted = await h.create([frame(2)]), pi = await h.finalize(accepted, [frame(2)]);
  pi.status = "requires_capture"; pi.amount_capturable = pi.amount;
  const other = await h.create([frame(14)]), otherPi = await h.finalize(other, [frame(14)]);
  await h.authorize(otherPi);
  assert.equal((await h.event("payment_intent.succeeded", otherPi, "evt_cap_concurrent_paid")).status, 200);
  h.env.PRODUCTION_BATCH_PAUSED = "1";
  const beforePi = structuredClone(pi);
  const rejected = await h.post({ cart: [frame(3)], paymentIntentId: accepted.id, updateToken: accepted.updateToken,
    shipping: SHIPPING, email: "buyer@example.test", finalize: true });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, "production_paused", "a pause remains stricter than ordinary intake limits");
  assert.deepEqual(pi, beforePi, "do not cancel or rewrite an authorization when rejecting a new quote");
  await h.authorize(pi, "evt_cap_accepted_authorization");
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_cap_accepted_paid")).status, 200);
  assert.deepEqual(productionBatchesForItem(pi.metadata, frame(2)), [
    { ordinal: 3, label: "Batch 3", quantity: 1 }, { ordinal: 4, label: "Batch 4", quantity: 1 },
  ]);
  const next = await readProductionBatch(h.env);
  assert.deepEqual([next.ordinal, next.capacity, next.remaining], [4, 15, 14]);
});

test("verified pre-release twenty-frame drafts can finish without grandfathering new quantities or unrelated tokens", async t => {
  const h = fixture(t), old = await h.create([frame()]), ordinary = await h.create([mic]);
  // Reconstruct the bound draft accepted before the dynamic limit existed.
  const accepted = await createCheckoutBinding([frame(20)], h.catalog), oldPi = h.intents.get(old.id);
  Object.assign(oldPi.metadata, { items: accepted.legacyItems, shipping_items: accepted.manifestJson,
    shipping_items_sha256: accepted.manifestSha256, shipping_catalog_sha256: accepted.catalogSha256 });
  oldPi.amount = 20 * 69900;
  assert.ok(await verifyCheckoutBinding(oldPi.metadata, h.catalog));
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  const unrelated = await h.post({ cart: [frame(20)], paymentIntentId: ordinary.id, updateToken: ordinary.updateToken,
    shipping: SHIPPING, email: "buyer@example.test", finalize: true });
  assert.equal(unrelated.status, 409);
  assert.equal((await unrelated.json()).code, "production_quantity_limit");
  assert.equal(h.intents.get(ordinary.id).metadata.items, "avian-mic|printed|1");
  h.env.PRODUCTION_BATCH_PAUSED = "1";
  await h.finalize(old, [frame(20)]);
  assert.equal((await readProductionBatch(h.env)).remaining, 15, "grandfathering does not reserve production");
  await h.authorize(oldPi);
  assert.equal((await h.event("payment_intent.succeeded", oldPi, "evt_pre_cap_draft_paid")).status, 200);
  assert.deepEqual(productionBatchesForItem(oldPi.metadata, frame(20)), [
    { ordinal: 3, label: "Batch 3", quantity: 15 }, { ordinal: 4, label: "Batch 4", quantity: 5 },
  ]);
});

test("unverifiable prior quantities and unavailable production reads fail before price, tax or intent writes", async t => {
  const h = fixture(t), old = await h.create([frame(15)]);
  const accepted = await createCheckoutBinding([frame(20)], h.catalog);
  Object.assign(h.intents.get(old.id).metadata, { items: accepted.legacyItems, shipping_items: accepted.manifestJson,
    shipping_items_sha256: accepted.manifestSha256, shipping_catalog_sha256: accepted.catalogSha256 });
  const post = () => h.post({ cart: [frame(16)], paymentIntentId: old.id, updateToken: old.updateToken,
    shipping: SHIPPING, email: "buyer@example.test", finalize: true });
  const beforePi = structuredClone(h.intents.get(old.id));
  h.failIntentRead(true);
  let before = h.requests.length;
  assert.equal((await post()).status, 503);
  assert.deepEqual(h.requests.slice(before), ["https://example.test/store-catalog.json", "https://api.stripe.com/v1/payment_intents/" + old.id]);
  assert.deepEqual(h.intents.get(old.id), beforePi);
  h.failIntentRead(false);
  h.intents.get(old.id).metadata.shipping_items_sha256 = "invalid";
  const invalid = await post();
  assert.equal(invalid.status, 409);
  assert.equal((await invalid.json()).code, "production_quantity_limit");
  h.env.STORE_INVENTORY = undefined;
  before = h.requests.length;
  assert.equal((await post()).status, 503);
  assert.deepEqual(h.requests.slice(before), ["https://example.test/store-catalog.json"]);
});

test("continuous frame intake fails closed if its trusted production contract is missing", async t => {
  const h = fixture(t);
  delete h.catalog[GROUP].variants[BUILD].productionBatchGroup;
  assert.equal((await h.post({ cart: [frame()] })).status, 400);
  assert.equal(h.intents.size, 0);
});

test("metadata write failure retries original allocation before any receipt, with distinct-event timestamps", async t => {
  const h = fixture(t), intent = await h.create([frame()]), pi = await h.finalize(intent, [frame()]);
  await h.authorize(pi); h.failNextMetadata();
  const at = Math.floor(Date.now() / 1000) - 2;
  const failed = await h.event("payment_intent.succeeded", pi, "evt_write_failed", at);
  assert.equal(failed.status, 503); assert.equal(h.emails.length, 0);
  assert.equal((await readProductionBatch(h.env)).remaining, 14);
  assert.equal(orderView(pi).status, "processing");
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_write_retry", at + 1)).status, 200);
  assert.equal(pi.metadata.production_paid_at, String(at), "metadata retries use the ledger's original success time");
  assert.equal((await readProductionBatch(h.env)).remaining, 14);
  assert.equal(h.emails.length, 1);
});

test("legacy finite payment binding and final stock commit survive introduction of continuous intake", async t => {
  const h = fixture(t), cart = [frame(1, "assembled-batch-2")];
  const old = await h.create(cart), pi = await h.finalize(old, cart);
  const before = await verifyCheckoutBinding(pi.metadata, h.catalog);
  h.catalog[GROUP].retiredBuilds = ["assembled", "assembled-batch-2"];
  assert.deepEqual(await verifyCheckoutBinding(pi.metadata, h.catalog), before);
  await h.publicState();
  await h.authorize(pi);
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_old_paid")).status, 200);
  assert.equal(h.db.sqlite.prepare("SELECT sold_quantity n FROM store_inventory_batches WHERE sku='avian-gen3-batch-02'").get().n, 30);
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  assert.equal(pi.metadata.production_batches, undefined);
  assert.equal(buildOrder(pi, h.catalog).items[0].label, "Assembled (Batch 2)");
});

test("wrong-mode or unapproved signed success cannot allocate production", async t => {
  const h = fixture(t), intent = await h.create([frame()]), pi = await h.finalize(intent, [frame()]);
  pi.status = "succeeded";
  const blocked = await h.event("payment_intent.succeeded", pi, "evt_unapproved");
  assert.equal((await blocked.json()).blocked, "capture_gate_not_approved");
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  await h.authorize(pi); pi.livemode = true;
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_wrong_mode")).status, 503);
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  assert.equal(h.emails.length, 0);
});

test("unavailable production ledger prevents capture and its recovery resumes the accepted authorization", async t => {
  const h = fixture(t), intent = await h.create([frame()]), pi = await h.finalize(intent, [frame()]);
  pi.status = "requires_capture"; pi.amount_capturable = pi.amount;
  h.env.STORE_INVENTORY = undefined;
  const blocked = await h.event("payment_intent.amount_capturable_updated", pi, "evt_ledger_unavailable");
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).blocked, "production_allocation_unavailable");
  assert.equal(pi.status, "requires_capture");
  assert.ok(!h.requests.some((url) => url.endsWith("/capture")));
  h.env.STORE_INVENTORY = h.db;
  await h.authorize(pi, "evt_ledger_recovered");
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
});

test("signed success waits for authoritative captured charge evidence before allocating or sending a receipt", async t => {
  const h = fixture(t), intent = await h.create([frame()]), pi = await h.finalize(intent, [frame()]);
  await h.authorize(pi);
  pi.latest_charge.created -= 2 * 86400;
  const snapshot = structuredClone(pi), paidAt = Math.floor(Date.now() / 1000) - 1;
  pi.latest_charge.captured = false;
  assert.equal((await h.event("payment_intent.succeeded", snapshot, "evt_charge_unavailable")).status, 503);
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  assert.equal(h.emails.length, 0);
  pi.latest_charge.captured = true;
  assert.equal((await h.event("payment_intent.succeeded", snapshot, "evt_charge_recovered", paidAt)).status, 200);
  const paid = h.db.sqlite.prepare("SELECT paid_at FROM production_paid_orders WHERE order_id=?").get(pi.id);
  assert.equal(paid.paid_at, paidAt, "manual capture is paid when it succeeds, not when the earlier authorization was created");
  assert.equal((await readProductionBatch(h.env)).remaining, 14);
  assert.equal(h.emails.length, 1);
});

test("legacy finite receipts work without the additive production migration", async t => {
  const h = fixture(t, { productionSchema: false }), cart = [frame(1, "assembled-batch-2")];
  const intent = await h.create(cart), pi = await h.finalize(intent, cart);
  await h.authorize(pi);
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_legacy_no_schema")).status, 200);
  assert.equal(h.emails.length, 1);
  assert.equal(h.db.sqlite.prepare("SELECT sold_quantity n FROM store_inventory_batches WHERE sku='avian-gen3-batch-02'").get().n, 30);
});

test("a partially captured payment cannot allocate full production quantities", async t => {
  const h = fixture(t), intent = await h.create([frame()]), pi = await h.finalize(intent, [frame()]);
  await h.authorize(pi);
  pi.amount_received = pi.amount - 100;
  pi.latest_charge.amount_captured = pi.amount - 100;
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_partial_capture")).status, 503);
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  assert.equal(h.emails.length, 0);
});

test("initialized legacy mirror failure retries before receipt without recommitting finite stock", async t => {
  const h = fixture(t), cart = [frame(1, "assembled-batch-2")];
  await h.publicState();
  const intent = await h.create(cart), pi = await h.finalize(intent, cart);
  await h.authorize(pi);
  const batch = h.db.batch.bind(h.db);
  h.db.batch = async statements => {
    if (statements.some((statement) => /UPDATE production_batches SET/.test(statement.sql))) throw new Error("D1 write unavailable");
    return batch(statements);
  };
  const result = await h.event("payment_intent.succeeded", pi, "evt_legacy_mirror_failed");
  assert.equal(result.status, 503);
  assert.equal((await result.json()).blocked, "production_legacy_mirror_pending");
  assert.equal(h.emails.length, 0);
  assert.equal(h.db.sqlite.prepare("SELECT sold_quantity n FROM store_inventory_batches WHERE sku='avian-gen3-batch-02'").get().n, 30);
  assert.equal(h.db.sqlite.prepare("SELECT committed_quantity n FROM production_batches WHERE ordinal=2").get().n, 29);
  h.db.batch = batch;
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_legacy_mirror_retry")).status, 200);
  assert.equal(h.db.sqlite.prepare("SELECT committed_quantity n FROM production_batches WHERE ordinal=2").get().n, 30);
  assert.equal(h.emails.length, 1);
});

test("order allocation projection refuses malformed, duplicate and quantity-mismatched records", () => {
  for (const allocations of [[], [[3, 2]], [[3, 1], [3, 1]], [["3", 1]], [[3, -1]]]) {
    assert.deepEqual(productionBatchesForItem({ production_batches: JSON.stringify({ v: 1, lines: [[GROUP, BUILD, allocations]] }) }, frame()), []);
  }
});

const quotaState = async (env) => {
  const [row] = await readInventoryAvailability(env, [VOUCHER_QUOTA]);
  return { capacity: row.capacity, reserved: row.reserved, sold: row.sold, available: row.available };
};
const voucherOptions = { voucherCode: VOUCHER_CODE };

test("the existing family campaign discounts continuous frames once before tax without rewriting its terms", async t => {
  const h = fixture(t, { voucher: true });
  h.catalog[GROUP].retiredBuilds = ["assembled", "assembled-batch-2"];
  const campaign = h.db.sqlite.prepare("SELECT * FROM store_vouchers WHERE id=?").get(VOUCHER_CAMPAIGN);
  const cart = [frame(2), mic], draft = await h.create(cart, voucherOptions);
  assert.equal(draft.subtotal, 160800); assert.equal(draft.discount, 10000); assert.equal(draft.total, 150800);
  assert.equal(await readInventoryReservation(h.env, draft.id), null);
  const pi = await h.finalize(draft, cart, voucherOptions), breakdown = orderView(pi).breakdown;
  assert.deepEqual(h.taxLines.at(-1).slice().sort((a,b) => a-b), [21000, 129800]);
  assert.equal(breakdown.discount, 10000);
  assert.equal(pi.amount, breakdown.subtotal - 10000 + breakdown.shipping + breakdown.tax);
  assert.deepEqual(JSON.parse(pi.metadata.inventory_demand).lines, [[VOUCHER_QUOTA, 1]]);
  await h.authorize(pi);
  assert.equal(pi.amount_received, pi.amount);
  assert.equal(pi.latest_charge.amount_captured, pi.amount);
  assert.equal((await quotaState(h.env)).reserved, 1);
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_continuous_voucher_paid")).status, 200);
  assert.equal((await h.event("payment_intent.succeeded", pi, "evt_continuous_voucher_repeat")).status, 200);
  assert.deepEqual(await quotaState(h.env), { capacity: 10, reserved: 0, sold: 1, available: 9 });
  assert.equal((await readProductionBatch(h.env)).remaining, 13);
  assert.deepEqual(h.db.sqlite.prepare("SELECT * FROM store_vouchers WHERE id=?").get(VOUCHER_CAMPAIGN), campaign);
  assert.equal(h.emails.length, 1);
  assert.match(receiptHtml(buildOrder(pi, h.catalog)), /100\.00/);
});

test("legacy accepted orders and continuous frames share the existing ten-redemption quota", async t => {
  const h = fixture(t, { voucher: true }), oldCart = [frame(1, "assembled-batch-2")];
  const oldDraft = await h.create(oldCart, voucherOptions), old = await h.finalize(oldDraft, oldCart, voucherOptions);
  h.catalog[GROUP].retiredBuilds = ["assembled", "assembled-batch-2"];
  await h.authorize(old);
  assert.equal((await h.event("payment_intent.succeeded", old, "evt_old_family_paid")).status, 200);
  assert.deepEqual(await quotaState(h.env), { capacity: 10, reserved: 0, sold: 1, available: 9 });
  const newer = await Promise.all(Array.from({ length: 10 }, async () => {
    const draft = await h.create([frame()], voucherOptions);
    return h.finalize(draft, [frame()], voucherOptions);
  }));
  const outcomes = await Promise.all(newer.map(async (pi, index) => {
    pi.status = "requires_capture"; pi.amount_capturable = pi.amount;
    const result = await h.event("payment_intent.amount_capturable_updated", pi, "evt_family_admit_" + index);
    assert.equal(result.status, 200); return result.json();
  }));
  assert.equal(outcomes.filter(result => result.captured).length, 9);
  assert.equal(outcomes.filter(result => result.blocked === "discount_unavailable" && result.canceled).length, 1);
  assert.deepEqual(await quotaState(h.env), { capacity: 10, reserved: 9, sold: 1, available: 0 });
  for (const pi of newer.filter(pi => pi.status === "succeeded")) {
    assert.equal((await h.event("payment_intent.succeeded", pi, "evt_family_settle_" + pi.id)).status, 200);
    assert.equal((await h.event("payment_intent.succeeded", pi, "evt_family_duplicate_" + pi.id)).status, 200);
  }
  assert.deepEqual(await quotaState(h.env), { capacity: 10, reserved: 0, sold: 10, available: 0 });
  assert.equal((await readProductionBatch(h.env)).remaining, 6);
  assert.equal(h.db.sqlite.prepare("SELECT sold_quantity AS sold FROM store_inventory_batches WHERE sku='avian-gen3-batch-02'").get().sold, 30);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM store_inventory_batches WHERE sku LIKE 'voucher-%'").get().n, 1);
});

test("continuous voucher capture failures keep one hold and signed cancellation releases it once", async t => {
  const h = fixture(t, { voucher: true }), cart = [frame()];
  const draft = await h.create(cart, voucherOptions), pi = await h.finalize(draft, cart, voucherOptions);
  h.failCapture(true); pi.status = "requires_capture"; pi.amount_capturable = pi.amount;
  assert.equal((await h.event("payment_intent.amount_capturable_updated", pi, "evt_family_capture_failed")).status, 503);
  assert.equal((await h.event("payment_intent.amount_capturable_updated", pi, "evt_family_capture_retry")).status, 503);
  assert.deepEqual(await quotaState(h.env), { capacity: 10, reserved: 1, sold: 0, available: 9 });
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  assert.equal((await h.event("payment_intent.payment_failed", pi, "evt_family_payment_failed")).status, 200);
  assert.equal((await quotaState(h.env)).reserved, 1);
  pi.status = "canceled";
  assert.equal((await h.event("payment_intent.canceled", pi, "evt_family_cancel")).status, 200);
  assert.equal((await h.event("payment_intent.canceled", pi, "evt_family_cancel_duplicate")).status, 200);
  assert.deepEqual(await quotaState(h.env), { capacity: 10, reserved: 0, sold: 0, available: 10 });
  assert.equal((await readProductionBatch(h.env)).remaining, 15);
  assert.equal(h.emails.length, 0);
});

test("continuous compatibility does not broaden other campaigns, builds or malformed production contracts", async t => {
  const h = fixture(t, { voucher: true }), manifest = { lines: [[GROUP, BUILD, 1]] };
  const resolve = () => resolveVoucher(h.env, VOUCHER_CODE, manifest, h.catalog);
  const found = await resolve();
  assert.equal(found.build_id, "assembled-batch-2"); assert.equal(found.matched_build_id, BUILD);
  for (const [field, value, original] of [["id", "other-campaign", VOUCHER_CAMPAIGN], ["build_id", "assembled", "assembled-batch-2"], ["amount_off", 5000, 10000]]) {
    h.db.sqlite.prepare("UPDATE store_vouchers SET " + field + "=?").run(value);
    await assert.rejects(resolve, /not available/);
    h.db.sqlite.prepare("UPDATE store_vouchers SET " + field + "=?").run(original);
  }
  const original = structuredClone(h.catalog[GROUP].variants[BUILD]);
  for (const changed of [{ productionBatchGroup: "other" }, { productionBatchGroup: undefined }, { inventorySku: "avian-gen3-batch-02" },
    { shippingProfile: "other" }, { launchAt: "2099-01-01T00:00:00Z" }]) {
    h.catalog[GROUP].variants[BUILD] = { ...original, ...changed };
    await assert.rejects(resolve, /not available/);
  }
  h.catalog[GROUP].variants[BUILD] = original;
  h.catalog[GROUP].retiredBuilds = [BUILD]; await assert.rejects(resolve, /not available/);
  h.catalog[GROUP].retiredBuilds = ["assembled-batch-2"];
  for (const cart of [{ lines: [[GROUP, "assembled", 1]] }, { lines: [["avian-mic", "printed", 1]] }])
    await assert.rejects(() => resolveVoucher(h.env, VOUCHER_CODE, cart, h.catalog), /not available/);
  h.db.sqlite.exec("UPDATE store_vouchers SET expires_at=1,active=0");
  await assert.rejects(resolve, /not available/);
  const historical = await voucherFromMetadata(h.env, { voucher_campaign: VOUCHER_CAMPAIGN, voucher_discount: "10000" }, manifest, h.catalog);
  assert.equal(historical.matched_build_id, BUILD, "accepted immutable callbacks remain resolvable after expiration");
});

test("continuous vouchers keep the same expiry boundary while previously admitted holds can settle", async t => {
  const h = fixture(t, { voucher: true }), cart = [frame()];
  const expiresAt = h.db.sqlite.prepare("SELECT expires_at FROM store_vouchers WHERE id=?").get(VOUCHER_CAMPAIGN).expires_at;
  const firstDraft = await h.create(cart, voucherOptions), first = await h.finalize(firstDraft, cart, voucherOptions);
  h.db.sqlite.exec("UPDATE store_vouchers SET expires_at=1");
  first.status = "requires_capture"; first.amount_capturable = first.amount;
  const blocked = await h.event("payment_intent.amount_capturable_updated", first, "evt_family_expired_new");
  assert.equal((await blocked.json()).blocked, "discount_unavailable");
  assert.equal(first.status, "canceled"); assert.equal(first.amount_received, undefined);
  assert.deepEqual(await quotaState(h.env), { capacity: 10, reserved: 0, sold: 0, available: 10 });
  h.db.sqlite.prepare("UPDATE store_vouchers SET expires_at=?").run(expiresAt);
  const heldDraft = await h.create(cart, voucherOptions), held = await h.finalize(heldDraft, cart, voucherOptions);
  h.failCapture(true); held.status = "requires_capture"; held.amount_capturable = held.amount;
  assert.equal((await h.event("payment_intent.amount_capturable_updated", held, "evt_family_hold_before_expiry")).status, 503);
  assert.equal((await quotaState(h.env)).reserved, 1);
  h.db.sqlite.exec("UPDATE store_vouchers SET expires_at=1,active=0");
  h.failCapture(false); await h.authorize(held, "evt_family_retry_after_expiry");
  assert.equal((await h.event("payment_intent.succeeded", held, "evt_family_paid_after_expiry")).status, 200);
  assert.deepEqual(await quotaState(h.env), { capacity: 10, reserved: 0, sold: 1, available: 9 });
  assert.equal((await readProductionBatch(h.env)).remaining, 14);
  assert.equal(held.metadata.voucher_discount, "10000");
});
