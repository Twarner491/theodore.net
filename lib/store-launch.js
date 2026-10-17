// Timed drops. hooks/store_products.py copies a variant's validated `launchAt` (ISO 8601 UTC)
// into store-catalog.json; checkout refuses the variant until that instant, so a sellable drop
// can be deployed ahead of time and opens by itself. The server clock is the authority (the
// storefront countdown is only a display). A present but unreadable value never opens.
export function launchPending(variant, now = Date.now()) {
  if (!variant || variant.launchAt == null) return false;
  const at = typeof variant.launchAt === "string" ? Date.parse(variant.launchAt) : NaN;
  return !Number.isFinite(at) || now < at;
}
