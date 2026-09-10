#!/usr/bin/env python3
"""Validate accepted Johannesberg mapping against pinned pre-review models.

Run from the repository root with an installed Python containing pyproj/Shapely:
  python johannesbergbuild/mapping/validate-alignment.py
  python johannesbergbuild/mapping/validate-alignment.py --baseline-dir DIR

Default baselines are read directly from the pinned Git commit. The optional
baseline directory supplies eighteen.json and nine.json, whose normalized bytes
must match the pinned original hashes. Source images remain in the ignored
acquisition cache: missing source files are an error, never a successful check.
The current JavaScript applier is replayed in memory through Node; no generated
models or source imagery are changed. This writes only the requested report.
"""
import argparse
import subprocess
import sys
import hashlib,json,math
from collections import Counter
from itertools import combinations
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import Polygon,Point,LineString

PINNED_REF='7aac4d4495e78d9321889273b34ad6d1bb12290a'
PINNED_MODELS={
 'johannesberg':('eighteen','johannesbergbuild/course-model.json','9cdec310df0f70a39b86f440fb6397309c7c175b668fba26683148864f392e69'),
 'johannesberg-9':('nine','johannesberg9build/course-model.json','f1b767a3ce03ac21c25daf485a8fa4d0f595c948844ad7dc146c53eae082b2b3'),
}
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline-dir',type=Path,help='Optional exact archived baselines; filenames eighteen.json and nine.json')
parser.add_argument('--out',type=Path,default=Path('johannesbergbuild/mapping/lm-alignment-validation.json'))
parser.add_argument('--check-only',action='store_true',help='Validate and print results without writing a report')
args=parser.parse_args()
BASE=args.baseline_dir

DIR=Path('johannesbergbuild/mapping')
files=['lm-review-front9.json','lm-review-back9.json','lm-review-back9-turf.json','lm-review-nine.json','lm-review-tee-platforms.json']
placement_files={'johannesberg':'tee-placement-review.json','johannesberg-9':'tee-placement-nine-review.json'}
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
rt=lambda x:round(float(x),6)
before={}
for slug,(name,path,expected_hash)in PINNED_MODELS.items():
 raw=(BASE/(name+'.json')).read_bytes()if BASE else subprocess.run(['git','show',PINNED_REF+':'+path],capture_output=True,check=True).stdout
 raw=raw.replace(b'\r\n',b'\n')
 if hashlib.sha256(raw).hexdigest()!=expected_hash:
  raise ValueError(f'{slug}: baseline does not match pinned original {PINNED_REF}')
 before[slug]=json.loads(raw)

actual_paths={'johannesberg':'johannesbergbuild/course-model.json','johannesberg-9':'johannesberg9build/course-model.json'}
actual={s:read(p)for s,p in actual_paths.items()}
placements={s:read(DIR/p)for s,p in placement_files.items()}
# Replaying against pinned originals also validates every accepted-original hash.
node_program="""
import fs from 'node:fs';
import {applyOrthoReview,legacyHeightfieldSampler} from './johannesbergbuild/mapping/apply-ortho-review.mjs';
import {applyTeePlacementReview} from './johannesbergbuild/mapping/apply-tee-placement-review.mjs';
import {applyObPlacementReview} from './johannesbergbuild/mapping/apply-ob-placement-review.mjs';
import {deriveTeeBearings} from './apps/golf/src/engine/tee-pads.mjs';
import {reviewedTeeMarkerPositions} from './apps/golf/src/engine/reviewed-tee-marker-placement.mjs';
const before=BASELINES;
const actual=ACTUALS;
const heightAt=legacyHeightfieldSampler(JSON.parse(fs.readFileSync('johannesbergbuild/heightfields.json')).hf0);
const planned={};
for(const [slug,ledgers]of [['johannesberg',['front9','back9','back9-turf','tee-platforms']],['johannesberg-9',['nine']]]){
 let model=before[slug];
 for(const file of ledgers)model=applyOrthoReview(model,JSON.parse(fs.readFileSync('johannesbergbuild/mapping/lm-review-'+file+'.json')),{heightAt});
 const placementFile=slug==='johannesberg'?'tee-placement-review.json':'tee-placement-nine-review.json';
 model=applyTeePlacementReview(model,JSON.parse(fs.readFileSync('johannesbergbuild/mapping/'+placementFile)),{heightAt});
 if(slug==='johannesberg')model=applyObPlacementReview(model,JSON.parse(fs.readFileSync('johannesbergbuild/mapping/ob-placement-review.json')));
 planned[slug]=model;
}
const markerLayout=[];
for(const [course,model]of Object.entries(actual))for(const original of model.holes){
 const hole=structuredClone(original);
 hole.tees.marks.forEach((mark,index)=>{mark.teeIdx=index;});
 deriveTeeBearings(hole);
 for(const [teeIndex,mark]of hole.tees.marks.entries())markerLayout.push({course,hole:hole.n,teeIndex,positions:reviewedTeeMarkerPositions(hole,mark)});
}
process.stdout.write(JSON.stringify({planned,markerLayout}));
""".replace('BASELINES',json.dumps(before,separators=(',',':'))).replace('ACTUALS',json.dumps(actual,separators=(',',':')))
replayed=json.loads(subprocess.run(['node','--input-type=module'],input=node_program,text=True,encoding='utf-8',capture_output=True,check=True).stdout)
planned=replayed['planned']

