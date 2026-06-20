// Sanitized, customer-safe view of a Stripe PaymentIntent for the confirmation +
// order-lookup pages. Never includes the client_secret or anything sensitive.
export function orderView(pi) {
  const m = pi.metadata || {};
  const items = (m.items ? String(m.items).split(";") : [])
    .map((s) => { const a = s.split("|"); return { id: a[0], build: a[1], qty: Number(a[2]) || 1 }; })
    .filter((i) => i.id);
  const b = m.breakdown ? String(m.breakdown).split("|").map(Number) : [];
  const breakdown = b.length === 4 ? { subtotal: b[0], shipping: b[1], tax: b[2], total: b[3] } : null;
  const ship = pi.shipping || {};
  const card = pi.latest_charge && pi.latest_charge.payment_method_details && pi.latest_charge.payment_method_details.card;
  return {
    status: pi.status,                                   // Stripe status ("succeeded")
    orderNo: String(pi.id).replace(/^pi_/, "").slice(0, 10).toUpperCase(),
    amount: pi.amount,
    currency: pi.currency,
    email: (pi.metadata && pi.metadata.email) || pi.receipt_email || null,
    items,
    breakdown,
    shipping: ship.address ? { name: ship.name || "", address: ship.address } : null,
    payment: card ? { brand: card.brand || null, last4: card.last4 || null } : null,
    fulfillment: m.fulfillment || "new",                 // "new" | "shipped"
    carrier: m.carrier || null,
    tracking: m.tracking || null,
    shippedAt: m.shipped_at ? Number(m.shipped_at) : null,
  };
}
