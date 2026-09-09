import json, math
import numpy as np
from PIL import Image, ImageDraw
from pathlib import Path
root=Path('lidingobuild/cache/architecture-review')
geometry=json.loads((root/'geometry.json').read_text())
tris=[]
W,H=1400,900
def render(name,eye,target,only=None):
 eye=np.array(eye,float); forward=np.array(target,float)-eye; forward/=np.linalg.norm(forward)
 right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right);up=np.cross(right,forward)
 depth=np.full((H,W),np.inf); rgb=np.zeros((H,W,3),dtype=np.uint8);rgb[:]=[195,213,219]
 light=np.array([-.6,.9,.7]);light/=np.linalg.norm(light)
 for t in tris:
  if only and t.get('id') not in [only,'ground']:continue
  p=np.array(t['points']);q=p-eye;d=q@forward
  if d.min()<=.1:continue
  s=np.stack([W*.5+(q@right)*1200/d,H*.5-(q@up)*1200/d],axis=1)
  x0=max(0,int(np.floor(s[:,0].min())));x1=min(W-1,int(np.ceil(s[:,0].max())))
  y0=max(0,int(np.floor(s[:,1].min())));y1=min(H-1,int(np.ceil(s[:,1].max())))
  if x0>x1 or y0>y1:continue
  (ax,ay),(bx,by),(cx,cy)=s;den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
  if abs(den)<1e-9:continue
  xx,yy=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
  a=((by-cy)*(xx-cx)+(cx-bx)*(yy-cy))/den;b=((cy-ay)*(xx-cx)+(ax-cx)*(yy-cy))/den;c=1-a-b
  with np.errstate(divide='ignore',invalid='ignore'):z=1/(a/d[0]+b/d[1]+c/d[2])
  mask=(a>=0)&(b>=0)&(c>=0)&(z<depth[y0:y1+1,x0:x1+1])
  if not mask.any():continue
  n=np.cross(p[1]-p[0],p[2]-p[0]);n/=np.linalg.norm(n)
  if np.dot(n,eye-p.mean(axis=0))<0:n=-n
  shade=.69+.31*max(0,np.dot(n,light))
  color=np.array([(t['color']>>16)&255,(t['color']>>8)&255,t['color']&255])*shade
  depth[y0:y1+1,x0:x1+1][mask]=z[mask];rgb[y0:y1+1,x0:x1+1][mask]=color
 im=Image.fromarray(rgb);draw=ImageDraw.Draw(im);draw.rectangle((0,H-40,W,H),fill=(24,38,35))
 label='Source TIN display' if name.startswith('old') else 'Photo-informed architecture'
 draw.text((20,H-27),f'GEOMETRY REVIEW / {label} + published 1 m terrain / Not an app screenshot',fill=(225,235,225))
 im.save(root/f'{name}.png')

for mode in ['old','current']:
 tris=geometry['terrain']+geometry[mode]
 render(mode+'-overview',[24,69,5],[-45,31.5,-84])
 if mode=='current':render('current-courtyard',[-33,36.7,-68],[-45,34.0,-106])
