"""Frame the authored scene in the connected Blender without opening a file."""
import bpy

scene=bpy.data.scenes['Tortuna | Clubhouse architecture']
bpy.context.window.scene=scene
for obj in scene.objects: obj.select_set(False)
for window in bpy.context.window_manager.windows:
    if window.scene != scene: continue
    for area in window.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='SOLID'
            area.spaces.active.shading.color_type='MATERIAL'
            area.tag_redraw()
print('Clubhouse framed; unrelated scenes preserved.')
