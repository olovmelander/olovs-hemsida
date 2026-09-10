"""Save the newly owned Puttom scene as a normal .blend and render review views.

Run with background Blender opening the .library.blend generated through MCP.
"""
import hashlib
import json
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[3]
HERE = ROOT/'puttombuild/facilities/models-2026-09-10'
CACHE = ROOT/'puttombuild/cache/facilities-model-2026-09-10'
report_path = HERE/'blender-model-build.json'
report = json.loads(report_path.read_text())
source = ROOT/report['libraryPath']
output = CACHE/'puttom-facilities-v1.blend'
assert bpy.app.background and Path(bpy.data.filepath).resolve()==source.resolve()
assert hashlib.sha256(source.read_bytes()).hexdigest()==report['librarySha256']
assert not output.exists(), 'Preserve existing artist document'
scene = bpy.data.scenes[report['scene']]
assert len(bpy.data.scenes)==1
bpy.context.window.scene = scene
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
scene['normal_blend_document'] = True
bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)
report['blendPath'] = output.relative_to(ROOT).as_posix()
report['blendSha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
report['blendBytes'] = output.stat().st_size
report['savedOpensOnAuthoredPuttom'] = True
report['previews'] = []
scene.render.resolution_percentage = 80
for camera,filename in [('Puttom clubhouse review','clubhouse.png'),('Puttom range review','range.png'),
                         ('Puttom maintenance review','maintenance.png'),('Puttom whole campus review','campus.png')]:
    matches=[obj for obj in scene.objects if obj.type=='CAMERA' and (obj.name==camera or obj.name.startswith(camera+'.'))]
    assert len(matches)==1, 'Expected one review camera in the owned scene: '+camera
    scene.camera = matches[0]
    scene.render.filepath = str(CACHE/filename)
    bpy.ops.render.render(write_still=True,scene=scene.name)
    report['previews'].append((CACHE/filename).relative_to(ROOT).as_posix())
report_path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
