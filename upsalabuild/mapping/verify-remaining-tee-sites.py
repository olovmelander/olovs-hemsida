"""Independent validation of the remaining tee-site navigation references.

Requires the acquired imagery and pinned pre-site models in local cache.
Does not call either JavaScript placement helper or change source geometry.
"""
from pathlib import Path
from hashlib import sha256
from copy import deepcopy
import json, math, csv
from datetime import datetime, timezone
from pyproj import Transformer
from shapely.geometry import Point, Polygon

ROOT=Path(__file__).resolve().parents[2]
read=lambda p:json.loads((ROOT/p).read_text(encoding='utf-8'))
hashfile=lambda p:sha256((ROOT/p).read_bytes()).hexdigest()
forward=Transformer.from_crs(4326,3006,always_xy=True)
checks=[];models=[];sources=[];moved=0;confirmed=0
for course,build in [('stora','upsalabuild'),('mellan','upsalamellanbuild')]:
 ledger_path=f'upsalabuild/mapping/lm-tee-site-review-{course}-2026-09-09.json'
 ledger=read(ledger_path);baseline_path=f'upsalabuild/cache/lm-remaining17-2026-09-09/{course}-baseline.json'
 baseline=read(baseline_path);model_path=f'{build}/course-model.json';model=read(model_path)
 assert ledger['baselineModelSha256']==hashfile(baseline_path),'Wrong pinned pre-site baseline'
 assert ledger['frame']=={k:model[k] for k in ['origin','mPerLat','mPerLon']}
 frame=ledger['frame'];expected=deepcopy(baseline);decisions={}
 def en(c):return forward.transform(frame['origin']['lon']+c[0]/frame['mPerLon'],frame['origin']['lat']-c[1]/frame['mPerLat'])
 for source in ledger['sources']:
  if source.get('path') and source.get('sha256'):
   assert hashfile(source['path'])==source['sha256'],f"Source bytes changed: {source['path']}"
   sources.append(dict(path=source['path'],sha256=source['sha256']))
 for record in ledger['holes']:
  n=record['hole'];before=baseline['holes'][n-1];after=model['holes'][n-1]
  assert record['originalTees']==before['tees'];assert record['originalLine']==before['line'];assert record['originalDistances']==before['t']
  assert after['tees']['pads']==before['tees']['pads'],'A support area became a physical pad'
  assert after['line']==before['line'] and after['t']==before['t'],'Route/card changed'
  for decision in record['decisions']:
   i=decision['markIndex'];old=before['tees']['marks'][i];new=after['tees']['marks'][i]
   assert 'referencePlacement' not in old,'An earlier accepted reference was replaced'
   assert new['c']==decision['reviewedPosition'];poly=Polygon(decision['supportRing']);point=Point(new['c'])
   assert poly.is_valid and poly.contains(point);clearance=poly.boundary.distance(point);assert clearance>=1
   shift=math.dist(old['c'],new['c']);assert shift<=decision['maxShiftMetres']+1e-9
   support=decision['supportEvidence'];gt=support['panel']['geoTransform']
   assert len(support['pixelRing'])==len(decision['supportRing'])==len(support['epsg3006Ring'])
   for pixel,projected,local in zip(support['pixelRing'],support['epsg3006Ring'],decision['supportRing']):
    wanted=[gt[0]+pixel[0]*gt[1]+pixel[1]*gt[2],gt[3]+pixel[0]*gt[4]+pixel[1]*gt[5]]
    assert math.dist(projected,wanted)<.001 and math.dist(en(local),wanted)<.003,'Pixel trace frame mismatch'
   pos=decision['positionEvidence'];assert math.dist(en(new['c']),pos['epsg3006'])<.003
   lon,lat=pos['wgs84LongitudeLatitude'];assert math.dist(en(new['c']),forward.transform(lon,lat))<.003
   marker=deepcopy(new);marker.pop('referencePlacement');marker['c']=old['c'];assert marker==old,'Changed non-position marker data'
   metadata=new['referencePlacement'];assert metadata['method']=='reviewed-visible-site-navigation-reference'
   assert metadata['siteClass']==decision['siteClass'] and metadata['supportFootprintIsPhysicalBoundary'] is False
   assert metadata['dailyMarkerPositionVerified'] is False
   decisions[(n,i)]=decision;moved+=shift>0;confirmed+=shift==0
   checks.append(dict(course=course,hole=n,markIndex=i,teeName=(['62','59','56','51','47','42'] if course=='stora' else ['White','Yellow','Blue','Red','Orange'])[i],siteClass=decision['siteClass'],shiftMetres=shift,visibleSupportClearanceMetres=clearance,local=new['c'],epsg3006=pos['epsg3006'],wgs84LongitudeLatitude=pos['wgs84LongitudeLatitude'],coordinateBasis=decision['coordinateBasis'],positionInterpretationUncertaintyMetres=decision.get('positionInterpretationUncertaintyMetres')))
  for i,old in enumerate(before['tees']['marks']):
   if (n,i) not in decisions:assert after['tees']['marks'][i]==old,'Unreviewed reference changed'
  # Only the reviewed reference coordinates and compact provenance may change.
  cleaned=deepcopy(after);cleaned['tees']=deepcopy(before['tees']);assert cleaned==before,'Other hole content changed'
  expected['holes'][n-1]=deepcopy(after)
 if course=='stora':expected['mappingRevision']=model['mappingRevision']
 assert expected==model,'Unrelated model content changed'
 models.append(dict(course=course,path=model_path,sha256=hashfile(model_path),baseline=dict(path=baseline_path,sha256=hashfile(baseline_path)),ledger=dict(path=ledger_path,sha256=hashfile(ledger_path))))

