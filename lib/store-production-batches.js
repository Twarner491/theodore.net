// A paid-order production grouping ledger. Callers must authenticate the provider
// and validate the paid cart before allocation; public cart drafts never call it.
const PRODUCT = "avian-visitors";
const POLICY_VERSION = "count-display-v1";
const EXPERIMENT_CAPACITY = 15;
const MAX_ATTEMPTS = 8;
const LEGACY_SKUS = ["avian-gen3-batch-01", "avian-gen3-batch-02"];

export class ProductionBatchError extends Error {
  constructor(message, code = "production_batch_unavailable") {
    super(message); this.name = "ProductionBatchError"; this.code = code;
  }
}
function product(value = PRODUCT) {
  if (value !== PRODUCT) throw new ProductionBatchError("Unsupported production product.", "production_batch_input");
  return value;
}
function time(value = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ProductionBatchError("Production time must be an integer timestamp.", "production_batch_input");
  return value;
}
function session(env) {
  const db = env && env.STORE_INVENTORY;
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function" || typeof db.withSession !== "function") {
    throw new ProductionBatchError("Production batch storage is not configured.");
  }
  return db.withSession("first-primary");
}
async function rows(db, sql, ...bindings) {
  const result = await db.prepare(sql).bind(...bindings).all();
  if (!result || result.success === false || !Array.isArray(result.results)) throw new ProductionBatchError("Production batch read failed.");
  return result.results;
}
async function transact(db, statements) {
  const result = await db.batch(statements);
  if (!Array.isArray(result) || result.length !== statements.length || result.some(r => !r || r.success === false)) {
    throw new ProductionBatchError("Production batch transaction returned an invalid result.");
  }
}
async function current(db, productId) {
  return (await rows(db, `SELECT s.product_id,s.current_ordinal,s.revision,s.observed_from,
    b.capacity,b.committed_quantity,b.policy_version,b.closed_at
    FROM production_batch_state s JOIN production_batches b
    ON b.product_id=s.product_id AND b.ordinal=s.current_ordinal WHERE s.product_id=?`, productId))[0] || null;
}
function publicBatch(row) {
  if (!row) return null;
  if (row.closed_at !== null || row.committed_quantity >= row.capacity) throw new ProductionBatchError("The accepting production batch is inconsistent.");
  return { productId: row.product_id, ordinal: row.current_ordinal, label: `Batch ${row.current_ordinal}`,
    capacity: row.capacity, committed: row.committed_quantity, remaining: row.capacity - row.committed_quantity,
    policyVersion: row.policy_version };
}

export function productionBatchPolicy({ previousCapacity = null } = {}) {
  // Hold the real allocation constant while randomizing only count visibility.
  // Fifteen is the experiment's baseline, not an estimated conversion optimum.
  const capacity = previousCapacity === null ? EXPERIMENT_CAPACITY : previousCapacity;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new ProductionBatchError("Invalid experiment capacity.");
  return { capacity, policyVersion: POLICY_VERSION, evidence: {
    experiment: "avian-count-v1", reason: "fixed-count-display-experiment", previousCapacity,
    capacity, conversionOptimal: false,
  } };
}

export async function readProductionBatch(env, options = {}) {
  return publicBatch(await current(session(env), product(options.productId)));
}

// Automatic first-use transition: freeze the experiment's baseline in Batch 3. The
// genuine legacy rows remain distinct; old finite payments keep their old gate.
export async function ensureProductionBatches(env, options = {}) {
  const productId = product(options.productId), now = time(options.now), db = session(env);
  const existing = await current(db, productId);
  if (existing) return publicBatch(existing);
  const legacy = await rows(db, "SELECT sku FROM store_inventory_batches WHERE sku IN (?,?)", ...LEGACY_SKUS);
  if (legacy.length !== 2) throw new ProductionBatchError("Legacy production inventory must be reconciled before transition.");
  const policy = productionBatchPolicy();
  const statements = [db.prepare("INSERT INTO production_batch_state (product_id,current_ordinal,revision,observed_from,created_at) VALUES (?,3,0,?,?)").bind(productId, now, now)];
  for (let i = 0; i < LEGACY_SKUS.length; i++) {
    // Read counts inside this transaction, rather than copying a possibly stale
    // preflight snapshot. Aggregate history is not a fabricated timed order.
    statements.push(db.prepare(`INSERT INTO production_batches
      (product_id,ordinal,capacity,committed_quantity,historical_quantity,legacy_sku,policy_version,policy_evidence,opened_at,closed_at)
      SELECT ?,?,capacity,sold_quantity,sold_quantity,sku,'legacy-inventory-snapshot',
      json_object('source','store_inventory_batches','observedAt',?,'capacity',capacity,'sold',sold_quantity),NULL,?
      FROM store_inventory_batches WHERE sku=?`).bind(productId, i + 1, now, now, LEGACY_SKUS[i]));
  }
  statements.push(db.prepare(`INSERT INTO production_batches
    (product_id,ordinal,capacity,policy_version,policy_evidence,opened_at) VALUES (?,3,?,?,?,?)`)
    .bind(productId, policy.capacity, policy.policyVersion, JSON.stringify(policy.evidence), now));
  try { await transact(db, statements); }
  catch (error) {
    if (!/UNIQUE constraint failed: production_batch_state\.product_id/.test(String(error))) throw error;
    const initialized = await current(session(env), productId);
    if (!initialized) throw error;
  }
  return publicBatch(await current(session(env), productId));
}