reviews=[read(DIR/f)for f in files]
forward=Transformer.from_crs(4326,3006,always_xy=True)
failures=[];vertices=0;residuals=[];sources={};per_resolution={};per_review=[]

for name,doc in zip(files,reviews):
 errors=[];nvertices=0
 for f in doc['features']:
  e=f['evidence']
  for src in e['sourceFiles']:
   if src['path'] not in sources:sources[src['path']]={'path':src['path'],'sha256':sha(src['path'])}
   if sources[src['path']]['sha256']!=src['sha256']:failures.append({'check':'source-checksum','feature':f['id'],'path':src['path']})
  if not e['sourceCaptureDates']==['2025-06-14']:failures.append({'check':'capture-date','feature':f['id']})
  if not (isinstance(e['uncertaintyM'],(int,float))and e['uncertaintyM']>0):failures.append({'check':'uncertainty','feature':f['id']})
  rings=f.get('rings',[f['ring']]if f.get('ring')else [])
  pix=e.get('sourcePixelRings',[e['sourcePixelRing']]if e.get('sourcePixelRing')else [])
  if f.get('action')=='remove':continue
  if len(rings)!=len(pix):failures.append({'check':'pixel-ring-count','feature':f['id']});continue
  extent=e['panelExtent'];extent=extent['bounds']if isinstance(extent,dict)else extent
  w,h=e['panelPixelSize'];rx=(extent[2]-extent[0])/w;ry=(extent[3]-extent[1])/h
  resolution=round(max(rx,ry),6)
  frame=doc['frame'];origin=frame['origin']
  for ring,pr in zip(rings,pix):
   if len(ring)!=len(pr):failures.append({'check':'pixel-vertex-count','feature':f['id']});continue
   if not Polygon(ring).is_valid:failures.append({'check':'ring-validity','feature':f['id']})
   for (x,z),(px,py)in zip(ring,pr):
    E,N=forward.transform(origin['lon']+x/frame['mPerLon'],origin['lat']-z/frame['mPerLat'])
    d=math.hypot(E-(extent[0]+px*rx),N-(extent[3]-py*ry))
    if not (0<=px<=w and 0<=py<=h):failures.append({'check':'pixel-within-reviewed-panel','feature':f['id'],'pixel':[px,py]})
    if d>.01:failures.append({'check':'pixel-roundtrip-over-centimetre','feature':f['id'],'residualMetres':rt(d)})
    errors.append(d);residuals.append(d);per_resolution.setdefault(resolution,[]).append(d);nvertices+=1
  if not errors:failures.append({'check':'pixel-vertices','feature':f['id']})
 per_review.append({'path':str(DIR/name).replace('\\','/'),'sha256':sha(DIR/name),'acceptedFeatureRecords':len(doc['features']),'verifiedPixelVertices':nvertices,'maxPixelRoundtripMetres':rt(max(errors,default=0)),'unresolvedRecords':len(doc.get('unresolved',[]))})

def verify_placement_sources(value,label):
 """Check retained image, club-plan and card evidence, including normalized text pins."""
 if isinstance(value,dict):
  path=value.get('path',value.get('snapshotPath',value.get('sourceFile')));expected=value.get('sha256',value.get('sourceSha256'))
  if path and expected:
   raw=Path(path).read_bytes();observed=hashlib.sha256(raw).hexdigest()
   normalized=hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest()
   sources.setdefault(path,{'path':path,'sha256':observed})
   if expected not in [observed,normalized]:failures.append({'check':'source-checksum','placementReview':label,'path':path})
  for child in value.values():verify_placement_sources(child,label)
 elif isinstance(value,list):
  for child in value:verify_placement_sources(child,label)

def placement_coordinate(mark):
 if mark.get('displayMarkers')is False or mark.get('status','').startswith('unresolved'):return None
 return mark.get('displayC',mark.get('c'))

