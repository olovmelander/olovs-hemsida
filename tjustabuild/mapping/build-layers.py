#!/usr/bin/env python3
"""Tjusta's layers: water, facilities, infrastructure (EPSG:3006).

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen python tjustabuild/mapping/build-layers.py

Written from Bro Hof's builder (brohofbuild/mapping/build-layers.py), the same steps on Tjusta's files.
Water keeps Lantmäteriet's measured bodies and levels; its outline is the union with the
2025-06-14 near-infrared water line, which is higher than the terrain's own capture. Facilities
are traced on the same photo from `layer-decisions.json`. Tjusta has no walls, boulders, bridges,
merged bodies or cart paths in OSM; those steps run on empty lists.
"""
import glob
import json
import sys
from pathlib import Path

import numpy as np
from rasterio.features import rasterize
from scipy import ndimage as nd
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages/course-geo/mapping'))
import turf_tracing as tt  # noqa: E402

HERE = Path(__file__).resolve().parent
cfg = tt.load_json(HERE / 'trace-config.json')
dec = tt.load_json(HERE / 'layer-decisions.json')
imagery = tt.Imagery([ROOT / p for p in cfg['imagery']['rasters']])
BOX = cfg['box']
IMG = cfg['imagery']['sourceId']

# The newest classifier: its name is a hash of what it read, so name order says nothing about which is current.
cached = sorted(glob.glob(str(ROOT / 'tjustabuild/cache/mapping/trace-*.npz')), key=lambda p: Path(p).stat().st_mtime)
if not cached:
    raise SystemExit('run trace-course-surfaces.py first: the classifier raster is missing')
prob = np.load(cached[-1], allow_pickle=False)['prob'].astype(np.float32)
TR = tt.from_origin(BOX[0], BOX[3], 0.4, 0.4)
mown = nd.gaussian_filter(prob[0] + prob[1], 0.8) > 0.5
green = nd.gaussian_filter(prob[0], 0.8) > 0.45


def rnd(coords, n=2):
    return [[round(float(x), n), round(float(y), n)] for x, y in coords]


# ------------------------------------------------------------------ water

RES = 0.3
img, tr, have = imagery.read(*BOX, RES)
g = lambda i: nd.gaussian_filter(img[i].astype(np.float32), 1.0)
R, G, B, N = g(0), g(1), g(2), g(3)
wet = have & (N < 52) & ((N - R) / (N + R + 1) < -0.12) & ((R + G + B) / 3 < 125)
wet = nd.binary_closing(nd.binary_opening(wet, iterations=2), iterations=3)
lab, _ = nd.label(wet)
photo = []
for i, sl in enumerate(nd.find_objects(lab), 1):
    m = lab[sl] == i
    if m.sum() * RES * RES < 40:
        continue
    t2 = tr * tt.rasterio.Affine.translation(sl[1].start, sl[0].start)
    for p in tt.polygon_from_mask(m, t2, 40):
        q = tt.largest(p.buffer(0.5).buffer(-0.9).buffer(0.4))
        if q is not None and q.area > 40:
            photo.append(q)
window = box(*BOX)
lm = tt.load_json(ROOT / cfg['water'])
built = unary_union([shape(f['geometry']).buffer(1) for f in tt.load_json(ROOT / 'geo_data/course-v2/tjusta/reference/osm-context-epsg3006.geojson')['features']
                     if (f['properties'].get('tags') or {}).get('building') and f['geometry']['type'] == 'Polygon'])
surfaces = unary_union([shape(f['geometry']).buffer(0.2) for d in ('tjustabuild',)
                        for f in tt.load_json(ROOT / d / 'mapping/playing-surfaces.geojson')['features']])
