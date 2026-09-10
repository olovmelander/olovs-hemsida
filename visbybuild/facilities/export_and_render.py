"""Audit and export the isolated generated Visby blend; run in background Blender."""
from pathlib import Path
import hashlib
import json
import math
import sys
import bpy

ROOT=Path(__file__).resolve().parents[2];HERE=ROOT/'visbybuild/facilities';OUT=HERE/'output'
report=json.loads((HERE/'blender-build-report.json').read_text(encoding='utf-8'))
assert len(bpy.data.scenes)==1,'Generated project contains unrelated scenes'
scene=bpy.data.scenes[report['sceneName']];bpy.context.window.scene=scene
assert scene.unit_settings.scale_length==1
assert scene['heightDatum']=='RH2000'
expected={f['nodeName']:f for f in report['facilities']}
export_objects=[];counts={};triangles=0
for node_name,facility in expected.items():
    root=scene.objects[node_name];assert root.parent is None
    export_objects.append(root)
    points=[];vertices=0;polygons=0
    for obj in root.children_recursive:
        assert obj.type=='MESH'
        assert obj.data.vertices and obj.data.polygons
        assert all(math.isfinite(c) for v in obj.data.vertices for c in v.co)
        assert obj.data.materials
        assert all(not n.image for m in obj.data.materials for n in m.node_tree.nodes if n.type=='TEX_IMAGE')
        points.extend(obj.matrix_world@v.co for v in obj.data.vertices)
        vertices+=len(obj.data.vertices);polygons+=len(obj.data.polygons)
        obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
        export_objects.append(obj)
    counts[facility['id']]={'vertices':vertices,'polygons':polygons,'boundsBlenderXYZ':[
        *[min(p[i] for p in points) for i in range(3)],*[max(p[i] for p in points) for i in range(3)]]}
public=ROOT/'apps/golf/public/models/visby';public.mkdir(parents=True,exist_ok=True)
asset=public/'facilities-v1.glb'
for obj in scene.objects:obj.select_set(False)
for obj in export_objects:obj.select_set(True)
bpy.context.view_layer.objects.active=export_objects[0]
bpy.ops.export_scene.gltf(filepath=str(asset),export_format='GLB',use_selection=True,
    export_extras=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
manifest={'schemaVersion':1,'groundId':'visby','courseSlugs':['visby'],
    'coordinateFrame':{'kind':'epsg3006-local-rh2000','originEpsg3006':{'easting':687748.5,'northing':6370951.5},
                       'axes':'east-up-south','heightDatum':'RH2000'},
    'asset':{'url':'models/visby/facilities-v1.glb','sha256':hashlib.sha256(asset.read_bytes()).hexdigest(),'bytes':asset.stat().st_size},
    'facilities':report['facilities'],
    'evidence':{'orthophoto':'Lantmateriet 2026-04-10, native 0.16m','footprints':'OSM plus documented image traces',
                'terrain':'National 1m DTM, RH2000','photographs':'Local Visby reference manifest',
                'architecturalHeights':'photo-estimated except published 10.4m lighthouse total'},
    'sourceNotesPath':'visbybuild/facilities/README.md'}
(public/'facilities-v1.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print('VISBY_EXPORT '+json.dumps(manifest['asset']),flush=True)
previews=[]
scene.eevee.taa_render_samples=32
for key in ['clubhouse-seaward','lighthouse','roof-plan','campus','range','service-yard']:
    scene.camera=scene.objects[report['cameras'][key]];scene.render.filepath=str(OUT/(key+'.png'))
    if '--export-only' not in sys.argv:bpy.ops.render.render(write_still=True,scene=scene.name)
    previews.append({'name':key,'path':(OUT/(key+'.png')).relative_to(ROOT).as_posix()})
scene.camera=scene.objects[report['cameras']['clubhouse-seaward']]
for obj in scene.objects:obj.select_set(False)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
bpy.context.preferences.filepaths.save_version=0
workspace=OUT/'visby-facilities-workspace.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(workspace),check_existing=False)
audit={'passed':True,'facilityCount':len(expected),'triangles':triangles,'features':counts,
       'runtimeAsset':manifest['asset'],'noPhotographicTexturesExported':True,'finiteGeometry':True,
       'workspacePath':workspace.relative_to(ROOT).as_posix(),'previews':previews,
       'rendered':'--export-only' not in sys.argv,'savedBlendReopened':True}
(HERE/'blender-validation.json').write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
print('VISBY_VALIDATION '+json.dumps({k:v for k,v in audit.items() if k!='features'}),flush=True)
