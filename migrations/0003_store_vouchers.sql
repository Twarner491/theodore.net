-- Voucher redemptions share the atomic reservation/settlement path with frame stock.
-- The actual code is generated privately; only its hash is provisioned outside Git.
INSERT INTO store_inventory_batches
  (sku, label, capacity, reserved_quantity, sold_quantity, created_at, updated_at)
VALUES
  ('voucher-avian-holidays-2026', 'Avian Visitors holiday voucher redemptions', 10, 0, 0, unixepoch(), unixepoch())
ON CONFLICT(sku) DO NOTHING;

CREATE TABLE IF NOT EXISTS store_vouchers (
  id TEXT PRIMARY KEY,
  code_sha256 TEXT UNIQUE CHECK (code_sha256 IS NULL OR length(code_sha256) = 64),
  amount_off INTEGER NOT NULL CHECK (amount_off > 0),
  product_id TEXT NOT NULL,
  build_id TEXT NOT NULL,
  quota_sku TEXT NOT NULL REFERENCES store_inventory_batches(sku),
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
);

-- Disabled until the private code hash is supplied. Reapplying never resets usage.
INSERT INTO store_vouchers
  (id, code_sha256, amount_off, product_id, build_id, quota_sku, expires_at, active)
VALUES
  ('avian-holidays-2026', NULL, 10000, 'avian-visitors', 'assembled-batch-2',
   'voucher-avian-holidays-2026', 1798790400, 0)
ON CONFLICT(id) DO NOTHING;
