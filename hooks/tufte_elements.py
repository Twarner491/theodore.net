"""
Tufte-inspired markdown processing hook for MkDocs.

Transforms shorthand syntax into Tufte HTML elements:

  {.newthought}Text here{/.newthought}
  {.sidenote}Sidenote text{/.sidenote}
  {.marginnote}Margin note text{/.marginnote}
  {.marginfigure}![alt](url)\nCaption text{/.marginfigure}
  {.epigraph} > Quote {/.epigraph}
  {.fullwidth} content {/.fullwidth}
"""

import os
import re


_sidenote_counter = 0
_carousel_counter = 0


def _reset_counter():
    global _sidenote_counter
    _sidenote_counter = 0


def _next_sidenote_id():
    global _sidenote_counter
    _sidenote_counter += 1
    return f"sn-{_sidenote_counter}"


def _next_marginnote_id():
    global _sidenote_counter
    _sidenote_counter += 1
    return f"mn-{_sidenote_counter}"


def _process_newthought(markdown):
    pattern = r'\{\.newthought\}(.*?)\{/\.newthought\}'
    return re.sub(pattern, r'<span class="newthought">\1</span>', markdown, flags=re.DOTALL)


def _process_sidenotes(markdown):
    def replace_sidenote(match):
        text = match.group(1).strip()
        sn_id = _next_sidenote_id()
        return (
            f'<label for="{sn_id}" class="margin-toggle sidenote-number"></label>'
            f'<input type="checkbox" id="{sn_id}" class="margin-toggle"/>'
            f'<span class="sidenote">{text}</span>'
        )
    pattern = r'\{\.sidenote\}(.*?)\{/\.sidenote\}'
    return re.sub(pattern, replace_sidenote, markdown, flags=re.DOTALL)


def _process_marginnotes(markdown):
    def replace_marginnote(match):
        text = match.group(1).strip()
        mn_id = _next_marginnote_id()
        return (
            f'<input type="checkbox" id="{mn_id}" class="margin-toggle"/>'
            f'<label for="{mn_id}" class="margin-toggle">'
            f'<i class="fa-solid fa-circle-plus"></i></label>'
            f'<span class="marginnote">{text}</span>'
        )
    pattern = r'\{\.marginnote\}(.*?)\{/\.marginnote\}'
    return re.sub(pattern, replace_marginnote, markdown, flags=re.DOTALL)


def _process_marginfigures(markdown):
    """Convert {.marginfigure}content{/.marginfigure} to margin figure HTML.

    Content can be an image with optional caption text below it:
      {.marginfigure}![alt](url)
      Caption text here{/.marginfigure}
    """
    pattern = r'\{\.marginfigure\}\s*\n?(.*?)\n?\{/\.marginfigure\}'

    def replace_marginfigure(match):
        content = match.group(1).strip()
        mn_id = _next_marginnote_id()

        # Split into image line(s) and caption
        lines = content.split('\n')
        img_lines = []
        caption_lines = []
        found_non_img = False

        for line in lines:
            stripped = line.strip()
            if not found_non_img and (stripped.startswith('![') or stripped.startswith('<img')):
                img_lines.append(stripped)
            else:
                found_non_img = True
                if stripped:
                    caption_lines.append(stripped)

        img_md = '\n'.join(img_lines) if img_lines else ''
        caption = ' '.join(caption_lines) if caption_lines else ''

        parts = [
            f'<input type="checkbox" id="{mn_id}" class="margin-toggle"/>',
            f'<label for="{mn_id}" class="margin-toggle">'
            f'<i class="fa-solid fa-circle-plus"></i></label>',
            f'<span class="marginfigure">',
        ]
        if img_md:
            parts.append(f'{img_md}')
        if caption:
            parts.append(f'<span class="caption">{caption}</span>')
        parts.append('</span>')

        return ''.join(parts)

    return re.sub(pattern, replace_marginfigure, markdown, flags=re.DOTALL)


