# Paid attribution and Meta Purchase

The initial November 10, 2026 release enabled private paid attribution and consented server Purchase delivery. Browser events and the later preference policy are described below. Integrations remain disabled where their activation flags are absent. These measurement changes do not create ads, upload customer lists, or send synthetic events to Meta.

## Consented website events

The browser-event extension requires the additional `META_PIXEL_ENABLED=1` Pages flag; without it, Purchase delivery continues without a Pixel. No additional Meta credential is needed. The preference policy requires migration `0009_meta_preference_policy.sql` after `0008_paid_attribution_meta.sql`. `/api/ad-config` exposes capability flags and the **public** Pixel ID independently of a visitor's privacy signals; capability does not mean that tracking is allowed. It never returns an access token. Local `META_CAPI_MODE=preview` always returns an empty Pixel ID, so local review cannot send browser events to Meta.

Preferences are available only in the Privacy page's Cookie preferences disclosure; there is no automatic store prompt. Google Analytics has its own independent preference and retains its existing default. Changing Meta does not change Google Analytics or first-party attribution.

The Meta policy distinguishes four versions:

- `meta-v1`: existing explicit permission for server Purchase only. It never authorizes browser events.
- `meta-v2`: an explicit ordinary choice made through the Privacy checkbox.
- `meta-us-v1`: a default allowance only for a genuinely fresh visitor whose trusted server region is US, with no privacy signal, existing choice, malformed history or storage-read failure. Existing refusals, including expired ones, do not become default allowances. Outside the US or with an unknown region, a stored US default is ineligible; this does not fabricate an explicit refusal.
- `meta-v3`: an explicit two-step override of the current GPC/DNT signals. Switching on prepares an identity- and signal-bound five-minute challenge; only a separate Allow click confirms it. Cancel, failure and an uncovered new signal keep tracking off. The override covers only its recorded signal bits and identity.

No new allowance turns On or loads Pixel before `/api/ad-consent` acknowledges it. New default and override versions require the canonical `decisionId` and `decisionAt`, and stored decisions are revalidated on each document before browser events. A fresh browser/header signal records Off, so removing that signal later does not silently turn tracking on. Older choices are not silently upgraded.

After an eligible acknowledged v2, US-default or confirmed-override allowance, the Pixel may load only on the store index and published product routes at `https://theodore.net`. It sends explicit `PageView`, the current `ViewContent`, subsequent successful cart quantity increases as `AddToCart`, and a public cart checkout-button click as `InitiateCheckout`. Checkout value is the displayed merchandise subtotal before shipping, tax and checkout discounts. The navigation never waits for tracking, so a script still loading at that click may miss the event. Product IDs use the same `metaCatalogId` override / product-variant rule as the generated feed. Adds blocked by stock limits, removals and cart restoration do not count. Pre-consent cart actions and checkout starts are not replayed. `Purchase` remains server-only with `Purchase:<PaymentIntent id>` deduplication.

The Pixel is never initialized on checkout, order confirmation or privacy routes. The three current `go=av3-meta-*` campaign tags and `cart=open` are allowlisted, including in same-origin public referrers. Unknown query parameters, hashes and unsafe referrer queries suppress it; this prevents payment return secrets or recovery tokens being transmitted as a page address. Consequently, checkout add-ons do not produce browser AddToCart events. This is deliberately partial funnel coverage, not a count of every shopper or cart action. Meta receives normal browser connection information, including IP address, once its script is allowed; no name, email, address or form values are supplied. The existing Meta dataset AI page/product enrichment setting can also use public page and product details; this is disclosed in privacy text and is not assumed to be disabled by `autoConfig=false`. `autoConfig=false` precedes `init`, no automatic-matching user data is provided, and only `trackSingle` addresses this dataset. Pixel consent starts revoked on each document and is granted only after the applicable allowance is validated. Browser/header GPC and DNT keep tracking off unless a current confirmed override covers those signals. Cross-tab denial, expiration, identity changes and newly uncovered signal bits stop future events; withdrawal retains the server suppression flow. Already transmitted events cannot be recalled.

Local checks cover v1 preservation, fresh v2 acknowledgment, US/other/unknown regions, old and malformed histories, default and override decision revalidation, prepare/confirm cancellation and race handling, denied choices, revocation during script loading, cross-tab withdrawal, private URL/referrer suppression, local/staging gates, manual-only configuration ordering, event payload allowlisting, stock-clamped cart changes, public checkout clicks without navigation delays, current paid URLs and unchanged Purchase deduplication. The test Pixel is a mocked queue; no synthetic production events are sent.