placement_rows={};per_placement=[]
for slug,doc in placements.items():
 verify_placement_sources(doc,placement_files[slug])
 rows={row['hole']:row for row in doc['holes']};placement_rows[slug]=rows
 if set(rows)!={h['n']for h in actual[slug]['holes']}:failures.append({'check':'placement-hole-coverage','course':slug})
 accepted=sum(placement_coordinate(mark)is not None for row in rows.values()for mark in row['marks'])
 per_placement.append({'course':slug,'path':str(DIR/placement_files[slug]).replace('\\','/'),'sha256':sha(DIR/placement_files[slug]),'acceptedReferences':accepted,'unresolvedReferences':sum(len(row['marks'])for row in rows.values())-accepted})
 # The nine-hole decisions retain manually selected native-image pixels. The
 # main-course marker positions are layouts inside reviewed surfaces, so do
 # not misreport those generated presentation positions as observed pixels.
 for row in rows.values():
  for mark in row['marks']:
   area_evidence=mark.get('referenceAreaEvidence');area_ring=mark.get('referenceSurfaceRing')
   if area_evidence and area_ring:
    extent=area_evidence['panelExtent'];extent=extent['bounds']if isinstance(extent,dict)else extent
    w,h=area_evidence['panelPixelSize'];rx=(extent[2]-extent[0])/w;ry=(extent[3]-extent[1])/h
    frame=doc['frame'];origin=frame['origin'];pixels=area_evidence['sourcePixelRing']
    if len(pixels)!=len(area_ring)or not Polygon(area_ring).is_valid:failures.append({'check':'mown-marker-area-geometry','course':slug,'hole':row['hole'],'teeIndex':mark['teeIndex']})
    for(x,z),(px,py)in zip(area_ring,pixels):
     E,N=forward.transform(origin['lon']+x/frame['mPerLon'],origin['lat']-z/frame['mPerLat'])
     residual=math.hypot(E-(extent[0]+px*rx),N-(extent[3]-py*ry))
     if residual>.01 or not(0<=px<=w and 0<=py<=h):failures.append({'check':'mown-marker-area-pixel-roundtrip','course':slug,'hole':row['hole'],'teeIndex':mark['teeIndex'],'residualMetres':rt(residual)})
   c=placement_coordinate(mark);e=mark.get('evidence',{});pixel=e.get('sourcePixel')
   if c is None or pixel is None:continue
   extent=e['sourcePanelExtent'];w,h=e['sourcePanelPixelSize'];rx=(extent[2]-extent[0])/w;ry=(extent[3]-extent[1])/h
   frame=doc['frame'];origin=frame['origin'];E,N=forward.transform(origin['lon']+c[0]/frame['mPerLon'],origin['lat']-c[1]/frame['mPerLat'])
   residual=math.hypot(E-(extent[0]+pixel[0]*rx),N-(extent[3]-pixel[1]*ry))
   if residual>.01 or not(0<=pixel[0]<=w and 0<=pixel[1]<=h):failures.append({'check':'tee-reference-pixel-roundtrip','course':slug,'hole':row['hole'],'teeIndex':mark['teeIndex'],'residualMetres':rt(residual)})

def counts(m):
 return {'greens':len(m['holes']),'fairwayRings':sum(len(h['fairway']['rings'])for h in m['holes']),'teePlatforms':sum(len(h['tees']['pads'])for h in m['holes']),'bunkers':sum(len(h['bunkers'])for h in m['holes']),'waterBodies':len(m['water']),'streams':len(m['streams'])}