def _process_epigraphs(markdown):
    pattern = r'\{\.epigraph\}\s*\n(.*?)\n\{/\.epigraph\}'

    def replace_epigraph(match):
        content = match.group(1).strip()
        quotes = []
        current_quote = []
        current_footer = None

        for line in content.split('\n'):
            stripped = line.strip()
            # Strip leading blockquote marker
            inner = stripped
            if inner.startswith('> '):
                inner = inner[2:]
            elif inner == '>':
                inner = ''

            if inner.startswith('— ') or inner.startswith('-- '):
                if inner.startswith('— '):
                    current_footer = inner[2:].strip()
                else:
                    current_footer = inner[3:].strip()
            elif stripped.startswith('> ') or stripped == '>':
                current_quote.append(inner)
            elif stripped == '' and current_quote:
                if current_quote:
                    quotes.append(('\n'.join(current_quote), current_footer))
                    current_quote = []
                    current_footer = None
            else:
                current_quote.append(stripped)

        if current_quote:
            quotes.append(('\n'.join(current_quote), current_footer))

        html_parts = ['<div class="epigraph">']
        for quote_text, footer in quotes:
            html_parts.append('  <blockquote>')
            html_parts.append(f'    <p>{quote_text}</p>')
            if footer:
                html_parts.append(f'    <footer>{footer}</footer>')
            html_parts.append('  </blockquote>')
        html_parts.append('</div>')

        return '\n'.join(html_parts)

    return re.sub(pattern, replace_epigraph, markdown, flags=re.DOTALL)


def _process_fullwidth(markdown):
    pattern = r'\{\.fullwidth\}\s*\n(.*?)\n\{/\.fullwidth\}'

    def replace_fullwidth(match):
        content = match.group(1).strip()
        return f'<figure class="fullwidth" markdown="1">\n{content}\n</figure>'

    return re.sub(pattern, replace_fullwidth, markdown, flags=re.DOTALL)


def _fix_fullwidth_after_margin(html):
    """When a margin note float is in the paragraph immediately before a
    fullwidth figure, convert it to a non-floating caption to avoid the
    clear:right gap."""
    # Match: paragraph containing a margin note, ending </p>, then
    # optional whitespace, then a fullwidth figure.
    # The margin note must be in that same <p> block.
    pattern = (
        r'<input type="checkbox" id="(mn-\d+)" class="margin-toggle"/>'
        r'<label for="\1" class="margin-toggle">'
        r'<i class="fa-solid fa-circle-plus"></i></label>'
        r'<span class="marginnote">([^<]*(?:<(?!/span>)[^<]*)*)</span>'
        r'(:[^<]*</p>\s*)'
        r'(<figure class="fullwidth")'
    )

    def replace(match):
        mn_id = match.group(1)
        note_text = match.group(2)
        between = match.group(3)
        fig_open = match.group(4)
        return (
            f'<input type="checkbox" id="{mn_id}" class="margin-toggle"/>'
            f'<label for="{mn_id}" class="margin-toggle">'
            f'<i class="fa-solid fa-circle-plus"></i></label>'
            f'<span class="fullwidth-caption">{note_text}</span>'
            f'{between}'
            f'{fig_open}'
        )

    return re.sub(pattern, replace, html, flags=re.DOTALL)


_IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'}


def _process_carousels(markdown, page, config):
    """Convert {.carousel}path/to/folder{/.carousel} to carousel HTML+JS.

    Scans the folder at build time and injects all images found.
    The path is relative to the docs directory.
    """
    global _carousel_counter
    pattern = r'\{\.carousel\}(.*?)\{/\.carousel\}'

    def replace_carousel(match):
        # Skip if inside backticks (code span in markdown)
        start = match.start()
        before = markdown[:start]
        # Count backticks before match — odd means we're inside a code span
        if before.count('`') % 2 == 1:
            return match.group(0)
        global _carousel_counter
        _carousel_counter += 1
        carousel_id = f"carousel-{_carousel_counter}"
        folder_path = match.group(1).strip()

        # Resolve to filesystem path
        docs_dir = config.get('docs_dir', 'docs')
        abs_folder = os.path.join(docs_dir, folder_path)
        abs_folder = os.path.normpath(abs_folder)

        # Scan for images
        images = []
        if os.path.isdir(abs_folder):
            for f in sorted(os.listdir(abs_folder)):
                if os.path.splitext(f)[1].lower() in _IMAGE_EXTS:
                    images.append(f)

        if not images:
            return f'<!-- carousel: no images found in {folder_path} -->'

        # Build relative URL from the built page to the image folder
        # MkDocs builds foo.md -> foo/index.html, so use dest_path
        dest_path = page.file.dest_path.replace('\\', '/')
        page_dir = os.path.dirname(dest_path)
        img_url = os.path.relpath(folder_path, page_dir).replace('\\', '/')

        images_js = ', '.join(f"'{img}'" for img in images)

        return (
            f'<div id="{carousel_id}"></div>\n'
            f'<script>\n'
            f'(function() {{\n'
            f'  function init() {{\n'
            f'    if (typeof ImageCarousel === "undefined") return;\n'
            f'    try {{ new ImageCarousel("{carousel_id}", "{img_url}", [{images_js}]); }}\n'
            f'    catch(e) {{ console.error("Carousel error:", e); }}\n'
            f'  }}\n'
            f'  if (document.readyState === "loading") {{\n'
            f'    document.addEventListener("DOMContentLoaded", init);\n'
            f'  }} else {{ init(); }}\n'
            f'}})();\n'
            f'</script>'
        )

    return re.sub(pattern, replace_carousel, markdown, flags=re.DOTALL)


