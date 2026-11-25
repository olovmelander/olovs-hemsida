#!/usr/bin/env python3
"""What every placed tree, and every reference crown, looks like to each source: the evidence a species is called on.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen python \
        tools/tree-pipeline/species-evidence.py --ground <id> [--out <dir>]

For each point (a placed tree from the review's candidates.csv, or a reference crown from reference.geojson) it reads:

- the laser canopy model (leaf-off at Bro Hof): its top;
- the surface matched from each aerial photo flight that has been fetched (tools/tree-pipeline/surface-models.mjs),
  as height above ground: its top, and how much of the crown stands at least half the top's height. A broadleaf
  crown in leaf stands solid; leafless, the photos match its twigs badly and much of it sinks. A conifer stands in
  both. So leafless/leafy fill is near 1 for a conifer and well under it for a broadleaf;
- the shape of the top in the leafy surface, and in the laser canopy: how far the surface falls from the top within
  1.5 m, as a share of the height. A spruce's top is a spire, a pine's is flat or rounded;
- Naturvårdsverket's species map (geo_data/course-v2/<ground>/vegetation/nmd2023-tradslag.tif) at the point's 10 m
  cell: the crown cover of pine, spruce, ordinary broadleaf and noble broadleaf (beech, oak and the rest), or none
  where the cell is not forest land (most of a course's own trees);
- the distance to the nearest water (alder grows by water).

Writes species-evidence.csv (one row a placed tree) and reference-evidence.csv (one row a reference crown) to the
review's cache folder. Numbers only; nothing here decides.
"""
import argparse
import csv
import json
from pathlib import Path

import numpy as np
import rasterio
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]


def load_raster(folder, layer):
    meta = folder / f'{layer}.json'
    if not meta.exists():
        return None
    info = json.loads(meta.read_text(encoding='utf-8'))
    data = np.fromfile(folder / f'{layer}.bin', dtype='<f4').reshape(info['height'], info['width'])
    return dict(info=info, data=data)


def disc(raster, e, n, radius):
    """The raster's cells whose centres lie within `radius` of (e, n), as a flat array (NaN kept)."""
    info, data = raster['info'], raster['data']
    s = info['sampleSpacingMetres']
    c = (e - info['originEasting']) / s - 0.5
    r = (info['originNorthing'] - n) / s - 0.5
    k = int(np.ceil(radius / s)) + 1
    r0, r1, c0, c1 = int(max(0, np.floor(r) - k)), int(min(info['height'], np.ceil(r) + k + 1)), int(max(0, np.floor(c) - k)), int(min(info['width'], np.ceil(c) + k + 1))
    if r0 >= r1 or c0 >= c1:
        return np.array([], dtype=np.float32), np.array([]), np.array([])
    rr, cc = np.mgrid[r0:r1, c0:c1]
    dist = np.hypot((cc - c) * s, (rr - r) * s)
    keep = dist <= radius
    return data[r0:r1, c0:c1][keep], dist[keep], np.stack([rr[keep], cc[keep]], axis=1)


def top_of(raster, e, n, search=1.5):
    values, _, cells = disc(raster, e, n, search)
    if not values.size or not np.isfinite(values).any():
        return None, None
    i = int(np.nanargmax(values))
    info = raster['info']
    s = info['sampleSpacingMetres']
    rr, cc = cells[i]
    return float(values[i]), (info['originEasting'] + (cc + 0.5) * s, info['originNorthing'] - (rr + 0.5) * s)


def fill(raster, e, n, radius, top):
    """Share of the crown disc standing at least half the top's height (cells with no match count as not standing)."""
    values, _, _ = disc(raster, e, n, radius)
    if not values.size or top is None or top <= 0:
        return None
    return float(np.mean(np.nan_to_num(values, nan=0.0) >= 0.5 * top))


def spire(raster, e, n, top):
    """How far the surface falls from the top within 1.5 m of it, as a share of the top's height (median of the 1-1.5 m ring)."""
    values, dist, _ = disc(raster, e, n, 1.5)
    ring = values[(dist >= 1.0) & np.isfinite(values)]
    if top is None or top <= 0 or ring.size < 4:
        return None
    return float((top - np.median(ring)) / top)


