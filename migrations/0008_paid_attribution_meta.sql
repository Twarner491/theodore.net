-- Anonymous campaign arrivals stay separate from original discovery and count experiments.
CREATE TABLE IF NOT EXISTS paid_ad_arrivals (
  anon TEXT NOT NULL, touch_id TEXT NOT NULL, experiment TEXT NOT NULL,
  arm TEXT NOT NULL, tag TEXT NOT NULL, received_at INTEGER NOT NULL,
  client_at INTEGER NOT NULL, session TEXT NOT NULL, path TEXT NOT NULL,
  detail_json TEXT NOT NULL, PRIMARY KEY (anon,touch_id)
);
CREATE INDEX IF NOT EXISTS paid_ad_arrivals_cohort ON paid_ad_arrivals(experiment,anon,received_at);

CREATE TABLE IF NOT EXISTS meta_ad_consent (
  anon TEXT PRIMARY KEY, allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  choice_at INTEGER NOT NULL, choice_at_ms INTEGER NOT NULL,
  received_at INTEGER NOT NULL, revoked_at INTEGER, revoked_at_ms INTEGER
);

CREATE TABLE IF NOT EXISTS meta_purchase_outbox (
  payment_intent_id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
  stripe_event_id TEXT NOT NULL, event_time INTEGER NOT NULL, created_at INTEGER NOT NULL,
  anon TEXT NOT NULL, consent_at INTEGER NOT NULL, consent_at_ms INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('preview','live')), payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('preview','queued','sending','sent','expired','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
  lease_token TEXT, lease_until INTEGER, sent_at INTEGER, last_error TEXT
);
CREATE INDEX IF NOT EXISTS meta_purchase_outbox_due ON meta_purchase_outbox(status,next_attempt_at);
