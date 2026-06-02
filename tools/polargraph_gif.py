#!/usr/bin/env python3
"""Render the polargraph header diagram as a looping GIF.

Reproduces the inline-SVG animation from docs/projects/Polargraph.md (same
geometry, waypoints and easeInOutCubic motion) and overlays a subtle *bipolar*
coordinate grid so the polar nature of the machine reads at a glance: each motor
is a pole, and the pen's position is the intersection of two belt lengths
(L1, L2) rather than a cartesian (x, y).

Usage:
    python3 polargraph_gif.py preview [frame]   # render one PNG to inspect
    python3 polargraph_gif.py                    # render all frames + assemble gif
"""
import math
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont, ImageChops

# --- output -----------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_GIF = os.path.join(REPO, "docs/assets/images/Polargraph/polargraph-bipolar.gif")
FRAME_DIR = "/tmp/pg_frames"
PREVIEW_PNG = "/tmp/pg_preview.png"

# --- canvas / timing --------------------------------------------------------
W = 1000                    # logical canvas width == original SVG viewBox
OY = 40                     # machine pushed down this far, freeing a caption band
H = 740                     # canvas height (room for the offset + counterweights)
S = 3                       # supersample factor (rendered then LANCZOS-downscaled)
FPS = 25
FRAMES_PER_SEG = 22         # frames between consecutive waypoints

# --- palette (monochrome) ---------------------------------------------------
INK       = (24, 24, 28)            # near black; hierarchy is by opacity alone
WHITE     = (255, 255, 255)
def rgba(c, a): return (c[0], c[1], c[2], a)

# --- machine geometry (logical units) ---------------------------------------
LM = (100, 120)            # left motor  (a pole)
RM = (900, 120)            # right motor (a pole)
FRAME_BOX = (100, 120, 900, 620)   # drawing area / workplane
TOTAL_BELT = 800           # constant used for counterweight travel (from JS)

WAYPOINTS = [(300, 350), (500, 250), (700, 350),
             (700, 500), (300, 500), (400, 400)]

# ----------------------------------------------------------------------------
def sx(v): return int(round(v * S))
def P(p):  return (p[0] * S, (p[1] + OY) * S)     # machine space, vertically offset
def PT(x, y): return (x * S, (y + OY) * S)        # machine-space text anchor
def lw(v): return max(1, int(round(v * S)))

def ease_in_out_cubic(t):
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2

def lerp(a, b, t): return a + (b - a) * t

def gondola_at(seg, local_t):
    cur = WAYPOINTS[seg]
    nxt = WAYPOINTS[(seg + 1) % len(WAYPOINTS)]
    e = ease_in_out_cubic(local_t)
    return lerp(cur[0], nxt[0], e), lerp(cur[1], nxt[1], e)

def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])

