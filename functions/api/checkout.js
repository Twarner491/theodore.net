// POST /api/checkout  (Cloudflare Pages Function)
// Builds a Stripe hosted Checkout Session from the cart. Prices are never taken
// from the client: each cart line is matched to a Stripe Price id from the
// trusted build catalog (store-catalog.json), and Stripe computes the amounts.
// The secret key comes from env (.dev.vars locally, a Cloudflare secret in
// production), never from the repo.
import { CONTIGUOUS_US_GROUND, trustedShippingProfile } from "../../lib/shipping-profile.js";
import { launchPending } from "../../lib/store-launch.js";

const MAX_QTY = 99, MAX_LINES = 50;
const HOSTED_CHECKOUT_DISABLED = true;

function requestedQuantity(value) {
  const qty = Number(value);
  return Number.isSafeInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : null;
}
function catalogQuantityLimit(variant) {
  const qty = variant && variant.maxQty;
  return Number.isSafeInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : 1;
}

export async function onRequestPost({ request, env }) {
  const reply = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  // Hosted Checkout cannot bind the final street address, current catalog,
  // tax calculation, and fulfillment state before Stripe captures payment.
  // Keep this legacy endpoint closed until it has the same authenticated
  // manual-capture contract as the on-site PaymentIntent flow.
  if (HOSTED_CHECKOUT_DISABLED) {
    return reply({ error: "Hosted checkout is unavailable. Use the on-site checkout." }, 409);
  }

  if (!env.STRIPE_SECRET_KEY) return reply({ error: "Checkout is not configured yet." }, 500);

  let cart;
  try { cart = (await request.json()).cart; } catch (e) { return reply({ error: "Bad request." }, 400); }
  if (!Array.isArray(cart) || cart.length === 0) return reply({ error: "Your cart is empty." }, 400);
  if (cart.length > MAX_LINES) return reply({ error: "Too many items in your cart." }, 400);

  // trusted product -> variant -> Stripe Price id map, generated from the markdown at build time
  let catalog;
  try { catalog = await fetch(new URL("/store-catalog.json", request.url)).then((r) => r.json()); }
  catch (e) { return reply({ error: "Store catalog unavailable." }, 502); }

  const items = [], requestedByVariant = new Map();
  let requiresContiguousGround = false;
  for (const l of cart) {
    const id = l && typeof l.id === "string" ? l.id : "";
    const build = l && typeof l.build === "string" ? l.build : "";
    const entry = id && Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : null;
    const variant = entry && entry.variants && Object.prototype.hasOwnProperty.call(entry.variants, build) ? entry.variants[build] : null;
    const price = variant && typeof variant.price === "string" ? variant.price : "";
    const shippingProfile = trustedShippingProfile(variant);
    if (!price.startsWith("price_")) return reply({ error: "An item in your cart is unavailable." }, 400);
    if (shippingProfile === null) return reply({ error: "An item in your cart is unavailable." }, 400);
    if (launchPending(variant)) return reply({ error: "An item in your cart is not open yet." }, 400);
    const qty = requestedQuantity(l && l.qty);
    if (qty == null) return reply({ error: "Enter a valid whole-number quantity." }, 400);
    const maxQty = catalogQuantityLimit(variant);
    const key = id + "\u0000" + build;
    const requested = (requestedByVariant.get(key) || 0) + qty;
    if (requested > maxQty) return reply({ error: "You can order at most " + maxQty + " of that item per order." }, 400);
    requestedByVariant.set(key, requested);
    if (shippingProfile === CONTIGUOUS_US_GROUND) requiresContiguousGround = true;
    items.push([price, qty]);
  }

  // Hosted Checkout exposes the street address only after this endpoint has
  // created the session. Its country allowlist cannot enforce lower-48 states
  // or reject PO boxes, so profiled carts must use the on-site address-validated
  // PaymentIntent flow. Refusing the session is the fail-closed boundary.
  if (requiresContiguousGround) {
    return reply({ error: "This item requires the on-site checkout for ground-shipping address validation." }, 400);
  }

  const origin = env.SITE_URL || new URL(request.url).origin;
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", origin + "/store/?checkout=success&session_id={CHECKOUT_SESSION_ID}");
  form.set("cancel_url", origin + "/store/?checkout=cancel");
  form.set("shipping_address_collection[allowed_countries][0]", "US");
  form.set("automatic_tax[enabled]", "true");
  items.forEach(([price, qty], i) => {
    form.set("line_items[" + i + "][price]", price);
    form.set("line_items[" + i + "][quantity]", String(qty));
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!res.ok) { console.log("stripe checkout failed:", res.status); return reply({ error: "Could not start checkout." }, 502); }
  const session = await res.json();
  return reply({ url: session.url });
}
