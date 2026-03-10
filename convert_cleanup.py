"""
Cleanup pass: handle remaining figcaptions and fix footnote regex.

1. Convert ALL remaining <figcaption>text</figcaption> to {.marginnote} above parent block
2. Fix remaining [^N] footnotes (previous regex was too restrictive)
"""

import os
import re

DOCS_DIR = os.path.join(os.path.dirname(__file__), 'docs')
SKIP_FILES = {'example.md', 'ProjectPortfolioSite.md'}

FIGCAPTION_RE = re.compile(r'^\s*<figcaption>(.*?)</figcaption>\s*$')
OPEN_TAG_RE = re.compile(r'^\s*<(figure|center|div)[\s>]')


def convert_remaining_figcaptions(content):
    """Remove all <figcaption> and place as {.marginnote} above parent block."""
    lines = content.split('\n')

    # First pass: identify figcaption lines and their parent block starts
    figcaptions = []  # (line_index, caption_text, parent_open_index)

    for i, line in enumerate(lines):
        m = FIGCAPTION_RE.match(line)
        if m:
            caption = m.group(1).strip()
            # Walk backward to find the parent container's opening tag
            parent_idx = None
            depth = 0
            for j in range(i - 1, -1, -1):
                l = lines[j].strip()
                # Count closing tags
                for tag in ('figure', 'center', 'div'):
                    depth += l.count(f'</{tag}>')
                    if re.search(rf'<{tag}[\s>]', l):
                        depth -= 1
                        if depth < 0:
                            parent_idx = j
                            break
                if parent_idx is not None:
                    break

            figcaptions.append((i, caption, parent_idx))

    if not figcaptions:
        return content

    # Process in reverse order to maintain line indices
    for line_idx, caption, parent_idx in reversed(figcaptions):
        # Remove figcaption line
        lines[line_idx] = None  # Mark for removal

        # Insert marginnote before parent block
        if parent_idx is not None:
            # Insert before the parent opening tag
            lines.insert(parent_idx, '')
            lines.insert(parent_idx, '{.marginnote}' + caption + '{/.marginnote}')
        else:
            # Fallback: insert above figcaption position
            lines.insert(line_idx, '{.marginnote}' + caption + '{/.marginnote}')

    # Remove None lines (deleted figcaptions)
    lines = [l for l in lines if l is not None]

    return '\n'.join(lines)


def fix_remaining_footnotes(content):
    """Convert any remaining [^N] footnote references and definitions."""
    lines = content.split('\n')

    # Collect remaining definitions
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

    # Replace ALL remaining [^N] (no negative lookahead - definitions are already removed)
    def replace_fn(match):
        fn_id = match.group(1)
        if fn_id in defs:
            return '{.sidenote}' + defs[fn_id] + '{/.sidenote}'
        return match.group(0)

    content = re.sub(r'\[\^(\w+)\]', replace_fn, content)
    content = re.sub(r'\n{3,}$', '\n', content)

    return content


def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content

    content = fix_remaining_footnotes(content)
    content = convert_remaining_figcaptions(content)

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


if __name__ == '__main__':
    main()
