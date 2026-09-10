"""Save the isolated facility library as a portable Blender file and render it.

Run in a separate Blender background process, opening tortuna-facilities.blend.
The interactive MCP session and its unrelated scenes are left intact.
"""
from pathlib import Path
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from fit_review_camera import fit_review_camera

out=Path(__file__).resolve().parents[1]/'facilities'
prefix='Tortuna facility | '
scenes=[s for s in bpy.data.scenes if s.name.startswith(prefix)]
labels=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
assert labels.issubset({s.name.removeprefix(prefix) for s in scenes if s.camera})
assert len(scenes)==8
assert not [im for im in bpy.data.images if im.type=='IMAGE'], 'No source photographs in portable asset'
scene=bpy.data.scenes[prefix+'entry-outbuilding']
for window in bpy.context.window_manager.windows:window.scene=scene
for other in list(bpy.data.scenes):
    if other not in scenes and len(other.objects)==0:bpy.data.scenes.remove(other)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.context.preferences.filepaths.save_version=0
for reviewed in scenes:
    if reviewed.camera:fit_review_camera(reviewed)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'tortuna-facilities.blend'),check_existing=False)
for scene in scenes:
    if not scene.camera:continue
    if labels and scene.name.removeprefix(prefix) not in labels:continue
    scene.render.filepath=str(out/(scene.name.removeprefix(prefix)+'.png'))
    bpy.ops.render.render(write_still=True,scene=scene.name)
print('FACILITIES_RENDER_OK: seven building scenes and geographic assembly retained')
