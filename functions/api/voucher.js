import { createCheckoutBinding } from "../../lib/shipping-binding.js";
import { resolveVoucher, voucherReply, VOUCHER_LABEL, VoucherUnavailableError } from "../../lib/store-vouchers.js";

export async function onRequestPost({ request, env }) {
  const reply = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
  let body;
  try { body = await request.json(); } catch (_) { return reply({ error: "Bad request." }, 400); }
  if (!body || !Array.isArray(body.cart) || !body.cart.length || body.cart.length > 50) return reply({ error: "Your cart is empty." }, 400);
  try {
    const response = await fetch(new URL("/store-catalog.json", request.url));
    if (!response.ok) throw new Error("catalog unavailable");
    const catalog = await response.json();
    const binding = await createCheckoutBinding(body.cart.map((line) => ({
      id: line && line.id, build: line && line.build, qty: Number(line && line.qty),
    })), catalog);
    if (!binding) throw new VoucherUnavailableError();
    const voucher = await resolveVoucher(env, body.voucherCode, binding.manifest, catalog);
    return reply({ discount: voucher ? voucher.amount_off : 0, discountLabel: voucher ? VOUCHER_LABEL : "" });
  } catch (error) { return voucherReply(error, reply); }
}
