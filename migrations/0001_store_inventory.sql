PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS store_inventory_batches (
  sku TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (reserved_quantity + sold_quantity <= capacity)
);

CREATE TRIGGER IF NOT EXISTS store_inventory_capacity_insert
BEFORE INSERT ON store_inventory_batches
WHEN NEW.reserved_quantity < 0
  OR NEW.sold_quantity < 0
  OR NEW.reserved_quantity + NEW.sold_quantity > NEW.capacity
BEGIN
  SELECT RAISE(ABORT, 'store_inventory_capacity_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS store_inventory_capacity_update
BEFORE UPDATE OF capacity, reserved_quantity, sold_quantity ON store_inventory_batches
WHEN NEW.reserved_quantity < 0
  OR NEW.sold_quantity < 0
  OR NEW.reserved_quantity + NEW.sold_quantity > NEW.capacity
BEGIN
  SELECT RAISE(ABORT, 'store_inventory_capacity_exceeded');
END;

CREATE TABLE IF NOT EXISTS store_inventory_reservations (
  payment_intent_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'expiring', 'sold', 'released')),
  expires_at INTEGER NOT NULL,
  update_token TEXT,
  update_expires_at INTEGER,
  release_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sold_at INTEGER,
  released_at INTEGER,
  provider_event_id TEXT,
  provider_event_created_at INTEGER,
  provider_outcome TEXT CHECK (provider_outcome IN ('canceled', 'failed', 'succeeded') OR provider_outcome IS NULL),
  commerce_amount INTEGER,
  commerce_currency TEXT,
  commerce_manifest_sha256 TEXT,
  commerce_catalog_sha256 TEXT,
  commerce_demand_sha256 TEXT,
  commerce_binding_sha256 TEXT,
  CHECK (expires_at >= created_at),
  CHECK (updated_at >= created_at),
  CHECK (sold_at IS NULL OR (sold_at >= created_at AND sold_at = updated_at)),
  CHECK (released_at IS NULL OR (released_at >= created_at AND released_at = updated_at)),
  CHECK (provider_event_created_at IS NULL OR
    (provider_event_created_at >= created_at AND provider_event_created_at <= updated_at)),
  CHECK (status <> 'released' OR (
    provider_outcome = 'canceled'
    AND release_reason IN ('provider_canceled', 'expired_provider_canceled')
  )),
  CHECK (
    (commerce_amount IS NULL
      AND commerce_currency IS NULL
      AND commerce_manifest_sha256 IS NULL
      AND commerce_catalog_sha256 IS NULL
      AND commerce_demand_sha256 IS NULL
      AND commerce_binding_sha256 IS NULL)
    OR
    (typeof(commerce_amount) = 'integer' AND commerce_amount > 0
      AND typeof(commerce_currency) = 'text' AND length(commerce_currency) = 3
      AND commerce_currency = lower(commerce_currency)
      AND typeof(commerce_manifest_sha256) = 'text' AND length(commerce_manifest_sha256) = 64
      AND commerce_manifest_sha256 NOT GLOB '*[^0-9a-f]*'
      AND typeof(commerce_catalog_sha256) = 'text' AND length(commerce_catalog_sha256) = 64
      AND commerce_catalog_sha256 NOT GLOB '*[^0-9a-f]*'
      AND typeof(commerce_demand_sha256) = 'text' AND length(commerce_demand_sha256) = 64
      AND commerce_demand_sha256 NOT GLOB '*[^0-9a-f]*'
      AND typeof(commerce_binding_sha256) = 'text' AND length(commerce_binding_sha256) = 64
      AND commerce_binding_sha256 NOT GLOB '*[^0-9a-f]*')
  )
);

CREATE INDEX IF NOT EXISTS store_inventory_reservations_expiry
ON store_inventory_reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS store_inventory_reservation_lines (
  payment_intent_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  held_quantity INTEGER NOT NULL CHECK (held_quantity >= 0),
  committed_quantity INTEGER NOT NULL CHECK (committed_quantity >= 0),
  target_quantity INTEGER NOT NULL CHECK (target_quantity >= 0),
  PRIMARY KEY (payment_intent_id, sku),
  FOREIGN KEY (payment_intent_id) REFERENCES store_inventory_reservations(payment_intent_id) ON DELETE CASCADE,
  FOREIGN KEY (sku) REFERENCES store_inventory_batches(sku) ON DELETE RESTRICT
);

-- A transition inserts a short-lived guard row as the first statement in its
-- D1 batch and deletes it as the last. The trigger asserts the reservation
-- state inside that same database transaction, before any counters can move.
CREATE TABLE IF NOT EXISTS store_inventory_transition_guards (
  guard_id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL,
  expected_state TEXT NOT NULL CHECK (
    expected_state IN ('active_live', 'active_any', 'active_expired', 'expiring')
  ),
  observed_at INTEGER NOT NULL,
  FOREIGN KEY (payment_intent_id) REFERENCES store_inventory_reservations(payment_intent_id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS store_inventory_transition_guard
BEFORE INSERT ON store_inventory_transition_guards
WHEN NOT EXISTS (
  SELECT 1
    FROM store_inventory_reservations AS reservation
   WHERE reservation.payment_intent_id = NEW.payment_intent_id
     AND (
       (NEW.expected_state = 'active_live'
         AND reservation.status = 'active'
         AND reservation.expires_at > NEW.observed_at
         AND NEW.observed_at >= reservation.updated_at)
       OR (NEW.expected_state = 'active_any'
         AND reservation.status = 'active'
         AND NEW.observed_at >= reservation.updated_at)
       OR (NEW.expected_state = 'active_expired'
         AND reservation.status = 'active'
         AND reservation.expires_at <= NEW.observed_at
         AND NEW.observed_at >= reservation.updated_at)
       OR (NEW.expected_state = 'expiring'
         AND reservation.status = 'expiring'
         AND NEW.observed_at >= reservation.updated_at)
     )
)
BEGIN
  SELECT RAISE(ABORT, 'store_inventory_state_conflict');
END;

INSERT INTO store_inventory_batches (
  sku, label, capacity, reserved_quantity, sold_quantity, created_at, updated_at
) VALUES (
  'avian-gen3-batch-01', 'Avian Visitors Gen 3 Batch 01', 20, 0, 0, unixepoch(), unixepoch()
)
ON CONFLICT (sku) DO NOTHING;
