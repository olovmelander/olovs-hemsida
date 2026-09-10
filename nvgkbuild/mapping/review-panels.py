"""Produce source-grid crop panels with retained pixel-edge transforms.

Raw orthophotos and visual-review PNGs remain in the ignored cache.
Run with the existing upsalabuild/cache/review-venv/Scripts/python.exe.
"""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT/'nvgkbuild/cache/lm-ortho'
OUT = ROOT/'nvgkbuild/cache/lm-review'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--holes', nargs='+', type=int, default=list(range(1,19)))
    args = parser.parse_args()
    model = json.loads((ROOT/'nvgkbuild/cache/lm-validation/baseline-course-model.json').read_text())
    project = Transformer.from_crs(4326,3006,always_xy=True)
    def grid(p):
        return project.transform(model['origin']['lon']+p[0]/model['mPerLon'],model['origin']['lat']-p[1]/model['mPerLat'])
    OUT.mkdir(parents=True,exist_ok=True)
    for h in model['holes']:
        n = h['n']
        if n not in args.holes: continue
        source_id = f'norrfallsviken-{n:02d}-hole'
        meta = json.loads((CACHE/f'{source_id}.json').read_text())
        with rasterio.open(CACHE/f'{source_id}.tif') as src:
            for kind in ['green','tees','hole']:
                points = [grid(p) for p in (h['green']['ring'] if kind=='green' else
                    [p for t in h['tees']['pads'] for p in t['ring']]+[m['c'] for m in h['tees']['marks']] if kind=='tees' else h['line'])]
                margin = 24 if kind=='green' else 25
                cols,rows=zip(*[(~src.transform)*(e,n) for e,n in points])
                c0=max(0,math.floor(min(cols)-margin/.16)); r0=max(0,math.floor(min(rows)-margin/.16))
                c1=min(src.width,math.ceil(max(cols)+margin/.16)); r1=min(src.height,math.ceil(max(rows)+margin/.16))
                if kind=='hole': c0,r0,c1,r1=0,0,src.width,src.height
                window=Window(c0,r0,c1-c0,r1-r0)
                scale=max(1,(c1-c0)/1600,(r1-r0)/1600)
                width=round((c1-c0)/scale);height=round((r1-r0)/scale)
                rgb=src.read([1,2,3],window=window,out_shape=(3,height,width))
                image=Image.fromarray(rgb.transpose(1,2,0))
                affine=src.window_transform(window)*rasterio.Affine.scale((c1-c0)/width,(r1-r0)/height)
                name=f'{n:02d}-{kind}'
                image.save(OUT/f'{name}.png')
                draw=ImageDraw.Draw(image)
                for x in range(0,width,100):
                    draw.line([(x,0),(x,height)],fill=(255,255,255,65),width=1)
                    draw.text((x+2,2),str(x),fill='white',stroke_width=1,stroke_fill='black')
                for y in range(100,height,100):
                    draw.line([(0,y),(width,y)],fill=(255,255,255,65),width=1)
                    draw.text((2,y+2),str(y),fill='white',stroke_width=1,stroke_fill='black')
                shapes=[('cyan',h['green']['ring'])]+[('yellow',b['ring']) for b in h['bunkers']]+[('white',t['ring']) for t in h['tees']['pads']]+[('magenta',f) for f in h['fairway']['rings']]
                for colour,ring in shapes:
                    pixels=[(~affine)*grid(p) for p in ring]
                    draw.line(pixels+[pixels[0]],fill=colour,width=2)
                for i,m in enumerate(h['tees']['marks']):
                    x,y=(~affine)*grid(m['c']);draw.ellipse((x-5,y-5,x+5,y+5),fill=['yellow','red','orange'][i]);draw.text((x+7,y),str(i),fill='white',stroke_width=1,stroke_fill='black')
                image.save(OUT/f'{name}-overlay.png')
                record={'id':name,'sourceId':source_id,'sourceSha256':meta['sha256'],'geoTransform':list(affine.to_gdal()),'width':width,'height':height,'sourcePixelWindow':[c0,r0,c1-c0,r1-r0]}
                (OUT/f'{name}.json').write_text(json.dumps(record,indent=2)+'\n')
                print(name,flush=True)


if __name__=='__main__': main()
