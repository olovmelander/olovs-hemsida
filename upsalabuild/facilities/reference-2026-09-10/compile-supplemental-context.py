"""Export existing mapped facilities as optional flat Blender references only."""
import hashlib
import json
from collections import Counter
from pathlib import Path

import pyproj
from shapely.geometry import Point, Polygon, MultiPolygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[3]
REF = Path(__file__).resolve().parent


def read(relative):
    return json.loads((ROOT / relative).read_text(encoding='utf-8'))


def source(relative):
    return {'path': relative, 'sha256': hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()}


model_path = 'upsalabuild/course-model.json'
model = read(model_path)
mellan = read('upsalamellanbuild/course-model.json')
manifest_path = 'upsalabuild/facilities/reference-2026-09-10/orthophoto-manifest.json'
manifest = read(manifest_path)
anchor = manifest['anchorLocalXZ']
frame = {key: model[key] for key in ('origin', 'mPerLat', 'mPerLon')}
assert frame == manifest['frame']
assert model['infra']['mappedPoints'] == mellan['infra']['mappedPoints']
native = unary_union([box(*image['boundsEpsg3006']) for image in manifest['images'] if 'overview' not in image['id']])
overview = unary_union([box(*image['boundsEpsg3006']) for image in manifest['images'] if 'overview' in image['id']])
forward = pyproj.Transformer.from_crs(4326, 3006, always_xy=True)
inverse = pyproj.Transformer.from_crs(3006, 4326, always_xy=True)
max_roundtrip = 0.0


def coordinates(local):
    global max_roundtrip
    x, z = local
    lon = frame['origin']['lon'] + x/frame['mPerLon']
    lat = frame['origin']['lat'] - z/frame['mPerLat']
    e, n = forward.transform(lon, lat)
    lon2, lat2 = inverse.transform(e, n)
    x2 = (lon2-frame['origin']['lon'])*frame['mPerLon']
    z2 = (frame['origin']['lat']-lat2)*frame['mPerLat']
    max_roundtrip = max(max_roundtrip, ((x2-x)**2 + (z2-z)**2)**.5)
    return [e, n], [lon, lat], [x-anchor[0], anchor[1]-z, 0]


def coverage(geometry):
    return {
        'nativeImageIntersects': geometry.intersects(native),
        'nativeImageFullyCovers': native.covers(geometry),
        'overviewImageIntersects': geometry.intersects(overview),
        'overviewImageFullyCovers': overview.covers(geometry),
        'meaning': 'Image availability only; does not establish visual confirmation of this feature.',
    }


equipment_path = 'upsalabuild/mapping/equipment-2025.json'
equipment = read(equipment_path)
equipment_ids = {feature['id'] for feature in equipment['features']}
osm_path = 'upsalabuild/osm-features.json'
osm = read(osm_path)
osm_points = {point['id']: point for point in osm['points']}
features = []
selected_kinds = {'range_mat', 'practice_bunker', 'paved_path'}
for index, feature in enumerate(model['scenery']['mappedFeatures']):
    if feature['kind'] not in selected_kinds:
        continue
    assert any(other == feature for other in mellan['scenery']['mappedFeatures'])
    if feature['kind'] in {'range_mat', 'practice_bunker'}:
        assert feature['id'] in equipment_ids
        evidence_path = equipment_path
    else:
        evidence_path = feature['sourceEvidence']
    rings = feature.get('rings') or [feature['ring']]
    converted = [[coordinates(point) for point in ring] for ring in rings]
    projected = [[point[0] for point in ring] for ring in converted]
    geometry = MultiPolygon([Polygon(ring) for ring in projected])
    assert geometry.is_valid and not geometry.is_empty
    features.append({
        'id': feature['id'], 'category': feature['kind'], 'geometryType': 'surface-outline',
        'source': model_path, 'sourceSha256': source(model_path)['sha256'],
        'sourcePointer': f'/scenery/mappedFeatures/{index}',
        'sourceEvidence': source(evidence_path),
        'currentModelFeature': feature,
        'localRings': rings, 'localRing': rings[0], 'localHoles': [],
        'epsg3006Rings': projected, 'epsg3006Ring': projected[0],
        'wgs84Rings': [[point[1] for point in ring] for ring in converted],
        'blenderRings': [[point[2] for point in ring] for ring in converted],
        'blenderRing': [point[2] for point in converted[0]],
        'coverage': coverage(geometry), 'heightMetres': None,
        'geometryInterpretation': 'Existing accepted horizontal surface outline; flat reference only, with original source uncertainty retained. No new review or extrusion height.',
    })

