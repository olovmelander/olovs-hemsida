"""Check exported images against their source TIFFs and preserve source coordinates."""
import contextlib
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT/'puttombuild/facilities'
ortho = json.loads((HERE/'orthophoto-reference.json').read_text(encoding='utf-8'))
inventory = json.loads((HERE/'facility-inventory.json').read_text(encoding='utf-8'))
inverse = Transformer.from_crs(3006, 4326, always_xy=True)
legacy = ortho['legacyFrame']
roundtrip_error = 0
for facility in inventory['facilities']:
    inherited = facility.get('inheritedModel')
    if not inherited:
        continue
    for en, xz in zip(inherited['ringEpsg3006'], inherited['ringLocalXZ']):
        lon, lat = inverse.transform(*en)
        actual = [(lon-legacy['origin']['lon'])*legacy['mPerLon'],
                  (legacy['origin']['lat']-lat)*legacy['mPerLat']]
        roundtrip_error = max(roundtrip_error, *(abs(a-b) for a, b in zip(actual, xz)))
assert roundtrip_error < .001
samples_checked = 0
panels_checked = []
for panel in ortho['panels']:
    assert hashlib.sha256((ROOT/panel['png']).read_bytes()).hexdigest() == panel['pngSha256']
    assert hashlib.sha256((ROOT/panel['tif']).read_bytes()).hexdigest() == panel['tifSha256']
    with contextlib.ExitStack() as stack:
        original = [stack.enter_context(rasterio.open(ROOT/source['file'])) for source in panel['sourceInputs']]
        exported = stack.enter_context(rasterio.open(ROOT/panel['tif']))
        png = np.array(Image.open(ROOT/panel['png']))
        assert exported.crs.to_epsg() == 3006
        assert (exported.width, exported.height) == (panel['width'], panel['height'])
        assert np.allclose(exported.transform.to_gdal(), panel['geoTransform'], rtol=0, atol=1e-8)
        assert np.allclose(exported.bounds, panel['boundsEpsg3006'], rtol=0, atol=1e-8)
        assert tuple(exported.read([1, 2, 3]).shape) == (3, png.shape[0], png.shape[1])
        assert np.array_equal(np.moveaxis(exported.read([1, 2, 3]), 0, 2), png)
        worldfile = [float(value) for value in (ROOT/panel['worldfile']).read_text().split()]
        affine = exported.transform
        assert np.allclose(worldfile, [affine.a, affine.d, affine.b, affine.e,
                                      affine.c+affine.a/2, affine.f+affine.e/2], rtol=0, atol=1e-7)
        coords = [rasterio.transform.xy(affine, int(row), int(col), offset='center')
                  for row in np.linspace(0, exported.height-1, 19)
                  for col in np.linspace(0, exported.width-1, 23)]
        actual = list(exported.sample(coords))
        for point, rgba in zip(coords, actual):
            candidates = [src for src in original if src.bounds.left <= point[0] < src.bounds.right
                          and src.bounds.bottom < point[1] <= src.bounds.top]
            assert candidates, 'No original source covers sample'
            assert any(np.array_equal(next(src.sample([point])), rgba) for src in candidates), 'Source pixel mismatch'
            samples_checked += 1
        panels_checked.append(panel['id'])
report = {'passed': True, 'panels': panels_checked, 'originalTiffSamplesMatched': samples_checked,
          'rgbPngMatchesAllExportedPixels': True, 'worldFilesAndGeotiffsAgree': True,
          'legacyCoordinateRoundtripMaximumErrorMetres': roundtrip_error,
          'checksEstablishSoftwarePreservationNotSurveyAccuracy': True}
(HERE/'reference-source-audit.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report))
