"""Reopen and validate the saved evidence library in a background Blender process."""
import hashlib
import json
from pathlib import Path
import sys
import bpy

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'angsobuild/facilities'
spec = json.loads((HERE / 'blender-reference-spec.json').read_text(encoding='utf-8'))
scene = bpy.data.scenes[spec['sceneName']]
assert list(bpy.data.scenes) == [scene], 'Saved file must not include unrelated scenes'
assert scene.unit_settings.system == 'METRIC' and scene.unit_settings.scale_length == 1
assert scene['reference_only'] and scene['horizontal_crs'] == 'EPSG:3006'
assert scene['architectural_model_complete'] is False
prefix = 'ANG REF | '
e, n = spec['originEPSG3006']
height_origin = spec.get('heightOriginRh2000M', 0)
maximum = 0.0
for panel in spec['orthophotos']:
    obj = scene.objects[prefix + panel['id']]
    w, s, east, north = panel['boundsEPSG3006']
    expected = [(w-e, s-n), (east-e, s-n), (east-e, north-n), (w-e, north-n)]
    for vertex, point in zip(obj.data.vertices, expected):
        maximum = max(maximum, abs(vertex.co.x-point[0]), abs(vertex.co.y-point[1]))
    assert obj.data.polygons[0].normal.z > 0
    for loop, expected_uv in zip(obj.data.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        assert tuple(obj.data.uv_layers.active.data[loop.index].uv) == expected_uv
for outline in spec['outlines']:
    obj = scene.objects[prefix + outline['id']]
    ring = outline['ringEPSG3006']
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    points = obj.data.splines[0].points
    assert len(points) == len(ring)
    for point, (east, north) in zip(points, ring):
        maximum = max(maximum, abs(point.co.x-(east-e)), abs(point.co.y-(north-n)))
    assert obj['height_verified'] is False
assert maximum < .0002, f'Unexpected coordinate storage error: {maximum} m'
images = [image for image in bpy.data.images if image.name.startswith(prefix)]
assert len(images) == len(spec['orthophotos']) + len(spec['photos'])
assert all(image.packed_file for image in images), 'Unpacked reference image'
for photo in spec['photos']:
    assert tuple(bpy.data.images[prefix + photo['id']].size) == (photo['width'], photo['height'])
assert all(obj['reference_only'] for obj in scene.objects)
assert scene['normal_blend_document'] is True
assert bpy.context.scene.name == scene.name
for item in spec.get('roofSupport', []):
    obj = scene.objects[prefix + item['id']]
    vertices = item['verticesEPSG3006Rh2000']
    assert len(obj.data.vertices) == len(vertices)
    assert len(obj.data.polygons) == 1 and obj.data.polygons[0].area > .01
    for actual, raw in zip(obj.data.vertices, vertices):
        expected = (raw[0]-e, raw[1]-n, raw[2]-height_origin)
        assert max(abs(actual.co[k]-expected[k]) for k in range(3)) < .001
    assert obj['architectural_model'] is False
point_count = 0
for cloud in spec.get('laserClouds', []):
    rows = json.loads((ROOT / cloud['path']).read_text(encoding='utf-8'))['points']
    for cls in sorted(set(row[3] for row in rows)):
        expected = [row for row in rows if row[3] == cls]
        obj = scene.objects[prefix + f"{cloud['id']} class {cls}"]
        assert len(obj.data.vertices) == len(expected)
        point_count += len(expected)
        for index in range(0, len(expected), max(1, len(expected)//100)):
            raw = expected[index]
            actual = obj.data.vertices[index].co
            assert max(abs(actual[0]-(raw[0]-e)), abs(actual[1]-(raw[1]-n)), abs(actual[2]-(raw[2]-height_origin))) < .001
assert not scene.collection.children[prefix + '10 Architecture - ready for modelling'].objects
bpy.context.window.scene = scene
scene.render.resolution_percentage = 70
previews = []
for camera_name, name in [(spec['defaultPanel']+' camera', 'blender-campus-preview.png'),
                          ('Whole site camera', 'blender-site-preview.png'),
                          ('Photo boards camera', 'blender-photo-preview.png')]:
    scene.camera = scene.objects[prefix + camera_name]
    output = (ROOT / spec['blendPath']).with_name(name)
    scene.render.filepath = str(output)
    if '--skip-render' not in sys.argv:
        bpy.ops.render.render(write_still=True, scene=scene.name)
    assert output.exists() and output.stat().st_size > 10000
    previews.append(output.relative_to(ROOT).as_posix())
report = {
    'passed': True, 'savedBlendPath': spec['blendPath'],
    'blendSha256': hashlib.sha256((ROOT / spec['blendPath']).read_bytes()).hexdigest(),
    'onlyRequestedSceneIncluded': True, 'allReferenceImagesPacked': True,
    'packedImages': len(images), 'imageNorthAndUVOrientationVerified': True,
    'maximumCoordinateStorageErrorMetres': maximum, 'originalLaserVerticesVerified': point_count,
    'roofSupportSurfacesVerified': len(spec.get('roofSupport', [])), 'normalDocumentStartupVerified': True,
    'architectureComplete': False, 'previews': previews, 'sceneObjects': len(scene.objects),
}
(HERE / 'blender-file-audit.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print('ANGSO_REFERENCE_AUDIT ' + json.dumps(report))
