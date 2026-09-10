"""Independent read-only audit of the FINAL saved Lidingö Blender workspace.

Run using a separate Blender process, never the live MCP instance:
  blender --background --python-exit-code 1 --python lidingobuild/facilities/audit-blender-workspace.py

Opens the final blend named by the pinned spec and checks imported coordinates,
topology, source holes, packed image bytes, UV direction, camera coverage and
scene isolation against the independently exported reference payload. Never saves
or modifies the blend file. Writes the small tracked audit report only.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
FAC = ROOT / 'lidingobuild/facilities'
REPORT_PATH = FAC / 'blender-independent-audit.json'
PREFIX = 'LID | '
CHECKS = []
DETAILS = {}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def source_uv(display_uv, orientation):
    """EXIF maps display pixels to encoded pixels; UV has its origin at bottom left.

    Derive from the standard top-left image coordinate transforms instead of
    copying the importer's four-corner lookup table.
    """
    u, v_bottom = display_uv
    v = 1 - v_bottom
    transforms = {
        1: lambda: (u, v), 2: lambda: (1-u, v),
        3: lambda: (1-u, 1-v), 4: lambda: (u, 1-v),
        5: lambda: (v, u), 6: lambda: (v, 1-u),
        7: lambda: (1-v, 1-u), 8: lambda: (1-v, u),
    }
    x, y_top = transforms[orientation]()
    return (float(x), float(1-y_top))


def check(name, fn):
    try:
        detail = fn()
        CHECKS.append({'name': name, 'passed': True})
        if detail is not None:
            DETAILS[name] = detail
    except Exception as error:
        CHECKS.append({'name': name, 'passed': False, 'error': str(error),
                       'exception': type(error).__name__})


def same(expected, actual, message):
    assert expected == actual, f'{message}: expected {expected!r}, found {actual!r}'


def signature(vertices, indices):
    digest = hashlib.sha256()
    for vertex in vertices:
        digest.update(struct.pack('<3f', *vertex))
    for index in indices:
        digest.update(struct.pack('<I', index))
    return digest.hexdigest()


def mesh_signature(obj):
    assert obj.type == 'MESH', obj.name
    assert all(len(p.vertices) == 3 for p in obj.data.polygons), f'Non-triangle: {obj.name}'
    same(tuple(v for row in obj.matrix_world for v in row),
         (1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.),
         f'Object transform changed for {obj.name}')
    return signature((v.co for v in obj.data.vertices),
                     (i for p in obj.data.polygons for i in p.vertices))


def curve_signature(obj):
    same(obj.type, 'CURVE', f'Expected outline curve for {obj.name}')
    same(len(obj.data.splines), 1, f'Spline count for {obj.name}')
    spline = obj.data.splines[0]
    same(spline.type, 'POLY', f'Unsmooth source outline for {obj.name}')
    assert not spline.use_cyclic_u, f'Artificial closure in {obj.name}'
    assert obj.matrix_world == __import__('mathutils').Matrix.Identity(4), obj.name
    return signature((p.co[:3] for p in spline.points), [])


def check_mesh_set(expected, actual):
    same(len(actual), len(expected), 'Mesh object count')
    remaining = list(actual)
    total_vertices = total_triangles = 0
    for source in expected:
        expected_signature = signature(source['vertices'], source['triangleIndices'])
        match = next((obj for obj in remaining if mesh_signature(obj) == expected_signature), None)
        assert match is not None, f'Missing exact float32 geometry: {source["id"]}'
        remaining.remove(match)
        if source.get('buildingId'):
            same(match.get('source_building_id'), source['buildingId'], 'Source building association')
        if source.get('part'):
            same(match.get('part'), source['part'], 'Architectural part association')
            assert match.get('imported_existing_display') is True, match.name
            assert match.get('not_new_architectural_measurement') is True, match.name
        total_vertices += len(source['vertices'])
        total_triangles += len(source['triangleIndices']) // 3
    assert not remaining
    return {'objects': len(actual), 'vertices': total_vertices, 'triangles': total_triangles,
            'precision': 'Exact vertex/index equality after required Blender float32 conversion'}


def check_ring_set(expected, actual, z_offset=0, flat_height=None):
    same(len(actual), len(expected), 'Outline object count')
    remaining = list(actual)
    vertices = closed = 0
    for source in expected:
        points = [[x, y, z + z_offset if flat_height is None else flat_height] for x, y, z in source]
        target = signature(points, [])
        match = next((obj for obj in remaining if curve_signature(obj) == target), None)
        assert match is not None, f'Missing exact source outline with {len(points)} vertices'
        remaining.remove(match)
        vertices += len(source)
        closed += source[0][:2] == source[-1][:2]
    return {'objects': len(actual), 'vertices': vertices, 'originallyClosedRings': closed,
            'visualHeightOffsetMetres': z_offset if flat_height is None else None,
            'flatPlanHeightMetres': flat_height}


def main():
    assert bpy.app.background, 'Audit must run in a separate background Blender process'
    spec = read(FAC / 'blender-workspace-spec.json')
    model = read(ROOT / spec['modelPath'])
    final_path = (ROOT / spec['blendPath']).resolve()
    assert final_path.is_file(), f'Final saved workspace not ready: {final_path}'
    before = sha(final_path)
    if not bpy.data.filepath or Path(bpy.data.filepath).resolve() != final_path:
        bpy.ops.wm.open_mainfile(filepath=str(final_path))
    same(Path(bpy.data.filepath).resolve(), final_path, 'Audit target')
    scenes = {key: bpy.data.scenes[name] for key, name in spec['sceneNames'].items()}
    model_scene, plan_scene, photo_scene = [scenes[k] for k in ('model', 'plan', 'photos')]
    for scene in scenes.values():
        scene.view_layers[0].update()
    DETAILS['file'] = {'path': spec['blendPath'], 'bytes': final_path.stat().st_size,
                       'sha256': before, 'blenderVersion': bpy.app.version_string}

    def isolation():
        same(set(bpy.data.scenes.keys()), set(spec['sceneNames'].values()), 'Only owned scenes')
        reachable = {o for scene in scenes.values() for o in scene.objects}
        same(set(bpy.data.objects), reachable, 'No unrelated/orphan objects')
        assert all(o.name.startswith(PREFIX) for o in reachable), 'Unrelated object name'
        assert all(m.name.startswith(PREFIX) for m in bpy.data.materials), 'Unrelated material'
        same(bpy.context.scene.name, spec['sceneNames']['model'], 'Saved active scene')
        return {key: len(scene.objects) for key, scene in scenes.items()}
    check('Owned scenes and objects only', isolation)

    def frame():
        for scene in scenes.values():
            same(scene.unit_settings.system, 'METRIC', 'Metric units')
            same(scene.unit_settings.scale_length, 1., 'One unit equals one metre')
            same(scene.get('origin_easting'), 677700.5, 'Easting origin')
            same(scene.get('origin_northing'), 6586399.5, 'Northing origin')
            same(scene.get('origin_height_rh2000'), 25., 'Height origin')
            same(scene.get('horizontal_crs'), 'EPSG:3006', 'Horizontal CRS')
            assert '5613' in scene.get('vertical_crs', ''), 'Vertical CRS'
            assert 'Y=N-6586399.5' in scene.get('axis_contract', ''), 'North axis'
        return model['frame']
    check('Metre scale and east north up frame', frame)

    architecture = [o for o in model_scene.objects if o.get('imported_existing_display')]
    check('Exact architecture vertices triangles and part associations',
          lambda: check_mesh_set(model['architectureMeshes'], architecture))
    terrain = [o for o in model_scene.objects if o.get('source_spacing_metres')]
    check('Exact terrain vertices and 120400 preview triangles',
          lambda: check_mesh_set([model['terrain']], terrain))
    roofs = [o for o in model_scene.objects if o.type == 'MESH' and 'unsupported_regions' in o]

    def roof_evidence():
        same(len(roofs), 5, 'Source roof objects')
        detail = check_mesh_set(model['sourceRoofMeshes'], roofs)
        same(detail['triangles'], 7069, 'Source roof triangle count')
        for source in model['sourceRoofMeshes']:
            obj = next(o for o in roofs if o.get('source_building_id') == source['buildingId'])
            same(json.loads(obj['unsupported_regions']), source['uncoveredFootprintPolygons'], 'Unsupported roof regions')
            same(json.loads(obj['evidence']), source['metadata'], 'Roof source metadata')
            assert any(c.hide_render and c.hide_viewport for c in obj.users_collection), 'Evidence initially hidden'
        assert not any(o.get('source_building_id') == 'way/221846983' for o in roofs), 'Withheld roof must stay absent'
        return detail
    check('Five source roof TINs preserve topology and unsupported holes', roof_evidence)

    primary = [r for f in model['buildingFootprints'] for r in f['rings']]
    facility = [r for f in model['facilities'] for p in f['polygons'] for r in p['rings']]
    additional = [r for f in model['supplementaryReferences'] for r in f['rings']]
    outlines = [o for o in model_scene.objects if o.type == 'CURVE']
    footprint_objects = [o for o in outlines if 'source_building_id' in o]
    facility_objects = [o for o in outlines if 'kind' in o]
    additional_objects = [o for o in outlines if o.get('additional_context_not_solid_model')]
    check('Six exact primary building footprints', lambda: check_ring_set(primary, footprint_objects, .15))
    check('Fourteen exact facility outlines and original interior ring', lambda: check_ring_set(facility, facility_objects, .12))
    check('Fourteen supplementary references retain exact line topology', lambda: check_ring_set(additional, additional_objects, .15))

    def outline_inventory():
        same(len(model['buildingFootprints']), 6, 'Primary footprint count')
        same(len(model['facilities']), 14, 'Facility feature count')
        same(len(model['supplementaryReferences']), 14, 'Supplementary feature count')
        same(sum(bool(o.get('interior_ring')) for o in facility_objects), 1, 'Facility hole count')
        same(len(outlines), len(primary) + len(facility) + len(additional), 'No extra model outlines')
        for obj in outlines:
            evidence = json.loads(obj['evidence'])
            assert evidence.get('notSurveyed') is True, f'Missing uncertainty: {obj.name}'
        return {'primaryFootprints': 6, 'facilityFeatures': 14, 'facilityCurvesIncludingHole': len(facility),
                'supplementaryFeatures': 14, 'supplementaryPolygons': sum(f['closed'] for f in model['supplementaryReferences'])}
    check('Outline inventory and uncertainty metadata', outline_inventory)

    def flattened_outlines():
        collection = next(c for c in plan_scene.collection.children if 'Footprints and facility outlines' in c.name)
        objects = list(collection.objects)
        for rings, height in [(primary, .3), (facility, .2), (additional, .25)]:
            group = [o for o in objects if all(abs(p.co.z - height) < 1e-6 for p in o.data.splines[0].points)]
            check_ring_set(rings, group, flat_height=height)
        same(len(objects), len(primary) + len(facility) + len(additional), 'Plan ring count')
        return {'rings': len(objects), 'horizontalCoordinates': 'Exact retained float32 values'}
    check('Plan outlines retain matching horizontal placement and hole', flattened_outlines)

    def unresolved_search_areas():
        expected = [g for g in spec.get('unresolvedFacilities', []) if g.get('observationBoundsEpsg3006')]
        actual = [o for o in plan_scene.objects if o.get('not_a_footprint')]
        same(len(actual), len(expected), 'Unresolved observation rectangle count')
        rings = []
        for gap in expected:
            west, south, east, north = gap['observationBoundsEpsg3006']
            x0, y0, x1, y1 = west-677700.5, south-6586399.5, east-677700.5, north-6586399.5
            rings.append([[x0,y0,.7],[x1,y0,.7],[x1,y1,.7],[x0,y1,.7],[x0,y0,.7]])
            obj = next(o for o in actual if json.loads(o['unresolved_facility']) == gap)
            assert obj.type == 'CURVE', 'An uncertain search region must not become solid geometry'
            assert any(c.hide_render and c.hide_viewport for c in obj.users_collection), 'Search regions initially hidden'
        result = check_ring_set(rings, actual)
        result['meaning'] = 'Observation search rectangles only; explicitly not measured footprints'
        return result
    check('Unresolved facilities remain hidden search references only', unresolved_search_areas)

    def images():
        web = read(FAC / 'web-reference.json')
        preferred_ids = {p['id'] for p in web['photos'] if p.get('preferredForBlender')}
        same(preferred_ids, {p['id'] for p in spec['photos']}, 'All preferred photos included')
        same(len(spec['orthophotos']), 12, 'Orthophoto reference count')
        image_objects = [o for scene in [plan_scene, photo_scene] for o in scene.objects if 'id' in o]
        items = spec['orthophotos'] + spec['photos']
        same(len(image_objects), len(items), 'Image board count')
        source_images = [i for i in bpy.data.images if i.source == 'FILE']
        same(len(source_images), len(items), 'Packed image datablock count')
        for item in items:
            obj = next(o for o in image_objects if o.get('id') == item['id'])
            same(obj.get('path'), item['path'], 'Image provenance path')
            textures = [n for n in obj.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE']
            same(len(textures), 1, 'One image texture per board')
            img = textures[0].image
            assert img.packed_file is not None, f'Image is not packed: {item["id"]}'
            expected_sha = item.get('sha256') or item['imageSha256']
            same(hashlib.sha256(img.packed_file.data).hexdigest(), expected_sha, f'Packed bytes {item["id"]}')
            uv = obj.data.uv_layers.active
            assert uv is not None, f'Missing UVs: {item["id"]}'
            corners = [(0., 0.), (1., 0.), (1., 1.), (0., 1.)]
            orientation = int(item.get('exifOrientation') or 1)
            assert 1 <= orientation <= 8, f'Invalid EXIF orientation {item["id"]}'
            if item['id'] in preferred_ids:
                same(tuple(img.size), (item['sourceWidth'], item['sourceHeight']), 'Encoded source image dimensions')
                expected_dimensions = (item['sourceHeight'], item['sourceWidth']) if orientation >= 5 else (item['sourceWidth'], item['sourceHeight'])
                same((item['width'], item['height']), expected_dimensions, 'EXIF-oriented photo dimensions')
                vertices = obj.data.vertices
                width = vertices[1].co.x - vertices[0].co.x
                height = vertices[3].co.y - vertices[0].co.y
                assert abs(width / height - item['width'] / item['height']) < 1e-5, f'Photo aspect ratio: {item["id"]}'
            for loop in obj.data.loops:
                same(tuple(uv.data[loop.index].uv), source_uv(corners[loop.vertex_index], orientation),
                     'EXIF-corrected photo UV or north-up orthophoto UV')
        return {'orthophotos': len(spec['orthophotos']), 'preferredPhotos': len(spec['photos']),
                'packedImages': len(source_images), 'packedBytesMatchPinnedSources': True,
                'uvOrientation': 'North-up/east-right orthophotos; photo EXIF orientation independently derived from image-coordinate transforms'}
    check('Twelve orthophotos and all preferred photos packed with exact bytes', images)

    def orthophoto_placement():
        projection_ranges = []
        for i, item in enumerate(spec['orthophotos']):
            obj = next(o for o in plan_scene.objects if o.get('id') == item['id'])
            w, s, e, n = item['boundsEpsg3006']
            z = -.05 - i * .002
            expected = [[w-677700.5, s-6586399.5, z], [e-677700.5, s-6586399.5, z],
                        [e-677700.5, n-6586399.5, z], [w-677700.5, n-6586399.5, z]]
            same(signature(expected, [0, 1, 2, 0, 2, 3]), mesh_signature(obj), f'Map bounds {item["id"]}')
            same(obj.hide_render, i > 0, 'Only overview initially rendered')
            same(obj.hide_viewport, i > 0, 'Only overview initially visible')
            camera = next(o for o in plan_scene.objects if o.type == 'CAMERA' and item['id'] in o.name)
            projected = [world_to_camera_view(plan_scene, camera, obj.matrix_world @ v.co) for v in obj.data.vertices]
            assert all(0 <= p.x <= 1 and 0 <= p.y <= 1 and p.z > 0 for p in projected), (
                f'Orthophoto clipped by portrait camera: {item["id"]}; '
                f'{[(round(p.x, 5), round(p.y, 5)) for p in projected]}')
            projection_ranges.append({'id': item['id'], 'x': [min(p.x for p in projected), max(p.x for p in projected)],
                                      'y': [min(p.y for p in projected), max(p.y for p in projected)]})
        return projection_ranges
    check('Georeferenced orthophoto placement and complete camera coverage', orthophoto_placement)

    def photo_camera():
        boards = [o for o in photo_scene.objects if 'id' in o]
        for obj in boards:
            points = [world_to_camera_view(photo_scene, photo_scene.camera, obj.matrix_world @ v.co) for v in obj.data.vertices]
            assert all(0 <= p.x <= 1 and 0 <= p.y <= 1 and p.z > 0 for p in points), f'Photo board clipped: {obj.name}'
        return {'allBoardsFitCamera': True, 'boards': len(boards)}
    check('All preferred photo boards fit the reference camera', photo_camera)

    def finite_and_notes():
        for obj in bpy.data.objects:
            if obj.type == 'MESH':
                assert all(math.isfinite(x) for v in obj.data.vertices for x in v.co), obj.name
        for scene in scenes.values():
            note = bpy.data.texts.get(scene.get('readme_text', ''))
            assert note and note.as_string() == spec['readme'], 'Missing packed modeling brief'
        same(sha(final_path), before, 'Audit must never modify the saved workspace')
        return {'readOnlyAudit': True, 'finiteMeshCoordinates': True, 'packedBriefMatchesSpec': True}
    check('Finite coordinates packed brief and unchanged final file', finite_and_notes)


try:
    main()
except Exception as error:
    CHECKS.append({'name': 'Audit setup and final file loading', 'passed': False,
                   'error': str(error), 'exception': type(error).__name__,
                   'traceback': traceback.format_exc(limit=3)})

report = {'schemaVersion': 1, 'groundId': 'lidingo',
          'status': 'passed' if CHECKS and all(c['passed'] for c in CHECKS) else 'failed',
          'checks': CHECKS, 'details': DETAILS,
          'limitations': ['Validates the imported baseline and retained evidence, not a newly remodeled replica.',
                          'Cannot re-audit the live original Blender scene; scene isolation is verified in the final saved file.',
                          'Blender stores mesh/curve coordinates as float32; equality is checked after that explicit conversion.']}
REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'status': report['status'], 'checks': len(CHECKS),
                  'failures': [c for c in CHECKS if not c['passed']], 'report': str(REPORT_PATH)}))
if report['status'] != 'passed':
    raise RuntimeError('Independent Blender workspace audit failed; see tracked report')
