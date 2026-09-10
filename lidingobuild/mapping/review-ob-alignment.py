"""Recreate local-only OB source overlays; public data contains vector observations."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
review = json.loads((ROOT / 'lidingobuild/mapping/ob-alignment-review-2026-09-09.json').read_text(encoding='utf8'))
output = ROOT / 'lidingobuild/cache/ob-alignment-2025'
output.mkdir(parents=True, exist_ok=True)
for feature in review['features']:
    window = next(w for w in review['sourceWindows'] if w['id'] == feature['sourceWindowId'])
    raster = ROOT / window['rasterFile']
    assert hashlib.sha256(raster.read_bytes()).hexdigest() == window['sha256'], f"Source drift: {window['id']}"
    image = Image.open(ROOT / window['rgbFile']).convert('RGB')
    assert image.size == (window['width'], window['height'])
    draw = ImageDraw.Draw(image)
    vertices = [tuple(point) for point in feature['pixels']]
    draw.line(vertices, fill='magenta', width=3)
    for col, row in vertices:
        draw.ellipse((col-3, row-3, col+3, row+3), fill='yellow')
    draw.text((8, 8), f"H{feature['hole']:02d} asphalt-edge trace; 2025-05-31; physical stakes unknown", fill='white', stroke_fill='black', stroke_width=2)
    image.save(output / f"hole-{feature['hole']:02d}-ob-review.png")
    print(f"Verified source and overlay: hole {feature['hole']:02d}")
