"""Export the authored Ribbingsfors facilities as one runtime GLB with its manifest.

Run in background Blender on the generated document, never on the live MCP:
  & 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background `
    ribbingsforsbuild/cache/facilities-model-2026-09-10/ribbingsfors-facilities.blend `
    --python ribbingsforsbuild/facilities/export_runtime_model.py [-- --export-only]

The facilities scene holds every authored mesh flat, tagged with `facility_id`
(build_blender_scene.py). The runtime loader wants one top-level node per
facility with its source identity in the node extras, so this groups the
meshes under parent empties, decides which retained source buildings each
authored roof replaces or supersedes, exports architecture only (no terrain,
no draped context surfaces, no reference boards) and writes the manifest the
loader validates. The GLB name carries its own SHA-256 so the host may cache
it immutably; the manifest is the one mutable file.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'ribbingsforsbuild/facilities'
CACHE = ROOT / 'ribbingsforsbuild/cache/facilities-model-2026-09-10'
PUBLIC = ROOT / 'apps/golf/public/models/ribbingsfors'
SCENE = 'Ribbingsfors | Facilities 2026-09-10'
ORIGIN_E, ORIGIN_N = 448975.5, 6536024.5
PREFIX = 'RIBB | '
EXPORT_ONLY = '--export-only' in sys.argv

# Retained source buildings the 2024 native orthophoto review refuses as
# structures, with the review's own reason. A source building an authored
# roof CLAIMS is replaced instead, whatever this table says.
SUPPRESS = {
    'ribbingsfors-clubhouse-annex': 'The 2024-05-17 native orthophoto shows the clubhouse cast shadow at this '
        'outline, not a second building (reference/independent-visual-review.md).',
    'ribbingsfors-yard-0': 'Satellite rectangle over the open tan arena/paddock; the real northern roof is the '
        'narrow crosswise maintenance-north-shelter (reference/independent-visual-review.md).',
    'ribbingsfors-yard-1': 'Satellite rectangle superseded by the native-orthophoto maintenance roofs.',
    'ribbingsfors-yard-2': 'Satellite rectangle superseded by the native-orthophoto maintenance roofs.',
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def inside(x, z, ring):
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        ax, az = ring[i]; bx, bz = ring[j]
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            hit = not hit
        j = i
    return hit


def centroid(ring):
    return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]


def overlap(a, b):
    """Either polygon's centroid inside the other, or any vertex of one inside the other."""
    return inside(*centroid(a), b) or inside(*centroid(b), a) \
        or any(inside(x, z, b) for x, z in a) or any(inside(x, z, a) for x, z in b)


def ground_sampler(spec):
    def ground(x, y):
        for panel in spec['panels']:
            step = panel.get('spacingM', panel.get('spacingMetres', panel.get('stepMetres', 1)))
            fx = (x - panel['x0']) / step; fz = (-y - panel['z0']) / step
            w, h = panel['width'], panel['height']
            if not (0 <= fx <= w - 1 and 0 <= fz <= h - 1):
                continue
            c = min(int(fx), w - 2); r = min(int(fz), h - 2); tx = fx - c; tz = fz - r
            a = panel['heightsRH2000M']
            at = lambda cc, rr: a[rr * w + cc]
            return (at(c, r) * (1 - tx) + at(c + 1, r) * tx) * (1 - tz) + (at(c, r + 1) * (1 - tx) + at(c + 1, r + 1) * tx) * tz
        raise ValueError('Outside measured terrain ' + str((x, y)))
    return ground


