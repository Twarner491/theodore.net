"""Build responsive storefront photographs without changing the source originals."""
from functools import lru_cache
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageOps


WIDTHS = (480, 960, 1440)
QUALITY = 90
RECIPE = f'webp-v1-q{QUALITY}-widths{WIDTHS}-method4'.encode()


def image_inputs(products, docs_dir):
    """Original URLs and paths, including variant-only photos and DARK siblings."""
    docs = Path(docs_dir).resolve()
    found = {}
    for product in products:
        base = product.get('imageBase') or ''
        names = list(product.get('images') or [])
        names += [variant['image'] for variant in product.get('variants', [])
                  if isinstance(variant, dict) and variant.get('image')]
        for name in names:
            url = base + name
            parsed = urlsplit(url)
            if parsed.scheme or parsed.netloc or not parsed.path.startswith('/assets/images/'):
                continue
            path = (docs / parsed.path.lstrip('/')).resolve()
            if not path.is_relative_to(docs) or path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
                continue
            for candidate in (path, path.with_name(path.stem + 'DARK' + path.suffix)):
                if candidate.is_file():
                    found['/' + candidate.relative_to(docs).as_posix()] = candidate
    return dict(sorted(found.items()))


def source_inputs(docs_dir):
    """Source files included in the generated catalog's cache version."""
    import yaml
    products = []
    for path in sorted((Path(docs_dir) / 'store').glob('*.md')):
        text = path.read_text(encoding='utf-8')
        if not text.startswith('---\n'):
            continue
        frontmatter = yaml.safe_load(text.split('---', 2)[1]) or {}
        if isinstance(frontmatter, dict) and frontmatter.get('product'):
            products.append(frontmatter)
    return image_inputs(products, docs_dir).values()


@lru_cache(maxsize=64)
def derivatives(source):
    """Return deterministic bytes; cache repeated MkDocs/test passes in memory."""
    with Image.open(BytesIO(source)) as opened:
        image = ImageOps.exif_transpose(opened)
        if getattr(opened, 'is_animated', False):
            return None
        image = image.convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
        width, height = image.size
        targets = sorted(set(min(width, target) for target in WIDTHS))
        versions = []
        for target in targets:
            size = (target, max(1, round(height * target / width)))
            resized = image if size == image.size else image.resize(size, Image.Resampling.LANCZOS)
            encoded = BytesIO()
            resized.save(encoded, 'WEBP', quality=QUALITY, method=4, exact=True)
            data = encoded.getvalue()
            digest = sha256(RECIPE + data).hexdigest()[:16]
            versions.append({'url': f'/assets/images/store/{digest}-{target}.webp',
                             'width': target, 'height': size[1], 'data': data})
        # Lossy WebP can shift a uniform background by one RGB step. Store the
        # encoded color under the original URL so contained photos still blend
        # into their letterbox without changing project pages using the PNGs.
        with Image.open(BytesIO(versions[-1]['data'])) as encoded:
            rgb = encoded.convert('RGB')
            w, h = rgb.size
            points = [(min(1, w - 1), min(1, h - 1)), (max(0, w - 2), min(1, h - 1)),
                      (min(1, w - 1), max(0, h - 2)), (max(0, w - 2), max(0, h - 2))]
            colors = [rgb.getpixel(point) for point in points]
            background = '#%02x%02x%02x' % tuple(round(sum(color[channel] for color in colors) / 4) for channel in range(3))
        return {'width': width, 'height': height, 'background': background, 'sources': versions}


def build_image_sources(products, docs_dir):
    """Return original-keyed metadata and virtual output files, never source writes."""
    metadata, outputs = {}, {}
    for url, path in image_inputs(products, docs_dir).items():
        result = derivatives(path.read_bytes())
        if result is None:
            continue
        metadata[url] = {'width': result['width'], 'height': result['height'], 'background': result['background'], 'sources': []}
        for version in result['sources']:
            outputs[version['url'].lstrip('/')] = version['data']
            metadata[url]['sources'].append({key: version[key] for key in ('url', 'width', 'height')})
    return metadata, outputs
