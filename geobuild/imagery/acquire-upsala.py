#!/usr/bin/env python3
"""Acquire bounded Upsala primary sources through their advertised public APIs.

Examples (standard library + Pillow):
  python acquire_upsala_public_sources.py --provider lm-latest --resolution .25 --output-dir sources
  python acquire_upsala_public_sources.py --provider municipal-2024 --resolution .25 --output-dir sources
  python acquire_upsala_public_sources.py --provider buildings --output-dir sources
  python acquire_upsala_public_sources.py --provider lm-latest --resolution .16 --bbox 639480 6635900 640080 6636500 --prefix lm2025_range_club_016m --output-dir sources

The default bbox is EPSG:3006 [639119.5,6635121.5,641167.5,6637169.5].
Raster output is bounded to 4096px per request and includes pixel-centre worldfiles,
exact request URLs, checksums and extents. No authentication or credentials are used.
No raster redistribution licence is inferred from public API accessibility. The
Lantmateriet proxy URL is advertised by public municipal webmap item
efc08fa6a37d4e1dbd468327958acd02. Its flight-year layer must be checked: the item
title alone is not sufficient. On 2026-09-05 it rendered 2025 across this bbox.
Do not interpret product GSD, edit dates, or publication dates as positional
accuracy or survey/acquisition dates. Individual building source methods remain
in the raw response and must be retained by any importer.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from PIL import Image, ImageStat

ORTO2024 = 'https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto/Ortofoto_2024/MapServer'
PORTAL = 'https://kartportal.uppsala.se/portal/sharing/rest/content/items/'
LM_PROXY = 'https://kartportal.uppsala.se/proxy/0rt0'
BUILDINGS = 'https://kartportal.uppsala.se/mapping/rest/services/iOpenData/OpenData_Byggnader/FeatureServer/1'
DEFAULT_BBOX = [639119.5, 6635121.5, 641167.5, 6637169.5]


def get(url):
    with urlopen(url, timeout=55) as response:
        return response.read(), response.headers.get('Content-Type', '')


def record(out, name, url, raw, suffix, extra=None):
    path = out / (name + suffix)
    path.write_bytes(raw)
    manifest = {
        'url': url, 'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'sha256': sha256(raw).hexdigest(), 'bytes': len(raw),
        'output': path.name, **(extra or {}),
    }
    (out / (name + '.request.json')).write_text(json.dumps(manifest, indent=2))
    return path


def get_json(out, name, url):
    raw, _ = get(url)
    data = json.loads(raw)
    record(out, name, url, raw, '.json')
    if 'error' in data:
        raise RuntimeError(f'{name}: {data["error"]}')
    return data


def spatial_query(bbox):
    return {
        'f': 'pjson', 'where': '1=1', 'geometry': ','.join(map(str, bbox)),
        'geometryType': 'esriGeometryEnvelope', 'inSR': 3006,
        'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*',
        'returnGeometry': 'true', 'outSR': 3006,
    }


def metadata(out, provider, bbox):
    if provider == 'municipal-2024':
        get_json(out, 'ortho2024_service', ORTO2024 + '?f=pjson')
        get_json(out, 'ortho2024_item', PORTAL + '33e9f30e12124fdbb45a441dfb971624?f=pjson')
        get_json(out, 'ortho2024_footprints', ORTO2024 + '/2/query?' + urlencode(spatial_query(bbox)))
    elif provider == 'lm-latest':
        get_json(out, 'lm_latest_webmap_item', PORTAL + 'efc08fa6a37d4e1dbd468327958acd02?f=pjson')
        get_json(out, 'lm_latest_webmap_data', PORTAL + 'efc08fa6a37d4e1dbd468327958acd02/data?f=pjson')
        url = LM_PROXY + '?' + urlencode({'service': 'WMS', 'request': 'GetCapabilities', 'version': '1.3.0'})
        raw, _ = get(url)
        record(out, 'lm_latest_wms_capabilities', url, raw, '.xml')
    elif provider == 'buildings':
        get_json(out, 'municipal_buildings_metadata', BUILDINGS + '?f=pjson')
        response = get_json(out, 'municipal_buildings_aoi', BUILDINGS + '/query?' + urlencode(spatial_query(bbox)))
        if response.get('exceededTransferLimit'):
            raise RuntimeError('Building query exceeded its transfer limit; do not use incomplete geometry.')
        print('buildings:', len(response.get('features', [])), flush=True)


def image_request(provider, bbox, width, height, layer=None):
    if provider == 'municipal-2024':
        url = ORTO2024 + '/export?' + urlencode({
            'f': 'pjson', 'bbox': ','.join(map(str, bbox)), 'bboxSR': 3006,
            'imageSR': 3006, 'size': f'{width},{height}', 'format': 'png32',
            'transparent': 'false',
        })
        raw, _ = get(url)
        data = json.loads(raw)
        if 'href' not in data:
            raise RuntimeError(f'ArcGIS image export failed: {data}')
        e = data['extent']
        actual = [e['xmin'], e['ymin'], e['xmax'], e['ymax']]
        if data['width'] != width or data['height'] != height or any(abs(a-b) > 1e-6 for a,b in zip(actual,bbox)):
            raise RuntimeError(f'Unexpected export extent/dimensions: {data}')
        pixels, content_type = get(data['href'])
        return url, pixels, content_type, data
    url = LM_PROXY + '?' + urlencode({
        'service': 'WMS', 'request': 'GetMap', 'version': '1.1.1',
        'srs': 'EPSG:3006', 'bbox': ','.join(map(str, bbox)),
        'width': width, 'height': height, 'styles': '',
        'format': 'image/png', 'transparent': 'false',
        'layers': layer or 'Ortofoto_0.16',
    })
    pixels, content_type = get(url)
    return url, pixels, content_type, None


def export_image(out, provider, name, bbox, width, height, layer=None):
    url, pixels, content_type, response = image_request(provider, bbox, width, height, layer)
    if 'image' not in content_type:
        raise RuntimeError(f'{name}: response is {content_type}, not an image: {pixels[:200]!r}')
    with Image.open(BytesIO(pixels)) as image:
        if image.size != (width, height):
            raise RuntimeError(f'{name}: wrong pixel dimensions {image.size}')
        stats = ImageStat.Stat(image.convert('RGB'))
        if not layer and max(stats.stddev) < 1:
            raise RuntimeError(f'{name}: uniform image suggests no data')
        quality = {'rgbMean': stats.mean, 'rgbStddev': stats.stddev}
    sx, sy = (bbox[2]-bbox[0])/width, (bbox[3]-bbox[1])/height
    path = record(out, name, url, pixels, '.png', {
        'provider': provider, 'crs': 'EPSG:3006', 'extent': bbox,
        'dimensions': [width, height], 'resolutionM': [sx, sy],
        'sourceNativeResolutionM': .08 if provider == 'municipal-2024' else .16,
        'sourceProductYear': 2024 if provider == 'municipal-2024' else None,
        'sourceFlightYearVerification': None if provider == 'municipal-2024' else 'Inspect flight-year metadata raster; observed2025 for defaultbbox on2026-09-05.',
        'horizontalAccuracyRMSEM': None, 'exactFlightDate': None,
        'rights': 'Public advertised viewing API; imagery-specific redistribution terms not established. Retain source raster for analysis; do not label CC0.',
        'quality': quality,
    })
    (out / (name + '.pgw')).write_text(f'{sx}\n0\n0\n{-sy}\n{bbox[0]+sx/2}\n{bbox[3]-sy/2}\n')
    if response:
        (out / (name + '.export.json')).write_text(json.dumps(response, indent=2))
    print(path.name, len(pixels), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--provider', choices=['municipal-2024', 'lm-latest', 'buildings'], required=True)
    p.add_argument('--bbox', nargs=4, type=float, default=DEFAULT_BBOX)
    p.add_argument('--resolution', type=float, default=.25)
    p.add_argument('--output-dir', type=Path, required=True)
    p.add_argument('--prefix')
    p.add_argument('--skip-metadata', action='store_true')
    p.add_argument('--metadata-only', action='store_true')
    p.add_argument('--workers', type=int, default=3)
    args = p.parse_args()
    if args.resolution <= 0 or not 1 <= args.workers <= 4:
        p.error('resolution must be positive and workers must be1..4')
    b = args.bbox
    if b[0] >= b[2] or b[1] >= b[3]:
        p.error('bbox must be xmin ymin xmax ymax')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if not args.skip_metadata:
        metadata(args.output_dir, args.provider, b)
    if args.metadata_only or args.provider == 'buildings':
        return
    w, h = (round((b[2]-b[0])/args.resolution), round((b[3]-b[1])/args.resolution))
    if any(abs(length/args.resolution-round(length/args.resolution)) > 1e-6 for length in [b[2]-b[0], b[3]-b[1]]):
        p.error('bbox dimensions must be exact multiples of resolution')
    cols, rows = math.ceil(w/4096), math.ceil(h/4096)
    prefix = args.prefix or args.provider.replace('-', '_')
    jobs = []
    for row in range(rows):
        for col in range(cols):
            x, y = col*4096, row*4096
            tw, th = min(4096, w-x), min(4096, h-y)
            bounds = [b[0]+x*args.resolution, b[3]-(y+th)*args.resolution,
                      b[0]+(x+tw)*args.resolution, b[3]-y*args.resolution]
            suffix = '' if cols*rows == 1 else f'_r{row}_c{col}'
            jobs.append((args.output_dir,args.provider,prefix+suffix,bounds,tw,th))
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda job: export_image(*job), jobs))
    if args.provider == 'lm-latest':
        scale = max(w,h)/2048
        fw,fh=max(1,round(w/scale)),max(1,round(h/scale))
        export_image(args.output_dir,args.provider,prefix+'_flightyear',b,fw,fh,'Ortofoto_0.16_meta')


if __name__ == '__main__':
    main()
