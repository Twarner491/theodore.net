const SKU_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PI_RE = /^pi_[A-Za-z0-9_]{1,252}$/;
const CURRENCY_RE = /^[a-z]{3}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const STATUSES = new Set(["active", "expiring", "sold", "released"]);
const EXPECTED_SCHEMA_SHA256 = "18857849686a5bc2ca02d766207837a6532abcdb335500a47a63f303e7f05e1b";
const SEED = Object.freeze({ sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01", capacity: 20 });
const VERIFIED_PROVIDER_EVIDENCE = new WeakSet();

export const INVENTORY_EXPIRY_POLICY = Object.freeze({
  defaultHoldSeconds: 30 * 60,
  minimumHoldSeconds: 5 * 60,
  maximumHoldSeconds: 24 * 60 * 60,
  providerEvidenceMaxAgeSeconds: 5 * 60,
  reclaimRequiresProviderOutcome: "canceled",
});

export class InventoryBindingError extends Error {
  constructor(message = "Finite inventory is not configured.") {
    super(message); this.name = "InventoryBindingError"; this.code = "inventory_binding_missing";
  }
}
export class InventoryConfigurationError extends Error {
  constructor(message = "Finite inventory is misconfigured.") {
    super(message); this.name = "InventoryConfigurationError"; this.code = "inventory_configuration_error";
  }
}
export class InventoryProtocolError extends InventoryConfigurationError {
  constructor(message = "D1 returned an invalid inventory result.") {
    super(message); this.name = "InventoryProtocolError"; this.code = "inventory_protocol_error";
  }
}
export class InventorySoldOutError extends Error {
  constructor(message = "The requested quantity is no longer available.") {
    super(message); this.name = "InventorySoldOutError"; this.code = "inventory_sold_out";
  }
}
export class InventoryStateError extends Error {
  constructor(message = "The inventory reservation is in a conflicting state.") {
    super(message); this.name = "InventoryStateError"; this.code = "inventory_state_conflict";
  }
}
export class InventoryExpiredError extends InventoryStateError {
  constructor(message = "The inventory reservation has expired.") {
    super(message); this.name = "InventoryExpiredError"; this.code = "inventory_expired";
  }
}
export class InventoryCancellationRequiredError extends InventoryStateError {
  constructor(message = "Expired inventory can be reclaimed only after the PaymentIntent is confirmed canceled.") {
    super(message); this.name = "InventoryCancellationRequiredError"; this.code = "inventory_cancellation_required";
  }
}
export class InventoryEvidenceError extends InventoryStateError {
  constructor(message = "Authenticated and fresh payment-provider evidence is required.") {
    super(message); this.name = "InventoryEvidenceError"; this.code = "inventory_evidence_invalid";
  }
}

export function requireInventoryBinding(env) {
  const db = env && env.STORE_INVENTORY;
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function" || typeof db.withSession !== "function") {
    throw new InventoryBindingError();
  }
  return db;
}

export function normalizeInventoryDemand(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new InventoryConfigurationError("A finite-inventory reservation must contain at least one line.");
  }
  const quantities = new Map();
  for (const line of input) {
    const sku = line && typeof line.sku === "string" ? line.sku : "";
    const quantity = line && line.quantity;
    if (!SKU_RE.test(sku) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new InventoryConfigurationError("Inventory demand contains an invalid SKU or quantity.");
    }
    const total = (quantities.get(sku) || 0) + quantity;
    if (!Number.isSafeInteger(total) || total > 99) {
      throw new InventoryConfigurationError("Inventory demand exceeds the per-order limit.");
    }
    quantities.set(sku, total);
  }
  return [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([sku, quantity]) => ({ sku, quantity }));
}

export function normalizeInventoryCommerceBinding(input) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Number.isSafeInteger(input.amount) || input.amount < 1 || !CURRENCY_RE.test(input.currency || "") ||
      !SHA256_RE.test(input.manifestSha256 || "") || !SHA256_RE.test(input.catalogSha256 || "") ||
      !SHA256_RE.test(input.demandSha256 || "") || !SHA256_RE.test(input.bindingSha256 || "")) {
    throw new InventoryConfigurationError("Inventory commerce binding is invalid.");
  }
  return Object.freeze({
    amount: input.amount,
    currency: input.currency,
    manifestSha256: input.manifestSha256,
    catalogSha256: input.catalogSha256,
    demandSha256: input.demandSha256,
    bindingSha256: input.bindingSha256,
  });
}

function sameCommerceBinding(left, right) {
  if (!left || !right) return left === right;
  return left.amount === right.amount && left.currency === right.currency &&
    left.manifestSha256 === right.manifestSha256 && left.catalogSha256 === right.catalogSha256 &&
    left.demandSha256 === right.demandSha256 && left.bindingSha256 === right.bindingSha256;
}

function requireSnapshotBinding(snapshot, input) {
  const expected = normalizeInventoryCommerceBinding(input);
  if (!sameCommerceBinding(snapshot.commerceBinding, expected)) {
    throw new InventoryStateError("Inventory commerce binding does not match the reservation.");
  }
  return expected;
}

