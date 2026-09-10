#!/usr/bin/env python3
"""Acquire pinned native Ängsö facility imagery and prepare reproducible references.

Run geobuild/cache/ortho-venv/Scripts/python.exe angsobuild/facilities/prepare-orthophoto.py.
Uses the existing authenticated intake (credentials never logged). Source pixels
remain in the ignored cache; JSON metadata and hand interpreted edges are tracked.
"""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import CRS, Transformer
import rasterio

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT/'angsobuild/cache/facilities-2026-09-10/ortho'
ORIGIN = [605530.0, 6605140.0]
SPECS = [
    ('facility-overview', [605240,6604720,605840,6605370], .80),
    ('campus-native', [605435,6605030,605650,6605290], .16),
    ('range-native', [605315,6604770,605640,6605100], .16),
    ('clubhouse-detail', [605490,6605100,605580,6605190], .16),
    ('northern-service-native', [605540,6606060,605710,6606210], .16),
    ('northern-neighbours-native', [605665,6606160,605840,6606330], .16),
    ('western-hole18-context', [605245,6605170,605470,6605400], .16),
]


def relative(path):
    return Path(path).relative_to(ROOT).as_posix()


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf8')


def area(ring):
    points = [(p[0]-ring[0][0],p[1]-ring[0][1]) for p in ring]
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1])))/2


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    baseline = ROOT/'geo_data/course-v2/angso/reference/lm-ortho-plan-2026-09-09.json'
    pinned = json.loads(baseline.read_text(encoding='utf8'))
    assert pinned['nativeResolutionMetres'] == .16 and pinned['collection']=='orto-o2-2025'
    windows = []
    for identifier, requested, res in SPECS:
        # Both selected tiles share this native grid. At coarse .8m it also aligns.
        anchor = [605000,6605000]
        bounds = [round(anchor[a]+math.floor((requested[a]-anchor[a])/res)*res,6) for a in range(2)]
        bounds += [round(anchor[a]+math.ceil((requested[a+2]-anchor[a])/res)*res,6) for a in range(2)]
        sources = [s['id'] for s in pinned['sources'] if all(bounds[a]<s['boundsEpsg3006'][a+2] and bounds[a+2]>s['boundsEpsg3006'][a] for a in range(2))]
        windows.append(dict(id=identifier,boundsEpsg3006=bounds,resolutionMetres=res,
            width=round((bounds[2]-bounds[0])/res),height=round((bounds[3]-bounds[1])/res),sourceIds=sources,
            purpose='facility reference; roof and site image edges, not surveyed walls'))
    plan = {**pinned,'kind':'angso-facility-reference-plan','createdAt':datetime.now(timezone.utc).isoformat(),
        'sourcePlanSha256':sha(baseline),'windows':windows}
    write(OUT/'plan.json',plan)
    spec=importlib.util.spec_from_file_location('angso_acquire',ROOT/'angsobuild/mapping/lm-ortho-acquire.py')
    intake=importlib.util.module_from_spec(spec);spec.loader.exec_module(intake)
    # This intake verifies source grid, byte range access, RGBI semantics and masks.
    import sys
    if '--offline' not in sys.argv:
        intake.acquire(plan,windows,OUT,HERE/'orthophoto-acquisition.json')
    acquisition=json.loads((HERE/'orthophoto-acquisition.json').read_text(encoding='utf8'))
    panels=[]
    for window in acquisition['windows']:
        path=OUT/window['rgbFile']
        path.with_suffix('.prj').write_text(CRS.from_epsg(3006).to_wkt(),encoding='ascii')
        with rasterio.open(OUT/window['rasterFile']) as ds:
            rgb=ds.read([1,2,3])
            assert ds.crs.to_epsg()==3006 and np.all(ds.dataset_mask()==255)
            assert np.array_equal(np.asarray(Image.open(path)),rgb.transpose(1,2,0))
            bounds=list(ds.bounds)
            res=ds.res[0]
        panels.append(dict(id=window['id'],path=relative(path),rasterPath=relative(OUT/window['rasterFile']),
            worldFilePath=relative(path.with_suffix('.pgw')),crsFilePath=relative(path.with_suffix('.prj')),
            boundsEPSG3006=bounds,pixelSizeM=res,width=window['width'],height=window['height'],
            sourceIds=[s['id'] for s in window['sources']],captureDate='2025-04-24',
            sha256=sha(path),rasterSha256=window['sha256'],resampling=window['resampling'],validFraction=1))
    model=json.loads((ROOT/'angsobuild/course-model.json').read_text(encoding='utf8'))
    inverse=Transformer.from_crs(3006,4326,always_xy=True)
    forward=Transformer.from_crs(4326,3006,always_xy=True)
    def geometry(ring):
        legacy=[]
        for e,n in ring:
            lon,lat=inverse.transform(e,n)
            legacy.append([round((lon-model['origin']['lon'])*model['mPerLon'],3),round((model['origin']['lat']-lat)*model['mPerLat'],3)])
        return dict(ringEPSG3006=[[round(v,3) for v in p] for p in ring],
            ringBlenderXY=[[round(p[0]-ORIGIN[0],3),round(p[1]-ORIGIN[1],3)] for p in ring],
            ringLegacyXZ=legacy,areaSquareMetres=round(area(ring),2),heightMetres=None)
    outlines=[]
    traces=HERE/'orthophoto-traces.json'
    for raw in json.loads(traces.read_text(encoding='utf8')) if traces.exists() else []:
        record=dict(raw)
        panel=next(p for p in panels if p['id']==record['sourcePanel'])
        w,s,e,n=panel['boundsEPSG3006'];r=panel['pixelSizeM']
        pixels=record.pop('ringPixels')
        ring=[(w+x*r,n-y*r) for x,y in pixels]
        outlines.append({**record,'tracedRingPixels':pixels,'sourceImageSha256':panel['sha256'],**geometry(ring)})
    context=[]
    for b in model['infra']['buildings']:
        ring=[forward.transform(model['origin']['lon']+p[0]/model['mPerLon'],model['origin']['lat']-p[1]/model['mPerLat']) for p in b['ring']]
        e,n=np.mean(ring,axis=0)
        if 605240<e<605840 and 6604720<n<6606330:
            context.append(dict(id=b['id'],label=b.get('name') or 'Existing mapped building',kind='building',
                geometryStatus='existing-model-unreviewed',sourceModel='angsobuild/course-model.json',**geometry(ring)))
    manifest=dict(schemaVersion=1,groundId='angso',kind='blender-georeferenced-facility-reference',
        observedAt=datetime.now(timezone.utc).isoformat(),horizontalCrs='EPSG:3006',originEPSG3006=ORIGIN,
        blenderAxes='X east, Y north, Z up; X=E-605530; Y=N-6605140; metres',
        pixelConvention='bounds are pixel edges; E=minE+x*pixelSizeM; N=maxN-y*pixelSizeM; pixel centres use column+0.5,row+0.5',
        legacyFrame={'originWgs84':model['origin'],'mPerLat':model['mPerLat'],'mPerLon':model['mPerLon'],
            'conversion':'EPSG3006 to WGS84 through PROJ, then x=(lon-origin.lon)*mPerLon, z=(origin.lat-lat)*mPerLat'},
        orthophotos=panels,outlines=outlines,existingModelContext=context,
        sourcePlan=relative(baseline),sourcePlanSha256=sha(baseline),sourceCollection=plan['collection'],
        sourceAssets=plan['sources'],attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.',
        sourceProduct='https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/ortofoto-nedladdning/',
        limitations=['Native 0.16 m is image sampling, not survey accuracy.',
            'Roof image edges may be shifted by roof height and orthorectification; these are not wall footprints.',
            'Building functions require corroboration from photographs or club publications; unconfirmed functions are not assigned.',
            'This reference is the April 2025 condition, not a September 2026 as-built survey.',
            'Heights, roof pitches, facade openings and hidden edges are not established by a nadir image.',
            'December 2025 club plans describe a new golf studio and covered range; April 2025 imagery predates that plan and cannot confirm construction.',
            'Raw pixels remain in ignored cache and are not runtime textures.'])
    for panel in panels:
        image=Image.open(ROOT/panel['path']).convert('RGB');draw=ImageDraw.Draw(image)
        w,s,e,n=panel['boundsEPSG3006'];r=panel['pixelSizeM']
        for f in outlines:
            pts=[((p[0]-w)/r,(n-p[1])/r) for p in f['ringEPSG3006']]
            if not any(0<=x<image.width and 0<=y<image.height for x,y in pts):continue
            draw.line(pts+pts[:1],fill='#24ffff',width=2)
            x,y=np.mean(pts,axis=0)
            draw.text((x+3,y+3),f['id'],fill='#24ffff',stroke_width=2,stroke_fill='black')
        image.save(OUT/(panel['id']+'-review.png'))
        # Replace intake's unannotated placeholder overlay with interpreted edges.
        image.save(OUT/(panel['id']+'-overlay.png'))
    write(HERE/'orthophoto-reference.json',manifest)
    print(json.dumps({'panels':len(panels),'traces':len(outlines),'originEPSG3006':ORIGIN}),flush=True)


if __name__=='__main__':
    try:main()
    except Exception as exc:
        import traceback
        print(json.dumps({'state':'failed','errorType':type(exc).__name__,
            'locations':[dict(file=Path(f.filename).name,line=f.lineno) for f in traceback.extract_tb(exc.__traceback__)]}))
        raise SystemExit(1)
