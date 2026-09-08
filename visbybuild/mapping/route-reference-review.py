#!/usr/bin/env python3
"""Local-only ortho evidence panels. Preserves source pixels/coordinates."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from hashlib import sha256

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'visbybuild/cache/route-reference-review'
OUT.mkdir(parents=True, exist_ok=True)
ortho = json.loads((ROOT/'geo_data/course-v2/visby/reference/gotland-ortho-2022.json').read_text('utf-8'))
source = ROOT/ortho['image']['path']
assert sha256(source.read_bytes()).hexdigest()==ortho['image']['sha256']
img = Image.open(source).convert('RGB')
draw=ImageDraw.Draw(img)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',28)
small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
osm=json.loads((ROOT/'geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson').read_text('utf-8'))
greens=[f for f in osm['features'] if f['properties']['tags'].get('golf')=='green']
for i,f in enumerate(greens,1):
    ring=f['geometry']['coordinates'][0]
    pts=[((x-686900)*2,(6372150-y)*2) for x,y in ring]
    draw.line(pts, fill='#ffff00',width=4)
    x=sum(p[0] for p in pts[:-1])/len(pts[:-1]);y=sum(p[1] for p in pts[:-1])/len(pts[:-1])
    draw.rectangle((x+10,y-24,x+82,y+15),fill='black')
    draw.text((x+14,y-23),f'G{i}',font=font,fill='yellow')
for x in range(0,img.width,200):
    draw.line((x,0,x,img.height), fill=(75,110,135),width=1)
    draw.text((x+3,5),str(x),font=small,fill='white')
for y in range(0,img.height,200):
    draw.line((0,y,img.width,y), fill=(75,110,135),width=1)
    draw.text((5,y+3),str(y),font=small,fill='white')
img.save(OUT/'osm-green-labels.png')
for name,b in [('north',(550,350,2250,1600)),('middle',(400,1300,2800,2450)),('south',(350,2200,3000,3200))]:
    img.crop(b).save(OUT/f'{name}.png')
print(json.dumps({'panels':str(OUT),'greenLabels':[{'label':f'G{i}','id':f['id']}for i,f in enumerate(greens,1)]},indent=2))
clean=Image.open(source).convert('RGB')
for name,bounds in {'middle-east-clean':(1630,1560,2600,2250),'south-clean':(1450,2630,2600,3210),'club-east-clean':(730,2590,1440,2960),'east-par3-clean':(2250,2090,2860,2550)}.items():
    clean.crop(bounds).save(OUT/(name+'.png'))
for name,bounds in {'tee12c':(2290,2790,2430,2930),'tee16c':(1680,1800,1780,1930),'green3c':(1260,750,1380,890),'green14c':(2260,2070,2430,2240)}.items():
    crop=clean.crop(bounds);crop.resize((crop.width*3,crop.height*3)).save(OUT/(name+'.png'))
for name,bounds in {'tee5c':(820,540,940,760),'green3d':(1280,760,1420,920),'tee12d':(2150,2900,2400,3050)}.items():
    crop=clean.crop(bounds);crop.resize((crop.width*3,crop.height*3)).save(OUT/(name+'.png'))
crop=clean.crop((2390,2650,2600,2890));crop.resize((crop.width*3,crop.height*3)).save(OUT/'tee12e.png')
