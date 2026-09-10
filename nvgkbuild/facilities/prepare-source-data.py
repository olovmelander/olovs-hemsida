"""Prepare an isolated Blender facility reference from measured LM sources.

Run from any working directory with Python containing numpy and scipy:
  upsalabuild/cache/review-venv/Scripts/python.exe nvgkbuild/facilities/prepare-source-data.py

All raw point vertices remain in ignored cache. This is a modelling reference;
it does not replace the application's 1 m terrain or publish source clouds.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import scipy
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'nvgkbuild/cache/facilities-reference'
ORIGIN = np.array([678580.0, 6988405.0, 32.8])
BOUNDS = [678520, 6988200, 678690, 6988460]
SPACING = 2.0

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))

def sha_bytes(value):
    return hashlib.sha256(value).hexdigest()

def sha_file(path):
    return sha_bytes(path.read_bytes())

def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')

acquisition_path = CACHE / 'laser/acquisition.json'
acquisition = read_json(acquisition_path)
raw_path = ROOT / acquisition['localPointsPath']
assert sha_file(raw_path) == acquisition['localPointsSha256'], 'Laser extract checksum mismatch'
raw = read_json(raw_path)
assert raw['columns'] == ['easting', 'northing', 'heightRH2000', 'classification', 'returnNumber', 'numberOfReturns', 'intensity']
points = np.asarray(raw['points'], dtype=np.float64)
assert points.shape == (190926, 7)
assert len(points) == acquisition['statistics']['pointsInWindow']
assert acquisition['boundsEpsg3006'] == BOUNDS
assert np.all(np.isfinite(points))
assert set(np.unique(points[:, 3]).tolist()) == {1.0, 2.0}
ground = points[points[:, 3] == 2, :3]
assert len(ground) == acquisition['statistics']['byClass']['2']

ortho_reference_path = ROOT / 'nvgkbuild/mapping/facilities-ortho-reference.json'
ortho_reference = read_json(ortho_reference_path)
ortho = ortho_reference['source']
ortho_record = ortho['window']
assert sha_file(ROOT / ortho['rasterPath']) == ortho_record['sha256']
assert sha_file(ROOT / ortho['rgbPath']) == ortho_record['rgbSha256']
height_reference_path = ROOT / 'nvgkbuild/mapping/facilities-height-reference.json'
height_reference = read_json(height_reference_path)
assert height_reference['source']['localPointsSha256'] == acquisition['localPointsSha256']

# Class 2 is the only ground evidence here. Unclassified returns include roofs,
# trees and structures and never contribute to this reference ground surface.
tree = cKDTree(ground[:, :2])
eastings = np.arange(BOUNDS[0], BOUNDS[2] + SPACING / 2, SPACING)
northings = np.arange(BOUNDS[1], BOUNDS[3] + SPACING / 2, SPACING)
ee, nn = np.meshgrid(eastings, northings)
queries = np.c_[ee.ravel(), nn.ravel()]
nearest_distance, nearest_index = tree.query(queries, k=1)
neighbours = tree.query_ball_point(queries, r=2.5)
heights = np.full(len(queries), np.nan)
supports = np.zeros(len(queries), dtype=int)
modes = np.zeros(len(queries), dtype=int)
for i, nearby in enumerate(neighbours):
    if nearest_distance[i] > 5.0:
        continue
    if len(nearby) >= 3:
        heights[i] = np.median(ground[nearby, 2])
        supports[i] = len(nearby)
        modes[i] = 1
        continue
    nearby = tree.query_ball_point(queries[i], r=3.0)
    if nearby:
        heights[i] = np.median(ground[nearby, 2])
        supports[i] = len(nearby)
        modes[i] = 2
    else:
        # Explicit closest-measured fallback, never beyond 5 m. This avoids
        # silently spanning wide ground holes beneath buildings or canopy.
        heights[i] = ground[nearest_index[i], 2]
        supports[i] = 1
        modes[i] = 3

valid = np.isfinite(heights)
grid_to_vertex = np.full(len(queries), -1, dtype=int)
grid_to_vertex[valid] = np.arange(valid.sum())
vertices = np.round(np.c_[queries[valid], heights[valid]] - ORIGIN, 4).tolist()
columns, rows = len(eastings), len(northings)
triangles = []
skipped_quads = 0
for row in range(rows - 1):
    for column in range(columns - 1):
        a = row * columns + column
        quad = grid_to_vertex[[a, a + 1, a + columns, a + columns + 1]]
        if np.any(quad < 0):
            skipped_quads += 1
            continue
        aa, bb, cc, dd = map(int, quad)
        triangles.extend([[aa, bb, cc], [bb, dd, cc]])

ox0, oy0, ox1, oy1 = ortho_record['boundsEpsg3006']
uv = np.c_[(queries[valid, 0] - ox0) / (ox1 - ox0), (queries[valid, 1] - oy0) / (oy1 - oy0)]
ortho_covered = np.all((uv >= 0) & (uv <= 1), axis=1)
triangle_array = np.asarray(triangles, dtype=int)
xyz = np.asarray(vertices)
normal_z = np.cross(xyz[triangle_array[:, 1]] - xyz[triangle_array[:, 0]],
                    xyz[triangle_array[:, 2]] - xyz[triangle_array[:, 0]])[:, 2]
assert np.all(normal_z > 0), 'Terrain triangle winding is not upward'
assert np.all(nearest_distance[valid] <= 5)
assert np.all(supports[valid] > 0)
assert np.all(np.isfinite(xyz))
point_vertices = np.round(points[:, :3] - ORIGIN, 4).tolist()
assert np.max(abs(np.asarray(point_vertices) + ORIGIN - points[:, :3])) < 1e-7
assert np.array_equal(points[:, 3].astype(int), np.asarray(points[:, 3], dtype=int))

terrain = {
    'vertices': vertices,
    'triangles': triangles,
    'uv': np.round(uv, 9).tolist(),
    'orthoCovered': ortho_covered.tolist(),
    'nearestGroundDistanceMetres': np.round(nearest_distance[valid], 4).tolist(),
    'groundSupportCount': supports[valid].tolist(),
    'sampleMethod': modes[valid].tolist(),
    'sampleMethods': {'1': 'median of at least 3 class-2 returns within 2.5 m',
                      '2': 'median of available class-2 returns within 3 m',
                      '3': 'nearest class-2 return, at most 5 m away'},
    'gridIndex': np.flatnonzero(valid).tolist(),
    'grid': {'columns': columns, 'rows': rows, 'spacingMetres': SPACING,
             'boundsEpsg3006': BOUNDS,
             'order': 'easting varies fastest; rows run south to north',
             'allGridVertexCount': len(queries),
             'omittedGridIndices': np.flatnonzero(~valid).tolist()},
    'uvConvention': 'u=(E-minE)/(maxE-minE); v=(N-minN)/(maxN-minN), standard Blender image UV with north at v=1. Values outside [0,1] are intentionally retained and marked orthoCovered=false.',
    'triangleWinding': 'counterclockwise viewed from above; positive local Z normal',
    'geometryHashes': {'verticesJsonSha256': sha_bytes(json_bytes(vertices)),
                       'trianglesJsonSha256': sha_bytes(json_bytes(triangles))},
}
validation = {
    'allSourcePointsRetained': len(point_vertices) == len(points),
    'sourcePointCount': len(points),
    'groundPointCount': len(ground),
    'pointCoordinateRoundtripMaximumErrorMetres': float(np.max(abs(np.asarray(point_vertices) + ORIGIN - points[:, :3]))),
    'terrainVertexCount': len(vertices),
    'terrainTriangleCount': len(triangles),
    'terrainGridVerticesOmittedBeyond5m': int((~valid).sum()),
    'terrainQuadsOmittedAroundUnsupportedVertices': skipped_quads,
    'maximumRetainedNearestGroundDistanceMetres': round(float(nearest_distance[valid].max()), 6),
    'terrainSampleCountsByMethod': {str(int(mode)): int((modes[valid] == mode).sum()) for mode in np.unique(modes[valid])},
    'terrainVerticesOutsideOrthophotoCoverage': int((~ortho_covered).sum()),
    'terrainTrianglesFullyInsideOrthophotoCoverage': int(np.all(ortho_covered[triangle_array], axis=1).sum()),
    'allTrianglesWindUpwards': bool(np.all(normal_z > 0)),
    'sourceHashesVerified': True,
}
data = {
    'schemaVersion': 1,
    'groundId': 'norrfallsviken',
    'purpose': 'Blender facilities source reference; not application terrain publication',
    'originEpsg3006RH2000': ORIGIN.tolist(),
    'coordinateFrame': {'axes': 'x=easting-originE; y=northing-originN; z=heightRH2000-originHeight',
                        'units': 'metres', 'horizontalCrs': 'EPSG:3006', 'verticalDatum': 'RH2000',
                        'localToSource': 'add originEpsg3006RH2000 componentwise; no rotation or scaling'},
    'pointCloud': {
        'vertices': point_vertices,
        'classification': points[:, 3].astype(int).tolist(),
        'classificationColours': {'1': [0.85, 0.43, 0.12, 1.0], '2': [0.20, 0.55, 0.25, 1.0]},
        'classificationMeaning': {'1': 'unclassified (including roofs, trees and structures)', '2': 'ground'},
        'geometrySha256': sha_bytes(json_bytes(point_vertices)),
    },
    'terrain': terrain,
    'sourceMetadata': {
        'laser': acquisition,
        'acquisitionFileSha256': sha_file(acquisition_path),
        'orthophoto': ortho,
        'orthophotoReferenceFile': str(ortho_reference_path.relative_to(ROOT)).replace('\\', '/'),
        'orthophotoReferenceSha256': sha_file(ortho_reference_path),
        'heightReferenceFile': str(height_reference_path.relative_to(ROOT)).replace('\\', '/'),
        'heightReferenceSha256': sha_file(height_reference_path),
        'generator': {'path': str(Path(__file__).resolve().relative_to(ROOT)).replace('\\', '/'),
                      'sha256': sha_file(Path(__file__)), 'numpy': np.__version__, 'scipy': scipy.__version__},
        'terrainMethod': '2 m reference grid, local medians of classified ground; closest-ground fallback only within 5 m, unsupported vertices and adjoining quads omitted.',
        'limitations': ['The 2 m reference surface is deliberately coarser than the application 1 m terrain.',
                        'Median filtering can soften small curbs and trenches; retain the full point cloud as primary evidence.',
                        'Ground gaps under roofs are not surveyed floors or building foundations.',
                        'The June 2024 image and June 2025 laser may show different construction states.',
                        'The source point cloud and orthophoto remain in ignored local cache.'],
    },
    'validation': validation,
}
output = CACHE / 'blender-source-data.json'
encoded = json_bytes(data)
output.write_bytes(encoded)
metadata = {'file': str(output.relative_to(ROOT)).replace('\\', '/'), 'bytes': len(encoded),
            'sha256': sha_bytes(encoded), 'validation': validation}
(CACHE / 'blender-source-data.meta.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(json.dumps(metadata, indent=2))
