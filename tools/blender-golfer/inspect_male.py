"""Inspect the cached CC0 male sculpt before fitting the golfer rig."""
import bpy, json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
with bpy.data.libraries.load(str(root/'output/golfer-source/human_base_meshes_bundle.blend'),link=False) as (src,dst):
    dst.objects=[n for n in src.objects if n.startswith('GEO-body_male_stylized')]
result=[]
for ob in dst.objects:
    data={'name':ob.name,'location':list(ob.location),'parent':ob.parent.name if ob.parent else None,'localCentre':list(ob.matrix_parent_inverse @ ob.location),'verts':len(ob.data.vertices)}
    coords=[v.co for v in ob.data.vertices]
    data['bounds']=[[min(v[i] for v in coords),max(v[i] for v in coords)] for i in range(3)]
    if '.sculpt_face_set' in ob.data.attributes:
        ids={}
        for p,g in zip(ob.data.polygons,ob.data.attributes['.sculpt_face_set'].data):
            ids.setdefault(g.value,set()).update(p.vertices)
        data['sets']={str(g):{'count':len(ii),'bounds':[[round(min(coords[j][i] for j in ii),5),round(max(coords[j][i] for j in ii),5)] for i in range(3)]} for g,ii in ids.items()}
    result.append(data)
(root/'output/golfer-source/male-data.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
for ob in dst.objects:bpy.data.objects.remove(ob,do_unlink=True)
