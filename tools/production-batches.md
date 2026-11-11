# Automatic production batches

Implementation contract, November 10, 2026. The release coordinator records deployment and migration status separately. This replaces the separate scratch simulator/manual allocation controls; its old three/five fixtures are not production settings.

The stable continuous frame variant accepts paid orders without a lifetime quantity ceiling. A batch is a real order grouping for production, with a fixed allocation and immutable order membership. Filling a group immediately opens its successor. This is not a finite inventory limit on overall order intake, and the sizing heuristic does not establish assembly capacity, delivery dates, or a conversion-optimal scarcity number.

## Storage and first-use transition

`migrations/0007_production_batches.sql` creates the ledger in the existing `STORE_INVENTORY` D1 binding. Migration 0006 is reserved by the separate TikTok branch. The migration inserts **no orders, counts, or historical dates**.

`ensureProductionBatches(env, { productId, now })` is the automatic, idempotent first-use transition. The current implementation supports `avian-visitors`. It reads the genuine existing inventory rows for `avian-gen3-batch-01` and `avian-gen3-batch-02` inside the initialization transaction and preserves their capacity and sold quantities as historical aggregates. Their original opening timestamps are unknown and stored as null. No synthetic provider orders are created from these totals.

New continuous orders explicitly start in **Batch 3**, with a fixed **15-frame experimental baseline** under policy `count-display-v1`. The count-display experiment changes only whether the genuine count is shown; this capacity is not a conversion-optimal finding. The legacy runs are closed to this new intake route, including an underfilled Batch 2. Existing finite Batch 2 PaymentIntents remain governed by their original catalog/inventory bindings and can finish the genuine last slot. After a verified legacy success, `syncLegacyProductionBatches` mirrors the authoritative finite sold counters; it does not allocate that order to Batch 3 or count it again as a dated continuous-product purchase. Mirror updates cannot lower historical counters.

The captured November 10 local bootstrap fixture is Batch 1 capacity/sold 20/20 and Batch 2 capacity/sold 30/29. **Those values are local fixtures, not migration defaults or instructions to overwrite production.** Production initialization would read the actual legacy values at that time. Missing legacy inventory rows fail closed at bootstrap. Dated sales history is not needed to calculate the fixed experimental allocation.

No manual batch-size setter or size-control page exists in this backend. `readProductionBatch` itself is read-only. An integration caller can perform `ensureProductionBatches` before public reads or intake; subsequent ensures return the existing allocation.

## Policy `count-display-v1`

The display experiment holds real capacity constant while randomizing only count visibility. `productionBatchPolicy()` opens the initial run with 15 frames. Rollover supplies the current run's `previousCapacity`, so every successor preserves the established capacity. It does not resize an already opened run, including older local v1/v2 runs. Invalid prior capacities fail closed.

Each newly opened run records its fixed capacity, experiment `avian-count-v1`, reason `fixed-count-display-experiment`, prior capacity and `conversionOptimal: false`. **No demand-history query runs at bootstrap, public reads or rollover for sizing.** There is no seven-day multiplier, rounding-to-five calculation, waiting period, private size setting or automatic response to conversion during the experiment. Views and carts never consume places; verified paid orders do.

When a real run fills, its successor opens in the same transaction. Overall intake remains continuous until paused. Refunds do not rewrite the original paid allocation or reopen historical groups. The remaining number describes unassigned places in a real production group, not completed shelf stock or a delivery guarantee.

### Historical calibration, no longer the active policy

The earlier `paid-median-v2` heuristic used verified dated paid history: all-frame Pacific Nov 3–9 units `[16,13,0,0,4,2,2]`, median two, multiplied by seven and rounded to five, yielding 15. UTC grouping would have yielded 30. Teddy rejected those operating assumptions as an answer to conversion optimization. The current baseline remains 15 solely to hold the display experiment's underlying allocation constant.

`lib/production-demand.js` remains a read-only research helper for authentic dated finite and continuous payments; the allocator no longer imports or calls it. Prior local v1/v2 evidence and immutable opened batches are preserved. See the [direct conversion experiment plan](/Users/twarn/Repositories/ai-working/scratch/avian-growth-20261110/batch-conversion-experiment.md) for the distinction between a count-display test and a future real-capacity policy test.

## API contract

