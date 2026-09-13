import bpy, json
from pathlib import Path
root=Path(r'C:/Users/olov_/repos/olovs-hemsida')
file=root/'docs/graphics/tree-atelier-2026-09-13/textured-pine.blend'
with bpy.data.libraries.load(str(file),link=False) as (source,target):
    target.scenes=['Ghibli | Textured pine foliage']
scene=target.scenes[0]
assert scene and len(scene.objects)==9
bpy.context.window.scene=scene
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
        area.spaces.active.shading.type='MATERIAL'
print(json.dumps({'scene':scene.name,'objects':len(scene.objects),'landmarksPreserved':len(bpy.data.scenes['Veckefjarden | Photo landmarks 2026-09-13'].objects)}))
