"""Emit /search-data.json for the custom card-based search.

One record per project / writing with the card metadata (title, description,
thumbnail, date, readtime) plus stripped body text for full-text matching.
Products are sourced separately at runtime from the store (window.searchProducts).
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


def _scan_store(docs_dir):
    """Read product definitions from docs/store/*.md frontmatter so products are
    searchable on every page. The frontmatter is the single source of truth
    (hooks/store_products.py builds the store's runtime data from the same
    files), so there is no JS parsing that could silently drift."""
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
        out.append((fm.get('order', 999), {
            'type': 'product',
            'url': f"/store/{pid}/",
            'title': fm.get('title', '') or '',
            'description': fm.get('teaser', '') or '',
            'thumbnail': (base + images[0]) if (base and images) else '',
            'date': '',
            'dateISO': '',
            'readtime': '',
            'price': int(min(prices)) if prices else None,
            'keywords': fm.get('teaser', '') or '',
            'text': fm.get('sub', '') or '',
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
        out.append({
            'type': type_,
            'url': f"/{folder}/{md.stem}/",
            'title': fm.get('title', ''),
            'description': fm.get('description', ''),
            'thumbnail': fm.get('thumbnail', ''),
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
