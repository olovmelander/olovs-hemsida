#!/usr/bin/env python3
"""Clip retained OSM infrastructure to the exact Visby terrain footprint."""
import json
from hashlib import sha256
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[4]
DIRECTORY = ROOT / 'geo_data/course-v2/visby/mapping'
BOUNDS = [685700.5, 6368903.5, 689796.5, 6372999.5]


def atomic(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type in ['Point', 'LineString', 'Polygon']:
        return [geometry]
    return [part for child in geometry.geoms for part in atomic(child)]


def main():
    source_path = ROOT / 'geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson'
    raw = source_path.read_bytes()
    collection = json.loads(raw)
    clip = box(*BOUNDS)
    features, checks = [], []
    for feature in collection['features']:
        tags = feature['properties'].get('tags', {})
        if not (tags.get('building') not in [None, 'no'] or tags.get('highway') or tags.get('golf') == 'path' or tags.get('natural') in ['coastline', 'water']):
            continue
        original = shape(feature['geometry'])
        clipped = original.intersection(clip)
        if clipped.is_empty:
            continue
        pieces = [p for p in atomic(clipped) if p.geom_type == original.geom_type or original.geom_type.startswith('Multi')]
        if not pieces:
            continue
        restored = unary_union(pieces)
        delta = restored.symmetric_difference(clipped)
        assert delta.area < 1e-8 and delta.length < 1e-5
        for index, piece in enumerate(pieces, 1):
            properties = dict(feature['properties'], sourceFeatureId=feature['id'],
                              parentContextId=feature['id'], sourceGeometrySha256=sha256(raw).hexdigest(),
                              clippedToTerrain=True, clipBoundaryIsPhysical=False,
                              geometryOperation='intersection with terrain sample-centre footprint; no simplification or snapping')
            features.append(dict(type='Feature', id=feature['id'] if len(pieces) == 1 else f'{feature["id"]}-clip-{index}',
                                 properties=properties, geometry=mapping(piece)))
        checks.append(dict(sourceFeatureId=feature['id'], sourceType=original.geom_type,
                           fragments=len(pieces), sourceMeasure=original.area if original.geom_type == 'Polygon' else original.length,
                           clippedMeasure=clipped.area if original.geom_type == 'Polygon' else clipped.length,
                           changed=not original.equals(clipped)))
    output = dict(type='FeatureCollection', name='Visby clipped OSM infrastructure observations',
                  crs=dict(type='name', properties=dict(name='EPSG:3006')),
                  coordinateOrder=['easting', 'northing'], licence='ODbL-1.0',
                  attribution='© OpenStreetMap contributors', bboxEpsg3006=BOUNDS,
                  sourcePath=source_path.relative_to(ROOT).as_posix(), sourceSha256=sha256(raw).hexdigest(), features=features)
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    target = DIRECTORY / 'osm-context-epsg3006.geojson'
    target.write_text(json.dumps(output, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    report = dict(schemaVersion=1, groundId='visby', sourcePath=output['sourcePath'], sourceSha256=output['sourceSha256'],
                  outputPath=target.relative_to(ROOT).as_posix(), outputSha256=sha256(target.read_bytes()).hexdigest(),
                  sourceFeatures=len(checks), outputFeatures=len(features), changedByClipping=sum(c['changed'] for c in checks),
                  checks=checks, limitations=['Infrastructure remains supplementary OSM observation geometry.',
                                             'Clipping creates artificial endpoints and polygon boundaries, not physical boundaries.',
                                             'Point traffic observations do not establish road footprints or widths.'])
    (DIRECTORY / 'osm-context-clip-evidence.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ['outputPath','sourceFeatures','outputFeatures','changedByClipping']}))


if __name__ == '__main__':
    main()
