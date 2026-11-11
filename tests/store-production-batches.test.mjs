import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  allocatePaidProductionOrder, ensureProductionBatches, productionBatchPolicy,
  readProductionBatch, syncLegacyProductionBatches,
} from "../lib/store-production-batches.js";

class Statement {
  constructor(db, sql, bindings = []) { this.db = db; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.bindings) }; }
}
class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001_store_inventory.sql", "0002_avian_batch_2.sql", "0005_avian_batch_2_capacity_30.sql", "0007_production_batches.sql"]) {
      this.sqlite.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
    }
    this.sqlite.exec("UPDATE store_inventory_batches SET sold_quantity=20 WHERE sku='avian-gen3-batch-01'; UPDATE store_inventory_batches SET sold_quantity=29 WHERE sku='avian-gen3-batch-02'");
    // Synthetic authenticated-history-shaped test rows, never a production seed.
    // Both actual run totals are represented; business-date counts are deliberate.
    let serial = 0;
    const sold = (sku, quantity, paidAt) => {
      const id = "pi_history_" + ++serial;
      this.sqlite.prepare(`INSERT INTO store_inventory_reservations
        (payment_intent_id,status,expires_at,created_at,updated_at,sold_at,provider_event_id,provider_event_created_at,provider_outcome)
        VALUES (?,'sold',?,?,?,?,?,?,'succeeded')`).run(id, paidAt+1800, paidAt-1, paidAt+1, paidAt+1, "evt_history_"+serial, paidAt);
      this.sqlite.prepare("INSERT INTO store_inventory_reservation_lines (payment_intent_id,sku,held_quantity,committed_quantity,target_quantity) VALUES (?,?,?,?,?)").run(id,sku,quantity,quantity,quantity);
    };
    sold("avian-gen3-batch-01",4,Date.parse("2026-10-29T12:00:00-07:00")/1000);
    for(let i=0;i<7;i++) sold("avian-gen3-batch-01",1,Date.parse("2026-10-29T12:00:00-07:00")/1000+i);
    for(let i=0;i<9;i++) sold("avian-gen3-batch-01",1,Date.parse("2026-11-03T12:00:00-08:00")/1000+i);
    for(const [date,quantity] of [[3,7],[4,13],[7,4],[8,2],[9,2],[10,1]])
      for(let i=0;i<quantity;i++) sold("avian-gen3-batch-02",1,Date.parse(`2026-11-${String(date).padStart(2,'0')}T12:00:00-08:00`)/1000+i);

  }
  prepare(sql) { return new Statement(this, sql); }
  withSession(constraint) { assert.equal(constraint, "first-primary"); return this; }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s, i) => {
        if (this.failAfter === i) { this.failAfter = null; throw Error("simulated database write failure"); }
        const result = this.sqlite.prepare(s.sql).run(...s.bindings);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      });
      this.sqlite.exec("COMMIT"); return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  rows(sql) { return this.sqlite.prepare(sql).all().map(row => ({ ...row })); }
}
const NOW = Date.parse("2026-11-10T22:00:00Z") / 1000;
const DAY = 86400;
function fixture(t) { const db = new SQLiteD1(); t.after(() => db.sqlite.close()); return { db, env: { STORE_INVENTORY: db } }; }
function paid(orderId, quantity = 1, paidAt = NOW) { return { provider: "stripe", orderId, productId: "avian-visitors", quantity, paidAt }; }
const allocate = (env, id, quantity = 1, now = NOW, paidAt = now) => allocatePaidProductionOrder(env, paid(id, quantity, paidAt), { now });