out_water, used = [], set()
for f in lm['features']:
    geom = shape(f['geometry']).buffer(0)
    for k, part in enumerate(geom.geoms if geom.geom_type == 'MultiPolygon' else [geom]):
        if part.area < 60:
            continue
        islands = [Polygon(r) for r in part.interiors if Polygon(r).area > 25]
        merged, grown = Polygon(part.exterior), 0.0
        if part.intersects(window):
            for j, q in enumerate(photo):
                share = q.intersection(part).area
                # A photo water body belongs to this one when they mostly coincide; a tree's or a
                # roof's dark pixels never do. Growth past 12 m of the measured line is refused.
                if share > 0.3 * q.area or share > 0.5 * min(q.area, part.area):
                    merged = merged.union(Polygon(q.exterior).intersection(part.buffer(12)))
                    used.add(j)
            merged = merged.difference(surfaces).difference(built)
            merged = tt.largest(merged.buffer(0.8).buffer(-1.6).buffer(0.8))
            grown = merged.area - Polygon(part.exterior).area
        for isle in islands:
            merged = tt.largest(merged.difference(isle.buffer(-0.5)))
        merged = tt.largest(merged.simplify(0.2))
        p = f['properties']
        out_water.append({'type': 'Feature', 'id': f'{f["id"]}-{k + 1}' if geom.geom_type == 'MultiPolygon' else f['id'],
                          'properties': {'kind': 'water', 'heightRH2000': p['heightRH2000'], 'isLake': True, 'isSea': False,
                                         'waterKind': p['waterKind'], 'sourceId': p['sourceId'], 'photoGrowthM2': round(grown, 1),
                                         'outline': 'lm-break-geometry-union-orto-o2-2025' if grown > 5 else 'lm-break-geometry'},
                          'geometry': {'type': 'Polygon', 'coordinates': tt.round_coords(merged)}})
# Ponds the break geometry lacks: level is the terrain's own flat floor under them.
t = cfg['terrain']
height = np.fromfile(ROOT / t['path'], np.float32).reshape(t['side'], t['side'])
for spec in dec['newPonds']:
    q = min(photo, key=lambda p: p.distance(Point(spec['at'])))
    if q.distance(Point(spec['at'])) > 8:
        raise SystemExit(f'no photo water at {spec["at"]}')
    inner = next((c for c in (q.buffer(-2), q.buffer(-1), q.buffer(-0.4)) if c.area > 0.25 * q.area), q)
    e0, n0, e1, n1 = inner.bounds
    zs = [height[int(round(t['firstNorthing'] - y)), int(round(x - t['firstEasting']))]
          for x in np.arange(e0, e1, 1.0) for y in np.arange(n0, n1, 1.0) if inner.contains(Point(x, y))]
    level = round(float(np.percentile(zs, 25)), 2)
    out_water.append({'type': 'Feature', 'id': spec['id'],
                      'properties': {'kind': 'water', 'heightRH2000': level, 'isLake': True, 'isSea': False, 'waterKind': 'inland-pond',
                                     'sourceId': IMG, 'outline': 'orto-o2-2025', 'levelMethod': 'lower quartile of the 1 m terrain inside the photo outline',
                                     'levelSpreadMetres': round(float(np.percentile(zs, 90) - np.percentile(zs, 10)), 2)},
                      'geometry': {'type': 'Polygon', 'coordinates': tt.round_coords(tt.largest(q.simplify(0.2)))}})
# Bodies the sources cut in two (none at Tjusta). The higher level of the two stands, so no flattened floor of
# the other part rises through the sheet.
for ids in dec['mergeWater']:
    parts = [f for f in out_water if f['id'] in ids]
    if len(parts) != 2:
        raise SystemExit(f'mergeWater {ids}: found {[f["id"] for f in parts]}')
    joined = tt.largest(tt.largest(unary_union([shape(f['geometry']).buffer(0.6) for f in parts]).buffer(-0.6)).simplify(0.25))
    top = max(parts, key=lambda f: f['properties']['heightRH2000'])
    top['properties'] = {**top['properties'], 'mergedFrom': sorted(f['id'] for f in parts), 'levels': sorted(f['properties']['heightRH2000'] for f in parts)}
    top['geometry'] = {'type': 'Polygon', 'coordinates': tt.round_coords(joined)}
    out_water = [f for f in out_water if f not in parts or f is top]
