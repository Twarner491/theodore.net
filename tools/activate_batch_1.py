#!/usr/bin/env python3
"""Activate the Avian Visitors Batch 1 drop. One command, safe to re-run:

    tools/activate_batch_1.py           # set everything up (asks before each external change)
    tools/activate_batch_1.py --check   # read-only preflight; changes nothing anywhere

In order:
  1. Preflight: both test suites pass, and wrangler is logged in with Pages access.
  2. Reads the live theodore-net Pages config and stops if it holds any dashboard variable or
     binding that adding inventory bindings to wrangler.toml could drop.
  3. Creates the test and production inventory databases (D1), binds them in wrangler.toml,
     applies migrations/0001, and proves each fresh database holds exactly the 20-unit seed.
  4. Stripe LIVE (key typed at a hidden prompt; never printed, saved, or put on a command line):
     creates or reuses the $699 Avian Visitors price, writes stripePriceLive, and subscribes the
     theodore.net webhook to the four payment_intent events a limited batch needs. Without
     amount_capturable_updated, every Batch 1 order would stay authorized and never be charged.
  5. Deploys the inventory expiry Worker (5-minute cron, production database, its own key).
  6. Marks the assembled frame status: available. Checkout still refuses it until launchAt, so
     deploying before the drop lets the page open by itself at 9:00 AM PT.
  7. Reruns the tests and a live-mode build that must carry the live price and launch gate.

It never commits, pushes, or deploys theodore.net. Review `git diff`, then deploy before the drop.
"""
import argparse
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "theodore-net"
DB_TEST, DB_PROD = "avian-store-inventory-test", "avian-store-inventory-production"
WEBHOOK_URL = "https://theodore.net/api/stripe-webhook"
EVENTS = ["payment_intent.amount_capturable_updated", "payment_intent.succeeded",
          "payment_intent.payment_failed", "payment_intent.canceled"]
PRICE_LOOKUP, PRODUCT_NAME, TAX_CODE, AMOUNT = "avian-visitors-assembled-usd", "Avian Visitors", "txcd_99999999", 69900
PRODUCT_MD = ROOT / "docs/store/avian-visitors.md"
PAGES_TOML = ROOT / "wrangler.toml"
WORKER_TOML = ROOT / "workers/wrangler.store-inventory-expiry.toml"
BLOCK_BEGIN = "# >>> store inventory: written by tools/activate_batch_1.py"
BLOCK_END = "# <<< store inventory"
# Pages config keys that are bindings or variables. Any of these in the live project that this
# repo's wrangler.toml does not declare would be at risk when the file adds its own bindings.
BINDING_KEYS = {"vars", "kv_namespaces", "r2_buckets", "d1_databases", "services", "durable_objects",
                "queues", "ai", "analytics_engine_datasets", "hyperdrive", "vectorize", "browser",
                "mtls_certificates", "send_email", "version_metadata", "workflows", "dispatch_namespaces",
                "pipelines", "secrets_store_secrets", "images", "unsafe"}


class Stop(Exception):
    pass


def say(text):
    print("\n== " + text, flush=True)


def note(text):
    print("   " + text, flush=True)


def run(cmd, capture=True, input_text=None, env=None):
    # A captured command must never wait on a prompt nobody can see: give it a closed stdin, which
    # also makes wrangler non-interactive (e.g. `d1 create` will not offer to edit wrangler.toml).
    extra = {"input": input_text} if input_text is not None else ({"stdin": subprocess.DEVNULL} if capture else {})
    result = subprocess.run(cmd, cwd=ROOT, text=True, env=env, capture_output=capture, **extra)
    return result.returncode, (result.stdout or "") + (result.stderr or "") if capture else ""


def wrangler(*args, capture=True, input_text=None):
    return run(["npx", "--no-install", "wrangler", *args], capture=capture, input_text=input_text)


def must(code_out, what):
    code, out = code_out
    if code:
        raise Stop(what + " failed:\n" + "\n".join(out.strip().splitlines()[-15:]))
    return out


