// POST /api/order   { pi, cs }
// Sanitized order details for the confirmation page. The caller must hold the
// PaymentIntent's client_secret (Stripe hands it to the buyer on redirect). POST (not
// GET) keeps the secret out of URLs/referrers/logs. Read-only; never exposes the key.
import { orderView } from "../../lib/order-view.js";

function ctEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequestPost({ request, env }) {
  const reply = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  if (!env.STRIPE_SECRET_KEY) return reply({ error: "Not configured." }, 500);
  let body;
  try { body = await request.json(); } catch (e) { return reply({ error: "Bad request." }, 400); }
  const pi = body && typeof body.pi === "string" ? body.pi : "";
  const cs = body && typeof body.cs === "string" ? body.cs : "";
  if (!pi.startsWith("pi_")) return reply({ error: "Bad request." }, 400);

  // Identical 404 for a missing PI or a wrong secret, so a guessed pi_ id reveals nothing.
  const notFound = () => reply({ error: "Order not found." }, 404);
  const down = () => reply({ error: "We couldn't load your order right now. Please try again in a minute." }, 502);
  let res;
  try {
    res = await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(pi) + "?expand[]=latest_charge", {
      headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY },
    });
  } catch (e) { return down(); }
  if (res.status === 404) return notFound();           // genuinely no such order
  if (!res.ok) { console.log("order fetch failed:", res.status); return down(); }   // Stripe down: don't tell a paying customer "not found"
  const p = await res.json();
  if (!ctEqual(cs, p.client_secret || "")) return notFound();
  return reply(orderView(p));
}
