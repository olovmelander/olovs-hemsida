#!/usr/bin/env python3
"""Retain a bounded Region Gotland 2022 orthophoto as local-only review evidence.

Run from repo root with the existing Pillow review Python. Source pixels never
enter public runtime assets. The service campaign is not an exact capture date.
"""
import json
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[4]
REFERENCE = Path(__file__).resolve().parent
CACHE = ROOT / 'visbybuild/cache/geodata-2026-09-07'
SERVICE = 'https://imageserver.gotland.se/arcgis/rest/services/Ortofoto/Ortofoto_2022/ImageServer'
BBOX = [686900, 6370350, 688650, 6372150]
WIDTH, HEIGHT = 3500, 3600


def acquire(name, url):
    path = CACHE / name
    ledger = path.with_suffix(path.suffix + '.download.json')
    if path.exists() and ledger.exists():
        raw = path.read_bytes()
        record = json.loads(ledger.read_text(encoding='utf-8'))
        if sha256(raw).hexdigest() != record['sha256']:
            raise RuntimeError('Source cache changed: ' + str(path))
        return raw, record
    with urlopen(url, timeout=55) as response:
        raw = response.read()
        record = dict(url=url, acquiredAt=datetime.now(timezone.utc).isoformat(),
                      path=path.relative_to(ROOT).as_posix(), bytes=len(raw),
                      sha256=sha256(raw).hexdigest(),
                      contentType=response.headers.get('Content-Type'),
                      etag=response.headers.get('ETag'))
    path.write_bytes(raw)
    ledger.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    return raw, record


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    query = SERVICE + '/query?' + urlencode(dict(
        f='pjson', where='1=1', geometry=','.join(map(str, BBOX)),
        geometryType='esriGeometryEnvelope', inSR=3006,
        spatialRel='esriSpatialRelIntersects', outFields='*',
        returnGeometry='true', outSR=3006))
    raw_query, query_record = acquire('gotland-2022-footprints.json', query)
    footprints = json.loads(raw_query)
    if footprints.get('error') or footprints.get('exceededTransferLimit'):
        raise RuntimeError('Incomplete municipal footprint query')
    export_url = SERVICE + '/exportImage?' + urlencode(dict(
        f='pjson', bbox=','.join(map(str, BBOX)), bboxSR=3006, imageSR=3006,
        size=f'{WIDTH},{HEIGHT}', format='png', interpolation='RSP_BilinearInterpolation',
        adjustAspectRatio='false', noDataInterpretation='esriNoDataMatchAny'))
    raw_export, export_record = acquire('gotland-2022-export.json', export_url)
    exported = json.loads(raw_export)
    if exported.get('error') or 'href' not in exported:
        raise RuntimeError('Municipal orthophoto export failed')
    extent = exported['extent']
    actual = [extent['xmin'], extent['ymin'], extent['xmax'], extent['ymax']]
    if any(abs(a - b) > 1e-6 for a, b in zip(actual, BBOX)):
        raise RuntimeError('Export altered requested extent')
    raw_image, image_record = acquire('gotland-2022-0p5m.png', exported['href'])
    image = Image.open(BytesIO(raw_image))
    if image.size != (WIDTH, HEIGHT):
        raise RuntimeError('Export altered dimensions')
    rgb = image.convert('RGB')
    stats = ImageStat.Stat(rgb)
    if max(stats.stddev) < 1:
        raise RuntimeError('Image is uniform; possible absent coverage')
    worldfile = CACHE / 'gotland-2022-0p5m.pgw'
    worldfile.write_text(f'0.5\n0\n0\n-0.5\n{BBOX[0] + .25}\n{BBOX[3] - .25}\n', encoding='ascii')
    preview = rgb.copy()
    preview.thumbnail((1400, 1400))
    preview.save(CACHE / 'gotland-2022-preview.jpg', quality=92)
    report = dict(schemaVersion=1, groundId='visby', provider='Region Gotland',
                  sourceId='visby-municipal-ortho-2022', campaignLabel='2022',
                  captureDate=None, horizontalCrs='EPSG:3006', nativeServiceCrs='EPSG:3015',
                  bboxEpsg3006=BBOX, width=WIDTH, height=HEIGHT,
                  outputSampleSpacingMetres=.5, advertisedProductGsdMetres=.25,
                  image=image_record, export=export_record, footprintQuery=query_record,
                  worldfilePath=worldfile.relative_to(ROOT).as_posix(),
                  footprintCount=len(footprints.get('features', [])),
                  sourceDatasets=[f['attributes'] for f in footprints.get('features', []) if f['attributes'].get('Category') == 1],
                  overviewRecordCount=sum(f['attributes'].get('Category') == 2 for f in footprints.get('features', [])),
                  rgbMean=stats.mean, rgbStandardDeviation=stats.stddev,
                  licence=dict(state='primary-terms-verification-pending',
                               copyright=None,
                               copyrightReason='The 2022 service copyrightText is empty; other service attribution cannot be inherited.',
                               redistribution='local measurement/review cache only'),
                  limitations=['2022 is the service campaign label; exact image capture dates remain unknown.',
                               'Requested 0.5 m pixels are resampled from the advertised 0.25 m product.',
                               'Output georeferencing does not establish independent positional accuracy.',
                               'Inspect against current club sources and 2026 national imagery metadata for changed features.',
                               'Raw orthophoto is not a runtime material and is not redistributed.'])
    (REFERENCE / 'gotland-ortho-2022.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(image=image_record, dimensions=image.size, footprints=report['footprintCount'])))


if __name__ == '__main__':
    main()
