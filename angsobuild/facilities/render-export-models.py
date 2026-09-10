"""Independently reopen, render, project and export the owned Ängsö architecture.

Executed in background Blender only. The live user session is never switched.
Runtime meshes are batched per facility/material and contain no source imagery.
"""
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import bpy
import bmesh

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'angsobuild/cache/facilities-model-2026-09-10'
PUBLIC=ROOT/'apps/golf/public/models/angso'
report_path=HERE/'model-build-report.json'
report=json.loads(report_path.read_text(encoding='utf-8'))
source=ROOT/report['blendPath']


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


assert bpy.app.background
assert Path(bpy.data.filepath).resolve()==source.resolve()
assert sha(source)==report['blendSha256'],'Model file changed; preserve artist edits'
for item in report['sourceInputs']:assert sha(ROOT/item['path'])==item['sha256'],item['path']
scene=bpy.data.scenes[report['scene']]
assert list(bpy.data.scenes)==[scene]
bpy.context.window.scene=scene
assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1
vertices=[];batches=[];facility_stats=[]
for facility in report['facilities']:
    parent=scene.objects[facility['blenderNodeName']]
    assert parent.parent is None and parent['facilityId']==facility['id']
    by_material={};bounds=[[math.inf]*3,[-math.inf]*3]
    for obj in parent.children_recursive:
        if obj.type!='MESH':continue
        assert obj.get('generated_facility_model') and not obj.get('context_only')
        assert len(obj.data.materials)==1
        mat=obj.data.materials[0]
        assert not any(node.type=='TEX_IMAGE' for node in mat.node_tree.nodes),'Reference image reached export'
        smooth=bool(obj.get('surface_overlay'))
        batch=by_material.setdefault((mat.name,smooth),{'facilityId':facility['id'],'material':mat,'smooth':smooth,'positions':[],'faces':[]})
        start=len(batch['positions'])
        for vertex in obj.data.vertices:
            p=tuple(obj.matrix_world@vertex.co)
            assert all(math.isfinite(v) for v in p)
            batch['positions'].append(p)
            for k in range(3):bounds[0][k]=min(bounds[0][k],p[k]);bounds[1][k]=max(bounds[1][k],p[k])
        obj.data.calc_loop_triangles()
        batch['faces'].extend(tuple(start+i for i in triangle.vertices) for triangle in obj.data.loop_triangles)
    assert by_material,facility['id']+' empty'
    triangles=sum(len(b['faces']) for b in by_material.values())
    assert triangles>0
    facility_stats.append({'id':facility['id'],'boundsGridLocal':bounds,'materialBatches':len(by_material),'triangles':triangles})
    for batch in by_material.values():
        batch['offset']=len(vertices);vertices.extend(batch['positions']);batch['count']=len(batch['positions']);batches.append(batch)
assert len(vertices)<1500000,'Facility vertex budget exceeded'
previews=[]
for key,name in report['cameras'].items():
    scene.camera=scene.objects[name];path=OUT/(key+'.png');scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True,scene=scene.name)
    previews.append({'view':key,'path':path.relative_to(ROOT).as_posix(),'sha256':sha(path)})

projection_input=OUT/f'projection-input-v{report["revision"]}.json'
projection_output=OUT/f'projection-output-v{report["revision"]}.json'
projection_input.write_text(json.dumps({'vertices':vertices,'groundSurfaceRingsBlenderXY':{
    f['id']:f.get('groundSurfaceRingsBlenderXY',[]) for f in report['facilities']}},separators=(',',':')),encoding='utf-8')
process=subprocess.run([str(ROOT/'geobuild/cache/ortho-venv/Scripts/python.exe'),str(HERE/'project-model-vertices.py'),
                        str(projection_input),str(projection_output)],capture_output=True,text=True)
assert process.returncode==0,process.stderr
print(process.stdout)
projected=json.loads(projection_output.read_text(encoding='utf-8'))
converted=projected['vertices']
assert len(converted)==len(vertices)
export_scene=bpy.data.scenes.new('Angso temporary runtime export')
roots={}
for facility in report['facilities']:
    obj=bpy.data.objects.new(facility['id'],None);export_scene.collection.objects.link(obj)
    obj['facilityId']=facility['id'];obj['sourceBuildingIds']=facility['sourceBuildingIds']
    obj['kind']=facility['kind'];obj['source_evidence']='Ängsö 2025 ortho / 2021 laser / curated photographs; hidden details estimated'
    roots[facility['id']]=obj
