import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cache_bust", ROOT / "hooks" / "cache_bust.py")
CACHE_BUST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CACHE_BUST)


class StorefrontAssetCacheBustTest(unittest.TestCase):
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
