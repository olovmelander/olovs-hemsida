"""Open the isolated library as a normal editable .blend, then render a review.

Run with Blender --background tortunabuild/clubhouse/tortuna-clubhouse.blend
--python tortunabuild/blender/render_clubhouse.py. This separate process avoids
changing the user's open file or render settings in the MCP-connected Blender.
"""
from pathlib import Path
import bpy

out=Path(__file__).resolve().parents[1]/'clubhouse'
scene=bpy.data.scenes['Tortuna | Clubhouse architecture']
for window in bpy.context.window_manager.windows: window.scene=scene
for other in list(bpy.data.scenes):
    if other != scene and len(other.objects)==0: bpy.data.scenes.remove(other)
# Opening the asset should show the building immediately, without scene setup.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
scene.render.filepath=str(out/'clubhouse-blender.png')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out/'tortuna-clubhouse.blend'),check_existing=False)
bpy.ops.render.render(write_still=True,scene=scene.name)