def r3(value):
    return None if value is None or not np.isfinite(value) else round(float(value), 3)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ground', required=True)
    ap.add_argument('--out', type=Path)
    args = ap.parse_args()
    config = json.loads((ROOT / f'course-workflows/{args.ground}/trees.json').read_text(encoding='utf-8'))
    review = ROOT / config['reviewDir']
    rasters = ROOT / config['cacheDir'] / 'rasters'
    out = args.out or (ROOT / config['cacheDir'] / 'species')
    out.mkdir(parents=True, exist_ok=True)
    laser = load_raster(rasters, 'chm-pitfree-050')
    photos = {year: r for year in (2025, 2023, 2021, 2019) if (r := load_raster(rasters, f'chm-photo-{year}-050'))}
    leafy = next((photos[y] for y in (2025, 2019, 2023) if y in photos), None)
    leafless = photos.get(2021)
    nmd_path = ROOT / f'geo_data/course-v2/{args.ground}/vegetation/nmd2023-tradslag.tif'
    nmd = rasterio.open(nmd_path) if nmd_path.exists() else None
    nmd_data = nmd.read() if nmd else None
    nmd_bands = list(nmd.descriptions) if nmd else []  # named in the file: tall, gran, lark, trivial, adel, bok, ekovradel, osakerklassning
    waters = []
    for build in {c['build'] for c in json.loads((ROOT / 'apps/golf/public/courses/index.json').read_text(encoding='utf-8'))['courses'] if c['slug'] in config['courseSlugs']}:
        file = ROOT / build / 'mapping' / 'water.geojson'
        if file.exists():
            waters += [shape(f['geometry']).boundary for f in json.loads(file.read_text(encoding='utf-8'))['features']]
    water_tree = STRtree(waters) if waters else None

    def row_for(e, n, radius):
        row = {}
        laser_top, laser_at = top_of(laser, e, n) if laser else (None, None)
        row['laserTop'] = r3(laser_top)
        # the same spire on the laser canopy (leafless at Bro Hof, 2 first returns a square metre: coarser than a photo surface)
        row['spireLaser'] = r3(spire(laser, *laser_at, laser_top)) if laser_at and laser_top and laser_top > 2 else None
        for year, raster in sorted(photos.items(), reverse=True):
            t, _ = top_of(raster, e, n)
            row[f'top{year}'] = r3(t)
        crown = max(1.5, min(4.0, 0.6 * radius)) if radius else 2.5
        if leafy and leafless:
            t_leafy, at = top_of(leafy, e, n)
            if t_leafy and t_leafy > 2 and at:
                f_leafy, f_leafless = fill(leafy, *at, crown, t_leafy), fill(leafless, *at, crown, t_leafy)
                row['fillLeafy'], row['fillLeafless'] = r3(f_leafy), r3(f_leafless)
                row['leaflessShare'] = r3(f_leafless / f_leafy) if f_leafy else None
                row['spire'] = r3(spire(leafy, *at, t_leafy))
        if nmd is not None:
            rr, cc = nmd.index(e, n)
            if 0 <= rr < nmd.height and 0 <= cc < nmd.width:
                values = nmd_data[:, rr, cc]
                forest = values[0] != 255
                row['nmdForest'] = int(forest)
                for i, name in enumerate(nmd_bands):
                    row[f'nmd_{name}'] = int(values[i]) if forest else None
        if water_tree is not None:
            p = Point(e, n)
            nearest = water_tree.nearest(p)
            row['waterMetres'] = r3(waters[nearest].distance(p))
        return row

    placed, rows = {'add', 'adjust', 'retain', 'merge'}, []
    with open(review / 'candidates.csv', encoding='utf-8') as fh:
        for c in csv.DictReader(fh):
            if c['decision'] not in placed:
                continue
            e, n, radius = float(c['easting']), float(c['northing']), float(c['radiusMetres'] or 0)
            rows.append(dict(id=c['id'], play=c['play'], type=c['type'], typeConfidence=c['typeConfidence'], easting=e, northing=n,
                             objectHeightMetres=c['objectHeightMetres'], radiusMetres=radius, **row_for(e, n, radius)))
    reference = []
    ref_file = review / 'reference.geojson'
    if ref_file.exists():
        for f in json.loads(ref_file.read_text(encoding='utf-8'))['features']:
            p = f['properties']
            if p.get('easting') is None:
                continue  # a reference feature that is not a crown (a window outline)
            e, n = p['easting'], p['northing']
            reference.append(dict(id=p['id'], window=p['window'], role=p['role'], type=p['type'], stratum=p.get('stratum'), heightMetres=p.get('heightMetres'),
                                  scored=p.get('scored'), easting=e, northing=n, **row_for(e, n, None)))
    for name, table in (('species-evidence.csv', rows), ('reference-evidence.csv', reference)):
        if not table:
            continue
        columns = list(dict.fromkeys(k for r in table for k in r))
        with open(out / name, 'w', encoding='utf-8', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=columns)
            w.writeheader()
            w.writerows(table)
    summary = dict(placed=len(rows), reference=len(reference), photoYears=sorted(photos), nmd=nmd is not None, waters=len(waters),
                   inForest=sum(1 for r in rows if r.get('nmdForest') == 1), out=str(out.relative_to(ROOT)).replace('\\', '/'))
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()
