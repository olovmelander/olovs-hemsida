"""Build cautious, reproducible Puttom roof-height evidence from classified laser.

Run after acquire-facilities-laser.mjs using a Python with NumPy, Shapely,
pyproj and Matplotlib. No runtime model or Blender scene is changed. Inventory
roof observations select the search area; raw laser coordinates determine planes.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import MultiPoint, Point, Polygon
from shapely import contains_xy
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = ROOT / 'puttombuild/cache/facilities-reference-2026-09-10/laser'
BLENDER_ORIGIN = np.array([697365., 7025190.])
acquisition = json.loads((CACHE / 'acquisition.json').read_text(encoding='utf-8'))
raw = (CACHE / 'points.json').read_bytes()
assert hashlib.sha256(raw).hexdigest() == acquisition['localPointsSha256']
cloud = np.array(json.loads(raw)['points'], dtype=np.float64)
model = json.loads((ROOT / 'puttombuild/course-model.json').read_text(encoding='utf-8'))
project = Transformer.from_crs(4326, 3006, always_xy=True)
inverse = Transformer.from_crs(3006, 4326, always_xy=True)
inventory_path = HERE / 'facility-inventory.json'
inventory_raw = inventory_path.read_bytes() if inventory_path.exists() else None
inventory = json.loads(inventory_raw) if inventory_raw else None
if inventory and inventory.get('roofObservations'):
    inherited_by_id = {f['id']: f for f in inventory['facilities']}
    facilities = []
    for roof in inventory['roofObservations']:
        old = next((inherited_by_id[i] for i in roof.get('inheritedIds', []) if i in inherited_by_id), {})
        facilities.append(dict(id=roof['id'], name=roof['label'], inheritedIds=roof.get('inheritedIds', []),
                               observedRoof=roof, inheritedModel=old.get('inheritedModel', {}), centerEpsg3006=roof['centerEpsg3006']))
elif inventory and inventory.get('facilities'):
    facilities = [f for f in inventory['facilities'] if (f.get('inheritedModel') or {}).get('ringEpsg3006') or (f.get('observedRoof') or {}).get('ringEpsg3006')]
    # Inventory also includes distant OSM buildings outside this deliberately
    # bounded facility acquisition. Never pretend they have measured support.
    bounds = acquisition['boundsEpsg3006']
    facilities = [f for f in facilities if bounds[0] < f['centerEpsg3006'][0] < bounds[2] and bounds[1] < f['centerEpsg3006'][1] < bounds[3]]
else:
    traces = json.loads((ROOT / 'puttombuild/sat-traces.json').read_text(encoding='utf-8'))
    facilities = []
    for feature in traces['buildings']:
        facilities.append(dict(id=feature['id'], name=feature.get('name'), inheritedModel=dict(
            ringEpsg3006=[project.transform(model['origin']['lon']+x/model['mPerLon'], model['origin']['lat']-z/model['mPerLat']) for x,z in feature['ring']],
            ringLocalXZ=feature['ring'], legacyHeightMetres=feature.get('h'))))

def quantiles(values, fractions=(.05, .5, .95)):
    return np.round(np.quantile(values, fractions), 3).tolist() if len(values) else None

def local_xz(en):
    lon, lat = inverse.transform(*en)
    return [round((lon-model['origin']['lon'])*model['mPerLon'], 4), round((model['origin']['lat']-lat)*model['mPerLat'], 4)]

def fit_plane(xyz, rng, threshold=.12, trials=1600):
    if len(xyz) < 15:
        return None
    A = np.c_[xyz[:, :2], np.ones(len(xyz))]
    best = None
    score = 0
    for _ in range(trials):
        ix = rng.choice(len(xyz), 3, replace=False)
        if abs(np.linalg.det(A[ix])) < .4:
            continue
        coef = np.linalg.solve(A[ix], xyz[ix, 2])
        if np.linalg.norm(coef[:2]) > 1.74:
            continue
        mask = abs(A @ coef - xyz[:, 2]) < threshold
        if mask.sum() > score:
            score = mask.sum()
            best = mask
    if best is None or score < 15:
        return None
    for _ in range(4):
        coef = np.linalg.lstsq(A[best], xyz[best, 2], rcond=None)[0]
        best = abs(A @ coef - xyz[:, 2]) < threshold
        if best.sum() < 15:
            return None
    return coef, best, A[best] @ coef - xyz[best, 2]

def connected_support(xyz, distance=1.8):
    """Reject stray coplanar returns before computing a support hull.

    A shared plane equation does not connect two physically separate objects.
    Keep the largest spatial component with at least three nearby neighbours.
    """
    d2 = np.sum((xyz[:, None, :2]-xyz[None, :, :2])**2, axis=2)
    adjacent = d2 <= distance**2
    dense = adjacent.sum(axis=1) >= 4
    seen = ~dense.copy()
    best = []
    for index in np.where(dense)[0]:
        if seen[index]:
            continue
        seen[index] = True
        todo = [int(index)]
        component = []
        while todo:
            current = todo.pop()
            component.append(current)
            neighbours = np.where(adjacent[current] & ~seen)[0]
            seen[neighbours] = True
            todo.extend(neighbours.tolist())
        if len(component) > len(best):
            best = component
    return np.array(best, dtype=int)

results = []
all_plane_points = []
fig, axs = plt.subplots(len(facilities), 2, figsize=(15, 4.4 * len(facilities)))
for row, facility in enumerate(facilities):
    identifier = facility['id']
    observed = facility.get('observedRoof') or {}
    has_observed = bool(observed.get('ringEpsg3006'))
    ring = observed['ringEpsg3006'] if has_observed else facility['inheritedModel']['ringEpsg3006']
    poly = Polygon(ring)
    centre = np.array([poly.centroid.x, poly.centroid.y])
    # Aerial roof outlines can be relief-displaced. Query buffer is deliberate;
    # measured point support never moves to match the image outline.
    buffer = 3.0 if has_observed else 6.0
    query = poly.buffer(buffer)
    window = poly.buffer(buffer + 7).bounds
    nearby = cloud[(cloud[:, 0] > window[0]) & (cloud[:, 0] < window[2]) & (cloud[:, 1] > window[1]) & (cloud[:, 1] < window[3])]
    ground = nearby[nearby[:, 3] == 2]
    G = np.c_[ground[:, :2] - centre, np.ones(len(ground))]
    groundfit = np.linalg.lstsq(G, ground[:, 2], rcond=None)[0]
    groundmask = np.ones(len(ground), dtype=bool)
    for _ in range(4):
        residual = ground[:, 2] - G @ groundfit
        limit = max(.3, float(np.quantile(abs(residual), .8)))
        groundmask = abs(residual) <= limit
        groundfit = np.linalg.lstsq(G[groundmask], ground[groundmask, 2], rcond=None)[0]
    grounderror = ground[groundmask, 2] - G[groundmask] @ groundfit
    hag = nearby[:, 2] - np.c_[nearby[:, :2]-centre, np.ones(len(nearby))] @ groundfit
    select = contains_xy(query, nearby[:, 0], nearby[:, 1])
    candidate = nearby[select & (nearby[:, 3] == 1) & (hag > 1.5) & (hag < 14) & (nearby[:, 4] == 1)]
    xyz = candidate[:, :3].copy()
    xyz[:, :2] -= centre
    used = np.zeros(len(xyz), dtype=bool)
    seed = int(hashlib.sha256(identifier.encode()).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed)
    planes = []
    coefficients = []
    supports = []
    ax, section = axs[row]
    ax.scatter(nearby[:, 0]-centre[0], nearby[:, 1]-centre[1], s=3, color='lightgray')
    for index in range(4):
        remainder = xyz[~used]
        fitted = fit_plane(remainder, rng)
        if fitted is None:
            break
        coef, mask, residual = fitted
        ix = np.where(~used)[0][mask]
        used[ix] = True
        connected = connected_support(xyz[ix])
        ix = ix[connected]
        support = xyz[ix]
        if len(support) < max(15, len(xyz)*.025):
            continue
        design = np.c_[support[:, :2], np.ones(len(support))]
        coef = np.linalg.lstsq(design, support[:, 2], rcond=None)[0]
        residual = design @ coef - support[:, 2]
        hull = MultiPoint(support[:, :2]).convex_hull
        if hull.geom_type != 'Polygon' or hull.area < 4 or len(support)/hull.area < .6:
            continue
        hull_relative = np.array(hull.exterior.coords)[:-1]
        hull_en = hull_relative + centre
        hull_z = np.c_[hull_relative, np.ones(len(hull_relative))] @ coef
        support_hag = support[:, 2] - np.c_[support[:, :2], np.ones(len(support))] @ groundfit
        hull_xy = hull_en - BLENDER_ORIGIN
        plane = dict(
            id=f'{identifier}-plane-{len(planes)+1}', interpretation='planar elevated return support; validate roof assembly against images',
            supportCount=len(support), supportHullAreaSquareMetres=round(hull.area, 2),
            supportPointDensityPerSquareMetre=round(len(support)/hull.area, 3),
            coefficientsLocalEN=np.round(coef, 7).tolist(),
            slopeDegrees=round(math.degrees(math.atan(np.linalg.norm(coef[:2]))), 2),
            residualRmseMetres=round(float(np.sqrt(np.mean(residual**2))), 3),
            residualP95AbsoluteMetres=round(float(np.quantile(abs(residual), .95)), 3),
            supportHeightQuantilesRH2000=dict(zip(['p05', 'p50', 'p95'], quantiles(support[:, 2]))),
            heightAboveNearbyGroundQuantilesMetres=dict(zip(['p05', 'p50', 'p95'], quantiles(support_hag))),
            supportHullEpsg3006=np.round(hull_en, 3).tolist(),
            supportHullLocalXZ=[local_xz(p) for p in hull_en],
            supportHullBlenderXY=np.round(hull_xy, 3).tolist(),
            supportHullHeightsRH2000=np.round(hull_z, 3).tolist(),
        )
        planes.append(plane)
        coefficients.append(coef)
        supports.append(support)
        all_plane_points.append(candidate[ix])
        ax.scatter(support[:, 0], support[:, 1], s=8, label=f"plane {len(planes)}: {len(support)}")
        section.scatter(support[:, 0], support[:, 2], s=8, label=f'plane {len(planes)}')
    record = dict(
        id=identifier, name=facility.get('name'), inheritedIds=facility.get('inheritedIds', [identifier]), sourceGeometry='observed aerial roof polygon' if has_observed else 'inherited manually traced approximate envelope',
        queryEnvelopeEpsg3006=ring, queryBufferMetres=buffer,
        sourceGeometryWarning='Query envelope is not a surveyed wall or eave boundary. Its buffer may include adjacent buildings and vegetation.',
        planeEquation='RH2000 height = a*(E-originE)+b*(N-originN)+c',
        originEpsg3006=np.round(centre, 4).tolist(), originLocalXZ=local_xz(centre), originBlenderXY=np.round(centre-BLENDER_ORIGIN, 4).tolist(),
        allCandidateElevatedReturns=len(candidate), planes=planes,
        nearbyGround=dict(
            classifiedGroundPointCount=len(ground), fittedSupportCount=int(groundmask.sum()),
            heightAtOriginRH2000=round(float(groundfit[2]), 3), coefficientsLocalEN=np.round(groundfit, 7).tolist(),
            heightQuantilesRH2000=dict(zip(['p05', 'p50', 'p95'], quantiles(ground[:, 2]))),
            fittedSlopeDegrees=round(math.degrees(math.atan(np.linalg.norm(groundfit[:2]))), 2),
            residualP95AbsoluteMetres=round(float(np.quantile(abs(grounderror), .95)), 3),
            meaning='Robust plane through surrounding classified ground, not entrance threshold or floor elevation.'),
        roofEvidenceStatus='supported-planar-subsets-require-image-interpretation' if planes else 'no-defensible-planar-roof-support',
        inheritedModelHeightMetres=facility.get('inheritedModel', {}).get('legacyHeightMetres'),
        limitations=['Support hulls are inner sampled envelopes. Do not use them as surveyed walls or eaves.',
                     'Building identity and assembly are inferred from images. Class 1 returns are unclassified and can include vegetation.',
                     'Residuals report internal plane scatter; they are not total absolute survey accuracy.',
                     '2023 laser predates 2024 orthophoto and current photos; roof changes require checking.'],
    )
    # Only propose a ridge where opposing slopes form a convex gable, with
    # sampled support on opposite sides of their intersection. Connected
    # wings or arbitrary planar intersections do not automatically pass.
    ridge_candidates = []
    for ia in range(len(planes)):
        for ib in range(ia+1, len(planes)):
            a, b = coefficients[ia], coefficients[ib]
            na, nb = np.linalg.norm(a[:2]), np.linalg.norm(b[:2])
            if min(na, nb) < .15 or np.dot(a[:2], b[:2])/(na*nb) > -.75:
                continue
            normal = a[:2]-b[:2]
            norm = np.linalg.norm(normal)
            ridge_origin = -(a[2]-b[2])*normal/norm**2
            axis = np.array([-normal[1], normal[0]])/norm
            delta_a = np.c_[supports[ia][:, :2], np.ones(len(supports[ia]))] @ (a-b)
            delta_b = np.c_[supports[ib][:, :2], np.ones(len(supports[ib]))] @ (a-b)
            if np.median(delta_a) >= -.1 or np.median(delta_b) <= .1:
                continue
            # A roof ridge's along-axis extent must be supported by BOTH sides.
            qa = np.quantile((supports[ia][:, :2]-ridge_origin) @ axis, [.02, .98])
            qb = np.quantile((supports[ib][:, :2]-ridge_origin) @ axis, [.02, .98])
            start, end = max(qa[0], qb[0]), min(qa[1], qb[1])
            if end-start < 3:
                continue
            endpoints = np.array([ridge_origin+t*axis for t in [start, end]])
            heights = np.c_[endpoints, np.ones(2)] @ a
            ground_heights = np.c_[endpoints, np.ones(2)] @ groundfit
            if np.min(heights-ground_heights) < 2 or np.max(heights-ground_heights) > 14:
                continue
            ridge_candidates.append(dict(
                planeIds=[planes[ia]['id'], planes[ib]['id']],
                status='candidate convex gable ridge from opposing sampled planes; assembly and endpoints require image review',
                endpointsEpsg3006=np.round(endpoints+centre, 3).tolist(),
                endpointsBlenderXY=np.round(endpoints+centre-BLENDER_ORIGIN, 3).tolist(),
                endpointsLocalXZ=[local_xz(p) for p in endpoints+centre],
                heightsRH2000=np.round(heights, 3).tolist(),
                heightAboveNearbyGroundMetres=np.round(heights-ground_heights, 3).tolist(),
                supportedLengthMetres=round(float(end-start), 2),
                gridBearingDegrees=round(math.degrees(math.atan2(axis[0], axis[1])) % 180, 2),
                uncertainty='Typically allow at least 0.3 m vertical and 0.5-1 m horizontal before independent image/field validation; larger where support is sparse or ground slopes.'
            ))
            ax.plot(*endpoints.T, c='black', linewidth=1.5)
    record['candidateGableRidges'] = ridge_candidates
    reviewed_assemblies = {'roof-clubhouse-main', 'roof-clubhouse-west-wing', 'roof-range-l-building',
                          'roof-range-south-building', 'roof-maintenance-long', 'roof-maintenance-hall'}
    if identifier not in reviewed_assemblies:
        record['candidateGableRidges'] = []
        record['roofEvidenceStatus'] = 'unresolved-roof-assembly-planar-support-only' if planes else 'no-defensible-planar-roof-support'
        record['limitations'].append('Ridge interpretation suppressed: sparse or mixed support, possible nearby roof/canopy overlap, or roof assembly not independently resolved.')
    if identifier in {'roof-clubhouse-west-lower', 'roof-clubhouse-connector'}:
        record['limitations'].append('This aerial query overlaps the measured high main-roof slope because of apparent aerial roof displacement. The high slope is not a separate measured lower roof.')
    outline = np.array(ring+[ring[0]])-centre
    ax.plot(*outline.T, color='red', linewidth=1, label='query source outline')
    ax.set(title=f"{identifier}: ground {groundfit[2]:.2f} m RH2000", xlabel='Relative easting m', ylabel='Relative northing m', aspect='equal')
    ax.legend(fontsize=7)
    section.set(title='Measured planar supports (east-west section)', xlabel='Relative easting m', ylabel='RH2000 height m')
    results.append(record)
    print(f"Measured {identifier}: {len(planes)} planar supports, nearby ground {groundfit[2]:.2f} m RH2000", flush=True)
fig.tight_layout()
fig.savefig(CACHE / 'roof-plane-review.png', dpi=120)
plt.close(fig)

clubhouse = next((r for r in results if r['id'] in ('trace-clubhouse-main', 'roof-clubhouse-main')), results[0])
vertical_origin = float(round(clubhouse['nearbyGround']['heightAtOriginRH2000']))
report = dict(
    schemaVersion=1, groundId='puttom', measuredOn='2026-09-10', source=acquisition,
    inventoryPath=str(inventory_path.relative_to(ROOT)) if inventory else 'puttombuild/sat-traces.json',
    inventorySha256=hashlib.sha256(inventory_raw).hexdigest() if inventory_raw else None,
    blenderFrame=dict(originEpsg3006=BLENDER_ORIGIN.tolist(), originHeightRH2000=vertical_origin,
                      axes='X=easting-originE; Y=northing-originN; Z=RH2000-originHeight', units='metres'),
    method=dict(algorithm='Deterministic RANSAC and least-squares refinement, up to four elevated planar subsets per envelope.',
                inlierVerticalResidualMetres=.12, iterationsPerPlane=1600,
                selection='First-return LAS class 1, 1.5-14 m above robust surrounding class-2 ground plane.',
                spatialSupport='Largest 1.8 m connected component whose points have at least three neighbours; minimum 0.6 returns per square metre of convex hull. Removes isolated coplanar outliers before hull/plane refitting.',
                ridgeGate='Opposing gradients, convex gable ordering, sampled support on both sides and overlapping longitudinal extent. All ridges remain unverified assembly candidates.',
                publication='Raw returns, point-review images and derived point subsets remain in ignored cache; aggregate geometry and provenance are publishable.'),
    facilities=results,
    limitations=['The active northern laser campaign is June 2023. It does not establish present-day construction.',
                 'No class-6 building labels occur in this window. Roof interpretation is evidence-based inference from planar unclassified returns and imagery.',
                 'All outlines and plane extents are modelling references, not a building survey.',
                 'Door/window layouts, materials, terrace thresholds and building use require photographic or field evidence.',
                 'Never infer roof heights from the ground-only terrain, nor shift measured laser planes to match relief-displaced aerial roofs.'],
)
(HERE / 'height-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

# Small, useful cloud for Blender review; remains a private source derivative.
unique = np.unique(np.vstack(all_plane_points), axis=0) if all_plane_points else np.empty((0, 7))
with (CACHE / 'roof-support-points.ply').open('w', encoding='ascii') as stream:
    stream.write(f'ply\nformat ascii 1.0\ncomment Puttom 2023 laser planar supports; not final roofs\nelement vertex {len(unique)}\nproperty float x\nproperty float y\nproperty float z\nend_header\n')
    for e,n,h,*_ in unique:
        stream.write(f'{e-BLENDER_ORIGIN[0]:.3f} {n-BLENDER_ORIGIN[1]:.3f} {h-vertical_origin:.3f}\n')

fig, ax = plt.subplots(figsize=(13, 11))
ground_view = cloud[cloud[:, 3] == 2][::12]
ax.scatter(ground_view[:, 0]-BLENDER_ORIGIN[0], ground_view[:, 1]-BLENDER_ORIGIN[1], s=.6, c='lightgray', label='classified ground (subsampled)')
if len(unique):
    scatter = ax.scatter(unique[:, 0]-BLENDER_ORIGIN[0], unique[:, 1]-BLENDER_ORIGIN[1], s=3, c=unique[:, 2], cmap='viridis')
    fig.colorbar(scatter, ax=ax, label='Planar elevated returns: RH2000 m')
for r in results:
    e,n = r['originBlenderXY']
    ax.text(e, n, r['id'].replace('trace-', ''), fontsize=6)
ax.set(aspect='equal', xlabel='Blender X / grid east m', ylabel='Blender Y / grid north m', title='Puttom facility height evidence — June 2023 airborne laser')
ax.legend(loc='lower right')
fig.tight_layout()
fig.savefig(CACHE / 'height-overview.png', dpi=150)
plt.close(fig)

# Show the actual source returns over the aerial panel, without translating
# either dataset to conceal roof relief displacement or date differences.
ortho_path = HERE / 'orthophoto-reference.json'
if ortho_path.exists():
    ortho = json.loads(ortho_path.read_text(encoding='utf-8'))
    panel = next(p for p in ortho['panels'] if p['id'] == 'clubhouse-courtyard')
    pixels = plt.imread(ROOT / panel['png'])
    min_e, _, _, max_n = panel['boundsEpsg3006']
    spacing = panel['pixelSizeMetres']
    roof_window = cloud[(cloud[:, 0] > 697335) & (cloud[:, 0] < 697387) & (cloud[:, 1] > 7025160) & (cloud[:, 1] < 7025223) & (cloud[:, 3] == 1) & (cloud[:, 2] > 44.5) & (cloud[:, 2] < 55)]
    fig, axes = plt.subplots(1, 2, figsize=(14, 10))
    for ax in axes:
        ax.imshow(pixels)
        ax.set(xlim=(80, 470), ylim=(530, 60), xlabel='Native pixel u', ylabel='Native pixel v')
    scatter = axes[1].scatter((roof_window[:, 0]-min_e)/spacing, (max_n-roof_window[:, 1])/spacing,
                             c=roof_window[:, 2], s=5, cmap='turbo', vmin=44.5, vmax=54)
    fig.colorbar(scatter, ax=axes[1], label='Unclassified 2023 returns: RH2000 m', fraction=.025)
    for ridge in clubhouse['candidateGableRidges']:
        pts = np.array(ridge['endpointsEpsg3006'])
        axes[1].plot((pts[:, 0]-min_e)/spacing, (max_n-pts[:, 1])/spacing, c='white', linewidth=2)
    axes[0].set_title('2024 orthophoto — unshifted source pixels')
    axes[1].set_title('2023 measured returns + candidate ridge — no alignment shift')
    fig.tight_layout()
    fig.savefig(CACHE / 'clubhouse-ortho-laser-review.png', dpi=140)
    plt.close(fig)

lines = [
    '# Puttom facility height reference', '',
    'Measured 2026-09-10 from Lantmäteriet Laserdata Nedladdning, skog, item `23f028-702_69`. The campaign is June 2023 (STAC nominal date June 4; capture interval June 1–7; nearby scan metadata says June 7). All facilities are north of the N=7025000 campaign seam. The June 2026 southern campaign does not cover these buildings.', '',
    f"The focused 370 × 300 m window contains {len(cloud):,} returns, including {acquisition['statistics']['byClass'].get('2',0):,} classified ground and {acquisition['statistics']['byClass'].get('1',0):,} unclassified returns. There are no class-6 building labels. Plane support is inferred roof evidence, not automatic building classification.", '',
    '[Source COPC]('+acquisition['sourceUrl']+') · [Licence and attribution]('+acquisition['termsUrl']+')', '',
    '## What the measurements mean', '',
    'The table gives surrounding ground height, measured planar-support height range, and candidate gable-ridge heights. Plane height percentiles are sampled roof-surface evidence, not surveyed eave elevations. Ground planes are not finished floor or entrance thresholds. Ridge candidates pass opposing-slope and shared-support checks but must be associated with the correct roof assembly in photographs.', '',
    '| Facility ID | Nearby ground RH2000 m | Planes / support returns | Plane support p05–p95 RH2000 m | Candidate ridge RH2000 m |',
    '|---|---:|---:|---:|---:|',
]
for r in results:
    planes = r['planes']
    lows = [p['supportHeightQuantilesRH2000']['p05'] for p in planes]
    highs = [p['supportHeightQuantilesRH2000']['p95'] for p in planes]
    envelope = f'{min(lows):.2f}–{max(highs):.2f}' if planes else 'unresolved'
    ridges = ', '.join(f"{np.mean(p['heightsRH2000']):.2f}" for p in r['candidateGableRidges']) or 'unresolved'
    lines.append(f"| {r['id']} | {r['nearbyGround']['heightAtOriginRH2000']:.2f} | {len(planes)} / {sum(p['supportCount'] for p in planes)} | {envelope} | {ridges} |")
lines += ['', 'Unresolved assemblies have their ridge interpretation suppressed. Lower-west/connector search areas overlap the main roof because the aerial roof appears displaced; do not treat those duplicated high planes as lower roofs. The 2023 laser and 2024 ortho remain in their original coordinates. The clubhouse overlay makes the displacement visible.', '', '## Blender coordinates', '',
          f'Use metres, X east and Y north. Subtract E=697365 and N=7025190 from EPSG:3006 coordinates, and subtract {vertical_origin:.0f} m from RH2000 elevations. This height origin is the rounded ground near the clubhouse; it changes only the local coordinate offset, not measured elevations.', '',
          '`height-reference.json` contains the complete source lineage, per-plane coefficients, measured support hulls, hull heights, candidate ridges, ground planes and Blender XY coordinates. `laser/roof-support-points.ply` uses the same origin. These are reference surfaces; no final facade/wall geometry is claimed.', '',
          '## Limits and follow-up', '',
          '- The source predates the 2024 orthophoto and current website imagery; check any new structures or roof alterations.',
          '- Roof query envelopes may be relief-displaced or inherited approximate traces. Buffers can include neighbouring roofs or tree returns. Individual planar subsets can therefore be duplicated across adjacent building queries.',
          '- Support hulls are sampled inner extents, not wall footprints or exact roof overhangs. Use photographs to identify roof type and assembly.',
          '- Internal plane residuals do not represent absolute survey accuracy. Allow at least roughly 0.3 m vertically and 0.5–1 m horizontally until independently checked; sparse returns, sloping ground or wrong assembly can increase uncertainty.',
          '- Windows, doors, posts, stairs, terrace heights, roof materials, service equipment and building ownership/use remain photographic or field questions.',
          '- The application’s bare-earth terrain does not contain roof height. These measurements use separate nonground laser returns.', '',
          '## Reproduce and review', '',
          '1. `node --env-file=.env puttombuild/facilities/acquire-facilities-laser.mjs`',
          '2. Run `puttombuild/facilities/prepare-height-reference.py` with NumPy, Shapely, pyproj and Matplotlib.',
          '3. Review `puttombuild/cache/facilities-reference-2026-09-10/laser/roof-plane-review.png` and `height-overview.png` against the ortho/photo reference panels.', '',
          'Raw points, derived point subsets and review rasters stay in the ignored local cache. Acquired point bytes are SHA-256 checked before fitting. The catalogue checksum for the 1.06 GB source is pinned; bounded range acquisition does not verify that entire source checksum.', '',
          acquisition['attribution'], '']
(HERE / 'height-reference.md').write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps(dict(facilities=len(results), planeCount=sum(len(r['planes']) for r in results), uniqueRoofSupportPoints=len(unique), blenderOriginHeightRH2000=vertical_origin)))
for r in results:
    print(r['id'], json.dumps(dict(ground=r['nearbyGround']['heightAtOriginRH2000'], planes=[(p['supportCount'],p['slopeDegrees']) for p in r['planes']], ridgeRH2000=[p['heightsRH2000'] for p in r['candidateGableRidges']])))
