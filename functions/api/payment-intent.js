// POST /api/payment-intent  (Cloudflare Pages Function)
// Creates/updates a Stripe PaymentIntent for the cart. EVERYTHING is computed
// SERVER-SIDE so the client can never set its own price:
//   - line prices come from each variant's Stripe Price (trusted catalog)
//   - shipping comes from the cart weight + the customer's US destination
//   - sales tax comes from Stripe Tax (charged only where you're registered)
// US shipping only. The client sends the cart, the (optional) shipping address,
// and an optional receipt email -- never amounts.
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
  const base = lb <= 0.5 ? 500 : lb <= 1 ? 650 : lb <= 2 ? 850 : lb <= 3 ? 1050 : lb <= 5 ? 1350 : lb <= 10 ? 1900 : 2600;
  return base + destinationSurchargeCents(state);
}
function destinationSurchargeCents(state) {
  const s = (state || "").toUpperCase();
  if (NONCONTIGUOUS[s]) return 900;          // AK / HI / territories: always pricier
  const c = STATE_CENTROIDS[s];
  if (!c) return 500;                         // unknown US state -> assume far
  const mi = haversineMiles(SHIP_FROM, { lat: c[0], lng: c[1] });
  if (mi <= 300) return 0;
  if (mi <= 900) return 150;
  if (mi <= 1600) return 350;
  return 500;
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
  });
  form.set("shipping_cost[amount]", String(shippingCents));
  form.set("customer_details[address][country]", "US");
  form.set("customer_details[address][state]", String(addr.state || "").slice(0, 20));
  form.set("customer_details[address][postal_code]", String(addr.postal_code || "").slice(0, 20));
  if (addr.city) form.set("customer_details[address][city]", String(addr.city).slice(0, 100));
  if (addr.line1) form.set("customer_details[address][line1]", String(addr.line1).slice(0, 200));
  form.set("customer_details[address_source]", "shipping");
  const res = await fetch("https://api.stripe.com/v1/tax/calculations", { method: "POST", headers, body: form });
  if (!res.ok) { console.log("tax calc failed:", res.status, await res.text().catch(() => "")); return { error: true }; }
  const c = await res.json();
  return { id: c.id, tax: c.tax_amount_exclusive || 0, total: c.amount_total };
}

