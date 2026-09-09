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
from shapely.geometry import Polygon,Point

PINNED_REF='7aac4d4495e78d9321889273b34ad6d1bb12290a'
PINNED_MODELS={
 'johannesberg':('eighteen','johannesbergbuild/course-model.json','9cdec310df0f70a39b86f440fb6397309c7c175b668fba26683148864f392e69'),
 'johannesberg-9':('nine','johannesberg9build/course-model.json','f1b767a3ce03ac21c25daf485a8fa4d0f595c948844ad7dc146c53eae082b2b3'),
}
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline-dir',type=Path,help='Optional exact archived baselines; filenames eighteen.json and nine.json')
parser.add_argument('--out',type=Path,default=Path('johannesbergbuild/mapping/lm-alignment-validation.json'))
args=parser.parse_args()
BASE=args.baseline_dir

DIR=Path('johannesbergbuild/mapping')
files=['lm-review-front9.json','lm-review-back9.json','lm-review-back9-turf.json','lm-review-nine.json']
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
# Replaying against pinned originals also validates every accepted-original hash.
node_program="""
import fs from 'node:fs';
import {applyOrthoReview,legacyHeightfieldSampler} from './johannesbergbuild/mapping/apply-ortho-review.mjs';
const before=BASELINES;
const heightAt=legacyHeightfieldSampler(JSON.parse(fs.readFileSync('johannesbergbuild/heightfields.json')).hf0);
const planned={};
for(const [slug,ledgers]of [['johannesberg',['front9','back9','back9-turf']],['johannesberg-9',['nine']]]){
 let model=before[slug];
 for(const file of ledgers)model=applyOrthoReview(model,JSON.parse(fs.readFileSync('johannesbergbuild/mapping/lm-review-'+file+'.json')),{heightAt});
 planned[slug]=model;
}
process.stdout.write(JSON.stringify(planned));
""".replace('BASELINES',json.dumps(before,separators=(',',':')))
planned=json.loads(subprocess.run(['node','--input-type=module'],input=node_program,text=True,encoding='utf-8',capture_output=True,check=True).stdout)

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

def counts(m):
 return {'greens':len(m['holes']),'fairwayRings':sum(len(h['fairway']['rings'])for h in m['holes']),'teePlatforms':sum(len(h['tees']['pads'])for h in m['holes']),'bunkers':sum(len(h['bunkers'])for h in m['holes']),'waterBodies':len(m['water']),'streams':len(m['streams'])}

courses=[];shapes=[];marker_count=0;marker_source_preserved=0;marker_display_inside=0
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
  if len(new['tees']['marks'])!=len(old['tees']['marks']):failures.append({'check':'source-marker-count','course':slug,'hole':n})
  for oldmark,mark in zip(old['tees']['marks'],new['tees']['marks']):
   marker_count+=1
   if mark['c']==oldmark['c']:marker_source_preserved+=1
   else:failures.append({'check':'original-marker-c-retained','course':slug,'hole':n,'teeIdx':mark.get('teeIdx')})
   index=mark.get('displayPadIndex');display=mark.get('displayC')
   if isinstance(index,int)and 0<=index<len(new['tees']['pads'])and isinstance(display,list)and len(display)==2 and Polygon(new['tees']['pads'][index]['ring']).covers(Point(display)):
    marker_display_inside+=1
   else:failures.append({'check':'display-anchor-in-declared-physical-pad','course':slug,'hole':n,'teeIdx':mark.get('teeIdx')})
   if mark.get('displayC') is not None and 'unverified'not in new['tees'].get('markerPositionStatus',''):failures.append({'check':'display-marker-provisional-status','course':slug,'hole':n})

  if not newp.covers(Point(new['green']['c'])):failures.append({'check':'green-target-containment','course':slug,'hole':n})
  if not newp.covers(Point(new['pin'])):failures.append({'check':'pin-containment','course':slug,'hole':n})
  if not newp.covers(Point(new['line'][-1])):failures.append({'check':'route-end-containment','course':slug,'hole':n})
  if new['line'][0]!=old['line'][0] or new['tees']['marks'][0]['c']!=old['tees']['marks'][0]['c']:failures.append({'check':'inherited-tee-start-preserved','course':slug,'hole':n})
  holes.append({'hole':n,'greenAreaBeforeM2':rt(oldp.area),'greenAreaAfterM2':rt(newp.area),'greenCentroidMovementM':rt(oldp.centroid.distance(newp.centroid)),'targetMovementM':rt(math.dist(old['green']['c'],new['green']['c'])),'routingEndInsideGreen':True,'countsBefore':{k:v for k,v in counts({'holes':[old],'water':[],'streams':[]}).items()if k not in ['waterBodies','streams']},'countsAfter':{k:v for k,v in counts({'holes':[new],'water':[],'streams':[]}).items()if k not in ['waterBodies','streams']}})
  groups={'green':[new['green']['ring']],'fairway':new['fairway']['rings'],'tee':[p['ring']for p in new['tees']['pads']],'bunker':[p['ring']for p in new['bunkers']]}
  for kind,rings in groups.items():
   for i,r in enumerate(rings):
    p=Polygon(r)
    if not p.is_valid:failures.append({'check':'generated-ring-validity','course':slug,'hole':n,'kind':kind,'index':i})
    shapes.append({'course':slug,'hole':n,'kind':kind,'index':i,'polygon':p})
 courses.append({'course':slug,'model':{'path':actual_paths[slug],'sha256':sha(actual_paths[slug])},'countsBefore':counts(baseline),'countsAfter':counts(m),'holes':holes})

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

