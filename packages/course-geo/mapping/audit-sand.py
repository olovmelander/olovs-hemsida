#!/usr/bin/env python3
"""IS ALL THE SAND IN THE MODEL, AND IS THE MODEL'S SAND SAND?

A look at every ring says whether each line is right. It cannot say what has no line. This reads the tracing photo
round every hole and measures both ways:

- bright sand on the photo that no bunker or waste area of the model holds, each with what the map has there
  (a road, a roof, a shore, a practice surface, or nothing): a bunker that was missed is in this list, among the
  bedrock, the gravel and the building sites;
- for every bunker and waste area of the model, how much of it is sand on the photo, and how much sand joined to
  it lies outside its line: a line drawn inside the sand, a lobe left out, a ring on something that is not sand.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen python \
        packages/course-geo/mapping/audit-sand.py --config <build>/mapping/trace-config.json \
        [--compare <older-photo.tif> ...] [--compare-captured YYYY-MM-DD] [--reach 80] [--sheets <dir>]

It writes <build>/mapping/sand-audit.json, which is kept in git: numbers and positions, no pixels. What a person
said of an area or a ring (`node packages/course-geo/mapping/sand-audit.mjs --verdict` or `--fault`) is carried
over to the next run when the area is still there. The contact sheets of what needs a verdict are crops of the photo: they go under the
build's cache and never into git.

With an older photo (--compare) it also reads every bunker of the model on that photo: how much of it was sand
then, how much was grass, how much lay in shade. A bunker that was grass has been built or reshaped since, and
the terrain, which is older still, cannot hold its bowl: that dates the ground under a hole, which the terrain's
own record does not. The older photo has another exposure, so its sand and turf levels are read from the bunkers
and their surroundings on that photo itself (most bunkers did not change, so the medians are its own).

It uses the tracer's own definition of sand, so it shares the tracer's blind spots (sand in deep shade, sand that
is not bright): it checks what was decided about the sand the tracer could see, and that the lines hold it.
Kept free of scipy on purpose, like every looking tool.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFilter
from rasterio import features
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box as rectangle, shape
from shapely.ops import unary_union

from photo_views import ROOT, Imagery, crop, draw_grid, font, load_json, pixel

# The tracer's thresholds (turf_tracing.SAND), read at a coarser step: an audit asks whether sand is there, not where
# its edge is to the decimetre.
SAND = {
    'bunker': dict(core=lambda br, nd, w: (br > 188) & (nd < 0.02) & (w > 2) & (w < 20), grow=lambda br, nd, w: (br > 158) & (nd < 0.06),
                   res=0.2, blur=1.0, opened=1, closed=2, core_m2=3, min_m2=5, tile=400, pad=60),
    'waste_sand': dict(core=lambda br, nd, w: (br > 120) & (br < 188) & (nd < -0.12) & (w > 13), grow=lambda br, nd, w: (br > 104) & (nd < -0.02) & (w > 5),
                       res=0.5, blur=1.0, opened=1, closed=2, core_m2=120, min_m2=250, tile=500, pad=300),
}
SAND_SHARE_LINE = 0.6   # a ring with less sand inside it than this is named
SPILL_LINE_M2 = 4.0     # and so is one with this much sand joined to it outside its line,
SPILL_LINE_SHARE = 0.02 # or this share of its own area, whichever is more (a waste area is thousands of square metres)
MODEL_REACH = 30.0      # the ground round the model's own sand counts as the course too (practice bunkers)
WAS_SAND_LINE = 0.85    # a bunker with this share of sand on the older photo was there then, as it is now
WAS_GRASS_LINE = 0.10   # with this share of grass it has been built or reshaped since
SHADE_LINE = 0.30       # and with this share dark and bare the older photo cannot say (shade, wet sand, soil)
EXPLAINED_SHARE = 0.5   # an area is "on" a mapped thing when this much of it lies on it


def tidy(value):
    """Whole numbers as integers, so that the record reads the same whether Python or Node wrote it last."""
    if isinstance(value, dict):
        return {k: tidy(v) for k, v in value.items()}
    if isinstance(value, list):
        return [tidy(v) for v in value]
    return int(value) if isinstance(value, float) and value.is_integer() else value


def smooth(a, lo, hi, sigma):
    """A Gaussian blur of a float field, through 8 bits: fine for a threshold, and it needs no scipy."""
    q = np.clip((a - lo) / (hi - lo), 0, 1) * 255
    out = np.asarray(Image.fromarray(q.astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma)), np.float32)
    return out / 255 * (hi - lo) + lo


def morph(mask, opened, closed):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    for _ in range(opened):
        im = im.filter(ImageFilter.MinFilter(3))
    for _ in range(opened + closed):
        im = im.filter(ImageFilter.MaxFilter(3))
    for _ in range(closed):
        im = im.filter(ImageFilter.MinFilter(3))
    return np.asarray(im) > 127


def polygons(mask, transform):
    return [shape(g).buffer(0) for g, v in features.shapes(mask.astype(np.uint8), mask=mask, transform=transform, connectivity=8) if v]


def find_sand(imagery, area, kind):
    """Every patch of `kind` sand on the photo that touches `area`, as polygons in EPSG:3006."""
    spec = SAND[kind]
    res, tile, pad = spec['res'], spec['tile'], spec['pad']
    e0, n0, e1, n1 = area.bounds
    found = []
    for te in np.arange(math.floor(e0 / tile) * tile, e1, tile):
        for tn in np.arange(math.floor(n0 / tile) * tile, n1, tile):
            if not rectangle(te, tn, te + tile, tn + tile).intersects(area):
                continue
            img, have = imagery.read(te - pad, tn - pad, te + tile + pad, tn + tile + pad, res)
            if not have.any():
                continue
            r, g, b, nir = (img[i].astype(np.float32) for i in range(4))
            br = smooth((r + g + b) / 3, 0, 255, spec['blur'])
            nd = smooth((nir - r) / (nir + r + 1e-3), -1, 1, spec['blur'])
            warm = smooth(r - b, -128, 127, spec['blur'])
            grow = morph(have & spec['grow'](br, nd, warm), spec['opened'], spec['closed'])
            core = have & grow & spec['core'](br, nd, warm)
            if not core.any():
                continue
            transform = rasterio.transform.from_origin(te - pad, tn + tile + pad, res, res)
            cores = unary_union(polygons(core, transform))
            for p in polygons(grow, transform):
                if p.area < spec['min_m2'] or p.intersection(cores).area < spec['core_m2']:
                    continue
                c = p.representative_point()
                if te <= c.x < te + tile and tn <= c.y < tn + tile:
                    found.append(p)
    merged = unary_union(found) if found else MultiPolygon()
    parts = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
    return [p.simplify(res / 2, preserve_topology=True) for p in parts if not p.is_empty and p.area >= spec['min_m2'] and p.intersects(area)]


def before_shares(imagery, bunkers, res=0.32):
    """What each modelled bunker was on an older photo: the shares of it that were sand, grass, and neither.

    Levels are that photo's own: sand from inside the rings, turf from the ground 3 to 8 m outside them."""
    seen = []
    for m in bunkers:
        b = m['poly'].bounds
        e0, n0, e1, n1 = b[0] - 10, b[1] - 10, b[2] + 10, b[3] + 10
        img, have = imagery.read(e0, n0, e1, n1, res)
        transform = rasterio.transform.from_origin(e0, n1, res, res)
        inside = features.rasterize([(m['poly'].buffer(-0.5), 1)], out_shape=have.shape, transform=transform, fill=0).astype(bool) & have
        band = features.rasterize([(m['poly'].buffer(8).difference(m['poly'].buffer(3)), 1)], out_shape=have.shape, transform=transform, fill=0).astype(bool) & have
        if inside.sum() < 12 or band.sum() < 30:
            continue
        r, g, bl, nir = (img[i].astype(np.float32) for i in range(4))
        seen.append(dict(m=m, br=((r + g + bl) / 3)[inside], nd=((nir - r) / (nir + r + 1e-3))[inside],
                         band_br=float(np.median(((r + g + bl) / 3)[band])), band_nd=float(np.median(((nir - r) / (nir + r + 1e-3))[band]))))
    if len(seen) < 8:
        return None
    sand_br, turf_br = float(np.median([np.percentile(x['br'], 60) for x in seen])), float(np.median([x['band_br'] for x in seen]))
    sand_nd, turf_nd = float(np.median([np.percentile(x['nd'], 40) for x in seen])), float(np.median([x['band_nd'] for x in seen]))
    if sand_br - turf_br < 30:
        return None  # sand and turf cannot be told apart on this photo
    mid_br, mid_nd, dark = (sand_br + turf_br) / 2, (sand_nd + turf_nd) / 2, turf_br * 0.75
    rows = []
    for x in seen:
        was_sand = float(((x['br'] > mid_br) & (x['nd'] < mid_nd)).mean())
        was_grass = float(((x['nd'] >= mid_nd) & (x['br'] > dark)).mean())
        rows.append(dict(id=x['m']['id'], slug=x['m']['slug'], hole=x['m']['hole'], wasSand=round(was_sand, 2), wasGrass=round(was_grass, 2)))
    return dict(levels=dict(sandBrightness=round(sand_br), turfBrightness=round(turf_br), sandNdvi=round(sand_nd, 2), turfNdvi=round(turf_nd, 2)), rows=rows)


