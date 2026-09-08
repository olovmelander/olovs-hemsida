"""Clip the pinned Lantmateriet PolygonZ source without dropping holes/heights."""
from pathlib import Path
import hashlib
import json
import sqlite3
import struct
import shapely
from shapely import from_wkb
from shapely.geometry import box, mapping

ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT / 'lidingobuild/cache/water-breakgeometry/658_67.gpkg'
EXPECTED = '892d247c76cb2be712e4966045957f7f34c63fae4b368f038d69130aea619600'
OUTPUT = ROOT / 'geo_data/course-v2/lidingo/mapping'
BOUNDS = [676676.5, 6585375.5, 678724.5, 6587423.5]


def decode_gpkg(blob):
    if blob[:2] != b'GP' or blob[2] != 0:
        raise ValueError('Unsupported GeoPackage geometry header')
    envelope = (blob[3] >> 1) & 7
    if envelope not in [0, 1, 2, 3, 4]:
        raise ValueError('Invalid GeoPackage envelope')
    endian = '<' if blob[3] & 1 else '>'
    if struct.unpack(endian + 'i', blob[4:8])[0] != 3006:
        raise ValueError('Expected EPSG:3006 geometry')
    offset = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]
    return from_wkb(blob[offset:])


def polygon_parts(geom):
    if geom.geom_type == 'Polygon':
        return [geom]
    if geom.geom_type == 'MultiPolygon':
        return list(geom.geoms)
    raise ValueError(f'Unexpected non-polygon intersection: {geom.geom_type}')


def heights(geom):
    return [p[2] for poly in polygon_parts(geom)
            for ring in [poly.exterior, *poly.interiors] for p in ring.coords]


def main():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == EXPECTED, 'Source checksum drift'
    connection = sqlite3.connect(f'file:{SOURCE}?mode=ro', uri=True)
    contract = connection.execute('select table_name,column_name,geometry_type_name,srs_id,z,m from gpkg_geometry_columns').fetchall()
    assert contract == [('polygons', 'geom', 'POLYGON', 3006, 1, 0)], contract
    clip = box(*BOUNDS)
    features, diagnostics, excluded = [], [], []
    source_count = 0
    for fid, blob, classification in connection.execute('select fid,geom,classification from polygons order by fid'):
        source_count += 1
        original = decode_gpkg(blob)
        if not original.is_valid:
            raise ValueError(f'Invalid source geometry fid {fid}; no automatic repair permitted')
        if not original.intersects(clip):
            excluded.append(fid)
            continue
        clipped = original.intersection(clip)
        if clipped.is_empty or clipped.area == 0:
            excluded.append(fid)
            continue
        assert clipped.is_valid and clipped.has_z
        source_heights, clipped_heights = heights(original), heights(clipped)
        assert max(source_heights) - min(source_heights) < 1e-9, f'fid {fid}: not a flat water level'
        assert max(clipped_heights) - min(clipped_heights) < 1e-9
        assert abs(clipped_heights[0] - source_heights[0]) < 1e-9
        assert clipped.difference(clip).area < 1e-8
        retained_holes = sum(len(p.interiors) for p in polygon_parts(clipped))
        stable_id = f'lm-658-67-water-{fid}'
        features.append({'type': 'Feature', 'id': stable_id, 'properties': {
            'sourceId': 'water-breaks-lm-1m', 'sourceItemId': '658_67', 'sourceFid': fid,
            'sourceClassification': classification, 'heightRH2000': source_heights[0],
            'kind': 'flattened-water-surface', 'geometryUse': 'source-derived-candidate',
            'reviewStatus': 'source-topology-checked-not-field-reviewed',
            'clipBoundaryIsShore': False, 'bathymetry': None,
        }, 'geometry': mapping(clipped)})
        diagnostics.append({'id': stable_id, 'sourceAreaSquareMetres': original.area,
            'clippedAreaSquareMetres': clipped.area, 'clipped': not clipped.equals(original),
            'sourceHoleCount': len(original.interiors), 'outputHoleCount': retained_holes,
            'outputPolygonCount': len(polygon_parts(clipped)), 'heightRH2000': source_heights[0],
            'sourceZSpreadMetres': max(source_heights)-min(source_heights)})
    connection.close()
    result = {'type': 'FeatureCollection', 'name': 'Lidingo ground clipped water break geometry',
        'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}},
        'coordinateOrder': ['easting', 'northing', 'heightRH2000'], 'verticalCrs': 'EPSG:5613',
        'licence': 'CC-BY-4.0', 'attribution': 'Markhojdmodell Nedladdning, © Lantmateriet, processed data, CC BY 4.0.',
        'features': features}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT / 'water-breakgeometry-epsg3006.geojson'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    report = {'schemaVersion': 1, 'groundId': 'lidingo', 'state': 'clipped-source-candidates',
        'source': {'path': SOURCE.relative_to(ROOT).as_posix(), 'sha256': EXPECTED,
            'itemId': '658_67', 'featureCount': source_count,
            'productMeaning': 'Water surfaces flattened in the height model; not bathymetry.',
            'productMeaningSource': 'https://www.lantmateriet.se/sv/geodata/vara-produkter/Produktnyheter/Geografisk-information/markhojdmodell-nedladdning-utokas-med-mer-innehall/'},
        'clipBoundsEpsg3006': BOUNDS, 'method': 'GEOS polygon intersection; original PolygonZ ring structure retained, no simplification or repair',
        'toolchain': {'shapely': shapely.__version__, 'geos': shapely.geos_version_string},
        'output': {'path': target.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'featureCount': len(features), 'polygonCount': sum(x['outputPolygonCount'] for x in diagnostics),
            'interiorRingCount': sum(x['outputHoleCount'] for x in diagnostics)},
        'features': diagnostics, 'excludedSourceFids': excluded,
        'limitations': ['Crop boundary segments are acquisition edges, not surveyed shorelines.',
            'Source classification code retained verbatim; no new classification meaning inferred.',
            'Exact local capture epochs and contemporary water levels remain unverified.',
            'This is source geometry, not an approved course water/bed rendering decision.']}
    (OUTPUT / 'water-breakgeometry-review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(report['output']))


if __name__ == '__main__':
    main()
