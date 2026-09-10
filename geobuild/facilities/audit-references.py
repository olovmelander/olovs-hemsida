"""Independently audit cached source evidence and facility coordinate records.

No producer module is imported and no course/runtime data is changed. Run with
the ortho-venv Python after photo and orthophoto curation, before Blender import.
This checks coordinate arithmetic and trace provenance, not survey accuracy.
"""
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from pyproj import CRS, Transformer
import rasterio
from rasterio.windows import Window
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    inventory = read(HERE/'inventory.json')
    photo_manifest = read(HERE/'photo-sources.json')
    failures = []
    counts = {'sourceTiffs': 0, 'panels': 0, 'rgbPixelSamples': 0,
              'reviewedFeatures': 0, 'contextFeatures': 0,
              'coordinateVertices': 0, 'photos': 0}
    maximum = {'legacyRoundTripMetres': 0.0, 'blenderXYDifferenceMetres': 0.0,
               'pixelTraceDifferenceMetres': 0.0}
    checked_inputs = []

    def check(condition, message):
        if not condition:
            failures.append(message)

    def pinned(path, expected=None):
        actual = sha(path)
        if expected:
            check(actual == expected, f'Hash mismatch: {path.relative_to(ROOT)}')
        checked_inputs.append({'path': path.relative_to(ROOT).as_posix(), 'sha256': actual})

    pinned(HERE/'inventory.json')
    pinned(HERE/'photo-sources.json')
    pinned(ROOT/inventory['sourceModel']['path'], inventory['sourceModel']['sha256'])
    frame = inventory['frame']
    check(frame['epsg'] == 3006, 'Unexpected horizontal CRS')
    check([frame['originE'], frame['originN']] == [684390, 7023040], 'Unexpected Blender origin')
    project = Transformer.from_crs('EPSG:4326', 'EPSG:3006', always_xy=True)
    panels = {p['id']: p for p in inventory['panels']}

    with ExitStack() as stack:
        datasets = {}
        for source in inventory['sources']:
            path = ROOT/source['path']
            pinned(path, source['sha256'])
            metadata_path = ROOT/source['metadataPath']
            pinned(metadata_path, source['metadataSha256'])
            acquisition = read(metadata_path)
            check(acquisition['sha256'] == source['sha256'], f'Acquisition hash mismatch: {source["id"]}')
            ds = stack.enter_context(rasterio.open(path))
            datasets[source['id']] = ds
            check(ds.crs == CRS.from_epsg(3006), f'Source CRS mismatch: {source["id"]}')
            check(np.allclose(ds.res, [.16, .16], atol=1e-12, rtol=0), f'Source spacing mismatch: {source["id"]}')
            check(np.allclose(ds.bounds, source['boundsEPSG3006'], atol=1e-7, rtol=0), f'Source bounds mismatch: {source["id"]}')
            check(all(item['capturedAt'].startswith('2024-06-27') for item in acquisition['sources']), f'Unexpected capture date: {source["id"]}')
            counts['sourceTiffs'] += 1

        for panel in panels.values():
            path = ROOT/panel['imagePath']
            pinned(path, panel['sha256'])
            with Image.open(path) as im:
                check(im.mode == 'RGB', f'Panel mode: {panel["id"]}')
                pixels = np.array(im)
                check(im.size == (panel['width'], panel['height']), f'Panel dimensions: {panel["id"]}')
            affine = rasterio.Affine(*panel['pixelEdgeAffine'])
            w,s,e,n = panel['boundsEPSG3006']
            check(np.allclose([affine.c, affine.f, *(affine*(panel['width'], panel['height']))],
                              [w,n,e,s], atol=1e-7, rtol=0), f'Panel bounds/affine: {panel["id"]}')
            check(affine.b == affine.d == 0 and affine.a > 0 and affine.e < 0,
                  f'Panel orientation: {panel["id"]}')
            check(np.allclose([affine.a, -affine.e], panel['resolutionMetres'], atol=1e-12, rtol=0),
                  f'Panel scale: {panel["id"]}')
            world = [float(v) for v in path.with_suffix('.pgw').read_text().split()]
            expected = [affine.a, affine.d, affine.b, affine.e, affine.c+affine.a/2, affine.f+affine.e/2]
            check(np.allclose(world, expected, atol=1e-7, rtol=0), f'Pixel-centre world file: {panel["id"]}')
            check(CRS.from_wkt(path.with_suffix('.prj').read_text()) == CRS.from_epsg(3006), f'Panel PRJ: {panel["id"]}')
            selected = [datasets[identifier] for identifier in panel['sourceIds']]
            union = unary_union([box(*ds.bounds) for ds in selected])
            check(union.buffer(1e-7).covers(box(w,s,e,n)), f'Incomplete TIFF coverage: {panel["id"]}')
            for row in np.linspace(0, panel['height']-1, 9, dtype=int):
                for col in np.linspace(0, panel['width']-1, 9, dtype=int):
                    point = affine*(int(col)+.5, int(row)+.5)
                    ds = next(ds for ds in selected if ds.bounds.left <= point[0] < ds.bounds.right and ds.bounds.bottom < point[1] <= ds.bounds.top)
                    src_col, src_row = (~ds.transform)*point
                    # At overview 4:1 scale, centres land exactly on native pixel
                    # edges. Remove <1e-6-pixel float noise before nearest ties.
                    src_col, src_row = math.floor(round(src_col, 6)), math.floor(round(src_row, 6))
                    expected_rgb = ds.read(indexes=[1,2,3], window=Window(src_col,src_row,1,1))[:,0,0]
                    check(np.array_equal(pixels[row,col], expected_rgb), f'RGB source mismatch: {panel["id"]} ({col},{row})')
                    counts['rgbPixelSamples'] += 1
            counts['panels'] += 1

    check(bool(inventory['features']), 'No reviewed geometry')
    identifiers = set()
    for group, counter in [('features','reviewedFeatures'), ('existingModelContext','contextFeatures')]:
        for feature in inventory[group]:
            identifier = feature['id']
            check(identifier not in identifiers, f'Duplicate feature ID: {identifier}')
            identifiers.add(identifier)
            ring = np.array(feature['ringEPSG3006'])
            polygon = Polygon(ring)
            check(polygon.is_valid and polygon.area > 0, f'Invalid polygon: {identifier}')
            check(feature['heightMetres'] is None, f'Unsupported physical height: {identifier}')
            check(abs(polygon.area-feature['areaSquareMetres']) <= .02+polygon.length*.00071,
                  f'Area mismatch: {identifier}')
            rectangle = np.array(polygon.minimum_rotated_rectangle.exterior.coords)
            lengths = np.linalg.norm(np.diff(rectangle,axis=0),axis=1)
            dimensions = sorted([lengths[0], lengths[1]], reverse=True)
            check(np.allclose(dimensions,feature['dimensionsMetres'],atol=.012,rtol=0),f'Dimension mismatch: {identifier}')
            blender = ring-np.array([frame['originE'],frame['originN']])
            delta = float(np.max(np.abs(blender-np.array(feature['ringBlenderXY']))))
            maximum['blenderXYDifferenceMetres'] = max(maximum['blenderXYDifferenceMetres'],delta)
            check(delta < .00001, f'Blender offset mismatch: {identifier}')
            legacy = np.array(feature['ringLegacyXZ'])
            lon = frame['legacyOrigin']['lon']+legacy[:,0]/frame['legacyMPerLon']
            lat = frame['legacyOrigin']['lat']-legacy[:,1]/frame['legacyMPerLat']
            back = np.array(project.transform(lon,lat)).T
            residual = float(np.max(np.linalg.norm(back-ring,axis=1)))
            maximum['legacyRoundTripMetres'] = max(maximum['legacyRoundTripMetres'],residual)
            check(residual < .0013, f'Legacy frame round trip: {identifier} {residual}')
            counts['coordinateVertices'] += len(ring)
            if group == 'features':
                panel = panels[feature['sourcePanelId']]
                check(feature['sourceImageSha256'] == panel['sha256'], f'Trace/image mismatch: {identifier}')
                check(feature['sourceIds'] == panel['sourceIds'], f'Trace/source mismatch: {identifier}')
                transform = rasterio.Affine(*panel['pixelEdgeAffine'])
                traced = np.array([transform*tuple(pixel) for pixel in feature['tracedRingPixels']])
                delta = float(np.max(np.abs(traced-ring)))
                maximum['pixelTraceDifferenceMetres'] = max(maximum['pixelTraceDifferenceMetres'],delta)
                check(delta < .00051, f'Trace coordinates mismatch: {identifier}')
                check(all(0 <= x <= panel['width'] and 0 <= y <= panel['height'] for x,y in feature['tracedRingPixels']),
                      f'Trace lies outside panel: {identifier}')
            counts[counter] += 1

    for photo in photo_manifest['photos']:
        path = ROOT/photo['localPath']
        pinned(path, photo['sha256'])
        with Image.open(path) as im:
            check(list(im.size) == photo['dimensionsPx'], f'Photo dimensions: {photo["id"]}')
            exif = im.getexif()
            capture = exif.get_ifd(34665).get(36867) or exif.get(36867)
            check(photo['cameraDateFromExif'] == capture, f'Photo capture date must be DateTimeOriginal: {photo["id"]}')
        if photo.get('metadataPath'):
            metadata_path = ROOT/photo['metadataPath']
            pinned(metadata_path, photo.get('metadataSha256'))
            metadata = read(metadata_path)
            check(metadata['link'] == photo['pageUrl'], f'Photo source page: {photo["id"]}')
            check(metadata['source_url'] == photo['originalImageUrl'], f'Photo image URL: {photo["id"]}')
        else:
            check(photo['pageUrl'].startswith('https://') and photo['originalImageUrl'].startswith('https://'),
                  f'Missing external photo source URL: {photo["id"]}')
        check(photo['visualReview'] is not None, f'Unreviewed photo: {photo["id"]}')
        check(bool(photo['rights']), f'Missing photo rights status: {photo["id"]}')
        counts['photos'] += 1

    report = {'passed': not failures, 'auditedAtUtc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
              'counts': counts, 'maximumDifferences': maximum, 'failures': failures,
              'checks': ['Actual TIFF, metadata, panel and photograph SHA256',
                         'EPSG3006 CRS, full bounds coverage, dimensions, pixel-centre worldfiles',
                         '81 independent original-TIFF RGB samples per panel',
                         'Polygon validity, area and minimum-rectangle dimensions',
                         'Pixel traces, Blender east/north offsets and full geographic legacy round trip',
                         'Photo dimensions and nested EXIF DateTimeOriginal, excluding modification dates'],
              'limits': ['Arithmetic agreement does not establish source absolute positional accuracy.',
                         'Image edge review does not prove wall bases, roof heights or roof pitches.',
                         'Photo capture times are camera-clock values; timezone and clock accuracy are unverified.',
                         'Native overlays were separately visually inspected for plausible roof/surface alignment.'],
              'checkedInputs': checked_inputs}
    (HERE/'reference-audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('passed','counts','maximumDifferences','failures')}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
