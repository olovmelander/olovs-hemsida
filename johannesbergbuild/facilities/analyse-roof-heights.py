"""Source-pinned roof-candidate evidence, with no automatic course edits.

Run using the existing ignored review Python environment. Raw points, profiles,
and plots stay private. Class 1 is unclassified, never a building guarantee.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely import contains_xy
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
SERVICE_HALL_ONLY = '--service-hall' in sys.argv
CACHE = ROOT / 'johannesbergbuild/cache/facilities-reference/laser'
if SERVICE_HALL_ONLY:
    CACHE /= 'service-hall'
OUT = Path(__file__).with_name('roof-height-service-hall-evidence.json' if SERVICE_HALL_ONLY else 'roof-height-evidence.json')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def pin(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path), 'bytes': path.stat().st_size}

def stats(values):
    if not len(values):
        return None
    return {key: round(float(v), 3) for key, v in zip(['min', 'p05', 'p25', 'median', 'p75', 'p95', 'max'], np.quantile(values, [0, .05, .25, .5, .75, .95, 1]))}

window = json.loads((CACHE / 'window.json').read_text(encoding='utf-8'))
for item in window['files']:
    assert digest(ROOT / item['path']) == item['sha256']
e = np.fromfile(CACHE / 'easting.f64', '<f8')
n = np.fromfile(CACHE / 'northing.f64', '<f8')
h = np.fromfile(CACHE / 'height-rh2000.f32', '<f4').astype(float)
cl = np.fromfile(CACHE / 'classification.u8', 'u1')
lon, lat = Transformer.from_crs(3006, 4326, always_xy=True).transform(e, n)
x = (lon - 18.19202) * 56118.16
z = (59.72733 - lat) * 111320
buildings = window['buildings']
FACILITY_IDS = {
    'w296165896': 'johannesberg-clubhouse',
    'w296165891': 'johannesberg-manor',
    'w296165894': 'johannesberg-east-wing',
    'w296165901': 'johannesberg-west-wing',
    'w296165899': 'johannesberg-karolinerhuset',
    'w296165893': 'johannesberg-east-slottsvilla',
    'w296165898': 'johannesberg-west-slottsvilla',
    'w296165904': 'johannesberg-johannesbergsvillan',
    'w296165905': 'johannesberg-johannesbergsflygeln',
    'w296165892': 'johannesberg-old-stable',
    'w296165897': 'johannesberg-clubhouse-shed',
    'w378922988': 'johannesberg-range-hut',
    'trace-range-shelter': 'johannesberg-range-shelter',
}
all_polygons = [Polygon(b['ringEpsg3006']) for b in buildings]
on_building = np.zeros(len(e), dtype=bool)
near_building = np.zeros(len(e), dtype=bool)
near_ground = np.zeros(len(e), dtype=bool)
for poly in all_polygons:
    on_building |= contains_xy(poly.buffer(1), e, n)
    near_building |= contains_xy(poly.buffer(2), e, n)
    near_ground |= contains_xy(poly.buffer(12), e, n)

# A separate compact Blender reference cloud, no invented surfaces. Include
# unclassified returns within a 2 m footprint buffer and actual class-2 ground
# within 12 m; omit all class-7 noise. Deterministic stride only if over 50k.
display_indices = np.flatnonzero((near_building & (cl == 1)) | (near_ground & (cl == 2)))
display_source_count = len(display_indices)
display_stride = max(1, int(np.ceil(display_source_count/50000)))
display_indices = display_indices[::display_stride]
display_path = CACHE / 'blender-facility-reference-points.json'
display_payload = {
    'schemaVersion': 1, 'groundId': 'johannesberg', 'captureDate': '2021-04-17',
    'horizontalCrs': 'EPSG:3006', 'verticalCrs': 'EPSG:5613',
    'columns': ['eastingM', 'northingM', 'heightRh2000M', 'classification'],
    'count': len(display_indices), 'sourceSelectionCount': display_source_count,
    'thinningStride': display_stride,
    'selection': 'Class 1 within 2 m of inherited building footprints; class 2 within 12 m. Class 1 does not identify a roof.',
    'points': [[round(float(e[i]), 3), round(float(n[i]), 3), round(float(h[i]), 3), int(cl[i])] for i in display_indices]
}
display_path.write_text(json.dumps(display_payload, separators=(',', ':')) + '\n')

def dominant_planes(xyz, maximum=3):
    """A descriptive planar-support statistic; never a roof/eave declaration."""
    rng = np.random.default_rng(20260910)
    remaining = np.arange(len(xyz))
    planes = []
    for _ in range(maximum):
        if len(remaining) < 16:
            break
        best = np.zeros(len(remaining), dtype=bool)
        subset = xyz[remaining]
        for __ in range(160):
            tri = subset[rng.choice(len(subset), 3, replace=False)]
            design = np.column_stack([tri[:, :2], np.ones(3)])
            if abs(np.linalg.det(design)) < .1:
                continue
            coef = np.linalg.solve(design, tri[:, 2])
            if np.linalg.norm(coef[:2]) > 1.8:
                continue
            residual = abs(subset[:, 2] - (subset[:, :2] @ coef[:2] + coef[2]))
            support = residual < .25
            if support.sum() > best.sum():
                best = support
        if best.sum() < 16:
            break
        accepted = subset[best]
        coef = np.linalg.lstsq(np.column_stack([accepted[:, :2], np.ones(len(accepted))]), accepted[:, 2], rcond=None)[0]
        residual = accepted[:, 2] - (accepted[:, :2] @ coef[:2] + coef[2])
        planes.append({'points': int(best.sum()), 'fractionOfAllCandidates': round(float(best.sum()/len(xyz)), 3), 'slopeDegrees': round(float(np.degrees(np.arctan(np.linalg.norm(coef[:2])))), 2), 'verticalResidualRmseMetres': round(float(np.sqrt(np.mean(residual**2))), 3), 'heightRH2000': stats(accepted[:, 2]), 'interpretation': 'Planar return support only; roof, terrace, branch and wall assignment requires imagery inspection.'})
        remaining = remaining[~best]
    return planes

reports = []
rows = int(np.ceil(len(buildings) / 3))
fig, axes = plt.subplots(rows, 3, figsize=(15, rows * 3.8), constrained_layout=True, squeeze=False)
for building, poly, ax in zip(buildings, all_polygons, axes.flat):
    centre = poly.centroid
    inside = contains_xy(poly, e, n)
    inset = contains_xy(poly.buffer(-1), e, n)
    around = contains_xy(poly.buffer(12), e, n) & ~contains_xy(poly.buffer(2), e, n)
    ground = around & (cl == 2) & ~on_building
    grounded = h[ground]
    ground_ref = float(np.median(grounded)) if len(grounded) else None
    candidate = inset & (cl == 1) & (h > ground_ref + 1.5) if ground_ref is not None else np.zeros(len(e), bool)
    classes = {str(int(c)): int((cl[inside] == c).sum()) for c in np.unique(cl[inside])}
    xyz = np.column_stack([e[candidate]-centre.x, n[candidate]-centre.y, h[candidate]])
    planes = dominant_planes(xyz)
    coverage_cells = len(set(zip(np.floor(e[candidate]).astype(int), np.floor(n[candidate]).astype(int))))
    csv = CACHE / (building['id'] + '-candidate-points.csv')
    np.savetxt(csv, np.column_stack([x[candidate], z[candidate], h[candidate]]), delimiter=',', header='legacy_x_east_m,legacy_z_south_m,height_RH2000_m', comments='', fmt='%.3f')
    support = sum(p['fractionOfAllCandidates'] for p in planes)
    confident = len(xyz) >= 50 and support >= .65
    report = {
        'facilityId': FACILITY_IDS.get(building['id'], 'johannesberg-building-' + building['id']),
        'sourceBuildingId': building['id'], 'sourceBuildingIndex': building['index'],
        'sourceName': building.get('name'), 'sourceKind': building['kind'],
        'footprintStatus': 'Inherited model footprint used as selection mask; orthophoto roof displacement and overhang may differ from walls.',
        'footprintLegacyMetres': building['ring'], 'footprintEpsg3006': building['ringEpsg3006'],
        'footprintAreaSquareMetres': round(poly.area, 2),
        'insideFootprint': {'points': int(inside.sum()), 'classes': classes, 'heightRH2000': stats(h[inside])},
        'adjacentGround': {'class': 2, 'mask': '2 to 12 m outside footprint, excluding 1 m buffers of all selected buildings', 'points': int(ground.sum()), 'heightRH2000': stats(grounded), 'referenceMedianRH2000': round(ground_ref, 3) if ground_ref is not None else None},
        'roofCandidates': {'class': 1, 'classificationMeaning': 'unclassified; includes roofs and vegetation', 'mask': '1 m inside inherited footprint and >1.5 m above adjacent-ground median', 'points': int(candidate.sum()), 'occupied1mCells': coverage_cells, 'heightRH2000': stats(h[candidate]), 'heightAboveAdjacentGroundMedianMetres': stats(h[candidate] - ground_ref) if ground_ref is not None else None, 'planes': planes, 'privatePoints': pin(csv)},
        'confidence': 'moderate-for-2021-roof-envelope-pending-image-crosscheck' if confident else 'low-unclassified-returns-or-sparse-planar-support',
        'measuredEaveHeightMetres': None, 'measuredRidgeHeightMetres': None,
        'currentBuildingAgreement': 'Requires cross-check against 2025 orthophoto and current dated facade photographs; 2021 capture cannot establish current extensions.',
        'use': 'Constrain historical massing envelope; do not set eaves, ridge, walls or roof shape from a height percentile alone.'
    }
    reports.append(report)
    near = contains_xy(poly.buffer(6), e, n) & (cl != 7)
    # Equal-aspect plan view; surface heights relative to surrounding median.
    xx = e[near] - centre.x
    yy = n[near] - centre.y
    ax.scatter(xx, yy, c=h[near]-ground_ref, cmap='viridis', s=2, vmin=0, vmax=18)
    coords = np.asarray(poly.exterior.coords)
    ax.plot(coords[:,0]-centre.x, coords[:,1]-centre.y, 'r-', linewidth=1)
    ax.set_aspect('equal')
    ax.set_title(f"{building['id']} · {building.get('name') or 'unnamed'}\n{candidate.sum()} candidates; ground {ground_ref:.1f} RH2000", fontsize=9)
    ax.set_xlabel('east from footprint centre (m)', fontsize=7)
    ax.set_ylabel('north (m)', fontsize=7)
    ax.tick_params(labelsize=7)
for ax in list(axes.flat)[len(buildings):]:
    ax.axis('off')

plot = CACHE / 'roof-candidate-plan-views.png'
fig.suptitle('Johannesberg 2021-04-17 laser return evidence\nRed inherited footprint; colour 0–18 m above adjacent-ground median. Roof and vegetation share class 1.', fontsize=15)
fig.savefig(plot, dpi=150)
plt.close(fig)

source = window['source']
evidence = {
    'schemaVersion': 1, 'groundId': 'johannesberg', 'reviewedOn': '2026-09-10',
    'state': 'bounded-laser-height-reference-ready-not-surveyed-building-model',
    'source': source, 'sourceCampaignInventory': window['campaignInventory'],
    'sourceModel': window['sourceModel'], 'sourceMigration': window['migration'],
    'privateWindowEvidence': pin(CACHE / 'window.json'), 'privatePlanViews': pin(plot),
    'privateBlenderPointReference': {**pin(display_path), 'columns': display_payload['columns'], 'captureDate': display_payload['captureDate'], 'horizontalCrs': display_payload['horizontalCrs'], 'verticalCrs': display_payload['verticalCrs'], 'count': display_payload['count'], 'sourceSelectionCount': display_source_count, 'thinningStride': display_stride, 'selection': display_payload['selection'], 'renderPolicy': 'Vertex evidence only, hidden by default; no inferred roof faces. Use explicit scene RH2000 height-origin offset.'},
    'bboxEpsg3006': window['bboxEpsg3006'], 'statistics': window['statistics'], 'transfer': window['transfer'],
    'classification': {'1': 'Unclassified surface: roofs and vegetation not separated', '2': 'Ground', '7': 'Low noise; excluded'},
    'method': {'footprintInsetMetres': 1, 'minimumCandidateHeightAboveGroundMedianMetres': 1.5, 'groundAnnulusMetres': [2,12], 'planeFit': 'Deterministic RANSAC descriptive support, up to three planes, 0.25 m vertical residual threshold, minimum 16 points each; slope capped 61 degrees. No roof-type inference or current-geometry mutation.', 'groundHeight': 'Median of local class-2 annulus; terrain variation reported in quantiles, not fitted away.', 'rawBytes': 'Private ignored cache only', 'currentElevationFrame': 'RH2000 absolute height, not legacy Terrarium world y'},
    'limitations': ['Laser capture 2021-04-17 predates the 2025 orthophoto by four years.', 'No class-6 building label exists in the bounded cloud: all candidates remain class-1 surface returns.', 'Tree branches, roof overhang, footprint misregistration, chimneys and sparse returns can affect quantiles.', 'Adjacent ground is sloping in parts of the estate; a median is not a survey floor level.', 'No measured eave or ridge heights are claimed; use planar support and current facade photos together.', 'No course runtime geometry or height data has been changed.'],
    'officialDocumentation': [
        {'title': 'Laserdata Nedladdning, skog product description', 'url': 'https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/hojddata/pb_laserdata_nedladdning_skog.pdf'},
        {'title': 'Laserdata quality description', 'url': 'https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/hojddata/kvalitetsbeskrivning_laserdata.pdf'}
    ],
    'facilities': reports
}
OUT.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
print(json.dumps([{'id': r['sourceBuildingId'], 'name': r['sourceName'], 'ground': r['adjacentGround']['referenceMedianRH2000'], 'candidates': r['roofCandidates']['points'], 'heightAboveGround': r['roofCandidates']['heightAboveAdjacentGroundMedianMetres'], 'planeSupport': sum(p['fractionOfAllCandidates'] for p in r['roofCandidates']['planes']), 'confidence': r['confidence']} for r in reports], ensure_ascii=False, indent=2))
