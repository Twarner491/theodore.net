-- Separate regional allowance and confirmed signal overrides from affirmative consent.
ALTER TABLE meta_ad_consent ADD COLUMN policy_version TEXT;
ALTER TABLE meta_ad_consent ADD COLUMN decision_id TEXT;
ALTER TABLE meta_ad_consent ADD COLUMN decided_at INTEGER;
ALTER TABLE meta_ad_consent ADD COLUMN signal_bits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meta_ad_consent ADD COLUMN override_bits INTEGER NOT NULL DEFAULT 0;

CREATE TABLE meta_ad_override_challenges (
  anon TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  signal_bits INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  base_choice_ms INTEGER,
  base_decision_id TEXT,
  consumed_at INTEGER,
  decision_id TEXT
);

ALTER TABLE meta_purchase_outbox ADD COLUMN consent_version TEXT;
ALTER TABLE meta_purchase_outbox ADD COLUMN decision_id TEXT;