def ask(question, assume_yes):
    if assume_yes:
        return True
    return input("   " + question + " [y/N] ").strip().lower() in ("y", "yes")


# ---------- pure helpers (unit-tested in tests/test_activate_batch_1.py) ----------

def unexpected_pages_settings(config):
    """Every binding or variable in a downloaded Pages config other than STORE_INVENTORY."""
    found = []

    def scan(section, where):
        for key, value in section.items():
            if key not in BINDING_KEYS:
                continue
            if key == "d1_databases":
                for db in value or []:
                    if not isinstance(db, dict) or db.get("binding") != "STORE_INVENTORY":
                        found.append(where + "d1_databases:" + str(db.get("binding") if isinstance(db, dict) else db))
            elif value:
                found.append(where + key)
    scan(config, "")
    for env_name, section in (config.get("env") or {}).items():
        if isinstance(section, dict):
            scan(section, "env." + env_name + ".")
    if config.get("compatibility_flags"):
        found.append("compatibility_flags")
    return found


def parse_config(path):
    """A Wrangler config in any of its formats (TOML, JSON, or JSON with comments)."""
    text = Path(path).read_text()
    if str(path).endswith(".toml"):
        return tomllib.loads(text)
    text = re.sub(r'("(?:\\.|[^"\\])*")|//[^\n]*|/\*.*?\*/', lambda m: m.group(1) or "", text, flags=re.S)
    text = re.sub(r",(\s*[}\]])", r"\1", text)   # JSONC allows trailing commas
    return json.loads(text)


def production_compatibility_date(config):
    """The date production actually runs. A downloaded Pages config keeps the dashboard's preview
    default at the top level and the deployed production value under [env.production]."""
    production = (config.get("env") or {}).get("production") or {}
    return production.get("compatibility_date") or config.get("compatibility_date")


def inventory_bindings(config):
    """Every STORE_INVENTORY D1 binding in a config, as (scope, database_name)."""
    out = [("top", db.get("database_name")) for db in config.get("d1_databases") or [] if db.get("binding") == "STORE_INVENTORY"]
    for env_name, section in (config.get("env") or {}).items():
        out += [(env_name, db.get("database_name")) for db in (section or {}).get("d1_databases") or []
                if db.get("binding") == "STORE_INVENTORY"]
    return out


def inventory_block(test_id, prod_id):
    def db(header, name, db_id):
        return '[[%s]]\nbinding = "STORE_INVENTORY"\ndatabase_name = "%s"\ndatabase_id = "%s"\n' % (header, name, db_id)
    return (BLOCK_BEGIN + "\n" + db("d1_databases", DB_TEST, test_id) + "\n" +
            db("env.preview.d1_databases", DB_TEST, test_id) + "\n" +
            db("env.production.d1_databases", DB_PROD, prod_id) + BLOCK_END + "\n")


def with_inventory_block(toml_text, block):
    pattern = re.compile(re.escape(BLOCK_BEGIN) + r".*?" + re.escape(BLOCK_END) + r"\n?", re.S)
    if pattern.search(toml_text):
        return pattern.sub(lambda _: block, toml_text)
    return toml_text.rstrip("\n") + "\n\n" + block


def worker_toml(prod_id):
    return ('# Written by tools/activate_batch_1.py. Production inventory expiry sweep.\n'
            'name = "theodore-store-inventory-expiry"\nmain = "store-inventory-expiry.js"\n'
            'compatibility_date = "2026-08-31"\n\n[[d1_databases]]\nbinding = "STORE_INVENTORY"\n'
            'database_name = "%s"\ndatabase_id = "%s"\n\n[triggers]\ncrons = ["*/5 * * * *"]\n' % (DB_PROD, prod_id))


def assembled_block(text):
    """(start, end) of the assembled variant's lines in the product frontmatter."""
    start = text.index("  - id: assembled\n")
    nxt = re.search(r"\n(  - id: |[a-zA-Z])", text[start + 1:])
    end = start + 1 + nxt.start() + 1 if nxt else len(text)
    return start, end


