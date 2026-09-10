#!/usr/bin/env python3
"""Prepare measured Veckefjarden facility plan references; never change course data.

Run with geobuild/cache/ortho-venv/Scripts/python.exe. Native panels preserve the
source 0.16 m grid. Roof traces are manually interpreted image edges, never
surveyed wall footprints or roof heights. Reference images remain in ignored cache.
"""
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import CRS, Transformer
import rasterio
from rasterio.merge import merge

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'geobuild/cache/facilities-2026-09-10/ortho'
SOURCE = ROOT / 'geobuild/cache/lm-ortho-veckefjarden'
ORIGIN = [684390.0, 7023040.0]
RES = .16
GRID = [682884.96, 7024027.04]
PANEL_SPECS = [
    ('facility-overview', [684080, 7022530, 684540, 7023340], .64),
    ('campus-native', [684340, 7022910, 684475, 7023110], .16),
    ('western-buildings-native', [684140, 7022905, 684242, 7023010], .16),
    ('northern-neighbours-native', [684270, 7023150, 684390, 7023340], .16),
    ('range-tee-native', [684235, 7022720, 684365, 7022850], .16),
    ('range-practice-context', [684020, 7022540, 684500, 7022980], .64),
]


def relative(p):
    return Path(p).relative_to(ROOT).as_posix()


def sha(p):
    h = hashlib.sha256()
    with Path(p).open('rb') as f:
        for block in iter(lambda: f.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf8')


def font(size):
    return ImageFont.truetype('C:/Windows/Fonts/arial.ttf', size)


def area(r):
    # Translate before shoelace to avoid cancellation at full projected coordinates.
    r = [(p[0]-r[0][0], p[1]-r[0][1]) for p in r]
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(r, r[1:]+r[:1])))/2


