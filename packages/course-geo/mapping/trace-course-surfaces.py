#!/usr/bin/env python3
"""Trace every course of one ground from its reviewed decisions files.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen \
      python packages/course-geo/mapping/trace-course-surfaces.py --config brohofbuild/mapping/trace-config.json

Writes, per course, EPSG:3006 `routes.geojson`, `playing-surfaces.geojson` and
`trace-report.json` (edge statistics, card-length residuals, what each outline
started from). Deterministic: same imagery, terrain and decisions give the same
bytes. Every output keeps `status: traced-awaiting-review` until a reviewer says
otherwise; nothing is warped to reach a card length.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from rasterio.features import rasterize
from scipy import ndimage as nd
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import turf_tracing as tt  # noqa: E402

TURF_RES = 0.4


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def osm_index(path):
    out = {}
    for f in tt.load_json(path)['features']:
        out[f['id']] = (f['properties'].get('tags') or {}, shape(f['geometry']))
    return out


def train_turf(imagery, box, osm, routes, res):
    """Train on the flight's own verified Stadium-style outlines (greens, fairways) and the rough beside them."""
    img, tr, have = imagery.read(*box, res)
    feats = tt.turf_features(img, res)
    veg = tt.vegetated(feats) & have
    shp = have.shape
    rast = lambda g: rasterize([(g, 1)], out_shape=shp, transform=tr, fill=0, dtype=np.uint8).astype(bool) if not g.is_empty else np.zeros(shp, bool)
    by = lambda k: [g for t, g in osm.values() if t.get('golf') == k and g.geom_type == 'Polygon']
    near = unary_union([r.buffer(60) for r in routes])
    greens = unary_union([p for p in by('green') if near.contains(p)])
    fairways = unary_union([p for p in by('fairway') if sum(p.intersection(r).length for r in routes) > 20])
    paths = unary_union([g.buffer(4) for t, g in osm.values() if t.get('golf') == 'cartpath'])
    keepout = unary_union([greens.buffer(6), fairways.buffer(4), unary_union(by('bunker')).buffer(2),
                           unary_union(by('water_hazard')).buffer(3), unary_union(by('tee')).buffer(3), paths])
    masks = [rast(greens.buffer(-1.5)), rast(fairways.difference(greens.buffer(3)).buffer(-3)),
             rast(unary_union([r.buffer(55) for r in routes]).difference(keepout)) & veg & ((feats[4] + feats[5] + feats[6]) / 3 > 62)]
    rng = np.random.default_rng(1)
    flat = feats.reshape(feats.shape[0], -1)
    samples = []
    for m, n in zip(masks, (9000, 16000, 16000)):
        i = np.flatnonzero(m.ravel())
        samples.append(flat[:, rng.choice(i, min(n, len(i)), replace=False)].T)
    model = tt.TurfModel().fit(samples)
    prob = model.predict(feats) * veg
    return prob, tr, model.accuracy


def component_at(mask, tr, seed, cap=32):
    inv = ~tr
    c, r = inv * seed
    yy, xx = np.ogrid[:mask.shape[0], :mask.shape[1]]
    disc = ((xx - c) ** 2 + (yy - r) ** 2) * tr.a ** 2 < cap ** 2
    lab, _ = nd.label(mask & disc)
    near = ((xx - c) ** 2 + (yy - r) ** 2) * tr.a ** 2 < 8 ** 2
    ids, counts = np.unique(lab[near & (lab > 0)], return_counts=True)
    if not len(ids):
        raise SystemExit(f'no classified component at seed {seed}')
    return lab == ids[counts.argmax()]


def along_route(route, p):
    line = LineString(route)
    return line.length - line.project(Point(p))


def remaining(route, p):
    """Playing distance from p to the green: to the next bend still ahead, then along the route."""
    line = LineString(route)
    s = line.project(Point(p))
    cum, best = 0.0, None
    pts = [np.array(q) for q in route]
    for i in range(1, len(pts)):
        cum += np.hypot(*(pts[i] - pts[i - 1]))
        if cum > s + 25 or i == len(pts) - 1:
            best = i
            break
    d = math.hypot(*(pts[best] - np.array(p)))
    for i in range(best + 1, len(pts)):
        d += math.hypot(*(pts[i] - pts[i - 1]))
    return d


