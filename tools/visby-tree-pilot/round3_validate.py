"""Validate the incremental preview against frozen inputs and rendered instances."""
from round3 import *
from validate import hits
from scipy.spatial import cKDTree

def main():
    check_lock();old=read(PREVIOUS/'pilot-records.json');new=read(WORK/'pilot-records.json');lookup={r['id']:r for r in new}
    assert len(lookup)==len(new) and all(lookup[r['id']]==r for r in old),'Prior record changed'
    cat=read(DOC/'corrections.json');accepted=[e for e in cat['edits'] if e['action']=='accept']
    assert len(new)==len(old)+len(accepted)
    baseline=read(OUT/'baseline.json');origin=baseline['ground']['frame']['origin'];holdout=protected()
    for f in baseline['identities']:assert digest(OUT/'before'/f['url'])==f['sha256']
    assert [r for r in old if holdout.covers(Point(r['easting'],r['northing']))]==[r for r in new if holdout.covers(Point(r['easting'],r['northing']))]
    inputs={i['tile']['id']:i for i in read(OUT/'stand-inputs/index.json')};fresh_cells=changed_cells=0
    for job in read(WORK/'stand-output/index.json'):
        before=np.fromfile(PREVIOUS/job['file'],dtype=np.uint8).reshape(job['height'],job['width'],4)
        after=np.fromfile(WORK/job['file'],dtype=np.uint8).reshape(before.shape);assert digest(WORK/job['file'])==job['sha256']
        changed=np.any(before!=after,axis=2);changed_cells+=int(changed.sum())
        assert np.all(after[:,:,0]<=before[:,:,0]) and np.all(after[changed,0:3]==0) and np.all(after[changed,3]&4)
        b=inputs[job['tileId']]['tile']['bounds'];region=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing'])
        if region.intersects(holdout):
            transform=from_origin(b['minEasting'],b['maxNorthing'],job['cellMetres'],job['cellMetres'])
            mask=geometry_mask([mapping(holdout)],out_shape=before.shape[:2],transform=transform,invert=True,all_touched=True)
            np.testing.assert_array_equal(before[mask],after[mask]);fresh_cells+=int(mask.sum())
    geometry={f['properties']['id']:shape(f['geometry']) for f in read(WORK/'pilot-footprints.geojson')['features']}
    footprints=[geometry.get(r['id'],Point(r['easting'],r['northing']).buffer(r['radiusMetres'])) for r in new]
    gaps=[shape(f['geometry']) for f in read(PRIOR_DOC.parent/'reference.geojson')['features'] if f['properties']['role']=='clearing']
    new_gaps=[shape(f['geometry']) for f in read(DOC/'clearings.geojson')['features']]
    results={};inspect='--inspect' in sys.argv
    for scenario in ['webgpu-high','webgl-high','webgl-low']:
        export=read(WORK/'captures'/(scenario+'-instances.json'))
        coords=np.array([[origin['easting']+a[0],origin['northing']-a[2],a[6]] for a in export['instances']])
        individual=coords[coords[:,2]==5];stands=coords[coords[:,2]==6];tree=cKDTree(individual[:,:2])
        missing=[dict(id=e['id'],candidateId=e['candidateId'],scene=e['scene'],number=e['reviewNumber']) for e in accepted if tree.query([e['easting'],e['northing']])[0]>.02]
        duplicates=hits(stands,footprints);intrusions=hits(coords,gaps);new_intrusions=hits(coords,new_gaps)
        results[scenario]=dict(drawn=export['total'],individuals=len(individual),standRepresentatives=len(stands),missingAccepted=missing,
            standBasesInsideIndividualFootprints=duplicates,basesInPreviousClearings=intrusions,basesInNewClearings=new_intrusions)
        if not inspect:assert not missing and duplicates==0 and intrusions==0 and new_intrusions==0,results[scenario]
    before=read(PREVIOUS/'captures/report.json');after=read(WORK/'captures/report.json');views=0
    assert len(before['runs'])==len(after['runs'])==3
    for br,ar in zip(before['runs'],after['runs']):
        assert br['scenario']==ar['scenario'] and br['state']['catalogue']==ar['state']['catalogue']
        assert br['state']['stats']['backend']==ar['state']['stats']['backend']
        assert not ar['errors'] and ar['state']['audit']['ok']
        assert ar['state']['objects']['loaded']['records']==len(new),'Capture used a stale object generation'
        assert not ar['state']['perf']['courseData']['fallbackReasons'],'Startup generation mismatch'
        for av in ar['views']:
            bv=next(v for v in br['views'] if (v['hole'],v['cam'])==(av['hole'],av['cam']))
            assert bv['camera']==av['camera'];assert digest(WORK/'captures'/av['file'])==av['sha256'];views+=1
    if not inspect:assert views==40,'All-hole matched views required'
    with rasterio.open(OUT/'chm.tif') as src:
        gap_support=[]
        for f in read(DOC/'clearings.geojson')['features']:
            g=shape(f['geometry']);win=from_bounds(*g.bounds,transform=src.transform).round_offsets().round_lengths();a=src.read(1,window=win)
            mask=geometry_mask([mapping(g)],out_shape=a.shape,transform=src.window_transform(win),invert=True);values=a[mask]
            gap_support.append(dict(id=f['properties']['id'],areaMetres2=g.area,finiteCellFraction=float(np.mean(np.isfinite(values))),
                cellsAboveThreeMetres=int(np.sum(values>=3)),maximumHeightMetres=float(np.nanmax(values)) if np.any(np.isfinite(values)) else None))
        assert all(g['cellsAboveThreeMetres']==0 and g['finiteCellFraction']>=.75 for g in gap_support),'Clearing lacks adequate height support'
    report=dict(status='inspection' if inspect else 'passed',previousRecords=len(old),records=len(new),acceptedAdditionalCrowns=len(accepted),
        actionCounts={a:sum(e['action']==a for e in cat['edits']) for a in sorted(set(e['action'] for e in cat['edits']))},
        previousRecordsUnchanged=True,productionAndPreviousRootsUnchanged=True,freshEvaluationUnedited=True,freshStandCellsVerified=fresh_cells,
        changedStandCells=changed_cells,matchedScreenshotPairs=views,rendered=results,newClearingHeightChecks=gap_support,
        detectorTargetMet=read(PRIOR_DOC/'evaluation.json')['passed'],newDetectorEvaluation=False)
    save(WORK/'inspection.json' if inspect else DOC/'validation.json',report);check_lock();print(json.dumps(report,indent=2))

if __name__=='__main__':main()
