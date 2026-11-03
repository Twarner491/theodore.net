-- Batch 2 is independent of Batch 1 reservations, sales, and payment callbacks.
INSERT INTO store_inventory_batches
  (sku, label, capacity, reserved_quantity, sold_quantity, created_at, updated_at)
VALUES
  ('avian-gen3-batch-02', 'Avian Visitors Gen 3 Batch 02', 100, 0, 0, unixepoch(), unixepoch())
ON CONFLICT(sku) DO NOTHING;
