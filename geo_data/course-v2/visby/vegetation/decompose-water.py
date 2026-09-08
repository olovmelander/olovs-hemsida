#!/usr/bin/env python3
"""Create hole-free compatibility pieces; prove their union preserves source water."""
import json
from hashlib import sha256
from pathlib import Path

from shapely.geometry import LineString, Polygon, mapping, shape
from shapely.ops import split, triangulate, unary_union

ROOT = Path(__file__).resolve().parents[4]
DIRECTORY = ROOT / 'geo_data/course-v2/visby/mapping'


def polygons(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    return [p for g in geometry.geoms for p in polygons(g)]


def decompose(original):
    pending, result, cuts = polygons(original), [], []
    while pending:
        polygon = pending.pop()
        if not polygon.interiors:
            result.append(polygon)
            continue
        bounds = polygon.bounds
        y = Polygon(polygon.interiors[0]).representative_point().y
        pieces = polygons(split(polygon, LineString([[bounds[0] - 1, y], [bounds[2] + 1, y]])))
        if len(pieces) < 2 or max(len(p.interiors) for p in pieces) >= len(polygon.interiors):
            # Rare degenerate cuts use a bounded Delaunay partition over the same vertices.
            pieces = [p for triangle in triangulate(polygon) for p in polygons(triangle.intersection(polygon)) if p.area > 1e-10]
            if any(p.interiors for p in pieces):
                raise RuntimeError('Could not remove an interior without changing source geometry')
            cuts.append(dict(method='clipped-Delaunay-fallback', pieces=len(pieces)))
        else:
            cuts.append(dict(method='horizontal-split-through-interior', northing=y, pieces=len(pieces)))
        pending.extend(pieces)
        if len(pending) + len(result) > 10000:
            raise RuntimeError('Excessive compatibility decomposition')
    result.sort(key=lambda p: (p.bounds[1], p.bounds[0], p.area))
    return result, cuts


def main():
    source_path = DIRECTORY / 'water-breakgeometry-epsg3006.geojson'
    source_bytes = source_path.read_bytes()
    source = json.loads(source_bytes)
    features, checks = [], []
    for feature in source['features']:
        original = shape(feature['geometry'])
        pieces, cuts = decompose(original)
        combined = unary_union(pieces)
        difference = combined.symmetric_difference(original).area
        overlap = sum(p.area for p in pieces) - combined.area
        tolerance = max(1e-6, original.area * 1e-10)
        assert difference <= tolerance and abs(overlap) <= tolerance, feature['id']
        assert all(p.is_valid and not p.interiors for p in pieces), feature['id']
        for number, piece in enumerate(pieces, 1):
            vertices = list(piece.exterior.coords)
            artificial_edges = []
            for a, b in zip(vertices, vertices[1:]):
                segment = LineString([a, b])
                if original.boundary.distance(segment.interpolate(.5, normalized=True)) > 1e-7:
                    artificial_edges.append([[a[0], a[1]], [b[0], b[1]]])
            properties = dict(feature['properties'], parentWaterId=feature['id'],
                              compatibilityPiece=number, compatibilityPieceCount=len(pieces),
                              artificialCutEdgesAreShore=False,
                              artificialCutEdgesEpsg3006=artificial_edges,
                              geometryUse='hole-free-compatibility-partition-of-canonical-water')
            features.append(dict(type='Feature', id=f'{feature["id"]}-part-{number}',
                                 properties=properties, geometry=mapping(piece)))
        checks.append(dict(parentWaterId=feature['id'], sourceAreaSquareMetres=original.area,
                           pieces=len(pieces), symmetricDifferenceSquareMetres=difference,
                           overlapSquareMetres=overlap, acceptedToleranceSquareMetres=tolerance, cuts=cuts))
    output = dict(source)
    output['name'] = 'Visby water compatibility pieces; canonical polygon union preserved'
    output['features'] = features
    output['canonicalSource'] = source_path.relative_to(ROOT).as_posix()
    output['canonicalSourceSha256'] = sha256(source_bytes).hexdigest()
    target = DIRECTORY / 'water-breakgeometry-simple-epsg3006.geojson'
    target.write_text(json.dumps(output, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    report = dict(schemaVersion=1, groundId='visby', sourcePath=output['canonicalSource'],
                  sourceSha256=output['canonicalSourceSha256'], outputPath=target.relative_to(ROOT).as_posix(),
                  outputSha256=sha256(target.read_bytes()).hexdigest(),
                  sourceFeatures=len(source['features']), compatibilityPieces=len(features),
                  outputInteriorRings=0, maximumSymmetricDifferenceSquareMetres=max(c['symmetricDifferenceSquareMetres'] for c in checks),
                  checks=checks, limitations=['Compatibility pieces partition the same water union; cut lines are artificial and must not become shore banks.',
                                             'Canonical geometry with islands remains the mapping authority.',
                                             'Some sea vertices have spatially varying source Z; the compatibility application still needs an explicit render-time water-level treatment.'])
    (DIRECTORY / 'water-compatibility-validation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ['outputPath','sourceFeatures','compatibilityPieces','outputInteriorRings','maximumSymmetricDifferenceSquareMetres']}))


if __name__ == '__main__':
    main()
