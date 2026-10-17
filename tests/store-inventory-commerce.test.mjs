import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequestGet as inventoryAvailability } from "../functions/api/inventory-availability.js";
import { onRequestPost as paymentIntent } from "../functions/api/payment-intent.js";
import { onRequestPost as stripeWebhook } from "../functions/api/stripe-webhook.js";
import { createCheckoutBinding, taxAddressBinding } from "../lib/shipping-binding.js";
import { canonicalShippingJson, sha256Hex } from "../lib/shipping-profile.js";
import {
  applyBoundInventoryMetadata,
  createInventoryCommerceBinding,
  inventoryDemandFromManifest,
  parseInventoryDemandJson,
  verifyBoundInventoryMetadata,
} from "../lib/store-inventory-commerce.js";
import { sweepExpiredInventory } from "../lib/store-inventory-expiry.js";
import {
  InventoryStateError,
  assertInventoryReservation,
  readInventoryAvailability,
  readInventoryReservation,
  refreshInventoryReservation,
  reserveInventory,
} from "../lib/store-inventory.js";

class SQLiteStatement {
  constructor(owner, sql, bindings = []) { this.owner = owner; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new SQLiteStatement(this.owner, this.sql, bindings); }
  run() { return this.owner.run(this); }
  all() { return this.owner.all(this); }
}

class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(readFileSync(new URL("../migrations/0001_store_inventory.sql", import.meta.url), "utf8"));
  }
  prepare(sql) { return new SQLiteStatement(this, sql); }
  withSession(constraint) { assert.equal(constraint, "first-primary"); return this; }
  run(statement) {
    const result = this.sqlite.prepare(statement.sql).run(...statement.bindings);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  all(statement) {
    return { success: true, results: this.sqlite.prepare(statement.sql).all(...statement.bindings), meta: { changes: 0 } };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.run(statement));
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

const SKU = "avian-gen3-batch-01";
const WEBHOOK_SECRET = "whsec_inventory_commerce_test";
const FINITE_CATALOG = {
  "avian-visitors": {
    title: "Avian Visitors",
    variants: {
      assembled: {
        price: "price_avian_assembled",
        weightLb: 4,
        maxQty: 1,
        label: "Assembled",
        priceUsd: 699,
        shippingProfile: "contiguous-us-ground",
        inventorySku: SKU,
      },
    },
  },
};
const ORDINARY_CATALOG = {
  cable: { title: "Cable", variants: { standard: {
    price: "price_cable", weightLb: 0.2, maxQty: 5, label: "Standard", priceUsd: 12,
  } } },
};
const SHIPPING = {
  name: "Test Buyer",
  address: {
    line1: "1 Test St", line2: "", city: "San Francisco", state: "CA",
    postal_code: "94107", country: "US",
  },
};
const finiteLine = (qty = 1) => ({ id: "avian-visitors", build: "assembled", qty });

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function request(body) {
  return new Request("https://example.test/api/payment-intent", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function metadataFromForm(form, prior = {}) {
  const metadata = { ...prior };
  for (const [key, value] of form.entries()) {
    const match = /^metadata\[([^\]]+)\]$/.exec(key);
    if (match) {
      if (value === "") delete metadata[match[1]];
      else metadata[match[1]] = value;
    }
  }
  return metadata;
}

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = original; }
}

async function signedWebhook(event, env, fetchMock = null) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(timestamp + "." + body).digest("hex");
  const webhookRequest = new Request("https://example.test/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body,
  });
  const run = () => stripeWebhook({ request: webhookRequest, env: {
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: "sk_test_inventory_commerce",
    ...env,
  } });
  return fetchMock ? withFetch(fetchMock, run) : run();
}

async function boundFixture(db, {
  paymentIntentId = "pi_inventory_bound", quantity = 1, now, holdSeconds, reserve = true,
} = {}) {
  const at = now ?? Math.floor(Date.now() / 1000);
  const checkout = await createCheckoutBinding([finiteLine(quantity)], FINITE_CATALOG);
  const binding = await createInventoryCommerceBinding({
    paymentIntentId,
    amount: 70000,
    currency: "usd",
    manifestSha256: checkout.manifestSha256,
    catalogSha256: checkout.catalogSha256,
    demand: [{ sku: SKU, quantity }],
  });
  if (reserve) {
    await reserveInventory({ STORE_INVENTORY: db }, paymentIntentId, binding.demand, {
      now: at, binding, ...(holdSeconds === undefined ? {} : { holdSeconds }),
    });
  }
  const form = new URLSearchParams();
  applyBoundInventoryMetadata(form, binding);
  const metadata = metadataFromForm(form, {
    items: checkout.legacyItems,
    shipping_profile: checkout.metadataProfile,
    shipping_items: checkout.manifestJson,
    shipping_items_sha256: checkout.manifestSha256,
    shipping_catalog_sha256: checkout.catalogSha256,
  });
  return { at, checkout, binding, metadata };
}

