"""Check saved source bytes, raster coordinates and packaged reference links."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = ROOT / 'angsobuild/cache/facilities-2026-09-10'
spec = json.loads((HERE / 'blender-reference-spec.json').read_text(encoding='utf-8'))
ortho = json.loads((HERE / 'orthophoto-reference.json').read_text(encoding='utf-8'))
for item in spec['inputs']:
    assert hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
build_report = json.loads((HERE / 'blender-build-report.json').read_text(encoding='utf-8'))
assert build_report['specSha256'] == hashlib.sha256((HERE / 'blender-reference-spec.json').read_bytes()).hexdigest()
assert build_report['blendSha256'] == hashlib.sha256((ROOT / spec['blendPath']).read_bytes()).hexdigest()
pixel_samples = 0
for panel in spec['orthophotos']:
    with rasterio.open(ROOT / panel['rasterPath']) as dataset:
        assert dataset.crs.to_epsg() == 3006
        assert dataset.width == panel['width'] and dataset.height == panel['height']
        expected = panel['boundsEPSG3006']
        assert np.max(np.abs(np.array(dataset.bounds)-expected)) < .0001
        assert abs(dataset.transform.a-panel['pixelSizeM']) < 1e-8
        assert abs(dataset.transform.e+panel['pixelSizeM']) < 1e-8
        assert dataset.transform.b == dataset.transform.d == 0
        rgb = np.asarray(Image.open(ROOT / panel['path']).convert('RGB'))
        raster = dataset.read([1, 2, 3]).transpose(1, 2, 0)
        assert raster.shape == rgb.shape
        for row in np.linspace(0, dataset.height-1, 13, dtype=int):
            for column in np.linspace(0, dataset.width-1, 13, dtype=int):
                assert np.array_equal(raster[row, column], rgb[row, column]), (panel['id'], row, column)
                pixel_samples += 1
        affine = [float(value) for value in (ROOT / panel['worldFilePath']).read_text().split()]
        expected_affine = [dataset.transform.a, 0, 0, dataset.transform.e,
                           dataset.transform.c+dataset.transform.a/2, dataset.transform.f+dataset.transform.e/2]
        assert np.max(np.abs(np.array(affine)-expected_affine)) < 1e-6
        assert (ROOT / panel['crsFilePath']).exists()
panels = {p['id']: p for p in spec['orthophotos']}
e0, n0 = spec['originEPSG3006']
maximum_roundtrip = 0
inverse = Transformer.from_crs(3006, 4326, always_xy=True)
forward = Transformer.from_crs(4326, 3006, always_xy=True)
ids = set()
for outline in spec['outlines']:
    assert outline['id'] not in ids, 'Duplicate outline ID'
    ids.add(outline['id'])
    points = outline['ringEPSG3006']
    assert len(points) >= 2
    panel_id = outline.get('sourcePanel')
    if panel_id in panels and not outline['kind'].startswith('inherited'):
        w, s, e, n = panels[panel_id]['boundsEPSG3006']
        assert all(w-.01 <= p[0] <= e+.01 and s-.01 <= p[1] <= n+.01 for p in points), outline['id']
    for index, (e, n) in enumerate(points):
        e2, n2 = forward.transform(*inverse.transform(e, n))
        maximum_roundtrip = max(maximum_roundtrip, abs(e-e2), abs(n-n2))
        if 'ringBlenderXY' in outline:
            actual = outline['ringBlenderXY'][index]
            assert max(abs(actual[0]-(e-e0)), abs(actual[1]-(n-n0))) < .002
assert maximum_roundtrip < .002


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ('href', 'src') and value and not urlparse(value).scheme and not value.startswith('#'):
                self.links.append(value)


parser = Links()
parser.feed((CACHE / 'index.html').read_text(encoding='utf-8'))
missing = [link for link in parser.links if not (CACHE / unquote(link)).resolve().exists()]
assert not missing, missing
report = {'passed': True, 'pinnedInputs': len(spec['inputs']), 'orthophotos': len(spec['orthophotos']),
          'exactRgbPixelSamples': pixel_samples, 'pixelEdgeBoundsAndWorldFilesVerified': True,
          'projectionRoundTripMaxMetres': maximum_roundtrip, 'outlineCount': len(spec['outlines']),
          'localGalleryLinks': len(parser.links), 'missingLinks': missing,
          'scope': 'Data integrity and coordinate handling; does not establish survey accuracy or complete architecture.'}
(HERE / 'reference-audit.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report))
