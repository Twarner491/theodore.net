// POST /api/stripe-webhook  (Cloudflare Pages Function)
// Receives Stripe events and verifies the signature against STRIPE_WEBHOOK_SECRET
// before trusting anything, so forged "payment succeeded" calls are rejected.
// On a completed checkout it runs fulfillment (for now, logs the paid order).
// The signing secret comes from env (.dev.vars locally, a Cloudflare secret in
// production), never from the repo.
import { buildOrder, receiptHtml, operatorHtml, sendEmail } from "../../lib/emails.js";
const TOLERANCE = 300; // seconds; rejects replayed or stale events

export async function onRequestPost({ request, env }) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 500 });

  const sig = request.headers.get("stripe-signature") || "";
  const body = await request.text(); // raw body is required for signature verification
  const event = await verify(body, sig, secret);
  if (!event) return new Response("invalid signature", { status: 400 });

  // fulfillment hooks (email / dashboard / store record go here later)
  if (event.type === "payment_intent.succeeded") {
    const pi = (event.data && event.data.object) || {};
    const ship = pi.shipping || {};
    console.log("paid:", pi.id, pi.amount, pi.currency, "| items:", pi.metadata && pi.metadata.items, "| ship:", ship.name);
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
      const catalog = await fetch(new URL("/store-catalog.json", request.url)).then((r) => r.json()).catch(() => ({}));
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
    console.log("paid (hosted):", s.id, s.amount_total, s.currency, s.customer_details && s.customer_details.email);
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
