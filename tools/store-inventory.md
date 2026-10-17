# Store inventory activation runbook

This source tree contains the finite-inventory authority, but inventory is not
provisioned, bound, deployed, or enabled. Avian Visitors remains unpublished and
coming soon. Do not change those gates until every step below passes in Stripe
test mode and then against a separate production D1 database.

The authority currently recognizes only `avian-gen3-batch-01`. Its migration
seeds one exact row with capacity 20. Checkout derives demand only from the
trusted generated catalog. Ordinary variants without `inventorySku` never need
D1 and keep their current checkout behavior.

## Source contracts

- `migrations/0001_store_inventory.sql` owns the exact schema and pristine
  20-unit seed.
- `lib/store-inventory.js` owns atomic reserve, commit, cancellation-only
  release, expiry marking, availability, strict D1 result validation, and the
  fresh-provisioning verifier.
- `lib/store-inventory-commerce.js` binds the PaymentIntent ID, amount,
  currency, catalog, cart manifest, and finite demand.
- `functions/api/payment-intent.js` performs a primary D1 availability preflight,
  creates no hold, and returns no client secret until Stripe carries the exact
  finite-demand binding. Public and abandoned drafts therefore consume zero
  Batch 01 units.
- `lib/shipping-capture-gate.js` refetches and validates the PaymentIntent inside
  Stripe's signed `payment_intent.amount_capturable_updated` event, atomically
  reserves the exact demand, and only then asks Stripe to capture. A sold-out or
  unavailable authority causes a provider cancellation request, never capture.
- `functions/api/stripe-webhook.js` commits before fulfillment on a signed
  success, retains on `payment_failed`, and releases only on a signed
  `payment_intent.canceled` event.
- `docs/assets/js/store.js` renders ordinary products immediately. Finite
  variants begin sold out, refresh only after a complete authority response,
  and use a 2.5-second hard timeout so an unavailable D1 path cannot blank or
  disable the ordinary store.
- `workers/store-inventory-expiry.js` marks expired holds and asks Stripe to
  cancel them. It never trusts the cancel API response to release stock. The
  signed cancellation webhook performs reclamation.

Cloudflare documents that D1 `batch()` executes its statement sequence as one
transaction and rolls back the sequence on failure. The core uses that boundary
for every counter transition. Availability and reservation reads use a
`first-primary` D1 session.

## 1. Reconcile Pages configuration first

This repository already has `pages_build_output_dir` in `wrangler.toml`, so the
Wrangler file is the Pages configuration source of truth. Cloudflare warns that
it must match the existing dashboard settings before a deployment. In a clean
temporary checkout, download the current settings and compare them manually:

```sh
npx wrangler pages download config theodore-net
```

Do not overwrite this repository's `wrangler.toml` or deploy the downloaded
file. Reconcile every existing variable and binding first. Secrets remain
Cloudflare secrets and must not be copied into source.

After the two D1 databases below exist, add the complete non-inheritable binding
set to `wrangler.toml`. Use the test database for local and preview, and override
the binding for production:

```toml
[[d1_databases]]
binding = "STORE_INVENTORY"
database_name = "avian-store-inventory-test"
database_id = "REPLACE_WITH_TEST_DATABASE_ID"

[[env.preview.d1_databases]]
binding = "STORE_INVENTORY"
database_name = "avian-store-inventory-test"
database_id = "REPLACE_WITH_TEST_DATABASE_ID"

[[env.production.d1_databases]]
binding = "STORE_INVENTORY"
database_name = "avian-store-inventory-production"
database_id = "REPLACE_WITH_PRODUCTION_DATABASE_ID"
```

Cloudflare treats D1 bindings as non-inheritable Pages configuration. If any
other non-inheritable bindings exist in the downloaded settings, repeat the
complete set under both `env.preview` and `env.production`; do not add only D1.

Official references:

- <https://developers.cloudflare.com/pages/functions/wrangler-configuration/>
- <https://developers.cloudflare.com/pages/functions/bindings/#d1-databases>
- <https://developers.cloudflare.com/d1/worker-api/d1-database/>
- <https://developers.cloudflare.com/d1/best-practices/read-replication/>

## 2. Create isolated databases

These commands are instructions only and have not been run:

```sh
npx wrangler d1 create avian-store-inventory-test --location=wnam
npx wrangler d1 create avian-store-inventory-production --location=wnam
```