# --- fonts ------------------------------------------------------------------
def load_font(size):
    for path in ("/System/Library/Fonts/Supplemental/Palatino.ttc",
                 "/System/Library/Fonts/Supplemental/Georgia.ttf",
                 "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
                 "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

F_TITLE = load_font(int(21 * S))
F_BODY  = load_font(int(18 * S))
F_LABEL = load_font(int(19 * S))
F_SUB   = load_font(int(12 * S))   # subscript digits
F_TINY  = load_font(int(13 * S))

# ----------------------------------------------------------------------------
def arc_through(d, center, point, half_deg, fill, width):
    """Short arc segment of the circle centred on `center` passing through `point`."""
    r = dist(center, point)
    base = math.degrees(math.atan2(point[1] - center[1], point[0] - center[0]))
    cx, cy = P(center)
    rr = r * S
    bbox = [cx - rr, cy - rr, cx + rr, cy + rr]
    d.arc(bbox, base - half_deg, base + half_deg, fill=fill, width=width)

def label_L(d, x, y, n, color):
    """Draw 'L' with a subscript digit, font-independent."""
    px, py = PT(x, y)
    d.text((px, py), "L", font=F_LABEL, fill=color)
    w = d.textlength("L", font=F_LABEL)
    d.text((px + w, py + int(8 * S)), str(n), font=F_SUB, fill=color)

# --- static layers ----------------------------------------------------------
def build_base():
    """White bg + faint bipolar mesh (clipped to workplane) + frame + bar +
    motors + caption. Everything that does not move between frames."""
    size = (W * S, H * S)
    base = Image.new("RGB", size, WHITE)

    # --- faint bipolar arc-mesh, clipped to the drawing area -----------------
    mesh = Image.new("RGBA", size, (0, 0, 0, 0))
    md = ImageDraw.Draw(mesh)
    for pole in (LM, RM):
        cx, cy = P(pole)
        for r in range(70, 1200, 70):
            rr = r * S
            md.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                       outline=rgba(INK, 34), width=lw(1))
    clip = Image.new("L", size, 0)
    ImageDraw.Draw(clip).rectangle([P((FRAME_BOX[0], FRAME_BOX[1])),
                                    P((FRAME_BOX[2], FRAME_BOX[3]))], fill=255)
    r_, g_, b_, a_ = mesh.split()
    mesh.putalpha(ImageChops.multiply(a_, clip))
    base = Image.alpha_composite(base.convert("RGBA"), mesh).convert("RGB")

    d = ImageDraw.Draw(base, "RGBA")

    # --- workplane frame + top bar ------------------------------------------
    d.rectangle([P((FRAME_BOX[0], FRAME_BOX[1])), P((FRAME_BOX[2], FRAME_BOX[3]))],
                outline=rgba(INK, 110), width=lw(1.5))
    d.line([P(LM), P(RM)], fill=rgba(INK, 255), width=lw(1.5))

    # --- motors (poles) ------------------------------------------------------
    for m in (LM, RM):
        cx, cy = P(m)
        for r in (22, 15):
            rr = r * S
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                      outline=rgba(INK, 255), width=lw(1.5))
        rr = 8 * S
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=rgba(INK, 255))
        # "pole" tag
        d.text((cx - int(13 * S), cy + int(26 * S)), "pole",
               font=F_TINY, fill=rgba(INK, 150))

    # --- caption (top margin) ------------------------------------------------
    d.text((sx(100), sx(20)), "BIPOLAR  POSITIONING",
           font=F_TITLE, fill=rgba(INK, 230))
    d.text((sx(100), sx(52)),
           "The pen is located by two belt lengths, L₁ and L₂, not by x and y.",
           font=F_BODY, fill=rgba(INK, 165))
    d.text((sx(100), sx(76)),
           "Each motor is a pole; turning one sweeps the pen along an arc about the other.",
           font=F_BODY, fill=rgba(INK, 165))

    return base

