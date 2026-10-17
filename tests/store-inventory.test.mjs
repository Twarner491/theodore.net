import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  commitInventory,
  InventoryBindingError,
  InventoryConfigurationError,
  InventoryExpiredError,
  InventoryEvidenceError,
  InventoryProtocolError,
  InventorySoldOutError,
  InventoryStateError,
  markInventoryExpired,
  readInventoryAvailability,
  reclaimExpiredInventory,
  releaseInventory,
  reserveInventory,
  verifyInventoryProviderEvidence,
  verifyFreshInventoryProvisioning,
} from "../lib/store-inventory.js";

class SQLiteStatement {
  constructor(owner, sql, bindings = []) {
    this.owner = owner;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new SQLiteStatement(this.owner, this.sql, bindings); }
  run() { return this.owner.run(this); }
  all() { return this.owner.all(this); }
  first() { return this.owner.first(this); }
}

class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(readFileSync(new URL("../migrations/0001_store_inventory.sql", import.meta.url), "utf8"));
    this.readMutator = null;
    this.batchMutator = null;
  }
  prepare(sql) { return new SQLiteStatement(this, sql); }
  withSession(constraint) {
    assert.equal(constraint, "first-primary");
    return this;
  }
  run(statement) {
    const result = this.sqlite.prepare(statement.sql).run(...statement.bindings);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  all(statement) {
    const result = { success: true, results: this.sqlite.prepare(statement.sql).all(...statement.bindings), meta: { changes: 0 } };
    return this.readMutator ? this.readMutator(statement, result) : result;
  }
  first(statement) {
    return this.sqlite.prepare(statement.sql).get(...statement.bindings) || null;
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.run(statement));
      this.sqlite.exec("COMMIT");
      return this.batchMutator ? this.batchMutator(statements, results) : results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

const finite = (quantity) => [{ sku: "avian-gen3-batch-01", quantity }];
const PROVIDER_SECRET = "whsec_inventory_authority_test";

async function providerEvidence(paymentIntentId, outcome, now, overrides = {}) {
  const type = {
    canceled: "payment_intent.canceled",
    failed: "payment_intent.payment_failed",
    succeeded: "payment_intent.succeeded",
  }[outcome];
  const event = JSON.stringify({
    id: overrides.eventId || "evt_" + paymentIntentId.slice(3) + "_" + outcome,
    type,
    created: overrides.created ?? now,
    livemode: false,
    data: { object: { object: "payment_intent", id: paymentIntentId } },
  });
  const signatureTimestamp = overrides.signatureTimestamp ?? now;
  const signature = createHmac("sha256", PROVIDER_SECRET)
    .update(String(signatureTimestamp) + "." + event).digest("hex");
  return verifyInventoryProviderEvidence(
    event,
    `t=${signatureTimestamp},v1=${overrides.signature || signature}`,
    PROVIDER_SECRET,
    { now, expectedLivemode: false },
  );
}

test("missing STORE_INVENTORY binding fails closed", async () => {
  await assert.rejects(() => reserveInventory({}, "pi_missing", finite(1)), InventoryBindingError);
  await assert.rejects(() => commitInventory({}, "pi_missing"), InventoryBindingError);
  await assert.rejects(() => releaseInventory({}, "pi_missing"), InventoryBindingError);
  await assert.rejects(() => readInventoryAvailability({}), InventoryBindingError);
});

test("the migration seeds an authoritative Batch 01 capacity of 20", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const rows = await readInventoryAvailability({ STORE_INVENTORY: db });
  assert.deepEqual(rows, [{
    sku: "avian-gen3-batch-01",
    label: "Avian Visitors Gen 3 Batch 01",
    capacity: 20,
    reserved: 0,
    sold: 0,
    available: 20,
    soldOut: false,
  }]);
});

test("atomic reservation never exceeds capacity and rolls back the losing request", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };

  await reserveInventory(env, "pi_twenty", finite(20), { now: 1000 });
  await assert.rejects(
    () => reserveInventory(env, "pi_one_more", finite(1), { now: 1001 }),
    InventorySoldOutError,
  );

  const [batch] = await readInventoryAvailability(env);
  assert.deepEqual({ reserved: batch.reserved, sold: batch.sold, available: batch.available },
    { reserved: 20, sold: 0, available: 0 });
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM store_inventory_reservations").get().n, 1);
});

