import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readProductionDemandHistory } from "../lib/production-demand.js";

const DAY = 86400, NOW = Date.parse("2026-11-10T20:00:00Z") / 1000;
const END = Math.floor(NOW / DAY) * DAY, PRODUCT = "avian-visitors";
const SKU1 = "avian-gen3-batch-01", SKU2 = "avian-gen3-batch-02";
class Statement {
  constructor(db, sql, values = []) { Object.assign(this, { db, sql, values }); }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.values) }; }
}
function fixture(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  for (const migration of ["0001_store_inventory.sql", "0002_avian_batch_2.sql", "0007_production_batches.sql"])
    db.exec(readFileSync(new URL("../migrations/" + migration, import.meta.url), "utf8"));
  db.prepare("INSERT INTO production_batch_state VALUES (?,3,0,?,?)").run(PRODUCT, END - 40 * DAY, END - 40 * DAY);
  for (const ordinal of [3, 4]) db.prepare("INSERT INTO production_batches (product_id,ordinal,capacity,policy_version,policy_evidence,opened_at,closed_at) VALUES (?,?,100,'fixture','{}',?,?)")
    .run(PRODUCT, ordinal, END - 40 * DAY, ordinal === 3 ? END - 39 * DAY : null);
  const env = { STORE_INVENTORY: { withSession(mode) { assert.equal(mode, "first-primary"); return { prepare: sql => new Statement(db, sql) }; } } };
  // These are synthetic test provider identities, never imported as real sales.
  function legacy(id, lines, paidAt, { soldAt = paidAt + 1, verified = true, status = "sold" } = {}) {
    db.prepare(`INSERT INTO store_inventory_reservations
      (payment_intent_id,status,expires_at,created_at,updated_at,sold_at,provider_event_id,provider_event_created_at,provider_outcome)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, status, paidAt + DAY, paidAt - 60, soldAt,
        status === "sold" ? soldAt : null, verified && status === "sold" ? "evt_" + id : null,
        verified && status === "sold" ? paidAt : null, verified && status === "sold" ? "succeeded" : null);
    for (const [sku, qty] of lines) {
      db.prepare("INSERT INTO store_inventory_reservation_lines VALUES (?,?,?,?,?)").run(id, sku, qty, qty, qty);
      if (status === "sold") db.prepare("UPDATE store_inventory_batches SET sold_quantity=sold_quantity+? WHERE sku=?").run(qty, sku);
    }
  }
  function continuous(id, qty, paidAt, provider = "stripe") {
    db.prepare("INSERT INTO production_paid_orders VALUES (?,?,?,?,?,?)").run(provider, id, PRODUCT, qty, paidAt, NOW);
  }
  return { db, env, legacy, continuous, read: (incoming, options = {}) => readProductionDemandHistory(env, { now: NOW, incoming, timeZone: "UTC", ...options }) };
}

test("verified historical paid dates immediately supply complete UTC windows and genuine zero-sale days", async t => {
  const h = fixture(t);
  h.legacy("pi_first", [[SKU1, 1]], END - 12 * DAY + 100);
  const units = [2, 14, 4, 0, 4, 2, 1];
  units.forEach((qty, index) => { if (qty) h.legacy("pi_day_" + index, [[SKU2, qty]], END - (7 - index) * DAY + 50); });
  const before = h.db.prepare("SELECT total_changes() n").get().n;
  const result = await h.read();
  assert.equal(result.available, true); assert.equal(result.exposureKnown, false);
  assert.equal(result.timeZone, "UTC"); assert.equal(result.windows[7].complete, true);
  assert.deepEqual(result.daily.slice(-7).map(day => day.units), units);
  assert.equal(result.windows[7].units, 27); assert.equal(result.windows[7].orders, 6);
  assert.equal(result.windows[14].complete, false);
  assert.equal(result.windows[14].observedDays, 11);
  assert.equal(h.db.prepare("SELECT total_changes() n").get().n, before, "all history queries are read-only");
});

test("signed provider success time defines the sale day rather than late processing time", async t => {
  const h = fixture(t);
  h.legacy("pi_anchor", [[SKU1, 1]], END - 20 * DAY);
  h.legacy("pi_delayed", [[SKU2, 2]], END - 3 * DAY + 30, { soldAt: END - DAY + 30 });
  const result = await h.read();
  assert.equal(result.daily.find(day => day.start === END - 3 * DAY).units, 2);
  assert.equal(result.daily.find(day => day.start === END - DAY).units, 0);
});

test("mixed finite and continuous units share one payment count; mirrors and allocation splits add nothing", async t => {
  const h = fixture(t), paidAt = END - 2 * DAY + 10;
  h.legacy("pi_anchor", [[SKU1, 1]], END - 20 * DAY);
  h.legacy("pi_mixed", [[SKU1, 2], [SKU2, 1]], paidAt);
  h.continuous("pi_mixed", 4, paidAt);
  h.continuous("same_provider_id", 2, paidAt, "stripe");
  h.continuous("same_provider_id", 3, paidAt, "tiktok");
  h.db.prepare("INSERT INTO production_allocations VALUES ('stripe','pi_mixed',?,3,2)").run(PRODUCT);
  h.db.prepare("INSERT INTO production_allocations VALUES ('stripe','pi_mixed',?,4,2)").run(PRODUCT);
  h.db.prepare("INSERT INTO production_batches (product_id,ordinal,capacity,committed_quantity,historical_quantity,legacy_sku,policy_version,policy_evidence,closed_at) VALUES (?,1,20,20,20,?,'mirror','{}',?)").run(PRODUCT, SKU1, END);
  const result = await h.read();
  assert.equal(result.windows[7].orders, 3); assert.equal(result.windows[7].units, 12);
});

test("incoming historical payment merges before rollover, duplicate incoming preserves the original paid date", async t => {
  const h = fixture(t), paidAt = END - DAY + 10;
  h.legacy("pi_anchor", [[SKU1, 1]], END - 20 * DAY);
  h.legacy("pi_incoming", [[SKU2, 2]], paidAt);
  const input = { provider: "stripe", orderId: "pi_incoming", productId: PRODUCT, quantity: 3, paidAt };
  const result = await h.read(input);
  assert.equal(result.windows[7].orders, 1); assert.equal(result.windows[7].units, 5);
  h.continuous(input.orderId, input.quantity, paidAt);
  assert.deepEqual((await h.read({ ...input, paidAt: NOW })).windows, result.windows);
  assert.equal((await h.read({ ...input, quantity: 4 })).reason, "incoming_payment_conflict");
});

test("first partial observed date and current partial UTC date never become complete zero-day evidence", async t => {
  const h = fixture(t);
  h.legacy("pi_first", [[SKU1, 1]], END - 3 * DAY + 40000);
  h.continuous("pi_today", 10, NOW - 10);
  const result = await h.read();
  assert.equal(result.totalUnits, 11);
  assert.equal(result.daily.length, 2);
  assert.deepEqual(result.daily.map(day => day.units), [0, 0]);
  assert.equal(result.firstPartialDay.units, 1);
  assert.equal(result.windows[3].complete, false);
  assert.equal(result.windows[3].units, 0);
  assert.ok(result.daily.every(day => day.end <= END));
});

test("missing dated sold units or mismatched legacy counters are unavailable instead of fabricated zero history", async t => {
  const h = fixture(t);
  h.legacy("pi_undated", [[SKU1, 2]], END - 10 * DAY, { verified: false });
  const result = await h.read();
  assert.equal(result.available, false); assert.equal(result.reason, "legacy_history_inconsistent");
  assert.deepEqual(result.daily, []); assert.deepEqual(result.windows, {});
  assert.deepEqual(result.legacyCoverage.find(row => row.sku === SKU1), { sku: SKU1, soldUnits: 2, committedUnits: 2, datedUnits: 0, invalidSoldRows: 1, complete: false });
  h.db.prepare("UPDATE store_inventory_batches SET sold_quantity=1 WHERE sku=?").run(SKU2);
  assert.equal((await h.read()).reason, "legacy_history_inconsistent");
});

test("a malformed zero-quantity sold row cannot pass reconciliation merely because its sums match", async t => {
  const h = fixture(t);
  h.legacy("pi_anchor", [[SKU1, 1]], END - 20 * DAY);
  h.legacy("pi_invalid_zero", [[SKU2, 0]], END - 3 * DAY);
  const result = await h.read();
  assert.equal(result.available, false);
  assert.equal(result.reason, "legacy_history_inconsistent");
  assert.equal(result.legacyCoverage.find(row => row.sku === SKU2).invalidSoldRows, 1);
});

test("active holds do not count as paid history and empty history does not imply zero demand", async t => {
  const h = fixture(t);
  h.legacy("pi_held", [[SKU1, 2]], END - DAY, { status: "active" });
  const result = await h.read();
  assert.equal(result.reason, "no_paid_history"); assert.equal(result.available, false);
  assert.deepEqual(result.daily, []); assert.equal(result.totalUnits, null);
});

test("missing schema and invalid incoming evidence cannot silently produce rates", async t => {
  const h = fixture(t);
  await assert.rejects(h.read({ provider: "stripe", orderId: "pi_future", productId: PRODUCT, quantity: 1, paidAt: NOW + 1 }), TypeError);
  h.db.exec("DROP TABLE production_paid_orders");
  const result = await h.read();
  assert.equal(result.available, false); assert.equal(result.reason, "storage_unavailable");
  assert.deepEqual(result.windows, {});
});

test("Pacific business dates group the same verified payments across UTC boundaries", async t => {
  const h = fixture(t);
  h.legacy("pi_anchor", [[SKU1, 1]], END - 20 * DAY);
  h.legacy("pi_early_utc", [[SKU2, 2]], Date.parse("2026-11-04T07:59:59Z") / 1000);
  h.continuous("pi_midnight_pacific", 3, Date.parse("2026-11-04T08:00:00Z") / 1000);
  const utc = await h.read(), pacific = await h.read(null, { timeZone: "America/Los_Angeles" });
  assert.equal(utc.daily.find(day => day.date === "2026-11-04").units, 5);
  assert.equal(pacific.daily.find(day => day.date === "2026-11-03").units, 2);
  assert.equal(pacific.daily.find(day => day.date === "2026-11-04").units, 3);
  assert.equal(pacific.windowEnd, Date.parse("2026-11-10T08:00:00Z") / 1000);
  assert.equal((await readProductionDemandHistory(h.env, { now: NOW })).timeZone, "America/Los_Angeles");
  await assert.rejects(h.read(null, { timeZone: "Europe/London" }), TypeError);
});

test("Pacific spring and fall windows use calendar dates with 23-hour and 25-hour days", async t => {
  const h = fixture(t);
  h.legacy("pi_anchor", [[SKU1, 1]], Date.parse("2026-02-01T20:00:00Z") / 1000);
  for (const [label, now, date, hours, start, end] of [
    ["spring", "2026-03-10T20:00:00Z", "2026-03-08", 23, "2026-03-08T08:00:00Z", "2026-03-09T07:00:00Z"],
    ["fall", "2026-11-03T20:00:00Z", "2026-11-01", 25, "2026-11-01T07:00:00Z", "2026-11-02T08:00:00Z"],
  ]) {
    const at = Date.parse(now) / 1000;
    const result = await h.read(null, { now: at, timeZone: "America/Los_Angeles" });
    const day = result.daily.find(day => day.date === date);
    assert.equal(day.start, Date.parse(start) / 1000, label);
    assert.equal(day.end, Date.parse(end) / 1000, label);
    assert.equal(day.end - day.start, hours * 3600, label);
    assert.equal(result.windows[7].observedDays, 7, label);
    assert.equal(result.windows[7].end - result.windows[7].start, (7 * 24 + (hours - 24)) * 3600, label);
  }
});
