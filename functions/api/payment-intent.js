// POST /api/payment-intent  (Cloudflare Pages Function)
// Creates/updates a Stripe PaymentIntent for the cart. EVERYTHING is computed
// SERVER-SIDE so the client can never set its own price:
//   - line prices come from each variant's Stripe Price (trusted catalog)
//   - shipping comes from the cart weight + the customer's US destination
//   - sales tax comes from Stripe Tax (charged only where you're registered)
// US shipping only. The client sends the cart, the (optional) shipping address,
// and an optional receipt email -- never amounts.
import {
  CONTIGUOUS_US_GROUND,
  canonicalShippingJson,
  sha256Hex,
  shippingDestinationError,
  shippingDestinationMessage,
  trustedShippingProfile,
} from "../../lib/shipping-profile.js";
import { createCheckoutBinding, taxAddressBinding } from "../../lib/shipping-binding.js";
import { launchPending } from "../../lib/store-launch.js";
import {
  applyBoundInventoryMetadata,
  applyPendingInventoryMetadata,
  clearInventoryMetadata,
  createInventoryCommerceBinding,
  inventoryDemandFromManifest,
  inventoryDemandScope,
  verifyBoundInventoryMetadata,
} from "../../lib/store-inventory-commerce.js";
import {
  InventorySoldOutError,
  readInventoryAvailability,
} from "../../lib/store-inventory.js";

const MAX_QTY = 99, MAX_LINES = 50;
const DEFAULT_WEIGHT_LB = 2.0;       // fallback when a variant has no weight
const PACKAGING_LB = 0.3;            // box + padding added to every order
const TAX_CODE = "txcd_99999999";    // Stripe tax code: General - Tangible Goods (hardware kits)

// Ship-from origin, used only to size shipping zones by distance.
// SET THIS to your real ship-from location. (Sales-tax origin is configured
// separately, in Stripe's Tax settings.)
const SHIP_FROM = { lat: 37.77, lng: -122.40 };   // San Francisco, ZIP 94107 (ship-from)

/* ---------- shipping ----------
   Weight tiers (USPS Ground Advantage ballpark) plus a destination surcharge by
   distance from SHIP_FROM. This is the ONLY shipping logic; to switch to live
   carrier rates later, replace computeShippingCents() with an EasyPost/Shippo
   call -- nothing else in checkout or tax changes. */
function computeShippingCents(totalLb, state) {
  const lb = totalLb + PACKAGING_LB;
  // Calibrated 2026-07 against the first 27 weighed shipments: USPS GA / UPS Ground
  // labels ran $6.44-8.83, so each tier targets actual label cost + ~$1-1.50 honest
  // buffer (the old table netted ~2x the label and read as sticker shock at checkout).
  // Above 10 lb (multi-kit carts) scale per-lb -- heavy orders ship as multiple
  // boxes, so a flat top tier would quietly subsidize every extra kit.
  const base = lb <= 0.5 ? 400 : lb <= 1 ? 550 : lb <= 2 ? 650 : lb <= 3 ? 750 : lb <= 5 ? 900 : lb <= 10 ? 1300 : 1300 + Math.ceil(lb - 10) * 150;
  return base + destinationSurchargeCents(state);
}
function destinationSurchargeCents(state) {
  const s = (state || "").toUpperCase();
  if (NONCONTIGUOUS[s]) return 800;          // AK / HI / territories: zone-9 labels run well above the 27-label calibration set
  const c = STATE_CENTROIDS[s];
  if (!c) return 300;                         // unknown US state -> assume far
  const mi = haversineMiles(SHIP_FROM, { lat: c[0], lng: c[1] });
  if (mi <= 300) return 0;
  if (mi <= 900) return 100;
  if (mi <= 1600) return 200;
  return 300;
}
function haversineMiles(a, b) {
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const NONCONTIGUOUS = { AK: 1, HI: 1, PR: 1, GU: 1, VI: 1, AS: 1, MP: 1 };
const STATE_CENTROIDS = {
  AL: [32.8, -86.8], AZ: [34.3, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.3], CO: [39.0, -105.5],
  CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.6, -83.4],
  ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.0, -93.5], KS: [38.5, -98.4],
  KY: [37.5, -85.3], LA: [31.0, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8], MA: [42.3, -71.8],
  MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6],
  NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.1, -74.7], NM: [34.4, -106.1],
  NY: [42.9, -75.5], NC: [35.5, -79.4], ND: [47.5, -100.5], OH: [40.3, -82.8], OK: [35.6, -97.5],
  OR: [44.0, -120.5], PA: [40.9, -77.8], RI: [41.7, -71.6], SC: [33.9, -80.9], SD: [44.4, -100.2],
  TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9],
  WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -90.0], WY: [43.0, -107.6],
};

