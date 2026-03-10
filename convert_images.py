"""
Comprehensive Tufte format conversion for MkDocs project/writing pages.

Steps (in order):
1. Convert [^N] footnotes → {.sidenote} shorthand
2. Extract <figcaption> → {.marginnote} placed ABOVE figures
3. Convert <figure markdown="1"> with images → HTML <figure>/<div class="figure-grid">
4. Move any standalone {.marginnote} after </figure> or </div> to ABOVE
"""

import os
import re

DOCS_DIR = os.path.join(os.path.dirname(__file__), 'docs')
SKIP_FILES = {'example.md', 'ProjectPortfolioSite.md'}

IMG_RE = re.compile(
    r'^\s*!\[([^\]]*)\]'
    r'\(([^)]+)\)'
    r'(?:\{([^}]*)\})?'
    r'\s*(.*)$'
)
ATTR_RE = re.compile(r'(\w+)="([^"]*)"')
FIGCAPTION_RE = re.compile(r'^\s*<figcaption>(.*?)</figcaption>\s*$')


def parse_md_image(line):
    m = IMG_RE.match(line)
    if not m:
        return None
    alt_bracket = m.group(1)
    path = m.group(2)
    attrs_str = m.group(3) or ''
    rest = m.group(4).strip()
    attrs = dict(ATTR_RE.findall(attrs_str))
    alt = alt_bracket or attrs.pop('alt', '')
    theme_class = None
    if '#only-light' in path:
        path = path.replace('#only-light', '')
        theme_class = 'only-light'
    elif '#only-dark' in path:
        path = path.replace('#only-dark', '')
        theme_class = 'only-dark'
    return {
        'path': path, 'alt': alt,
        'width': attrs.pop('width', None),
        'align': attrs.pop('align', None),
        'theme_class': theme_class,
        'rest': rest,
    }


def img_to_html(p):
    parts = [f'<img src="{p["path"]}"']
    if p['alt']:
        parts.append(f' alt="{p["alt"]}"')
    if p['theme_class']:
        parts.append(f' class="{p["theme_class"]}"')
    if p['width']:
        parts.append(f' width="{p["width"]}"')
    parts.append('>')
    return ''.join(parts)


# --- Step 1: Footnote → Sidenote ---

def convert_footnotes(content):
    """Convert [^N] footnotes to {.sidenote} shorthand."""
    lines = content.split('\n')

    # Collect definitions [^N]: text (possibly multi-line with 4-space indent)
    defs = {}
    clean = []
    i = 0
    while i < len(lines):
        m = re.match(r'^\[\^(\w+)\]:\s*(.*)', lines[i])
        if m:
            fn_id = m.group(1)
            parts = [m.group(2)]
            i += 1
            while i < len(lines) and (lines[i].startswith('    ') or lines[i].startswith('\t')):
                parts.append(lines[i].strip())
                i += 1
            defs[fn_id] = ' '.join(p for p in parts if p)
            continue
        clean.append(lines[i])
        i += 1

    if not defs:
        return content

    content = '\n'.join(clean)

    # Replace inline [^N] (not followed by :) with {.sidenote}text{/.sidenote}
    used = set()

    def replace_fn(match):
        fn_id = match.group(1)
        if fn_id in defs:
            used.add(fn_id)
            return '{.sidenote}' + defs[fn_id] + '{/.sidenote}'
        return match.group(0)

    content = re.sub(r'\[\^(\w+)\](?![\s]*:)', replace_fn, content)

    # Strip excessive trailing newlines from removed definitions
    content = re.sub(r'\n{3,}$', '\n', content)

    return content


# --- Step 2+3: Figure processing ---

