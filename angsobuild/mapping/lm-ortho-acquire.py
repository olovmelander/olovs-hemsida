"""Acquire georeferenced Lantmateriet RGBI review windows for all 18 Angso holes.

Run with the repository's ignored Python environment (rasterio, numpy, pyproj,
Pillow). Credentials use LANTMATERIET_* environment variables or the local .env;
they are never written or logged. Raw pixels stay in angsobuild/cache/lm-ortho.
"""
import argparse
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'visbybuild/mapping'))
from lm_ortho import authorization, digest, probe_sources, source_url


def credentials():
    # Parse only the three supported names; do not execute the dotenv file.
    env = dict(os.environ)
    file = ROOT / '.env'
    if file.exists():
        for line in file.read_text(encoding='utf-8-sig').splitlines():
            key, sep, value = line.partition('=')
            key = key.strip()
            if sep and key in ('LANTMATERIET_USERNAME', 'LANTMATERIET_PASSWORD', 'LANTMATERIET_BEARER_TOKEN'):
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'':
                    value = value[1:-1]
                env.setdefault(key, value)
    return authorization(env)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def make_plan():
    from pyproj import Transformer
    discovery = json.loads((ROOT / 'geo_data/course-v2/angso/acquisition/d2-discovery.json').read_text(encoding='utf-8'))
    ortho = discovery['orthophoto']
    if discovery['groundId'] != 'angso' or not ortho['coverage']['complete'] or ortho['horizontalCrs'] != 'EPSG:3006':
        raise ValueError('Expected complete Angso EPSG:3006 discovery')
    resolution = ortho['resolutionMetres']
    anchor = ortho['items'][0]['projBbox'][:2]
    transform = Transformer.from_crs(4326, 3006, always_xy=True)
    windows, all_points, models = [], [], []

    def window(identifier, points, margin, output_resolution, **details):
        lo = [min(p[a] for p in points) - margin for a in range(2)]
        hi = [max(p[a] for p in points) + margin for a in range(2)]
        bounds = [round(anchor[a] + math.floor((lo[a] - anchor[a]) / output_resolution) * output_resolution, 6) for a in range(2)]
        bounds += [round(anchor[a] + math.ceil((hi[a] - anchor[a]) / output_resolution) * output_resolution, 6) for a in range(2)]
        width, height = [round((bounds[a+2]-bounds[a])/output_resolution) for a in range(2)]
        if width * height > 16_000_000:
            raise ValueError('Review window exceeds 16 megapixels')
        aoi = discovery['aoi']['bboxEpsg3006']
        if any(bounds[a] < aoi[a] or bounds[a+2] > aoi[a+2] for a in range(2)):
            raise ValueError('Window exceeds discovered AOI')
        ids = [i['id'] for i in ortho['items'] if all(bounds[a] < i['projBbox'][a+2] and bounds[a+2] > i['projBbox'][a] for a in range(2))]
        return dict(id=identifier, boundsEpsg3006=bounds, width=width, height=height,
                    resolutionMetres=output_resolution, sourceIds=ids, **details)

    all_features = []
    for course, filename in [('angso', 'angsobuild/course-model.json')]:
        file = ROOT / filename
        model = json.loads(file.read_text(encoding='utf-8'))
        models.append(dict(course=course, file=filename, sha256=digest(file)))
        def projected(p):
            # Same inverse as angsobuild/lib.mjs, followed by authoritative PROJ.
            origin = model['origin']
            metres_lon = model['mPerLat'] * math.cos(math.radians(origin['lat']))
            return list(transform.transform(origin['lon'] + p[0] / metres_lon,
                                            origin['lat'] - p[1] / model['mPerLat']))
        water_features = [dict(kind='water', sourceId=w.get('id'), ring=list(map(projected, w['ring'])))
                          for w in model.get('water', [])]
        for hole in model['holes']:
            features = [dict(kind='green', sourceId=hole['green'].get('sourceId'), ring=list(map(projected, hole['green']['ring'])))]
            features += [dict(kind='bunker', sourceId=b.get('sourceId'), ring=list(map(projected, b['ring']))) for b in hole['bunkers']]
            full_features = features + [dict(kind='fairway', ring=list(map(projected, ring))) for ring in hole['fairway']['rings']]
            full_features += [dict(kind='tee', ring=list(map(projected, pad['ring']))) for pad in hole['tees']['pads']]
            full_points = [p for f in full_features for p in f['ring']] + list(map(projected, hole['line']))
            full_points += list(map(projected, [mark['c'] for mark in hole['tees']['marks']]))
            all_points += full_points
            hole_window = window(f'{course}-{hole["n"]:02d}-hole', full_points, 50, resolution,
                                 course=course, hole=hole['n'], purpose='native complete hole fairway, tees, green, bunkers and nearby water review', features=full_features)
            bounds = hole_window['boundsEpsg3006']
            nearby_water = [f for f in water_features if all(min(p[a] for p in f['ring']) < bounds[a+2]
                               and max(p[a] for p in f['ring']) > bounds[a] for a in range(2))]
            hole_window['features'] += nearby_water
            all_features += full_features
            windows.append(hole_window)
        # Preserve all practice and nearby context in the estate overview.
        for kind, values in model.get('scenery', {}).items():
            if not isinstance(values, list):
                continue
            for value in values:
                ring = value.get('ring') if isinstance(value, dict) else value
                if ring and isinstance(ring[0], list) and len(ring[0]) == 2:
                    all_points += list(map(projected, ring))
    # Five native pixels divide the 15,625-pixel source tile width exactly;
    # a four-pixel coarse grid would straddle the source seam at a quarter cell.
    windows.insert(0, window('ground-overview', all_points, 100, resolution*5,
                            purpose='all 18 holes, practice ground and surrounding alignment context', features=all_features))
    sources = [dict(id=i['id'], href=i['assets']['data']['href'], bytes=i['assets']['data']['bytes'],
                    boundsEpsg3006=i['projBbox'], width=i['assets']['data']['projShape'][1],
                    height=i['assets']['data']['projShape'][0], capturedAt=i['capturedAt'],
                    captureStart=i.get('captureStart'), captureEnd=i.get('captureEnd')) for i in ortho['items']
               if any(i['id'] in w['sourceIds'] for w in windows)]
    return dict(schemaVersion=1, groundId='angso', kind='authenticated-orthophoto-review-plan',
                createdAt=datetime.now(timezone.utc).isoformat(), collection=ortho['collection'],
                horizontalCrs='EPSG:3006', nativeResolutionMetres=resolution, captureRange=ortho['captureRange'],
                sourceDiscoverySha256=digest(ROOT / 'geo_data/course-v2/angso/acquisition/d2-discovery.json'),
                models=models, sources=sources, windows=windows,
                localFrameInverse='lon=16.871+x/(111320*cos(59.57390 degrees)); lat=59.57390-z/111320; project WGS84 to EPSG:3006 with PROJ',
                pixelConvention='bounds are pixel edges; E=minE+(column+0.5)*resolution; N=maxN-(row+0.5)*resolution',
                limitations=['Image ground sample distance is not absolute horizontal accuracy.',
                             'Review extents and existing feature overlays do not establish corrected boundaries.',
                             'Raw imagery remains in the ignored cache and is not a runtime texture.'])


