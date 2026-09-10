"""Reproducible fit auxiliary roof planes.
See roof-reproduction.md before running: later stages overwrite derived evidence.
Preserved from the reviewed cache recipe; paths now resolve from this source file.
"""
from pathlib import Path
import json,gzip,math
import numpy as np
from shapely import Polygon,contains_xy
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[3];CACHE=ROOT/'upsalabuild/cache/facilities-2026-09-10/roof-study';CACHE.mkdir(parents=True,exist_ok=True)
ref=ROOT/'upsalabuild/facilities/reference-2026-09-10';inv=json.loads((ref/'building-reference-inventory.json').read_text());laser=json.loads((ref/'lidar-roof-evidence.json').read_text())
with gzip.open(ROOT/laser['points']['path'],'rt') as f:pts=np.loadtxt(f,delimiter=',',skiprows=1)
result=[];im=Image.open(ROOT/'upsalabuild/cache/facilities-2026-09-10/facilities-campus-native.png').convert('RGB');draw=ImageDraw.Draw(im);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
colors=['#00ffff','#ff00ff','#ffff00','#00ff00']
for ident in ['B02','B04','B05','B06','B07']:
 b=next(b for b in inv['buildings'] if b['id']==ident);keep=contains_xy(Polygon(b['sourceRingsEPSG3006']).buffer(-.35),pts[:,0],pts[:,1])&(pts[:,3]==1)
 data=pts[keep,:3];origin=data[:,:2].mean(axis=0) if len(data) else np.zeros(2);A=np.column_stack([data[:,:2]-origin,np.ones(len(data))]);remaining=np.arange(len(data));rng=np.random.default_rng(904);planes=[]
 for index in range(4):
  if len(remaining)<12:break
  best=[]
  for _ in range(1300):
   sample=rng.choice(remaining,3,replace=False)
   try:c=np.linalg.solve(A[sample],data[sample,2])
   except np.linalg.LinAlgError:continue
   if np.linalg.norm(c[:2])>1.6:continue
   inliers=remaining[np.abs(A[remaining]@c-data[remaining,2])<.13]
   if len(inliers)>len(best):best=inliers
  if len(best)<12:break
  c=np.linalg.lstsq(A[best],data[best,2],rcond=None)[0];inliers=remaining[np.abs(A[remaining]@c-data[remaining,2])<.13];c=np.linalg.lstsq(A[inliers],data[inliers,2],rcond=None)[0]
  residual=A[inliers]@c-data[inliers,2];pl=dict(id=f'{ident}-P{index+1}',originEPSG3006=origin.tolist(),coefficients=c.tolist(),points=data[inliers].tolist(),count=len(inliers),rmse=float(np.sqrt(np.mean(residual**2))),pitchDegrees=math.degrees(math.atan(np.linalg.norm(c[:2]))),centroid=data[inliers].mean(axis=0).tolist());planes.append(pl);remaining=np.setdiff1d(remaining,inliers)
  for q in pl['points']:
   x=(q[0]-639740)/.16;y=(6636540-q[1])/.16;draw.ellipse([x-2,y-2,x+2,y+2],fill=colors[index])
  x=(pl['centroid'][0]-639740)/.16;y=(6636540-pl['centroid'][1])/.16;draw.text((x,y),pl['id'],font=font,fill=colors[index],stroke_width=2,stroke_fill='black')
 result.append(dict(id=ident,planes=planes,sourcePointCount=len(data),unmatched=len(remaining)))
im.crop((250,500,1250,1490)).save(CACHE/'auxiliary-plane-clusters.png');(CACHE/'auxiliary-planes.json').write_text(json.dumps(result,indent=2))
print(json.dumps([dict(id=b['id'],n=b['sourcePointCount'],planes=[{k:p[k] for k in ['id','count','rmse','pitchDegrees','coefficients']} for p in b['planes']]) for b in result],indent=2))