courses=[];shapes=[];marker_count=0;marker_source_preserved=0;marker_display_inside=0;marker_fairway_inside=0;marker_mown_inside=0;marker_unresolved=0
for slug,m in actual.items():
 baseline=before[slug];target=planned[slug]
 if m['holes']!=target['holes']:
  def differences(a,b,path='holes'):
   if isinstance(a,dict)and isinstance(b,dict):
    return sum((differences(a.get(k),b.get(k),path+'.'+k)for k in sorted(set(a)|set(b))),[])
   if isinstance(a,list)and isinstance(b,list):
    if len(a)!=len(b):return [{'path':path,'actualLength':len(a),'replayedLength':len(b)}]
    return sum((differences(x,y,path+'.'+str(i))for i,(x,y)in enumerate(zip(a,b))),[])
   return []if a==b else [{'path':path,'actual':a,'replayed':b}]
  failures.append({'check':'generated-playing-model-equals-reviewed-baseline','course':slug,'differences':differences(m['holes'],target['holes'])[:12]})
 holes=[]
 for old,new in zip(baseline['holes'],m['holes']):
  n=new['n'];oldp=Polygon(old['green']['ring']);newp=Polygon(new['green']['ring'])
  row=placement_rows[slug].get(n,{'marks':[]});decisions={mark['teeIndex']:mark for mark in row['marks']}
  if len(new['tees']['marks'])!=len(old['tees']['marks']):failures.append({'check':'source-marker-count','course':slug,'hole':n})
  if set(decisions)!=set(range(len(new['tees']['marks']))):failures.append({'check':'placement-marker-coverage','course':slug,'hole':n})
  for tee_index,(oldmark,mark)in enumerate(zip(old['tees']['marks'],new['tees']['marks'])):
   marker_count+=1
   context={'course':slug,'hole':n,'teeIndex':tee_index};decision=decisions.get(tee_index,{})
   reference=mark.get('orthophotoReference',{});original=reference.get('originalReference',{})
   if original.get('c')==oldmark['c']:marker_source_preserved+=1
   else:failures.append({'check':'inherited-marker-reference-retained-in-provenance',**context})
   if mark.get('m')!=oldmark.get('m'):failures.append({'check':'official-marker-length-preserved',**context})
   if 'displayC'in mark or'displayPadIndex'in mark:failures.append({'check':'obsolete-nearest-pad-anchor-removed',**context})
   expected=placement_coordinate(decision)
   if expected is None:
    marker_unresolved+=1
    if mark['c']!=oldmark['c']or reference.get('kind')!='unresolved-guide-tee-reference'or mark.get('sourcePadId')is not None:
     failures.append({'check':'unresolved-reference-retained-without-physical-marker-claim',**context})
   else:
    if mark['c']!=expected:failures.append({'check':'accepted-reference-equals-placement-ledger',**context})
    if reference.get('kind')=='unresolved-guide-tee-reference':failures.append({'check':'accepted-reference-not-marked-unresolved',**context})
    surface=decision.get('surfaceKind',decision.get('referenceSurfaceKind','tee'))
    if surface=='fairway':
     if mark.get('referenceSurfaceKind')=='fairway'and any(Polygon(r).covers(Point(mark['c']))for r in new['fairway']['rings']):marker_fairway_inside+=1
     else:failures.append({'check':'reviewed-forward-reference-in-fairway',**context})
    elif surface=='mown-ground':
     ring=mark.get('referenceSurfaceRing')
     if mark.get('referenceSurfaceKind')=='mown-ground'and ring==decision.get('referenceSurfaceRing')and Polygon(ring).covers(Point(mark['c'])):marker_mown_inside+=1
     else:failures.append({'check':'reviewed-forward-reference-in-bounded-mown-area',**context})
    else:
     pad_id=decision.get('padId',decision.get('sourcePadId'));matching=[p for p in new['tees']['pads']if p.get('id')==pad_id]
     if mark.get('sourcePadId')==pad_id and len(matching)==1 and Polygon(matching[0]['ring']).covers(Point(mark['c'])):marker_display_inside+=1
     else:failures.append({'check':'accepted-reference-in-declared-unique-physical-pad',**context})

  for pad in row.get('pads',[]):
   index=pad.get('index',pad.get('padIndex'));pad_id=pad['padId'];actual_pad=new['tees']['pads'][index]
   if actual_pad.get('id')!=pad_id:failures.append({'check':'stable-tee-platform-identity','course':slug,'hole':n,'padIndex':index})
   if 'ring'in pad and actual_pad['ring']!=pad['ring']:failures.append({'check':'placement-platform-geometry-preserved','course':slug,'hole':n,'padIndex':index})

  if not newp.covers(Point(new['green']['c'])):failures.append({'check':'green-target-containment','course':slug,'hole':n})
  if not newp.covers(Point(new['pin'])):failures.append({'check':'pin-containment','course':slug,'hole':n})
  if not newp.covers(Point(new['line'][-1])):failures.append({'check':'route-end-containment','course':slug,'hole':n})
  if placement_coordinate(decisions.get(0,{}))is not None and new['line'][0]!=new['tees']['marks'][0]['c']:failures.append({'check':'route-start-equals-accepted-back-tee-reference','course':slug,'hole':n})
  if new.get('t')!=old.get('t'):failures.append({'check':'official-hole-card-preserved','course':slug,'hole':n})
  holes.append({'hole':n,'greenAreaBeforeM2':rt(oldp.area),'greenAreaAfterM2':rt(newp.area),'greenCentroidMovementM':rt(oldp.centroid.distance(newp.centroid)),'targetMovementM':rt(math.dist(old['green']['c'],new['green']['c'])),'routingEndInsideGreen':True,'countsBefore':{k:v for k,v in counts({'holes':[old],'water':[],'streams':[]}).items()if k not in ['waterBodies','streams']},'countsAfter':{k:v for k,v in counts({'holes':[new],'water':[],'streams':[]}).items()if k not in ['waterBodies','streams']}})
  groups={'green':[new['green']['ring']],'fairway':new['fairway']['rings'],'tee':[p['ring']for p in new['tees']['pads']],'bunker':[p['ring']for p in new['bunkers']]}
  for kind,rings in groups.items():
   for i,r in enumerate(rings):
    p=Polygon(r)
    if not p.is_valid:failures.append({'check':'generated-ring-validity','course':slug,'hole':n,'kind':kind,'index':i})
    shapes.append({'course':slug,'hole':n,'kind':kind,'index':i,'polygon':p})
 courses.append({'course':slug,'model':{'path':actual_paths[slug],'sha256':sha(actual_paths[slug])},'countsBefore':counts(baseline),'countsAfter':counts(m),'holes':holes})