test("competing reservations serialize without overselling the batch", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  const results = await Promise.allSettled([
    reserveInventory(env, "pi_compete_a", finite(11), { now: 1000 }),
    reserveInventory(env, "pi_compete_b", finite(10), { now: 1000 }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof InventorySoldOutError).length, 1);
  const [batch] = await readInventoryAvailability(env);
  assert.ok(batch.reserved === 10 || batch.reserved === 11);
  assert.equal(batch.sold, 0);
  assert.equal(batch.available, 20 - batch.reserved);
});

test("a multi-SKU capacity failure rolls back every line and the reservation row", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  db.sqlite.prepare(
    `INSERT INTO store_inventory_batches
       (sku, label, capacity, reserved_quantity, sold_quantity, created_at, updated_at)
     VALUES ('unavailable-part', 'Unavailable part', 0, 0, 0, 1000, 1000)`
  ).run();

  await assert.rejects(() => reserveInventory(env, "pi_multiline", [
    { sku: "avian-gen3-batch-01", quantity: 1 },
    { sku: "unavailable-part", quantity: 1 },
  ], { now: 1000 }), InventorySoldOutError);

  const rows = await readInventoryAvailability(env);
  assert.equal(rows.find((row) => row.sku === "avian-gen3-batch-01").reserved, 0);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM store_inventory_reservations").get().n, 0);
});

test("reserve is idempotent for the same PaymentIntent and exact demand", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };

  const first = await reserveInventory(env, "pi_repeat", finite(2), { now: 1000 });
  const second = await reserveInventory(env, "pi_repeat", finite(2), { now: 1001 });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  const [batch] = await readInventoryAvailability(env);
  assert.deepEqual({ reserved: batch.reserved, available: batch.available }, { reserved: 2, available: 18 });
});

test("commit moves a reservation to sold exactly once", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_paid", finite(3), { now: 1000 });
  const succeeded = await providerEvidence("pi_paid", "succeeded", 1010);

  const first = await commitInventory(env, "pi_paid", { now: 1010, evidence: succeeded });
  const second = await commitInventory(env, "pi_paid", { now: 1020 });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  const [batch] = await readInventoryAvailability(env);
  assert.deepEqual({ reserved: batch.reserved, sold: batch.sold, available: batch.available },
    { reserved: 0, sold: 3, available: 17 });
});

test("authenticated cancellation restores availability exactly once and a released hold cannot later commit", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_canceled", finite(4), { now: 1000 });
  const evidence = await providerEvidence("pi_canceled", "canceled", 1010);

  const first = await releaseInventory(env, "pi_canceled", { now: 1010, evidence });
  const retryEvidence = await providerEvidence("pi_canceled", "canceled", 1020, { eventId: "evt_canceled_retry" });
  const second = await releaseInventory(env, "pi_canceled", { now: 1020, evidence: retryEvidence });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  await assert.rejects(() => commitInventory(env, "pi_canceled", { now: 1030 }), InventoryStateError);
  const [batch] = await readInventoryAvailability(env);
  assert.deepEqual({ reserved: batch.reserved, sold: batch.sold, available: batch.available },
    { reserved: 0, sold: 0, available: 20 });
});

test("duplicate SKU lines aggregate before the atomic reservation", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  const result = await reserveInventory(env, "pi_aggregate", [
    { sku: "avian-gen3-batch-01", quantity: 2 },
    { sku: "avian-gen3-batch-01", quantity: 3 },
  ], { now: 1000 });

  assert.deepEqual(result.lines, [{ sku: "avian-gen3-batch-01", quantity: 5 }]);
  const [batch] = await readInventoryAvailability(env, ["avian-gen3-batch-01"]);
  assert.equal(batch.reserved, 5);
});

