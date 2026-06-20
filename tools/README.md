# Newsletter (Buttondown)

How new posts become emails, and how you approve them before they go out.

## How it works

On every push to `main`, CI builds and deploys the site, then runs
`tools/newsletter.py`. For each newly-published post (under `docs/projects` or
`docs/writings`, without `draft: true`, dated on/after `NEWSLETTER_SINCE`, and
not already emailed) it:

1. Creates a **draft** in Buttondown (never sends to the list).
2. Emails a one-click **approval notice** to test@theodore.net.

Nothing reaches your subscribers until you open that email, click **Approve and
send to everyone**, and confirm on the page that opens. Ignore it and it stays a
draft in Buttondown that you can send by hand anytime.

The email subscribers receive is plain text (the subject line is the post title):

```
<the post's description>

<the first paragraph or two of the piece, cleaned to plain text>

Keep reading: https://theodore.net/<path>/

Teddy
```

Teasers are cut on paragraph/sentence boundaries (never mid-sentence) and capped
around 90 words, so the email gives a taste and drives to the site.

## One-time setup

1. **Secrets.** Add these so CI and the approval link work:
   - GitHub repo -> Settings -> Secrets and variables -> Actions:
     `BUTTONDOWN_API_KEY` (your Buttondown key) and `NEWSLETTER_APPROVE_SECRET`
     (any long random string, e.g. `openssl rand -hex 32`).
   - Cloudflare Pages -> your project -> Settings -> Environment variables: the
     **same** `BUTTONDOWN_API_KEY` and `NEWSLETTER_APPROVE_SECRET`.

   Until these exist the CI step safely no-ops.
2. **Keep Buttondown's built-in RSS-to-email off** (Settings -> Basic ->
   RSS-to-email). It lives only in Buttondown's UI; if it's set to "send" it will
   also blast a thin one-line version of every post. This flow replaces it.

## How sending actually happens

- The script only ever POSTs `status:"draft"` and re-reads to confirm. It cannot
  email the list; the only mail it sends (`--send-test` and the approval notice)
  goes to one named address.
- The list send lives in `functions/api/newsletter-approve.js`. When you click
  the signed approval link and confirm, it verifies the link's HMAC, checks the
  email is still a draft, then transitions it to `about_to_send`.
- The confirm page (a button -> POST) exists so email link-scanners, which only
  load GET links, can't trigger a send.

## Local use

```bash
# Preview the emails for specific posts (no network, no key needed):
python tools/newsletter.py --dry-run --all --post docs/projects/AvianVisitors.md

# Preview everything that would go out from here:
python tools/newsletter.py --dry-run

# Create a draft from one post (even if already emailed) and send yourself a test:
BUTTONDOWN_API_KEY=... python tools/newsletter.py \
    --force --post docs/projects/Polargraph.md --send-test test@theodore.net
```

## Guards

- Date floor: only posts dated on/after `NEWSLETTER_SINCE` are considered, so the
  first run can't backfill the whole archive.
- Dedup: a post is skipped if Buttondown already has an email for its canonical
  URL or our "Keep reading: <url>" body marker, so re-runs never duplicate.

## Writing the list directly

For notes that aren't about a new post, see `tools/letter-template.md`.
