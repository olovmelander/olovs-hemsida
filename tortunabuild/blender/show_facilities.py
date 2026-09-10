"""Display the entry building in the connected Blender, retaining other scenes."""
from pathlib import Path
import sys,bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from fit_review_camera import fit_review_camera

for scene in bpy.data.scenes:
    if scene.name.startswith('Tortuna facility | ') and scene.camera:fit_review_camera(scene)
scene=bpy.data.scenes['Tortuna facility | entry-outbuilding']
bpy.context.window.scene=scene
for obj in scene.objects:obj.select_set(False)
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
        area.spaces.active.shading.type='SOLID'
        area.spaces.active.shading.color_type='MATERIAL'
        area.tag_redraw()
print('Seven facility scenes and geographic assembly ready; unrelated Blender scenes retained.')
