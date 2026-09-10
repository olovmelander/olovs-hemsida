"""Audit accepted orthophoto rings against the model using independent PROJ.

Run from repository root with the ignored review Python environment. Native
comparison images remain in the ignored cache. This script never changes source
geometry, a model, a manifest, or a runtime artifact.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
import pyproj
import rasterio
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
from shapely.validation import explain_validity

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'angsobuild/cache/lm-ortho'
OUT=CACHE/'alignment-review'
sha=lambda data:hashlib.sha256(data).hexdigest()
COLORS={'green':(45,255,75),'fairways':(255,223,35),'tees':(25,235,255),'bunkers':(255,75,220),'water':(70,145,255)}

def read(path):
    raw=path.read_bytes()
    return json.loads(raw),sha(raw)

def stats(values):
    a=np.asarray(values,dtype=float)
    if not len(a):return dict(count=0,minimum=None,median=None,maximum=None,rms=None)
    return dict(count=len(a),minimum=float(a.min()),median=float(np.median(a)),maximum=float(a.max()),rms=float(np.sqrt(np.mean(a*a))))

def classes(hole):
    return dict(green=[hole['green']],fairways=[dict(ring=r,**meta) for r,meta in zip(hole['fairway']['rings'],hole['fairway'].get('orthophotoSources',[{}]*len(hole['fairway']['rings'])))],
                tees=hole['tees']['pads'],bunkers=hole['bunkers'])

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-overlays',action='store_true')
    args=parser.parse_args()
    model,mhash=read(ROOT/'angsobuild/course-model.json')
    baseline,bhash=read(CACHE/'baseline-course-model.json')
    review,rhash=read(ROOT/'angsobuild/mapping/orthophoto-review.json')
    assert model['origin']==baseline['origin']==dict(lat=59.5739,lon=16.871)
    assert model['mPerLat']==baseline['mPerLat']==111320
    assert model['mPerLon']==baseline['mPerLon']==56375.41
    project=pyproj.Transformer.from_crs(4326,3006,always_xy=True)
    def projected(ring):
        p=np.asarray(ring,dtype=float)
        e,n=project.transform(model['origin']['lon']+p[:,0]/model['mPerLon'],model['origin']['lat']-p[:,1]/model['mPerLat'])
        return np.column_stack([e,n])
    def source_world(source,ring):
        p=np.asarray(ring,dtype=float); t=source['geoTransform']
        return np.column_stack([t[0]+p[:,0]*t[1]+p[:,1]*t[2],t[3]+p[:,0]*t[4]+p[:,1]*t[5]])
    def source_pixels(source,world):
        t=source['geoTransform']; a=np.array([[t[1],t[2]],[t[4],t[5]]])
        return (np.asarray(world)-[t[0],t[3]])@np.linalg.inv(a).T
    def aggregate_centroid(features):
        polygons=[Polygon(projected(f['ring'])) for f in features]
        if not polygons:return None
        return unary_union(polygons).centroid
    entries=[]
    reviewed_holes={h['n']:h for h in review['holes']}
    by_id={}
    baseline_counts=Counter(); updated_counts=Counter(); reviewed_counts=Counter(); reviewed_categories=Counter()
    topology=[]; holes=[]; marker_rows=[]; residuals=defaultdict(list)
    for h in model['holes']:
        n=h['n']; old=next(x for x in baseline['holes'] if x['n']==n); rh=reviewed_holes[n]
        old_classes=classes(old); new_classes=classes(h)
        row=dict(hole=n,classes={})
        for kind in ['green','fairways','tees','bunkers']:
            prior=old_classes[kind]; current=new_classes[kind]
            baseline_counts[kind]+=len(prior);updated_counts[kind]+=len(current)
            if kind in rh:
                reviewed_categories[kind]+=1
                accepted=[rh[kind]] if kind=='green' else rh[kind]['accepted']
                for item in accepted:
                    key=item.get('sourceKey',rh[kind].get('sourceKey'))
                    entries.append(dict(item,sourceKey=key,kind=kind,hole=n))
                reviewed_counts[kind]+=len(accepted)
            a=aggregate_centroid(prior);b=aggregate_centroid(current)
            area_before=sum(Polygon(projected(f['ring'])).area for f in prior)
            area_after=sum(Polygon(projected(f['ring'])).area for f in current)
            row['classes'][kind]=dict(status='reviewed' if kind in rh else 'retained-unreviewed',baselineRings=len(prior),modelRings=len(current),
                baselineAreaSquareMetres=round(area_before,4),modelAreaSquareMetres=round(area_after,4),
                aggregateCentroidShiftMetres=round(a.distance(b),4) if a is not None and b is not None else None)
            if kind not in rh:
                assert [f['ring'] for f in prior]==[f['ring'] for f in current],(n,kind,'unreviewed geometry changed')
            for index,f in enumerate(current):
                poly=Polygon(projected(f['ring']))
                topology.append(dict(hole=n,kind=kind,index=index,id=f.get('reviewId'),reviewed=kind in rh,
                    valid=poly.is_valid,reason=explain_validity(poly),closed=f['ring'][0]==f['ring'][-1],areaSquareMetres=poly.area))
                if f.get('reviewId'):by_id[f['reviewId']]=f
        assert Point(h['pin']).distance(Point(h['green']['c']))<1e-8
        assert Point(h['line'][-1]).distance(Point(h['green']['c']))<1e-8
        assert Polygon(h['green']['ring']).covers(Point(h['green']['c']))
        row['greenReferenceInside']=True
        row['routeEndToGreenReferenceMetres']=0
        row['routeLengthMetres']=h['lineLen']
        row['scorecardMetres']=h['t'][0]
        row['scorecardDifferenceIsAGate']=False
        for i,mark in enumerate(h['tees']['marks']):
            ref=mark.get('orthophotoReference',{})
            original=ref.get('originalPosition',old['tees']['marks'][i]['c'])
            point=Point(mark['c'])
            nearest=min(point.distance(Polygon(p['ring'])) for p in h['tees']['pads'])
            unresolved=ref.get('kind','').startswith('unresolved-')
            if unresolved:assert mark['c']==original
            elif mark.get('referenceSurfaceKind')=='fairway':assert any(Polygon(r).covers(point) for r in h['fairway']['rings'])
            else:assert nearest<1e-8,(n,i,nearest)
            marker_rows.append(dict(hole=n,markIndex=i,kind=ref.get('kind'),identityStatus=ref.get('identityStatus'),
                displacementMetres=math.dist(original,mark['c']),distanceToReviewedPadMetres=nearest,
                originalNearestPadEdgeMetres=ref.get('nearestPadEdgeDistanceMetres'),retainedOriginal=mark['c']==original,
                selectedPadReviewId=ref.get('selectedPadReviewId')))
        holes.append(row)
    baseline_counts['water']=len(baseline['water']);updated_counts['water']=len(model['water']);reviewed_counts['water']=len(review['water'])
    for item in review['water']:entries.append(dict(item,kind='water',hole=None))
    water_levels=[]
    for water in model['water']:
        prior=next(w for w in baseline['water'] if w['id']==water['id'])
        if water.get('reviewId'):by_id[water['reviewId']]=water
        else:assert water['ring']==prior['ring'],(water['id'],'unreviewed water ring changed')
        poly=Polygon(projected(water['ring']))
        topology.append(dict(hole=None,kind='water',id=water.get('reviewId',water['id']),reviewed=bool(water.get('reviewId')),
            valid=poly.is_valid,reason=explain_validity(poly),closed=water['ring'][0]==water['ring'][-1],areaSquareMetres=poly.area))
        assert water['level']==prior['level'],water['id']
        water_levels.append(dict(id=water['id'],reviewed=bool(water.get('reviewId')),baselineLevel=prior['level'],modelLevel=water['level']))
    source_checks=[]
    for key,source in review['sources'].items():
        file=CACHE/source['rasterFile']
        assert sha(file.read_bytes())==source['sha256'],key
        with rasterio.open(file) as tif:
            assert tif.crs.to_epsg()==3006 and tif.width==source['width'] and tif.height==source['height']
            assert np.allclose(tif.transform.to_gdal(),source['geoTransform'],rtol=0,atol=1e-8)
        source_checks.append(dict(sourceKey=key,sha256=source['sha256'],gridAndHashVerified=True))
    feature_residuals=[]
    for entry in entries:
        source=review['sources'][entry['sourceKey']]; expected=source_world(source,entry['ringPixels'])
        f=by_id[entry['id']];actual=projected(f['ring'])
        assert expected.shape==actual.shape,entry['id']
        distances=np.linalg.norm(actual-expected,axis=1)
        pixels=np.linalg.norm(source_pixels(source,actual)-np.asarray(entry['ringPixels']),axis=1)
        assert entry['ringPixels'][0]==entry['ringPixels'][-1]
        assert Polygon(expected).is_valid
        assert np.all(np.asarray(entry['ringPixels'])>=[0,0]) and np.all(np.asarray(entry['ringPixels'])<=[source['width'],source['height']])
        residuals['all'].extend(distances.tolist());residuals[entry['kind']].extend(distances.tolist());residuals['pixels'].extend(pixels.tolist())
        feature_residuals.append(dict(id=entry['id'],hole=entry['hole'],kind=entry['kind'],vertices=len(distances),maximumMetres=float(distances.max()),rmsMetres=float(np.sqrt(np.mean(distances*distances)))))
    assert max(residuals['all'])<.005,'Numerical source/model residual exceeds 5 mm'
    assert all(t['valid'] for t in topology if t['reviewed'])
    assert all(t['closed'] for t in topology if t['reviewed'])
    assert all(p.get('preserveTerrain') is True for h in model['holes'] for p in h['tees']['pads'])
    OUT.mkdir(exist_ok=True)
    overlay_records=[]
    if not args.no_overlays:
        for h in model['holes']:
            n=h['n'];source=review['sources'][f'angso-{n:02d}-hole']
            im=Image.open(CACHE/source['rgbFile']).convert('RGB');draw=ImageDraw.Draw(im)
            def line(world,color,width,dashed=False):
                ring=source_pixels(source,world).tolist()
                if ring[0]!=ring[-1]:ring.append(ring[0])
                if not dashed:draw.line([tuple(p) for p in ring],fill=color,width=width);return
                for a,b in zip(ring,ring[1:]):
                    length=math.dist(a,b)
                    for start in np.arange(0,length,20):
                        end=min(start+10,length)
                        p=[a[j]+(b[j]-a[j])*start/(length or 1) for j in range(2)]
                        q=[a[j]+(b[j]-a[j])*end/(length or 1) for j in range(2)]
                        draw.line([tuple(p),tuple(q)],fill=color,width=width)
            old=next(x for x in baseline['holes'] if x['n']==n)
            for features in classes(old).values():
                for f in features:line(projected(f['ring']),(255,65,65),3,True)
            for water in baseline['water']:line(projected(water['ring']),(255,65,65),3,True)
            for kind,features in classes(h).items():
                for f in features:line(projected(f['ring']),COLORS[kind] if kind in reviewed_holes[n] else (230,230,230),5)
            for water in model['water']:
                if water.get('reviewId'):line(projected(water['ring']),COLORS['water'],5)
            draw.rectangle((0,0,min(im.width-1,1320),44),fill=(15,20,24))
            draw.text((10,8),f'Hole {n} | dashed red: baseline | green: putting | yellow: fairway | cyan: tees | pink: sand | blue: water | white: retained',fill=(255,255,255))
            native=OUT/f'hole-{n:02d}-baseline-reviewed-native.png';im.save(native)
            preview=OUT/f'hole-{n:02d}-baseline-reviewed.png'
            im.thumbnail((1100,1400),Image.Resampling.LANCZOS);im.save(preview)
            overlay_records.append(dict(hole=n,nativePath=str(native.relative_to(ROOT)).replace('\\','/'),nativeSha256=sha(native.read_bytes()),previewPath=str(preview.relative_to(ROOT)).replace('\\','/')))
        (OUT/'overlays.json').write_text(json.dumps(overlay_records,indent=2)+'\n')
    elif (OUT/'overlays.json').exists():overlay_records=json.loads((OUT/'overlays.json').read_text())
    marker_counts=Counter(r['kind'] for r in marker_rows)
    green_shifts=[h['classes']['green']['aggregateCentroidShiftMetres'] for h in holes]
    report=dict(schemaVersion=1,groundId='angso',kind='independent-orthophoto-alignment-audit',auditedAt=datetime.now(timezone.utc).isoformat(),
        inputs=dict(modelPath='angsobuild/course-model.json',modelSha256=mhash,reviewPath='angsobuild/mapping/orthophoto-review.json',reviewSha256=rhash,
            baselinePath='angsobuild/cache/lm-ortho/baseline-course-model.json',baselineSha256=bhash,validatorSha256=sha(Path(__file__).read_bytes())),
        sourceCaptureDate=review.get('sourceCaptureDate'),reviewDate=review['reviewedAt'],
        frame=dict(origin=model['origin'],mPerLat=model['mPerLat'],mPerLon=model['mPerLon'],axes='east +x, true north -z',horizontalCrs='EPSG:3006',
            conversion='Native pixel-edge affine -> EPSG:3006. Model local metres -> frozen WGS84 inverse -> independent pyproj EPSG:3006; grid convergence is handled by PROJ, not an image fit.',
            pyprojVersion=pyproj.__version__,projVersion=pyproj.proj_version_str,pixelConvention='continuous pixel edges; sample centres use column+0.5,row+0.5',globalFitApplied=False),
        counts=dict(baselineRings=dict(baseline_counts),modelRings=dict(updated_counts),reviewedRings=dict(reviewed_counts),
            retainedUnreviewedRings={k:updated_counts[k]-reviewed_counts[k] for k in updated_counts},reviewedHoleCategories=dict(reviewed_categories),totalReviewedRings=len(entries)),
        numericalRegistration=dict(method='Independent projected residual for every matched accepted vertex, including closing vertex; measures implementation fidelity only.',
            perClassMetres={k:stats(v) for k,v in residuals.items() if k!='pixels'},nativePixels=stats(residuals['pixels']),passLimitMetres=.005,passed=True,
            doesNotMeasure=['absolute surveying accuracy','manual boundary interpretation accuracy','current ground changes after the capture date']),
        topology=dict(modelRings=len(topology),reviewedRings=sum(t['reviewed'] for t in topology),invalidReviewedRings=[t for t in topology if t['reviewed'] and not t['valid']],
            unclosedReviewedRings=[t for t in topology if t['reviewed'] and not t['closed']],invalidRetainedRings=[t for t in topology if not t['reviewed'] and not t['valid']],
            allReviewedPixelRingsInsideTheirSource=True,allGreenReferencesInsideTheirPuttingSurfaces=True),
        centroidDisplacements=dict(greenMetres=stats(green_shifts),definition='Projected polygon-area centroids; per-class values compare union centroids within a hole, not feature identities.'),
        teeReferences=dict(total=len(marker_rows),kinds=dict(marker_counts),displacementMetres=stats([r['displacementMetres'] for r in marker_rows]),
            allUnresolvedOriginalPositionsRetained=True,allResolvedReferencesInsideAssignedSurfaces=True,
            allResolvedReferencesInsideReviewedPads=all(r['kind'].startswith('unresolved-') or r['distanceToReviewedPadMetres']<1e-8 for r in marker_rows),
            allPhysicalPadsPreserveMeasuredTerrain=True,
            guideAssociatedReferences=sum(r['identityStatus']=='guide-orthophoto-correspondence' for r in marker_rows),
            surveyedCurrentMarkerPositionsVerified=0,references=marker_rows),
        waterLevels=dict(allRetained=True,values=water_levels),
        unchangedSourceClasses=dict(vegetation=model.get('vegetation')==baseline.get('vegetation'),streams=model.get('streams')==baseline.get('streams'),
            coast=model.get('coast')==baseline.get('coast'),scenery=model.get('scenery')==baseline.get('scenery'),
            infraGeometry={k:v for k,v in model.get('infra',{}).items() if k!='preserveMappedBoundaries'}=={k:v for k,v in baseline.get('infra',{}).items() if k!='preserveMappedBoundaries'}),
        limitations=['Fairways on par-three holes 12 and 15 retain legacy rings; the April image does not establish their cut boundary confidently.',
            'Tree shadows and dormant spring turf limit some interpreted edges, especially long fairway margins.',
            'The imagery is from 2025-04-24 and does not establish later construction, mowing, marker placement or water levels.',
            'Guide topology and native imagery establish representative colour references; current daily marker positions are not surveyed. Explicit unresolved decisions retain their original references.',
            'Canopy, infrastructure, surrounding land cover and terrain are not re-surveyed by this surface review.',
            'The retained malaren-1 shoreline has a pre-existing self-intersection; it is unchanged and outside the reviewed polygon set.',
            '0.16 m ground sample distance and subpixel numerical registration do not establish absolute geodetic or manual tracing accuracy.',
            'Scorecard distances remain metadata; geometry and camera endpoints are not stretched to match card length.'],
        sources=source_checks,holes=holes,featureResiduals=feature_residuals,overlays=overlay_records)
    target=ROOT/'angsobuild/mapping/alignment-report.json'
    target.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(dict(report=str(target.relative_to(ROOT)),modelSha256=mhash,reviewedRings=len(entries),vertices=len(residuals['all']),maxNumericalResidualMetres=max(residuals['all']),greenCentroidShiftMetres=stats(green_shifts),teeReferenceKinds=dict(marker_counts),overlays=len(overlay_records))))

if __name__=='__main__':main()
