// POST /api/stripe-webhook  (Cloudflare Pages Function)
// Receives Stripe events and verifies the signature against STRIPE_WEBHOOK_SECRET
// before trusting anything, so forged "payment succeeded" calls are rejected.
// On a completed checkout it runs fulfillment (for now, logs the paid order).
// The signing secret comes from env (.dev.vars locally, a Cloudflare secret in
// production), never from the repo.
import { buildOrder, receiptHtml, operatorHtml, sendEmail } from "../../lib/emails.js";
import { verifyCheckoutBinding } from "../../lib/shipping-binding.js";
import { CONTIGUOUS_US_GROUND, canonicalShippingJson, sha256Hex, shippingDestinationError } from "../../lib/shipping-profile.js";
import { captureProfiledAuthorization } from "../../lib/shipping-capture-gate.js";
import {
  inventoryMetadataState,
  verifyBoundInventoryMetadata,
  verifyCurrentInventoryBinding,
} from "../../lib/store-inventory-commerce.js";
import {
  commitInventory,
  readInventoryReservation,
  releaseInventory,
  verifyInventoryProviderEvidence,
} from "../../lib/store-inventory.js";
const TOLERANCE = 300; // seconds; rejects replayed or stale events

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

function expectedStripeLivemode(env) {
  const key = env && env.STRIPE_SECRET_KEY;
  if (typeof key !== "string") return null;
  if (/^(?:sk|rk)_live_/.test(key)) return true;
  if (/^(?:sk|rk)_test_/.test(key)) return false;
  return null;
}

