"""Intersect published orthophoto seam polygons with each Johannesberg review window.

Tile-level datetimes are representative, whereas the published flygbild mosaic
polygons identify the imagery contributing to a specific part of the tile.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen
from shapely.geometry import shape, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
cache = ROOT / 'johannesbergbuild/cache/lm-ortho'
plan_file = cache / 'plan.json'
plan = json.loads(plan_file.read_text(encoding='utf-8'))
discovery = json.loads((ROOT / 'geo_data/course-v2/johannesberg/acquisition/d2-discovery.json').read_text(encoding='utf-8'))
sources, footprints = [], []
for source in plan['sources']:
    item = next(i for i in discovery['orthophoto']['items'] if i['id'] == source['id'])
    url = item['assets']['metadata']['href']
    with urlopen(url, timeout=30) as response:
        raw = response.read(8*1024*1024+1)
    if len(raw) > 8*1024*1024:
        raise ValueError('Source metadata unexpectedly large')
    document = json.loads(raw)
    if document.get('crs',{}).get('properties',{}).get('name') != 'urn:ogc:def:crs:EPSG::3006':
        raise ValueError('Unexpected source footprint CRS')
    (cache / (source['id'] + '-flygbild.json')).write_bytes(raw)
    sources.append(dict(id=source['id'], href=url, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                        features=len(document['features'])))
    for f in document['features']:
        geom = shape(f['geometry'])
        if not geom.is_valid:
            raise ValueError('Invalid source seam polygon')
        footprints.append((source['id'], f['properties']['bildidentitet'], f['properties']['tidpunkt'], geom))

windows=[]
for window in plan['windows']:
    area=box(*window['boundsEpsg3006'])
    contributing=[]
    covered=[]
    for source, identity, date, geom in footprints:
        if source not in window['sourceIds']:
            continue
        intersection=area.intersection(geom)
        if intersection.area <= 1e-8:
            continue
        covered.append(intersection)
        contributing.append(dict(sourceId=source, imageId=identity, capturedAt=date,
                                 intersectionSquareMetres=round(intersection.area,4),
                                 windowFraction=round(intersection.area/area.area,8)))
    union=unary_union(covered)
    coverage=union.area/area.area
    if not contributing or coverage < .99999:
        raise ValueError('Incomplete source image date coverage')
    dates=[c['capturedAt'] for c in contributing]
    windows.append(dict(id=window['id'], boundsEpsg3006=window['boundsEpsg3006'], coverageFraction=round(coverage,8),
                        captureRange=dict(first=min(dates),last=max(dates)), contributingImages=contributing))

report=dict(schemaVersion=1,groundId='johannesberg',kind='orthophoto-window-capture-evidence',observedAt=datetime.now(timezone.utc).isoformat(),
            horizontalCrs='EPSG:3006',collection=plan['collection'],planSha256=hashlib.sha256(plan_file.read_bytes()).hexdigest(),
            method='Intersect native EPSG:3006 review pixel-edge bounds with published flygbild mosaic source polygons.',
            sourceMetadata=sources,windows=windows,
            limitations=['Capture dates describe source pixels, not dates of course construction or change.',
                         'Ground sample distance does not establish absolute positional accuracy.'])
out=ROOT / 'geo_data/course-v2/johannesberg/reference/lm-ortho-capture-2026-09-09.json'
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(windows=len(windows), dates=sorted(set(c['capturedAt'][:10] for w in windows for c in w['contributingImages'])),
                      nativeWindowDates=sorted(set(c['capturedAt'][:10] for w in windows if w['id']!='ground-overview' for c in w['contributingImages'])))))
