"""Emit /search-data.json for the custom card-based search.

One record per project, writing, product, or accessory with card metadata
(title, description, thumbnail, date, readtime) plus searchable copy. Store
records come from the same docs/store frontmatter used to build the storefront.
"""

import json
import math
import os
import re
import yaml
from datetime import datetime, date
from pathlib import Path


def _frontmatter(content):
    if not content.startswith('---'):
        return {}, content
    m = re.search(r'\n---\s*\n', content[3:])
    if not m:
        return {}, content
    try:
        return (yaml.safe_load(content[3:m.start() + 3]) or {}), content[m.end() + 3:]
    except yaml.YAMLError:
        return {}, content


def _plain(body):
    t = re.sub(r'```.*?```', ' ', body, flags=re.DOTALL)
    t = re.sub(r'`[^`]+`', ' ', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', t)
    t = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', t)
    t = re.sub(r'\{\.?/?\.?\w+\}', ' ', t)
    t = re.sub(r'[#>*_~`|]+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def _readtime(body):
    words = len(_plain(body).split())
    if words < 50:
        return '~1 min'
    slow, fast = max(1, math.ceil(words / 190)), max(1, math.ceil(words / 150))
    if slow == fast:
        return f"{slow} min" if slow == 1 else f"{slow} mins"
    return f"{slow}–{fast} mins"


def _date_strs(fm):
    d = fm.get('date')
    if isinstance(d, datetime):
        pass
    elif isinstance(d, date):
        d = datetime.combine(d, datetime.min.time())
    elif isinstance(d, str):
        try:
            d = datetime.fromisoformat(d.replace('Z', '+00:00')).replace(tzinfo=None)
        except ValueError:
            d = None
    else:
        d = None
    return (d.strftime('%b %Y') if d else ''), (d.isoformat() if d else '')


def _dark_sibling(docs_dir, url):
    """Return the '<name>DARK.<ext>' URL when that file exists on disk, else ''.
    Lets search.js swap a thumbnail to its dark variant in dark mode."""
    if not url:
        return ''
    stem, dot, ext = url.rpartition('.')
    if not dot:
        return ''
    dark = stem + 'DARK.' + ext
    return dark if (Path(docs_dir) / dark.lstrip('/')).exists() else ''


def _scan_store(docs_dir):
    """Read product definitions from docs/store/*.md frontmatter so products and
    accessories are searchable on every page. The frontmatter is the single
    source of truth (hooks/store_products.py builds the store's runtime data
    from the same files), so there is no JS parsing that could silently drift.

    Accessories carry their relationship metadata into the index. search.js
    keeps them out of the empty browse view and only surfaces them for a typed
    query, avoiding a duplicate card for every add-on in the normal Store row.
    """
    out = []
    store = Path(docs_dir) / 'store'
    if not store.exists():
        return out
    for md in sorted(store.glob('*.md')):
        try:
            fm, _ = _frontmatter(md.read_text(encoding='utf-8'))
        except Exception:
            continue
        if not isinstance(fm, dict) or not fm.get('product'):
            continue
        pid = fm.get('id') or md.stem
        variants = fm.get('variants') if isinstance(fm.get('variants'), list) else []
        prices = [v.get('price') for v in variants
                  if isinstance(v, dict) and isinstance(v.get('price'), (int, float))]
        images = fm.get('images') if isinstance(fm.get('images'), list) else []
        base = fm.get('imageBase') or ''
        thumb = (base + images[0]) if (base and images) else ''
        # Product pages keep the most useful search vocabulary in `sub` and in
        # their variant labels/descriptions/contents. In particular, an item
        # such as "Sakura Micron 05" needs its "pens" copy indexed even though
        # that word is not in the title. Do not add parentId here: matching a
        # parent name alone must not make every one of its accessories appear.
        search_terms = [fm.get('keywords', ''), fm.get('sub', ''), pid.replace('-', ' ')]
        for variant in variants:
            if not isinstance(variant, dict):
                continue
            search_terms.extend([variant.get('label', ''), variant.get('desc', '')])
            contents = variant.get('contents')
            if isinstance(contents, list):
                search_terms.extend(contents)
        keywords = ' '.join(_plain(str(term)) for term in search_terms if term)
        out.append((fm.get('order', 999), {
            'type': 'product',
            'id': pid,
            'url': f"/store/{pid}/",
            'title': fm.get('title', '') or '',
            'description': fm.get('teaser', '') or '',
            'thumbnail': thumb,
            'thumbnailDark': _dark_sibling(docs_dir, thumb),
            'date': '',
            'dateISO': '',
            'readtime': '',
            'price': int(min(prices)) if prices else None,
            'keywords': keywords,
            'text': fm.get('sub', '') or '',
            'accessory': bool(fm.get('accessory')),
            'parentId': fm.get('parentId', '') or '',
        }))
    out.sort(key=lambda t: (t[0], t[1].get('title', '')))   # frontmatter `order` keeps products consistent with the store grid
    return [e for _, e in out]


def _scan(docs_dir, folder, type_):
    out = []
    p = Path(docs_dir) / folder
    if not p.exists():
        return out
    for md in sorted(p.glob('*.md')):
        try:
            content = md.read_text(encoding='utf-8')
        except Exception:
            continue
        fm, body = _frontmatter(content)
        if not isinstance(fm, dict):          # a list/scalar frontmatter must not crash the build
            fm = {}
        sx = fm.get('search')
        if fm.get('draft') or not fm.get('title') or (isinstance(sx, dict) and sx.get('exclude')):
            continue                          # honour drafts and `search: exclude: true` (the site's opt-out convention)
        date_str, date_iso = _date_strs(fm)
        kw = fm.get('keywords', '') or ''
        text = _plain(body)
        thumb = fm.get('thumbnail', '')
        out.append({
            'type': type_,
            'url': f"/{folder}/{md.stem}/",
            'title': fm.get('title', ''),
            'description': fm.get('description', ''),
            'thumbnail': thumb,
            'thumbnailDark': _dark_sibling(docs_dir, thumb),
            'date': date_str,
            'dateISO': date_iso,
            'readtime': _readtime(body),
            'keywords': kw,
            'text': text[:4000],
        })
    return out


def on_post_build(config):
    # A search-index hook must never abort the site build; degrade to a stale/partial index.
    try:
        docs_dir = config['docs_dir']
        items = _scan(docs_dir, 'projects', 'project') + _scan(docs_dir, 'writings', 'writing')
        items.sort(key=lambda x: x['dateISO'], reverse=True)
        items += _scan_store(docs_dir)   # products carry no date; keep them after dated content
        out_path = os.path.join(config['site_dir'], 'search-data.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump({'items': items}, f, ensure_ascii=False, separators=(',', ':'))
    except Exception as e:
        print(f"search_data: could not build search-data.json: {e}")
