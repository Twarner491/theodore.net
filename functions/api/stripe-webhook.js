// POST /api/stripe-webhook  (Cloudflare Pages Function)
// Receives Stripe events and verifies the signature against STRIPE_WEBHOOK_SECRET
// before trusting anything, so forged "payment succeeded" calls are rejected.
// On a completed checkout it runs fulfillment (for now, logs the paid order).
// The signing secret comes from env (.dev.vars locally, a Cloudflare secret in
// production), never from the repo.
const TOLERANCE = 300; // seconds; rejects replayed or stale events

export async function onRequestPost({ request, env }) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 500 });

  const sig = request.headers.get("stripe-signature") || "";
  const body = await request.text(); // raw body is required for signature verification
  const event = await verify(body, sig, secret);
  if (!event) return new Response("invalid signature", { status: 400 });

  if (event.type === "checkout.session.completed") {
    const s = event.data && event.data.object ? event.data.object : {};
    // fulfillment hook: email / dashboard / store record goes here later
    console.log("paid:", s.id, s.amount_total, s.currency, s.customer_details && s.customer_details.email);
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "content-type": "application/json" } });
}

async function verify(body, header, secret) {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = (parts.find((p) => p[0] === "t") || [])[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || sigs.length === 0) return null;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE) return null;

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