test("exact active and sold PaymentIntent retries bypass a zero-remaining sold-out check", async (t) => {
  const activeDb = new SQLiteD1(); t.after(() => activeDb.close());
  const activeEnv = { STORE_INVENTORY: activeDb };
  await reserveInventory(activeEnv, "pi_full_active", finite(20), { now: 1000 });
  const activeRetry = await reserveInventory(activeEnv, "pi_full_active", finite(20), { now: 1001, holdSeconds: -1 });
  assert.equal(activeRetry.status, "active");
  assert.equal(activeRetry.duplicate, true);
  assert.equal((await readInventoryAvailability(activeEnv))[0].available, 0);

  const soldDb = new SQLiteD1(); t.after(() => soldDb.close());
  const soldEnv = { STORE_INVENTORY: soldDb };
  await reserveInventory(soldEnv, "pi_full_sold", finite(20), { now: 1000 });
  const succeeded = await providerEvidence("pi_full_sold", "succeeded", 1010);
  await commitInventory(soldEnv, "pi_full_sold", { now: 1010, evidence: succeeded });
  const soldRetry = await reserveInventory(soldEnv, "pi_full_sold", finite(20), { now: 1020 });
  assert.equal(soldRetry.status, "sold");
  assert.equal(soldRetry.duplicate, true);
  assert.equal((await readInventoryAvailability(soldEnv))[0].available, 0);
});

test("expired holds cannot commit and reclaim only after confirmed PaymentIntent cancellation", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_expired", finite(2), { now: 1000, holdSeconds: 300 });

  await assert.rejects(() => commitInventory(env, "pi_expired", { now: 1300 }), InventoryEvidenceError);
  assert.equal(db.sqlite.prepare("SELECT status FROM store_inventory_reservations WHERE payment_intent_id = ?").get("pi_expired").status, "active");
  await markInventoryExpired(env, "pi_expired", { now: 1300 });
  assert.equal(db.sqlite.prepare("SELECT status FROM store_inventory_reservations WHERE payment_intent_id = ?").get("pi_expired").status, "expiring");
  assert.equal((await readInventoryAvailability(env))[0].reserved, 2);
  await assert.rejects(() => reclaimExpiredInventory(env, "pi_expired", { now: 1301 }), InventoryEvidenceError);
  await assert.rejects(
    () => reclaimExpiredInventory(env, "pi_expired", { now: 1301, paymentIntentStatus: "succeeded" }),
    InventoryEvidenceError,
  );

  const canceled = await providerEvidence("pi_expired", "canceled", 1301);
  const reclaimed = await reclaimExpiredInventory(env, "pi_expired", { now: 1301, evidence: canceled });
  const canceledRetry = await providerEvidence("pi_expired", "canceled", 1302, { eventId: "evt_expired_retry" });
  const duplicate = await reclaimExpiredInventory(env, "pi_expired", { now: 1302, evidence: canceledRetry });
  assert.equal(reclaimed.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual((await readInventoryAvailability(env))[0], {
    sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01",
    capacity: 20, reserved: 0, sold: 0, available: 20, soldOut: false,
  });
  await assert.rejects(() => commitInventory(env, "pi_expired", { now: 1303 }), InventoryExpiredError);
});

test("expiration cannot start early and marking it twice is idempotent", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_expiry_mark", finite(1), { now: 1000, holdSeconds: 300 });
  await assert.rejects(() => markInventoryExpired(env, "pi_expiry_mark", { now: 1299 }), InventoryStateError);
  assert.equal((await markInventoryExpired(env, "pi_expiry_mark", { now: 1300 })).duplicate, false);
  assert.equal((await markInventoryExpired(env, "pi_expiry_mark", { now: 1301 })).duplicate, true);
  assert.equal((await readInventoryAvailability(env))[0].reserved, 1);
});

test("expired release rejects bare status, forged evidence, and retryable payment failure", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_expired_release", finite(2), { now: 1000, holdSeconds: 300 });
  await assert.rejects(
    () => releaseInventory(env, "pi_expired_release", { now: 1300, paymentIntentStatus: "canceled" }),
    InventoryEvidenceError,
  );
  await assert.rejects(
    () => releaseInventory(env, "pi_expired_release", { now: 1300, evidence: {
      paymentIntentId: "pi_expired_release", outcome: "canceled", verifiedAt: 1300,
    } }),
    InventoryEvidenceError,
  );
  const failed = await providerEvidence("pi_expired_release", "failed", 1300);
  await assert.rejects(
    () => releaseInventory(env, "pi_expired_release", { now: 1300, evidence: failed }),
    InventoryEvidenceError,
  );
  assert.equal(db.sqlite.prepare("SELECT status FROM store_inventory_reservations WHERE payment_intent_id = ?").get("pi_expired_release").status, "active");
  assert.equal((await readInventoryAvailability(env))[0].reserved, 2);

  const canceled = await providerEvidence("pi_expired_release", "canceled", 1301);
  const released = await releaseInventory(env, "pi_expired_release", { now: 1301, evidence: canceled });
  assert.equal(released.status, "released");
  assert.equal((await readInventoryAvailability(env))[0].available, 20);
});

