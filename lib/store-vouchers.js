import { sha256Hex } from "./shipping-profile.js";
import { launchPending } from "./store-launch.js";
import { normalizeInventoryDemand, readInventoryAvailability } from "./store-inventory.js";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const VOUCHER_LABEL = "Friends and family";
export const isVoucherQuotaSku = (sku) => typeof sku === "string" && sku.startsWith("voucher-");

export class VoucherUnavailableError extends Error {
  constructor() { super("That code is not available for this order."); this.code = "discount_unavailable"; }
}
export class VoucherConfigurationError extends Error {
  constructor() { super("Discount availability could not be confirmed. Please try again."); this.code = "discount_unavailable_temporarily"; }
}

async function voucherRow(env, field, value) {
  const binding = env && env.STORE_INVENTORY;
  if (!binding || typeof binding.prepare !== "function") throw new VoucherConfigurationError();
  const db = typeof binding.withSession === "function" ? binding.withSession("first-primary") : binding;
  let result;
  try {
    result = await db.prepare(`SELECT id, amount_off, product_id, build_id, quota_sku, expires_at, active
      FROM store_vouchers WHERE ${field} = ? LIMIT 2`).bind(value).all();
  } catch (_) { throw new VoucherConfigurationError(); }
  if (!result || result.success !== true || !Array.isArray(result.results) || result.results.length > 1) throw new VoucherConfigurationError();
  if (!result.results.length) throw new VoucherUnavailableError();
  const row = result.results[0];
  if (!ID_RE.test(row.id || "") || !ID_RE.test(row.product_id || "") || !ID_RE.test(row.build_id || "") ||
      !ID_RE.test(row.quota_sku || "") || !isVoucherQuotaSku(row.quota_sku) ||
      !Number.isSafeInteger(row.amount_off) || row.amount_off <= 0 ||
      !Number.isSafeInteger(row.expires_at) || row.expires_at <= 0 || ![0, 1].includes(row.active)) throw new VoucherConfigurationError();
  return row;
}

function eligibleVoucher(row, manifest, catalog, historical = false) {
  // Carry the existing friends-and-family campaign onto the same assembled
  // product's continuous offering. Campaign terms and its shared quota stay intact.
  const continuousCampaign = row.id === "avian-holidays-2026" && row.product_id === "avian-visitors" &&
    row.build_id === "assembled-batch-2" && row.quota_sku === "voucher-avian-holidays-2026" && row.amount_off === 10000;
  const line = manifest && Array.isArray(manifest.lines) && manifest.lines.find((item) =>
    item[0] === row.product_id && (item[1] === row.build_id || (continuousCampaign && item[1] === "assembled-continuous")) &&
      Number.isSafeInteger(item[2]) && item[2] >= 1);
  const product = catalog && Object.prototype.hasOwnProperty.call(catalog, row.product_id) ? catalog[row.product_id] : null;
  const variant = line && product && product.variants && Object.prototype.hasOwnProperty.call(product.variants, line[1])
    ? product.variants[line[1]] : null;
  const continuous = line && continuousCampaign && line[1] === "assembled-continuous";
  const inventoryValid = variant && (continuous
    ? variant.productionBatchGroup === "avian-visitors" && !variant.inventorySku
    : ID_RE.test(variant.inventorySku || "") && !isVoucherQuotaSku(variant.inventorySku));
  if (!line || !variant || variant.shippingProfile !== "contiguous-us-ground" || !inventoryValid ||
      (!historical && (launchPending(variant) || (Array.isArray(product.retiredBuilds) && product.retiredBuilds.includes(line[1])))))
    throw new VoucherUnavailableError();
  return { ...row, matched_build_id: line[1] };
}

export async function resolveVoucher(env, code, manifest, catalog, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (code == null || code === "") return null;
  if (typeof code !== "string" || code.length > 128) throw new VoucherUnavailableError();
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z0-9-]{8,128}$/.test(normalized)) throw new VoucherUnavailableError();
  const row = eligibleVoucher(await voucherRow(env, "code_sha256", await sha256Hex(normalized)), manifest, catalog);
  if (row.active !== 1 || !Number.isSafeInteger(now) || now >= row.expires_at) throw new VoucherUnavailableError();
  try {
    const [quota] = await readInventoryAvailability(env, [row.quota_sku]);
    if (quota.available < 1) throw new VoucherUnavailableError();
  } catch (error) {
    if (error instanceof VoucherUnavailableError) throw error;
    throw new VoucherConfigurationError();
  }
  return row;
}

// Historical callbacks depend on immutable campaign terms, not today's enabled/expired state.
export async function voucherFromMetadata(env, metadata, manifest, catalog) {
  const id = metadata && metadata.voucher_campaign;
  const discount = metadata && metadata.voucher_discount;
  if (!id && !discount) return null;
  if (!ID_RE.test(id || "") || typeof discount !== "string") throw new VoucherUnavailableError();
  const row = eligibleVoucher(await voucherRow(env, "id", id), manifest, catalog, true);
  if (discount !== String(row.amount_off)) throw new VoucherUnavailableError();
  return row;
}

export function voucherInventoryDemand(demand, voucher) {
  return voucher ? normalizeInventoryDemand(demand.concat({ sku: voucher.quota_sku, quantity: 1 })) : demand;
}

export function voucherReply(error, reply) {
  return error instanceof VoucherUnavailableError
    ? reply({ error: error.message, code: error.code }, 409)
    : reply({ error: "Discount availability could not be confirmed. Please try again.", code: "discount_unavailable_temporarily" }, 503);
}
