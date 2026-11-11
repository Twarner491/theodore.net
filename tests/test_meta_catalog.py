import csv
import io
import json
import unittest

from hooks.store_products import _meta_catalog_csv, _products
from test_store_launch import build, drop


class MetaCatalogTests(unittest.TestCase):
    def test_sold_out_items_explicitly_clear_meta_stock(self):
        rows = list(csv.DictReader(io.StringIO(_meta_catalog_csv([
            drop('2000-01-01T00:00:00Z', status='soldout')]))))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['availability'], 'out of stock')
        self.assertEqual(rows[0]['quantity_to_sell_on_facebook'], '0')

    def test_finite_default_build_keeps_product_identity_and_gallery_across_batches(self):
        for batch in (2, 3):
            product = drop('2000-01-01T00:00:00Z', inventorySku=f'avian-gen3-batch-0{batch}',
                           shippingProfile='contiguous-us-ground')
            product.update(metaCatalogId='frame', imageBase='/photos/', images=['front.png', 'back.png'])
            rows = list(csv.DictReader(io.StringIO(_meta_catalog_csv([product]))))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['id'], 'frame')
            self.assertEqual(rows[0]['availability'], 'out of stock')
            self.assertEqual(rows[0]['quantity_to_sell_on_facebook'], '0')
            self.assertEqual(rows[0]['image_link'], 'https://theodore.net/photos/front.png')
            self.assertEqual(rows[0]['additional_image_link'], 'https://theodore.net/photos/back.png')

    def test_runtime_source_includes_finite_inventory_and_future_launch_gate(self):
        product = drop('2999-01-01T00:00:00Z', inventorySku='avian-gen3-batch-02',
                       shippingProfile='contiguous-us-ground')
        source = json.loads(build([product])['meta-catalog-source.json'])
        self.assertEqual(source[0]['inventorySku'], 'avian-gen3-batch-02')
        self.assertEqual(source[0]['launchAt'], '2999-01-01T00:00:00Z')

    def test_production_source_keeps_stable_identity_and_static_feed_fails_closed(self):
        product = drop('2000-01-01T00:00:00Z', productionBatchGroup='avian-visitors',
                       shippingProfile='contiguous-us-ground')
        product.update(metaCatalogId='avian-visitors')
        generated = build([product])
        source = json.loads(generated['meta-catalog-source.json'])
        self.assertEqual(source[0]['id'], 'avian-visitors')
        self.assertEqual(source[0]['productionBatchGroup'], 'avian-visitors')
        self.assertEqual(source[0]['quantity_to_sell_on_facebook'], 25)
        self.assertIsNone(source[0]['inventorySku'])
        row = list(csv.DictReader(io.StringIO(generated['meta-catalog.csv'])))[0]
        self.assertEqual(row['availability'], 'out of stock')
        self.assertEqual(row['quantity_to_sell_on_facebook'], '0')
        self.assertNotIn('productionBatchGroup', row)

    def test_real_live_catalog_has_one_assembled_frame_and_no_buyable_polargraphs(self):
        from pathlib import Path
        docs = Path(__file__).resolve().parents[1] / 'docs'
        rows = list(csv.DictReader(io.StringIO(_meta_catalog_csv(_products(docs), 'stripePriceLive', docs))))
        frame = [r for r in rows if r['id'] == 'avian-visitors']
        self.assertEqual(len(frame), 1)
        self.assertEqual(frame[0]['price'], '699.00 USD')
        self.assertEqual(frame[0]['availability'], 'out of stock')
        self.assertEqual(frame[0]['quantity_to_sell_on_facebook'], '0')
        polargraphs = [r for r in rows if r['id'] in ('polargraph-electronics', 'polargraph-electronics-printed')]
        self.assertEqual(len(polargraphs), 2)
        self.assertTrue(all(r['availability'] == 'out of stock' for r in polargraphs))