test("migration creates an empty production ledger rather than synthetic historical orders", t => {
  const { db } = fixture(t);
  assert.equal(db.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='production_paid_orders'").length, 1);
  assert.equal(db.rows("SELECT COUNT(*) n FROM production_paid_orders")[0].n, 0);
});

test("bootstrap copies real legacy aggregates without fabricating paid orders and starts Batch 3", async t => {
  const { db, env } = fixture(t);
  assert.deepEqual(db.rows("SELECT * FROM production_paid_orders"), []);
  assert.equal(await readProductionBatch(env), null);
  const states = await Promise.all([ensureProductionBatches(env, { now: NOW }), ensureProductionBatches(env, { now: NOW })]);
  for (const s of states) assert.deepEqual([s.ordinal, s.capacity, s.remaining], [3, 15, 15]);
  assert.deepEqual(db.rows("SELECT ordinal,capacity,committed_quantity,historical_quantity FROM production_batches ORDER BY ordinal"), [
    { ordinal: 1, capacity: 20, committed_quantity: 20, historical_quantity: 20 },
    { ordinal: 2, capacity: 30, committed_quantity: 29, historical_quantity: 29 },
    { ordinal: 3, capacity: 15, committed_quantity: 0, historical_quantity: 0 },
  ]);
  assert.equal(db.rows("SELECT COUNT(*) n FROM production_paid_orders")[0].n, 0);
});

test("same paid order replays its original allocation and paid time after rollover", async t => {
  const { env } = fixture(t);
  const first = await allocate(env, "pi_first");
  await allocate(env, "pi_fill", 14);
  const again = await allocate(env, "pi_first", 1, NOW + 10, NOW + 9);
  assert.deepEqual(first.allocations, [{ ordinal: 3, label: "Batch 3", quantity: 1 }]);
  assert.deepEqual(again, { ...first, duplicate: true });
  assert.equal((await readProductionBatch(env)).remaining, 15);
});

test("duplicate changed quantity conflicts without consuming more units; provider namespaces remain distinct", async t => {
  const { env, db } = fixture(t);
  await allocate(env, "same", 2);
  await assert.rejects(allocate(env, "same", 3), /different|conflict/i);
  await allocatePaidProductionOrder(env, { ...paid("same", 2), provider: "tiktok" }, { now: NOW });
  assert.equal((await readProductionBatch(env)).remaining, 11);
  assert.equal(db.rows("SELECT COUNT(*) n FROM production_paid_orders")[0].n, 2);
});

test("concurrent last-slot payments allocate once each across successive real runs", async t => {
  const { env, db } = fixture(t);
  await allocate(env, "pi_earlier", 14);
  const results = await Promise.all([allocate(env, "pi_a"), allocate(env, "pi_b")]);
  assert.deepEqual(results.map(r => r.allocations[0].ordinal).sort(), [3, 4]);
  const current = await readProductionBatch(env);
  assert.deepEqual([current.ordinal, current.capacity, current.remaining], [4, 15, 14]);
  assert.equal(db.rows("SELECT COUNT(*) n FROM production_batches WHERE committed_quantity>capacity")[0].n, 0);
  assert.equal(db.rows("SELECT SUM(quantity) n FROM production_allocations")[0].n, 16);
});

test("concurrent callbacks for one paid order do not allocate twice", async t => {
  const { env, db } = fixture(t);
  const results = await Promise.all([allocate(env, "pi_once", 2), allocate(env, "pi_once", 2)]);
  assert.equal(results.filter(r => r.duplicate).length, 1);
  assert.equal((await readProductionBatch(env)).remaining, 13);
  assert.equal(db.rows("SELECT SUM(quantity) n FROM production_allocations")[0].n, 2);
});

test("a concurrency retry starts a fresh primary session rather than reusing stale replica reads", async t => {
  const { env, db } = fixture(t);
  await allocate(env, "pi_before_replica_race", 14);
  // A D1 session promises sequential consistency, not that every later read
  // observes another session's writes. Retaining its earlier snapshot is legal.
  db.withSession = mode => {
    assert.equal(mode, "first-primary");
    const cache = new Map();
    class SnapshotStatement extends Statement {
      bind(...bindings) { return new SnapshotStatement(db, this.sql, bindings); }
      async all() {
        const key = JSON.stringify([this.sql, this.bindings]);
        if (!cache.has(key)) cache.set(key, await super.all());
        return structuredClone(cache.get(key));
      }
    }
    return {
      prepare: sql => new SnapshotStatement(db, sql),
      async batch(statements) { const result = await db.batch(statements); cache.clear(); return result; },
    };
  };
  const paidOrders = await Promise.all([allocate(env, "pi_replica_a"), allocate(env, "pi_replica_b")]);
  assert.deepEqual(paidOrders.map(order => order.allocations[0].ordinal).sort(), [3, 4]);
  assert.equal((await readProductionBatch(env)).remaining, 14);
});

test("one larger paid order splits across batches and exact final-slot fills open a successor", async t => {
  const { env } = fixture(t);
  const result = await allocate(env, "pi_many", 65);
  assert.deepEqual(result.allocations, [
    { ordinal: 3, label: "Batch 3", quantity: 15 },
    { ordinal: 4, label: "Batch 4", quantity: 15 },
    { ordinal: 5, label: "Batch 5", quantity: 15 },
    { ordinal: 6, label: "Batch 6", quantity: 15 },
    { ordinal: 7, label: "Batch 7", quantity: 5 },
  ]);
  await allocate(env, "pi_exact", 10);
  assert.deepEqual(await readProductionBatch(env), { productId: "avian-visitors", ordinal: 8, label: "Batch 8", capacity: 15, committed: 0, remaining: 15, policyVersion: "count-display-v1" });
});

test("a database failure rolls back paid order, allocation, rollover, and counters together", async t => {
  const { env, db } = fixture(t);
  await allocate(env, "pi_prior", 14);
  const before = await readProductionBatch(env);
  db.failAfter = 3;
  await assert.rejects(allocate(env, "pi_retry", 2), /database write failure/);
  assert.deepEqual(await readProductionBatch(env), before);
  assert.equal(db.rows("SELECT COUNT(*) n FROM production_paid_orders WHERE order_id='pi_retry'")[0].n, 0);
  const retried = await allocate(env, "pi_retry", 2);
  assert.deepEqual(retried.allocations.map(a => [a.ordinal, a.quantity]), [[3, 1], [4, 1]]);
});

test("old finite success mirrors genuine legacy count without consuming Batch 3 or fabricating policy orders", async t => {
  const { env, db } = fixture(t);
  await ensureProductionBatches(env, { now: NOW });
  db.sqlite.exec("UPDATE store_inventory_batches SET sold_quantity=30 WHERE sku='avian-gen3-batch-02'");
  await syncLegacyProductionBatches(env, { now: NOW + 1 });
  await syncLegacyProductionBatches(env, { now: NOW + 2 });
  assert.equal(db.rows("SELECT historical_quantity FROM production_batches WHERE ordinal=2")[0].historical_quantity, 30);
  assert.equal((await readProductionBatch(env)).remaining, 15);
  assert.equal(db.rows("SELECT COUNT(*) n FROM production_paid_orders")[0].n, 0);
});

test("count-display experiment freezes real capacity despite demand changes", () => {
  for (const units of [[16,13,0,0,4,2,2], [11,14,4,0,4,2,1], [50,60,70,80,90,100,110], [0,0,0,0,0,0,0]]) {
    const result = productionBatchPolicy({ history: { daily: units } });
    assert.equal(result.capacity, 15);
    assert.equal(result.evidence.experiment, "avian-count-v1");
    assert.equal(result.evidence.conversionOptimal, false);
  }
  assert.equal(productionBatchPolicy({ previousCapacity: 25 }).capacity, 25, "preserve an already established experimental allocation");
  for (const capacity of [0, -1, 1.5, "15", NaN]) assert.throws(() => productionBatchPolicy({ previousCapacity: capacity }), /capacity/i);
});

test("experiment rollover preserves capacity even after complete-day sales change", async t => {
  const {env,db}=fixture(t);
  await ensureProductionBatches(env,{now:NOW});
  await allocate(env,"pi_today",15,NOW);
  await allocate(env,"pi_future",15,NOW + 14 * DAY);
  const state=await readProductionBatch(env);
  assert.deepEqual([state.ordinal,state.capacity,state.remaining],[5,15,15]);
  const evidence=JSON.parse(db.rows("SELECT policy_evidence FROM production_batches WHERE ordinal=5")[0].policy_evidence);
  assert.equal(evidence.reason,"fixed-count-display-experiment");
  assert.equal(evidence.previousCapacity,15);
  assert.equal(db.rows("SELECT capacity FROM production_batches WHERE ordinal=3")[0].capacity,15);
});

test("database rejects capacity rewrites, overselling, and historical allocation edits", async t => {
  const { env, db } = fixture(t);
  await allocate(env, "pi_immutable", 1);
  assert.throws(() => db.sqlite.exec("UPDATE production_batches SET capacity=50 WHERE ordinal=3"), /immutable|capacity/i);
  assert.throws(() => db.sqlite.exec("UPDATE production_batches SET committed_quantity=31 WHERE ordinal=3"), /CHECK|capacity/i);
  assert.throws(() => db.sqlite.exec("UPDATE production_allocations SET quantity=2"), /immutable/i);
  assert.throws(() => db.sqlite.exec("DELETE FROM production_allocations"), /immutable/i);
});

test("invalid paid input cannot initialize or alter the production ledger", async t => {
  const { env, db } = fixture(t);
  for (const bad of [0, -1, 1.5, 100, "1", true]) {
    await assert.rejects(allocate(env, "pi_bad", bad), /quantity/i);
  }
  await assert.rejects(allocatePaidProductionOrder(env, { ...paid("pi_bad"), paidAt: NOW + 100 }, { now: NOW }), /time/i);
  await assert.rejects(allocatePaidProductionOrder(env, { ...paid("pi_bad"), productId: "other" }, { now: NOW }), /product/i);
  assert.equal(db.rows("SELECT COUNT(*) n FROM production_paid_orders")[0].n, 0);
  assert.equal(db.rows("SELECT COUNT(*) n FROM production_batch_state")[0].n, 0);
});