def place_mark(pad, route, want):
    """A point on the pad, 1.2 m inside its edge, whose playing distance is nearest the card's."""
    inner = pad.buffer(-1.2)
    inner = tt.largest(inner) or tt.largest(pad.buffer(-0.5)) or pad
    c = inner.representative_point() if not inner.contains(inner.centroid) else inner.centroid
    nxt = np.array(route[1], float)
    d = nxt - np.array([c.x, c.y])
    d /= np.hypot(*d)
    ray = LineString([(c.x - d[0] * 60, c.y - d[1] * 60), (c.x + d[0] * 60, c.y + d[1] * 60)]).intersection(inner)
    if ray.is_empty:
        return (c.x, c.y)
    if ray.geom_type != 'LineString':
        ray = max(ray.geoms, key=lambda g: g.length)
    best = min((ray.interpolate(t) for t in np.linspace(0, ray.length, 81)), key=lambda q: abs(remaining(route, (q.x, q.y)) - want))
    return (best.x, best.y)


def trace_course(course, ctx):
    imagery, osm, prob, tr, platforms, sand = (ctx[k] for k in ('imagery', 'osm', 'prob', 'tr', 'platforms', 'sand'))
    dec = tt.load_json(course['decisions'])
    card = tt.load_json(course['card'])
    rows = {h['number']: h for h in card['holes']}
    order = [t['id'] for t in card['tees']]
    greens_mask = nd.binary_closing(prob[0] > 0.4, iterations=3)
    features, routes, report = [], [], []
    greens, pads_by_hole, route_lines = {}, {}, {}
    for key in sorted(dec['holes'], key=int):
        n, hole = int(key), dec['holes'][key]
        g = hole['green']
        if 'seed' in g:
            m = nd.binary_fill_holes(component_at(greens_mask, tr, tuple(g['seed'])))
            m = nd.binary_opening(m, iterations=3)
            start = tt.largest(unary_union(tt.polygon_from_mask(m, tr, 60)).buffer(1.5).buffer(-1.5).buffer(-1).buffer(1))
            src = 'classified-component'
        elif isinstance(g['ring'], str):
            start, src = tt.largest(osm[g['ring'].split(':', 1)[1]][1]), g['ring']
        else:
            start, src = Polygon(g['ring']), 'reviewed-ring'
        poly, st = tt.refine_ring(imagery, start, g.get('reach', 3.0), avoid=ctx['bunkerAvoid'], smooth_m=0.8, stiffness=1.0)
        if poly is None or st['dPrime'] < 0.8:
            poly, st = start, {**st, 'kept': 'start'}
        greens[n] = poly
        features.append(tt.feature(f"{course['prefix']}-green-{n:02d}", 'green', poly, hole=n, sourceId=ctx['imageId'], start=src, edge=st))
        report.append(dict(hole=n, kind='green', start=src, area=round(poly.area, 1), **st))
        pads = []
        for k, spec in enumerate(hole['pads'], 1):
            if spec['src'] == 'osm':
                start, src = tt.largest(osm[spec['id']][1]), f"osm:{spec['id']}"
            elif spec['src'] == 'ellipse':
                start, src = tt.ellipse(spec['c'], *spec['size'], spec['rot']), 'reviewed-ellipse'
            elif spec['src'] == 'ring':
                start, src = Polygon(spec['ring']), 'reviewed-ring'
            else:
                q = min(platforms, key=lambda p: p['polygon'].distance(Point(spec['at'])) + 0.02 * p['polygon'].centroid.distance(Point(spec['at'])))
                if q['polygon'].distance(Point(spec['at'])) > 4:
                    raise SystemExit(f'hole {n}: no terrain platform at {spec["at"]}')
                start, src = q['polygon'], 'terrain-platform'
            reach = spec.get('reach', 0.9 if spec['src'] == 'ring' else 2.2)
            poly, st = (start, dict(dPrime=0.0, weakShare=1.0, kept='as-drawn')) if reach == 0 else tt.refine_ring(
                imagery, start, reach, ds=0.5, inside_m=0.6, gap_m=0.9, outside_m=3.2, smooth_m=0.5, stiffness=0.9)
            keep = reach == 0 or (poly is not None and st['dPrime'] >= 1.0 and st['weakShare'] <= 0.5 and 0.5 < poly.area / start.area < 1.9)
            if not keep:
                # Shade or a tree over the deck: the terrain platform under it is the better measurement.
                under = [p['polygon'] for p in platforms if p['polygon'].intersection(start).area > 0.45 * min(p['polygon'].area, start.area)
                         and 0.5 < p['polygon'].area / start.area < 1.6]
                # A ring a reviewer drew on the photo stands; a platform is already the terrain's own.
                swap = bool(under) and spec['src'] not in ('platform', 'ring')
                poly = under[0] if swap else start
                st = {**st, 'kept': 'terrain-platform' if swap else 'start'}
            poly = tt.largest(poly.buffer(0))
            fid = f"{course['prefix']}-tee-{n:02d}-{k}"
            pads.append(dict(id=fid, poly=poly, tees=spec['tees'], src=src, st=st))
        back = next(p for p in pads if order[0] in p['tees'])
        c = greens[n].centroid if greens[n].contains(greens[n].centroid) else greens[n].representative_point()
        route = [(back['poly'].centroid.x, back['poly'].centroid.y), *[tuple(b) for b in hole['bends']], (c.x, c.y)]
        marks = {}
        for p in pads:
            for t in p['tees']:
                marks[t] = place_mark(p['poly'], route, rows[n]['lengths'][t])
        route[0] = marks[order[0]]
        missing = [t for t in order if t not in marks]
        if missing:
            raise SystemExit(f'{course["slug"]} hole {n}: no platform for {missing}')
        res = {t: round(remaining(route, marks[t]) - rows[n]['lengths'][t], 1) for t in order}
        for p in pads:
            features.append(tt.feature(p['id'], 'tee', p['poly'], hole=n, sourceId=ctx['imageId'], start=p['src'], edge=p['st'],
                                       teeIds=p['tees'], teeMarks={t: [round(v, 2) for v in marks[t]] for t in p['tees']}))
            report.append(dict(hole=n, kind='tee', id=p['id'], start=p['src'], tees=p['tees'], area=round(p['poly'].area, 1), **p['st']))
        report.append(dict(hole=n, kind='route', length=round(LineString(route).length, 1), card=rows[n]['lengths'][order[0]], cardResidual=res))
        routes.append({'type': 'Feature', 'id': f"{course['prefix']}-route-{n:02d}",
                       'properties': {'kind': 'hole', 'hole': n, 'par': rows[n]['par'], 'lengthMetres': round(LineString(route).length, 1)},
                       'geometry': {'type': 'LineString', 'coordinates': [[round(x, 2), round(y, 2)] for x, y in route]}})
        pads_by_hole[n], route_lines[n] = pads, LineString(route)
    return dict(features=features, routes=routes, report=report, greens=greens, pads=pads_by_hole, lines=route_lines, dec=dec)


