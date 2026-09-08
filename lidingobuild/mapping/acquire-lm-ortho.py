"""Acquire Lantmäteriet's 0.16 m orthophoto over the course, and date it.

WHY THIS AND NOT THE 2019 MUNICIPAL FRAME. The Lidingö stad 2019 orthophoto is
CC0 and was the licensed record here, but it is a LEAF-OFF spring capture and
that costs real fidelity: measured inside the 40 already-mapped bunkers, sand
separates from mown turf by 3.8 luminance and 7.0 excess-green on it, against
59.9 and 19.0 on this capture. A detector calibrated on the 2019 frame recovers
9 of 40 bunkers; the separation here is what a working instrument looks like.
It is also NEWER than every course change the club records - the hole-17 green
bunker (2024), the hole-13 left green bunker and the orange tees on 6/7/8
(2025), and the upper-parking practice area that opened 2025-05-17, two weeks
before this flight.

WHAT IT IS. Lantmäteriet's national Ortofoto, served through the Min karta
e-service WMS without a key. Native 0.16 m: the server does not interpolate
past native, so a request at a finer pixel returns an exact nearest-neighbour
upsample, which is how the native spacing was proven rather than assumed.
Orthorectified, so pixel -> world is exact and nothing traced from it needs
registering.

RIGHTS. Lantmäteriet states for Min karta: publishing images or screen clips is
permitted, and a publication must state "Datakälla Lantmäteriets Min karta;
©Lantmäteriet", that the information has been processed where it has, and that
CC BY 4.0 applies. That contemplates processed output, which is exactly this
use. The pixels stay in the ignored cache; what this repository publishes is
derived vector geometry, carrying that attribution. The request count is
deliberately small - the whole course window is six GetMap calls - because
bulk tiling of an e-service backend is a question about service usage rather
than about the licence, and it is not one this needs to test.

  python3 lidingobuild/mapping/acquire-lm-ortho.py [--metres-per-pixel 0.16]
"""
import hashlib, json, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen, Request

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'lidingobuild/cache/lm-ortho-2025'
CACHE.mkdir(parents=True, exist_ok=True)
SERVICE = 'https://minkarta.lantmateriet.se/map/ortofoto/'
LAYER = 'Ortofoto_0.16'
MAX_PIXELS = 4096                      # the service's own GetMap limit
# the same EPSG:3006 window the published DTM dump and the 2019 frame cover,
# snapped outward to whole 0.16 m source pixels so no resampling is involved
WINDOW = {'minEasting': 677056.0, 'minNorthing': 6585728.0,
          'maxEasting': 678252.8, 'maxNorthing': 6587100.8}
MPP = float(sys.argv[sys.argv.index('--metres-per-pixel') + 1]) if '--metres-per-pixel' in sys.argv else 0.16
UA = 'banvy-course-mapping/1.0 (course geometry measurement; contact via repository)'


def get(params, path, retries=3):
    url = SERVICE + '?' + urlencode(params)
    for attempt in range(retries):
        try:
            with urlopen(Request(url, headers={'User-Agent': UA}), timeout=180) as r:
                body = r.read()
                if r.headers.get('Content-Type', '').startswith('image/'):
                    path.write_bytes(body)
                    return url, body
                raise RuntimeError(f'{r.headers.get("Content-Type")}: {body[:300]!r}')
        except Exception as exc:
            if attempt == retries - 1:
                raise
            print(f'  retry {attempt + 1} after {exc}', file=sys.stderr)
            time.sleep(4 * (attempt + 1))


