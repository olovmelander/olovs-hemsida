"""Reference-only LAS-window inventory; never modifies a model or terrain."""
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import pyproj
from shapely import Polygon, box, contains_xy

ROOT = Path(__file__).resolve().parents[3]
REF = Path(__file__).resolve().parent
CACHE = ROOT / 'upsalabuild/cache/facilities-reference-2026-09-10/lidar'


def rel(path):
    return path.relative_to(ROOT).as_posix()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stats(values):
    if len(values) == 0:
        return {'count': 0}
    q = np.quantile(values, [0, .05, .5, .95, 1])
    return dict(count=len(values), **dict(zip(['min', 'p05', 'p50', 'p95', 'max'], [round(float(v), 3) for v in q])))


acquisition_path = CACHE / 'window-acquisition.json'
report = json.loads(acquisition_path.read_text(encoding='utf-8'))
assert pyproj.CRS.from_wkt(report['crs']['lasWkt']).to_epsg() == 5845
source_csv = ROOT / report['points']['path']
assert digest(source_csv) == report['points']['sha256']
with gzip.open(source_csv, 'rt', encoding='utf-8') as stream:
    points = np.genfromtxt(stream, delimiter=',', names=True)
assert len(points) == report['statistics']['pointsInWindow']
east, north, height = (points[name] for name in ('easting', 'northing', 'height_rh2000'))
classification = points['classification'].astype(np.uint8)
to_wgs = pyproj.Transformer.from_crs(3006, 4326, always_xy=True)
to_grid = pyproj.Transformer.from_crs(4326, 3006, always_xy=True)
model_path = ROOT / 'upsalabuild/course-model.json'
model = json.loads(model_path.read_text(encoding='utf-8'))
lon, lat = to_wgs.transform(east, north)
local_x = (lon - model['origin']['lon']) * model['mPerLon']
local_z = (model['origin']['lat'] - lat) * model['mPerLat']
back_e, back_n = to_grid.transform(lon, lat)

# A reference PLY with the explicit full-course Blender frame, not a production GLB.
ply_path = CACHE / 'clubhouse-central-2021-course-frame.ply'
ply = np.zeros(len(points), dtype=[('x', '<f8'), ('y', '<f8'), ('z', '<f8'), ('classification', 'u1')])
ply['x'], ply['y'], ply['z'], ply['classification'] = local_x, -local_z, height, classification
ply_header = ('ply\nformat binary_little_endian 1.0\ncomment reference only: metres x=east-course y=north-course z=RH2000\n'
              f'element vertex {len(points)}\nproperty double x\nproperty double y\nproperty double z\nproperty uchar classification\nend_header\n')
ply_path.write_bytes(ply_header.encode('ascii') + ply.tobytes())

# Same 2023 1 m DTM used by the shipped Upsala heightfields; diagnostic only.
dtm_path = ROOT / 'upsalabuild/cache/terrain-block.f32'
dtm = np.memmap(dtm_path, dtype='<f4', mode='r', shape=(4785, 3641))
column = east - 638255.5
row = 6637977.5 - north
ix, iy = np.floor(column).astype(int), np.floor(row).astype(int)
assert np.all((ix >= 0) & (ix + 1 < dtm.shape[1]) & (iy >= 0) & (iy + 1 < dtm.shape[0]))
fx, fy = column - ix, row - iy
ground = ((1-fx)*(1-fy)*dtm[iy, ix] + fx*(1-fy)*dtm[iy, ix+1] +
          (1-fx)*fy*dtm[iy+1, ix] + fx*fy*dtm[iy+1, ix+1])
above_dtm = height - ground
window_polygon = box(*report['window']['bboxEpsg3006'])


def footprint_summary(feature_id, name, geometry, basis, extra=None):
    polygon = Polygon(geometry)
    if not polygon.is_valid or polygon.is_empty:
        return {'id': feature_id, 'basis': basis, 'excluded': 'invalid polygon'}
    if not polygon.intersects(window_polygon):
        return None
    core = polygon.buffer(-1.0)
    keep = contains_xy(core, east, north)
    by_class = {}
    for value in sorted(set(classification[keep].tolist())):
        subset = keep & (classification == value)
        by_class[str(value)] = {
            'heightRH2000Metres': stats(height[subset]),
            'heightAbove2023DtmMetres': stats(above_dtm[subset]),
            'firstReturns': int(np.count_nonzero(subset & (points['return_number'] == 1))),
        }
    return {
        'id': feature_id, 'name': name, 'basis': basis, **(extra or {}),
        'footprintAreaSquareMetres': round(polygon.area, 3),
        'interiorMarginMetres': 1, 'interiorAreaSquareMetres': round(core.area, 3),
        'fullyCoveredByWindow': window_polygon.covers(polygon),
        'footprintEpsg3006Sha256': hashlib.sha256(json.dumps(geometry, separators=(',', ':')).encode()).hexdigest(),
        'allInteriorReturns': int(np.count_nonzero(keep)), 'byLasClass': by_class,
        'roofSurfaceVerified': False, 'floorHeightVerified': False,
    }


