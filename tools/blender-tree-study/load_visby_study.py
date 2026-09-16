"""Append the finished Visby study to live Blender without replacing user work."""
import bpy, json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
file = root / 'docs/graphics/visby-coastal-pine-2026-09-16/visby-coastal-pines.blend'
with bpy.data.libraries.load(str(file), link=False) as (source, target):
    target.scenes = [name for name in source.scenes if name.startswith('Visby GK |')]
scene = target.scenes[0]
bpy.context.window.scene = scene
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
print(json.dumps({'scene': scene.name, 'objects': len(scene.objects), 'file': str(file)}))
