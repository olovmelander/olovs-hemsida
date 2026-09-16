"""Apply six explicitly reviewed crown-size corrections, without moving bases."""
from round6 import *
from stand_fields import mask_geometries


def main():
    check_lock();decisions=read(ROOT/'tools/visby-tree-pilot/round6-decisions.json')
    scenes=read(WORK/'review-scenes.json');assert set(decisions['notes'])=={str(m['priority']) for m in scenes}
    records=read(PREVIOUS/'pilot-records.json');by_id={r['id']:r for r in records}
    old_footprints=read(PREVIOUS/'pilot-footprints.geojson')['features'];footprints={f['properties']['id']:f for f in old_footprints}
    points=np.array([[r['easting'],r['northing']] for r in records]);tree=cKDTree(points)
    issues=read(PRIOR_DOC/'issue-index.json')['cases'];issue_geoms=[shape(c['geometry']) for c in issues]
    probes={p['id']:p for p in read(WORK/'runtime-probes.json')['probes']}
    edits=[];journal=[];blockers=[]
    for m in scenes:
        rank=str(m['priority']);kind,note=decisions['notes'][rank];g=shape(m['geometry'])
        assert len(note)>40 and (WORK/'review'/(m['id']+'-board.png')).exists()
        item=dict(id=m['id'],gapId=m['gapId'],classification=kind,note=note,geometry=m['geometry'],areaMetres2=g.area,
            reviewed=True,reviewer=decisions['reviewer'],reviewDate=decisions['reviewDate'],sources=m['sources'],sourceDates=m['dates'],
            boardSha256=digest(WORK/'review'/(m['id']+'-board.png')),runtimeProbe=probes[m['id']],
            priorIssueIds=[c['id'] for c,geo in zip(issues,issue_geoms) if geo.intersection(g).area>0],
            status='reviewed-unresolved',positionMeaning='Crown evidence does not establish a surveyed trunk position.')
        if kind=='structure':item['status']='reviewed-non-tree'
        if kind=='resize':
            id=decisions['resize'][rank];r=by_id[id];p=Point(r['easting'],r['northing'])
            original=shape(footprints[id]['geometry']) if id in footprints else p.buffer(r['radiusMetres'])
            # Keep only native height pixels nearest the named tree; the
            # visually ambiguous portions remain in the unresolved gap ledger.
            w,s,e,n=m['bounds'];t=from_origin(w,n,1,1)
            mask=rasterize([(mapping(g),1)],out_shape=(m['size'],m['size']),transform=t).astype(bool)
            rr,cc=np.where(mask);xy=np.column_stack([w+cc+.5,n-rr-.5]);distance,nearest=tree.query(xy)
            keep=np.array([records[i]['id']==id for i in nearest]) & (distance<=r['radiusMetres']*1.6)
            selected=np.zeros_like(mask,dtype=np.uint8);selected[rr[keep],cc[keep]]=1
            addition=unary_union([shape(geo) for geo,value in shapes(selected,mask=selected>0,transform=t)]).intersection(g)
            updated=original.union(addition).buffer(0);assert addition.area>5
            assert not updated.buffer(2).intersects(protected())
            radius=round(float(np.sqrt(updated.area/np.pi)),3);assert r['radiusMetres']<radius<r['radiusMetres']*1.4
            edit=dict(id=id,action='resize-crown',scene=m['id'],reason=note,geometry=mapping(updated),additionGeometry=mapping(addition),
                before=dict(r),radiusBeforeMetres=r['radiusMetres'],radiusAfterMetres=radius,sourceWindows=m['sources'],sourceDates=m['dates'],
                sourcePositionUnchanged=True,uncertaintyKind='Interpreted crown extent; equivalent circular rendering radius, not measured stem accuracy.',priorIssueIds=item['priorIssueIds'])
            r['radiusMetres']=radius;r['sourceId']='visby-tree-pilot-round6-crown-review';edit['after']=dict(r);edits.append(edit)
            footprints[id]=dict(type='Feature',geometry=mapping(updated),properties=dict(id=id,role='individual-crown',reviewScene=m['id']))
            blockers.append(updated);item.update(status='crown-size-corrected',recordId=id,acceptedAdditionMetres2=addition.area,acceptedGeometry=mapping(addition))
        journal.append(item)
    assert len(edits)==6
    save(DOC/'review-journal.json',dict(reviewer=decisions['reviewer'],cases=journal,allSelectedInspected=True,
        limitation='79 large residual components reviewed; smaller components remain explicit. Review does not certify every tree or resolve older cases wholesale.'))
    save(DOC/'review-journal.geojson',collection([dict(type='Feature',geometry=j['geometry'],properties={k:v for k,v in j.items() if k not in ['geometry','sources','runtimeProbe']}) for j in journal]))
    save(DOC/'corrections.json',dict(version=6,status='local-experiment-only',previousPublicationSha256=digest(PREVIOUS/'publication.json'),inputLockSha256=digest(DOC/'input-lock.json'),
        decisionsSha256=digest(ROOT/'tools/visby-tree-pilot/round6-decisions.json'),edits=edits,addedTrees=0,removedTrees=0,basePositionsChanged=0))
    save(DOC/'corrections.geojson',collection([dict(type='Feature',geometry=e['geometry'],properties={k:v for k,v in e.items() if k not in ['geometry','additionGeometry','sourceWindows','before','after']}) for e in edits]))
    save(WORK/'pilot-record-drafts.json',records);save(WORK/'pilot-footprints.geojson',collection(list(footprints.values())))
    save(DOC/'clearings.geojson',collection([]))
    inputs={i['tile']['id']:i['tile']['bounds'] for i in read(OUT/'stand-inputs/index.json')};jobs=[];changes=[]
    for job in read(PREVIOUS/'stand-output/index.json'):
        b=inputs[job['tileId']];region=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing']);old=np.fromfile(PREVIOUS/job['file'],dtype=np.uint8).reshape(job['height'],job['width'],4)
        t=from_origin(b['minEasting'],b['maxNorthing'],job['cellMetres'],job['cellMetres']);blocked=mask_geometries([g for g in blockers if g.intersects(region)],t,job['width'])
        new=old.copy();new[blocked,0:3]=0;new[blocked,3]|=4;changed=np.any(new!=old,axis=2)
        target=WORK/job['file'];target.parent.mkdir(exist_ok=True);new.tofile(target)
        jobs.append(dict(job,changed=job['changed'] or bool(changed.any()),round6Changed=bool(changed.any()),sha256=digest(target),canopyAreaMetres2=float(np.sum(new[:,:,0]/255)*job['cellMetres']**2)))
        if changed.any():changes.append(dict(tileId=job['tileId'],cellMetres=job['cellMetres'],changedCells=int(changed.sum()),removedStandCanopyMetres2=float(np.sum((old[:,:,0].astype(float)-new[:,:,0])/255)*job['cellMetres']**2)))
    save(WORK/'stand-output/index.json',jobs);save(DOC/'stand-summary.json',dict(tiles=changes,changedTiles=len(changes),newIndividualFootprints=0,resizedIndividualFootprints=len(edits),
        fineTiles=sum(j['cellMetres']==1 for j in jobs),policy='Subtract reviewed crown extensions only; no stand eligibility expansion, new clearing, base relocation or ground-rule override.'))
    check_lock();print(json.dumps([dict(id=e['id'],before=e['radiusBeforeMetres'],after=e['radiusAfterMetres'],area=shape(e['additionGeometry']).area) for e in edits],indent=2))


if __name__=='__main__':main()
