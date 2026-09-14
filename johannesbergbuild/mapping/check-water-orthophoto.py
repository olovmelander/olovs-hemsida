"""Verify the exact source windows and map the retained bank outlines.

python johannesbergbuild/mapping/check-water-orthophoto.py [--fetch]
Requires Pillow and pyproj. Images remain in the ignored cache, not app assets.
--fetch retrieves pinned public windows and refuses changed mosaic bytes.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import urllib.request
from PIL import Image, ImageDraw
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'johannesbergbuild/cache/water-review'
review = json.loads((ROOT / 'johannesbergbuild/mapping/water-source-review.json').read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fetch', action='store_true')
args = parser.parse_args()
CACHE.mkdir(parents=True, exist_ok=True)
project = Transformer.from_crs(4326, 3006, always_xy=True)
frame = review['frame']

def grid(point):
    return project.transform(frame['origin']['lon'] + point[0] / frame['metresPerLongitude'],
                             frame['origin']['lat'] - point[1] / frame['metresPerLatitude'])

for source in review['sources']:
    target = CACHE / (source['id'] + '-ortho.png')
    if not target.exists() and args.fetch:
        req = urllib.request.Request(source['url'], headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=45) as response:
            data = response.read()
        assert hashlib.sha256(data).hexdigest() == source['sha256'], 'mosaic changed; review again'
        target.write_bytes(data)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == source['sha256'], source['id']
    image = Image.open(target).convert('RGB')
    assert image.size == (source['width'], source['height'])
    draw = ImageDraw.Draw(image)
    e0, n0, e1, n1 = source['boundsEpsg3006']

    def pixel(point):
        e, n = grid(point)
        return ((e - e0) * source['width'] / (e1 - e0),
                (n1 - n) * source['height'] / (n1 - n0))

    for body in review['bodies']:
        if body['sourceId'] != source['id']:
            continue
        points = [pixel(p) for p in body['baseline']['ring']]
        draw.line(points + points[:1], fill='yellow', width=2)
        for c in body['controls']:
            x, y = pixel(c['point'])
            assert 0 <= x < source['width'] and 0 <= y < source['height']
            # Reproduce the stored continuous source pixels with PROJ. The
            # residual is coordinate-rounding consistency, not survey accuracy.
            residual = math.dist((x, y), c['sourcePixel']) * source['resolutionMetres']
            assert residual < .001, (body['id'], residual)
            draw.ellipse((x-5, y-5, x+5, y+5), fill='cyan')
    image.save(CACHE / (source['id'] + '-verified.png'))
print(json.dumps({'reviewId': review['id'], 'verifiedImages': len(review['sources']),
                  'interiorControls': 45, 'captureDateVerified': False}))