test("retryable payment failure cannot free a full batch before later success", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_retryable_failure", finite(20), { now: 1000 });
  const failed = await providerEvidence("pi_retryable_failure", "failed", 1010);

  await assert.rejects(
    () => releaseInventory(env, "pi_retryable_failure", { now: 1010, evidence: failed }),
    InventoryEvidenceError,
  );
  assert.deepEqual((await readInventoryAvailability(env))[0], {
    sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01",
    capacity: 20, reserved: 20, sold: 0, available: 0, soldOut: true,
  });
  await assert.rejects(
    () => reserveInventory(env, "pi_second_buyer", finite(1), { now: 1011 }),
    InventorySoldOutError,
  );

  const succeeded = await providerEvidence("pi_retryable_failure", "succeeded", 1020);
  const committed = await commitInventory(env, "pi_retryable_failure", { now: 1020, evidence: succeeded });
  const duplicate = await commitInventory(env, "pi_retryable_failure", { now: 1021 });
  assert.equal(committed.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual((await readInventoryAvailability(env))[0], {
    sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01",
    capacity: 20, reserved: 0, sold: 20, available: 0, soldOut: true,
  });
});

test("retryable failure followed by cancellation releases once and only as canceled", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_failure_canceled", finite(20), { now: 1000 });
  const failed = await providerEvidence("pi_failure_canceled", "failed", 1010);
  await assert.rejects(
    () => releaseInventory(env, "pi_failure_canceled", { now: 1010, evidence: failed }),
    InventoryEvidenceError,
  );

  const canceled = await providerEvidence("pi_failure_canceled", "canceled", 1020);
  const released = await releaseInventory(env, "pi_failure_canceled", { now: 1020, evidence: canceled });
  const canceledRetry = await providerEvidence("pi_failure_canceled", "canceled", 1030, { eventId: "evt_failure_canceled_retry" });
  const duplicate = await releaseInventory(env, "pi_failure_canceled", { now: 1030, evidence: canceledRetry });
  assert.equal(released.status, "released");
  assert.equal(released.providerOutcome, "canceled");
  assert.equal(released.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual((await readInventoryAvailability(env))[0], {
    sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01",
    capacity: 20, reserved: 0, sold: 0, available: 20, soldOut: false,
  });
  assert.throws(() => db.sqlite.prepare(
    `UPDATE store_inventory_reservations
        SET provider_outcome = 'failed', release_reason = 'provider_failed'
      WHERE payment_intent_id = 'pi_failure_canceled'`
  ).run(), /CHECK constraint failed/);
});

test("an expiring PaymentIntent with authenticated success commits held stock", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_late_success", finite(3), { now: 1000, holdSeconds: 300 });
  await markInventoryExpired(env, "pi_late_success", { now: 1300 });
  const succeeded = await providerEvidence("pi_late_success", "succeeded", 1301);
  const sold = await commitInventory(env, "pi_late_success", { now: 1301, evidence: succeeded });
  assert.equal(sold.status, "sold");
  assert.equal(sold.providerOutcome, "succeeded");
  assert.deepEqual((await readInventoryAvailability(env))[0], {
    sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01",
    capacity: 20, reserved: 0, sold: 3, available: 17, soldOut: false,
  });
});

test("provider evidence must be authentic, fresh, and bound to the exact PaymentIntent", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_evidence", finite(1), { now: 1000 });
  await assert.rejects(
    () => providerEvidence("pi_evidence", "canceled", 1400, { signatureTimestamp: 1000 }),
    InventoryEvidenceError,
  );
  await assert.rejects(
    () => providerEvidence("pi_evidence", "canceled", 1010, { signature: "0".repeat(64) }),
    InventoryEvidenceError,
  );
  const other = await providerEvidence("pi_other", "canceled", 1010);
  await assert.rejects(() => releaseInventory(env, "pi_evidence", { now: 1010, evidence: other }), InventoryEvidenceError);
  const predating = await providerEvidence("pi_evidence", "canceled", 1010, { created: 999 });
  await assert.rejects(() => releaseInventory(env, "pi_evidence", { now: 1010, evidence: predating }), InventoryEvidenceError);
});

