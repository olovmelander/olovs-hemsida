"""Independently reopen and check the delivered Blender file in background."""
from pathlib import Path
import json
import bpy

out=Path(__file__).resolve().parents[1]/'clubhouse'
expected=json.loads((out/'model-export.json').read_text())
scene=bpy.data.scenes['Tortuna | Clubhouse architecture']
assert len(bpy.data.scenes)==1, 'Unrelated scene in delivered file'
meshes=[o for o in scene.objects if o.type=='MESH']
assert len(meshes)==expected['meshes']
assert all(o.name.startswith('Clubhouse | ') for o in meshes)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
assert triangles==expected['triangles']
assert list(scene['anchorEpsg3006RH2000'])==expected['anchorEpsg3006RH2000']
assert all(not image.filepath for image in bpy.data.images), 'Image reference in delivery'
receipt={'passed':True,'blenderVersion':bpy.app.version_string,
         'scenes':[s.name for s in bpy.data.scenes],'meshes':len(meshes),'triangles':triangles,
         'fileBackedImages':0,'unitScale':scene.unit_settings.scale_length,
         'anchorEpsg3006RH2000':list(scene['anchorEpsg3006RH2000'])}
(out/'blend-inspection.json').write_bytes((json.dumps(receipt,indent=2)+'\n').encode())
print(json.dumps(receipt))
