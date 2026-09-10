"""Acquire current LM tee and boundary review windows into the ignored cache.

First run node lidingobuild/mapping/lm-ortho-discover.mjs. Credentials are read
through the existing bounded LM acquisition helper, never logged. RGBI rasters,
RGB previews and gridded overlays remain local; only evidence metadata is saved.
"""
import argparse
import contextlib
from datetime import datetime, timezone
import importlib.util
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('lm_common', ROOT / 'upsalabuild/mapping/lm-ortho-acquire.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
CACHE = ROOT / 'lidingobuild/cache/lm-ortho'
EVIDENCE = ROOT / 'lidingobuild/mapping/lm-latest-ortho-2026-09-09.json'
ORIGIN = [677700.5, 6586399.5]


def projected(point):
    return [ORIGIN[0] + point[0], ORIGIN[1] - point[1]]


def plan_windows(catalog, model):
    anchor = catalog['items'][0]['projBbox'][:2]
    def window(identifier, points, resolution, margin, **extra):
        bounds = [anchor[a] + math.floor((min(p[a] for p in points)-margin-anchor[a])/resolution)*resolution for a in range(2)]
        bounds += [anchor[a] + math.ceil((max(p[a] for p in points)+margin-anchor[a])/resolution)*resolution for a in range(2)]
        bounds = [round(v, 6) for v in bounds]
        width, height = [round((bounds[a+2]-bounds[a])/resolution) for a in range(2)]
        if not 0 < width*height <= 16_000_000:
            raise ValueError('Oversized review window')
        return dict(id=identifier, boundsEpsg3006=bounds, resolutionMetres=resolution,
                    width=width, height=height, sourceIds=[i['id'] for i in catalog['items'] if
                    all(bounds[a]<i['projBbox'][a+2] and bounds[a+2]>i['projBbox'][a] for a in range(2))], **extra)
    aoi = catalog['aoi']['bboxEpsg3006']
    windows = [window('ground-overview', [aoi[:2], aoi[2:]], .8, 0)]
    for hole in model['holes']:
        route, distance = [hole['line'][0]], 0
        for a, b in zip(hole['line'], hole['line'][1:]):
            segment = math.dist(a, b)
            if distance+segment >= 170:
                fraction = (170-distance)/segment
                route.append([a[j]+(b[j]-a[j])*fraction for j in range(2)])
                break
            route.append(b)
            distance += segment
        rings = [p['ring'] for p in hole['tees']['pads']]
        points = list(map(projected, route + [p for ring in rings for p in ring]))
        windows.append(window(f'hole-{hole["n"]:02d}-tees', points, .16, 45,
                              hole=hole['n'], features=[dict(kind='tee', ring=list(map(projected, r))) for r in rings]))
    for number in [2, 11, 12, 14, 15]:
        hole = next(h for h in model['holes'] if h['n']==number)
        points = hole['line'] if number in [11, 15] else hole['green']['ring']
        windows.append(window(f'hole-{number:02d}-boundary', list(map(projected, points)), .16, 55, hole=number))
    windows.append(window('hole-02-boundary-west', [[677920,6585790],[678045,6585920]], .16, 0, hole=2))
    windows.append(window('hole-04-tees-forward', [[677680,6586100],[678005,6586410]], .16, 0, hole=4))
    return windows


def acquire(only=None):
    import numpy as np
    import rasterio
    from rasterio.enums import ColorInterp, Resampling
    from rasterio.merge import merge
    from rasterio.transform import array_bounds
    from PIL import Image, ImageDraw, ImageFont
    catalog = json.loads((CACHE / 'catalog.json').read_text())
    model = json.loads((ROOT / 'lidingobuild/course-model.json').read_text())
    if catalog['collection']!='orto-o2-2025' or not catalog['coverage']['complete']:
        raise ValueError('Review updated catalog before changing the pinned campaign')
    sources = [dict(id=i['id'], href=i['assets']['data']['href'], bytes=i['assets']['data']['bytes'],
                    width=i['assets']['data']['projShape'][1], height=i['assets']['data']['projShape'][0],
                    boundsEpsg3006=i['projBbox'], capturedAt=i['capturedAt']) for i in catalog['items']]
    windows = plan_windows(catalog, model)
    common.write_json(CACHE / 'plan.json', dict(groundId='lidingo', sources=sources, windows=windows))
    if only:
        windows = [w for w in windows if w['id'] in only.split(',')]
    auth = common.credentials()
    access = common.probe_sources(sources, auth)
    report = dict(schemaVersion=1, groundId='lidingo', kind='latest-orthophoto-acquisition-evidence',
                  observedAt=datetime.now(timezone.utc).isoformat(), state='acquiring',
                  catalog=catalog, catalogSha256=common.digest(CACHE / 'catalog.json'),
                  access=access, sources=sources, windows=[], horizontalCrs='EPSG:3006',
                  nativeResolutionMetres=.16, localOriginEpsg3006=ORIGIN,
                  localConvention='x=E-677700.5; z=6586399.5-N',
                  pixelConvention='Pixel edges at bounds; E=minE+(col+0.5)*res; N=maxN-(row+0.5)*res',
                  rawImageryRedistributed=False,
                  attribution='Ortofoto Nedladdning, © Lantmäteriet, processed information, CC BY 4.0.',
                  limitations=['Ground sample distance is not absolute positional accuracy.',
                               'Capture on 2025-05-31 does not establish changes after that date.',
                               'Moving tee markers and individual OB stakes may be unresolved or occluded; do not infer surveyed positions from pixels.'])
    report_file = CACHE / 'selected-acquisition.json' if only else EVIDENCE
    common.write_json(report_file, report)
    if not access['authorized']:
        raise ValueError('Authenticated byte-range access failed')
    environment = dict(GDAL_HTTP_HEADERS='Authorization: '+auth, GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
                       CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='60', GDAL_HTTP_MAX_RETRY='2',
                       CPL_CURL_VERBOSE=False, CPL_DEBUG=False, GDAL_HTTP_NETRC='NO', GDAL_TIFF_INTERNAL_MASK=True,
                       GDAL_HTTP_AUTH_HEADER_ALLOWED_IF_REDIRECT='IF_SAME_HOST')
    with rasterio.Env(**environment), contextlib.ExitStack() as stack:
        datasets = {}
        for source in sources:
            src = stack.enter_context(rasterio.open('/vsicurl/'+common.source_url(source['href'])))
            if (src.crs.to_epsg()!=3006 or src.count!=4 or src.width!=source['width'] or src.height!=source['height']
                or not np.allclose(src.bounds, source['boundsEpsg3006'], rtol=0, atol=1e-6)
                or not np.allclose(src.res, [.16,.16], rtol=0, atol=1e-8)):
                raise ValueError('Pinned RGBI source grid changed')
            datasets[source['id']] = src
        for window in windows:
            out = CACHE / (window['id']+'.tif')
            ledger = out.with_suffix('.json')
            if out.exists() and ledger.exists():
                record = json.loads(ledger.read_text())
                if record['boundsEpsg3006']==window['boundsEpsg3006'] and record['sha256']==common.digest(out):
                    report['windows'].append(record)
                    common.write_json(report_file, report)
                    continue
            resolution = window['resolutionMetres']
            resampling = Resampling.nearest if resolution==.16 else Resampling.average
            pixels, transform = merge([datasets[i] for i in window['sourceIds']], bounds=window['boundsEpsg3006'],
                                       res=resolution, masked=True, resampling=resampling)
            bounds = list(array_bounds(pixels.shape[1], pixels.shape[2], transform))
            valid = ~np.ma.getmaskarray(pixels).any(axis=0)
            if (pixels.shape!=(4, window['height'], window['width']) or not valid.all()
                or not np.allclose(bounds, window['boundsEpsg3006'], rtol=0, atol=1e-6)):
                raise ValueError('Incomplete or misaligned review window')
            with rasterio.open(out, 'w', driver='GTiff', width=window['width'], height=window['height'],
                               count=4, dtype='uint8', crs=3006, transform=transform, tiled=True,
                               compress='deflate', photometric='RGB', ALPHA='UNSPECIFIED') as dst:
                dst.write(pixels.filled(0))
                dst.colorinterp=(ColorInterp.red,ColorInterp.green,ColorInterp.blue,ColorInterp.undefined)
                dst.descriptions=('red','green','blue','near infrared')
                dst.write_mask(valid.astype('uint8')*255)
            rgb = Image.fromarray(pixels[:3].filled(0).transpose(1,2,0))
            rgb.save(out.with_suffix('.png'))
            out.with_suffix('.pgw').write_text('\n'.join(map(str,[resolution,0,0,-resolution,bounds[0]+resolution/2,bounds[3]-resolution/2]))+'\n')
            overlay = rgb.copy()
            draw = ImageDraw.Draw(overlay)
            for f in window.get('features', []):
                ring = [((p[0]-bounds[0])/resolution,(bounds[3]-p[1])/resolution) for p in f['ring']]
                draw.line(ring+[ring[0]], fill=(255,60,235), width=3)
            # Image pixel grid retains exact coordinates on downsampled previews.
            for x in range(0,window['width'],200):
                draw.line([(x,0),(x,window['height'])], fill=(150,150,150), width=1)
                draw.text((x+3,20), str(x), fill='white', stroke_fill='black', stroke_width=2)
            for y in range(0,window['height'],200):
                draw.line([(0,y),(window['width'],y)], fill=(150,150,150), width=1)
                draw.text((3,y+3), str(y), fill='white', stroke_fill='black', stroke_width=2)
            overlay.thumbnail((1400,1400), Image.Resampling.LANCZOS)
            overlay.save(CACHE / (window['id']+'-review.png'))
            record = dict(id=window['id'], rasterFile=out.relative_to(ROOT).as_posix(),
                          rgbFile=out.with_suffix('.png').relative_to(ROOT).as_posix(),
                          reviewFile=(CACHE/(window['id']+'-review.png')).relative_to(ROOT).as_posix(),
                          sha256=common.digest(out), sha256Content='GeoTIFF file bytes',
                          rgbSha256=common.digest(out.with_suffix('.png')),
                          boundsEpsg3006=bounds, geoTransform=list(transform.to_gdal()),
                          width=window['width'],height=window['height'], resolutionMetres=resolution,
                          validFraction=float(valid.mean()), resampling=resampling.name, sourceIds=window['sourceIds'],
                          acquiredAt=datetime.now(timezone.utc).isoformat())
            common.write_json(ledger, record)
            report['windows'].append(record)
            common.write_json(report_file, report)
            print(json.dumps(dict(id=window['id'], width=window['width'],height=window['height'])), flush=True)
    report['state']='acquired-for-review'
    common.write_json(report_file, report)


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only')
    args = parser.parse_args()
    try:
        acquire(args.only)
    except Exception as exc:
        import traceback
        print(json.dumps(dict(state='failed', errorType=type(exc).__name__,
                              locations=[dict(file=Path(f.filename).name,line=f.lineno) for f in traceback.extract_tb(exc.__traceback__)])), file=sys.stderr)
        raise SystemExit(1)
