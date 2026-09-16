"""Render and audit the final native character through the local Blender bridge."""
import bpy,json
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
out=root/'docs/graphics/golfer-2026-09-16'
scene=bpy.data.scenes['Banvy | Golfer atelier'];bpy.context.window.scene=scene
rig=scene.objects['Golfer_Rig'];rig.animation_data.action=bpy.data.actions['Idle'];scene.frame_set(1)
rig.animation_data.action_slot=rig.animation_data.action.slots[0];bpy.context.view_layer.update()
scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.filepath=str(out/'golfer-portrait.png')
bpy.ops.render.render(write_still=True)
with bpy.data.libraries.load(str(out/'banvy-golfer.blend'),link=False) as (src,dst):
    audit={'scenes':src.scenes,'actions':src.actions,'objects':src.objects,'fileBytes':(out/'banvy-golfer.blend').stat().st_size}
    assert len(src.actions)==20,src.actions
    assert 'Golfer_Rig' in src.objects
audit['render']=scene.render.filepath
(out/'blender-audit.json').write_text(json.dumps(audit,indent=2))
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
print(json.dumps(audit))
