"""Draw the model's own geometry over the 2019 CC0 orthophoto, for review.

The imagery is orthorectified and carries a worldfile, so pixel->world is an
affine map and a crop needs no registration: what the overlay shows is the
model against the picture, not against a fitted version of the picture.

  python3 lidingobuild/mapping/ortho-crop.py <name> <easting> <northing> <size_m> [--scale N] [--plain]
  python3 lidingobuild/mapping/ortho-crop.py --hole 13 green
  python3 lidingobuild/mapping/ortho-crop.py --overview

Local-only review output; it adopts nothing.
"""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'lidingobuild/cache/ortho-review'
OUT.mkdir(parents=True, exist_ok=True)
Image.MAX_IMAGE_PIXELS = None
src = Image.open(ROOT / 'lidingobuild/cache/municipal-ortho-2019/lidingo-2019-0p5m.png').convert('RGB')
world = [float(x) for x in (ROOT / 'lidingobuild/cache/municipal-ortho-2019/lidingo-2019-0p5m.pgw').read_text().split()]
to3011 = Transformer.from_crs(3006, 3011, always_xy=True)
to3006 = Transformer.from_crs(4326, 3006, always_xy=True)

def px(e, n):
    x, y = to3011.transform(e, n)
    return ((x - world[4]) / world[0], (y - world[5]) / world[3])

surfaces = json.loads((ROOT / 'lidingobuild/mapping/playing-surfaces.geojson').read_text(encoding='utf8'))
survey = json.loads((ROOT / 'geo_data/lidingo_clean.json').read_text(encoding='utf8'))
COLOUR = {'green': (60, 255, 90), 'tee': (90, 170, 255), 'fairway': (255, 235, 60), 'bunker': (255, 90, 60)}

def rings(g):
    return [g['coordinates'][0]] if g['type'] == 'Polygon' else [p[0] for p in g['coordinates']]

def crop(name, e, n, size, scale=2, plain=False):
    half = size / 2
    a = px(e - half, n + half); b = px(e + half, n - half)
    left, top, right, bottom = round(min(a[0], b[0])), round(min(a[1], b[1])), round(max(a[0], b[0])), round(max(a[1], b[1]))
    img = src.crop((left, top, right, bottom))
    img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
    if not plain:
        d = ImageDraw.Draw(img, 'RGBA')
        def P(pt):
            x, y = px(pt[0], pt[1]); return ((x - left) * scale, (y - top) * scale)
        for f in surfaces['features']:
            c = COLOUR.get(f['properties']['kind'])
            if not c: continue
            for r in rings(f['geometry']):
                pts = [P(p) for p in r]
                if all(p[0] < -40 or p[0] > img.width + 40 or p[1] < -40 or p[1] > img.height + 40 for p in pts): continue
                d.line(pts, fill=c + (235,), width=2)
        for f in survey['features']:
            if f['properties']['name'] != 'Green Center': continue
            lon, lat = f['geometry']['coordinates']
            x, y = P(to3006.transform(lon, lat))
            d.ellipse((x - 6, y - 6, x + 6, y + 6), outline=(255, 0, 255, 255), width=3)
            d.text((x + 9, y - 7), f['properties']['hole'], fill=(255, 0, 255, 255))
        # a metre grid so distances can be read straight off the crop
        step = 50 if size <= 400 else 100
        e0 = math.ceil((e - half) / step) * step
        while e0 < e + half:
            x = P((e0, n))[0]; d.line([(x, 0), (x, img.height)], fill=(255, 255, 255, 70)); d.text((x + 3, 3), str(int(e0)), fill=(255, 255, 255, 160)); e0 += step
        n0 = math.ceil((n - half) / step) * step
        while n0 < n + half:
            y = P((e, n0))[1]; d.line([(0, y), (img.width, y)], fill=(255, 255, 255, 70)); d.text((3, y + 3), str(int(n0)), fill=(255, 255, 255, 160)); n0 += step
    path = OUT / f'{name}.png'
    img.save(path)
    print(f'{path}  {img.width}x{img.height}  centre E{e:.1f} N{n:.1f}  {size} m  {size/img.width*scale*1000:.0f} mm/px')
    return path

if __name__ == '__main__':
    a = sys.argv[1:]
    if '--overview' in a:
        crop('overview', 677660, 6586420, 1180, scale=1)
    elif '--hole' in a:
        h = int(a[a.index('--hole') + 1]); what = a[a.index('--hole') + 2] if len(a) > a.index('--hole') + 2 else 'green'
        pt = None
        for f in survey['features']:
            if int(f['properties']['hole']) == h and f['properties']['name'] == ('Green Center' if what == 'green' else 'TheTipsTee Back Reach'):
                pt = to3006.transform(*f['geometry']['coordinates'])
        crop(f'hole-{h:02d}-{what}', pt[0], pt[1], 200, scale=4)
    else:
        name, e, n, size = a[0], float(a[1]), float(a[2]), float(a[3])
        scale = int(a[a.index('--scale') + 1]) if '--scale' in a else 2
        crop(name, e, n, size, scale, '--plain' in a)