def on_page_markdown(markdown, page, config, files, **kwargs):
    """MkDocs hook: process Tufte shorthand syntax in markdown."""
    src_path = page.file.src_path.replace('\\', '/')
    if not (src_path.startswith('projects/') or src_path.startswith('writings/')):
        return markdown

    _reset_counter()
    global _carousel_counter
    _carousel_counter = 0

    markdown = _process_newthought(markdown)
    markdown = _process_sidenotes(markdown)
    markdown = _process_marginnotes(markdown)
    markdown = _process_marginfigures(markdown)
    markdown = _process_epigraphs(markdown)
    markdown = _process_fullwidth(markdown)
    markdown = _process_carousels(markdown, page, config)

    return markdown


_bom_counter = 0

# JS for dynamic figure grid height matching.
# Sets flex-grow proportional to each image's aspect ratio so images in a row
# share the same height with dynamic widths. Skips 2x2 grids (they wrap).
_FIGURE_GRID_JS = """
<script>
(function() {
  function initGrids() {
    document.querySelectorAll('.figure-grid').forEach(function(grid) {
      if (grid.classList.contains('grid-2x2')) return;
      var imgs = grid.querySelectorAll('img');
      var loaded = 0;
      var total = imgs.length;
      if (!total) return;
      function applyFlex() {
        imgs.forEach(function(img) {
          if (img.naturalWidth && img.naturalHeight) {
            img.style.flexGrow = (img.naturalWidth / img.naturalHeight).toString();
            img.style.flexShrink = '1';
            img.style.flexBasis = '0px';
            img.style.height = 'auto';
            img.style.width = 'auto';
            img.style.minWidth = '0';
          }
        });
      }
      imgs.forEach(function(img) {
        function check() {
          loaded++;
          if (loaded >= total) applyFlex();
        }
        if (img.complete && img.naturalWidth) check();
        else img.addEventListener('load', check);
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGrids);
  } else {
    initGrids();
  }
})();
</script>
"""

# CSS injected on pages with margin elements to hide TOC content
# but preserve the sidebar space for proper content width
_HIDE_TOC_CSS = """
<style>
.md-sidebar--secondary .md-nav--secondary { visibility: hidden; }
.md-sidebar--secondary .md-sidebar__scrollwrap { overflow: hidden; }
</style>
"""


def on_page_content(html, page, config, files, **kwargs):
    """Post-process rendered HTML: BOM tables, figure grid JS, TOC hiding."""
    src_path = page.file.src_path.replace('\\', '/')
    if not (src_path.startswith('projects/') or src_path.startswith('writings/')):
        return html

    global _bom_counter

    def replace_bom(match):
        global _bom_counter
        _bom_counter += 1
        bom_id = f"bom-toggle-{_bom_counter}"
        inner = match.group(1)
        row_count = inner.count('<tr') - 1

        return (
            f'<div class="bom-table">'
            f'<input type="checkbox" id="{bom_id}" class="bom-collapse-toggle">'
            f'<div class="bom-table-inner">{inner}</div>'
            f'<div class="bom-fade"></div>'
            f'<label for="{bom_id}" class="bom-toggle-label">'
            f'<span class="bom-label-expand">Show all {row_count} items</span>'
            f'<span class="bom-label-collapse">Collapse</span>'
            f'</label>'
            f'</div>'
        )

    html = re.sub(
        r'<div class="bom-table"[^>]*>(.*?)</div>',
        replace_bom,
        html,
        flags=re.DOTALL,
    )

    if 'figure-grid' in html:
        html += _FIGURE_GRID_JS

    # If page has margin elements, hide the TOC content (keep sidebar for width)
    has_margin = ('class="sidenote"' in html or
                  'class="marginnote"' in html or
                  'class="marginfigure"' in html)
    if has_margin:
        html = _HIDE_TOC_CSS + html

    # Convert margin notes before fullwidth figures to non-floating captions
    if 'class="fullwidth"' in html:
        html = _fix_fullwidth_after_margin(html)

    return html