function guard(db, row) {
  const id = crypto.randomUUID();
  return { id, statement: db.prepare("INSERT INTO production_batch_guards (guard_id,product_id,expected_revision) VALUES (?,?,?)")
    .bind(id, row.product_id, row.revision) };
}
function finish(db, row, id, ordinal = row.current_ordinal) {
  return [
    db.prepare("UPDATE production_batch_state SET current_ordinal=?,revision=revision+1 WHERE product_id=?").bind(ordinal, row.product_id),
    db.prepare("DELETE FROM production_batch_guards WHERE guard_id=?").bind(id),
  ];
}
function revisionConflict(error) { return /production_batch_revision_conflict/.test(String(error)); }

export async function syncLegacyProductionBatches(env, options = {}) {
  const productId = product(options.productId);
  await ensureProductionBatches(env, options);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const db = session(env);
    const row = await current(db, productId), lock = guard(db, row);
    const statements = [lock.statement];
    for (const sku of LEGACY_SKUS) {
      statements.push(db.prepare(`UPDATE production_batches SET
        historical_quantity=(SELECT sold_quantity FROM store_inventory_batches WHERE sku=?),
        committed_quantity=(SELECT sold_quantity FROM store_inventory_batches WHERE sku=?)
        WHERE product_id=? AND legacy_sku=?`).bind(sku, sku, productId, sku));
    }
    statements.push(...finish(db, row, lock.id));
    try { await transact(db, statements); return publicBatch(await current(db, productId)); }
    catch (error) { if (!revisionConflict(error)) throw error; }
  }
  throw new ProductionBatchError("Production batch history is busy; retry the verified callback.");
}

function normalizePaid(input, now) {
  const productId = product(input && input.productId);
  if (!input || !["stripe", "tiktok"].includes(input.provider) || typeof input.orderId !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(input.orderId)) {
    throw new ProductionBatchError("A verified provider order identity is required.", "production_batch_input");
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) {
    throw new ProductionBatchError("Production quantity must be between 1 and 99 units per order.", "production_batch_input");
  }
  const paidAt = time(input.paidAt);
  if (input.paidAt === undefined || paidAt > now) throw new ProductionBatchError("Paid time must be an authoritative past timestamp.", "production_batch_input");
  return { provider: input.provider, orderId: input.orderId, productId, quantity: input.quantity, paidAt };
}
async function existingOrder(db, input) {
  const result = await rows(db, `SELECT o.product_id,o.quantity,o.paid_at,a.ordinal,a.quantity AS allocated
    FROM production_paid_orders o LEFT JOIN production_allocations a
    ON a.provider=o.provider AND a.order_id=o.order_id
    WHERE o.provider=? AND o.order_id=? ORDER BY a.ordinal`, input.provider, input.orderId);
  if (!result.length) return null;
  if (result[0].product_id !== input.productId || result[0].quantity !== input.quantity) {
    throw new ProductionBatchError("The paid order conflicts with a different recorded quantity or product.", "production_batch_conflict");
  }
  const allocations = result.map(r => ({ ordinal: r.ordinal, label: `Batch ${r.ordinal}`, quantity: r.allocated }));
  if (allocations.some(a => !Number.isInteger(a.ordinal) || !Number.isInteger(a.quantity)) || allocations.reduce((n,a) => n+a.quantity,0) !== input.quantity) {
    throw new ProductionBatchError("The recorded paid allocation is inconsistent.");
  }
  return { ...input, paidAt: result[0].paid_at, allocations, duplicate: true };
}

export async function allocatePaidProductionOrder(env, input, options = {}) {
  const now = time(options.now), order = normalizePaid(input, now);
  await ensureProductionBatches(env, { productId: order.productId, now });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Sequential consistency alone need not expose a concurrent worker's newer
    // revision. Start each retry on the primary rather than reuse replica reads.
    const db = session(env);
    const row = await current(db, order.productId);
    publicBatch(row);
    const existing = await existingOrder(db, order);
    if (existing) return existing;
    const lock = guard(db, row);
    const statements = [lock.statement, db.prepare(`INSERT INTO production_paid_orders
      (provider,order_id,product_id,quantity,paid_at,recorded_at) VALUES (?,?,?,?,?,?)`)
      .bind(order.provider, order.orderId, order.productId, order.quantity, order.paidAt, now)];
    let ordinal = row.current_ordinal, capacity = row.capacity, committed = row.committed_quantity, remaining = order.quantity;
    const allocations = [];
    while (remaining > 0) {
      const quantity = Math.min(remaining, capacity - committed);
      allocations.push({ ordinal, label: `Batch ${ordinal}`, quantity });
      statements.push(db.prepare(`INSERT INTO production_allocations (provider,order_id,product_id,ordinal,quantity) VALUES (?,?,?,?,?)`)
        .bind(order.provider, order.orderId, order.productId, ordinal, quantity));
      committed += quantity; remaining -= quantity;
      statements.push(db.prepare("UPDATE production_batches SET committed_quantity=? WHERE product_id=? AND ordinal=?")
        .bind(committed, order.productId, ordinal));
      if (committed === capacity) {
        statements.push(db.prepare("UPDATE production_batches SET closed_at=? WHERE product_id=? AND ordinal=?").bind(now, order.productId, ordinal));
        const policy = productionBatchPolicy({ previousCapacity: capacity });
        ordinal += 1; capacity = policy.capacity; committed = 0;
        statements.push(db.prepare(`INSERT INTO production_batches (product_id,ordinal,capacity,policy_version,policy_evidence,opened_at) VALUES (?,?,?,?,?,?)`)
          .bind(order.productId, ordinal, capacity, policy.policyVersion, JSON.stringify(policy.evidence), now));
      }
    }
    statements.push(...finish(db, row, lock.id, ordinal));
    try {
      await transact(db, statements);
      return { ...order, allocations, duplicate: false };
    } catch (error) { if (!revisionConflict(error)) throw error; }
  }
  throw new ProductionBatchError("Production batch allocation is busy; retry the verified payment callback.");
}
