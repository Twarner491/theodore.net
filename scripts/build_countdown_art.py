"""Pre-render the email countdown art into lib/countdown-art.js.

functions/api/countdown.js serves an animated GIF of a drop's countdown that matches the
.pe-countdown field on the product page (store.css): the same outline, digits, unit labels and
"Notify me" pill, drawn with the site's own JetBrains Mono file at the weight the site renders
(the self-hosted variable font bottoms out at 400, so the CSS 300 renders as 400). A Worker has no
canvas, so the typography and anti-aliasing happen here, once: two backgrounds (counting down /
open) with the digit slots left blank, and one tile per digit. The Function only copies tiles
and encodes frames. Re-run after changing the field's look in store.css:

    /Users/twarn/.local/pipx/venvs/mkdocs/bin/python scripts/build_countdown_art.py

Geometry is the light-theme desktop field at 2x: store.css sizes are em-relative to the 16px
product column (.pe-countdown is 0.86em = 13.76px).
"""

import base64
import json
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / 'docs/assets/fonts/jetbrains-mono/jetbrains-mono-regular.woff2'
OUT = ROOT / 'lib/countdown-art.js'

S = 2                          # output scale (retina)
SS = 4                         # supersampling for the shapes
W, H = 520, 52                 # CSS px; the email shows it at this size
BASE = 13.76                   # .pe-countdown font-size
DIGIT_PX = BASE * 1.4          # .pe-cd-time
LABEL_PX = DIGIT_PX * 0.56     # .pe-cd-label
PILL_PX = BASE * 0.92          # .pe-cd-notify
PAD_L = BASE * 1.3             # .pe-countdown padding-left
UNIT_GAP = DIGIT_PX * 0.9      # .pe-cd-time gap
LABEL_ML = DIGIT_PX * 0.16     # .pe-cd-label margin-left
PILL_H, PILL_INSET, PILL_R = 42, 4, 12   # .pe-cd-notify height, the field's right padding, radius
PILL_PAD = PILL_PX * 1.2       # padding: 0 1.2em
BORDER, FIELD_R = 1.2, 16

# light theme: --md-default-fg-color is black at 0.87 on white; opacities from store.css
def gray(alpha):
    return round(255 * (1 - alpha))

FG = 0.87
C_LINE = gray(0.32)            # --md-default-fg-color--lighter
C_DIGIT = gray(FG * 0.88)      # .pe-cd-num
C_LABEL = gray(FG * 0.40)      # .pe-cd-label
C_PILL = gray(FG)              # .pe-cd-notify background
C_PILL_TEXT = 255


def font(px, weight=400):
    f = ImageFont.truetype(str(FONT), px * S)
    if weight != 400:
        f.set_variation_by_axes([weight])
    return f


def shapes(pill_w):
    """Field outline + pill, supersampled then reduced so the curves are anti-aliased."""
    k = S * SS
    img = Image.new('L', (W * k, H * k), 255)
    d = ImageDraw.Draw(img)
    b = BORDER * k
    d.rounded_rectangle([0, 0, W * k - 1, H * k - 1], radius=FIELD_R * k, fill=C_LINE)
    d.rounded_rectangle([b, b, W * k - 1 - b, H * k - 1 - b], radius=(FIELD_R - BORDER) * k, fill=255)
    x1 = (W - BORDER - PILL_INSET) * k
    x0 = x1 - pill_w * k
    y0 = (H - PILL_H) / 2 * k
    d.rounded_rectangle([x0, y0, x1, y0 + PILL_H * k], radius=PILL_R * k, fill=C_PILL)
    return img.resize((W * S, H * S), Image.LANCZOS), (x0 / k, y0 / k)


def spaced_width(f, text, spacing):
    return sum(f.getlength(ch) + spacing for ch in text)


def draw_spaced(d, xy, text, f, fill, spacing):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill, anchor='lm')
        x += f.getlength(ch) + spacing


def layout():
    fd = font(DIGIT_PX)
    adv = fd.getlength('0') / S                       # monospace advance, CSS px
    fl = font(LABEL_PX)
    # .pe-cd-time is a 1.3 line box centred in the field; the baseline sits ascent + half-leading down
    asc, desc = fd.getmetrics()
    line = DIGIT_PX * 1.3
    top = (H - line) / 2
    baseline = top + (line - (asc + desc) / S) / 2 + asc / S
    cells, labels, x = [], [], PAD_L
    for unit in 'dhms':
        cells += [x, x + adv]
        x += 2 * adv + LABEL_ML
        labels.append((unit, x))
        x += fl.getlength(unit) / S + UNIT_GAP
    return fd, fl, adv, baseline, cells, labels


def render():
    fd, fl, adv, baseline, cells, labels = layout()
    fp = font(PILL_PX, 500)
    spacing = 0.04 * PILL_PX * S
    texts = {'countdown': 'Notify me', 'open': 'Order now'}
    pill_w = max(spaced_width(fp, t, spacing) for t in texts.values()) / S + 2 * PILL_PAD

    # one digit tile: snapped to whole output pixels; every tile shares the same box
    by = round(baseline * S)
    ink = [fd.getbbox(str(n), anchor='ls') for n in range(10)]
    tile_top = by + min(b[1] for b in ink) - 2
    tile_h = (by + max(b[3] for b in ink) + 2) - tile_top
    tile_w = int(adv * S)
    assert all(b[0] >= 0 and b[2] <= tile_w for b in ink), 'digit ink overflows its tile'
    tiles = []
    for n in range(10):
        t = Image.new('L', (tile_w, tile_h), 255)
        ImageDraw.Draw(t).text((0, by - tile_top), str(n), font=fd, fill=C_DIGIT, anchor='ls')
        tiles.append(t)
    cell_xy = [[round(cx * S), tile_top] for cx in cells]

    backgrounds = {}
    for key, text in texts.items():
        img, (px0, py0) = shapes(pill_w)
        d = ImageDraw.Draw(img)
        for unit, lx in labels:
            d.text((lx * S, by), unit, font=fl, fill=C_LABEL, anchor='ls')
        tw = spaced_width(fp, text, spacing) - spacing
        draw_spaced(d, (px0 * S + (pill_w * S - tw) / 2, (py0 + PILL_H / 2) * S), text, fp, C_PILL_TEXT, spacing)
        backgrounds[key] = img
    return backgrounds, tiles, cell_xy, tile_w, tile_h


def pack(img):
    return base64.b64encode(zlib.compress(img.tobytes(), 9)).decode()


def main():
    backgrounds, tiles, cells, tile_w, tile_h = render()
    art = {
        'width': W * S, 'height': H * S,
        'tileWidth': tile_w, 'tileHeight': tile_h,
        'cells': cells,
        'countdown': pack(backgrounds['countdown']),
        'open': pack(backgrounds['open']),
        'digits': [pack(t) for t in tiles],
    }
    OUT.write_text(
        '// Generated by scripts/build_countdown_art.py. Do not edit by hand.\n'
        '// 8-bit grayscale bitmaps (zlib + base64) for the email countdown GIF.\n'
        'export default ' + json.dumps(art, separators=(',', ':')) + ';\n', encoding='utf-8')
    print('wrote', OUT.relative_to(ROOT), OUT.stat().st_size, 'bytes')
    if len(sys.argv) > 1:   # optional: save a sample frame (digits 03 14 15 92) to eyeball
        preview = backgrounds['countdown'].copy()
        for (x, y), n in zip(cells, [0, 3, 1, 4, 1, 5, 9, 2]):
            preview.paste(tiles[n], (x, y))
        preview.save(sys.argv[1])


if __name__ == '__main__':
    main()
