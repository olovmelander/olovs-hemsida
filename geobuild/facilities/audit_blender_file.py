"""Audit the saved reference .blend in a separate background Blender process.

Usage: blender --background <reference.blend> --python <this.py>
The currently open interactive Blender is never touched by this command.
"""
import hashlib
import json
from pathlib import Path
import bpy

blend = Path(bpy.data.filepath)
ROOT = blend.parents[3]
spec_path = ROOT/'geobuild/facilities/blender-reference-spec.json'
spec = json.loads(spec_path.read_text(encoding='utf-8'))
scene = bpy.data.scenes[spec['sceneName']]
assert [s.name for s in bpy.data.scenes]==[scene.name], 'Unrelated scene included in saved file'
assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1
assert scene['reference_only'] and scene['horizontal_crs']=='EPSG:3006'
prefix='VECK REF | '
e,n=spec['originEPSG3006']
maximum=0.0
for panel in spec['orthophotos']:
    obj=scene.objects[prefix+panel['id']]
    w,s,ee,nn=panel['boundsEPSG3006']
    expected=[(w-e,s-n),(ee-e,s-n),(ee-e,nn-n),(w-e,nn-n)]
    for vertex,point in zip(obj.data.vertices,expected):
        maximum=max(maximum,abs(vertex.co.x-point[0]),abs(vertex.co.y-point[1]))
    assert obj.data.polygons[0].normal.z>0
    for loop,expected_uv in zip(obj.data.loops,[(0,0),(1,0),(1,1),(0,1)]):
        assert tuple(obj.data.uv_layers.active.data[loop.index].uv)==expected_uv
for outline in spec['outlines']:
    obj=scene.objects[prefix+outline['id']]
    ring=outline['ringEPSG3006']
    if ring[0]==ring[-1]:
        ring=ring[:-1]
    points=obj.data.splines[0].points
    assert len(points)==len(ring)
    for point,(ee,nn) in zip(points,ring):
        maximum=max(maximum,abs(point.co.x-(ee-e)),abs(point.co.y-(nn-n)))
    assert obj['height_verified'] is False
assert maximum<1e-4, f'Coordinate precision lost: {maximum} m'
images=[i for i in bpy.data.images if i.name.startswith(prefix)]
assert len(images)==len(spec['orthophotos'])+len(spec['photos'])
assert all(i.packed_file for i in images), 'Unpacked image dependency'
for photo in spec['photos']:
    img=bpy.data.images[prefix+photo['id']]
    assert tuple(img.size)==(photo['width'],photo['height'])
assert all(o['reference_only'] for o in scene.objects)
scene.camera=scene.objects[prefix+'Site plan camera']
bpy.context.window.scene=scene
scene.render.resolution_percentage=70
scene.render.filepath=str(ROOT/spec['previewPath'])
bpy.ops.render.render(write_still=True,scene=scene.name)
campus_preview=ROOT/'geobuild/cache/facilities-2026-09-10/blender-campus-preview.png'
scene.camera=scene.objects[prefix+'campus-native camera']
scene.render.filepath=str(campus_preview)
bpy.ops.render.render(write_still=True,scene=scene.name)
report={'passed':True,'savedBlendPath':spec['blendPath'],
        'blendSha256':hashlib.sha256(blend.read_bytes()).hexdigest(),
        'onlyRequestedSceneIncluded':True,'allReferenceImagesPacked':True,
        'packedImages':len(images),'imageNorthAndUVOrientationVerified':True,
        'maximumCoordinateStorageErrorMetres':maximum,'physicalHeightsEstablished':False,
        'renderedPreviewPath':spec['previewPath'],
        'renderedCampusPreviewPath':campus_preview.relative_to(ROOT).as_posix(),
        'sceneObjects':len(scene.objects)}
(ROOT/'geobuild/facilities/blender-file-audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('VECKEFJARDEN_REFERENCE_AUDIT '+json.dumps(report))