function validatePi(paymentIntentId) {
  if (!PI_RE.test(paymentIntentId || "")) throw new InventoryConfigurationError("Inventory reservations require a valid PaymentIntent ID.");
}
function resolveNow(options) {
  if (!options || options.now === undefined) return Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(options.now) || options.now < 0) throw new InventoryConfigurationError("Inventory time must be a non-negative integer Unix timestamp.");
  return options.now;
}
function resolveHoldSeconds(options, now) {
  const value = !options || options.holdSeconds === undefined ? INVENTORY_EXPIRY_POLICY.defaultHoldSeconds : options.holdSeconds;
  if (!Number.isSafeInteger(value) || value < INVENTORY_EXPIRY_POLICY.minimumHoldSeconds ||
      value > INVENTORY_EXPIRY_POLICY.maximumHoldSeconds || !Number.isSafeInteger(now + value)) {
    throw new InventoryConfigurationError("Inventory hold duration is outside the safe policy.");
  }
  return value;
}
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index += 1) different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return different === 0;
}
async function hmacSha256Hex(secret, value) {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The returned object is opaque: settlement functions accept only objects
// branded by this verifier in the current isolate. Callers cannot manufacture
// evidence by passing a status string or a lookalike object.
export async function verifyInventoryProviderEvidence(rawBody, signatureHeader, webhookSecret, options = {}) {
  const now = resolveNow(options);
  if (typeof rawBody !== "string" || !rawBody || typeof signatureHeader !== "string" ||
      typeof webhookSecret !== "string" || !webhookSecret) throw new InventoryEvidenceError();
  const fields = signatureHeader.split(",").map((part) => part.trim().split("="));
  const timestampText = (fields.find((field) => field[0] === "t") || [])[1];
  const signatures = fields.filter((field) => field[0] === "v1").map((field) => field[1]);
  if (!/^\d+$/.test(timestampText || "") || signatures.length === 0) throw new InventoryEvidenceError();
  const signatureTimestamp = Number(timestampText);
  if (!Number.isSafeInteger(signatureTimestamp) || signatureTimestamp > now ||
      now - signatureTimestamp > INVENTORY_EXPIRY_POLICY.providerEvidenceMaxAgeSeconds) throw new InventoryEvidenceError("Payment-provider evidence is stale.");
  const expected = await hmacSha256Hex(webhookSecret, timestampText + "." + rawBody);
  if (!signatures.some((signature) => /^[0-9a-f]{64}$/i.test(signature || "") && timingSafeEqual(signature.toLowerCase(), expected))) {
    throw new InventoryEvidenceError("Payment-provider evidence signature is invalid.");
  }
  let event;
  try { event = JSON.parse(rawBody); } catch (error) { throw new InventoryEvidenceError("Payment-provider evidence is not valid JSON."); }
  const object = event && event.data && event.data.object;
  const outcomes = {
    "payment_intent.canceled": "canceled",
    "payment_intent.payment_failed": "failed",
    "payment_intent.succeeded": "succeeded",
  };
  const outcome = outcomes[event && event.type];
  if (!outcome || typeof event.id !== "string" || !/^evt_[A-Za-z0-9_]+$/.test(event.id) ||
      !Number.isSafeInteger(event.created) || event.created < 0 || event.created > now ||
      !object || object.object !== "payment_intent" || !PI_RE.test(object.id || "")) throw new InventoryEvidenceError();
  if (typeof options.expectedLivemode !== "boolean" || event.livemode !== options.expectedLivemode) throw new InventoryEvidenceError("Payment-provider environment does not match.");
  const evidence = Object.freeze({
    paymentIntentId: object.id,
    outcome,
    eventId: event.id,
    eventCreated: event.created,
    signatureTimestamp,
    verifiedAt: now,
  });
  VERIFIED_PROVIDER_EVIDENCE.add(evidence);
  return evidence;
}

function requireProviderEvidence(evidence, paymentIntentId, outcomes, now, snapshot) {
  if (!evidence || typeof evidence !== "object" || !VERIFIED_PROVIDER_EVIDENCE.has(evidence) ||
      evidence.paymentIntentId !== paymentIntentId || !outcomes.includes(evidence.outcome) ||
      !Number.isSafeInteger(evidence.verifiedAt) || evidence.verifiedAt > now ||
      now - evidence.verifiedAt > INVENTORY_EXPIRY_POLICY.providerEvidenceMaxAgeSeconds ||
      !Number.isSafeInteger(evidence.eventCreated) || evidence.eventCreated < snapshot.createdAt || evidence.eventCreated > now) {
    throw new InventoryEvidenceError();
  }
  return evidence;
}
function strictInteger(value, label, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new InventoryProtocolError(label + " is not a valid integer.");
  return value;
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryProtocolError(label + " is not an object.");
  return value;
}
function primary(db) {
  const session = db.withSession("first-primary");
  if (!session || typeof session.prepare !== "function") throw new InventoryProtocolError("D1 did not create a primary session.");
  return session;
}
function validateReadResult(result, label) {
  record(result, label);
  if (result.success !== true || !Array.isArray(result.results) || !result.meta || typeof result.meta !== "object" || result.error) {
    throw new InventoryProtocolError(label + " did not return a successful D1 result.");
  }
  return result.results;
}
async function queryRows(db, sql, bindings = [], label = "D1 read") {
  let result;
  try { result = await db.prepare(sql).bind(...bindings).all(); }
  catch (error) { throw new InventoryConfigurationError(label + " failed."); }
  return validateReadResult(result, label);
}
function validateBatchEnvelope(results, expectedLength, label) {
  if (!Array.isArray(results) || results.length !== expectedLength) throw new InventoryProtocolError(label + " returned the wrong result count.");
  return results.map((result, index) => {
    record(result, label + " result " + index);
    if (result.success !== true || !Array.isArray(result.results) || !result.meta || typeof result.meta !== "object" || result.error) {
      throw new InventoryProtocolError(label + " result " + index + " was not successful.");
    }
    return strictInteger(result.meta.changes, label + " result " + index + " changes");
  });
}
function requireMutationCounts(results, expectedLength, label) {
  if (validateBatchEnvelope(results, expectedLength, label).some((count) => count !== 1)) {
    throw new InventoryProtocolError(label + " did not mutate exactly one row per statement.");
  }
}
function capacityFailure(error) { return /store_inventory_capacity_exceeded|check constraint failed/i.test(String(error && (error.message || error))); }
function stateFailure(error) { return /store_inventory_state_conflict/i.test(String(error && (error.message || error))); }

function validateAvailabilityRow(raw) {
  const row = record(raw, "Inventory availability row");
  if (!SKU_RE.test(row.sku || "") || typeof row.label !== "string" || !row.label.trim()) throw new InventoryProtocolError("Inventory availability contains an invalid SKU or label.");
  const capacity = strictInteger(row.capacity, "Inventory capacity");
  const reserved = strictInteger(row.reserved_quantity, "Inventory reserved quantity");
  const sold = strictInteger(row.sold_quantity, "Inventory sold quantity");
  const available = strictInteger(row.available_quantity, "Inventory available quantity");
  const createdAt = strictInteger(row.created_at, "Inventory created timestamp");
  const updatedAt = strictInteger(row.updated_at, "Inventory updated timestamp");
  if (reserved + sold > capacity || available !== capacity - reserved - sold || updatedAt < createdAt) {
    throw new InventoryProtocolError("Inventory availability violates its counter invariants.");
  }
  return { sku: row.sku, label: row.label, capacity, reserved, sold, available, soldOut: available === 0 };
}
async function availabilityFromDb(db, skus) {
  let sql = `SELECT sku, label, capacity, reserved_quantity, sold_quantity,
                    capacity - reserved_quantity - sold_quantity AS available_quantity,
                    created_at, updated_at FROM store_inventory_batches`;
  let bindings = [];
  if (skus) { sql += ` WHERE sku IN (${skus.map(() => "?").join(",")})`; bindings = skus; }
  sql += " ORDER BY sku";
  const raw = await queryRows(primary(db), sql, bindings, "Inventory availability read");
  if (raw.length === 0) throw new InventoryConfigurationError("No finite-inventory rows are provisioned.");
  const result = raw.map(validateAvailabilityRow);
  const unique = new Set(result.map((row) => row.sku));
  if (unique.size !== result.length) throw new InventoryProtocolError("Inventory availability contains duplicate SKUs.");
  if (skus && (result.length !== skus.length || skus.some((sku) => !unique.has(sku)))) throw new InventoryConfigurationError("A requested finite-inventory SKU is not provisioned.");
  return result;
}

function validateReservationRow(raw, paymentIntentId) {
  const row = record(raw, "Inventory reservation row");
  if (row.payment_intent_id !== paymentIntentId || !STATUSES.has(row.status)) throw new InventoryProtocolError("Inventory reservation identity or status is invalid.");
  const expiresAt = strictInteger(row.expires_at, "Reservation expiry");
  const createdAt = strictInteger(row.created_at, "Reservation creation timestamp");
  const updatedAt = strictInteger(row.updated_at, "Reservation update timestamp");
  if (expiresAt < createdAt || updatedAt < createdAt) throw new InventoryProtocolError("Reservation timestamps are inconsistent.");
  const providerFields = [row.provider_event_id, row.provider_event_created_at, row.provider_outcome];
  const hasProviderEvidence = providerFields.every((value) => value != null);
  if (!hasProviderEvidence && providerFields.some((value) => value != null)) throw new InventoryProtocolError("Reservation provider evidence is partial.");
  if (hasProviderEvidence && (!/^evt_[A-Za-z0-9_]+$/.test(row.provider_event_id) ||
      !["canceled", "failed", "succeeded"].includes(row.provider_outcome) ||
      strictInteger(row.provider_event_created_at, "Provider event timestamp") < createdAt ||
      row.provider_event_created_at > updatedAt)) throw new InventoryProtocolError("Reservation provider evidence is inconsistent.");
  if (row.status === "sold") {
    const soldAt = strictInteger(row.sold_at, "Reservation sold timestamp");
    if (soldAt !== updatedAt || row.released_at != null || row.release_reason != null ||
        (hasProviderEvidence && row.provider_outcome !== "succeeded")) throw new InventoryProtocolError("Sold reservation fields are inconsistent.");
  } else if (row.sold_at != null) throw new InventoryProtocolError("Unsold reservation unexpectedly has a sold timestamp.");
  if (row.status === "released") {
    const releasedAt = strictInteger(row.released_at, "Reservation release timestamp");
    if (releasedAt !== updatedAt || typeof row.release_reason !== "string" || !row.release_reason ||
        !hasProviderEvidence || row.provider_outcome !== "canceled" ||
        !["provider_canceled", "expired_provider_canceled"].includes(row.release_reason)) {
      throw new InventoryProtocolError("Released reservation fields are inconsistent.");
    }
  } else if (row.release_reason != null || row.released_at != null) throw new InventoryProtocolError("Unreleased reservation unexpectedly has release fields.");
  if ((row.status === "active" || row.status === "expiring") && hasProviderEvidence) throw new InventoryProtocolError("Open reservation unexpectedly has provider evidence.");
  const commerceValues = [row.commerce_amount, row.commerce_currency, row.commerce_manifest_sha256,
    row.commerce_catalog_sha256, row.commerce_demand_sha256, row.commerce_binding_sha256];
  const hasCommerceBinding = commerceValues.every((value) => value != null);
  if (!hasCommerceBinding && commerceValues.some((value) => value != null)) {
    throw new InventoryProtocolError("Reservation commerce binding is partial.");
  }
  let commerceBinding = null;
  if (hasCommerceBinding) {
    try {
      commerceBinding = normalizeInventoryCommerceBinding({
        amount: row.commerce_amount,
        currency: row.commerce_currency,
        manifestSha256: row.commerce_manifest_sha256,
        catalogSha256: row.commerce_catalog_sha256,
        demandSha256: row.commerce_demand_sha256,
        bindingSha256: row.commerce_binding_sha256,
      });
    } catch (error) {
      throw new InventoryProtocolError("Reservation commerce binding is malformed.");
    }
  }
  return {
    paymentIntentId, status: row.status, expiresAt, releaseReason: row.release_reason || null,
    createdAt, updatedAt, providerEventId: row.provider_event_id || null,
    providerEventCreatedAt: row.provider_event_created_at == null ? null : row.provider_event_created_at,
    providerOutcome: row.provider_outcome || null, commerceBinding,
  };
}
function validateReservationLines(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new InventoryProtocolError("Inventory reservation has no lines.");
  const seen = new Set();
  return rawRows.map((raw) => {
    const row = record(raw, "Inventory reservation line");
    if (!SKU_RE.test(row.sku || "") || seen.has(row.sku)) throw new InventoryProtocolError("Inventory reservation line has an invalid or duplicate SKU.");
    seen.add(row.sku);
    const held = strictInteger(row.held_quantity, "Held quantity", 1);
    const committed = strictInteger(row.committed_quantity, "Committed quantity", 1);
    const target = strictInteger(row.target_quantity, "Target quantity", 1);
    if (held > 99 || committed !== held || target !== held) throw new InventoryProtocolError("Inventory reservation line quantities are inconsistent.");
    return { sku: row.sku, quantity: held };
  });
}
async function reservationSnapshot(db, paymentIntentId) {
  const session = primary(db);
  const reservations = await queryRows(session,
    `SELECT payment_intent_id, status, expires_at, release_reason, created_at, updated_at, sold_at,
            released_at, provider_event_id, provider_event_created_at, provider_outcome,
            commerce_amount, commerce_currency, commerce_manifest_sha256, commerce_catalog_sha256,
            commerce_demand_sha256, commerce_binding_sha256
       FROM store_inventory_reservations WHERE payment_intent_id = ? LIMIT 2`, [paymentIntentId], "Inventory reservation read");
  if (reservations.length > 1) throw new InventoryProtocolError("D1 returned duplicate reservations.");
  if (reservations.length === 0) return null;
  const snapshot = validateReservationRow(reservations[0], paymentIntentId);
  const lineRows = await queryRows(session,
    `SELECT sku, held_quantity, committed_quantity, target_quantity
       FROM store_inventory_reservation_lines WHERE payment_intent_id = ? ORDER BY sku`, [paymentIntentId], "Inventory reservation-line read");
  return { ...snapshot, lines: validateReservationLines(lineRows) };
}
function sameDemand(snapshot, demand) {
  return !!snapshot && snapshot.lines.length === demand.length && snapshot.lines.every((line, index) => line.sku === demand[index].sku && line.quantity === demand[index].quantity);
}
function guardId() {
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== "function") throw new InventoryConfigurationError("Secure randomness is unavailable.");
  return "guard_" + globalThis.crypto.randomUUID();
}

