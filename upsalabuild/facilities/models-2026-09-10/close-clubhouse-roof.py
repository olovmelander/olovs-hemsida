"""Close image-domain gaps with explicit laser-fit or nearest-roof evidence."""
from pathlib import Path
import gzip,json,hashlib,math
import numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import contains_xy
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).parent;path=HERE/'roof-measurements.json'
doc=json.loads(path.read_text());base=doc['clubhouseComponents'][:4]
inv=json.loads((ROOT/'upsalabuild/facilities/reference-2026-09-10/building-reference-inventory.json').read_text());building=next(v for v in inv['buildings'] if v['id']=='B01')
laser=json.loads((ROOT/'upsalabuild/facilities/reference-2026-09-10/lidar-roof-evidence.json').read_text())
with gzip.open(ROOT/laser['points']['path'],'rt') as stream:points=np.loadtxt(stream,delimiter=',',skiprows=1)
forward=Transformer.from_crs(4326,3006,always_xy=True);inverse=Transformer.from_crs(3006,4326,always_xy=True);frame=doc['frame']
lon,lat=inverse.transform(points[:,0],points[:,1]);x=(lon-frame['origin']['lon'])*frame['mPerLon'];z=(frame['origin']['lat']-lat)*frame['mPerLat']
def grid(q):return list(forward.transform(frame['origin']['lon']+q[0]/frame['mPerLon'],frame['origin']['lat']-q[1]/frame['mPerLat']))
def h(p,q):
 ox,oz=p['originLocalXZ'];return p['a']*(q[0]-ox)+p['b']*(-q[1]+oz)+p['c']
domain=unary_union([Polygon(c['domainRoofRingLocalXZ']) for c in base]);remaining=Polygon(building['localRing']).difference(domain)
parts=[remaining] if remaining.geom_type=='Polygon' else list(remaining.geoms);additions=[]
for index,part in enumerate(parts):
 if part.area<1e-8:continue
 ring=[list(q) for q in list(part.exterior.coords)[:-1]];centroid=[part.centroid.x,part.centroid.y];keep=contains_xy(part,x,z)&(points[:,3]==1);count=int(keep.sum())
 if part.area>20:
  ident='clubhouse-northwest-alcove-low-roof';material='dark low-slope membrane';kind='low-roof-plane-fit'
 elif part.area>10:
  ident='clubhouse-central-junction-connector';material='warm roof tile';kind='approximate junction patch fitted to mixed local roof returns'
 else:
  ident=f'clubhouse-outline-edge-continuation-{index+1}';material='warm roof tile';kind='nearest adjoining roof continuation'
 if part.area>10:
  A=np.column_stack([x[keep]-centroid[0],-(z[keep]-centroid[1]),np.ones(count)]);c=np.linalg.lstsq(A,points[keep,2],rcond=None)[0];res=A@c-points[keep,2];rmse=float(np.sqrt(np.mean(res**2)))
  plane=dict(id=ident+'-plane',originLocalXZ=centroid,equation='heightRH2000=a*(xCourse-originX)+b*(-zCourse+originZ)+c',a=float(c[0]),b=float(c[1]),c=float(c[2]),supportCount=count,verticalRmseMetres=rmse,
   pitchDegrees=math.degrees(math.atan(np.linalg.norm(c[:2]))),sourceLasClass=1,interpretation=kind,
   residualMinimumMetres=float(res.min()),residualMaximumMetres=float(res.max()),sourceObservedHeightRH2000Range=[float(points[keep,2].min()),float(points[keep,2].max())])
  roof_planes=[plane];uncertainty=.5 if part.area<20 else .3
 else:
  nearest=min(base,key=lambda c:Polygon(c['domainRoofRingLocalXZ']).distance(part.representative_point()))
  roof_planes=nearest['roofPlanes'];rmse=None;uncertainty=.5
 additions.append(dict(id=ident,sourceBuildingIds=['B01'],domainRoofRingLocalXZ=ring,domainRoofRingEPSG3006=[grid(q) for q in ring],roofPlanes=roof_planes,
  domainInterpretation='Exact municipal B01 area outside the four manually interpreted main roof rectangles; explicitly added closure evidence, not a hidden structural assumption.',
  closureMethod=kind,materialHint=material,roofMaterial='dark-metal' if part.area>20 else 'tile',heightFunction='single fitted plane' if len(roof_planes)==1 else 'minimum of the adjoining two roof planes',
  closureEvidence=dict(areaSquareMetres=part.area,sourceInteriorUnclassifiedReturns=count,fitVerticalRmseMetres=rmse,sourceLaserSha256=laser['points']['sha256'],
   nativeImageObservation='Small dark low roof north of west wing' if part.area>20 else ('Tiled connector at the roof junction; mixed-return low-slope fit approximates its unresolved local facet structure' if part.area>10 else 'Small plan-edge remainder adjacent to the established roof')),
  horizontalInterpretationUncertaintyMetres=.8,verticalInterpretationUncertaintyMetres=uncertainty,
  limits=['No finished floor or hidden roof structure established.','The central junction is an approximate patch (RMS0.29m), unlike the stronger main eight roof-plane fits.'] if part.area>10 and part.area<20 else ['Plan edge convention and overhang remain uncertain.']))
