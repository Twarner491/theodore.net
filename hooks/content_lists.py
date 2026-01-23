"""
MkDocs hook to auto-populate content lists from Projects and writings folders.
Replaces placeholder tokens with generated HTML based on file metadata.

Tokens:
  <!-- PROJECTS_GRID_6 --> - Projects grid for index.md (6 items)
  <!-- WRITINGS_LIST_3 --> - Writings list for index.md (3 items)
  <!-- PROJECTS_FULL_LIST --> - Full projects list for projects.md
  <!-- WRITINGS_FULL_LIST --> - Full writings list for writings.md
"""

import os
import re
import json
import yaml
from datetime import datetime, date
from pathlib import Path


# Cache for parsed content
_projects_cache = None
_writings_cache = None
_config_cache = None


def _get_config(docs_dir):
    """Load content configuration from YAML file."""
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    
    config_path = Path(docs_dir).parent / "hooks" / "content_config.yaml"
    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            _config_cache = yaml.safe_load(f)
    else:
        _config_cache = {"external_projects": [], "settings": {}}
    
    return _config_cache


def _parse_frontmatter(content):
    """Extract YAML frontmatter from markdown content."""
    if not content.startswith('---'):
        return {}, content
    
    # Find the closing ---
    end_match = re.search(r'\n---\s*\n', content[3:])
    if not end_match:
        return {}, content
    
    frontmatter_str = content[3:end_match.start() + 3]
    try:
        frontmatter = yaml.safe_load(frontmatter_str)
        remaining = content[end_match.end() + 3:]
        return frontmatter or {}, remaining
    except yaml.YAMLError:
        return {}, content


def _parse_json_ld(content):
    """Extract JSON-LD schema data from content."""
    pattern = r'<script type="application/ld\+json">\s*(\{[\s\S]*?\})\s*</script>'
    match = re.search(pattern, content)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    return {}


def _parse_date(date_str):
    """Parse ISO date string to datetime object (timezone-naive for consistency)."""
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        # Convert to naive datetime for consistent comparisons
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt
    except ValueError:
        return None


def _format_date(dt, fmt="%b %Y"):
    """Format datetime to display string (e.g., 'Dec 2025')."""
    if not dt:
        return ""
    return dt.strftime(fmt)


def _scan_folder(docs_dir, folder_name):
    """Scan a folder and extract metadata from all markdown files."""
    items = []
    folder_path = Path(docs_dir) / folder_name
    
    if not folder_path.exists():
        return items
    
    for md_file in folder_path.glob("*.md"):
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            frontmatter, _ = _parse_frontmatter(content)
            json_ld = _parse_json_ld(content)
            
            # Skip drafts
            if frontmatter.get('draft', False):
                continue
            
            # Extract metadata
            title = frontmatter.get('title') or json_ld.get('headline', '')
            description = frontmatter.get('description') or json_ld.get('description', '')
            
            # Get image from frontmatter or JSON-LD
            thumbnail = frontmatter.get('thumbnail', '')
            if not thumbnail and json_ld.get('image'):
                # Convert absolute URL to relative path
                img_url = json_ld.get('image', '')
                if img_url.startswith('https://theodore.net'):
                    thumbnail = img_url.replace('https://theodore.net', '')
            
            # Get date from frontmatter (YAML may parse as date object)
            date_val = frontmatter.get('date')
            item_date = None
            if date_val:
                if isinstance(date_val, datetime):
                    item_date = date_val
                elif isinstance(date_val, date) and not isinstance(date_val, datetime):
                    # YAML parses YYYY-MM-DD as datetime.date objects
                    item_date = datetime.combine(date_val, datetime.min.time())
                elif isinstance(date_val, str):
                    item_date = _parse_date(date_val + "T00:00:00Z")
            
            # Get readtime (for writings)
            readtime = frontmatter.get('readtime', '')
            
            # Build URL from file path
            file_stem = md_file.stem
            url = f"/{folder_name}/{file_stem}/"
            
            items.append({
                'title': title,
                'description': description,
                'thumbnail': thumbnail,
                'date': item_date,
                'date_str': _format_date(item_date),
                'readtime': readtime,
                'url': url,
                'external': False,
                'file': str(md_file)
            })
            
        except Exception as e:
            print(f"Warning: Could not parse {md_file}: {e}")
    
    return items


def _get_projects(docs_dir):
    """Get all projects, including external ones, sorted by date."""
    global _projects_cache
    if _projects_cache is not None:
        return _projects_cache
    
    # Scan local projects
    projects = _scan_folder(docs_dir, "projects")
    
    # Add external projects from config
    config = _get_config(docs_dir)
    for ext in config.get('external_projects', []):
        ext_date = None
        if ext.get('date'):
            if isinstance(ext['date'], str):
                ext_date = _parse_date(ext['date'] + "T00:00:00Z")
            elif isinstance(ext['date'], date):
                # YAML parses dates as date objects, convert to datetime
                ext_date = datetime.combine(ext['date'], datetime.min.time())
            elif isinstance(ext['date'], datetime):
                ext_date = ext['date']
        
        projects.append({
            'title': ext.get('title', ''),
            'description': ext.get('description', ''),
            'thumbnail': ext.get('thumbnail', ''),
            'date': ext_date,
            'date_str': _format_date(ext_date),
            'readtime': ext.get('readtime', ''),
            'url': ext.get('url', ''),
            'external': ext.get('external', True),
            'file': None
        })
    
    # Sort by date (newest first)
    projects.sort(key=lambda x: x['date'] or datetime.min, reverse=True)
    _projects_cache = projects
    return projects


