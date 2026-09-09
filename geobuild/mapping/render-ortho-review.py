#!/usr/bin/env python3
"""Render north-up orthophoto/model review panels without changing geometry.

Requires numpy, Pillow, pyproj and rasterio. Example (PowerShell):
  $rasters = (Get-ChildItem geobuild/cache/lm-ortho-veckefjarden/*.tif).FullName
  python geobuild/mapping/render-ortho-review.py --source $rasters

Greens cover 100 m at 800 px. Tees include every existing pad and mark plus
35 m on each side. Holes include the complete line/fairway/green plus 50 m.
Context subdivides the published ground's level-0 terrain bounds. All nearby
features are overlaid regardless of hole association. Plain PNGs have no
annotations; overlay PNGs have pixel coordinates for manual tracing. PNG world
files use pixel centres, while JSON affines explicitly use pixel edges.

Source coverage and spatial pixel variation are checked. These mechanical
checks are not a claim of visual review, positional accuracy or completeness.
Images and reports must be written to a Git-ignored local cache. Use --panels
with an earlier panels.json to preserve exact before/after panel extents.
"""

import argparse
from collections import Counter
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import CRS, Transformer
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT


ROOT = Path(__file__).resolve().parents[2]
COLOURS = {
    'green': '#00ffff', 'tee': '#ffffff', 'tee-mark': '#ffffff',
    'bunker': '#ffff00', 'fairway': '#ff60ef', 'water': '#408dff',
    'stream': '#408dff', 'path': '#ff8c20', 'building': '#ffffff',
    'parking': '#ff8c20', 'hole-line': '#ffc0ef',
}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def font(size):
    for name in ['C:/Windows/Fonts/arial.ttf', 'DejaVuSans.ttf']:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def bbox(points):
    xs, ys = zip(*points)
    return [min(xs), min(ys), max(xs), max(ys)]


def intersects(a, b):
    return a[2] >= b[0] and a[0] <= b[2] and a[3] >= b[1] and a[1] <= b[3]


def rectangle_covered(bounds, rectangles):
    """Reject even subpixel gaps in the union of north-up source rectangles."""
    west, south, east, north = bounds
    clipped = [(max(west, a), max(south, b), min(east, c), min(north, d))
               for a, b, c, d in rectangles if c > west and a < east and d > south and b < north]
    xs = sorted({west, east, *(v for r in clipped for v in (r[0], r[2]))})
    for left, right in zip(xs, xs[1:]):
        if right <= left:
            continue
        middle = (left + right) / 2
        intervals = sorted((b, d) for a, b, c, d in clipped if a <= middle <= c)
        covered_to = south
        for bottom, top in intervals:
            if bottom > covered_to + 1e-7:
                return False
            covered_to = max(covered_to, top)
        if covered_to < north - 1e-7:
            return False
    return True


def features_from_model(model, project):
    features = []

    def add(kind, label, path, points, closed=True, hole=None, shape=None):
        if not points:
            return
        projected = [project(p) for p in points]
        features.append({'id': label, 'kind': kind, 'hole': hole, 'modelPath': path,
                         'sourceId': (shape or {}).get('sourceId', (shape or {}).get('id')),
                         'provenance': (shape or {}).get('prov'), 'closed': closed,
                         'localPoints': points, 'pointsEPSG3006': projected,
                         'boundsEPSG3006': bbox(projected)})

    for i, hole in enumerate(model['holes']):
        n, base = hole['n'], f'/holes/{i}'
        add('green', f'H{n:02}G', base+'/green/ring', hole['green']['ring'], hole=n, shape=hole['green'])
        for j, ring in enumerate(hole.get('fairway', {}).get('rings', [])):
            add('fairway', f'H{n:02}F{j+1}', f'{base}/fairway/rings/{j}', ring, hole=n, shape=hole['fairway'])
        for j, pad in enumerate(hole.get('tees', {}).get('pads', [])):
            add('tee', f'H{n:02}T{j+1}', f'{base}/tees/pads/{j}/ring', pad['ring'], hole=n, shape=pad)
        for j, mark in enumerate(hole.get('tees', {}).get('marks', [])):
            add('tee-mark', f'H{n:02}M{mark.get("teeIdx", j)+1}', f'{base}/tees/marks/{j}/c', [mark['c']], False, n, mark)
        for j, bunker in enumerate(hole.get('bunkers', [])):
            add('bunker', f'H{n:02}B{j+1}', f'{base}/bunkers/{j}/ring', bunker['ring'], hole=n, shape=bunker)
        add('hole-line', f'H{n:02}L', base+'/line', hole.get('line'), False, n)
    for collection, kind in [('greens', 'green'), ('tees', 'tee'), ('fairways', 'fairway'), ('bunkers', 'bunker')]:
        for i, ring in enumerate(model.get('scenery', {}).get(collection, [])):
            add(kind, f'S{kind[0].upper()}{i+1}', f'/scenery/{collection}/{i}', ring)
    for collection, kind in [('water', 'water'), ('streams', 'stream')]:
        for i, item in enumerate(model.get(collection, [])):
            key = 'ring' if 'ring' in item else 'line'
            add(kind, f'{kind[0].upper()}{i+1}', f'/{collection}/{i}/{key}', item[key], key == 'ring', shape=item)
    for collection, kind in [('paths', 'path'), ('roads', 'path'), ('tracks', 'path'),
                             ('piers', 'path'), ('buildings', 'building'), ('parking', 'parking')]:
        for i, item in enumerate(model.get('infra', {}).get(collection, [])):
            key = 'ring' if 'ring' in item else 'line'
            add(kind, f'{collection[:2].upper()}{i+1}', f'/infra/{collection}/{i}/{key}', item[key], key == 'ring', shape=item)
    return features