def assign_fairways(courses, ctx):
    """Mown ground (fairway and green classes together), cut at narrow necks, owned by the nearest route."""
    prob, tr = ctx['prob'], ctx['tr']
    mown = nd.gaussian_filter(prob[0] + prob[1], 1.2) > 0.5
    # A green is mown whatever its colour says (shade, a dry ridge), so it never opens a hole in its own fairway.
    greens = unary_union([g.buffer(1.0) for c in courses for g in c['out']['greens'].values()])
    mown |= rasterize([(greens, 1)], out_shape=mown.shape, transform=tr, fill=0, dtype=np.uint8).astype(bool)
    block = unary_union([p['polygon'] for p in ctx['sandKept']] + [ctx['water']] + ctx['fairwayExclude'])
    mown &= ~rasterize([(block, 1)], out_shape=mown.shape, transform=tr, fill=0, dtype=np.uint8).astype(bool)
    lab, n = nd.label(nd.binary_opening(mown, structure=nd.generate_binary_structure(2, 1), iterations=4))
    # Grow the opened cores back inside the mask, so the opening only cuts necks and never erodes an edge.
    grown = nd.grey_dilation(lab, size=(9, 9))
    lab = np.where(mown & (lab == 0), grown, lab) * mown
    sandy = unary_union([p['polygon'].buffer(0.6) for p in ctx['sandKept']])
    tees = unary_union([p['poly'].buffer(1.5) for c in courses for ps in c['out']['pads'].values() for p in ps])
    made = []
    for p0, sl in enumerate(nd.find_objects(lab), 1):
        if sl is None:
            continue
        m = np.pad(lab[sl] == p0, 2)
        if m.sum() * TURF_RES ** 2 < 180:
            continue
        m = nd.binary_fill_holes(m)
        t2 = tr * tt.rasterio.Affine.translation(sl[1].start - 2, sl[0].start - 2)
        for p in tt.polygon_from_mask(m, t2, 180):
            # A tree's shadow bites the edge and a path beside it leaves a spike: close 3.5 m, open 3 m.
            p = tt.largest(p.buffer(3.5).buffer(-6.5).buffer(3.0))
            p = tt.largest(p.difference(sandy)) if p is not None else None
            if p is None or p.area < 180 or p.intersection(tees).area > 0.5 * p.area or p.difference(greens).area < 100:
                continue
            best = []
            for c in courses:
                for hn, line in c['out']['lines'].items():
                    d = line.distance(p.representative_point())
                    overlap = line.intersection(p).length
                    best.append((overlap, -d, c['slug'], hn, c))
            best.sort(key=lambda b: (b[0], b[1]), reverse=True)
            overlap, nd_, _, hn, c = best[0]
            if overlap < 5 and -nd_ > 35:
                continue
            made.append((c, hn, p))
    return made


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--config', type=Path, required=True)
    ap.add_argument('--cache', type=Path, help='directory for the classifier raster (gitignored)')
    args = ap.parse_args()
    cfg = tt.load_json(args.config)
    imagery = tt.Imagery(cfg['imagery']['rasters'])
    osm = osm_index(cfg['osm'])
    box = cfg['box']
    t = cfg['terrain']
    h = np.fromfile(t['path'], np.float32).reshape(t['side'], t['side'])
    if sha(t['path']) != t['sha256']:
        raise SystemExit('terrain checksum differs from the configuration')
    platforms = tt.tee_platforms(h, t['firstEasting'], t['firstNorthing'], box)
    train = [g for tags, g in osm.values() if tags.get('golf') == 'hole']
    raster_sha = {Path(p).name: sha(p) for p in cfg['imagery']['rasters']}
    # The slow, decision-free steps are cached on exactly what they read.
    key = hashlib.sha256(json.dumps([raster_sha, sha(cfg['osm']), box, sha(Path(__file__).parent / 'turf_tracing.py')]).encode()).hexdigest()[:16]
    cached = args.cache / f'trace-{key}.npz' if args.cache else None
    if cached and cached.exists():
        z = np.load(cached, allow_pickle=False)
        prob, acc = z['prob'], z['acc'].tolist()
        tr = tt.from_origin(box[0], box[3], TURF_RES, TURF_RES)
        sand = [dict(kind=k, polygon=shape(g)) for k, g in json.loads(str(z['sand']))]
    else:
        prob, tr, acc = train_turf(imagery, box, osm, train, TURF_RES)
        sand = [dict(kind=k, polygon=p) for k in ('bunker', 'waste_sand') for p in tt.extract_sand(imagery, box, k)]
        if cached:
            args.cache.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(cached, prob=prob.astype(np.float16), acc=np.array(acc),
                                sand=np.array(json.dumps([[s['kind'], mapping(s['polygon'])] for s in sand])))
    prob = np.asarray(prob, np.float16).astype(np.float32)
    print(f'platforms {len(platforms)}, classifier accuracy G/F/R {np.round(acc, 3)}')
    print('sand candidates', len(sand))
    sd = tt.load_json(cfg['sandDecisions'])
    kept = []
    for rule in sd['keep']:
        hits = [s for s in sand if s["kind"] == rule["kind"] and s["polygon"].centroid.distance(Point(rule["at"])) < (1.5 if rule["kind"] == "bunker" else 25)]
        if len(hits) != 1:
            near = min((s for s in sand if s['kind'] == rule['kind']), key=lambda s: s['polygon'].centroid.distance(Point(rule['at'])))
            c = near['polygon'].centroid
            raise SystemExit(f"sand decision {rule['at']} ({rule['kind']}) matches {len(hits)} candidates; nearest is at ({c.x:.1f}, {c.y:.1f}), {near['polygon'].area:.0f} m2")
        hit = hits[0]
        if rule['kind'] == 'waste_sand':
            # Bedrock beside a waste area frays its edge into slivers a metre wide: those are rock, not sand.
            q = tt.largest(hit['polygon'].buffer(-0.9).buffer(1.8).buffer(-0.9))
            q = Polygon(q.exterior, [r for r in q.interiors if Polygon(r).area > 8])
            hit = {**hit, 'polygon': tt.largest(q.simplify(0.15))}
        kept.append({**hit, **{k: rule.get(k) for k in ('hole', 'course', 'role', 'material')}})
    for rule in sd.get('add', []):
        start = Polygon(rule['ring'])
        poly, st = tt.refine_ring(imagery, start, rule.get('reach', 1.5), ds=0.4, inside_m=0.5, gap_m=0.7, outside_m=2.5, smooth_m=0.4)
        kept.append(dict(kind=rule['kind'], polygon=poly if poly is not None and st['dPrime'] > 1 else start,
                         **{k: rule.get(k) for k in ('hole', 'course', 'role', 'material')}))
    water = unary_union([shape(f['geometry']) for f in tt.load_json(cfg['water'])['features']])
    ctx = dict(imagery=imagery, osm=osm, prob=prob, tr=tr, platforms=platforms, sand=sand, sandKept=kept, water=water,
               imageId=cfg['imagery']['sourceId'], bunkerAvoid=unary_union([k['polygon'].buffer(0.8) for k in kept] + [water.buffer(0.5)]),
               fairwayExclude=[Polygon(r) for r in cfg.get('fairwayExclude', [])])
    courses = cfg['courses']
    for c in courses:
        c['out'] = trace_course(c, ctx)
    for c, hn, p in assign_fairways(courses, ctx):
        poly, st = tt.refine_ring(imagery, p, 2.0, ds=0.9, avoid=ctx['bunkerAvoid'], smooth_m=1.2, stiffness=1.2, passes=1)
        if poly is None or st['dPrime'] < 0.8 or not 0.8 < poly.area / p.area < 1.25:
            poly, st = p, {**(st or {}), 'kept': 'classified'}
        k = 1 + sum(1 for f in c['out']['features'] if f['properties']['kind'] == 'fairway' and f['properties']['hole'] == hn)
        c['out']['features'].append(tt.feature(f"{c['prefix']}-fairway-{hn:02d}-{k}", 'fairway', Polygon(poly.exterior), hole=hn,
                                               sourceId=ctx['imageId'], start='classified-mown-ground', edge=st))
        c['out']['report'].append(dict(hole=hn, kind='fairway', area=round(poly.area), **st))
    for k, s in enumerate(kept, 1):
        c = next((c for c in courses if c['slug'] == s.get('course')), None)
        if c is None:
            continue
        kind = s['kind']
        i = 1 + sum(1 for f in c['out']['features'] if f['properties']['kind'] == kind and f['properties']['hole'] == s['hole'])
        tag = f"{s['hole']:02d}" if s['hole'] is not None else 'p'
        c['out']['features'].append(tt.feature(f"{c['prefix']}-{kind.replace('_', '-')}-{tag}-{i}", kind, s['polygon'], hole=s['hole'],
                                               sourceId=ctx['imageId'], start='extracted-sand', material=s.get('material')))
    provenance = dict(imagery=cfg['imagery']['sourceId'], imagerySha256=raster_sha,
                      terrainSha256=t['sha256'], osmSha256=sha(cfg['osm']), tool='packages/course-geo/mapping/trace-course-surfaces.py')
    for c in courses:
        out, where = c.pop('out'), Path(c['outDir'])
        tt.write_json(where / 'routes.geojson', tt.collection(out['routes'], status='traced-awaiting-review', provenance=provenance))
        feats = sorted(out['features'], key=lambda f: (f['properties']['hole'] if f['properties']['hole'] is not None else 99, f['properties']['kind'], f['id']))
        tt.write_json(where / 'playing-surfaces.geojson', tt.collection(feats, status='traced-awaiting-review', provenance=provenance))
        tt.write_json(where / 'trace-report.json', dict(schemaVersion=1, slug=c['slug'], classifierAccuracy=dict(zip(('green', 'fairway', 'otherGrass'), [round(a, 4) for a in acc])),
                                                       provenance=provenance, rows=out['report']))
        counts = {}
        for f in feats:
            counts[f['properties']['kind']] = counts.get(f['properties']['kind'], 0) + 1
        print(c['slug'], counts)


if __name__ == '__main__':
    main()