async function capturablePi(fixture, paymentIntentId, taxCalculation) {
  const addressSha256 = await sha256Hex(canonicalShippingJson(SHIPPING));
  return {
    id: paymentIntentId,
    object: "payment_intent",
    capture_method: "manual",
    status: "requires_capture",
    amount: fixture.binding.amount,
    amount_capturable: fixture.binding.amount,
    currency: fixture.binding.currency,
    shipping: SHIPPING,
    metadata: {
      ...fixture.metadata,
      checkout_ready: "1",
      tax_calculation: taxCalculation,
      shipping_address_sha256: addressSha256,
      shipping_tax_binding: await taxAddressBinding({
        taxCalculation,
        addressSha256,
        manifestSha256: fixture.checkout.manifestSha256,
        catalogSha256: fixture.checkout.catalogSha256,
        profile: fixture.checkout.profile,
        amount: fixture.binding.amount,
        currency: fixture.binding.currency,
      }),
      capture_gate: "pending",
    },
  };
}

test("trusted catalog inventory demand and PaymentIntent metadata have one canonical binding", async () => {
  const checkout = await createCheckoutBinding([finiteLine()], FINITE_CATALOG);
  const demand = inventoryDemandFromManifest(checkout.manifest, FINITE_CATALOG);
  assert.deepEqual(demand, [{ sku: SKU, quantity: 1 }]);

  const binding = await createInventoryCommerceBinding({
    paymentIntentId: "pi_canonical_binding", amount: 70000, currency: "usd",
    manifestSha256: checkout.manifestSha256, catalogSha256: checkout.catalogSha256, demand,
  });
  assert.deepEqual(parseInventoryDemandJson(binding.demandJson), demand);
  const form = new URLSearchParams();
  applyBoundInventoryMetadata(form, binding);
  const verified = await verifyBoundInventoryMetadata({
    id: binding.paymentIntentId, amount: binding.amount, currency: binding.currency,
    metadata: metadataFromForm(form, {
      shipping_items_sha256: binding.manifestSha256,
      shipping_catalog_sha256: binding.catalogSha256,
    }),
  });
  assert.equal(verified.bindingSha256, binding.bindingSha256);
  assert.deepEqual(inventoryDemandFromManifest(
    (await createCheckoutBinding([{ id: "cable", build: "standard", qty: 2 }], ORDINARY_CATALOG)).manifest,
    ORDINARY_CATALOG,
  ), []);
});

test("a commerce-bound reservation refreshes only the exact immutable stock demand", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const fixture = await boundFixture(db, { paymentIntentId: "pi_refresh_bound", now: 1000 });
  const nextBinding = await createInventoryCommerceBinding({
    paymentIntentId: "pi_refresh_bound", amount: 71000, currency: "usd",
    manifestSha256: fixture.checkout.manifestSha256,
    catalogSha256: fixture.checkout.catalogSha256,
    demand: fixture.binding.demand,
  });
  const refreshed = await refreshInventoryReservation(
    { STORE_INVENTORY: db }, "pi_refresh_bound", fixture.binding.demand,
    { now: 1010, binding: nextBinding },
  );
  assert.equal(refreshed.commerceBinding.amount, 71000);
  assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].reserved, 1);
  await assertInventoryReservation(
    { STORE_INVENTORY: db }, "pi_refresh_bound", fixture.binding.demand,
    { now: 1011, binding: nextBinding },
  );
  await assert.rejects(
    () => assertInventoryReservation(
      { STORE_INVENTORY: db }, "pi_refresh_bound", fixture.binding.demand,
      { now: 1011, binding: fixture.binding },
    ),
    InventoryStateError,
  );
  await assert.rejects(
    () => refreshInventoryReservation(
      { STORE_INVENTORY: db }, "pi_refresh_bound", [{ sku: SKU, quantity: 2 }],
      { now: 1011, binding: nextBinding },
    ),
    InventoryStateError,
  );
});

