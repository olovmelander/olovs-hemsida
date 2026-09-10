"""Native-pixel visual evidence for front-nine tee placement (no image registration)."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'angsobuild/cache/lm-ortho'
OUT=ROOT/'angsobuild/cache/tee-placement/front9-review'
OUT.mkdir(parents=True,exist_ok=True)
REVIEW=json.loads((ROOT/'angsobuild/mapping/orthophoto-review.json').read_text())
BOXES={1:[550,0,1212,1450],2:[157,432,1400,845],3:[749,527,1614,1111],4:[164,1655,866,2812],5:[259,156,743,1713],6:[532,1340,1506,2359],7:[0,2450,1477,3766],8:[505,250,929,1430],9:[324,218,809,1074]}
PLACEMENTS=ROOT/'angsobuild/mapping/tee-placement-front9.json'
PROPOSED=json.loads(PLACEMENTS.read_text()) if PLACEMENTS.exists() else {}
COLORS=['white','yellow','deepskyblue','red','orange']
for n,box in BOXES.items():
    key=f'angso-{n:02}-hole'
    raw=Image.open(CACHE/(key+'.png')).crop(box).convert('RGB')
    meta={'hole':n,'sourceKey':key,'box':box,'scale':1}
    (OUT/f'h{n:02}.json').write_text(json.dumps(meta,indent=2)+'\n')
    h=next(h for h in REVIEW['holes'] if h['n']==n)
    proposed=next((h for h in PROPOSED.get('holes',[]) if h['n']==n),{})
    for bright in [False,True]:
        im=ImageEnhance.Brightness(raw).enhance(1.7) if bright else raw.copy()
        draw=ImageDraw.Draw(im,'RGBA')
        for x in range(0,im.width,100):
            draw.line((x,0,x,im.height),fill=(255,255,255,35))
            draw.text((x+2,2),str(x+box[0]),fill='white',stroke_width=1,stroke_fill='black')
        for y in range(100,im.height,100):
            draw.line((0,y,im.width,y),fill=(255,255,255,35))
            draw.text((2,y+2),str(y+box[1]),fill='white',stroke_width=1,stroke_fill='black')
        for pad in h['tees']['accepted']:
            points=[(p[0]-box[0],p[1]-box[1]) for p in pad['ringPixels']]
            draw.line(points,fill=(0,255,255,220),width=2)
            draw.text(points[0],pad['id'].split('-')[-1],fill='cyan',stroke_width=1,stroke_fill='black')
        for pad in proposed.get('pads',[]):
            points=[(p[0]-box[0],p[1]-box[1]) for p in pad['ringPixels']]
            draw.line(points+[points[0]],fill=(255,160,60,230),width=2)
            draw.text(points[0],pad['id'].split('-')[-1],fill='orange',stroke_width=1,stroke_fill='black')
        for mark in proposed.get('marks',[]):
            if mark.get('pixel') is None:
                if mark.get('candidatePixel'):
                    x,y=mark['candidatePixel'];x-=box[0];y-=box[1]
                    draw.line((x-7,y-7,x+7,y+7),fill='silver',width=2)
                    draw.line((x-7,y+7,x+7,y-7),fill='silver',width=2)
                    draw.text((x+9,y-7),'?'+['W','Y','B','R','O'][mark['index']],fill='silver',stroke_width=1,stroke_fill='black')
                continue
            x,y=mark['pixel'];x-=box[0];y-=box[1]
            c=COLORS[mark['index']]
            draw.ellipse((x-5,y-5,x+5,y+5),fill=c,outline='black',width=1)
            draw.text((x+8,y-6),['W','Y','B','R','O'][mark['index']],fill=c,stroke_width=1,stroke_fill='black')
        im.save(OUT/f'h{n:02}{"-bright" if bright else ""}.png')
print(OUT)
