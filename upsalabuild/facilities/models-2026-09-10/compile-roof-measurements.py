"""Reproducible compile roof measurements.
See roof-reproduction.md before running: later stages overwrite derived evidence.
Preserved from the reviewed cache recipe; paths now resolve from this source file.
"""
from pathlib import Path
import json,gzip,hashlib,math
import numpy as np
from pyproj import Transformer
from shapely import Polygon,contains_xy
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[3];CACHE=ROOT/'upsalabuild/cache/facilities-2026-09-10/roof-study';CACHE.mkdir(parents=True,exist_ok=True);OUT=ROOT/'upsalabuild/facilities/models-2026-09-10';OUT.mkdir(exist_ok=True)
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
ref=ROOT/'upsalabuild/facilities/reference-2026-09-10';inv=read(ref/'building-reference-inventory.json');frame=inv['frame'];anchor=inv['anchorLocalXZ'];planes=read(CACHE/'planes.json');laser=read(ref/'lidar-roof-evidence.json')
inverse=Transformer.from_crs(3006,4326,always_xy=True)
def local(p):
 lon,lat=inverse.transform(*p[:2]);return [(lon-frame['origin']['lon'])*frame['mPerLon'],(frame['origin']['lat']-lat)*frame['mPerLat']]
def gridpix(p):return np.array([639784.96+p[0]*.16,6636460-p[1]*.16])
def px(p):return [(p[0]-639784.96)/.16,(6636460-p[1])/.16]
dtm=np.memmap(ROOT/'upsalabuild/cache/terrain-block.f32',dtype='<f4',mode='r',shape=(4785,3641))
def ground(p):
 col=p[0]-638255.5;row=6637977.5-p[1];x=int(np.floor(col));y=int(np.floor(row));dx=col-x;dy=row-y
 return float((1-dx)*(1-dy)*dtm[y,x]+dx*(1-dy)*dtm[y,x+1]+(1-dx)*dy*dtm[y+1,x]+dx*dy*dtm[y+1,x+1])
def planerecord(p):
 points=np.array(p['points']);xz=np.array([local(q) for q in points]);origin=xz.mean(axis=0);A=np.column_stack([xz[:,0]-origin[0],-(xz[:,1]-origin[1]),np.ones(len(points))]);c=np.linalg.lstsq(A,points[:,2],rcond=None)[0]
 return dict(id=p['id'],originLocalXZ=origin.tolist(),equation='heightRH2000=a*(xCourse-originX)+b*(-zCourse+originZ)+c',a=float(c[0]),b=float(c[1]),c=float(c[2]),supportCount=len(points),verticalRmseMetres=p['rmse'],pitchDegrees=p['pitchDegrees'],
  sourceLasClass=1,interpretation='Coherent laser plane manually matched to visible roof facet in 2025 orthophoto and2026 photograph; source LAS class remains unclassified.',
  inlierHullLocalXZ=[local(q) for q in Polygon(points[:,:2]).convex_hull.exterior.coords] if False else [local(q) for q in __import__('shapely').MultiPoint(points[:,:2]).convex_hull.exterior.coords],
  sourcePlaneEPSG3006=dict(origin=p['originEPSG3006'],coefficients=p['coefficients'],equation='heightRH2000=a*(E-originE)+b*(N-originN)+c'))
