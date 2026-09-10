"""Fetch bounded native LM facility references using existing credential handling.

Run geobuild/cache/ortho-venv/Scripts/python.exe on this file after the adjacent
discover-orthophoto.mjs. Source raster pixels stay in the ignored build cache.
"""
from pathlib import Path
from datetime import datetime, timezone
import importlib.util
import json
import math
import sys
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
REFERENCE = HERE / 'reference'
CACHE = ROOT / 'ribbingsforsbuild/cache/facilities-reference-2026-09-10/ortho'
ORIGIN = [448975.5, 6536024.5]
spec = importlib.util.spec_from_file_location('verified_ortho', ROOT / 'upsalabuild/mapping/lm-ortho-acquire.py')
ortho = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ortho)


def rel(path):
    return path.relative_to(ROOT).as_posix()


def main():
    import numpy as np
    import rasterio
    from pyproj import CRS
    from shapely.geometry import box, shape
    from shapely.ops import unary_union

    catalog = json.loads((REFERENCE / 'orthophoto-catalog.json').read_text(encoding='utf8'))
    if not catalog['coverage']['complete'] or catalog['fallbackCollections']:
        raise ValueError('Expected a complete latest campaign')
    native = min(i['resolutionMetres'] for i in catalog['items'])
    # Bounds below are engine x/z. Facility Blender Z uses absolute RH2000.
    definitions = [
        ('site-overview', [-420,-720,850,320], native*5, 'All facilities including southwest maintenance yard, range and estate'),
        ('campus-native', [385,-660,845,-120], native, 'Clubhouse, practice green, entire range and nearby estate'),
        ('clubhouse-close', [430,-515,550,-385], native, 'Clubhouse, annex, courtyard, practice green and access'),
        ('range-tee-close', [480,-465,715,-330], native, 'Northern range end, candidate hitting line, access and adjacent estate road'),
        ('estate-close', [675,-560,815,-425], native, 'Estate farm courtyard and surrounding roofs'),
        ('maintenance-close', [-420,95,-260,270], native, 'Southwest maintenance yard with all visible sheds and hardstanding'),
        ('manor-close', [440,-660,625,-475], native, 'Manor main house, wings, estate garden buildings, boathouse and pier'),
        ('estate-north-close', [675,-660,815,-535], native, 'Northern estate outbuildings'),
        ('range-mats-detail', [615,-446,677,-421], native, 'Native pixels of shelter, open mat row and apron'),
    ]
    sources=[]
    for item in catalog['items']:
        asset=item['assets']['data']
        sources.append(dict(id=item['id'], href=asset['href'], bytes=asset['bytes'],
            boundsEpsg3006=item['projBbox'], width=asset['projShape'][1], height=asset['projShape'][0],
            capturedAt=item['capturedAt'], captureStart=item.get('captureStart'), captureEnd=item.get('captureEnd')))
    # All requested windows fit in one 2500 m source tile.
    anchor=next(s for s in sources if s['boundsEpsg3006'][0]<ORIGIN[0]<s['boundsEpsg3006'][2]
                and s['boundsEpsg3006'][1]<ORIGIN[1]<s['boundsEpsg3006'][3])['boundsEpsg3006'][:2]
    windows=[]
    for name, local, resolution, purpose in definitions:
        requested=[ORIGIN[0]+local[0],ORIGIN[1]-local[3],ORIGIN[0]+local[2],ORIGIN[1]-local[1]]
        bounds=[round(anchor[a]+math.floor((requested[a]-anchor[a])/resolution)*resolution,6) for a in range(2)]
        bounds += [round(anchor[a]+math.ceil((requested[a+2]-anchor[a])/resolution)*resolution,6) for a in range(2)]
        width,height=[round((bounds[a+2]-bounds[a])/resolution) for a in range(2)]
        if width*height>16000000:raise ValueError('Pixel budget exceeded')
        ids=[s['id'] for s in sources if all(bounds[a]<s['boundsEpsg3006'][a+2] and bounds[a+2]>s['boundsEpsg3006'][a] for a in range(2))]
        windows.append(dict(id=name,boundsEpsg3006=bounds,width=width,height=height,
            resolutionMetres=resolution,sourceIds=ids,purpose=purpose,features=[]))
    sources=[s for s in sources if any(s['id'] in w['sourceIds'] for w in windows)]
    frame=dict(originEpsg3006=ORIGIN,terrainTileInternalOriginHeightRH2000=69.14,unit='metre',
        blender='X=easting-448975.5; Y=northing-6536024.5; Z=absolute heightRH2000',
        engine='x=easting-448975.5; z=6536024.5-northing; y=absolute heightRH2000',
        note='Canonical grid frame. Facility heights are absolute RH2000. The renderer restores the terrain tile internal 69.14 m origin before scene composition. No geographic flat-earth conversion or meridian convergence correction.')
    plan=dict(schemaVersion=1,groundId='ribbingsfors',kind='facility-orthophoto-reference-plan',
        observedAt=datetime.now(timezone.utc).isoformat(),collection=catalog['collection'],
        horizontalCrs='EPSG:3006',nativeResolutionMetres=native,sources=sources,windows=windows,
        frame=frame,pixelConvention='Pixel-edge bounds; E=minE+(column+0.5)*resolution; N=maxN-(row+0.5)*resolution')
    ortho.write_json(CACHE/'plan.json',plan)
    ortho.write_json(REFERENCE/'orthophoto-plan.json',plan)
    acquisition=REFERENCE/'orthophoto-acquisition.json'
    ortho.acquire(plan,windows,CACHE,acquisition)
    report=json.loads(acquisition.read_text(encoding='utf8'))
    # Shared acquisition reader has an Upsala report label; actual source checks
    # are pinned to the supplied plan. Correct the reused report label explicitly.
    report['groundId']='ribbingsfors'
    ortho.write_json(acquisition,report)

    footprints=[]
    metadata=[]
    for source in sources:
        item=next(i for i in catalog['items'] if i['id']==source['id'])
        url=item['assets']['metadata']['href']
        with urlopen(url,timeout=30) as response:raw=response.read(8*1024*1024+1)
        if len(raw)>8*1024*1024:raise ValueError('Source metadata unexpectedly large')
        file=CACHE/(source['id']+'-flygbild.json');file.write_bytes(raw)
        document=json.loads(raw)
        if document.get('crs',{}).get('properties',{}).get('name')!='urn:ogc:def:crs:EPSG::3006':
            raise ValueError('Unexpected source seam CRS')
        metadata.append(dict(id=source['id'],href=url,file=rel(file),sha256=ortho.digest(file)))
        for f in document['features']:
            geom=shape(f['geometry'])
            if not geom.is_valid:raise ValueError('Invalid source seam polygon')
            footprints.append((source['id'],f['properties']['bildidentitet'],f['properties']['tidpunkt'],geom))

    panels=[]
    for w,rec in zip(windows,report['windows']):
        area=box(*w['boundsEpsg3006']);covered=[];contributing=[]
        for source,image,date,geom in footprints:
            intersection=area.intersection(geom)
            if intersection.area<1e-8:continue
            covered.append(intersection)
            contributing.append(dict(sourceId=source,imageId=image,capturedAt=date,
                fraction=round(intersection.area/area.area,8)))
        coverage=unary_union(covered).area/area.area
        if coverage<.99999:raise ValueError('Source-date coverage gap')
        tif=CACHE/rec['rasterFile'];png=CACHE/rec['rgbFile']
        png.with_suffix('.prj').write_text(CRS.from_epsg(3006).to_wkt(version='WKT1_GDAL'))
        with rasterio.open(tif) as ds:
            valid=bool((ds.dataset_mask()==255).all())
            if not valid or ds.crs.to_epsg()!=3006:raise ValueError('Output raster validation failed')
        bounds=rec['boundsEpsg3006']
        corners=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]]
        panels.append(dict(id=w['id'],purpose=w['purpose'],png=rel(png),tif=rel(tif),
            worldfile=rel(png.with_suffix('.pgw')),projectionFile=rel(png.with_suffix('.prj')),
            pngSha256=ortho.digest(png),tifSha256=ortho.digest(tif),width=rec['width'],height=rec['height'],
            boundsEpsg3006=bounds,pixelSizeMetres=w['resolutionMetres'],
            nativePixels=w['resolutionMetres']==native,resampling=rec['resampling'],
            cornersBlenderXY=[[e-ORIGIN[0],n-ORIGIN[1]] for e,n in corners],
            boundsEngineXZ=[bounds[0]-ORIGIN[0],ORIGIN[1]-bounds[3],bounds[2]-ORIGIN[0],ORIGIN[1]-bounds[1]],
            sourceCaptureDates=sorted(set(c['capturedAt'][:10] for c in contributing)),
            contributingImages=contributing,captureCoverageFraction=round(coverage,8),validFraction=1.0))
    manifest=dict(schemaVersion=1,groundId='ribbingsfors',observedAt=datetime.now(timezone.utc).isoformat(),
        source='Lantmateriet Ortofoto Nedladdning',collection=catalog['collection'],
        nativeResolutionMetres=native,frame=frame,panels=panels,sourceMetadata=metadata,
        attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.',
        limitations=['Capture year 2024; retrieved in 2026. No newer published imagery intersects this AOI in the live catalogue.',
            '16 cm ground sample distance is not surveyed building-position accuracy. Roof edges include overhang and relief displacement.',
            'Orthophotos provide plan shape and surface evidence; roof height and facade detail require laser or ground photos.',
            'Native TIFF bands are RGBI with explicit validity; PNG reference is RGB only. Raw pixels remain local reference assets.'])
    ortho.write_json(REFERENCE/'orthophoto-manifest.json',manifest)
    print(json.dumps(dict(panels=len(panels),sourceDates=sorted({d for p in panels for d in p['sourceCaptureDates']}),manifest=rel(REFERENCE/'orthophoto-manifest.json'))))


if __name__=='__main__':
    try:main()
    except Exception as exc:
        import traceback
        print(json.dumps(dict(state='failed',errorType=type(exc).__name__,locations=[dict(file=Path(f.filename).name,line=f.lineno) for f in traceback.extract_tb(exc.__traceback__)])),file=sys.stderr)
        raise SystemExit(1)