Before a separate deployment review:

- Inspect the Privacy controls, regional defaults, signal confirmation, failure/retry states and policy text locally. These behavior changes are not evidence of improved conversion.
- Verify the delivered site's CSP headers. This repository currently defines no CSP; do not weaken any externally managed policy to make a test pass. Meta's official advanced documentation specifies script access to `connect.facebook.net/en_US/fbevents.js` and `connect.facebook.net/signals/config/<pixelId>`; inspect the actual event transport permissions too if a policy exists.
- Verify Events Manager automatic advanced matching and automatic event settings are off. Keep website audience definitions distinct from populated, eligible audiences. Historical first-party traffic cannot be backfilled by this extension.
- For a new installation, stage with `META_PIXEL_ENABLED` absent before intentional activation. For the existing live installation, follow the migration/worker/Pages upgrade order below and preserve approved flags and secrets. Local mocked tests cannot establish Meta delivery, audience population or match quality.

Official implementation references: [advanced Pixel configuration](https://developers.facebook.com/documentation/meta-pixel/advanced) and [Pixel consent](https://developers.facebook.com/documentation/meta-pixel/implementation/gdpr). The documentation was read in the in-app browser on November 10, 2026.

## Configuration

Migration `0008_paid_attribution_meta.sql` provides attribution, consent and outbox storage. The preference policy additionally requires `0009_meta_preference_policy.sql`, which adds decision provenance, signal/override bits, nonce challenges and outbox decision references. Apply both to a separate local review database before exercising the new policy.

Local `.dev.vars` additions:

```dotenv
PAID_ATTRIBUTION_ENABLED=1
META_CAPI_ENABLED=1
META_CAPI_MODE=preview
```

Use existing Stripe **test** credentials. Preview is accepted only on localhost/127.0.0.1/IPv6 loopback, persists a `preview` outbox row after a fully validated signed test webhook, and never calls Meta. `/api/ad-config` is uncached and returns capability flags, the public Pixel ID, `privacyOptOut`, `privacySignals:{gpc,dnt}`, `regionalDefaultAllowed` and `signalOverrideSupported`. The browser unions server signals with navigator signals; false browser values cannot hide true request-header signals. Region eligibility comes from trusted `request.cf.country`, not client-supplied country fields.

Live operation requires the production migration, `META_CAPI_MODE=live`, the approved `META_DATASET_ID`, a secret `META_CAPI_ACCESS_TOKEN`, and the existing live Stripe configuration. Live queued events require the canonical `https://theodore.net` webhook origin and matching Stripe live mode. `workers/meta-purchase-delivery.js` drains only `mode=live` rows. `workers/wrangler.meta-purchase-delivery.toml` contains the production account, dataset and D1 binding, with its approved live flags; the example file remains a disabled portable template. That worker needs a Meta token, **not** a Stripe key. The deployed Pages and delivery worker use the same approved dataset. Switching configuration never promotes preview rows.

## Attribution contract

The three campaign tags are `av3-meta-reel-a`, `av3-meta-species`, and `av3-meta-photo`, under `av-meta-nov26-v1`. They are public campaign labels, not proof of a paid impression or billable click.

`POST /api/ad-attribution` receives `{anon,session,paidAttribution}`. The validated `last` touch is deduplicated by `(anon,touch_id)`. `received_at` is the authoritative server arrival time; `client_at` is retained separately to expose delayed receipts. Existing original-discovery `src` and the count experiment remain separate.

The primary first-party cohort must select the first received arrival per `(experiment,anon)` inside the locked delivery dates, retain that initial arm across later clicks, and follow each arrival for seven days. Join **actual succeeded orders** by `metadata.anon` using the verified paid timestamp, never PaymentIntent creation time. Count distinct frame-containing orders and buyers separately from quantities; report crossovers, delayed receipts, unmatched buyers, pending cohorts and current refunds. The bounded Stripe `ad_first`/`ad_last` fields are an independent coverage check, not a replacement for a captured arrival.

Arrival receipts include validated path, UTM tokens and numeric ad identifiers. They exclude Meta click/browser identifiers and customer contact details. A bounded cleanup removes receipts older than 90 days on subsequent arrivals. Original discovery is not rewritten when a paid click arrives. A quote/finalize refresh can update an unpaid draft's campaign snapshot; an authorized, processing, canceled or succeeded payment is not relabeled.

## Meta matching and consent

Checkout matching context supplies `{consent,version,at,atMs,signals,fbc?,fbp?}`. The new default/override versions also supply their canonical `decisionId` and `decisionAt`; the backend verifies these against the current private ledger before attaching tracking metadata. Only genuine existing click/browser identifiers are used. Server Purchase payloads contain no fabricated fbc/fbp, email, phone, customer address, IP address or private anonymous ID. The actual checkout browser User-Agent accompanies valid matching context, as required for website CAPI events. Matching identifiers are revalidated against the actual purchase time, so a delayed finalized draft cannot send an expired click. Missing consent, identifiers, User-Agent, or an addressable private anonymous ID results in no Purchase queue entry. These exclusions mean Meta will not observe every sale; first-party paid orders remain the business source of truth.

`Sec-GPC: 1`, `DNT: 1` and true browser signal bits keep matching off unless a current `meta-v3` decision covers every active bit. `prepare-override` alone never grants permission; `confirm-override` validates the nonce and the unchanged decision baseline. Replayed confirmation is idempotent and cannot revive a later refusal. Explicit false clears matching metadata on an unpaid checkout update. `POST /api/ad-consent` records the latest anonymous choice and suppresses queued/preview records on withdrawal. The delivery worker checks withdrawal again before sending. Choice ordering uses the original millisecond timestamp, so same-second changes and delayed retries preserve their order. Exact timestamp ties favor denial. Re-opt-in can enable future purchase contexts but does not revive a context from before withdrawal. Already-dispatched requests cannot be recalled. The browser retries an unacknowledged choice; a request that never reaches the server cannot suppress a server-side queue immediately.

The seven-day matching and attribution windows are **not** global deletion promises. Matching consent/context is attached to the Stripe order metadata. Successful or expired delivery scrubs the outbox payload; outbox receipts are removed after 90 days by active live delivery maintenance. Affirmative anonymous decision state is eligible for cleanup after 90 days on subsequent requests. Minimal refusal records are retained so an expired local preference cannot become a new default allowance. Preview records stay local. Stripe order metadata follows the order-record retention policy, not the browser's seven-day storage TTL.

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

For this upgrade of the existing live installation:

1. Apply `0009_meta_preference_policy.sql` to the approved `STORE_INVENTORY` D1 after `0008`. Verify the new columns and challenge table while preserving existing inventory, production, consent and outbox records.
2. Deploy the updated delivery worker against that schema before Pages can enqueue the new decision versions. Preserve its approved dataset, D1 binding, secret, flags and schedule. Legacy queued events remain supported.
3. Deploy the reviewed Pages code and matching static artifact. Preserve existing live flags and secrets; verify the regional configuration, explicit choices, confirmed signal override, stored-decision revalidation and withdrawal. Do not deploy a raw local preview artifact containing fake analytics IDs or local provider stubs.
4. Verify a subsequent genuine eligible purchase reaches the dataset once; inspect ledger/outbox status and provider acknowledgment without replaying synthetic purchases. First-party Stripe reports remain authoritative, including opted-out and unmatched sales.

For a new installation, first apply the required schema, stage Pages and the worker with Meta disabled, install their separate encrypted Meta secrets and matching dataset configuration, then activate the approved flags together. A running but unconfigured delivery path must not leave new events aging in the queue.

Rolling back Meta means disabling Pages and worker activation flags together. Existing queued events remain private and unsent; do not change their original event time to make expired events appear recent.


## Initial production release (November 10, 2026)

- Pages deployment: `08ee862f-d67f-4aa3-bf6d-a7d01661cc8f` on production branch `site-updates`.
- Staged Pages deployment with Meta disabled: `5157bef7-a1f5-4d1b-9221-2a028e1938a7`.
- Delivery worker version: `092ca41d-5c32-4bd2-aec7-b8a7fe4cccde`; schedule `*/5 * * * *`.
- Approved dataset: `2377987452691978`. Access tokens are stored only as encrypted Pages/worker secrets; the temporary transfer file was removed.
- Final pre-release validation: 499 Node tests and 60 Python tests passed. Exact migration rehearsal preserved all 21 pre-existing table counts and inventory/voucher/production ledger hashes; public catalog JSON remained unchanged.
- At that initial release, canonical `/api/ad-config` disabled capability under GPC/DNT. The newer contract above separates capability from the visitor decision; do not use the historical capability behavior as the current consent gate. Store, product, checkout and privacy pages were verified successfully.

These checks establish configured production operation, not Meta acceptance of a real Purchase. The next genuine, consented eligible purchase must supply that end-to-end evidence. No charge, email, ad or synthetic Purchase was generated for release validation.
