"""Timed drops in the store build hook: launchAt validation, the trusted catalog field the
checkout gate reads, the email countdown's store-launches.json, and the Meta feed exclusion."""
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from hooks.store_products import _launch_at, _launch_open, _meta_catalog_csv, on_files


class HookConfig(dict):
    use_directory_urls = True
    plugins = SimpleNamespace(_current_plugin='test')

    @property
    def docs_dir(self):
        return self['docs_dir']


def build(products):
    with tempfile.TemporaryDirectory() as root:
        docs_dir = Path(root) / 'docs'
        docs_dir.mkdir()
        config = HookConfig(docs_dir=str(docs_dir))
        config.site_dir = str(Path(root) / 'site')
        files = []
        with patch('hooks.store_products._products', return_value=products), \
                patch.dict(os.environ, {'STRIPE_MODE': 'test'}):
            on_files(files, config)
        return {f.src_uri: f.content_string for f in files}


def drop(launch_at, **extra):
    return {'id': 'frame', 'published': True, 'title': 'Frame', 'defaultBuild': 'one', 'variants': [
        dict({'id': 'one', 'label': 'One', 'price': 10, 'stripePrice': 'price_one', 'launchAt': launch_at}, **extra)]}


class StoreLaunchTests(unittest.TestCase):
    def test_launch_at_must_be_a_quoted_real_utc_time(self):
        self.assertEqual(_launch_at({'launchAt': '2026-10-29T16:00:00Z'}), '2026-10-29T16:00:00Z')
        self.assertIsNone(_launch_at({}))
        for bad in ('2026-10-29', '2026-10-29T16:00:00-07:00', '2026-02-30T16:00:00Z',
                    datetime(2026, 10, 29, 16, tzinfo=timezone.utc), None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                _launch_at({'launchAt': bad})

    def test_a_bad_launch_at_fails_the_build_before_store_data_is_written(self):
        with self.assertRaises(ValueError):
            build([drop('Oct 29')])

    def test_catalog_and_launch_index_carry_the_drop_instant(self):
        out = build([drop('2026-10-29T16:00:00Z', launchLabel='Batch 1')])
        variant = json.loads(out['store-catalog.json'])['frame']['variants']['one']
        self.assertEqual(variant['launchAt'], '2026-10-29T16:00:00Z')
        self.assertEqual(json.loads(out['store-launches.json']),
                         {'frame': {'launchAt': '2026-10-29T16:00:00Z', 'label': 'Batch 1'}})

    def test_meta_feed_holds_a_drop_until_it_opens(self):
        self.assertFalse(_launch_open({'launchAt': '2999-01-01T00:00:00Z'}))
        self.assertTrue(_launch_open({'launchAt': '2000-01-01T00:00:00Z'}))
        self.assertNotIn('frame-one', _meta_catalog_csv([drop('2999-01-01T00:00:00Z')]))
        self.assertIn('frame-one', _meta_catalog_csv([drop('2000-01-01T00:00:00Z')]))


if __name__ == '__main__':
    unittest.main()