definitions=[('clubhouse-north-wing',[0,1],[[357,262],[309,418]],13.8),('clubhouse-west-terrace-wing',[2,3],[[189,376],[309,418]],13.6),('clubhouse-south-wing',[4,5],[[339,485],[392,566]],13.8),('clubhouse-central-raised-gable',[6,7],[[282,468],[383,418]],7.9)]
components=[];im=Image.open(CACHE/'clubhouse-plain-native.png').convert('RGB');draw=ImageDraw.Draw(im);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',14)
for index,(ident,pair,rough,width) in enumerate(definitions):
 first,second=[planes[i] for i in pair];a=np.array(first['coefficients']);b=np.array(second['coefficients']);origin=np.array(first['originEPSG3006']);delta=a-b;normal=delta[:2]/np.linalg.norm(delta[:2]);ends=[];snaps=[]
 for pixel in rough:
  q=gridpix(pixel);dist=(delta[:2]@(q-origin)+delta[2])/np.linalg.norm(delta[:2]);q=q-normal*dist;ends.append(q);snaps.append(float(abs(dist)))
 ends=np.array(ends);axis=ends[1]-ends[0];length=np.linalg.norm(axis);axis/=length
 ring=np.array([ends[0]+normal*width/2,ends[1]+normal*width/2,ends[1]-normal*width/2,ends[0]-normal*width/2]);ridge=[float(a[:2]@(p-origin)+a[2]) for p in ends]
 height=lambda q:float(min(a[:2]@(q-origin)+a[2],b[:2]@(q-origin)+b[2]))
 eaves=[height(p) for p in ring];g=[ground(p) for p in ring];localring=[local(p) for p in ring];localends=[local(p) for p in ends]
 components.append(dict(id=ident,sourceBuildingIds=['B01'],domainRoofRingLocalXZ=localring,domainRoofRingEPSG3006=ring.tolist(),domainInterpretation='Approximate roof extent rectangle from native-image eaves and ridge endpoints; intersecting roofs require union/highest-roof envelope, not overlapping closed walls.',
   ridgeAxisLocalXZ=localends,ridgeAxisEPSG3006=ends.tolist(),lengthMetres=float(length),roofWidthMetres=width,
   roofPlanes=[planerecord(first),planerecord(second)],heightFunction='Minimum of the two facet planes inside this component domain; where components overlap use the maximum roof envelope and remove internal walls.',
   ridgeHeightRH2000=ridge,eaveHeightRH2000=eaves,estimatedTerrainRH2000AtCorners=g,approximateWallHeightAboveDtmAtEaves=[e-t for e,t in zip(eaves,g)],
   manualEndpointToFittedRidgeShiftMetres=snaps,horizontalInterpretationUncertaintyMetres=.8,verticalInterpretationUncertaintyMetres=.35,roofEdgeVsWallOffsetMetres=None,
   limits=['2021 laser predates2025 ortho and2026 photograph; matching form supports interpretation, not survey-grade as-built heights.','DTM is ground reference, not finished floor; wall bottom must be reconciled with terrain/photographs.']))
 color=['#00ffff','#ffff00','#00ff88','#ff33ff'][index];draw.line([px(q) for q in ring]+[px(ring[0])],fill=color,width=2);draw.line([px(q) for q in ends],fill=color,width=4);x,y=px(ends.mean(axis=0));draw.text((x+6,y),str(index+1),font=font,fill=color,stroke_width=2,stroke_fill='black')
draw.text((5,5),'1 north / 2 west / 3 south / 4 raised crossing gable\nRidge from laser planes; rectangles approximate image roof extents',font=font,fill='white',stroke_width=2,stroke_fill='black');im.save(CACHE/'clubhouse-roof-domains.png')
dormers=[]
west=components[1]
for i,pixel in enumerate([[213,423],[248,436]],1):
 q=gridpix(pixel);xz=local(q)
 dormers.append(dict(id=f'west-terrace-dormer-{i}',centreLocalXZ=xz,centreEPSG3006=q.tolist(),sourceNativeCropPixel=pixel,widthMetres=2.7,projectionDepthMetres=1.8,estimatedPeakRiseAboveMainRoofMetres=1.1,
  orientation='Gable faces outward from west terrace wing toward southwest terrace; ridge perpendicular to parent wing.',
  confidence='Two front gable dormers directly visible in2026 drone photo; coordinates approximated from native roof protrusions; dimensions and peak rise estimated from image, not laser-separated.',horizontalUncertaintyMetres=.7,dimensionUncertaintyMetres=.6))
