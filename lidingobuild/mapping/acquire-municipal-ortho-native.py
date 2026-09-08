"""Acquire a Lidingö stad open-data orthophoto at its NATIVE resolution.

Two corrections drove this.

FIRST, THE 2019 FRAME WAS BEING SAMPLED AT A THIRD OF ITS RESOLUTION. The
retained snapshot is 0.5 m per pixel, and that is a request parameter, not the
source: measured by spectral cut-off, this service's native spacing is about
0.16 m. Every conclusion drawn from the 0.5 m export understated it.

SECOND, THERE IS A 2018 CAPTURE AND IT IS LEAF-ON. Only 2019 was known here.
Probing the servicename pattern finds 2012, 2018 and 2019 published and nothing
else; 2018 is full summer - deciduous canopy in leaf, fairways green and mown,
players on the course - where 2019 is dormant spring. On one fixed bunker
footprint sampled identically in all three, sand separates from its turf collar
by d' 9.11 in 2018 against 1.44 in 2019.

Both are CC0 1.0 under the municipality's own DCAT distribution records, which
is a cleaner grant than anything else available over this course: deriving
geometry, publishing the vectors and redistributing the imagery are all
permitted outright.

WMS 1.3.0 with EPSG:3011 puts NORTHING FIRST in the bbox. EPSG:3006 and
EPSG:3857 are both rejected by this service (HTTP 200 carrying a
ServiceException), so requests go out in 3011 and consumers transform.

  python3 lidingobuild/mapping/acquire-municipal-ortho-native.py [2018|2019|2012] [--mpp 0.16]
"""
import hashlib, json, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen, Request

from PIL import Image
from pyproj import Transformer

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
SERVICE = 'https://karta.lidingo.se/wms'
# The service advertises MaxWidth/MaxHeight 10000, and a 10000-square PNG does
# come back - but not reliably: one arrived truncated ("broken data stream"),
# which a cache that trusts a 200 would then keep forever. Smaller requests, and
# every one of them is DECODED before it is accepted.
MAX_PIXELS = 4096
UA = 'banvy-course-mapping/1.0 (course geometry measurement; contact via repository)'
# the same EPSG:3006 window the published DTM dump and the Lantmäteriet frame cover
WINDOW_3006 = {'minEasting': 677060, 'minNorthing': 6585730, 'maxEasting': 678250, 'maxNorthing': 6587100}
LICENCE = {
    2018: 'https://metadata.lidingo.se/store/3/resource/30',
    2019: 'https://metadata.lidingo.se/store/3/resource/32',
    2012: 'https://metadata.lidingo.se/store/3/resource/28',
}
SEASON = {2018: 'leaf-on, full summer', 2019: 'leaf-off, dormant spring', 2012: 'leaf-off'}

year = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 2018
mpp = float(sys.argv[sys.argv.index('--mpp') + 1]) if '--mpp' in sys.argv else 0.16
CACHE = ROOT / f'lidingobuild/cache/municipal-ortho-{year}-native'
CACHE.mkdir(parents=True, exist_ok=True)

to3011 = Transformer.from_crs(3006, 3011, always_xy=True)
bounds = to3011.transform_bounds(WINDOW_3006['minEasting'], WINDOW_3006['minNorthing'],
                                 WINDOW_3006['maxEasting'], WINDOW_3006['maxNorthing'], densify_pts=21)