test("finite checkout binds Stripe before exposing the secret without holding stock", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = {
    STRIPE_SECRET_KEY: "sk_test_checkout",
    STRIPE_PUBLISHABLE_KEY: "pk_test_checkout",
    STORE_INVENTORY: db,
  };
  let stripePi = null;
  let createForm = null;
  let bindForm = null;
  const result = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/store-catalog.json")) return response(FINITE_CATALOG);
    if (target.endsWith("/v1/prices/price_avian_assembled")) {
      return response({ active: true, unit_amount: 69900, currency: "usd" });
    }
    if (target.endsWith("/v1/payment_intents")) {
      createForm = options.body;
      stripePi = {
        id: "pi_finite_checkout", object: "payment_intent",
        client_secret: "pi_finite_checkout_secret_test",
        amount: Number(createForm.get("amount")), currency: createForm.get("currency"),
        metadata: metadataFromForm(createForm),
      };
      return response(stripePi);
    }
    if (target.endsWith("/v1/payment_intents/pi_finite_checkout")) {
      bindForm = options.body;
      stripePi.metadata = metadataFromForm(bindForm, stripePi.metadata);
      return response(stripePi);
    }
    throw new Error("unexpected fetch " + target);
  }, () => paymentIntent({ request: request({ cart: [finiteLine()] }), env }));

  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.clientSecret, "pi_finite_checkout_secret_test");
  assert.match(body.updateToken, /^[0-9a-f]{64}$/);
  assert.equal(createForm.get("capture_method"), "manual");
  assert.equal(createForm.get("metadata[inventory_state]"), "pending");
  assert.equal(bindForm.get("metadata[inventory_state]"), "bound");
  assert.match(bindForm.get("metadata[inventory_binding_sha256]"), /^[0-9a-f]{64}$/);
  const stored = await readInventoryReservation(env, "pi_finite_checkout");
  assert.equal(stored, null);
  assert.equal((await readInventoryAvailability(env))[0].available, 20);

  let updateForm = null;
  const updated = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/store-catalog.json")) return response(FINITE_CATALOG);
    if (target.endsWith("/v1/prices/price_avian_assembled")) {
      return response({ active: true, unit_amount: 69900, currency: "usd" });
    }
    if (target.endsWith("/v1/tax/calculations")) {
      return response({
        id: "taxcalc_finite_update", currency: "usd",
        tax_amount_exclusive: 6031, amount_total: 76831,
      });
    }
    if (target.endsWith("/v1/payment_intents/pi_finite_checkout") && options.method === "POST") {
      updateForm = options.body;
      stripePi.amount = Number(updateForm.get("amount"));
      stripePi.currency = "usd";
      stripePi.metadata = metadataFromForm(updateForm, stripePi.metadata);
      return response(stripePi);
    }
    throw new Error("unexpected fetch " + target);
  }, () => paymentIntent({ request: request({
    cart: [finiteLine()], shipping: SHIPPING,
    paymentIntentId: "pi_finite_checkout", updateToken: body.updateToken,
  }), env }));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).updated, true);
  assert.equal(updateForm.get("metadata[inventory_state]"), "bound");
  const refreshed = await readInventoryReservation(env, "pi_finite_checkout");
  assert.equal(refreshed, null);
  assert.match(updateForm.get("metadata[inventory_binding_sha256]"), /^[0-9a-f]{64}$/);
  assert.equal((await readInventoryAvailability(env))[0].available, 20);
});

test("ordinary checkout preserves the historical PaymentIntent-only update token", async () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_ordinary_token",
    STRIPE_PUBLISHABLE_KEY: "pk_test_ordinary_token",
  };
  const created = await withFetch(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/store-catalog.json")) return response(ORDINARY_CATALOG);
    if (target.endsWith("/v1/prices/price_cable")) {
      return response({ active: true, unit_amount: 1200, currency: "usd" });
    }
    if (target.endsWith("/v1/payment_intents")) {
      return response({
        id: "pi_ordinary_legacy_token", object: "payment_intent",
        client_secret: "pi_ordinary_legacy_token_secret_test",
        amount: Number(options.body.get("amount")), currency: options.body.get("currency"),
        metadata: metadataFromForm(options.body),
      });
    }
    throw new Error("unexpected fetch " + target);
  }, () => paymentIntent({
    request: request({ cart: [{ id: "cable", build: "standard", qty: 1 }] }), env,
  }));
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.updateToken, createHmac("sha256", env.STRIPE_SECRET_KEY)
    .update("pi_ordinary_legacy_token").digest("hex"));
});