# Check the actual shared renderer's endpoints, not just nominal tee centres.
rendered_balls=[];rendered_pairs=0;suppressed_pairs=0;ball_clearances=[];colour_separations=[]
for item in replayed['markerLayout']:
 slug=item['course'];n=item['hole'];tee_index=item['teeIndex'];context={'course':slug,'hole':n,'teeIndex':tee_index}
 hole=next(h for h in actual[slug]['holes']if h['n']==n);mark=hole['tees']['marks'][tee_index]
 decision=next(d for d in placement_rows[slug][n]['marks']if d['teeIndex']==tee_index);positions=item['positions']
 if placement_coordinate(decision)is None:
  suppressed_pairs+=1
  if positions:failures.append({'check':'unresolved-reference-renders-no-marker-balls',**context})
  continue
 if len(positions)!=2:failures.append({'check':'accepted-reference-renders-two-marker-balls',**context,'count':len(positions)});continue
 rendered_pairs+=1
 surface=decision.get('surfaceKind',decision.get('referenceSurfaceKind','tee'))
 rings=hole['fairway']['rings']if surface=='fairway'else [mark['referenceSurfaceRing']]if surface=='mown-ground'else [p['ring']for p in hole['tees']['pads']if p.get('id')==mark.get('sourcePadId')]
 polygons=[Polygon(r)for r in rings]
 for position in positions:
  point=Point(position);clearance=max((point.distance(p.boundary)if p.covers(point)else -point.distance(p))for p in polygons)if polygons else -math.inf
  ball_clearances.append(clearance)
  if clearance<.15-1e-5:failures.append({'check':'rendered-marker-ball-clears-reviewed-surface-edge',**context,'position':position,'clearanceM':rt(clearance)})
  for previous in rendered_balls:
   if previous['course']!=slug or(previous['hole']==n and previous['teeIndex']==tee_index):continue
   separation=math.dist(previous['position'],position);colour_separations.append(separation)
   if separation<.35-1e-5:failures.append({'check':'rendered-marker-balls-have-separate-colour-positions',**context,'otherHole':previous['hole'],'otherTeeIndex':previous['teeIndex'],'separationM':rt(separation)})
  rendered_balls.append({**context,'position':position})
marker_rendering={'acceptedReferencesRenderedAsPairs':rendered_pairs,'renderedBalls':len(rendered_balls),'unresolvedReferencesSuppressed':suppressed_pairs,'minimumBallCentreSurfaceClearanceM':rt(min(ball_clearances))if ball_clearances else None,'minimumDifferentColourBallSeparationM':rt(min(colour_separations))if colour_separations else None,'surfaceClearanceThresholdM':.15,'colourSeparationThresholdM':.35,'renderer':'reviewedTeeMarkerPositions'}

# Club plans establish OB corridor existence and side of play. These checks
# verify the retained image registration and illustrative post generation,
# never the legal boundary or individual physical stake coordinates.
ob_path=DIR/'ob-placement-review.json';ob=read(ob_path);ob_cache=Path('johannesbergbuild/cache/ob-review')
ob_residuals=[];ob_post_residuals=[];ob_spacings=[];ob_rows=[];ob_windows={}
ob_failure_start=len(failures)
verify_placement_sources(ob,'ob-placement-review.json')
if ob.get('frame')!={k:actual['johannesberg'][k]for k in ['origin','mPerLat','mPerLon']}:
 failures.append({'check':'ob-declared-frame-equals-course-frame'})
if ob.get('originalMarking')!=before['johannesberg'].get('marking'):
 failures.append({'check':'ob-original-marking-equals-pinned-baseline'})
if actual['johannesberg'].get('marking')!=planned['johannesberg'].get('marking')or actual['johannesberg'].get('obPlacementReview')!=planned['johannesberg'].get('obPlacementReview'):
 failures.append({'check':'generated-ob-corridors-equal-replayed-review'})
if actual['johannesberg-9'].get('marking')!=actual['johannesberg'].get('marking'):
 failures.append({'check':'nine-carries-parent-ob-corridors-verbatim-as-estate-scenery'})

def verify_ob_window(name,native=False):
 import rasterio
 if name in ob_windows:return ob_windows[name]
 directory=ob_cache if native else Path('johannesbergbuild/cache/lm-ortho')
 meta=read(directory/(name+'.json'))
 acquisition_path=DIR/'ob-orthophoto-acquisition.json'if native else Path('geo_data/course-v2/johannesberg/reference/lm-ortho-acquisition-2026-09-09.json')
 acquisition=read(acquisition_path);records=[r for r in acquisition['windows']if r['id']==name]
 if len(records)!=1 or records[0]!=meta:failures.append({'check':'ob-source-window-equals-acquisition-record','window':name})
 plan_path=directory/'plan.json'if native else Path('geo_data/course-v2/johannesberg/reference/lm-ortho-plan-2026-09-09.json')
 verify_placement_sources({'path':str(plan_path).replace('\\','/'),'sha256':acquisition['planSha256']},'ob-acquisition-plan')
 for key,pin in [('rgbFile','rgbSha256'),('rasterFile','sha256')]:
  verify_placement_sources({'path':str(directory/meta[key]).replace('\\','/'),'sha256':meta[pin]},'ob-source-window')
 with rasterio.open(directory/meta['rasterFile'])as raster:
  if raster.crs.to_epsg()!=3006 or raster.width!=meta['width']or raster.height!=meta['height']or any(abs(a-b)>1e-8 for a,b in zip(raster.transform.to_gdal(),meta['geoTransform'])):
   failures.append({'check':'ob-source-affine-and-dimensions-match-raster','window':name})
 if sorted({s['capturedAt'][:10]for s in meta['sources']})!=['2025-06-14']:
  failures.append({'check':'ob-source-capture-date','window':name})
 ob_windows[name]=meta
 return meta

