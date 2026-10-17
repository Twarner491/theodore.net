#!/usr/bin/env python3
"""Build fidelity-first Avian Visitors store photos from the original photographs.

The generated-image passes are deliberately used only as visual references.  This
renderer takes every product pixel from the supplied photographs, rectifies the
camera geometry, removes the room/table, and composites the same subject pixels
over the store's light and dark backgrounds.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from scipy.spatial import ConvexHull


LIGHT_BG = np.array([251, 251, 251], dtype=np.float32)
DARK_BG = np.array([45, 46, 50], dtype=np.float32)
CANVAS = (1151, 1367)
SIDE_SCALE = 1.16
SIDE_CENTER = (575.5, 691.0)


@dataclass(frozen=True)
class View:
    name: str
    source_quad: tuple[tuple[float, float], ...]
    destination_quad: tuple[tuple[float, float], ...]
    roi: tuple[int, int, int, int]
    warm_red_green: float
    warm_red_blue: float
    close_iterations: int = 3


VIEWS = {
    "Top": View(
        "Top",
        ((407, 509), (1509, 517), (1510, 1911), (381, 1897)),
        ((197, 208), (954, 208), (954, 1158), (197, 1158)),
        (330, 460, 1570, 1970),
        16,
        28,
        3,
    ),
    "Back": View(
        "Back",
        ((470, 626), (1400, 611), (1416, 1823), (453, 1810)),
        ((197, 208), (954, 208), (954, 1158), (197, 1158)),
        (400, 540, 1520, 1880),
        14,
        28,
        4,
    ),
    "Side": View(
        "Side",
        ((485, 1235), (3037, 1286), (3037, 1510), (485, 1440)),
        ((197, 682), (954, 682), (954, 744), (197, 744)),
        (420, 1020, 3110, 1540),
        14,
        28,
        4,
    ),
}


def perspective_coefficients(
    destination: tuple[tuple[float, float], ...],
    source: tuple[tuple[float, float], ...],
) -> tuple[float, ...]:
    """Return Pillow perspective coefficients mapping destination to source."""
    rows: list[list[float]] = []
    values: list[float] = []
    for (xd, yd), (xs, ys) in zip(destination, source):
        rows.append([xd, yd, 1, 0, 0, 0, -xs * xd, -xs * yd])
        values.append(xs)
        rows.append([0, 0, 0, xd, yd, 1, -ys * xd, -ys * yd])
        values.append(ys)
    return tuple(np.linalg.solve(np.asarray(rows), np.asarray(values)).tolist())


def largest_component(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if not count:
        raise RuntimeError("No foreground component found")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == int(np.argmax(sizes))


def source_mask(rgb: np.ndarray, view: View) -> np.ndarray:
    """Find the warm wooden enclosure, then fill its enclosed face."""
    height, width = rgb.shape[:2]
    x0, y0, x1, y1 = view.roi
    roi = np.zeros((height, width), dtype=bool)
    roi[y0:y1, x0:x1] = True

    work = rgb.astype(np.int16)
    red, green, blue = work[..., 0], work[..., 1], work[..., 2]
    warm = (
        (red - green >= view.warm_red_green)
        & (red - blue >= view.warm_red_blue)
        & (green >= blue - 3)
        & (red > 55)
        & roi
    )
    warm = ndimage.binary_opening(warm, iterations=1)
    warm = ndimage.binary_closing(warm, iterations=view.close_iterations)
    if view.name == "Side":
        labels, count = ndimage.label(warm)
        sizes = np.bincount(labels.ravel())
        threshold = max(250, int(sizes[1:].max() * 0.025)) if count else 250
        warm = np.isin(labels, np.flatnonzero(sizes >= threshold)) & (labels != 0)
        warm = ndimage.binary_closing(warm, iterations=10)
    warm = largest_component(warm)
    warm = ndimage.binary_closing(warm, iterations=5)
    solid = ndimage.binary_fill_holes(warm)

    # Do not dilate into the photographed cast shadow; the output compositor
    # reconstructs a clean one-pixel antialias from the source-owned interior.
    return solid


def warp(image: Image.Image, view: View, *, mask: bool = False) -> Image.Image:
    coefficients = perspective_coefficients(view.destination_quad, view.source_quad)
    return image.transform(
        CANVAS,
        Image.Transform.PERSPECTIVE,
        coefficients,
        resample=Image.Resampling.BILINEAR if mask else Image.Resampling.BICUBIC,
        fillcolor=0 if mask else (0, 0, 0),
    )


def shifted_top_view() -> View:
    """Align the photographed enclosure, rather than its old geometric mask."""
    view = VIEWS["Top"]
    return View(
        view.name,
        view.source_quad,
        tuple((x + 5, y) for x, y in view.destination_quad),
        view.roi,
        view.warm_red_green,
        view.warm_red_blue,
        view.close_iterations,
    )


def presentation_side_view() -> View:
    """Enlarge the physical side profile without changing its orientation."""
    view = VIEWS["Side"]
    center_x, center_y = SIDE_CENTER
    destination = tuple(
        (
            center_x + (x - center_x) * SIDE_SCALE,
            center_y + (y - center_y) * SIDE_SCALE,
        )
        for x, y in view.destination_quad
    )
    return View(
        view.name,
        view.source_quad,
        destination,
        view.roi,
        view.warm_red_green,
        view.warm_red_blue,
        view.close_iterations,
    )


def scaled_side_box(
    box: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    """Scale a proven-safe baseline side box with the photographed product."""
    center_x, center_y = SIDE_CENTER
    x0, y0, x1, y1 = box
    return (
        int(np.floor(center_x + (x0 - center_x) * SIDE_SCALE)),
        int(np.floor(center_y + (y0 - center_y) * SIDE_SCALE)),
        int(np.ceil(center_x + (x1 - center_x) * SIDE_SCALE)),
        int(np.ceil(center_y + (y1 - center_y) * SIDE_SCALE)),
    )


def physical_side_silhouette(warped_mask: np.ndarray) -> np.ndarray:
    """Close the real convex outline so both photographed endcaps stay clean."""
    support_image = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(support_image).rectangle(
        scaled_side_box((190, 610, 961, 742)), fill=255
    )
    semantic = (warped_mask >= 128) & (np.asarray(support_image) > 0)

    # These are known-opaque regions of the face/endcaps. Scaling the boxes
    # with the source rectification removes threshold holes without inventing
    # any product RGB.
    for box in (
        (220, 682, 931, 743),
        (198, 680, 221, 701),
        (930, 680, 951, 701),
    ):
        x0, y0, x1, y1 = scaled_side_box(box)
        semantic[y0:y1, x0:x1] = True

    semantic = (
        ndimage.gaussian_filter(
            semantic.astype(np.float32), 0.85 * SIDE_SCALE
        )
        >= 0.5
    )
    semantic = ndimage.binary_closing(semantic, iterations=1)
    semantic = largest_component(ndimage.binary_fill_holes(semantic))

    y_coordinates, x_coordinates = np.nonzero(semantic)
    points = np.column_stack((x_coordinates, y_coordinates))
    hull = ConvexHull(points)
    polygon = [tuple(map(int, points[index])) for index in hull.vertices]
    hull_image = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(hull_image).polygon(polygon, fill=255)
    semantic = np.asarray(hull_image) > 0

    # Stay one output pixel inside the photographed tabletop, then reconstruct
    # a single source-owned antialias ring via source_owned_subject().
    semantic = ndimage.binary_erosion(semantic, iterations=1)
    semantic = ndimage.binary_closing(semantic, iterations=1)
    return largest_component(ndimage.binary_fill_holes(semantic))


def physical_top_silhouette(warped_rgb: np.ndarray) -> np.ndarray:
    """Recover the photographed oak contour without convex-hull corner cuts.

    The warm-oak component already traces all four physical outer edges. Fill
    its enclosed face directly, smooth only single-pixel threshold noise, then
    add one antialias support ring. Unlike a convex hull, this preserves the
    source corner arcs and never spans pale tabletop pixels outside them.
    """
    work = warped_rgb.astype(np.int16)
    red, green, blue = work[..., 0], work[..., 1], work[..., 2]

    bounds_image = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(bounds_image).rounded_rectangle(
        (195, 200, 965, 1165), radius=42, fill=255
    )
    bounds = np.asarray(bounds_image) > 0
    oak = (
        (red - green >= 24)
        & (red - blue >= 46)
        & (red < 230)
        & bounds
    )
    oak = ndimage.binary_opening(oak, iterations=1)
    oak = ndimage.binary_closing(oak, iterations=3)
    oak = largest_component(oak)
    oak = ndimage.binary_closing(oak, iterations=3)

    semantic = ndimage.binary_fill_holes(oak)
    semantic = ndimage.gaussian_filter(
        semantic.astype(np.float32), sigma=3.0
    ) >= 0.5
    semantic = ndimage.binary_closing(
        semantic, structure=np.ones((3, 3), dtype=bool)
    )
    semantic = largest_component(semantic)
    return ndimage.binary_fill_holes(semantic)


def source_owned_subject(
    warped_rgb: np.ndarray, semantic: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Use exact source interiors and subpixel, source-owned edge coverage."""
    inside_distance = ndimage.distance_transform_edt(semantic)
    core = inside_distance >= 2.0
    coverage = ndimage.gaussian_filter(
        semantic.astype(np.float32), sigma=0.65
    )
    alpha = np.clip((coverage - 0.08) / 0.84, 0.0, 1.0)
    alpha[core] = 1.0
    support = alpha > 0.0
    edge = support & ~core
    _, foreground_indices = ndimage.distance_transform_edt(
        ~core, return_indices=True
    )

    subject = warped_rgb.astype(np.float32)
    nearest_foreground = warped_rgb[tuple(foreground_indices)].astype(np.float32)
    subject[edge] = nearest_foreground[edge]
    subject[~support] = 0
    return np.rint(subject).astype(np.uint8), alpha


