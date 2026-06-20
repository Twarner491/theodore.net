#!/usr/bin/env python3
"""Generate Buttondown drafts from newly-published posts.

When a project or writing is published (front-matter without `draft: true`),
this builds a plain-text email (the description, the first paragraph or two of
the piece, and a plain "Keep reading:" link) and creates it in Buttondown as a
DRAFT. It never sends to the subscriber list.

Safety: the only code path that delivers mail is `--send-test`, which posts to a
single named address. Drafts are created with status="draft" and re-read to
confirm. Sending to the list happens via an explicit approval step, not here.

Design notes
------------
- Stdlib only (urllib + a tiny front-matter reader): runs on the CI image and
  on a bare local Python with no pip installs.
- Teasers cut on paragraph/sentence boundaries, not character counts, so they
  never end mid-sentence (the failure mode of Buttondown's native RSS abstract).
- The site's custom syntax (hooks/tufte_elements.py) is stripped so sidenotes,
  marginnotes, figures, and admonitions never leak into the email.

Usage
-----
  # See exactly what would be emailed (no network, no key needed):
  python tools/newsletter.py --dry-run --all --post docs/projects/AvianVisitors.md

  # Live: create drafts for genuinely new, not-yet-emailed posts (CI default):
  BUTTONDOWN_API_KEY=... python tools/newsletter.py

  # Force a fresh draft from one post and send a test to one address only:
  BUTTONDOWN_API_KEY=... python tools/newsletter.py \
      --force --post docs/projects/Polargraph.md --send-test test@theodore.net

Env
---
  BUTTONDOWN_API_KEY    required for any API call (dedup GET, draft POST)
  BUTTONDOWN_API_BASE   default https://api.buttondown.email/v1
  NEWSLETTER_SINCE      ISO date (YYYY-MM-DD); only posts dated >= this are
                        candidates. Default DEFAULT_SINCE below.
  NEWSLETTER_APPROVE_SECRET  required with --approve-to; signs the one-click link.
  NEWSLETTER_APPROVE_URL     approval endpoint (default https://theodore.net/api/newsletter-approve).
"""

import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

SITE_URL = "https://theodore.net"
FOLDERS = (("projects", "project"), ("writings", "writing"))
API_BASE = os.environ.get("BUTTONDOWN_API_BASE", "https://api.buttondown.email/v1")

# Only posts dated on/after this are emailed in live mode, so the first CI run
# can't backfill drafts for the whole archive. Override with NEWSLETTER_SINCE.
DEFAULT_SINCE = "2026-06-18"

# Teaser shape: the first paragraph if it is at least MIN_WORDS, otherwise the
# first two; then trim to MAX_WORDS on a sentence boundary so nothing runs long.
TEASER_MIN_WORDS = 40
TEASER_MAX_WORDS = 90

SIGNOFF = "Teddy"             # plain sign-off (no em dash, no slop)
PLAINTEXT_MARKER = "<!-- buttondown-editor-mode: plaintext -->"


# --------------------------------------------------------------------------- #
# Post discovery + front-matter
# --------------------------------------------------------------------------- #

def read_post(path):
    """Return (frontmatter dict of top-level scalars, body string).

    A deliberately tiny YAML reader: we only need title/description/date/draft,
    all single-line scalars, so we avoid a PyYAML dependency.
    """
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}, text
    m = re.search(r"\n---\s*\n", text[3:])
    if not m:
        return {}, text
    block, body = text[3:m.start() + 3], text[m.end() + 3:]
    fm = {}
    for line in block.splitlines():
        if not line or line[0].isspace():        # skip nested list/dict values
            continue
        mm = re.match(r"([A-Za-z0-9_]+):\s?(.*)$", line)
        if not mm:
            continue
        key, val = mm.group(1), mm.group(2).strip()
        if len(val) >= 2 and val[0] in "\"'" and val[-1] == val[0]:
            val = val[1:-1]
        if re.fullmatch(r"[>|][+-]?\d*", val):    # YAML block scalar marker, not a value
            val = ""
        fm[key] = val
    return fm, body


def is_draft(fm):
    return str(fm.get("draft", "")).strip().lower() in ("true", "yes", "1")


def post_url(folder, stem):
    return f"{SITE_URL}/{folder}/{stem}/"


def discover(docs_dir, only=None):
    """Return candidate posts as dicts. `only` is a list of paths to restrict to."""
    only_set = {Path(p).resolve() for p in only} if only else None
    out = []
    for folder, type_ in FOLDERS:
        d = Path(docs_dir) / folder
        if not d.exists():
            continue
        for md in sorted(d.glob("*.md")):
            if only_set is not None and md.resolve() not in only_set:
                continue
            fm, body = read_post(md)
            if not fm.get("title") or is_draft(fm):   # need a title; honour drafts
                continue
            out.append({
                "path": md, "folder": folder, "type": type_,
                "stem": md.stem, "fm": fm, "body": body,
                "url": post_url(folder, md.stem),
            })
    return out