/* ---------- Stripe Tax ----------
   Returns { id, tax, total } or { error:true }. Tax is $0 in states where you
   have no registration (Stripe returns "not_collecting"); that's correct, not a
   failure. Only a missing/disabled Tax setup makes this error. */
async function calculateTax(headers, currency, taxLines, shippingCents, addr) {
  const form = new URLSearchParams();
  form.set("currency", currency);
  taxLines.forEach((li, i) => {
    form.set("line_items[" + i + "][amount]", String(li.amount));
    form.set("line_items[" + i + "][reference]", li.reference);
    form.set("line_items[" + i + "][tax_code]", TAX_CODE);
    form.set("line_items[" + i + "][tax_behavior]", "exclusive");
  });
  form.set("shipping_cost[amount]", String(shippingCents));
  form.set("shipping_cost[tax_behavior]", "exclusive");
  form.set("customer_details[address][country]", "US");
  form.set("customer_details[address][state]", String(addr.state || "").slice(0, 20));
  form.set("customer_details[address][postal_code]", String(addr.postal_code || "").slice(0, 20));
  if (addr.city) form.set("customer_details[address][city]", String(addr.city).slice(0, 100));
  if (addr.line1) form.set("customer_details[address][line1]", String(addr.line1).slice(0, 200));
  form.set("customer_details[address_source]", "shipping");
  let res;
  try {
    res = await fetch("https://api.stripe.com/v1/tax/calculations", { method: "POST", headers, body: form });
  } catch (e) {
    console.log("tax calc unavailable");
    return { error: true };
  }
  if (!res.ok) { console.log("tax calc failed:", res.status); return { error: true }; }
  let c;
  try { c = await res.json(); } catch (e) { return { error: true }; }
  const expectedTotal = taxLines.reduce((sum, line) => sum + line.amount, 0) + shippingCents + (c && c.tax_amount_exclusive || 0);
  if (!c || typeof c.id !== "string" || !c.id.startsWith("taxcalc_") || c.currency !== currency ||
      !Number.isSafeInteger(c.tax_amount_exclusive) || c.tax_amount_exclusive < 0 ||
      !Number.isSafeInteger(c.amount_total) || c.amount_total <= 0 || c.amount_total !== expectedTotal) {
    console.log("tax calc returned an invalid result");
    return { error: true };
  }
  return { id: c.id, tax: c.tax_amount_exclusive || 0, total: c.amount_total };
}

function requestedQuantity(value) {
  const qty = Number(value);
  return Number.isSafeInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : null;
}
function catalogQuantityLimit(variant) {
  const qty = variant && variant.maxQty;
  return Number.isSafeInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : 1;
}

