"""Independent source/grid and adopted-reference checks for Upsala tee review.

Run after both course models have been rebuilt:
  python upsalabuild/mapping/verify-lm-tee-alignment.py
--source-only verifies inputs/decisions before rebuilding, and writes its report
to ignored cache. Complete validation requires the pre-alignment model snapshots
and protected-file hashes in upsalabuild/cache/lm-tee-validation/. Their model
hashes must match the pinned native tee acquisition plan.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio
from rasterio.enums import ColorInterp
from shapely.geometry import Polygon,Point,box

ROOT=Path(__file__).resolve().parents[2]
REFERENCE=ROOT/'geo_data/course-v2/upsala/reference'
CACHE=ROOT/'upsalabuild/cache/lm-tees'
AUDIT=ROOT/'upsalabuild/cache/lm-tee-validation'


def load(file):
    return json.loads(file.read_text(encoding='utf-8'))


def sha(file):
    with file.open('rb') as handle:
        return hashlib.file_digest(handle,'sha256').hexdigest()


def relative(file):
    return file.relative_to(ROOT).as_posix()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-only',action='store_true')
    args=parser.parse_args()
    errors=[]
    def check(condition,message):
        if not condition:errors.append(message)
        return condition
    plan_file=REFERENCE/'lm-tee-plan-2026-09-09.json'
    acquisition_file=REFERENCE/'lm-tee-acquisition-2026-09-09.json'
    capture_file=REFERENCE/'lm-tee-capture-2026-09-09.json'
    plan=load(plan_file);acquisition=load(acquisition_file);capture=load(capture_file)
    check(plan['groundId']==acquisition['groundId']==capture['groundId']=='upsala','Ground identity mismatch')
    check(acquisition['planSha256']==capture['planSha256']==sha(plan_file)==sha(CACHE/'plan.json'),'Tee plan/acquisition/capture hash mismatch')
    check(acquisition['state']=='acquired-for-review' and acquisition['access']['authorized'],'Authenticated tee acquisition is not complete')
    windows={w['id']:w for w in plan['windows']};records={w['id']:w for w in acquisition['windows']}
    dates={w['id']:w for w in capture['windows']}
    check(len(windows)==len(records)==len(dates)==27 and set(windows)==set(records)==set(dates),'Incomplete native tee windows')
    source_rows=[]
    for identifier,w in windows.items():
        record=records[identifier];raster=CACHE/record['rasterFile'];rgb=CACHE/record['rgbFile']
        if not check(raster.parent==rgb.parent==CACHE,f'{identifier}: raster path outside cache'):continue
        check(sha(raster)==record['sha256'],f'{identifier}: final TIFF hash mismatch')
        check(sha(rgb)==record['rgbSha256'],f'{identifier}: final RGB hash mismatch')
        with rasterio.open(raster) as src:
            check(src.crs.to_epsg()==3006 and src.count==4 and src.dtypes==('uint8',)*4,f'{identifier}: source CRS/bands/dtype')
            check(src.colorinterp==(ColorInterp.red,ColorInterp.green,ColorInterp.blue,ColorInterp.undefined),f'{identifier}: NIR/alpha interpretation')
            check(src.width==w['width']==record['width'] and src.height==w['height']==record['height'],f'{identifier}: pixel dimensions')
            check(bool(np.allclose(src.res,[.16,.16],rtol=0,atol=1e-10)),f'{identifier}: native resolution')
            check(bool(np.allclose(src.bounds,w['boundsEpsg3006'],rtol=0,atol=1e-8)),f'{identifier}: source extent')
            check(bool(np.allclose(src.transform.to_gdal(),record['geoTransform'],rtol=0,atol=1e-8)),f'{identifier}: source transform')
            check(bool(np.all(src.dataset_mask()==255)),f'{identifier}: incomplete valid pixel mask')
            check(bool(np.array_equal(src.read([1,2,3]).transpose(1,2,0),np.array(Image.open(rgb)))),f'{identifier}: PNG differs from source RGB')
            world=list(map(float,rgb.with_suffix('.pgw').read_text().split()))
            check(bool(np.allclose(world,[.16,0,0,-.16,src.transform.c+.08,src.transform.f-.08],rtol=0,atol=1e-8)),f'{identifier}: worldfile pixel centres')
        check(dates[identifier]['coverageFraction']>.99999,f'{identifier}: incomplete source-image date coverage')
        check(all(i['capturedAt'].startswith('2025-06-14') for i in dates[identifier]['contributingImages']),f'{identifier}: unexpected source capture day')
        source_rows.append(dict(id=identifier,sha256=record['sha256'],rgbSha256=record['rgbSha256'],pixels=w['width']*w['height']))

    baselines={};models={};projectors={};inverse=Transformer.from_crs(3006,4326,always_xy=True)
    for m in plan['models']:
        before=AUDIT/(m['course']+'-baseline.json')
        if not before.exists():raise ValueError('Pinned pre-alignment model snapshot is missing: '+relative(before))
        check(sha(before)==m['sha256'],m['course']+': baseline snapshot differs from native acquisition model')
        baselines[m['course']]=load(before);models[m['course']]=load(ROOT/m['file'])
        frame=m['frame'];transformer=Transformer.from_crs(4326,3006,always_xy=True)
        projectors[m['course']]=lambda p,f=frame,t=transformer:t.transform(f['origin']['lon']+p[0]/f['mPerLon'],f['origin']['lat']-p[1]/f['mPerLat'])
        if not args.source_only:
            before_model=baselines[m['course']];current=models[m['course']]
            for key in set(before_model)|set(current):
                if key in ['holes','mappingRevision']:continue
                check(current.get(key)==before_model.get(key),m['course']+': unrelated model content changed: '+key)
    review_files=[ROOT/f'upsalabuild/mapping/lm-tee-review-{part}-2026-09-09.json' for part in ['front9','back9','mellan']]
    for f in review_files:
        if not f.exists():raise ValueError('Review ledger missing: '+relative(f))
    seen=set();rows=[];route_rows=[];projection_maximum=0;source_pixel_maximum=0
    for file in review_files:
        review=load(file);course=review['course'];baseline=baselines[course];model=models[course];project=projectors[course]
        frame={k:baseline[k] for k in ['origin','mPerLat','mPerLon']}
        check(review['frame']==frame,file.name+': declared frame mismatch')
        check(review['baselineModelSha256']==next(m['sha256'] for m in plan['models'] if m['course']==course),file.name+': baseline model identity')
        review_sources={s.get('id') or Path(s.get('path',s.get('rasterFile',''))).stem:s for s in review.get('sources',[])}
        for reviewed in review['holes']:
            n=reviewed['hole'];identity=f'{course}/{n}'
            check(identity not in seen,identity+': duplicate hole review');seen.add(identity)
            before=next(h for h in baseline['holes'] if h['n']==n);after=next(h for h in model['holes'] if h['n']==n)
            window=windows[f'{course}-{n:02d}-tees'];source=records[window['id']]
            check(window['id'] in review_sources,identity+': review omits its native source')
            if window['id'] in review_sources:
                check(review_sources[window['id']]['sha256']==source['sha256'],identity+': review source hash is stale')
            check(reviewed['originalMarks']==before['tees']['marks'],identity+': original references differ from snapshot')
            check(reviewed['originalLine']==before['line'],identity+': original route differs from snapshot')
            check(reviewed['originalDistances']==before['t'],identity+': original card distances differ from snapshot')
            check(sorted(d['markIndex'] for d in reviewed['referenceDecisions'])==list(range(len(before['tees']['marks']))),identity+': every reference needs exactly one decision')
            local_pads=[Polygon(p['ring']) for p in before['tees']['pads']]
            projected_pads=[Polygon([project(v) for v in p['ring']]) for p in before['tees']['pads']]
            for index,pad in enumerate(before['tees']['pads']):
                check(local_pads[index].is_valid and local_pads[index].area>1,identity+f'/P{index}: invalid physical pad')
                planned=window['features'][index]
                check(pad['ring']==planned['originalRing'] and pad.get('sourceId')==planned.get('sourceId'),identity+f'/P{index}: acquisition target differs')
                for original,grid in zip(pad['ring'],planned['ring']):
                    expected=project(original);projection_maximum=max(projection_maximum,math.dist(expected,grid))
                    lon,lat=inverse.transform(*grid)
                    local=[(lon-frame['origin']['lon'])*frame['mPerLon'],(frame['origin']['lat']-lat)*frame['mPerLat']]
                    check(math.dist(original,local)<.00001,identity+f'/P{index}: independent source-grid inverse projection')
                check(box(*window['boundsEpsg3006']).covers(projected_pads[index]),identity+f'/P{index}: physical pad outside source coverage')
            if not args.source_only:
                for key in set(before)|set(after):
                    if key in ['tees','line','lineLen','lenDev','teePadDist','routeStartReference']:continue
                    check(after.get(key)==before.get(key),identity+': unrelated hole content changed: '+key)
                for key in set(before['tees'])|set(after['tees']):
                    if key in ['marks','referenceReview','markProvenance']:continue
                    check(after['tees'].get(key)==before['tees'].get(key),identity+': physical tee or coverage content changed: '+key)
                check(len(after['tees']['marks'])==len(before['tees']['marks']),identity+': reference count changed')
            for decision in reviewed['referenceDecisions']:
                i=decision['markIndex'];label=identity+f'/M{i+1}';original=before['tees']['marks'][i]
                mark=original if args.source_only else after['tees']['marks'][i]
                old=Point(project(original['c']));new=Point(project(mark['c']))
                before_distance=min(old.distance(pad) for pad in projected_pads)
                after_distance=min(new.distance(pad) for pad in projected_pads)
                shift=math.dist(original['c'],mark['c'])
                row=dict(course=course,hole=n,markIndex=i,status=decision['status'],beforeDistanceToAnyPadMetres=round(before_distance,6),
                         beforeOnAnyPad=any(pad.covers(old) for pad in projected_pads))
                check(decision['status'] in ['align-to-observed-pad','retain'] and bool(decision.get('reason','').strip()),label+': missing decision or reason')
                if decision['status']=='align-to-observed-pad':
                    index=decision['padIndex'];pad=before['tees']['pads'][index];poly=local_pads[index]
                    check(decision['padSourceId']==pad.get('sourceId') and decision['originalPadRing']==pad['ring'],label+': chosen platform identity/boundary mismatch')
                    check(pad.get('preserveTerrain') is True and pad.get('prov') in ['dated-orthophoto-trace','ortho-trace'],label+': chosen platform lacks observed provenance')
                    limit=decision['maxShiftMetres'];check(isinstance(limit,(float,int)) and math.isfinite(limit) and limit>=0,label+': invalid explicit shift limit')
                    check(not poly.buffer(-1).is_empty,label+': selected platform has no 1 m interior')
                    row.update(padIndex=index,padSourceId=pad['sourceId'],maxShiftMetres=limit,beforeDistanceToChosenPadMetres=round(old.distance(projected_pads[index]),6))
                    if not args.source_only:
                        local_point=Point(mark['c']);clearance=poly.boundary.distance(local_point) if poly.covers(local_point) else -poly.distance(local_point)
                        grid_clearance=projected_pads[index].boundary.distance(new) if projected_pads[index].covers(new) else -projected_pads[index].distance(new)
                        check(clearance>=.999,label+': aligned reference lacks 1 m local interior clearance')
                        check(grid_clearance>=.999,label+': aligned reference lacks approximately 1 m source-grid clearance')
                        check(shift<=limit+1e-8,label+': applied shift exceeds reviewed bound')
                        check({k:v for k,v in mark.items() if k not in ['c','referencePlacement']}=={k:v for k,v in original.items() if k!='c'},label+': reference data/order changed beyond coordinate/provenance')
                        metadata=mark.get('referencePlacement',{})
                        check(metadata.get('padSourceId')==pad['sourceId'] and metadata.get('dailyMarkerPositionVerified') is False and metadata.get('teeColourAssociationVerified') is False,label+': reference provenance misstates marker identity')
                        check(set(metadata)=={'method','reviewId','padSourceId','boundaryClearanceMetres','shiftMetres','dailyMarkerPositionVerified','teeColourAssociationVerified','note'},label+': unexpected runtime evidence fields')
                        check(metadata.get('boundaryClearanceMetres')==1 and abs(metadata.get('shiftMetres',-1)-shift)<=.000501,label+': placement measurement metadata differs')
                        row.update(localInteriorClearanceMetres=round(clearance,6),sourceGridInteriorClearanceMetres=round(grid_clearance,6))
                elif not args.source_only:
                    check(mark==original,label+': explicitly retained reference changed')
                if not args.source_only:
                    west,south,east,north=window['boundsEpsg3006'];px=(new.x-west)/.16;py=(north-new.y)/.16
                    restored=(west+px*.16,north-py*.16);source_pixel_maximum=max(source_pixel_maximum,math.dist(restored,(new.x,new.y)))
                    check(0<=px<=window['width'] and 0<=py<=window['height'],label+': applied point outside native source coverage')
                    row.update(afterDistanceToAnyPadMetres=round(after_distance,6),afterOnAnyPad=any(pad.covers(new) for pad in projected_pads),shiftMetres=round(shift,6),shiftSourceGridMetres=round(old.distance(new),6))
                rows.append(row)
            if not args.source_only:
                expected=[p[:] for p in before['line']]
                first_moved=math.dist(before['tees']['marks'][0]['c'],after['tees']['marks'][0]['c'])>1e-9
                may_follow=first_moved and math.dist(before['line'][0],before['tees']['marks'][0]['c'])<=.2
                if may_follow:expected[0]=after['tees']['marks'][0]['c'][:]
                check(after['line']==expected,identity+': route changed outside approved coincident start')
                if may_follow:
                    length=sum(math.dist(a,b) for a,b in zip(expected,expected[1:]))
                    check(abs(after['lineLen']-round(length,1))<1e-8,identity+': changed route length is stale')
                    if 'lenDev' in before:
                        check(abs(after['lenDev']-round(abs(length-before['t'][0])/before['t'][0]*100,2))<1e-8,identity+': changed route length deviation is stale')
                    if 'teePadDist' in before:
                        distance=min(Point(expected[0]).distance(p.centroid) for p in local_pads)
                        check(abs(after['teePadDist']-round(distance,1))<1e-8,identity+': changed route platform distance is stale')
                    check(set(after.get('routeStartReference',{}))=={'method','reviewedAt','note'},identity+': unexpected route source evidence fields')
                else:
                    for key in ['lineLen','lenDev','teePadDist','routeStartReference']:
                        check(after.get(key)==before.get(key),identity+': unchanged route metadata changed: '+key)
                metadata=after['tees'].get('referenceReview',{})
                moved=sum(math.dist(a['c'],b['c'])>1e-9 for a,b in zip(before['tees']['marks'],after['tees']['marks']))
                retained=sum(d['status']=='retain' for d in reviewed['referenceDecisions'])
                check(metadata.get('movedReferenceCount')==moved and metadata.get('retainedReferenceCount')==retained and metadata.get('unresolvedReferencesRetained')==(retained>0) and metadata.get('dailyMarkerPositionsVerified') is False,identity+': reference review counts/provenance differ')
                route_rows.append(dict(course=course,hole=n,startMoved=may_follow,coincidentOriginalStart=math.dist(before['line'][0],before['tees']['marks'][0]['c'])<=.2,
                                       startShiftMetres=round(math.dist(before['line'][0],after['line'][0]),6),laterVerticesUnchanged=after['line'][1:]==before['line'][1:]))
    check(len(seen)==27 and len(rows)==153,'Review coverage is not all 27 holes / 153 references')
    check(projection_maximum<1e-8,'Native tee plan does not use the exact declared legacy frame')
    protected=load(AUDIT/'protected-files.json')
    if not args.source_only:
        for item in protected:
            path=ROOT/item['path'];check(path.exists() and path.stat().st_size==item['bytes'] and sha(path)==item['sha256'],'Protected terrain/heightfield changed: '+item['path'])
        current_terrain={relative(p) for p in (ROOT/'apps/golf/public/grounds/upsala/terrain').rglob('*') if p.is_file()}
        check(current_terrain=={p['path'] for p in protected if '/terrain/' in p['path']},'Terrain tile membership changed')
    summary=dict(reviewedHoles=len(seen),reviewedReferences=len(rows),alignDecisions=sum(r['status']=='align-to-observed-pad' for r in rows),retainDecisions=sum(r['status']=='retain' for r in rows),
                 beforeOnAnyPad=sum(r['beforeOnAnyPad'] for r in rows),beforeOutsideAnyPad=sum(not r['beforeOnAnyPad'] for r in rows),
                 maximumBeforeDistanceToPadMetres=max(r['beforeDistanceToAnyPadMetres'] for r in rows))
    if not args.source_only:
        summary.update(afterOnAnyPad=sum(r['afterOnAnyPad'] for r in rows),afterOutsideAnyPad=sum(not r['afterOnAnyPad'] for r in rows),
                       movedReferences=sum(r['shiftMetres']>0 for r in rows),maximumShiftMetres=max(r['shiftMetres'] for r in rows),
                       minimumAlignedInteriorClearanceMetres=min(r['localInteriorClearanceMetres'] for r in rows if r['status']=='align-to-observed-pad'),
                       movedRouteStarts=sum(r['startMoved'] for r in route_rows),protectedTerrainAndHeightfieldFiles=len(protected))
    report=dict(schemaVersion=1,groundId='upsala',kind='independent-tee-alignment-validation',observedAt=datetime.now(timezone.utc).isoformat(),
                state='failed' if errors else 'source-and-decisions-passed' if args.source_only else 'passed',
                method='Independent Python/pyproj/Shapely checks; does not call the JavaScript reference placement helper.',
                reviewFiles=[dict(path=relative(f),sha256=sha(f)) for f in review_files],
                sourcePlanSha256=sha(plan_file),sourceAcquisitionSha256=sha(acquisition_file),sourceCaptureSha256=sha(capture_file),
                validatorSha256=sha(Path(__file__)),models=[dict(course=m['course'],path=m['file'],baselineSha256=m['sha256'],currentSha256=sha(ROOT/m['file'])) for m in plan['models']],
                sourceWindows=source_rows,declaredFrameProjectionMaximumResidualMetres=projection_maximum,appliedSourcePixelRoundtripMaximumResidualMetres=source_pixel_maximum,
                summary=summary,references=rows,routes=route_rows,errors=errors,
                limitations=['Physical platform associations are manual review decisions; geometric checks do not independently identify daily tee colours or positions.',
                             'Retained unresolved references can remain off-pad by explicit decision.',
                             'Pixel resolution and internal coordinate agreement do not establish absolute surveyed accuracy.'])
    out=AUDIT/'source-decision-validation.json' if args.source_only else ROOT/'upsalabuild/mapping/lm-tee-alignment-validation-2026-09-09.json'
    out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(state=report['state'],**summary,errors=errors)))
    return 1 if errors else 0


if __name__=='__main__':
    raise SystemExit(main())
