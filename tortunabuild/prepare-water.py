"""Prepare source water for the runtime without changing its measured union."""
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    import shapely
    from shapely.geometry import LineString, box, mapping, shape
    from shapely.ops import unary_union
    spec = importlib.util.spec_from_file_location('water_partition', ROOT / 'geo_data/course-v2/visby/vegetation/decompose-water.py')
    partition = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(partition)
    path = ROOT / 'geo_data/course-v2/tortuna/acquisition/water-epsg3006.geojson'
    data = path.read_bytes()
    expected = '71160f84bc842d6e92a7d76f5513f37f70c9bb7f1e902fa7ae1cf8200571501d'
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Acquired Tortuna water source changed')
    source = json.loads(data)
    terrain = box(595352.5, 6612851.5, 599448.5, 6616947.5)
    features, checks = [], []
    for feature in source['features']:
        original = shape(feature['geometry'])
        level = feature['properties']['heightRH2000']
        if not original.is_valid or original.is_empty or not original.has_z or level is None:
            raise ValueError('Source must be valid PolygonZ water with an explicit flat level')
        if original.difference(terrain).area > 1e-8:
            raise ValueError('Acquired water escapes the terrain sample extent')
        coordinates = [p for polygon in partition.polygons(original) for ring in [polygon.exterior, *polygon.interiors] for p in ring.coords]
        if any(abs(p[2] - level) > 1e-8 for p in coordinates):
            raise ValueError('Source polygon Z differs from the recorded surface level')
        pieces, cuts = partition.decompose(original)
        combined = unary_union(pieces)
        difference = combined.symmetric_difference(original).area
        overlap = sum(piece.area for piece in pieces) - combined.area
        tolerance = max(1e-6, original.area * 1e-10)
        if difference > tolerance or abs(overlap) > tolerance or any(not p.is_valid or p.interiors for p in pieces):
            raise ValueError('Runtime partition changes source water or loses an island')
        for number, piece in enumerate(pieces, 1):
            vertices = list(piece.exterior.coords)
            artificial = []
            for a, b in zip(vertices, vertices[1:]):
                segment = LineString([a[:2], b[:2]])
                if original.boundary.distance(segment.interpolate(.5, normalized=True)) > 1e-7:
                    artificial.append([list(a[:2]), list(b[:2])])
            features.append(dict(type='Feature', id=f"{feature['id']}-part-{number}",
                properties=dict(feature['properties'], parentWaterId=feature['id'], sourceItemId='661_59',
                    compatibilityPiece=number, compatibilityPieceCount=len(pieces),
                    artificialCutEdgesAreShore=False, artificialCutEdgesEpsg3006=artificial,
                    bathymetry=None, reviewStatus='source-topology-and-level-verified',
                    geometryUse='unchanged-source-water-union-runtime-partition'), geometry=mapping(piece)))
        checks.append(dict(parentWaterId=feature['id'], sourceAreaSquareMetres=original.area,
            sourceInteriorRings=sum(len(p.interiors) for p in partition.polygons(original)),
            pieces=len(pieces), heightRH2000=level, symmetricDifferenceSquareMetres=difference,
            overlapSquareMetres=overlap, toleranceSquareMetres=tolerance, cuts=cuts))
    out = ROOT / 'geo_data/course-v2/tortuna/mapping'
    out.mkdir(parents=True, exist_ok=True)
    target = out / 'water-runtime-epsg3006.geojson'
    output = dict(type='FeatureCollection', name='Tortuna source water, exact runtime partition',
        crs=dict(type='name', properties=dict(name='EPSG:3006')), verticalCrs='EPSG:5613',
        coordinateOrder=['easting', 'northing', 'heightRH2000'], canonicalSource=path.relative_to(ROOT).as_posix(),
        canonicalSourceSha256=expected, features=features)
    target.write_text(json.dumps(output, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    report = dict(schemaVersion=1, groundId='tortuna', sourcePath=path.relative_to(ROOT).as_posix(), sourceSha256=expected,
        outputPath=target.relative_to(ROOT).as_posix(), outputSha256=hashlib.sha256(target.read_bytes()).hexdigest(),
        sourceFeatures=len(source['features']), compatibilityPieces=len(features), outputInteriorRings=0,
        maximumSymmetricDifferenceSquareMetres=max(c['symmetricDifferenceSquareMetres'] for c in checks),
        toolchain=dict(shapely=shapely.__version__, geos=shapely.geos_version_string), checks=checks,
        limitations=['The DTM water levels are water surfaces, not bathymetry.',
            'National break geometry may omit smaller ponds and drainage channels.',
            'Acquisition extent and artificial partition edges are not shore banks.',
            'No current field water-level survey or independent source alignment controls are available.'])
    (out / 'water-runtime-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['sourceFeatures', 'compatibilityPieces', 'outputInteriorRings', 'maximumSymmetricDifferenceSquareMetres', 'outputSha256']}))


if __name__ == '__main__':
    main()
