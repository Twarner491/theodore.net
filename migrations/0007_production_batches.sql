-- Production batch ledger schema. No historical order data is seeded here.
-- 0006 is reserved by the separate TikTok channel integration.
CREATE TABLE IF NOT EXISTS production_batch_state (
  product_id TEXT PRIMARY KEY,
  current_ordinal INTEGER NOT NULL CHECK (current_ordinal >= 3),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  observed_from INTEGER NOT NULL CHECK (observed_from >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE TABLE IF NOT EXISTS production_batches (
  product_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  committed_quantity INTEGER NOT NULL DEFAULT 0 CHECK (committed_quantity >= 0 AND committed_quantity <= capacity),
  historical_quantity INTEGER NOT NULL DEFAULT 0 CHECK (historical_quantity >= 0 AND historical_quantity <= committed_quantity),
  legacy_sku TEXT UNIQUE,
  policy_version TEXT NOT NULL,
  policy_evidence TEXT NOT NULL CHECK (json_valid(policy_evidence)),
  opened_at INTEGER CHECK (opened_at IS NULL OR opened_at >= 0),
  closed_at INTEGER CHECK (closed_at IS NULL OR closed_at >= COALESCE(opened_at, 0)),
  PRIMARY KEY (product_id, ordinal),
  FOREIGN KEY (product_id) REFERENCES production_batch_state(product_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS production_one_accepting_batch
ON production_batches(product_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS production_paid_orders (
  provider TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  paid_at INTEGER NOT NULL CHECK (paid_at >= 0),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0),
  PRIMARY KEY (provider, order_id),
  FOREIGN KEY (product_id) REFERENCES production_batch_state(product_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS production_paid_window ON production_paid_orders(product_id, paid_at);

CREATE TABLE IF NOT EXISTS production_allocations (
  provider TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  PRIMARY KEY (provider, order_id, ordinal),
  FOREIGN KEY (provider, order_id) REFERENCES production_paid_orders(provider, order_id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id, ordinal) REFERENCES production_batches(product_id, ordinal) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS production_batch_guards (
  guard_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  FOREIGN KEY (product_id) REFERENCES production_batch_state(product_id) ON DELETE RESTRICT
);
CREATE TRIGGER IF NOT EXISTS production_batch_revision_guard
BEFORE INSERT ON production_batch_guards
WHEN COALESCE((SELECT revision FROM production_batch_state WHERE product_id=NEW.product_id), -1) <> NEW.expected_revision
BEGIN SELECT RAISE(ABORT, 'production_batch_revision_conflict'); END;

CREATE TRIGGER IF NOT EXISTS production_batch_definition_immutable
BEFORE UPDATE OF product_id,ordinal,capacity,legacy_sku,policy_version,policy_evidence,opened_at ON production_batches
BEGIN SELECT RAISE(ABORT, 'production_batch_definition_immutable'); END;
CREATE TRIGGER IF NOT EXISTS production_batch_counters_monotonic
BEFORE UPDATE OF committed_quantity,historical_quantity ON production_batches
WHEN NEW.committed_quantity < OLD.committed_quantity OR NEW.historical_quantity < OLD.historical_quantity
BEGIN SELECT RAISE(ABORT, 'production_batch_history_immutable'); END;
CREATE TRIGGER IF NOT EXISTS production_batch_closed_immutable
BEFORE UPDATE OF closed_at ON production_batches
WHEN OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT OLD.closed_at
BEGIN SELECT RAISE(ABORT, 'production_batch_closed_immutable'); END;
CREATE TRIGGER IF NOT EXISTS production_paid_order_immutable
BEFORE UPDATE ON production_paid_orders
BEGIN SELECT RAISE(ABORT, 'production_paid_order_immutable'); END;
CREATE TRIGGER IF NOT EXISTS production_paid_order_no_delete
BEFORE DELETE ON production_paid_orders
BEGIN SELECT RAISE(ABORT, 'production_paid_order_immutable'); END;
CREATE TRIGGER IF NOT EXISTS production_allocation_immutable
BEFORE UPDATE ON production_allocations
BEGIN SELECT RAISE(ABORT, 'production_allocation_immutable'); END;
CREATE TRIGGER IF NOT EXISTS production_allocation_no_delete
BEFORE DELETE ON production_allocations
BEGIN SELECT RAISE(ABORT, 'production_allocation_immutable'); END;
