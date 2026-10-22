import json
import re
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path
from types import SimpleNamespace

import yaml
from jinja2 import ChoiceLoader, DictLoader, Environment, FileSystemLoader
from mkdocs.utils.templates import url_filter


ROOT = Path(__file__).resolve().parents[1]
DISCUSSIONS = {
    'projects/ParametricGenerator.md': 6,
    'projects/Octoprint.md': 7,
    'projects/KlipperEnder3.md': 8,
    'writings/a-mutual-meaning.md': 11,
    'projects/ProjectPortfolioSite.md': 12,
    'projects/VonNiemannProbe.md': 13,
    'projects/MillingWorflow.md': 14,
    'writings/downforce.md': 16,
    'writings/torpediniformes.md': 17,
    'writings/decisiveness.md': 18,
    'writings/efd.md': 19,
    'writings/juggling.md': 20,
    'writings/on-turning-twenty.md': 21,
    'writings/benevolentfreedom.md': 22,
    'writings/centuryinjapan.md': 23,
    'writings/immortalitytrap.md': 25,
    'projects/Quotes.md': 26,
    'projects/Polargraph.md': 27,
    'writings/downsideprotection.md': 28,
    'projects/AvianVisitors.md': 29,
    'projects/LithophaneExperiments.md': 30,
}


class Links(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.hrefs = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.hrefs.append(dict(attrs).get('href'))


class CommentMappingTests(unittest.TestCase):
    def render(self, metadata, path='projects/AvianVisitors.md'):
        env = Environment(loader=ChoiceLoader([
            DictLoader({'base.html': '{% block content %}{% endblock %}'}),
            FileSystemLoader(ROOT / 'overrides'),
        ]))
        env.filters['url'] = url_filter
        html = env.get_template('comments.html').render(
            page=SimpleNamespace(meta=metadata, title=metadata['title'],
                                 url=path.removesuffix('.md') + '/', content=''),
            config={'site_url': 'https://theodore.net/', 'extra': {}},
            lang=SimpleNamespace(t=lambda key: 'Comments'),
        )
        config = re.search(r'var config = (\{.*?\n        \})', html, re.S)
        self.assertIsNotNone(config, 'rendered page must configure Giscus')
        # Evaluate the rendered config, including JSON quoting and optional fields.
        result = subprocess.run(
            ['node', '-e', 'const fs = require("node:fs"); '
             'const vm = require("node:vm"); '
             'console.log(JSON.stringify(vm.runInNewContext('
             '"(" + fs.readFileSync(0, "utf8") + ")", '
             '{currentTheme: () => "light"})));'],
            input=config.group(1), text=True, capture_output=True, check=True,
        )
        return html, json.loads(result.stdout)

    def article_metadata(self, path='projects/AvianVisitors.md'):
        source = (ROOT / 'docs' / path).read_text()
        return yaml.safe_load(source.split('---', 2)[1])

    def test_existing_articles_select_original_discussions_without_title_search(self):
        for path, number in DISCUSSIONS.items():
            with self.subTest(path=path):
                metadata = self.article_metadata(path)
                self.assertIs(type(metadata.get('giscus_discussion')), int)
                _, config = self.render(metadata, path)
                self.assertEqual(config['data-mapping'], 'number')
                self.assertEqual(config['data-term'], str(number))

    def test_renaming_article_keeps_the_original_discussion(self):
        metadata = self.article_metadata()
        metadata['title'] = 'A different article title'
        _, config = self.render(metadata)
        self.assertEqual(config['data-mapping'], 'number')
        self.assertEqual(str(config['data-term']), '29')

    def test_newer_comments_remain_accessible_from_the_article(self):
        for path, number in [('projects/AvianVisitors.md', 32),
                             ('writings/immortalitytrap.md', 33)]:
            with self.subTest(path=path):
                html, _ = self.render(self.article_metadata(path), path)
                self.assertIn(f'https://github.com/Twarner491/theodore.net/discussions/{number}',
                              Links(html).hrefs)

    def test_other_articles_keep_their_existing_title_mapping(self):
        html, config = self.render({'title': 'Another project'})
        self.assertEqual(config['data-mapping'], 'og:title')
        self.assertNotIn('data-term', config)
        self.assertNotIn('https://github.com/Twarner491/theodore.net/discussions/32',
                         Links(html).hrefs)


if __name__ == '__main__':
    unittest.main()