test("twenty abandoned public finite drafts consume no Batch 01 stock", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = {
    STRIPE_SECRET_KEY: "sk_test_abandoned_drafts",
    STRIPE_PUBLISHABLE_KEY: "pk_test_abandoned_drafts",
    STORE_INVENTORY: db,
  };
  for (let index = 0; index < 20; index += 1) {
    const piId = "pi_abandoned_draft_" + index;
    let stripePi = null;
    const result = await withFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/store-catalog.json")) return response(FINITE_CATALOG);
      if (target.endsWith("/v1/prices/price_avian_assembled")) {
        return response({ active: true, unit_amount: 69900, currency: "usd" });
      }
      if (target.endsWith("/v1/payment_intents")) {
        stripePi = {
          id: piId, object: "payment_intent", client_secret: piId + "_secret_test",
          amount: Number(options.body.get("amount")), currency: options.body.get("currency"),
          metadata: metadataFromForm(options.body),
        };
        return response(stripePi);
      }
      if (target.endsWith("/v1/payment_intents/" + piId)) {
        stripePi.metadata = metadataFromForm(options.body, stripePi.metadata);
        return response(stripePi);
      }
      throw new Error("unexpected fetch " + target);
    }, () => paymentIntent({ request: request({ cart: [finiteLine()] }), env }));
    assert.equal(result.status, 200);
    assert.equal(await readInventoryReservation(env, piId), null);
  }
  assert.deepEqual((await readInventoryAvailability(env))[0], {
    sku: SKU, label: "Avian Visitors Gen 3 Batch 01", capacity: 20,
    reserved: 0, sold: 0, available: 20, soldOut: false,
  });
});

test("finite checkout fails closed without D1 before creating a PaymentIntent", async () => {
  const calls = [];
  const result = await withFetch(async (url) => {
    calls.push(String(url));
    return response(FINITE_CATALOG);
  }, () => paymentIntent({
    request: request({ cart: [finiteLine()] }),
    env: { STRIPE_SECRET_KEY: "sk_test_checkout", STRIPE_PUBLISHABLE_KEY: "pk_test_checkout" },
  }));
  assert.equal(result.status, 503);
  assert.deepEqual(calls, ["https://example.test/store-catalog.json"]);
  assert.equal("clientSecret" in await result.json(), false);
});

test("manual capture requires the exact live D1 reservation before Stripe capture", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const now = Math.floor(Date.now() / 1000);
  const fixture = await boundFixture(db, { paymentIntentId: "pi_inventory_capture", now, reserve: false });
  const addressSha256 = await sha256Hex(canonicalShippingJson(SHIPPING));
  const shippingTaxBinding = await taxAddressBinding({
    taxCalculation: "taxcalc_inventory_capture",
    addressSha256,
    manifestSha256: fixture.checkout.manifestSha256,
    catalogSha256: fixture.checkout.catalogSha256,
    profile: fixture.checkout.profile,
    amount: 70000,
    currency: "usd",
  });
  const pi = {
    id: "pi_inventory_capture", object: "payment_intent", capture_method: "manual",
    status: "requires_capture", amount: 70000, amount_capturable: 70000, currency: "usd",
    shipping: SHIPPING,
    metadata: {
      ...fixture.metadata,
      checkout_ready: "1",
      tax_calculation: "taxcalc_inventory_capture",
      shipping_address_sha256: addressSha256,
      shipping_tax_binding: shippingTaxBinding,
      capture_gate: "pending",
    },
  };
  let captureCalls = 0;
  const result = await signedWebhook({
    id: "evt_inventory_capture", type: "payment_intent.amount_capturable_updated",
    created: now, livemode: false, data: { object: { id: pi.id } },
  }, { STORE_INVENTORY: db }, async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v1/payment_intents/pi_inventory_capture") && !options.method) return response(pi);
    if (target.endsWith("/store-catalog.json")) return response(FINITE_CATALOG);
    if (target.endsWith("/capture")) {
      captureCalls += 1;
      return response({
        id: pi.id,
        status: "succeeded",
        metadata: {
          capture_gate: "approved",
          capture_gate_event: "evt_inventory_capture",
          capture_address_sha256: addressSha256,
        },
      });
    }
    throw new Error("unexpected fetch " + target);
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { received: true, captured: true });
  assert.equal(captureCalls, 1);
  const reservation = await readInventoryReservation({ STORE_INVENTORY: db }, pi.id);
  assert.equal(reservation.status, "active");
  assert.equal(reservation.commerceBinding.bindingSha256, fixture.binding.bindingSha256);
  assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].available, 19);
});