// Sign a PI id with the secret key so the update path can prove the caller created this PI,
// without an extra Stripe round-trip. Returned on create, required on every update.
async function signPi(piId, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(piId));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const priceCache = {};
  const items = [], taxLines = [];
  let subtotal = 0, currency = "usd", totalLb = 0;
  for (const l of cart) {
    const id = l && typeof l.id === "string" ? l.id : "";
    const build = l && typeof l.build === "string" ? l.build : "";
    const entry = id && Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : null;
    const variant = entry && entry.variants && Object.prototype.hasOwnProperty.call(entry.variants, build) ? entry.variants[build] : null;
    const priceId = variant && typeof variant.price === "string" ? variant.price : "";
    const weightLb = variant && typeof variant.weightLb === "number" ? variant.weightLb : DEFAULT_WEIGHT_LB;
    const qty = Math.min(Math.max(1, Math.floor(Number(l && l.qty)) || 1), MAX_QTY);
    if (!priceId.startsWith("price_")) return reply({ error: "An item in your cart is unavailable.", item: { id, build } }, 400);
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
    items.push(id + "|" + build + "|" + qty);
    taxLines.push({ amount: lineTotal, reference: (id + "|" + build).slice(0, 64) });
  }
  if (subtotal <= 0) return reply({ error: "Your cart is empty." }, 400);

  // shipping + tax need a US shipping address; before that, charge the subtotal as a placeholder
  let shippingCents = null, taxCents = null, total = subtotal, calcId = "", taxStatus = "";
  if (addr && typeof addr.country === "string" && addr.country !== "US") {
    return reply({ error: "We only ship within the US right now." }, 400);
  }
  // Shipping + tax only once we have a valid US destination: a 2-letter state we recognize
  // plus a 5-digit ZIP. Validating here also stops a malformed address from making the tax
  // API error out and silently fall back to $0 in a state where we DO collect.
  const _state = String((addr && addr.state) || "").toUpperCase();
  const _zip = String((addr && addr.postal_code) || "");
  const haveAddress = !!addr && !!(STATE_CENTROIDS[_state] || NONCONTIGUOUS[_state]) && /^\d{5}(-\d{4})?$/.test(_zip);
  if (haveAddress) {
    shippingCents = computeShippingCents(totalLb, _state);
    const tax = await calculateTax(headers, currency, taxLines, shippingCents, addr);
    if (tax.error) { taxCents = 0; total = subtotal + shippingCents; taxStatus = "calc_failed"; }   // never block checkout on tax infra, but flag it so tax isn't silently $0
    else { taxCents = tax.tax; total = tax.total; calcId = tax.id; }
  }

  const form = new URLSearchParams();
  form.set("amount", String(total));
  form.set("metadata[items]", items.join(";").slice(0, 500));
  form.set("metadata[breakdown]", subtotal + "|" + (shippingCents || 0) + "|" + (taxCents || 0) + "|" + total);   // cents, for the confirmation page receipt
  form.set("metadata[weight]", String(Math.round(totalLb * 10) / 10));   // lb, for the operator's carrier call
  if (calcId) form.set("metadata[tax_calculation]", calcId);   // the webhook records the tax transaction from this
  if (taxStatus) form.set("metadata[tax_status]", taxStatus);   // flags a tax-calc failure so it's visible to the operator, not silently $0
  if (email) form.set("metadata[email]", email);   // our own receipt + order lookup use this; NOT receipt_email, which makes Stripe ALSO send its own receipt
  if (anon) form.set("metadata[anon]", anon);       // first-party visitor id -> joins this order back to its funnel session
  if (src) form.set("metadata[src]", src);          // first-party channel (x / instagram / direct / <go-slug>) for revenue attribution
  // NB: we deliberately do NOT set shipping[...] here. confirmPayment() sets the PI's
  // shipping from the Address Element (publishable key); a secret-key shipping set
  // would then block that client update. The address above is still used for tax.
  const breakdown = { subtotal, shipping: shippingCents, tax: taxCents, total, currency };

  if (piId) {
    const tok = (body && typeof body.updateToken === "string") ? body.updateToken : "";
    if (!tok || !ctEqual(tok, await signPi(piId, env.STRIPE_SECRET_KEY))) return reply({ error: "Could not update checkout." }, 400);   // only the buyer who created this PI may update it
    form.set("metadata[order_no]", piId.replace(/^pi_/, "").slice(0, 10).toUpperCase());   // searchable for the order-lookup page
    const upd = await fetch("https://api.stripe.com/v1/payment_intents/" + piId, { method: "POST", headers, body: form });
    if (!upd.ok) { console.log("payment_intent update failed:", upd.status); return reply({ error: "Could not update checkout." }, 502); }
    return reply({ updated: true, ...breakdown });
  }

  form.set("currency", currency);
  form.set("automatic_payment_methods[enabled]", "true");          // dynamic methods so Apple Pay / Google Pay surface; curate which appear in the Stripe Dashboard
  form.set("automatic_payment_methods[allow_redirects]", "never"); // keep checkout to immediate methods (card + wallets), no redirect/BNPL flows
  form.set("description", "theodore.net store order");
  const res = await fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", headers, body: form });
  if (!res.ok) { console.log("payment_intent failed:", res.status); return reply({ error: "Could not start checkout." }, 502); }
  const pi = await res.json();
  const updateToken = await signPi(pi.id, env.STRIPE_SECRET_KEY);
  return reply({ clientSecret: pi.client_secret, publishableKey: env.STRIPE_PUBLISHABLE_KEY || null, updateToken, ...breakdown });
}