required_boundary_status='guide-supported-landscape-corridor-not-surveyed-stake-line'
if ob.get('kind')!='club-guide-supported-ob-display-corridors'or not ob.get('sourcePolicy')or ob.get('postPlacement',{}).get('physicalPostPositionsObserved')is not False:
 failures.append({'check':'ob-review-remains-explicitly-unsurveyed'})
expected_ob_ids={f['id']for f in ob['features']};actual_ob={m.get('id'):m for m in actual['johannesberg'].get('marking',[])}
if len(expected_ob_ids)!=len(ob['features'])or set(actual_ob)!=expected_ob_ids or len(actual_ob)!=len(actual['johannesberg'].get('marking',[])):
 failures.append({'check':'ob-corridor-identity-coverage'})
for feature in ob['features']:
 context={'feature':feature['id'],'hole':feature['hole']};evidence=feature['evidence'];meta=verify_ob_window(feature['sourceWindow'])
 line=feature['line'];pixels=feature['pixelLine'];affine=evidence['geoTransform'];posts=actual_ob.get(feature['id'],{});spacing=feature['postPlacement'].get('spacingM')
 if len(line)<2 or len(line)!=len(pixels)or not LineString(line).is_simple or any(a==b for a,b in zip(line,line[1:])):
  failures.append({'check':'ob-corridor-line-geometry',**context});continue
 if affine!=meta['geoTransform']or evidence.get('sourceCaptureDates')!=['2025-06-14']:
  failures.append({'check':'ob-corridor-source-affine-or-capture-date',**context})
 expected_png=str(Path('johannesbergbuild/cache/lm-ortho')/meta['rgbFile']).replace('\\','/')
 if not any(s.get('path')==expected_png and s.get('sha256')==meta['rgbSha256']for s in evidence['sourceFiles']):
  failures.append({'check':'ob-corridor-pins-registered-source-image',**context})
 plan=ob_cache/f'Bana-{feature["hole"]}.jpg'
 verify_placement_sources({'path':str(plan).replace('\\','/'),'sha256':evidence['officialPlanSha256']},'ob-official-plan')
 if not evidence.get('officialPlanUrl')or not evidence.get('officialPlanRetrievedOn'):
  failures.append({'check':'ob-corridor-official-plan-identity',**context})
 if feature.get('boundaryStatus')!=required_boundary_status or evidence.get('individualPhysicalPostsObserved')is not False or not evidence.get('corridorUncertaintyM',0)>0 or feature.get('status')!='accepted-display-corridor':
  failures.append({'check':'ob-corridor-has-no-surveyed-stake-claim',**context})
 policy=feature['postPlacement']
 if policy.get('kind')!='illustrative-distance-spacing'or policy.get('physicalPostPositionsObserved')is not False or policy.get('includeLineCorners')is not True or not isinstance(spacing,(int,float))or not 0<spacing<=12:
  failures.append({'check':'ob-post-placement-is-illustrative-and-bounded',**context})
 frame=ob['frame'];origin=frame['origin'];errors=[]
 for(x,z),(px,py)in zip(line,pixels):
  E,N=forward.transform(origin['lon']+x/frame['mPerLon'],origin['lat']-z/frame['mPerLat'])
  residual=math.hypot(E-(affine[0]+px*affine[1]+py*affine[2]),N-(affine[3]+px*affine[4]+py*affine[5]))
  errors.append(residual);ob_residuals.append(residual)
  if residual>.01 or not(0<=px<=meta['width']and 0<=py<=meta['height']):
   failures.append({'check':'ob-corridor-pixel-affine-registration',**context,'residualMetres':rt(residual)})
 positions=posts.get('pts',[]);geometry=LineString(line);segment_lengths=[math.dist(a,b)for a,b in zip(line,line[1:])]
 expected_count=1+sum(math.ceil(distance/spacing)for distance in segment_lengths)if isinstance(spacing,(int,float))and spacing>0 else None
 if len(positions)!=expected_count or not positions or positions[0]!=line[0]or positions[-1]!=line[-1]or not all(vertex in positions for vertex in line):
  failures.append({'check':'ob-post-count-endpoints-and-corners',**context,'expectedCount':expected_count,'actualCount':len(positions)})
 if posts.get('line')!=line or posts.get('boundaryStatus')!=required_boundary_status or posts.get('postPlacementKind')!='illustrative-distance-spacing'or posts.get('physicalPostPositionsObserved')is not False or posts.get('corridorUncertaintyM')!=evidence['corridorUncertaintyM']:
  failures.append({'check':'published-ob-preserves-unsurveyed-corridor-policy',**context})
 stations=[]
 for p in positions:
  residual=geometry.distance(Point(p));ob_post_residuals.append(residual);stations.append(geometry.project(Point(p)))
  if residual>.001:failures.append({'check':'ob-display-post-on-reviewed-polyline',**context,'position':p,'residualMetres':rt(residual)})
 steps=[math.dist(a,b)for a,b in zip(positions,positions[1:])];ob_spacings.extend(steps)
 if any(a>=b for a,b in zip(stations,stations[1:]))or any(distance<=0 or distance>spacing+.002 for distance in steps):
  failures.append({'check':'ob-display-post-order-and-maximum-spacing',**context})
 ob_rows.append({**context,'sourceWindow':feature['sourceWindow'],'corridorVertices':len(line),'corridorLengthM':rt(geometry.length),'displayPosts':len(positions),'maximumPostSpacingM':rt(max(steps,default=0)),'maximumPixelRoundtripM':rt(max(errors,default=0)),'corridorUncertaintyM':evidence['corridorUncertaintyM']})

