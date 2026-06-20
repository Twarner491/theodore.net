// POST /api/order-lookup   { orderNo, email }
// Guest order lookup: no accounts. Requires BOTH the order number (a high-entropy
// Stripe id prefix) AND the matching receipt email, so orders can't be enumerated.
// Returns the same sanitized view as /api/order. Never exposes the secret key.
import { orderView } from "../../lib/order-view.js";

export async function onRequestPost({ request, env }) {
  const reply = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  if (!env.STRIPE_SECRET_KEY) return reply({ error: "Not configured." }, 500);
  let body;
  try { body = await request.json(); } catch (e) { return reply({ error: "Bad request." }, 400); }
  const orderNo = (body && typeof body.orderNo === "string" ? body.orderNo : "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const email = (body && typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, 200);
  if (orderNo.length < 10 || email.indexOf("@") < 1) return reply({ error: "Enter your order number and email." }, 400);   // order numbers are 10 chars; reject short brute-force guesses

  // Same generic response whether the order number is wrong OR the email doesn't match,
  // so a guessed order number reveals nothing without the matching email.
  const notFound = () => reply({ error: "We couldn't find an order with that number and email." }, 404);
  let data;
  try {
    const q = encodeURIComponent('metadata["order_no"]:"' + orderNo + '"');
    const res = await fetch("https://api.stripe.com/v1/payment_intents/search?limit=5&expand[]=data.latest_charge&query=" + q, {
      headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY },
    });
    if (!res.ok) { console.log("order search failed:", res.status, await res.text().catch(() => "")); return reply({ error: "Lookup is unavailable. Please try again." }, 502); }
    data = await res.json();
  } catch (e) { return reply({ error: "Lookup is unavailable. Please try again." }, 502); }

  const pi = (data.data || []).find((p) => p.status === "succeeded" && (((p.metadata && p.metadata.email) || p.receipt_email) || "").toLowerCase() === email);
  if (!pi) return notFound();
  return reply(orderView(pi));
}
