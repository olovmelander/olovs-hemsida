#!/usr/bin/env python3
"""A sample of placed trees to name the species of, by eye: the truth a species rule is held to.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen python \
        tools/tree-pipeline/species-sample.py --ground <id> [--count 200] [--compare <leafless photo.tif>]

No ground had one: the reference crowns say conifer or broadleaf, never which. This draws the sample from the placed
trees (species-evidence.csv), spread over what the trees are called (conifer, broadleaf, unknown), where they stand
(near play, woodland) and whether the species map counts them as forest, so no kind of tree is left out. Each tree
is split into calibration or evaluation by the 150 m block it stands in, so neighbours never sit on both sides.

For each tree it draws three panels, 30 m across with the crown's circle and a 5 m grid: the summer photo in
natural colour and in colour infrared (a conifer is darker in infrared than a broadleaf), and the leafless photo
(a broadleaf crown is bare). Nothing on a panel says what any rule called the tree: the panels are for a blind
look, first by an agent (.claude/agents/species-reviewer.md), then by the owner on a page
(tools/tree-pipeline/species-check-page.mjs). The panels are crops of the photos: they stay in the private cache.
The sample itself (ids, positions, roles) is written to the review folder and kept in git, so it cannot drift.
"""
import argparse
import csv
import hashlib
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages/course-geo/mapping'))
from photo_views import Imagery, crop, draw_grid, font, pixel  # noqa: E402

SPAN, SIZE = 30.0, 260


def stable(text):
    return int(hashlib.sha256(text.encode()).hexdigest()[:12], 16)


def stratum(row):
    forest = 'forest' if row.get('nmdForest') == '1' else 'open'
    return f"{row['type'] or 'unknown'}|{row['play']}|{forest}"


def pick(rows, count, covered):
    """Deterministic, spread over strata: each stratum gets its share of the count, at least four where it has them.
    A tree that either photo does not fully cover is passed over for the next one of its stratum."""
    by = {}
    for row in rows:
        by.setdefault(stratum(row), []).append(row)
    for members in by.values():
        members.sort(key=lambda r: stable(r['id']))
    total = sum(len(m) for m in by.values())
    quota = {k: max(min(4, len(m)), round(count * len(m) / total)) for k, m in by.items()}
    while sum(quota.values()) > count:
        k = max(quota, key=lambda k: quota[k] - min(4, len(by[k])))
        quota[k] -= 1
    chosen = []
    for k, members in sorted(by.items()):
        taken = 0
        for row in members:
            if taken == quota[k]:
                break
            if covered(row):
                chosen.append(row)
                taken += 1
    return chosen


