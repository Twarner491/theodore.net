import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cache_bust", ROOT / "hooks" / "cache_bust.py")
CACHE_BUST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CACHE_BUST)


class StorefrontAssetCacheBustTest(unittest.TestCase):
    def test_measurement_script_urls_change_when_their_source_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = root / "docs/assets/js"
            scripts.mkdir(parents=True)
            assets = ["assets/js/attribution.js", "assets/js/meta-tracking.js"]
            for asset in assets:
                (root / "docs" / asset).write_text("window.measurementVersion = 1;\n")

            config = {
                "config_file_path": str(root / "mkdocs.yml"),
                "extra_javascript": assets,
                "extra_css": [],
            }
            previous = CACHE_BUST.on_config(config)["extra_javascript"]
            for index, asset in enumerate(assets):
                with self.subTest(asset=asset):
                    self.assertRegex(previous[index], r"\?h=[0-9a-f]{8}$")
                    (root / "docs" / asset).write_text("window.measurementVersion = 2;\n")
                    updated = CACHE_BUST.on_config(config)["extra_javascript"]
                    self.assertNotEqual(updated[index], previous[index])
                    self.assertEqual(updated[1 - index], previous[1 - index])
                    self.assertEqual(CACHE_BUST.on_config(config)["extra_javascript"], updated)
                    previous = updated

    def test_storefront_status_assets_receive_content_versions(self):
        config = {
            "config_file_path": str(ROOT / "mkdocs.yml"),
            "extra_javascript": [
                "assets/js/store-data.js",
                "assets/js/grids.js",
                "assets/js/search.js",
                "assets/js/index.js",
            ],
            "extra_css": ["assets/css/search.css", "assets/css/header-search.css", "assets/css/extra.css"],
        }

        result = CACHE_BUST.on_config(config)

        self.assertRegex(str(result["extra_javascript"][0]), r"^assets/js/store-data\.js\?h=[0-9a-f]{8}$")
        self.assertEqual(str(result["extra_javascript"][1]), "assets/js/grids.js")
        self.assertRegex(str(result["extra_javascript"][2]), r"^assets/js/search\.js\?h=[0-9a-f]{8}$")
        self.assertRegex(str(result["extra_javascript"][3]), r"^assets/js/index\.js\?h=[0-9a-f]{8}$")
        self.assertRegex(result["extra_css"][0], r"^assets/css/search\.css\?h=[0-9a-f]{8}$")
        self.assertRegex(result["extra_css"][1], r"^assets/css/header-search\.css\?h=[0-9a-f]{8}$")
        self.assertEqual(result["extra_css"][2], "assets/css/extra.css")

    def test_project_card_assets_in_templates_receive_content_versions(self):
        html = '<link href="/assets/css/projects/project.css"><script src="/assets/js/index.js"></script>'
        result = CACHE_BUST.on_post_page(html, None, {"config_file_path": str(ROOT / "mkdocs.yml")})
        self.assertRegex(result, r'/assets/css/projects/project\.css\?h=[0-9a-f]{8}')
        self.assertRegex(result, r'/assets/js/index\.js\?h=[0-9a-f]{8}')

    def test_header_assets_in_templates_receive_content_versions(self):
        html = '<link href="/assets/css/header.css"><script src="/assets/js/header.js"></script>'
        result = CACHE_BUST.on_post_page(html, None, {"config_file_path": str(ROOT / "mkdocs.yml")})
        self.assertRegex(result, r'/assets/css/header\.css\?h=[0-9a-f]{8}')
        self.assertRegex(result, r'/assets/js/header\.js\?h=[0-9a-f]{8}')


if __name__ == "__main__":
    unittest.main()
