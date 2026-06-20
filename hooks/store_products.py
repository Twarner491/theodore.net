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
import os
import re
import yaml
from pathlib import Path
from mkdocs.structure.files import File

try:
    from PIL import Image
    _PIL_OK = True
except Exception:
    _PIL_OK = False

# keys copied verbatim from frontmatter into the runtime product object
KEYS = ['id', 'published', 'title', 'teaser', 'sub', 'imageBase', 'images',
        'defaultBuild', 'variants', 'softwareNote', 'sections', 'colophon', 'weight',
        'accessory', 'parentId', 'icon', 'related', 'project']

DEFAULT_WEIGHT_LB = 2.0


def _bg_color(path):
    """Average a product image's four corners into an #rrggbb so store.js can letterbox a
    contained image with a background matching that image's own. None if Pillow is missing or
    the file is unreadable (store.js then just uses no background)."""
    if not _PIL_OK:
        return None
    try:
        im = Image.open(path).convert('RGB')
        w, h = im.size
        if w < 2 or h < 2:
            return None
        pts = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]
        rs = gs = bs = 0
        for x, y in pts:
            r, g, b = im.getpixel((x, y))
            rs += r; gs += g; bs += b
        n = len(pts)
        return '#%02x%02x%02x' % (round(rs / n), round(gs / n), round(bs / n))
    except Exception:
        return None   # shipping weight used when a product/variant sets none


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


def _sellable(v):
    """A variant can be sold unless its status (or legacy comingSoon) is soldout/comingSoon.
    Non-sellable variants are dropped from the catalog so the checkout Function refuses them."""
    if not isinstance(v, dict):
        return False
    s = v.get('status') or ('comingSoon' if v.get('comingSoon') else 'available')
    return s in ('available', 'backorder', 'preorder')


def on_files(files, config):
    products = _products(config['docs_dir'])
    # product image URLs that have a "<name>DARK.<ext>" sibling on disk; store.js
    # swaps to it in dark mode and leaves the rest as-is (no broken requests)
    docs = Path(config['docs_dir'])
    dark = []
    image_bg = {}   # per-image letterbox color (light URL + DARK sibling), sampled from the file
    for p in products:
        base = p.get('imageBase', '') or ''
        for f in (p.get('images') or []):
            url = base + f
            c = _bg_color(docs / url.lstrip('/'))
            if c:
                image_bg[url] = c
            stem, dot, ext = str(f).rpartition('.')
            dark_rel = base.lstrip('/') + stem + 'DARK.' + ext
            if dot and (docs / dark_rel).exists():
                dark.append(url)
                dc = _bg_color(docs / dark_rel)
                if dc:
                    image_bg[base + stem + 'DARK.' + ext] = dc
    content = ("/* generated from docs/store/*.md frontmatter by "
               "hooks/store_products.py. do not edit by hand. */\n"
               "window.STORE_PRODUCTS = "
               + json.dumps(products, ensure_ascii=False) + ";\n"
               "window.STORE_DARK_IMAGES = "
               + json.dumps(dark, ensure_ascii=False) + ";\n"
               "window.STORE_IMAGE_BG = "
               + json.dumps(image_bg, ensure_ascii=False) + ";\n")
    files.append(File.generated(config, 'assets/js/store-data.js', content=content))
    # trusted catalog read server-side by the checkout Function: per variant, the
    # Stripe Price id (amount) and the shipping weight (lb). Variant `weight`
    # overrides the product `weight`, which falls back to DEFAULT_WEIGHT_LB.
    #
    # Test vs live: local/preview builds use each variant's `stripePrice` (a test Price id);
    # the production build sets STRIPE_MODE=live and uses `stripePriceLive` instead, so the
    # same source tree serves test ids locally and live ids in prod with no manual swapping.
    # In live mode a sellable variant missing its live id is dropped from the catalog (the
    # backend then refuses it) rather than ever shipping a test id to a real customer.
    mode = os.environ.get('STRIPE_MODE', 'test').strip().lower()
    price_field = 'stripePriceLive' if mode == 'live' else 'stripePrice'
    catalog = {}
    missing = []
    for p in products:
        if not p.get('published'):
            continue   # hidden products are never sellable, even by a direct URL
        def _w(v):
            w = v.get('weight', p.get('weight'))
            try:
                return float(w) if w is not None else DEFAULT_WEIGHT_LB
            except (TypeError, ValueError):
                return DEFAULT_WEIGHT_LB
        variants = {}
        for v in (p.get('variants') or []):
            if not (isinstance(v, dict) and _sellable(v)):
                continue
            price_id = v.get(price_field)
            if not price_id:
                if v.get('stripePrice'):   # configured to sell, just missing the id for THIS mode
                    missing.append(p['id'] + '/' + str(v.get('id')))
                continue
            variants[v.get('id')] = {'price': price_id, 'weightLb': _w(v),
                                     'label': v.get('label', v.get('id')), 'priceUsd': v.get('price')}
        if variants:
            catalog[p['id']] = {'title': p.get('title', p['id']), 'variants': variants}
    if mode == 'live' and missing:
        print('WARNING [store_products]: STRIPE_MODE=live but these sellable variants have no '
              'stripePriceLive and were dropped from store-catalog.json: ' + ', '.join(missing))
    files.append(File.generated(config, 'store-catalog.json', content=json.dumps(catalog, ensure_ascii=False)))
    return files


# --- kit cards on project/writing pages get the same letterbox treatment as the store grid:
# the image is `object-fit: contain`, and the wrap's background is sampled from the image so the
# fill matches the photo's own background instead of a fixed white. Sampled at build (PIL); a
# missing/unreadable image just keeps the CSS default. ---
_KIT_BG_CACHE = {}
_KIT_RX = re.compile(r'(<span class="kit-card__imgwrap")(>\s*<img\b[^>]*?\bsrc="([^"]+)")')


def on_post_page(output, page, config):
    if 'kit-card__imgwrap' not in output:
        return output
    docs = Path(config['docs_dir'])

    def repl(m):
        src = m.group(3)
        if src not in _KIT_BG_CACHE:
            rel = src.split('?', 1)[0].split('#', 1)[0]
            _KIT_BG_CACHE[src] = _bg_color(docs / rel.lstrip('/')) if rel.startswith('/') else None
        color = _KIT_BG_CACHE[src]
        return m.group(0) if not color else (m.group(1) + ' style="background:' + color + '"' + m.group(2))

    return _KIT_RX.sub(repl, output)