test("active commit requires exact fresh authenticated succeeded evidence", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_commit_auth", finite(1), { now: 1000 });

  await assert.rejects(
    () => commitInventory(env, "pi_commit_auth", { now: 1010 }),
    InventoryEvidenceError,
  );
  await assert.rejects(
    () => commitInventory(env, "pi_commit_auth", { now: 1010, evidence: {
      paymentIntentId: "pi_commit_auth", outcome: "succeeded", eventId: "evt_forged",
      eventCreated: 1010, signatureTimestamp: 1010, verifiedAt: 1010,
    } }),
    InventoryEvidenceError,
  );
  const wrongPaymentIntent = await providerEvidence("pi_other_commit", "succeeded", 1010);
  await assert.rejects(
    () => commitInventory(env, "pi_commit_auth", { now: 1010, evidence: wrongPaymentIntent }),
    InventoryEvidenceError,
  );
  const wrongOutcome = await providerEvidence("pi_commit_auth", "canceled", 1010, { eventId: "evt_commit_canceled" });
  await assert.rejects(
    () => commitInventory(env, "pi_commit_auth", { now: 1010, evidence: wrongOutcome }),
    InventoryEvidenceError,
  );
  const stale = await providerEvidence("pi_commit_auth", "succeeded", 1010, { eventId: "evt_commit_stale" });
  await assert.rejects(
    () => commitInventory(env, "pi_commit_auth", { now: 1311, evidence: stale }),
    InventoryEvidenceError,
  );
  assert.deepEqual((await readInventoryAvailability(env))[0], {
    sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01",
    capacity: 20, reserved: 1, sold: 0, available: 19, soldOut: false,
  });

  const succeeded = await providerEvidence("pi_commit_auth", "succeeded", 1311, { eventId: "evt_commit_exact" });
  const committed = await commitInventory(env, "pi_commit_auth", { now: 1311, evidence: succeeded });
  assert.equal(committed.status, "sold");
  assert.equal(committed.providerEventId, "evt_commit_exact");
  assert.equal(committed.providerOutcome, "succeeded");
  assert.deepEqual((await readInventoryAvailability(env))[0], {
    sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01",
    capacity: 20, reserved: 0, sold: 1, available: 19, soldOut: false,
  });
});

test("transition and retry timestamps are monotonic", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_time", finite(1), { now: 1000 });
  await assert.rejects(() => commitInventory(env, "pi_time", { now: 999 }), InventoryStateError);
  const canceled = await providerEvidence("pi_time", "canceled", 1010);
  await releaseInventory(env, "pi_time", { now: 1010, evidence: canceled });
  await assert.rejects(() => releaseInventory(env, "pi_time", { now: 1009, evidence: canceled }), InventoryStateError);
  assert.throws(() => db.sqlite.prepare(
    "UPDATE store_inventory_reservations SET updated_at = 999, released_at = 999 WHERE payment_intent_id = 'pi_time'"
  ).run(), /CHECK constraint failed/);
});

test("reads require an explicit successful D1 envelope", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  db.readMutator = (_statement, result) => ({ ...result, success: undefined });
  await assert.rejects(() => readInventoryAvailability({ STORE_INVENTORY: db }), InventoryProtocolError);
});

test("availability fails closed on non-integer or inconsistent counters", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  db.readMutator = (statement, result) => {
    if (!statement.sql.includes("FROM store_inventory_batches")) return result;
    return { ...result, results: result.results.map((row) => ({ ...row, reserved_quantity: "0" })) };
  };
  await assert.rejects(() => readInventoryAvailability({ STORE_INVENTORY: db }), InventoryProtocolError);

  db.readMutator = (statement, result) => {
    if (!statement.sql.includes("FROM store_inventory_batches")) return result;
    return { ...result, results: result.results.map((row) => ({ ...row, available_quantity: 19 })) };
  };
  await assert.rejects(() => readInventoryAvailability({ STORE_INVENTORY: db }), InventoryProtocolError);
});

