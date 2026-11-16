-- Checkout admission only. A link never holds or allocates production units.
CREATE TABLE IF NOT EXISTS frame_order_links (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  expires_at INTEGER NOT NULL CHECK (expires_at > 0)
);
