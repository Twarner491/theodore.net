-- Recovery data has separate tables. These records never reserve stock or vouchers.
CREATE TABLE IF NOT EXISTS store_recovery_journeys (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, anon TEXT, session TEXT NOT NULL,
  source TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL, cart_json TEXT NOT NULL DEFAULT '[]', checkout_at INTEGER
);
CREATE TABLE IF NOT EXISTS store_recovery_contacts (
  email_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL,
  subscriber_id TEXT, unsubscribed_at INTEGER, suppression_reason TEXT
);
CREATE TABLE IF NOT EXISTS store_recovery_journey_contacts (
  journey_id TEXT NOT NULL REFERENCES store_recovery_journeys(id), email_hash TEXT NOT NULL REFERENCES store_recovery_contacts(email_hash),
  purpose TEXT NOT NULL CHECK(purpose IN ('newsletter','cart_email','checkout')),
  created_at INTEGER NOT NULL, copy_version TEXT NOT NULL, placement TEXT NOT NULL,
  product TEXT, build TEXT, PRIMARY KEY(journey_id,email_hash,purpose)
);
CREATE TABLE IF NOT EXISTS store_recovery_requests (
  journey_id TEXT NOT NULL REFERENCES store_recovery_journeys(id), request_id TEXT NOT NULL,
  action TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(journey_id,request_id)
);
CREATE TABLE IF NOT EXISTS store_recovery_events (
  id TEXT PRIMARY KEY, journey_id TEXT NOT NULL REFERENCES store_recovery_journeys(id),
  type TEXT NOT NULL, created_at INTEGER NOT NULL, detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS store_recovery_events_journey ON store_recovery_events(journey_id,created_at);
CREATE TABLE IF NOT EXISTS store_recovery_restores (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, journey_id TEXT NOT NULL REFERENCES store_recovery_journeys(id),
  cart_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS store_recovery_outbox (
  id TEXT PRIMARY KEY, journey_id TEXT NOT NULL REFERENCES store_recovery_journeys(id),
  email_hash TEXT NOT NULL REFERENCES store_recovery_contacts(email_hash), kind TEXT NOT NULL CHECK(kind IN ('newsletter','cart_email')),
  created_at INTEGER NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  payload_json TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER,
  first_attempt_at INTEGER, provider_id TEXT, completed_at INTEGER, last_error TEXT
);
CREATE TABLE IF NOT EXISTS store_recovery_checkouts (
  payment_intent_id TEXT PRIMARY KEY, journey_id TEXT NOT NULL REFERENCES store_recovery_journeys(id),
  email_hash TEXT, cart_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS store_recovery_purchases (
  payment_intent_id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, journey_id TEXT,
  email_hash TEXT, cart_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS store_recovery_purchases_email ON store_recovery_purchases(email_hash);
CREATE TABLE IF NOT EXISTS store_recovery_rate_limits (
  key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
);
