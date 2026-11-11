import { ensureProductionBatches, readProductionBatch, allocatePaidProductionOrder } from "./store-production-batches.js";
import { canonicalShippingJson } from "./shipping-profile.js";
import { CONTINUOUS_FRAME_BUILD, PRODUCTION_BATCH_METADATA, PRODUCTION_PAID_AT_METADATA } from "./order-production-batches.js";

export const PRODUCTION_GROUP = "avian-visitors";
export const productionIntakePaused = (env) => env.PRODUCTION_BATCH_PAUSED === "1";

export function productionDemand(manifest, catalog) {
  const demand = [];
  for (const [id, build, quantity] of manifest.lines) {
    const variant = catalog[id] && catalog[id].variants && catalog[id].variants[build];
    const continuousFrame = id === PRODUCTION_GROUP && build === CONTINUOUS_FRAME_BUILD;
    if (!continuousFrame && (!variant || !variant.productionBatchGroup)) continue;
    if (!variant || variant.productionBatchGroup !== PRODUCTION_GROUP || !continuousFrame || variant.inventorySku) {
      throw new Error("Unsupported production batch contract");
    }
    demand.push({ productId: id, build, quantity });
  }
  return demand;
}

export async function productionBatchReady(env) {
  await ensureProductionBatches(env, { productId: PRODUCTION_GROUP });
  const current = await readProductionBatch(env, { productId: PRODUCTION_GROUP });
  if (!current || !Number.isSafeInteger(current.ordinal) || current.ordinal < 1 ||
      !Number.isSafeInteger(current.remaining) || current.remaining < 0) throw new Error("Production allocation unavailable");
  return current;
}

// Called only after signature, manifest, tax, address and capture-gate checks in
// the succeeded webhook. Neither drafts nor authorizations allocate production.
export async function allocateProductionPayment({ event, pi, demand, env }) {
  const now = Math.floor(Date.now() / 1000);
  const keyMode = /^(?:sk|rk)_(test|live)_/.exec(env.STRIPE_SECRET_KEY || "");
  const mode = keyMode && keyMode[1] === "live";
  if (!keyMode || event.type !== "payment_intent.succeeded" || event.livemode !== mode ||
      !/^evt_[A-Za-z0-9_]+$/.test(event.id || "") || !Number.isSafeInteger(event.created) || event.created < 1 || event.created > now ||
      !/^pi_[A-Za-z0-9_]+$/.test(pi.id || "") || pi.object !== "payment_intent" || pi.status !== "succeeded" ||
      pi.livemode !== mode || pi.currency !== "usd" || !Number.isSafeInteger(pi.amount) || pi.amount <= 0) {
    throw new Error("Invalid paid production evidence");
  }
  const headers = { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" };
  const url = "https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(pi.id);
  const response = await fetch(url + "?expand[]=latest_charge", { headers });
  if (!response.ok) throw new Error("Paid intent unavailable");
  const current = await response.json();
  if (!current || current.id !== pi.id || current.object !== "payment_intent" || current.status !== "succeeded" ||
      current.livemode !== mode || current.amount !== pi.amount || current.amount_received !== pi.amount || current.currency !== pi.currency ||
      canonicalShippingJson(current.shipping) !== canonicalShippingJson(pi.shipping)) throw new Error("Paid intent changed");
  for (const field of ["items", "shipping_items", "shipping_items_sha256", "shipping_catalog_sha256", "shipping_profile",
    "checkout_ready", "tax_calculation", "shipping_tax_binding", "shipping_address_sha256", "capture_gate", "capture_address_sha256"]) {
    if (!current.metadata || current.metadata[field] !== pi.metadata[field]) throw new Error("Paid intent binding changed");
  }
  const charge = current.latest_charge;
  if (!charge || charge.object !== "charge" || charge.payment_intent !== pi.id || charge.status !== "succeeded" ||
      charge.paid !== true || charge.captured !== true || charge.livemode !== mode || charge.currency !== pi.currency || charge.amount !== pi.amount || charge.amount_captured !== pi.amount ||
      !Number.isSafeInteger(charge.created) || charge.created < 1 || charge.created > now) throw new Error("Paid charge unavailable");
  await productionBatchReady(env);
  const lines = [];
  let firstPaidAt = null;
  for (const line of demand) {
    const allocation = await allocatePaidProductionOrder(env, {
      // Charge creation can precede manual capture. The first verified success
      // event dates payment; the ledger preserves it across distinct retries.
      provider: "stripe", orderId: pi.id, productId: line.productId, quantity: line.quantity, paidAt: event.created,
    });
    if (firstPaidAt !== null && firstPaidAt !== allocation.paidAt) throw new Error("Production paid time changed");
    firstPaidAt = allocation.paidAt;
    lines.push([line.productId, line.build, allocation.allocations.map(({ ordinal, quantity }) => [ordinal, quantity])]);
  }
  if (!Number.isSafeInteger(firstPaidAt) || firstPaidAt < 1) throw new Error("Production paid time unavailable");
  const paidTime = String(firstPaidAt);
  const value = JSON.stringify({ v: 1, lines });
  if (value.length > 500) throw new Error("Production allocation metadata exceeds Stripe limit");
  const prior = current.metadata[PRODUCTION_BATCH_METADATA];
  if (prior && prior !== value) throw new Error("Paid production allocation changed");
  const priorPaidTime = current.metadata[PRODUCTION_PAID_AT_METADATA];
  if (priorPaidTime && priorPaidTime !== paidTime) throw new Error("Paid production time changed");
  if (prior === value && priorPaidTime === paidTime) return current;
  const saved = await fetch(url, { method: "POST", headers: { ...headers, "idempotency-key": "production-allocation-v2-" + pi.id },
    body: new URLSearchParams({ ["metadata[" + PRODUCTION_BATCH_METADATA + "]"]: value,
      ["metadata[" + PRODUCTION_PAID_AT_METADATA + "]"]: paidTime }) });
  if (!saved.ok) throw new Error("Production allocation metadata pending");
  const updated = await saved.json();
  if (!updated || updated.id !== pi.id || updated.status !== "succeeded" ||
      !updated.metadata || updated.metadata[PRODUCTION_BATCH_METADATA] !== value ||
      updated.metadata[PRODUCTION_PAID_AT_METADATA] !== paidTime) throw new Error("Production allocation metadata not confirmed");
  return updated;
}
