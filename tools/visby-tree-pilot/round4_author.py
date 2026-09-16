"""Apply explicit cell review decisions to the retained third preview."""
from round4 import *
from stand_fields import mask_geometries
from round3_author import merged_measurement

def main():
    check_lock();path=ROOT/'tools/visby-tree-pilot/round4-decisions.json';decisions=read(path)
    fs=read(WORK/'placement-candidates.geojson')['features'];records=read(PREVIOUS/'pilot-records.json');old=[dict(r) for r in records]
    footprints=read(PREVIOUS/'pilot-footprints.geojson')['features'];new_footprints=[];edits=[];gaps=[]
    reserved=[e.get('id','tree-visby-000000') for e in read(PRIOR_DOC/'corrections.json')['edits']]
    sequence=max(int(id.split('-')[-1]) for id in reserved+[r['id'] for r in records]+[f['properties']['id'] for f in footprints])
    holdout=protected();accepted=[];baseline_points=cKDTree([[r['easting'],r['northing']] for r in old])
    for scene in read(WORK/'review-scenes.json'):
        sid=scene['id'];d=decisions['scenes'][sid];meta=read(WORK/'review'/(sid+'.json'));local=[f for f in fs if f['properties']['scene']==sid]
        assert d['inspected'] is True and len(d['note'])>20 and meta['validOwnedImageFraction']==1,sid
        focus=[f['properties']['reviewNumber'] for f in local if f['properties']['nearestExistingMetres']>6 and not f['properties']['protectedEvaluation']]
        named=d['accept']+d['stand']+list(map(int,d['hold']))+list(map(int,d['reject']))
        assert sorted(named)==sorted(focus) and len(set(named))==len(named),(sid,'Every focus candidate needs one explicit decision',focus,named)
        for f in local:
            p=f['properties'];n=p['reviewNumber'];g=shape(f['geometry']);x=p['easting'];y=p['northing'];h=p['height']
            if p['protectedEvaluation']:action='reserved-evaluation';reason='Frozen evaluation overlap; no placement or stand edit.'
            elif p['nearestExistingMetres']<=6:action='retain-nearby-representation';reason='Retain existing individual/stand treatment near this candidate. Proximity does not establish a separate stem or exact crown identity.'
            elif n in d['accept']:action='accept';reason='Distinct source crown corroborated in RGB/CIR, LiDAR and seasonal context; use its LiDAR-weighted position.'
            elif n in d['stand']:action='retain-stand';reason='Visually connected woodland retained as measured stand coverage; no distinct individual stem claimed.'
            elif str(n) in d['reject']:action='reject-not-tree';reason=d['reject'][str(n)]
            else:action='hold';reason=d['hold'][str(n)]
            edit=dict(candidateId=p['id'],scene=sid,cellId=scene['cellId'],hole=scene['hole'],affectedHoles=scene['holes'],reviewNumber=n,action=action,reason=reason,
                geometry=f['geometry'],easting=x,northing=y,heightMetres=h,sourceWindows=meta['sources'],imageCapture='2026-04-10',lidarCaptureRange=['2024-02-03','2024-04-28'],seasonalCapture='2022; exact date unknown',
                positionKind='LiDAR height-weighted crown centre; not surveyed stem',horizontalUncertaintyMetres=2,uncertaintyKind='review judgement, not measured accuracy',
                nearestExistingId=p['nearestExistingId'],nearestExistingMetres=p['nearestExistingMetres'],priorIssueIds=p['priorIssueIds'])
            if action=='accept':
                sequence+=1;id=f'tree-visby-{sequence:06}';edit['id']=id
                radius=float(np.sqrt(g.area/np.pi));assert h>=3 and baseline_points.query([x,y])[0]>6
                assert not g.buffer(2).intersects(holdout) and not Point(x,y).buffer(radius+2).intersects(holdout)
                assert not p['priorIssueIds'],(sid,n,'Cannot implicitly resolve an older case')
                assert g.covers(Point(x,y)),(sid,n,'Centre outside supported crown')
                record=dict(id=id,easting=x,northing=y,objectHeightMetres=h,radiusMetres=radius,sourceId='visby-tree-pilot-round4-source-review',placementMethod='derived-lidar',
                    horizontalAccuracyMetres=2,verticalAccuracyMetres=1.5,confidence=.65,truthZone='A',capturedAt='2024-04-28')
                edit['record']=record;hold=decisions.get('baseHolds',{}).get(p['id'])
                if hold:edit.update(action='hold-base',reason=hold,standMaskAction='Retain previous stand cells; unresolved base does not authorize clearing.')
                else:
                    edit['standMaskAction']='Subtract accepted crown footprint';records.append(dict(record,pilotEdit=True));accepted.append(edit)
                    new_footprints.append(dict(type='Feature',geometry=f['geometry'],properties=dict(id=id,role='individual-crown',candidateId=p['id'])))
            edits.append(edit)
        # Pixel annotations use the nominal LiDAR panel extent, not a raster
        # stretched from its native RGB pixel edge bounds.
        w,s,e,n=meta['bounds']
        for index,ring in enumerate(decisions.get('clearingsPixels',{}).get(sid,[])):
            g=Polygon([(w+px/650*(e-w),n-py/650*(n-s)) for px,py in ring]).intersection(corridor())
            assert g.is_valid and not g.is_empty and not g.buffer(2).intersects(holdout)
            assert not any(g.covers(Point(r['easting'],r['northing'])) for r in records)
            gaps.append(dict(type='Feature',geometry=mapping(g),properties=dict(id=f'gap-{sid}-{index+1}',role='clearing',scene=sid,reviewed='agent source interpretation',
                imageCapture='2026-04-10',lidarCaptureRange=['2024-02-03','2024-04-28'],meaning='Reviewed open ground; not an independent surveyed boundary',sourceWindows=meta['sources'])))
    if accepted:
        pairs=cKDTree([[c['easting'],c['northing']] for c in accepted]).query_pairs(4)
        assert not pairs,[(accepted[a]['candidateId'],accepted[b]['candidateId']) for a,b in pairs]
    save(WORK/'pilot-record-drafts.json',records);save(WORK/'pilot-footprints.geojson',collection(footprints+new_footprints));save(DOC/'clearings.geojson',collection(gaps))
    save(DOC/'corrections.json',dict(version=4,groundId='visby',status='local-experiment-only',reviewer=decisions['reviewer'],
        limits='Every editable review cell inspected; no stem census, new detector score, IR-only removal or implicit resolution of prior cases.',
        decisionsSha256=digest(path),inputLockSha256=digest(DOC/'input-lock.json'),previousPublicationSha256=digest(PREVIOUS/'publication.json'),
        candidatesSha256=digest(WORK/'placement-candidates.geojson'),detectorLockSha256=digest(DETECTOR_DOC/'detector-lock.json'),edits=edits))
    save(DOC/'corrections.geojson',collection([dict(type='Feature',geometry=e['geometry'],properties={k:v for k,v in e.items() if k!='geometry'}) for e in edits]))
    blockers=[shape(f['geometry']) for f in new_footprints+gaps];inputs={i['tile']['id']:i for i in read(OUT/'stand-inputs/index.json')};jobs=[];changes=[]
    (WORK/'stand-output').mkdir(exist_ok=True)
    for job in read(PREVIOUS/'stand-output/index.json'):
        b=inputs[job['tileId']]['tile']['bounds'];region=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing']);old=np.fromfile(PREVIOUS/job['file'],dtype=np.uint8).reshape(job['height'],job['width'],4)
        transform=from_origin(b['minEasting'],b['maxNorthing'],job['cellMetres'],job['cellMetres']);blocked=mask_geometries([g for g in blockers if g.intersects(region)],transform,job['width'])
        new=old.copy();new[blocked,0:3]=0;new[blocked,3]|=4;altered=not np.array_equal(old,new);target=WORK/job['file'];target.parent.mkdir(exist_ok=True);new.tofile(target)
        jobs.append(dict(job,changed=job['changed'] or altered,round4Changed=altered,sha256=digest(target),canopyAreaMetres2=float(np.sum(new[:,:,0]/255)*job['cellMetres']**2)))
        if altered:changes.append(dict(tileId=job['tileId'],cellMetres=job['cellMetres'],changedCells=int(np.any(old!=new,axis=2).sum()),removedStandCanopyMetres2=float(np.sum((old[:,:,0].astype(float)-new[:,:,0])/255)*job['cellMetres']**2)))
    save(WORK/'stand-output/index.json',jobs);save(DOC/'stand-summary.json',dict(changedTiles=len(changes),tiles=changes,newIndividualFootprints=len(new_footprints),reviewedClearings=len(gaps),
        fineTiles=sum(j['cellMetres']==1 for j in jobs),policy='Subtract accepted footprints and explicit reviewed gaps only; held bases retain prior stands. No eligibility expansion.'))
    coverage=read(DOC/'coverage-plan.geojson')
    for f in coverage['features']:
        p=f['properties']
        if not p['selected']:continue
        sid=p['scene'];d=decisions['scenes'][sid];issues=[e['candidateId'] for e in edits if e['scene']==sid and e['action'].startswith('hold')]
        issues += [o['id'] for o in decisions.get('additionalObservations',[]) if o['scene']==sid]
        p.update(status='ambiguous' if issues else 'reviewed',inspected=True,reviewer=decisions['reviewer'],reviewDate='2026-09-16',note=d['note'],issueIds=issues,
            acceptedIndividuals=sum(e['action']=='accept' and e['scene']==sid for e in edits),sourceMetadata=str((WORK/'review'/(sid+'.json')).relative_to(ROOT)).replace('\\','/'))
    save(DOC/'coverage.geojson',coverage);check_lock();print('Records',len(records),'new accepted',len(accepted),'source holds',sum(e['action'].startswith('hold') for e in edits),flush=True)

if __name__=='__main__':main()
