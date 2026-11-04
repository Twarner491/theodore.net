-- Reduce Batch 2 only. Preserve all sales, holds, and payment associations.
-- The existing capacity constraint rejects this if sold + reserved exceeds 30.
UPDATE store_inventory_batches
SET capacity = 30, updated_at = unixepoch()
WHERE sku = 'avian-gen3-batch-02' AND capacity = 100;
