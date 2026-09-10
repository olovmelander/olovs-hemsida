"""Derive a bounded architectural facility group from retained source data.

Only files beneath tortunabuild/facilities are written. Ground footprints, point
clouds, imagery, terrain, course models and runtime assets are never modified.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from shapely.geometry import Polygon,Point,shape
from shapely import contains_xy
import rasterio
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'tortunabuild/facilities'
PRIVATE=OUT/'private-review'
PINS={
 'tortunabuild/cache/buildings/laser-2021-points.json':'ff07c4e622e8c5ddfb26472d0407f67e7c6c14687e9af93c916df51f9c79ea00',
 'tortunabuild/cache/terrain/terrain-1m.f32':'86f30a75f398cfa2da8c32b833b859c575a9056910b237ac2539fdbba3c02ef1',
 'tortunabuild/mapping/building-observations.json':'09476c14e7bc95deb3d7276f20cf6938776b153094fdc9c9f2e4f03ab81108a6',
 'tortunabuild/mapping/building-height-evidence.json':'145dd1e3b7f424519d6244029ba1380b2801e9573a0510b7c674567b1706a292',
}
SELECTED={
 'way/1163533128':('entry-outbuilding','gable',None),
 'tortuna-range-shelter':('range-shelter','shed',None),
 'way/1163533113':('service-yard-long-barn','gable',None),
 'way/1163533114':('service-yard-small-outbuilding','gable',None),
 'way/1163533115':('service-yard-west-barn','gable',None),
 'way/1163533123':('carpark-west-barn','gable',None),
 'way/1163607303':('nearby-house','cross_gable',[0,2]),
}

def read(relative):return json.loads((ROOT/relative).read_text(encoding='utf8'))
def save(path,value):path.write_bytes((json.dumps(value,indent=2,allow_nan=False)+'\n').encode('utf8'))
def identity(relative):
 raw=(ROOT/relative).read_bytes();return dict(path=relative,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw))
def q(a):
 a=np.asarray(a);a=a[np.isfinite(a)]
 return dict(count=len(a),**dict(zip(['minimum','p05','median','p95','maximum'],np.quantile(a,[0,.05,.5,.95,1]).tolist()))) if len(a) else dict(count=0)
def bounds(a):return dict(uMin=float(a[:,0].min()),uMax=float(a[:,0].max()),vMin=float(a[:,1].min()),vMax=float(a[:,1].max()))
def box_ring(b):return np.asarray([[b['uMin'],b['vMin']],[b['uMax'],b['vMin']],[b['uMax'],b['vMax']],[b['uMin'],b['vMax']],[b['uMin'],b['vMin']]])
def height(terrain,xy):
 col=(xy[:,0]-595352.5);row=(6616947.5-xy[:,1]);cc=np.floor(col).astype(int);rr=np.floor(row).astype(int);fx=col-cc;fy=row-rr
 return terrain[rr,cc]*(1-fx)*(1-fy)+terrain[rr,cc+1]*fx*(1-fy)+terrain[rr+1,cc]*(1-fx)*fy+terrain[rr+1,cc+1]*fx*fy

def main():
 OUT.mkdir(parents=True,exist_ok=True);PRIVATE.mkdir(exist_ok=True)
 inputs=[]
 for relative,pin in PINS.items():
  src=identity(relative)
  if src['sha256']!=pin:raise ValueError('Retained source identity changed: '+relative)
  inputs.append(src)
 obs=read('tortunabuild/mapping/building-observations.json')['buildings']
 evidence={b['id']:b for b in read('tortunabuild/mapping/building-height-evidence.json')['buildings']}
 all_points=np.asarray(read('tortunabuild/cache/buildings/laser-2021-points.json')['points'])
 terrain=np.memmap(ROOT/'tortunabuild/cache/terrain/terrain-1m.f32',dtype='<f4',mode='r',shape=(4097,4097))
 buildings=[];parameters=[];backlog=[]
 for ob in obs:
  bid=ob['associatedBuildingId']
  if bid not in SELECTED:
   if bid is None:backlog.append(dict(observationId=ob['id'],reason='Observed small hut has no retained runtime source building ID; no model may be hidden inside a neighboring building asset.',observedRoofGeometryEpsg3006=ob['observedRoofGeometryEpsg3006'],sourceGrid=ob['sourceGrid'],observedAppearance=ob['observedAppearance']))
   continue
  image_identity=identity(ob['sourceGrid']['path'])
  if image_identity['sha256']!=ob['sourceGrid']['sha256']:raise ValueError('Retained native image identity changed')
  if not any(x['path']==image_identity['path'] for x in inputs):inputs.append(image_identity)
  label,roof_type,pair_override=SELECTED[bid];old=evidence[ob['id']];old_planes=old['planes'];poly=shape(ob['observedRoofGeometryEpsg3006']);origin=np.array(poly.centroid.coords[0])
  if len(old_planes)>1:
   pair=pair_override or [0,1];gradient=np.array(old_planes[pair[0]]['coefficients'][:2])-np.array(old_planes[pair[1]]['coefficients'][:2]);vv=gradient/np.linalg.norm(gradient);uu=np.array([vv[1],-vv[0]])
   if uu[0]<0:uu=-uu;vv=-vv
  else:
   rect=np.array(poly.minimum_rotated_rectangle.exterior.coords);edges=np.diff(rect,axis=0);uu=edges[np.argmax(np.linalg.norm(edges,axis=1))];uu/=np.linalg.norm(uu)
   if uu[0]<0:uu=-uu
   vv=np.array([-uu[1],uu[0]]);pair=None
  axes=np.column_stack((uu,vv));image_uv=(np.array(poly.exterior.coords)-origin)@axes
  bxy=poly.buffer(5).bounds;near=(all_points[:,0]>bxy[0])&(all_points[:,0]<bxy[2])&(all_points[:,1]>bxy[1])&(all_points[:,1]<bxy[3]);points=all_points[near];uv=(points[:,:2]-origin)@axes
  ground=height(terrain,points[:,:2]);first=(points[:,3]==1)&(points[:,4]==1)
  local_planes=[];predictions=[]
  for p in old_planes:
   ab=np.array(p['coefficients'][:2]);co=np.array([ab@uu,ab@vv,p['coefficients'][2]+ab@(origin-np.array(p['originEpsg3006']))]);predictions.append(np.column_stack((uv,np.ones(len(uv))))@co)
   local_planes.append(dict(sourcePlaneIndex=p['index'],coefficients=co.tolist(),equation='RH2000=a*u+b*v+c',sourceInlierReturns=p['pointCount'],sourceResidualMetres=p['absoluteResidualMetres'],slopeDegrees=p['slopeDegrees']))
  predictions=np.array(predictions)
  if pair:
   predicted=np.minimum(predictions[pair[0]],predictions[pair[1]])
   if roof_type=='cross_gable':predicted=np.maximum(predicted,np.minimum(predictions[1],predictions[3]))
  else:predicted=predictions[0]
  matches=first&contains_xy(poly.buffer(3),points[:,0],points[:,1])&(points[:,2]>ground+1.7)&(np.abs(points[:,2]-predicted)<.18)
  support=uv[matches]
  # Quantiles suppress isolated neighboring-tree coincidences. The padding is
  # explicitly a display allowance for sampling gaps, not a measured eave.
  low=np.quantile(support,.015,axis=0)-.3;high=np.quantile(support,.985,axis=0)+.3
  eave=dict(uMin=round(float(low[0]),2),uMax=round(float(high[0]),2),vMin=round(float(low[1]),2),vMax=round(float(high[1]),2))
  body={k:round(v+(.3 if k.endswith('Min') else -.3),2) for k,v in eave.items()}
  outside=contains_xy(poly.buffer(4),points[:,0],points[:,1])&~contains_xy(poly.buffer(.5),points[:,0],points[:,1])&(points[:,3]==2)
  ground_base=round(float(np.median(points[outside,2])) if outside.sum()>8 else float(height(terrain,origin.reshape(1,2))[0]),2)
  if pair:
   c0,c1=[np.array(local_planes[x]['coefficients']) for x in pair]
   rv=float(-(c0[2]-c1[2])/(c0[1]-c1[1]));ridge=float(c0@np.array([0,rv,1]));ev0=float(np.min(np.array([p['coefficients'] for p in local_planes])[pair]@np.array([0,eave['vMin'],1])));ev1=float(np.min(np.array([p['coefficients'] for p in local_planes])[pair]@np.array([0,eave['vMax'],1])))
   eave_height=round((ev0+ev1)/2,2)
  else:
   rv=0;ridge=float(max(predicted[matches]));eave_height=round(float(min(predicted[matches])),2);ev0=ev1=eave_height
  frame=dict(originEpsg3006=origin.tolist(),uAxis=uu.tolist(),vAxis=vv.tolist(),anchorEpsg3006RH2000=origin.tolist()+[ground_base],uBearingDegrees=float(np.degrees(np.arctan2(uu[0],uu[1])))%360)
  ground_ring=ob.get('sourceFootprintGeometryEpsg3006')
  record=dict(buildingId=bid,observationId=ob['id'],label=label,roofType=roof_type,localFrame=frame,
   sourceEpoch='2021-04-05T12:00:00Z',imageEpoch='2026-05-02',sourceImage=ob['sourceGrid'],
   measuredPlanes=local_planes,expandedPlaneSupport=dict(count=int(matches.sum()),residualMetres=q(np.abs(points[matches,2]-predicted[matches])),boundsUV=bounds(support),heightRH2000=q(points[matches,2])),
   observedImageRoofBoundsUV=bounds(image_uv),observedImageRoofGeometryEpsg3006=ob['observedRoofGeometryEpsg3006'],
   sourceGroundFootprintGeometryEpsg3006=ground_ring,groundFootprintRetained=True,
   displayGeometry=dict(bodyBoundsUV=body,eaveBoundsUV=eave,baseRH2000=ground_base,eaveRH2000=eave_height,ridgeRH2000=round(ridge,2),ridgeV=rv,
    method='Laser-plane compatible returns in a bounded image buffer; robust support bounds plus 0.3m sampling allowance. Wall rectangle is inset 0.3m from the roof estimate.',
    status='Source-panel reviewed display estimates; dimensions are not surveyed wall measurements',horizontalUncertaintyMetres=.8,eaveHeightUncertaintyMetres=.35),
   groundSupport=dict(count=int(outside.sum()),heightRH2000=q(points[outside,2])),
   observedAppearance=ob['observedAppearance'],roofColourDisplayEstimateHex=ob['roofColourDisplayEstimateHex'],facadeColourDisplayEstimateHex=ob['facadeColourDisplayEstimateHex'],
   limitations=['2021 laser and 2026 image have different epochs; roof/image relief displacement can move the apparent outline.','Roof edge estimates include a sampling allowance; facade position and floor elevation are not directly surveyed.'])
  record['groundSupport']['nativeTerrainHeightAtAnchorRH2000']=float(height(terrain,origin.reshape(1,2))[0])
  record['groundSupport']['anchorMinusNativeTerrainMetres']=ground_base-record['groundSupport']['nativeTerrainHeightAtAnchorRH2000']
  record['groundSupport']['interpretation']='Surrounding classified-ground median supplies a display datum. It is not a surveyed floor; nearby native terrain varies and foundations must tolerate that ground variation without shifting the measured roof.'
  if roof_type=='cross_gable':
   c1,c3=[np.array(local_planes[x]['coefficients']) for x in [1,3]];cross_u=float(-(c1[2]-c3[2])/(c1[0]-c3[0]));record['displayGeometry']['crossGableU']=cross_u
   house_components=[
    dict(id='main-wing',bodyBoundsUV=dict(uMin=-7.05,uMax=4.80,vMin=-2.80,vMax=4.05),roofBoundsUV=dict(uMin=-7.35,uMax=4.80,vMin=-3.10,vMax=4.35),roofPlaneIndices=[0,2],ridgeAxis='u',ridgeCoordinate=rv),
    dict(id='cross-wing',bodyBoundsUV=dict(uMin=1.80,uMax=7.90,vMin=-6.21,vMax=6.22),roofBoundsUV=dict(uMin=1.50,uMax=8.20,vMin=-6.51,vMax=6.52),roofPlaneIndices=[1,3],ridgeAxis='v',ridgeCoordinate=cross_u),
   ]
   for component in house_components:
    rect=box_ring(component['roofBoundsUV'])[:-1];cs=np.array([local_planes[x]['coefficients'] for x in component['roofPlaneIndices']]);heights=np.min(np.column_stack((rect,np.ones(4)))@cs.T,axis=1)
    component['baseRH2000']=ground_base;component['roofCornerCoordinatesUVRH2000']=np.column_stack((rect,heights)).tolist();component['eaveRH2000']=round(float(np.mean(heights)),2)
    component['ridgeRH2000']=round(ridge if component['id']=='main-wing' else float(c1@np.array([cross_u,0,1])),2)
    component['status']='Observed T topology; laser-supported plane domains with estimated wall inset and edge allowance'
   record['displayGeometry']['components']=house_components
   record['displayGeometry']['overallBoundsMeaning']='Envelope of all roof returns, not an enclosed rectangular wall body'
   record['displayGeometry']['eaveRH2000']=house_components[0]['eaveRH2000']
   record['displayGeometry']['excludedLowerSouthwestArea']=dict(boundsUV=dict(uMin=-7.1,uMax=1.5,vMin=-6.0,vMax=-3.1),status='A lower grey covered veranda/canopy is visible; wall enclosure, ground attachment and detailed material remain uncertain. Do not fill this area as the main house.',sourceReturnHeightRH2000=q(points[first&(uv[:,0]>-7.1)&(uv[:,0]<1.5)&(uv[:,1]>-6.0)&(uv[:,1]<-3.1)&(points[:,2]>34.5)&(points[:,2]<35.5),2]))
   record['limitations'].append('The house is T-shaped. The two component wall rectangles form the building body; its overall bounding rectangle must not fill the two western setbacks. The lower southwest canopy is excluded from enclosed volumes.')
  buildings.append(record)
  parameters.append(dict(buildingId=bid,label=label,status='working-source-derived-display-model',frame=frame,
   body=dict(**body,baseRH2000=ground_base,eaveRH2000=eave_height),roof=dict(type=roof_type,**{'eave'+k[0].upper()+k[1:]:v for k,v in eave.items()},ridgeRH2000=round(ridge,2),ridgeV=round(rv,3),ridgeUMin=eave['uMin'],ridgeUMax=eave['uMax'],planes=local_planes),
   appearance=dict(roofHex=ob['roofColourDisplayEstimateHex'],wallHex=ob['facadeColourDisplayEstimateHex'],status='photo interpretation pending source agent review'),
   evidence='tortunabuild/facilities/facility-geometry-evidence.json',uncertainty=record['displayGeometry']['status']))
  if bid=='way/1163533128':
   parameters[-1]['appearance'].update(wallHex='cba548',roofHex='a7725f',trimHex='e8e8de',status='Yellow vertical timber, white trim and red tiled gable confirmed in official photos 2827 and 2657; exact colour values remain illumination-dependent display estimates')
   parameters[-1]['appearance']['openBay']='Dark bay is near the NE/uMax end of the SE-facing long facade (vMin); the reverse NW/vMax side does not show that bay. No unverified functional label.'
  if bid=='tortuna-range-shelter':
   parameters[-1]['appearance'].update(wallHex='8b3934',roofHex='e1dfd6',trimHex='eee9de',status='Official photo 2827 and source-panel correspondence confirm an enclosed red hut with a light mono-pitch roof; its specific function is unverified.')
   parameters[-1]['enclosure']='enclosed-red-hut'
   parameters[-1]['observedFacades']=dict(uMinSouthwest='Three tall light panels/doors separated by dark uprights, facing the clubhouse; exact opening function is uncertain.',vMinSoutheast='Broad red solid side with vertical boards; no evidence of open driving bays.')
   record['observedAppearance']='Official photo 2827 confirms the same mapped light roof hut beside the practice bunker: red vertical walls, three tall light panels/doors on the SW facade, broad red solid SE side. Existing range-shelter ID retained; exact function unknown.'
   record['limitations'].append('The legacy range-shelter label must not be interpreted as an open driving-range hitting shelter. The source photo shows enclosed walls and panels.')
  if roof_type=='shed':
   rect=box_ring(eave)[:-1];co=np.array(local_planes[0]['coefficients']);parameters[-1]['roof']['cornerCoordinatesUVRH2000']=np.column_stack((rect,np.column_stack((rect,np.ones(4)))@co)).tolist()
  if roof_type=='cross_gable':
   parameters[-1]['body']=dict(**house_components[0]['bodyBoundsUV'],baseRH2000=ground_base,eaveRH2000=house_components[0]['eaveRH2000'])
   parameters[-1]['bodyComponents']=house_components
   parameters[-1]['roof']['components']=house_components
   parameters[-1]['roof']['crossGableU']=round(cross_u,4)
   parameters[-1]['roof']['construction']='Take the union of the two T-shaped component roof domains and use the higher intersecting roof plane-pair only in their overlap; do not fill the full bounding box.'
   parameters[-1]['excludedLowerSouthwestArea']=record['displayGeometry']['excludedLowerSouthwestArea']
  # Private native image plus independently georeferenced returns, with no
  # translation of the original image or ground footprint.
  with rasterio.open(ROOT/ob['sourceGrid']['path']) as src:
   image=src.read([1,2,3]).transpose(1,2,0);imgb=src.bounds
  fig,axs=plt.subplots(1,2,figsize=(12,5),layout='constrained')
  axs[0].imshow(image,extent=[imgb.left,imgb.right,imgb.bottom,imgb.top]);axs[0].set_xlim(bxy[0],bxy[2]);axs[0].set_ylim(bxy[1],bxy[3]);axs[0].set_aspect('equal');axs[0].ticklabel_format(useOffset=False,style='plain');axs[0].tick_params(labelsize=6)
  axs[0].scatter(points[matches,0],points[matches,1],c=points[matches,2],s=10,cmap='plasma')
  plotted=[(eave,'cyan','Estimated eave'),(body,'lime','Estimated walls')] if roof_type!='cross_gable' else [(c['roofBoundsUV'],'cyan',c['id']+' roof') for c in house_components]+[(c['bodyBoundsUV'],'lime',c['id']+' walls') for c in house_components]
  for bb,color,lab in plotted:
   xy=box_ring(bb)@axes.T+origin;axs[0].plot(xy[:,0],xy[:,1],color=color,label=lab,lw=1)
  axs[0].legend(fontsize=7);axs[0].set_title(label)
  axs[1].scatter(uv[first,1],points[first,2],s=5,color='lightgray',label='Nearby first returns');axs[1].scatter(uv[matches,1],points[matches,2],s=8,label='Roof plane compatible');axs[1].axhline(ground_base,color='brown',label='Ground datum estimate');axs[1].set_xlabel('v metres');axs[1].set_ylabel('RH2000');axs[1].legend(fontsize=7);axs[1].grid(alpha=.2)
  fig.savefig(PRIVATE/f'{label}.png',dpi=150);plt.close(fig)
 script='tortunabuild/facilities/derive-facilities.py'
 for p in ['tortunabuild/cache/clubhouse-model/references/official-wp-2827.png','tortunabuild/cache/clubhouse-model/references/official-wp-2657.png']:
  inputs.append(identity(p))
 report=dict(schemaVersion=1,groundId='tortuna',state='source-panel-reviewed-architectural-estimates',horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613',inputs=inputs,
  script=dict(path=script,sha256LfNormalized=hashlib.sha256((ROOT/script).read_bytes().replace(b'\r\n',b'\n')).hexdigest()),buildings=buildings,backlog=backlog,
  immutableSourcePolicy='These observations never replace the retained OSM/observed source footprints or measured TINs. Display-only Blender assets must be keyed to existing building IDs; the unmapped small hut remains separate backlog.')
 save(OUT/'facility-geometry-evidence.json',report);save(OUT/'model-parameters-working.json',dict(schemaVersion=1,status=report['state'],buildings=parameters))
 print(json.dumps([dict(id=b['buildingId'],label=b['label'],frame=b['localFrame'],geometry=b['displayGeometry'],returns=b['expandedPlaneSupport']['count']) for b in buildings],indent=2))

if __name__=='__main__':main()
