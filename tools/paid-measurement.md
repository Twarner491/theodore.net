# Paid attribution and Meta Purchase

Released to production on November 10, 2026, with private paid attribution and consented server Purchase delivery enabled. Both integrations remain disabled in environments where their activation flags are absent. This release does not create ads, install the Meta Pixel, upload customer lists, or send synthetic events to Meta.

## Consented website events

The browser-event extension is gated independently and requires the additional `META_PIXEL_ENABLED=1` Pages flag; absent that flag, the existing Purchase service continues without a Pixel. No new credential or database migration is needed. `/api/ad-config` exposes `metaBrowserEventsEnabled` and the **public** `metaPixelId` only when the live canonical origin, existing CAPI configuration and privacy signals permit it. It never returns the access token. Local `META_CAPI_MODE=preview` can show the expanded choice but always returns an empty Pixel ID, so local review cannot send browser events to Meta.

The new affirmative choice is `meta-v2`. Existing `meta-v1` choices remain valid for the original server Purchase purpose; an old yes does not authorize browsing events. When browser events are enabled, those shoppers see the expanded prompt. An existing no remains off. New organic store visitors can also choose. The prompt has equal Allow / No thanks controls and is not a checkout requirement. No browser events run until the new choice has been acknowledged by `/api/ad-consent`. Both versions remain accepted by Purchase metadata and payload validation, without upgrading an old server record behind the scenes.

After v2 consent, the Pixel may load only on the store index and published product routes at `https://theodore.net`. It sends explicit `PageView`, the current `ViewContent`, subsequent successful cart quantity increases as `AddToCart`, and a public cart checkout-button click as `InitiateCheckout`. Checkout value is the displayed merchandise subtotal before shipping, tax and checkout discounts. The navigation never waits for tracking, so a script still loading at that click may miss the event. Product IDs use the same `metaCatalogId` override / product-variant rule as the generated feed. Adds blocked by stock limits, removals and cart restoration do not count. Pre-consent cart actions and checkout starts are not replayed. `Purchase` remains server-only with `Purchase:<PaymentIntent id>` deduplication.

The Pixel is never initialized on checkout, order confirmation or privacy routes. The three current `go=av3-meta-*` campaign tags and `cart=open` are allowlisted, including in same-origin public referrers. Unknown query parameters, hashes and unsafe referrer queries suppress it; this prevents payment return secrets or recovery tokens being transmitted as a page address. Consequently, checkout add-ons do not produce browser AddToCart events. This is deliberately partial funnel coverage, not a count of every shopper or cart action. Meta receives normal browser connection information, including IP address, once its script is allowed; no name, email, address or form values are supplied. The existing Meta dataset AI page/product enrichment setting can also use public page and product details; this is disclosed in privacy text and is not assumed to be disabled by `autoConfig=false`. `autoConfig=false` precedes `init`, no automatic-matching user data is provided, and only `trackSingle` addresses this dataset. Consent starts revoked on each document and is granted only after permission. Browser/header GPC and DNT, cross-tab denial, expiration and identity changes stop future events; withdrawal also retains the existing server suppression flow. Already transmitted events cannot be recalled.

Local checks cover v1 preservation, fresh v2 acknowledgment, organic visitors, denied consent, revocation during script loading, cross-tab withdrawal, private URL/referrer suppression, local/staging gates, manual-only configuration ordering, event payload allowlisting, stock-clamped cart changes, public checkout clicks without navigation delays, current paid URLs and unchanged Purchase deduplication. The test Pixel is a mocked queue; no synthetic production events are sent.

Before a separate deployment review:

- Inspect the expanded prompt and privacy text locally. This adds a consent choice for organic store visits when enabled and may affect conversion; it is not evidence of improved conversion.
- Verify the delivered site's CSP headers. This repository currently defines no CSP; do not weaken any externally managed policy to make a test pass. Meta's official advanced documentation specifies script access to `connect.facebook.net/en_US/fbevents.js` and `connect.facebook.net/signals/config/<pixelId>`; inspect the actual event transport permissions too if a policy exists.
- Verify Events Manager automatic advanced matching and automatic event settings are off. Keep website audience definitions distinct from populated, eligible audiences. Historical first-party traffic cannot be backfilled by this extension.
- Deploy only after review, initially with `META_PIXEL_ENABLED` absent, then enable intentionally and check consented genuine traffic. Local mocked tests cannot establish Meta delivery, audience population or match quality.

