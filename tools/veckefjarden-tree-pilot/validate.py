"""Validate actual shared-ground output and actual rendered positions."""
from prepare import *
from shapely import points, contains_xy
from shapely.strtree import STRtree
from scipy.spatial import cKDTree

def epsg_instances(mode,run):
 a=np.array(read(OUT/f'captures/{mode}/{run["slug"]}-{run["scenario"]}-instances.json')['instances'],dtype=object)
 b=run['state']['terrain']['bridge'];o=read(OUT/'baseline.json')['ground']['frame']['origin']
 x=a[:,0].astype(float)/b['scaleX'];z=a[:,2].astype(float)/b['scaleZ'];c=np.cos(b['rotationRadians']);s=np.sin(b['rotationRadians'])
 return np.column_stack([o['easting']-b['translateX']+x*c+z*s,o['northing']+b['translateZ']+x*s-z*c,a[:,6].astype(int)])

def main():
 check_lock();baseline=read(OUT/'baseline.json');old=read(OUT/'baseline-records.json');new=read(OUT/'pilot-records.json');byid={r['id']:r for r in new}
 assert len(byid)==len(new) and all(byid[r['id']]==r for r in old)
 for f in baseline['identities']:assert digest(OUT/'before'/f['url'])==f['sha256'],f['url']
 assert digest(ROOT/'apps/golf/public/courses/v2-index.json')==baseline['productionRootSha256']
 scope=shape(read(DOC/'facility-scope.geojson')['features'][0]['geometry']);hold=shape(read(DOC/'protected-evaluation.geojson')['features'][0]['geometry'])
 corrections=read(DOC/'corrections.geojson')['features'];accepted=[f['properties'] for f in corrections if f['properties']['decision']=='accepted-source-reviewed-individual']
 acceptedPoints=np.array([[p['easting'],p['northing']] for p in accepted]);assert len(acceptedPoints)==read(DOC/'corrections.json')['accepted']
 assert all(not hold.intersects(shape(f['geometry'])) for f in corrections if f['properties']['decision']=='accepted-source-reviewed-individual')
 cells=read(DOC/'coverage-plan.geojson')['features'];union=unary_union([shape(f['geometry']) for f in cells])
 assert union.symmetric_difference(scope).area<.001 and abs(sum(shape(f['geometry']).area for f in cells)-scope.area)<.001
 assert len({f['properties']['id'] for f in cells})==131
 refs=read(DOC/'reference-freeze.json');assert digest(DOC/'reference.geojson')==refs['sha256']
 assert refs['counts']['evaluation']>=30 and sum(refs['counts'].values())>=100
 inspections=read(DOC/'coverage-inspection.geojson')['features'];assert len(inspections)==131 and all(f['properties']['inspected'] for f in inspections)
 for f in inspections:assert digest(OUT/f['properties']['contactSheet'])==f['properties']['contactSheetSha256']
 before=read(OUT/'captures/before/report.json');after=read(OUT/'captures/after/report.json');assert len(before['runs'])==len(after['runs'])==6
 results=[];views=0;failures=[]
 for br,ar in zip(before['runs'],after['runs']):
  assert br['slug']==ar['slug'] and br['scenario']==ar['scenario']
  assert br['state']['catalogue']==ar['state']['catalogue'];assert ar['state']['audit']['ok'] and not ar['errors']
  assert ar['state']['perf']['courseData']['fallbackReasons']==[]
  assert len(br['views'])==len(ar['views'])
  for bv,av in zip(br['views'],ar['views']):
   assert (bv['hole'],bv['cam'],bv['camera'])==(av['hole'],av['cam'],av['camera'])
   assert digest(OUT/'captures/before'/bv['file'])==bv['sha256'] and digest(OUT/'captures/after'/av['file'])==av['sha256'];views+=1
  row=dict(slug=ar['slug'],scenario=ar['scenario'])
  for mode,run,recs in [('before',br,old),('after',ar,new)]:
   coords=epsg_instances(mode,run);owned=contains_xy(scope,coords[:,0],coords[:,1])
   individuals=coords[coords[:,2]==5];stands=coords[(coords[:,2]==6)&owned];tree=cKDTree(individuals[:,:2]);distance=tree.query(acceptedPoints)[0]
   missing=[p['id'] for p,d in zip(accepted,distance) if d>.025]
   footprints=[Point(r['easting'],r['northing']).buffer(max(0,r['radiusMetres']-.02)) for r in recs if scope.buffer(20).covers(Point(r['easting'],r['northing']))]
   dup=STRtree(footprints).query(points(stands[:,:2]),predicate='within');duplicates=len(set(dup[0].tolist()))
   promoted=[Point(p['easting'],p['northing']).buffer(p['radiusMetres']-.02) for p in accepted]
   nearNew=STRtree(promoted).query(points(stands[:,:2]),predicate='within')
   row[mode]=dict(drawnInFacility=int(owned.sum()),individualsInFacility=int(np.sum(owned&(coords[:,2]==5))),standRepresentativesInFacility=len(stands),
    standBasesInsideAnyIndividualFootprint=duplicates,standBasesInsidePromotedFootprints=len(set(nearNew[0].tolist())),missingAccepted=missing)
   if mode=='after' and missing:failures.append(dict(slug=ar['slug'],scenario=ar['scenario'],missing=missing))
   if mode=='after' and len(nearNew[0]):failures.append(dict(slug=ar['slug'],scenario=ar['scenario'],duplicateBasesAtPromotions=len(set(nearNew[0].tolist()))))
  results.append(row)
 assert views==62
 pub=read(OUT/'publication.json');assert pub['graphs'][0]['references']['ground']['sha256']==pub['graphs'][1]['references']['ground']['sha256']
 report=dict(status='passed' if not failures else 'failed',failures=failures,productionUnchanged=True,unchangedBaselineRecords=len(old),newRecords=len(new)-len(old),matchedScreenshotPairs=views,sharedGround=True,
  sourceInspectedCells=131,referenceCounts=refs['counts'],rendered=results,sourceAreaCoverage=read(DOC/'coverage-summary.json'),
  detectorTargetsMet=read(DOC/'benchmark.json')['passed'],default='baseline',
  caveats=['Source inspection is complete; exhaustive crown identity and the accuracy target remain unresolved.',
   'Protected evaluation cells retain baseline vegetation; diagnostic detector results do not constitute published improvement there.',
   'Runtime coordinate checks use Veckefjarden rotation/scale/datum bridge, not a Visby translation.'])
 save(DOC/'validation.json',report);print(json.dumps(dict(status=report['status'],newRecords=report['newRecords'],matchedPairs=views,failures=failures),indent=2))
 assert not failures,'Runtime gates failed; see validation.json'

if __name__=='__main__':main()
