"""Acquire separate native 0.16 m tee review windows for Stora and Mellan.

python upsalabuild/mapping/lm-tee-acquire.py
Use --only stora-01-tees for a bounded retry. The established surface acquisition
plan and ledgers remain untouched. Source credentials are handled by the existing
authenticated reader, never persisted or logged.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import math
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'upsalabuild/cache/lm-tees'
REFERENCE=ROOT/'geo_data/course-v2/upsala/reference'
spec=importlib.util.spec_from_file_location('upsala_orthophoto',ROOT/'upsalabuild/mapping/lm-ortho-acquire.py')
ortho=importlib.util.module_from_spec(spec)
spec.loader.exec_module(ortho)


def make_plan():
    from pyproj import Transformer
    source_plan=json.loads((REFERENCE/'lm-ortho-plan-2026-09-09.json').read_text(encoding='utf-8'))
    resolution=source_plan['nativeResolutionMetres']
    if resolution!=.16:
        raise ValueError('Expected pinned native 0.16 m RGBI sources')
    sources=source_plan['sources']
    anchor=sources[0]['boundsEpsg3006'][:2]
    project=Transformer.from_crs(4326,3006,always_xy=True)
    windows=[];models=[]
    for course,path in [('stora','upsalabuild/course-model.json'),('mellan','upsalamellanbuild/course-model.json')]:
        file=ROOT/path
        model=json.loads(file.read_text(encoding='utf-8'))
        frame={k:model[k] for k in ('origin','mPerLat','mPerLon')}
        models.append(dict(course=course,file=path,sha256=ortho.digest(file),frame=frame))
        tee_names=model['card'].get('teeNames',[]) if isinstance(model.get('card'),dict) else model.get('teeNames',[])
        def projected(p):
            return list(project.transform(model['origin']['lon']+p[0]/model['mPerLon'],
                                          model['origin']['lat']-p[1]/model['mPerLat']))
        for hole in model['holes']:
            pads=[dict(kind='tee',sourceId=p.get('sourceId'),padIndex=i,
                       originalRing=p['ring'],ring=list(map(projected,p['ring'])))
                  for i,p in enumerate(hole['tees']['pads'])]
            marks=[dict(markIndex=i,teeName=tee_names[i] if i<len(tee_names) else None,
                        original=p['c'],point=projected(p['c'])) for i,p in enumerate(hole['tees']['marks'])]
            start=projected(hole['line'][0])
            points=[p for pad in pads for p in pad['ring']]+[m['point'] for m in marks]+[start]
            lo=[min(p[a] for p in points)-40 for a in range(2)]
            hi=[max(p[a] for p in points)+40 for a in range(2)]
            bounds=[round(anchor[a]+math.floor((lo[a]-anchor[a])/resolution)*resolution,6) for a in range(2)]
            bounds += [round(anchor[a]+math.ceil((hi[a]-anchor[a])/resolution)*resolution,6) for a in range(2)]
            width,height=[round((bounds[a+2]-bounds[a])/resolution) for a in range(2)]
            ids=[s['id'] for s in sources if all(bounds[a]<s['boundsEpsg3006'][a+2] and bounds[a+2]>s['boundsEpsg3006'][a] for a in range(2))]
            windows.append(dict(id=f'{course}-{hole["n"]:02d}-tees',course=course,hole=hole['n'],
                                purpose='All existing physical tee pads, tee references and route start plus 40 m search margin',
                                marginMetres=40,boundsEpsg3006=bounds,width=width,height=height,resolutionMetres=resolution,
                                sourceIds=ids,features=pads,teeReferences=marks,routeStart=start))
    return dict(schemaVersion=1,groundId='upsala',kind='authenticated-tee-orthophoto-review-plan',
                createdAt=datetime.now(timezone.utc).isoformat(),horizontalCrs='EPSG:3006',collection=source_plan['collection'],
                nativeResolutionMetres=resolution,sourceOrthophotoPlanSha256=ortho.digest(REFERENCE/'lm-ortho-plan-2026-09-09.json'),
                projection='Declared model mPerLon and mPerLat invert local XZ to WGS84, then pyproj projects each vertex to EPSG:3006. No fitted shift or rotation.',
                pixelConvention='bounds are pixel edges; E=minE+(column+0.5)*resolution; N=maxN-(row+0.5)*resolution',
                models=models,sources=sources,windows=windows,
                limitations=['Existing pad outlines and tee references define search windows, not accepted physical locations.',
                             'Course-card reference starts and daily tee markers are not physical platform boundaries.',
                             'Source GSD and coordinate consistency do not establish absolute positional accuracy.'])


def capture_evidence(plan):
    from shapely.geometry import shape,box
    from shapely.ops import unary_union
    source_cache=ROOT/'upsalabuild/cache/lm-ortho'
    footprints=[];metadata=[]
    for source in plan['sources']:
        path=source_cache/(source['id']+'-flygbild.json')
        doc=json.loads(path.read_text(encoding='utf-8'))
        if doc.get('crs',{}).get('properties',{}).get('name')!='urn:ogc:def:crs:EPSG::3006':
            raise ValueError('Unexpected capture metadata CRS')
        metadata.append(dict(sourceId=source['id'],sha256=ortho.digest(path),bytes=path.stat().st_size))
        footprints += [(source['id'],f['properties']['bildidentitet'],f['properties']['tidpunkt'],shape(f['geometry'])) for f in doc['features']]
    records=[]
    for w in plan['windows']:
        area=box(*w['boundsEpsg3006']);parts=[];images=[]
        for source,image,date,geom in footprints:
            if source not in w['sourceIds']:continue
            intersection=area.intersection(geom)
            if intersection.area<=1e-8:continue
            parts.append(intersection)
            images.append(dict(sourceId=source,imageId=image,capturedAt=date,windowFraction=round(intersection.area/area.area,8)))
        coverage=unary_union(parts).area/area.area
        if not images or coverage<.99999:
            raise ValueError('Incomplete tee capture-date footprint coverage')
        dates=[i['capturedAt'] for i in images]
        records.append(dict(id=w['id'],boundsEpsg3006=w['boundsEpsg3006'],coverageFraction=round(coverage,8),
                            captureRange=dict(first=min(dates),last=max(dates)),contributingImages=images))
    report=dict(schemaVersion=1,groundId='upsala',kind='tee-window-capture-evidence',observedAt=datetime.now(timezone.utc).isoformat(),
                horizontalCrs='EPSG:3006',collection=plan['collection'],planSha256=ortho.digest(CACHE/'plan.json'),
                method='Intersect tee review pixel-edge bounds with the published Lantmateriet flygbild source mosaic polygons.',
                sourceMetadata=metadata,windows=records)
    ortho.write_json(REFERENCE/'lm-tee-capture-2026-09-09.json',report)
    return report


def verify(plan,acquisition,capture):
    import numpy as np
    import rasterio
    from rasterio.enums import ColorInterp
    from PIL import Image,ImageDraw
    from pyproj import Transformer
    if acquisition['planSha256']!=capture['planSha256'] or acquisition['state']!='acquired-for-review':
        raise ValueError('Tee acquisition and capture evidence do not match')
    if {w['id'] for w in acquisition['windows']}!={w['id'] for w in plan['windows']}:
        raise ValueError('Incomplete tee acquisition')
    project=Transformer.from_crs(4326,3006,always_xy=True)
    pixels=0;maximum=0
    for record in acquisition['windows']:
        w=next(w for w in plan['windows'] if w['id']==record['id'])
        file=CACHE/record['rasterFile'];rgb=CACHE/record['rgbFile']
        if ortho.digest(file)!=record['sha256'] or ortho.digest(rgb)!=record['rgbSha256']:
            raise ValueError('Tee source checksum mismatch')
        with rasterio.open(file) as src:
            if (src.crs.to_epsg()!=3006 or src.count!=4 or src.colorinterp!=(ColorInterp.red,ColorInterp.green,ColorInterp.blue,ColorInterp.undefined)
                or not np.all(src.dataset_mask()==255) or src.width!=w['width'] or src.height!=w['height']
                or not np.allclose(src.bounds,w['boundsEpsg3006'],rtol=0,atol=1e-8)
                or not np.allclose(src.transform.to_gdal(),record['geoTransform'],rtol=0,atol=1e-8)
                or not np.allclose(src.res,[.16,.16],rtol=0,atol=1e-10)
                or not np.array_equal(src.read([1,2,3]).transpose(1,2,0),np.array(Image.open(rgb)))):
                raise ValueError('Tee native grid, RGBI interpretation, coverage or RGB values differ')
            world=list(map(float,rgb.with_suffix('.pgw').read_text().split()))
            if not np.allclose(world,[.16,0,0,-.16,src.transform.c+.08,src.transform.f-.08],rtol=0,atol=1e-8):
                raise ValueError('Tee worldfile pixel centres differ from native grid')
        frame=next(m['frame'] for m in plan['models'] if m['course']==w['course'])
        all_points=[]
        for pad in w['features']:
            for original,grid in zip(pad['originalRing'],pad['ring']):
                expected=project.transform(frame['origin']['lon']+original[0]/frame['mPerLon'],frame['origin']['lat']-original[1]/frame['mPerLat'])
                maximum=max(maximum,math.dist(expected,grid));all_points.append(grid)
        for mark in w['teeReferences']:
            original=mark['original']
            expected=project.transform(frame['origin']['lon']+original[0]/frame['mPerLon'],frame['origin']['lat']-original[1]/frame['mPerLat'])
            maximum=max(maximum,math.dist(expected,mark['point']))
        all_points += [m['point'] for m in w['teeReferences']]+[w['routeStart']]
        if any(p[0]<w['boundsEpsg3006'][0]+39.99 or p[0]>w['boundsEpsg3006'][2]-39.99 or
               p[1]<w['boundsEpsg3006'][1]+39.99 or p[1]>w['boundsEpsg3006'][3]-39.99 for p in all_points):
            raise ValueError('Tee search margin is incomplete')
        # Tee references are drawn separately from pad outlines. They are not
        # promoted to observed physical marker positions by this diagnostic.
        image=Image.open(CACHE/(w['id']+'-overlay.png')).convert('RGB');draw=ImageDraw.Draw(image)
        west,_,_,north=w['boundsEpsg3006']
        for m in w['teeReferences']:
            x=(m['point'][0]-west)/.16;y=(north-m['point'][1])/.16
            draw.ellipse((x-6,y-6,x+6,y+6),outline=(20,230,255),width=3)
            draw.text((x+8,y+4),str(m['teeName'] or m['markIndex']),fill=(20,230,255))
        x=(w['routeStart'][0]-west)/.16;y=(north-w['routeStart'][1])/.16
        draw.line((x-9,y,x+9,y),fill=(255,220,20),width=3);draw.line((x,y-9,x,y+9),fill=(255,220,20),width=3)
        image.save(CACHE/(w['id']+'-overlay.png'))
        pixels+=w['width']*w['height']
    if maximum>1e-8:raise ValueError('Declared legacy frame conversion changed')
    report=dict(schemaVersion=1,groundId='upsala',kind='tee-native-orthophoto-verification',observedAt=datetime.now(timezone.utc).isoformat(),
                state='passed',planSha256=ortho.digest(CACHE/'plan.json'),acquisitionSha256=ortho.digest(REFERENCE/'lm-tee-acquisition-2026-09-09.json'),
                verifiedWindows=len(plan['windows']),nativeResolutionMetres=.16,pixels=pixels,
                declaredFrameProjectionMaximumResidualMetres=maximum,
                captureDates=sorted(set(i['capturedAt'][:10] for w in capture['windows'] for i in w['contributingImages'])),
                checks=['All 27 expected tee windows present','Final TIFF and RGB hashes','Native EPSG:3006 pixel grids',
                        'Explicit RGBI bands and valid coverage','Exact PNG/TIFF RGB values','Worldfile pixel centres',
                        'Declared mPerLon/mPerLat projection of every pad vertex and tee reference',
                        '40 m search margin around every pad, tee reference and route start','Complete capture-date source polygon coverage'],
                limitations=['This validates source registration; it does not accept physical pad outlines or daily marker positions.'])
    ortho.write_json(REFERENCE/'lm-tee-validation-2026-09-09.json',report)
    print(json.dumps({k:report[k] for k in ('state','verifiedWindows','pixels','captureDates')}),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only',default='')
    parser.add_argument('--replan',action='store_true')
    parser.add_argument('--plan-only',action='store_true')
    args=parser.parse_args()
    reference=REFERENCE/'lm-tee-plan-2026-09-09.json'
    plan=make_plan() if args.replan or not reference.exists() else json.loads(reference.read_text(encoding='utf-8'))
    if plan['groundId']!='upsala' or plan['horizontalCrs']!='EPSG:3006' or len(plan['windows'])!=27:
        raise ValueError('Expected all 27 Upsala tee windows')
    ids=[w['id'] for w in plan['windows']]
    if len(set(ids))!=len(ids) or any(not re.fullmatch(r'(stora|mellan)-\d{2}-tees',i) for i in ids):
        raise ValueError('Invalid tee window file identifiers')
    for w in plan['windows']:
        if not isinstance(w['width'],int) or not isinstance(w['height'],int) or min(w['width'],w['height'])<=0 or w['width']*w['height']>16_000_000:
            raise ValueError('Invalid or oversized tee window')
    ortho.write_json(CACHE/'plan.json',plan);ortho.write_json(reference,plan)
    if args.plan_only:return
    selected=plan['windows']
    if args.only:
        names=set(args.only.split(','));selected=[w for w in selected if w['id'] in names]
        if len(selected)!=len(names):raise ValueError('Unknown tee window selection')
    report_file=CACHE/'selected-acquisition.json' if args.only else REFERENCE/'lm-tee-acquisition-2026-09-09.json'
    try:
        ortho.acquire(plan,selected,CACHE,report_file)
        if not args.only:
            capture=capture_evidence(plan)
            verify(plan,json.loads(report_file.read_text(encoding='utf-8')),capture)
    except Exception as exc:
        if report_file.exists():
            report=json.loads(report_file.read_text(encoding='utf-8'));report.update(state='failed',errorType=type(exc).__name__);ortho.write_json(report_file,report)
        raise


if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(json.dumps({'state':'failed','errorType':type(exc).__name__}),file=sys.stderr)
        raise SystemExit(1)