production = []
for building in model['infra']['buildings']:
    ring = building['ring']
    e, n = to_grid.transform([model['origin']['lon'] + p[0]/model['mPerLon'] for p in ring],
                             [model['origin']['lat'] - p[1]/model['mPerLat'] for p in ring])
    item = footprint_summary(building['id'], building.get('name'), list(map(list, zip(e, n))),
                             'current-production-model-outline', {'currentHeightMetres': building.get('h')})
    if item:
        production.append(item)

inventory_path = REF / 'building-reference-inventory.json'
inventory = json.loads(inventory_path.read_text(encoding='utf-8'))
new_reference = []
for building in inventory['buildings']:
    ring = building['sourceRingsEPSG3006']
    item = footprint_summary(building['id'], building['name'], ring, '2026-municipal-reference-outline', {
        'municipalObjectId': building['municipalObjectId'],
        'outlineMeasurementConfirmed': building['confirmedExistingMeasuredOutline'],
        'groundFootprintVerified': building['groundFootprintVerified'],
        'roofOutlineVerified': building['roofOutlineVerified'],
    })
    if item:
        new_reference.append(item)

report.update({
    'referenceReportVersion': 1,
    'generatedBy': rel(Path(__file__)),
    'automaticHeightAdoption': False,
    'lasClassMeaning': {'1': 'Unclassified: may include roofs, trees, objects and other surfaces.',
                        '2': 'Ground.', '7': 'Low point / noise.',
                        '6': 'Building classification; no class 6 returns occur in this window.'},
    'interpretation': 'Interior membership narrows the search area; it does not classify a return as roof. Height summaries retain every class separately and fit no planes.',
    'coordinateValidation': {'lasCompoundCrsPyprojEpsg': 5845, 'pyprojVersion': pyproj.__version__,
                             'xyRoundtripMaxMetres': float(np.max(np.hypot(back_e-east, back_n-north))),
                             'frame': {key: model[key] for key in ['origin', 'mPerLat', 'mPerLon']},
                             'blenderMapping': 'x=xCourse, y=-zCourse, z=heightRH2000; metres; no origin or height subtraction in reference PLY'},
    'blenderPointReference': {'path': rel(ply_path), 'sha256': digest(ply_path), 'bytes': ply_path.stat().st_size,
                             'points': len(points), 'faces': 0, 'scope': 'ignored local cache; not a renderable building asset'},
    'dtmComparison': {'path': rel(dtm_path), 'sha256': digest(dtm_path), 'sourceEpoch': '2023-04',
                      'product': 'Lantmateriet 1 m Markhojdmodell', 'verticalDatum': 'RH 2000',
                      'sampling': 'bilinear, native EPSG:3006 grid',
                      'limitation': '2021 laser minus 2023 ground DTM is a mixed-epoch diagnostic, not measured building height.'},
    'footprintSources': [{'path': rel(model_path), 'sha256': digest(model_path)},
                         {'path': rel(inventory_path), 'sha256': digest(inventory_path)}],
    'productionFootprints': production,
    'newMunicipalReferenceFootprints': new_reference,
})
report['limitations'].extend([
    'Source municipal Z values are unverified and include sentinel values; they are not used in this analysis.',
    'The extracted CSV retains X/Y/Z, classification, return number, number of returns and intensity only. LAS flags, GPS time and other dimensions are not exported; this is not a lossless replacement for the original LAS file.',
    'No GPS time dimension was exported; catalogue capture range is retained without assigning an exact observation day to individual returns.',
    'The 250 m window does not cover all facilities; partially covered footprints are marked explicitly.',
    'New municipal reference outlines have not replaced production building geometry.',
])
output = REF / 'lidar-roof-evidence.json'
output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
club = next(item for item in production if item['id'] == 'w221193965')
print(json.dumps({'report': rel(output), 'productionFootprints': len(production), 'newReferenceFootprints': len(new_reference),
                  'clubhouse': club, 'blenderReference': report['blenderPointReference']}, indent=2))
