"""Build the next seven Tortuna buildings through the existing Blender MCP.

Each building has an isolated metre-scale scene and GLB. The delivered Blender
library includes a geographic assembly without baking geographic offsets twice
into the exported assets. Other connected Blender scenes are preserved.
"""
from pathlib import Path
import json,hashlib,math,sys,importlib
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tortunabuild/blender'))
import facility_geometry
importlib.reload(facility_geometry)
from facility_geometry import FacilityGeometry,closed_building,area,contains,plane_at
from fit_review_camera import fit_review_camera

OUT=ROOT/'tortunabuild/facilities'
CACHE=ROOT/'tortunabuild/cache/facilities'
CACHE.mkdir(parents=True,exist_ok=True)
model=json.loads((OUT/'model-parameters.json').read_text())
appearance=json.loads((OUT/'appearance-parameters.json').read_text())
OWNER='tortunabuild/blender/build_facilities.py'
PREFIX='Tortuna facility | '

# Only this builder's marked scenes and unused data are replaced on reruns.
old=[s for s in bpy.data.scenes if s.get('owner')==OWNER]
if bpy.context.window.scene in old:
    bpy.context.window.scene=next((s for s in bpy.data.scenes if s not in old),None) or bpy.data.scenes.new('Scene')
for scene in old:
    for obj in list(scene.objects): bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.scenes.remove(scene)
for blocks in [bpy.data.collections,bpy.data.meshes,bpy.data.materials,bpy.data.worlds,bpy.data.lights,bpy.data.cameras]:
    for block in list(blocks):
        if block.name.startswith(PREFIX) and block.users==0:blocks.remove(block)


def worldpoint(row,u,v,z):
    f=row['frame'];a=f['anchorEpsg3006RH2000']
    return Vector((f['originEpsg3006'][0]+u*f['uAxis'][0]+v*f['vAxis'][0]-a[0],
                   f['originEpsg3006'][1]+u*f['uAxis'][1]+v*f['vAxis'][1]-a[1],z-a[2]))


