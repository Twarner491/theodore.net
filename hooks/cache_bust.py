"""
MkDocs hook: cache-bust the inline store.js reference.

store.js is referenced as a plain <script src="/assets/js/store.js"> on every store + legal page and is
served from the edge with a long TTL (max-age=604800), so a code change can sit behind a stale CDN object
until a purge -- and the zone purge has proven unreliable for this asset. Append a short content hash
(?h=...) so each store.js change produces a NEW url the CDN treats as a fresh object. The HTML pages are
served dynamically (cache-control: max-age=0), so the rewritten reference goes live on the very next deploy
with no purge needed. Fully defensive: any failure falls back to the bare reference, never breaking the build.
"""
import hashlib
import os

_HASH = None


def _store_hash(config):
    global _HASH
    if _HASH is None:
        try:
            base = os.path.dirname(os.path.abspath(config["config_file_path"]))
            with open(os.path.join(base, "docs", "assets", "js", "store.js"), "rb") as f:
                _HASH = hashlib.sha1(f.read()).hexdigest()[:8]
        except Exception:
            _HASH = "1"
    return _HASH


def on_page_markdown(markdown, page, config, files):
    try:
        if "/assets/js/store.js" not in markdown:
            return markdown
        return markdown.replace("/assets/js/store.js", "/assets/js/store.js?h=" + _store_hash(config))
    except Exception:
        return markdown
