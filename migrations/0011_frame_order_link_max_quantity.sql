-- Existing private links retain their original allowance.
ALTER TABLE frame_order_links ADD COLUMN max_quantity INTEGER
  CHECK (max_quantity IS NULL OR max_quantity BETWEEN quantity AND 99);
