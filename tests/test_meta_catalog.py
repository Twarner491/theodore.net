import csv
import io
import json
import unittest

from hooks.store_products import _meta_catalog_csv, _products
from test_store_launch import build, drop
from urllib.parse import parse_qs, urlsplit


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

    def test_real_catalog_links_select_the_advertised_build_and_price(self):
        from pathlib import Path
        docs = Path(__file__).resolve().parents[1] / 'docs'
        products = _products(docs)
        source = json.loads(build(products)['meta-catalog-source.json'])
        by_id = {row['id']: row for row in source}
        frame = by_id['avian-visitors']
        self.assertEqual(frame['link'], 'https://theodore.net/store/avian-visitors/')
        self.assertEqual(frame['price'], '699.00 USD')
        self.assertEqual(frame['availability'], 'in stock')
        for product_id, price in [('avian-visitors-kit', 520), ('avian-mic', 210)]:
            with self.subTest(product=product_id):
                row = by_id[product_id + '-electronics-printed']
                url = urlsplit(row['link'])
                selected = parse_qs(url.query).get('variant', [None])[0]
                self.assertEqual(selected, 'electronics-printed')
                product = next(p for p in products if p['id'] == product_id)
                variant = next(v for v in product['variants'] if v['id'] == selected)
                self.assertEqual(url.path, '/store/' + product_id + '/')
                self.assertEqual(variant['price'], price)
                self.assertEqual(row['price'], '%.2f USD' % price)
                self.assertEqual(row['availability'], 'in stock')

    def test_real_kit_listing_fields_carry_exact_store_copy_weight_and_images(self):
        from pathlib import Path
        docs = Path(__file__).resolve().parents[1] / 'docs'
        products = _products(docs)
        by_id = {row['id']: row for row in json.loads(build(products)['meta-catalog-source.json'])}
        expected = {  # store weight + 0.3 lb packaging, exactly as checkout prices shipping
            'avian-visitors-kit-electronics': ('avian-visitors-kit', 'electronics', 450, 2.0),
            'avian-visitors-kit-electronics-printed': ('avian-visitors-kit', 'electronics-printed', 520, 3.5),
            'avian-mic-electronics': ('avian-mic', 'electronics', 180, 0.9),
            'avian-mic-electronics-printed': ('avian-mic', 'electronics-printed', 210, 1.05),
        }
        for sku, (group, variant_id, price, weight) in expected.items():
            with self.subTest(sku=sku):
                row = by_id[sku]
                product = next(p for p in products if p['id'] == group)
                variant = next(v for v in product['variants'] if v['id'] == variant_id)
                self.assertEqual((row['group'], row['variantId'], row['price']), (group, variant_id, '%.2f USD' % price))
                self.assertEqual(row['productTitle'], product['title'])
                self.assertEqual(row['variantLabel'], variant['label'])
                self.assertEqual(row['shipWeightLb'], weight)
                self.assertTrue(row['listingImages'])
                self.assertTrue(all(u.startswith('https://theodore.net/') for u in row['listingImages']))
                description = row['listingDescription']
                self.assertTrue(description.startswith('<p>'))
                self.assertNotRegex(description, r'<(?!/?(p|ul|li)>)')   # paragraphs and lists only
                for line in variant.get('contents') or []:
                    self.assertIn(line.replace('&', '&amp;'), description)

    def test_listing_description_drops_links_and_markup_but_keeps_store_words(self):
        from hooks.store_products import _listing_description
        text = _listing_description({
            'sub': 'A <em>tiny</em> mic.', 'softwareNote': 'Hardware only.',
            'variants': [{'id': 'a', 'label': 'Kit', 'desc': 'All parts.', 'contents': ['Pi & SD']},
                         {'id': 'b', 'label': '+ Case', 'contents': []}],
            'sections': [{'label': 'Pairs with', 'items': ['A <a href="/x/">Frame</a> or `birdnet.local`']}],
            'colophon': 'Sold as hardware.'})
        self.assertEqual(text, '<p>A tiny mic.</p><p>Kit: All parts.</p><ul><li>Pi &amp; SD</li></ul>'
                               '<p>+ Case</p><p>Hardware only.</p><p>Pairs with</p>'
                               '<ul><li>A Frame or birdnet.local</li></ul><p>Sold as hardware.</p>')

    def test_variant_link_encodes_query_delimiters_without_changing_the_feed_identity(self):
        product = drop('2000-01-01T00:00:00Z')
        product['variants'][0]['id'] = 'printed & mounted'
        row = list(csv.DictReader(io.StringIO(_meta_catalog_csv([product]))))[0]
        self.assertEqual(row['id'], 'frame-printed & mounted')
        self.assertEqual(parse_qs(urlsplit(row['link']).query), {'variant': ['printed & mounted']})

