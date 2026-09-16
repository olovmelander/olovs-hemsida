"""Publish only explicit decisions; preserve the previous pilot and blind sample."""
from round2 import *
from stand_fields import mask_geometries

def main():
    decision=read(ROOT/'tools/visby-tree-pilot/round2-decisions.json')
    records=read(OUT/'pilot-records.json');candidates=read(WORK/'placement-candidates.geojson')
    old_footprints=read(OUT/'pilot-footprints.geojson')['features']
    sequence=max(int(f['properties']['id'].split('-')[-1]) for f in old_footprints)
    sequence=max(sequence,max(int(r['id'].split('-')[-1]) for r in records))
    edits=[];new_footprints=[]
    for f in candidates['features']:
        p=f['properties'];scene=p['scene'];number=p['reviewNumber'];d=decision['scenes'][scene]
        counts=int(number in d['accept'])+int(number in d['retainExisting'])+int(str(number) in d['hold'])
        assert counts==1,'Each reviewed candidate must have exactly one decision'
        action='accept' if number in d['accept'] else 'retain-existing' if number in d['retainExisting'] else 'hold'
        meta=read(WORK/'review'/(scene+'.json'))
        edit=dict(candidateId=p['id'],scene=scene,reviewNumber=number,action=action,geometry=f['geometry'],
            easting=p['easting'],northing=p['northing'],heightMetres=p['height'],sourceWindows=meta['sources'],
            imageCapture='2026-04-10',lidarCaptureRange=['2024-02-03','2024-04-28'],
            uncertaintyMetres=2,positionKind='LiDAR height-weighted crown centre, not measured trunk',
            nearestExistingId=p['nearestExistingId'],nearestExistingMetres=p['nearestExistingMetres'])
        if action=='accept':
            # Reserve IDs also for base holds, so accepted IDs never shift on rerun.
            sequence+=1;tree_id=f'tree-visby-{sequence:06}';edit['id']=tree_id
            assert p['height']>=3 and p['nearestExistingMetres']>6,'Ambiguous duplicate needs explicit review'
            hold=decision['baseHolds'].get(p['id']);poly=shape(f['geometry'])
            candidate=dict(id=tree_id,easting=p['easting'],northing=p['northing'],objectHeightMetres=p['height'],
                radiusMetres=float(np.sqrt(poly.area/np.pi)),sourceId='visby-tree-pilot-round2-source-review',placementMethod='derived-lidar',
                horizontalAccuracyMetres=2,verticalAccuracyMetres=1.5,confidence=.65,truthZone='A',capturedAt='2024-04-28')
            edit['record']=candidate
            if hold:edit.update(action='hold-base',reason=hold)
            else:records.append(dict(**candidate,pilotEdit=True));edit['reason']='Distinguishable LiDAR crown corroborated by RGB/CIR; source-reviewed addition replaces stand representation.'
            new_footprints.append(dict(type='Feature',geometry=f['geometry'],properties=dict(id=tree_id,role='unresolved-crown-overhang' if hold else 'individual-crown',candidateId=p['id'])))
        elif action=='hold':edit['reason']=d['hold'][str(number)]
        else:edit['reason']='Existing individual already represents this crown; preserve its record.'
        edits.append(edit)
    save(WORK/'pilot-record-drafts.json',records)
    save(WORK/'pilot-footprints.geojson',dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),features=old_footprints+new_footprints))
    catalogue=dict(version=2,groundId='visby',status='local-experiment-only',reviewer=decision['reviewer'],positionPolicy=decision['positionPolicy'],
        previousPublicationSha256=digest(OUT/'publication.json'),decisionsSha256=digest(ROOT/'tools/visby-tree-pilot/round2-decisions.json'),
        candidatesSha256=digest(WORK/'placement-candidates.geojson'),freshReferenceSha256=digest(DOC/'reference.geojson'),limits=decision['limits'],edits=edits)
    save(DOC/'corrections.json',catalogue)
    # Only subtract the new footprints from the first pilot's already refined fields.
    inputs={i['tile']['id']:i for i in read(OUT/'stand-inputs/index.json')};jobs=[];changed=[]
    blockers=[shape(f['geometry']) for f in new_footprints]
    for job in read(OUT/'stand-output/index.json'):
        b=inputs[job['tileId']]['tile']['bounds'];region=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing'])
        old=np.fromfile(OUT/job['file'],dtype=np.uint8).reshape(job['height'],job['width'],4)
        transform=from_origin(b['minEasting'],b['maxNorthing'],job['cellMetres'],job['cellMetres'])
        mask=mask_geometries([g for g in blockers if g.intersects(region)],transform,job['width'])
        new=old.copy();new[mask,0:3]=0;new[mask,3]|=4
        altered=not np.array_equal(old,new);target=WORK/job['file'];target.parent.mkdir(exist_ok=True);new.tofile(target)
        newjob=dict(job,changed=job['changed'] or altered,sha256=digest(target),round2Changed=altered,
            canopyAreaMetres2=float(np.sum(new[:,:,0]/255)*job['cellMetres']**2))
        jobs.append(newjob)
        if altered:changed.append(dict(tileId=job['tileId'],cellMetres=job['cellMetres'],changedCells=int(np.any(old!=new,axis=2).sum()),
            removedStandCanopyMetres2=float(np.sum((old[:,:,0].astype(float)-new[:,:,0])/255)*job['cellMetres']**2)))
    save(WORK/'stand-output/index.json',jobs)
    save(DOC/'stand-summary.json',dict(changedTiles=len(changed),tiles=changed,newFootprints=len(new_footprints),
        fineTiles=sum(j['cellMetres']==1 for j in jobs),policy='Subtract new reviewed individual footprints; retain all other previous-pilot stand cells byte-for-byte.'))
    print({a:sum(e['action']==a for e in edits) for a in ['accept','retain-existing','hold','hold-base']})

if __name__=='__main__':main()