protected=read('upsalabuild/cache/lm-remaining17-2026-09-09/protected-terrain.json')
for item in protected:assert hashfile(item['path'])==item['sha256'],'Protected terrain changed'
assert len(checks)==17 and len({(r['course'],r['hole'],r['markIndex']) for r in checks})==17
result=dict(schemaVersion=1,reviewedAt=datetime.now(timezone.utc).isoformat(),passed=True,method='Independent Python/pyproj/Shapely validation without JavaScript placement helpers.',models=models,sourceFilesVerified=sources,referencesReviewed=len(checks),moved=moved,confirmedWithoutMovement=confirmed,physicalPadGeometryUnchanged=True,routesAndCardsUnchanged=True,earlier136ReferencesUnchanged=True,protectedTerrainFilesUnchanged=len(protected),checks=checks,limitations=['Navigation sites are reviewed; daily marker positions and absolute survey accuracy are not established.','Support polygons describe visible interior evidence only and are not physical pad outlines.','Mellan Orange points are approximate guide-identified fairway entries, not independently published GPS points.'])
(ROOT/'upsalabuild/mapping/lm-remaining17-validation-2026-09-09.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
with (ROOT/'upsalabuild/mapping/remaining17-tee-coordinates-2026-09-09.csv').open('w',newline='',encoding='utf-8') as handle:
 writer=csv.writer(handle)
 writer.writerow(['course','hole','tee','longitude','latitude','easting_epsg3006','northing_epsg3006','local_x','local_z','shift_metres','coordinate_basis','interpretation_uncertainty_metres','daily_marker_position_verified'])
 for row in checks:
  writer.writerow([row['course'],row['hole'],row['teeName'],*[f'{v:.9f}' for v in row['wgs84LongitudeLatitude']],*[f'{v:.3f}' for v in row['epsg3006']],*row['local'],f"{row['shiftMetres']:.3f}",row['coordinateBasis'],row['positionInterpretationUncertaintyMetres'],'false'])
print(json.dumps({k:result[k] for k in ['passed','referencesReviewed','moved','confirmedWithoutMovement','protectedTerrainFilesUnchanged']}))