def with_live_price(text, price_id):
    if not re.fullmatch(r"price_[A-Za-z0-9]+", price_id):
        raise Stop("unexpected Stripe price id: " + price_id)
    start, end = assembled_block(text)
    block = text[start:end]
    line = '    stripePriceLive: "%s"\n' % price_id
    if re.search(r"^    stripePriceLive:.*\n", block, re.M):
        block = re.sub(r"^    stripePriceLive:.*\n", line, block, count=1, flags=re.M)
    else:
        block = re.sub(r"(^    stripePrice: .*\n)", r"\1" + line.replace("\\", "\\\\"), block, count=1, flags=re.M)
    if line not in block:
        raise Stop("could not place stripePriceLive in the assembled variant")
    return text[:start] + block + text[end:]


def with_status_available(text):
    start, end = assembled_block(text)
    block = text[start:end]
    if "    status: available\n" in block:
        return text
    if block.count("    status: soldout\n") != 1:
        raise Stop("expected exactly one 'status: soldout' in the assembled variant")
    return text[:start] + block.replace("    status: soldout\n", "    status: available\n") + text[end:]


def with_weight(text, pounds):
    """Set the assembled variant's packed shipping weight (lb), which prices its shipping."""
    if not 0.5 <= pounds <= 40:
        raise Stop("a packed frame should weigh between 0.5 and 40 lb")
    start, end = assembled_block(text)
    block = text[start:end]
    line = "    weight: %s   # packed, lb (set by tools/activate_batch_1.py)\n" % ("%g" % pounds)
    if re.search(r"^    weight:.*\n", block, re.M):
        block = re.sub(r"^    weight:.*\n", line, block, count=1, flags=re.M)
    else:
        block = re.sub(r"(^    price: .*\n)", lambda m: m.group(1) + line, block, count=1, flags=re.M)
    if line not in block:
        raise Stop("could not place weight in the assembled variant")
    return text[:start] + block + text[end:]


def has_weight(text):
    start, end = assembled_block(text)
    return re.search(r"^    weight:", text[start:end], re.M) is not None


def form_encode(params):
    pairs = []
    for key, value in params.items():
        for item in (value if isinstance(value, list) else [value]):
            pairs.append((key, str(item)))
    return urllib.parse.urlencode(pairs)


# ---------- steps ----------

