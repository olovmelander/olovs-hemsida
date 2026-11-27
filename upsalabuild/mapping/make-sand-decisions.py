#!/usr/bin/env python3
"""Upsala's first sand decisions, from the tracer's own sand candidates.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen python \
        upsalabuild/mapping/make-sand-decisions.py [--write]

Reads the candidates the last trace cached (upsalabuild/cache/mapping/trace-*.npz, the newest) and the bunkers that
were already known: OSM's 80 bunkers in the club's relation and the 53 of Stora banan's reviewed model (eight of them
redrawn on the 2025 photo in September). A bunker candidate that overlaps a known bunker is kept, on the hole whose
line is nearest (of either routing). Every other candidate within 60 m of a hole line is printed with its size, so
that it can be looked at on the photo and kept or left out by hand: the list is the work, not the answer.
Without --write it only prints.

Each kept bunker's sand is measured on the photo: tan (NDVI under -0.17 and warmth over 15, as Mellanbanan's) or
white (Stora banan's). EXTRA are the bunkers no map had, kept after a look at the photo (27 November 2026).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from shapely.geometry import LineString, Point, Polygon, mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/course-geo/mapping'))
from photo_views import Imagery  # noqa: E402

EXTRA = [
    ((639465.5, 6635916.0), 'a raked fairway bunker on the left of the 7th, white sand on both photo years; in neither OSM nor the old model'),
    ((639812.9, 6636141.8), "the upper of a pair of raked fairway bunkers on the 18th, white sand on both photo years; in neither OSM nor the old model"),
    ((639815.5, 6636123.7), "the lower of the pair of fairway bunkers on the 18th, white sand on both photo years; in neither OSM nor the old model"),
]


def material(imagery, poly):
    b, res = poly.bounds, 0.16
    arr, have = imagery.read(b[0], b[1], b[2] + res, b[3] + res, res)
    mask = ~geometry_mask([mapping(poly)], out_shape=have.shape, transform=from_origin(b[0], b[3] + res, res, res)) & have
    r, bl, nir = (arr[k].astype(np.float32)[mask] for k in (0, 2, 3))
    ndvi, warm = float(np.median((nir - r) / np.maximum(nir + r, 1))), float(np.median(r - bl))
    return 'tan-sand' if ndvi < -0.17 and warm > 15 else 'white-sand'

ROOT = Path(__file__).resolve().parents[2]


def load(p):
    return json.loads((ROOT / p).read_text(encoding='utf-8'))


def lines_of(decisions):
    out = []
    for key, hole in decisions['holes'].items():
        back = hole['pads'][0]
        start = Polygon(back['ring']).centroid.coords[0] if back['src'] == 'ring' else tuple(back.get('c') or back['at'])
        g = Polygon(hole['green']['ring']).centroid.coords[0]
        out.append((int(key), LineString([start, *[tuple(b) for b in hole['bends']], g]), Polygon(hole['green']['ring'])))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    cfg = load('upsalabuild/mapping/trace-config.json')
    npz = max((ROOT / 'upsalabuild/cache/mapping').glob('trace-*.npz'), key=lambda p: p.stat().st_mtime)
    z = np.load(npz, allow_pickle=False)
    cands = [dict(kind=k, polygon=shape(g)) for k, g in json.loads(str(z['sand']))]
    routings = [(c['slug'], lines_of(load(c['decisions']))) for c in cfg['courses']]
    known = []
    for f in load(cfg['osm'])['features']:
        if f['properties'].get('tags', {}).get('golf') == 'bunker':
            known.append(('osm', f['id'], shape(f['geometry'])))
    model = load('geo_data/course-v2/upsala/migration/course-model.epsg3006.json')['geometry']
    for h in model['holes']:
        for b in h.get('bunkers') or []:
            known.append(('stora-model', f"h{h['n']}", Polygon(b['ring'])))

    def nearest_hole(poly):
        best = None
        for slug, lines in routings:
            for n, line, green in lines:
                d = min(line.distance(poly.centroid), green.distance(poly.centroid))
                if best is None or d < best[0]:
                    best = (d, slug, n)
        return best

    imagery = Imagery([ROOT / r for r in cfg['imagery']['rasters']])
    keep, unknown, known_hit = [], [], set()
    extra = {}
    for at, why in EXTRA:
        j = min(range(len(cands)), key=lambda k: cands[k]['polygon'].centroid.distance(Point(at)))
        if cands[j]['polygon'].centroid.distance(Point(at)) > 1.5:
            raise SystemExit(f'no candidate at {at}')
        extra[j] = why
    for i, c in enumerate(cands):
        p = c['polygon']
        if c['kind'] != 'bunker':
            d, slug, n = nearest_hole(p)
            if d < 60:
                unknown.append((i, c['kind'], round(p.area), round(p.centroid.x, 1), round(p.centroid.y, 1), slug, n, round(d)))
            continue
        hits = [(src, ident) for src, ident, k in known if k.intersects(p) and k.intersection(p).area > 0.25 * min(k.area, p.area)]
        d, slug, n = nearest_hole(p)
        if i in extra:
            keep.append(dict(at=[round(p.centroid.x, 1), round(p.centroid.y, 1)], kind='bunker', course=slug, hole=n,
                             material=material(imagery, p), areaM2=round(p.area, 1), why=extra[i]))
        elif hits:
            known_hit.update(hits)
            keep.append(dict(at=[round(p.centroid.x, 1), round(p.centroid.y, 1)], kind='bunker', course=slug, hole=n,
                             material=material(imagery, p), areaM2=round(p.area, 1),
                             why=f"the raked sand of {', '.join(sorted({f'{s} {i}' for s, i in hits}))}, {d:.0f} m from the {n} line"))
        elif d < 60 and p.area >= 6:
            unknown.append((i, 'bunker', round(p.area), round(p.centroid.x, 1), round(p.centroid.y, 1), slug, n, round(d)))
    missed = [(s, i, round(k.area), round(k.centroid.x, 1), round(k.centroid.y, 1)) for s, i, k in known if (s, i) not in known_hit]
    print(f'{len(cands)} candidates; kept {len(keep)} that overlap a known bunker')
    print(f'{len(missed)} known bunkers with no candidate:')
    for m in missed:
        print('   ', m)
    print(f'{len(unknown)} other candidates within 60 m of a line (index, kind, m2, E, N, routing, hole, metres):')
    for u in sorted(unknown, key=lambda u: -u[2]):
        print('   ', u)
    if args.write:
        doc = load('upsalabuild/mapping/sand-decisions.json')
        doc['keep'] = keep
        (ROOT / 'upsalabuild/mapping/sand-decisions.json').write_text(json.dumps(doc, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        print('wrote upsalabuild/mapping/sand-decisions.json')


if __name__ == '__main__':
    main()