def main():
    assert bpy.app.background, 'Use an independent background Blender process'
    blend = CACHE / 'ribbingsfors-facilities.blend'
    assert Path(bpy.data.filepath).resolve() == blend.resolve(), 'Open the generated Ribbingsfors document'
    build_report = read(HERE / 'blender-build-report.json')
    assert build_report['blendSha256'] == sha(blend), 'The generated document changed since its build report'
    scene = bpy.data.scenes[SCENE]
    bpy.context.window.scene = scene
    traces = read(HERE / 'reference/reviewed-ortho-traces.json')
    features = {f['id']: f for f in traces['features']}
    model = read(ROOT / 'ribbingsforsbuild/course-model.json')
    buildings = {b['id']: b for b in model['infra']['buildings']}
    ground = ground_sampler(read(HERE / 'reference/facility-ground.json'))

    # 1. Group the flat authored meshes by facility.
    groups = {}
    for obj in scene.objects:
        if obj.type != 'MESH' or obj.get('context_only'):
            continue
        fid = obj.get('facility_id')
        assert fid and fid != 'unassigned', obj.name
        assert obj.parent is None and all(abs(v) < 1e-9 for row_i, row in enumerate(obj.matrix_world)
                                          for col_i, v in enumerate(row) if row_i != col_i and col_i != 3), obj.name
        assert all(abs(obj.matrix_world[i][3]) < 1e-9 for i in range(3)), 'Authored meshes carry world coordinates: ' + obj.name
        groups.setdefault(fid, []).append(obj)
    assert 'clubhouse-main' in groups and 'range-shelter' in groups, sorted(groups)

    # 2. Decide source ownership: an authored roof whose trace contains a retained
    #    building's centroid (or vice versa) REPLACES that building; every other
    #    retained building an authored roof overlaps is superseded and suppressed.
    claimed = {}
    for fid in groups:
        trace = features.get(fid)
        if not trace or trace['kind'] != 'roof':
            continue
        ring = trace['ringEngineXZ']
        candidates = [b for b in buildings.values() if inside(*centroid(b['ring']), ring) or inside(*centroid(ring), b['ring'])]
        candidates = [b for b in candidates if b['id'] not in claimed]
        if candidates:
            best = min(candidates, key=lambda b: math.dist(centroid(b['ring']), centroid(ring)))
            claimed[best['id']] = fid
    superseded = {}
    for bid, building in buildings.items():
        if bid in claimed:
            continue
        covering = [fid for fid in groups if features.get(fid, {}).get('kind') == 'roof'
                    and overlap(features[fid]['ringEngineXZ'], building['ring'])]
        if covering:
            superseded[bid] = {'reason': 'Retained satellite rectangle superseded by native-orthophoto roofs.', 'coveredBy': covering}
    for bid, reason in SUPPRESS.items():
        if bid in buildings and bid not in claimed:
            superseded[bid] = {'reason': reason, 'coveredBy': superseded.get(bid, {}).get('coveredBy', [])}
    by_facility = {fid: bid for bid, fid in claimed.items()}

    # 3. Parent each group under one empty carrying its identity; measure it.
    export_objects = []
    manifest_facilities = []
    def engine_bounds(objs):
        xs, ys, zs = [], [], []
        for obj in objs:
            for v in obj.data.vertices:
                p = obj.matrix_world @ v.co
                xs.append(p.x); ys.append(p.y); zs.append(p.z)
        return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)
    for fid in sorted(groups):
        objs = groups[fid]
        node_name = 'Ribbingsfors ' + fid
        assert not bpy.data.objects.get(node_name), 'Run on a fresh generated document: ' + node_name
        parent = bpy.data.objects.new(node_name, None)
        scene.collection.objects.link(parent)
        parent['facilityId'] = fid
        trace = features.get(fid)
        x0, x1, y0, y1, z0, z1 = engine_bounds(objs)
        if trace and trace.get('ringEngineXZ'):
            footprint = [[round(x, 3), round(z, 3)] for x, z in trace['ringEngineXZ']]
        else:
            footprint = [[round(x0, 3), round(-y1, 3)], [round(x1, 3), round(-y1, 3)], [round(x1, 3), round(-y0, 3)], [round(x0, 3), round(-y0, 3)]]
        anchor_xy = centroid([[p[0], -p[1]] for p in footprint])  # Blender XY
        anchor_local = [round(anchor_xy[0], 3), round(-anchor_xy[1], 3)]
        anchor_h = ground(*anchor_xy)
        record = {'id': fid, 'nodeName': node_name, 'groundAnchorLocal': anchor_local,
                  'groundAnchorRh2000M': round(anchor_h, 4), 'placement': 'absolute-rh2000',
                  'kind': trace['kind'] if trace else 'range-fixture',
                  'modelDetail': 'photo-informed' if fid in ('clubhouse-main', 'range-shelter') else
                                 'orthophoto roof massing; facades unresolved' if trace and trace['kind'] == 'roof' else
                                 'photo-informed range fixture',
                  'boundsLocalRh2000': {'min': [round(x0, 3), round(z0, 3), round(-y1, 3)], 'max': [round(x1, 3), round(z1, 3), round(-y0, 3)]}}
        if fid in by_facility:
            record['sourceBuildingId'] = by_facility[fid]
            parent['sourceBuildingId'] = by_facility[fid]
        else:
            record['sourceFeatureId'] = fid
            record['footprintLocal'] = footprint
            parent['sourceFeatureId'] = fid
        if trace:
            record['sourcePanel'] = trace.get('panelId')
            record['evidence'] = trace.get('confidence') or trace.get('evidence') or 'native 0.16 m orthophoto trace, 2024-05-17'
        for obj in objs:
            obj.parent = parent
            obj['sourceFacilityId'] = fid
            for m in obj.data.materials:
                assert not any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes), 'No photographic textures in runtime geometry'
            assert obj.data.vertices and obj.data.polygons, obj.name
            assert all(math.isfinite(c) for v in obj.data.vertices for c in v.co), obj.name
        export_objects.append(parent)
        export_objects.extend(objs)
        manifest_facilities.append(record)

    # 4. Export architecture only.
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for old in PUBLIC.glob('facilities-*.glb'):
        old.unlink()
    temp = PUBLIC / 'facilities-export.glb'
    for obj in scene.objects:
        obj.select_set(False)
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = export_objects[0]
    bpy.ops.export_scene.gltf(filepath=str(temp), export_format='GLB', use_selection=True, export_extras=True,
                              export_yup=True, export_animations=False, export_cameras=False, export_lights=False,
                              export_apply=True)
    digest = sha(temp)
    asset = PUBLIC / f'facilities-{digest}.glb'
    temp.rename(asset)
    triangles = 0
    for obj in export_objects:
        if obj.type == 'MESH':
            obj.data.calc_loop_triangles(); triangles += len(obj.data.loop_triangles)
    manifest = {
        'schemaVersion': 1, 'groundId': 'ribbingsfors', 'courseSlugs': ['ribbingsfors'],
        'coordinateFrame': {'kind': 'epsg3006-local-rh2000',
                            'originEpsg3006': {'easting': ORIGIN_E, 'northing': ORIGIN_N},
                            'axes': 'east-up-south', 'heightDatum': 'RH2000'},
        'asset': {'url': f'models/ribbingsfors/facilities-{digest}.glb', 'sha256': digest, 'bytes': asset.stat().st_size},
        'facilities': manifest_facilities,
        'suppressedSourceBuildingIds': [{'id': bid, **info} for bid, info in sorted(superseded.items())],
        'replacesRangeFacilities': True,
        'evidence': {'orthophoto': 'Lantmateriet Ortofoto 0.16 m, captured 2024-05-17 (reference/orthophoto-manifest.json)',
                     'photographs': 'Club architectural photographs of 2024-07-12 (photo-reference-manifest.json)',
                     'terrain': 'Published 1 m laser DTM, RH2000 (reference/facility-ground.json)',
                     'architecturalHeights': 'photo-informed estimates; no surveyed eave or ridge heights',
                     'sourceBlendSha256': sha(blend), 'buildReport': 'ribbingsforsbuild/facilities/blender-build-report.json'},
        'sourceNotesPath': 'ribbingsforsbuild/facilities/README.md'}
    (PUBLIC / 'facilities-v1.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('RIBBINGSFORS_EXPORT ' + json.dumps(manifest['asset']), flush=True)

    # 5. Review renders from the generated cameras (skipped with --export-only).
    previews = []
    for key in ('clubhouse', 'clubhouse-west', 'range-bays', 'range-overview', 'campus', 'manor', 'maintenance'):
        scene.camera = scene.objects[build_report['cameras'][key]]
        target = CACHE / f'{key}.png'
        scene.render.filepath = str(target)
        if not EXPORT_ONLY:
            bpy.ops.render.render(write_still=True, scene=scene.name)
        previews.append({'name': key, 'path': target.relative_to(ROOT).as_posix()})
    validation = {'schemaVersion': 1, 'passed': True, 'sourceBlend': blend.relative_to(ROOT).as_posix(),
                  'sourceBlendSha256': manifest['evidence']['sourceBlendSha256'],
                  'facilityCount': len(manifest_facilities), 'meshCount': sum(o.type == 'MESH' for o in export_objects),
                  'triangles': triangles, 'runtimeAsset': manifest['asset'],
                  'replacedSourceBuildings': sorted(claimed), 'suppressedSourceBuildings': sorted(superseded),
                  'retainedSourceBuildings': sorted(b for b in buildings if b not in claimed and b not in superseded),
                  'noPhotographicTexturesExported': True, 'contextSurfacesExcluded': True,
                  'previews': previews, 'rendered': not EXPORT_ONLY}
    (HERE / 'runtime-export-validation.json').write_text(json.dumps(validation, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('RIBBINGSFORS_VALIDATION ' + json.dumps({k: v for k, v in validation.items() if k not in ('previews',)}), flush=True)


main()
