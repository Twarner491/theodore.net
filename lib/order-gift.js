// Gift details travel with the order, never with analytics or recovery events.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
export const GIFT_FROM_LIMIT = 80;

export function parseGiftInput(body = {}) {
  const value = body && body.gift;
  if (value !== undefined && typeof value !== "boolean") throw new Error("Choose whether this is a gift.");
  if (value !== true) return { gift: false, giftFrom: "" };
  const raw = body.giftFrom === undefined ? "" : body.giftFrom;
  if (typeof raw !== "string" || CONTROL.test(raw)) throw new Error("Enter the sender names on one line.");
  const giftFrom = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (Array.from(giftFrom).length > GIFT_FROM_LIMIT) throw new Error("Use 80 characters or fewer for the sender names.");
  return { gift: true, giftFrom };
}

export function orderGift(metadata = {}) {
  if (!metadata || metadata.gift !== "1") return { gift: false, giftFrom: "" };
  try { return parseGiftInput({ gift: true, giftFrom: metadata.gift_from }); }
  catch (_) { return { gift: true, giftFrom: "" }; }
}
