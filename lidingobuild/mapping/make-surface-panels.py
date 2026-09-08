"""Produce local-only source inspection panels; never adopts or changes geometry."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'lidingobuild/cache/surface-mapping-2019'
CACHE.mkdir(parents=True, exist_ok=True)
source = Image.open(ROOT / 'lidingobuild/cache/municipal-ortho-2019/lidingo-2019-0p5m.png').convert('RGB')
data = json.loads((ROOT / 'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson').read_text(encoding='utf8'))
to_source = Transformer.from_crs(3006,3011,always_xy=True)
world = [float(x) for x in (ROOT / 'lidingobuild/cache/municipal-ortho-2019/lidingo-2019-0p5m.pgw').read_text().split()]
def pixel(p):
    e,n = to_source.transform(*p)
    return ((e-world[4])/world[0],(n-world[5])/world[3])
routes = sorted([f for f in data['features'] if f['properties']['tags']['golf']=='hole'],key=lambda f:int(f['properties']['tags']['ref']))
panels=[]
for kind,index in [('green',-1),('tee',0)]:
    for route in routes:
        hole = int(route['properties']['tags']['ref'])
        center = pixel(route['geometry']['coordinates'][index])
        side = 160 if kind=='green' else 220
        left,top = round(center[0]-side/2),round(center[1]-side/2)
        scale=3 if kind=='green' else 2
        img=source.crop((left,top,left+side,top+side)).resize((side*scale,side*scale))
        draw=ImageDraw.Draw(img)
        for pos in range(0,side,20):
            draw.line((pos*scale,0,pos*scale,side*scale),fill=(180,180,180),width=1)
            draw.line((0,pos*scale,side*scale,pos*scale),fill=(180,180,180),width=1)
            draw.text((pos*scale+2,2),str(pos),fill='yellow',stroke_width=1,stroke_fill='black')
            draw.text((2,pos*scale+2),str(pos),fill='yellow',stroke_width=1,stroke_fill='black')
        x,y = ((center[0]-left)*scale,(center[1]-top)*scale)
        draw.ellipse((x-4,y-4,x+4,y+4),outline='magenta',width=2)
        img.save(CACHE / f'{kind}-{hole:02d}.png')
        panels.append({'hole':hole,'kind':kind,'sourcePixelOrigin':[left,top],'sourcePixelsPerPanel':side,'displayScale':scale,'routeId':route['id'],'endpointPixel':list(center)})
    subset=[p for p in panels if p['kind']==kind]
    for start in range(0,18,6):
        sheet=Image.new('RGB',(3*500,2*510),'#333333')
        draw=ImageDraw.Draw(sheet)
        for idx,panel in enumerate(subset[start:start+6]):
            x,y=(idx%3)*500,(idx//3)*510
            sheet.paste(Image.open(CACHE/f'{kind}-{panel["hole"]:02d}.png'),(x,y+25))
            draw.text((x+8,y+5),f'{kind.upper()} {panel["hole"]} local px; origin {panel["sourcePixelOrigin"]}',fill='white')
        sheet.save(CACHE/f'{kind}-{start+1:02d}-{start+6:02d}.png')
(CACHE/'panels.json').write_text(json.dumps(panels,indent=2)+'\n')
print(CACHE)