def _get_writings(docs_dir):
    """Get all writings sorted by date."""
    global _writings_cache
    if _writings_cache is not None:
        return _writings_cache
    
    writings = _scan_folder(docs_dir, "writings")
    
    # Sort by date (newest first)
    writings.sort(key=lambda x: x['date'] or datetime.min, reverse=True)
    _writings_cache = writings
    return writings


def _generate_projects_grid(projects, count=6):
    """Generate HTML for projects grid (index.md style)."""
    html_parts = []
    
    for item in projects[:count]:
        target = ' target="_blank"' if item['external'] else ''
        html_parts.append(f'''          <a{target} href="{item['url']}"> <div class="grid-item">
              <p class="projtitle">{item['title']}</p>
              <p class="projdescription">{item['description']}</p>
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </div> </a>''')
    
    return '\n'.join(html_parts)


def _generate_writings_list(writings, count=None, include_mobileyear=True):
    """Generate HTML for writings list (index.md and writ.md style)."""
    html_parts = []
    items = writings[:count] if count else writings
    
    for i, item in enumerate(items):
        mobileyear_start = '<span class="mobileyear">\n              ' if include_mobileyear else ''
        mobileyear_end = '\n              <span>' if include_mobileyear else ''
        
        html_parts.append(f'''        <div class="writparent">
          <a href="{item['url']}">
            <div class="title-row">
              <p class="projtitle">{item['title']}</p>
              <p class="writeyear">{item['date_str']}</p>
            </div>
            <div class="description-row">
              <p class="projdescription">{item['description']}</p>
              {mobileyear_start}<p class="readtime">{item['readtime']}</p>{mobileyear_end}
            </div>
          </a>
        </div>''')
        
        # Add hr between items (not after last)
        if i < len(items) - 1:
            html_parts.append('        <hr>')
    
    return '\n'.join(html_parts)


def _generate_projects_full_list(projects):
    """Generate HTML for full projects list (proj.md style with thumbnails)."""
    html_parts = []
    
    for item in projects:
        target = ' target="_blank"' if item['external'] else ''
        thumbnail = item['thumbnail'] or '/assets/images/thumb.png'
        # Make thumbnail path relative if needed
        if thumbnail.startswith('/'):
            thumbnail = '..' + thumbnail
        
        html_parts.append(f'''        <div class="writparent">
          <a{target} href="{item['url']}">
            <div class="imgparent"><img class="writeimg" src="{thumbnail}" alt="{item['title']} project hero image"></div>
            <div class="textcontent">
              <p class="projtitle">{item['title']}</p>
              <p class="projdescription">{item['description']}</p>
            </div>
          </a>
        </div>''')
    
    return '\n'.join(html_parts)


def on_page_markdown(markdown: str, page, config, files):
    """Replace content tokens with generated HTML."""
    src_path = page.file.src_path
    
    # Replace copyright year with current year (for all pages)
    current_year = datetime.now().strftime('%Y')
    # Use regex to match copyright year pattern - match any chars between Copyright and the year
    markdown = re.sub(r'(Copyright\s*.{0,10}?)20\d{2}', rf'\g<1>{current_year}', markdown)
    markdown = markdown.replace('<!-- COPYRIGHT_YEAR -->', current_year)
    
    # Only process content list tokens for specific pages
    if src_path not in ['index.md', 'projects.md', 'writings.md', 'books.md']:
        return markdown
    
    docs_dir = config['docs_dir']
    
    # Get settings from config
    content_config = _get_config(docs_dir)
    settings = content_config.get('settings', {})
    index_projects_count = settings.get('index_projects_count', 6)
    index_writings_count = settings.get('index_writings_count', 3)
    
    # Replace tokens based on page
    if src_path == 'index.md':
        # Projects grid
        if '<!-- PROJECTS_GRID_6 -->' in markdown:
            projects = _get_projects(docs_dir)
            grid_html = _generate_projects_grid(projects, index_projects_count)
            markdown = markdown.replace('<!-- PROJECTS_GRID_6 -->', grid_html)
        
        # Writings list
        if '<!-- WRITINGS_LIST_3 -->' in markdown:
            writings = _get_writings(docs_dir)
            list_html = _generate_writings_list(writings, index_writings_count)
            markdown = markdown.replace('<!-- WRITINGS_LIST_3 -->', list_html)
    
    elif src_path == 'projects.md':
        if '<!-- PROJECTS_FULL_LIST -->' in markdown:
            projects = _get_projects(docs_dir)
            list_html = _generate_projects_full_list(projects)
            markdown = markdown.replace('<!-- PROJECTS_FULL_LIST -->', list_html)
    
    elif src_path == 'writings.md':
        if '<!-- WRITINGS_FULL_LIST -->' in markdown:
            writings = _get_writings(docs_dir)
            list_html = _generate_writings_list(writings, include_mobileyear=False)
            markdown = markdown.replace('<!-- WRITINGS_FULL_LIST -->', list_html)
    
    return markdown


def on_env(env, config, files):
    """Clear caches at the start of each build and add template globals."""
    global _projects_cache, _writings_cache, _config_cache
    _projects_cache = None
    _writings_cache = None
    _config_cache = None
    
    # Add 'now' function to Jinja2 environment for templates
    env.globals['now'] = datetime.now
    env.globals['current_year'] = datetime.now().strftime('%Y')
    
    return env