def ground_bounds(public_dir, slug):
    index = json.loads((public_dir/'courses/v2-index.json').read_text(encoding='utf-8'))
    entry = next(e for e in index['courses'] if e['slug'] == slug)
    course = json.loads((public_dir/entry['manifest']['url']).read_text(encoding='utf-8'))
    path = public_dir/course['groundManifest']['url']
    if digest(path) != course['groundManifest']['sha256']:
        raise ValueError(f'Published ground checksum differs: {path}')
    ground = json.loads(path.read_text(encoding='utf-8'))
    if ground['frame']['horizontalCrs'] != 'EPSG:3006':
        raise ValueError('Context ground must use EPSG:3006')
    tiles = [t['bounds'] for t in ground['tiles'] if t['lod'] == 0]
    if not tiles:
        raise ValueError('No level-0 ground tiles for context extent')
    bounds = [min(t['minEasting'] for t in tiles), min(t['minNorthing'] for t in tiles),
              max(t['maxEasting'] for t in tiles), max(t['maxNorthing'] for t in tiles)]
    return bounds, {'path': path.as_posix(), 'sha256': digest(path), 'extentSource': 'union of level-0 tile bounds'}


def panel_definitions(args, model, project, features):
    if args.panels:
        prior = json.loads(args.panels.read_text(encoding='utf-8'))
        return [{k: p[k] for k in ['id', 'hole', 'kind', 'pixelSize', 'extentEPSG3006']} for p in prior['panels']], None
    result = []
    for mode in args.modes:
        if mode == 'context':
            continue
        for hole in model['holes']:
            n = hole['n']
            if n not in args.holes:
                continue
            if mode == 'greens':
                e, north = project(hole['green']['c'])
                half = args.green_metres / 2
                bounds = [e-half, north-half, e+half, north+half]
            else:
                kinds = ['tee', 'tee-mark'] if mode == 'tees' else ['hole-line', 'fairway', 'green']
                points = [p for f in features if f['hole'] == n and f['kind'] in kinds for p in f['pointsEPSG3006']]
                if not points:
                    raise ValueError(f'H{n}: no geometry for {mode} panel')
                a, b, c, d = bbox(points)
                margin = 35 if mode == 'tees' else 50
                half = max(c-a, d-b)/2 + margin
                e, north = (a+c)/2, (b+d)/2
                bounds = [e-half, north-half, e+half, north+half]
            result.append({'id': f'{mode}-hole-{n:02}', 'hole': n, 'kind': mode,
                           'extentEPSG3006': bounds, 'pixelSize': [args.pixels, args.pixels]})
    context_source = None
    if 'context' in args.modes:
        if args.context_bounds:
            bounds = args.context_bounds
            context_source = {'extentSource': 'explicit --context-bounds'}
        else:
            bounds, context_source = ground_bounds(args.public_dir, args.ground)
        a, b, c, d = bounds
        for row in range(args.context_rows):
            for col in range(args.context_columns):
                west, east = a+(c-a)*col/args.context_columns, a+(c-a)*(col+1)/args.context_columns
                north, south = d-(d-b)*row/args.context_rows, d-(d-b)*(row+1)/args.context_rows
                result.append({'id': f'context-r{row+1:02}-c{col+1:02}', 'hole': None, 'kind': 'context',
                               'extentEPSG3006': [west, south, east, north], 'pixelSize': [args.pixels, args.pixels]})
    return result, context_source


