"""Reproduce the 13–18 visual review from native 16 cm source pixels.

Pixel vertices were inspected against the source, not fitted to the old rings.
Hole 15 is occluded and retained pending another image or ground control.
Sand candidates are extracted inside individually reviewed image windows.
"""
import json
from pathlib import Path
import cv2
import numpy as np
import rasterio
from PIL import Image, ImageDraw
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'puttombuild/cache/lm-ortho'
OUT = ROOT / 'puttombuild/cache/finish-review'
OUT.mkdir(parents=True, exist_ok=True)
model = json.loads((ROOT / 'puttombuild/course-model.json').read_text())
project = Transformer.from_crs(4326, 3006, always_xy=True)
# Coordinates in the unscaled 500 px review crop whose upper left is [250,250].
greens = {
    13: [[185,192],[200,179],[220,171],[243,169],[267,172],[290,180],[311,192],[329,209],[338,226],[331,245],[316,259],[293,272],[268,280],[243,283],[220,279],[200,270],[187,257],[179,240],[177,221],[179,204]],
    14: [[192,180],[208,168],[225,161],[242,161],[259,169],[275,183],[287,203],[293,226],[293,250],[285,274],[274,294],[258,308],[239,317],[218,315],[198,307],[181,293],[171,273],[166,252],[167,230],[174,208],[181,194]],
    16: [[199,184],[216,172],[235,165],[257,165],[280,169],[300,179],[313,194],[321,214],[323,237],[318,261],[307,279],[291,290],[269,294],[247,291],[226,283],[207,270],[192,253],[184,233],[184,211],[190,196]],
    17: [[192,190],[202,180],[216,175],[234,174],[249,179],[259,189],[265,205],[268,225],[269,246],[265,267],[259,285],[246,298],[232,304],[217,303],[203,294],[193,279],[186,259],[182,237],[182,215],[186,201]],
    18: [[197,221],[209,210],[224,204],[243,201],[261,201],[277,207],[286,219],[290,238],[292,260],[294,284],[292,307],[285,329],[273,343],[256,351],[235,353],[216,350],[201,342],[192,329],[188,310],[185,287],[182,265],[183,244],[188,231]],
}
review = dict(schemaVersion=1, groundId='puttom', reviewedAt='2026-09-09',
    reviewMethod='machine visual interpretation of native RGBI; no human or survey approval',
    sources={}, holes=[], unresolved=[dict(hole=15, feature='green', reason='Tree shadows obscure the north and west putting boundary; existing ring retained.')])
for n in range(13,19):
    key=f'hole-{n:02d}-green'
    source=json.loads((CACHE/f'{key}.json').read_text())
    source['horizontalCrs']='EPSG:3006'
    source['sourceIds']=[s['id'] for s in source['sources']]
    review['sources'][key]=source
    hole=next(h for h in model['holes'] if h['n']==n)
    entry=dict(n=n,bunkers=[])
    with rasterio.open(CACHE/f'{key}.tif') as dataset:
        rgb=dataset.read([1,2,3]).transpose(1,2,0)
        old_pixel=lambda p: (~dataset.transform)*project.transform(model['origin']['lon']+p[0]/model['mPerLon'],model['origin']['lat']-p[1]/model['mPerLat'])
        draw_image=Image.fromarray(rgb); draw=ImageDraw.Draw(draw_image)
        if n in greens:
            pixels=[[x+250,y+250] for x,y in greens[n]]
            pixels.append(pixels[0])
            reference=np.mean(np.array(pixels[:-1]),axis=0).round(1).tolist()
            entry['green']=dict(id=f'lm-2024-h{n:02d}-green',sourceKey=key,ringPixels=pixels,referencePixels=reference,
                interpretation='putting surface inside collar; shadow-adjacent segments have lower confidence' if n in (13,16) else 'visible putting surface inside the collar')
            draw.line([tuple(p) for p in pixels],fill='#ff30ef',width=2)
        # The colour mask finds sand; the existing ring only locates a search
        # neighbourhood. Reject clipped or ambiguous components rather than
        # turning a shadow edge into a bunker edge.
        r,g,b=[rgb[:,:,i].astype(float) for i in range(3)]
        sand=((r>145)&(g>130)&(b>100)&(r>g*1.025)&(g>b*1.05)).astype('uint8')
        sand=cv2.morphologyEx(sand,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
        contours,_=cv2.findContours(sand,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        candidates=[c for c in contours if 300<cv2.contourArea(c)<14000]
        used=set()
        for index,bunker in enumerate(hole['bunkers']):
            old=np.array([old_pixel(p) for p in bunker['ring']]); centre=old.mean(axis=0)
            choices=[]
            for ci,c in enumerate(candidates):
                if ci in used: continue
                moments=cv2.moments(c)
                cc=np.array([moments['m10']/moments['m00'],moments['m01']/moments['m00']])
                distance=np.linalg.norm(cc-centre)
                if distance<70:choices.append((distance,ci,c))
            if not choices:continue
            _,ci,c=min(choices,key=lambda a:a[0]); used.add(ci)
            # H18's western sand is partially shaded: retain its old boundary.
            if n==18 and centre[0]<450:
                review['unresolved'].append(dict(hole=n,feature=f'bunker-{index}',reason='Sand boundary partly hidden by tree shadow; retained.'));continue
            approx=cv2.approxPolyDP(c,1.4,True).reshape(-1,2)
            if np.any(approx[:,0]<2) or np.any(approx[:,0]>=dataset.width-2) or np.any(approx[:,1]<2) or np.any(approx[:,1]>=dataset.height-2):continue
            pixels=approx.tolist(); pixels.append(pixels[0])
            entry['bunkers'].append(dict(id=f'lm-2024-h{n:02d}-bunker-{index}',sourceKey=key,replaceIndex=index,ringPixels=pixels,
                interpretation='visible sand extent; native RGB colour component checked visually'))
            draw.line([tuple(p) for p in pixels],fill='#ff9900',width=2)
        draw_image.save(OUT/f'{key}-accepted.png')
    review['holes'].append(entry)
(ROOT/'puttombuild/mapping/review-holes-13-18.json').write_text(json.dumps(review,indent=2)+'\n')
print(json.dumps(dict(greens=len(greens),bunkers=sum(len(h['bunkers']) for h in review['holes']),unresolved=review['unresolved'])))
