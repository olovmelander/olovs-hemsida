"""Exact EPSG:3006 -> legacy app frame conversion for every exported vertex."""
import json
from pathlib import Path
import sys
import numpy as np
from pyproj import Transformer

source, target = map(Path, sys.argv[1:3])
payload = json.loads(source.read_text(encoding='utf-8'))
points = np.array(payload['vertices'], dtype=np.float64)
assert points.ndim == 2 and points.shape[1] == 3 and np.isfinite(points).all()
e, n = points[:,0]+605530, points[:,1]+6605140
inverse = Transformer.from_crs(3006,4326,always_xy=True)
lon, lat = inverse.transform(e,n)
x, z = (lon-16.871)*56375.41, (59.5739-lat)*111320
converted = np.c_[x,-z,points[:,2]+8]
assert np.isfinite(converted).all()
# Export scene is Blender Z-up; native glTF converts (X,Y,Z) -> (X,Z,-Y).
result = {'vertices':np.round(converted,7).tolist(),
          'contract':'Export Blender=(legacyX,-legacyZ,RH2000); glTF=(legacyX,RH2000,legacyZ)',
          'count':len(points)}
surface_rings={}
for fid,rings in payload.get('groundSurfaceRingsBlenderXY',{}).items():
    surface_rings[fid]=[]
    for ring in rings:
        xy=np.asarray(ring,dtype=np.float64)
        assert xy.ndim==2 and xy.shape[1]==2 and len(xy)>=3 and np.isfinite(xy).all()
        lon,lat=inverse.transform(xy[:,0]+605530,xy[:,1]+6605140)
        surface_rings[fid].append(np.round(np.c_[(lon-16.871)*56375.41,(59.5739-lat)*111320],7).tolist())
result['groundSurfaceRingsLocal']=surface_rings
target.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
print(json.dumps({'projectedVertices':len(points),'horizontalProjection':'EPSG3006 to WGS84 via PROJ; exact legacy equations'}))