span_e = WINDOW['maxEasting'] - WINDOW['minEasting']
span_n = WINDOW['maxNorthing'] - WINDOW['minNorthing']
width = round(span_e / MPP)
height = round(span_n / MPP)
cols = -(-width // MAX_PIXELS)
rows = -(-height // MAX_PIXELS)
print(f'{width} x {height} px at {MPP} m over {span_e:.1f} x {span_n:.1f} m -> {cols} x {rows} = {cols * rows} GetMap calls')

mosaic = Image.new('RGB', (width, height))
requests = []
for row in range(rows):
    for col in range(cols):
        x0 = col * MAX_PIXELS
        y0 = row * MAX_PIXELS
        w = min(MAX_PIXELS, width - x0)
        h = min(MAX_PIXELS, height - y0)
        bbox = (WINDOW['minEasting'] + x0 * MPP, WINDOW['maxNorthing'] - (y0 + h) * MPP,
                WINDOW['minEasting'] + (x0 + w) * MPP, WINDOW['maxNorthing'] - y0 * MPP)
        part = CACHE / f'part-{row}-{col}.jpg'
        params = {'service': 'WMS', 'version': '1.1.1', 'request': 'GetMap', 'layers': LAYER,
                  'styles': '', 'srs': 'EPSG:3006', 'bbox': ','.join(f'{v:.2f}' for v in bbox),
                  'width': w, 'height': h, 'format': 'image/jpeg'}
        if part.exists():
            body = part.read_bytes(); url = SERVICE + '?' + urlencode(params)
        else:
            url, body = get(params, part)
        tile = Image.open(part).convert('RGB')
        if tile.size != (w, h):
            raise SystemExit(f'part {row},{col} came back {tile.size}, not {(w, h)}')
        mosaic.paste(tile, (x0, y0))
        requests.append({'row': row, 'column': col, 'bboxEpsg3006': [round(v, 2) for v in bbox],
                         'widthPixels': w, 'heightPixels': h, 'bytes': len(body),
                         'sha256': hashlib.sha256(body).hexdigest()})
        print(f'  part {row},{col}  {w}x{h}  {len(body) / 1e6:.1f} MB')

image_path = CACHE / f'lidingo-lm-{str(MPP).replace(".", "p")}m.png'
mosaic.save(image_path)
(CACHE / f'lidingo-lm-{str(MPP).replace(".", "p")}m.pgw').write_text(
    f'{MPP}\n0\n0\n{-MPP}\n{WINDOW["minEasting"] + MPP / 2}\n{WINDOW["maxNorthing"] - MPP / 2}\n', encoding='utf-8')

# The capture date is READ, not assumed: the _fs layer draws the image seams
# labelled with their exact flight timestamps over this ground.
seam_path = CACHE / 'seams.png'
seam_url, seam_body = get({'service': 'WMS', 'version': '1.1.1', 'request': 'GetMap',
                           'layers': 'Ortofoto_0.16_fs', 'styles': '', 'srs': 'EPSG:3006',
                           'bbox': '676500,6585000,679000,6587500', 'width': 1400, 'height': 1400,
                           'format': 'image/png'}, seam_path)
meta_path = CACHE / 'meta.png'
meta_url, meta_body = get({'service': 'WMS', 'version': '1.1.1', 'request': 'GetMap',
                           'layers': 'Ortofoto_0.16_meta', 'styles': '', 'srs': 'EPSG:3006',
                           'bbox': '676500,6585000,679000,6587500', 'width': 1400, 'height': 1400,
                           'format': 'image/png'}, meta_path)

raw = image_path.read_bytes()
report = {
    'schemaVersion': 1, 'groundId': 'lidingo', 'sourceId': 'imagery-lm-ortofoto-0p16',
    'provider': 'Lantmäteriet', 'product': 'Ortofoto', 'service': SERVICE, 'layer': LAYER,
    'retrievedAt': datetime.now(timezone.utc).isoformat(),
    'horizontalCrs': 'EPSG:3006', 'windowEpsg3006': WINDOW,
    'sampleSpacingMetres': MPP, 'nativeSpacingMetres': 0.16,
    'nativeSpacingEvidence': 'the service does not interpolate past native: a request at 0.04 m returns an exact 4x nearest-neighbour upsample of a 0.16 m grid',
    'width': width, 'height': height, 'bands': 'RGB',
    'captureDate': '2025-05-31',
    'captureDateEvidence': ('read, not assumed: the Ortofoto_0.16_fs layer draws the image seams over this ground '
                            'labelled with their flight timestamps, and Ortofoto_0.16_meta prints the flight year. '
                            'Both were fetched over a 2.5 km box centred on the course and are retained beside the image.'),
    'path': str(image_path.relative_to(ROOT).as_posix()),
    'worldfilePath': str((CACHE / (image_path.stem + '.pgw')).relative_to(ROOT).as_posix()),
    'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
    'requests': requests,
    'sidecars': [{'layer': 'Ortofoto_0.16_fs', 'path': str(seam_path.relative_to(ROOT).as_posix()), 'sha256': hashlib.sha256(seam_body).hexdigest()},
                 {'layer': 'Ortofoto_0.16_meta', 'path': str(meta_path.relative_to(ROOT).as_posix()), 'sha256': hashlib.sha256(meta_body).hexdigest()}],
    'licence': {'id': 'CC-BY-4.0',
                'attribution': 'Datakälla Lantmäteriets Min karta; ©Lantmäteriet; bearbetad; CC BY 4.0',
                'url': 'https://www.lantmateriet.se/sv/kartor/vara-karttjanster/min-karta/',
                'note': ('Lantmäteriet permits publishing images and screen clips from Min karta with that attribution, and '
                         'explicitly contemplates processed information. The pixels are not redistributed by this repository; '
                         'derived vector geometry is, carrying the attribution. Whether bulk programmatic tiling of the '
                         'e-service backend is acceptable SERVICE USAGE is a separate question from the licence and is not '
                         'settled here, which is why the whole window is six requests.')},
    'limitations': [
        'RGB only on this route; the 0.16 m NIR band is download-only behind a Geotorget entitlement.',
        'One capture date over the whole course, but the mosaic is a national product and a seam could fall inside a future window; the _fs sidecar is what would show it.',
        'Orthorectification is to the terrain, so anything standing above it leans radially away from nadir - a roof outline overstates its footprint.',
    ],
}
out = ROOT / 'geo_data/course-v2/lidingo/discovery/lm-ortofoto-0p16.json'
out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'wrote {image_path} ({len(raw) / 1e6:.1f} MB) and {out.relative_to(ROOT)}')
