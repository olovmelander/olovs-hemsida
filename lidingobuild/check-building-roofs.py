"""Independent checks of retained roof meshes against source geometry/heights."""
import json
from pathlib import Path
import hashlib
import numpy as np
from shapely.geometry import shape, Polygon, LineString, Point
from shapely.ops import unary_union
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

ROOT = Path(__file__).resolve().parents[1]
def read(path):
    return json.loads((ROOT/path).read_text(encoding='utf-8'))
def sha(path):
    return hashlib.sha256((ROOT/path).read_bytes()).hexdigest()

def main():
    mesh_path = 'lidingobuild/mapping/building-roof-meshes.json'
    source = read(mesh_path)
    assert source['horizontalCrs']=='EPSG:3006' and source['verticalCrs']=='EPSG:5613'
    for item in source['inputs'] + [source['evidence']]:
        assert sha(item['path']) == item['sha256'], f"Source changed: {item['path']}"
    context = read('geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson')
    footprints = {f['id']: shape(f['geometry']) for f in context['features'] if f['geometry']['type']=='Polygon'}
    acquisition = read('lidingobuild/mapping/building-laser-acquisition.json')
    raw = np.asarray(read(acquisition['rasterlessPoints']['path'])['points'])
    roof_source = raw[(raw[:, 3]==1) & (raw[:, 4]==1)]
    raw_heights = {}
    for e, n, h, *_ in roof_source:
        raw_heights.setdefault((round(float(e), 6), round(float(n), 6)), []).append(float(h))
    checks = []
    fig = plt.figure(figsize=(15, 10), layout='constrained')
    for number, building in enumerate(source['buildings'], 1):
        footprint = footprints[building['id']]
        mesh = building['mesh']
        vertices = np.asarray(mesh['verticesEpsg3006RH2000'])
        indices = np.asarray(mesh['triangleIndices'])
        assert vertices.ndim==2 and vertices.shape[1]==3 and np.isfinite(vertices).all()
        assert indices.ndim==1 and len(indices)%3==0 and (indices>=0).all() and (indices<len(vertices)).all()
        assert np.issubdtype(indices.dtype, np.integer)
        indices = indices.reshape((-1, 3))
        assert len({tuple(sorted(t)) for t in indices})==len(indices), 'Duplicated triangle'
        triangles = []
        min_signed_area = float('inf')
        for triangle in indices:
            xy = vertices[triangle, :2]
            signed_area = float(np.linalg.det(np.array([xy[1]-xy[0], xy[2]-xy[0]])) / 2)
            assert signed_area > 0, 'TIN winding must face upward after E,N,H -> x,H,-N'
            min_signed_area = min(min_signed_area, signed_area)
            triangles.append(Polygon(xy))
        surface = unary_union(triangles)
        outside = surface.difference(footprint).area
        overlap = sum(t.area for t in triangles)-surface.area
        fraction = surface.area/footprint.area
        assert outside < .005, 'Roof leaves source footprint'
        assert overlap < .005, 'Overlapping roof triangles'
        assert abs(fraction-mesh['statistics']['footprintCoverageFraction']) < .000005
        void = shape(mesh['uncoveredFootprintGeometryEpsg3006'])
        void_difference = void.symmetric_difference(footprint.difference(surface)).area
        assert void_difference < .005, 'Uncovered region topology differs'
        wall_distance = 0.
        for segment in mesh['boundaryWallSegmentsEpsg3006RH2000']:
            assert np.asarray(segment).shape==(2, 3) and np.isfinite(segment).all()
            line = LineString(np.asarray(segment)[:, :2])
            deviation = max(Point(p[:2]).distance(footprint.boundary) for p in segment)
            deviation = max(deviation, line.interpolate(.5, normalized=True).distance(footprint.boundary))
            wall_distance = max(wall_distance, deviation)
            assert deviation < .00001, 'A wall segment is an invented interior edge'
        source_vertices, errors = 0, []
        for e, n, h in vertices:
            values = raw_heights.get((round(float(e), 6), round(float(n), 6)))
            if values:
                source_vertices += 1
                errors.append(min(abs(float(h)-value) for value in values))
        assert source_vertices >= 75
        assert max(errors) <= .000051, 'TIN altered an original return beyond encoding rounding'
        record = dict(id=building['id'], state=building['state'], passed=True,
            vertices=len(vertices), triangles=len(indices), upwardWindingTriangles=len(indices),
            minimumSignedTriangleAreaSquareMetres=min_signed_area,
            sourceReturnVertices=source_vertices, sourceReturnHeightMaximumRoundingDifferenceMetres=max(errors),
            outsideFootprintAreaSquareMetres=outside, overlappingTriangleAreaSquareMetres=overlap,
            footprintCoverageFraction=fraction, uncoveredRegionDifferenceSquareMetres=void_difference,
            wallSegments=len(mesh['boundaryWallSegmentsEpsg3006RH2000']),
            maximumWallDistanceFromSourceFootprintMetres=wall_distance)
        checks.append(record)
        ax = fig.add_subplot(2, 3, number, projection='3d')
        centre = np.asarray(footprint.centroid.coords)[0]
        local = vertices.copy(); local[:, :2] -= centre
        collection = Poly3DCollection(local[indices], cmap='viridis', edgecolor='#384744', linewidth=.08)
        collection.set_array(local[indices, 2].mean(axis=1))
        ax.add_collection3d(collection)
        ax.set_xlim(local[:, 0].min(), local[:, 0].max()); ax.set_ylim(local[:, 1].min(), local[:, 1].max())
        ax.set_zlim(local[:, 2].min()-1, local[:, 2].max()+1)
        ax.set_box_aspect([np.ptp(local[:, 0]), np.ptp(local[:, 1]), max(3, np.ptp(local[:, 2]))])
        ax.view_init(elev=35, azim=-70)
        ax.set_xlabel('East metres'); ax.set_ylabel('North metres'); ax.set_zlabel('RH2000 metres')
        ax.set_title(f"{building['id']}\n{fraction:.1%} footprint supported", fontsize=11)
    fig.suptitle('Actual 2021 roof-return TINs; unsupported footprint areas are intentionally open', fontsize=14)
    fig.savefig(ROOT/'lidingobuild/cache/buildings/building-roof-mesh-panels.png', dpi=150)
    plt.close(fig)
    report = dict(schemaVersion=1, groundId='lidingo', state='source-geometry-and-height-checks-passed',
        meshSource=dict(path=mesh_path, sha256=sha(mesh_path)), checks=checks,
        totals=dict(buildings=len(checks), triangles=sum(c['triangles'] for c in checks),
            sourceReturnVertices=sum(c['sourceReturnVertices'] for c in checks)),
        visualization='lidingobuild/cache/buildings/building-roof-mesh-panels.png',
        limitations=['Checks establish source preservation, finite geometry, winding and explicit gaps; they do not establish independent positional accuracy.',
            'Two source footprints have substantial unsupported roof regions. Those areas remain unknown; no synthetic roof fill or internal wall edges were added.'])
    (ROOT/'lidingobuild/mapping/building-roof-validation.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps(report['totals']))

if __name__=='__main__':
    main()
