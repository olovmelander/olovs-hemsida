"""Make local source overlays and verify every recorded pixel-to-ground transform."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
review = json.loads((ROOT / 'lidingobuild/mapping/ob-placement-review.json').read_text(encoding='utf-8'))
sources = {source['id']: source for source in review['sources']}
out = ROOT / 'lidingobuild/cache/ob-review'
out.mkdir(parents=True, exist_ok=True)
for boundary in review['boundaries']:
    if boundary['state'] != 'accepted':
        continue
    source = sources[boundary['imageSourceId']]
    path = ROOT / source['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == source['sha256'], path
    pixels = boundary['sourcePixelLine']
    x0, _, _, y1 = source['boundsEpsg3006']
    resolution = source['resolutionMetres']
    for pixel, coordinate in zip(pixels, boundary['lineEpsg3006'], strict=True):
        expected = [x0 + pixel[0] * resolution, y1 - pixel[1] * resolution]
        assert max(abs(a - b) for a, b in zip(expected, coordinate)) < .001, boundary['id']
    image = Image.open(path).convert('RGB')
    draw = ImageDraw.Draw(image)
    draw.line([tuple(p) for p in pixels], fill=(0, 255, 240), width=3)
    for x, y in pixels:
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), outline=(255, 230, 0), width=1)
    bounds = (max(0, min(p[0] for p in pixels) - 90), max(0, min(p[1] for p in pixels) - 40),
              min(image.width, max(p[0] for p in pixels) + 90), min(image.height, max(p[1] for p in pixels) + 40))
    image.crop(bounds).save(out / f'{boundary["id"]}.png')
print(json.dumps({'checkedTransforms': sum(len(b['sourcePixelLine']) for b in review['boundaries']),
                  'overlays': len(review['boundaries'])}))
