"""
Convert bare markdown ![](path) images to HTML <figure> or <div class="figure-grid"> format.

Rules:
- Single standalone images → <figure><img src="path"></figure>
- 2 adjacent images → <div class="figure-grid grid-2x1">
- 3 adjacent images → <div class="figure-grid grid-3x1">
- 4+ adjacent images → grouped into pairs of grid-2x1
- {.marginnote} lines immediately after image(s) → moved ABOVE the figure/grid
- Images with {: align=...} attributes → left as-is (floating inline)
- Images inside admonitions (indented), code blocks, or existing figure/div blocks → left as-is
"""

import os
import re

DOCS_DIR = os.path.join(os.path.dirname(__file__), 'docs')

# Match bare markdown image: ![alt](path){optional attrs}
IMG_RE = re.compile(r'^!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?\s*$')
MARGINNOTE_RE = re.compile(r'^\{\.marginnote\}.*\{/\.marginnote\}\s*$')
ALIGN_RE = re.compile(r'\{:[^}]*align\s*=')
INSIDE_BLOCK_RE = re.compile(r'^(\s{4,}|\t|<figure|<div|<center)')


def parse_md_img(line):
    """Parse a markdown image line. Returns (alt, src, attrs_str) or None."""
    m = IMG_RE.match(line)
    if not m:
        return None
    alt = m.group(1)
    src = m.group(2)
    attrs = m.group(3) or ''
    return alt, src, attrs


def attrs_to_html(attrs_str, alt=''):
    """Convert markdown {width="80%" ...} to HTML attributes string."""
    parts = []
    if alt:
        parts.append(f'alt="{alt}"')

    # Extract width
    wm = re.search(r'width="([^"]+)"', attrs_str)
    if wm:
        parts.append(f'width="{wm.group(1)}"')

    # Extract height
    hm = re.search(r'height="([^"]+)"', attrs_str)
    if hm:
        parts.append(f'height="{hm.group(1)}"')

    return ' '.join(parts)


def img_tag(alt, src, attrs_str):
    """Build an <img> tag from parsed markdown image parts."""
    html_attrs = attrs_to_html(attrs_str, alt)
    if html_attrs:
        return f'<img src="{src}" {html_attrs}>'
    return f'<img src="{src}">'


def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    result = []
    i = 0
    changes = 0
    in_code_block = False
    in_admonition = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Track code blocks
        if stripped.startswith('```'):
            in_code_block = not in_code_block
            result.append(line)
            i += 1
            continue

        if in_code_block:
            result.append(line)
            i += 1
            continue

        # Skip indented lines (admonition content, list items)
        if line.startswith('    ') or line.startswith('\t'):
            result.append(line)
            i += 1
            continue

        # Check if this is a bare markdown image
        parsed = parse_md_img(stripped)
        if parsed is None:
            result.append(line)
            i += 1
            continue

        alt, src, attrs = parsed

        # Skip images with align attribute (floating inline)
        if ALIGN_RE.search(attrs):
            result.append(line)
            i += 1
            continue

        # Collect consecutive images
        images = [(alt, src, attrs)]
        j = i + 1
        while j < len(lines):
            next_stripped = lines[j].strip()
            next_parsed = parse_md_img(next_stripped)
            if next_parsed and not ALIGN_RE.search(next_parsed[2]):
                images.append(next_parsed)
                j += 1
            else:
                break

        # Check if there's a marginnote immediately after the image group
        marginnote_line = None
        k = j
        if k < len(lines) and MARGINNOTE_RE.match(lines[k].strip()):
            marginnote_line = lines[k].strip()
            k += 1

        # Build replacement
        replacement = []

        # Place marginnote ABOVE
        if marginnote_line:
            replacement.append(marginnote_line + '\n')
            replacement.append('\n')

        if len(images) == 1:
            a, s, at = images[0]
            tag = img_tag(a, s, at)
            replacement.append('<figure>\n')
            replacement.append(f'{tag}\n')
            replacement.append('</figure>\n')
        elif len(images) == 2:
            replacement.append('<div class="figure-grid grid-2x1">\n')
            for a, s, at in images:
                replacement.append(f'{img_tag(a, s, at)}\n')
            replacement.append('</div>\n')
        elif len(images) == 3:
            replacement.append('<div class="figure-grid grid-3x1">\n')
            for a, s, at in images:
                replacement.append(f'{img_tag(a, s, at)}\n')
            replacement.append('</div>\n')
        else:
            # Group into pairs
            for idx in range(0, len(images), 2):
                batch = images[idx:idx+2]
                if len(batch) == 2:
                    replacement.append('<div class="figure-grid grid-2x1">\n')
                else:
                    replacement.append('<figure>\n')
                for a, s, at in batch:
                    replacement.append(f'{img_tag(a, s, at)}\n')
                if len(batch) == 2:
                    replacement.append('</div>\n')
                else:
                    replacement.append('</figure>\n')
                if idx + 2 < len(images):
                    replacement.append('\n')

        result.extend(replacement)
        changes += len(images)
        i = k  # Skip past all consumed lines
        continue

    if changes > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.writelines(result)

    return changes


def main():
    total = 0
    target_files = [
        'projects/AssistiveAquaponics.md',
    ]

    for relpath in target_files:
        filepath = os.path.join(DOCS_DIR, relpath)
        if not os.path.isfile(filepath):
            print(f'  NOT FOUND: {relpath}')
            continue
        count = process_file(filepath)
        if count:
            print(f'  CONVERTED {count} images: {relpath}')
            total += count
        else:
            print(f'  unchanged: {relpath}')

    print(f'\nTotal images converted: {total}')


if __name__ == '__main__':
    main()
