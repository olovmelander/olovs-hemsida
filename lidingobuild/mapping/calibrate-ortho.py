"""Measure what the 2019 CC0 orthophoto reads on surfaces the model already has.

A detection rule copied from another course is a rule calibrated on another
course's light. Ribbingsfors' sand thresholds were measured on Ribbingsfors and
Ängsö's on Ängsö; this measures Lidingö's on Lidingö, using only features that
were mapped without ever looking at these numbers.

  python3 lidingobuild/mapping/calibrate-ortho.py
"""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
Image.MAX_IMAGE_PIXELS = None
CACHE = ROOT / 'lidingobuild/cache'
img = np.asarray(Image.open(CACHE / 'municipal-ortho-2019/lidingo-2019-0p5m.png').convert('RGB')).astype(np.float32)
world = [float(x) for x in (CACHE / 'municipal-ortho-2019/lidingo-2019-0p5m.pgw').read_text().split()]
to3011 = Transformer.from_crs(3006, 3011, always_xy=True)

def pixels(coords):
    e = np.array([c[0] for c in coords]); n = np.array([c[1] for c in coords])
    x, y = to3011.transform(e, n)
    return np.stack([(x - world[4]) / world[0], (y - world[5]) / world[3]], axis=1)

surfaces = json.loads((ROOT / 'lidingobuild/mapping/playing-surfaces.geojson').read_text(encoding='utf8'))
context = json.loads((ROOT / 'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson').read_text(encoding='utf8'))

def ring_pixels(ring):
    """Interior samples of a ring, eroded by one metre so a mixed edge pixel
    never enters a class it does not belong to."""
    p = pixels(ring)
    x0, y0 = np.floor(p.min(axis=0)).astype(int); x1, y1 = np.ceil(p.max(axis=0)).astype(int)
    x0 = max(x0, 0); y0 = max(y0, 0); x1 = min(x1, img.shape[1] - 1); y1 = min(y1, img.shape[0] - 1)
    if x1 - x0 < 3 or y1 - y0 < 3: return None
    gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    inside = np.zeros(gx.shape, bool)
    for i in range(len(p) - 1):
        (ax, ay), (bx, by) = p[i], p[i + 1]
        hit = ((ay > gy) != (by > gy)) & (gx < ax + (gy - ay) * (bx - ax) / np.where(by == ay, 1e-9, by - ay))
        inside ^= hit
    # erode: drop any inside pixel with an outside 4-neighbour, twice (1 m)
    for _ in range(2):
        e = inside.copy()
        e[1:, :] &= inside[:-1, :]; e[:-1, :] &= inside[1:, :]
        e[:, 1:] &= inside[:, :-1]; e[:, :-1] &= inside[:, 1:]
        inside = e
    if inside.sum() < 8: return None
    return img[y0:y1, x0:x1][inside]

def rings_of(g):
    return [g['coordinates'][0]] if g['type'] == 'Polygon' else [p[0] for p in g['coordinates']]

def stats(name, samples):
    if not len(samples): return None
    a = np.concatenate(samples)
    r, g, b = a[:, 0], a[:, 1], a[:, 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    exg = 2 * g - r - b                      # excess green: the mown-turf signal
    rg = r / np.maximum(g, 1)                # sand runs warm; turf does not
    row = {'n': int(len(a)),
           'rgb': [round(float(np.median(c)), 1) for c in (r, g, b)],
           'luminance': [round(float(np.percentile(lum, q)), 1) for q in (10, 50, 90)],
           'excessGreen': [round(float(np.percentile(exg, q)), 1) for q in (10, 50, 90)],
           'redOverGreen': [round(float(np.percentile(rg, q)), 3) for q in (10, 50, 90)]}
    print(f"{name:22} n={row['n']:7d}  rgb={row['rgb']}  lum(p10/50/90)={row['luminance']}  ExG={row['excessGreen']}  R/G={row['redOverGreen']}")
    return row

report = {'schemaVersion': 1, 'measuredOn': '2026-09-08',
          'source': {'imagery': 'lidingo-municipal-ortho-2019 (CC0), 0.5 m, EPSG:3011',
                     'calibratedOn': 'features already in playing-surfaces.geojson and the OSM context extract'},
          'classes': {}}
by_kind = {}
for f in surfaces['features']:
    kind = f['properties']['kind']
    for r in rings_of(f['geometry']):
        s = ring_pixels(r)
        if s is not None: by_kind.setdefault(kind, []).append(s)
for kind in ('green', 'fairway', 'tee', 'bunker'):
    report['classes'][kind] = stats(kind, by_kind.get(kind, []))

wood = []
for f in context['features']:
    t = f['properties'].get('tags', {})
    if t.get('natural') == 'wood' or t.get('landuse') == 'forest':
        if f['geometry']['type'] in ('Polygon', 'MultiPolygon'):
            for r in rings_of(f['geometry']):
                s = ring_pixels(r)
                if s is not None: wood.append(s)
report['classes']['wood'] = stats('wood (OSM)', wood)

(ROOT / 'lidingobuild/mapping/ortho-calibration.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
print('\nwrote lidingobuild/mapping/ortho-calibration.json')
