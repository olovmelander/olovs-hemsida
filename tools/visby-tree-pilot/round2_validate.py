"""Verify incremental edits, frozen evaluation and actual browser instances."""
from round2 import *
from validate import hits
from scipy.spatial import cKDTree

def main():
    old=read(OUT/'pilot-records.json');new=read(WORK/'pilot-records.json');lookup={r['id']:r for r in new}
    assert len(lookup)==len(new) and all(lookup[r['id']]==r for r in old),'Previous pilot record changed'
    cat=read(DOC/'corrections.json');accepted=[e for e in cat['edits'] if e['action']=='accept']
    assert len(new)==len(old)+len(accepted)
    assert cat['previousPublicationSha256']==digest(OUT/'publication.json')
    previous=read(OUT/'publication.json');assert digest(OUT/'after/courses/v2-index.json')==previous['graph']['rootSha256']
    baseline=read(OUT/'baseline.json')
    assert digest(ROOT/'apps/golf/public/courses/v2-index.json')==previous['productionRootSha256']
    for f in baseline['identities']:assert digest(OUT/'before'/f['url'])==f['sha256']
    detector=read(DOC/'detector-lock.json')
    assert digest(DOC/'reference.geojson')==detector['freshReferenceSha256']
    assert digest(ROOT/'tools/visby-tree-pilot/round2_benchmark.py')==detector['detectorCodeSha256']
    assert digest(ROOT/'tools/visby-tree-pilot/round2-detect.R')==detector['rCodeSha256']
    fresh=[box(*read(WORK/'review'/(s['id']+'.json'))['bounds']) for s in SCENES]
    fresh_union=unary_union(fresh)
    assert [r for r in old if fresh_union.covers(Point(r['easting'],r['northing']))]==[r for r in new if fresh_union.covers(Point(r['easting'],r['northing']))]
    inputs={i['tile']['id']:i for i in read(OUT/'stand-inputs/index.json')};fresh_cells=0;changed_cells=0
    for job in read(WORK/'stand-output/index.json'):
        before=np.fromfile(OUT/job['file'],dtype=np.uint8).reshape(job['height'],job['width'],4)
        after=np.fromfile(WORK/job['file'],dtype=np.uint8).reshape(before.shape)
        assert digest(WORK/job['file'])==job['sha256']
        changed_cells+=int(np.any(before!=after,axis=2).sum())
        # Existing canopy eligibility can only be subtracted; every changed cell is blocked.
        changed=np.any(before!=after,axis=2)
        assert np.all(after[:,:,0]<=before[:,:,0]) and np.all(after[changed,0:3]==0) and np.all(after[changed,3]&4)
        b=inputs[job['tileId']]['tile']['bounds'];region=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing'])
        if region.intersects(fresh_union):
            transform=from_origin(b['minEasting'],b['maxNorthing'],job['cellMetres'],job['cellMetres'])
            mask=geometry_mask([mapping(fresh_union)],out_shape=before.shape[:2],transform=transform,invert=True,all_touched=True)
            np.testing.assert_array_equal(before[mask],after[mask]);fresh_cells+=int(mask.sum())
    geometry={f['properties']['id']:shape(f['geometry']) for f in read(WORK/'pilot-footprints.geojson')['features']}
    footprints=[geometry.get(r['id'],Point(r['easting'],r['northing']).buffer(r['radiusMetres'])) for r in new]
    gaps=[shape(f['geometry']) for f in read(DOC.parent/'reference.geojson')['features'] if f['properties']['role']=='clearing']
    origin=baseline['ground']['frame']['origin'];results={}
    for scenario in ['webgpu-high','webgl-high','webgl-low']:
        export=read(WORK/'captures'/(scenario+'-instances.json'))
        coords=np.array([[origin['easting']+a[0],origin['northing']-a[2],a[6]] for a in export['instances']])
        individual=coords[coords[:,2]==5];stands=coords[coords[:,2]==6];tree=cKDTree(individual[:,:2])
        missing=[dict(id=e['id'],candidateId=e['candidateId'],scene=e['scene'],number=e['reviewNumber']) for e in accepted if tree.query([e['easting'],e['northing']])[0]>.02]
        duplicates=hits(stands,footprints);intrusions=hits(coords,gaps)
        results[scenario]=dict(drawn=export['total'],individuals=len(individual),standRepresentatives=len(stands),missingAccepted=missing,standBasesInsideIndividualFootprints=duplicates,basesInReviewedClearings=intrusions)
        if '--inspect' not in sys.argv:assert not missing and duplicates==0 and intrusions==0,results[scenario]
    b=read(OUT/'captures/after/report.json');a=read(WORK/'captures/report.json');views=0
    assert len(b['runs'])==len(a['runs'])==3,'Incomplete renderer captures'
    for br,ar in zip(b['runs'],a['runs']):
        assert br['scenario']==ar['scenario'] and br['state']['catalogue']==ar['state']['catalogue']
        assert br['state']['stats']['backend']==ar['state']['stats']['backend']
        assert not ar['errors'] and ar['state']['audit']['ok']
        for av in ar['views']:
            bv=next(v for v in br['views'] if (v['hole'],v['cam'])==(av['hole'],av['cam']))
            assert bv['camera']==av['camera'];assert digest(WORK/'captures'/av['file'])==av['sha256'];views+=1
    report=dict(status='inspected' if '--inspect' in sys.argv else 'passed',previousPilotRecords=len(old),records=len(new),acceptedAdditionalCrowns=len(accepted),
        retainedExistingDecisions=sum(e['action']=='retain-existing' for e in cat['edits']),heldCandidates=sum(e['action'].startswith('hold') for e in cat['edits']),
        previousRecordsUnchanged=True,productionRootUnchanged=True,previousPilotRootUnchanged=True,freshEvaluationUnedited=True,freshStandCellsVerified=fresh_cells,
        changedStandCells=changed_cells,matchedScreenshotPairs=views,rendered=results,detectorTargetMet=read(DOC/'evaluation.json')['passed'])
    if '--inspect' not in sys.argv:save(DOC/'validation.json',report)
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
