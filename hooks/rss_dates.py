"""
MkDocs hook to process dates from frontmatter for RSS feed generation
and template rendering.

This hook reads 'date' and 'date_modified' from frontmatter and populates:
- page.meta.datePublished (ISO string for JSON-LD in template)
- page.meta.dateModified (ISO string for JSON-LD in template)
- page.meta.date (datetime object for RSS plugin)
- page.meta.date_modified (datetime object for RSS plugin)
- page.meta.date_display (human-readable string for template)

Frontmatter format:
  date: 2025-01-15           # Published date (YYYY-MM-DD)
  date_modified: 2025-01-16  # Last modified date (optional, defaults to date)

To exclude a page from the RSS feed (e.g., work in progress), add to frontmatter:
  draft: true
"""
from datetime import datetime, date


def on_page_markdown(markdown: str, page, config, files):
    """Process dates from frontmatter and add formatted versions to page meta."""
    
    # Only process pages in projects or writings folders
    # Normalize path separators for cross-platform compatibility
    src_path = page.file.src_path.replace("\\", "/").lower()
    if not (src_path.startswith("projects/") or src_path.startswith("writings/")):
        return markdown
    
    # Initialize page.meta if needed
    if not hasattr(page, 'meta') or page.meta is None:
        page.meta = {}
    
    # Disable image enclosures for RSS to prevent length="None" errors
    # This prevents the RSS plugin from extracting images from content
    page.meta['image'] = ""
    
    # Check for draft flag - exclude from RSS feed but still process dates for display
    # The 'draft' key comes from YAML frontmatter
    is_draft = page.meta.get('draft', False)
    if is_draft:
        # Setting rss.exclude tells the RSS plugin to skip this page
        page.meta['rss'] = {'exclude': True}
        # Don't return early - still need to process dates for template display
    
    # Get dates from frontmatter
    # YAML parses YYYY-MM-DD as datetime.date objects automatically
    date_val = page.meta.get('date')
    date_mod_val = page.meta.get('date_modified')
    
    # Process published date
    if date_val:
        dt = _to_datetime(date_val)
        if dt:
            # Store datetime for RSS plugin
            page.meta['date'] = dt
            # Store ISO string for JSON-LD in template
            page.meta['datePublished'] = dt.strftime('%Y-%m-%dT00:00:00Z')
            # Store human-readable format for template display
            page.meta['date_display'] = dt.strftime("%b %Y")
    
    # Process modified date (defaults to published date if not specified)
    if date_mod_val:
        dt = _to_datetime(date_mod_val)
        if dt:
            page.meta['date_modified'] = dt
            page.meta['dateModified'] = dt.strftime('%Y-%m-%dT00:00:00Z')
    elif date_val:
        # If no modified date, use published date
        dt = _to_datetime(date_val)
        if dt:
            page.meta['date_modified'] = dt
            page.meta['dateModified'] = dt.strftime('%Y-%m-%dT00:00:00Z')
    
    return markdown


def _to_datetime(val):
    """Convert various date formats to datetime object."""
    if isinstance(val, datetime):
        return val
    elif isinstance(val, date):
        return datetime.combine(val, datetime.min.time())
    elif isinstance(val, str):
        # Try parsing ISO format string
        try:
            # Handle full ISO format with timezone
            if 'T' in val:
                return datetime.fromisoformat(val.replace('Z', '+00:00'))
            # Handle simple YYYY-MM-DD format
            return datetime.strptime(val, '%Y-%m-%d')
        except ValueError:
            pass
    return None