def source_owned_subject_one_pixel(
    warped_rgb: np.ndarray, semantic: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Use exact source interiors and the proven single-pixel side edge."""
    inside_distance = ndimage.distance_transform_edt(semantic)
    core = inside_distance >= 2.0
    edge = semantic & ~core
    _, foreground_indices = ndimage.distance_transform_edt(
        ~core, return_indices=True
    )

    subject = warped_rgb.astype(np.float32)
    nearest_foreground = warped_rgb[tuple(foreground_indices)].astype(np.float32)
    subject[edge] = nearest_foreground[edge]
    subject[~semantic] = 0

    alpha = np.zeros(semantic.shape, dtype=np.float32)
    alpha[core] = 1.0
    alpha[edge] = np.clip(inside_distance[edge] / 2.0, 0.0, 1.0)
    return np.rint(subject).astype(np.uint8), alpha


def neutralize_top_matte(subject: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Neutralize all physical paper, including the display's inner bevel."""
    paper_image = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(paper_image).rounded_rectangle(
        (241, 248, 918, 1117), radius=14, fill=255
    )
    paper_outline = np.asarray(paper_image) > 0

    # Protect only the e-paper face. The surrounding cream-colored bevel is
    # physical white matte and must receive the same neutral correction.
    protected_display = np.zeros(subject.shape[:2], dtype=bool)
    protected_display[362:1008, 342:812] = True
    paper = paper_outline & ~protected_display

    # Measure from the paper's oak boundary before subtracting the display.
    # This lets the narrow inner bevel reach full correction instead of fading
    # back to cream merely because it surrounds a protected screen opening.
    distance = ndimage.distance_transform_edt(paper_outline)
    weight = np.clip((distance - 1.0) / 11.0, 0.0, 1.0)
    weight[~paper] = 0.0

    rgb = subject.astype(np.float32)
    luminance = (
        0.2126 * rgb[..., 0]
        + 0.7152 * rgb[..., 1]
        + 0.0722 * rgb[..., 2]
    )
    # Preserve the real dark cut-edge/shadow around the e-paper. Bright matte
    # bevel pixels receive full correction; boundary pixels below paper-white
    # luminance ramp smoothly toward their exact photographed values.
    display_distance = ndimage.distance_transform_edt(~protected_display)
    inner_bevel = paper & (display_distance <= 14.0)
    shade_gate = np.clip((luminance - 155.0) / 60.0, 0.0, 1.0)
    weight[inner_bevel] *= shade_gate[inner_bevel]
    neutral = np.clip(luminance + 25.0, 0, 248)
    graded = np.repeat(neutral[..., None], 3, axis=2)
    result = rgb * (1.0 - weight[..., None]) + graded * weight[..., None]

    # Explicit invariants: correction cannot enter display content or oak.
    result[protected_display] = rgb[protected_display]
    result[~paper_outline] = rgb[~paper_outline]
    return np.rint(result).astype(np.uint8), weight


# A robust 13 x 15 wood-grid fit from the original Back photograph. Rows are
# [constant, x, y, x^2, xy, y^2]; columns are linear-light R, G, B. Feature
# boxes (keyhole, sticker, USB aperture, and engraving) were excluded from the
# fit, so their exact source-owned pixels are transformed but never treated as
# illumination samples.
BACK_RELIGHT_COEFFICIENTS = np.array(
    [
        [-0.855951687520194, -1.384364356173691, -2.048769878965305],
        [-0.270960854013129, -0.359095542824733, -0.474360788035786],
        [0.047260267641418, 0.069758021905474, 0.066802255285378],
        [-0.021465325696796, 0.003895917729785, 0.093983381890095],
        [0.054380047082139, 0.080239528077814, 0.116389331882569],
        [-0.024925930349853, -0.031160804008550, 0.041763787058198],
    ],
    dtype=np.float64,
)
BACK_RELIGHT_TARGET = np.array(
    [0.425697764901583, 0.252452664128919, 0.131874789424487],
    dtype=np.float64,
)
BACK_STICKER_POLYGON = ((753, 975), (846, 981), (844, 1041), (751, 1037))


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    value = rgb.astype(np.float64) / 255.0
    return np.where(
        value <= 0.04045,
        value / 12.92,
        ((value + 0.055) / 1.055) ** 2.4,
    )


def linear_to_srgb(linear: np.ndarray) -> np.ndarray:
    value = np.clip(linear, 0.0, 1.0)
    value = np.where(
        value <= 0.0031308,
        value * 12.92,
        1.055 * np.power(value, 1.0 / 2.4) - 0.055,
    )
    return np.rint(value * 255.0).astype(np.uint8)


def linear_to_oklab(linear: np.ndarray) -> np.ndarray:
    lms = np.cbrt(
        np.clip(
            linear
            @ np.array(
                [
                    [0.4122214708, 0.2119034982, 0.0883024619],
                    [0.5363325363, 0.6806995451, 0.2817188376],
                    [0.0514459929, 0.1073969566, 0.6299787005],
                ]
            ),
            0.0,
            None,
        )
    )
    return lms @ np.array(
        [
            [0.2104542553, 1.9779984951, 0.0259040371],
            [0.7936177850, -2.4285922050, 0.7827717662],
            [-0.0040720468, 0.4505937099, -0.8086757660],
        ]
    )


def oklab_to_linear(lab: np.ndarray) -> np.ndarray:
    lms = (
        lab
        @ np.array(
            [
                [1.0, 1.0, 1.0],
                [0.3963377774, -0.1055613458, -0.0894841775],
                [0.2158037573, -0.0638541728, -1.2914855480],
            ]
        )
    ) ** 3
    return lms @ np.array(
        [
            [4.0767416621, -1.2684380046, -0.0041960863],
            [-3.3077115913, 2.6097574011, -0.7034186147],
            [0.2309699292, -0.3413193965, 1.7076147010],
        ]
    )


def relight_back_subject(subject: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Remove the photographed falloff and revive only the real label inks."""
    linear = srgb_to_linear(subject)
    yy, xx = np.indices(alpha.shape)
    x = (xx - 575.5) / 378.5
    y = (yy - 683.0) / 475.0
    basis = np.stack(
        (np.ones_like(x), x, y, x * x, x * y, y * y), axis=-1
    )
    field = np.exp(basis @ BACK_RELIGHT_COEFFICIENTS)
    gain = np.clip(BACK_RELIGHT_TARGET / np.clip(field, 1e-6, None), 0.68, 1.72)
    corrected = np.clip(linear * gain, 0.0, 1.0)

    sticker_image = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(sticker_image).polygon(BACK_STICKER_POLYGON, fill=255)
    sticker = np.asarray(sticker_image) > 0
    distance = ndimage.distance_transform_edt(sticker)
    sticker_weight = np.clip((distance - 0.25) / 1.5, 0.0, 1.0)
    lab = linear_to_oklab(corrected)
    vivid_lab = lab.copy()
    vivid_lab[..., 1:] *= 1.22
    vivid = np.clip(oklab_to_linear(vivid_lab), 0.0, 1.0)
    corrected = (
        corrected * (1.0 - sticker_weight[..., None])
        + vivid * sticker_weight[..., None]
    )
    corrected[alpha <= 0] = 0.0
    return linear_to_srgb(corrected)


def expected_support(view: View) -> np.ndarray:
    """Hard safety bounds that exclude the photographed table and cast shadow."""
    image = Image.new("L", CANVAS, 0)
    draw = ImageDraw.Draw(image)
    if view.name == "Top":
        draw.rounded_rectangle((197, 208, 954, 1158), radius=24, fill=255)
    elif view.name == "Back":
        draw.rounded_rectangle((197, 208, 954, 1158), radius=38, fill=255)
    else:
        draw.rectangle((190, 610, 961, 742), fill=255)
    return np.asarray(image) > 0


def extract_subject(
    warped_rgb: np.ndarray, warped_mask: np.ndarray, view: View
) -> tuple[np.ndarray, np.ndarray]:
    """Recover a clean 1–2 px edge while leaving every interior pixel intact."""
    support = expected_support(view)
    if view.name == "Side":
        # Keep the photographed top/endcap silhouette.  Only the safe central
        # face is filled geometrically so the dark plywood seam remains part of
        # the object even where a warm-wood threshold cannot see it.
        semantic = (warped_mask >= 128) & support
        semantic[682:743, 220:931] = True
        semantic[680:701, 198:221] = True
        semantic[680:701, 930:951] = True
        semantic = ndimage.gaussian_filter(semantic.astype(np.float32), 0.85) >= 0.5
    else:
        # The framed front and rear panel are opaque rounded rectangles after
        # perspective rectification. Geometric support avoids table shadows.
        semantic = support
    semantic = ndimage.binary_closing(semantic, iterations=1)
    semantic = largest_component(semantic)
    semantic = ndimage.binary_fill_holes(semantic)
    yy, xx = np.ogrid[-2:3, -2:3]
    disk = (xx * xx + yy * yy) <= 4
    semantic = ndimage.binary_opening(semantic, structure=disk)
    semantic = ndimage.binary_erosion(semantic, iterations=2 if view.name == "Top" else 1)

    inside_distance = ndimage.distance_transform_edt(semantic)
    core = inside_distance >= 3.0
    edge = semantic & ~core

    _, foreground_indices = ndimage.distance_transform_edt(~core, return_indices=True)
    foreground = warped_rgb[tuple(foreground_indices)].astype(np.float32)
    color = warped_rgb.astype(np.float32)

    alpha = np.zeros(semantic.shape, dtype=np.float32)
    alpha[core] = 1.0
    alpha[edge] = np.clip(inside_distance[edge] / 2.0, 0.0, 1.0)

    subject = color.copy()
    # Boundary RGB is taken from the nearest exact source-owned interior pixel,
    # never from the photographed white tabletop.  This prevents a light halo
    # on the dark catalog background without inventing product content.
    subject[edge] = foreground[edge]
    subject[~semantic] = 0
    return np.rint(subject).astype(np.uint8), alpha


def composite(subject: np.ndarray, alpha: np.ndarray, background: np.ndarray) -> Image.Image:
    alpha_image = Image.fromarray(np.rint(alpha * 255).astype(np.uint8), "L")
    shadow_alpha = alpha_image.filter(ImageFilter.GaussianBlur(14))
    shadow_alpha = shadow_alpha.transform(
        CANVAS,
        Image.Transform.AFFINE,
        (1, 0, -7, 0, 1, -9),
        resample=Image.Resampling.BILINEAR,
        fillcolor=0,
    )
    shadow = np.asarray(shadow_alpha, dtype=np.float32) / 255.0 * 0.12

    base = np.empty((CANVAS[1], CANVAS[0], 3), dtype=np.float32)
    base[:] = background
    base *= 1.0 - shadow[..., None]
    a = alpha[..., None]
    result = subject.astype(np.float32) * a + base * (1.0 - a)
    return Image.fromarray(np.rint(np.clip(result, 0, 255)).astype(np.uint8), "RGB")


def render(source_path: Path, view: View, output_directory: Path) -> list[Path]:
    source = Image.open(source_path).convert("RGB")
    source_rgb = np.asarray(source)
    if view.name == "Top":
        top_view = shifted_top_view()
        warped_source = warp(source, top_view)
        semantic = physical_top_silhouette(np.asarray(warped_source))
        subject, alpha = source_owned_subject(
            np.asarray(warped_source), semantic
        )
        subject, matte_weight = neutralize_top_matte(subject)
        diagnostic_mask = semantic
    elif view.name == "Side":
        mask = source_mask(source_rgb, view)
        side_view = presentation_side_view()
        warped_source = warp(source, side_view)
        warped_mask = warp(
            Image.fromarray(mask.astype(np.uint8) * 255, "L"),
            side_view,
            mask=True,
        )
        semantic = physical_side_silhouette(np.asarray(warped_mask))
        subject, alpha = source_owned_subject_one_pixel(
            np.asarray(warped_source), semantic
        )
        diagnostic_mask = mask
    else:
        mask = source_mask(source_rgb, view)
        warped_source = warp(source, view)
        warped_mask = warp(
            Image.fromarray(mask.astype(np.uint8) * 255, "L"),
            view,
            mask=True,
        )
        subject, alpha = extract_subject(
            np.asarray(warped_source), np.asarray(warped_mask), view
        )
        if view.name == "Back":
            subject = relight_back_subject(subject, alpha)
        diagnostic_mask = mask

    stem = f"avianAssembled{view.name}"
    light_path = output_directory / f"{stem}.png"
    dark_path = output_directory / f"{stem}DARK.png"
    composite(subject, alpha, LIGHT_BG).save(light_path, optimize=True, compress_level=9)
    composite(subject, alpha, DARK_BG).save(dark_path, optimize=True, compress_level=9)

    diagnostics = output_directory / "diagnostics"
    diagnostics.mkdir(exist_ok=True)
    Image.fromarray(diagnostic_mask.astype(np.uint8) * 255, "L").save(
        diagnostics / f"{stem}-source-mask.png"
    )
    Image.fromarray(np.rint(alpha * 255).astype(np.uint8), "L").save(
        diagnostics / f"{stem}-alpha.png"
    )
    if view.name == "Top":
        Image.fromarray(np.rint(matte_weight * 255).astype(np.uint8), "L").save(
            diagnostics / f"{stem}-matte-weight.png"
        )
    return [light_path, dark_path]


def contact_sheet(paths: list[Path], output_path: Path) -> None:
    thumbs: list[Image.Image] = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        image.thumbnail((360, 480), Image.Resampling.LANCZOS)
        card = Image.new("RGB", (390, 530), (225, 225, 225))
        card.paste(image, ((390 - image.width) // 2, 12))
        draw = ImageDraw.Draw(card)
        draw.text((16, 500), path.name, fill=(30, 30, 30))
        thumbs.append(card)
    sheet = Image.new("RGB", (390 * 3, 530 * 2), (210, 210, 210))
    for index, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((index % 3) * 390, (index // 3) * 530))
    sheet.save(output_path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=Path, required=True)
    parser.add_argument("--back", type=Path, required=True)
    parser.add_argument("--side", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    outputs: list[Path] = []
    outputs += render(args.top, VIEWS["Top"], args.output)
    outputs += render(args.back, VIEWS["Back"], args.output)
    outputs += render(args.side, VIEWS["Side"], args.output)
    contact_sheet(outputs, args.output / "avian-assembled-contact.png")


if __name__ == "__main__":
    main()
