"""
MkDocs hook: cache-bust storefront asset references.

store.js is referenced as a plain <script src="/assets/js/store.js"> on every store + legal page and is
served from the edge with a long TTL (max-age=604800), so a code change can sit behind a stale CDN object
until a purge -- and the zone purge has proven unreliable for this asset. Append a short content hash
(?h=...) so each store.js change produces a NEW url the CDN treats as a fresh object. The HTML pages are
served dynamically (cache-control: max-age=0), so the rewritten reference goes live on the very next deploy
with no purge needed. Fully defensive: any failure falls back to the bare reference, never breaking the build.

The sitewide measurement, store-data.js and search.js references need the same treatment. Store data is generated from
the product frontmatter, so its version covers the product definitions and generator rather than a source
file that does not exist until the build is underway.
"""
import hashlib
import importlib.util
import os
from pathlib import Path

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


def _source_hash(config, paths):
    try:
        base = Path(config["config_file_path"]).resolve().parent
        digest = hashlib.sha1()
        for relative in paths:
            source = base / relative
            digest.update(str(relative).encode("utf-8"))
            digest.update(source.read_bytes())
        return digest.hexdigest()[:8]
    except Exception:
        return "1"


def on_config(config):
    # Hook loading does not guarantee that `hooks` is an importable package.
    image_spec = importlib.util.spec_from_file_location('store_image_cache_inputs', Path(__file__).with_name('store_images.py'))
    image_helpers = importlib.util.module_from_spec(image_spec)
    image_spec.loader.exec_module(image_helpers)
    base = Path(config["config_file_path"]).resolve().parent
    store_sources = [Path("hooks/store_products.py"), Path("hooks/store_images.py")]
    store_sources.extend(path.relative_to(base) for path in sorted((base / "docs/store").glob("*.md")))
    store_sources.extend(path.relative_to(base) for path in image_helpers.source_inputs(base / "docs"))
    versions = {
        "assets/js/attribution.js": _source_hash(config, [Path("docs/assets/js/attribution.js")]),
        "assets/js/meta-tracking.js": _source_hash(config, [Path("docs/assets/js/meta-tracking.js")]),
        "assets/js/store-data.js": _source_hash(config, store_sources),
        "assets/js/search.js": _source_hash(config, [Path("docs/assets/js/search.js")]),
        "assets/js/index.js": _source_hash(config, [Path("docs/assets/js/index.js")]),
        "assets/js/footer-social.js": _source_hash(config, [Path("docs/assets/js/footer-social.js")]),
    }
    config["extra_javascript"] = [
        asset.split("?", 1)[0] + "?h=" + versions[asset.split("?", 1)[0]]
        if asset.split("?", 1)[0] in versions else asset
        for asset in map(str, config.get("extra_javascript", []))
    ]
    # CSS defines the initial, static header slots. Version it alongside search.js
    # so a cached stylesheet cannot restore the old hidden/injected-icon layout.
    css_versions = {
        asset: _source_hash(config, [Path("docs") / asset])
        for asset in ("assets/css/search.css", "assets/css/header-search.css", "assets/css/ad-measurement.css")
    }
    config["extra_css"] = [
        asset.split("?", 1)[0] + "?h=" + css_versions[asset.split("?", 1)[0]]
        if asset.split("?", 1)[0] in css_versions else asset
        for asset in map(str, config.get("extra_css", []))
    ]
    return config


def on_post_page(output, page, config):
    # These card assets also have absolute references authored directly in templates.
    for asset in ("assets/js/index.js", "assets/css/projects/project.css", "assets/css/store.css",
                  "assets/js/header.js", "assets/css/header.css"):
        reference = '/' + asset + '"'
        if reference in output:
            version = _source_hash(config, [Path("docs") / asset])
            output = output.replace(reference, '/' + asset + '?h=' + version + '"')
    return output


def on_page_markdown(markdown, page, config, files):
    try:
        if "/assets/js/store.js" not in markdown:
            return markdown
        return markdown.replace("/assets/js/store.js", "/assets/js/store.js?h=" + _store_hash(config))
    except Exception:
        return markdown