out={'schemaVersion':1,'groundId':'johannesberg','validatedOn':'2026-09-09','validationScope':'Mechanical source-to-authored-pixel registration, actual generated playing models, geometry validity, green endpoint containment, provisional display anchors and shared scenery. This is not an independent survey or a measured absolute positional accuracy claim.','sourceCaptureDate':'2025-06-14','sourceFilesVerified':len(sources),'sourceHashesVerified':not any(f['check']=='source-checksum'for f in failures),'reviews':per_review,'pixelRoundtrip':{'method':'pyproj EPSG:4326 to EPSG:3006 from declared legacy origin/metres-per-degree; compared with retained source-panel pixel-edge affine. Residual measures coordinate quantization/reprojection only.','passThresholdMetres':0.01,'thresholdMeaning':'Centimetre bound covers retained0.01m coordinate rounding and forward/inverse projection; it is not source positional accuracy.','vertexCount':len(residuals),'maximumMetres':rt(max(residuals,default=0)),'byPanelPixelResolution':[{'resolutionM':r,'vertexCount':len(v),'maximumMetres':rt(max(v))}for r,v in sorted(per_resolution.items())]},'courses':courses,'crossHolePlayingSurfaceIntersections':overlaps,'intersectionScope':'Different holes and different courses only. Same-hole green/fairway/tee/bunker layering is intentional and excluded. Positive intersection areas above0.01m2 retained for review.','sharedScenery':scenery,'markerDisplayValidation':{'sourceMarks':marker_count,'originalCoordinatesRetained':marker_source_preserved,'displayAnchorsInsideDeclaredPad':marker_display_inside,'meaning':'displayC is a provisional visual anchor on a photographed physical pad; original c is retained. Official tee-colour ownership and daily marker placement remain unverified.'},'baselineReference':{'gitCommit':PINNED_REF,'modelHashes':{slug:entry[2]for slug,entry in PINNED_MODELS.items()}},'boundaryInterpretationUncertaintyMetres':{'minimum':min(f['evidence']['uncertaintyM']for d in reviews for f in d['features']),'maximum':max(f['evidence']['uncertaintyM']for d in reviews for f in d['features']),'meaning':'Reviewer interpretation allowance per feature. Independent absolute source accuracy remains unmeasured.'},'unresolvedReferences':[{'path':str(DIR/f).replace('\\','/'),'section':'unresolved','count':len(d.get('unresolved',[]))}for f,d in zip(files,reviews)],'failureCount':len(failures),'failures':failures,'status':'passed-mechanical-checks-with-reviewed-shared-turf'if not failures and overlaps else 'passed-mechanical-checks'if not failures else 'failed'}
args.out.parent.mkdir(parents=True,exist_ok=True)
args.out.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'failures':failures,'overlaps':overlaps,'sources':len(sources),'pixelVertices':len(residuals),'maxRoundtripM':out['pixelRoundtrip']['maximumMetres'],'displayMarkersInsidePads':marker_display_inside,'sourceMarksPreserved':marker_source_preserved}))

sys.exit(1 if failures else 0)
