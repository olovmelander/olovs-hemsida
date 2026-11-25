"""What the looking tools share: the photo mosaic, a stretched crop, a metre grid.

Kept free of scipy on purpose. The tracer needs scipy; a look at its result must not, so that the look still runs
on a machine or a day where the tracer's own libraries do not load.
"""
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageFont
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[3]


class Imagery:
    """A best-resolution-first mosaic over cached RGBI GeoTIFFs in EPSG:3006 (the tracer's own order of reading)."""

    def __init__(self, paths):
        self.paths = [Path(p) for p in paths]
        missing = [str(p) for p in self.paths if not p.exists()]
        if missing:
            raise SystemExit(f'photo not found (the raw caches are private and stay on the machine that fetched them): {missing}')

    def read(self, e0, n0, e1, n1, res):
        w, h = max(1, int(round((e1 - e0) / res))), max(1, int(round((n1 - n0) / res)))
        out, have = np.zeros((4, h, w), np.uint8), np.zeros((h, w), bool)
        for p in self.paths:
            if have.all():
                break
            with rasterio.open(p) as src:
                b = src.bounds
                if b.right <= e0 or b.left >= e1 or b.top <= n0 or b.bottom >= n1:
                    continue
                d = src.read([1, 2, 3, 4], window=from_bounds(e0, n0, e1, n1, src.transform), out_shape=(4, h, w), boundless=True,
                             fill_value=0, resampling=Resampling.bilinear)
                ok = d.any(axis=0) & ~have
                out[:, ok] = d[:, ok]
                have |= ok
        return out, have


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def largest(geom):
    return max(geom.geoms, key=lambda g: g.area) if geom.geom_type == 'MultiPolygon' else geom


def font(size):
    try:
        return ImageFont.truetype('arial.ttf', size)
    except OSError:
        return ImageFont.load_default()


def pixel(p, box, width, height=None):
    """An EPSG:3006 point in a picture of `box` (e0, n0, e1, n1) that is `width` pixels wide."""
    height = height or width
    return ((p[0] - box[0]) * width / (box[2] - box[0]), (box[3] - p[1]) * height / (box[3] - box[1]))


def crop(imagery, box, width, height=None, infrared=False, gamma=0.7):
    """The photo over `box`, contrast-stretched; `infrared` shows near infrared as red (vegetation stands out)."""
    height = height or width
    img, have = imagery.read(*box, max(0.16, (box[2] - box[0]) / width))
    rgb = (img[[3, 0, 1]] if infrared else img[:3]).astype(np.float32)
    if have.any():
        lo, hi = np.percentile(rgb[:, have], [1, 99.3])
        rgb = np.clip((rgb - lo) / max(1.0, hi - lo), 0, 1) ** gamma * 255
    return Image.fromarray(np.transpose(rgb.astype(np.uint8), (1, 2, 0))).resize((width, height), Image.BICUBIC)


def draw_grid(draw, box, width, step, height=None, labels_every=2):
    """Grid lines every `step` metres, labelled with their coordinate on every `labels_every`-th line."""
    height = height or width
    f = font(12)
    for k, v in enumerate(range(math.ceil(box[0] / step) * step, int(box[2]) + 1, step)):
        x = pixel((v, box[1]), box, width, height)[0]
        major = (v // step) % labels_every == 0
        draw.line([(x, 0), (x, height)], fill=(255, 255, 255) if major else (150, 150, 150))
        if major:
            draw.text((x + 2, 2), str(v), fill='yellow', font=f, stroke_width=2, stroke_fill='black')
    for v in range(math.ceil(box[1] / step) * step, int(box[3]) + 1, step):
        y = pixel((box[0], v), box, width, height)[1]
        major = (v // step) % labels_every == 0
        draw.line([(0, y), (width, y)], fill=(255, 255, 255) if major else (150, 150, 150))
        if major:
            draw.text((2, y + 2), str(v), fill='yellow', font=f, stroke_width=2, stroke_fill='black')
