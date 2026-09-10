"""Independently verify accepted review geometry using PROJ and Shapely.

Source rasters are never required by the runtime. This offline audit verifies
retained source bytes, display affines, native coverage, trace polygons,
projection roundtrips, final model adoption and before/after measurements.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from pyproj import Transformer
import rasterio
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union
from shapely.validation import explain_validity

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'nvgkbuild/cache/lm-ortho'
REFERENCE=ROOT/'geo_data/course-v2/norrfallsviken/reference'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file,'sha256').hexdigest()


def features(value,path='',hole=None):
    if isinstance(value,dict):
        hole=value.get('hole',hole)
        for coordinate_key in ('ringEpsg3006','lineEpsg3006'):
            if coordinate_key in value:
                yield dict(feature=value,path=path,hole=hole,key=coordinate_key)
        for key,item in value.items():
            if key not in ('ringEpsg3006','lineEpsg3006'):
                yield from features(item,path+'/'+key,hole)
    elif isinstance(value,list):
        for index,item in enumerate(value):
            yield from features(item,path+'/'+str(index),hole)


def identified(value):
    if isinstance(value,dict):
        if ('ring' in value or 'line' in value) and (value.get('reviewId') or value.get('id')):
            yield value
        for item in value.values():
            yield from identified(item)
    elif isinstance(value,list):
        for item in value:
            yield from identified(item)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review',nargs='+',required=True,type=Path)
    parser.add_argument('--model',type=Path,default=ROOT/'nvgkbuild/course-model.json')
    parser.add_argument('--baseline',type=Path,default=ROOT/'nvgkbuild/cache/lm-validation/baseline-course-model.json')
    parser.add_argument('--out',type=Path,default=REFERENCE/'lm-geometry-validation-2026-09-09.json')
    parser.add_argument('--trace-only',action='store_true',help='Validate source geometry before adoption; does not report final-model adoption passed')
    args=parser.parse_args()
    model,baseline=read(args.model),read(args.baseline)
    acquisition=read(REFERENCE/'lm-ortho-acquisition-2026-09-09.json')
    plan=read(REFERENCE/'lm-ortho-plan-2026-09-09.json')
    assert acquisition['state']=='acquired-for-review'
    assert acquisition['planSha256']==sha(REFERENCE/'lm-ortho-plan-2026-09-09.json')
    projected=Transformer.from_crs(4326,3006,always_xy=True)
    geographic=Transformer.from_crs(3006,4326,always_xy=True)
    def grid(point):
        return projected.transform(model['origin']['lon']+point[0]/model['mPerLon'],model['origin']['lat']-point[1]/model['mPerLat'])
    def local(point):
        lon,lat=geographic.transform(*point)
        return [(lon-model['origin']['lon'])*model['mPerLon'],(model['origin']['lat']-lat)*model['mPerLat']]
    window_records={w['id']:w for w in acquisition['windows']}
    native=[w for w in acquisition['windows'] if w['resolutionMetres']==plan['nativeResolutionMetres']]
    native_coverage=unary_union([box(*w['boundsEpsg3006']) for w in native])
    source_coverage=unary_union([box(*s['boundsEpsg3006']) for s in plan['sources']])
    source_ids={s['id'] for s in plan['sources']}
    errors=[]
    def require(condition,message):
        if not condition: errors.append(message)
    source_hashes=[]
    for record in acquisition['windows']:
        file=CACHE/record['rasterFile']
        require(sha(file)==record['sha256'],f'{record["id"]}: raster checksum mismatch')
        with rasterio.open(file) as src:
            require(np.allclose(src.transform.to_gdal(),record['geoTransform'],atol=1e-8,rtol=0),f'{record["id"]}: raster transform mismatch')
            require(src.crs.to_epsg()==3006,f'{record["id"]}: wrong source CRS')
        source_hashes.append(dict(id=record['id'],sha256=record['sha256']))
    panels=[]
    for folder in (ROOT/'nvgkbuild/cache/lm-review', CACHE/'review'):
        if not folder.exists(): continue
        for file in sorted(folder.glob('*.json')):
            panel=read(file)
            source=window_records.get(panel.get('sourceId',panel.get('sourceWindow')))
            if not source or 'geoTransform' not in panel: continue
            transform=source['geoTransform']
            if 'sourcePixelWindow' in panel:
                x,y,w,h=panel['sourcePixelWindow']
                width,height=panel['width'],panel['height']
                require(panel['sourceSha256']==source['sha256'],f'{file.name}: source checksum mismatch')
            elif 'sourceCropPixelEdges' in panel:
                x,y,r,b=panel['sourceCropPixelEdges'];w,h=r-x,b-y
                width,height=panel['displayWidth'],panel['displayHeight']
            else: continue
            expected=[transform[0]+x*transform[1],w*transform[1]/width,0,transform[3]+y*transform[5],0,h*transform[5]/height]
            delta=max(abs(a-b) for a,b in zip(expected,panel['geoTransform']))
            require(delta<1e-8,f'{file.name}: displayed pixel affine differs from source window')
            require(0<=x<x+w<=source['width'] and 0<=y<y+h<=source['height'],f'{file.name}: display crop exceeds source coverage')
            panels.append(dict(file=file.relative_to(ROOT).as_posix(),sha256=sha(file),maxAffineDifference=delta))
    final_by_id={f.get('reviewId',f.get('id')):f for f in identified(model)}
    results=[]
    for review_file in args.review:
        review=read(review_file)
        require(review.get('groundId')=='norrfallsviken',f'{review_file}: wrong ground')
        for item in features(review):
            feature=item['feature'];identifier=feature.get('id',item['path']);points=feature[item['key']]
            closed=item['key']=='ringEpsg3006'
            geom=Polygon(points) if closed else LineString(points)
            require(geom.is_valid,f'{identifier}: {explain_validity(geom)}')
            require(not geom.is_empty and (geom.area>1 if closed else geom.length>1),f'{identifier}: empty or degenerate geometry')
            require(source_coverage.buffer(.001).covers(geom),f'{identifier}: geometry outside catalogued source')
            require(native_coverage.buffer(.001).covers(geom),f'{identifier}: geometry outside acquired native windows')
            source_id=feature.get('sourceId')
            require(source_id in source_ids or source_id in window_records,f'{identifier}: unrecognized source id {source_id}')
            roundtrip=max(math.dist(p,grid(local(p))) for p in points)
            require(roundtrip<1e-5,f'{identifier}: PROJ roundtrip exceeds 0.01 mm')
            affine_error=None
            if 'panel' in feature and ('ringPixels' in feature or 'linePixels' in feature):
                panel=feature['panel']
                source=window_records.get(panel['sourceId'])
                require(source is not None,f'{identifier}: unknown embedded panel source')
                if source:
                    require(panel['sourceSha256']==source['sha256'],f'{identifier}: embedded panel source hash mismatch')
                    x,y,w,h=panel['sourcePixelWindow']
                    st=source['geoTransform']
                    expected=[st[0]+x*st[1],w*st[1]/panel['width'],0,st[3]+y*st[5],0,h*st[5]/panel['height']]
                    require(max(abs(a-b) for a,b in zip(expected,panel['geoTransform']))<1e-8,f'{identifier}: embedded panel affine mismatch')
                    pixels=feature.get('ringPixels',feature.get('linePixels'))
                    require(len(pixels)==len(points),f'{identifier}: trace pixel/coordinate vertex count differs')
                    require(all(0<=p[0]<=panel['width'] and 0<=p[1]<=panel['height'] for p in pixels),f'{identifier}: trace outside displayed image')
                    tr=panel['geoTransform']
                    affine_error=max(math.dist(p,[tr[0]+q[0]*tr[1]+q[1]*tr[2],tr[3]+q[0]*tr[4]+q[1]*tr[5]]) for p,q in zip(points,pixels))
                    require(affine_error<.002,f'{identifier}: trace affine differs from EPSG geometry by {affine_error:.6f} m')
                    if 'pointPixels' in feature and 'pointEpsg3006' in feature:
                        q=feature['pointPixels']
                        point_error=math.dist(feature['pointEpsg3006'],[tr[0]+q[0]*tr[1]+q[1]*tr[2],tr[3]+q[0]*tr[4]+q[1]*tr[5]])
                        require(point_error<.002,f'{identifier}: reference point affine mismatch')
                        require(geom.buffer(.001).covers(Point(feature['pointEpsg3006'])),f'{identifier}: reviewed reference point outside its surface')
            final=final_by_id.get(identifier)
            # Fairway runtime rings keep their provenance in sourceFeatures.
            hole=next((h for h in model['holes'] if h['n']==item['hole']),None)
            previous=next((h for h in baseline['holes'] if h['n']==item['hole']),None)
            old=None
            if hole and '/fairways/' in item['path']:
                entries=hole['fairway'].get('sourceFeatures',[])
                index=next((i for i,f in enumerate(entries) if f.get('id')==identifier),None)
                if index is not None: final={'ring':hole['fairway']['rings'][index]}
            if previous:
                if item['path'].endswith('/green'): old=Polygon([grid(p) for p in previous['green']['ring']])
                elif '/fairways/' in item['path']: old=unary_union([Polygon([grid(p) for p in ring]) for ring in previous['fairway']['rings']])
                elif '/tees/' in item['path'] or '/bunkers/' in item['path']:
                    collection=previous['tees']['pads'] if '/tees/' in item['path'] else previous['bunkers']
                    candidates=[Polygon([grid(p) for p in f['ring']]) for f in collection]
                    candidates=[p for p in candidates if p.is_valid and not p.is_empty]
                    if candidates:
                        old=min(candidates,key=lambda p:(-p.intersection(geom).area,p.centroid.distance(geom.centroid))) if geom.is_valid else None
            adoption=None
            if not args.trace_only:
                require(final is not None,f'{identifier}: missing from final model')
                if final:
                    final_points=final.get('ring',final.get('line'))
                    final_geom=Polygon([grid(p) for p in final_points]) if closed else LineString([grid(p) for p in final_points])
                    adoption=geom.hausdorff_distance(final_geom)
                    require(adoption<.003,f'{identifier}: final model differs from reviewed EPSG geometry by {adoption:.6f} m')
                if hole and item['path'].endswith('/green') and 'pointEpsg3006' in feature:
                    require(math.dist(grid(hole['green']['c']),feature['pointEpsg3006'])<.003,f'{identifier}: adopted green reference differs from reviewed point')
            changes=None
            if old is not None and not old.is_empty and old.is_valid and geom.is_valid:
                changes=dict(previousAreaSquareMetres=round(old.area,3),newAreaSquareMetres=round(geom.area,3),
                             centroidShiftMetres=round(old.centroid.distance(geom.centroid),3),
                             boundaryHausdorffMetres=round(old.hausdorff_distance(geom),3),
                             intersectionOverUnion=round(old.intersection(geom).area/old.union(geom).area,6))
            results.append(dict(id=identifier,hole=item['hole'],review=review_file.as_posix(),path=item['path'],
                                sourceId=source_id,valid=geom.is_valid,areaSquareMetres=round(geom.area,3),
                                vertices=len(points),projectionRoundtripMetres=roundtrip,traceAffineErrorMetres=affine_error,
                                adoptionErrorMetres=adoption,change=changes))
    interactions=[]
    for hole in model['holes']:
        green=Polygon([grid(p) for p in hole['green']['ring']])
        if hole['green'].get('prov')=='lm-orthophoto':
            require(green.is_valid,f'H{hole["n"]}: adopted green is invalid')
            require(green.buffer(.001).covers(Point(grid(hole['green']['c']))),f'H{hole["n"]}: green reference lies outside accepted surface')
            require(green.buffer(.001).covers(Point(grid(hole['pin']))),f'H{hole["n"]}: pin reference lies outside accepted surface')
        for bunker_hole,bunker in [(h['n'],b) for h in model['holes'] for b in h['bunkers']]:
            ring=Polygon([grid(p) for p in bunker['ring']])
            if not green.is_valid or not ring.is_valid: continue
            area=green.intersection(ring).area
            if area>.01:
                interactions.append(dict(hole=hole['n'],bunkerHole=bunker_hole,green=hole['green'].get('id'),bunker=bunker.get('id'),overlapSquareMetres=round(area,4)))
                if hole['green'].get('prov')=='lm-orthophoto' or bunker.get('prov')=='lm-orthophoto':
                    require(area<.05,f'H{hole["n"]}: accepted green/bunker overlap {area:.3f} square metres')
        for index,mark in enumerate(hole['tees']['marks']):
            if mark.get('sourcePadId'):
                pad=next((p for p in hole['tees']['pads'] if p.get('id')==mark['sourcePadId']),None)
                require(pad is not None and Polygon(pad['ring']).buffer(.001).covers(Point(mark['c'])),f'H{hole["n"]} tee {index}: reviewed reference outside its platform')
    fourth,eighth=[next(h for h in model['holes'] if h['n']==n)['green'] for n in (4,8)]
    if fourth.get('prov')==eighth.get('prov')=='lm-orthophoto':
        a,b=[Polygon([grid(p) for p in green['ring']]) for green in (fourth,eighth)]
        require(a.is_valid and b.is_valid and a.symmetric_difference(b).area<.05,'H4/H8 must share the same reviewed putting surface')
    report=dict(schemaVersion=1,groundId='norrfallsviken',kind='independent-orthophoto-geometry-verification',
                observedAt=datetime.now(timezone.utc).isoformat(),state='failed' if errors else ('trace-only-passed' if args.trace_only else 'passed'),
                method='Independent Shapely topology and PROJ conversion from frozen model scales; no fitted image registration.',
                modelSha256=sha(args.model),baselineSha256=sha(args.baseline),
                reviewFiles=[dict(path=p.as_posix(),sha256=sha(p)) for p in args.review],
                verifiedSourceWindows=source_hashes,verifiedPanelAffines=panels,features=results,
                greenBunkerIntersections=interactions,errors=errors,
                limitations=['Geometric and source consistency does not measure survey accuracy or guarantee semantic boundary interpretation.',
                             '2024 imagery cannot establish 2026 construction, current movable tee markers, building facade dimensions or current forest changes.'])
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(state=report['state'],features=len(results),panels=len(panels),errors=errors)))
    raise SystemExit(bool(errors))


if __name__=='__main__':main()