test("missing inventory authority cancels a finite authorization and never captures", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const now = Math.floor(Date.now() / 1000);
  const fixture = await boundFixture(db, { paymentIntentId: "pi_inventory_capture_blocked", now, reserve: false });
  const addressSha256 = await sha256Hex(canonicalShippingJson(SHIPPING));
  const pi = {
    id: "pi_inventory_capture_blocked", object: "payment_intent", capture_method: "manual",
    status: "requires_capture", amount: 70000, amount_capturable: 70000, currency: "usd",
    shipping: SHIPPING,
    metadata: {
      ...fixture.metadata,
      checkout_ready: "1",
      tax_calculation: "taxcalc_inventory_blocked",
      shipping_address_sha256: addressSha256,
      shipping_tax_binding: await taxAddressBinding({
        taxCalculation: "taxcalc_inventory_blocked", addressSha256,
        manifestSha256: fixture.checkout.manifestSha256,
        catalogSha256: fixture.checkout.catalogSha256,
        profile: fixture.checkout.profile, amount: 70000, currency: "usd",
      }),
      capture_gate: "pending",
    },
  };
  let captureCalls = 0;
  let cancelCalls = 0;
  let blockedReason = "";
  const result = await signedWebhook({
    id: "evt_inventory_capture_blocked", type: "payment_intent.amount_capturable_updated",
    created: now, livemode: false, data: { object: { id: pi.id } },
  }, {}, async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v1/payment_intents/pi_inventory_capture_blocked") && !options.method) return response(pi);
    if (target.endsWith("/store-catalog.json")) return response(FINITE_CATALOG);
    if (target.endsWith("/capture")) { captureCalls += 1; return response({}); }
    if (target.endsWith("/cancel")) {
      cancelCalls += 1;
      assert.equal(options.headers["idempotency-key"], "inventory-capture-cancel-evt_inventory_capture_blocked");
      return response({ id: pi.id, object: "payment_intent", status: "canceled" });
    }
    if (target.endsWith("/v1/payment_intents/pi_inventory_capture_blocked") && options.method === "POST") {
      blockedReason = options.body.get("metadata[capture_block_reason]");
      return response({ id: pi.id });
    }
    throw new Error("unexpected fetch " + target);
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    received: true, captured: false, canceled: true,
    blocked: "inventory_reservation_unavailable",
  });
  assert.equal(blockedReason, "inventory_reservation_unavailable");
  assert.equal(captureCalls, 0);
  assert.equal(cancelCalls, 1);
});

