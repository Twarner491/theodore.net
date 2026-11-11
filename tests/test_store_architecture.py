import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image

from hooks.search_data import _scan_store
from hooks.store_products import _inventory_sku, _production_batch_group, _products, _shipping_profile, on_files


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'


class AvianVisitorsStoreArchitectureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.products = {product['id']: product for product in _products(DOCS)}

    def test_assembled_product_and_diy_kit_are_separate_catalog_entries(self):
        assembled = self.products['avian-visitors']
        kit = self.products['avian-visitors-kit']

        self.assertTrue(assembled['published'])
        self.assertEqual(assembled['defaultBuild'], 'assembled-continuous')
        self.assertEqual([variant['id'] for variant in assembled['variants']], ['assembled-continuous'])
        assembled_variant = assembled['variants'][0]
        self.assertNotIn('comingSoon', assembled_variant)
        self.assertEqual(assembled_variant['price'], 699)
        self.assertEqual(assembled_variant['stripePrice'], 'price_1UAyqjRPSNpqisAPDHJxogp3')
        self.assertNotIn('localPreview', assembled_variant)
        self.assertEqual(assembled_variant['shippingProfile'], 'contiguous-us-ground')
        self.assertEqual(assembled_variant['productionBatchGroup'], 'avian-visitors')
        self.assertNotIn('inventorySku', assembled_variant)
        self.assertNotIn('batchSize', assembled_variant)
        self.assertEqual(assembled_variant['maxQuantity'], 20)
        self.assertEqual(assembled_variant['status'], 'available')
        self.assertRegex(assembled_variant['stripePriceLive'], r'^price_[A-Za-z0-9]+$')
        self.assertNotIn('launchAt', assembled_variant)
        self.assertEqual(assembled_variant['label'], 'Assembled')
        self.assertNotIn('batchLabel', assembled_variant)
        self.assertNotIn('batchSizePrivate', assembled_variant)
        self.assertEqual(assembled['storeListings'], [{
            'category': 'products',
            'build': 'assembled-continuous',
            'variants': ['assembled-continuous'],
            'title': 'Avian Visitors',
        }])

        self.assertEqual(kit['defaultBuild'], 'electronics')
        self.assertEqual(
            [variant['id'] for variant in kit['variants']],
            ['electronics', 'electronics-printed'],
        )
        self.assertEqual(kit['storeListings'], [{
            'category': 'kits',
            'build': 'electronics',
            'variants': ['electronics', 'electronics-printed'],
            'title': 'Avian Visitors Kit',
        }])

    def test_assembled_frame_is_listed_as_a_product_without_rejoining_the_kit(self):
        listings = []
        for product in self.products.values():
            if not product.get('published'):
                continue
            configured = product.get('storeListings') or [{
                'category': 'accessories' if product.get('accessory') else 'kits',
            }]
            listings.extend((listing['category'], product['id']) for listing in configured)

        self.assertEqual(
            [product_id for category, product_id in listings if category == 'products'],
            ['avian-visitors'],
        )
        self.assertIn(('kits', 'avian-visitors-kit'), listings)
        self.assertNotIn(('kits', 'avian-visitors'), listings)

    def test_assembled_copy_is_reduced_to_four_essential_sections(self):
        assembled = self.products['avian-visitors']
        variant = assembled['variants'][0]

        self.assertNotIn('desc', variant)
        self.assertEqual(variant['softwareNote'], "I assemble each frame by hand. Batches 1 and 2 are expected to ship by the end of 2026, and I'm working hard to get subsequent batches out as soon as possible.")
        self.assertNotIn('colophon', assembled)
        self.assertEqual(
            [section['label'] for section in assembled['sections']],
            ['How it works', 'Pairs with', 'Dimensions'],
        )
        self.assertEqual(
            assembled['sub'],
            'A battery-powered e-paper frame that collages birds heard near your ZIP code.',
        )
        self.assertEqual(
            assembled['sections'][0]['html'],
            'The framed e-ink display dynamically updates to show a collage of the birds '
            'heard most recently near your ZIP code.',
        )
        pairs = assembled['sections'][1]['html']
        self.assertNotIn('<ul', pairs)
        self.assertIn('href="/store/avian-mic/"', pairs)
        self.assertIn('href="https://www.birdweather.com/shop-birdweather-puc"', pairs)
        self.assertIn('target="_blank"', pairs)
        self.assertIn('rel="noopener noreferrer"', pairs)
        self.assertTrue(pairs.endswith('Not required.'))
        self.assertEqual(assembled['sections'][2]['html'], '11.75 × 14.75 × 0.96 in')

    def test_assembled_frame_cross_sells_the_bird_mic_as_a_kit(self):
        assembled = self.products['avian-visitors']
        bird_mic = self.products['avian-mic']

        self.assertEqual(assembled['related'], ['avian-mic'])
        self.assertEqual(bird_mic['title'], 'Bird Mic Kit')
        self.assertFalse(bird_mic.get('accessory', False))
        self.assertEqual(
            [variant['id'] for variant in bird_mic['variants']],
            ['electronics', 'electronics-printed'],
        )

    def test_assembled_and_kit_photos_have_distinct_ownership_and_order(self):
        assembled = self.products['avian-visitors']
        kit = self.products['avian-visitors-kit']

        self.assertEqual(assembled['images'], [
            'avianAssembledTop.png',
            'avianAssembledBack.png',
            'avianAssembledSide.png',
        ])
        self.assertEqual(assembled['variants'][0]['image'], 'avianAssembledTop.png')

        self.assertEqual(kit['images'], [
            'avianElectronics.png',
            'heard-today.png',
            'frameAndBacking.png',
        ])
        self.assertEqual(
            {variant['id']: variant['image'] for variant in kit['variants']},
            {
                'electronics': 'avianElectronics.png',
                'electronics-printed': 'frameAndBacking.png',
            },
        )

        homepage = (DOCS / 'index.md').read_text(encoding='utf-8')
        project = (DOCS / 'projects' / 'AvianVisitors.md').read_text(encoding='utf-8')
        self.assertIn('/assets/images/AvianVisitors/avianAssembledTop.png', homepage)
        self.assertIn('/assets/images/AvianVisitors/heard-today.png', project)

    def test_store_hook_discovers_only_existing_dark_siblings(self):
        """Exercise the DARK naming contract without depending on repository PNG timing."""
        product = {
            'id': 'fixture-frame',
            'published': False,
            'title': 'Fixture frame',
            'imageBase': '/assets/images/Fixture/',
            'images': ['top.png', 'back.png', 'side.png'],
            'variants': [],
        }
        with tempfile.TemporaryDirectory() as root:
            docs_dir = Path(root) / 'docs'
            image_dir = docs_dir / 'assets' / 'images' / 'Fixture'
            image_dir.mkdir(parents=True)
            for filename in ('top.png', 'topDARK.png', 'back.png', 'side.png', 'sideDARK.png'):
                Image.new('RGB', (8, 6), '#f3f2f2').save(image_dir / filename)

            class HookConfig(dict):
                site_dir = str(Path(root) / 'site')
                use_directory_urls = True
                plugins = SimpleNamespace(_current_plugin='test')

                @property
                def docs_dir(self):
                    return self['docs_dir']

            files = []
            with patch('hooks.store_products._products', return_value=[product]):
                on_files(files, HookConfig(docs_dir=str(docs_dir)))

        generated = next(file for file in files if file.src_uri == 'assets/js/store-data.js')
        self.assertIn(
            'window.STORE_DARK_IMAGES = '
            '["/assets/images/Fixture/top.png", "/assets/images/Fixture/side.png"]',
            generated.content_string,
        )

    def test_frame_parts_belongs_to_kit_and_each_page_mounts_its_own_product(self):
        parts = self.products['avian-visitors-parts']
        self.assertEqual(parts['parentId'], 'avian-visitors-kit')

        assembled_page = (DOCS / 'store' / 'avian-visitors.md').read_text(encoding='utf-8')
        kit_page = (DOCS / 'store' / 'avian-visitors-kit.md').read_text(encoding='utf-8')
        self.assertIn('data-product="avian-visitors"', assembled_page)
        self.assertIn('data-product="avian-visitors-kit"', kit_page)

    def test_search_index_contains_both_pages_and_the_updated_accessory_parent(self):
        search = {item['id']: item for item in _scan_store(DOCS)}
        self.assertEqual(search['avian-visitors']['url'], '/store/avian-visitors/')
        self.assertEqual(search['avian-visitors-kit']['url'], '/store/avian-visitors-kit/')
        self.assertEqual(search['avian-visitors-parts']['parentId'], 'avian-visitors-kit')

    def test_shipping_profile_allowlist_rejects_unknown_values(self):
        self.assertEqual(
            _shipping_profile({'shippingProfile': 'contiguous-us-ground'}),
            'contiguous-us-ground',
        )
        self.assertIsNone(_shipping_profile({}))
        with self.assertRaises(ValueError):
            _shipping_profile({'shippingProfile': 'ground-ish'})

    def test_trusted_catalog_carries_the_shipping_profile(self):
        product = {
            'id': 'profiled-product',
            'published': True,
            'title': 'Profiled product',
            'variants': [{
                'id': 'default',
                'label': 'Default',
                'price': 10,
                'stripePrice': 'price_profiled',
                'shippingProfile': 'contiguous-us-ground',
                'inventorySku': 'avian-gen3-batch-01',
            }],
        }
        with tempfile.TemporaryDirectory() as root:
            docs_dir = Path(root) / 'docs'
            docs_dir.mkdir()

            class HookConfig(dict):
                site_dir = str(Path(root) / 'site')
                use_directory_urls = True
                plugins = SimpleNamespace(_current_plugin='test')

                @property
                def docs_dir(self):
                    return self['docs_dir']

            config = HookConfig(docs_dir=str(docs_dir))
            files = []
            with patch('hooks.store_products._products', return_value=[product]), \
                    patch.dict(os.environ, {'STRIPE_MODE': 'test'}):
                on_files(files, config)

        generated = next(file for file in files if file.src_uri == 'store-catalog.json')
        catalog = json.loads(generated.content_string)
        self.assertEqual(
            catalog['profiled-product']['variants']['default']['shippingProfile'],
            'contiguous-us-ground',
        )
        self.assertEqual(
            catalog['profiled-product']['variants']['default']['inventorySku'],
            'avian-gen3-batch-01',
        )

    def test_inventory_sku_is_allowlisted_and_requires_the_ground_profile(self):
        self.assertEqual(
            _inventory_sku({
                'inventorySku': 'avian-gen3-batch-01',
                'shippingProfile': 'contiguous-us-ground',
            }),
            'avian-gen3-batch-01',
        )
        self.assertIsNone(_inventory_sku({}))
        with self.assertRaises(ValueError):
            _inventory_sku({
                'inventorySku': 'unknown-batch',
                'shippingProfile': 'contiguous-us-ground',
            })
        with self.assertRaises(ValueError):
            _inventory_sku({'inventorySku': 'avian-gen3-batch-01'})

    def test_production_group_is_allowlisted_and_separate_from_finite_stock(self):
        valid = {'productionBatchGroup': 'avian-visitors', 'shippingProfile': 'contiguous-us-ground'}
        self.assertEqual(_production_batch_group(valid), 'avian-visitors')
        self.assertIsNone(_production_batch_group({}))
        for invalid in ({'productionBatchGroup': 'other'}, {'productionBatchGroup': 'avian-visitors'},
                        {**valid, 'inventorySku': 'avian-gen3-batch-02'}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                _production_batch_group(invalid)

    def test_continuous_sales_preserve_both_retired_payment_catalog_snapshots(self):
        variant = self.products['avian-visitors']['variants'][0]
        class HookConfig(dict):
            use_directory_urls = True
            plugins = SimpleNamespace(_current_plugin='test')

            @property
            def docs_dir(self):
                return self['docs_dir']

        for mode in ('test', 'live'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root:
                config = HookConfig(docs_dir=str(DOCS))
                config.site_dir = str(Path(root) / 'site')
                files = []
                with patch.dict(os.environ, {'STRIPE_MODE': mode}):
                    on_files(files, config)
                generated = next(file for file in files if file.src_uri == 'store-catalog.json')
                catalog = json.loads(generated.content_string)
                entry = catalog['avian-visitors']['variants']['assembled-continuous']
                self.assertNotIn('launchAt', entry)
                self.assertNotIn('inventorySku', entry)
                self.assertEqual(entry['productionBatchGroup'], 'avian-visitors')
                self.assertEqual(entry['label'], 'Assembled')
                self.assertEqual(entry['price'], variant['stripePriceLive' if mode == 'live' else 'stripePrice'])
                self.assertEqual(catalog['avian-visitors']['retiredBuilds'], ['assembled-batch-2', 'assembled'])
                # These exact fields are hashed into existing payment bindings.
                self.assertEqual(catalog['avian-visitors']['variants']['assembled-batch-2'], {
                    'price': variant['stripePriceLive' if mode == 'live' else 'stripePrice'],
                    'weightLb': 4.0, 'maxQty': 20, 'label': 'Assembled (Batch 2)', 'priceUsd': 699,
                    'shippingProfile': 'contiguous-us-ground', 'inventorySku': 'avian-gen3-batch-02',
                })
                self.assertEqual(catalog['avian-visitors']['variants']['assembled'], {
                    'price': variant['stripePriceLive' if mode == 'live' else 'stripePrice'],
                    'weightLb': 4.0, 'maxQty': 20, 'label': 'Assembled', 'priceUsd': 699,
                    'shippingProfile': 'contiguous-us-ground',
                    'inventorySku': 'avian-gen3-batch-01', 'launchAt': '2026-10-29T16:00:00Z',
                })
                runtime = next(file for file in files if file.src_uri == 'assets/js/store-data.js')
                self.assertNotIn('retiredVariants', runtime.content_string)
                self.assertNotIn('avian-gen3-batch-01', runtime.content_string)
                self.assertNotIn('avian-gen3-batch-02', runtime.content_string)

    def test_kit_and_accessory_availability_retains_test_and_live_prices(self):
        for product in self.products.values():
            for variant in product.get('variants', []):
                if (product['id'], variant.get('id')) == ('avian-visitors', 'assembled-continuous'):
                    continue
                with self.subTest(product=product['id'], variant=variant.get('id')):
                    if product['id'] in ('polargraph', 'polargraph-parts', 'micron-pens-9'):
                        self.assertEqual(variant.get('status'), 'soldout')
                    else:
                        self.assertNotIn('status', variant)
                    self.assertTrue(variant.get('stripePrice'))
                    self.assertTrue(variant.get('stripePriceLive'))

    def test_test_and_live_catalogs_exclude_paused_kits_and_preserve_other_products(self):

        class HookConfig(dict):
            use_directory_urls = True
            plugins = SimpleNamespace(_current_plugin='test')

            @property
            def docs_dir(self):
                return self['docs_dir']

        expected = {
            'avian-visitors-kit': ['electronics', 'electronics-printed'],
            'avian-mic': ['electronics', 'electronics-printed'],
            'avian-visitors-parts': ['default'],
            'bird-mic-case': ['default'],
            'mic-mount': ['default'],
            'micron-pens-9': ['default', 'with-mounts'],
            'polargraph-parts': ['default'],
        }
        if self.products['avian-visitors']['variants'][0]['status'] == 'available':
            expected['avian-visitors'] = ['assembled', 'assembled-batch-2', 'assembled-continuous']
        for mode in ('test', 'live'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root:
                config = HookConfig(docs_dir=str(DOCS))
                config.site_dir = str(Path(root) / 'site')
                files = []
                with patch.dict(os.environ, {'STRIPE_MODE': mode}):
                    on_files(files, config)
                generated = next(file for file in files if file.src_uri == 'store-catalog.json')
                catalog = json.loads(generated.content_string)
                self.assertEqual({k: sorted(v['variants']) for k, v in catalog.items()}, expected)
                signup_file = next(file for file in files if file.src_uri == 'store-signup-catalog.json')
                signup = json.loads(signup_file.content_string)
                self.assertEqual(signup['polargraph'], ['electronics', 'electronics-printed'])
                self.assertNotIn('polargraph', catalog)
                self.assertEqual(signup['avian-visitors'], ['assembled-continuous'])
                for product_id in ('avian-visitors-kit', 'mic-mount'):
                    self.assertEqual(signup[product_id], expected[product_id])
                launches = next(file for file in files if file.src_uri == 'store-launches.json')
                self.assertEqual(json.loads(launches.content_string), {})

    def test_signup_catalog_uses_only_published_product_pages_and_visible_builds(self):
        variant = {'id': 'current', 'stripePrice': 'price_current', 'price': 10}
        retired = {'id': 'retired', 'stripePrice': 'price_retired', 'price': 10}
        products = [
            {'id': 'soldout', 'variants': [{**variant, 'status': 'soldout'}]},
            {'id': 'upcoming', 'variants': [{**variant, 'comingSoon': True}]},
            {'id': 'kit', 'variants': [variant], 'retiredVariants': [retired]},
            {'id': 'accessory', 'accessory': True, 'variants': [variant]},
            {'id': 'hidden', 'published': False, 'variants': [variant]},
            {'id': 'article', 'product': False, 'variants': [variant]},
        ]
        with tempfile.TemporaryDirectory() as root:
            docs_dir = Path(root) / 'docs'
            store_dir = docs_dir / 'store'
            store_dir.mkdir(parents=True)
            for product in products:
                frontmatter = {'product': True, 'published': True, **product}
                (store_dir / (product['id'] + '.md')).write_text(
                    '---\n' + json.dumps(frontmatter) + '\n---\n', encoding='utf-8')

            class HookConfig(dict):
                site_dir = str(Path(root) / 'site')
                use_directory_urls = True
                plugins = SimpleNamespace(_current_plugin='test')

                @property
                def docs_dir(self):
                    return self['docs_dir']

            files = []
            with patch.dict(os.environ, {'STRIPE_MODE': 'test'}):
                on_files(files, HookConfig(docs_dir=str(docs_dir)))

        generated = {file.src_uri: file.content_string for file in files}
        self.assertEqual(json.loads(generated['store-signup-catalog.json']), {
            'soldout': ['current'], 'upcoming': ['current'],
            'kit': ['current'], 'accessory': ['current'],
        })
        checkout = json.loads(generated['store-catalog.json'])
        self.assertEqual(set(checkout), {'kit', 'accessory'})
        self.assertEqual(set(checkout['kit']['variants']), {'current', 'retired'})
        self.assertEqual(checkout['kit']['retiredBuilds'], ['retired'])


if __name__ == '__main__':
    unittest.main()
