"""Reopen the portable file and check all scenes, anchors and assembly offsets."""
from pathlib import Path
import json,math
import bpy

out=Path(__file__).resolve().parents[1]/'facilities'
expected=json.loads((out/'model-export.json').read_text())
prefix='Tortuna facility | '
assert len(bpy.data.scenes)==8
assert not [i for i in bpy.data.images if i.filepath], 'No source images in delivery'
records=[]
for row in expected['buildings']:
    scene=bpy.data.scenes[prefix+row['label']]
    objects=[o for o in scene.objects if o.type=='MESH']
    assert len(objects)==row['meshes']
    assert all(o.name.startswith(prefix+row['label']+' | ') for o in objects)
    assert all(o['buildingId']==row['buildingId'] for o in objects)
    assert all(math.isfinite(c) for o in objects for v in o.data.vertices for c in v.co)
    triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
    assert triangles==row['triangles']
    assert list(scene['anchorEpsg3006RH2000'])==row['anchorEpsg3006RH2000']
    assert scene.unit_settings.scale_length==1 and scene.camera
    records.append({'buildingId':row['buildingId'],'meshes':len(objects),'triangles':triangles})
assembly=bpy.data.scenes[prefix+'Geographic assembly']
assert len(assembly.objects)==7
for row in expected['buildings']:
    obj=assembly.objects[prefix+row['label']+' instance'];a=row['anchorEpsg3006RH2000']
    assert obj.instance_type=='COLLECTION'
    assert all(abs(obj.location[i]-[a[0]-597400.5,a[1]-6614899.5,a[2]][i])<.0001 for i in range(3))
receipt={'passed':True,'blenderVersion':bpy.app.version_string,'scenes':8,'buildingScenes':7,
    'geographicInstances':7,'externalImages':0,'unitScale':1,'buildings':records}
(out/'blend-inspection.json').write_bytes((json.dumps(receipt,indent=2)+'\n').encode())
print(json.dumps(receipt))
