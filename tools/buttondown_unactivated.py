#!/usr/bin/env python3
"""Unactivated (never-confirmed) subscribers on the theodore.net Buttondown list.

Default is a DRY RUN: it only reads and prints counts. Nothing is sent or changed
unless you pass --remind or --activate together with --yes.

  python tools/buttondown_unactivated.py                     # counts + what would happen
  python tools/buttondown_unactivated.py --remind --yes      # resend the confirmation reminder
  python tools/buttondown_unactivated.py --activate --yes    # flip to `regular` (skips flagged)

  --include-flagged  also act on addresses Buttondown's firewall flagged (typo, random-looking,
                     noreply@...) or scored risky. Off by default: those are the likely bounces.
  --tag NAME         restrict to subscribers carrying this tag (e.g. waitlist)
  --limit N          act on at most N (use --limit 1 to trial on a single address first)
  --older-than DAYS  only subscribers created at least DAYS ago (default 0 = everyone)
  --email ADDR       act on exactly this one address (for a trial run on your own signup)
  --exclude ADDR     skip this address (repeatable; e.g. one already handled in a trial)

Env: BUTTONDOWN_API_KEY, or the key in .dev.vars at the repo root.

Notes
- `unactivated` subscribers never receive newsletter sends; there is no per-send override.
- --remind uses POST /subscribers/{id}/send-reminder (the Settings > Subscribing > Reminder
  text). --activate uses PATCH {"type": "regular"}; Buttondown's API allows `regular` to be
  set programmatically and the state chart allows unactivated -> regular.
- Each action is logged (id, email, outcome) to the file printed at the end.
"""
import argparse, json, os, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

API = os.environ.get("BUTTONDOWN_API_BASE", "https://api.buttondown.email/v1")
RISK_FLAG = 0.5   # risk_score at/above this counts as flagged


def load_key():
    k = os.environ.get("BUTTONDOWN_API_KEY")
    if k:
        return k
    dv = Path(__file__).resolve().parent.parent / ".dev.vars"
    if dv.exists():
        for line in dv.read_text().splitlines():
            if line.startswith("BUTTONDOWN_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("BUTTONDOWN_API_KEY is not set (env or .dev.vars)")


def api(method, path, key, data=None):
    url = path if path.startswith("http") else API + path
    req = urllib.request.Request(url, data=(json.dumps(data).encode() if data is not None else None),
                                 headers={"Authorization": f"Token {key}", "Content-Type": "application/json"},
                                 method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read().decode()
            return r.status, (json.loads(t) if t.strip() else {})
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try:
            return e.code, json.loads(t)
        except ValueError:
            return e.code, {"_raw": t[:300]}


def fetch_unactivated(key):
    items, path = [], "/subscribers?type=unactivated"
    while path:
        st, d = api("GET", path, key)
        if st != 200:
            sys.exit(f"GET subscribers -> {st}: {d}")
        items.extend(d.get("results", []))
        path = d.get("next")
    return [s for s in items if s.get("type") == "unactivated"]


def flagged(s):
    return bool(s.get("firewall_reasons")) or (s.get("risk_score") or 0) >= RISK_FLAG


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--remind", action="store_true", help="resend the confirmation reminder email")
    ap.add_argument("--activate", action="store_true", help="set type=regular (they start receiving sends)")
    ap.add_argument("--yes", action="store_true", help="actually do it (otherwise dry run)")
    ap.add_argument("--include-flagged", action="store_true")
    ap.add_argument("--tag")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--older-than", type=int, default=0, metavar="DAYS")
    ap.add_argument("--email", metavar="ADDR")
    ap.add_argument("--exclude", action="append", default=[], metavar="ADDR")
    a = ap.parse_args()
    if a.remind and a.activate:
        sys.exit("pick one of --remind / --activate")

    key = load_key()
    subs = fetch_unactivated(key)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=a.older_than)

    chosen, skipped_flagged, skipped_tag, skipped_age = [], 0, 0, 0
    for s in sorted(subs, key=lambda x: x.get("creation_date", "")):
        if (s.get("email_address") or "").lower() in {e.lower() for e in a.exclude}:
            skipped_tag += 1; continue
        if a.email and (s.get("email_address") or "").lower() != a.email.lower():
            skipped_tag += 1; continue
        if a.tag and a.tag not in (s.get("tags") or []):
            skipped_tag += 1; continue
        if datetime.fromisoformat(s["creation_date"].replace("Z", "+00:00")) > cutoff:
            skipped_age += 1; continue
        if flagged(s) and not a.include_flagged:
            skipped_flagged += 1; continue
        chosen.append(s)
    if a.limit:
        chosen = chosen[:a.limit]

    print(f"unactivated total: {len(subs)}")
    print(f"selected: {len(chosen)}   (skipped: {skipped_flagged} flagged, {skipped_tag} tag mismatch, {skipped_age} too recent)")
    if not (a.remind or a.activate):
        print("dry run: pass --remind or --activate (plus --yes) to act.")
        return 0
    action = "remind" if a.remind else "activate"
    if not a.yes:
        print(f"dry run: would {action} {len(chosen)} subscriber(s). Add --yes to proceed.")
        return 0

    log_dir = Path.home() / ".cache" / "theodore"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"buttondown_{action}_{now.strftime('%Y%m%d-%H%M%S')}.json"
    log, ok, bad = [], 0, 0
    for s in chosen:
        sid, email = s["id"], s.get("email_address")
        if a.remind:
            st, d = api("POST", f"/subscribers/{sid}/send-reminder", key, {})
            good = st in (200, 201, 204)
        else:
            st, d = api("PATCH", f"/subscribers/{sid}", key, {"type": "regular"})
            good = st == 200 and d.get("type") == "regular"
            if st == 200 and not good:                    # re-read to be sure
                st2, d2 = api("GET", f"/subscribers/{sid}", key)
                good = st2 == 200 and d2.get("type") == "regular"
        ok += good; bad += (not good)
        log.append({"id": sid, "email": email, "status": st, "ok": good,
                    "detail": (d.get("detail") or d.get("code") or d.get("_raw") or "") if not good else ""})
        print(f"{'ok ' if good else 'ERR'} {st} {email}" + ("" if good else f"  {log[-1]['detail']}"))
        time.sleep(0.3)
    log_path.write_text(json.dumps(log, indent=1))
    print(f"\n{action}: {ok} ok, {bad} failed. Log: {log_path}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
