"""Sample the native DTM for Blender review only; never export terrain in assets."""
import json
from pathlib import Path
import numpy as np
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[2]
plan=json.loads((ROOT/'upsalabuild/facilities/models-2026-09-10/model-plan.json').read_text())
frame=plan['frame'];ax,az=plan['anchorLocalXZ'];ah=plan['anchorHeightRH2000']
grid=np.memmap(ROOT/'upsalabuild/cache/terrain-block.f32',dtype='<f4',mode='r',shape=(4785,3641))
project=Transformer.from_crs(4326,3006,always_xy=True)
xs=np.arange(-170,211,2.);zs=np.arange(-430,-149,2.);x,z=np.meshgrid(xs,zs)
e,n=project.transform(frame['origin']['lon']+x/frame['mPerLon'],frame['origin']['lat']-z/frame['mPerLat'])
col=e-638255.5;row=6637977.5-n;ix=np.floor(col).astype(int);iy=np.floor(row).astype(int);fx=col-ix;fy=row-iy
h=(1-fx)*(1-fy)*grid[iy,ix]+fx*(1-fy)*grid[iy,ix+1]+(1-fx)*fy*grid[iy+1,ix]+fx*fy*grid[iy+1,ix+1]
vs=np.stack([x-ax,az-z,h-ah],axis=-1).reshape(-1,3).round(4).tolist();faces=[]
for r in range(len(zs)-1):
    for c in range(len(xs)-1):
        k=r*len(xs)+c;faces.append([k,k+len(xs),k+len(xs)+1,k+1])
path=ROOT/'upsalabuild/cache/facilities-2026-09-10/model-preview-terrain.json'
path.write_text(json.dumps({'vertices':vs,'faces':faces},separators=(',',':'))+'\n')
print(path)
