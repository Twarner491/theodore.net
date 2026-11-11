// Immutable allocations recorded only after verified payment. Catalog labels may
// describe today's offer; an order's accepted production runs must not change.
export const CONTINUOUS_FRAME_BUILD = "assembled-continuous";
export const PRODUCTION_BATCH_METADATA = "production_batches";
export const PRODUCTION_PAID_AT_METADATA = "production_paid_at";

export function productionBatchesForItem(metadata, item) {
  if (!item || item.id !== "avian-visitors" || item.build !== CONTINUOUS_FRAME_BUILD ||
      !Number.isSafeInteger(item.qty) || item.qty < 1) return [];
  let parsed;
  try { parsed = JSON.parse(metadata && metadata[PRODUCTION_BATCH_METADATA]); } catch (_) { return []; }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.lines)) return [];
  const matches = parsed.lines.filter((line) => Array.isArray(line) && line[0] === item.id && line[1] === item.build);
  if (matches.length !== 1 || matches[0].length !== 3 || !Array.isArray(matches[0][2]) || !matches[0][2].length) return [];
  const allocations = [], ordinals = new Set();
  for (const allocation of matches[0][2]) {
    if (!Array.isArray(allocation) || allocation.length !== 2) return [];
    const [ordinal, quantity] = allocation;
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || ordinals.has(ordinal)) return [];
    ordinals.add(ordinal); allocations.push({ ordinal, label: "Batch " + ordinal, quantity });
  }
  return allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) === item.qty ? allocations : [];
}

export function productionBatchLabel(label, allocations) {
  if (!allocations.length) return label;
  return label + " (" + allocations.map((allocation) => allocation.label +
    (allocations.length > 1 ? " × " + allocation.quantity : "")).join(", ") + ")";
}