def mapped_ground(cfg, builds):
    """What the map holds that explains bright ground, as one geometry a kind."""
    kinds = {'a building': [], 'a road or a path': [], 'a shore': [], 'a practice surface': [], 'a yard, a building site or bare rock': []}
    def osm(path):
        for f in load_json(path)['features']:
            tags, g = f['properties'].get('tags') or f['properties'], shape(f['geometry'])
            if g.is_empty:
                continue
            if tags.get('building'):
                kinds['a building'].append(g.buffer(1.5))
            elif tags.get('highway') or tags.get('golf') in ('cartpath', 'path') or tags.get('railway'):
                kinds['a road or a path'].append(g.buffer(2.0 if tags.get('highway') in ('path', 'footway', 'cycleway', 'steps') or tags.get('golf') else 3.5))
            elif tags.get('amenity') == 'parking' or tags.get('landuse') in ('construction', 'industrial', 'quarry', 'farmyard', 'brownfield', 'commercial', 'residential') \
                    or tags.get('natural') in ('bare_rock', 'scree', 'shingle', 'beach', 'sand', 'rock') or tags.get('leisure') in ('pitch', 'marina', 'horse_riding') or tags.get('man_made') in ('pier', 'breakwater'):
                kinds['a yard, a building site or bare rock'].append(g if g.geom_type != 'LineString' else g.buffer(2))
    for path in [cfg.get('osm')] + [b / 'mapping' / 'context.geojson' for b in builds]:
        if path and (ROOT / path).exists():
            osm(ROOT / path)
    for b in builds:
        for name, kind, grow in [('infrastructure.geojson', 'a road or a path', 2.5), ('facilities.geojson', 'a practice surface', 1.0), ('water.geojson', 'a shore', 5.0)]:
            file = ROOT / b / 'mapping' / name
            if file.exists():
                kinds[kind] += [shape(f['geometry']).buffer(grow) for f in load_json(file)['features']]
    return {kind: unary_union(geoms) for kind, geoms in kinds.items() if geoms}