Record each returned database ID in the reconciled config. Never point preview
or Stripe test-mode secrets at the production database.

## 3. Apply and verify the migration

First exercise a disposable local D1 database:

```sh
npx wrangler d1 migrations apply STORE_INVENTORY --local
npm test
```

For each newly created remote database, list and then apply the migration:

```sh
npx wrangler d1 migrations list avian-store-inventory-test --remote
npx wrangler d1 migrations apply avian-store-inventory-test --remote
npx wrangler d1 migrations list avian-store-inventory-production --remote
npx wrangler d1 migrations apply avian-store-inventory-production --remote
```

Before binding either fresh database to a request-serving deployment, export an
exact snapshot and run the source verifier. It rejects extra relevant schema
objects, the wrong schema hash, a poisoned seed, changed counters, and any
reservation or transition rows:

```sh
npx wrangler d1 export avian-store-inventory-test --remote \
  --output=/private/tmp/avian-store-inventory-test.sql
node tools/verify-store-inventory-export.mjs \
  /private/tmp/avian-store-inventory-test.sql

npx wrangler d1 export avian-store-inventory-production --remote \
  --output=/private/tmp/avian-store-inventory-production.sql
node tools/verify-store-inventory-export.mjs \
  /private/tmp/avian-store-inventory-production.sql
```

The verifier must print `"ok":true`, schema SHA-256
`18857849686a5bc2ca02d766207837a6532abcdb335500a47a63f303e7f05e1b`,
and the exact 20-unit pristine seed. Stop on any other result. This verifier is
for a fresh database only. It intentionally fails after the first reservation.

Cloudflare migration and export command reference:
<https://developers.cloudflare.com/d1/wrangler-commands/>.

## 4. Configure and test expiry cancellation

Copy `workers/wrangler.store-inventory-expiry.example.toml` to a reviewed
environment-specific config and replace the database placeholders. Bind the
local D1 database first and set a Stripe test secret on that Worker:

```sh
npx wrangler secret put STRIPE_SECRET_KEY \
  --config workers/wrangler.store-inventory-expiry.test.toml
npx wrangler dev --test-scheduled \
  --config workers/wrangler.store-inventory-expiry.test.toml
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

That command exercises local D1 only. After local tests pass, use a separately
reviewed test config with the preview database ID and Wrangler's explicit remote
mode to exercise the same flow against the Stripe test-mode D1 database. Never
point the test Worker at production inventory.

The source uses a five-minute schedule in the example config. Cloudflare Cron
Triggers invoke a Worker's `scheduled()` handler and use UTC. A sweep must leave
the D1 row `expiring` and stock reserved until the signed Stripe cancellation
webhook arrives. A failed or ambiguous Stripe API call must also retain stock.

Only after test-mode reconciliation is green should a separately reviewed
production expiry Worker be configured with the production D1 ID and live
Stripe secret. No scheduler or Worker has been provisioned or deployed here.

Official Cron reference:
<https://developers.cloudflare.com/workers/configuration/cron-triggers/>.

## 5. External activation gates

Before changing Avian to sellable:

1. Register the Pages webhook for `payment_intent.amount_capturable_updated`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`, and
   `payment_intent.canceled` in the matching Stripe mode.
2. Exercise create, address update, authorization, capture, signed success,
   retryable failure, terminal cancellation, webhook retry, expiry, and catalog
   outage against the test database. Confirm all counters after every case.
3. Verify the launch-specific abuse controls. Public PaymentIntent drafts only
   preflight availability and consume no stock. A hold begins only after Stripe
   authenticates payment and emits the signed capturable event. Keep the current
   rate limit, and consider Turnstile or a tighter finite-cart rule as additional
   protection against payment-provider cost and draft spam, but never move the
   stock mutation back into the public draft route.
4. Add monitoring for `inventory_commit_pending`,
   `inventory_cancellation_pending`, `inventory_reservation_unavailable`, stuck
   `expiring` rows, and Stripe/D1 disagreement. Confirm signed webhook retries
   are enabled and rehearse Stripe event redelivery.
5. Verify both test and live catalogs still omit the assembled frame. Then add
   final price, test and live Stripe Price IDs, weight, and only after every
   other product gate is resolved, change `published` and `comingSoon` in one
   reviewed launch change.

Never recover an incident by deleting `inventorySku`, removing the D1 binding,
or releasing stock from an unsigned Stripe API response. Those changes would
turn a safe closed failure into an oversell risk.