# --------------------------------------------------------------------------- #
# Teaser extraction (strip the site's custom syntax -> clean plain text)
# --------------------------------------------------------------------------- #

_ENTITIES = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    "&rsquo;": "’", "&lsquo;": "‘", "&hellip;": "...", "&nbsp;": " ",
}

# Tufte/inline constructs whose *content* is tangential -> remove wholesale.
_NOTE_BLOCKS = ("sidenote", "marginnote", "marginfigure", "carousel",
                "epigraph", "fullwidth")


def _strip_constructs(text):
    """Remove things that shouldn't appear in a teaser, content and all."""
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    # Curly Tufte note blocks: {.sidenote}...{/.sidenote} etc.
    for name in _NOTE_BLOCKS:
        text = re.sub(r"\{\." + name + r"\}.*?\{/\." + name + r"\}", " ",
                      text, flags=re.DOTALL)
    # Hand-written rendered sidenotes/marginnotes (Polargraph does this inline).
    text = re.sub(r'<span class="(?:side|margin)note">.*?</span>', " ",
                  text, flags=re.DOTALL)
    text = re.sub(r'<label[^>]*class="[^"]*margin-toggle[^"]*"[^>]*>.*?</label>',
                  " ", text, flags=re.DOTALL)
    text = re.sub(r'<input[^>]*class="[^"]*margin-toggle[^"]*"[^>]*/?>', " ", text)
    # Unwrap {.newthought}lead-in{/.newthought} and drop any leftover markers.
    text = re.sub(r"\{/?\.?\w+\}", "", text)
    return text


def _looks_like_prose(block):
    """True if a paragraph block is body prose (not HTML/figure/table/heading)."""
    if re.match(r"(?: {4,}|\t)", block):             # indented code / admonition body
        return False
    s = block.lstrip()
    if not s:
        return False
    if s[0] == "<":                                  # raw HTML block
        return False
    if s[:3] in ("???", "!!!", "===", "---", "***", "```"):  # admonition / hr / fence
        return False
    if s[0] in "#>|":                                # heading / quote / table
        return False
    if s.startswith("!["):                           # image
        return False
    if re.match(r"(\*|-|\+)\s", s) or re.match(r"\d+\.\s", s):  # list item
        return False
    if s[0] == "{":                                  # leftover shortcode
        return False
    return True


def _clean_inline(block):
    """Reduce a prose block to clean one-line plain text."""
    t = re.sub(r"(?m)^\s*>\s?", "", block)                 # blockquote markers -> plain
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)            # images
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)         # links -> link text
    t = re.sub(r"<[^>]+>", " ", t)                         # stray tags
    t = re.sub(r"\*\*([^*]+)\*\*", r"\1", t)               # bold
    t = re.sub(r"\*([^*]+)\*", r"\1", t)                   # italic
    t = re.sub(r"`([^`]+)`", r"\1", t)                     # inline code
    t = t.replace("~~", "")
    for ent, ch in _ENTITIES.items():
        t = t.replace(ent, ch)
    return re.sub(r"\s+", " ", t).strip()


def _truncate_words(text, max_words):
    """Trim to <= max_words, preferring a sentence boundary."""
    words = text.split()
    if len(words) <= max_words:
        return text
    clip = " ".join(words[:max_words])
    cut = max(clip.rfind(". "), clip.rfind("? "), clip.rfind("! "))
    if cut > 40:
        return clip[:cut + 1]
    return clip.rstrip(",;:") + "..."


def extract_teaser(body):
    """First paragraph or two of real prose, as clean plain text."""
    cleaned = _strip_constructs(body)
    paras = []
    for block in re.split(r"\n\s*\n", cleaned):
        if not _looks_like_prose(block):
            continue
        txt = _clean_inline(block)
        if len(txt) < 25 or len(txt.split()) < 5:     # captions / strays
            continue
        paras.append(txt)

    if not paras:
        return ""
    chosen = [paras[0]]
    if len(paras[0].split()) < TEASER_MIN_WORDS and len(paras) > 1:
        chosen.append(paras[1])                # thin opener -> add the next paragraph
    total = sum(len(p.split()) for p in chosen)
    if total > TEASER_MAX_WORDS:               # trim the last paragraph on a sentence break
        keep = max(20, len(chosen[-1].split()) - (total - TEASER_MAX_WORDS))
        chosen[-1] = _truncate_words(chosen[-1], keep)
    return "\n\n".join(chosen)


