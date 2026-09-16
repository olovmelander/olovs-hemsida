"""Apply reviewed additions/merge, retain previous records, mask only decisions."""
from round3 import *
from stand_fields import mask_geometries
from scipy.spatial import cKDTree

def merged_measurement(features):
    geometry=unary_union([shape(f['geometry']) for f in features])
    with rasterio.open(OUT/'chm.tif') as src:
        window=from_bounds(*geometry.bounds,transform=src.transform).round_offsets().round_lengths()
        a=src.read(1,window=window);t=src.window_transform(window)
        mask=geometry_mask([mapping(geometry)],out_shape=a.shape,transform=t,invert=True)&np.isfinite(a)&(a>=2)
        rr,cc=np.where(mask);h=a[mask];assert len(h)>=6 and max(h)>=3
        x=t.c+(cc+.5)*t.a;y=t.f+(rr+.5)*t.e
    return geometry,float(np.average(x,weights=h)),float(np.average(y,weights=h)),float(max(h)),len(h)

def main():
    check_lock();decision_path=ROOT/'tools/visby-tree-pilot/round3-decisions.json';decisions=read(decision_path)
    candidates=read(WORK/'placement-candidates.geojson')['features'];scenes=read(WORK/'review-scenes.json')
    records=read(PREVIOUS/'pilot-records.json');old_footprints=read(PREVIOUS/'pilot-footprints.geojson')['features']
    sequence=max(int(r['id'].split('-')[-1]) for r in records+[{ 'id':f['properties']['id']} for f in old_footprints])
    original_points=cKDTree([[r['easting'],r['northing']] for r in records]);edits=[];footprints=[];clearings=[];accepted=[]
    holdout=protected()
    for scene in scenes:
        sid=scene['id'];d=decisions['scenes'][sid];meta=read(WORK/'review'/(sid+'.json'))
        fs=[f for f in candidates if f['properties']['scene']==sid];by_number={f['properties']['reviewNumber']:f for f in fs}
        merges=d.get('mergeCrowns',[]);merged_into={number:group[0] for group in merges for number in group[1:]}
        assert all(group[0] in d['accept'] and len(set(group))==len(group) for group in merges)
        named=d['accept']+d['retainExisting']+d['retainStand']+d.get('protectedEvaluation',[])+list(map(int,d['reject']))+list(map(int,d['hold']))+list(merged_into)
        assert sorted(named)==sorted(by_number) and len(named)==len(set(named)),sid+' needs exactly one decision for every candidate'
        for number,f in by_number.items():
            p=f['properties'];geometry=shape(f['geometry']);x=p['easting'];y=p['northing'];h=p['height'];supported=None
            group=next((g for g in merges if g[0]==number),None)
            if group:geometry,x,y,h,supported=merged_measurement([by_number[k] for k in group])
            if number in d['accept']:action='accept'
            elif number in d['retainExisting']:action='retain-existing'
            elif number in d['retainStand']:action='retain-stand'
            elif number in d.get('protectedEvaluation',[]):action='reserved-evaluation'
            elif str(number) in d['reject']:action='reject-not-tree'
            elif number in merged_into:action='merged-into'
            else:action='hold'
            edit=dict(candidateId=p['id'],scene=sid,cellId=scene['cellId'],hole=scene['hole'],affectedHoles=scene['holes'],reviewNumber=number,
                action=action,geometry=mapping(geometry),easting=x,northing=y,heightMetres=h,sourceWindows=meta['sources'],
                imageCapture='2026-04-10',lidarCaptureRange=['2024-02-03','2024-04-28'],seasonalCapture='2022; exact date unknown',
                positionKind='LiDAR height-weighted crown centre, not surveyed stem',horizontalUncertaintyMetres=2,
                uncertaintyKind='review judgement, not measured accuracy',nearestExistingId=p['nearestExistingId'],nearestExistingMetres=p['nearestExistingMetres'])
            if group:edit.update(mergedCandidateIds=[by_number[k]['properties']['id'] for k in group],supportedHeightCells=supported)
            if action=='accept':
                sequence+=1;tree_id=f'tree-visby-{sequence:06}';edit['id']=tree_id
                assert h>=3 and original_points.query([x,y])[0]>6,(sid,number,'Existing identity conflict')
                assert not geometry.buffer(2).intersects(holdout),(sid,number,'Protected evaluation overlap')
                assert geometry.covers(Point(x,y)),(sid,number,'Weighted centre lies outside its supported crown')
                radius=float(np.sqrt(geometry.area/np.pi))
                # Protect against a circular runtime crown extending into a frozen sample.
                assert not Point(x,y).buffer(radius+2).intersects(holdout),(sid,number,'Runtime crown overlaps protected evaluation')
                record=dict(id=tree_id,easting=x,northing=y,objectHeightMetres=h,radiusMetres=radius,
                    sourceId='visby-tree-pilot-round3-source-review',placementMethod='derived-lidar',horizontalAccuracyMetres=2,
                    verticalAccuracyMetres=1.5,confidence=.65,truthZone='A',capturedAt='2024-04-28')
                edit['record']=record
                hold=decisions['baseHolds'].get(p['id'])
                if hold:edit.update(action='hold-base',reason=hold,standMaskAction='unchanged; unresolved base does not authorize a clearing')
                else:
                    records.append(dict(**record,pilotEdit=True));accepted.append(edit)
                    edit.update(reason='Distinct crown corroborated by RGB/CIR and LiDAR; explicit source review promotes it from stand representation.' if not group else 'Two detections describe one isolated crown; reviewed union and LiDAR-weighted centre produce one individual.',standMaskAction='subtract individual crown footprint')
                    footprints.append(dict(type='Feature',geometry=mapping(geometry),properties=dict(id=tree_id,role='individual-crown',candidateId=p['id'])))
            elif action=='hold':edit['reason']=d['hold'][str(number)]
            elif action=='reject-not-tree':edit['reason']=d['reject'][str(number)]
            elif action=='merged-into':edit.update(mergedIntoCandidateId=by_number[merged_into[number]]['properties']['id'],reason='Reviewed fragment of the same isolated crown; no separate record.')
            elif action=='reserved-evaluation':edit['reason']='Frozen evaluation footprint; no placement or stand edits.'
            elif action=='retain-stand':edit['reason']='Connected woodland remains represented by measured stand coverage; no individual stem census claimed.'
            else:edit['reason']='An existing individual represents this crown; retain its identity and values.'
            edits.append(edit)
        w,s,e,n=meta['bounds']
        for i,ring in enumerate(decisions['clearingsPixels'].get(sid,[])):
            geometry=Polygon([(w+px/650*(e-w),n-py/650*(n-s)) for px,py in ring]).intersection(corridor())
            assert geometry.is_valid and not geometry.is_empty and not geometry.buffer(2).intersects(holdout),(sid,'Clearing must be in scope and outside protected evaluation')
            assert not any(geometry.covers(Point(r['easting'],r['northing'])) for r in records),'Clearing conflicts with an individual'
            clearings.append(dict(type='Feature',geometry=mapping(geometry),properties=dict(id=f'gap-{sid}-{i+1}',role='clearing',scene=sid,
                reviewed='agent source interpretation',imageCapture='2026-04-10',lidarCaptureRange=['2024-02-03','2024-04-28'],
                meaning='Reviewed open ground, not an independently surveyed forest boundary',sourceWindows=meta['sources'])))
    # Accepted records must not become neighbouring duplicate centres across cell seams.
    if len(accepted)>1:
        tree=cKDTree([[e['easting'],e['northing']] for e in accepted])
        assert not tree.query_pairs(4),[(accepted[a]['candidateId'],accepted[b]['candidateId']) for a,b in tree.query_pairs(4)]
    save(WORK/'pilot-record-drafts.json',records)
    save(WORK/'pilot-footprints.geojson',collection(old_footprints+footprints))
    save(DOC/'clearings.geojson',collection(clearings))
    cat=dict(version=3,groundId='visby',status='local-experiment-only',reviewer=decisions['reviewer'],positionPolicy=decisions['positionPolicy'],limits=decisions['limits'],
        previousPublicationSha256=digest(PREVIOUS/'publication.json'),inputLockSha256=digest(DOC/'input-lock.json'),decisionsSha256=digest(decision_path),
        candidatesSha256=digest(WORK/'placement-candidates.geojson'),detectorLockSha256=digest(PRIOR_DOC/'detector-lock.json'),edits=edits)
    save(DOC/'corrections.json',cat)
    save(DOC/'corrections.geojson',collection([dict(type='Feature',geometry=e['geometry'],properties={k:v for k,v in e.items() if k!='geometry'}) for e in edits]))
    inputs={i['tile']['id']:i for i in read(OUT/'stand-inputs/index.json')};jobs=[];changed=[]
    blockers=[shape(f['geometry']) for f in footprints+clearings]
    for job in read(PREVIOUS/'stand-output/index.json'):
        b=inputs[job['tileId']]['tile']['bounds'];region=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing'])
        old=np.fromfile(PREVIOUS/job['file'],dtype=np.uint8).reshape(job['height'],job['width'],4)
        transform=from_origin(b['minEasting'],b['maxNorthing'],job['cellMetres'],job['cellMetres'])
        blocked=mask_geometries([g for g in blockers if g.intersects(region)],transform,job['width'])
        new=old.copy();new[blocked,0:3]=0;new[blocked,3]|=4
        altered=not np.array_equal(old,new);target=WORK/job['file'];target.parent.mkdir(exist_ok=True);new.tofile(target)
        jobs.append(dict(job,changed=job['changed'] or altered,round3Changed=altered,sha256=digest(target),canopyAreaMetres2=float(np.sum(new[:,:,0]/255)*job['cellMetres']**2)))
        if altered:changed.append(dict(tileId=job['tileId'],cellMetres=job['cellMetres'],changedCells=int(np.any(old!=new,axis=2).sum()),removedStandCanopyMetres2=float(np.sum((old[:,:,0].astype(float)-new[:,:,0])/255)*job['cellMetres']**2)))
    save(WORK/'stand-output/index.json',jobs)
    save(DOC/'stand-summary.json',dict(changedTiles=len(changed),tiles=changed,newIndividualFootprints=len(footprints),reviewedClearings=len(clearings),
        fineTiles=sum(j['cellMetres']==1 for j in jobs),policy='Subtract accepted individual footprints and explicit reviewed clearings only. Base holds retain prior stands. All other previous-pilot cells remain byte-identical.'))
    coverage=read(DOC/'coverage-plan.geojson');observations=decisions.get('additionalObservations',[])
    for f in coverage['features']:
        p=f['properties']
        if not p['selected']:continue
        sid=p['scene'];local=[e for e in edits if e['scene']==sid];issues=[e['candidateId'] for e in local if e['action'].startswith('hold')]
        issues += [o['id'] for o in observations if o['scene']==sid]
        p.update(status='ambiguous' if issues else 'reviewed',inspected=True,reviewer=decisions['reviewer'],note=decisions['scenes'][sid]['note'],issueIds=issues,
            acceptedIndividuals=sum(e['action']=='accept' for e in local),sourceMetadata=str((WORK/'review'/(sid+'.json')).relative_to(ROOT)).replace('\\','/'))
    save(DOC/'coverage.geojson',coverage)
    check_lock();print({a:sum(e['action']==a for e in edits) for a in sorted(set(e['action'] for e in edits))},flush=True)

if __name__=='__main__':main()
