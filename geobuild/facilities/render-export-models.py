"""Reopen and inspect generated architecture in background Blender, render and export.

Does not connect to the live Blender session. Only the generated model files are
written. The GLBs contain procedural model geometry/materials, excluding terrain,
reference photography, cameras and lights.
"""
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

blend=Path(bpy.data.filepath)
ROOT=blend.parents[3]
HERE=ROOT/'geobuild/facilities'
OUT=blend.parent
report=json.loads((HERE/'model-build-report.json').read_text(encoding='utf-8'))
scene=bpy.data.scenes[report['scene']]
assert len(bpy.data.scenes)==1,'Unrelated scenes in architecture file'
assert hashlib.sha256(blend.read_bytes()).hexdigest()==report['blendSha256']
assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1
assert scene['horizontal_crs']=='EPSG:3006' and scene['vertical_crs']=='EPSG:5613'
bpy.context.window.scene=scene
features={}
mesh_objects=[]
for obj in scene.objects:
    if obj.type!='MESH' or obj.get('context_only'):continue
    assert obj.get('generated_facility_model'),obj.name
    assert len(obj.data.vertices)>0 and len(obj.data.polygons)>0,obj.name
    assert all(all(math.isfinite(c) for c in v.co) for v in obj.data.vertices),obj.name
    assert len(obj.data.materials)>0,obj.name
    assert all(not node.image for mat in obj.data.materials for node in mat.node_tree.nodes if node.type=='TEX_IMAGE'),'Photo texture accidentally exported'
    key=obj.get('source_feature')
    assert key,obj.name+' missing source feature'
    assert key[0]!='N','Neighbouring property included as golf facility'
    points=[obj.matrix_world@v.co for v in obj.data.vertices]
    f=features.setdefault(key,{'objects':0,'vertices':0,'bounds':[math.inf,math.inf,math.inf,-math.inf,-math.inf,-math.inf]})
    f['objects']+=1;f['vertices']+=len(points)
    for p in points:
        for i in range(3):f['bounds'][i]=min(f['bounds'][i],p[i]);f['bounds'][i+3]=max(f['bounds'][i+3],p[i])
    mesh_objects.append(obj)
expected={'R'+str(i).zfill(2) for i in range(1,13)}|{'S'+str(i).zfill(2) for i in range(1,9)}
assert expected<=features.keys(),'Missing facility coverage '+str(expected-features.keys())
scene.render.resolution_percentage=90
previews=[]
for key,name in report['cameras'].items():
    scene.camera=scene.objects[name]
    scene.render.filepath=str(OUT/(key+'.png'))
    if '--export-only' not in sys.argv:
        bpy.ops.render.render(write_still=True,scene=scene.name)
    previews.append({'name':key,'path':(OUT/(key+'.png')).relative_to(ROOT).as_posix()})

exports=[]
blender_axes=scene['axis_contract']
scene['axis_contract']='glTF X east, Y up, Z south; coordinates relative to EPSG:3006/RH2000 origin extras'
scene['source_blender_axis_contract']=blender_axes
for name,objects in [('veckefjarden-facilities',mesh_objects),('veckefjarden-clubhouse',[o for o in mesh_objects if o.get('source_feature') in {'R01','R02','S01'}])]:
    for obj in scene.objects:obj.select_set(False)
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    target=OUT/(name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,
        export_extras=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
    exports.append({'name':name,'path':target.relative_to(ROOT).as_posix(),'bytes':target.stat().st_size,
                    'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'objects':len(objects)})
scene['axis_contract']=blender_axes
del scene['source_blender_axis_contract']
for obj in scene.objects:obj.select_set(False)
scene.camera=scene.objects[report['cameras']['clubhouse-west']]
scene.render.resolution_percentage=100
# Save a normal Blender workspace copy, with camera view and material preview set.
# The library supplied by live MCP remains untouched and independently reproducible.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
workspace=OUT/'veckefjarden-facilities-workspace.blend'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(workspace),check_existing=False)
audit={'passed':True,'scene':scene.name,'existingLiveSessionTouched':False,'onlyRequestedScene':True,
       'finiteGeometry':True,'photoTexturesInExports':False,'facilityCount':len(features),'features':features,
       'estimatedHeights':True,'nativeTerrainSourceSpacingMetres':1,'terrainMeshSpacingMetres':2,
       'originEPSG3006':report['originEPSG3006'],'originHeightRH2000':report['originHeightRH2000'],
       'gltfAxes':'X east, Y up, Z south; translation anchored E684390 N7023040 H30.673 RH2000',
       'exports':exports,'previews':previews,'workspacePath':workspace.relative_to(ROOT).as_posix(),
       'workspaceSha256':hashlib.sha256(workspace.read_bytes()).hexdigest()}
audit['exportScriptSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
(HERE/'model-audit.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('VECKEFJARDEN_MODEL_AUDIT '+json.dumps({k:v for k,v in audit.items() if k!='features'}))
