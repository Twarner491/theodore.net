"""Render storefront icons locally and prioritize its rendering dependencies."""
from functools import lru_cache
from html import escape
from importlib.resources import files
import re
from urllib.parse import urlsplit


_FONT_AWESOME = re.compile(
    r'<script\b(?=[^>]*\bsrc=["\']https://kit\.fontawesome\.com/)[^>]*>\s*</script>',
    re.IGNORECASE,
)
_FONT_AWESOME_LINK = re.compile(r'<link\b(?=[^>]*\bhref=["\']https://(?:[a-z0-9.-]+\.)?fontawesome\.com(?:/[^"\']*)?["\'])[^>]*>', re.IGNORECASE)
_ICON = re.compile(r'<i\b([^>]*)>\s*</i>', re.IGNORECASE)
_STOREFRONT_STYLES = re.compile(
    r'<link\b(?=[^>]*\brel=["\']stylesheet["\'])(?=[^>]*\bhref=["\']/assets/css/(?:index|store|header)\.css(?:\?[^"\']*)?["\'])[^>]*>',
    re.IGNORECASE,
)
_EXTERNAL_SCRIPT = re.compile(r'<script\b[^>]*\bsrc=["\']([^"\']+)["\'][^>]*>\s*</script>', re.IGNORECASE)
_GOOGLE_FONT_CSS = re.compile(
    r'<link\b(?=[^>]*\brel=["\']stylesheet["\'])(?=[^>]*\bhref=["\']https://fonts\.googleapis\.com/)[^>]*>',
    re.IGNORECASE,
)
_EARLY_SCRIPTS = ('error-suppressor.js', 'attribution.js', 'meta-tracking.js', 'store-data.js', 'store.js', 'header.js', 'search.js')
_EARLY_MARKER = '<!-- storefront early scripts -->'


def on_page_markdown(markdown, page, config, files):
    if not page.file.src_uri.startswith('store/'):
        return markdown

    return _FONT_AWESOME.sub('', markdown)


@lru_cache(maxsize=None)
def _icon_source(family, name):
    # MkDocs Material is already the site's theme/build dependency. Keep its
    # complete SVG/viewBox and license comment, with no browser font request.
    return files('material').joinpath(f'templates/.icons/fontawesome/{family}/{name}.svg').read_text()


def _inline_icon(match):
    classes = re.search(r'\bclass=["\']([^"\']+)["\']', match.group(1))
    if not classes:
        return match.group()
    classes = classes.group(1).split()
    family = next((kind for kind in ('solid', 'regular', 'brands') if 'fa-' + kind in classes), None)
    if not family:
        return match.group()
    name = next((c[3:] for c in classes if c.startswith('fa-') and c != 'fa-' + family), None)
    if not name or not re.fullmatch(r'[a-z0-9-]+', name):
        raise ValueError('Unrecognized storefront icon: ' + ' '.join(classes))
    extra = ' '.join(['store-icon'] + [c for c in classes if not c.startswith('fa-')])
    return _icon_source(family, name).replace('<svg ', '<svg class="' + escape(extra, quote=True) + '" fill="currentColor" aria-hidden="true" focusable="false" ', 1)


def _footer_instagram(match):
    opening, content = match.group(1), match.group(2)
    if not re.search(r'\bhref=["\']mailto:teddy@warner\.net["\']', opening) or 'fa-paper-plane' not in content:
        return match.group()
    opening = re.sub(r'\bhref=["\'][^"\']+["\']', 'href="https://www.instagram.com/teddymakesstuff/"', opening)
    opening = re.sub(r'\s+(?:aria-label|rel)=["\'][^"\']*["\']', '', opening)
    opening = opening[:-1] + ' aria-label="Instagram" rel="noopener">'
    return opening + content.replace('fa-solid fa-paper-plane', 'fa-brands fa-instagram') + '</a>'


def on_post_page(output, page, config):
    if not page.file.src_uri.startswith('store/'):
        return output
    output = _FONT_AWESOME.sub('', output)
    output = _FONT_AWESOME_LINK.sub('', output)
    # Resolve the existing footer-social.js swap before replacing the icon with
    # SVG; its runtime selector intentionally targets only the old <i> element.
    output = re.sub(r'(<a\b[^>]*>)(.*?)</a>', _footer_instagram, output, flags=re.DOTALL | re.IGNORECASE)
    output = _ICON.sub(_inline_icon, output)
    # Markdown authors these links after the header. A streamed document can paint
    # that header before its cart sizing/badge styles arrive. Keep the same cascade,
    # but discover every storefront stylesheet in the real head before first paint.
    head_end = output.find('</head>')
    if head_end < 0:
        return output
    head, body = output[:head_end], output[head_end:]
    links = _STOREFRONT_STYLES.findall(body)
    body = _STOREFRONT_STYLES.sub('', body)
    if links:
        head += '\n' + '\n'.join(dict.fromkeys(links)) + '\n'
    output = head + body

    # The storefront's display faces are local. Material's secondary text/code
    # fonts can arrive independently instead of holding CSS, inline palette setup
    # and the parser behind a cross-origin stylesheet request.
    if '<!-- storefront secondary fonts -->' not in output:
        def nonblocking_font(match):
            original = match.group()
            preload = re.sub(r'\brel=["\']stylesheet["\']', 'rel="preload" as="style"', original, count=1)
            preload = preload[:-1] + ' onload="this.onload=null;this.rel=\'stylesheet\'">'
            return '<!-- storefront secondary fonts -->' + preload + '<noscript>' + original + '</noscript>'
        output = _GOOGLE_FONT_CSS.sub(nonblocking_font, output)

    if _EARLY_MARKER in output:
        return output
    early = {}

    def defer_local_script(match):
        src = urlsplit(match.group(1))
        tag = match.group()
        if src.scheme or src.netloc or re.search(r'\sasync\b|\btype=["\']module["\']', tag, re.IGNORECASE):
            return tag
        if not re.search(r'\sdefer\b', tag, re.IGNORECASE):
            tag = tag.replace('>', ' defer>', 1)
        name = src.path.rsplit('/', 1)[-1]
        if '/assets/js/' in '/' + src.path and name in _EARLY_SCRIPTS:
            early.setdefault(name, tag)
            return ''
        return tag

    # Defer local scripts together. Moving only store.js would run it before its
    # catalog/attribution dependencies; this explicit queue preserves that order
    # and renders the shop before optional Material/widgets finish initializing.
    output = _EXTERNAL_SCRIPT.sub(defer_local_script, output)
    scripts = '\n'.join(early[name] for name in _EARLY_SCRIPTS if name in early)
    if scripts:
        output = output.replace('</head>', _EARLY_MARKER + '\n' + scripts + '\n</head>', 1)
    return output