def dimensions(r):
    # Minimum-area oriented bounding rectangle; report extent, not wall lengths.
    # Rectangle candidates belong to the convex hull, not concave input edges.
    pts = sorted(set(tuple(p) for p in r))
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower = []
    for point in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper = []
    for point in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    p = np.array(lower[:-1]+upper[:-1]); p -= p.mean(axis=0)
    candidates = []
    for a, b in zip(p, np.roll(p, -1, axis=0)):
        v = b-a
        if np.linalg.norm(v) < .001:
            continue
        v /= np.linalg.norm(v); w = np.array([-v[1], v[0]])
        x, y = p@v, p@w
        size = [float(np.ptp(x)), float(np.ptp(y))]
        candidates.append((size[0]*size[1], sorted(size, reverse=True)))
    return [round(v, 2) for v in min(candidates)[1]]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    model_path = ROOT/'geobuild/course-model.json'
    model = json.loads(model_path.read_text(encoding='utf8'))
    forward = Transformer.from_crs(4326, 3006, always_xy=True)
    inverse = Transformer.from_crs(3006, 4326, always_xy=True)
    project = lambda p: forward.transform(model['origin']['lon']+p[0]/model['mPerLon'], model['origin']['lat']-p[1]/model['mPerLat'])
    def legacy(p):
        lon, lat = inverse.transform(*p)
        return [(lon-model['origin']['lon'])*model['mPerLon'], -(lat-model['origin']['lat'])*model['mPerLat']]
    def geom(r):
        return {'ringEPSG3006': [[round(v, 3) for v in p] for p in r],
                'ringBlenderXY': [[round(p[0]-ORIGIN[0], 3), round(p[1]-ORIGIN[1], 3)] for p in r],
                'ringLegacyXZ': [[round(v, 3) for v in legacy(p)] for p in r],
                'areaSquareMetres': round(area(r), 2), 'dimensionsMetres': dimensions(r),
                'heightMetres': None}
    model_features = []
    for collection, kind in [('buildings', 'building'), ('parking', 'parking')]:
        for i, item in enumerate(model['infra'][collection]):
            ring = [project(p) for p in item['ring']]
            e, n = np.mean(ring, axis=0)
            if not (684080 < e < 684540 and 7022530 < n < 7023340):
                continue
            model_features.append({'id': ('B' if kind == 'building' else 'P')+str(i),
                'label': item.get('name') or f'Existing {kind} {i}', 'kind': kind,
                'geometryStatus': 'existing-model-unreviewed', 'identificationStatus': 'existing-model-label-only',
                'sourceModelPath': f'/infra/{collection}/{i}/ring', 'sourceModelProvenance': item.get('prov', 'unspecified'),
                'sourcePanelId': 'facility-overview', 'notes': 'Context only. Existing mapped polygon; not measured from this orthophoto.',
                **geom(ring)})
    spec = importlib.util.spec_from_file_location('review_renderer', ROOT/'geobuild/mapping/render-ortho-review.py')
    renderer = importlib.util.module_from_spec(spec); spec.loader.exec_module(renderer)
    panels = []; source_records = {}
    with ExitStack() as stack:
        datasets = [stack.enter_context(rasterio.open(p)) for p in sorted(SOURCE.glob('context-*.tif'))]
        for panel_id, requested, res in PANEL_SPECS:
            w, s, e, n = requested
            w = GRID[0] + math.floor((w-GRID[0])/res)*res
            e = GRID[0] + math.ceil((e-GRID[0])/res)*res
            s = GRID[1] + math.floor((s-GRID[1])/res)*res
            n = GRID[1] + math.ceil((n-GRID[1])/res)*res
            bounds = [round(v, 3) for v in (w, s, e, n)]
            selected = [ds for ds in datasets if ds.bounds.right>w and ds.bounds.left<e and ds.bounds.top>s and ds.bounds.bottom<n]
            assert renderer.rectangle_covered(bounds, [list(ds.bounds) for ds in selected]), panel_id+' has missing imagery'
            for ds in selected:
                p = Path(ds.name); meta = json.loads(p.with_suffix('.json').read_text(encoding='utf8'))
                if p.stem not in source_records:
                    actual = sha(p)
                    assert actual == meta['sha256'], p.name+' differs from acquisition hash'
                    source_records[p.stem] = {'id': p.stem, 'path': relative(p), 'sha256': actual,
                        'metadataPath': relative(p.with_suffix('.json')), 'metadataSha256': sha(p.with_suffix('.json')),
                        'capturedAt': meta['sources'][0]['capturedAt'], 'sourceItems': meta['sources'],
                        'boundsEPSG3006': list(ds.bounds), 'pixelSizeMetres': list(ds.res)}
            a, t = merge(selected, bounds=bounds, res=res, indexes=[1,2,3])
            assert a.shape[0] == 3 and a.dtype == np.uint8
            path = OUT/f'{panel_id}.png'
            image = Image.fromarray(np.moveaxis(a, 0, -1)); image.save(path)
            path.with_suffix('.pgw').write_text('\n'.join(str(v) for v in [t.a, t.d, t.b, t.e, t.c+t.a/2, t.f+t.e/2])+'\n', encoding='ascii')
            path.with_suffix('.prj').write_text(CRS.from_epsg(3006).to_wkt(), encoding='ascii')
            panel = {'id': panel_id, 'imagePath': relative(path), 'sha256': sha(path),
                'boundsEPSG3006': bounds, 'width': image.width, 'height': image.height,
                'pixelEdgeAffine': [t.a,t.b,t.c,t.d,t.e,t.f], 'resolutionMetres': res,
                'sourceIds': [Path(ds.name).stem for ds in selected], 'coverageChecked': True,
                'imageAxes': 'column right=east; row down=south; affine acts on pixel edges',
                'interpretation': 'RGB bands 1,2,3; native 0.16m or nearest-resampled overview; no annotations in base image'}
            panels.append(panel)
    traces_path = HERE/'ortho-traces.json'
    traces = json.loads(traces_path.read_text(encoding='utf8')) if traces_path.exists() else []
    by_panel = {p['id']:p for p in panels}
    features = []
    for record in traces:
        record = dict(record); p = by_panel[record['sourcePanelId']]
        a,b,c,d,e,f = p['pixelEdgeAffine']
        pixels = record.pop('ringPixels')
        ring = [(a*x+b*y+c,d*x+e*y+f) for x,y in pixels]
        features.append({**record, 'sourceImageSha256': p['sha256'], 'tracedRingPixels': pixels,
                         'sourceIds': p['sourceIds'], **geom(ring)})
    for panel in panels:
        path = ROOT/panel['imagePath']; image = Image.open(path).convert('RGB'); draw = ImageDraw.Draw(image)
        a,b,c,d,e,f = panel['pixelEdgeAffine']
        for feature in [*model_features, *features]:
            pts = [((x-c)/a,(y-f)/e) for x,y in feature['ringEPSG3006']]
            if not any(-30<x<image.width+30 and -30<y<image.height+30 for x,y in pts): continue
            color = '#ffd45c' if feature['geometryStatus']=='existing-model-unreviewed' else '#48ffff'
            draw.line(pts+pts[:1], fill=color, width=2)
            cx,cy = np.mean(pts, axis=0)
            draw.text((cx+3,cy+3),feature['id'],fill=color,font=font(15),stroke_width=2,stroke_fill='black')
        draw.rectangle((0,0,image.width,32),fill='#11251e')
        draw.text((8,6),f'{panel["id"]} | north up | {panel["resolutionMetres"]} m/px | cyan: reviewed edge; amber: existing model',font=font(14),fill='white')
        bar_metres = 20 if panel['resolutionMetres']>.2 else 10
        y = image.height-30; x = 20
        draw.line((x,y,x+bar_metres/a,y),fill='white',width=5)
        draw.text((x,y-24),f'{bar_metres} m',fill='white',font=font(16),stroke_width=2,stroke_fill='black')
        overlay = path.with_name(path.stem+'-overlay.png'); image.save(overlay)
        panel['overlayPath'] = relative(overlay)
    inventory = {'schemaVersion': 1, 'course': 'Veckefjarden GC', 'createdAt': '2026-09-10',
        'frame': {'epsg': 3006, 'originE': ORIGIN[0], 'originN': ORIGIN[1], 'axes': 'X east,Y north,Z up',
                  'verticalReference': 'Unresolved: all plan references at Z=0; this is not ground level or RH2000 zero.',
                  'legacyOrigin': model['origin'], 'legacyMPerLat': model['mPerLat'], 'legacyMPerLon': model['mPerLon'],
                  'legacyConversion': 'Full EPSG:4326 to EPSG:3006 projection; north=-legacy Z; do not merely translate or swap axes.'},
        'sourceModel': {'path': relative(model_path), 'sha256': sha(model_path), 'modifiedByThisScript': False},
        'measurementLimits': ['0.16 m is source pixel spacing, not absolute positional accuracy.',
            'Source absolute horizontal accuracy is unverified.', 'Roof-edge rings are image interpretations; elevated roofs can differ from wall footprints.',
            'All heights, roof pitches and wall bases remain unresolved.', 'Dimensions are minimum-area oriented bounding rectangle extents in metres.',
            'Neighbouring structures are included for visible context; ownership and golf-facility use are not inferred from proximity.'],
        'sources': list(source_records.values()), 'panels': panels, 'features': features,
        'existingModelContext': model_features}
    write_json(HERE/'inventory.json', inventory)
    write_json(OUT/'panels.json', panels)
    print(json.dumps({'panels':len(panels),'sources':len(source_records),'reviewedFeatures':len(features),'existingModelContext':len(model_features),'inventory':relative(HERE/'inventory.json')}))


if __name__ == '__main__':
    main()
