"""Acquire review-only municipal orthophotos; retain exact pixel-to-ground metadata.

Run from the repository root with Python + Pillow. Images stay in ignored cache;
adopted vertices and acquisition metadata belong in the committed review record.
This is visual interpretation of the 2022 flight, not a current field survey.
"""
import concurrent.futures
import datetime
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'visbybuild/cache/facility-windows-2022'
SERVICE = 'https://imageserver.gotland.se/arcgis/rest/services/Ortofoto/Ortofoto_2022/ImageServer/exportImage'
E0, N0 = 687748.5, 6370951.5
MODEL = json.loads((ROOT / 'visbybuild/course-model.json').read_text())


def acquire(spec):
    name, cx, cz, size = spec
    pixels = int(size * 4)
    extent = [E0 + cx - size / 2, N0 - cz - size / 2,
              E0 + cx + size / 2, N0 - cz + size / 2]
    url = SERVICE + '?' + urllib.parse.urlencode({
        'bbox': ','.join(map(str, extent)), 'bboxSR': 3006, 'imageSR': 3006,
        'size': f'{pixels},{pixels}', 'format': 'png', 'f': 'pjson'})
    meta_path, image_path = OUT / f'{name}.json', OUT / f'{name}.png'
    if meta_path.exists() and image_path.exists():
        meta = json.loads(meta_path.read_text())
        if meta['sha256'] != hashlib.sha256(image_path.read_bytes()).hexdigest():
            raise ValueError(f'{name}: cached image hash mismatch')
        if meta['requestUrl'] != url:
            raise ValueError(f'{name}: cached request differs')
    else:
        with urllib.request.urlopen(url, timeout=90) as response:
            exported = json.load(response)
        if 'href' not in exported:
            raise ValueError(exported)
        with urllib.request.urlopen(exported['href'], timeout=90) as response:
            data = response.read()
        image_path.write_bytes(data)
        actual = exported['extent']
        actual_extent = [actual[k] for k in ('xmin', 'ymin', 'xmax', 'ymax')]
        if actual_extent != extent or Image.open(image_path).size != (pixels, pixels):
            raise ValueError(f'{name}: server changed requested grid')
        meta = {
            'id': 'visby-municipal-ortho-2022', 'requestUrl': url,
            'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
            'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'imageSize': [pixels, pixels], 'extentEpsg3006': actual_extent,
            'pixelConvention': 'pixel edges from top left; E=xmin+u*0.25, N=ymax-v*0.25',
            'observedYear': 2022, 'captureDate': None,
            'interpretationUncertaintyMetres': 2,
            'registrationAccuracy': 'not independently measured', 'rawImageRedistributed': False,
        }
        meta_path.write_text(json.dumps(meta, indent=2) + '\n')
    image = Image.open(image_path).convert('RGB')
    draw = ImageDraw.Draw(image)
    def px(point):
        return ((point[0] - cx + size / 2) * 4, (point[1] - cz + size / 2) * 4)
    for h in MODEL['holes']:
        for pad in h['tees']['pads']:
            draw.line([px(p) for p in pad['ring']], fill='#ff55ff', width=2)
        for i, mark in enumerate(h['tees']['marks']):
            x, y = px(mark['c'])
            if 0 <= x < pixels and 0 <= y < pixels:
                draw.ellipse((x-4, y-4, x+4, y+4), outline='#ffdd22', width=2)
                draw.text((x+6, y-10+i*2), f"H{h['n']}/{[63,59,55,51,46,41][i]}", fill='#ffffff', stroke_width=1, stroke_fill='#000000')
    for step in range(0, pixels, 100):
        draw.text((step+2, 2), str(step), fill='white', stroke_width=1, stroke_fill='black')
        draw.text((2, step+2), str(step), fill='white', stroke_width=1, stroke_fill='black')
    image.save(OUT / f'{name}-overlay.png')
    print(f'{name}: {pixels}px, {meta["sha256"]}', flush=True)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    specs = []
    review_path = ROOT / 'visbybuild/mapping/tee-platform-review.json'
    # Once reviewed, replay the retained source grids even after cameras move.
    sources = json.loads(review_path.read_text())['sources'] if review_path.exists() else {}
    for h in MODEL['holes']:
        name = f'hole-{h["n"]:02}'
        if name in sources:
            xmin, ymin, xmax, ymax = sources[name]['extentEpsg3006']
            specs.append((name, round((xmin+xmax)/2-E0, 2), round(N0-(ymin+ymax)/2, 2), round(xmax-xmin)))
            continue
        points = [m['c'] for m in h['tees']['marks']]
        low = [min(p[i] for p in points) for i in (0, 1)]
        high = [max(p[i] for p in points) for i in (0, 1)]
        size = max(160, math.ceil((max(high[i]-low[i] for i in (0, 1))+100)/10)*10)
        cx, cz = [(a+b)/2 for a, b in zip(low, high)]
        if h['n'] == 12:
            cx, cz, size = 323, 260, 260
        specs.append((name, round(cx, 2), round(cz, 2), size))
    specs.append(('practice', -230, -50, 360))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(acquire, specs))
