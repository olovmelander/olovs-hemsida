"""The 2025-05-31 Lantmäteriet capture, as the one photo record this build reads.

Everything mapped from imagery on this ground now comes from this capture. It is
the owner's instruction and it is also what the measurement says: run through
detect-bunkers.py's identical rule, the five captures score

    capture          accepted  recovered of 40  median
    lm-2025 0.16 m         71              34    0.9 m
    municipal-2018         208              35    1.4 m
    municipal-2019          70              11    1.1 m
    ortho-2019 0.5 m        76              13    1.2 m
    esri-2026 0.30 m       109              30    1.6 m

so 2018 buys one more bunker for three times the false accepts and half a metre
of precision. The older captures keep exactly one job: dating. A feature absent
in 2018 and 2019 and present here was built between them, which is how the club's
reported works are told from its proposals.

This module is the shared foundation - one reader, one DTM, one calibration - so
that four surface classes cannot each calibrate a different rule on the same
pixels and then disagree about what the photograph says.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'lidingobuild/cache'
CAPTURE = 'lm-ortofoto-0p16'

_meta = json.loads((ROOT / 'geo_data/course-v2/lidingo/discovery/lm-ortofoto-0p16.json').read_text())
META = _meta
_img = None
_world = None


def image():
    """The capture's pixels, EPSG:3006 native - a tile's coordinates ARE its
    georeference, so a trace made on it needs no registration."""
    global _img, _world
    if _img is None:
        _img = np.asarray(Image.open(ROOT / _meta['path']).convert('RGB'))
        _world = [float(x) for x in (ROOT / _meta['worldfilePath']).read_text().split()]
    return _img, _world


def sample(EE, NN):
    img, w = image()
    c = np.clip(np.round((np.asarray(EE) - w[4]) / w[0]).astype(np.int32), 0, img.shape[1] - 1)
    r = np.clip(np.round((np.asarray(NN) - w[5]) / w[3]).astype(np.int32), 0, img.shape[0] - 1)
    return img[r, c]


def indices(px):
    """Luminance, excess green and red-over-green: the three the calibration and
    every rule below are stated in."""
    a = px.astype(np.float32)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    return 0.299 * R + 0.587 * G + 0.114 * B, 2 * G - R - B, R / np.maximum(G, 1)


# --- the shape record: the published 1 m laser DTM ---------------------------
_dtm_meta = json.loads((CACHE / 'terrain-review/review-dtm-1m.json').read_text())
DTM_META = _dtm_meta
DTM = np.fromfile(CACHE / 'terrain-review/review-dtm-1m.f32', dtype='<f4').reshape(
    _dtm_meta['height'], _dtm_meta['width'])
DTM_W = _dtm_meta['northwestSampleCentre']['easting']
DTM_N = _dtm_meta['northwestSampleCentre']['northing']
WINDOW = _dtm_meta['window']
LOCAL_WINDOW_METRES = 15
RESIDUAL = DTM - nd.median_filter(np.nan_to_num(DTM, nan=0.0), size=LOCAL_WINDOW_METRES, mode='nearest')

# The laser is 2021-03-23 and the photograph is 2025-05-31. Anything built
# between them has colour and no shape, which is not a defect of either record.
DTM_CAPTURE = '2021-03-23'
IMAGE_CAPTURE = _meta['captureDate']


def dtm_at(EE, NN, field=DTM):
    c = np.clip(np.round(np.asarray(EE) - DTM_W).astype(np.int32), 0, field.shape[1] - 1)
    r = np.clip(np.round(DTM_N - np.asarray(NN)).astype(np.int32), 0, field.shape[0] - 1)
    return field[r, c]


def rings_of(geometry):
    return ([geometry['coordinates'][0]] if geometry['type'] == 'Polygon'
            else [p[0] for p in geometry['coordinates']])


def ring_centroid(ring):
    """About the FIRST VERTEX, never about the EPSG:3006 origin. A small ring's
    raw cross products are ~4.6e12 and sum to ~-90, so a centroid taken about
    the origin is the ninth significant figure of a double: measured on this
    build's 40 bunkers it was out by a median 20.6 m, and 36 of the 40 landed
    outside their own bounding box."""
    ox, oy = ring[0][0], ring[0][1]
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][0] - ox, ring[i][1] - oy
        x1, y1 = ring[i + 1][0] - ox, ring[i + 1][1] - oy
        cr = x0 * y1 - x1 * y0
        a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr
    if abs(a) < 1e-9:
        return None
    return (ox + cx / (3 * a), oy + cy / (3 * a), abs(a) / 2)


def interior_samples(ring, step=0.5, shrink=0.0):
    """Points on a grid inside a ring. A scanline-span midpoint is inside by
    construction; a centroid is not, and this build's own 22-point crescents
    are why every interior probe here is a span and not a point."""
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    gx = np.arange(min(xs), max(xs) + step, step)
    gy = np.arange(min(ys), max(ys) + step, step)
    EE, NN = np.meshgrid(gx, gy)
    inside = point_in_ring(EE, NN, ring)
    if shrink > 0:
        inside = nd.binary_erosion(inside, np.ones((3, 3)), iterations=max(1, int(shrink / step)))
    return EE[inside], NN[inside]


def point_in_ring(EE, NN, ring):
    inside = np.zeros(np.shape(EE), bool)
    n = len(ring)
    for i in range(n - 1):
        x0, y0 = ring[i]; x1, y1 = ring[i + 1]
        if y0 == y1:
            continue
        crosses = ((y0 > NN) != (y1 > NN))
        with np.errstate(divide='ignore', invalid='ignore'):
            xint = x0 + (NN - y0) * (x1 - x0) / (y1 - y0)
        inside ^= crosses & (EE < xint)
    return inside


def survey():
    """The GolfTraxx GPS survey: five points a hole, green centre and back tee
    the two this build anchors on."""
    fc = json.loads((ROOT / 'geo_data/lidingo_clean.json').read_text(encoding='utf8'))
    from pyproj import Transformer
    to3006 = Transformer.from_crs(4326, 3006, always_xy=True)
    out = {}
    for f in fc['features']:
        p = f['properties']
        lon, lat = f['geometry']['coordinates'][:2]
        e, n = to3006.transform(lon, lat)
        out.setdefault(int(p['hole']), {})[p['name']] = (e, n)
    return out


def surfaces():
    return json.loads((ROOT / 'lidingobuild/mapping/playing-surfaces.geojson').read_text(encoding='utf8'))


def trace_outline(mask, easts, norths, thin_metres=0.5):
    """The outer boundary of a boolean component, as a closed world-coordinate ring.

    Moore-neighbour tracing with Jacob's stopping criterion, so a kidney-shaped
    green comes out as a boundary rather than as points sorted by angle about a
    centroid - that shortcut is exact enough for a convex bunker and folds a
    concave green inside out. The boundary is then thinned to `thin_metres`, so
    the ring is a boundary and not a pixel dump.
    """
    ys, xs = np.nonzero(mask)
    if not len(ys):
        return None
    h, w = mask.shape
    # start at the first cell in raster order; its west neighbour is background
    start = (int(ys[0]), int(xs[0]))
    # the eight neighbours, clockwise from west
    nb = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]
    boundary = [start]
    backtrack = 0                       # we entered `start` from the west
    current = start
    first_step = None
    for _ in range(8 * mask.size):
        found = None
        for k in range(1, 9):
            d = nb[(backtrack + k) % 8]
            r, c = current[0] + d[0], current[1] + d[1]
            if 0 <= r < h and 0 <= c < w and mask[r, c]:
                found = ((r, c), (backtrack + k) % 8)
                break
        if found is None:
            break                        # an isolated cell
        nxt, entered = found
        # we came from the opposite side of the direction we moved in
        backtrack = (entered + 4) % 8
        if first_step is None:
            first_step = nxt
        elif current == start and nxt == first_step:
            break                        # Jacob's criterion: back at the start, same way
        current = nxt
        boundary.append(nxt)
        if len(boundary) > 4 * mask.size:
            break
    ring = [[float(easts[c]), float(norths[r])] for r, c in boundary]
    thinned = [ring[0]]
    for point in ring[1:]:
        if (point[0] - thinned[-1][0]) ** 2 + (point[1] - thinned[-1][1]) ** 2 >= thin_metres ** 2:
            thinned.append(point)
    if len(thinned) < 3:
        return None
    thinned.append(thinned[0])
    return [[round(x, 3), round(y, 3)] for x, y in thinned]
