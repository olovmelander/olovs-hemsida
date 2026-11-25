#!/usr/bin/env python3
"""Every traced ring against the photo, worst score first: the look a tracer cannot do for itself.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen \
      python packages/course-geo/mapping/render-ring-sheets.py --config <build>/mapping/trace-config.json \
        [--compare <older-photo.tif> ...] [--kinds tee,green,bunker] [--only <ring id>,...] [--out <dir>] [--blind]

A contact sheet holds 40 rings; each ring is shown on the tracing photo and, with --compare, on an older one
beside it (a deck rebuilt or a pond filled between the two shows at once). Tees and greens are ordered by
their edge score from trace-report.json, lowest first. --only draws the named rings large, with a 5 m grid.
The sheets are private (they are crops of the photo): they go under the build's cache, never into git.

--blind is for a second reviewer who has not seen the tracing: the rings come in hole order, and no score, no
source and no tee colour is printed, so nothing on the sheet says which rings the first look doubted.

Look at every sheet, then record the look with `node packages/course-geo/mapping/ring-review.mjs`.
A ring that is wrong is fixed in decisions.json and traced again, never here.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import shape

from photo_views import ROOT, Imagery, crop, draw_grid, font, largest, load_json, pixel


def tile(ring, neighbours, sources, size, grid, blind=False):
    poly = ring['poly']
    b = poly.bounds
    half = max(14.0, math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + 7)
    c = (poly.centroid.x, poly.centroid.y)
    box = (c[0] - half, c[1] - half, c[0] + half, c[1] + half)
    px = lambda p: pixel(p, box, size)
    out = Image.new('RGB', (size * len(sources) + 2 * (len(sources) - 1), size + 18), (0, 0, 0))
    for k, imagery in enumerate(sources):
        im = crop(imagery, box, size)
        d = ImageDraw.Draw(im)
        if grid:
            draw_grid(d, box, size, 5)
        for other in neighbours:
            if other is not ring and other['poly'].distance(poly) < half:
                d.line([px(p) for p in other['poly'].exterior.coords], fill=(120, 200, 255), width=1)
        d.line([px(p) for p in poly.exterior.coords], fill='white', width=2)
        for interior in poly.interiors:
            d.line([px(p) for p in interior.coords], fill='white', width=1)
        out.paste(im, (k * (size + 2), 0))
    label = f"{ring['id']}  {2 * half:.0f} m" if blind else f"{ring['id']} {'/'.join(ring['tees'])}  {ring['score']}  {2 * half:.0f} m"
    ImageDraw.Draw(out).text((3, size + 2), label, fill=(255, 235, 120), font=font(12))
    return out


def sheet(tiles, cols, path):
    w, h = tiles[0].size
    out = Image.new('RGB', (cols * (w + 4), math.ceil(len(tiles) / cols) * (h + 4)), (30, 30, 30))
    for i, t in enumerate(tiles):
        out.paste(t, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
    out.save(path, quality=88)
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', type=Path, required=True)
    ap.add_argument('--compare', type=Path, nargs='*', default=[])
    ap.add_argument('--kinds', default='tee,green,bunker')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', type=Path)
    ap.add_argument('--blind', action='store_true')
    args = ap.parse_args()
    cfg = load_json(args.config)
    sources = [Imagery([ROOT / p for p in cfg['imagery']['rasters']])] + ([Imagery(args.compare)] if args.compare else [])
    out = args.out.resolve() if args.out else ROOT / Path(cfg['courses'][0]['outDir']).parent / 'cache' / ('ring-sheets-blind' if args.blind else 'ring-sheets')
    out.mkdir(parents=True, exist_ok=True)
    only = [s for s in args.only.split(',') if s]
    written = []
    for course in cfg['courses']:
        where = ROOT / course['outDir']
        scores = {}
        for row in load_json(where / 'trace-report.json')['rows']:
            rid = row.get('id') or f"{course['prefix']}-{row['kind']}-{row['hole']:02d}"
            if 'dPrime' in row:
                scores[rid] = (row['dPrime'], row.get('kept'))
        rings = []
        for f in load_json(where / 'playing-surfaces.geojson')['features']:
            p = f['properties']
            score = scores.get(f['id'])
            rings.append(dict(id=f['id'], kind=p['kind'], hole=p.get('hole') or 0, poly=largest(shape(f['geometry'])), tees=p.get('teeIds') or [],
                              order=(score[0] if score else 99.0), score=(f"dP {score[0]}{' kept ' + score[1] if score[1] else ''}" if score else '')))
        if only:
            chosen = [r for r in rings if r['id'] in only]
            if chosen:
                written.append(sheet([tile(r, rings, sources, 440, True) for r in chosen], 2 if len(sources) == 1 else 1, out / f"{course['prefix']}-zoom.jpg"))
            continue
        for kind in args.kinds.split(','):
            chosen = sorted((r for r in rings if r['kind'] == kind), key=lambda r: (r['hole'], r['id']) if args.blind else (r['order'], r['hole'], r['id']))
            for k in range(0, len(chosen), 40):
                tiles = [tile(r, rings, sources, 190, False, args.blind) for r in chosen[k:k + 40]]
                written.append(sheet(tiles, 8 if len(sources) == 1 else 5, out / f"{course['prefix']}-{kind}-{k // 40 + 1}.jpg"))
    print(json.dumps(dict(sheets=[str(p.relative_to(ROOT)).replace('\\', '/') for p in written]), indent=1))


if __name__ == '__main__':
    main()