test("competing last-unit authorizations capture one winner and cancel the loser", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const now = Math.floor(Date.now() / 1000);
  await reserveInventory({ STORE_INVENTORY: db }, "pi_existing_nineteen", [{ sku: SKU, quantity: 19 }], { now });
  const winnerFixture = await boundFixture(db, {
    paymentIntentId: "pi_last_unit_winner", now, reserve: false,
  });
  const loserFixture = await boundFixture(db, {
    paymentIntentId: "pi_last_unit_loser", now, reserve: false,
  });
  const winner = await capturablePi(winnerFixture, "pi_last_unit_winner", "taxcalc_last_unit_winner");
  const loser = await capturablePi(loserFixture, "pi_last_unit_loser", "taxcalc_last_unit_loser");
  const piById = new Map([[winner.id, winner], [loser.id, loser]]);
  const captures = [];
  const cancellations = [];
  const fetchMock = async (url, options = {}) => {
    const target = String(url);
    const match = /\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)$/.exec(target);
    if (match && !options.method) return response(piById.get(match[1]));
    if (target.endsWith("/store-catalog.json")) return response(FINITE_CATALOG);
    if (target.endsWith("/capture")) {
      const piId = target.split("/").at(-2);
      captures.push(piId);
      return response({
        id: piId, object: "payment_intent", status: "succeeded",
        metadata: {
          capture_gate: "approved",
          capture_gate_event: piId === winner.id ? "evt_last_unit_winner" : "evt_last_unit_loser",
          capture_address_sha256: piById.get(piId).metadata.shipping_address_sha256,
        },
      });
    }
    if (target.endsWith("/cancel")) {
      const piId = target.split("/").at(-2);
      cancellations.push(piId);
      return response({ id: piId, object: "payment_intent", status: "canceled" });
    }
    if (match && options.method === "POST") return response({ id: match[1], object: "payment_intent" });
    throw new Error("unexpected fetch " + target);
  };

  const won = await signedWebhook({
    id: "evt_last_unit_winner", type: "payment_intent.amount_capturable_updated",
    created: now, livemode: false, data: { object: { id: winner.id } },
  }, { STORE_INVENTORY: db }, fetchMock);
  assert.deepEqual(await won.json(), { received: true, captured: true });

  const lost = await signedWebhook({
    id: "evt_last_unit_loser", type: "payment_intent.amount_capturable_updated",
    created: now, livemode: false, data: { object: { id: loser.id } },
  }, { STORE_INVENTORY: db }, fetchMock);
  assert.deepEqual(await lost.json(), {
    received: true, captured: false, canceled: true, blocked: "inventory_sold_out",
  });
  assert.deepEqual(captures, [winner.id]);
  assert.deepEqual(cancellations, [loser.id]);
  assert.equal((await readInventoryReservation({ STORE_INVENTORY: db }, winner.id)).status, "active");
  assert.equal(await readInventoryReservation({ STORE_INVENTORY: db }, loser.id), null);
  assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].available, 0);

  const canceled = await signedWebhook({
    id: "evt_last_unit_loser_canceled", type: "payment_intent.canceled",
    created: now, livemode: false,
    data: { object: {
      id: loser.id, object: "payment_intent", amount: loser.amount, currency: loser.currency,
      metadata: loser.metadata,
    } },
  }, { STORE_INVENTORY: db });
  assert.deepEqual(await canceled.json(), { received: true, inventory: "not_reserved" });
  assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].available, 0);
});

test("capture failure after reservation retains the exact hold for a safe retry", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const now = Math.floor(Date.now() / 1000);
  const fixture = await boundFixture(db, {
    paymentIntentId: "pi_capture_failure_holds", now, reserve: false,
  });
  const pi = await capturablePi(fixture, "pi_capture_failure_holds", "taxcalc_capture_failure_holds");
  let cancelCalls = 0;
  const result = await signedWebhook({
    id: "evt_capture_failure_holds", type: "payment_intent.amount_capturable_updated",
    created: now, livemode: false, data: { object: { id: pi.id } },
  }, { STORE_INVENTORY: db }, async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v1/payment_intents/" + pi.id) && !options.method) return response(pi);
    if (target.endsWith("/store-catalog.json")) return response(FINITE_CATALOG);
    if (target.endsWith("/capture")) return response({ error: "ambiguous capture" }, 500);
    if (target.endsWith("/cancel")) { cancelCalls += 1; return response({}); }
    throw new Error("unexpected fetch " + target);
  });
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { received: false, pending: true });
  assert.equal(cancelCalls, 0);
  const reservation = await readInventoryReservation({ STORE_INVENTORY: db }, pi.id);
  assert.equal(reservation.status, "active");
  assert.equal(reservation.commerceBinding.bindingSha256, fixture.binding.bindingSha256);
  assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].available, 19);
});

