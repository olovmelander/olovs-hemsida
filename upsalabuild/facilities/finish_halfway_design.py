"""Build and render the unplaced design in an isolated factory-startup Blender."""
import hashlib
import json
from pathlib import Path
import runpy
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
namespace=runpy.run_path(str(Path(__file__).with_name('build_halfway_design.py')))
scene=namespace['build_halfway_design']()
bpy.context.window.scene=scene
for other in list(bpy.data.scenes):
    if other!=scene:bpy.data.scenes.remove(other)
world=bpy.data.worlds.new('Halfway design daylight');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.7,.78,.84,1);world.node_tree.nodes['Background'].inputs[1].default_value=.65;scene.world=world
review=bpy.data.collections.new('REVIEW ONLY | Not part of GLB');scene.collection.children.link(review)
data=bpy.data.lights.new('Design sun','SUN');data.energy=2.5;data.angle=.15
light=bpy.data.objects.new('Design sun',data);review.objects.link(light);light.rotation_euler=(.4,-.6,-.5)
data=bpy.data.cameras.new('Design review');camera=bpy.data.objects.new('Design review',data);review.objects.link(camera)
camera.location=(12,-16,10);camera.rotation_euler=(Vector((0,0,1.4))-camera.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=12;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
out=ROOT/'upsalabuild/facilities/models-2026-09-10/unplaced-design'
scene.render.filepath=str(out/'Halfway-design-unplaced-preview.png');bpy.ops.render.render(write_still=True,scene=scene.name)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.context.preferences.filepaths.save_version=0
blend=out/'Halfway-design-unplaced.blend';bpy.ops.wm.save_as_mainfile(filepath=str(blend),check_existing=False)
path=out/'Halfway-design-unplaced.json';report=json.loads(path.read_text())
report.update(savedAsNormalBlend=True,blendSha256=hashlib.sha256(blend.read_bytes()).hexdigest(),previewPath=str(Path(scene.render.filepath).relative_to(ROOT)).replace('\\','/'))
path.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'unplacedDesignReady':True,'runtimeIncluded':False,'path':str(blend)}))
