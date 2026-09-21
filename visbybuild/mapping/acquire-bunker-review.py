"""Acquire public, registered WMS windows for Visby's bunker audit.

No account credentials or remote artifact upload. Pixels stay in ignored cache.
The viewing service is mutable: record response hashes, request grids and retrieval
time, and do not infer an acquisition date from the requested layer's resolution.
"""
import concurrent.futures
import datetime
import hashlib
import io
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'visbybuild/cache/bunker-audit-2026-09-21'
ENDPOINT = 'https://minkarta.lantmateriet.se/map/ortofoto'
METRES = 0.16


def acquire(hole):
    points = hole['line'] + hole['green']['ring']
    points += [p for ring in hole['fairway']['rings'] for p in ring]
    west = math.floor((min(p[0] for p in points)-55)/METRES)*METRES
    north = math.ceil((max(p[1] for p in points)+55)/METRES)*METRES
    width = math.ceil((max(p[0] for p in points)+55-west)/METRES)
    height = math.ceil((north-min(p[1] for p in points)+55)/METRES)
    if max(width, height) > 4096:
        raise ValueError(f'Hole {hole["n"]}: split oversized window explicitly')
    bounds = [west, north-height*METRES, west+width*METRES, north]
    params = dict(SERVICE='WMS', VERSION='1.1.1', REQUEST='GetMap',
                  LAYERS='Ortofoto_0.16', STYLES='', SRS='EPSG:3006',
                  BBOX=','.join(f'{v:.2f}' for v in bounds),
                  WIDTH=width, HEIGHT=height, FORMAT='image/jpeg')
    url = ENDPOINT + '?' + urllib.parse.urlencode(params)
    key = f'hole-{hole["n"]:02d}'
    file = CACHE / (key+'.jpg')
    evidence = CACHE / (key+'.json')
    if file.exists() and evidence.exists():
        record = json.loads(evidence.read_text())
        if record['url'] == url and hashlib.sha256(file.read_bytes()).hexdigest() == record['sha256']:
            return record
    req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0',
        'Referer':'https://minkarta.lantmateriet.se/'})
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = response.read()
        content_type = response.headers.get('content-type')
    image = Image.open(io.BytesIO(payload)).convert('RGB')
    if image.size != (width,height) or np.asarray(image).std() < 5:
        raise ValueError(f'{key}: wrong grid or blank pixels')
    record = dict(id=key, file=file.name, url=url, sha256=hashlib.sha256(payload).hexdigest(),
        contentType=content_type, retrievedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        captureDate=None, sourceIds=['visby-public-ortho-bunker-review-2026-09-21'],
        extentEpsg3006=bounds, imageSize=[width,height], width=width,height=height,
        geoTransform=[west,METRES,0,north,0,-METRES],
        pixelConvention='pixel edges from top left; EPSG:3006 east/north',
        interpretationUncertaintyMetres=1, registrationAccuracy='not independently measured',
        attribution='Ortofoto © Lantmäteriet; public viewing service; local review only')
    file.write_bytes(payload)
    evidence.write_text(json.dumps(record,indent=2)+'\n')
    print(f'{key}: {width}x{height}, {len(payload)} bytes',flush=True)
    return record


if __name__ == '__main__':
    CACHE.mkdir(parents=True,exist_ok=True)
    geometry = json.loads((ROOT/'visbybuild/mapping/geometry.json').read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(acquire,geometry['holes']))
    (CACHE/'index.json').write_text(json.dumps(dict(groundId='visby',sources=records),indent=2)+'\n')