for unresolved in ob.get('unresolved',[]):
 if unresolved.get('kind')=='ob-corridor'and unresolved.get('hole')is not None:
  n=unresolved['hole'];verify_placement_sources({'path':str(ob_cache/f'Bana-{n}.jpg').replace('\\','/'),'sha256':unresolved['officialPlanSha256']},'ob-unresolved-official-plan')
  if any(f['hole']==n for f in ob['features'])or any(m.get('hole')==n for m in actual['johannesberg'].get('marking',[])):
   failures.append({'check':'unresolved-ob-corridor-is-not-published','hole':n})
  if unresolved.get('nativeWindow'):verify_ob_window(Path(unresolved['nativeWindow']).stem,native=True)
verify_placement_sources({'path':str(ob_cache/'local-rules-2024.html').replace('\\','/'),'sha256':ob['rules']['htmlSha256']},'ob-official-local-rules')
if ob['rules'].get('internalObSpecified')is not False:failures.append({'check':'ob-review-does-not-invent-internal-boundaries'})
ob_validation={'review':{'path':str(ob_path).replace('\\','/'),'sha256':sha(ob_path)},'acceptedCorridors':len(ob_rows),'displayPosts':sum(row['displayPosts']for row in ob_rows),'verifiedSourceWindows':len(ob_windows),'registeredPixelVertices':len(ob_residuals),'maximumPixelRoundtripM':rt(max(ob_residuals,default=0)),'maximumPostToCorridorDistanceM':rt(max(ob_post_residuals,default=0)),'maximumPostSpacingM':rt(max(ob_spacings,default=0)),'pixelRoundtripThresholdM':.01,'postToCorridorThresholdM':.001,'spacingRoundingToleranceM':.002,'individualPhysicalPostPositionsObserved':False,'boundaryStatus':required_boundary_status,'corridors':ob_rows,'failureCount':len(failures)-ob_failure_start,'meaning':'Verifies source bytes, authored image-to-local registration and illustrative polyline spacing. It does not establish surveyed OB boundary vertices or observed individual stake positions.'}

overlaps=[]
for a,b in combinations(shapes,2):
 if a['course']==b['course']and a['hole']==b['hole']:continue
 area=a['polygon'].intersection(b['polygon']).area
 if area>.01:overlaps.append({'a':{k:v for k,v in a.items()if k!='polygon'},'b':{k:v for k,v in b.items()if k!='polygon'},'areaM2':rt(area)})

for item in overlaps:
 if item['a']['course']=='johannesberg-9' and item['b']['course']=='johannesberg-9' and {item['a']['hole'],item['b']['hole']}=={1,5} and item['a']['kind']==item['b']['kind']=='fairway':
  item['reviewStatus']='accepted-shared-mown-connector'
  item['reviewNote']='Native nine-05-hole source around pixel750,177 and final H1/H5 overlays show continuous mown connector around the eastern end of the intervening rough strip. Both polygons assign the same fairway/apron class. Two visual reviewers confirmed no visible physical turf boundary between hole ownership. Retained without inventing a physical edge.'
  item['source']='johannesbergbuild/cache/lm-ortho/nine-05-hole.png'
 else:failures.append({'check':'unreviewed-cross-hole-surface-intersection','intersection':item})

