"""Independently reopen, export, and render the finished Blender asset library."""
import hashlib
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'upsalabuild/facilities/models-2026-09-10'
report=json.loads((OUT/'model-build-report.json').read_text())
scene=bpy.data.scenes[report['sceneName']]
bpy.context.window.scene=scene
for other in list(bpy.data.scenes):
    if other!=scene:
        assert not other.objects,'Unexpected unrelated scene in asset library'
        bpy.data.scenes.remove(other)
meshes=[o for o in scene.objects if o.type=='MESH']
assert len({o['asset_id'] for o in meshes})==12
assert sum(len(o.data.loop_triangles) for o in meshes)==report['triangles']
assert all(not m.node_tree.nodes.get('Image Texture') for o in meshes for m in o.data.materials)
glb=OUT/'upsala-facilities.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_active_scene=True,export_yup=True,export_extras=True)

review=bpy.data.collections.new('REVIEW ONLY | Native terrain and studio lights');scene.collection.children.link(review)
terrain=json.loads((ROOT/'upsalabuild/cache/facilities-2026-09-10/model-preview-terrain.json').read_text())
mesh=bpy.data.meshes.new('REVIEW native DTM');mesh.from_pydata(terrain['vertices'],[],terrain['faces']);mesh.update()
obj=bpy.data.objects.new('REVIEW native DTM | excluded from GLB and runtime',mesh);review.objects.link(obj);obj['review_only']=True
mat=bpy.data.materials.new('REVIEW meadow');mat.diffuse_color=(.16,.205,.11,1);obj.data.materials.append(mat)
for poly in mesh.polygons:poly.use_smooth=True
world=bpy.data.worlds.new('Upsala review daylight');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.70,.78,.87,1);world.node_tree.nodes['Background'].inputs[1].default_value=.6;scene.world=world
sun=bpy.data.lights.new('REVIEW sun','SUN');sun.energy=3;sun.angle=.12;light=bpy.data.objects.new('REVIEW sun',sun);review.objects.link(light);light.rotation_euler=(.45,-.65,-.6)
data=bpy.data.cameras.new('Upsala review camera');camera=bpy.data.objects.new('Upsala review camera',data);review.objects.link(camera);scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.resolution_x=1500;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
preview=ROOT/'upsalabuild/cache/facilities-2026-09-10/model-renders';preview.mkdir(exist_ok=True)
views=[('clubhouse-terrace',(-52,-83,49),(0,0,4),76),('clubhouse-entrance',(66,50,39),(0,0,4),76),('parking-barn',(100,102,34),(49,36,4),33),('practice-building',(63,-96,22),(21,-64,4),35),('campus',(-190,-260,210),(10,12,1),310),('practice-range',(-200,-145,38),(-149,-89,-7),50)]
renders=[]
for name,position,target,scale in views:
    camera.location=position;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=scale
    scene.render.filepath=str(preview/(name+'.png'));bpy.ops.render.render(write_still=True,scene=scene.name);renders.append(str(Path(scene.render.filepath).relative_to(ROOT)).replace('\\','/'))
# Open directly to the clubhouse view in Blender, with review terrain clearly separated.
name,position,target,scale=views[0];camera.location=position;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();data.ortho_scale=scale
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.region_3d.view_perspective='CAMERA';space.shading.type='MATERIAL';space.overlay.show_floor=False
blend=ROOT/report['blendPath'];bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(blend),check_existing=False)
report.update(savedAsNormalBlend=True,blenderMeshObjects=len(meshes),glbPath=str(glb.relative_to(ROOT)).replace('\\','/'),glbBytes=glb.stat().st_size,blendBytes=blend.stat().st_size,
              glbSha256=hashlib.sha256(glb.read_bytes()).hexdigest(),blendSha256=hashlib.sha256(blend.read_bytes()).hexdigest(),previewRenders=renders,
              renderMethod='Independent Blender4.5.9 Cycles render on native2m DTM review mesh. Terrain/light collection excluded from production exports.')
(OUT/'model-build-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
