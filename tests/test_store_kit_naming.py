import re
import unittest
from pathlib import Path

from hooks.search_data import _scan_store
from hooks.store_products import _products


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


class StoreKitNamingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.products = {product["id"]: product for product in _products(DOCS)}
        cls.search = {item["id"]: item for item in _scan_store(DOCS)}

    def test_canonical_kit_titles_keep_existing_ids_and_urls(self):
        expected = {
            "avian-mic": ("Bird Mic Kit", "/store/avian-mic/"),
            "polargraph": ("Polargraph Kit", "/store/polargraph/"),
        }

        for product_id, (title, url) in expected.items():
            with self.subTest(product_id=product_id):
                self.assertEqual(self.products[product_id]["title"], title)
                self.assertEqual(self.search[product_id]["title"], title)
                self.assertEqual(self.search[product_id]["url"], url)
                self.assertFalse(self.products[product_id].get("accessory", False))

    def test_manual_store_cards_use_the_canonical_kit_titles(self):
        homepage = (DOCS / "index.md").read_text(encoding="utf-8")
        avian_project = (DOCS / "projects" / "AvianVisitors.md").read_text(encoding="utf-8")
        polargraph_project = (DOCS / "projects" / "Polargraph.md").read_text(encoding="utf-8")

        self.assertIn('<p class="store-mini-title">Bird Mic Kit</p>', homepage)
        self.assertIn('<p class="store-mini-title">Polargraph Kit</p>', homepage)
        self.assertIn('<span class="kit-card__title">Bird Mic Kit</span>', avian_project)
        self.assertIn('<span class="kit-card__title">Polargraph Kit</span>', polargraph_project)

    def test_homepage_store_trio_uses_each_product_hero_and_current_price_or_status(self):
        homepage = (DOCS / "index.md").read_text(encoding="utf-8")
        cards = re.findall(r'<a class="store-mini-card".*?</a>', homepage, flags=re.DOTALL)

        self.assertEqual(len(cards), 3)
        expected = [
            ('/store/avian-visitors/', '/assets/images/AvianVisitors/avianAssembledTop.png', 'Avian Visitors', '$699'),
            ('/store/avian-mic/', '/assets/images/AvianVisitors/bird-mic.png', 'Bird Mic Kit', '<span class="from">from</span>$180'),
            ('/store/polargraph/', '/assets/images/Polargraph/kit.png', 'Polargraph Kit', 'Sold out'),
        ]
        for card, (href, image, title, price) in zip(cards, expected):
            with self.subTest(title=title):
                self.assertIn(f'href="{href}"', card)
                self.assertIn(f'src="{image}"', card)
                self.assertIn(f'alt="{title}"', card)
                self.assertIn(f'<p class="store-mini-title">{title}</p>', card)
                self.assertIn(f'<p class="store-mini-price">{price}</p>', card)

    def test_avian_pairing_copy_names_the_sellable_kit(self):
        assembled = (DOCS / "store" / "avian-visitors.md").read_text(encoding="utf-8")
        diy_kit = (DOCS / "store" / "avian-visitors-kit.md").read_text(encoding="utf-8")

        link = '<a href="/store/avian-mic/">Bird Mic Kit</a>'
        self.assertIn(link, assembled)
        self.assertIn(link, diy_kit)


if __name__ == "__main__":
    unittest.main()
