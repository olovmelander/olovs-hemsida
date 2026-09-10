"""Generate local native-data review panels; panel metadata preserves pixel transforms."""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'nvgkbuild/cache/lm-ortho'
OUT = ROOT / 'nvgkbuild/cache/back9-review'
OUT.mkdir(exist_ok=True)
MODEL = json.loads((ROOT / 'nvgkbuild/cache/lm-validation/baseline-course-model.json').read_text())
PROJ = Transformer.from_crs(4326, 3006, always_xy=True)

def project(p):
    return list(PROJ.transform(MODEL['origin']['lon']+p[0]/MODEL['mPerLon'], MODEL['origin']['lat']-p[1]/MODEL['mPerLat']))

records = []
for hole in MODEL['holes'][9:]:
    n = hole['n']
    name = f'norrfallsviken-{n:02d}-hole'
    if not (CACHE / f'{name}.json').exists():
        continue
    source = json.loads((CACHE / f'{name}.json').read_text())
    im = Image.open(CACHE / source['rgbFile'])
    e0, _, _, n0 = source['boundsEpsg3006']
    res = source['resolutionMetres']
    def panel(identifier, bounds, output_scale=1):
        u0,v0,u1,v1 = [int(round(v)) for v in bounds]
        crop=im.crop((u0,v0,u1,v1))
        if output_scale != 1:
            crop=crop.resize((round(crop.width/output_scale),round(crop.height/output_scale)),Image.Resampling.LANCZOS)
        original=crop.copy()
        draw=ImageDraw.Draw(crop)
        for u in range(0,crop.width,100):
            draw.line([(u,0),(u,crop.height)],fill=(255,255,255,70),width=1)
            draw.text((u+2,2),str(u),fill=(255,220,0),stroke_width=1,stroke_fill='black')
        for v in range(100,crop.height,100):
            draw.line([(0,v),(crop.width,v)],fill=(255,255,255,70),width=1)
            draw.text((2,v+2),str(v),fill=(255,220,0),stroke_width=1,stroke_fill='black')
        crop.save(OUT/f'{identifier}.png')
        original.save(OUT/f'{identifier}-plain.png')
        records.append(dict(id=identifier,hole=n,sourceId=name,rasterSha256=source['sha256'],pixelOrigin=[u0,v0],pixelScale=output_scale,geoTransform=[e0+u0*res,res*output_scale,0,n0-v0*res,0,-res*output_scale],width=crop.width,height=crop.height))
    e,north=project(hole['green']['c'])
    u=(e-e0)/res;v=(n0-north)/res
    panel(f'h{n}-green',(u-220,v-220,u+220,v+220))
    tee_points=[project(m['c']) for m in hole['tees']['marks']]+[project(p) for pad in hole['tees']['pads'] for p in pad['ring']]
    loe=min(p[0] for p in tee_points)-25;hie=max(p[0] for p in tee_points)+25
    lon=min(p[1] for p in tee_points)-25;hin=max(p[1] for p in tee_points)+25
    panel(f'h{n}-tees',((loe-e0)/res,(n0-hin)/res,(hie-e0)/res,(n0-lon)/res),2)
    panel(f'h{n}-hole',(0,0,im.width,im.height),3)
(OUT/'panels.json').write_text(json.dumps(records,indent=2)+'\n')
print(f'{len(records)} panels')
