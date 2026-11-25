#!/usr/bin/env python3
"""Where has the canopy changed since the laser was flown? Trees planted or grown up, and trees felled.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen python \
        tools/tree-pipeline/canopy-change.py --ground <id>

The laser places the trees, and at many grounds it was flown years ago. The surfaces matched from later aerial
photos show what has changed. A surface matched from photos fails in its own ways (an isolated tree may not be
matched, a shadow or a roof edge may stand up), so a change is called only where two photo flights agree:

- **new**: canopy of at least 4 m in the newest leafy surface where the laser saw under 1 m and the leafy surface
  flown before the laser (2019 at Bro Hof) saw under 1 m too;
- **gone**: canopy of at least 5 m in the laser where the newest leafy surface sees under 1.5 m but the leafy
  surface before the laser saw at least half the laser's height (so the photos could match this tree then).

Patches smaller than 6 m² are dropped. Within the published buildings and water nothing is called. Each patch is
listed with its area, the heights that called it, and the placed trees inside it (from candidates.csv), so a later
round can add the new ones and drop the gone ones, each scored on a held-out sample. Writes canopy-change.json and
canopy-change.geojson to the tree cache's species folder; nothing here changes a placed tree.
"""
import argparse
import csv
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio import features
from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]


def load(folder, layer):
    meta = folder / f'{layer}.json'
    if not meta.exists():
        return None, None
    info = json.loads(meta.read_text(encoding='utf-8'))
    return np.fromfile(folder / f'{layer}.bin', dtype='<f4').reshape(info['height'], info['width']), info


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ground', required=True)
    ap.add_argument('--newest', type=int, default=2025)
    ap.add_argument('--before', type=int, default=2019)
    args = ap.parse_args()
    config = json.loads((ROOT / f'course-workflows/{args.ground}/trees.json').read_text(encoding='utf-8'))
    rasters = ROOT / config['cacheDir'] / 'rasters'
    out = ROOT / config['cacheDir'] / 'species'
    out.mkdir(parents=True, exist_ok=True)
    laser, info = load(rasters, 'chm-pitfree-050')
    newest, _ = load(rasters, f'chm-photo-{args.newest}-050')
    before, _ = load(rasters, f'chm-photo-{args.before}-050')
    if laser is None or newest is None or before is None:
        raise SystemExit('needs chm-pitfree-050 and the photo surfaces of both years (tools/tree-pipeline/surface-models.mjs)')
    s = info['sampleSpacingMetres']
    transform = rasterio.transform.from_origin(info['originEasting'], info['originNorthing'], s, s)
    shape_ = laser.shape
    # buildings and water: no canopy change is called inside them
    blocked = np.zeros(shape_, dtype=bool)
    index = json.loads((ROOT / 'apps/golf/public/courses/index.json').read_text(encoding='utf-8'))['courses']
    for build in {c['build'] for c in index if c['slug'] in config['courseSlugs']}:
        for name, grow in (('water.geojson', 2.0), ('context.geojson', 1.5)):
            file = ROOT / build / 'mapping' / name
            if not file.exists():
                continue
            geoms = []
            for f in json.loads(file.read_text(encoding='utf-8'))['features']:
                tags = f['properties'].get('tags') or {}
                if name == 'water.geojson' or tags.get('building'):
                    g = shape(f['geometry'])
                    if g.geom_type in ('Polygon', 'MultiPolygon'):
                        geoms.append(g.buffer(grow))
            if geoms:
                blocked |= features.rasterize([(g, 1) for g in geoms], out_shape=shape_, transform=transform, fill=0).astype(bool)
    L, N, B = np.nan_to_num(laser, nan=0.0), np.nan_to_num(newest, nan=-1.0), np.nan_to_num(before, nan=-1.0)
    new = (N >= 4) & (L < 1) & (B >= 0) & (B < 1) & ~blocked
    gone = (L >= 5) & (N >= 0) & (N < 1.5) & (B >= 0.5 * L) & ~blocked
    placed = []
    with open(ROOT / config['reviewDir'] / 'candidates.csv', encoding='utf-8') as fh:
        for c in csv.DictReader(fh):
            if c['decision'] in ('add', 'adjust', 'retain', 'merge'):
                placed.append((c['id'], Point(float(c['easting']), float(c['northing']))))
    patches = []
    for kind, mask in (('new', new), ('gone', gone)):
        for geom, value in features.shapes(mask.astype(np.uint8), mask=mask, transform=transform, connectivity=8):
            poly = shape(geom).buffer(0)
            if poly.area < 6:
                continue
            window = features.geometry_mask([geom], out_shape=shape_, transform=transform, invert=True)
            inside = [tid for tid, p in placed if poly.buffer(0.5).contains(p)]
            c = poly.representative_point()
            patches.append(dict(kind=kind, at=[round(c.x, 1), round(c.y, 1)], areaM2=round(poly.area, 1),
                                laserTop=round(float(L[window].max()), 1), newestTop=round(float(N[window].max()), 1), beforeTop=round(float(B[window].max()), 1),
                                placedTrees=inside, geometry=poly.simplify(0.25)))
    record = dict(schemaVersion=1, kind='canopy-change', groundId=args.ground, laser=config['laser'].get('label'), newest=args.newest, before=args.before,
                  rules=dict(new='newest leafy surface >= 4 m, laser < 1 m, earlier leafy surface < 1 m', gone='laser >= 5 m, newest leafy surface < 1.5 m, earlier leafy surface >= half the laser',
                             minimumAreaM2=6, blocked='published buildings (1.5 m) and water (2 m)'),
                  counts={k: sum(1 for p in patches if p['kind'] == k) for k in ('new', 'gone')},
                  areaM2={k: round(sum(p['areaM2'] for p in patches if p['kind'] == k), 1) for k in ('new', 'gone')},
                  goneWithPlacedTrees=sum(len(p['placedTrees']) for p in patches if p['kind'] == 'gone'),
                  newWithoutPlacedTree=sum(1 for p in patches if p['kind'] == 'new' and not p['placedTrees']),
                  patches=[{k: v for k, v in p.items() if k != 'geometry'} for p in patches])
    (out / 'canopy-change.json').write_text(json.dumps(record, indent=1) + '\n', encoding='utf-8', newline='\n')
    fc = dict(type='FeatureCollection', features=[dict(type='Feature', properties={k: v for k, v in p.items() if k not in ('geometry', 'placedTrees')} | {'placed': len(p['placedTrees'])},
                                                       geometry=p['geometry'].__geo_interface__) for p in patches])
    (out / 'canopy-change.geojson').write_text(json.dumps(fc) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({k: v for k, v in record.items() if k != 'patches'}, indent=1))


if __name__ == '__main__':
    main()