# Exact point equality is sufficient here: reciprocal scenery should carry the
# already accepted physical rings verbatim, not refit their coordinates.
key=lambda r:json.dumps(r,separators=(',',':'))
def owned(m):return {'greens':[h['green']['ring']for h in m['holes']],'fairways':[r for h in m['holes']for r in h['fairway']['rings']],'tees':[p['ring']for h in m['holes']for p in h['tees']['pads']],'bunkers':[p['ring']for h in m['holes']for p in h['bunkers']]}
scenery=[]
for slug,other in [('johannesberg','johannesberg-9'),('johannesberg-9','johannesberg')]:
 for kind,rings in owned(actual[other]).items():
  observed=Counter(map(key,actual[slug]['scenery'][kind]));expected=Counter(map(key,rings));ownset=set(map(key,owned(actual[slug])[kind]));missing=sum(max(0,v-observed[k])for k,v in expected.items());duplicate=sum(observed[k]for k in ownset)
  if missing or duplicate:failures.append({'check':'shared-scenery','course':slug,'kind':kind,'missing':missing,'ownDuplicates':duplicate})
  scenery.append({'course':slug,'sharedCourse':other,'kind':kind,'expectedSharedRings':len(rings),'missingSharedRings':missing,'ownPlayingRingsDuplicatedAsScenery':duplicate})

out={'schemaVersion':1,'groundId':'johannesberg','validatedOn':'2026-09-09','validationScope':'Mechanical source-to-authored-pixel registration, actual generated playing models, geometry validity, green endpoint containment, explicit tee references, unresolved-marker policy and shared scenery. This is not an independent survey or a measured absolute positional accuracy claim.','sourceCaptureDate':'2025-06-14','sourceFilesVerified':len(sources),'sourceHashesVerified':not any(f['check']=='source-checksum'for f in failures),'reviews':per_review,'teePlacementReviews':per_placement,'pixelRoundtrip':{'method':'pyproj EPSG:4326 to EPSG:3006 from declared legacy origin/metres-per-degree; compared with retained source-panel pixel-edge affine. Residual measures coordinate quantization/reprojection only.','passThresholdMetres':0.01,'thresholdMeaning':'Centimetre bound covers retained0.01m coordinate rounding and forward/inverse projection; it is not source positional accuracy.','vertexCount':len(residuals),'maximumMetres':rt(max(residuals,default=0)),'byPanelPixelResolution':[{'resolutionM':r,'vertexCount':len(v),'maximumMetres':rt(max(v))}for r,v in sorted(per_resolution.items())]},'courses':courses,'crossHolePlayingSurfaceIntersections':overlaps,'intersectionScope':'Different holes and different courses only. Same-hole green/fairway/tee/bunker layering is intentional and excluded. Positive intersection areas above0.01m2 retained for review.','sharedScenery':scenery,'markerPlacementValidation':{'sourceMarks':marker_count,'originalCoordinatesRetainedInProvenance':marker_source_preserved,'acceptedReferencesInsideDeclaredPad':marker_display_inside,'acceptedReferencesInsideReviewedFairway':marker_fairway_inside,'acceptedReferencesInsideBoundedMownArea':marker_mown_inside,'unresolvedReferencesWithoutPhysicalMarkerClaim':marker_unresolved,'meaning':'Accepted c values match explicit placement ledgers; inherited references remain in orthophotoReference.originalReference.c. Unresolved c values remain inherited and cannot establish a physical marker. Nine-hole colour ownership and all daily marker positions remain unverified.'},'markerRenderingValidation':marker_rendering,'baselineReference':{'gitCommit':PINNED_REF,'modelHashes':{slug:entry[2]for slug,entry in PINNED_MODELS.items()}},'boundaryInterpretationUncertaintyMetres':{'minimum':min(f['evidence']['uncertaintyM']for d in reviews for f in d['features']),'maximum':max(f['evidence']['uncertaintyM']for d in reviews for f in d['features']),'meaning':'Reviewer interpretation allowance per feature. Independent absolute source accuracy remains unmeasured.'},'unresolvedReferences':[{'path':str(DIR/f).replace('\\','/'),'section':'unresolved','count':len(d.get('unresolved',[]))}for f,d in zip(files,reviews)],'failureCount':len(failures),'failures':failures,'status':'passed-mechanical-checks-with-reviewed-shared-turf'if not failures and overlaps else 'passed-mechanical-checks'if not failures else 'failed'}
out['obPlacementValidation']=ob_validation
out['validationScope']+=' OB review also verifies source bytes, pixel-affine registration, illustrative post spacing and explicit unsurveyed-boundary policy.'
if not args.check_only:
 args.out.parent.mkdir(parents=True,exist_ok=True)
 args.out.write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'failures':failures,'overlaps':overlaps,'sources':len(sources),'pixelVertices':len(residuals),'maxRoundtripM':out['pixelRoundtrip']['maximumMetres'],'acceptedReferencesInsidePads':marker_display_inside,'originalReferencesPreserved':marker_source_preserved,'acceptedFairwayReferences':marker_fairway_inside,'acceptedMownAreaReferences':marker_mown_inside,'unresolvedReferences':marker_unresolved,'markerRendering':marker_rendering,'obPlacement':ob_validation}))

sys.exit(1 if failures else 0)
