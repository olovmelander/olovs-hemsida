"""Run in background Blender after loading refined-pine.blend.
Convert the library export into a normal file that opens at the study camera.
"""
import bpy
from pathlib import Path

assert bpy.app.background
scene = next(s for s in bpy.data.scenes if s.name.startswith('Ghibli | Refined original pine'))
bpy.context.window.scene = scene
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
scene.render.filepath = str(Path(bpy.data.filepath).parent / 'refined-pine-variations.png')
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
bpy.ops.render.render(write_still=True)
print('REFINED_PINE_PACKAGED')
