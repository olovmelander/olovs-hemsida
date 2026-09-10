"""Reproducible 2021 laser roof/ground reference for Angso; no Blender/runtime edits.

Run with geobuild/cache/ortho-venv/Scripts/python.exe after the COPC acquisition.
Observed orthophoto roof envelopes take precedence as search areas; inherited
OSM polygons remain a fallback. Neither changes the measured return positions.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import MultiPoint, Polygon
from shapely import contains_xy
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = ROOT / 'angsobuild/cache/facilities-2026-09-10/laser'
BLENDER_ORIGIN = np.array([605530., 6605140.])
acquisition = json.loads((CACHE / 'acquisition.json').read_text(encoding='utf-8'))
raw = (CACHE / 'points.json').read_bytes()
assert hashlib.sha256(raw).hexdigest() == acquisition['localPointsSha256']
cloud = np.array(json.loads(raw)['points'], dtype=np.float64)
model_raw = (ROOT / 'angsobuild/course-model.json').read_bytes()
model = json.loads(model_raw)
project = Transformer.from_crs(4326, 3006, always_xy=True)
inverse = Transformer.from_crs(3006, 4326, always_xy=True)
ortho_path = HERE / 'orthophoto-reference.json'
ortho_raw = ortho_path.read_bytes() if ortho_path.exists() else None
ortho = json.loads(ortho_raw) if ortho_raw else {}


def local_xz(en):
    lon, lat = inverse.transform(*en)
    return [round((lon-model['origin']['lon'])*model['mPerLon'], 4),
            round((model['origin']['lat']-lat)*model['mPerLat'], 4)]


def quantiles(values):
    return dict(zip(['p05', 'p50', 'p95'], np.round(np.quantile(values, [.05, .5, .95]), 3).tolist())) if len(values) else None


def in_acquisition(en):
    return any(w['bbox'][0] < en[0] < w['bbox'][2] and w['bbox'][1] < en[1] < w['bbox'][3]
               for w in acquisition['windows'])


facilities = []
excluded_envelopes = []
for f in ortho.get('outlines', []):
    if not f.get('ringEPSG3006'):
        continue
    kind = f.get('kind', '').lower()
    if not any(word in kind for word in ('roof', 'building', 'shelter', 'structure', 'canopy')):
        continue
    poly = Polygon(f['ringEPSG3006'])
    if not poly.is_valid or poly.area < 4:
        continue
    if not in_acquisition(poly.centroid.coords[0]):
        excluded_envelopes.append(dict(id=f['id'], name=f.get('label'), reason='Outside bounded laser acquisition; no height evidence claimed.'))
        continue
    facilities.append(dict(id=f['id'], name=f.get('label'), ring=f['ringEPSG3006'],
                           geometryStatus=f.get('geometryStatus'), geometrySource='orthophoto-observation', buffer=3.0))
used_ortho = bool(facilities)
if not facilities:
    ids = {'w516709521', 'w516709522', 'w516709523', 'w516709524', 'w516709525', 'w517780252'}
    for f in model['infra']['buildings']:
        if f['id'] not in ids:
            continue
        ring = [project.transform(model['origin']['lon']+x/model['mPerLon'],
                                  model['origin']['lat']-z/model['mPerLat']) for x, z in f['ring']]
        facilities.append(dict(id=f['id'], name=f.get('name'), ring=ring,
                               geometryStatus='inherited-osm-footprint-not-surveyed', geometrySource='legacy-osm', buffer=6.0))
if not facilities:
    raise RuntimeError('No source roof envelopes in laser acquisition windows')


def fit_plane(xyz, rng, threshold=.16, trials=1200):
    if len(xyz) < 12:
        return None
    A = np.c_[xyz[:, :2], np.ones(len(xyz))]
    best, score = None, 0
    for _ in range(trials):
        ix = rng.choice(len(xyz), 3, replace=False)
        if abs(np.linalg.det(A[ix])) < .4:
            continue
        coef = np.linalg.solve(A[ix], xyz[ix, 2])
        if np.linalg.norm(coef[:2]) > 1.74:
            continue
        mask = abs(A @ coef-xyz[:, 2]) < threshold
        if mask.sum() > score:
            best, score = mask, mask.sum()
    if best is None or score < 12:
        return None
    for _ in range(4):
        coef = np.linalg.lstsq(A[best], xyz[best, 2], rcond=None)[0]
        best = abs(A @ coef-xyz[:, 2]) < threshold
        if best.sum() < 12:
            return None
    return coef, best


def connected_support(xyz, distance=2.5):
    # Forestry sampling is sparse; keep connected planar support while refusing
    # isolated coplanar outliers. Final hull/planes still require image review.
    d2 = np.sum((xyz[:, None, :2]-xyz[None, :, :2])**2, axis=2)
    adjacent = d2 <= distance**2
    dense = adjacent.sum(axis=1) >= 3
    seen, best = ~dense.copy(), []
    for index in np.where(dense)[0]:
        if seen[index]:
            continue
        seen[index] = True
        todo, component = [int(index)], []
        while todo:
            current = todo.pop()
            component.append(current)
            neighbours = np.where(adjacent[current] & ~seen)[0]
            seen[neighbours] = True
            todo.extend(neighbours.tolist())
        if len(component) > len(best):
            best = component
    return np.array(best, dtype=int)


results, all_plane_points = [], []
fig, axs = plt.subplots(len(facilities), 2, figsize=(14, 4.2*len(facilities)), squeeze=False)
for row, facility in enumerate(facilities):
    identifier = facility['id']
    poly = Polygon(facility['ring'])
    centre = np.array(poly.centroid.coords[0])
    buffer = facility['buffer']
    query = poly.buffer(buffer)
    window = poly.buffer(buffer+7).bounds
    nearby = cloud[(cloud[:, 0] > window[0]) & (cloud[:, 0] < window[2]) &
                   (cloud[:, 1] > window[1]) & (cloud[:, 1] < window[3])]
    ground = nearby[nearby[:, 3] == 2]
    record = dict(id=identifier, name=facility.get('name'), sourceGeometry=facility['geometrySource'],
                  geometryStatus=facility['geometryStatus'], queryEnvelopeEpsg3006=facility['ring'], queryBufferMetres=buffer,
                  sourceGeometryWarning='Search envelope is not a surveyed wall/eave boundary and can include adjacent structures or vegetation.',
                  planeEquation='RH2000 height = a*(E-originE)+b*(N-originN)+c',
                  originEpsg3006=np.round(centre, 4).tolist(), originLocalXZ=local_xz(centre),
                  originBlenderXY=np.round(centre-BLENDER_ORIGIN, 4).tolist(), planes=[], candidateGableRidges=[])
    ax, section = axs[row]
    outline = np.array(facility['ring']+[facility['ring'][0]])-centre
    ax.plot(*outline.T, color='red', linewidth=1, label='source query outline')
    if len(ground) < 20:
        record.update(roofEvidenceStatus='insufficient-nearby-ground-support', nearbyGround={'classifiedGroundPointCount': len(ground)})
        results.append(record)
        continue
    G = np.c_[ground[:, :2]-centre, np.ones(len(ground))]
    groundfit = np.linalg.lstsq(G, ground[:, 2], rcond=None)[0]
    groundmask = np.ones(len(ground), dtype=bool)
    for _ in range(4):
        residual = ground[:, 2]-G @ groundfit
        groundmask = abs(residual) <= max(.3, float(np.quantile(abs(residual), .8)))
        groundfit = np.linalg.lstsq(G[groundmask], ground[groundmask, 2], rcond=None)[0]
    grounderror = ground[groundmask, 2]-G[groundmask] @ groundfit
    hag = nearby[:, 2]-np.c_[nearby[:, :2]-centre, np.ones(len(nearby))] @ groundfit
    select = contains_xy(query, nearby[:, 0], nearby[:, 1])
    candidate = nearby[select & (nearby[:, 3] == 1) & (hag > 1.5) & (hag < 14) & (nearby[:, 4] == 1)]
    xyz = candidate[:, :3].copy()
    xyz[:, :2] -= centre
    used = np.zeros(len(xyz), dtype=bool)
    rng = np.random.default_rng(int(hashlib.sha256(identifier.encode()).hexdigest()[:8], 16))
    coefficients, supports, planes = [], [], []
    ax.scatter(nearby[:, 0]-centre[0], nearby[:, 1]-centre[1], s=2, color='lightgray')
    for _ in range(4):
        fitted = fit_plane(xyz[~used], rng)
        if fitted is None:
            break
        coef, mask = fitted
        ix = np.where(~used)[0][mask]
        used[ix] = True
        ix = ix[connected_support(xyz[ix])]
        support = xyz[ix]
        if len(support) < max(12, len(xyz)*.025):
            continue
        design = np.c_[support[:, :2], np.ones(len(support))]
        coef = np.linalg.lstsq(design, support[:, 2], rcond=None)[0]
        residual = design @ coef-support[:, 2]
        hull = MultiPoint(support[:, :2]).convex_hull
        if hull.geom_type != 'Polygon' or hull.area < 4 or len(support)/hull.area < .35:
            continue
        hull_relative = np.array(hull.exterior.coords)[:-1]
        hull_en = hull_relative+centre
        hull_z = np.c_[hull_relative, np.ones(len(hull_relative))] @ coef
        support_hag = support[:, 2]-np.c_[support[:, :2], np.ones(len(support))] @ groundfit
        planes.append(dict(
            id=f'{identifier}-plane-{len(planes)+1}', interpretation='elevated planar returns, roof identity requires image review',
            supportCount=len(support), supportHullAreaSquareMetres=round(hull.area, 2),
            supportPointDensityPerSquareMetre=round(len(support)/hull.area, 3), coefficientsLocalEN=np.round(coef, 7).tolist(),
            supportInsideSourceEnvelopeFraction=round(float(np.mean(contains_xy(poly, support[:, 0]+centre[0], support[:, 1]+centre[1]))), 3),
            slopeDegrees=round(math.degrees(math.atan(np.linalg.norm(coef[:2]))), 2),
            residualRmseMetres=round(float(np.sqrt(np.mean(residual**2))), 3),
            residualP95AbsoluteMetres=round(float(np.quantile(abs(residual), .95)), 3),
            supportHeightQuantilesRH2000=quantiles(support[:, 2]), heightAboveNearbyGroundQuantilesMetres=quantiles(support_hag),
            supportHullEpsg3006=np.round(hull_en, 3).tolist(), supportHullLocalXZ=[local_xz(p) for p in hull_en],
            supportHullBlenderXY=np.round(hull_en-BLENDER_ORIGIN, 3).tolist(), supportHullHeightsRH2000=np.round(hull_z, 3).tolist()))
        coefficients.append(coef)
        supports.append(support)
        all_plane_points.append(candidate[ix])
        ax.scatter(support[:, 0], support[:, 1], s=8, label=f'plane {len(planes)}: {len(support)}')
        section.scatter(support[:, 0], support[:, 2], s=8, label=f'plane {len(planes)}')
    record.update(allCandidateElevatedReturns=len(candidate), planes=planes,
                  nearbyGround=dict(classifiedGroundPointCount=len(ground), fittedSupportCount=int(groundmask.sum()),
                                    heightAtOriginRH2000=round(float(groundfit[2]), 3), coefficientsLocalEN=np.round(groundfit, 7).tolist(),
                                    heightQuantilesRH2000=quantiles(ground[:, 2]),
                                    fittedSlopeDegrees=round(math.degrees(math.atan(np.linalg.norm(groundfit[:2]))), 2),
                                    residualP95AbsoluteMetres=round(float(np.quantile(abs(grounderror), .95)), 3),
                                    meaning='Surrounding classified ground plane, not entrance threshold or floor elevation.'),
                  roofEvidenceStatus='planar-subsets-require-image-review' if planes else 'no-defensible-planar-roof-support',
                  limitations=['Support hulls are inner sampled envelopes, not surveyed walls or eaves.',
                               'Class 1 returns are unclassified and can include vegetation or adjacent roofs.',
                               'Plane scatter measures internal agreement, not total absolute survey accuracy.',
                               '2021 laser can predate roofs visible in the newer orthophoto/photos.',
                               'Buffered adjacent envelopes can share the same returns. These are candidate studies, not separate established roof components.'])
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
            qa = np.quantile((supports[ia][:, :2]-ridge_origin) @ axis, [.02, .98])
            qb = np.quantile((supports[ib][:, :2]-ridge_origin) @ axis, [.02, .98])
            start, end = max(qa[0], qb[0]), min(qa[1], qb[1])
            if end-start < 3:
                continue
            endpoints = np.array([ridge_origin+t*axis for t in [start, end]])
            heights = np.c_[endpoints, np.ones(2)] @ a
            relative = heights-np.c_[endpoints, np.ones(2)] @ groundfit
            if np.min(relative) < 2 or np.max(relative) > 14:
                continue
            record['candidateGableRidges'].append(dict(
                planeIds=[planes[ia]['id'], planes[ib]['id']],
                status='candidate convex gable intersection; unverified roof assembly and endpoints',
                endpointsEpsg3006=np.round(endpoints+centre, 3).tolist(),
                endpointsBlenderXY=np.round(endpoints+centre-BLENDER_ORIGIN, 3).tolist(),
                endpointsLocalXZ=[local_xz(p) for p in endpoints+centre], heightsRH2000=np.round(heights, 3).tolist(),
                heightAboveNearbyGroundMetres=np.round(relative, 3).tolist(), supportedLengthMetres=round(float(end-start), 2),
                gridBearingDegrees=round(math.degrees(math.atan2(axis[0], axis[1])) % 180, 2),
                uncertainty='Allow at least 0.3 m vertical and 0.5-1 m horizontal until independent validation; sparse/changed roofs can have substantially larger error.'))
            ax.plot(*endpoints.T, c='black', linewidth=1.5)
    ax.set(title=f'{identifier}: ground {groundfit[2]:.2f} m RH2000', xlabel='Relative easting m', ylabel='Relative northing m', aspect='equal')
    ax.legend(fontsize=7)
    section.set(title='Elevated planar supports (east-west section)', xlabel='Relative easting m', ylabel='RH2000 height m')
    results.append(record)
    print(f'{identifier}: {len(planes)} planes, {len(record["candidateGableRidges"])} ridge candidates, ground {groundfit[2]:.2f} m RH2000', flush=True)
fig.tight_layout()
fig.savefig(CACHE / 'roof-plane-review.png', dpi=120)
from matplotlib.transforms import Bbox
renderer = fig.canvas.get_renderer()
for row, facility in enumerate(facilities):
    bounds = Bbox.union([ax.get_tightbbox(renderer) for ax in axs[row]]).transformed(fig.dpi_scale_trans.inverted())
    fig.savefig(CACHE / f'roof-plane-{facility["id"]}.png', dpi=140, bbox_inches=bounds.expanded(1.04, 1.06))
plt.close(fig)
vertical_origin = 8.0  # Explicit shared Blender frame; stays fixed across envelope refinements.
report = dict(schemaVersion=1, groundId='angso', measuredOn='2026-09-10', source=acquisition,
              inventoryPath='angsobuild/facilities/orthophoto-reference.json' if used_ortho else 'angsobuild/course-model.json',
              inventorySha256=hashlib.sha256(ortho_raw if used_ortho else model_raw).hexdigest(),
              blenderFrame=dict(originEpsg3006=BLENDER_ORIGIN.tolist(), originHeightRH2000=vertical_origin,
                                axes='X=easting-originE; Y=northing-originN; Z=RH2000-originHeight', units='metres'),
              method=dict(algorithm='Deterministic RANSAC and least-squares refinement, up to four elevated planes per query envelope.',
                          inlierVerticalResidualMetres=.16, iterationsPerPlane=1200,
                          selection='First-return LAS class 1, 1.5-14 m above robust surrounding class-2 ground plane.',
                          spatialSupport='Largest 2.5 m connected component, at least two neighbours per retained point, at least 12 returns and 0.35 returns per square metre of support hull.',
                          ridgeGate='Opposing slopes, convex gable ordering and sampled support on both sides with overlapping longitudinal extent. Candidates remain unverified.',
                          publication='Raw points, plots and point subsets stay in ignored cache; aggregate evidence/provenance only in the reference JSON.'),
              facilities=results, excludedEnvelopes=excluded_envelopes,
              roofSupport=[dict(id=p['id'], facilityId=r['id'], evidenceStatus='2021-planar-support-candidate-requires-image-review',
                                supportCount=p['supportCount'], residualRmseMetres=p['residualRmseMetres'],
                                supportInsideSourceEnvelopeFraction=p['supportInsideSourceEnvelopeFraction'],
                                verticesEPSG3006Rh2000=[[en[0], en[1], h] for en, h in zip(p['supportHullEpsg3006'], p['supportHullHeightsRH2000'])])
                           for r in results for p in r['planes']],
              limitations=['Laser capture interval is March 8-April 1 2021, not the 2026 publication date.',
                           'No class-6 building labels occur in these windows; roof interpretation requires images.',
                           'These are modelling references, not an architectural or building survey.',
                           'Newer roofs, eaves, walls, doors, windows, use, materials and terrace thresholds need current photographic evidence.',
                           'Do not shift measured laser planes to match relief-displaced aerial roofs or infer roof height from bare-earth DTM.'])
(HERE / 'height-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
unique = np.unique(np.vstack(all_plane_points), axis=0) if all_plane_points else np.empty((0, 7))
with (CACHE / 'roof-support-points.ply').open('w', encoding='ascii') as stream:
    stream.write(f'ply\nformat ascii 1.0\ncomment Angso 2021 laser planar supports; not final roofs\nelement vertex {len(unique)}\nproperty float x\nproperty float y\nproperty float z\nend_header\n')
    for e, n, z, *_ in unique:
        stream.write(f'{e-BLENDER_ORIGIN[0]:.3f} {n-BLENDER_ORIGIN[1]:.3f} {z-vertical_origin:.3f}\n')
lines = ['# Angso facilities: 2021 laser height evidence', '',
         f'{len(cloud):,} classified returns acquired in two bounded windows; {len(unique):,} unique returns retained in planar supports.', '',
         'Source capture interval: 2021-03-08 to 2021-04-01. LAS class 1 is unclassified, not a building label. Roof assemblies require visual review against the newer imagery.', '',
         '| Reference ID | Nearby ground RH2000 | Planes | Candidate gable ridge RH2000 |', '| --- | ---: | ---: | --- |']
for r in results:
    ground = r.get('nearbyGround', {}).get('heightAtOriginRH2000')
    ridge = '; '.join(f'{min(c["heightsRH2000"]):.2f}–{max(c["heightsRH2000"]):.2f} m' for c in r['candidateGableRidges']) or 'unresolved'
    lines.append(f'| {r["id"]} | {ground if ground is not None else "unresolved"} m | {len(r["planes"])} | {ridge} |')
lines += ['', 'Detailed plane coefficients, support hulls, point counts, residuals, ground estimates, candidate ridge coordinates and caveats are in `height-reference.json`.', '',
          f'Blender point-cloud frame: E0=605530, N0=6605140, H0={vertical_origin} m RH2000; X east, Y grid north, Z up. The `.ply` uses this same origin. If the modelling workspace chooses a different H0, apply the explicit vertical difference.', '',
          'Raw source points, `roof-support-points.ply`, and `roof-plane-review.png` are in `angsobuild/cache/facilities-2026-09-10/laser/`.', '',
          'Ground fits are surrounding terrain planes, not finished-floor levels. Planar hulls are sampled inner envelopes, not surveyed eaves or walls. Internal fit residuals are not total survey accuracy. Small sparse roofs can remain unresolved. Adjacent buffered queries can share returns; these plane studies are not separate established roof components.', '',
          'Outside the laser windows: '+', '.join(r['id'] for r in excluded_envelopes)+'. No height evidence is claimed for these neighbouring structures.' if excluded_envelopes else 'All selected source roof envelopes are covered by the laser windows.', '',
          f'Attribution: {acquisition["attribution"]}. [Source COPC]({acquisition["sourceUrl"]}). [Terms]({acquisition["termsUrl"]}).', '']
(HERE / 'height-reference.md').write_text('\n'.join(lines), encoding='utf-8')
print(f'Wrote height-reference.json/.md; Blender vertical origin {vertical_origin} m RH2000; {len(unique)} planar-support points', flush=True)
