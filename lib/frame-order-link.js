import { sha256Hex } from "./shipping-profile.js";

export async function readFrameOrderLink(env, token, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const db = env.STORE_INVENTORY.withSession("first-primary");
  const row = await db.prepare("SELECT quantity, max_quantity, expires_at FROM frame_order_links WHERE token_hash=? AND expires_at>?")
    .bind(await sha256Hex(token), now).first();
  if (!row || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 99 ||
      !Number.isSafeInteger(row.expires_at) || row.expires_at <= now) return null;
  const maxQuantity = row.max_quantity ?? row.quantity;
  if (!Number.isSafeInteger(maxQuantity) || maxQuantity < row.quantity || maxQuantity > 99) return null;
  return { quantity: row.quantity, maxQuantity, expiresAt: row.expires_at };
}