doc['clubhouseComponents']=base+additions
closed=unary_union([Polygon(c['domainRoofRingLocalXZ']) for c in doc['clubhouseComponents']]);gap=Polygon(building['localRing']).difference(closed).area;assert gap<1e-7
doc['closureValidation']=dict(originalMissingMunicipalAreaSquareMetres=remaining.area,addedParts=len(additions),remainingMissingMunicipalAreaSquareMetres=gap,
 explicitQualityDistinction='Northwest low roof:39points/RMS0.058m. Central junction:24points/RMS0.290m approximate closure; local facet topology is not fully resolved.')
aux_validation=[]
for auxiliary in doc['auxiliaryBuildings']:
 base_aux=[c for c in auxiliary.get('roofComponents',[]) if 'closureMethod' not in c]
 if not base_aux:continue
 outline=Polygon(auxiliary['sourceOutlineLocalXZ']);covered=unary_union([Polygon(c['domainRoofRingLocalXZ']) for c in base_aux]);missing=outline.difference(covered)
 parts_aux=[missing] if missing.geom_type=='Polygon' else list(missing.geoms);extra=[]
 for i,part in enumerate(parts_aux):
  if part.area<1e-8:continue
  q=part.representative_point();position=[q.x,q.y];keep=contains_xy(part,x,z)&(points[:,3]==1);n=int(keep.sum())
  def score(c):
   if n>=3:
    predicted=np.array([min(h(p,[xx,zz]) for p in c['roofPlanes']) for xx,zz in zip(x[keep],z[keep])])
    return float(np.median(abs(predicted-points[keep,2])))
   return Polygon(c['domainRoofRingLocalXZ']).distance(q)
  parent=min(base_aux,key=score);ring=[list(p) for p in list(part.exterior.coords)[:-1]]
  extra.append(dict(id=f'{auxiliary["id"]}-outline-roof-continuation-{i+1}',domainRoofRingLocalXZ=ring,domainRoofRingEPSG3006=[grid(p) for p in ring],roofPlanes=parent['roofPlanes'],
    closureMethod='Extend the best-supported adjoining roof function to its uncovered municipal outline; no new plane is invented.',parentRoofComponent=parent['id'],
    sourceInteriorUnclassifiedReturns=n,selectionMetric='median point-height residual in metres' if n>=3 else 'nearest adjoining domain in metres',selectionValue=score(parent),
    domainInterpretation='Explicit footprint-minus-roof closure; source plan outline and roof edge convention remain uncertain.',horizontalInterpretationUncertaintyMetres=.8,verticalInterpretationUncertaintyMetres=.5))
 auxiliary['roofComponents']=base_aux+extra
 new_union=unary_union([Polygon(c['domainRoofRingLocalXZ']) for c in auxiliary['roofComponents']]);remaining_aux=outline.difference(new_union).area;assert remaining_aux<1e-7
 aux_validation.append(dict(id=auxiliary['id'],originalMissingOutlineAreaSquareMetres=missing.area,addedParts=len(extra),remainingMissingOutlineAreaSquareMetres=remaining_aux,
   closures=[dict(id=c['id'],parent=c['parentRoofComponent'],area=Polygon(c['domainRoofRingLocalXZ']).area,points=c['sourceInteriorUnclassifiedReturns'],selectionValue=c['selectionValue']) for c in extra]))
doc['auxiliaryClosureValidation']=aux_validation
path.write_text(json.dumps(doc,indent=2)+'\n')
print(json.dumps(dict(validation=doc['closureValidation'],auxiliary=aux_validation),indent=2))