def convert_figure_block(figure_lines):
    """Process a <figure markdown="1"> block.

    Returns (pre_lines, figure_lines):
      pre_lines: marginnotes to place BEFORE the figure
      figure_lines: the converted figure output
    """
    open_line = figure_lines[0].strip()
    inner = figure_lines[1:-1]

    # Extract figcaptions
    captions = []
    cleaned = []
    for line in inner:
        cap_m = FIGCAPTION_RE.match(line)
        if cap_m:
            captions.append(cap_m.group(1).strip())
        else:
            cleaned.append(line)

    pre = []
    for cap in captions:
        pre.append('{.marginnote}' + cap + '{/.marginnote}')
        pre.append('')

    content_lines = [l for l in cleaned if l.strip()]

    # Classify content lines
    image_lines = []
    non_image = False
    for l in content_lines:
        s = l.strip()
        if s.startswith('!['):
            image_lines.append(l)
        elif s.startswith('<img'):
            # Already HTML image - skip conversion
            return pre, [fl for fl in figure_lines if not FIGCAPTION_RE.match(fl)]
        elif s == '<br>' or s.startswith('<br'):
            non_image = True
        elif s:
            non_image = True

    if non_image or not image_lines:
        # Keep as-is but remove figcaptions
        out = [l for l in figure_lines if not FIGCAPTION_RE.match(l)]
        return pre, out

    # Parse images
    images = []
    trailing = []
    for l in image_lines:
        p = parse_md_image(l)
        if p:
            images.append(p)
            if p['rest']:
                trailing.append(p['rest'])
        else:
            return pre, figure_lines

    if not images:
        return pre, figure_lines

    # Preserve style
    style_m = re.search(r'style="([^"]*)"', open_line)
    style = f' style="{style_m.group(1)}"' if style_m else ''

    has_theme = any(img['theme_class'] for img in images)
    result = []

    if has_theme:
        result.append(f'<figure{style}>')
        for img in images:
            result.append(img_to_html(img))
        result.append('</figure>')
    elif len(images) == 1:
        result.append(f'<figure{style}>')
        result.append(img_to_html(images[0]))
        result.append('</figure>')
    elif len(images) == 2:
        result.append('<div class="figure-grid grid-2x1">')
        for img in images:
            result.append(img_to_html(img))
        result.append('</div>')
    elif len(images) == 3:
        result.append('<div class="figure-grid grid-3x1">')
        for img in images:
            result.append(img_to_html(img))
        result.append('</div>')
    elif len(images) >= 4:
        for j in range(0, len(images), 2):
            pair = images[j:j + 2]
            if len(pair) == 2:
                result.append('<div class="figure-grid grid-2x1">')
                for img in pair:
                    result.append(img_to_html(img))
                result.append('</div>')
                if j + 2 < len(images):
                    result.append('')
            else:
                result.append('<figure>')
                result.append(img_to_html(pair[0]))
                result.append('</figure>')

    for t in trailing:
        result.append(t)

    return pre, result


def process_figures(content):
    """Find and convert all <figure markdown="1"> blocks."""
    lines = content.split('\n')
    output = []
    i = 0
    in_code = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith('```'):
            in_code = not in_code
            output.append(line)
            i += 1
            continue

        if in_code:
            output.append(line)
            i += 1
            continue

        if re.match(r'<figure\s+markdown="1"', stripped):
            fig = [line]
            i += 1
            depth = 1
            while i < len(lines) and depth > 0:
                cur = lines[i]
                depth += len(re.findall(r'<figure[\s>]', cur))
                depth -= cur.count('</figure>')
                fig.append(cur)
                i += 1

            pre, converted = convert_figure_block(fig)
            output.extend(pre)
            output.extend(converted)
            continue

        output.append(line)
        i += 1

    return '\n'.join(output)


# --- Step 4: Move marginnotes above figures ---

def move_marginnotes(content):
    """Move standalone {.marginnote}...{/.marginnote} from after </figure> or </div> to before."""
    lines = content.split('\n')
    result = []
    i = 0

    while i < len(lines):
        stripped = lines[i].strip()
        mn_m = re.match(r'^(\{\.marginnote\}.*\{/\.marginnote\})$', stripped)

        if mn_m:
            prev_idx = len(result) - 1
            while prev_idx >= 0 and result[prev_idx].strip() == '':
                prev_idx -= 1

            prev = result[prev_idx].strip() if prev_idx >= 0 else ''

            if prev in ('</figure>', '</div>'):
                tag = 'figure' if prev == '</figure>' else 'div'
                depth = 0
                open_idx = -1
                for j in range(prev_idx, -1, -1):
                    l = result[j].strip()
                    depth += len(re.findall(rf'</{tag}[\s>]', l))
                    depth -= len(re.findall(rf'<{tag}[\s>]', l))
                    if depth <= 0:
                        open_idx = j
                        break

                if open_idx >= 0:
                    result.insert(open_idx, '')
                    result.insert(open_idx, mn_m.group(1))
                    i += 1
                    continue

        result.append(lines[i])
        i += 1

    return '\n'.join(result)


def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content

    content = convert_footnotes(content)
    content = process_figures(content)
    content = move_marginnotes(content)

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False


def main():
    changed = []
    for subdir in ['projects', 'writings']:
        dirpath = os.path.join(DOCS_DIR, subdir)
        if not os.path.isdir(dirpath):
            continue
        for fname in sorted(os.listdir(dirpath)):
            if not fname.endswith('.md') or fname in SKIP_FILES:
                continue
            filepath = os.path.join(dirpath, fname)
            if process_file(filepath):
                changed.append(f'{subdir}/{fname}')
                print(f'  CHANGED: {subdir}/{fname}')
            else:
                print(f'  unchanged: {subdir}/{fname}')

    print(f'\n{len(changed)} files changed')
    for f in changed:
        print(f'  {f}')


if __name__ == '__main__':
    main()