# Water stands against a retaining wall: the terrain's 1 m bank hides the last metre or two.
for spec in dec['walls']:
    body = next(f for f in out_water if f['id'] == spec['waterId'])
    wall = LineString(spec['line'])
    inside = Polygon(wall.coords)
    g = shape(body['geometry'])
    if spec.get('encloses'):
        g = g.union(inside.buffer(3.0).difference(Polygon(spec['causeway']))).difference(inside)
    else:
        g = g.union(inside)
    body['geometry'] = {'type': 'Polygon', 'coordinates': tt.round_coords(tt.largest(tt.largest(g.buffer(0.05)).simplify(0.12)))}
tt.write_json(HERE / 'water.geojson', tt.collection(out_water, status='traced-awaiting-review'))
all_water = unary_union([shape(f['geometry']) for f in out_water])
print('water', len(out_water), 'grown', [(f['id'], f['properties']['photoGrowthM2']) for f in out_water if f['properties'].get('photoGrowthM2', 0) > 50])

# ------------------------------------------------------------- facilities

facilities = []


def component(mask, seed, cap, close=3):
    m = nd.binary_closing(mask, iterations=close)
    inv = ~TR
    c, r = inv * tuple(seed)
    yy, xx = np.ogrid[:m.shape[0], :m.shape[1]]
    d2 = ((xx - c) ** 2 + (yy - r) ** 2) * TR.a ** 2
    labelled, _ = nd.label(m & (d2 < cap ** 2))
    ids, n = np.unique(labelled[(d2 < 8 ** 2) & (labelled > 0)], return_counts=True)
    if not len(ids):
        raise SystemExit(f'no mown component at {seed}')
    fill = nd.binary_fill_holes(labelled == ids[n.argmax()])
    return tt.largest(unary_union(tt.polygon_from_mask(nd.binary_opening(fill, iterations=2), TR, 20)).buffer(1.2).buffer(-2.2).buffer(1.0))


def add_facility(spec, poly, st):
    facilities.append({'type': 'Feature', 'id': spec['id'],
                       'properties': {'kind': spec['kind'], 'material': spec.get('material'), 'parentFacilityId': spec.get('parent'),
                                      'sourceId': IMG, 'edge': st},
                       'geometry': {'type': 'Polygon', 'coordinates': tt.round_coords(poly)}})


for spec in dec['facilities']:
    if 'osm' in spec:
        ring = next(shape(f['geometry']) for f in tt.load_json(ROOT / cfg['osm'])['features'] if f['id'] == spec['osm'])
        start = tt.largest(ring)
    elif 'ring' in spec:
        start = Polygon(spec['ring'], spec.get('holes', []))
    else:
        start = component(green if spec.get('class') == 'green' else mown, spec['seed'], spec.get('cap', 30), spec.get('close', 3))
    if spec.get('reach', 1.5) == 0:
        add_facility(spec, start, dict(start='as given'))
        continue
    poly, st = tt.refine_ring(imagery, start, spec.get('reach', 1.5), ds=0.7, smooth_m=0.8)
    if poly is None or st['dPrime'] < 0.8 or not 0.7 < poly.area / start.area < 1.4:
        poly, st = start, {**(st or {}), 'kept': 'start'}
    add_facility(spec, poly, st)
tt.write_json(HERE / 'facilities.geojson', tt.collection(facilities, status='traced-awaiting-review'))
print('facilities', {f['id']: round(shape(f['geometry']).area) for f in facilities})

# ---------------------------------------------------------- infrastructure


def ridge(line, half, width, bright=True):
    """Snap a hand-placed line to the brightest band of `width` metres within `half` metres."""
    ls = LineString(line)
    s = np.arange(0, ls.length, 0.5)
    pts = np.array([ls.interpolate(v).coords[0] for v in s])
    b = LineString(pts).buffer(half + 3).bounds
    im, t3, _ = imagery.read(*b, 0.16)
    v = nd.uniform_filter(im[:3].astype(np.float32).mean(0), max(1, int(round(width / 0.16))))
    tan = np.gradient(pts, axis=0)
    tan /= np.hypot(*tan.T)[:, None]
    nor = np.stack([tan[:, 1], -tan[:, 0]], 1)
    offs = np.arange(-half, half + 1e-6, 0.1)
    px = pts[:, None, 0] + nor[:, None, 0] * offs[None]
    py = pts[:, None, 1] + nor[:, None, 1] * offs[None]
    prof = nd.map_coordinates(v, [(py - t3.f) / t3.e - 0.5, (px - t3.c) / t3.a - 0.5], order=1, mode='nearest')
    o = offs[(prof * (1 if bright else -1) - 2.0 * offs[None] ** 2).argmax(1)]
    o = nd.gaussian_filter1d(nd.median_filter(o, 7), 2.0)
    q = LineString(pts + nor * o[:, None]).simplify(0.15)
    return q, float(np.abs(o).mean())