All helpers live in `lib/store-production-batches.js` and use `STORE_INVENTORY` with `withSession('first-primary')`.

```js
await ensureProductionBatches(env, { productId: 'avian-visitors' });

await readProductionBatch(env, { productId: 'avian-visitors' });
// { productId, ordinal, label, capacity, committed, remaining, policyVersion }
// null only if the ledger has not yet been initialized.

await allocatePaidProductionOrder(env, {
  provider: 'stripe', // or a verified TikTok adapter using 'tiktok'
  orderId: paymentIntent.id,
  productId: 'avian-visitors',
  quantity: 2,
  paidAt: verifiedPaidTimestamp,
});
// { provider, orderId, productId, quantity, paidAt,
//   allocations: [{ ordinal, label, quantity }], duplicate }

await syncLegacyProductionBatches(env);
```

`now` is an optional integer timestamp for deterministic local tests. Per-order quantity is 1–99, matching the existing finite-order safety boundary; there is no cap on the number of paid orders or batches. Provider identity is namespaced, so a Stripe ID cannot collide with a TikTok ID.

**Authentication belongs to the integration boundary.** The allocator does not fetch Stripe or verify signatures. Only call it after the existing signed/provider-refetched successful-payment, cart, amount, address, and catalog checks. The public availability endpoint must never accept an order ID or call allocation from buyer-supplied data. Payment drafts and capturable-but-not-paid callbacks do not consume a production place. No additional finite inventory hold is created for this continuous variant.

For Stripe, use the **first authenticated `payment_intent.succeeded` event's creation time** after refetching and validating the paid intent/charge. `charge.created` describes Charge creation and can precede manual capture, so it is not a reliable paid-conversion timestamp. A duplicate callback with the same provider, order ID, product, and quantity returns the **first recorded timestamp and allocations**, even if the new event has a different event creation time. A changed quantity or product conflicts. `allocateProductionPayment` writes the preserved timestamp as integer-seconds text in Stripe metadata `production_paid_at`, alongside `production_batches`, after the verified ledger allocation. Retry callbacks use that first ledger timestamp even if their own event creation time differs. Existing conflicting allocation or paid-time metadata blocks continuation; a failed metadata write retries before sending a receipt. The `production-allocation-v2-<pi>` idempotency key keeps this metadata update distinct from the older allocation-only write. Retry through this API after an uncertain network outcome; do not create a replacement provider identity.

## Atomicity and invariants

For allocation, the helper reads the current batch/revision and any existing order allocation, plans any split across successive runs, then issues one D1 transaction:

1. Insert a short-lived guard whose trigger requires the state revision observed during planning.
2. Insert the unique paid order.
3. Write allocation rows, update committed counters, close each filled batch, and create each successor with its fixed policy evidence.
4. Advance the accepting pointer/revision and remove the guard.

A concurrent writer causes the guard to abort the entire transaction. The helper starts a fresh `first-primary` session and retries up to eight times, rather than repeatedly planning from a prior session's potentially stale replica snapshot. A retryable callback error after sustained contention is preferable to dropping a paid order; an identical retry is idempotent. An exact final-slot purchase still creates its empty successor in the same transaction. Larger orders can be split: at capacity 15, a 65-frame paid order receives 15 each in Batches 3–6 and five in Batch 7. It retains that assignment thereafter.

Database checks prevent committed quantities exceeding capacity. A unique partial index permits only one accepting run per product. Triggers prevent changing opened capacities/policy evidence, reopening a closed run, decreasing recorded counters, or editing/deleting paid order allocations. The legacy aggregate is tracked separately from newly allocated units. There are no customer contact details in this ledger.

