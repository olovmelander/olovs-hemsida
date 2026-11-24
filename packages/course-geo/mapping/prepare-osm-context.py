#!/usr/bin/env python3
"""Clip and clean a ground's OSM context for compile-grid-course.mjs (EPSG:3006 in and out).

    pixi run ... -e mapping --frozen python packages/course-geo/mapping/prepare-osm-context.py --config <build>/mapping/context-config.json

Footprints inside `innerHalfMetres` stay footprints; further out they become far boxes
[cx, cz, half width, half depth, angle, kind, height]. Lines and woods are clipped to
`outerHalfMetres`. A stream keeps only its reaches outside mapped water, so a channel is never
drawn twice, and mapped features of the course itself (`dropIds`) are left out.
"""
import argparse
import json
import math
import sys
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import turf_tracing as tt  # noqa: E402

KEEP = ('building', 'highway', 'waterway', 'natural', 'landuse', 'amenity', 'barrier', 'power', 'man_made', 'name', 'surface', 'width',
        'height', 'building:levels', 'historic', 'tunnel', 'covered', 'bridge', 'layer', 'leisure', 'tourism', 'parking', 'oneway')


def polygons(geom):
    geom = make_valid(geom) if not geom.is_valid else geom
    if geom.geom_type == 'Polygon':
        return [geom]
    return [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']


def lines(geom):
    if geom.geom_type == 'LineString':
        return [geom]
    return [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'LineString']


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--config', type=Path, required=True)
    cfg = tt.load_json(ap.parse_args().config)
    e0, n0 = cfg['frame']['easting'], cfg['frame']['northing']
    inner = box(e0 - cfg['innerHalfMetres'], n0 - cfg['innerHalfMetres'], e0 + cfg['innerHalfMetres'], n0 + cfg['innerHalfMetres'])
    outer = box(e0 - cfg['outerHalfMetres'], n0 - cfg['outerHalfMetres'], e0 + cfg['outerHalfMetres'], n0 + cfg['outerHalfMetres'])
    water = unary_union([shape(f['geometry']).buffer(0) for f in tt.load_json(cfg['water'])['features']])
    drop = set(cfg.get('dropIds', []))
    out, far, counts = [], [], {}

    def put(f, geom, tags, k=0):
        coords = mapping(geom)
        rnd = lambda c: [round(c[0], 2), round(c[1], 2)] if isinstance(c[0], (int, float)) else [rnd(x) for x in c]
        out.append({'type': 'Feature', 'id': f['id'] if not k else f"{f['id']}-{k}", 'properties': {'tags': tags},
                    'geometry': {'type': coords['type'], 'coordinates': rnd(list(coords['coordinates']))}})

    for f in tt.load_json(cfg['context'])['features']:
        if f['id'] in drop:
            continue
        tags = {k: v for k, v in (f['properties'].get('tags') or {}).items() if k in KEEP}
        g = shape(f['geometry'])
        if tags.get('building'):
            for k, p in enumerate(polygons(g)):
                if p.area < 12 or not outer.contains(p.centroid):
                    continue
                if inner.contains(p.centroid):
                    q = tt.largest(p.simplify(0.15))
                    put(f, tt.Polygon(q.exterior), tags, k)
                    counts['building'] = counts.get('building', 0) + 1
                else:
                    r = list(p.minimum_rotated_rectangle.exterior.coords)
                    a, b, c = r[0], r[1], r[2]
                    w, d = math.dist(a, b), math.dist(b, c)
                    if min(w, d) < 3:
                        continue
                    cx, cy = p.minimum_rotated_rectangle.centroid.coords[0]
                    ang = math.atan2(-(b[1] - a[1]), b[0] - a[0])
                    kind = 1 if tags['building'] in ('industrial', 'warehouse', 'retail', 'supermarket') else 2 if tags['building'] in ('apartments', 'commercial', 'school', 'office', 'public', 'hospital') else 0
                    levels = tags.get('building:levels')
                    ht = float(levels) * 3 + 1.2 if levels and levels.replace('.', '', 1).isdigit() else 0
                    far.append([round(cx - e0, 1), round(n0 - cy, 1), round(w / 2, 1), round(d / 2, 1), round(ang, 3), kind, *([round(ht, 1)] if ht else [])])
            continue
        if f['geometry']['type'] in ('Polygon', 'MultiPolygon'):
            if tags.get('natural') == 'water' or tags.get('landuse') == 'basin' or tags.get('leisure') == 'golf_course' or tags.get('landuse') == 'grass':
                continue
            if not (tags.get('landuse') or tags.get('natural') or tags.get('amenity') == 'parking'):
                continue
            for k, p in enumerate(polygons(g.intersection(outer))):
                q = tt.largest(p.simplify(0.4))
                if q is None or q.area < 40:
                    continue
                put(f, q, tags, k)
                key = tags.get('landuse') or tags.get('natural') or 'parking'
                counts[key] = counts.get(key, 0) + 1
        elif f['geometry']['type'] == 'LineString':
            h = tags.get('highway')
            if h in ('platform', 'construction', 'proposed'):
                continue
            if not (h or tags.get('waterway') or tags.get('barrier') in ('wall', 'fence', 'hedge', 'retaining_wall') or tags.get('power') in ('line', 'minor_line')):
                continue
            if tags.get('waterway') in ('floating_barrier', 'flowline', 'dam', 'weir'):
                continue
            clip = g.intersection(outer)
            if tags.get('waterway'):
                clip = clip.difference(water.buffer(1.0))
            for k, p in enumerate(lines(clip)):
                if p.length < 4:
                    continue
                put(f, p.simplify(0.15), tags, k)
                key = 'highway' if h else 'waterway' if tags.get('waterway') else tags.get('barrier') or 'power'
                counts[key] = counts.get(key, 0) + 1
        elif f['geometry']['type'] == 'Point' and tags.get('power') in ('pole', 'tower') and outer.contains(g):
            put(f, g, tags)
            counts['power-point'] = counts.get('power-point', 0) + 1
    tt.write_json(cfg['out'], tt.collection(out, source=dict(licence='ODbL-1.0', attribution='© OpenStreetMap contributors', input=cfg['context'])))
    Path(cfg['farOut']).write_text(json.dumps({'schemaVersion': 1, 'frame': cfg['frame'], 'boxes': far}) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps(dict(features=len(out), farBuildings=len(far), **counts)))


if __name__ == '__main__':
    main()
