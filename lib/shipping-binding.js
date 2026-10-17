import { sha256Hex, strictestShippingProfile, trustedShippingProfile } from "./shipping-profile.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

function canonicalCatalogValue(value, depth = 0) {
  if (depth > 8) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalCatalogValue(item, depth + 1));
    return items.some((item, index) => item === null && value[index] !== null) ? null : items;
  }
  if (!value || typeof value !== "object") return null;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const item = canonicalCatalogValue(value[key], depth + 1);
    if (item === null && value[key] !== null) return null;
    result[key] = item;
  }
  return result;
}

function metadataProfile(profile) {
  return profile || "none";
}

export function createItemManifest(lines) {
  const merged = new Map();
  for (const line of lines) {
    if (!line || !ID.test(line.id || "") || !ID.test(line.build || "") ||
        !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 99) return null;
    const key = line.id + "\u0000" + line.build;
    merged.set(key, { id: line.id, build: line.build, qty: (merged.get(key)?.qty || 0) + line.qty });
  }
  const manifest = { v: 1, lines: [...merged.values()].sort((a, b) =>
    a.id.localeCompare(b.id) || a.build.localeCompare(b.build)).map((line) => [line.id, line.build, line.qty]) };
  if (!manifest.lines.length || manifest.lines.some((line) => line[2] > 99)) return null;
  const json = JSON.stringify(manifest);
  return json.length <= 500 ? { manifest, json } : null;
}

export function parseItemManifest(json) {
  if (typeof json !== "string" || json.length > 500) return null;
  let value;
  try { value = JSON.parse(json); } catch (_) { return null; }
  if (!value || value.v !== 1 || !Array.isArray(value.lines)) return null;
  const created = createItemManifest(value.lines.map((line) => ({
    id: Array.isArray(line) ? line[0] : "",
    build: Array.isArray(line) ? line[1] : "",
    qty: Array.isArray(line) ? line[2] : null,
  })));
  return created && created.json === json ? created : null;
}

export function bindManifestToCatalog(manifest, catalog) {
  if (!manifest || !catalog || typeof catalog !== "object" || Array.isArray(catalog)) return null;
  const lines = [];
  const profiles = [];
  for (const [id, build, qty] of manifest.lines) {
    const entry = Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : null;
    const variants = entry && entry.variants;
    const variant = variants && Object.prototype.hasOwnProperty.call(variants, build) ? variants[build] : null;
    const price = variant && typeof variant.price === "string" && variant.price.startsWith("price_") ? variant.price : "";
    const maxQty = variant && Number.isSafeInteger(variant.maxQty) && variant.maxQty >= 1 && variant.maxQty <= 99 ? variant.maxQty : 1;
    const profile = trustedShippingProfile(variant);
    const title = entry && typeof entry.title === "string" && entry.title ? entry.title : null;
    const catalogVariant = variant && !Array.isArray(variant) ? canonicalCatalogValue(variant) : null;
    if (!price || qty > maxQty || profile === null || !title || !catalogVariant) return null;
    profiles.push(profile);
    // Bind the complete selected catalog variant plus the product title. This
    // automatically covers weight, labels, receipt price, inventory fields, and
    // future fulfillment fields instead of maintaining a fragile partial list.
    lines.push([id, build, qty, title, catalogVariant]);
  }
  const profile = strictestShippingProfile(profiles);
  if (profile === null) return null;
  return { json: JSON.stringify({ v: 1, lines }), profile };
}

export async function createCheckoutBinding(lines, catalog) {
  const created = createItemManifest(lines);
  if (!created) return null;
  const catalogBinding = bindManifestToCatalog(created.manifest, catalog);
  if (!catalogBinding) return null;
  const legacyItems = created.manifest.lines.map((line) => line.join("|")).join(";");
  if (legacyItems.length > 500) return null;
  return {
    manifest: created.manifest,
    manifestJson: created.json,
    manifestSha256: await sha256Hex(created.json),
    catalogSha256: await sha256Hex(catalogBinding.json),
    profile: catalogBinding.profile,
    metadataProfile: metadataProfile(catalogBinding.profile),
    legacyItems,
  };
}

export async function verifyCheckoutBinding(metadata, catalog) {
  const created = parseItemManifest(metadata && metadata.shipping_items);
  if (!created) return null;
  const catalogBinding = bindManifestToCatalog(created.manifest, catalog);
  if (!catalogBinding) return null;
  const manifestSha256 = await sha256Hex(created.json);
  const catalogSha256 = await sha256Hex(catalogBinding.json);
  const legacyItems = created.manifest.lines.map((line) => line.join("|")).join(";");
  if (metadata.shipping_items_sha256 !== manifestSha256 || metadata.shipping_catalog_sha256 !== catalogSha256 ||
      metadata.shipping_profile !== metadataProfile(catalogBinding.profile) || metadata.items !== legacyItems) return null;
  return { manifest: created.manifest, manifestSha256, catalogSha256, profile: catalogBinding.profile, legacyItems };
}

export async function taxAddressBinding({ taxCalculation, addressSha256, manifestSha256, catalogSha256, profile, amount, currency }) {
  return sha256Hex(JSON.stringify({ v: 1, taxCalculation, addressSha256, manifestSha256,
    catalogSha256, profile, amount, currency }));
}
