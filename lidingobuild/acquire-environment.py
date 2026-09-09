"""Acquire bounded LM water vectors and audit 2025 RGBI against existing surfaces.

Credentials stay in request headers. Only water geometry and per-feature
statistics leave the runner; orthophoto pixels are never published.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from datetime import datetime, timezone
from urllib.request import Request, urlopen

import numpy as np
import rasterio
from rasterio.features import geometry_mask, geometry_window
from rasterio.io import MemoryFile
from rasterio.merge import merge
from shapely.geometry import box, mapping, shape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'geo_data/course-v2/lidingo/acquisition'
AUTH = 'Basic ' + base64.b64encode((os.environ['LANTMATERIET_USERNAME'] + ':' + os.environ['LANTMATERIET_PASSWORD']).encode()).decode()
CORE = box(676676.5, 6585375.5, 678724.5, 6587423.5)
WORLD = box(669508.5, 6578207.5, 685892.5, 6594591.5)
STAMP = datetime.now(timezone.utc).isoformat()


def download(url, limit, authorized=False):
    if not url.startswith(('https://api.lantmateriet.se/', 'https://dl1.lantmateriet.se/')):
        raise ValueError('Unexpected source host')
    with urlopen(Request(url, headers={'Authorization': AUTH} if authorized else {}), timeout=60) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Source exceeded bounded download size')
        return data


def polygons(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    if geom.geom_type in ('MultiPolygon', 'GeometryCollection'):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def acquire_water():
    # Reuse the checked GeoPackage header/CRS decoder without running its clip.
    import importlib.util
    spec = importlib.util.spec_from_file_location('water_source', ROOT / 'geo_data/course-v2/lidingo/reference/clip-water-breakgeometry.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    features, sources = [], []
    with tempfile.TemporaryDirectory() as cache:
        for north in range(657, 660):
            for east in range(66, 69):
                item_id = f'{north}_{east}'
                item = json.loads(download(f'https://api.lantmateriet.se/stac-hojd/v1/collections/dtm-cog/items/{item_id}', 2*1024*1024, True))
                asset = item['assets']['breakgeometry']
                data = download(asset['href'], 16*1024*1024, True)
                digest = hashlib.sha256(data).hexdigest()
                if asset['file:checksum'] != '1220' + digest or asset['file:size'] != len(data):
                    raise ValueError(f'{item_id}: water source checksum/size differs')
                source = Path(cache) / (item_id + '.gpkg')
                source.write_bytes(data)
                sources.append({'itemId': item_id, 'href': asset['href'], 'bytes': len(data), 'sha256': digest})
                with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as db:
                    for fid, blob, classification in db.execute('select fid,geom,classification from polygons order by fid'):
                        original = mod.decode_gpkg(blob)
                        if not original.is_valid or not original.has_z:
                            raise ValueError(f'{item_id}/{fid}: invalid source topology')
                        if not original.intersects(WORLD) or CORE.covers(original):
                            continue
                        zs = mod.heights(original)
                        if max(zs) - min(zs) > 1e-7:
                            raise ValueError(f'{item_id}/{fid}: non-flat water, RH2000 range {min(zs)}..{max(zs)}; classification {classification}')
                        clipped = original.intersection(WORLD).difference(CORE)
                        for part, poly in enumerate(polygons(clipped)):
                            if poly.area < 1:
                                continue
                            if not poly.is_valid:
                                raise ValueError('Invalid clipped water topology')
                            features.append({'type': 'Feature', 'id': f'{item_id}/{fid}/{part}',
                                'properties': {'heightRH2000': zs[0], 'sourceItemId': item_id,
                                    'sourceClassification': classification, 'clipBoundaryIsShore': False},
                                'geometry': mapping(poly)})
    target = OUT / 'environment-water.geojson'
    target.write_text(json.dumps({'type': 'FeatureCollection', 'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}},
        'features': features}, separators=(',', ':')) + '\n')
    report = {'schemaVersion': 1, 'groundId': 'lidingo', 'acquiredAt': STAMP,
        'worldBoundsEpsg3006': list(WORLD.bounds), 'excludedCoreBoundsEpsg3006': list(CORE.bounds),
        'sources': sources, 'features': len(features), 'interiorRings': sum(len(shape(f['geometry']).interiors) for f in features),
        'areaSquareMetres': sum(shape(f['geometry']).area for f in features),
        'geometrySha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'method': 'Source PolygonZ intersection with 16 km world minus existing 2 km water window; holes and RH2000 levels retained; no repair, smoothing or sea fill.',
        'attribution': 'Markhöjdmodell Nedladdning, © Lantmäteriet, processed information, CC BY 4.0.'}
    (OUT / 'environment-water.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'waterFeatures': len(features), 'interiorRings': report['interiorRings']}))


def audit_ortho():
    discovery = json.loads((OUT / 'd2-discovery.json').read_text())
    items = discovery['orthophoto']['items']
    audit = {'schemaVersion': 1, 'groundId': 'lidingo', 'checkedAt': STAMP, 'resolutionMetres': 1,
        'sourceResolutionMetres': discovery['orthophoto']['resolutionMetres'],
        'sourceItems': [i['id'] for i in items], 'sourceCaptureYears': [2025],
        'use': 'Per-feature RGBI statistics for reviewing existing 2019 surface candidates; no geometry automatically approved or moved.',
        'rasterExported': False}
    from urllib.error import HTTPError
    for item in items:
        try:
            with urlopen(Request(item['assets']['data']['href'], headers={'Authorization': AUTH, 'Range': 'bytes=0-15'}), timeout=60) as response:
                response.read(16)
        except HTTPError as error:
            if error.code not in (401, 403):
                raise
            audit.update(state='access-denied', httpStatus=error.code, blockedItem=item['id'])
            (OUT / 'ortho-2025-surface-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
            print(json.dumps({'orthophoto': audit['state'], 'status': error.code}))
            return
    with rasterio.Env(GDAL_HTTP_HEADERS='Authorization: ' + AUTH, CPL_CURL_VERBOSE=False,
                      GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_HTTP_TIMEOUT='60'):
        datasets = [rasterio.open('/vsicurl/' + i['assets']['data']['href']) for i in items]
        try:
            if any(d.crs.to_epsg() != 3006 or d.count != 4 for d in datasets):
                raise ValueError('Expected four-band EPSG3006 RGBI imagery')
            rgb, transform = merge(datasets, bounds=discovery['aoi']['bboxEpsg3006'], res=1,
                resampling=rasterio.enums.Resampling.average)
        finally:
            for d in datasets:
                d.close()
    surfaces = json.loads((ROOT / 'lidingobuild/mapping/playing-surfaces.geojson').read_text())
    results = []
    with MemoryFile() as mem:
        with mem.open(driver='GTiff', width=rgb.shape[2], height=rgb.shape[1], count=4,
                      dtype=rgb.dtype, transform=transform, crs='EPSG:3006') as ds:
            for f in surfaces['features']:
                geom = f['geometry']
                window = geometry_window(ds, [geom])
                rows, cols = window.toslices()
                crop = rgb[:, rows, cols].astype(np.float32)
                inside = geometry_mask([geom], out_shape=crop.shape[1:], transform=ds.window_transform(window), invert=True)
                valid = inside & (crop.sum(axis=0) > 0)
                if not valid.any():
                    results.append({'id': f['id'], 'state': 'no-valid-pixels'})
                    continue
                samples = crop[:, valid]
                ndvi = (samples[3] - samples[0]) / np.maximum(1, samples[3] + samples[0])
                results.append({'id': f['id'], 'kind': f['properties']['kind'], 'hole': f['properties'].get('hole'),
                    'pixels': int(valid.sum()), 'validFraction': round(float(valid.sum()/inside.sum()), 4),
                    'meanRGBI': [round(float(v), 3) for v in samples.mean(axis=1)],
                    'medianNDVI': round(float(np.median(ndvi)), 4),
                    'vegetationFractionNDVI025': round(float((ndvi > .25).mean()), 4)})
    audit.update(state='acquired-and-measured', features=results,
        limitations=['Spectral statistics flag review candidates; shadows, irrigation and seasonal mowing prevent automatic boundary approval.',
            'Source capture year is 2025; present-day tee marker and pin positions remain unknown.'])
    (OUT / 'ortho-2025-surface-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print(json.dumps({'orthophoto': audit['state'], 'features': len(results)}))


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    audit_ortho()
    acquire_water()