test("duplicate capturable delivery reuses one D1 hold and one Stripe idempotency key", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const now = Math.floor(Date.now() / 1000);
  const fixture = await boundFixture(db, {
    paymentIntentId: "pi_duplicate_capturable", now, reserve: false,
  });
  const pi = await capturablePi(fixture, "pi_duplicate_capturable", "taxcalc_duplicate_capturable");
  const event = {
    id: "evt_duplicate_capturable", type: "payment_intent.amount_capturable_updated",
    created: now, livemode: false, data: { object: { id: pi.id } },
  };
  const captureKeys = [];
  const fetchMock = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v1/payment_intents/" + pi.id) && !options.method) return response(pi);
    if (target.endsWith("/store-catalog.json")) return response(FINITE_CATALOG);
    if (target.endsWith("/capture")) {
      captureKeys.push(options.headers["idempotency-key"]);
      return response({
        id: pi.id, object: "payment_intent", status: "succeeded",
        metadata: {
          capture_gate: "approved", capture_gate_event: event.id,
          capture_address_sha256: pi.metadata.shipping_address_sha256,
        },
      });
    }
    throw new Error("unexpected fetch " + target);
  };
  const first = await signedWebhook(event, { STORE_INVENTORY: db }, fetchMock);
  const second = await signedWebhook(event, { STORE_INVENTORY: db }, fetchMock);
  assert.deepEqual(await first.json(), { received: true, captured: true });
  assert.deepEqual(await second.json(), { received: true, captured: true });
  assert.deepEqual(captureKeys, ["shipping-capture-" + event.id, "shipping-capture-" + event.id]);
  assert.equal((await readInventoryReservation({ STORE_INVENTORY: db }, pi.id)).status, "active");
  assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].reserved, 1);
});

test("retryable payment failure retains all 20 units and later signed success commits once", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const now = Math.floor(Date.now() / 1000);
  const fixtures = [];
  for (let index = 0; index < 20; index += 1) {
    fixtures.push(await boundFixture(db, {
      paymentIntentId: index === 0 ? "pi_failure_then_success" : "pi_held_" + index,
      now,
    }));
  }
  const fixture = fixtures[0];
  const pi = {
    id: "pi_failure_then_success", object: "payment_intent", amount: 70000, currency: "usd",
    metadata: { ...fixture.metadata, checkout_ready: "0" },
  };
  const failed = await signedWebhook({
    id: "evt_retryable_failure", type: "payment_intent.payment_failed", created: now,
    livemode: false, data: { object: pi },
  }, { STORE_INVENTORY: db });
  assert.deepEqual(await failed.json(), { received: true, inventory: "retained" });
  assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].available, 0);
  await assert.rejects(
    () => reserveInventory({ STORE_INVENTORY: db }, "pi_second_buyer", [{ sku: SKU, quantity: 1 }], { now: now + 1 }),
  );

  const succeededEvent = {
    id: "evt_later_success", type: "payment_intent.succeeded", created: now,
    livemode: false, data: { object: pi },
  };
  const succeeded = await signedWebhook(succeededEvent, { STORE_INVENTORY: db });
  assert.equal(succeeded.status, 200);
  assert.equal((await succeeded.json()).blocked, "tax_not_finalized");
  const duplicate = await signedWebhook(succeededEvent, { STORE_INVENTORY: db });
  assert.equal(duplicate.status, 200);
  assert.deepEqual((await readInventoryAvailability({ STORE_INVENTORY: db }))[0], {
    sku: SKU, label: "Avian Visitors Gen 3 Batch 01", capacity: 20,
    reserved: 19, sold: 1, available: 0, soldOut: true,
  });
});

test("only signed cancellation releases a bound active reservation and retries are idempotent", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const now = Math.floor(Date.now() / 1000);
  const fixture = await boundFixture(db, { paymentIntentId: "pi_signed_cancel", now });
  const event = {
    id: "evt_inventory_canceled", type: "payment_intent.canceled", created: now,
    livemode: false,
    data: { object: {
      id: "pi_signed_cancel", object: "payment_intent", amount: 70000, currency: "usd",
      metadata: fixture.metadata,
    } },
  };
  const first = await signedWebhook(event, { STORE_INVENTORY: db });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { received: true, inventory: "released", duplicate: false });
  const second = await signedWebhook(event, { STORE_INVENTORY: db });
  assert.deepEqual(await second.json(), { received: true, inventory: "released", duplicate: true });
  assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].available, 20);
});

test("availability endpoint reads primary state and fails closed when its D1 authority is absent", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  await reserveInventory({ STORE_INVENTORY: db }, "pi_public_availability", [{ sku: SKU, quantity: 2 }]);
  const result = await inventoryAvailability({
    request: new Request("https://example.test/api/inventory-availability?sku=" + SKU),
    env: { STORE_INVENTORY: db },
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await result.json(), { inventory: [{ sku: SKU, available: 18, soldOut: false }] });

  const missing = await inventoryAvailability({
    request: new Request("https://example.test/api/inventory-availability?sku=" + SKU), env: {},
  });
  assert.equal(missing.status, 503);
});

