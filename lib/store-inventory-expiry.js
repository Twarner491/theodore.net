import {
  listInventoryCancellationCandidates,
  markInventoryExpired,
} from "./store-inventory.js";

export class InventoryExpirySweepError extends Error {
  constructor(message = "Inventory expiry sweep could not complete.") {
    super(message);
    this.name = "InventoryExpirySweepError";
    this.code = "inventory_expiry_sweep_failed";
  }
}

export async function sweepExpiredInventory(env, options = {}) {
  const now = options.now === undefined ? Math.floor(Date.now() / 1000) : options.now;
  const limit = options.limit === undefined ? 25 : options.limit;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!Number.isSafeInteger(now) || now < 0 || typeof fetchImpl !== "function" ||
      !env || typeof env.STRIPE_SECRET_KEY !== "string" ||
      !/^(?:sk|rk)_(?:test|live)_/.test(env.STRIPE_SECRET_KEY)) {
    throw new InventoryExpirySweepError("Inventory expiry worker is not configured.");
  }
  const candidates = await listInventoryCancellationCandidates(env, { now, limit });
  const results = [];
  for (const candidate of candidates) {
    if (candidate.status === "active") {
      await markInventoryExpired(env, candidate.paymentIntentId, { now });
    }
    let response;
    try {
      response = await fetchImpl(
        "https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(candidate.paymentIntentId) + "/cancel",
        {
          method: "POST",
          headers: {
            authorization: "Bearer " + env.STRIPE_SECRET_KEY,
            "content-type": "application/x-www-form-urlencoded",
            "idempotency-key": "inventory-expiry-" + candidate.paymentIntentId,
          },
          body: new URLSearchParams({ cancellation_reason: "abandoned" }),
        },
      );
    } catch (error) {
      results.push({ paymentIntentId: candidate.paymentIntentId, cancelRequested: false, awaitingWebhook: true });
      continue;
    }
    let paymentIntent = null;
    try { paymentIntent = await response.json(); } catch (error) {}
    const canceled = response.ok && paymentIntent && paymentIntent.id === candidate.paymentIntentId &&
      paymentIntent.object === "payment_intent" && paymentIntent.status === "canceled";
    results.push({ paymentIntentId: candidate.paymentIntentId, cancelRequested: !!canceled, awaitingWebhook: true });
  }
  return Object.freeze({ checked: candidates.length, results: Object.freeze(results) });
}
