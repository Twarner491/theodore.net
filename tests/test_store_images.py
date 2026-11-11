import hashlib
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image

from hooks.store_images import build_image_sources, image_inputs, source_inputs


class StoreImageTests(unittest.TestCase):
    def test_derivatives_preserve_originals_and_cover_both_themes_without_upscaling(self):
        with tempfile.TemporaryDirectory() as tmp:
            docs = Path(tmp)
            image_dir = docs / 'assets/images/example'
            image_dir.mkdir(parents=True)
            paths = [image_dir / 'photo.png', image_dir / 'photoDARK.png', image_dir / 'parts.png']
            for index, path in enumerate(paths):
                Image.new('RGB', (1200, 800), (40 + index, 80, 120)).save(path)
            before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
            products = [{'imageBase': '/assets/images/example/', 'images': ['photo.png'], 'variants': [{'image': 'parts.png'}]}]
            metadata, files = build_image_sources(products, docs)
            self.assertEqual(set(metadata), {'/assets/images/example/photo.png', '/assets/images/example/photoDARK.png', '/assets/images/example/parts.png'})
            for original, entry in metadata.items():
                self.assertEqual((entry['width'], entry['height']), (1200, 800))
                self.assertEqual([item['width'] for item in entry['sources']], [480, 960, 1200])
                for item in entry['sources']:
                    self.assertRegex(item['url'], r'^/assets/images/store/[a-f0-9]{16}-\d+\.webp$')
                    decoded = Image.open(BytesIO(files[item['url'].lstrip('/')]))
                    self.assertEqual(decoded.size, (item['width'], item['height']))
                    self.assertEqual(decoded.format, 'WEBP')
            self.assertEqual(before, {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})
            self.assertFalse((docs / 'assets/images/store').exists(), 'derivatives are virtual build outputs, never source files')
            self.assertEqual(build_image_sources(products, docs), (metadata, files))

    def test_source_changes_change_derivative_urls_and_cache_inputs_include_variant_only_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            docs = Path(tmp)
            (docs / 'store').mkdir()
            (docs / 'assets/images').mkdir(parents=True)
            path = docs / 'assets/images/photo.png'
            Image.new('RGBA', (80, 40), (10, 40, 80, 120)).save(path)
            products = [{'imageBase': '/assets/images/', 'variants': [{'image': 'photo.png'}]}]
            first, files = build_image_sources(products, docs)
            entry = first['/assets/images/photo.png']
            self.assertEqual([s['width'] for s in entry['sources']], [80])
            self.assertEqual(Image.open(BytesIO(next(iter(files.values())))).mode, 'RGBA')
            Image.new('RGBA', (80, 40), (200, 40, 80, 120)).save(path)
            second, _ = build_image_sources(products, docs)
            self.assertNotEqual(entry['sources'][0]['url'], second['/assets/images/photo.png']['sources'][0]['url'])
            (docs / 'store/product.md').write_text('---\nproduct: true\nimageBase: /assets/images/\nvariants:\n  - image: photo.png\n---\n')
            self.assertEqual(list(source_inputs(docs)), [path.resolve()])

    def test_remote_missing_and_outside_paths_do_not_become_build_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            products = [{'imageBase': 'https://example.com/', 'images': ['photo.png']}, {'imageBase': '/assets/images/', 'images': ['missing.png', '../../../outside.png']}]
            self.assertEqual(image_inputs(products, tmp), {})


if __name__ == '__main__':
    unittest.main()