def build_email(post):
    """Return (subject, body) for a candidate post."""
    fm = post["fm"]
    subject = fm.get("title", "").strip()           # used as the email subject line only
    parts = [PLAINTEXT_MARKER]
    desc = (fm.get("description") or "").strip()
    if desc:
        parts.append(desc)
    teaser = extract_teaser(post["body"])
    if teaser:
        parts.append(teaser)
    parts.append(f"Keep reading: {post['url']}")
    parts.append(SIGNOFF)
    body = parts[0] + "\n" + "\n\n".join(parts[1:])
    return subject, body


# --------------------------------------------------------------------------- #
# Buttondown API (stdlib urllib)
# --------------------------------------------------------------------------- #

def api(method, path, token, data=None):
    """Call the Buttondown API. Returns (status_code, parsed_json_or_dict).

    Network/transport errors are allowed to raise: callers fail closed (no
    drafts created) rather than guess at state.
    """
    url = path if path.startswith("http") else API_BASE + path
    headers = {"Authorization": f"Token {token}", "Content-Type": "application/json"}
    raw = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=raw, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text.strip() else {})
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, {"_raw": text[:500]}


def _norm_url(u):
    return (u or "").strip().rstrip("/").lower()


def fetch_existing(token):
    """All emails already in the account, for dedup (follows pagination).

    GET /v1/emails returns drafts, scheduled, and sent, so a post that already
    has a draft is correctly skipped on re-runs.
    """
    items, path = [], "/emails"
    while path:
        status, data = api("GET", path, token)
        if status != 200:
            raise RuntimeError(f"GET /emails -> {status}: {data}")
        items.extend(data.get("results", []))
        path = data.get("next")
    return items


def already_emailed(post, existing):
    """True if Buttondown already has an email for this post.

    Matches the exact canonical_url/absolute_url, plus our own
    "Keep reading: <url>" body marker as a fallback (that marker can't collide
    with a cross-link to a *different* post). Title is intentionally NOT matched:
    two posts can share a title, and matching it would wrongly skip a real one.
    """
    url = _norm_url(post["url"])
    if not url:
        return False
    marker = ("keep reading: " + post["url"].strip()).lower()
    for e in existing:
        if _norm_url(e.get("canonical_url")) == url:
            return True
        if _norm_url(e.get("absolute_url")) == url:
            return True
        if marker in (e.get("body") or "").lower():
            return True
    return False


