import unittest
import re
from types import SimpleNamespace

from hooks.header_assets import on_page_markdown, on_post_page


class HeaderAssetTests(unittest.TestCase):
    def test_store_does_not_load_font_awesome_runtime(self):
        html = '<script src="https://kit.fontawesome.com/79ff35ecec.js" crossorigin="anonymous" defer></script>\n<script src="/assets/js/store.js" defer></script>'
        page = SimpleNamespace(file=SimpleNamespace(src_uri='store/checkout.md'))
        result = on_page_markdown(html, page, None, None)
        self.assertNotIn('kit.fontawesome.com', result)
        self.assertIn('<script src="/assets/js/store.js" defer>', result)
        self.assertEqual(on_page_markdown(result, page, None, None), result)

    def test_unrelated_pages_and_scripts_remain_unchanged(self):
        html = '<script src="https://kit.fontawesome.com/79ff35ecec.js" defer></script>'
        page = SimpleNamespace(file=SimpleNamespace(src_uri='projects/test.md'))
        self.assertEqual(on_page_markdown(html, page, None, None), html)

    def test_storefront_styles_are_discovered_before_the_header_without_duplicates(self):
        head = '<html><head><link rel="stylesheet" href="/assets/css/search.css"></head>'
        links = ''.join(f'<link rel="stylesheet" href="/assets/css/{name}.css?h=123">' for name in ['index', 'store', 'header'])
        html = head + '<body><header>bag</header><main>' + links + '</main></body></html>'
        page = SimpleNamespace(file=SimpleNamespace(src_uri='store/index.md'))
        result = on_post_page(html, page, None)
        self.assertLess(result.index('/assets/css/search.css'), result.index('/assets/css/index.css'))
        for name in ['index', 'store', 'header']:
            self.assertEqual(result.count(f'/assets/css/{name}.css'), 1)
            self.assertLess(result.index(f'/assets/css/{name}.css'), result.index('</head>'))
        self.assertEqual(on_post_page(result, page, None), result)

    def test_store_boots_with_dependencies_before_optional_deferred_scripts(self):
        html = '''<html><head></head><body>
<script src="/assets/js/store.js?h=123" defer></script>
<script src="/assets/js/header.js"></script>
<script src="https://kit.fontawesome.com/example.js" async></script>
<script src="../../assets/javascripts/bundle.example.js"></script>
<script src="../../assets/js/error-suppressor.js"></script>
<script src="../../assets/js/attribution.js"></script>
<script src="../../assets/js/store-data.js?h=456"></script>
<script src="../../assets/js/index.js"></script>
<script src="../../assets/js/search.js"></script>
<script>window.inlineStillRuns = true;</script>
</body></html>'''
        page = SimpleNamespace(file=SimpleNamespace(src_uri='store/avian-visitors.md'))
        result = on_post_page(html, page, None)
        sources = re.findall(r'<script[^>]+src="([^"]+)"[^>]*>', result)
        self.assertEqual([url.split('?')[0].rsplit('/', 1)[-1] for url in sources[:6]], [
            'error-suppressor.js', 'attribution.js', 'store-data.js', 'store.js', 'header.js', 'search.js'])
        self.assertLess(result.index('/assets/js/search.js'), result.index('</head>'))
        self.assertIn('<script src="../../assets/javascripts/bundle.example.js" defer>', result)
        self.assertIn('<script src="../../assets/js/index.js" defer>', result)
        self.assertNotIn('kit.fontawesome.com', result)
        self.assertIn('<script>window.inlineStillRuns = true;</script>', result)
        self.assertEqual(result.count('/assets/js/store.js?'), 1)
        self.assertEqual(on_post_page(result, page, None), result)

    def test_secondary_fonts_do_not_block_storefront_rendering(self):
        tag = '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Fira+Sans&amp;display=fallback">'
        html = '<html><head>' + tag + '</head><body></body></html>'
        page = SimpleNamespace(file=SimpleNamespace(src_uri='store/index.md'))
        result = on_post_page(html, page, None)
        self.assertIn('rel="preload" as="style"', result)
        self.assertIn('onload="this.onload=null;this.rel=\'stylesheet\'"', result)
        self.assertIn('<noscript>' + tag + '</noscript>', result)
        self.assertEqual(on_post_page(result, page, None), result)
        page.file.src_uri = 'projects/test.md'
        self.assertEqual(on_post_page(html, page, None), html)

    def test_store_icons_are_inline_and_legacy_footer_email_becomes_instagram(self):
        html = '''<html><head><link rel="preconnect" href="https://kit.fontawesome.com" crossorigin>
<link rel="preconnect" href="https://ka-f.fontawesome.com" crossorigin></head><body>
<a href="https://github.com/example" aria-label="GitHub"><i class="fa-brands fa-github"></i></a>
<a href="https://x.com/example" aria-label="X"><i class="fa-brands fa-x-twitter"></i></a>
<a target="_blank" href="mailto:teddy@warner.net" aria-label="Send Email"><i class="fa-solid fa-paper-plane"></i></a>
<a href="mailto:teddy@warner.net">Contact me</a>
<i class="fa-solid fa-chevron-down store-filter-caret" aria-hidden="true"></i>
</body></html>'''
        page = SimpleNamespace(file=SimpleNamespace(src_uri='store/index.md'))
        result = on_post_page(html, page, None)
        self.assertNotIn('<i ', result)
        self.assertNotIn('rel="preconnect"', result)
        self.assertEqual(result.count('class="store-icon'), 4)
        self.assertIn('href="https://www.instagram.com/teddymakesstuff/" aria-label="Instagram" rel="noopener"', result)
        self.assertIn('<a href="mailto:teddy@warner.net">Contact me</a>', result)
        self.assertIn('class="store-icon store-filter-caret"', result)
        self.assertEqual(result.count('focusable="false"'), 4)
        self.assertEqual(on_post_page(result, page, None), result)
        page.file.src_uri = 'projects/test.md'
        self.assertEqual(on_post_page(html, page, None), html)


if __name__ == '__main__':
    unittest.main()