def render_source(panel, rasters, source_records):
    width, height = panel['pixelSize']
    bounds = panel['extentEPSG3006']
    transform = from_bounds(*bounds, width, height)
    intersecting = [(r, s) for r, s in zip(rasters, source_records) if intersects(list(r.bounds), bounds)]
    if not rectangle_covered(bounds, [list(r.bounds) for r, _ in intersecting]):
        raise ValueError(f'{panel["id"]}: source rectangles do not fully cover panel {bounds}')
    rgb = np.zeros((3, height, width), dtype=np.uint8)
    coverage = np.zeros((height, width), dtype=bool)
    contributing = []
    for raster, record in intersecting:
        bands = [raster.colorinterp.index(c)+1 for c in [ColorInterp.red, ColorInterp.green, ColorInterp.blue]] if all(c in raster.colorinterp for c in [ColorInterp.red, ColorInterp.green, ColorInterp.blue]) else [1, 2, 3]
        with WarpedVRT(raster, crs='EPSG:3006', transform=transform, width=width, height=height,
                       resampling=Resampling.bilinear, add_alpha=ColorInterp.alpha not in raster.colorinterp) as vrt:
            pixels = vrt.read(bands)
            valid = vrt.dataset_mask() > 0
        if valid.any():
            rgb[:, valid] = pixels[:, valid]
            coverage |= valid
            contributing.append(record)
    if not coverage.all():
        raise ValueError(f'{panel["id"]}: {np.count_nonzero(~coverage)} pixels lack valid source data')
    ranges = [int(b.max())-int(b.min()) for b in rgb]
    deviations = [float(b.std()) for b in rgb]
    if max(ranges) <= 1 or max(deviations) < 0.5:
        raise ValueError(f'{panel["id"]}: spatially blank or nearly constant imagery (ranges {ranges})')
    stats = {'sourceRectangleCoverageComplete': True, 'validPixelFraction': 1.0,
             'nonblankPassed': True, 'channelRange': ranges, 'channelStdDev': deviations,
             'visualReviewPerformed': False}
    return Image.fromarray(np.moveaxis(rgb, 0, -1)), transform, contributing, stats


def save_georeferenced(image, path, transform):
    temporary = path.with_suffix('.tmp.png')
    image.save(temporary)
    temporary.replace(path)
    world = path.with_suffix('.pgw')
    # A,D,B,E,C,F; C and F are the centre of the upper-left pixel.
    values = [transform.a, transform.d, transform.b, transform.e,
              transform.c+(transform.a+transform.b)/2, transform.f+(transform.d+transform.e)/2]
    world.write_text(''.join(f'{value:.15f}\n' for value in values), encoding='ascii')
    path.with_suffix('.prj').write_text(CRS.from_epsg(3006).to_wkt(), encoding='utf-8')
    return {'path': path.as_posix(), 'sha256': digest(path), 'worldFile': world.as_posix()}


def render_overlay(plain, transform, features, label_features=True):
    overlay = plain.copy()
    draw = ImageDraw.Draw(overlay, 'RGBA')
    width, height = overlay.size
    pixel_font = font(15)
    label_font = font(12)
    inverse = ~transform
    visible = []
    bounds = [transform.c, transform.f+transform.e*height, transform.c+transform.a*width, transform.f]
    # Extent tests intentionally use bounding boxes: no feature is lost merely
    # because all its vertices lie outside the panel (e.g. a crossing road).
    for feature in features:
        if not intersects(feature['boundsEPSG3006'], bounds):
            continue
        points = [inverse * tuple(p) for p in feature['pointsEPSG3006']]
        colour = COLOURS[feature['kind']]
        if len(points) == 1:
            x, y = points[0]
            draw.line([(x-4, y), (x+4, y)], fill=colour, width=2)
            draw.line([(x, y-4), (x, y+4)], fill=colour, width=2)
        else:
            draw.line(points + ([points[0]] if feature['closed'] else []), fill=colour,
                      width=1 if feature['kind'] == 'hole-line' else 2)
        if label_features and feature['kind'] not in ['hole-line', 'path', 'stream']:
            inside = [(x, y) for x, y in points if 0 <= x < width and 0 <= y < height]
            if inside:
                x, y = inside[0]
                draw.text((min(x+3, width-70), min(y+3, height-18)), feature['id'], fill=colour,
                          font=label_font, stroke_width=1, stroke_fill='#000000')
        visible.append({k: feature[k] for k in ['id', 'kind', 'hole', 'modelPath', 'sourceId', 'provenance', 'closed']} |
                       {'originalShapePanelPixelRing' if feature['closed'] else 'originalShapePanelPixelPoints': points})
    for x in range(0, width, 100):
        draw.line([(x, 0), (x, height)], fill=(255, 255, 255, 65), width=1)
        draw.text((x+3, 3), str(x), fill='white', font=pixel_font, stroke_width=2, stroke_fill='black')
    for y in range(100, height, 100):
        draw.line([(0, y), (width, y)], fill=(255, 255, 255, 65), width=1)
        draw.text((3, y+3), str(y), fill='white', font=pixel_font, stroke_width=2, stroke_fill='black')
    return overlay, visible


