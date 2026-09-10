"""Independent followup checks against the saved post-83-reference baseline.

Run after rebuilding both course models. Requires local native tee imagery and
upsalabuild/cache/lm-tee-followup-validation baseline snapshots. Historical
initial-review ledgers/reports are hash-checked and never rewritten.
"""
import argparse
from datetime import datetime,timezone
import hashlib,json,math
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio
from rasterio.enums import ColorInterp
from shapely.geometry import Point,Polygon

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'upsalabuild/cache/lm-tee-followup-validation'
MAPPING=ROOT/'upsalabuild/mapping'

def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def rel(path):return path.relative_to(ROOT).as_posix()
def clearance(poly,point):
    p=Point(point)
    return poly.boundary.distance(p) if poly.covers(p) else -poly.distance(p)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-only',action='store_true')
    parser.add_argument('--stora-review',default='upsalabuild/mapping/lm-tee-followup-stora-2026-09-09.json')
    parser.add_argument('--pad-review',default='upsalabuild/mapping/lm-stora-tee-platform-followup-2026-09-09.json')
    args=parser.parse_args();errors=[]
    def check(condition,message):
        if not condition:errors.append(message)
    identity=read(CACHE/'baselines.json');before={};current={};project={}
    transformer=Transformer.from_crs(4326,3006,always_xy=True)
    inverse=Transformer.from_crs(3006,4326,always_xy=True)
    for course,build in [('stora','upsalabuild'),('mellan','upsalamellanbuild')]:
        baseline=ROOT/identity[course]['path'];check(sha(baseline)==identity[course]['sha256'],course+': followup baseline hash changed')
        before[course]=read(baseline);current[course]=read(ROOT/f'{build}/course-model.json')
        f={k:before[course][k] for k in ['origin','mPerLat','mPerLon']}
        project[course]=lambda p,f=f:transformer.transform(f['origin']['lon']+p[0]/f['mPerLon'],f['origin']['lat']-p[1]/f['mPerLat'])
    history=read(CACHE/'historical-files.json')
    for item in history:check(sha(ROOT/item['path'])==item['sha256'],'Historical evidence changed: '+item['path'])
    acquisition_path=ROOT/'geo_data/course-v2/upsala/reference/lm-tee-acquisition-2026-09-09.json'
    acquisition=read(acquisition_path);windows={x['id']:x for x in acquisition['windows']}
    source_rows=[]
    for identifier,item in windows.items():
        raster=ROOT/'upsalabuild/cache/lm-tees'/item['rasterFile'];rgb=raster.with_suffix('.png')
        check(sha(raster)==item['sha256'] and sha(rgb)==item['rgbSha256'],identifier+': native imagery hash differs')
        with rasterio.open(raster) as dataset:
            check(dataset.crs.to_epsg()==3006 and dataset.count==4 and dataset.dtypes==('uint8',)*4,identifier+': native grid/bands differ')
            check(dataset.colorinterp==(ColorInterp.red,ColorInterp.green,ColorInterp.blue,ColorInterp.undefined),identifier+': fourth band is not explicit NIR/undefined')
            check(bool(np.allclose(dataset.transform.to_gdal(),item['geoTransform'],rtol=0,atol=1e-8)),identifier+': source transform differs')
            check(bool(np.allclose(dataset.res,[.16,.16],rtol=0,atol=1e-10)),identifier+': source resolution differs')
            check(bool(np.all(dataset.dataset_mask()==255)),identifier+': incomplete native valid coverage')
            check(bool(np.array_equal(dataset.read([1,2,3]).transpose(1,2,0),np.array(Image.open(rgb)))),identifier+': RGB differs from native source')
        source_rows.append(dict(id=identifier,sha256=item['sha256'],rgbSha256=item['rgbSha256']))
    old_files=[MAPPING/f'lm-tee-review-{part}-2026-09-09.json' for part in ['front9','back9','mellan']]
    initial={}
    for file in old_files:
        review=read(file)
        for h in review['holes']:
            for d in h['referenceDecisions']:initial[(review['course'],h['hole'],d['markIndex'])]=d
    follow_files=[ROOT/args.stora_review,MAPPING/'lm-tee-followup-mellan-2026-09-09.json']
    missing=[rel(f) for f in follow_files if not f.exists()]
    if missing:raise ValueError('Followup review missing: '+', '.join(missing))
    decisions={};rows=[];maximum_source_roundtrip=0;maximum_source_projection=0
    for file in follow_files:
        review=read(file);course=review['course'];baseline=before[course];model=current[course]
        frame={k:baseline[k] for k in ['origin','mPerLat','mPerLon']}
        check(review['frame']==frame,rel(file)+': frame differs')
        check(review['baselineModelSha256']==identity[course]['sha256'],rel(file)+': baseline model identity differs')
        for h in review['holes']:
            n=h['hole'];old=next(x for x in baseline['holes'] if x['n']==n);new=next(x for x in model['holes'] if x['n']==n)
            check(h['originalMarks']==old['tees']['marks'],f'{course}/{n}: original mark guard differs')
            check(h['originalLine']==old['line'] and h['originalDistances']==old['t'],f'{course}/{n}: original route/card guard differs')
            check(sorted(d['markIndex'] for d in h['referenceDecisions'])==list(range(len(old['tees']['marks']))),f'{course}/{n}: incomplete reference decisions')
            source=windows[f'{course}-{n:02d}-tees']
            stated=next(s for s in review['sources'] if s.get('id')==f'{course}-{n:02d}-tees')
            check(stated['sha256']==source['sha256'],f'{course}/{n}: review native source hash differs')
            check(h.get('sourceCaptureDates',[stated.get('captureDate')])==['2025-06-14'],f'{course}/{n}: review capture evidence differs')
            if 'sourceRasterSha256' in h:check(h['sourceRasterSha256']==source['sha256'],f'{course}/{n}: review per-hole source hash differs')
            for decision in h['referenceDecisions']:
                i=decision['markIndex'];key=course,n,i;label=f'{course}/{n}/M{i+1}'
                check(key not in decisions,label+': duplicate followup decision');decisions[key]=decision
                mark=old['tees']['marks'][i] if args.source_only else new['tees']['marks'][i]
                row=dict(course=course,hole=n,markIndex=i,status=decision['status'])
                if decision['status']=='retain':
                    if not args.source_only:check(mark==old['tees']['marks'][i],label+': followup retained reference changed')
                    rows.append(row);continue
                check(decision['status']=='align-to-observed-pad',label+': unsupported decision status')
                ring=decision['originalPadRing'];poly=Polygon(ring)
                check(poly.is_valid and poly.area>1,label+': target platform invalid')
                q=decision.get('reviewedPosition')
                if q is not None:
                    check(len(q)==2 and all(isinstance(x,(int,float)) and math.isfinite(x) for x in q),label+': explicit point invalid')
                    check(clearance(poly,q)>=.999,label+': explicit point lacks 1 m interior')
                    check(math.dist(q,old['tees']['marks'][i]['c'])<=decision['maxShiftMetres']+1e-8,label+': explicit point exceeds bound')
                if course=='mellan':
                    position=decision['positionSource'];source_file=ROOT/position['sourcePath']
                    check(sha(source_file)==position['sourceSha256'],label+': published source hash differs')
                    pointer=position['sourceFeatureId'];check(pointer.startswith('/points/'),label+': invalid point source identity')
                    record=read(source_file)['points'][int(pointer.rsplit('/',1)[1])]
                    check(record['hole']==n and record['markIndex']==i,label+': source role identifies another reference')
                    check(position['wgs84']==record['publishedWgs84'] and position['epsg3006']==record['publishedEpsg3006'] and position['localXZ']==record['publishedLocal'],label+': coordinates differ from identified source point')
                    exact=transformer.transform(*position['wgs84']);local=position['localXZ']
                    projected=project[course](local);projection_residual=max(math.dist(exact,position['epsg3006']),math.dist(exact,projected))
                    maximum_source_projection=max(maximum_source_projection,projection_residual)
                    check(projection_residual<1e-8,label+': source WGS84/local/EPSG3006 mismatch')
                    lon,lat=inverse.transform(*exact)
                    restored=[(lon-frame['origin']['lon'])*frame['mPerLon'],(frame['origin']['lat']-lat)*frame['mPerLat']]
                    maximum_source_roundtrip=max(maximum_source_roundtrip,math.dist(restored,local))
                    check(math.dist(restored,local)<1e-5,label+': independent source inverse transform mismatch')
                    check(abs(math.dist(q,local)-position['adjustmentDistanceMetres'])<1e-8,label+': published-point adjustment distance differs')
                if not args.source_only:
                    pad=new['tees']['pads'][decision['padIndex']]
                    check(pad['ring']==ring and pad['sourceId']==decision['padSourceId'],label+': applied platform identity/ring differs')
                    check(pad.get('preserveTerrain') is True and pad.get('prov') in ['ortho-trace','dated-orthophoto-trace'],label+': applied platform lacks observed provenance')
                    check(clearance(poly,mark['c'])>=.999,label+': applied point lacks 1 m clearance')
                    if q is not None:check(mark['c']==q,label+': applied point differs from reviewed coordinate')
                    shift=math.dist(mark['c'],old['tees']['marks'][i]['c']);check(shift<=decision['maxShiftMetres']+1e-8,label+': applied movement exceeds reviewed bound')
                    metadata=mark.get('referencePlacement',{})
                    check(metadata.get('padSourceId')==pad['sourceId'] and metadata.get('dailyMarkerPositionVerified') is False and metadata.get('teeColourAssociationVerified') is False,label+': runtime metadata misstates identity')
                    allowed={'method','reviewId','padSourceId','boundaryClearanceMetres','shiftMetres','dailyMarkerPositionVerified','teeColourAssociationVerified','note','explicitReviewedPosition'}
                    check(set(metadata)<=allowed,label+': source coordinates or unexpected evidence leaked into runtime')
                    check({k:v for k,v in mark.items() if k not in ['c','referencePlacement']}=={k:v for k,v in old['tees']['marks'][i].items() if k not in ['c','referencePlacement']},label+': other mark content changed')
                    row.update(shiftMetres=shift,interiorClearanceMetres=clearance(poly,mark['c']),padSourceId=pad['sourceId'])
                rows.append(row)
    pad_file=ROOT/args.pad_review
    if not pad_file.exists():raise ValueError('Reviewed physical pad addition is missing: '+rel(pad_file))
    pad_review=read(pad_file)
    check(pad_review['baselineModelSha256']==identity['stora']['sha256'],'Physical pad baseline differs')
    check(pad_review['frame']=={k:before['stora'][k] for k in ['origin','mPerLat','mPerLon']},'Physical pad review frame differs')
    check(len(pad_review['features'])==2 and len(pad_review['holes'])==2,'Physical followup must contain exactly two additions')
    check(sorted(f['hole'] for f in pad_review['features'])==[6,18],'Unexpected physical addition holes')
    additions={};pad_results=[]
    for item in pad_review['sources']+pad_review.get('guideSources',[]):
        path=ROOT/item['path'];check(path.exists() and sha(path)==item['sha256'],'Physical addition supporting source hash differs: '+item['path'])
    for feature in pad_review['features']:
        n=feature['hole'];label=f'Stora H{n} addition';hole_guard=next(h for h in pad_review['holes'] if h['hole']==n)
        original=next(h for h in before['stora']['holes'] if h['n']==n)
        check(feature['status']=='accepted' and feature['kind']=='tee',label+': physical addition role differs')
        check(hole_guard['originalPads']==original['tees']['pads'] and hole_guard['originalMarks']==original['tees']['marks'],label+': baseline assertions differ')
        check(hole_guard['originalLine']==original['line'] and hole_guard['originalDistances']==original['t'],label+': route/card assertions differ')
        check(hole_guard['retainOriginalPadIndices']==[0,1,2] and hole_guard['retireOriginalPadIndices']==[],label+': changes old platforms')
        native_source=windows[feature['sourceId']]
        check(feature['sourceSha256']==native_source['sha256'] and feature['observedYear']==2025,label+': native source identity differs')
        check(feature['boundaryInterpretationUncertaintyMetres']>0 and feature['sourceAbsoluteHorizontalAccuracyMetres'] is None,label+': uncertainty missing')
        trace=feature['tracePanel'];check(sha(ROOT/trace['plainPath'])==trace['plainSha256'],label+': tracing panel hash differs')
        check(trace['source']['sha256']==native_source['sha256'],label+': panel source differs')
        ring=feature['ring'];grid_ring=feature['sourceGeometryEPSG3006'];pixel_ring=feature['originalPixelRing'];gt=trace['geoTransform']
        check(len(ring)==len(grid_ring)==len(pixel_ring),label+': vertex counts differ')
        polygon=Polygon(ring);grid_polygon=Polygon(grid_ring);check(polygon.is_valid and grid_polygon.is_valid and polygon.area>1,label+': invalid polygon')
        pixel_residual=0;local_residual=0;frame=pad_review['frame']
        for pixel,grid,local in zip(pixel_ring,grid_ring,ring):
            expected=[gt[0]+pixel[0]*gt[1]+pixel[1]*gt[2],gt[3]+pixel[0]*gt[4]+pixel[1]*gt[5]]
            pixel_residual=max(pixel_residual,math.dist(expected,grid))
            lon,lat=inverse.transform(*grid)
            restored=[(lon-frame['origin']['lon'])*frame['mPerLon'],(frame['origin']['lat']-lat)*frame['mPerLat']]
            local_residual=max(local_residual,math.dist(restored,local))
            check(0<=pixel[0]<=trace['pixelSize'][0] and 0<=pixel[1]<=trace['pixelSize'][1],label+': trace vertex outside panel')
        check(pixel_residual<1e-6 and local_residual<.00072,label+': source pixel/grid/local transform differs')
        check(abs(polygon.area-feature['areaSquareMetres'])<=.000501,label+': three-decimal stated area differs')
        for pad in original['tees']['pads']:check(polygon.intersection(Polygon(pad['ring'])).area<1e-8,label+': new platform overlaps existing platform')
        additions[n]=dict(feature=feature,guard=hole_guard,polygon=polygon)
        pad_results.append(dict(id=feature['id'],hole=n,vertices=len(ring),areaSquareMetres=polygon.area,pixelToGridMaximumResidualMetres=pixel_residual,gridToLocalMaximumResidualMetres=local_residual))
    if not args.source_only:
        for course in ['stora','mellan']:
            baseline=before[course];model=current[course]
            for key in set(baseline)|set(model):
                if key in ['holes','scenery','mappingRevision']:continue
                check(baseline.get(key)==model.get(key),course+': unrelated top-level content changed: '+key)
            for key in set(baseline['scenery'])|set(model['scenery']):
                old_value=baseline['scenery'].get(key);new_value=model['scenery'].get(key)
                if course=='mellan' and key=='tees':
                    extra_rings=[v['feature']['ring'] for v in additions.values()]
                    check(all(sum(r==ring for r in new_value)==1 for ring in extra_rings) and [r for r in new_value if r not in extra_rings]==old_value,'Mellan shared tee scenery differs beyond exactly two reviewed rings')
                else:check(old_value==new_value,course+': unrelated scenery changed: '+key)
            for old,new in zip(baseline['holes'],model['holes']):
                n=old['n'];label=f'{course}/{n}'
                check(old['n']==new['n'],label+': hole ordering changed')
                for key in set(old)|set(new):
                    if key=='tees':continue
                    check(old.get(key)==new.get(key),label+': route/card/other hole content changed: '+key)
                for key in set(old['tees'])|set(new['tees']):
                    if key in ['marks','referenceReview','markProvenance'] or course=='stora' and n in additions and key in ['pads','mappingCoverage','inferPads']:continue
                    check(old['tees'].get(key)==new['tees'].get(key),label+': unrelated tee content changed: '+key)
                check(len(old['tees']['marks'])==len(new['tees']['marks']),label+': reference count changed')
                for i,(old_mark,new_mark) in enumerate(zip(old['tees']['marks'],new['tees']['marks'])):
                    d=decisions.get((course,n,i))
                    if d is None or d['status']=='retain':check(old_mark==new_mark,label+f'/M{i+1}: untouched reference changed')
                if course=='stora' and n in additions:
                    feature=additions[n]['feature'];hole_guard=additions[n]['guard'];polygon=additions[n]['polygon'];ring=feature['ring']
                    pads=new['tees']['pads'];check(len(pads)==4 and pads[:3]==old['tees']['pads'],label+': existing physical pads changed')
                    added=pads[3];check(added['ring']==ring and added['sourceId']==feature['id'],label+': added physical pad differs')
                    check(abs(added['area']-polygon.area)<1e-6 and math.dist([added['cx'],added['cz']],[polygon.centroid.x,polygon.centroid.y])<1e-8,label+': pad derived geometry differs')
                    check(new['tees']['mappingCoverage']==hole_guard['coverage'] and new['tees']['inferPads'] is False,label+': coverage metadata differs')
                    allowed={'ring','cx','cz','area','ang','prov','sourceId','imagerySourceId','observedYear','crosscheckYear','yearBasis','captureDate','sourceSha256','boundaryInterpretationUncertaintyMetres','sourceAbsoluteHorizontalAccuracyMetres','centreProvenance','preserveTerrain'}
                    check(set(added)<=allowed,'Source geometry or unexpected evidence leaked into runtime pad')
        protected=read(ROOT/'upsalabuild/cache/lm-tee-validation/protected-files.json')
        for item in protected:
            p=ROOT/item['path'];check(p.exists() and p.stat().st_size==item['bytes'] and sha(p)==item['sha256'],'Protected terrain/heightfield changed: '+item['path'])
        current_tiles={rel(p) for p in (ROOT/'apps/golf/public/grounds/upsala/terrain').rglob('*') if p.is_file()}
        check(current_tiles=={p['path'] for p in protected if '/terrain/' in p['path']},'Terrain membership changed')
        maintained=0
        for (course,n,i),old_decision in initial.items():
            if old_decision['status']!='align-to-observed-pad':continue
            d=decisions.get((course,n,i),old_decision)
            if d['status']=='retain':d=old_decision
            h=next(h for h in current[course]['holes'] if h['n']==n)
            pad=h['tees']['pads'][d['padIndex']]
            check(pad['sourceId']==d['padSourceId'] and pad['ring']==d['originalPadRing'],f'{course}/{n}/M{i+1}: prior reviewed target changed without followup')
            check(clearance(Polygon(pad['ring']),h['tees']['marks'][i]['c'])>=.999,f'{course}/{n}/M{i+1}: reviewed alignment lost 1 m clearance')
            maintained+=1
    summary=dict(followupReviewedReferences=len(rows),followupAlignDecisions=sum(r['status']=='align-to-observed-pad' for r in rows),followupRetainDecisions=sum(r['status']=='retain' for r in rows),nativeWindowsChecked=len(source_rows),historicalEvidenceFilesPreserved=len(history))
    if not args.source_only:
        all_final=[];previous_targets_preserved=0;previous_targets_replaced=0
        for (course,n,i),old_decision in initial.items():
            follow=decisions.get((course,n,i));effective=follow if follow and follow['status']=='align-to-observed-pad' else old_decision
            h=next(h for h in current[course]['holes'] if h['n']==n);mark=h['tees']['marks'][i]
            all_final.append(dict(course=course,hole=n,markIndex=i,approved=effective['status']=='align-to-observed-pad',onAnyPad=any(Polygon(p['ring']).covers(Point(mark['c'])) for p in h['tees']['pads'])))
            if old_decision['status']=='align-to-observed-pad':
                if effective['padSourceId']==old_decision['padSourceId']:previous_targets_preserved+=1
                else:previous_targets_replaced+=1
        for course in ['stora','mellan']:
            for h in current[course]['holes']:
                unresolved=any(not r['approved'] for r in all_final if r['course']==course and r['hole']==h['n'])
                metadata=h['tees'].get('referenceReview',{})
                check(metadata.get('unresolvedReferencesRetained')==unresolved,f"{course}/{h['n']}: runtime unresolved flag differs from evidence decisions")
                check(metadata.get('dailyMarkerPositionsVerified') is False,f"{course}/{h['n']}: runtime overstates daily marker verification")
        summary.update(movedReferences=sum(r.get('shiftMetres',0)>0 for r in rows),maximumShiftMetres=max(r.get('shiftMetres',0) for r in rows),
            minimumFollowupInteriorClearanceMetres=min(r['interiorClearanceMetres'] for r in rows if 'interiorClearanceMetres' in r),previouslyApprovedAlignmentsPreservedOrExplicitlyReplaced=maintained,
            previousPlatformTargetsPreserved=previous_targets_preserved,previousPlatformTargetsExplicitlyReplaced=previous_targets_replaced,
            finalApprovedReferences=sum(r['approved'] for r in all_final),finalUnresolvedReferences=sum(not r['approved'] for r in all_final),
            finalReferencesOnAnyPad=sum(r['onAnyPad'] for r in all_final),finalReferencesOffEveryPad=sum(not r['onAnyPad'] for r in all_final),protectedTerrainHeightfieldFiles=len(protected))
    report=dict(schemaVersion=1,kind='independent-tee-followup-validation',observedAt=datetime.now(timezone.utc).isoformat(),state='failed' if errors else 'source-and-decisions-passed' if args.source_only else 'passed',
        method='Independent Python/pyproj/Shapely source identity, coordinate, containment and unchanged-content checks; JavaScript placement helper is not called.',
        baselines=identity,models=[dict(course=c,path=f'{b}/course-model.json',sha256=sha(ROOT/f'{b}/course-model.json')) for c,b in [('stora','upsalabuild'),('mellan','upsalamellanbuild')]],
        reviews=[dict(path=rel(f),sha256=sha(f)) for f in follow_files],physicalPadReview=dict(path=rel(pad_file),sha256=sha(pad_file)),
        validator=dict(path=rel(Path(__file__)),sha256=sha(Path(__file__))),sourceWindows=source_rows,physicalPads=pad_results,
        maximumPublishedSourceProjectionResidualMetres=maximum_source_projection,maximumPublishedSourceInverseResidualMetres=maximum_source_roundtrip,summary=summary,references=rows,errors=errors,
        limitations=['Published coordinates and imagery establish reviewed navigation-reference associations, not surveyed daily marker positions.','Explicitly unresolved Orange references retain their prior inferred coordinates.'])
    destination=CACHE/'source-validation.json' if args.source_only else MAPPING/'lm-tee-followup-validation-2026-09-09.json'
    destination.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(state=report['state'],**summary,errors=errors)))
    return int(bool(errors))

if __name__=='__main__':raise SystemExit(main())
