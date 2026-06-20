// POST /api/checkout  (Cloudflare Pages Function)
// Builds a Stripe hosted Checkout Session from the cart. Prices are never taken
// from the client: each cart line is matched to a Stripe Price id from the
// trusted build catalog (store-catalog.json), and Stripe computes the amounts.
// The secret key comes from env (.dev.vars locally, a Cloudflare secret in
// production), never from the repo.
const MAX_QTY = 99, MAX_LINES = 50;

export async function onRequestPost({ request, env }) {
  const reply = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  if (!env.STRIPE_SECRET_KEY) return reply({ error: "Checkout is not configured yet." }, 500);

  let cart;
  try { cart = (await request.json()).cart; } catch (e) { return reply({ error: "Bad request." }, 400); }
  if (!Array.isArray(cart) || cart.length === 0) return reply({ error: "Your cart is empty." }, 400);
  if (cart.length > MAX_LINES) return reply({ error: "Too many items in your cart." }, 400);

  // trusted product -> variant -> Stripe Price id map, generated from the markdown at build time
  let catalog;
  try { catalog = await fetch(new URL("/store-catalog.json", request.url)).then((r) => r.json()); }
  catch (e) { return reply({ error: "Store catalog unavailable." }, 502); }

  const items = [];
  for (const l of cart) {
    const id = l && typeof l.id === "string" ? l.id : "";
    const build = l && typeof l.build === "string" ? l.build : "";
    const entry = id && Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : null;
    const variant = entry && entry.variants && Object.prototype.hasOwnProperty.call(entry.variants, build) ? entry.variants[build] : null;
    const price = variant && typeof variant.price === "string" ? variant.price : "";
    const qty = Math.min(Math.max(1, Math.floor(Number(l && l.qty)) || 1), MAX_QTY);
    if (!price.startsWith("price_")) return reply({ error: "An item in your cart is unavailable." }, 400);
    items.push([price, qty]);
  }

  const origin = env.SITE_URL || new URL(request.url).origin;
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", origin + "/store/?checkout=success&session_id={CHECKOUT_SESSION_ID}");
  form.set("cancel_url", origin + "/store/?checkout=cancel");
  form.set("shipping_address_collection[allowed_countries][0]", "US");
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
