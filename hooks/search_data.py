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
    """Parse the PRODUCTS array out of the store's source (store.js) at build
    time so products are searchable on every page, not only where store.js runs.
    Read-only: we never modify the store's files."""
    out = []
    js = Path(docs_dir) / 'assets' / 'js' / 'store.js'
    if not js.exists():
        return out
    try:
        src = js.read_text(encoding='utf-8')
    except Exception:
        return out
    m = re.search(r'const\s+PRODUCTS\s*=\s*\[', src)
    if not m:
        return out
    # walk from the opening '[' to its matching ']' (string-aware)
    i = src.index('[', m.start())
    depth, end, instr, esc = 0, None, None, False
    for j in range(i, len(src)):
        c = src[j]
        if instr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == instr:
                instr = None
            continue
        if c in ('"', "'", '`'):
            instr = c
        elif c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                end = j
                break
    if end is None:
        return out
    arr = src[i + 1:end]
    # split top-level product objects ({...} at brace-depth 0 within the array)
    objs, depth, start, instr, esc = [], 0, None, None, False
    for k, c in enumerate(arr):
        if instr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == instr:
                instr = None
            continue
        if c in ('"', "'", '`'):
            instr = c
        elif c == '{':
            if depth == 0:
                start = k
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0 and start is not None:
                objs.append(arr[start:k + 1])
                start = None
    seen = set()
    for blk in objs:
        def field(pat):
            mm = re.search(pat, blk)
            return mm.group(1) if mm else None
        pid = field(r'\bid:\s*"([^"]*)"')              # product id is the first id: in the block
        if not pid or pid in seen:
            continue                                    # every store product is searchable; de-dupe by id
        seen.add(pid)
        img = re.search(r'\bimages:\s*\[\s*"([^"]*)"', blk)
        base = field(r'\bimageBase:\s*"([^"]*)"') or ''
        prices = [int(x) for x in re.findall(r'\bprice:\s*(\d+)', blk)]
        out.append({
            'type': 'product',
            'url': f"/store/{pid}/",
            'title': field(r'\btitle:\s*"([^"]*)"') or '',
            'description': field(r'\bteaser:\s*"([^"]*)"') or '',
            'thumbnail': (base + img.group(1)) if (base and img) else '',
            'date': '',
            'dateISO': '',
            'readtime': '',
            'price': min(prices) if prices else None,
            'keywords': field(r'\bteaser:\s*"([^"]*)"') or '',
            'text': field(r'\bsub:\s*"([^"]*)"') or '',
        })
    if objs and not out:   # PRODUCTS block found but nothing parsed — store.js format likely changed
        print("search_data: store.js PRODUCTS matched but yielded 0 products (format may have changed)")
    return out


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