export async function onRequestPost({ request, env }) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 500 });

  const sig = request.headers.get("stripe-signature") || "";
  const body = await request.text(); // raw body is required for signature verification
  const event = await verify(body, sig, secret);
  if (!event) return new Response("invalid signature", { status: 400 });

  // Profiled orders authorize first. This authenticated event is the sole
  // server-side capture gate. Inventory admission failure asks Stripe to cancel;
  // ambiguous capture itself stays pending with its D1 hold intact for retry.
  if (event.type === "payment_intent.amount_capturable_updated") {
    return captureProfiledAuthorization({ event, request, env });
  }

  const eventPi = event && event.data && event.data.object;
  const inventoryState = inventoryMetadataState(eventPi && eventPi.metadata);

  // A failed payment method is retryable. It never frees held stock.
  if (event.type === "payment_intent.payment_failed" && inventoryState !== "none") {
    return json({ received: true, inventory: "retained" });
  }

  if (event.type === "payment_intent.canceled" && inventoryState !== "none") {
    try {
      const expectedLivemode = expectedStripeLivemode(env);
      if (expectedLivemode === null) throw new Error("Stripe mode is unavailable");
      const evidence = await verifyInventoryProviderEvidence(body, sig, secret, {
        now: Math.floor(Date.now() / 1000), expectedLivemode,
      });
      const reservation = await readInventoryReservation(env, eventPi.id);
      // A signed cancellation after a sold-out capture gate is expected to
      // have no D1 row. Acknowledge it without inventing a release. Missing or
      // malformed D1 still throws and remains fail closed.
      if (!reservation) return json({ received: true, inventory: "not_reserved" });
      let binding = null;
      if (inventoryState === "bound") {
        binding = await verifyBoundInventoryMetadata(eventPi);
      } else if (inventoryState === "pending") {
        binding = reservation.commerceBinding;
        if (!binding) throw new Error("Pending reservation is not commerce-bound");
      } else {
        throw new Error("Inventory metadata is invalid");
      }
      const released = await releaseInventory(env, eventPi.id, { evidence, binding });
      return json({ received: true, inventory: "released", duplicate: released.duplicate });
    } catch (error) {
      console.log("inventory cancellation pending:", error && error.code || "invalid");
      return json({ received: false, pending: true, blocked: "inventory_cancellation_pending" }, 503);
    }
  }

  // fulfillment hooks (email / dashboard / store record go here later)
  if (event.type === "payment_intent.succeeded") {
    const pi = (event.data && event.data.object) || {};
    const ship = pi.shipping || {};
    console.log("paid:", pi.id, pi.amount, pi.currency, "| items:", pi.metadata && pi.metadata.items, "| ship:", ship.name);
    let committedInventory = null;
    if (inventoryState !== "none") {
      try {
        if (inventoryState !== "bound") throw new Error("Inventory metadata is not bound");
        const expectedLivemode = expectedStripeLivemode(env);
        if (expectedLivemode === null) throw new Error("Stripe mode is unavailable");
        const binding = await verifyBoundInventoryMetadata(pi);
        const evidence = await verifyInventoryProviderEvidence(body, sig, secret, {
          now: Math.floor(Date.now() / 1000), expectedLivemode,
        });
        committedInventory = await commitInventory(env, pi.id, { evidence, binding });
      } catch (error) {
        console.log("inventory success pending:", error && error.code || "invalid");
        return json({ received: false, fulfilled: false, pending: true, blocked: "inventory_commit_pending" }, 503);
      }
    }
    // A PaymentIntent is created before the buyer finishes the address form so
    // Stripe Elements can mount. Treat a direct confirmation of that draft as
    // unfulfillable: only the server-side address + Tax calculation update marks
    // the intent ready. This prevents a client from bypassing shipping or Tax by
    // confirming the initial subtotal-only intent.
    if (!pi.metadata || pi.metadata.checkout_ready !== "1" ||
        typeof pi.metadata.tax_calculation !== "string" || !pi.metadata.tax_calculation.startsWith("taxcalc_")) {
      console.log("fulfillment blocked: payment intent was not tax-finalized", pi.id);
      // The event is authentic and has been handled, so acknowledge it. A non-2xx
      // response would make Stripe retry the same intentionally blocked event.
      return new Response(JSON.stringify({ received: true, fulfilled: false, blocked: "tax_not_finalized" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    // Re-derive every succeeded order from the strict manifest and the current
    // trusted catalog. Absence of a profile is never treated as evidence that a
    // product is unrestricted, including PaymentIntents created before a catalog
    // item acquired a shipping profile.
    let catalog;
    try {
      const catalogResponse = await fetch(new URL("/store-catalog.json", request.url));
      if (!catalogResponse.ok) throw new Error("catalog status " + catalogResponse.status);
      catalog = await catalogResponse.json();
    } catch (e) {
      console.log("fulfillment pending: current catalog unavailable", pi.id);
      return new Response(JSON.stringify({ received: false, fulfilled: false, pending: true, blocked: "catalog_unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    const currentBinding = await verifyCheckoutBinding(pi.metadata, catalog);
    if (!currentBinding) {
      console.log("fulfillment blocked: current catalog or item manifest mismatch", pi.id);
      return new Response(JSON.stringify({ received: true, fulfilled: false, blocked: "catalog_or_manifest_mismatch" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    try {
      const currentInventory = await verifyCurrentInventoryBinding(pi, currentBinding, catalog);
      if (!!currentInventory !== !!committedInventory) throw new Error("Inventory expectation changed");
    } catch (error) {
      console.log("fulfillment blocked: inventory or catalog binding mismatch", pi.id);
      return json({ received: true, fulfilled: false, blocked: "inventory_or_catalog_mismatch" });
    }
    // Address Element writes the final address onto the PaymentIntent during
    // confirmation. Recheck that address against the server-stamped profile so
    // a changed or directly confirmed address can never reach fulfillment.
    const destinationError = currentBinding.profile === CONTIGUOUS_US_GROUND
      ? shippingDestinationError(currentBinding.profile, ship) : "";
    if (destinationError) {
      console.log("fulfillment blocked: shipping destination is not allowed", pi.id, destinationError);
      return new Response(JSON.stringify({ received: true, fulfilled: false, blocked: "shipping_destination_not_allowed" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (currentBinding.profile === CONTIGUOUS_US_GROUND) {
      const finalAddressJson = canonicalShippingJson(pi.shipping);
      const finalAddressSha256 = finalAddressJson && await sha256Hex(finalAddressJson);
      if (pi.metadata.capture_gate !== "approved" ||
          typeof pi.metadata.capture_gate_event !== "string" || !pi.metadata.capture_gate_event.startsWith("evt_") ||
          pi.metadata.capture_address_sha256 !== finalAddressSha256) {
        console.log("fulfillment blocked: profiled authorization did not pass capture gate", pi.id);
        return new Response(JSON.stringify({ received: true, fulfilled: false, blocked: "capture_gate_not_approved" }), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    // Idempotency: Stripe delivers events at-least-once and payment_intent.succeeded can fire
    // more than once, so guard fulfillment on a per-PI flag to avoid double receipts / double
    // operator alerts on a retry. (Best-effort, not perfectly atomic, but right at this volume.)
    if (pi.metadata && pi.metadata.notified === "1") {
      return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    // record the Stripe Tax transaction for filing (best-effort; a retry's duplicate reference just no-ops)
    const calc = pi.metadata && pi.metadata.tax_calculation;
    if (calc && env.STRIPE_SECRET_KEY) {
      try {
        const r = await fetch("https://api.stripe.com/v1/tax/transactions/create_from_calculation", {
          method: "POST",
          headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ calculation: calc, reference: pi.id }),
        });
        if (!r.ok) console.log("tax transaction failed:", r.status, await r.text().catch(() => ""));
      } catch (e) { console.log("tax transaction error:", e && e.message); }
    }
    // order emails: receipt to the customer, notification to the operator (best-effort; never fail the webhook)
    try {
      const order = buildOrder(pi, catalog);
      if (order.email) await sendEmail(env, { to: order.email, subject: "Order confirmed (#" + order.orderNo + ")", html: receiptHtml(order) });
      if (env.OPERATOR_EMAIL) await sendEmail(env, { to: env.OPERATOR_EMAIL, replyTo: order.email || undefined, subject: "New order #" + order.orderNo, html: operatorHtml(order, { opsUrl: env.OPS_URL || "https://ops.theodore.net" }) });
    } catch (e) { console.log("order email error:", e && e.message); }
    // mark fulfilled (idempotency flag) + ensure the order-lookup key exists, in one PI update.
    // Set AFTER emails so a failure before this point lets a Stripe retry re-send rather than drop the receipt.
    if (env.STRIPE_SECRET_KEY) {
      try {
        const md = new URLSearchParams({ "metadata[notified]": "1" });
        if (!(pi.metadata && pi.metadata.order_no)) md.set("metadata[order_no]", String(pi.id).replace(/^pi_/, "").slice(0, 10).toUpperCase());
        await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(pi.id), {
          method: "POST",
          headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" },
          body: md,
        });
      } catch (e) { console.log("fulfillment flag error:", e && e.message); }
    }
  } else if (event.type === "checkout.session.completed") {
    const s = (event.data && event.data.object) || {};
    console.log("hosted checkout fulfillment blocked: no strict item/address capture binding", s.id);
    return new Response(JSON.stringify({ received: true, fulfilled: false, blocked: "legacy_hosted_checkout_unbound" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "content-type": "application/json" } });
}

async function verify(body, header, secret) {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = (parts.find((p) => p[0] === "t") || [])[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || sigs.length === 0) return null;
  const ts = Number(t); if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE) return null;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(t + "." + body));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (!sigs.some((s) => timingSafeEqual(s, expected))) return null;
  try { return JSON.parse(body); } catch (e) { return null; }
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
