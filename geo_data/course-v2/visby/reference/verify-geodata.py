#!/usr/bin/env python3
"""Replay Visby retained evidence checks; no adoption or source mutation."""
import json
from hashlib import sha256
from pathlib import Path

from PIL import Image
from pyproj import Transformer
from shapely.geometry import shape
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[4]
REFERENCE = Path(__file__).resolve().parent


def load(name):
    return json.loads((REFERENCE / name).read_text(encoding='utf-8'))


def check_asset(record):
    raw = (ROOT / record['path']).read_bytes()
    assert len(raw) == record['bytes'], record['path']
    assert sha256(raw).hexdigest() == record['sha256'], record['path']
    return len(raw)


def pairs(coordinates):
    if isinstance(coordinates[0], (float, int)):
        yield coordinates
    else:
        for part in coordinates:
            yield from pairs(part)


def main():
    osm = load('osm-acquisition.json')
    imagery = load('gotland-ortho-2022.json')
    assets = [osm, imagery['image'], imagery['export'], imagery['footprintQuery']]
    assets.extend(load('lm-retained-assets.json')['assets'])
    catalog = load('gotland-imagery-services.json')
    assets.extend([catalog['catalog'], *catalog['services']])
    verified_bytes = sum(map(check_asset, assets))
    wgs = load('osm-golf-wgs84.geojson')
    projected = load('osm-golf-epsg3006.geojson')
    assert len(wgs['features']) == len(projected['features'])
    transform = Transformer.from_crs(4326, 3006, always_xy=True)
    max_residual, coordinate_pairs = 0, 0
    invalid = []
    observations = []
    for a, b in zip(wgs['features'], projected['features']):
        assert a['id'] == b['id']
        for p, q in zip(pairs(a['geometry']['coordinates']), pairs(b['geometry']['coordinates'])):
            e, n = transform.transform(*p)
            max_residual = max(max_residual, ((e-q[0])**2+(n-q[1])**2)**.5)
            coordinate_pairs += 1
        geometry = shape(b['geometry'])
        if not geometry.is_valid:
            invalid.append(dict(id=b['id'], reason=explain_validity(geometry)))
        if b['properties']['tags'].get('golf') == 'hole':
            observations.append(dict(id=b['id'], tags=b['properties']['tags'],
                                     geometryType=geometry.geom_type, vertices=len(geometry.coords),
                                     isClosed=geometry.is_closed, lengthMetres=geometry.length,
                                     courseAssociation=None, approval='pending-source-review'))
    assert max_residual < 1e-6
    property_feature = next(f for f in projected['features'] if f['id'] == 'way/199830330')
    property_geometry = shape(property_feature['geometry'])
    source_path = ROOT / 'visbybuild/cache/geodata-2026-09-07/m637_68_ursprung.json'
    terrain_origins = json.loads(source_path.read_text(encoding='utf-8'))
    overlap = []
    for source in terrain_origins['features']:
        intersection = property_geometry.intersection(shape(source['geometry']))
        if intersection.area > 0:
            overlap.append(dict(sourceFeatureId=source['id'], properties=source['properties'],
                                intersectionSquareMetres=intersection.area,
                                fractionOfOsmProperty=intersection.area/property_geometry.area))
    with Image.open(ROOT / imagery['image']['path']) as image:
        assert image.size == (imagery['width'], imagery['height'])
    report = dict(schemaVersion=1, groundId='visby', observedOn='2026-09-07',
                  verifiedSourceAssets=len(assets), verifiedSourceBytes=verified_bytes,
                  osmFeatureCount=len(projected['features']), comparedCoordinatePairs=coordinate_pairs,
                  maximumProjectionResidualMetres=max_residual, invalidGeometries=invalid,
                  property=dict(osmId=property_feature['id'], bboxEpsg3006=list(property_geometry.bounds),
                                squareMetres=property_geometry.area),
                  holeObservations=observations, terrainOriginsIntersectingOsmProperty=overlap,
                  orthophoto=dict(dimensions=[imagery['width'], imagery['height']],
                                 actualSourceDatasetCount=len(imagery['sourceDatasets']),
                                 overviewRecords=imagery['overviewRecordCount']),
                  limitations=['Projection replay and geometry validity do not prove geographic accuracy.',
                               'OSM property is a supplementary mapped golf boundary, not a cadastral boundary.',
                               'Terrain date intersections use retained source-origin polygons and the OSM boundary.',
                               'No current hole-route association or surface authority was approved.'])
    (REFERENCE / 'geodata-validation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
