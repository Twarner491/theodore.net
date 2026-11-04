# Store signup and requested cart email

The store supports an inline Avian Visitors newsletter signup, a requested cart email, and private visit/cart/checkout/purchase associations. There are no automated abandonment reminders, discount offers or marketing campaigns. Requesting a cart email does not subscribe its recipient to the newsletter, and entering an email at checkout is not marketing consent.

## Production configuration

Production uses the existing `STORE_INVENTORY` binding and these settings:

```dotenv
STORE_RECOVERY_ENABLED=1
STORE_RECOVERY_MODE=live
STORE_RECOVERY_SEND_ENABLED=1
```

- Newsletter: `BUTTONDOWN_API_KEY`. New subscribers retain Buttondown's confirmation behavior. Existing opt-outs are respected; unrelated tags are preserved. Signups receive `newsletter` and `avian-visitors-product` tags plus signup-page metadata.
- Requested cart email: `RESEND_API_KEY` and a nonempty `STORE_MAILING_ADDRESS` for the postal footer. `STORE_FROM_EMAIL` is optional and defaults to `store@theodore.net`; its domain must be verified with Resend.
- Keep existing Stripe keys, sender settings, bindings and other secrets intact. Update only the required production settings, using `wrangler pages secret put` or a narrowly scoped `pages secret bulk --project-name theodore-net --env production` payload. Do not replace the full project configuration or put credentials into source control.

`GET /api/store-recovery?status=1` exposes only readiness and enabled-field flags. The production frontend checks this endpoint on HTTPS `theodore.net` or `www.theodore.net` store pages, then loads the fields. A failed capability check leaves shopping available. Existing GA4 and first-party funnel events remain active in production. The visit review HTML and JSON endpoints remain unavailable in live mode.

## Release sequence

1. Apply only `migrations/0004_store_recovery.sql` to the explicitly named production database. This migration was applied on November 3, 2026. It creates separate recovery tables and does not change inventory, reservations, voucher quotas or Batch 2 capacity. Do not bulk-apply unrelated pending migrations.

   ```sh
   npx wrangler d1 execute avian-store-inventory-production --env production --remote --file migrations/0004_store_recovery.sql
   ```

2. Verify the recovery tables and provider prerequisites, review the scoped diff, and run `npm test`, the site build, and `git diff --check`. Confirm generated store HTML places `store-restore-token` before analytics execution.
3. Configure the production flags and deploy the reviewed build. At this handoff, all three flags are configured as production secrets and deployment is pending. `STORE_MAILING_ADDRESS` is still missing, so `cartEmail` remains false until a postal address is configured.
4. Check production capabilities, both field interactions, review-endpoint denial, and unchanged inventory availability. If testing actual submissions, use an authorized test address and verify provider records. A successful API response means the provider accepted the request, not that the email reached the inbox.

Setting `STORE_RECOVERY_ENABLED=0` disables new recovery requests and purchase tracking. Setting only `STORE_RECOVERY_SEND_ENABLED=0` hides both email fields and stops provider sends while leaving visit tracking available.

Pre-deployment checks on November 3, 2026: 275 Node tests and 40 Python tests passed; the production-mode build succeeded, with the restore-token scrubber before analytics in generated HTML. Local browser checks confirmed right-side X, typed arrow, clearing back to X, and closing. Production has all ten recovery tables; Batch 2 remains capacity 30, sold 3, reserved 0. These checks do not establish production deployment or inbox delivery.

## Local review

Configure the ignored `.dev.vars` with `STORE_RECOVERY_ENABLED=1` and `STORE_RECOVERY_MODE=local`. Local mode queues previews without contacting Buttondown or Resend; provider credentials are unnecessary for this review.

```sh
npx wrangler d1 execute STORE_INVENTORY --local --file migrations/0004_store_recovery.sql
STRIPE_MODE=test SITE_URL=http://127.0.0.1:8892/ mkdocs build --clean
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx wrangler pages dev site --ip 127.0.0.1 --port 8892
```

Use the existing local inventory database and test catalog. Open `/store/avian-visitors/?recovery-preview=1`; activation follows navigation within the tab, and `?recovery-preview=0` disables it. `/api/store-recovery-review` shows visits and saved messages; `/api/store-recovery` returns the same review as JSON. Both require local mode on loopback.

## Behavior and checks

- The muted “Email me this cart” link becomes one field. The X is on the right, in the arrow's position. Empty X closes the field; typing changes it to submit, and clearing restores X. Failed requests retain the email for retry.
- Email requests use durable outbox records and stable request IDs. Live submissions await provider acceptance; retries reuse the same request and cart-email provider idempotency key. A queued or failed request is not shown as sent.
- Email addresses stay in private operational records, outside browser storage and analytics events. Opaque visit credentials link actual cart actions and validated checkout activity. An anonymous identifier alone does not identify a person. Checkout email is captured when checkout updates reach the server, not on every keystroke.
- Only authenticated Stripe success events that pass existing payment/fulfillment checks record purchases. Recovery association failures do not prevent checkout; purchase-recording failures ask Stripe to retry before receipt processing.
- Saved-cart links expire after seven days. Their opaque fragment token is removed before analytics, held only in memory, and sent to the restore endpoint. Restoring rechecks catalog and stock without reserving inventory or locking prices, and asks before replacing a different current cart.
- New visits trigger bounded retention cleanup at most every 15 minutes. It removes visit/activity records older than 90 days, expired restore links and unlinked old contact data, while retaining minimal hashed opt-out records. There is no scheduled campaign or sender. Monitor cleanup throughput if traffic grows substantially.

Any future marketing follow-up needs separate send rules, consent and unsubscribe handling, and fresh purchase/stock checks. The private friends-and-family discount code is not used by this implementation.