def _parse_date(s):
    """Parse YYYY-M-D (zero-padding optional) to a date, or None."""
    m = re.match(r"\s*(\d{4})-(\d{1,2})-(\d{1,2})", s or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def after_since(post, since):
    pd, sd = _parse_date(post["fm"].get("date")), _parse_date(since)
    return pd is not None and sd is not None and pd >= sd


def create_draft(post, token):
    """Create a DRAFT in Buttondown and confirm it is not sendable. Returns (id, url)."""
    subject, body = build_email(post)
    status, data = api("POST", "/emails", token, {
        "subject": subject, "body": body,
        "status": "draft", "canonical_url": post["url"],
    })
    if status not in (200, 201):
        raise RuntimeError(f"create draft failed ({status}): {data}")
    eid = data.get("id")
    # Belt-and-suspenders: confirm it really is an unsent draft before moving on.
    if data.get("status") != "draft":
        _, check = api("GET", f"/emails/{eid}", token)
        if check.get("status") != "draft":
            raise RuntimeError(
                f"refusing to continue: email {eid} status="
                f"{check.get('status')!r}, expected 'draft'")
    return eid, data.get("absolute_url", "")


def send_test(eid, address, token):
    """Send a draft to ONE explicit address only. Never the subscriber list."""
    if not address or "@" not in address:
        raise ValueError(f"refusing to send test: not an email address: {address!r}")
    status, data = api("POST", f"/emails/{eid}/send-draft", token,
                       {"recipients": [address]})
    if status not in (200, 201, 204):
        raise RuntimeError(f"send-test failed ({status}): {data}")
    return data


APPROVE_TTL_DAYS = 7   # the one-click approval link expires after this many days


def _approve_link(email_id, secret, base, ttl_days=APPROVE_TTL_DAYS):
    exp = int(time.time()) + ttl_days * 86400
    sig = hmac.new(secret.encode(), f"{email_id}|{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{base}?" + urlencode({"id": email_id, "exp": exp, "t": sig})


def send_approval(post, email_id, addr, token, secret, base):
    """Email a one-click approval notice for a freshly-created draft to ADDR.

    Sent via a throwaway Buttondown draft (created, test-sent to ADDR, deleted),
    so it never touches the list. The link, once clicked and confirmed, sends the
    real draft (email_id) via functions/api/newsletter-approve.js.
    """
    link = _approve_link(email_id, secret, base)
    title = (post["fm"].get("title") or "").strip()
    desc = (post["fm"].get("description") or "").strip()
    preview = "\n\n".join(x for x in (desc, extract_teaser(post["body"])) if x)
    body = (
        PLAINTEXT_MARKER + "\n"
        f"Ready to send: {title}\n\n"
        f"Approve and send to everyone:\n{link}\n\n"
        "Ignore this and it stays a draft (send it from Buttondown anytime).\n\n"
        "--- preview ---\n\n"
        f"{preview}"
    )
    status, data = api("POST", "/emails", token,
                       {"subject": f"Approve: {title}", "body": body, "status": "draft"})
    if status not in (200, 201):
        raise RuntimeError(f"approval-email create failed ({status}): {data}")
    tmp_id = data.get("id")
    try:
        send_test(tmp_id, addr, token)
    finally:
        api("DELETE", f"/emails/{tmp_id}", token)   # don't leave the throwaway behind


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _print_preview(post):
    subject, body = build_email(post)
    print("\n" + "=" * 70)
    print(f"POST     {post['path']}")
    print(f"URL      {post['url']}")
    print(f"DATE     {post['fm'].get('date', '?')}")
    print(f"SUBJECT  {subject}")
    print("-" * 70)
    print(body)
    print("=" * 70)


def main():
    ap = argparse.ArgumentParser(description="Create Buttondown drafts from new posts.")
    ap.add_argument("--docs-dir", default="docs")
    ap.add_argument("--post", action="append", help="restrict to this file (repeatable)")
    ap.add_argument("--dry-run", action="store_true", help="print emails, write nothing")
    ap.add_argument("--all", action="store_true", help="ignore the date guard")
    ap.add_argument("--force", action="store_true", help="create even if already emailed")
    ap.add_argument("--limit", type=int, default=0, help="cap number processed (0 = no cap)")
    ap.add_argument("--send-test", metavar="ADDR",
                    help="after creating, send the draft to ADDR only (never the list)")
    ap.add_argument("--approve-to", metavar="ADDR",
                    help="email a one-click approval notice for each new draft to ADDR")
    ap.add_argument("--since", default=os.environ.get("NEWSLETTER_SINCE", DEFAULT_SINCE))
    args = ap.parse_args()

    approve_secret = os.environ.get("NEWSLETTER_APPROVE_SECRET")
    approve_base = os.environ.get("NEWSLETTER_APPROVE_URL",
                                  "https://theodore.net/api/newsletter-approve")

    posts = discover(args.docs_dir, only=args.post)
    posts.sort(key=lambda p: (_parse_date(p["fm"].get("date")) or date.min, p["stem"]))
    if not posts:
        print("No candidate posts found (check the path; the post may be a draft "
              "or missing a title).")
        return 0

    # Dry run is purely local: no key, no network.
    if args.dry_run:
        shown = posts if (args.all or args.post) else [p for p in posts if after_since(p, args.since)]
        if args.limit:
            shown = shown[:args.limit]
        for p in shown:
            _print_preview(p)
        print(f"\n{len(shown)} email(s) previewed (dry-run, nothing written).")
        return 0

    token = os.environ.get("BUTTONDOWN_API_KEY")
    if not token:
        print("ERROR: BUTTONDOWN_API_KEY is not set.", file=sys.stderr)
        return 2
    if args.approve_to and not approve_secret:
        print("ERROR: --approve-to requires NEWSLETTER_APPROVE_SECRET.", file=sys.stderr)
        return 2

    existing = fetch_existing(token)
    created = deduped = before_cut = 0
    for p in posts:
        if not args.force:
            if not (args.all or after_since(p, args.since)):
                before_cut += 1
                continue
            if already_emailed(p, existing):
                deduped += 1
                print(f"skip (already emailed): {p['url']}")
                continue
        eid, archive = create_draft(p, token)
        created += 1
        print(f"draft created: {p['url']}  ->  {eid}" + (f"  ({archive})" if archive else ""))
        if args.send_test:
            send_test(eid, args.send_test, token)
            print(f"  test sent to {args.send_test} (this address only)")
        if args.approve_to:
            try:
                send_approval(p, eid, args.approve_to, token, approve_secret, approve_base)
                print(f"  approval notice sent to {args.approve_to}")
            except Exception as e:
                print(f"  WARNING: approval email failed: {e}", file=sys.stderr)
        if args.limit and created >= args.limit:
            break

    print(f"\nDone. {created} draft(s) created; {deduped} already emailed; "
          f"{before_cut} before {args.since}. Nothing sent to the list.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
