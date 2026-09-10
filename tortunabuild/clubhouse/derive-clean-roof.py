"""Fit spatially isolated architectural roof planes from original 2021 returns.

Working architectural parameters remain explicitly distinct from measurements.
No source raster, source mesh, runtime file or Blender scene is modified.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from shapely.geometry import Polygon
from shapely import contains_xy

ROOT=Path(__file__).resolve().parents[2]
PINS={
 'tortunabuild/cache/buildings/laser-2021-points.json':'ff07c4e622e8c5ddfb26472d0407f67e7c6c14687e9af93c916df51f9c79ea00',
 'tortunabuild/cache/terrain/terrain-1m.f32':'86f30a75f398cfa2da8c32b833b859c575a9056910b237ac2539fdbba3c02ef1',
 'tortunabuild/cache/orthophoto/crops/clubhouse.tif':'1ce087d73b92e7c31f4bbf47bcc1ec2f4667055d7adb798d154ccdba29448c98',
}
ORIGIN=np.asarray([597463.6991434265,6615075.173127487])
U=np.asarray([.7304403538581326,-.6829764926083519])
V=np.asarray([.6829764926083519,.7304403538581326])

def q(values):
 values=np.asarray(values);values=values[np.isfinite(values)]
 return dict(count=len(values),**dict(zip(['minimum','p05','median','p95','maximum'],[round(float(v),4) for v in np.quantile(values,[0,.05,.5,.95,1])]))) if len(values) else dict(count=0)

def fit(uvw,threshold=.12,coefficient_filter=None):
 rng=np.random.default_rng(1163533127)
 design=np.column_stack((uvw[:,:2],np.ones(len(uvw))))
 best=np.zeros(len(uvw),dtype=bool)
 if len(uvw)<8:return None
 for _ in range(2000):
  ids=rng.choice(len(uvw),3,replace=False);a=design[ids]
  if abs(np.linalg.det(a))<.03:continue
  coeff=np.linalg.solve(a,uvw[ids,2])
  if np.linalg.norm(coeff[:2])>6:continue
  if coefficient_filter and not coefficient_filter(coeff):continue
  keep=np.abs(design@coeff-uvw[:,2])<=threshold
  if keep.sum()>best.sum():best=keep
 if best.sum()<8:return None
 for _ in range(3):
  coeff=np.linalg.lstsq(design[best],uvw[best,2],rcond=None)[0]
  if coefficient_filter and not coefficient_filter(coeff):return None
  best=np.abs(design@coeff-uvw[:,2])<=threshold
 residual=np.abs(design[best]@coeff-uvw[best,2]);support=uvw[best]
 return dict(equation='RH2000=a*u+b*v+c',coefficients=coeff.tolist(),selectedReturns=len(uvw),inlierReturns=int(best.sum()),
  sourceResidualMetres=q(residual),slopeDegrees=float(np.degrees(np.arctan(np.linalg.norm(coeff[:2])))),
  supportingBoundsUV=dict(uMin=float(support[:,0].min()),uMax=float(support[:,0].max()),vMin=float(support[:,1].min()),vMax=float(support[:,1].max())),
  sourceHeightRH2000=q(support[:,2]),supportIndices=np.flatnonzero(best).tolist())

def main():
 inputs=[]
 for relative,pin in PINS.items():
  raw=(ROOT/relative).read_bytes();sha=hashlib.sha256(raw).hexdigest()
  if sha!=pin:raise ValueError('Pinned architectural source changed')
  inputs.append(dict(path=relative,sha256=sha,bytes=len(raw)))
 all_points=np.asarray(json.loads((ROOT/'tortunabuild/cache/buildings/laser-2021-points.json').read_text())['points'])
 uv=(all_points[:,:2]-ORIGIN)@np.column_stack((U,V))
 nearby=(np.abs(uv[:,0])<19)&(uv[:,1]>-10)&(uv[:,1]<14)
 points=all_points[nearby];uv=uv[nearby]
 first=(points[:,3]==1)&(points[:,4]==1)
 u,v=uv.T;h=points[:,2]
 wings=(np.abs(u)>6)&(np.abs(u)<13)
 zones={
  'upper_southwest':first&wings&(v>-4.4)&(v<2.0)&(h>33.3)&(h<35.7),
  'upper_northeast':first&wings&(v>2.8)&(v<9.0)&(h>33.3)&(h<35.7),
  'crossgable_northwest':first&(u>-5)&(u<.3)&(v>-6)&(v<10.5)&(h>33)&(h<35.7)&(h>np.minimum(.26568*v+34.8392,-.26925*v+36.0443)+.18),
  'crossgable_southeast':first&(u>1.4)&(u<6)&(v>-6)&(v<10.5)&(h>33)&(h<35.7)&(h>np.minimum(.26568*v+34.8392,-.26925*v+36.0443)+.18),
  'lower_southwest':first&wings&(v>-6.2)&(v<-4)&(h>31)&(h<33.9),
  'lower_northeast':first&wings&(v>8.9)&(v<11)&(h>31)&(h<33.7),
  'northwest_end_upper':first&(u>-16)&(u<-9)&(v>-3)&(v<8)&(h>33)&(h<35.7)&(h<np.minimum(.26568*v+34.8392,-.26925*v+36.0443)-.15),
  'southeast_end_upper':first&(u>11)&(u<16)&(v>-3)&(v<8)&(h>33)&(h<35.7)&(h<np.minimum(.26568*v+34.8392,-.26925*v+36.0443)-.15),
 }
 filters={
  'crossgable_northwest':lambda c:c[0]>.2 and abs(c[1])<.06,
  'crossgable_southeast':lambda c:c[0]<-.2 and abs(c[1])<.06,
  'lower_northeast':lambda c:c[1]<-.7 and abs(c[0])<.15,
  'northwest_end_upper':lambda c:c[0]>.3 and abs(c[1])<.08,
  'southeast_end_upper':lambda c:c[0]<-.3 and abs(c[1])<.08,
 }
 fits={name:fit(np.column_stack((uv[mask],h[mask])),coefficient_filter=filters.get(name)) for name,mask in zones.items()}
 for name,mask in zones.items():
  (ROOT/'tortunabuild/cache/clubhouse').mkdir(parents=True,exist_ok=True)
  np.savez(ROOT/f'tortunabuild/cache/clubhouse/{name}-fit.npz',uvw=np.column_stack((uv[mask],h[mask])),fit=fits[name])
 rooflike=first&(np.abs(u)<16)&(v>-6)&(v<11)&(h>33.3)&(h<35.7)
 old=json.loads((ROOT/'tortunabuild/mapping/building-observations.json').read_text())['buildings'][0]
 oldpoly=Polygon(old['observedRoofGeometryEpsg3006']['coordinates'][0])
 outside=rooflike&~contains_xy(oldpoly,points[:,0],points[:,1])
 working=dict(schemaVersion=1,groundId='tortuna',buildingId='way/1163533127',state='working-source-roof-parameters',
  inputs=inputs,sourceEpoch='2021-04-05T12:00:00Z',imageEpoch='2026-05-02',horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613',
  localFrame=dict(originEpsg3006=ORIGIN.tolist(),uSoutheast=U.tolist(),vNortheast=V.tolist(),uBearingDegrees=133.07667681792472,
   transform='E,N=origin+u*uSoutheast+v*vNortheast; height remains absolute RH2000'),
  measuredPlanes=fits,
  sourceCoverage=dict(nearbyPoints=len(points),upperRoofLikeFirstReturns=int(rooflike.sum()),roofLikeReturnsOutsideEarlierImageOutline=int(outside.sum()),
    explanation='Earlier image-clipped mesh discarded these source returns; image roof silhouette and source laser XY are not interchangeable.'),
  workingDisplayEstimates=dict(status='display estimate; see geometry-evidence.json for final edge evidence and uncertainties',
   bodyBoundsUV=dict(uMin=-12.5,uMax=14.9,vMin=-5.1,vMax=9.65),
   ordinaryWallTopRH2000=31.7,roofBreakHeightRH2000=33.6,mainRidgeRH2000=35.44,
   groundReferenceRH2000=27.1,bodyDimensionUncertaintyMetres=.7,eaveHeightUncertaintyMetres=.3,
   warning='Bounds are initial source-section estimates, not surveyed wall dimensions. Mansard skirts and cross-gabled raised wall require separate construction.'),
  limitations=['Class1 source returns are unclassified; fitted zones are explicitly spatial and reviewed against images.',
   'Image roof displacement is assessed against independent laserXY; original OSM ground footprint remains unchanged.',
   'No arbitrary mesh smoothing is performed. Plane residuals express measured support, not current-year architectural certainty.',
   'Steep skirts, eaves and wall positions have sparser sampling than the upper roof; unsupported details remain estimates.'])
 (ROOT/'tortunabuild/clubhouse/roof-parameters-working.json').write_bytes((json.dumps(working,indent=2,allow_nan=False)+'\n').encode())
 print(json.dumps({name:None if p is None else {k:p[k] for k in ['coefficients','inlierReturns','slopeDegrees','sourceResidualMetres','supportingBoundsUV']} for name,p in fits.items()},indent=2))

if __name__=='__main__':main()
