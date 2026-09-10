"""Publish bounded source-derived clubhouse architecture, with explicit estimates.

Run derive-clean-roof.py first. This report and private plots do not change the
immutable observation/TIN sources or any runtime geometry.
"""
from pathlib import Path
import hashlib,json
import numpy as np
import rasterio
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'tortunabuild/cache/clubhouse'

def save(path,value):
 path.write_bytes((json.dumps(value,indent=2,allow_nan=False)+'\n').encode('utf8'))

def identity(relative):
 raw=(ROOT/relative).read_bytes()
 return dict(path=relative,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw))

def quantiles(values):
 return dict(zip(['minimum','p05','median','p95','maximum'],np.quantile(values,[0,.05,.5,.95,1]).tolist()))

def main():
 working=json.loads((ROOT/'tortunabuild/clubhouse/roof-parameters-working.json').read_text())
 for src in working['inputs']:
  if identity(src['path'])!=src:raise ValueError('Architectural source identity changed')
 origin=np.array(working['localFrame']['originEpsg3006'])
 axes=np.array([working['localFrame']['uSoutheast'],working['localFrame']['vNortheast']]).T
 planes=working['measuredPlanes'];coeff={k:np.array(v['coefficients']) for k,v in planes.items()}
 raw=np.asarray(json.loads((ROOT/'tortunabuild/cache/buildings/laser-2021-points.json').read_text())['points'])
 uv=(raw[:,:2]-origin)@axes;u,v=uv.T;h=raw[:,2]
 nearby=(u>-19)&(u<20)&(v>-11)&(v<14)
 points=raw[nearby];uv=uv[nearby];u,v=uv.T;h=points[:,2]
 first=(points[:,3]==1)&(points[:,4]==1)
 def xyz(local):return (origin+axes@np.array(local[:2])).tolist()+[float(local[2])]
 def triple(*names):
  a,b,c=[coeff[n] for n in names]
  uvh=np.linalg.solve(np.array([[a[0],a[1],-1],[b[0],b[1],-1],[c[0],c[1],-1]]),-np.array([a[2],b[2],c[2]]))
  return dict(uvRH2000=uvh.tolist(),epsg3006RH2000=xyz(uvh),planes=list(names))
 def equal_at_u(a,b,fixed_u):
  a,b=coeff[a],coeff[b];vv=(-(a[0]-b[0])*fixed_u-(a[2]-b[2]))/(a[1]-b[1]);zz=a@np.array([fixed_u,vv,1])
  return [float(fixed_u),float(vv),float(zz)]
 def cross_at_v(vv):
  a,b=coeff['crossgable_northwest'],coeff['crossgable_southeast'];uu=(-(a[1]-b[1])*vv-(a[2]-b[2]))/(a[0]-b[0]);zz=a@np.array([uu,vv,1])
  return [float(uu),float(vv),float(zz)]
 intersections={
  'mainRidgeNorthwest':triple('upper_southwest','upper_northeast','northwest_end_upper'),
  'mainRidgeSoutheast':triple('upper_southwest','upper_northeast','southeast_end_upper'),
  'crossRidgeAtSouthwestEave':dict(uvRH2000=cross_at_v(-5.65)),
  'crossRidgeAtNortheastEave':dict(uvRH2000=cross_at_v(10.1)),
 }
 body=dict(uMin=-12.5,uMax=14.9,vMin=-5.1,vMax=9.65)
 eave=dict(uMin=-13.2,uMax=15.2,vMin=-5.65,vMax=10.1)
 edge_masks={
  'northwestWall':(u>-15)&(u<-12)&(v>-3)&(v<8)&(h>28)&(h<33.5)&(points[:,3]==1),
  'southwestLowEave':(u>-13)&(u<15)&(v>-6.5)&(v<-4.5)&(h>31.6)&(h<32)&(points[:,3]==1),
  'northeastLowEave':(u>-13)&(u<15)&(v>9.5)&(v<11)&(h>31.6)&(h<32)&(points[:,3]==1),
  'southwestWallLowerReturns':(abs(u)>6)&(abs(u)<12)&(v>-5.5)&(v<-4.5)&(h>28)&(h<28.5)&(points[:,3]==1),
 }
 edge_evidence={name:dict(count=int(m.sum()),u=quantiles(u[m]),v=quantiles(v[m]),heightRH2000=quantiles(h[m]),returnsUVRH2000=np.column_stack((u[m],v[m],h[m])).tolist()) for name,m in edge_masks.items()}
 crosssw=first&(u>-4.5)&(u<6)&(v>-10)&(v<-5.4)&(h>33.4)&(h<35.8)
 crossne=first&(u>-4.5)&(u<6)&(v>9.7)&(v<14)&(h>33.4)&(h<35.8)
 ground=(points[:,3]==2)&(((u<-14)&(u>-18))|((v<-6.5)&(v>-9)))
 # Image cross-ridge pixel was manually read from the native 800px source.
 # Pixel-edge coordinates, uncertainty +/-2 pixels (0.32m), not a survey tie.
 image_cross_pixel=[354,398]
 image_cross=np.array([597406.72+354*.16,6615139.52-398*.16])
 ridgeline=equal_at_u('upper_southwest','upper_northeast',.907)
 measured_cross=np.array(xyz(ridgeline)[:2])
 shift=measured_cross-image_cross
 input_ids=working['inputs']+[identity('tortunabuild/clubhouse/roof-parameters-working.json'),identity('tortunabuild/mapping/building-observations.json')]
 result=dict(schemaVersion=1,groundId='tortuna',buildingId='way/1163533127',
  state='source-derived-architectural-parameters-with-explicit-wall-estimates',
  sourceEpoch=working['sourceEpoch'],imageEpoch=working['imageEpoch'],horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613',
  localFrame=working['localFrame'],inputs=input_ids,
  method=dict(roofPlanes='Deterministic robust fits of spatially isolated original class 1 first returns. Threshold 0.12m; coefficient sign/orientation checks reject adjacent faces. No point coordinate is smoothed or moved.',
   faceSelection='Upper side wings exclude the central crossroof. Crossroof candidates stand above the ordinary upper side faces. Short-end hips lie below those faces. Steep lower faces use isolated edge zones.',
   reproducibleCommands=['python tortunabuild/clubhouse/derive-clean-roof.py','python tortunabuild/clubhouse/finalize-geometry-evidence.py'],
   scripts=[dict(path=p,sha256LfNormalized=hashlib.sha256((ROOT/p).read_bytes().replace(b'\r\n',b'\n')).hexdigest()) for p in ['tortunabuild/clubhouse/derive-clean-roof.py','tortunabuild/clubhouse/finalize-geometry-evidence.py']]),
  measuredPlanes=planes,measuredIntersections=intersections,
  mainRoof=dict(topology='Broken-pitch long side slopes, approximately 29-degree short-end hips, central crossgable spanning both long facades.',
   surfaceConstruction='Ordinary roof is the lower envelope of the four side faces and two short-end hip planes, clipped to the eave bounds. Central crossroof replaces the ordinary roof where it rises above it; vertical gable/cheek walls close the raised perimeter.',
   crossGableRidgeAtV0=cross_at_v(0),
   breakLinesAtU0=dict(southwest=equal_at_u('upper_southwest','lower_southwest',0),northeast=equal_at_u('upper_northeast','lower_northeast',0)),
   breakLinesAtWingU=[dict(u=uu,southwest=equal_at_u('upper_southwest','lower_southwest',uu),northeast=equal_at_u('upper_northeast','lower_northeast',uu)) for uu in [-10,10]],
   eaveBoundsUV=eave,eaveBoundsStatus='Source-section edge estimate; not an exact surveyed outline',eaveHorizontalUncertaintyMetres=.4,
   ordinaryLowEaveRH2000=dict(southwest=31.74,northeast=31.87,uncertaintyMetres=.2),
   shortEndUpperEaveRH2000=dict(northwest=float(coeff['northwest_end_upper']@np.array([eave['uMin'],2.25,1])),southeast=float(coeff['southeast_end_upper']@np.array([eave['uMax'],2.25,1])),uncertaintyMetres=.3),
   crossGableWidthEstimate=dict(uMin=-4.2,uMax=5.8,status='Display estimate from measured slopes at RH 33.75 plus visible three-window facade; not a surveyed wall width',uncertaintyMetres=.6),
   crossRoofProjectionEvidence=dict(southwestSupportCount=int(crosssw.sum()),southwestMinimumV=float(v[crosssw].min()),northeastSupportCount=int(crossne.sum()),northeastMaximumV=float(v[crossne].max()),
    conclusion='The 2021 high crossroof returns stop near the ordinary long-side eaves. A 2m additional full-height southwest extension is not supported by this laser sample; later photo-only interpretations must remain separate.')),
  wallBodyEstimate=dict(boundsUV=body,lengthMetres=27.4,widthMetres=14.75,areaSquareMetres=27.4*14.75,
   status='Measured NW facade and SW lower returns support these bounds; other wall edges are conservative display estimates inside roof overhang.',
   horizontalUncertaintyMetres=dict(northwest=.35,southeast=.7,southwest=.4,northeast=.6),
   ordinaryWallTopRH2000=dict(southwest=31.65,northeast=31.75,uncertaintyMetres=.3),
   groundReferenceRH2000=27.1,groundReferenceStatus='Display datum from surrounding classified ground; foundation floor elevation is not measured',
   courtyardGroundSample=dict(count=int(ground.sum()),heightRH2000=quantiles(h[ground])),
   note='Raised crossgable facades and short end upper walls extend above the ordinary long-side wall top. The immutable OSM quad is retained separately and is not overwritten.'),
  edgeEvidence=edge_evidence,
  orthoLaserAlignment=dict(nativePixelCrossRidge=image_cross_pixel,nativePixelEdgeTransform='E=597406.72+0.16x;N=6615139.52-0.16y',
   imageCrossRidgeEpsg3006=image_cross.tolist(),imageTraceUncertaintyMetres=.32,measuredCrossRidgeEpsg3006=measured_cross.tolist(),
   imageToLaserDisplacementMetresEN=shift.tolist(),displacementMagnitudeMetres=float(np.linalg.norm(shift)),
   interpretation='Approximately 2.6m source-to-source roof displacement is visible at the central ridge. Relief displacement in the ground-orthorectified photo is plausible; camera geometry was not independently recovered, so its cause is not asserted. Neither the earlier image outline nor OSM quad is a surveyed wall boundary.',
   consequence='Use laser EPSG coordinates for the clean roof. Use ortho and photographs for topology/appearance; do not translate immutable original source geometry.',
   oldImageRoofAreaSquareMetres=398.554,proposedMainEaveEnvelopeAreaSquareMetres=28.4*15.75,
   areaExplanation='The earlier polygon contains an irregular image silhouette. Its area, an architectural wall rectangle, and a laser-aligned eave envelope describe different surfaces; they are not interchangeable.'),
  limitations=['2021 laser sampling cannot establish later structural changes. Photos uploaded in 2023 and 2026 ortho show the same broad broken roof/crossgable topology.',
   'Nine returns support the NE steep face; its exact slope and breakline carry more uncertainty than the densely supported upper planes.',
   'Dormers, chimneys, gutter profiles, eave thicknesses, wall setbacks and terrace details require image-based estimates. Their sparse outlying laser returns are not main roof faces.',
   'Planar fit residuals quantify agreement within selected returns, not absolute roof accuracy or current structure certification.'])
 save(ROOT/'tortunabuild/clubhouse/geometry-evidence.json',result)
 OUT.mkdir(parents=True,exist_ok=True)
 with rasterio.open(ROOT/'tortunabuild/cache/orthophoto/crops/clubhouse.tif') as src:
  image=src.read([1,2,3]).transpose(1,2,0);bounds=src.bounds
 fig,axs=plt.subplots(1,2,figsize=(14,8),layout='constrained')
 for ax in axs:
  ax.imshow(image,extent=[bounds.left,bounds.right,bounds.bottom,bounds.top]);ax.set_xlim(597445,597487);ax.set_ylim(6615057,6615098);ax.set_aspect('equal');ax.ticklabel_format(useOffset=False,style='plain');ax.tick_params(labelsize=7)
 def rectangle(bb):return np.array([[bb['uMin'],bb['vMin']],[bb['uMax'],bb['vMin']],[bb['uMax'],bb['vMax']],[bb['uMin'],bb['vMax']],[bb['uMin'],bb['vMin']]])@axes.T+origin
 rooflike=first&(u>-14)&(u<16)&(v>-6.5)&(v<11)&(h>31.6)&(h<35.8)
 axs[0].scatter(points[rooflike,0],points[rooflike,1],s=5,c=h[rooflike],cmap='plasma',alpha=.7)
 for bb,name,color in [(body,'Estimated wall rectangle','lime'),(eave,'Laser-aligned eave estimate','cyan')]:
  poly=rectangle(bb);axs[0].plot(poly[:,0],poly[:,1],color=color,label=name,lw=1.3)
 old=json.loads((ROOT/'tortunabuild/mapping/building-observations.json').read_text())['buildings'][0]['observedRoofGeometryEpsg3006']['coordinates'][0]
 old=np.array(old);axs[0].plot(old[:,0],old[:,1],color='red',label='Earlier image roof trace',lw=1)
 axs[0].legend(fontsize=7);axs[0].set_title('Independent laserXY vs native image; no source translation')
 axs[1].scatter(*image_cross,color='red',s=50,label='Image cross ridge ±0.32m')
 axs[1].scatter(*measured_cross,color='cyan',s=50,label='Measured plane intersection')
 axs[1].annotate('',xy=measured_cross,xytext=image_cross,arrowprops=dict(arrowstyle='->',color='yellow',lw=2))
 for name,plane in planes.items():
  source=np.load(OUT/f'{name}-fit.npz',allow_pickle=True)['uvw'];support=source[plane['supportIndices']];xy=support[:,:2]@axes.T+origin
  axs[1].scatter(xy[:,0],xy[:,1],s=8,label=f'{name} ({len(support)})')
 axs[1].legend(fontsize=6,loc='upper right');axs[1].set_title('Spatially isolated clean plane support')
 fig.savefig(OUT/'clean-roof-source-alignment.png',dpi=170);plt.close(fig)
 print(json.dumps(dict(output='tortunabuild/clubhouse/geometry-evidence.json',sha256=identity('tortunabuild/clubhouse/geometry-evidence.json')['sha256'],body=body,eave=eave,intersections=intersections,alignment=result['orthoLaserAlignment']['imageToLaserDisplacementMetresEN']),indent=2))

if __name__=='__main__':main()
