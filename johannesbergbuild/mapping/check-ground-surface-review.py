"""Verify private review pixels and their published vector transforms.

python johannesbergbuild/mapping/check-ground-surface-review.py [--fetch]
Requires Pillow, numpy and pyproj. Raw imagery stays in the ignored cache.
--fetch reads only the three public WMS windows pinned by this review and
refuses changed image bytes; it never silently substitutes a newer mosaic.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import urllib.request
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'johannesbergbuild/cache/surface-review-2026-09-13'
review = json.loads((ROOT / 'johannesbergbuild/mapping/ground-surface-review.json').read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fetch', action='store_true')
args = parser.parse_args()
inverse = Transformer.from_crs(3006, 4326, always_xy=True)
forward = Transformer.from_crs(4326, 3006, always_xy=True)
sources = {s['id']: s for s in review['sources']}
residuals = []
for source in sources.values():
    target = CACHE / (source['id'] + '-ortho.png')
    if not target.exists() and args.fetch:
        request = urllib.request.Request(source['url'], headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=45) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != source['sha256']:
            raise ValueError(f"{source['id']}: viewing mosaic changed; a new source review is required")
        CACHE.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == source['sha256'], source['id']
    with Image.open(target) as image:
        assert image.size == (source['width'], source['height']), source['id']

def verify(source_id, pixel, point):
    source = sources[source_id]
    e0, n0, e1, n1 = source['boundsEpsg3006']
    e = e0 + pixel[0] * (e1-e0) / source['width']
    n = n1 - pixel[1] * (n1-n0) / source['height']
    frame = review['frame']
    origin = frame['origin']
    lon = origin['lon'] + point[0] / frame['metresPerLongitude']
    lat = origin['lat'] - point[1] / frame['metresPerLatitude']
    got_e, got_n = forward.transform(lon, lat)
    residuals.append(math.hypot(e-got_e, n-got_n))

for feature in review['features']:
    assert len(feature['rings']) == len(feature['pixelRings']), feature['id']
    for pixels, ring in zip(feature['pixelRings'], feature['rings']):
        assert len(pixels) == len(ring), feature['id']
        for pixel, point in zip(pixels, ring):
            verify(feature['sourceId'], pixel, point)
for control in review['controls']:
    verify(control['sourceId'], control['pixel'], control['point'])
assert max(residuals) < .001, max(residuals)
print(json.dumps(dict(reviewId=review['id'], sourceImages=len(sources),
                      projectedVerticesAndControls=len(residuals),
                      maximumProjectionRoundingResidualMetres=max(residuals),
                      absoluteSurveyAccuracyClaimed=False), indent=2))
