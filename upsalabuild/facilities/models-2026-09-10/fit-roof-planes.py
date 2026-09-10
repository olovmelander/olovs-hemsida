"""Reproducible fit roof planes.
See roof-reproduction.md before running: later stages overwrite derived evidence.
Preserved from the reviewed cache recipe; paths now resolve from this source file.
"""
from pathlib import Path
import json,gzip,math
import numpy as np
from shapely import Polygon,contains_xy
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[3];CACHE=ROOT/'upsalabuild/cache/facilities-2026-09-10/roof-study';CACHE.mkdir(parents=True,exist_ok=True)
# Exact native crop used for the manually reviewed roof domains.
Image.open(ROOT/'upsalabuild/cache/facilities-2026-09-10/facilities-campus-native.png').crop((281,500,1063,1375)).save(CACHE/'clubhouse-plain-native.png')
ref=ROOT/'upsalabuild/facilities/reference-2026-09-10';inventory=json.loads((ref/'building-reference-inventory.json').read_text());laser=json.loads((ref/'lidar-roof-evidence.json').read_text())
with gzip.open(ROOT/laser['points']['path'],'rt') as f:pts=np.loadtxt(f,delimiter=',',skiprows=1)
b=next(b for b in inventory['buildings'] if b['id']=='B01');keep=contains_xy(Polygon(b['sourceRingsEPSG3006']).buffer(-.4),pts[:,0],pts[:,1])&(pts[:,3]==1)
data=pts[keep,:3];origin=data[:,:2].mean(axis=0);A=np.column_stack([data[:,:2]-origin,np.ones(len(data))]);remaining=np.arange(len(data));rng=np.random.default_rng(9401);planes=[]
for index in range(12):
 if len(remaining)<30:break
 best=[]
 for _ in range(1800):
  sample=rng.choice(remaining,3,replace=False)
  try:c=np.linalg.solve(A[sample],data[sample,2])
  except np.linalg.LinAlgError:continue
  if np.linalg.norm(c[:2])>1.6:continue
  errors=np.abs(A[remaining]@c-data[remaining,2]);inliers=remaining[errors<.13]
  if len(inliers)>len(best):best=inliers
 if len(best)<30:break
 c=np.linalg.lstsq(A[best],data[best,2],rcond=None)[0]
 inliers=remaining[np.abs(A[remaining]@c-data[remaining,2])<.13]
 c=np.linalg.lstsq(A[inliers],data[inliers,2],rcond=None)[0];residual=A[inliers]@c-data[inliers,2]
 planes.append(dict(id=f'P{index+1:02d}',originEPSG3006=origin.tolist(),coefficients=c.tolist(),points=data[inliers].tolist(),count=len(inliers),rmse=float(np.sqrt(np.mean(residual**2))),pitchDegrees=math.degrees(math.atan(np.linalg.norm(c[:2]))),centroid=data[inliers].mean(axis=0).tolist()))
 remaining=np.setdiff1d(remaining,inliers)
colors=['#ff0000','#00ee00','#2222ff','#ff00ff','#00ffff','#ffff00','#ff8800','#bb88ff','#ffffff','#00aa88','#ccbb88','#888888'];im=Image.open(CACHE/'clubhouse-plain-native.png').convert('RGB');d=ImageDraw.Draw(im);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',19)
def px(p):return ((p[0]-639740)/.16-281,(6636540-p[1])/.16-500)
for i,p in enumerate(planes):
 for q in p['points']:
  x,y=px(q);d.ellipse([x-1,y-1,x+1,y+1],fill=colors[i])
 x,y=px(p['centroid']);d.text((x,y),p['id'],font=font,fill=colors[i],stroke_width=2,stroke_fill='black')
im.save(CACHE/'clubhouse-plane-clusters.png');(CACHE/'planes.json').write_text(json.dumps(planes,indent=2))
print(json.dumps([{k:p[k] for k in ['id','count','rmse','pitchDegrees','centroid','coefficients']} for p in planes],indent=2))
