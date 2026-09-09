"""Read checked orthophoto review pixels and draw registered geometry overlays.

Source pixel coordinates remain on the native TIFF pixel-edge grid. Preview
resizing is display-only; never use preview coordinates as authoring vertices.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'visbybuild/cache/lm-review'


def read_image(image_id, cache=CACHE):
    index = json.loads((cache / 'index.json').read_text())
    if index['groundId'] != 'visby' or index['crs'] != 'EPSG:3006':
        raise ValueError('Expected Visby projected source images')
    rows = [r for r in index['images'] if r['id'] == image_id]
    if len(rows) != 1:
        raise ValueError('Expected exactly one source image')
    record = rows[0]
    file = cache / record['file']
    if file.parent != cache or hashlib.sha256(file.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('Review image checksum mismatch')
    image = Image.open(file).convert('RGB')
    if image.size != (record['width'], record['height']):
        raise ValueError('Image dimensions differ from the source grid')
    a, b, c, d, e, f = record['geoTransform']
    if b != .16 or f != -.16 or c != 0 or e != 0:
        raise ValueError('Expected the native north-up 16 cm grid')
    return image, record


def pixel(record, point):
    a, b, c, d, e, f = record['geoTransform']
    return ((point[0] - a) / b, (point[1] - d) / f)


def features(geometry, model):
    for hole in geometry['holes']:
        yield f"H{hole['n']} green", 'green', hole['green']['ring']
        for key, rings in [('tee', [p['ring'] for p in hole['tees']['pads']]),
                           ('fairway', hole['fairway']['rings']),
                           ('bunker', [p['ring'] for p in hole['bunkers']])]:
            for i, ring in enumerate(rings):
                yield f"H{hole['n']} {key}{i}", key, ring
    for key in ['greens', 'tees', 'fairways', 'bunkers', 'range']:
        for i, ring in enumerate(geometry['scenery'].get(key, [])):
            yield f'{key}{i}', key.rstrip('s'), ring
    for b in model['infra']['buildings']:
        yield b['id'], 'building', [[687748.5+x, 6370951.5-z] for x, z in b['ring']]


def overlay(image, record, geometry, model, labels=True):
    image = image.copy()
    draw = ImageDraw.Draw(image)
    colors = dict(green='#ff40e0', tee='#00ffff', fairway='#ffff00',
                  bunker='#ff6040', building='#ffffff', range='#ff9f00')
    for label, kind, ring in features(geometry, model):
        pts = [pixel(record, p) for p in ring]
        if not any(0 <= x < image.width and 0 <= y < image.height for x, y in pts):
            continue
        draw.line(pts + pts[:1], fill=colors[kind], width=3)
        if labels:
            x = sum(p[0] for p in pts)/len(pts)
            y = sum(p[1] for p in pts)/len(pts)
            draw.text((x, y), label, fill=colors[kind], stroke_width=2, stroke_fill='black')
    return image


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image_id')
    parser.add_argument('--overlay', action='store_true')
    parser.add_argument('--max-side', type=int, default=1600)
    args = parser.parse_args()
    image, record = read_image(args.image_id)
    if args.overlay:
        geometry = json.loads((ROOT / 'visbybuild/mapping/geometry.json').read_text())
        model = json.loads((ROOT / 'visbybuild/course-model.json').read_text())
        image = overlay(image, record, geometry, model)
    image.thumbnail((args.max_side, args.max_side), Image.Resampling.LANCZOS)
    out = CACHE / 'qa'
    out.mkdir(exist_ok=True)
    target = out / (args.image_id + ('-overlay' if args.overlay else '') + '.png')
    image.save(target)
    print(json.dumps(dict(path=str(target), nativeSize=[record['width'], record['height']],
                         previewSize=list(image.size), geoTransform=record['geoTransform'])))
