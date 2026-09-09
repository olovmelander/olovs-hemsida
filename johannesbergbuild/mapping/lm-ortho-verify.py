"""Verify source hashes, RGBI semantics and pixel-centre registration offline."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import ColorInterp
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
cache=ROOT / 'johannesbergbuild/cache/lm-ortho'
reference=ROOT / 'geo_data/course-v2/johannesberg/reference'
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
plan_file=reference / 'lm-ortho-plan-2026-09-09.json'
report_file=reference / 'lm-ortho-acquisition-2026-09-09.json'
plan=json.loads(plan_file.read_text(encoding='utf-8'))
report=json.loads(report_file.read_text(encoding='utf-8'))
capture=json.loads((reference / 'lm-ortho-capture-2026-09-09.json').read_text(encoding='utf-8'))
assert report['state']=='acquired-for-review' and report['access']['authorized']
assert report['planSha256']==capture['planSha256']==sha(plan_file)==sha(cache / 'plan.json')
assert {w['id'] for w in plan['windows']}=={w['id'] for w in report['windows']}
pixels=0
for record in report['windows']:
    window=next(w for w in plan['windows'] if w['id']==record['id'])
    raster=cache / record['rasterFile']
    rgb=cache / record['rgbFile']
    assert raster.parent==rgb.parent==cache
    assert sha(raster)==record['sha256'] and sha(rgb)==record['rgbSha256']
    with rasterio.open(raster) as src:
        assert src.crs.to_epsg()==3006 and src.count==4 and src.dtypes==('uint8',)*4
        assert src.colorinterp==(ColorInterp.red,ColorInterp.green,ColorInterp.blue,ColorInterp.undefined)
        assert np.all(src.dataset_mask()==255)
        assert src.width==record['width']==window['width'] and src.height==record['height']==window['height']
        assert np.allclose(src.transform.to_gdal(),record['geoTransform'],rtol=0,atol=1e-8)
        assert np.allclose(src.bounds,window['boundsEpsg3006'],rtol=0,atol=1e-8)
        assert np.allclose(src.res,[window['resolutionMetres']]*2,rtol=0,atol=1e-8)
        assert np.array_equal(src.read([1,2,3]).transpose(1,2,0),np.array(Image.open(rgb)))
        world=list(map(float,rgb.with_suffix('.pgw').read_text().split()))
        assert np.allclose(world,[src.res[0],0,0,-src.res[1],src.transform.c+src.res[0]/2,src.transform.f-src.res[1]/2],rtol=0,atol=1e-8)
    date=next(w for w in capture['windows'] if w['id']==record['id'])
    assert date['coverageFraction']>.99999
    assert date['captureRange']['first'] <= date['captureRange']['last']
    pixels+=record['width']*record['height']

result=dict(schemaVersion=1,groundId='johannesberg',kind='orthophoto-offline-verification',
            observedAt=datetime.now(timezone.utc).isoformat(),state='passed',
            planSha256=sha(plan_file),acquisitionSha256=sha(report_file),
            validatedWindows=len(report['windows']),nativeWindows=sum(w['resolutionMetres']==.16 for w in report['windows']),pixels=pixels,
            checks=['all expected windows present','raster and RGB checksums','EPSG:3006 and exact planned pixel-edge grid',
                    'explicit RGBI band interpretation with independent validity mask','all pixels valid',
                    'PNG RGB values exactly match GeoTIFF','worldfile pixel centres','complete source-image capture-date coverage'],
            limitations=['Internal coordinate consistency does not measure absolute geolocation accuracy.',
                         'Image verification does not accept any feature geometry.'])
(reference / 'lm-ortho-validation-2026-09-09.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