aux=[];aux_planes=read(CACHE/'auxiliary-planes.json')
for ident in ['B02','B04','B05','B06','B07']:
 b=next(x for x in inv['buildings'] if x['id']==ident);poly=Polygon(b['sourceRingsEPSG3006']);rect=list(poly.minimum_rotated_rectangle.exterior.coords)[:-1]
 evidence=next(x for x in aux_planes if x['id']==ident);p=evidence['planes'];roof=[]
 if len(p)>=2:
  pair=[0,2] if ident=='B04' else [0,1];first,second=[p[i] for i in pair];a=np.array(first['coefficients']);c=np.array(second['coefficients']);origin=np.array(first['originEPSG3006']);delta=a-c;normal=delta[:2]/np.linalg.norm(delta[:2]);tangent=np.array([-normal[1],normal[0]]);mid=np.array([poly.centroid.x,poly.centroid.y]);mid-=normal*((delta[:2]@(mid-origin)+delta[2])/np.linalg.norm(delta[:2]))
  vertices=np.array(rect);t=(vertices-mid)@tangent
  support=np.array(first['points']+second['points'])[:,:2];n=(support-mid)@normal
  # Roof supports exclude the uncertain outline edge; extend conservatively to
  # observed eaves without carrying a tall gable across a separate lean-to.
  nlo,nhi=float(n.min()-.65),float(n.max()+.65)
  if ident=='B04':nlo,nhi=-4.3,4.3
  if ident in ['B02','B05']:nlo,nhi=float(((vertices-mid)@normal).min()),float(((vertices-mid)@normal).max())
  ends=[mid+tangent*t.min(),mid+tangent*t.max()];ring=[ends[0]+normal*nlo,ends[1]+normal*nlo,ends[1]+normal*nhi,ends[0]+normal*nhi]
  height=lambda q:float(min(a[:2]@(q-origin)+a[2],c[:2]@(q-origin)+c[2]))
  roof.append(dict(id=ident+'-main-gable',domainRoofRingLocalXZ=[local(q) for q in ring],domainRoofRingEPSG3006=[q.tolist() for q in ring],ridgeAxisLocalXZ=[local(q) for q in ends],ridgeHeightRH2000=[height(q) for q in ends],eaveHeightRH2000=[height(q) for q in ring],
    roofPlanes=[planerecord(first),planerecord(second)],roofWidthMetres=nhi-nlo,lengthMetres=float(t.max()-t.min()),heightFunction='minimum of the two roof planes inside domain',domainInterpretation='Approximate domain from municipal outline and matched laser support; roof edges/overhang are not surveyed.',horizontalInterpretationUncertaintyMetres=.8,verticalInterpretationUncertaintyMetres=.4))
  for index in range(len(p)):
   if index in pair:continue
   pl=p[index];hull=__import__('shapely').MultiPoint(np.array(pl['points'])[:,:2]).convex_hull.buffer(.6,join_style=2)
   roof.append(dict(id=ident+'-lean-to-'+str(index+1),domainRoofRingLocalXZ=[local(q) for q in list(hull.exterior.coords)[:-1]],domainRoofRingEPSG3006=list(hull.exterior.coords)[:-1],roofPlanes=[planerecord(pl)],heightFunction='single fitted plane within the support-hull domain',domainInterpretation='Conservative support hull plus0.6m, reference approximation of attached lower roof.',horizontalInterpretationUncertaintyMetres=1.0,verticalInterpretationUncertaintyMetres=.5))
 aux.append(dict(id=ident,name=b['name'],sourceOutlineLocalXZ=b['localRing'],sourceOutlineEPSG3006=b['sourceRingsEPSG3006'],orientedRectangleLocalXZ=[local(p) for p in rect],dimensionsMetres=b['orientedBoundingRectangleMetres'],areaSquareMetres=b['areaSquareMetres'],
  roofComponents=roof,sourceInteriorPointCount=evidence['sourcePointCount'],heightStatus='Coherent roof plane estimates supported by2021 laser and visually checked2025 orthophoto; not surveyed wall/floor heights.' if roof else 'Insufficient roof returns for a stable plane; treat B07 as attached deck/porch evidence, not a separate inferred gable.',terrainRH2000AtCentroid=ground([poly.centroid.x,poly.centroid.y]),geometryMeaning=b['geometryInterpretation']))
report=dict(schemaVersion=1,id='upsala-facility-roof-measurements-2026-09-10',frame=frame,anchorLocalXZ=anchor,anchorHeightRH2000=34.968,
 scope='Interpreted architecture measurements for modelling, not surveyed reconstruction.',clubhouseComponents=components,terraceDormers=dormers,auxiliaryBuildings=aux,
 sources=[dict(path=laser['points']['path'],sha256=laser['points']['sha256'],capturePeriod=laser['source']['captureStart']+' through '+laser['source']['captureEnd']),dict(path='upsalabuild/cache/facilities-2026-09-10/facilities-campus-native.tif',sha256=sha(ROOT/'upsalabuild/cache/facilities-2026-09-10/facilities-campus-native.tif'),captureDate='2025-06-14'),dict(path='upsalabuild/cache/facilities-web-2026-09-10/june2026-drone.webp',sha256=sha(ROOT/'upsalabuild/cache/facilities-web-2026-09-10/june2026-drone.webp'))],
 reviewImages=['upsalabuild/cache/facilities-2026-09-10/roof-study/clubhouse-plane-clusters.png','upsalabuild/cache/facilities-2026-09-10/roof-study/clubhouse-roof-domains.png','upsalabuild/cache/facilities-2026-09-10/roof-study/auxiliary-plane-clusters.png'],
 fitMethod='Deterministic RANSAC within B01 buffered inward0.4m, 0.13m inlier threshold, least-squares plane refit; eight coherent planes subsequently directly matched to visible roof facets. No LAS reclassification.',
 limits=['Plane residuals measure internal fit, not survey accuracy.','Roof domain rectangles and dormer sizes are image interpretation with explicit uncertainty.','Build roof union, omit internal walls between overlapping components.','B02 has a lower23degree gabled white roof in the2021 returns; apparent white photo cover alone is not evidence of a flat roof.','B07 has only8interior returns and no stable plane; retain its deck/porch role as image interpretation rather than fabricating a second tall building.'])
(OUT/'roof-measurements.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps([dict(id=c['id'],length=c['lengthMetres'],width=c['roofWidthMetres'],ridge=c['ridgeHeightRH2000'],eaves=c['eaveHeightRH2000'],axes=c['ridgeAxisLocalXZ']) for c in components],indent=2))
