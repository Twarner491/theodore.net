"""Generate /assets/js/store-data.js from the product definitions in
docs/store/*.md frontmatter.

Each product is authored in the frontmatter of its docs/store/<slug>.md page
(see any existing one for the shape). This hook collects every file marked
`product: true` at build time into one data file that store.js reads at runtime
(window.STORE_PRODUCTS). The search hook (search_data.py) reads the same
frontmatter directly, so there is a single source of truth and search keeps
working without parsing JS. To add a product: copy a store/<slug>.md, edit its
frontmatter. Read-only: this never writes into the source tree.
"""

import json
import re
import yaml
from pathlib import Path
from mkdocs.structure.files import File

# keys copied verbatim from frontmatter into the runtime product object
KEYS = ['id', 'published', 'title', 'teaser', 'sub', 'imageBase', 'images',
        'defaultBuild', 'variants', 'softwareNote', 'sections', 'colophon']


def _frontmatter(text):
    if not text.startswith('---'):
        return {}
    m = re.search(r'\n---\s*\n', text[3:])
    if not m:
        return {}
    try:
        return yaml.safe_load(text[3:m.start() + 3]) or {}
    except yaml.YAMLError:
        return {}


def _products(docs_dir):
    out = []
    store = Path(docs_dir) / 'store'
    if not store.exists():
        return out
    for md in sorted(store.glob('*.md')):
        try:
            fm = _frontmatter(md.read_text(encoding='utf-8'))
        except Exception:
            continue
        if not isinstance(fm, dict) or not fm.get('product'):
            continue
        prod = {k: fm[k] for k in KEYS if k in fm}
        prod.setdefault('id', md.stem)
        out.append((fm.get('order', 999), prod))
    out.sort(key=lambda t: (t[0], t[1].get('id', '')))   # frontmatter `order` controls store/search ordering
    return [p for _, p in out]


def on_files(files, config):
    products = _products(config['docs_dir'])
    content = ("/* generated from docs/store/*.md frontmatter by "
               "hooks/store_products.py. do not edit by hand. */\n"
               "window.STORE_PRODUCTS = "
               + json.dumps(products, ensure_ascii=False) + ";\n")
    files.append(File.generated(config, 'assets/js/store-data.js', content=content))
    return files
