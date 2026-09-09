"""Render reproducible pixel-coordinate review panels and write reviewed rings.

Traces use native pixel edges after the exact panel crop/scale transform. They
are never fitted to existing geometry. Raw orthophotos and panels stay ignored.
"""
import argparse
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'angsobuild/cache/lm-ortho'
OUT = CACHE / 'back9-review'
PLAN = json.loads((CACHE / 'plan.json').read_text(encoding='utf-8'))

def panel(n, name='full', box=None, scale=3, overlay=False):
    window=next(w for w in PLAN['windows'] if w.get('hole')==n)
    suffix='-overlay' if overlay else ''
    im=Image.open(CACHE / (window['id']+suffix+'.png')).convert('RGB')
    box=box or (0,0,im.width,im.height)
    box=(box[0],box[1],box[0]+math.ceil((box[2]-box[0])/scale)*scale,box[1]+math.ceil((box[3]-box[1])/scale)*scale)
    im=im.crop(box)
    im=im.resize((im.width//scale,im.height//scale),Image.Resampling.LANCZOS)
    draw=ImageDraw.Draw(im,'RGBA')
    for x in range(0,im.width,50):
        draw.line((x,0,x,im.height),fill=(255,255,255,45))
        draw.text((x+2,2),str(x),fill=(255,255,255,255),stroke_width=1,stroke_fill=(0,0,0,255))
    for y in range(50,im.height,50):
        draw.line((0,y,im.width,y),fill=(255,255,255,45))
        draw.text((2,y+2),str(y),fill=(255,255,255,255),stroke_width=1,stroke_fill=(0,0,0,255))
    OUT.mkdir(exist_ok=True)
    target=OUT/f'{n:02d}-{name}{suffix}.png'
    im.save(target)
    metadata=dict(hole=n,name=name,sourceKey=window['id'],box=box,scale=scale,width=im.width,height=im.height)
    (OUT/f'{n:02d}-{name}.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(target.relative_to(ROOT),json.dumps(metadata))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('hole',type=int,nargs='?')
    parser.add_argument('--write',action='store_true')
    parser.add_argument('--name',default='full')
    parser.add_argument('--box',type=int,nargs=4)
    parser.add_argument('--scale',type=int,default=3)
    parser.add_argument('--overlay',action='store_true')
    args=parser.parse_args()
    if args.write:
        write_review()
        return
    panel(args.hole,args.name,args.box,args.scale,args.overlay)

def write_review():
    traces=json.loads((ROOT/'angsobuild/mapping/lm-back9-traces.json').read_text())
    result=dict(schemaVersion=1,groundId='angso',reviewedAt='2026-09-09',sources={},holes=[],water=[],
                method='Manual orthophoto edge tracing; native-pixel zooms for greens and sand, exactly three-native-pixel scaled display for fairway context. Existing rings used only for feature location. No fitted translation, rotation or scale.',
                limitations=['April 2025 orthophoto depicts capture-date mowing and sand boundaries, not a live survey.', 'Image ground sample distance is not absolute horizontal accuracy.', 'Omitted categories retain existing geometry and must not be represented as reviewed.'])
    counts={}
    for ns, features in traces.items():
        n=int(ns)
        key=f'angso-{n:02d}-hole'
        ledger=json.loads((CACHE/(key+'.json')).read_text())
        ledger['horizontalCrs']='EPSG:3006'
        result['sources'][key]=ledger
        h=dict(n=n,notes=features.get('notes',''))
        colors={'green':(40,255,65),'fairways':(255,225,30),'tees':(10,245,255),'bunkers':(255,80,220)}
        raw=Image.open(CACHE/(key+'.png')).convert('RGB')
        draw=ImageDraw.Draw(raw)
        zooms={}
        def feature(kind,index,record):
            name,coords=record
            meta=json.loads((OUT/f'{n:02d}-{name}.json').read_text())
            ring=[[round(meta['box'][0]+p[0]*meta['scale'],3),round(meta['box'][1]+p[1]*meta['scale'],3)] for p in coords]
            if ring[-1]!=ring[0]:ring.append(ring[0])
            poly=Polygon(ring)
            assert poly.is_valid and poly.area>1,(n,kind,index)
            assert all(0<=p[0]<=ledger['width'] and 0<=p[1]<=ledger['height'] for p in ring)
            draw.line([tuple(p) for p in ring],fill=colors[kind],width=4)
            if name not in zooms:zooms[name]=Image.open(OUT/f'{n:02d}-{name}.png').convert('RGB')
            ImageDraw.Draw(zooms[name]).line([tuple(p) for p in coords+[coords[0]]],fill=colors[kind],width=2)
            counts[kind]=counts.get(kind,0)+1
            return dict(id=f'angso-{n:02d}-{kind.rstrip("s")}-{index+1:02d}',sourceKey=key,ringPixels=ring)
        for kind in ['green','fairways','tees','bunkers']:
            if kind not in features:continue
            if kind=='green':h[kind]=feature(kind,0,features[kind])
            else:h[kind]=dict(replaceAll=True,sourceKey=key,accepted=[feature(kind,i,r) for i,r in enumerate(features[kind])])
        result['holes'].append(h)
        raw=raw.crop((0,0,math.ceil(raw.width/3)*3,math.ceil(raw.height/3)*3))
        raw.resize((raw.width//3,raw.height//3),Image.Resampling.LANCZOS).save(OUT/f'{n:02d}-reviewed.png')
        for name,img in zooms.items():img.save(OUT/f'{n:02d}-{name}-reviewed.png')
    target=ROOT/'angsobuild/mapping/lm-review-back9.json'
    target.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(file=str(target.relative_to(ROOT)),holes=len(result['holes']),features=counts)))

if __name__=='__main__':main()