def contact_sheets(panels, out):
    records = []
    for kind in dict.fromkeys(p['kind'] for p in panels):
        group = [p for p in panels if p['kind'] == kind]
        for offset in range(0, len(group), 6):
            page = group[offset:offset+6]
            for variant in ['plain', 'overlay']:
                sheet = Image.new('RGB', (1050, 2*382), '#171717')
                draw = ImageDraw.Draw(sheet)
                for i, panel in enumerate(page):
                    x, y = (i % 3)*350, (i // 3)*382
                    draw.text((x+6, y+7), panel['id'], fill='white', font=font(15))
                    with Image.open(panel[variant+'Path']) as im:
                        thumb = im.copy()
                        thumb.thumbnail((350, 350), Image.Resampling.LANCZOS)
                        sheet.paste(thumb, (x+(350-thumb.width)//2, y+32))
                path = out/f'contact-{kind}-{offset//6+1:02}-{variant}.png'
                temporary = path.with_suffix('.tmp.png')
                sheet.save(temporary)
                temporary.replace(path)
                records.append({'path': path.as_posix(), 'sha256': digest(path), 'kind': kind,
                                'variant': variant, 'panels': [p['id'] for p in page],
                                'georeferenced': False, 'note': 'Thumbnails for overview only; trace individual panels.'})
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', type=Path, nargs='+', required=True)
    parser.add_argument('--model', type=Path, default=ROOT/'geobuild/course-model.json')
    parser.add_argument('--out', type=Path, default=ROOT/'geobuild/cache/lm-ortho-review')
    parser.add_argument('--modes', choices=['greens', 'tees', 'holes', 'context'], nargs='+', default=['greens', 'tees', 'holes', 'context'])
    parser.add_argument('--holes', type=int, nargs='+', default=list(range(1, 19)))
    parser.add_argument('--pixels', type=int, default=800)
    parser.add_argument('--green-metres', type=float, default=100)
    parser.add_argument('--panels', type=Path, help='Reuse exact panel extents and dimensions from an earlier panels.json')
    parser.add_argument('--context-bounds', type=float, nargs=4, metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'))
    parser.add_argument('--context-rows', type=int, default=4)
    parser.add_argument('--context-columns', type=int, default=4)
    parser.add_argument('--public-dir', type=Path, default=ROOT/'apps/golf/public')
    parser.add_argument('--ground', default='veckefjarden')
    parser.add_argument('--no-feature-labels', action='store_true')
    args = parser.parse_args()
    if min(args.pixels, args.context_rows, args.context_columns, args.green_metres) <= 0:
        parser.error('Pixel dimensions, context grid dimensions and green metres must be positive')
    args.out = args.out.resolve()
    ignored = subprocess.run(['git', 'check-ignore', '-q', '--no-index', str(args.out/'plain.png')], cwd=ROOT)
    if ignored.returncode != 0 or 'cache' not in args.out.parts:
        parser.error('Review imagery must stay in a Git-ignored cache directory')
    args.out.mkdir(parents=True, exist_ok=True)
    model = json.loads(args.model.read_text(encoding='utf-8'))
    frame = {key: model[key] for key in ['origin', 'mPerLat', 'mPerLon']}
    forward = Transformer.from_crs('EPSG:4326', 'EPSG:3006', always_xy=True)

    def project(point):
        x, z = point
        return forward.transform(frame['origin']['lon']+x/frame['mPerLon'], frame['origin']['lat']-z/frame['mPerLat'])

    features = features_from_model(model, project)
    definitions, context_source = panel_definitions(args, model, project, features)
    if not definitions:
        parser.error('No panels selected')
    panels, sources = [], []
    with ExitStack() as stack:
        rasters = []
        for path in args.source:
            raster = stack.enter_context(rasterio.open(path))
            if raster.crs != rasterio.crs.CRS.from_epsg(3006):
                raise ValueError(f'Unexpected CRS for {path}: {raster.crs}; expected EPSG:3006')
            if raster.count < 3 or any(dtype != 'uint8' for dtype in raster.dtypes[:3]):
                raise ValueError(f'{path}: expected at least three uint8 RGB bands')
            if raster.transform.b != 0 or raster.transform.d != 0 or raster.transform.a <= 0 or raster.transform.e >= 0:
                raise ValueError(f'{path}: expected north-up source raster')
            rasters.append(raster)
            sources.append({'path': path.as_posix(), 'sha256': digest(path), 'crs': str(raster.crs),
                            'width': raster.width, 'height': raster.height,
                            'geoTransform': list(raster.transform.to_gdal()),
                            'boundsEPSG3006': list(raster.bounds), 'resolutionM': list(raster.res),
                            'colourInterpretation': [c.name for c in raster.colorinterp], 'nodata': raster.nodata})
        for definition in definitions:
            plain, transform, contributing, stats = render_source(definition, rasters, sources)
            overlay, visible = render_overlay(plain, transform, features, not args.no_feature_labels)
            plain_record = save_georeferenced(plain, args.out/f'{definition["id"]}-plain.png', transform)
            overlay_record = save_georeferenced(overlay, args.out/f'{definition["id"]}-overlay.png', transform)
            panel = {**definition, 'plainPath': plain_record['path'], 'overlayPath': overlay_record['path'],
                     'plainSha256': plain_record['sha256'], 'overlaySha256': overlay_record['sha256'],
                     'worldFiles': [plain_record['worldFile'], overlay_record['worldFile']],
                     'geoTransform': list(transform.to_gdal()), 'affinePixelEdgeToEPSG3006': list(transform)[:6],
                     'pixelCoordinateConvention': 'pixel edges; E=west+x*xResolution, N=north-y*yResolution; pixel centres add 0.5',
                     'resampling': 'bilinear display only; native source retained', 'sources': contributing,
                     'validation': stats, 'visibleFeatureCounts': dict(Counter(f['kind'] for f in visible)), 'shapes': visible}
            panels.append(panel)
            print(f'{definition["id"]}: {len(visible)} overlapping feature bounds; full valid coverage', flush=True)
    document = {'schemaVersion': 1, 'frame': frame, 'modelPath': args.model.as_posix(),
                'modelSha256': digest(args.model), 'crs': 'EPSG:3006',
                'projection': 'pyproj EPSG:4326 to EPSG:3006 through declared legacy local frame; no fitted offset',
                'visualReviewPerformed': False, 'automaticAdoption': False,
                'coverageValidation': 'Complete source rectangle union and valid mask at every rendered pixel; spatial channel variation checked',
                'featureInventoryScope': 'Hole/scenery greens, fairways, tees, bunkers; tee marks; hole lines; water, streams; infra paths, roads, tracks, piers, buildings, parking. Panel inclusion uses overlapping feature bounds.',
                'legend': COLOURS, 'contextExtentSource': context_source, 'sources': sources, 'panels': panels,
                'contactSheets': contact_sheets(panels, args.out), 'features': features}
    if args.panels:
        document['extentReference'] = {'path': args.panels.as_posix(), 'sha256': digest(args.panels)}
    report = args.out/'panels.json'
    temporary_report = report.with_suffix('.tmp.json')
    temporary_report.write_text(json.dumps(document, indent=2, allow_nan=False)+'\n', encoding='utf-8', newline='\n')
    temporary_report.replace(report)
    lines = ['# Orthophoto review inventory', '',
             'Mechanical coverage/nonblank checks passed. Visual review and geometry adoption are not asserted.', '',
             'Colours: cyan green; white tee/mark/building; yellow bunker; pink fairway; blue water/stream; orange path/parking.', '',
             'Trace the original-size individual panels using the JSON pixel-edge affine; contact sheets are thumbnails.', '',
             '| Panel | Feature counts (overlapping bounds) |', '| --- | --- |']
    for p in panels:
        counts = ', '.join(f'{k}: {v}' for k, v in sorted(p['visibleFeatureCounts'].items()))
        lines.append(f'| {p["id"]} | {counts} |')
    (args.out/'inventory.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    print(report)


if __name__ == '__main__':
    main()
