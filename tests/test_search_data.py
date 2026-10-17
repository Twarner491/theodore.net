import tempfile
import unittest
from pathlib import Path

from hooks.search_data import _scan_store


class StoreSearchIndexTests(unittest.TestCase):
    def test_indexes_accessory_copy_and_relationship_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Path(tmp) / 'store'
            store.mkdir()
            (store / 'polargraph.md').write_text(
                """---
title: Polargraph Plotter
product: true
id: polargraph
teaser: A drawing machine.
sub: A wall-mounted pen plotter.
images: []
variants:
  - id: kit
    label: Electronics Kit
    price: 430
---
""",
                encoding='utf-8',
            )
            (store / 'micron-pens-9.md').write_text(
                """---
title: Sakura Micron 05 (9-pack)
product: true
accessory: true
parentId: polargraph
id: micron-pens-9
teaser: Nine archival-ink fineliners.
sub: A pack of nine pens for plotting in color.
images: []
variants:
  - id: with-mounts
    label: 9 Pens + 9 Mounts & Caps
    price: 48
    desc: Keep every color loaded and swap quickly.
    contents:
      - 9 Sakura Pigma Micron pens
      - 9 3D-printed pen mounts
---
""",
                encoding='utf-8',
            )

            by_id = {item['id']: item for item in _scan_store(tmp)}
            accessory = by_id['micron-pens-9']

            self.assertEqual(set(by_id), {'polargraph', 'micron-pens-9'})
            self.assertTrue(accessory['accessory'])
            self.assertEqual(accessory['parentId'], 'polargraph')
            self.assertEqual(accessory['url'], '/store/micron-pens-9/')
            self.assertEqual(accessory['price'], 48)
            self.assertIn('pens', accessory['keywords'].lower())
            self.assertIn('mounts', accessory['keywords'].lower())
            # The relationship is metadata, not inherited search vocabulary:
            # searching only for a parent must not summon its entire add-on set.
            self.assertNotIn('polargraph', accessory['keywords'].lower())


if __name__ == '__main__':
    unittest.main()
