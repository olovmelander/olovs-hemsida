"""Append the finished Visby study to live Blender without replacing user work."""
import bpy, json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
revision = 'visby-martall-original-colours-2026-09-21' if globals().get('ORIGINAL_COLOURS', False) else 'visby-martall-2026-09-21'
file = root / 'docs/graphics' / revision / 'visby-coastal-pines.blend'
previous_scene = bpy.context.scene.name
with bpy.data.libraries.load(str(file), link=False) as (source, target):
    target.scenes = [name for name in source.scenes if name.startswith('Visby GK |')]
scene = target.scenes[0]
crowns = [ob for ob in scene.objects if ob.type == 'MESH' and ' | crown' in ob.name]
trunks = [ob for ob in scene.objects if ob.type == 'MESH' and ' | trunk' in ob.name]
references = [ob for ob in scene.objects if ob.type == 'EMPTY' and ob.empty_display_type == 'IMAGE']
assert len(crowns) == len(trunks) == len(references) == 4
assert all(ob.data.packed_file for ob in references)
assert all(min(v.co.z for v in ob.data.vertices) >= -1e-6 for ob in trunks)
assert all(ob.data.uv_layers for ob in crowns)
report = {'scene': scene.name, 'objects': len(scene.objects), 'file': str(file),
          'previousScenePreserved': previous_scene in bpy.data.scenes,
          'heroCrowns': len(crowns), 'heroTrunks': len(trunks), 'packedReferences': len(references),
          'passed': True}
bpy.context.window.scene = scene
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
(file.parent / 'blender-validation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report))