test("batch results require exact count, success, and one mutation per statement", async (t) => {
  for (const mutate of [
    (_statements, results) => results.slice(0, -1),
    (_statements, results) => results.map((result, index) => index === 0 ? { ...result, success: undefined } : result),
    (_statements, results) => results.map((result, index) => index === 1 ? { ...result, meta: { changes: 0 } } : result),
  ]) {
    const db = new SQLiteD1();
    db.batchMutator = mutate;
    await assert.rejects(() => reserveInventory({ STORE_INVENTORY: db }, "pi_bad_batch", finite(1), { now: 1000 }), InventoryProtocolError);
    db.close();
  }
});

test("a reservation with missing or malformed lines fails closed", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { STORE_INVENTORY: db };
  await reserveInventory(env, "pi_bad_lines", finite(1), { now: 1000 });
  db.sqlite.prepare("DELETE FROM store_inventory_reservation_lines WHERE payment_intent_id = ?").run("pi_bad_lines");
  await assert.rejects(() => commitInventory(env, "pi_bad_lines", { now: 1010 }), InventoryProtocolError);

  db.sqlite.prepare(
    `INSERT INTO store_inventory_reservation_lines
       (payment_intent_id, sku, held_quantity, committed_quantity, target_quantity)
     VALUES (?, 'avian-gen3-batch-01', 1, 1, 1)`
  ).run("pi_bad_lines");
  db.sqlite.exec("PRAGMA ignore_check_constraints = ON");
  db.sqlite.prepare("UPDATE store_inventory_reservation_lines SET held_quantity = 'one' WHERE payment_intent_id = ?").run("pi_bad_lines");
  await assert.rejects(() => commitInventory(env, "pi_bad_lines", { now: 1010 }), InventoryProtocolError);
});

test("fresh provisioning verifier binds exact schema, seed, counters, and empty state", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const verified = await verifyFreshInventoryProvisioning({ STORE_INVENTORY: db });
  assert.equal(verified.ok, true);
  assert.equal(verified.schemaSha256, "18857849686a5bc2ca02d766207837a6532abcdb335500a47a63f303e7f05e1b");
  assert.deepEqual(verified.seed, {
    sku: "avian-gen3-batch-01", label: "Avian Visitors Gen 3 Batch 01", capacity: 20, reserved: 0, sold: 0,
  });
});

test("provisioning verifier rejects a poisoned seed preserved by migration ON CONFLICT", async (t) => {
  const db = new SQLiteD1(); t.after(() => db.close());
  db.sqlite.prepare("UPDATE store_inventory_batches SET label = 'Poisoned', capacity = 21").run();
  db.sqlite.exec(readFileSync(new URL("../migrations/0001_store_inventory.sql", import.meta.url), "utf8"));
  await assert.rejects(() => verifyFreshInventoryProvisioning({ STORE_INVENTORY: db }), InventoryConfigurationError);
});

test("provisioning verifier rejects altered schema and preexisting reservation state", async (t) => {
  const altered = new SQLiteD1(); t.after(() => altered.close());
  altered.sqlite.exec("DROP TRIGGER store_inventory_capacity_update");
  altered.sqlite.exec("CREATE TRIGGER store_inventory_capacity_update BEFORE UPDATE ON store_inventory_batches BEGIN SELECT 1; END");
  await assert.rejects(() => verifyFreshInventoryProvisioning({ STORE_INVENTORY: altered }), InventoryConfigurationError);

  const hidden = new SQLiteD1(); t.after(() => hidden.close());
  hidden.sqlite.exec("CREATE TABLE audit_probe (value INTEGER)");
  hidden.sqlite.exec(
    `CREATE TRIGGER quiet_capacity_mutator AFTER INSERT ON audit_probe
     BEGIN UPDATE store_inventory_batches SET capacity = capacity + 1; END`
  );
  hidden.sqlite.exec("CREATE INDEX quiet_inventory_index ON store_inventory_batches(label)");
  hidden.sqlite.exec("CREATE VIEW quiet_inventory_view AS SELECT sku, capacity FROM store_inventory_batches");
  await assert.rejects(() => verifyFreshInventoryProvisioning({ STORE_INVENTORY: hidden }), InventoryConfigurationError);

  const used = new SQLiteD1(); t.after(() => used.close());
  await reserveInventory({ STORE_INVENTORY: used }, "pi_existing", finite(1), { now: 1000 });
  await assert.rejects(() => verifyFreshInventoryProvisioning({ STORE_INVENTORY: used }), InventoryConfigurationError);
});
