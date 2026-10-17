import { sha256Hex } from "./shipping-profile.js";
import { normalizeInventoryDemand } from "./store-inventory.js";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const PI_RE = /^pi_[A-Za-z0-9_]{1,252}$/;
const SKU_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export const INVENTORY_METADATA_KEYS = Object.freeze([
  "inventory_state",
  "inventory_demand",
  "inventory_demand_sha256",
  "inventory_binding_sha256",
]);

export class InventoryCommerceError extends Error {
  constructor(message = "Finite-inventory checkout binding is invalid.") {
    super(message);
    this.name = "InventoryCommerceError";
    this.code = "inventory_commerce_invalid";
  }
}

function catalogVariant(catalog, id, build) {
  const entry = catalog && typeof catalog === "object" && !Array.isArray(catalog) &&
    Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : null;
  const variants = entry && entry.variants;
  return variants && Object.prototype.hasOwnProperty.call(variants, build) ? variants[build] : null;
}

export function inventoryDemandFromManifest(manifest, catalog) {
  if (!manifest || manifest.v !== 1 || !Array.isArray(manifest.lines) || !manifest.lines.length) {
    throw new InventoryCommerceError("Inventory demand requires a canonical checkout manifest.");
  }
  const raw = [];
  for (const line of manifest.lines) {
    if (!Array.isArray(line) || line.length !== 3 || !ID_RE.test(line[0] || "") ||
        !ID_RE.test(line[1] || "") || !Number.isSafeInteger(line[2]) || line[2] < 1 || line[2] > 99) {
      throw new InventoryCommerceError("Checkout manifest contains an invalid line.");
    }
    const variant = catalogVariant(catalog, line[0], line[1]);
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      throw new InventoryCommerceError("Checkout manifest is absent from the trusted catalog.");
    }
    if (!Object.prototype.hasOwnProperty.call(variant, "inventorySku")) continue;
    if (!SKU_RE.test(variant.inventorySku || "") || variant.shippingProfile !== "contiguous-us-ground") {
      throw new InventoryCommerceError("Finite inventory requires a valid SKU and manual-capture shipping profile.");
    }
    raw.push({ sku: variant.inventorySku, quantity: line[2] });
  }
  return raw.length ? normalizeInventoryDemand(raw) : [];
}

export function inventoryDemandJson(input) {
  const demand = normalizeInventoryDemand(input);
  return JSON.stringify({ v: 1, lines: demand.map((line) => [line.sku, line.quantity]) });
}

export function parseInventoryDemandJson(value) {
  if (typeof value !== "string" || value.length > 500) throw new InventoryCommerceError();
  let parsed;
  try { parsed = JSON.parse(value); } catch (error) { throw new InventoryCommerceError(); }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.lines)) throw new InventoryCommerceError();
  let demand;
  try {
    demand = normalizeInventoryDemand(parsed.lines.map((line) => ({
      sku: Array.isArray(line) ? line[0] : "",
      quantity: Array.isArray(line) ? line[1] : null,
    })));
  } catch (error) {
    throw new InventoryCommerceError();
  }
  if (inventoryDemandJson(demand) !== value) throw new InventoryCommerceError("Inventory demand is not canonical.");
  return demand;
}

export function inventoryDemandScope(demand) {
  return demand.length ? inventoryDemandJson(demand) : "none";
}

export async function createInventoryCommerceBinding({
  paymentIntentId, amount, currency, manifestSha256, catalogSha256, demand,
}) {
  if (!PI_RE.test(paymentIntentId || "") || !Number.isSafeInteger(amount) || amount < 1 ||
      !/^[a-z]{3}$/.test(currency || "") || !SHA256_RE.test(manifestSha256 || "") ||
      !SHA256_RE.test(catalogSha256 || "")) throw new InventoryCommerceError();
  const demandJson = inventoryDemandJson(demand);
  const normalizedDemand = parseInventoryDemandJson(demandJson);
  const demandSha256 = await sha256Hex(demandJson);
  const bindingJson = JSON.stringify({
    v: 1,
    paymentIntentId,
    amount,
    currency,
    manifestSha256,
    catalogSha256,
    demandSha256,
  });
  const bindingSha256 = await sha256Hex(bindingJson);
  return Object.freeze({
    paymentIntentId, amount, currency, manifestSha256, catalogSha256,
    demand: normalizedDemand, demandJson, demandSha256, bindingSha256,
  });
}

export function applyPendingInventoryMetadata(form, demand) {
  const demandJson = inventoryDemandJson(demand);
  form.set("metadata[inventory_state]", "pending");
  form.set("metadata[inventory_demand]", demandJson);
  return sha256Hex(demandJson).then((digest) => {
    form.set("metadata[inventory_demand_sha256]", digest);
    form.set("metadata[inventory_binding_sha256]", "");
    return digest;
  });
}

export function applyBoundInventoryMetadata(form, binding) {
  form.set("metadata[inventory_state]", "bound");
  form.set("metadata[inventory_demand]", binding.demandJson);
  form.set("metadata[inventory_demand_sha256]", binding.demandSha256);
  form.set("metadata[inventory_binding_sha256]", binding.bindingSha256);
}

export function clearInventoryMetadata(form) {
  for (const key of INVENTORY_METADATA_KEYS) form.set("metadata[" + key + "]", "");
}

export function inventoryMetadataState(metadata) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const present = INVENTORY_METADATA_KEYS.some((key) => typeof source[key] === "string" && source[key] !== "");
  if (!present) return "none";
  return source.inventory_state === "pending" || source.inventory_state === "bound"
    ? source.inventory_state : "invalid";
}

export async function verifyBoundInventoryMetadata(paymentIntent) {
  const metadata = paymentIntent && paymentIntent.metadata;
  if (inventoryMetadataState(metadata) !== "bound") throw new InventoryCommerceError();
  const demand = parseInventoryDemandJson(metadata.inventory_demand);
  const binding = await createInventoryCommerceBinding({
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    manifestSha256: metadata.shipping_items_sha256,
    catalogSha256: metadata.shipping_catalog_sha256,
    demand,
  });
  if (metadata.inventory_demand_sha256 !== binding.demandSha256 ||
      metadata.inventory_binding_sha256 !== binding.bindingSha256) throw new InventoryCommerceError();
  return binding;
}

export async function verifyCurrentInventoryBinding(paymentIntent, checkoutBinding, catalog) {
  const demand = inventoryDemandFromManifest(checkoutBinding.manifest, catalog);
  const state = inventoryMetadataState(paymentIntent && paymentIntent.metadata);
  if (!demand.length) {
    if (state !== "none") throw new InventoryCommerceError("Ordinary checkout has unexpected inventory metadata.");
    return null;
  }
  const binding = await verifyBoundInventoryMetadata(paymentIntent);
  if (binding.manifestSha256 !== checkoutBinding.manifestSha256 ||
      binding.catalogSha256 !== checkoutBinding.catalogSha256 ||
      inventoryDemandJson(binding.demand) !== inventoryDemandJson(demand)) throw new InventoryCommerceError();
  return binding;
}