def acquire(plan, selected, cache, report_file, probe_only=False):
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling, ColorInterp
    from rasterio.merge import merge
    from rasterio.transform import array_bounds
    from PIL import Image, ImageDraw
    auth = credentials()
    sources = [s for s in plan['sources'] if any(s['id'] in w['sourceIds'] for w in selected)]
    access = probe_sources(sources, auth)
    report = dict(schemaVersion=1, groundId='angso', state='access-verified' if access['authorized'] else 'blocked',
                  observedAt=datetime.now(timezone.utc).isoformat(), horizontalCrs='EPSG:3006',
                  collection=plan['collection'], nativeResolutionMetres=plan['nativeResolutionMetres'],
                  planSha256=digest(cache / 'plan.json'), access=access, windows=[], sources=sources,
                  rawImageryRedistributed=False, geometryChanged=False,
                  attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.',
                  terms='https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder_pu.pdf')
    write_json(report_file, report)
    if not access['authorized']:
        print(json.dumps({'state':report['state'], 'access':access}), flush=True)
        raise ValueError('Orthophoto byte-range access failed')
    if probe_only:
        print(json.dumps({'state':report['state'], 'access':access}), flush=True)
        return
    environment = dict(GDAL_HTTP_HEADERS='Authorization: ' + auth, GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
                       CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='60', GDAL_HTTP_MAX_RETRY='2',
                       CPL_CURL_VERBOSE=False, CPL_DEBUG=False, GDAL_HTTP_NETRC='NO',
                       GDAL_TIFF_INTERNAL_MASK=True,
                       GDAL_HTTP_AUTH_HEADER_ALLOWED_IF_REDIRECT='IF_SAME_HOST')
    with rasterio.Env(**environment), contextlib.ExitStack() as stack:
        datasets = {}
        for source in sources:
            src = stack.enter_context(rasterio.open('/vsicurl/' + source_url(source['href'])))
            if (src.crs.to_epsg() != 3006 or src.count != 4 or src.dtypes != ('uint8',)*4 or
                    src.width != source['width'] or src.height != source['height'] or
                    not np.allclose(src.bounds, source['boundsEpsg3006'], rtol=0, atol=1e-6) or
                    not np.allclose(src.res, [plan['nativeResolutionMetres']]*2, rtol=0, atol=1e-8) or
                    src.transform.b != 0 or src.transform.d != 0):
                raise ValueError('Pinned RGBI source grid changed')
            datasets[source['id']] = src
        for window in selected:
            out = cache / (window['id'] + '.tif')
            ledger = out.with_suffix('.json')
            request_hash = hashlib.sha256(json.dumps(dict(window=window, sources=sources), sort_keys=True).encode()).hexdigest()
            if out.exists() and ledger.exists():
                old = json.loads(ledger.read_text(encoding='utf-8'))
                if old.get('requestSha256') == request_hash and old['sha256'] == digest(out):
                    report['windows'].append(old)
                    write_json(report_file, report)
                    continue
            resolution = window['resolutionMetres']
            resampling = Resampling.nearest if resolution == plan['nativeResolutionMetres'] else Resampling.average
            pixels, trans = merge([datasets[i] for i in window['sourceIds']], bounds=window['boundsEpsg3006'],
                                  res=resolution, masked=True, resampling=resampling)
            bounds = list(array_bounds(pixels.shape[1], pixels.shape[2], trans))
            valid = ~np.ma.getmaskarray(pixels).any(axis=0)
            if (pixels.shape != (4, window['height'], window['width']) or not valid.all() or
                    not np.allclose(bounds, window['boundsEpsg3006'], rtol=0, atol=1e-6) or
                    any(float(pixels[b].std()) == 0 for b in range(3))):
                raise ValueError('Incomplete, empty or misaligned review window')
            temp = out.with_suffix('.partial.tif')
            with rasterio.open(temp, 'w', driver='GTiff', width=window['width'], height=window['height'],
                               count=4, dtype='uint8', crs=3006, transform=trans, compress='deflate', tiled=True) as dst:
                dst.write(pixels.filled(0))
                # TIFF defaults otherwise interpret the fourth byte band as
                # alpha, silently turning measured NIR into an opacity mask.
                dst.colorinterp=(ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.undefined)
                dst.descriptions=('red', 'green', 'blue', 'near infrared')
                dst.write_mask(valid.astype('uint8')*255)
            temp.replace(out)
            # GDAL's create path may restore the default alpha interpretation
            # while closing a four-band TIFF. Persist the declaration in update
            # mode, then verify after reopen before hashing the artifact.
            with rasterio.open(out, 'r+') as dst:
                dst.colorinterp=(ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.undefined)
            with rasterio.open(out) as verified:
                if verified.colorinterp != (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.undefined):
                    raise ValueError('RGBI band semantics did not persist')
            preview = out.with_suffix('.png')
            rgb = Image.fromarray(pixels[:3].filled(0).transpose(1,2,0))
            rgb.save(preview)
            overlay = rgb.copy()
            draw = ImageDraw.Draw(overlay)
            for f in window.get('features', []):
                ring = [((p[0]-bounds[0])/resolution, (bounds[3]-p[1])/resolution) for p in f['ring']]
                draw.line(ring+[ring[0]], fill={'green':(30,255,70),'bunker':(255,70,235),'fairway':(255,225,20),'tee':(40,220,255),'water':(30,100,255)}[f['kind']], width=3)
            overlay.save(out.with_name(window['id']+'-overlay.png'))
            preview.with_suffix('.pgw').write_text('\n'.join(map(str,[resolution,0,0,-resolution,bounds[0]+resolution/2,bounds[3]-resolution/2]))+'\n')
            record = dict(id=window['id'], rasterFile=out.name, rgbFile=preview.name, sha256=digest(out),
                          rgbSha256=digest(preview), requestSha256=request_hash, bytes=out.stat().st_size,
                          boundsEpsg3006=bounds, geoTransform=list(trans.to_gdal()), width=window['width'], height=window['height'],
                          resolutionMetres=resolution, resampling=resampling.name, validFraction=float(valid.mean()),
                          bands=['red','green','blue','near infrared'], mask='explicit dataset validity; NIR is not alpha',
                          acquiredAt=datetime.now(timezone.utc).isoformat(),
                          sources=[{k:s[k] for k in ('id','capturedAt','captureStart','captureEnd')} for s in sources if s['id'] in window['sourceIds']])
            write_json(ledger, record)
            report['windows'].append(record)
            write_json(report_file, report)
            print(json.dumps({k:record[k] for k in ('id','rasterFile','width','height','validFraction')}), flush=True)
    report['state']='acquired-for-review'
    write_json(report_file, report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', default='')
    parser.add_argument('--probe-only', action='store_true')
    parser.add_argument('--plan-only', action='store_true')
    parser.add_argument('--replan', action='store_true', help='Explicitly replace the pinned baseline plan from current course models')
    args = parser.parse_args()
    cache = ROOT / 'angsobuild/cache/lm-ortho'
    reference = ROOT / 'geo_data/course-v2/angso/reference/lm-ortho-plan-2026-09-09.json'
    plan = make_plan() if args.replan or not reference.exists() else json.loads(reference.read_text(encoding='utf-8'))
    if plan.get('groundId') != 'angso' or plan.get('horizontalCrs') != 'EPSG:3006':
        raise ValueError('Expected a pinned Angso EPSG:3006 plan')
    if any(not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', w['id']) for w in plan['windows']):
        raise ValueError('Invalid review window file identifier')
    if len({w['id'] for w in plan['windows']}) != len(plan['windows']):
        raise ValueError('Duplicate review window file identifier')
    if any(not isinstance(w['width'], int) or not isinstance(w['height'], int) or
           w['width'] <= 0 or w['height'] <= 0 or w['width'] * w['height'] > 16_000_000 for w in plan['windows']):
        raise ValueError('Invalid review window pixel budget')
    write_json(cache / 'plan.json', plan)
    write_json(reference, plan)
    selected = plan['windows']
    if args.only:
        names = set(args.only.split(','))
        selected = [w for w in selected if w['id'] in names]
        if len(selected) != len(names):
            raise ValueError('Unknown window selection')
    if args.plan_only:
        print(json.dumps({'windows':len(plan['windows']), 'collection':plan['collection']}))
        return
    # Partial retries and probes must not replace the complete public ledger.
    report = cache / 'selected-acquisition.json' if args.only or args.probe_only else ROOT / 'geo_data/course-v2/angso/reference/lm-ortho-acquisition-2026-09-09.json'
    try:
        acquire(plan, selected, cache, report, args.probe_only)
    except Exception as exc:
        if report.exists():
            evidence = json.loads(report.read_text(encoding='utf-8'))
            evidence.update(state='failed', errorType=type(exc).__name__)
            write_json(report, evidence)
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Third-party errors may include HTTP headers. Never serialize them.
        import traceback
        print(json.dumps({'state':'failed', 'errorType':type(exc).__name__,
                          'locations':[dict(file=Path(f.filename).name,line=f.lineno) for f in traceback.extract_tb(exc.__traceback__)]}), file=sys.stderr)
        raise SystemExit(1)
