import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from hooks.search_data import _scan_store
from hooks.store_products import _inventory_sku, _products, _shipping_profile, on_files


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
        self.assertEqual(assembled['defaultBuild'], 'assembled')
        self.assertEqual([variant['id'] for variant in assembled['variants']], ['assembled'])
        assembled_variant = assembled['variants'][0]
        self.assertNotIn('comingSoon', assembled_variant)
        self.assertEqual(assembled_variant['price'], 699)
        self.assertEqual(assembled_variant['stripePrice'], 'price_1UAyqjRPSNpqisAPDHJxogp3')
        self.assertTrue(assembled_variant['localPreview'])
        self.assertEqual(assembled_variant['shippingProfile'], 'contiguous-us-ground')
        self.assertEqual(assembled_variant['inventorySku'], 'avian-gen3-batch-01')
        self.assertEqual(assembled_variant['batchSize'], 20)
        self.assertEqual(assembled_variant['maxQuantity'], 20)
        # Batch 1 is a timed drop with a private batch size. It is either still held
        # (soldout, no live price) or activated by tools/activate-batch-1.sh (available
        # with a live price, still refused by checkout until launchAt).
        if assembled_variant['status'] == 'soldout':
            self.assertNotIn('stripePriceLive', assembled_variant)
        else:
            self.assertEqual(assembled_variant['status'], 'available')
            self.assertRegex(assembled_variant['stripePriceLive'], r'^price_[A-Za-z0-9]+$')
        self.assertEqual(assembled_variant['launchAt'], '2026-10-29T16:00:00Z')
        self.assertEqual(assembled_variant['launchLabel'], 'Batch 1')
        self.assertTrue(assembled_variant['batchSizePrivate'])
        self.assertEqual(assembled['storeListings'], [{
            'category': 'products',
            'build': 'assembled',
            'variants': ['assembled'],
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
        self.assertEqual(variant['softwareNote'], 'This is a one-man shop. I assemble each frame by hand. Batch 1 will ship by the end of 2026.')
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
                (image_dir / filename).touch()

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

    def test_assembled_frame_enters_checkout_only_when_activated_and_always_with_its_launch_gate(self):
        variant = self.products['avian-visitors']['variants'][0]
        activated = variant['status'] == 'available'
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
                if not activated:
                    self.assertNotIn('avian-visitors', catalog)
                    continue
                entry = catalog['avian-visitors']['variants']['assembled']
                self.assertEqual(entry['launchAt'], '2026-10-29T16:00:00Z')
                self.assertEqual(entry['inventorySku'], 'avian-gen3-batch-01')
                self.assertEqual(entry['price'], variant['stripePriceLive' if mode == 'live' else 'stripePrice'])

    def test_every_kit_and_accessory_is_sellable_with_test_and_live_prices(self):
        for product in self.products.values():
            for variant in product.get('variants', []):
                if (product['id'], variant.get('id')) == ('avian-visitors', 'assembled'):
                    continue
                with self.subTest(product=product['id'], variant=variant.get('id')):
                    self.assertNotIn('status', variant)
                    self.assertTrue(variant.get('stripePrice'))
                    self.assertTrue(variant.get('stripePriceLive'))

    def test_test_and_live_catalogs_sell_everything_except_the_assembled_frame(self):

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
            'polargraph': ['electronics', 'electronics-printed'],
            'polargraph-parts': ['default'],
        }
        if self.products['avian-visitors']['variants'][0]['status'] == 'available':
            expected['avian-visitors'] = ['assembled']   # activated: sellable, behind its launchAt
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
                launches = next(file for file in files if file.src_uri == 'store-launches.json')
                self.assertEqual(json.loads(launches.content_string), {
                    'avian-visitors': {'launchAt': '2026-10-29T16:00:00Z', 'label': 'Batch 1'},
                })


if __name__ == '__main__':
    unittest.main()