for index, feature in enumerate(model['infra']['mappedPoints']):
    assert feature['id'] in osm_points
    assert feature == osm_points[feature['id']]
    local = feature['c']
    projected, wgs, blender = coordinates(local)
    natural = feature['tags'].get('natural')
    features.append({
        'id': feature['id'], 'category': 'mapped-tree-point' if natural == 'tree' else 'mapped-fixture-point',
        'geometryType': 'point', 'source': model_path, 'sourceSha256': source(model_path)['sha256'],
        'sourcePointer': f'/infra/mappedPoints/{index}', 'sourceEvidence': source(osm_path),
        'sourceUrl': f"https://www.openstreetmap.org/node/{feature['id'][1:]}",
        'currentModelFeature': feature, 'localXZ': local, 'epsg3006Point': projected,
        'wgs84Point': wgs, 'blenderPoint': blender, 'coverage': coverage(Point(projected)),
        'heightMetres': None, 'radiusMetres': None,
        'geometryInterpretation': 'Existing OSM point and tags only. Position accuracy, dimensions, current presence and observation date are unverified; no point becomes a solid or a newly observed object.',
    })

counts = Counter(feature['category'] for feature in features)
assert counts == {'range_mat': 30, 'practice_bunker': 2, 'paved_path': 1, 'mapped-tree-point': 228, 'mapped-fixture-point': 7}
assert len({feature['id'] for feature in features}) == len(features)
assert max_roundtrip < 0.000001
output = {
    'schemaVersion': 1, 'id': 'upsala-supplemental-facility-context-2026-09-10',
    'purpose': 'Optional reference collections compiled from existing source-model records. No production edits or automatic extrusions.',
    'frame': frame, 'anchorLocalXZ': anchor,
    'blenderAxisConvention': 'x=localX-anchorX, y=anchorZ-localZ, z=0; one unit=one metre; flat reference only',
    'elevationDatum': None,
    'heightMeaning': 'No feature height or floor level is assigned. Blender Z=0 is an authoring reference plane, not RH2000 zero or measured ground.',
    'horizontalProjection': 'Local XZ -> persisted frame WGS84 lon/lat -> pyproj EPSG:3006, always_xy=True; no fitted offset.',
    'sources': [source(relative) for relative in [model_path, 'upsalamellanbuild/course-model.json',
        equipment_path, 'upsalabuild/mapping/practice-path-review-2026-09-07.json', osm_path, manifest_path]],
    'imageBounds': [{'id': image['id'], 'boundsEpsg3006': image['boundsEpsg3006']} for image in manifest['images']],
    'counts': dict(counts), 'features': features,
    'validation': {'state': 'passed', 'featureCount': len(features), 'uniqueIds': True,
        'sharedMellanRecordsIdentical': True, 'osmPointRecordsIdentical': True,
        'maximumLocalRoundtripMetres': max_roundtrip, 'pyprojVersion': pyproj.__version__,
        'nativeImageFullyCoveredCounts': dict(Counter(f['category'] for f in features if f['coverage']['nativeImageFullyCovers'])),
        'overviewImageFullyCoveredCounts': dict(Counter(f['category'] for f in features if f['coverage']['overviewImageFullyCovers']))},
    'limitations': [
        'All 235 mapped points are retained for completeness, including points outside facilities imagery; use explicit coverage flags to select local reference collections.',
        'Seven non-natural fixtures are one flagpole, three fountains, two gates and one mast; the other 228 records are trees.',
        'Availability of 2025 imagery does not establish that an older OSM point has been visually verified in that image.',
        'Polygon rings are existing adopted surface outlines, not newly surveyed dimensions; preserve their recorded uncertainties and dates.',
        'No production mesh, terrain, inferred hardware, tree crown or feature height is generated by this export.',
    ],
}
path = REF / 'supplemental-context.json'
path.write_text(json.dumps(output, indent=2, ensure_ascii=True, allow_nan=False) + '\n', encoding='utf-8')
print(json.dumps({'path': path.relative_to(ROOT).as_posix(), 'counts': dict(counts), 'validation': output['validation']}, indent=2))