Official implementation references: [advanced Pixel configuration](https://developers.facebook.com/documentation/meta-pixel/advanced) and [Pixel consent](https://developers.facebook.com/documentation/meta-pixel/implementation/gdpr). The documentation was read in the in-app browser on November 10, 2026.

## Configuration

Migration `0008_paid_attribution_meta.sql` is applied to the production `STORE_INVENTORY` D1. For a separate local review environment, apply that same migration locally.

Local `.dev.vars` additions:

```dotenv
PAID_ATTRIBUTION_ENABLED=1
META_CAPI_ENABLED=1
META_CAPI_MODE=preview
```

Use existing Stripe **test** credentials. Preview is accepted only on localhost/127.0.0.1/IPv6 loopback, persists a `preview` outbox row after a fully validated signed test webhook, and never calls Meta. `/api/ad-config` returns `{metaMeasurementEnabled,privacyOptOut}` and is not cached; the second field also carries header-only GPC/DNT preferences into the browser.

Live operation requires the production migration, `META_CAPI_MODE=live`, the approved `META_DATASET_ID`, a secret `META_CAPI_ACCESS_TOKEN`, and the existing live Stripe configuration. Live queued events require the canonical `https://theodore.net` webhook origin and matching Stripe live mode. `workers/meta-purchase-delivery.js` drains only `mode=live` rows. `workers/wrangler.meta-purchase-delivery.toml` contains the production account, dataset and D1 binding, with its approved live flags; the example file remains a disabled portable template. That worker needs a Meta token, **not** a Stripe key. The deployed Pages and delivery worker use the same approved dataset. Switching configuration never promotes preview rows.

## Attribution contract

The three campaign tags are `av3-meta-reel-a`, `av3-meta-species`, and `av3-meta-photo`, under `av-meta-nov26-v1`. They are public campaign labels, not proof of a paid impression or billable click.

`POST /api/ad-attribution` receives `{anon,session,paidAttribution}`. The validated `last` touch is deduplicated by `(anon,touch_id)`. `received_at` is the authoritative server arrival time; `client_at` is retained separately to expose delayed receipts. Existing original-discovery `src` and the count experiment remain separate.

The primary first-party cohort must select the first received arrival per `(experiment,anon)` inside the locked delivery dates, retain that initial arm across later clicks, and follow each arrival for seven days. Join **actual succeeded orders** by `metadata.anon` using the verified paid timestamp, never PaymentIntent creation time. Count distinct frame-containing orders and buyers separately from quantities; report crossovers, delayed receipts, unmatched buyers, pending cohorts and current refunds. The bounded Stripe `ad_first`/`ad_last` fields are an independent coverage check, not a replacement for a captured arrival.

Arrival receipts include validated path, UTM tokens and numeric ad identifiers. They exclude Meta click/browser identifiers and customer contact details. A bounded cleanup removes receipts older than 90 days on subsequent arrivals. Original discovery is not rewritten when a paid click arrives. A quote/finalize refresh can update an unpaid draft's campaign snapshot; an authorized, processing, canceled or succeeded payment is not relabeled.

## Meta matching and consent

An explicit opt-in supplies `{consent:true,version:'meta-v1',at,atMs,fbc?,fbp?}`. Only genuine existing click/browser identifiers are used. No fabricated fbc/fbp, email, phone, customer address, IP address, or private anonymous ID is sent to Meta. The actual checkout browser User-Agent accompanies valid matching context, as required for website CAPI events. Matching identifiers are revalidated against the actual purchase time, so a delayed finalized draft cannot send an expired click. Missing consent, identifiers, User-Agent, or an addressable private anonymous ID results in no Purchase queue entry. These exclusions mean Meta will not observe every sale; first-party paid orders remain the business source of truth.

`Sec-GPC: 1` and `DNT: 1` override opt-in. Explicit false clears matching metadata on an unpaid checkout update. `POST /api/ad-consent` records the latest anonymous choice and suppresses queued/preview records on withdrawal. The delivery worker checks withdrawal again before sending. Choice ordering uses the original millisecond timestamp, so same-second changes and delayed retries preserve their order. Exact timestamp ties favor denial. Re-opt-in can enable future purchase contexts but does not revive a context from before withdrawal. Already-dispatched requests cannot be recalled. The browser retries an unacknowledged choice; a request that never reaches the server cannot suppress a server-side queue immediately.

The seven-day matching and attribution windows are **not** global deletion promises. Matching consent/context is attached to the Stripe order metadata. Successful or expired delivery scrubs the outbox payload; outbox receipts are removed after 90 days by active live delivery maintenance. Anonymous consent state is cleaned after 90 days on subsequent consent requests. Preview records stay local. Stripe order metadata follows the order-record retention policy, not the browser's seven-day storage TTL.

## Verified Purchase and retries

Only the existing signature-verified `payment_intent.succeeded` path, after catalog, address, capture, inventory and production checks, can queue a Purchase. A thank-you page, an authorization, a client event, an invalid signature, or a refund webhook cannot enqueue one.

One order generates one `Purchase` with stable `event_id = Purchase:<payment-intent-id>`, original Stripe event time, captured `amount_received / 100`, USD, and catalog-matching product IDs. Value includes collected shipping and tax; business reports must separately exclude tax and subtract costs/refunds. `contains_assembled_frame='1'` is available for a future custom conversion rule; its availability in Meta's rule UI has not been verified. Generic Purchase also includes accessories, so it is not automatically the desired frame-sales optimization event.

A unique outbox primary key deduplicates webhook retries. Workers claim leases atomically, retry lost acknowledgements with the same event name/ID, and back off from one minute to one hour. A crash after provider acceptance can resend the same event ID; Meta's event deduplication is the external exactly-once boundary. There is no claim of exactly-once HTTP delivery. Requests older than the original seven-day event-time limit expire and require operational attention, not a rewritten event time. No `test_event_code` is sent: the current Meta documentation says test events can be used for targeting/measurement, so local validation uses a mocked transport exclusively.

A queue-storage failure returns a retryable webhook response before the receipt shortcut; already captured funds remain captured. Meta transport errors happen only in the independent worker and cannot block checkout, fulfillment validation or customer receipts. Refunds do not generate another Purchase. Net retained revenue and refund adjustments belong in the private business report; this implementation does not claim to revise an already reported Meta Purchase.

## Local verification

```sh
node --test tests/paid-attribution-backend.test.mjs
```

Tests cover server receipt time, repeated arrivals, crossover, unsafe input, Stripe field limits, draft refresh/freeze, consent/GPC/DNT, opt-out suppression, re-opt-in, trusted webhook integration, exact captured values, duplicate webhook handling, mismatched modes, preview/live separation, missing credentials, delivery retries, concurrent claims, crash-after-acceptance, seven-day expiry, refund non-events and queue outages. All provider requests in these tests are intercepted; no charge, email, ad or Meta event is sent.

Primary implementation reference verified November 10, 2026: [Meta Conversions API](https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api), [customer-information parameters](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/customer-information-parameters).


## Coordinated release order

1. Apply the final `0008` schema to the approved production D1 before enabling either new feature. Confirm the consent millisecond columns and `suppressed` outbox state are present. Preserve existing inventory/production tables.
2. Deploy the Pages code with `PAID_ATTRIBUTION_ENABLED=1`, `META_CAPI_ENABLED=0`, and `META_CAPI_MODE=disabled`. This safely enables private paid attribution while Meta configuration is incomplete. No Meta queue, consent prompt, or external Meta traffic is possible in this state.
3. For a fresh staged rollout, temporarily set the delivery worker flags to disabled before deploying its production configuration. Install the Meta access-token secret independently in Pages and the worker; verify the approved dataset ID matches in both. Do not share the Stripe key with the delivery worker.
4. Activate the configured worker and Pages together with `META_CAPI_ENABLED=1` and `META_CAPI_MODE=live`; recheck the canonical public config, consent flow and worker health. A configured but inactive worker would allow queued events to age out. A running worker with disabled Pages creates no new events.
5. Verify a subsequent genuine, consented eligible purchase reaches the dataset and is counted once; inspect outbox status and provider acceptance without replaying synthetic test purchases into the real dataset. The first-party Stripe report remains authoritative for all purchases, including opt-outs and unmatched visitors.

Rolling back Meta means disabling Pages and worker activation flags together. Existing queued events remain private and unsent; do not change their original event time to make expired events appear recent.


## Current production release

- Pages deployment: `08ee862f-d67f-4aa3-bf6d-a7d01661cc8f` on production branch `site-updates`.
- Staged Pages deployment with Meta disabled: `5157bef7-a1f5-4d1b-9221-2a028e1938a7`.
- Delivery worker version: `092ca41d-5c32-4bd2-aec7-b8a7fe4cccde`; schedule `*/5 * * * *`.
- Approved dataset: `2377987452691978`. Access tokens are stored only as encrypted Pages/worker secrets; the temporary transfer file was removed.
- Final pre-release validation: 499 Node tests and 60 Python tests passed. Exact migration rehearsal preserved all 21 pre-existing table counts and inventory/voucher/production ledger hashes; public catalog JSON remained unchanged.
- Canonical `/api/ad-config` reports measurement enabled normally and disabled with `privacyOptOut:true` for GPC or DNT. Store, product, checkout and privacy pages return successfully.

These checks establish configured production operation, not Meta acceptance of a real Purchase. The next genuine, consented eligible purchase must supply that end-to-end evidence. No charge, email, ad or synthetic Purchase was generated for release validation.
