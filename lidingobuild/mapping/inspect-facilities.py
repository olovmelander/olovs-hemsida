"""Local-only annotated source crops; no geometry adoption in this inspector."""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'lidingobuild/cache/facility-review'
OUT.mkdir(parents=True, exist_ok=True)
base = ROOT / 'lidingobuild/cache/municipal-ortho-2019/lidingo-2019-0p5m'
source = Image.open(base.with_suffix('.png')).convert('RGB')
world = [float(v) for v in base.with_suffix('.pgw').read_text().split()]
transform = Transformer.from_crs(3006, 3011, always_xy=True)

def pixel(p):
    e, n = transform.transform(*p[:2])
    return ((e-world[4])/world[0], (n-world[5])/world[3])

features = []
for name in ['osm-golf-epsg3006.geojson', 'osm-context-epsg3006.geojson']:
    features += json.loads((ROOT/'geo_data/course-v2/lidingo/reference'/name).read_text(encoding='utf8'))['features']
panels = [('clubhouse', [1050, 1150, 1430, 1510]), ('range', [980, 1450, 1420, 2020]), ('north-practice', [1110, 870, 1560, 1220]), ('south-practice', [940, 1950, 1400, 2220]), ('upper-parking', [1000, 1140, 1230, 1390])]
records = []
for name, bounds in panels:
    left, top, right, bottom = bounds
    scale = 2
    im = source.crop(bounds).resize(((right-left)*scale, (bottom-top)*scale))
    raw = im.copy()
    draw = ImageDraw.Draw(im)
    for f in features:
        geom = f['geometry']; tags = f['properties']['tags']
        if geom['type'] != 'Polygon' or not any(k in tags for k in ['building', 'golf', 'amenity']):
            continue
        coords = [pixel(p) for p in geom['coordinates'][0]]
        center = [sum(p[k] for p in coords)/len(coords) for k in (0, 1)]
        if not (left < center[0] < right and top < center[1] < bottom):
            continue
        colour = 'cyan' if 'building' in tags else 'magenta' if 'golf' in tags else 'yellow'
        draw.line([((x-left)*scale, (y-top)*scale) for x,y in coords], fill=colour, width=2)
        label = f['id'].replace('way/', '')+' '+str(tags.get('golf', tags.get('building', tags.get('amenity'))))
        draw.text(((center[0]-left)*scale, (center[1]-top)*scale), label, fill=colour, stroke_fill='black', stroke_width=1)
        records.append({'panel': name, 'id': f['id'], 'tags': tags, 'sourcePixelCentre': center})
    im.save(OUT/f'{name}-osm.png')
    draw = ImageDraw.Draw(raw)
    for x in range(0, right-left, 25):
        draw.line((x*scale, 0, x*scale, raw.height), fill='#999999', width=1)
        draw.text((x*scale+2, 2), str(x), fill='yellow', stroke_fill='black', stroke_width=1)
    for y in range(0, bottom-top, 25):
        draw.line((0, y*scale, raw.width, y*scale), fill='#999999', width=1)
        draw.text((2, y*scale+2), str(y), fill='yellow', stroke_fill='black', stroke_width=1)
    raw.save(OUT/f'{name}-grid.png')
(OUT/'osm-panel-inventory.json').write_text(json.dumps(records, indent=2)+'\n', encoding='utf8')
print(OUT)
