"""Validate imagery bytes/grid and exact retained facility joins, then write review docs."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import numpy as np
import rasterio
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
read=lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
sha=lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
ortho=read(HERE/'orthophoto-reference.json')
catalog=read(HERE/'orthophoto-catalog-check.json')
assert catalog['assetsMatchRetained2025Sources'] and catalog['coverage']['complete'] and catalog['collection']=='orto-o2-2025'
checks=[]
assert len(ortho['windows'])==12
for w in ortho['windows']:
    for pathkey,hashkey in [('imagePath','imageSha256'),('rasterPath','rasterSha256'),('worldFilePath','worldFileSha256'),('projectionPath','projectionSha256')]:
        assert sha(ROOT/w[pathkey])==w[hashkey], w['id']+' checksum mismatch'
    with rasterio.open(ROOT/w['rasterPath']) as src:
        assert src.crs.to_epsg()==3006 and src.count==3
        assert [src.width,src.height]==[w['width'],w['height']]
        assert np.allclose(src.bounds,w['boundsEpsg3006'],rtol=0,atol=1e-7)
        assert np.allclose(src.res,[w['resolutionMetres']]*2,rtol=0,atol=1e-8)
        pixels=src.read()
        assert np.array_equal(pixels.transpose(1,2,0),np.asarray(Image.open(ROOT/w['imagePath'])))
        values=[float(v) for v in (ROOT/w['worldFilePath']).read_text().split()]
        assert np.allclose(values,[src.transform.a,0,0,src.transform.e,src.transform.c+src.transform.a/2,src.transform.f+src.transform.e/2],rtol=0,atol=1e-7)
    checks.append(dict(id=w['id'],checksums=True,epsg3006=True,rgbExact=True,worldFilePixelCentres=True,width=w['width'],height=w['height']))

inventory=read(HERE/'facility-inventory.json')
source_maps={}
for record in inventory['mappedFeatures']:
    path=record['sourceGeometryPath']
    if path not in source_maps:
        source_maps[path]={f['id']:f for f in read(ROOT/path)['features']}
    assert record['geometryEpsg3006']==source_maps[path][record['id']]['geometry']
    assert record['sourceGeometryFileSha256']==sha(ROOT/path)
assert len(set(f['id'] for f in inventory['mappedFeatures']))==len(inventory['mappedFeatures'])
for f in inventory['unresolvedFacilities']:
    assert f['geometryEpsg3006'] is None and f['sourceFootprintId'] is None
for source in inventory['inputs']:
    assert sha(ROOT/source['path'])==source['sha256']
report=dict(schemaVersion=1,groundId='lidingo',checkedAt=datetime.now(timezone.utc).isoformat(),state='pass',
    imagery=checks,mappedFeatures=len(inventory['mappedFeatures']),exactSourceGeometryJoins=True,duplicateFeatureIds=False,
    unresolvedEntriesWithoutInventedFootprints=len(inventory['unresolvedFacilities']),currentCatalogMatchesRetained2025Sources=True,
    limitation='Checks establish file integrity, coordinate consistency and faithful source joins; they do not measure absolute geolocation accuracy or establish current facility conditions.')
(HERE/'geospatial-reference-validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')

lines=['# Lidingö orthophoto reference package','',
 '**Twelve georeferenced reference images are ready for Blender:** a full facility-corridor overview and five detail crops, each paired with 2025 national imagery and a 2019 municipal comparator. All raster pixels remain in the ignored local cache.','',
 'A live Lantmäteriet STAC check at `'+catalog['checkedAt']+'` confirms `orto-o2-2025` remains the latest complete campaign covering the course and its selected asset identities/sizes match the retained imagery. See [catalog evidence](orthophoto-catalog-check.json).','',
 'The 2025 pixels were captured **31 May 2025** at **0.16 m/pixel**. Exact contributing frame timestamps and image IDs are attached per crop in the [manifest](orthophoto-reference.json). The municipal images belong to the **2019 campaign**; exact capture date and product GSD remain unknown. Their original sampled grid is 0.5 m/pixel in EPSG:3011, reprojected here to EPSG:3006 at 0.5 m/pixel using nearest-neighbour sampling.','',
 '## Import coordinates','',
 '- Horizontal CRS: **EPSG:3006**, SWEREF 99 TM; all bounds below are metres and pixel outer edges.','- Vertical evidence: **RH2000 / EPSG:5613**. Orthophotos contain no building-height measurement.',
 '- Blender origin: **E 677700.5, N 6586399.5, H 25.0 m**. Use `X=E−677700.5`, `Y=N−6586399.5`, `Z=RH2000−25.0` and metres.',
 '- Images are north-up. Plane width is `maxE−minE`, plane height is `maxN−minN`; its Blender XY centre is the bounds midpoint minus the horizontal origin. Place a reference plane below terrain as appropriate; its display elevation is not measured image data.',
 '- Pixel centres: `E=minE+(col+0.5)*resolution`, `N=maxN−(row+0.5)*resolution`. Every PNG has a `.pgw` worldfile and `.prj`; every GeoTIFF embeds EPSG:3006.',
 '- The application uses X east, Y RH2000 height and Z south. An exported Blender GLB with the stated vertical origin needs a +25 m height translation in that application frame.','',
 '## Crop register','',
 'All image paths are relative to the repository. Bounds are `[minE, minN, maxE, maxN]`. Full SHA-256 values for PNG, GeoTIFF, worldfile, CRS file and original source raster are in the manifest.','',
 '| Image ID | Bounds EPSG:3006 | Pixels | m/pixel | Capture |','| --- | --- | --- | ---: | --- |']
for w in ortho['windows']:
    lines.append('| `'+w['id']+'` | '+', '.join(f'{v:.2f}' for v in w['boundsEpsg3006'])+' | '+str(w['width'])+' × '+str(w['height'])+' | '+str(w['resolutionMetres'])+' | '+str(w.get('captureDate') or '2019 campaign; day unknown')+' |')
lines+=['','Base directory: `lidingobuild/cache/facilities-reference-2026-09-10/ortho/`. Each crop ID names its `.png`, `.tif`, `.pgw`, `.prj` and `.json`. Primary modeling image: `facilities-overview-lm-2025.png`. Native source mosaic: `facilities-native-source-lm-2025.tif` (four measured bands: RGB + NIR; the fourth band is not alpha). Detail reference GeoTIFFs contain RGB only.','',
 '## Provenance and rights','',
 '- 2025: **Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0**. The authenticated byte-range intake is recorded locally in `ortho/native-acquisition.json`; no credentials are stored in reports. [Official terms](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder_pu.pdf).',
 '- 2019: **Lidingö stad, CC0-1.0**. The [official municipal distribution metadata](https://metadata.lidingo.se/store/3/resource/32) explicitly licenses the retained `wms_ortofoto_2019_oppendata` service. Checked-in primary evidence is `geo_data/course-v2/lidingo/mapping/municipal-ortho-2019-licence.json`.',
 '- The exact 2019 source image and worldfile are reused from `lidingobuild/cache/municipal-ortho-2019/`; their hashes are retained. The older municipal public-map LM layer has unknown capture date and is not used as the current reference.',
 '- Acquisition and reference files stay local under the existing ignored cache. This task does not publish source pixels.','',
 '## What the references can establish','',
 'The images support plan shape, building orientation, facility placement and comparisons across dates. At roof edges, relief displacement, eaves, shadow and vegetation can separate the apparent roof perimeter from the ground wall footprint. Photo views and the dated laser roof evidence are needed for facade proportions and elevations. 0.16 m GSD does not imply 0.16 m positional accuracy. Changes after May 2025 require more recent evidence.','',
 'The [facility inventory](facility-inventory.md) identifies retained footprints/surfaces and missing covered tees, practice greens, net details and outlying facilities. Its overlay displays historical source geometry over 2025 pixels as a review aid; it does not approve a retrace.','',
 'The [validation report](geospatial-reference-validation.json) verifies all file hashes, exact PNG/GeoTIFF RGB equality, worldfile pixel centres, EPSG:3006 grids and exact retained feature joins.','',
 'Rebuild with the existing environment:','',
 '```powershell','node lidingobuild/facilities/recheck-orthophoto-catalog.mjs','upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/facilities/prepare-geospatial-reference.py','upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/facilities/build-facility-inventory.py','upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/facilities/verify-geospatial-reference.py','```','']
(HERE/'orthophoto-reference.md').write_text('\n'.join(lines),encoding='utf-8')
print(json.dumps(dict(state='pass',images=len(checks),mappedFeatures=report['mappedFeatures'],unresolved=report['unresolvedEntriesWithoutInventedFootprints'])))
