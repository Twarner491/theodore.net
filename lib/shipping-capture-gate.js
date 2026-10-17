import { verifyCheckoutBinding, taxAddressBinding } from "./shipping-binding.js";
import {
  CONTIGUOUS_US_GROUND,
  canonicalShippingJson,
  sha256Hex,
  shippingDestinationError,
} from "./shipping-profile.js";
import { verifyCurrentInventoryBinding } from "./store-inventory-commerce.js";
import { InventorySoldOutError, reserveInventory } from "./store-inventory.js";

const JSON_HEADERS = { "content-type": "application/json" };

function reply(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

async function recordBlockedAuthorization(piId, eventId, reason, headers) {
  const body = new URLSearchParams({
    "metadata[capture_gate]": "blocked",
    "metadata[capture_block_reason]": reason,
    "metadata[capture_gate_event]": eventId.slice(0, 200),
  });
  try {
    const response = await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(piId), {
      method: "POST", headers, body,
    });
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function cancelBlockedAuthorization(piId, eventId, headers) {
  try {
    const response = await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(piId) + "/cancel", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "inventory-capture-cancel-" + eventId },
      body: new URLSearchParams({ cancellation_reason: "abandoned" }),
    });
    if (!response.ok) return false;
    const canceled = await response.json();
    return !!canceled && canceled.id === piId && canceled.object === "payment_intent" && canceled.status === "canceled";
  } catch (_) {
    return false;
  }
}

export async function captureProfiledAuthorization({ event, request, env }) {
  const eventPi = event && event.data && event.data.object;
  const piId = eventPi && typeof eventPi.id === "string" && /^pi_[A-Za-z0-9_]+$/.test(eventPi.id) ? eventPi.id : "";
  const eventId = event && typeof event.id === "string" && /^evt_[A-Za-z0-9_]+$/.test(event.id) ? event.id : "";
  if (!piId || !eventId || !env.STRIPE_SECRET_KEY) return reply({ received: false, pending: true }, 503);

  const headers = { authorization: "Bearer " + env.STRIPE_SECRET_KEY,
    "content-type": "application/x-www-form-urlencoded" };
  let pi;
  try {
    const response = await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(piId), { headers });
    if (!response.ok) return reply({ received: false, pending: true }, 503);
    pi = await response.json();
  } catch (_) {
    return reply({ received: false, pending: true }, 503);
  }

  if (!pi || pi.id !== piId) return reply({ received: false, pending: true }, 503);
  // Approval is terminal once Stripe reports the PaymentIntent succeeded. A
  // distinct delayed capturable event must never downgrade approved metadata.
  if (pi.status === "succeeded" && pi.metadata && pi.metadata.capture_gate === "approved") {
    return reply({ received: true, captured: true, duplicate: true });
  }

  let catalog;
  try {
    const response = await fetch(new URL("/store-catalog.json", request.url));
    if (!response.ok) return reply({ received: false, pending: true }, 503);
    catalog = await response.json();
  } catch (_) {
    return reply({ received: false, pending: true }, 503);
  }

  const metadata = pi.metadata || {};
  const binding = await verifyCheckoutBinding(metadata, catalog);
  let inventoryBinding = null;
  let reason = "";
  let retryable = false;
  let cancelForInventoryFailure = false;
  if (pi.capture_method !== "manual" || pi.status !== "requires_capture" ||
      !Number.isSafeInteger(pi.amount) || pi.amount <= 0 || pi.amount_capturable !== pi.amount || pi.currency !== "usd") {
    reason = "invalid_manual_capture_state";
  } else if (!binding || binding.profile !== CONTIGUOUS_US_GROUND) {
    reason = "catalog_or_manifest_mismatch";
  } else if (metadata.checkout_ready !== "1" || typeof metadata.tax_calculation !== "string" ||
      !metadata.tax_calculation.startsWith("taxcalc_")) {
    reason = "tax_not_finalized";
  } else if (shippingDestinationError(binding.profile, pi.shipping)) {
    reason = "shipping_destination_not_allowed";
  } else {
    const canonicalAddress = canonicalShippingJson(pi.shipping);
    const addressSha256 = canonicalAddress && await sha256Hex(canonicalAddress);
    const expectedTaxBinding = addressSha256 && await taxAddressBinding({
      taxCalculation: metadata.tax_calculation,
      addressSha256,
      manifestSha256: binding.manifestSha256,
      catalogSha256: binding.catalogSha256,
      profile: binding.profile,
      amount: pi.amount,
      currency: pi.currency,
    });
    if (!addressSha256 || metadata.shipping_address_sha256 !== addressSha256 ||
        metadata.shipping_tax_binding !== expectedTaxBinding) reason = "address_or_tax_binding_mismatch";
  }

  if (!reason) {
    try {
      inventoryBinding = await verifyCurrentInventoryBinding(pi, binding, catalog);
      if (inventoryBinding) {
        // A public draft never consumes finite stock. The authenticated Stripe
        // authorization event is the first point at which inventory is held,
        // immediately before capture and against the refetched exact PI.
        const reservation = await reserveInventory(env, piId, inventoryBinding.demand, { binding: inventoryBinding });
        if (reservation.status !== "active") {
          reason = "inventory_reservation_state_conflict";
          retryable = true;
        }
      }
    } catch (error) {
      reason = error instanceof InventorySoldOutError ? "inventory_sold_out" : "inventory_reservation_unavailable";
      retryable = true;
      // The authorization is genuine, but it must not remain capturable after
      // stock admission failed. Only Stripe's later signed canceled event can
      // release a reservation that may have persisted before an ambiguous D1
      // response.
      cancelForInventoryFailure = true;
    }
  }

  if (reason) {
    const recorded = await recordBlockedAuthorization(piId, eventId, reason, headers);
    if (cancelForInventoryFailure) {
      if (await cancelBlockedAuthorization(piId, eventId, headers)) {
        return reply({ received: true, captured: false, canceled: true, blocked: reason });
      }
      return reply({ received: false, pending: true, blocked: reason }, 503);
    }
    if (!recorded) return reply({ received: false, pending: true }, 503);
    return reply({ received: !retryable, captured: false, pending: true, blocked: reason }, retryable ? 503 : 200);
  }

  const capture = new URLSearchParams({
    amount_to_capture: String(pi.amount),
    "metadata[capture_gate]": "approved",
    "metadata[capture_gate_event]": eventId,
    "metadata[capture_address_sha256]": metadata.shipping_address_sha256,
  });
  let captured;
  try {
    const response = await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(piId) + "/capture", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "shipping-capture-" + eventId },
      body: capture,
    });
    if (!response.ok) return reply({ received: false, pending: true }, 503);
    captured = await response.json();
  } catch (_) {
    return reply({ received: false, pending: true }, 503);
  }
  if (!captured || captured.id !== piId || captured.status !== "succeeded" ||
      !captured.metadata || captured.metadata.capture_gate !== "approved" ||
      captured.metadata.capture_gate_event !== eventId ||
      captured.metadata.capture_address_sha256 !== metadata.shipping_address_sha256) {
    return reply({ received: false, pending: true }, 503);
  }
  return reply({ received: true, captured: true });
}
