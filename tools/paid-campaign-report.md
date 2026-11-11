# Paid campaign report

This local report joins the three-arm November ad experiment to verified successful frame orders. It makes no network requests and emits aggregate JSON and CSV without visitor or payment identifiers. Keep its private input exports under `~/Repositories/ai-working/scratch/`, outside the repository.

Run:

```sh
node tools/report-paid-campaign.mjs /absolute/private/input.json /absolute/private/report
```

Input shape:

```json
{
  "start": 1794355200,
  "end": 1794960000,
  "asOf": 1795564800,
  "spend": { "reel-a": 30000, "species": 30000, "photo": 30000 },
  "arrivals": [],
  "stripe": { "complete": true, "capturedAt": "2026-11-25T00:00:00Z", "payments": [] }
}
```

Dates above illustrate the schema, not approved delivery dates. Set delivery bounds in Unix seconds, with an exclusive end, then set `asOf` to the common complete observation cutoff of both exports. Spend is **actual delivered USD cents**, not the $300 configured ceiling. Omit an arm's spend when it has not been reconciled; the report then leaves its CPA and contribution after ads blank.

Export the **full experiment history**, including arrivals before the delivery window. Do not prefilter by the intended first creative. The database insertion order resolves rare same-second cross-arm arrivals:

```sql
SELECT rowid AS arrival_index, anon, touch_id, experiment, arm, tag,
       received_at, client_at, session, path
FROM paid_ad_arrivals
WHERE experiment = 'av-meta-nov26-v1'
ORDER BY received_at, rowid;
```

The script accepts this row array or Wrangler's `results` wrapper. Deduplication uses anonymous browser + touch ID. When different arms tie at the first receipt second and no insertion index exists, that visitor is explicitly unassigned in coverage rather than arbitrarily choosing an arm. A client/server delay above five minutes is counted for measurement QA. The server receipt time remains the enrollment clock.

Use the existing sanitized Stripe export schema from the November analytics work. Each payment needs:

- `id`, `anon`, `status`, `currency`, `amount_received` and `productionPaidAt` (verified success epoch seconds).
- `items`: `product|build|quantity` entries separated by `;`, or objects with `id`, `build`, `qty`.
- `breakdown`: `subtotal|shipping|tax|total` in cents, and `discount` in cents.
- `refundedAmount`: current refunded cents, including zero; absent data remains unknown.
- Optionally `contributionCents`: whole-order retained cash contribution **before ads**, computed by the ops cost model using the current refunds, fees, parts and shipping estimates/actuals. The owner's assembly labor is $0/hour under the agreed plan. Do not enter merchandise revenue as contribution.

`stripe.complete` must be true and its capture time must cover `asOf`. There is no fallback from `productionPaidAt` to charge creation: an authorization date is not the payment-success date. Test orders must be excluded in the input using the documented QA order list; do not filter real failures, refunds or zero-sale arms out of the report.

The primary mature result uses first observed paid arrival + seven days, distinct succeeded frame-containing orders and distinct anonymous browsers. Unit counts are separate; one order containing two frames is one acquisition. Accessory-only orders do not count as frame conversions. Later ad arms are crossovers and never reassign the first arm. A visitor first observed before delivery cannot reenroll on a subsequent click.

`observed` totals include purchases from visitors who are still waiting for full follow-up. Their CPA is provisional. `mature7d` supplies the fixed-window rate. `completeFollowup` becomes true after delivery closes plus seven days, provided the supplied exports actually cover `asOf`. The report does not select a winner or infer incremental sales.

Refund amounts describe the whole basket and cannot automatically be allocated between frames, accessories, tax and shipping. Unknown refund/revenue/contribution coverage produces null totals rather than treating missing costs as zero. All historical frame orders are audited in coverage; `historicalOrders`, `futureOrders`, missing identity/time, unmatched and out-of-window orders explain exclusions.