// Sign a PI id with the secret key so the update path can prove the caller created this PI,
// without an extra Stripe round-trip. Returned on create, required on every update.
async function signPi(piId, secret, inventoryScope = "none") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // Keep the historical ordinary-cart token byte-for-byte compatible. Finite
  // carts add an exact demand scope so their token cannot be reused to change
  // which stock would be reserved at the authenticated capture gate.
  const payload = inventoryScope === "none" ? piId : piId + "\n" + inventoryScope;
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function cancelPaymentIntent(piId, headers, reason) {
  try {
    const response = await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(piId) + "/cancel", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "inventory-cancel-" + piId + "-" + reason },
      body: new URLSearchParams({ cancellation_reason: "abandoned" }),
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

function inventoryUnavailable(reply, error) {
  if (error instanceof InventorySoldOutError) {
    return reply({ error: "This limited batch is sold out.", code: "inventory_sold_out" }, 409);
  }
  console.log("inventory unavailable:", error && error.code || "unknown");
  return reply({ error: "Limited-batch availability could not be confirmed. Please try again." }, 503);
}
function ctEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequestPost({ request, env }) {
  const reply = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  if (!env.STRIPE_SECRET_KEY) return reply({ error: "Checkout is not configured yet." }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return reply({ error: "Bad request." }, 400); }
  const cart = body && body.cart;
  const piId = (body && typeof body.paymentIntentId === "string" && body.paymentIntentId.startsWith("pi_")) ? body.paymentIntentId : "";
  const email = (body && typeof body.email === "string" && body.email.indexOf("@") > 0) ? body.email.trim().slice(0, 200) : "";
  const ship = body && typeof body.shipping === "object" && body.shipping ? body.shipping : null;
  const addr = ship && typeof ship.address === "object" && ship.address ? ship.address : null;
  // First-party funnel attribution (no PII): a random visitor id + a channel token the storefront derived.
  // Stamped onto the order's metadata so ops can attribute revenue to its session + channel. Sanitized; never
  // trusted for anything that affects price.
  const anon = (body && typeof body.anon === "string") ? body.anon.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) : "";
  const src = (body && typeof body.source === "string") ? body.source.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 24) : "";
  if (!Array.isArray(cart) || cart.length === 0) return reply({ error: "Your cart is empty." }, 400);
  if (cart.length > MAX_LINES) return reply({ error: "Too many items in your cart." }, 400);

  let catalog;
  try { catalog = await fetch(new URL("/store-catalog.json", request.url)).then((r) => r.json()); }
  catch (e) { return reply({ error: "Store catalog unavailable." }, 502); }

  const auth = { authorization: "Bearer " + env.STRIPE_SECRET_KEY };
  const headers = { ...auth, "content-type": "application/x-www-form-urlencoded" };
  const normalized = [], requestedByVariant = new Map();
  for (const l of cart) {
    const id = l && typeof l.id === "string" ? l.id : "";
    const build = l && typeof l.build === "string" ? l.build : "";
    const entry = id && Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : null;
    const variant = entry && entry.variants && Object.prototype.hasOwnProperty.call(entry.variants, build) ? entry.variants[build] : null;
    const priceId = variant && typeof variant.price === "string" ? variant.price : "";
    const qty = requestedQuantity(l && l.qty);
    const shippingProfile = trustedShippingProfile(variant);
    if (!priceId.startsWith("price_")) return reply({ error: "An item in your cart is unavailable.", item: { id, build } }, 400);
    if (shippingProfile === null) return reply({ error: "An item in your cart is unavailable.", item: { id, build } }, 400);
    if (launchPending(variant)) return reply({ error: (entry.title || "That item") + " is not open yet." }, 400);
    if (qty == null) return reply({ error: "Enter a valid whole-number quantity." }, 400);
    const maxQty = catalogQuantityLimit(variant);
    const key = id + "\u0000" + build;
    const requested = (requestedByVariant.get(key) || 0) + qty;
    if (requested > maxQty) return reply({ error: "You can order at most " + maxQty + " of that item per order." }, 400);
    requestedByVariant.set(key, requested);
    normalized.push({ id, build, priceId, qty, shippingProfile,
      weightLb: typeof variant.weightLb === "number" ? variant.weightLb : DEFAULT_WEIGHT_LB });
  }

  const checkoutBinding = await createCheckoutBinding(normalized, catalog);
  if (!checkoutBinding) return reply({ error: "An item in your cart is unavailable." }, 400);
  let inventoryDemand;
  try { inventoryDemand = inventoryDemandFromManifest(checkoutBinding.manifest, catalog); }
  catch (error) { return reply({ error: "An item in your cart is unavailable." }, 400); }
  const inventoryScope = inventoryDemandScope(inventoryDemand);
  if (piId) {
    const tok = (body && typeof body.updateToken === "string") ? body.updateToken : "";
    if (!tok || !ctEqual(tok, await signPi(piId, env.STRIPE_SECRET_KEY, inventoryScope))) {
      return reply({ error: "Could not update checkout." }, 400);
    }
  }
  if (inventoryDemand.length) {
    try {
      const availability = await readInventoryAvailability(env, inventoryDemand.map((line) => line.sku));
      if (inventoryDemand.some((line) => availability.find((row) => row.sku === line.sku).available < line.quantity)) {
        throw new InventorySoldOutError();
      }
    } catch (error) {
      return inventoryUnavailable(reply, error);
    }
  }
  const requiresContiguousGround = checkoutBinding.profile === CONTIGUOUS_US_GROUND;
  if (addr && requiresContiguousGround) {
    const destinationError = shippingDestinationError(CONTIGUOUS_US_GROUND, ship);
    if (destinationError) return reply({ error: shippingDestinationMessage(destinationError) }, 400);
  }

  const priceCache = {};
  const taxLines = [];
  let subtotal = 0, currency = "usd", totalLb = 0;
  for (const line of normalized) {
    const { id, build, priceId, weightLb, qty } = line;
    if (!priceCache[priceId]) {
      const pr = await fetch("https://api.stripe.com/v1/prices/" + priceId, { headers: auth });
      if (!pr.ok) return reply({ error: "An item in your cart is unavailable.", item: { id, build } }, 400);
      priceCache[priceId] = await pr.json();
    }
    const price = priceCache[priceId];
    if (!price.active || typeof price.unit_amount !== "number") return reply({ error: "An item in your cart is unavailable.", item: { id, build } }, 400);
    if (price.currency !== "usd") return reply({ error: "An item in your cart is unavailable.", item: { id, build } }, 400);   // pin USD; a stray non-USD Price must never set the amount or currency
    const lineTotal = price.unit_amount * qty;
    subtotal += lineTotal;
    totalLb += weightLb * qty;
    taxLines.push({ amount: lineTotal, reference: (id + "|" + build).slice(0, 64) });
  }
  if (subtotal <= 0) return reply({ error: "Your cart is empty." }, 400);

  // Shipping + tax need a US address. Before that, initialize a manual-capture
  // draft at the subtotal so Stripe Elements can mount without making it payable.
  let shippingCents = null, taxCents = null, total = subtotal, calcId = "";
  if (addr && typeof addr.country === "string" && addr.country !== "US") {
    return reply({ error: "We only ship within the US right now." }, 400);
  }
  // Shipping + tax only once we have a valid US destination: a 2-letter state we recognize
  // plus a 5-digit ZIP. Validating here also stops a malformed address from making the tax
  // API error out and silently fall back to $0 in a state where we DO collect.
  const _state = String((addr && addr.state) || "").toUpperCase();
  const _zip = String((addr && addr.postal_code) || "");
  const haveAddress = !!addr && addr.country === "US" && !!(STATE_CENTROIDS[_state] || NONCONTIGUOUS[_state]) && /^\d{5}(-\d{4})?$/.test(_zip);
  if (addr && !haveAddress) return reply({ error: "Enter a valid US shipping address." }, 400);
  if (piId && !haveAddress) return reply({ error: "A valid shipping address is required before payment." }, 400);
  if (haveAddress) {
    shippingCents = computeShippingCents(totalLb, _state);
    const tax = await calculateTax(headers, currency, taxLines, shippingCents, addr);
    if (tax.error) return reply({ error: "Sales tax could not be calculated. Please try again." }, 502);
    taxCents = tax.tax; total = tax.total; calcId = tax.id;
  }

  const form = new URLSearchParams();
  form.set("amount", String(total));
  form.set("metadata[items]", checkoutBinding.legacyItems);
  form.set("metadata[breakdown]", subtotal + "|" + (shippingCents || 0) + "|" + (taxCents || 0) + "|" + total);   // cents, for the confirmation page receipt
  form.set("metadata[weight]", String(Math.round(totalLb * 10) / 10));   // lb, for the operator's carrier call
  if (calcId) form.set("metadata[tax_calculation]", calcId);   // the webhook records the tax transaction from this
  form.set("metadata[checkout_ready]", haveAddress && calcId ? "1" : "0");
  form.set("metadata[shipping_profile]", checkoutBinding.metadataProfile);
  form.set("metadata[shipping_items]", checkoutBinding.manifestJson);
  form.set("metadata[shipping_items_sha256]", checkoutBinding.manifestSha256);
  form.set("metadata[shipping_catalog_sha256]", checkoutBinding.catalogSha256);
  let inventoryBinding = null;
  if (inventoryDemand.length && piId) {
    try {
      inventoryBinding = await createInventoryCommerceBinding({
        paymentIntentId: piId, amount: total, currency,
        manifestSha256: checkoutBinding.manifestSha256,
        catalogSha256: checkoutBinding.catalogSha256,
        demand: inventoryDemand,
      });
      applyBoundInventoryMetadata(form, inventoryBinding);
    } catch (error) {
      return reply({ error: "An item in your cart is unavailable." }, 400);
    }
  } else if (inventoryDemand.length) {
    await applyPendingInventoryMetadata(form, inventoryDemand);
  } else if (piId) {
    clearInventoryMetadata(form);
  }
  if (requiresContiguousGround) {
    form.set("metadata[capture_gate]", "pending");
    if (haveAddress) {
      const canonicalAddress = canonicalShippingJson(ship);
      if (!canonicalAddress) return reply({ error: "Enter a complete contiguous-US street address." }, 400);
      const addressSha256 = await sha256Hex(canonicalAddress);
      const taxBinding = await taxAddressBinding({
        taxCalculation: calcId,
        addressSha256,
        manifestSha256: checkoutBinding.manifestSha256,
        catalogSha256: checkoutBinding.catalogSha256,
        profile: checkoutBinding.profile,
        amount: total,
        currency,
      });
      form.set("metadata[shipping_address_sha256]", addressSha256);
      form.set("metadata[shipping_tax_binding]", taxBinding);
    }
  } else if (piId) {
    // An update token can be reused for a different cart. Explicitly erase any
    // prior address/capture bindings so omitted fields cannot survive the update.
    for (const key of ["shipping_address_sha256", "shipping_tax_binding",
      "capture_gate", "capture_block_reason", "capture_gate_event", "capture_address_sha256"]) {
      form.set("metadata[" + key + "]", "");
    }
  }
  // The initial subtotal-only intent exists only so Stripe Elements can mount.
  // Keep it manual-capture until a server-side address + Tax calculation has
  // finalized the total. capture_method is secret-key-only, so a caller that
  // confirms the draft directly can at most create an expiring authorization;
  // it cannot capture an untaxed subtotal or trigger fulfillment.
  form.set("capture_method", (requiresContiguousGround || inventoryDemand.length) ? "manual" : (haveAddress && calcId ? "automatic" : "manual"));
  if (email) form.set("metadata[email]", email);   // our own receipt + order lookup use this; NOT receipt_email, which makes Stripe ALSO send its own receipt
  if (anon) form.set("metadata[anon]", anon);       // first-party visitor id -> joins this order back to its funnel session
  if (src) form.set("metadata[src]", src);          // first-party channel (x / instagram / direct / <go-slug>) for revenue attribution
  // NB: we deliberately do NOT set shipping[...] here. confirmPayment() sets the PI's
  // shipping from the Address Element (publishable key); a secret-key shipping set
  // would then block that client update. The address above is still used for tax.
  const breakdown = { subtotal, shipping: shippingCents, tax: taxCents, total, currency };

  if (piId) {
    form.set("metadata[order_no]", piId.replace(/^pi_/, "").slice(0, 10).toUpperCase());   // searchable for the order-lookup page
    const upd = await fetch("https://api.stripe.com/v1/payment_intents/" + piId, { method: "POST", headers, body: form });
    if (!upd.ok) { console.log("payment_intent update failed:", upd.status); return reply({ error: "Could not update checkout." }, 502); }
    if (inventoryDemand.length) {
      let updatedPi;
      try { updatedPi = await upd.json(); } catch (error) { updatedPi = null; }
      try {
        const confirmed = await verifyBoundInventoryMetadata(updatedPi);
        if (confirmed.bindingSha256 !== inventoryBinding.bindingSha256) throw new Error("binding mismatch");
      } catch (error) {
        await cancelPaymentIntent(piId, headers, "update-failed");
        return inventoryUnavailable(reply, error);
      }
    }
    return reply({ updated: true, ...breakdown });
  }

  form.set("currency", currency);
  form.set("automatic_payment_methods[enabled]", "true");          // dynamic methods so Apple Pay / Google Pay surface; curate which appear in the Stripe Dashboard
  form.set("automatic_payment_methods[allow_redirects]", "never"); // keep checkout to immediate methods (card + wallets), no redirect/BNPL flows
  form.set("description", "theodore.net store order");
  const res = await fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", headers, body: form });
  if (!res.ok) { console.log("payment_intent failed:", res.status); return reply({ error: "Could not start checkout." }, 502); }
  const pi = await res.json();
  if (!pi || typeof pi.id !== "string" || !/^pi_[A-Za-z0-9_]+$/.test(pi.id) ||
      typeof pi.client_secret !== "string" || !pi.client_secret.startsWith(pi.id + "_secret_")) {
    return reply({ error: "Could not start checkout." }, 502);
  }
  if (inventoryDemand.length) {
    try {
      inventoryBinding = await createInventoryCommerceBinding({
        paymentIntentId: pi.id, amount: total, currency,
        manifestSha256: checkoutBinding.manifestSha256,
        catalogSha256: checkoutBinding.catalogSha256,
        demand: inventoryDemand,
      });
      const bindForm = new URLSearchParams();
      applyBoundInventoryMetadata(bindForm, inventoryBinding);
      const boundResponse = await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(pi.id), {
        method: "POST",
        headers: { ...headers, "idempotency-key": "inventory-bind-" + pi.id },
        body: bindForm,
      });
      if (!boundResponse.ok) throw new Error("Stripe inventory binding update failed");
      const boundPi = await boundResponse.json();
      const confirmed = await verifyBoundInventoryMetadata(boundPi);
      if (confirmed.bindingSha256 !== inventoryBinding.bindingSha256) throw new Error("Stripe inventory binding mismatch");
    } catch (error) {
      await cancelPaymentIntent(pi.id, headers, "create-failed");
      return inventoryUnavailable(reply, error);
    }
  }
  const updateToken = await signPi(pi.id, env.STRIPE_SECRET_KEY, inventoryScope);
  return reply({ clientSecret: pi.client_secret, publishableKey: env.STRIPE_PUBLISHABLE_KEY || null, updateToken, ...breakdown });
}