[Cloudflare's D1 Database API documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/) states that `batch()` executes transactionally and rolls back its sequence if a statement fails. It also documents `withSession('first-primary')` for an initial primary read and sequential consistency for subsequent session queries. These properties were checked against the official documentation updated June 22, 2026; the implementation relies on them. This is not a JavaScript mutex across workers.

The internal read helper returns the current label/count, capacity, committed units, and policy version for server callers. The **public GET endpoint exposes only `group`, `ordinal`, `remaining`, and `paused`**; it does not expose capacity, policy evidence, future operational dates, or an order ledger. Production batch grouping is recorded when a paid order is allocated, not guaranteed by an earlier page view; the integration must not present the displayed batch as an immutable prepayment delivery promise.

## Focused verification

`node --test tests/store-production-batches.test.mjs` currently passes 14 tests using SQLite and D1 transaction/session adapters. They exercise real SQL constraints and rollback, including:

- Empty migration and concurrent bootstrap from genuine legacy aggregates.
- Duplicate callback identity, preserved paid time, provider namespaces, and changed-quantity conflicts.
- Concurrent final-slot purchases and concurrent callbacks for one order.
- A concurrency retry with an earlier session retaining stale reads; the retry must start on the primary again.
- Multi-run quantity splits and immediate rollover on an exact fill.
- An injected write failure that must roll back order, allocations, counters, and successor together.
- Legacy finite-success synchronization without continuous-order double counting.
- Fixed experiment capacity despite changing demand, preserved prior allocation, unchanged already-open capacity, and invalid capacity rejection.
- Database immutability/oversell rejection and invalid-input rejection before initialization.

The isolated Wrangler runtime and payment integration have additional historical checks recorded below. SQLite tests alone are not proof of a deployed migration, provider integration, or Meta/TikTok channel synchronization. Consult the release record for current deployment status.


## Historical local runtime verification

The prior local Cloudflare Pages Functions verification ran at `http://127.0.0.1:8766/store/avian-visitors/`, with a persistent local D1 database at `/Users/twarn/Repositories/ai-working/scratch/avian-growth-20261110/backend-history-v2-state`. The former v1 state is preserved separately, without resizing any opened run. This replaces the scratch Python preview on that port. There is no injected catalog override, simulated batch endpoint, batch-control page, or local size setter. The rejected control server on 8768 is stopped.

The gitignored `.dev.vars` contains only Stripe test credentials, a newly generated local webhook signing secret, and disabled recovery. Email/subscriber service credentials were not copied. Do not replace these with live keys for local testing.

Reproduction from this worktree (Wrangler 4.151.1 and the existing MkDocs environment):

```sh
mkdocs build
npx --no-install wrangler d1 migrations apply avian-store-inventory-test --local --persist-to /Users/twarn/Repositories/ai-working/scratch/avian-growth-20261110/backend-history-v2-state
npx --no-install wrangler pages dev site --ip 127.0.0.1 --port 8766 --persist-to /Users/twarn/Repositories/ai-working/scratch/avian-growth-20261110/backend-history-v2-state
```

The explicit `--local` migration and local runtime leave remote databases unchanged. Existing local state is preserved on restart. The local history import contains the 46 genuine finite paid records / 49 units from the read-only November 10 refresh, including their authenticated payment dates, plus the matching inventory. It is not a production migration or invented test sales. Those dated records supported the historical v2 calibration; the current fixed policy requires the genuine legacy inventory rows but does not read dated history at bootstrap. Customer contact information and credentials were not imported. Current initialization reads the genuine inventory already present in its own database.

Historical v2 validation: **424 storefront Node tests, 524 companion ops tests**, and MkDocs build pass. The previous 60 Python tests passed; Python source is unchanged in this revision. The companion ops worktree is `/Users/twarn/Repositories/ai-working/worktrees/theodore-ops/continuous-production-batches`; it maps the stable variant to the existing frame BOM, packaging and $699 price, and displays immutable accepted batch assignments in orders/packing slips.

During the prior v1 verification, a separate actual Wrangler runtime and isolated QA D1 database were exercised with three real **Stripe test-mode** PaymentIntents: quantities 20, 10 and 2. Checkout created and finalized them, test-card authorization entered the existing capture gate, locally signed callbacks caused provider refetch/capture, and verified paid callbacks recorded allocations before notification. Counts progressed **Batch 3:30 → 10 → Batch 4:30 → 28**. Authorizations did not allocate. Duplicate callbacks left counts and immutable payment metadata unchanged; an invalid signature returned400. Final callback replays also passed after the review fixes. Test notification flags were marked handled, and no email sender was configured. These test payments affected only Stripe test records and the separate local QA database; that old QA state is preserved. The later historical v2 preview bootstrapped Batch 3 with 15 from genuine history. No further Stripe payments were created for the v2 calibration; its sizing and rollover paths were covered by the then-current SQLite/D1 transaction tests. These are historical payment results, not evidence that the current experiment release was tested with live charges.

Evidence is in `/Users/twarn/Repositories/ai-working/scratch/avian-growth-20261110/`: `local-backend-e2e-results.json`, `local-backend-replay.log`, `tests-production-ledger-full.log`, `tests-production-python.log`, `tests-ops-continuous-full.log`, and `build-production-batches.log`.

In-app browser verification covered 375px mobile and 1280px desktop, both themes, quiet batch label, compact remaining quantity, and the real Stripe Address Element on checkout. Production dates and sizing controls are absent. The historical v2 HTTP response was `{"group":"avian-visitors","ordinal":3,"remaining":15,"paused":false}`. The historical stored v2 policy evidence was Pacific daily units `[16,13,0,0,4,2,2]`, median two, seven-day cadence and five-unit granularity. Historical v2 desktop/mobile proof and runtime evidence are `history-sized-batch-desktop.png`, `history-sized-batch-mobile.png` and `local-history-policy-evidence.json`; historical v2 validation logs are `tests-history-v2-node.log`, `tests-history-v2-ops.log` and `build-history-v2.log`. The dynamic Meta feed honors the same pause/readiness authority while retaining its stable product ID and ordinary made-to-order publishing quantity; that publishing quantity is not the production-run remainder.

The separate TikTok chat still needs to connect paid continuous-frame orders to this allocator and honor pause when publishing availability. Its existing finite-inventory-only order adapter will skip the new nonfinite variant until updated. See the scratch `production-channel-compatibility.md` report. That historical local verification did not launch a channel or create a live payment. Current release status is recorded separately.

## Count-display experiment and forward disable

The storefront uses experiment `avian-count-v1`, with stable 50/50 `label` and `count` arms derived from the existing persistent anonymous visitor identity. The unsigned FNV-1a hash of `avian-count-v1:<anon>` assigns values below `0x80000000` to `label`, all others to `count`; the collector independently verifies that relationship. No query parameter changes assignment. Visitors without a usable persistent identity are not enrolled.

The label arm conceals the remaining-count span with `visibility: hidden` and `aria-hidden`, preserving the same geometry as the count arm. Both use the same fully visible, uncovered, foreground purchase-area box for eligibility. Paused intake is not eligible. `batch_exposure` records the experiment/arm plus the genuine underlying `batch_ordinal` and `batch_remaining` for both groups, deduplicated by distinct state per tab/session. The reporting cohort uses each visitor's first accepted exposure, not only those who later add to cart. Existing `batch_view` events remain compatible but are not the experiment's primary denominator.

The companion collector requires the nullable exposure columns in `0023_batch_view_events.sql` and experiment columns in `0024_count_display_experiment.sql`. Apply additive schema changes before deploying the collector, and deploy that collector before the participating storefront. Historical events keep null experiment fields; no exposure is backfilled. The local Pages preview does not run this separate collector, so handler/database tests and live release verification are distinct checks.

`docs/assets/js/store.js` contains the source constant `COUNT_EXPERIMENT_ENABLED = true`. A forward build with it set to `false` shows the batch label alone for everyone, stops assignment/observation, and suppresses both `batch_exposure` and `batch_view` beacons. It preserves the current checkout, successful-payment handling, ledger and accepted order allocations. Use that forward artifact to disable the experiment; do not roll back to a payment implementation that cannot recognize newly accepted continuous orders.

## Existing friends-and-family voucher

The approved existing `avian-holidays-2026` campaign carries from `assembled-batch-2` to `assembled-continuous` for Avian Visitors only. Compatibility requires its original `voucher-avian-holidays-2026` quota, $100 amount, the continuous production group and contiguous-US shipping contract. No campaign row, code, quota capacity, redemption history or expiry is rewritten. Old accepted finite callbacks remain valid.

The resolver preserves the campaign's original `build_id` and returns a separate verified `matched_build_id` for pricing. The payment handler applies $100 once to that eligible cart line before tax, even for multiple frames or a cart with accessories. Both old and continuous orders reserve and settle the same ten-redemption quota through the existing atomic inventory path; failed ambiguous capture retains its one hold, cancellation releases it once, and duplicate paid callbacks do not redeem again. New authorizations still honor the original expiry; previously admitted holds retain their existing settlement behavior.