export async function reserveInventory(env, paymentIntentId, input, options = {}) {
  const db = requireInventoryBinding(env); validatePi(paymentIntentId);
  const demand = normalizeInventoryDemand(input); const now = resolveNow(options);
  const commerceBinding = normalizeInventoryCommerceBinding(options.binding);
  const existing = await reservationSnapshot(db, paymentIntentId);
  if (existing) {
    if (now < existing.updatedAt) throw new InventoryStateError("Inventory retry time precedes the prior transition.");
    if (existing.status === "active" && existing.expiresAt <= now) {
      await markInventoryExpired(env, paymentIntentId, { now }).catch((error) => { if (!(error instanceof InventoryStateError)) throw error; });
      throw new InventoryExpiredError();
    }
    if (existing.status === "expiring") throw new InventoryExpiredError();
    if (sameDemand(existing, demand) && sameCommerceBinding(existing.commerceBinding, commerceBinding) &&
        (existing.status === "active" || existing.status === "sold")) return { ...existing, duplicate: true };
    throw new InventoryStateError();
  }
  const batches = await availabilityFromDb(db, demand.map((line) => line.sku));
  if (demand.some((line) => batches.find((batch) => batch.sku === line.sku).available < line.quantity)) throw new InventorySoldOutError();
  const holdSeconds = resolveHoldSeconds(options, now);
  const expiresAt = now + holdSeconds;
  const statements = [db.prepare(
    `INSERT INTO store_inventory_reservations
       (payment_intent_id, status, expires_at, created_at, updated_at,
        commerce_amount, commerce_currency, commerce_manifest_sha256, commerce_catalog_sha256,
        commerce_demand_sha256, commerce_binding_sha256)
     VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(paymentIntentId, expiresAt, now, now,
    commerceBinding && commerceBinding.amount,
    commerceBinding && commerceBinding.currency,
    commerceBinding && commerceBinding.manifestSha256,
    commerceBinding && commerceBinding.catalogSha256,
    commerceBinding && commerceBinding.demandSha256,
    commerceBinding && commerceBinding.bindingSha256)];
  for (const line of demand) {
    statements.push(db.prepare(`UPDATE store_inventory_batches SET reserved_quantity = reserved_quantity + ?, updated_at = MAX(updated_at, ?) WHERE sku = ?`).bind(line.quantity, now, line.sku));
    statements.push(db.prepare(
      `INSERT INTO store_inventory_reservation_lines
         (payment_intent_id, sku, held_quantity, committed_quantity, target_quantity) VALUES (?, ?, ?, ?, ?)`
    ).bind(paymentIntentId, line.sku, line.quantity, line.quantity, line.quantity));
  }
  try {
    requireMutationCounts(await db.batch(statements), statements.length, "Inventory reservation batch");
  } catch (error) {
    if (error instanceof InventoryProtocolError) throw error;
    if (capacityFailure(error)) throw new InventorySoldOutError();
    const raced = await reservationSnapshot(db, paymentIntentId).catch(() => null);
    if (sameDemand(raced, demand) && sameCommerceBinding(raced.commerceBinding, commerceBinding) &&
        (raced.status === "active" || raced.status === "sold")) {
      if (now < raced.updatedAt) throw new InventoryStateError("Inventory retry time precedes the prior transition.");
      if (raced.status === "active" && raced.expiresAt <= now) throw new InventoryExpiredError();
      return { ...raced, duplicate: true };
    }
    throw new InventoryConfigurationError("D1 could not create the inventory reservation.");
  }
  const stored = await reservationSnapshot(db, paymentIntentId);
  if (!stored || stored.status !== "active" || stored.expiresAt !== expiresAt || !sameDemand(stored, demand) ||
      !sameCommerceBinding(stored.commerceBinding, commerceBinding)) {
    throw new InventoryProtocolError("D1 did not persist the exact inventory reservation.");
  }
  return { ...stored, duplicate: false };
}

// Refreshes the immutable stock demand while rebinding an active reservation
// to a later server-authoritative PaymentIntent amount/catalog snapshot. A
// finite cart that changes stock demand must cancel and start a new intent, so
// no unauthenticated cart edit can release or reassign held units.
export async function refreshInventoryReservation(env, paymentIntentId, input, options = {}) {
  const db = requireInventoryBinding(env); validatePi(paymentIntentId);
  const demand = normalizeInventoryDemand(input); const now = resolveNow(options);
  const commerceBinding = normalizeInventoryCommerceBinding(options.binding);
  if (!commerceBinding) throw new InventoryConfigurationError("Inventory refresh requires a commerce binding.");
  const snapshot = await reservationSnapshot(db, paymentIntentId);
  if (!snapshot) throw new InventoryStateError("No inventory reservation exists for this PaymentIntent.");
  if (now < snapshot.updatedAt || snapshot.status !== "active" || snapshot.expiresAt <= now || !sameDemand(snapshot, demand)) {
    throw new InventoryStateError("Only a live reservation with unchanged stock demand can be refreshed.");
  }
  const expiresAt = now + resolveHoldSeconds(options, now);
  const guard = guardId();
  const statements = [
    db.prepare(`INSERT INTO store_inventory_transition_guards
      (guard_id, payment_intent_id, expected_state, observed_at) VALUES (?, ?, 'active_live', ?)`).bind(guard, paymentIntentId, now),
    db.prepare(`UPDATE store_inventory_reservations
      SET expires_at = ?, updated_at = ?, commerce_amount = ?, commerce_currency = ?,
          commerce_manifest_sha256 = ?, commerce_catalog_sha256 = ?, commerce_demand_sha256 = ?,
          commerce_binding_sha256 = ? WHERE payment_intent_id = ?`).bind(
      expiresAt, now, commerceBinding.amount, commerceBinding.currency,
      commerceBinding.manifestSha256, commerceBinding.catalogSha256,
      commerceBinding.demandSha256, commerceBinding.bindingSha256, paymentIntentId,
    ),
    db.prepare(`DELETE FROM store_inventory_transition_guards WHERE guard_id = ?`).bind(guard),
  ];
  try {
    requireMutationCounts(await db.batch(statements), statements.length, "Inventory refresh batch");
  } catch (error) {
    if (error instanceof InventoryProtocolError) throw error;
    const after = await reservationSnapshot(db, paymentIntentId).catch(() => null);
    if (after && after.status === "active" && after.expiresAt >= expiresAt && sameDemand(after, demand) &&
        sameCommerceBinding(after.commerceBinding, commerceBinding)) return { ...after, duplicate: true };
    if (stateFailure(error)) throw new InventoryStateError();
    throw new InventoryConfigurationError("Inventory refresh batch failed.");
  }
  const stored = await reservationSnapshot(db, paymentIntentId);
  if (!stored || stored.status !== "active" || stored.expiresAt !== expiresAt || !sameDemand(stored, demand) ||
      !sameCommerceBinding(stored.commerceBinding, commerceBinding)) {
    throw new InventoryProtocolError("D1 did not persist the exact inventory refresh.");
  }
  return { ...stored, duplicate: sameCommerceBinding(snapshot.commerceBinding, commerceBinding) };
}

export async function assertInventoryReservation(env, paymentIntentId, input, options = {}) {
  const db = requireInventoryBinding(env); validatePi(paymentIntentId);
  const demand = normalizeInventoryDemand(input); const now = resolveNow(options);
  const snapshot = await reservationSnapshot(db, paymentIntentId);
  if (!snapshot || snapshot.status !== "active" || snapshot.expiresAt <= now ||
      !sameDemand(snapshot, demand)) throw new InventoryStateError("A matching live inventory reservation is required.");
  requireSnapshotBinding(snapshot, options.binding);
  return { ...snapshot };
}

export async function readInventoryReservation(env, paymentIntentId) {
  const db = requireInventoryBinding(env); validatePi(paymentIntentId);
  const snapshot = await reservationSnapshot(db, paymentIntentId);
  return snapshot ? { ...snapshot } : null;
}

async function guardedTransition(db, snapshot, spec, now) {
  if (now < snapshot.updatedAt || now < snapshot.createdAt) throw new InventoryStateError("Inventory transition time is not monotonic.");
  const guard = guardId();
  const evidence = spec.evidence || null;
  const statements = [db.prepare(
    `INSERT INTO store_inventory_transition_guards (guard_id, payment_intent_id, expected_state, observed_at) VALUES (?, ?, ?, ?)`
  ).bind(guard, snapshot.paymentIntentId, spec.expectedState, now)];
  if (spec.moveCounters) {
    for (const line of snapshot.lines) statements.push(db.prepare(
      `UPDATE store_inventory_batches
          SET reserved_quantity = reserved_quantity - ?, sold_quantity = sold_quantity + ?, updated_at = MAX(updated_at, ?) WHERE sku = ?`
    ).bind(line.quantity, spec.target === "sold" ? line.quantity : 0, now, line.sku));
  }
  statements.push(db.prepare(
    `UPDATE store_inventory_reservations
        SET status = ?, updated_at = ?, sold_at = ?, released_at = ?, release_reason = ?,
            provider_event_id = ?, provider_event_created_at = ?, provider_outcome = ?
      WHERE payment_intent_id = ?`
  ).bind(
    spec.target,
    now,
    spec.target === "sold" ? now : null,
    spec.target === "released" ? now : null,
    spec.releaseReason || null,
    evidence && evidence.eventId,
    evidence && evidence.eventCreated,
    evidence && evidence.outcome,
    snapshot.paymentIntentId,
  ));
  statements.push(db.prepare(`DELETE FROM store_inventory_transition_guards WHERE guard_id = ?`).bind(guard));
  try {
    requireMutationCounts(await db.batch(statements), statements.length, spec.label);
  } catch (error) {
    if (error instanceof InventoryProtocolError) throw error;
    const after = await reservationSnapshot(db, snapshot.paymentIntentId).catch(() => null);
    if (after && after.status === spec.target && (!spec.releaseReason || after.releaseReason === spec.releaseReason)) {
      if (now < after.updatedAt) throw new InventoryStateError("Inventory retry time precedes the winning transition.");
      return { ...after, duplicate: true };
    }
    if (stateFailure(error)) throw new InventoryStateError();
    throw new InventoryConfigurationError(spec.label + " failed.");
  }
  const stored = await reservationSnapshot(db, snapshot.paymentIntentId);
  if (!stored || stored.status !== spec.target || (spec.releaseReason && stored.releaseReason !== spec.releaseReason) ||
      (evidence && (stored.providerEventId !== evidence.eventId || stored.providerOutcome !== evidence.outcome))) {
    throw new InventoryProtocolError(spec.label + " did not persist the exact state.");
  }
  return { ...stored, duplicate: false };
}

export async function commitInventory(env, paymentIntentId, options = {}) {
  const db = requireInventoryBinding(env); validatePi(paymentIntentId); const now = resolveNow(options);
  let snapshot = await reservationSnapshot(db, paymentIntentId);
  if (!snapshot) throw new InventoryStateError("No inventory reservation exists for this PaymentIntent.");
  if (now < snapshot.updatedAt) throw new InventoryStateError("Inventory retry time precedes the prior transition.");
  requireSnapshotBinding(snapshot, options.binding);
  if (snapshot.status === "sold") return { ...snapshot, duplicate: true };
  if (snapshot.status === "released") throw new InventoryExpiredError();
  if (snapshot.status !== "active" && snapshot.status !== "expiring") throw new InventoryStateError();
  const evidence = requireProviderEvidence(options.evidence, paymentIntentId, ["succeeded"], now, snapshot);
  if (snapshot.status === "active" && snapshot.expiresAt <= now) {
    await markInventoryExpired(env, paymentIntentId, { now });
    snapshot = await reservationSnapshot(db, paymentIntentId);
  }
  if (snapshot.status === "expiring") {
    return guardedTransition(db, snapshot, {
      target: "sold", expectedState: "expiring", moveCounters: true, evidence,
      label: "Expired inventory success batch",
    }, now);
  }
  try {
    return await guardedTransition(db, snapshot, {
      target: "sold", expectedState: "active_live", moveCounters: true, evidence,
      label: "Inventory commit batch",
    }, now);
  } catch (error) {
    if (error instanceof InventoryStateError) {
      const after = await reservationSnapshot(db, paymentIntentId);
      if (after && after.status === "sold") return { ...after, duplicate: true };
      if (after && (after.status === "expiring" || after.releaseReason === "expired_provider_canceled")) throw new InventoryExpiredError();
    }
    throw error;
  }
}

export async function releaseInventory(env, paymentIntentId, options = {}) {
  const db = requireInventoryBinding(env); validatePi(paymentIntentId); const now = resolveNow(options);
  let snapshot = await reservationSnapshot(db, paymentIntentId);
  if (!snapshot) throw new InventoryStateError("No inventory reservation exists for this PaymentIntent.");
  if (now < snapshot.updatedAt) throw new InventoryStateError("Inventory retry time precedes the prior transition.");
  requireSnapshotBinding(snapshot, options.binding);
  const evidence = requireProviderEvidence(options.evidence, paymentIntentId, ["canceled"], now, snapshot);
  if (snapshot.status === "released") return { ...snapshot, duplicate: true };
  if (snapshot.status === "active" && snapshot.expiresAt <= now) {
    await markInventoryExpired(env, paymentIntentId, { now });
    snapshot = await reservationSnapshot(db, paymentIntentId);
  }
  if (snapshot.status === "expiring") {
    return reclaimExpiredInventory(env, paymentIntentId, { now, evidence, binding: options.binding });
  }
  if (snapshot.status !== "active") throw new InventoryStateError();
  return guardedTransition(db, snapshot, {
    target: "released", expectedState: "active_any", moveCounters: true,
    releaseReason: "provider_canceled", evidence, label: "Inventory release batch",
  }, now);
}

export async function markInventoryExpired(env, paymentIntentId, options = {}) {
  const db = requireInventoryBinding(env); validatePi(paymentIntentId); const now = resolveNow(options);
  const snapshot = await reservationSnapshot(db, paymentIntentId);
  if (!snapshot) throw new InventoryStateError("No inventory reservation exists for this PaymentIntent.");
  if (now < snapshot.updatedAt) throw new InventoryStateError("Inventory retry time precedes the prior transition.");
  if (snapshot.status === "expiring" || (snapshot.status === "released" && snapshot.releaseReason === "expired_provider_canceled")) return { ...snapshot, duplicate: true };
  if (snapshot.status !== "active") throw new InventoryStateError();
  if (snapshot.expiresAt > now) throw new InventoryStateError("Inventory reservation has not expired.");
  return guardedTransition(db, snapshot, { target: "expiring", expectedState: "active_expired", moveCounters: false, label: "Inventory expiration batch" }, now);
}

export async function reclaimExpiredInventory(env, paymentIntentId, options = {}) {
  const db = requireInventoryBinding(env); validatePi(paymentIntentId); const now = resolveNow(options);
  const snapshot = await reservationSnapshot(db, paymentIntentId);
  if (!snapshot) throw new InventoryStateError("No inventory reservation exists for this PaymentIntent.");
  if (now < snapshot.updatedAt) throw new InventoryStateError("Inventory retry time precedes the prior transition.");
  requireSnapshotBinding(snapshot, options.binding);
  const evidence = requireProviderEvidence(options.evidence, paymentIntentId, [INVENTORY_EXPIRY_POLICY.reclaimRequiresProviderOutcome], now, snapshot);
  if (snapshot.status === "released" && snapshot.releaseReason === "expired_provider_canceled") return { ...snapshot, duplicate: true };
  if (snapshot.status !== "expiring") throw new InventoryStateError("Reservation must be marked expiring before reclamation.");
  return guardedTransition(db, snapshot, {
    target: "released", expectedState: "expiring", moveCounters: true,
    releaseReason: "expired_provider_canceled", evidence, label: "Inventory reclamation batch",
  }, now);
}

export async function readInventoryAvailability(env, skus = null) {
  const db = requireInventoryBinding(env); let normalized = null;
  if (skus != null) {
    if (!Array.isArray(skus) || skus.length === 0 || skus.some((sku) => !SKU_RE.test(sku))) throw new InventoryConfigurationError("Availability requires valid inventory SKUs.");
    normalized = [...new Set(skus)].sort();
    if (normalized.length !== skus.length) throw new InventoryConfigurationError("Availability SKUs must be unique.");
  }
  return availabilityFromDb(db, normalized);
}

export async function listInventoryCancellationCandidates(env, options = {}) {
  const db = requireInventoryBinding(env); const now = resolveNow(options);
  const limit = options.limit === undefined ? 25 : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new InventoryConfigurationError("Inventory cancellation limit is invalid.");
  }
  const rows = await queryRows(primary(db),
    `SELECT payment_intent_id FROM store_inventory_reservations
      WHERE (status = 'active' AND expires_at <= ?) OR status = 'expiring'
      ORDER BY expires_at, payment_intent_id LIMIT ?`, [now, limit], "Inventory cancellation-candidate read");
  const seen = new Set(); const result = [];
  for (const raw of rows) {
    const row = record(raw, "Inventory cancellation-candidate row");
    const paymentIntentId = row.payment_intent_id;
    if (!PI_RE.test(paymentIntentId || "") || seen.has(paymentIntentId)) {
      throw new InventoryProtocolError("Inventory cancellation candidate is invalid or duplicated.");
    }
    seen.add(paymentIntentId);
    const snapshot = await reservationSnapshot(db, paymentIntentId);
    if (snapshot && ((snapshot.status === "active" && snapshot.expiresAt <= now) || snapshot.status === "expiring")) {
      result.push({ paymentIntentId, status: snapshot.status, expiresAt: snapshot.expiresAt });
    }
  }
  return result;
}

function normalizeSchemaSql(sql) { return String(sql).replace(/\s+/g, " ").trim(); }
async function sha256(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function exactCount(db, table) {
  const result = await queryRows(primary(db), `SELECT COUNT(*) AS count FROM ${table}`, [], "Provisioning count read");
  if (result.length !== 1) throw new InventoryProtocolError("Provisioning count returned the wrong row count.");
  return strictInteger(record(result[0], "Provisioning count row").count, "Provisioning count");
}

// Run once against a newly migrated database before binding it to checkout.
// It rejects prior orders, altered counters, extra schema objects, and a
// poisoned pre-existing seed row that ON CONFLICT would otherwise preserve.
export async function verifyFreshInventoryProvisioning(env) {
  const db = requireInventoryBinding(env);
  const objects = await queryRows(primary(db),
    `SELECT type, name, tbl_name, sql
       FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
        AND (
          lower(name) GLOB 'store_inventory_*'
          OR lower(tbl_name) GLOB 'store_inventory_*'
          OR lower(COALESCE(sql, '')) LIKE '%store_inventory_%'
        )
      ORDER BY type, name, tbl_name`, [], "Inventory schema read");
  if (objects.length !== 8) throw new InventoryConfigurationError("Inventory schema object count is incorrect.");
  const manifest = objects.map((raw) => {
    const row = record(raw, "Inventory schema row");
    if (typeof row.type !== "string" || typeof row.name !== "string" || typeof row.tbl_name !== "string" || typeof row.sql !== "string") throw new InventoryProtocolError("Inventory schema row is malformed.");
    return row.type + "\0" + row.name + "\0" + row.tbl_name + "\0" + normalizeSchemaSql(row.sql);
  }).join("\n");
  if (await sha256(manifest) !== EXPECTED_SCHEMA_SHA256) throw new InventoryConfigurationError("Inventory schema does not match the accepted migration.");
  const fkState = await queryRows(primary(db), "PRAGMA foreign_keys", [], "Foreign-key state read");
  if (fkState.length !== 1 || strictInteger(record(fkState[0], "Foreign-key row").foreign_keys, "Foreign-key state") !== 1) throw new InventoryConfigurationError("Inventory foreign-key enforcement is disabled.");
  const batches = await availabilityFromDb(db, null);
  if (batches.length !== 1 || batches[0].sku !== SEED.sku || batches[0].label !== SEED.label || batches[0].capacity !== SEED.capacity ||
      batches[0].reserved !== 0 || batches[0].sold !== 0 || batches[0].available !== SEED.capacity) {
    throw new InventoryConfigurationError("Batch 01 seed is not pristine and exact.");
  }
  for (const table of ["store_inventory_reservations", "store_inventory_reservation_lines", "store_inventory_transition_guards"]) {
    if (await exactCount(db, table) !== 0) throw new InventoryConfigurationError("Fresh inventory provisioning contains state rows.");
  }
  return { ok: true, schemaSha256: EXPECTED_SCHEMA_SHA256, seed: { ...SEED, reserved: 0, sold: 0 } };
}