# --- per-frame dynamic drawing ----------------------------------------------
def draw_frame(base, gx, gy):
    img = base.copy()
    d = ImageDraw.Draw(img, "RGBA")

    g = (gx, gy)
    la = (gx - 22, gy - 15)     # left  belt attachment
    ra = (gx + 22, gy - 15)     # right belt attachment

    # belt lengths -> counterweight travel (identical to the JS)
    lbl = dist(la, LM)
    rbl = dist(ra, RM)
    lcy = 120 + (TOTAL_BELT - lbl)
    rcy = 120 + (TOTAL_BELT - rbl)

    # counterweight guide lines + weights
    d.line([P((80, 120)), P((80, lcy))], fill=rgba(INK, 95), width=lw(1))
    d.line([P((920, 120)), P((920, rcy))], fill=rgba(INK, 95), width=lw(1))
    d.rounded_rectangle([P((73, lcy)), P((87, lcy + 26))], radius=2 * S,
                        fill=WHITE, outline=rgba(INK, 255), width=lw(1))
    d.rounded_rectangle([P((913, rcy)), P((927, rcy + 26))], radius=2 * S,
                        fill=WHITE, outline=rgba(INK, 255), width=lw(1))

    # belts
    d.line([P(LM), P(la)], fill=rgba(INK, 130), width=lw(1))
    d.line([P(RM), P(ra)], fill=rgba(INK, 130), width=lw(1))

    # --- overlay: tangent arcs (motion when one motor turns) -----------------
    # turning the LEFT motor moves the pen along an arc about the RIGHT motor,
    # and vice-versa: short segments through the pen show the local "axes".
    arc_through(d, RM, g, 15, rgba(INK, 125), lw(2))
    arc_through(d, LM, g, 15, rgba(INK, 125), lw(2))

    # --- gondola (drawn last so belts tuck under it) -------------------------
    gd = ImageDraw.Draw(img, "RGBA")
    def tp(dx, dy): return (gx + dx, gy + dy)
    gd.rounded_rectangle([P(tp(-28, -20)), P(tp(28, 20))], radius=4 * S,
                         fill=WHITE, outline=rgba(INK, 255), width=lw(1.5))
    for ax in (-22, 22):
        cx, cy = P(tp(ax, -15))
        rr = 3 * S
        gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=rgba(INK, 255))
    gd.rounded_rectangle([P(tp(-8, 20)), P(tp(8, 55))], radius=2 * S,
                         fill=WHITE, outline=rgba(INK, 255), width=lw(1.2))
    gd.polygon([P(tp(-6, 55)), P(tp(0, 63)), P(tp(6, 55))], fill=rgba(INK, 255))

    # --- L1 / L2 labels at belt midpoints, nudged off the line ---------------
    def midlabel(motor, n):
        mx, my = (motor[0] + gx) / 2, (motor[1] + gy) / 2
        nudge = -40 if motor is LM else 22
        label_L(gd, mx + nudge, my - 30, n, rgba(INK, 215))
    midlabel(LM, 1)
    midlabel(RM, 2)

    return img.resize((W, H), Image.LANCZOS)

# ----------------------------------------------------------------------------
def render_all():
    os.makedirs(FRAME_DIR, exist_ok=True)
    for f in os.listdir(FRAME_DIR):
        os.remove(os.path.join(FRAME_DIR, f))
    base = build_base()
    idx = 0
    for seg in range(len(WAYPOINTS)):
        for i in range(FRAMES_PER_SEG):
            gx, gy = gondola_at(seg, i / FRAMES_PER_SEG)
            draw_frame(base, gx, gy).save(
                os.path.join(FRAME_DIR, f"f_{idx:04d}.png"))
            idx += 1
    print(f"rendered {idx} frames -> {FRAME_DIR}")
    assemble_gif(idx)

def assemble_gif(n):
    palette = "/tmp/pg_palette.png"
    subprocess.run(
        ["ffmpeg", "-y", "-framerate", str(FPS), "-i", f"{FRAME_DIR}/f_%04d.png",
         "-vf", "palettegen=max_colors=128:stats_mode=full", palette],
        check=True, capture_output=True)
    subprocess.run(
        ["ffmpeg", "-y", "-framerate", str(FPS), "-i", f"{FRAME_DIR}/f_%04d.png",
         "-i", palette, "-lavfi", "paletteuse=dither=none", "-loop", "0", OUT_GIF],
        check=True, capture_output=True)
    sz = os.path.getsize(OUT_GIF) / 1024
    print(f"gif -> {OUT_GIF}  ({sz:.0f} KB, {n} frames @ {FPS}fps)")

def render_preview(frame):
    base = build_base()
    total = len(WAYPOINTS) * FRAMES_PER_SEG
    frame %= total
    seg, i = divmod(frame, FRAMES_PER_SEG)
    gx, gy = gondola_at(seg, i / FRAMES_PER_SEG)
    draw_frame(base, gx, gy).save(PREVIEW_PNG)
    print(f"preview frame {frame} (gondola {gx:.0f},{gy:.0f}) -> {PREVIEW_PNG}")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "preview":
        render_preview(int(sys.argv[2]) if len(sys.argv) > 2 else 40)
    else:
        render_all()