test("restricted Stripe keys map webhook evidence to test and live mode", async () => {
  for (const mode of [
    { key: "rk_test_inventory_commerce", livemode: false, suffix: "test" },
    { key: "rk_live_inventory_commerce", livemode: true, suffix: "live" },
  ]) {
    const db = new SQLiteD1();
    try {
      const now = Math.floor(Date.now() / 1000);
      const paymentIntentId = "pi_restricted_webhook_" + mode.suffix;
      const fixture = await boundFixture(db, { paymentIntentId, now });
      const result = await signedWebhook({
        id: "evt_restricted_webhook_" + mode.suffix,
        type: "payment_intent.canceled",
        created: now,
        livemode: mode.livemode,
        data: { object: {
          id: paymentIntentId,
          object: "payment_intent",
          amount: 70000,
          currency: "usd",
          metadata: fixture.metadata,
        } },
      }, { STORE_INVENTORY: db, STRIPE_SECRET_KEY: mode.key });

      assert.equal(result.status, 200, mode.suffix);
      assert.deepEqual(await result.json(), {
        received: true, inventory: "released", duplicate: false,
      }, mode.suffix);
      assert.equal((await readInventoryAvailability({ STORE_INVENTORY: db }))[0].available, 20, mode.suffix);
    } finally {
      db.close();
    }
  }
});

test("restricted Stripe keys are accepted by the inventory expiry worker", async () => {
  for (const mode of [
    { key: "rk_test_expiry", suffix: "test" },
    { key: "rk_live_expiry", suffix: "live" },
  ]) {
    const db = new SQLiteD1();
    try {
      const paymentIntentId = "pi_restricted_expiry_" + mode.suffix;
      await boundFixture(db, { paymentIntentId, now: 1000, holdSeconds: 300 });
      const calls = [];
      const summary = await sweepExpiredInventory({
        STORE_INVENTORY: db,
        STRIPE_SECRET_KEY: mode.key,
      }, {
        now: 1300,
        fetchImpl: async (url, options) => {
          calls.push({ url: String(url), options });
          return response({ id: paymentIntentId, object: "payment_intent", status: "canceled" });
        },
      });

      assert.equal(summary.checked, 1, mode.suffix);
      assert.deepEqual(summary.results, [{
        paymentIntentId,
        cancelRequested: true,
        awaitingWebhook: true,
      }], mode.suffix);
      assert.equal(calls.length, 1, mode.suffix);
      assert.equal(calls[0].options.headers.authorization, "Bearer " + mode.key, mode.suffix);
      assert.equal((await readInventoryReservation({ STORE_INVENTORY: db }, paymentIntentId)).status, "expiring", mode.suffix);
    } finally {
      db.close();
    }
  }
});

test("expiry sweep marks then asks Stripe to cancel but never releases on an unsigned API response", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db, STRIPE_SECRET_KEY: "sk_test_expiry" };
  const fixture = await boundFixture(db, {
    paymentIntentId: "pi_expiry_adapter", now: 1000, holdSeconds: 300,
  });
  const calls = [];
  const summary = await sweepExpiredInventory(env, {
    now: 1300,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ id: "pi_expiry_adapter", object: "payment_intent", status: "canceled" });
    },
  });
  assert.deepEqual(summary.results, [{
    paymentIntentId: "pi_expiry_adapter", cancelRequested: true, awaitingWebhook: true,
  }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["idempotency-key"], "inventory-expiry-pi_expiry_adapter");
  assert.equal((await readInventoryReservation(env, "pi_expiry_adapter")).status, "expiring");
  assert.equal((await readInventoryAvailability(env))[0].reserved, 1);

  const webhookNow = Math.floor(Date.now() / 1000);
  const canceled = await signedWebhook({
    id: "evt_expiry_adapter_canceled", type: "payment_intent.canceled",
    created: webhookNow, livemode: false,
    data: { object: {
      id: "pi_expiry_adapter", object: "payment_intent", amount: 70000, currency: "usd",
      metadata: fixture.metadata,
    } },
  }, { STORE_INVENTORY: db });
  assert.deepEqual(await canceled.json(), {
    received: true, inventory: "released", duplicate: false,
  });
  assert.equal((await readInventoryAvailability(env))[0].available, 20);
});
