"""The pure parts of tools/activate_batch_1.py: the live Pages config guard, the wrangler.toml and
Worker config it writes, and its edits to the assembled frame's frontmatter."""
import importlib.util
import re
import tomllib
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("activate_batch_1", ROOT / "tools" / "activate_batch_1.py")
activate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activate)


def assembled(text):
    front = text[3:text.index("\n---", 3)]
    return yaml.safe_load(front)["variants"][0]


class ActivateBatch1Tests(unittest.TestCase):
    def test_pages_guard_flags_every_binding_or_variable_except_store_inventory(self):
        self.assertEqual(activate.unexpected_pages_settings({"name": "theodore-net", "compatibility_date": "2024-11-01"}), [])
        ok = {"d1_databases": [{"binding": "STORE_INVENTORY"}],
              "env": {"production": {"d1_databases": [{"binding": "STORE_INVENTORY"}]}}}
        self.assertEqual(activate.unexpected_pages_settings(ok), [])
        risky = {"vars": {"SITE_URL": "https://theodore.net"}, "d1_databases": [{"binding": "EVENTS"}],
                 "compatibility_flags": ["nodejs_compat"],
                 "env": {"production": {"kv_namespaces": [{"binding": "KV"}], "vars": {}}}}
        self.assertEqual(sorted(activate.unexpected_pages_settings(risky)),
                         ["compatibility_flags", "d1_databases:EVENTS", "env.production.kv_namespaces", "vars"])

    def test_inventory_block_binds_test_locally_and_production_in_production_idempotently(self):
        base = (ROOT / "wrangler.toml").read_text()
        once = activate.with_inventory_block(base, activate.inventory_block("test-id", "prod-id"))
        twice = activate.with_inventory_block(once, activate.inventory_block("test-id", "prod-id"))
        self.assertEqual(once, twice)
        config = tomllib.loads(once)
        self.assertEqual(config["name"], "theodore-net")
        self.assertEqual(config["pages_build_output_dir"], "site")
        self.assertEqual(config["d1_databases"], [{"binding": "STORE_INVENTORY", "database_name": activate.DB_TEST, "database_id": "test-id"}])
        self.assertEqual(config["env"]["preview"]["d1_databases"][0]["database_id"], "test-id")
        self.assertEqual(config["env"]["production"]["d1_databases"],
                         [{"binding": "STORE_INVENTORY", "database_name": activate.DB_PROD, "database_id": "prod-id"}])
        self.assertEqual(activate.unexpected_pages_settings(config), [])
        self.assertEqual(sorted(activate.inventory_bindings(config)),
                         [("preview", activate.DB_TEST), ("production", activate.DB_PROD), ("top", activate.DB_TEST)])

    def test_compatibility_check_reads_production_not_the_preview_default(self):
        live = tomllib.loads('name = "theodore-net"\npages_build_output_dir = "site"\n'
                             'compatibility_date = "2026-06-20"\n\n[env.production]\ncompatibility_date = "2024-11-01"\n')
        self.assertEqual(activate.production_compatibility_date(live), "2024-11-01")
        self.assertEqual(activate.unexpected_pages_settings(live), [])
        self.assertEqual(activate.production_compatibility_date({"compatibility_date": "2024-11-01"}), "2024-11-01")

    def test_downloaded_config_parses_in_every_wrangler_format(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            toml_path, jsonc_path = Path(tmp) / "wrangler.toml", Path(tmp) / "wrangler.jsonc"
            toml_path.write_text('name = "theodore-net"\n[vars]\nSITE_URL = "https://theodore.net"\n')
            jsonc_path.write_text('{\n  // live config\n  "name": "theodore-net", /* block */ "url": "https://x//y",\n'
                                  '  "vars": {"A": "1",},\n}\n')
            self.assertEqual(activate.unexpected_pages_settings(activate.parse_config(toml_path)), ["vars"])
            parsed = activate.parse_config(jsonc_path)
            self.assertEqual(parsed["url"], "https://x//y")
            self.assertEqual(activate.unexpected_pages_settings(parsed), ["vars"])

    def test_worker_config_targets_production_inventory_on_a_five_minute_cron(self):
        config = tomllib.loads(activate.worker_toml("prod-id"))
        self.assertEqual(config["main"], "store-inventory-expiry.js")
        self.assertEqual(config["d1_databases"], [{"binding": "STORE_INVENTORY", "database_name": activate.DB_PROD, "database_id": "prod-id"}])
        self.assertEqual(config["triggers"]["crons"], ["*/5 * * * *"])

    def test_product_edits_touch_only_the_assembled_price_and_status(self):
        # start from the held state whether or not the repo has been activated yet
        current = (ROOT / "docs/store/avian-visitors.md").read_text()
        original = re.sub(r'^    stripePriceLive: .*\n', "", current.replace("    status: available\n", "    status: soldout\n"), flags=re.M)
        self.assertEqual(assembled(original)["status"], "soldout")
        edited = activate.with_status_available(activate.with_live_price(original, "price_LiveTest123"))
        again = activate.with_status_available(activate.with_live_price(edited, "price_LiveTest123"))
        self.assertEqual(edited, again)
        variant = assembled(edited)
        self.assertEqual(variant["status"], "available")
        self.assertEqual(variant["stripePriceLive"], "price_LiveTest123")
        self.assertEqual(variant["stripePrice"], assembled(original)["stripePrice"])
        changed = [line for line in edited.splitlines() if line not in original.splitlines()]
        self.assertEqual(changed, ["    status: available", '    stripePriceLive: "price_LiveTest123"'])
        with self.assertRaises(activate.Stop):
            activate.with_live_price(original, "price_bad id")

    def test_packed_weight_lands_on_the_assembled_variant_only(self):
        text = (ROOT / "docs/store/avian-visitors.md").read_text()
        weighed = activate.with_weight(text, 4.2)
        self.assertEqual(assembled(weighed)["weight"], 4.2)
        self.assertEqual(activate.with_weight(weighed, 4.2), weighed)
        self.assertTrue(activate.has_weight(weighed))
        with self.assertRaises(activate.Stop):
            activate.with_weight(text, 400)

    def test_stripe_params_encode_lists_as_repeated_keys(self):
        encoded = activate.form_encode({"enabled_events[]": ["a.b", "c.d"], "limit": 100})
        self.assertEqual(encoded, "enabled_events%5B%5D=a.b&enabled_events%5B%5D=c.d&limit=100")


if __name__ == "__main__":
    unittest.main()
