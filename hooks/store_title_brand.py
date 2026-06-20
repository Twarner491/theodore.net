"""
MkDocs hook: dim the brand mark in the store landing title.

The store landing title reads "theodore.net Store". Wrap the lowercase brand mark in a span so
it can be dimmed to read as branding beside the capitalised "Store" (see ".introabt h2 .brand"
in extra.css). Done at build time, not in JS, so it never flashes on load, and without editing
docs/store/index.md, which the store agent owns.
"""


def on_page_markdown(markdown, page, config, files):
    if page.file.src_uri == "store/index.md":
        markdown = markdown.replace(
            "<h2>theodore.net Store</h2>",
            '<h2><span class="brand">theodore.net</span> Store</h2>',
            1,
        )
    return markdown