for batch in batches:
    points=converted[batch['offset']:batch['offset']+batch['count']]
    mesh=bpy.data.meshes.new('Runtime '+batch['facilityId']+' '+batch['material'].name)
    mesh.from_pydata(points,[],batch['faces']);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    for face in mesh.polygons:face.use_smooth=batch['smooth']
    mesh.materials.append(batch['material'])
    obj=bpy.data.objects.new(mesh.name,mesh);obj.parent=roots[batch['facilityId']];export_scene.collection.objects.link(obj)
bpy.context.window.scene=export_scene
for obj in export_scene.objects:obj.select_set(True)
bpy.context.view_layer.objects.active=next(o for o in export_scene.objects if o.type=='MESH')
glb=OUT/f'angso-facilities-v{report["revision"]}.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,
                          export_animations=False,export_cameras=False,export_lights=False,export_texcoords=False)
assert glb.stat().st_size<32*1024*1024
PUBLIC.mkdir(parents=True,exist_ok=True)
asset_hash=sha(glb);asset=PUBLIC/f'facilities-{asset_hash}.glb'
if asset.exists():assert sha(asset)==asset_hash
else:shutil.copy2(glb,asset)

# Save the editable source scene as a normal document that opens on the courtyard.
bpy.context.window.scene=scene
for obj in list(export_scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
bpy.data.scenes.remove(export_scene)
scene.camera=scene.objects[report['cameras']['courtyard']]
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
scene['normal_blend_document']=True
backup=source.with_suffix('.library.blend');stage=source.with_suffix('.packaged.blend')
assert source.resolve().parent==OUT.resolve() and backup.resolve().parent==OUT.resolve() and stage.resolve().parent==OUT.resolve()
assert not backup.exists() and not stage.exists()
shutil.copy2(source,backup)
bpy.ops.wm.save_as_mainfile(filepath=str(stage),compress=True)
assert sha(source)==report['blendSha256'];stage.replace(source)
report['blendSha256']=sha(source);report['normalBlendDocument']=True
report['libraryBackup']=backup.relative_to(ROOT).as_posix()
report_path.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
facilities=[]
for facility in report['facilities']:
    record={k:v for k,v in facility.items() if k not in ('blenderNodeName','groundSurfaceRingsBlenderXY')}
    record['groundSurfaceRingsLocal']=projected['groundSurfaceRingsLocal'][facility['id']]
    # Site groups own paths and fixtures beyond the original parking outline.
    # Keep the observed source ring intact and report the authored extent as a
    # separate display footprint. Sites never drive vegetation exclusions.
    if record['kind']=='site':
        points=[p for batch in batches if batch['facilityId']==record['id']
                for p in converted[batch['offset']:batch['offset']+batch['count']]]
        x0,x1=min(p[0] for p in points),max(p[0] for p in points)
        z0,z1=min(-p[1] for p in points),max(-p[1] for p in points)
        record['sourceFootprintLocal']=record['footprintLocal']
        record['footprintLocal']=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]
        record['footprintEvidence']='Authored site geometry bounds; source image outline retained separately'
    record['appearance']='reference-based-model-with-estimated-hidden-details'
    facilities.append(record)
manifest={'schemaVersion':1,'groundId':'angso','courseSlugs':['angso'],
          'coordinateFrame':{'kind':'legacy-local-rh2000','originWgs84':{'lat':59.5739,'lon':16.871},'mPerLat':111320,'mPerLon':56375.41},
          'asset':{'url':'models/angso/'+asset.name,'sha256':asset_hash,'bytes':asset.stat().st_size},
          'facilities':facilities,'sourceBlendSha256':sha(source),
          'referenceDates':{'orthophoto':'2025-04-24','laserCampaign':['2021-03-08','2021-04-01']},
          'sourceAttribution':'Ortofoto Nedladdning and Laserdata Nedladdning skog © Lantmäteriet, bearbetad information, CC BY 4.0',
          'limitations':'Eaves, wall offsets, openings and hidden details include estimates. Proposed range development excluded.'}
(PUBLIC/'facilities-v1.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
result={'passed':True,'blendPath':report['blendPath'],'blendSha256':sha(source),'asset':manifest['asset'],
        'facilities':facility_stats,'triangles':sum(f['triangles'] for f in facility_stats),'materialBatches':len(batches),
        'exportVertices':len(vertices),'referenceImagesExported':False,'exactHorizontalProjection':True,
        'previews':previews,'sourceSceneRetainsEditableComponents':True,'liveBlenderScenePreserved':True}
(HERE/'model-export-validation.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k not in ('facilities','previews')}))
