"""Measure source roof heights; do not modify the course model or invent eaves.

Run with the repository's review Python environment after acquire-building-laser.mjs.
All coordinates are EPSG:3006, heights RH2000. OSM supplies the footprint hypothesis.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from shapely.geometry import shape, Point, MultiPoint, Polygon
from shapely.ops import triangulate
from shapely import contains_xy
from pyproj import Transformer
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'lidingobuild/cache/buildings'
OUT.mkdir(parents=True, exist_ok=True)
TARGETS = ['way/32262176', 'way/32262169', 'way/32262183', 'way/26408210', 'way/26408211', 'way/221846983']
TERRAIN_SHA = '80ffcd4865daa00f8e2393f43b8fcb1b37e020f968c0656a0189f80dde1de923'
REVIEWED_CONTEXT_SHA = '2f15ec752e6201a5652f05d8be4b5b9b8e05413beaead454c86eded79a4657c7'
REVIEWED_ORTHOPHOTO_SHA = 'cd12fca3a779b19199f591306a7090c39c19eb9d8b91f57f69bdb301c6496691'
REVIEWED_POINTS_SHA = '99e059dc03b2923a4803815085e38546f49393996023445676a4fa80389c0365'

def read(relative):
    return json.loads((ROOT / relative).read_text(encoding='utf-8'))

def identity(relative):
    data = (ROOT / relative).read_bytes()
    return dict(path=relative, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())

def q(values):
    values = np.asarray(values)
    values = values[np.isfinite(values)]
    if not len(values):
        return dict(count=0, minimum=None, p05=None, median=None, p95=None, maximum=None)
    return dict(count=len(values), **dict(zip(['minimum', 'p05', 'median', 'p95', 'maximum'],
                [round(float(v), 3) for v in np.quantile(values, [0, .05, .5, .95, 1])])) )

def dtm_at(x, y, dtm):
    col = np.asarray(x) - 676676.5
    row = 6587423.5 - np.asarray(y)
    if np.any((col < 0) | (row < 0) | (col > 2048) | (row > 2048)):
        raise ValueError('Source query leaves the retained terrain grid')
    ix = np.minimum(2047, np.floor(col).astype(int))
    iy = np.minimum(2047, np.floor(row).astype(int))
    u, v = col - ix, row - iy
    return (dtm[iy, ix] * (1-u) + dtm[iy, ix+1] * u) * (1-v) + (dtm[iy+1, ix] * (1-u) + dtm[iy+1, ix+1] * u) * v

def robust_planes(points, min_inliers=25, threshold=.18, max_planes=8):
    """Deterministic RANSAC planes; outputs evidence, not architectural surfaces."""
    if len(points) < min_inliers:
        return [], np.full(len(points), -1, dtype=int)
    centre = points[:, :2].mean(axis=0)
    local = points.copy()
    local[:, :2] -= centre
    labels = np.full(len(points), -1, dtype=int)
    rng = np.random.default_rng(32262176)
    planes = []
    for _ in range(max_planes):
        rem = np.flatnonzero(labels < 0)
        if len(rem) < min_inliers:
            break
        best = np.array([], dtype=int)
        for _ in range(600):
            ids = rng.choice(rem, 3, replace=False)
            a = np.column_stack((local[ids, :2], np.ones(3)))
            if abs(np.linalg.det(a)) < 1:
                continue
            plane = np.linalg.solve(a, local[ids, 2])
            if np.linalg.norm(plane[:2]) > 1.2:
                continue
            residual = np.abs(np.column_stack((local[rem, :2], np.ones(len(rem)))) @ plane - local[rem, 2])
            matches = rem[residual <= threshold]
            if len(matches) > len(best):
                best = matches
        if len(best) < min_inliers:
            break
        a = np.column_stack((local[best, :2], np.ones(len(best))))
        plane, *_ = np.linalg.lstsq(a, local[best, 2], rcond=None)
        residual = np.abs(a @ plane - local[best, 2])
        if np.quantile(residual, .95) > .22 or np.linalg.norm(plane[:2]) > 1.2:
            break
        label = len(planes)
        labels[best] = label
        planes.append(dict(index=label, pointCount=len(best), originEpsg3006=centre.tolist(),
            coefficients=list(map(float, plane)), equation='RH2000 = a*(E-originE) + b*(N-originN) + c',
            absoluteResidualMetres=q(residual), slopeDegrees=round(float(np.degrees(np.arctan(np.linalg.norm(plane[:2])))), 2)))
    return planes, labels

def roof_mesh(poly, selected, labels, planes, dtm, edge_candidates):
    """Measured-return TIN plus explicitly bounded boundary extrapolation.

    Uses original heights of planar-supported returns. Boundary heights use
    the nearest supported local plane, at most 3 m from its supporting points.
    No roof style, eave line, ridge, or additional rooftop is invented.
    """
    valid = labels >= 0
    xyz, plane_labels = selected[valid], labels[valid]
    if len(xyz) < 75 or len(xyz) / max(1, len(selected)) < .90:
        return dict(status='withheld', reasons=['insufficient planar-supported returns']), None
    # Interior planes classify additional actual edge returns only when the
    # same plane is supported nearby. This does not extrapolate a new point.
    existing = {tuple(p) for p in xyz}
    added, added_labels = [], []
    for point in edge_candidates:
        if tuple(point) in existing:
            continue
        choices = []
        for plane in planes:
            local = point[:2] - np.asarray(plane['originEpsg3006'])
            residual = abs(float(np.dot(np.r_[local, 1.], plane['coefficients'])) - point[2])
            supports = xyz[plane_labels == plane['index'], :2]
            distance = float(np.linalg.norm(supports - point[:2], axis=1).min())
            if residual <= .22 and distance <= 3:
                choices.append((residual, plane['index']))
        if choices:
            added.append(point); added_labels.append(min(choices)[1]); existing.add(tuple(point))
    if added:
        xyz = np.vstack((xyz, added)); plane_labels = np.r_[plane_labels, added_labels]
    boundary = []
    distances = []
    ring = np.asarray(poly.exterior.coords)
    for a, b in zip(ring[:-1], ring[1:]):
        for t in np.arange(max(1, int(np.ceil(np.linalg.norm(b-a)))))/max(1, int(np.ceil(np.linalg.norm(b-a)))):
            point = a + (b-a)*t
            dist = np.linalg.norm(xyz[:, :2] - point, axis=1)
            nearest = np.argmin(dist)
            plane = planes[int(plane_labels[nearest])]
            local = point - np.asarray(plane['originEpsg3006'])
            z = float(np.dot(np.r_[local, 1.], plane['coefficients']))
            distances.append(float(dist[nearest]))
            if dist[nearest] > 3 or z < selected[:, 2].min() - .75 or z > selected[:, 2].max() + .75:
                boundary.append(None)
            else:
                boundary.append([float(point[0]), float(point[1]), z])
    supported_boundary = [p for p in boundary if p is not None]
    wall_segments = [[a, b] for a, b in zip(boundary, boundary[1:]+boundary[:1]) if a is not None and b is not None]
    all_points = np.vstack((xyz, supported_boundary))
    by_xy = {}
    for e, n, h in all_points:
        by_xy.setdefault((float(e), float(n)), []).append(float(h))
    heights = {xy: float(np.median(values)) for xy, values in by_xy.items()}
    original_triangles = triangulate(MultiPoint(list(heights)))
    vertices, indices, ids = [], [], {}
    accepted_triangles = []
    triangle_edges = []
    area = 0.
    def vertex_id(e, n, h):
        key = (round(float(e), 6), round(float(n), 6))
        if key not in ids:
            ids[key] = len(vertices)
            vertices.append([key[0], key[1], round(float(h), 4)])
        return ids[key]
    for tri in original_triangles:
        coords = np.asarray(tri.exterior.coords)[:3]
        edge = max(np.linalg.norm(coords[1]-coords[0]), np.linalg.norm(coords[2]-coords[1]), np.linalg.norm(coords[0]-coords[2]))
        # Do not bridge broad unmeasured roof regions.
        if edge > 5:
            continue
        clipped = tri.intersection(poly)
        if clipped.is_empty or clipped.area < 1e-8:
            continue
        centre = coords.mean(axis=0)
        a = np.column_stack((coords-centre, np.ones(3)))
        if abs(np.linalg.det(a)) < 1e-10:
            continue
        z = np.array([heights[tuple(p)] for p in coords])
        plane = np.linalg.solve(a, z)
        parts = [clipped] if clipped.geom_type == 'Polygon' else list(clipped.geoms)
        for part in parts:
            if part.geom_type != 'Polygon' or part.area < 1e-8:
                continue
            for piece in triangulate(part):
                if not part.buffer(1e-8).covers(piece) or piece.area < 1e-8:
                    continue
                xyz_piece = []
                for e, n in list(piece.exterior.coords)[:3]:
                    h = float(np.dot([e-centre[0], n-centre[1], 1.], plane))
                    xyz_piece.append([e, n, h])
                indices.extend(vertex_id(*p) for p in xyz_piece)
                accepted_triangles.append(piece)
                triangle_edges.append(float(edge))
                area += piece.area
    covered = area / poly.area
    if covered <= 0 or not vertices:
        return dict(status='withheld', reasons=['no supported roof triangles'], footprintCoverageFraction=covered), None
    vertices_array = np.asarray(vertices)
    clearance = vertices_array[:, 2] - dtm_at(vertices_array[:, 0], vertices_array[:, 1], dtm)
    if not len(vertices) or not np.isfinite(vertices_array).all() or clearance.min() < .5:
        return dict(status='withheld', reasons=['roof surface intersects DTM or has invalid coordinates']), None
    from shapely.ops import unary_union
    missing = poly.difference(unary_union(accepted_triangles))
    missing_polygons = [missing] if missing.geom_type == 'Polygon' else list(missing.geoms)
    void_polygons = [[[list(p) for p in gap.exterior.coords]] + [[list(p) for p in hole.coords] for hole in gap.interiors]
                     for gap in missing_polygons if gap.geom_type=='Polygon' and gap.area > 1e-6]
    wall_length = sum(np.linalg.norm(np.asarray(b)[:2]-np.asarray(a)[:2]) for a, b in wall_segments)
    boundary.append(boundary[0])
    stats = dict(status='machine-reviewed-measured-roof-candidate' if covered >= .95 else 'machine-reviewed-partial-measured-roof-candidate', sourceReturns=len(xyz), additionalMeasuredEdgeReturns=len(added), triangles=len(indices)//3,
        vertices=len(vertices), footprintCoverageFraction=round(covered, 6),
        boundarySupportDistanceMetres=q(distances), maximumTriangleEdgeMetres=round(max(triangle_edges), 3),
        roofClearanceAboveDtmMetres=q(clearance), roofHeightRH2000=q(vertices_array[:, 2]),
        interpolatedBoundaryVertices=len(supported_boundary), unsupportedBoundaryVertices=len(boundary)-1-len(supported_boundary),
        supportedWallBoundaryMetres=round(float(wall_length), 3), sourceFootprintPerimeterMetres=round(poly.length, 3),
        uncoveredRoofAreaSquareMetres=round(poly.area-area, 4),
        interpretation='Dated first-return roof surface TIN; original planar-supported return heights, locally fitted boundary heights, no architectural roof style assumed.')
    mesh = dict(verticesEpsg3006RH2000=vertices, triangleIndices=indices,
        boundaryRingsEpsg3006RH2000=[[[round(v, 6) for v in p] for p in boundary]] if all(p is not None for p in boundary) else [],
        boundaryWallSegmentsEpsg3006RH2000=[[[round(v, 6) for v in p] for p in segment] for segment in wall_segments],
        uncoveredFootprintGeometryEpsg3006=dict(type='MultiPolygon', coordinates=void_polygons),
        vertexOrder='easting,northing,heightRH2000', boundaryHeightMethod='nearest robust source plane; support distance <=3 m; source footprint unchanged',
        roofStyle=None, eaveHeightRH2000=None, statistics=stats)
    return stats, mesh

def main():
    acquisition = read('lidingobuild/mapping/building-laser-acquisition.json')
    raw_id = identity(acquisition['rasterlessPoints']['path'])
    if raw_id['sha256'] != REVIEWED_POINTS_SHA or raw_id['sha256'] != acquisition['rasterlessPoints']['sha256'] or acquisition['capturedAt'] != '2021-03-23':
        raise ValueError('Retained point source identity differs')
    raw = read(raw_id['path'])
    if raw['columns'] != ['easting', 'northing', 'heightRH2000', 'classification', 'returnNumber', 'numberOfReturns']:
        raise ValueError('Point schema differs')
    points = np.asarray(raw['points'])
    if points.shape != (acquisition['statistics']['pointsInWindow'], 6) or not np.isfinite(points).all():
        raise ValueError('Point data incomplete or non-finite')
    terrain_id = identity('lidingobuild/cache/terrain-review/terrain-1m.f32')
    if terrain_id['sha256'] != TERRAIN_SHA:
        raise ValueError('Source DTM differs')
    dtm = np.fromfile(ROOT / terrain_id['path'], dtype='<f4').reshape((2049, 2049))
    context_path = 'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson'
    if identity(context_path)['sha256'] != REVIEWED_CONTEXT_SHA:
        raise ValueError('Footprints changed: repeat the visual correspondence review before updating its pinned identity')
    context = read(context_path)
    if context['crs']['properties']['name'] != 'EPSG:3006':
        raise ValueError('Footprint CRS differs')
    features = {f['id']: f for f in context['features'] if f['id'] in TARGETS}
    if set(features) != set(TARGETS):
        raise ValueError('A selected building footprint is missing')
    photo = read('geo_data/course-v2/lidingo/discovery/municipal-ortho-2019.json')
    if photo['sha256'] != REVIEWED_ORTHOPHOTO_SHA or identity(photo['path'])['sha256'] != photo['sha256']:
        raise ValueError('Reference orthophoto differs')
    image = np.asarray(Image.open(ROOT / photo['path']))
    transform = Transformer.from_crs(3006, 3011, always_xy=True)
    image_bounds = photo['bboxEpsg3011']
    fig, axes = plt.subplots(2, 3, figsize=(15, 11), layout='constrained')
    buildings, meshes = [], []
    for index, feature_id in enumerate(TARGETS):
        f = features[feature_id]
        poly = shape(f['geometry'])
        if not poly.is_valid or poly.area <= 0 or poly.geom_type != 'Polygon' or poly.interiors:
            raise ValueError('Invalid or unsupported source footprint topology')
        inside = contains_xy(poly, points[:, 0], points[:, 1])
        core = contains_xy(poly.buffer(-.6), points[:, 0], points[:, 1])
        ground = dtm_at(points[:, 0], points[:, 1], dtm)
        # Class 1 is unclassified; the spatial/image association stays explicit.
        elevated = (points[:, 3] == 1) & (points[:, 4] == 1) & ((points[:, 2] - ground) >= 1.5)
        selected = points[core & elevated, :3]
        footprint_returns = points[inside]
        planes, labels = robust_planes(selected, min_inliers=12 if poly.area < 40 else 25)
        observed_fraction = float(np.count_nonzero(labels >= 0) / len(labels)) if len(labels) else 0.
        ring = np.asarray(poly.exterior.coords)
        rectangle = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)
        lengths = np.linalg.norm(np.diff(rectangle, axis=0), axis=1)
        centre = np.asarray(poly.centroid.coords)[0]
        record = dict(id=feature_id, sourceId=f['properties']['sourceId'], observedAt='2021-03-23',
            tags=f['properties']['tags'], footprintSha256=hashlib.sha256(json.dumps(f['geometry'], separators=(',', ':')).encode()).hexdigest(),
            footprintAreaSquareMetres=round(poly.area, 2), horizontalBoundsEpsg3006=list(poly.bounds),
            minimumRotatedRectangleMetres=dict(long=round(float(max(lengths)), 2), short=round(float(min(lengths)), 2)),
            footprintReturnCount=len(footprint_returns), footprintClasses={str(int(k)): int(v) for k, v in zip(*np.unique(footprint_returns[:, 3], return_counts=True))},
            selectedInteriorFirstReturns=len(selected), selectionBoundaryInsetMetres=.6,
            roofCandidateAbsoluteHeightRH2000=q(selected[:, 2]),
            roofCandidateHeightAboveDtm=q(selected[:, 2] - dtm_at(selected[:, 0], selected[:, 1], dtm)),
            footprintBoundaryDtmRH2000=q(dtm_at(ring[:, 0], ring[:, 1], dtm)),
            footprintCentroidDtmRH2000=round(float(dtm_at(centre[0], centre[1], dtm)), 3),
            planarSupportFraction=round(observed_fraction, 4), planes=planes,
            imageAssociation=dict(sourceId='imagery-municipal-2019', year=2019, status='machine-visual-reviewed',
                meaning='Visible roof corresponds to the retained footprint; roof displacement and source years remain uncalibrated.',
                review='Inspected original facility overlay and source-return panels. Large roof interiors are visually clear of tree crowns; the small shed has sparse returns.'),
            renderingAdoption=None, wallHeightMetres=None, eaveHeightRH2000=None, roofType=None,
            limitations=['First-return class 1 is unclassified; spatial selection can include a tree, chimney, or roof fixture.',
                'Ground is an interpolated DTM beneath the structure, not a measured foundation or wall base.',
                'Roof candidate heights are not eave/wall heights; do not assign them directly to the legacy building h field.'])
        mesh_stats, mesh = roof_mesh(poly, selected, labels, planes, dtm, points[inside & elevated, :3])
        record['roofSurface'] = mesh_stats
        if mesh is not None:
            meshes.append(dict(id=feature_id, sourceId='laser-lm-skog', sourceFootprintId=feature_id,
                sourceEpoch='2021-03-23', state=mesh_stats['status'], mesh=mesh))
        buildings.append(record)
        np.savez(OUT / (feature_id.replace('/', '-') + '-roof-points.npz'), xyz=selected, labels=labels)
        ax = axes.flat[index]
        ax.imshow(image, extent=[image_bounds[0], image_bounds[2], image_bounds[1], image_bounds[3]], origin='upper')
        x, y = transform.transform(ring[:, 0], ring[:, 1])
        ax.plot(x, y, color='cyan', lw=1.5)
        e, n = transform.transform(selected[:, 0], selected[:, 1])
        scatter = ax.scatter(e, n, c=selected[:, 2], s=7, cmap='viridis', alpha=.8)
        bounds = transform.transform_bounds(*poly.buffer(8).bounds, densify_pts=21)
        ax.set_xlim(bounds[0], bounds[2]); ax.set_ylim(bounds[1], bounds[3]); ax.set_aspect('equal')
        ax.ticklabel_format(useOffset=False, style='plain'); ax.tick_params(labelsize=6)
        ax.set_title(f"{feature_id}: {len(selected)} interior returns\n{observed_fraction:.0%} planar support; {len(planes)} planes", fontsize=11)
        fig.colorbar(scatter, ax=ax, label='2021 RH2000 metres', shrink=.7)
    fig.suptitle('Lidingö buildings: OSM footprint hypothesis (cyan), 2019 orthophoto, actual 2021 first returns', fontsize=14)
    fig.savefig(OUT / 'building-roof-source-panels.png', dpi=150)
    plt.close(fig)
    report = dict(schemaVersion=1, groundId='lidingo', state='roof-height-evidence-candidates',
        horizontalCrs='EPSG:3006', verticalCrs='EPSG:5613', sourceEpoch='2021-03-23',
        inputs=[identity('geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson'), terrain_id, raw_id,
                identity('lidingobuild/mapping/building-laser-acquisition.json'), identity(photo['path'])],
        sourceIds=['lidingo-osm-2026-09-07', 'laser-lm-skog', 'terrain-lm-1m', 'imagery-municipal-2019'],
        method=dict(footprintInsetMetres=.6, minimumHeightAboveDtmMetres=1.5, sourceClassification=1,
            firstReturnsOnly=True, roofPlanes='Deterministic RANSAC, 0.18 m residual inlier band, maximum slope 1.2, least-squares refit; summary evidence, not a roof-style classifier.'),
        buildings=buildings, visualEvidence='lidingobuild/cache/buildings/building-roof-source-panels.png',
        limitations=['No building classification exists in this source; accepted roof/footprint correspondence needs visual review.',
            '2019 image and 2021 laser establish dated source geometry; present-day geometry and uses need current evidence.',
            'Ground height, roof-return height, eave height and wall height are distinct quantities.'])
    destination = ROOT / 'lidingobuild/mapping/building-height-evidence.json'
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    mesh_report = dict(schemaVersion=1, groundId='lidingo', state='machine-reviewed-measured-roof-candidates',
        horizontalCrs='EPSG:3006', verticalCrs='EPSG:5613', sourceEpoch='2021-03-23', inputs=report['inputs'],
        evidence=identity('lidingobuild/mapping/building-height-evidence.json'), buildings=meshes,
        withheld=[dict(id=b['id'], reasons=b['roofSurface']['reasons']) for b in buildings if b['roofSurface']['status']=='withheld'],
        limitations=['Interpolated surfaces between measured returns do not recover unobserved roof details.',
            'Boundary heights are bounded local-plane extrapolation onto the retained OSM footprint, not directly measured eaves.',
            'Render the supplied surface directly; do not add a generic gable or roof on top.',
            'Walls may descend to the source DTM for visualization; that is not evidence for actual foundations or wall materials.'])
    (ROOT / 'lidingobuild/mapping/building-roof-meshes.json').write_text(json.dumps(mesh_report, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps([dict(id=b['id'], returns=b['selectedInteriorFirstReturns'], aboveDtm=b['roofCandidateHeightAboveDtm'], planarSupport=b['planarSupportFraction'], roofSurface=b['roofSurface']) for b in buildings], indent=2))

if __name__ == '__main__':
    main()
