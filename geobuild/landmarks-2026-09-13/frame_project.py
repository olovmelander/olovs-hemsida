"""Present the church in Blender's saved viewport without changing the exports."""
from pathlib import Path
import bpy
from mathutils import Vector

root=Path(globals().get('VECK_REPO_ROOT',r'C:\Users\olov_\repos\olovs-hemsida'))
scene=bpy.data.scenes['Veckefjarden | Photo landmarks 2026-09-13']
bpy.context.window.scene=scene
for collection in scene.collection.children:
    if collection.name.startswith('VECK LANDMARK | Preview rig'):
        collection.hide_viewport=True
        collection.hide_render=True
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.region_3d.view_location=Vector((-65,0,19))
            space.region_3d.view_distance=78
            space.region_3d.view_rotation=Vector((65,-85,42)).to_track_quat('Z','Y')
            space.region_3d.view_perspective='ORTHO'
            space.clip_end=2500
            space.shading.type='MATERIAL'
old=bpy.context.preferences.filepaths.save_version
try:
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(root/'geobuild/landmarks-2026-09-13/veckefjarden-landmarks.blend'),copy=True)
finally:
    bpy.context.preferences.filepaths.save_version=old
print('Framed editable church; original Scene remains intact.')
