#!/usr/bin/env python3
"""Render georeferenced source/model comparisons into an ignored review cache.

Example:
  python geobuild/render-mapping-review.py --build upsalabuild \
    --source-dir upsalabuild/cache/review-2026-09-06/lm-latest \
    --kind tees --holes 8,9,11,12,13,14,15,18 --out upsalabuild/cache/tee-review

Requires Pillow and pyproj. Reads acquisition .request.json records, verifies
their raster hashes, and plots exact model rings in EPSG:3006. No geometry is
changed or automatically accepted. Review PNGs contain source imagery and must
stay in the local cache; their extent, input hashes and output hashes are logged.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--kind', choices=['tees', 'greens', 'fairways', 'infrastructure'], required=True)
    parser.add_argument('--holes')
    parser.add_argument('--evidence', type=Path, help='Overlay local candidate rings in red; never adopt them')
    parser.add_argument('--panels', type=Path, help='Reuse extents from a previous report for exact before/after views')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if 'cache' not in args.out.parts:
        parser.error('Source imagery comparisons must be written beneath a cache directory')
    args.out.mkdir(parents=True, exist_ok=True)
    model_path = args.build / 'course-model.json'
    model = json.loads(model_path.read_text(encoding='utf-8'))
    transform = Transformer.from_crs('EPSG:4326', 'EPSG:3006', always_xy=True)

    def project(ring):
        return [transform.transform(model['origin']['lon'] + x/model['mPerLon'],
                                    model['origin']['lat'] - z/model['mPerLat']) for x, z in ring]

    sources = []
    for record in sorted(args.source_dir.glob('*.request.json')):
        source = json.loads(record.read_text())
        if not source.get('extent') or not source.get('dimensions') or 'flightyear' in source['output']:
            continue
        raster = args.source_dir / source['output']
        if digest(raster) != source['sha256']:
            raise ValueError(f'Raster checksum differs: {raster}')
        sources.append({**source, 'path': raster})
    if not sources:
        raise ValueError('No georeferenced acquisition rasters')
    images = {}

    def raster_crop(extent, size):
        e0, n0, e1, n1 = extent
        result = Image.new('RGB', (size, size), '#252525')
        for source in sources:
            a, b, c, d = source['extent']
            if c <= e0 or a >= e1 or d <= n0 or b >= n1:
                continue
            key = str(source['path'])
            if key not in images:
                images[key] = Image.open(source['path']).convert('RGB')
            image = images[key]
            left, bottom, right, top = max(e0, a), max(n0, b), min(e1, c), min(n1, d)
            box = ((left-a)/(c-a)*image.width, (d-top)/(d-b)*image.height,
                   (right-a)/(c-a)*image.width, (d-bottom)/(d-b)*image.height)
            x0, y0 = round((left-e0)/(e1-e0)*size), round((n1-top)/(n1-n0)*size)
            x1, y1 = round((right-e0)/(e1-e0)*size), round((n1-bottom)/(n1-n0)*size)
            if x1 > x0 and y1 > y0:
                part = image.resize((x1-x0, y1-y0), Image.Resampling.LANCZOS, box=box)
                result.paste(part, (x0, y0))
        return result

    objects = []
    for hole in model['holes']:
        objects.append(('green', hole['n'], project(hole['green']['ring']), '#00ffff', True))
        objects.extend(('tee', hole['n'], project(p['ring']), '#ffffff', True) for p in hole['tees'].get('pads', []))
        objects.extend(('fairway', hole['n'], project(r), '#ff60ef', True) for r in hole.get('fairway', {}).get('rings', []))
        objects.extend(('bunker', hole['n'], project(b['ring']), '#ffff00', True) for b in hole.get('bunkers', []))
    for kind, colour in [('roads', '#ff8c20'), ('paths', '#ff8c20'), ('tracks', '#ff8c20'),
                         ('buildings', '#ffffff'), ('parking', '#709dff')]:
        for item in model['infra'].get(kind, []):
            points = item.get('ring') or item.get('line')
            if points:
                objects.append((kind, None, project(points), colour, 'ring' in item))
    for item in model.get('water', []):
        objects.append(('water', None, project(item['ring']), '#709dff', True))
    selected = set(map(int, args.holes.split(','))) if args.holes else {h['n'] for h in model['holes']}
    panels = []
    if args.kind == 'infrastructure':
        for row in range(3):
            for col in range(3):
                e0, n0 = 639350 + col*520, 6635350 + row*520
                panels.append((f'ground-{row}-{col}', [e0, n0, e0+520, n0+520]))
    else:
        for hole in model['holes']:
            if hole['n'] not in selected:
                continue
            kind = {'tees': 'tee', 'greens': 'green', 'fairways': 'fairway'}[args.kind]
            points = [p for k, n, ring, _, _ in objects if k == kind and n == hole['n'] for p in ring]
            if not points:
                continue
            xs, ys = zip(*points)
            span = max(max(xs)-min(xs), max(ys)-min(ys), 40) + (35 if kind != 'fairway' else 60)
            e, n = (max(xs)+min(xs))/2, (max(ys)+min(ys))/2
            panels.append((f'h{hole["n"]:02}-{kind}', [e-span/2, n-span/2, e+span/2, n+span/2]))
    if args.panels:
        panels = [(p['id'], p['extentEPSG3006']) for p in json.loads(args.panels.read_text())['panels']]
    if args.evidence:
        evidence = json.loads(args.evidence.read_text(encoding='utf-8'))
        if evidence['frame'] != {k: model[k] for k in ['origin', 'mPerLat', 'mPerLon']}:
            raise ValueError('Evidence/model local frames differ')
        for feature in evidence['features']:
            for ring in feature.get('rings', [feature.get('ring')]):
                if ring:
                    objects.append((feature.get('kind', 'tee'), feature.get('hole'), project(ring), '#ff4040', True))
            if feature.get('line'):
                objects.append((feature.get('kind', 'line'), feature.get('hole'), project(feature['line']), '#ff4040', False))
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 18) if Path('C:/Windows/Fonts/arial.ttf').exists() else ImageFont.load_default()
    records = []
    size = 720
    for label, extent in panels:
        e0, n0, e1, n1 = extent
        base = raster_crop(extent, size)
        overlay = base.copy()
        draw = ImageDraw.Draw(overlay)
        def xy(point):
            return ((point[0]-e0)/(e1-e0)*size, (n1-point[1])/(n1-n0)*size)
        for kind, hole, ring, colour, closed in objects:
            if not any(e0 <= e <= e1 and n0 <= n <= n1 for e, n in ring):
                continue
            points = list(map(xy, ring))
            draw.line(points + ([points[0]] if closed else []), fill=colour, width=2)
        pair = Image.new('RGB', (size*2, size+44), '#151515')
        pair.paste(base, (0, 44)); pair.paste(overlay, (size, 44))
        draw = ImageDraw.Draw(pair)
        draw.text((8, 10), f'{label} | {args.source_dir.name} | north up | {e1-e0:.1f} m wide', fill='white', font=font)
        draw.text((size+8, 10), 'cyan green | white tee/building | pink fairway | yellow sand', fill='white', font=font)
        filename = args.out / f'{label}.png'
        pair.save(filename)
        records.append({'id': label, 'extentEPSG3006': extent, 'image': filename.name, 'sha256': digest(filename)})
    report = {'schemaVersion': 1, 'automaticAdoption': False, 'model': {'path': model_path.as_posix(), 'sha256': digest(model_path)},
              'projection': 'pyproj EPSG:4326 to EPSG:3006, longitude/latitude from declared local frame',
              'sources': [{k: v for k, v in s.items() if k != 'path'} for s in sources], 'panels': records}
    if args.evidence:
        report['evidence'] = {'path': args.evidence.as_posix(), 'sha256': digest(args.evidence)}
    (args.out / 'report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(f'{len(records)} source/model comparison pairs: {args.out}')


if __name__ == '__main__':
    main()