def preflight(check):
    say("1. Preflight")
    for path in ("migrations/0001_store_inventory.sql", "tools/verify-store-inventory-export.mjs",
                 "workers/store-inventory-expiry.js", "docs/store/avian-visitors.md"):
        if not (ROOT / path).exists():
            raise Stop("missing " + path)
    mkdocs = shutil.which("mkdocs")
    if not mkdocs:
        raise Stop("mkdocs is not on PATH")
    first = open(mkdocs).readline()
    python = first[2:].strip() if first.startswith("#!") else sys.executable
    must(run(["npm", "test", "--silent"]), "npm test")
    must(run([python, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-q"]), "python tests")
    note("tests pass")
    code, out = wrangler("pages", "project", "list")
    if code or PROJECT not in out:
        if check:
            note("wrangler cannot read Pages projects yet (run `npx wrangler login`); skipping Cloudflare checks")
            return python, False
        note("wrangler needs a login with Pages access; opening the browser")
        must(wrangler("login", capture=False), "wrangler login")
        code, out = wrangler("pages", "project", "list")
        if code or PROJECT not in out:
            raise Stop("wrangler still cannot see the %s Pages project:\n%s" % (PROJECT, out[-800:]))
    note("wrangler can see the %s Pages project" % PROJECT)
    return python, True


def pages_config_check():
    say("2. Live Pages config")
    with tempfile.TemporaryDirectory() as tmp:
        # download writes wrangler.toml into its working directory: run it ONLY in a temp dir,
        # never in the repo, or it would overwrite this project's wrangler.toml
        result = subprocess.run(["npx", "--no-install", "wrangler", "pages", "download", "config", PROJECT, "--force"],
                                cwd=tmp, text=True, capture_output=True, stdin=subprocess.DEVNULL)
        files = [Path(tmp) / n for n in ("wrangler.toml", "wrangler.json", "wrangler.jsonc") if (Path(tmp) / n).exists()]
        if result.returncode or not files:
            raise Stop("could not download the Pages config:\n" + (result.stdout + result.stderr)[-800:])
        live = parse_config(files[0])
    ours = tomllib.loads(PAGES_TOML.read_text())
    extra = unexpected_pages_settings(live)
    if extra:
        raise Stop("the live Pages project has settings wrangler.toml does not declare: " + ", ".join(extra) +
                   "\nAdd them to wrangler.toml (secrets are unaffected), then re-run.")
    live_date = production_compatibility_date(live)
    if live_date and live_date != ours.get("compatibility_date"):
        raise Stop("live production compatibility_date %r differs from wrangler.toml %r" %
                   (live_date, ours.get("compatibility_date")))
    note("no dashboard vars or bindings to preserve; production compatibility_date matches")


def d1_ids():
    # stdout only: wrangler prints warnings like "[WARNING]" on stderr, which would break the JSON
    result = subprocess.run(["npx", "--no-install", "wrangler", "d1", "list", "--json"], cwd=ROOT,
                            text=True, capture_output=True, stdin=subprocess.DEVNULL)
    if result.returncode:
        raise Stop("wrangler d1 list failed:\n" + result.stderr[-800:])
    try:
        rows = json.loads(result.stdout)
    except ValueError:
        raise Stop("could not read `wrangler d1 list --json`:\n" + result.stdout[-400:])
    return {row.get("name"): row.get("uuid") for row in rows}


def databases(check, assume_yes, python):
    say("3. Inventory databases")
    ids = d1_ids()
    for name in (DB_TEST, DB_PROD):
        if ids.get(name):
            note("%s exists" % name)
        elif check:
            note("%s does not exist yet" % name)
        elif ask("Create D1 database %s (location wnam)?" % name, assume_yes):
            must(wrangler("d1", "create", name, "--location=wnam"), "create " + name)
        else:
            raise Stop("stopped before creating " + name)
    if check:
        return None
    ids = d1_ids()
    test_id, prod_id = ids.get(DB_TEST), ids.get(DB_PROD)
    if not test_id or not prod_id:
        raise Stop("could not read both database ids after creation")
    PAGES_TOML.write_text(with_inventory_block(PAGES_TOML.read_text(), inventory_block(test_id, prod_id)))
    bound = sorted(inventory_bindings(tomllib.loads(PAGES_TOML.read_text())))
    if bound != [("preview", DB_TEST), ("production", DB_PROD), ("top", DB_TEST)]:
        raise Stop("wrangler.toml should bind STORE_INVENTORY exactly once per scope, found: %r" % bound)
    note("wrangler.toml binds STORE_INVENTORY (test for local/preview, production for production)")

    for name, env in ((DB_TEST, []), (DB_PROD, ["--env", "production"])):
        out = must(wrangler("d1", "migrations", "list", name, "--remote", *env), "list migrations for " + name)
        fresh = "0001_store_inventory.sql" in out and "No migrations to apply" not in out
        if fresh:
            if not ask("Apply migrations/0001 to %s?" % name, assume_yes):
                raise Stop("stopped before migrating " + name)
            must(wrangler("d1", "migrations", "apply", name, "--remote", *env, input_text="y\n"), "migrate " + name)
            with tempfile.TemporaryDirectory() as tmp:
                dump = str(Path(tmp) / (name + ".sql"))
                must(wrangler("d1", "export", name, "--remote", *env, "--output=" + dump), "export " + name)
                verdict = must(run(["node", "tools/verify-store-inventory-export.mjs", dump]), "verify " + name)
            if '"ok":true' not in verdict.replace(" ", ""):
                raise Stop("%s did not verify as the pristine 20-unit seed:\n%s" % (name, verdict[-600:]))
            note("%s migrated and verified: exact schema, 20 units, no reservations" % name)
        else:
            out = must(wrangler("d1", "execute", name, "--remote", *env, "--json", "--command",
                                "SELECT capacity, reserved_quantity, sold_quantity FROM store_inventory_batches"),
                       "read " + name)
            note("%s already migrated; batch counters: %s" % (name, out[out.find("[{"):].split("]")[0][:200]))
    must(wrangler("d1", "migrations", "apply", DB_TEST, "--local", input_text="y\n"), "local migration")
    note("local preview database migrated (wrangler pages dev)")
    return prod_id


class Stripe:
    def __init__(self, key):
        self.key = key

    def call(self, method, path, params=None):
        data = form_encode(params).encode() if params and method == "POST" else None
        url = "https://api.stripe.com/v1" + path + ("?" + form_encode(params) if params and method == "GET" else "")
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": "Bearer " + self.key, "Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            body = error.read().decode(errors="replace")
            try:
                message = json.loads(body)["error"]["message"]
            except Exception:
                message = body[:300]
            raise Stop("Stripe %s %s -> %s: %s" % (method, path, error.code, message))


def live_key(prompt, allow_blank=False):
    key = getpass.getpass("   " + prompt)
    if allow_blank and not key:
        return ""
    if not re.fullmatch(r"(sk|rk)_live_[A-Za-z0-9]+", key):
        raise Stop("that is not a Stripe LIVE secret or restricted key")
    return key


def stripe_live(check, assume_yes):
    say("4. Stripe live")
    key = live_key("Stripe LIVE key with write on Products, Prices, and Webhook Endpoints"
                   + (" (Enter to skip): " if check else ": "), allow_blank=check)
    if not key:
        note("skipped")
        return None, None
    stripe = Stripe(key)
    found = stripe.call("GET", "/prices", {"lookup_keys[]": PRICE_LOOKUP, "active": "true", "expand[]": "data.product"})["data"]
    if found:
        price = found[0]
        if price["unit_amount"] != AMOUNT or price["currency"] != "usd" or price["type"] != "one_time":
            raise Stop("live price %s is not a one-time $699 USD price" % price["id"])
        note("reusing live price %s ($699, tax code %s)" % (price["id"], price["product"].get("tax_code")))
    elif check:
        note("no live $699 price yet (lookup key %s)" % PRICE_LOOKUP)
        price = None
    elif ask("Create the live Avian Visitors product and $699 price?", assume_yes):
        product = stripe.call("POST", "/products", {"name": PRODUCT_NAME, "tax_code": TAX_CODE,
                                                    "metadata[store_id]": "avian-visitors", "metadata[variant]": "assembled"})
        price = stripe.call("POST", "/prices", {"product": product["id"], "unit_amount": AMOUNT, "currency": "usd",
                                                "lookup_key": PRICE_LOOKUP, "metadata[store_id]": "avian-visitors"})
        note("created live price %s" % price["id"])
    else:
        raise Stop("stopped before creating the live price")

    endpoints = [e for e in stripe.call("GET", "/webhook_endpoints", {"limit": 100})["data"] if e.get("url") == WEBHOOK_URL]
    if len(endpoints) != 1:
        raise Stop("expected exactly one live webhook for %s, found %d" % (WEBHOOK_URL, len(endpoints)))
    endpoint = endpoints[0]
    if endpoint.get("status") != "enabled":
        raise Stop("the live webhook %s is %s" % (endpoint["id"], endpoint.get("status")))
    current = set(endpoint.get("enabled_events") or [])
    missing = [] if "*" in current else [e for e in EVENTS if e not in current]
    if not missing:
        note("webhook %s already receives all four payment_intent events" % endpoint["id"])
    elif check:
        note("webhook %s is missing: %s" % (endpoint["id"], ", ".join(missing)))
    elif ask("Add %s to webhook %s?" % (", ".join(missing), endpoint["id"]), assume_yes):
        updated = stripe.call("POST", "/webhook_endpoints/" + endpoint["id"],
                              {"enabled_events[]": sorted(current | set(EVENTS))})
        if not set(EVENTS) <= set(updated.get("enabled_events") or []):
            raise Stop("Stripe did not keep the webhook events")
        note("webhook %s now receives all four payment_intent events" % endpoint["id"])
    else:
        raise Stop("stopped before updating the webhook")
    return (price["id"] if price else None), key


def expiry_worker(prod_id, setup_key, assume_yes):
    say("5. Inventory expiry Worker")
    WORKER_TOML.write_text(worker_toml(prod_id))
    if not ask("Deploy theodore-store-inventory-expiry (every 5 minutes, production database)?", assume_yes):
        raise Stop("stopped before deploying the expiry Worker")
    must(wrangler("deploy", "--config", str(WORKER_TOML.relative_to(ROOT))), "deploy the expiry Worker")
    key = live_key("LIVE key for the Worker (a restricted key with PaymentIntents: Write is enough; "
                   "Enter reuses the key above): ", allow_blank=True) or setup_key
    must(wrangler("secret", "put", "STRIPE_SECRET_KEY", "--config", str(WORKER_TOML.relative_to(ROOT)),
                  input_text=key), "set the Worker's Stripe key")
    out = must(wrangler("secret", "list", "--config", str(WORKER_TOML.relative_to(ROOT))), "list Worker secrets")
    if "STRIPE_SECRET_KEY" not in out:
        raise Stop("the Worker's STRIPE_SECRET_KEY is not set")
    note("deployed with its Stripe key; it cancels holds that outlive 30 minutes")


def activate_product(price_id):
    say("6. Assembled frame")
    text = with_status_available(with_live_price(PRODUCT_MD.read_text(), price_id))
    if not has_weight(text):
        answer = input("   Packed shipping weight of one assembled frame, in lb (it prices shipping): ").strip()
        try:
            text = with_weight(text, float(answer))
        except ValueError:
            raise Stop("not a number: %r" % answer)
    PRODUCT_MD.write_text(text)
    note("status: available, stripePriceLive: %s, packed weight set (checkout still waits for launchAt)" % price_id)


def final_checks(python, price_id):
    say("7. Final checks")
    must(run(["npm", "test", "--silent"]), "npm test")
    must(run([python, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-q"]), "python tests")
    with tempfile.TemporaryDirectory() as tmp:
        env = dict(os.environ, STRIPE_MODE="live")
        must(run([shutil.which("mkdocs"), "build", "-q", "-d", tmp], env=env), "live-mode build")
        catalog = json.loads((Path(tmp) / "store-catalog.json").read_text())
    entry = catalog.get("avian-visitors", {}).get("variants", {}).get("assembled", {})
    if entry.get("price") != price_id or not entry.get("launchAt") or entry.get("inventorySku") != "avian-gen3-batch-01":
        raise Stop("the live-mode catalog does not carry the assembled frame's live price and launch gate: %r" % entry)
    note("tests pass; the live catalog sells the frame at %s, gated until %s" % (price_id, entry["launchAt"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true", help="read-only preflight; change nothing")
    parser.add_argument("--yes", action="store_true", help="do not ask before each external change")
    args = parser.parse_args()
    try:
        python, cloudflare = preflight(args.check)
        if cloudflare:
            pages_config_check()
            prod_id = databases(args.check, args.yes, python)
        price_id, key = stripe_live(args.check, args.yes)
        if args.check:
            say("Check complete. Nothing was changed.")
            return 0
        expiry_worker(prod_id, key, args.yes)
        activate_product(price_id)
        final_checks(python, price_id)
    except Stop as stop:
        print("\nSTOPPED: " + str(stop), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nSTOPPED by you.", file=sys.stderr)
        return 1
    say("Done. Batch 1 is ready to deploy.")
    changed = subprocess.run(["git", "status", "--short", "--", "wrangler.toml", str(WORKER_TOML.relative_to(ROOT)),
                              "docs/store/avian-visitors.md"], cwd=ROOT, text=True, capture_output=True).stdout
    print(changed)
    note("Next: review `git diff`, then deploy before the drop (push to main).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