def tile_of(target, model, sources, size, label):
    b = target.bounds
    half = max(12.0, math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + 8)
    c = target.representative_point()
    box = (c.x - half, c.y - half, c.x + half, c.y + half)
    px = lambda p: pixel(p, box, size)
    out = Image.new('RGB', (size * len(sources) + 2 * (len(sources) - 1), size + 18), (0, 0, 0))
    near = [m for m in model if m.distance(target) < half * 1.5]
    for k, imagery in enumerate(sources):
        im = crop(imagery, box, size)
        d = ImageDraw.Draw(im)
        draw_grid(d, box, size, 5 if half < 30 else 10)
        for m in near:
            for ring in [m.exterior, *m.interiors]:
                d.line([px(p) for p in ring.coords], fill='white', width=1)
        for part in (target.geoms if hasattr(target, 'geoms') else [target]):
            d.line([px(p) for p in part.exterior.coords], fill=(255, 220, 0), width=2)
        out.paste(im, (k * (size + 2), 0))
    ImageDraw.Draw(out).text((3, size + 2), f'{label}  {2 * half:.0f} m', fill=(255, 235, 120), font=font(12))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', type=Path, required=True)
    ap.add_argument('--compare', type=Path, nargs='*', default=[])
    ap.add_argument('--reach', type=float, default=80.0, help='metres from a hole line that count as the course')
    ap.add_argument('--sheets', type=Path)
    ap.add_argument('--compare-captured', help='the day the first --compare photo was taken (YYYY-MM-DD)')
    args = ap.parse_args()
    cfg = load_json(args.config)
    home = Path(cfg['courses'][0]['outDir']).parent
    builds = [Path(c['outDir']).parent for c in cfg['courses']]
    imagery = Imagery([ROOT / p for p in cfg['imagery']['rasters']])
    sources = [imagery] + ([Imagery([p.resolve() for p in args.compare])] if args.compare else [])
    sheets = args.sheets.resolve() if args.sheets else ROOT / home / 'cache' / 'sand-audit'

    holes, model, surfaces_sha = [], [], {}
    for course in cfg['courses']:
        where = ROOT / course['outDir']
        surfaces_sha[course['slug']] = hashlib.sha256((where / 'playing-surfaces.geojson').read_bytes()).hexdigest()
        for f in load_json(where / 'routes.geojson')['features']:
            holes.append(dict(slug=course['slug'], hole=f['properties']['hole'], line=LineString(f['geometry']['coordinates'])))
        for f in load_json(where / 'playing-surfaces.geojson')['features']:
            kind = f['properties']['kind']
            if kind in SAND:
                model.append(dict(id=f['id'], kind=kind, slug=course['slug'], hole=f['properties'].get('hole'), poly=shape(f['geometry']).buffer(0)))
            elif kind == 'green':
                holes.append(dict(slug=course['slug'], hole=f['properties']['hole'], line=shape(f['geometry']).exterior))
    course_area = unary_union([h['line'].buffer(args.reach) for h in holes] + [m['poly'].buffer(MODEL_REACH) for m in model]).intersection(rectangle(*cfg['box']))
    mapped = mapped_ground(cfg, builds)
    previous = load_json(ROOT / home / 'mapping' / 'sand-audit.json') if (ROOT / home / 'mapping' / 'sand-audit.json').exists() else {}
    said = lambda item: {k: item[k] for k in ('verdict', 'fault') if item.get(k)}

    areas, rings, to_draw = [], [], []
    for kind in SAND:
        ours = [m for m in model if m['kind'] == kind]
        everything = unary_union([m['poly'] for m in model]) if model else MultiPolygon()
        sand = find_sand(imagery, course_area, kind)
        sand_all = unary_union(sand) if sand else MultiPolygon()
        spill = {m['id']: 0.0 for m in ours}
        for s in sand:
            held = s.intersection(everything.buffer(0.3)).area
            if held >= max(3.0, 0.2 * s.area):
                # Sand of the model: what of it lies outside every line, once slivers along the edge are dropped.
                outside = s.difference(everything.buffer(0.8)).buffer(-0.4).buffer(0.4)
                for part in (outside.geoms if hasattr(outside, 'geoms') else [outside]):
                    if part.is_empty or part.area < 2.0 or not ours:
                        continue
                    nearest = min(ours, key=lambda m: m['poly'].distance(part))
                    if nearest['poly'].distance(part) < 3.0:
                        spill[nearest['id']] += part.area
                continue
            shares = {name: s.intersection(geom).area / s.area for name, geom in mapped.items()}
            name, share = max(shares.items(), key=lambda kv: kv[1]) if shares else (None, 0.0)
            hole = min(holes, key=lambda h: h['line'].distance(s))
            c = s.representative_point()
            areas.append(dict(kind=kind, at=[round(c.x, 1), round(c.y, 1)], areaM2=round(s.area, 1), slug=hole['slug'], hole=hole['hole'], metresFromHole=round(hole['line'].distance(s), 1),
                              on=name if share >= EXPLAINED_SHARE else None, poly=s))
        for m in ours:
            share = m['poly'].intersection(sand_all).area / m['poly'].area
            if share < SAND_SHARE_LINE or spill[m['id']] >= max(SPILL_LINE_M2, SPILL_LINE_SHARE * m['poly'].area):
                old = next((r for r in previous.get('rings', []) if r['id'] == m['id']), {})
                rings.append(dict(id=m['id'], kind=kind, slug=m['slug'], hole=m['hole'], areaM2=round(m['poly'].area, 1), sandShare=round(share, 2), sandOutsideM2=round(spill[m['id']], 1), **said(old)))
                to_draw.append((m['id'], f"{m['id']}  sand {share:.0%}, {spill[m['id']]:.0f} m2 outside", m['poly']))

    areas.sort(key=lambda a: (a['on'] is not None, a['kind'], a['slug'], a['hole'], -a['at'][1], a['at'][0]))
    for i, a in enumerate(areas):
        a['id'] = f"sand-{i + 1:03d}"
        old = next((o for o in previous.get('areas', []) if o['kind'] == a['kind'] and (o.get('verdict') or o.get('fault')) and a['poly'].distance(Point(o['at'])) < 4.0), {})
        a.update(said(old))
        if a['on'] is None:
            to_draw.append((a['id'], f"{a['id']}  {a['kind']}  {a['areaM2']:.0f} m2  {a['slug'].split('-')[-1]} {a['hole']}", a['poly']))

    sheets.mkdir(parents=True, exist_ok=True)
    written, size, cols = [], 260, 3 if len(sources) > 1 else 6
    for k in range(0, len(to_draw), cols * 5):
        tiles = [tile_of(poly, [m['poly'] for m in model], sources, size, label) for _, label, poly in to_draw[k:k + cols * 5]]
        w, h = tiles[0].size
        out = Image.new('RGB', (cols * (w + 4), math.ceil(len(tiles) / cols) * (h + 4)), (30, 30, 30))
        for i, t in enumerate(tiles):
            out.paste(t, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
        written.append(sheets / f'sand-audit-{k // (cols * 5) + 1}.jpg')
        out.save(written[-1], quality=88)

    record = dict(schemaVersion=1, groundId=cfg['groundId'], imagery=dict(sourceId=cfg['imagery']['sourceId'], captured=cfg['imagery'].get('captured')),
                  reachMetres=args.reach, lines=dict(sandShare=SAND_SHARE_LINE, sandOutsideM2=SPILL_LINE_M2, sandOutsideShare=SPILL_LINE_SHARE), surfaces=surfaces_sha,
                  modelled={kind: sum(1 for m in model if m['kind'] == kind) for kind in SAND}, rings=rings,
                  areas=[{k: v for k, v in a.items() if k != 'poly'} for a in areas])
    if args.compare:
        then = before_shares(sources[1], [m for m in model if m['kind'] == 'bunker'])
        if then:
            changed = [row for row in then['rows'] if row['wasSand'] < WAS_SAND_LINE and row['wasGrass'] >= WAS_GRASS_LINE]
            shaded = [row for row in then['rows'] if row['wasSand'] < WAS_SAND_LINE and row['wasGrass'] < WAS_GRASS_LINE and 1 - row['wasSand'] - row['wasGrass'] >= SHADE_LINE]
            record['before'] = dict(captured=args.compare_captured, levels=then['levels'], lines=dict(wasSand=WAS_SAND_LINE, wasGrass=WAS_GRASS_LINE, shade=SHADE_LINE),
                                    bunkers=len(then['rows']), wasSand=sum(1 for row in then['rows'] if row['wasSand'] >= WAS_SAND_LINE), changed=changed, shaded=shaded)
    (ROOT / home / 'mapping' / 'sand-audit.json').write_text(json.dumps(tidy(record), indent=1, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    unexplained = [a for a in areas if a['on'] is None]
    print(json.dumps(dict(record=str(home / 'mapping' / 'sand-audit.json').replace('\\', '/'), modelled=record['modelled'], ringsOffTheLine=len(rings),
                          areasNotInTheModel=len(areas), ofThemOnNothingMapped=len(unexplained), needAVerdict=sum(1 for x in rings + unexplained if not (x.get('verdict') or x.get('fault'))),
                          sinceTheOlderPhoto=dict(changed=[row['id'] for row in record['before']['changed']], shaded=[row['id'] for row in record['before']['shaded']]) if 'before' in record else None,
                          sheets=[str(p.relative_to(ROOT)).replace('\\', '/') for p in written]), indent=1))


if __name__ == '__main__':
    main()
