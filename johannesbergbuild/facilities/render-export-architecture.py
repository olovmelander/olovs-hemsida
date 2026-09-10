"""Validate, render and export only the new architecture in background Blender."""
import hashlib
import json
import math
from pathlib import Path
import bpy

ROOT=Path(__file__).resolve().parents[2]
HERE=ROOT/'johannesbergbuild/facilities'
OUT=ROOT/'johannesbergbuild/cache/facilities-model'
report=json.loads((HERE/'model-build-report.json').read_text(encoding='utf-8'))
source=ROOT/report['blendPath']
assert Path(bpy.data.filepath).resolve()==source.resolve()
assert hashlib.sha256(source.read_bytes()).hexdigest()==report['blendSha256']
scene=bpy.data.scenes[report['scene']]
bpy.context.window.scene=scene
assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1
roots=[o for o in scene.objects if o.get('authored_facility')]
assert len(roots)==22 and all(o.parent is None for o in roots)
objects=[];count=0;facility_stats=[]
for root in roots:
    meshes=[o for o in root.children_recursive if o.type=='MESH']
    assert meshes and root['sourceBuildingId']
    bounds=[[math.inf]*3,[-math.inf]*3]
    for obj in meshes:
        assert obj.get('procedural_model') and obj.get('sourceBuildingId')==root['sourceBuildingId']
        assert obj.matrix_world.is_identity,'Bake authoring transforms before export'
        assert len(obj.data.polygons)>0
        for mat in obj.data.materials:
            assert mat.use_nodes and all(n.type!='TEX_IMAGE' for n in mat.node_tree.nodes),'Reference image in architecture'
        for vert in obj.data.vertices:
            assert all(math.isfinite(v) for v in vert.co)
            for k in range(3):bounds[0][k]=min(bounds[0][k],vert.co[k]);bounds[1][k]=max(bounds[1][k],vert.co[k])
        count+=len(obj.data.polygons);objects.append(obj)
    facility_stats.append({'id':root.name,'sourceBuildingId':root['sourceBuildingId'],'boundsGridLocal':bounds})
assert count==report['totalTriangles'] and count<200000
previews=[]
for key,name in report['cameras'].items():
    scene.camera=scene.objects[name];scene.render.filepath=str(OUT/(key+'.png'))
    bpy.ops.render.render(write_still=True,scene=scene.name)
    previews.append({'view':key,'path':(OUT/(key+'.png')).relative_to(ROOT).as_posix()})
for obj in scene.objects:obj.select_set(False)
for obj in roots+objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
glb=OUT/'johannesberg-facilities-grid.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,
                          export_extras=True,export_yup=True,export_animations=False,
                          export_cameras=False,export_lights=False)
for obj in scene.objects:obj.select_set(False)
scene.camera=scene.objects[report['cameras']['clubhouse-front']]
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
workspace=OUT/'johannesberg-facilities-v1.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(workspace),check_existing=False)
result={'passed':True,'scene':scene.name,'facilities':facility_stats,'triangles':count,'photoTexturesExported':False,
        'gridGlbPath':glb.relative_to(ROOT).as_posix(),'gridGlbSha256':hashlib.sha256(glb.read_bytes()).hexdigest(),
        'gridGlbBytes':glb.stat().st_size,'workspacePath':workspace.relative_to(ROOT).as_posix(),
        'workspaceSha256':hashlib.sha256(workspace.read_bytes()).hexdigest(),'previews':previews,
        'liveBlenderProjectModified':False,'dimensionsIncludeEstimates':True}
(HERE/'model-export-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='facilities'}))