def panel(imagery, e, n, radius, infrared=False):
    box = (e - SPAN / 2, n - SPAN / 2, e + SPAN / 2, n + SPAN / 2)
    im = crop(imagery, box, SIZE, infrared=infrared)
    d = ImageDraw.Draw(im)
    draw_grid(d, box, SIZE, 5, labels_every=99)
    r = max(1.5, radius) * SIZE / SPAN
    cx, cy = pixel((e, n), box, SIZE)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 235, 60), width=2)
    return im


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ground', required=True)
    ap.add_argument('--count', type=int, default=200)
    ap.add_argument('--compare', type=Path, nargs='+', required=True, help='the leafless photo(s) (GeoTIFF RGBI)')
    ap.add_argument('--summer', type=Path, nargs='*', help='the summer photo(s); default: the trace configuration\'s')
    args = ap.parse_args()
    config = json.loads((ROOT / f'course-workflows/{args.ground}/trees.json').read_text(encoding='utf-8'))
    cache = ROOT / config['cacheDir'] / 'species'
    review = ROOT / config['reviewDir']
    rows = list(csv.DictReader(open(cache / 'species-evidence.csv', encoding='utf-8')))
    rows = [r for r in rows if float(r['objectHeightMetres'] or 0) >= 4]
    summer_paths = args.summer
    if not summer_paths:
        builds = [c['build'] for c in json.loads((ROOT / 'apps/golf/public/courses/index.json').read_text(encoding='utf-8'))['courses'] if c['slug'] in config['courseSlugs']]
        trace = next(ROOT / b / 'mapping/trace-config.json' for b in builds if (ROOT / b / 'mapping/trace-config.json').exists())
        summer_paths = [ROOT / p for p in json.loads(trace.read_text(encoding='utf-8'))['imagery']['rasters']]
    summer, leafless = Imagery(summer_paths), Imagery([p.resolve() for p in args.compare])

    def covered(row):
        e, n = float(row['easting']), float(row['northing'])
        box = (e - SPAN / 2, n - SPAN / 2, e + SPAN / 2, n + SPAN / 2)
        return all(imagery.read(*box, 1.0)[1].mean() >= 0.98 for imagery in (summer, leafless))

    sample = pick(rows, args.count, covered)
    panels = cache / 'sample'
    panels.mkdir(parents=True, exist_ok=True)
    out = []
    for i, row in enumerate(sorted(sample, key=lambda r: stable('order' + r['id'])), 1):
        e, n, radius = float(row['easting']), float(row['northing']), float(row['radiusMetres'] or 2)
        sid = f'S{i:03d}'
        block = f"{math.floor(e / 150)}:{math.floor(n / 150)}"
        role = 'calibration' if stable(f'{args.ground}:{block}') % 2 == 0 else 'evaluation'
        tiles = [panel(summer, e, n, radius), panel(summer, e, n, radius, infrared=True), panel(leafless, e, n, radius)]
        sheet = Image.new('RGB', (SIZE * 3 + 8, SIZE + 20), (20, 20, 20))
        for k, t in enumerate(tiles):
            sheet.paste(t, (k * (SIZE + 4), 0))
        ImageDraw.Draw(sheet).text((4, SIZE + 3), f'{sid}   summer   ·   summer, infrared   ·   leafless   ·   30 m, grid 5 m, height {float(row["objectHeightMetres"]):.0f} m',
                                   fill=(255, 235, 120), font=font(12))
        sheet.save(panels / f'{sid}.jpg', quality=90)
        out.append(dict(sampleId=sid, treeId=row['id'], easting=e, northing=n, heightMetres=float(row['objectHeightMetres']), radiusMetres=radius, role=role, block=block, stratum=stratum(row)))
    # contact sheets of 12 for the blind reviewer
    for k in range(0, len(out), 12):
        tiles = [Image.open(panels / f"{s['sampleId']}.jpg") for s in out[k:k + 12]]
        w, h = tiles[0].size
        sheet = Image.new('RGB', (w * 2 + 6, (h + 6) * math.ceil(len(tiles) / 2)), (40, 40, 40))
        for j, t in enumerate(tiles):
            sheet.paste(t, ((j % 2) * (w + 6), (j // 2) * (h + 6)))
        sheet.save(panels / f'sheet-{k // 12 + 1:02d}.jpg', quality=88)
    record = dict(schemaVersion=1, kind='species-sample', groundId=args.ground, reviewId=config['reviewId'], drawnFrom='species-evidence.csv (placed trees 4 m and taller)',
                  count=len(out), roles={r: sum(1 for s in out if s['role'] == r) for r in ('calibration', 'evaluation')},
                  strata={k: sum(1 for s in out if s['stratum'] == k) for k in sorted({s['stratum'] for s in out})},
                  photos=dict(summer=[str(p).replace('\\', '/').split('olovs-hemsida/')[-1] for p in summer_paths], leafless=[p.name for p in args.compare]),
                  sample=out)
    (review / 'species-sample.json').write_text(json.dumps(record, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({k: v for k, v in record.items() if k != 'sample'}, indent=1))


if __name__ == '__main__':
    main()
