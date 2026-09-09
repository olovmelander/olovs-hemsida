"""Clip the checksummed national PolygonZ water source to Tortuna's terrain."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'visbybuild/mapping'))
from lm_ortho import authorization, NoRedirect


def main():
    from shapely.geometry import box, mapping
    spec = importlib.util.spec_from_file_location('water_decoder', ROOT / 'geo_data/course-v2/lidingo/reference/clip-water-breakgeometry.py')
    decoder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(decoder)
    auth = authorization()
    opener = urllib.request.build_opener(NoRedirect())
    url = 'https://api.lantmateriet.se/stac-hojd/v1/collections/dtm-cog/items/661_59'
    with opener.open(urllib.request.Request(url, headers={'Authorization': auth}), timeout=60) as r:
        item = json.loads(r.read(2 * 1024 * 1024))
    asset = item['assets']['breakgeometry']
    if asset['href'] != 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/66_5/m661_59_brytgeometri.gpkg':
        raise ValueError('Water source URL changed')
    with opener.open(urllib.request.Request(asset['href'], headers={'Authorization': auth}), timeout=60) as r:
        data = r.read(16 * 1024 * 1024 + 1)
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > 16 * 1024 * 1024 or asset['file:checksum'] != '1220' + digest or asset['file:size'] != len(data):
        raise ValueError('Water source integrity check failed')
    cache = ROOT / 'tortunabuild/cache/water.gpkg'
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    extent = box(595352.5, 6612851.5, 599448.5, 6616947.5)
    features = []
    with sqlite3.connect(f'file:{cache}?mode=ro', uri=True) as db:
        for fid, blob, classification in db.execute('select fid,geom,classification from polygons order by fid'):
            original = decoder.decode_gpkg(blob)
            if not original.is_valid or not original.has_z:
                raise ValueError('Invalid source water topology')
            if not original.intersects(extent):
                continue
            zs = decoder.heights(original)
            clipped = original.intersection(extent)
            features.append(dict(type='Feature', id=f'lm-water-661_59-{fid}',
                properties=dict(sourceId='water-breaks-lm-1m', sourceFid=fid, classification=classification,
                    heightRH2000=zs[0] if max(zs)-min(zs) < 1e-7 else None,
                    heightRangeRH2000=[min(zs), max(zs)], clipBoundaryIsShore=False), geometry=mapping(clipped)))
    out = ROOT / 'geo_data/course-v2/tortuna/acquisition'
    target = out / 'water-epsg3006.geojson'
    target.write_text(json.dumps(dict(type='FeatureCollection', crs=dict(type='name', properties=dict(name='EPSG:3006')), features=features), separators=(',', ':')) + '\n')
    (out / 'water-evidence.json').write_text(json.dumps(dict(schemaVersion=1, groundId='tortuna',
        acquiredAt=datetime.now(timezone.utc).isoformat(), sourceUrl=asset['href'], sourceSha256=digest,
        sourceBytes=len(data), sha256=hashlib.sha256(target.read_bytes()).hexdigest(), features=len(features),
        sourceCommit=os.environ.get('GITHUB_SHA'), boundsEpsg3006=list(extent.bounds),
        attribution='Markhöjdmodell Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.',
        limitations=['Source surface elevations are not bathymetry.', 'Small ponds and ditches may be absent from this national dataset.']), indent=2) + '\n')
    print(json.dumps(dict(waterFeatures=len(features), sourceChecksumVerified=True)))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps(dict(state='failed', errorType=type(e).__name__)), file=sys.stderr)
        raise SystemExit(1)