# snap outward to whole pixels of the requested spacing
west = mpp * (bounds[0] // mpp); south = mpp * (bounds[1] // mpp)
east = mpp * -(-bounds[2] // mpp); north = mpp * -(-bounds[3] // mpp)
width = round((east - west) / mpp); height = round((north - south) / mpp)
cols = -(-width // MAX_PIXELS); rows = -(-height // MAX_PIXELS)
print(f'{year}: {width} x {height} px at {mpp} m in EPSG:3011 -> {cols} x {rows} = {cols * rows} GetMap calls')


def get(params, path, retries=3):
    url = SERVICE + '?' + urlencode(params)
    for attempt in range(retries):
        try:
            with urlopen(Request(url, headers={'User-Agent': UA}), timeout=300) as r:
                body = r.read()
                if r.headers.get('Content-Type', '').startswith('image/'):
                    path.write_bytes(body)
                    return body
                raise RuntimeError(f'{r.headers.get("Content-Type")}: {body[:300]!r}')
        except Exception as exc:
            if attempt == retries - 1:
                raise
            print(f'  retry {attempt + 1} after {exc}', file=sys.stderr)
            time.sleep(5 * (attempt + 1))


mosaic = Image.new('RGB', (width, height))
requests = []
for row in range(rows):
    for col in range(cols):
        x0 = col * MAX_PIXELS; y0 = row * MAX_PIXELS
        w = min(MAX_PIXELS, width - x0); h = min(MAX_PIXELS, height - y0)
        box = (west + x0 * mpp, north - (y0 + h) * mpp, west + (x0 + w) * mpp, north - y0 * mpp)
        part = CACHE / f'part-{row}-{col}.png'
        params = {'servicename': f'wms_ortofoto_{year}_oppendata', 'SERVICE': 'WMS', 'VERSION': '1.3.0',
                  'REQUEST': 'GetMap', 'LAYERS': f'theme-ortofoto{year}_i1', 'STYLES': '', 'CRS': 'EPSG:3011',
                  # WMS 1.3.0 + a northing-first CRS: min N, min E, max N, max E
                  'BBOX': f'{box[1]:.3f},{box[0]:.3f},{box[3]:.3f},{box[2]:.3f}',
                  'WIDTH': w, 'HEIGHT': h, 'FORMAT': 'image/png', 'TRANSPARENT': 'FALSE'}
        tile = None
        for attempt in range(3):
            if not part.exists():
                get(params, part)
            try:
                candidate = Image.open(part)
                candidate.load()                     # a 200 is not a whole image
                tile = candidate.convert('RGB')
                break
            except OSError as exc:
                print(f'  part {row},{col} did not decode ({exc}); refetching', file=sys.stderr)
                part.unlink(missing_ok=True)
                time.sleep(5 * (attempt + 1))
        if tile is None:
            raise SystemExit(f'part {row},{col} never decoded')
        body = part.read_bytes()
        if tile.size != (w, h):
            raise SystemExit(f'part {row},{col} came back {tile.size}, not {(w, h)}')
        mosaic.paste(tile, (x0, y0))
        requests.append({'row': row, 'column': col, 'bboxEpsg3011': [round(v, 3) for v in box],
                         'widthPixels': w, 'heightPixels': h, 'bytes': len(body),
                         'sha256': hashlib.sha256(body).hexdigest()})
        print(f'  part {row},{col}  {w}x{h}  {len(body) / 1e6:.1f} MB')

stem = f'lidingo-{year}-{str(mpp).replace(".", "p")}m'
image_path = CACHE / f'{stem}.png'
mosaic.save(image_path)
(CACHE / f'{stem}.pgw').write_text(f'{mpp}\n0\n0\n{-mpp}\n{west + mpp / 2}\n{north - mpp / 2}\n', encoding='utf-8')
raw = image_path.read_bytes()
report = {
    'schemaVersion': 1, 'groundId': 'lidingo', 'sourceId': f'imagery-municipal-{year}-native',
    'provider': 'Lidingö stad', 'service': SERVICE, 'servicename': f'wms_ortofoto_{year}_oppendata',
    'layer': f'theme-ortofoto{year}_i1', 'campaignLabel': str(year),
    'retrievedAt': datetime.now(timezone.utc).isoformat(),
    'horizontalCrs': 'EPSG:3011', 'requestedCoverageEpsg3006': WINDOW_3006,
    'bboxEpsg3011': [round(west, 3), round(south, 3), round(east, 3), round(north, 3)],
    'sampleSpacingMetres': mpp,
    'nativeSpacingMetres': 0.16,
    'nativeSpacingEvidence': ('measured, not published: the radial power spectrum of a 200 m box cuts off at '
                              '2.75-2.82 cycles/m, and the same estimator calibrated against Esri z19 (documented '
                              '0.3042 m) reads 12% pessimistic. The service resamples to any requested size, so '
                              'the 0.5 m snapshot retained beside this one is a request parameter and not the limit '
                              'of the source.'),
    'captureDate': None,
    'captureDateEvidence': (f'year only. The DCAT record gives a temporal extent ending {year}-12-31 and no flight '
                            f'date is published anywhere reachable. The SEASON is measured from the pixels: {SEASON.get(year)}.'),
    'season': SEASON.get(year),
    'width': width, 'height': height, 'bands': 'RGB',
    'path': str(image_path.relative_to(ROOT).as_posix()),
    'worldfilePath': str((CACHE / f'{stem}.pgw').relative_to(ROOT).as_posix()),
    'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'requests': requests,
    'licence': {'id': 'CC0-1.0', 'url': 'http://creativecommons.org/publicdomain/zero/1.0/',
                'assertedBy': LICENCE.get(year),
                'note': ("the municipality's own DCAT distribution record dedicates this exact service to the public "
                         'domain, so deriving geometry, publishing the vectors and redistributing the imagery are all '
                         'permitted outright. That is a cleaner grant than any other capture over this course.')},
    'limitations': [
        'The exact flight date is not published for any Lidingö stad campaign; only the year and the season read off the pixels.',
        'RGB only.',
        'Orthorectified to the terrain, so anything standing above it leans radially away from nadir.',
    ],
}
out = ROOT / f'geo_data/course-v2/lidingo/discovery/municipal-ortho-{year}-native.json'
out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'wrote {image_path} ({len(raw) / 1e6:.1f} MB) and {out.relative_to(ROOT)}')
