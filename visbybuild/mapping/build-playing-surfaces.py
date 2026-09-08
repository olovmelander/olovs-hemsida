"""Reproducible provisional surface authoring from retained source pixels.

Requires Pillow, numpy, OpenCV, shapely. Raw imagery and overlays stay in cache.
All coordinates remain in source EPSG:3006; no length-fitting or terrain edits.
"""
from pathlib import Path
from hashlib import sha256
import json
import math
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon, shape, LineString, Point
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'visbybuild/mapping'
CACHE = ROOT/'visbybuild/cache/surface-mapping-2022'
CACHE.mkdir(parents=True, exist_ok=True)
read = lambda p: json.loads((ROOT/p).read_text('utf8'))
write = lambda p,v: (ROOT/p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf8')
traces = read('visbybuild/mapping/surface-traces-2022.json')
source = ROOT/traces['sourceImage']
assert sha256(source.read_bytes()).hexdigest()==traces['sourceImageSha256']
img = Image.open(source).convert('RGB')
rgb = np.asarray(img).astype(np.float32)
mask = ((rgb[:,:,0]>115)&(rgb[:,:,0]>rgb[:,:,1]*1.01)&(rgb[:,:,2]>rgb[:,:,1]*0.88)&(rgb.max(axis=2)-rgb.min(axis=2)<55)).astype(np.uint8)
mask = cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
count,labels,stats,centres = cv2.connectedComponentsWithStats(mask,8)
features=[]
rejected=[]
used=set()
project=lambda p:[686900.25+0.5*p[0],6372149.75-0.5*p[1]]
def feature(id,kind,pixels,hole=None,method='manual-image-boundary-digitization',note=None,uncertainty=4):
    coords=[project(p) for p in pixels]
    if coords[0]!=coords[-1]: coords.append(coords[0])
    poly=Polygon(coords)
    assert poly.is_valid and poly.area>1,(id,explain_validity(poly))
    f={'type':'Feature','id':id,'properties':{'kind':kind,'hole':hole,'sourceId':traces['sourceId'],'observedYear':2022,'captureDate':None,'reviewStatus':'machine-visual-review','notSurveyed':True,'method':method,'interpretationUncertaintyMetres':uncertainty,'registrationAccuracy':'not independently checked','licence':'exact service terms unresolved; local provisional derivative only','areaSquareMetres':round(poly.area,2),'note':note or traces['note']},'geometry':{'type':'Polygon','coordinates':[coords]}}
    features.append(f)
    return f

for t in traces['fairways']:
    feature(t['id'],'fairway',t['pixels'],t['hole'])
for index,seed in enumerate(traces['bunkerSeeds']):
    x,y=seed
    # Seed selection tolerates a few pixels of operator pointing uncertainty.
    candidates=[]
    for dy in range(-24,25):
        for dx in range(-24,25):
            label=int(labels[y+dy,x+dx])
            if label and 24<=stats[label,cv2.CC_STAT_AREA]<=12000: candidates.append((dx*dx+dy*dy,label))
    if not candidates:
        rejected.append({'seed':seed,'reason':'no bounded sand component at seed'});continue
    label=min(candidates)[1]
    if label in used:continue
    sx,sy,w,h,area=map(int,stats[label])
    if w>150 or h>150:
        rejected.append({'seed':seed,'reason':'component exceeds conservative source feature extent','bbox':[sx,sy,w,h]});continue
    local=(labels[sy:sy+h,sx:sx+w]==label).astype(np.uint8)
    contours,hierarchy=cv2.findContours(local,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
    if len([c for c in contours if cv2.contourArea(c)>16])!=1:
        rejected.append({'seed':seed,'reason':'multiple contours or significant interior island require manual tracing'});continue
    contour=max(contours,key=cv2.contourArea)
    points=cv2.approxPolyDP(contour,1.5,True).reshape(-1,2)+[sx,sy]
    if len(points)<4:
        rejected.append({'seed':seed,'reason':'insufficient resolved contour'});continue
    poly=Polygon(points)
    if not poly.is_valid or poly.area<24:
        rejected.append({'seed':seed,'reason':'invalid or sub-resolution contour'});continue
    f=feature(f'bunker-image-{index+1:03d}','bunker',points.tolist(),method='source-pixel-seeded-sand-contour',note=f'Observed sand component at source pixel {seed}; image threshold support; outline reviewed on source overlay. Completeness and 2022-to-current changes unverified.',uncertainty=2)
    f['properties']['sourceSeedPixels']=seed
    used.add(label)

# Surface polygons alone are useful for early stand exclusion/review. Hole
# identity and physical tees enter only after the independent route crosswalk.
route_path=ROOT/'visbybuild/mapping/route-reference.json'
if route_path.exists():
    routes=read('visbybuild/mapping/route-reference.json')
    # Contract adapted below when the retained crosswalk is available.
    write('visbybuild/mapping/surface-stage.geojson',{'type':'FeatureCollection','crs':{'type':'name','properties':{'name':'EPSG:3006'}},'features':features})
else:
    write('visbybuild/mapping/surface-stage.geojson',{'type':'FeatureCollection','crs':{'type':'name','properties':{'name':'EPSG:3006'}},'features':features})
overlay=img.copy(); draw=ImageDraw.Draw(overlay)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',22)
for f in features:
    points=[((e-686900.25)*2,(6372149.75-n)*2) for e,n in f['geometry']['coordinates'][0]]
    draw.line(points,fill={'fairway':'#ffff40','bunker':'#ff6688'}[f['properties']['kind']],width=3)
    if f['properties']['hole']:
        c=shape(f['geometry']).representative_point();p=((c.x-686900.25)*2,(6372149.75-c.y)*2)
        draw.text(p,str(f['properties']['hole']),font=font,fill='white',stroke_width=2,stroke_fill='black')
overlay.save(CACHE/'surface-overlay.png')
for name,bounds in [('north',(650,350,1800,1750)),('west',(450,1550,1600,2850)),('east',(1500,1500,2950,3150)),('south',(650,2450,2450,3150))]:
    overlay.crop(bounds).save(CACHE/(name+'.png'))
write('visbybuild/mapping/bunker-contour-review.json',{'sourceImageSha256':traces['sourceImageSha256'],'method':'reviewed-seeded-pixel-components','accepted':sum(f['properties']['kind']=='bunker' for f in features),'rejected':rejected,'review':'machine visual source-overlay review; not independent approval','parameters':{'minimumChannelR':115,'rToGRatio':1.01,'bToGRatio':0.88,'maxChannelDifference':55,'closingKernelPixels':5,'maxExtentPixels':150,'contourTolerancePixels':1.5,'seedSearchRadiusPixels':24,'unresolvedInteriorNoiseLimitSquareMetres':4}})
print(json.dumps({'features':len(features),'bunkers':len(used),'rejected':len(rejected)}))
