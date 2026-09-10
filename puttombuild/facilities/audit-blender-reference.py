"""Reopen, inspect and render the saved Puttom reference file independently."""
import hashlib
import json
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'puttombuild/facilities'
PREFIX = 'PUT REF | '
spec = json.loads((HERE / 'blender-reference-spec.json').read_text(encoding='utf-8'))
assert bpy.app.background
assert Path(bpy.data.filepath).resolve() == (ROOT / spec['blendPath']).resolve()
scene = bpy.data.scenes[spec['sceneName']]
assert list(bpy.data.scenes) == [scene]
assert bpy.context.scene == scene, 'Saved file must open directly on Puttom'
assert scene['normal_blend_document'] and scene['reference_only']
assert scene.unit_settings.system == 'METRIC' and scene.unit_settings.scale_length == 1
oe, on = spec['originEPSG3006']
maximum = 0
for panel in spec['orthophotos']:
    obj = scene.objects[PREFIX + panel['id']]
    w, s, e, n = panel['boundsEPSG3006']
    expected = [(w-oe, s-on), (e-oe, s-on), (e-oe, n-on), (w-oe, n-on)]
    for vertex, xy in zip(obj.data.vertices, expected):
        maximum = max(maximum, abs(vertex.co.x-xy[0]), abs(vertex.co.y-xy[1]))
    assert obj.data.polygons[0].normal.z > 0
    for loop, uv in zip(obj.data.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        assert tuple(obj.data.uv_layers.active.data[loop.index].uv) == uv
for outline in spec['outlines']:
    obj = scene.objects[PREFIX + outline['id']]
    ring = outline['ringEPSG3006']
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    assert len(obj.data.splines[0].points) == len(ring)
    for point, xy in zip(obj.data.splines[0].points, ring):
        maximum = max(maximum, abs(point.co.x-(xy[0]-oe)), abs(point.co.y-(xy[1]-on)))
assert maximum < .0001, f'Coordinate error {maximum}'
images = [image for image in bpy.data.images if image.name.startswith(PREFIX)]
assert len(images) == len(spec['orthophotos']) + len(spec['photos'])
assert all(image.packed_file for image in images)
for photo in spec['photos']:
    assert tuple(bpy.data.images[PREFIX+photo['id']].size) == (photo['width'], photo['height'])
cloud_count = 0
if spec.get('pointCloud'):
    cloud = json.loads((ROOT / spec['pointCloud']['path']).read_text(encoding='utf-8'))
    mesh = scene.objects[PREFIX + 'Original laser points'].data
    assert len(mesh.vertices) == len(cloud['points'])
    cloud_count = len(mesh.vertices)
    classes = mesh.attributes['source_classification'].data
    for i in range(0, cloud_count, max(1, cloud_count//10000)):
        row = cloud['points'][i]
        expected = (row[0]-oe, row[1]-on, row[2]-spec['heightOriginRh2000M'])
        assert max(abs(a-b) for a, b in zip(mesh.vertices[i].co, expected)) < .0001
        assert classes[i].value == row[3]
for catalogue in spec['catalogues']:
    assert bpy.data.texts[PREFIX + Path(catalogue).name].as_string() == (ROOT/catalogue).read_text(encoding='utf-8')
assert all(obj.get('reference_only') for obj in scene.objects)
previews = []
scene.render.resolution_percentage = 85
for camera_id, path in spec['renders'].items():
    scene.camera = scene.objects[PREFIX + camera_id]
    scene.render.filepath = str(ROOT / path)
    bpy.ops.render.render(write_still=True, scene=scene.name)
    assert (ROOT/path).stat().st_size > 10000
    previews.append(path)
report = {'passed': True, 'savedBlendPath': spec['blendPath'],
          'blendSha256': hashlib.sha256((ROOT/spec['blendPath']).read_bytes()).hexdigest(),
          'opensOnPuttom': True, 'onlyRequestedSceneIncluded': True,
          'allReferenceImagesPacked': True, 'packedImages': len(images),
          'mapNorthAndUVOrientationVerified': True,
          'maximumCoordinateStorageErrorMetres': maximum,
          'laserVertices': cloud_count, 'embeddedCataloguesVerified': True,
          'renderedPreviews': previews, 'objects': len(scene.objects),
          'architecturalModelsCompleted': False}
(HERE/'blender-file-audit.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print('PUTTOM_REFERENCE_AUDIT ' + json.dumps(report))
