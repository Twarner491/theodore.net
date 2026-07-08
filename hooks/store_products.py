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

import csv
import hashlib
import io
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


def _meta_catalog_csv(products, price_field='stripePrice', docs_dir=None):
    """Meta Commerce catalog feed (one row per sellable, priced variant), served at
    /meta-catalog.csv for Commerce Manager's scheduled fetch. Columns are Meta's
    required set. Feed ids must never contain ':' (Meta's checkout URL encodes
    id:qty pairs), and coming-soon/soldout variants are excluded the same way the
    checkout catalog excludes them -- a tagged product that can't be bought is a
    commerce-review flag."""
    base = 'https://theodore.net'
    out = io.StringIO()
    w = csv.writer(out)
    # quantity_to_sell_on_facebook: without it, the Instagram shop surface renders
    # items "Sold out" even when availability says in stock (Meta help 560696898000137).
    # Kits are made to order, so this is a display/eligibility field, not real inventory.
    w.writerow(['id', 'title', 'description', 'availability', 'condition',
                'price', 'link', 'image_link', 'brand', 'quantity_to_sell_on_facebook'])
    for p in products:
        if not p.get('published') or not p.get('id'):
            continue
        desc = p.get('sub') or p.get('teaser') or p.get('title') or ''
        img_base = p.get('imageBase', '') or ''
        images = p.get('images') or []
        first_img = images[0] if images else ''
        for v in (p.get('variants') or []):
            if not (isinstance(v, dict) and _sellable(v)):
                continue
            price = v.get('price')
            if not isinstance(price, (int, float)):
                continue
            # Mirror store-catalog.json's gate: a variant the checkout would refuse
            # (no Price id for this mode) must never be published to Meta as buyable.
            if not v.get(price_field):
                continue
            status = v.get('status') or ('comingSoon' if v.get('comingSoon') else 'available')
            availability = {'available': 'in stock', 'backorder': 'available for order',
                            'preorder': 'preorder'}.get(status, 'in stock')
            img = v.get('image') or first_img
            image_link = ''
            if img:
                img = str(img)
                image_link = img if img.startswith('http') else base + img_base + img
                # Meta caches catalog images by URL, so a replaced photo under the same
                # filename would never refresh in the shop. Version the URL by content
                # hash: any image swap yields a new URL and Meta re-downloads on the
                # next feed fetch.
                if docs_dir and not img.startswith('http'):
                    try:
                        fp = Path(docs_dir) / (img_base + img).lstrip('/')
                        if fp.exists():
                            image_link += '?v=' + hashlib.sha1(fp.read_bytes()).hexdigest()[:8]
                    except Exception:
                        pass
            title = str(p.get('title', p['id']))
            label = str(v.get('label', v.get('id', '')))
            w.writerow([
                p['id'] + '-' + str(v.get('id', '')),
                title if (not label or label == title) else title + ' - ' + label,
                desc,
                availability,
                'new',
                '%.2f USD' % float(price),
                base + '/store/' + p['id'] + '/',
                image_link,
                'theodore.net',
                25,
            ])
    return out.getvalue()


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
    # Meta (Instagram Shop) catalog feed -- same frontmatter source of truth, so
    # prices/availability can never drift from the site (the #1 commerce-review rejection).
    files.append(File.generated(config, 'meta-catalog.csv', content=_meta_catalog_csv(products, price_field, config['docs_dir'])))
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
