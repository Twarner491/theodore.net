import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_hook(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "hooks" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


STORE_PRODUCTS = load_hook("store_products")
SEARCH_DATA = load_hook("search_data")


class StoreSalesOpenTest(unittest.TestCase):
    def test_public_catalog_reopens_only_the_existing_fulfillable_variants(self):
        expected = {
            "avian-visitors": ["electronics", "electronics-printed"],
            "mic-mount": ["default"],
            "avian-mic": ["electronics", "electronics-printed"],
            "avian-visitors-parts": ["default"],
            "bird-mic-case": ["default"],
            "polargraph-parts": ["default"],
            "polargraph": ["electronics", "electronics-printed"],
            "micron-pens-9": ["default", "with-mounts"],
        }
        products = {product["id"]: product for product in STORE_PRODUCTS._products(ROOT / "docs")}
        sellable = {
            product_id: [variant["id"] for variant in product["variants"] if STORE_PRODUCTS._sellable(variant)]
            for product_id, product in products.items()
        }

        self.assertEqual(sellable, expected)
        for product_id, variant_ids in expected.items():
            variants = {variant["id"]: variant for variant in products[product_id]["variants"]}
            for variant_id in variant_ids:
                self.assertIsInstance(variants[variant_id].get("price"), (int, float))
                self.assertTrue(variants[variant_id].get("stripePrice"))
                self.assertTrue(variants[variant_id].get("stripePriceLive"))

        assembled = next(variant for variant in products["avian-visitors"]["variants"] if variant["id"] == "assembled")
        self.assertTrue(assembled.get("comingSoon"))
        self.assertFalse(STORE_PRODUCTS._sellable(assembled))

    def test_search_returns_current_public_prices_without_sold_out_status(self):
        products = {
            product["title"]: {"price": product["price"], "status": product["status"]}
            for product in SEARCH_DATA._scan_store(ROOT / "docs")
        }

        self.assertEqual(products, {
            "Avian Visitors": {"price": 450, "status": ""},
            "Bird Mic": {"price": 180, "status": ""},
            "Polargraph Plotter": {"price": 430, "status": ""},
        })


if __name__ == "__main__":
    unittest.main()
