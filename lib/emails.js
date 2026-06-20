// Order emails via Resend, styled to match theodore.net, sent from store@theodore.net.
// Pure builders: the caller resolves the order data and passes it in. Imported by the
// webhook (receipt + operator) and the ops endpoint (shipped). No-op without RESEND_API_KEY.

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(cents) {
  return "$" + (Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function carrierFor(weightLb) {
  return Number(weightLb) > 5 ? "UPS Ground" : "USPS Ground Advantage";   // all kits are light; USPS is cheapest + tracked
}

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SERIF = "'Crimson Pro', Georgia, 'Times New Roman', serif";

function layout(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;background:#ffffff;"><div style="background:#ffffff;padding:34px 16px;font-family:${MONO};color:#1b1b1f;-webkit-font-smoothing:antialiased;">` +
      `<div style="max-width:480px;margin:0 auto;">` +
        `<div style="font-family:${SERIF};font-size:19px;letter-spacing:-0.01em;margin:0 0 30px;">theodore.net</div>` +
        inner +
        `<div style="margin-top:38px;padding-top:18px;border-top:1px solid #ececec;font-size:11px;color:#9a9a9a;line-height:1.7;">theodore.net store. Questions? <a href="mailto:support@theodore.net" style="color:#9a9a9a;">support@theodore.net</a></div>` +
      `</div></div></body></html>`;
}

function addressBlock(s) {
  const a = (s && s.address) || {};
  const lines = [s && s.name, a.line1, a.line2, ((a.city ? a.city + ", " : "") + (a.state || "") + " " + (a.postal_code || "")).trim()].filter(Boolean).map(esc);
  return `<div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#9a9a9a;margin:0 0 7px;">Shipping to</div>` +
    `<div style="font-size:13px;line-height:1.7;">${lines.join("<br>")}</div>`;
}

// Resolve an order object from a Stripe PaymentIntent + the trusted catalog (titles, labels, prices).
export function buildOrder(pi, catalog) {
  const meta = pi.metadata || {};
  const items = (meta.items ? String(meta.items).split(";") : []).map((s) => {
    const a = s.split("|"), id = a[0], build = a[1], qty = Number(a[2]) || 1;
    const entry = catalog && catalog[id], v = entry && entry.variants && entry.variants[build];
    const unit = v && typeof v.priceUsd === "number" ? v.priceUsd : 0;
    return { id, build, qty, title: entry ? entry.title : id, label: v ? v.label : build, lineTotal: Math.round(unit * qty * 100) };
  }).filter((i) => i.id);
  const b = meta.breakdown ? String(meta.breakdown).split("|").map(Number) : [];
  const breakdown = b.length === 4 ? { subtotal: b[0], shipping: b[1], tax: b[2], total: b[3] } : { subtotal: null, shipping: null, tax: null, total: pi.amount };
  const ship = pi.shipping || {};
  return {
    id: pi.id,
    orderNo: String(pi.id).replace(/^pi_/, "").slice(0, 10).toUpperCase(),
    email: pi.receipt_email || null,
    items, breakdown,
    weight: meta.weight ? Number(meta.weight) : null,
    shipping: ship.address ? { name: ship.name || "", address: ship.address } : null,
  };
}

export function receiptHtml(o) {
  const b = o.breakdown || {};
  const items = o.items.map((i) =>
    `<tr><td style="padding:9px 0;font-size:13px;border-bottom:1px solid #f3f3f3;">${esc(i.title)} <span style="color:#8a8a8a;">${esc(i.label)}${i.qty > 1 ? " &times; " + i.qty : ""}</span></td>` +
    `<td style="padding:9px 0;font-size:13px;text-align:right;white-space:nowrap;border-bottom:1px solid #f3f3f3;">${money(i.lineTotal)}</td></tr>`).join("");
  const sub = (l, v) => `<tr><td style="padding:5px 0;font-size:13px;color:#8a8a8a;">${l}</td><td style="padding:5px 0;font-size:13px;text-align:right;color:#8a8a8a;">${v}</td></tr>`;
  const totals =
    (b.subtotal != null ? sub("Subtotal", money(b.subtotal)) : "") +
    (b.tax != null ? sub("Sales tax", money(b.tax)) : "") +
    (b.shipping != null ? sub("Shipping", b.shipping === 0 ? "Free" : money(b.shipping)) : "");
  const total = `<tr><td style="padding:13px 0 0;font-size:14px;font-weight:600;border-top:1px solid #ececec;">Total</td><td style="padding:13px 0 0;font-size:14px;font-weight:600;text-align:right;border-top:1px solid #ececec;">${money(b.total)}</td></tr>`;
  return layout(
    `<div style="font-family:${SERIF};font-size:25px;margin:0 0 4px;">Order confirmed</div>` +
    `<div style="font-size:12px;color:#9a9a9a;margin:0 0 22px;">Order #${esc(o.orderNo)}</div>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${items}<tr><td colspan="2" style="height:12px;"></td></tr>${totals}${total}</table>` +
    (o.shipping ? `<div style="margin-top:26px;">${addressBlock(o.shipping)}</div>` : "") +
    `<div style="margin-top:18px;font-size:12px;color:#8a8a8a;line-height:1.7;">Made to order. Allow about a week to build and ship, plus a few days in transit. You'll get a tracking link by email.</div>`
  );
}

export function shippedHtml(o, ship) {
  ship = ship || {};
  const track = ship.trackingUrl ? `<a href="${esc(ship.trackingUrl)}" style="color:#1b1b1f;">${esc(ship.tracking)}</a>` : esc(ship.tracking || "");
  return layout(
    `<div style="font-family:${SERIF};font-size:25px;margin:0 0 4px;">Your order shipped</div>` +
    `<div style="font-size:12px;color:#9a9a9a;margin:0 0 22px;">Order #${esc(o.orderNo)}</div>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">` +
      `<tr><td style="padding:6px 0;color:#8a8a8a;width:90px;">Carrier</td><td style="padding:6px 0;">${esc(ship.carrier || "")}</td></tr>` +
      `<tr><td style="padding:6px 0;color:#8a8a8a;">Tracking</td><td style="padding:6px 0;">${track}</td></tr>` +
    `</table>` +
    (o.shipping ? `<div style="margin-top:24px;">${addressBlock(o.shipping)}</div>` : "") +
    `<div style="margin-top:18px;font-size:12px;color:#8a8a8a;line-height:1.7;">Thank you for your order!</div>`
  );
}

export function operatorHtml(o, opts) {
  opts = opts || {};
  const items = o.items.map((i) =>
    `<tr><td style="padding:7px 0;font-size:13px;border-bottom:1px solid #f3f3f3;">${esc(i.title)} <span style="color:#8a8a8a;">${esc(i.label)}</span></td>` +
    `<td style="padding:7px 0;font-size:13px;text-align:right;border-bottom:1px solid #f3f3f3;">&times; ${i.qty}</td></tr>`).join("");
  return layout(
    `<div style="font-family:${SERIF};font-size:25px;margin:0 0 4px;">New order</div>` +
    `<div style="font-size:12px;color:#9a9a9a;margin:0 0 24px;">Order #${esc(o.orderNo)} &middot; ${money(o.breakdown.total)} paid</div>` +
    `<div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#9a9a9a;margin:0 0 7px;">Assemble and pack</div>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">${items}</table>` +
    (o.shipping ? `${addressBlock(o.shipping)}<div style="height:24px;"></div>` : "") +
    `<div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#9a9a9a;margin:0 0 7px;">Ship</div>` +
    `<div style="font-size:13px;line-height:1.8;">${o.weight ? esc(o.weight) + " lb &middot; " : ""}Recommend ${esc(carrierFor(o.weight || 0))}</div>` +
    (o.email ? `<div style="margin-top:16px;font-size:12px;color:#8a8a8a;">Customer ${esc(o.email)}</div>` : "") +
    (opts.opsUrl ? `<div style="margin-top:24px;"><a href="${esc(opts.opsUrl)}" style="display:inline-block;background:#1b1b1f;color:#ffffff;text-decoration:none;font-size:13px;padding:11px 22px;border-radius:10px;">Open dashboard</a></div>` : "")
  );
}

export async function sendEmail(env, msg) {
  if (!env.RESEND_API_KEY) { console.log("email skipped (no RESEND_API_KEY):", msg.subject); return { skipped: true }; }
  const from = "theodore.net <" + (env.STORE_FROM_EMAIL || "store@theodore.net") + ">";
  const body = { from, to: Array.isArray(msg.to) ? msg.to : [msg.to], subject: msg.subject, html: msg.html };
  if (msg.replyTo) body.reply_to = msg.replyTo;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.log("email send failed:", res.status, await res.text().catch(() => "")); return { ok: false, status: res.status }; }
  return { ok: true };
}