def review_setup(scene,row,app):
    prefix=PREFIX+row['label']+' | '
    body=row['body'];base=body['baseRH2000']
    roof=row['roof']
    cu=(roof['eaveUMin']+roof['eaveUMax'])/2;cv=(roof['eaveVMin']+roof['eaveVMax'])/2
    span=max(roof['eaveUMax']-roof['eaveUMin'],roof['eaveVMax']-roof['eaveVMin'])
    world=bpy.data.worlds.new(prefix+'World');scene.world=world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.19,.22,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.65
    for name,pos,energy,size in [('Key',(0,-20,35),21000,25),('Fill',(-20,10,20),12000,20)]:
        data=bpy.data.lights.new(prefix+name,'AREA');data.energy=energy;data.size=size
        obj=bpy.data.objects.new(prefix+name,data);scene.collection.objects.link(obj)
        obj.location=worldpoint(row,cu+pos[0],cv+pos[1],base+pos[2])
        obj.rotation_euler=(worldpoint(row,cu,cv,base+2)-obj.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new(prefix+'Camera');data.type='ORTHO';data.ortho_scale=max(12,span*1.45)
    camera=bpy.data.objects.new(prefix+'Camera',data);scene.collection.objects.link(camera);scene.camera=camera
    view=app.get('reviewCameraUV',[-1,-1])
    camera.location=worldpoint(row,cu+view[0]*span*1.4,cv+view[1]*span*1.4,base+span*.8+5)
    camera.rotation_euler=(worldpoint(row,cu,cv,base+2.4)-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.engine='CYCLES';scene.cycles.samples=20
    scene.render.resolution_x=1100;scene.render.resolution_y=780;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
    scene.render.filepath=str(OUT/(row['label']+'.png'))
    fit_review_camera(scene)


receipts=[];scenes=[];collections=[]
for row in model['buildings']:
    app=appearance['buildings'][row['buildingId']]
    scene=bpy.data.scenes.new(PREFIX+row['label']);scene['owner']=OWNER
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    bpy.context.window.scene=scene
    collection=bpy.data.collections.new(PREFIX+row['label']);scene.collection.children.link(collection)
    A=FacilityGeometry(collection,row)
    roof_color=app.get('roofHex',row['appearance']['roofHex'])
    wall_color=app['wallHex']
    for name,color,rough,metal in [
        ('Timber',wall_color,.86,0),('Batten',app.get('battenHex',wall_color),.9,0),
        ('White trim',app.get('trimHex','E8E8DE'),.7,0),('Roof tile',roof_color,.88,0),
        ('Tile course',roof_color,.9,0),('Roof flashing',app.get('flashingHex','655C54'),.6,.2),
        ('Foundation','858077',.94,0),('Door panel',app.get('doorHex','443B34'),.9,0),
        ('Glass','36494E',.24,.15),('Metal','717A78',.5,.4),
        ('Interior shadow','292723',1,0),('Brick','895347',.9,0),
    ]:A.material(name,color,rough,metal)
    patches=closed_building(A,row,app)
    if row.get('bodyComponents'):
        # Independent area and grid coverage check for the real T-shaped union.
        components=row['bodyComponents'];rects=[c['roofBoundsUV'] for c in components]
        assert len(rects)==2
        r,s=rects
        expected=(r['uMax']-r['uMin'])*(r['vMax']-r['vMin'])+(s['uMax']-s['uMin'])*(s['vMax']-s['vMin'])
        expected-=max(0,min(r['uMax'],s['uMax'])-max(r['uMin'],s['uMin']))*max(0,min(r['vMax'],s['vMax'])-max(r['vMin'],s['vMin']))
        assert abs(sum(area(poly) for poly,_ in patches)-expected)<1e-5,'Roof patches must cover exact T union'
        for i in range(51):
            for j in range(43):
                u=row['roof']['eaveUMin']+(i+.371)/51*(row['roof']['eaveUMax']-row['roof']['eaveUMin'])
                v=row['roof']['eaveVMin']+(j+.217)/43*(row['roof']['eaveVMax']-row['roof']['eaveVMin'])
                expected_count=int(any(r['uMin']<=u<=r['uMax'] and r['vMin']<=v<=r['vMax'] for r in rects))
                assert sum(contains(poly,u,v) for poly,_ in patches)==expected_count,'Roof gaps, overlaps or filled T corners'
    objects=A.build()
    for obj in objects:
        obj['buildingId']=row['buildingId'];obj['appearanceStatus']=app['status'];obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    export_path=CACHE/(row['label']+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(export_path),export_format='GLB',use_selection=True,use_active_scene=True,
        export_yup=True,export_apply=True,export_animations=False,export_cameras=False,export_lights=False,
        export_extras=True,export_materials='EXPORT')
    payload=export_path.read_bytes();sha=hashlib.sha256(payload).hexdigest()
    public=ROOT/'apps/golf/public/courses/tortuna/architecture';public.mkdir(parents=True,exist_ok=True)
    (public/(sha+'.glb')).write_bytes(payload)
    count=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
    receipt={'buildingId':row['buildingId'],'label':row['label'],'appearanceStatus':app['status'],
        'asset':{'url':f'courses/tortuna/architecture/{sha}.glb','sha256':sha,'bytes':len(payload)},
        'anchorEpsg3006RH2000':row['frame']['anchorEpsg3006RH2000'],
        'meshes':len(objects),'vertices':sum(len(o.data.vertices) for o in objects),'triangles':count,
        'features':dict(A.features),'roofPatchCount':len(patches),'roofProjectedAreaSquareMetres':sum(area(p) for p,_ in patches)}
    receipts.append(receipt)
    scene['buildingId']=row['buildingId'];scene['anchorEpsg3006RH2000']=row['frame']['anchorEpsg3006RH2000']
    review_setup(scene,row,app)
    scenes.append(scene);collections.append((row,collection))

# True geographic layout for editing/context, with local component scene assets.
assembly=bpy.data.scenes.new(PREFIX+'Geographic assembly');assembly['owner']=OWNER
assembly.unit_settings.system='METRIC';assembly.unit_settings.scale_length=1
assembly['anchorEpsg3006RH2000']=[597400.5,6614899.5,0]
for row,collection in collections:
    obj=bpy.data.objects.new(PREFIX+row['label']+' instance',None)
    obj.instance_type='COLLECTION';obj.instance_collection=collection
    a=row['frame']['anchorEpsg3006RH2000'];obj.location=(a[0]-597400.5,a[1]-6614899.5,a[2])
    assembly.collection.objects.link(obj)
scenes.append(assembly)
bpy.data.libraries.write(str(OUT/'tortuna-facilities.blend'),set(scenes),path_remap='RELATIVE',fake_user=True,compress=True)
result={'schemaVersion':1,'blenderVersion':bpy.app.version_string,'connection':'Blender MCP localhost:9876',
    'sourceGeometryChanged':False,'photosEmbedded':False,'buildings':receipts,
    'totals':{k:sum(r[k] for r in receipts) for k in ['meshes','vertices','triangles']},
    'totalAssetBytes':sum(r['asset']['bytes'] for r in receipts)}
(OUT/'model-export.json').write_bytes((json.dumps(result,indent=2)+'\n').encode())
bpy.context.window.scene=scenes[0]
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
print(json.dumps(result))
