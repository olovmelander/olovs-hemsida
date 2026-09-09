"""Review open-water shorelines with the native RGB and near-infrared imagery."""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image,ImageDraw
from pyproj import Transformer
from derived_window import derive_window, ROOT

model=json.loads((ROOT/'puttombuild/course-model.json').read_text())
project=Transformer.from_crs(4326,3006,always_xy=True)
review=dict(schemaVersion=1,groundId='puttom',reviewedAt='2026-09-09',sources={},water=[],
    reviewMethod='machine RGBI water segmentation and visual boundary review; not a surveyed water level',unresolved=[])
out=ROOT/'puttombuild/cache/water-review';out.mkdir(exist_ok=True)
for old in model['water']:
    if old['id'] not in ['w185976257','w227300000']:continue
    key='water-'+old['id'][1:]
    points=np.array([project.transform(model['origin']['lon']+x/model['mPerLon'],model['origin']['lat']-z/model['mPerLat']) for x,z in old['ring']])
    bounds=[points[:,0].min()-25,points[:,1].min()-25,points[:,0].max()+25,points[:,1].max()+25]
    source,pixels,transform=derive_window(key,bounds)
    rgb=pixels[:3].transpose(1,2,0);green=pixels[1].astype(float);nir=pixels[3].astype(float)
    ndwi=(green-nir)/(green+nir+1)
    mask=((ndwi>.15)&(nir<70)&(nir<pixels[0].astype(float)*.8)).astype('uint8')
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
    # Tree shadows and shiny roofs can connect to water through a narrow pixel
    # neck. Opening removes those appendages; this is a broad lake boundary,
    # and connected narrow waterways stay in the separate stream geometry.
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9)))
    contours,hierarchy=cv2.findContours(mask,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE)
    contour=max(contours,key=cv2.contourArea)
    area=cv2.contourArea(contour)*.16**2
    approx=cv2.approxPolyDP(contour,5,True).reshape(-1,2)
    if np.any(approx[:,0]<3) or np.any(approx[:,0]>=source['width']-3) or np.any(approx[:,1]<3) or np.any(approx[:,1]>=source['height']-3):raise ValueError('Water reaches review edge')
    if not .6<area/old['area']<1.2:raise ValueError('Unexpected water extent')
    ring=approx.tolist();ring.append(ring[0])
    review['sources'][key]=source
    review['water'].append(dict(id='lm-2024-'+key,sourceKey=key,replaceId=old['id'],ringPixels=ring,
        interpretation='visible open water in 2024 RGBI; excludes reeds; retained 1 m terrain/legacy water level',
        oldAreaSquareMetres=old['area'],imageAreaSquareMetres=round(area,1),method=dict(ndwiMinimum=.15,nirMaximum=70,nirToRedMaximum=.8,closingPixels=5,openingPixels=9,simplificationMetres=.8),
        uncertainty='Open-water edge, not legal hazard boundary; 1.44 m opening suppresses narrow shadow artefacts; aquatic vegetation and occluded shore require ground review.'))
    image=Image.fromarray(rgb);draw=ImageDraw.Draw(image)
    oldpixels=[(~transform)*tuple(p) for p in points]
    draw.line(oldpixels+[oldpixels[0]],fill='#ff4242',width=8)
    draw.line([tuple(p) for p in ring],fill='#25ffce',width=5)
    image.thumbnail((950,1400));image.save(out/(key+'-overlay.png'))
    raw=Image.fromarray(rgb);raw.thumbnail((950,1400));raw.save(out/(key+'.png'))
    print(json.dumps(dict(id=old['id'],oldArea=old['area'],newArea=round(area,1),vertices=len(ring))))
(ROOT/'puttombuild/mapping/review-water.json').write_text(json.dumps(review,indent=2)+'\n')
