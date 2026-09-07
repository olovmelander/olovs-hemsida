#!/usr/bin/env python3
"""Reacquire the four expanded Upsala tee review windows from municipal archives.

Raw images remain in ignored cache. Service years are archive labels; exact
capture dates and source absolute horizontal accuracy are unknown. No geometry
is adopted. Each JSON record includes the server-returned extent and raster SHA.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
from PIL import Image, ImageStat

WINDOWS = [
    ('stora-h11', [639898, 6636578, 640118, 6636798]),
    ('stora-h13', [639370, 6636275, 639530, 6636435]),
    ('stora-h15', [639634, 6636282, 639774, 6636422]),
    ('mellan-h08', [640267, 6635890, 640407, 6636030]),
]
SERVICES = {2015: 'ortofoto2015/ImageServer/exportImage',
            2017: 'ortofoto2017/ImageServer/exportImage',
            2018: 'ortofoto2018/ImageServer/exportImage',
            2020: 'ortofoto2020/ImageServer/exportImage',
            2023: 'Ortofoto_2023_1800/MapServer/export'}
BASE = 'https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto/'


def get(url):
    with urlopen(url, timeout=75) as response:
        return response.read()


def acquire(job):
    year, window, root = job
    label, bbox = window
    output = root / f'source-{year}'
    output.mkdir(parents=True, exist_ok=True)
    width, height = [round((bbox[i+2]-bbox[i])*10) for i in range(2)]
    url = BASE + SERVICES[year] + '?' + urlencode(dict(
        f='pjson', bbox=','.join(map(str, bbox)), bboxSR=3006,
        imageSR=3006, size=f'{width},{height}', format='png32', transparent='false'))
    result = json.loads(get(url))
    raw = get(result['href'])
    image = Image.open(BytesIO(raw))
    if max(ImageStat.Stat(image.convert('RGB')).stddev) < 1:
        raise ValueError(f'{year}/{label}: uniform image')
    ex = result['extent']
    record = dict(url=url, retrievedAt=datetime.now(timezone.utc).isoformat(),
                  sha256=sha256(raw).hexdigest(), bytes=len(raw), output=label+'.png',
                  provider=f'municipal-service-{year}', crs='EPSG:3006',
                  extent=[ex[k] for k in ['xmin', 'ymin', 'xmax', 'ymax']],
                  dimensions=list(image.size), sourceProductYear=year, captureDate=None,
                  sourceAbsoluteHorizontalAccuracyMetres=None,
                  yearBasis='municipal archive service name; exact flight date unknown',
                  exportResolutionMetres=0.1,
                  rights='Public viewing API; redistribution rights not established. Keep raster in local cache.')
    (output / (label+'.png')).write_bytes(raw)
    (output / (label+'.request.json')).write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')
    print(year, label, len(raw), flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path('upsalabuild/cache/tee-review-2026-09-07'))
    parser.add_argument('--years', default='2015,2017,2018,2020,2023')
    args = parser.parse_args()
    if 'cache' not in args.out.parts:
        parser.error('Source imagery must be written beneath a cache directory')
    years = [int(year) for year in args.years.split(',')]
    if any(year not in SERVICES for year in years):
        parser.error('Unsupported archive year')
    args.out.mkdir(parents=True, exist_ok=True)
    panels = {'panels': [{'id': label, 'extentEPSG3006': bbox} for label, bbox in WINDOWS]}
    (args.out / 'panels.json').write_text(json.dumps(panels, indent=2)+'\n', encoding='utf-8')
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(acquire, [(year, window, args.out) for year in years for window in WINDOWS]))


if __name__ == '__main__':
    main()
