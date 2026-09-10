"""Georeferenced canopy/turf audit panels; no vegetation editing."""
import json
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'nvgkbuild/cache/lm-ortho'
audit=json.loads((ROOT/'geo_data/course-v2/norrfallsviken/reference/lm-vegetation-audit-2026-09-09.json').read_text())
items=[dict(id=t['tree']['id'],p=[t['tree']['easting'],t['tree']['northing']],hole=t['surfaces'][0]['hole']) for t in audit['treeConflicts']]
items += [dict(id=t['id'],p=t['centreEpsg3006'],hole=t['surfaces'][0]['hole']) for t in audit['standConflicts']]
canvas=Image.new('RGB',(4*400,2*430),(240,240,240))
for i,item in enumerate(items):
    sid=f'norrfallsviken-{item["hole"]:02d}-hole'
    import rasterio
    with rasterio.open(CACHE/f'{sid}.tif') as src:
        col,row=(~src.transform)*item['p']
        c0,r0=round(col-200),round(row-200)
        crop=Image.open(CACHE/f'{sid}.png').crop((c0,r0,c0+400,r0+400))
    draw=ImageDraw.Draw(crop)
    x,y=col-c0,row-r0
    draw.ellipse((x-10,y-10,x+10,y+10),outline='red',width=2)
    draw.line((x-18,y,x+18,y),fill='red',width=1)
    draw.line((x,y-18,x,y+18),fill='red',width=1)
    xx,yy=i%4*400,i//4*430
    canvas.paste(crop,(xx,yy+30))
    ImageDraw.Draw(canvas).text((xx+5,yy+5),f'H{item["hole"]}: {item["id"]}',fill='black')
out=ROOT/'nvgkbuild/cache/lm-review/vegetation-candidates.png'
canvas.save(out)
print(out)