infra = []
for spec in dec['walls']:
    line, moved = ridge(spec['line'], 1.5, 0.5)
    infra.append({'type': 'Feature', 'id': spec['id'], 'properties': {'kind': 'bulkhead', 'material': 'stone', 'hole': spec['hole'], 'waterId': spec.get('waterId'),
                                                                      'sourceId': IMG, 'provenance': spec['evidence'], 'meanSnapMetres': round(moved, 2)},
                  'geometry': {'type': 'LineString', 'coordinates': rnd(line.coords)}})
for spec in dec['boulders']:
    body = min((shape(f['geometry']) for f in out_water), key=lambda w: w.distance(Point(spec['near'])))
    corridor = LineString(spec['corridor']).buffer(spec.get('half', 9))
    edge = body.exterior.intersection(corridor)
    edge = linemerge(edge) if edge.geom_type == 'MultiLineString' else edge
    parts = list(edge.geoms) if edge.geom_type == 'MultiLineString' else [edge]
    for j, part in enumerate([p for p in parts if p.length > 8], 1):
        infra.append({'type': 'Feature', 'id': f'{spec["id"]}-{j}', 'properties': {'kind': 'bulkhead', 'material': 'boulders', 'hole': spec['hole'], 'sourceId': IMG,
                                                                                  'provenance': spec['evidence']},
                      'geometry': {'type': 'LineString', 'coordinates': rnd(part.simplify(0.3).coords)}})
for spec in dec['bridges']:
    line, moved = (LineString(spec['line']), 0.0) if len(spec['line']) == 2 else ridge(spec['line'], 1.2, spec['width'] * 0.7)
    infra.append({'type': 'Feature', 'id': spec['id'], 'properties': {'kind': 'bridge', 'style': spec['style'], 'width': spec['width'], 'sourceId': IMG,
                                                                      'provenance': 'orthophoto-2025', 'observedYear': 2025, 'meanSnapMetres': round(moved, 2)},
                  'geometry': {'type': 'LineString', 'coordinates': rnd(line.coords)}})
for spec in dec.get('cartParks', []):
    infra.append({'type': 'Feature', 'id': spec['id'], 'properties': {'kind': 'cart_park', 'count': spec['count'], 'fleet': spec.get('fleet'), 'sourceId': IMG,
                                                                      'provenance': spec['evidence']},
                  'geometry': {'type': 'LineString', 'coordinates': rnd(spec['line'])}})
for f in tt.load_json(ROOT / cfg['osm'])['features']:
    tags = f['properties'].get('tags') or {}
    if tags.get('golf') == 'cartpath' and f['geometry']['type'] == 'LineString':
        infra.append({'type': 'Feature', 'id': f['id'], 'properties': {'kind': 'path', 'highway': 'cartpath', 'surface': tags.get('surface', 'asphalt'),
                                                                      'width': float(tags.get('width', dec['cartPathWidth'])), 'sourceId': 'osm-odbl-2026-11-26'},
                      'geometry': {'type': 'LineString', 'coordinates': rnd(f['geometry']['coordinates'])}})
tt.write_json(HERE / 'infrastructure.geojson', tt.collection(infra, status='traced-awaiting-review'))
kinds = {}
for f in infra:
    key = f['properties']['kind'] + '/' + str(f['properties'].get('material') or f['properties'].get('style') or '')
    kinds[key] = kinds.get(key, 0) + round(shape(f['geometry']).length)
print('infrastructure metres', kinds)
