"""Sold-out accessory admission must preserve already-bound payment callbacks."""
import copy
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from hooks.store_products import _products, on_files
from test_store_launch import HookConfig

ROOT = Path(__file__).resolve().parents[1]
IDS = ('polargraph-parts', 'micron-pens-9')
# Trusted generated fields before the November 10 sold-out change. The public
# Stripe Price identifiers are intentionally included to detect binding drift.
PRIOR = {
    'polargraph-parts': {'title': 'Polargraph 3D Printed Parts', 'variants': {
        'default': {'price': 'price_1TkzoJRPSNpqisAPVlfZTzg2', 'weightLb': 1.4,
                    'maxQty': 10, 'label': '3D Printed Parts', 'priceUsd': 90}}},
    'micron-pens-9': {'title': 'Sakura Micron 05 (9-pack)', 'variants': {
        'default': {'price': 'price_1TkB7LRPSNpqisAPmfGuCIzh', 'weightLb': 0.2,
                    'maxQty': 10, 'label': '9-pack', 'priceUsd': 28},
        'with-mounts': {'price': 'price_1TkzoKRPSNpqisAPEQSKciDr', 'weightLb': 0.5,
                        'maxQty': 10, 'label': '+ 9 Mounts & Caps', 'priceUsd': 48}}},
}
LIVE_PRICES = {
    ('polargraph-parts', 'default'): 'price_1Tl0o8RPSNpqisAPnCC3CyOi',
    ('micron-pens-9', 'default'): 'price_1TkCJfRPSNpqisAPPz9Lc7ut',
    ('micron-pens-9', 'with-mounts'): 'price_1Tl0o9RPSNpqisAPlKRkfPHP',
}


def products():
    return [p for p in _products(ROOT / 'docs') if p['id'] in IDS]


def generated(mode):
    with tempfile.TemporaryDirectory() as root:
        docs = Path(root) / 'docs'
        docs.mkdir()
        config = HookConfig(docs_dir=str(docs))
        config.site_dir = str(Path(root) / 'site')
        files = []
        with patch('hooks.store_products._products', return_value=products()), \
                patch.dict(os.environ, {'STRIPE_MODE': mode}):
            on_files(files, config)
        return {f.src_uri: f.content_string for f in files}


def prior_catalog(mode):
    result = copy.deepcopy(PRIOR)
    if mode == 'live':
        for (product, build), price in LIVE_PRICES.items():
            result[product]['variants'][build]['price'] = price
    return result


class SoldOutAccessoryTests(unittest.TestCase):
    def test_public_options_and_channel_feed_are_sold_out(self):
        for product in products():
            for variant in product['variants']:
                self.assertEqual(variant['status'], 'soldout')
        rows = json.loads(generated('live')['meta-catalog-source.json'])
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(row['availability'] == 'out of stock' for row in rows))
        self.assertTrue(all(row['quantity_to_sell_on_facebook'] == 0 for row in rows))

    def test_retired_trusted_variants_preserve_exact_prior_fields_in_both_modes(self):
        for mode in ('test', 'live'):
            with self.subTest(mode=mode):
                catalog = json.loads(generated(mode)['store-catalog.json'])
                for product, old in prior_catalog(mode).items():
                    self.assertEqual(catalog[product]['title'], old['title'])
                    self.assertEqual(catalog[product]['variants'], old['variants'])
                    self.assertEqual(set(catalog[product]['retiredBuilds']), set(old['variants']))

    def test_real_checkout_rejects_new_orders_and_accepts_old_signed_callbacks(self):
        # Exercise real JS handlers against the generated catalog. Only catalog
        # reads are permitted: a new/updated retired order must fail before Stripe.
        script = r'''
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { onRequestPost as checkout } from "./functions/api/payment-intent.js";
import { onRequestPost as webhook } from "./functions/api/stripe-webhook.js";
import { createCheckoutBinding, verifyCheckoutBinding } from "./lib/shipping-binding.js";
const cases = JSON.parse(readFileSync(0, "utf8"));
let checked = 0;
for (const {mode, catalog, prior} of cases) {
  globalThis.fetch = async url => {
    assert.ok(String(url).endsWith("/store-catalog.json"), "Retirement must prevent all provider mutations");
    return new Response(JSON.stringify(catalog), {headers: {"content-type": "application/json"}});
  };
  for (const [id, product] of Object.entries(prior)) for (const build of Object.keys(product.variants)) {
    const line = {id, build, qty: 1};
    for (const update of [false, true]) {
      const request = new Request("https://example.test/api/payment-intent", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({cart: [line], ...(update ? {paymentIntentId: "pi_retired_test", updateToken: "irrelevant_before_admission"} : {})})});
      const result = await checkout({request, env: {STRIPE_SECRET_KEY: "sk_test_retirement"}});
      assert.equal(result.status, 400);
      assert.match((await result.json()).error, /closed/);
    }
    const old = await createCheckoutBinding([line], prior);
    const metadata = {items: old.legacyItems, shipping_items: old.manifestJson,
      shipping_items_sha256: old.manifestSha256, shipping_catalog_sha256: old.catalogSha256,
      shipping_profile: old.metadataProfile, checkout_ready: "1", tax_calculation: "taxcalc_historical", notified: "1"};
    assert.ok(await verifyCheckoutBinding(metadata, catalog));
    const now = Math.floor(Date.now()/1000), secret = "whsec_historical_fixture";
    const body = JSON.stringify({id: "evt_historical_fixture", created: now, livemode: mode === "live", type: "payment_intent.succeeded", data: {object: {id: "pi_historical_fixture", object: "payment_intent", status: "succeeded", amount: product.variants[build].priceUsd*100, currency: "usd", metadata}}});
    const sig = createHmac("sha256", secret).update(now + "." + body).digest("hex");
    const result = await webhook({request: new Request("https://example.test/api/stripe-webhook", {method: "POST", headers: {"stripe-signature": `t=${now},v1=${sig}`}, body}), env: {STRIPE_WEBHOOK_SECRET: secret}});
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {received: true, duplicate: true}, "Historical verified callback still reaches the already-notified receipt path");
    checked++;
  }
}
assert.equal(checked, 6);
'''
        inputs = [{'mode': mode,
                   'catalog': json.loads(generated(mode)['store-catalog.json']),
                   'prior': prior_catalog(mode)} for mode in ('test', 'live')]
        result = subprocess.run(['node', '--input-type=module', '-e', script],
                                input=json.dumps(inputs), text=True, cwd=ROOT,
                                capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
