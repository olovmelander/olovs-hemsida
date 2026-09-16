"""Render both authored golfers and save a native two-character review scene."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
out=root/'docs/graphics/golfer-2026-09-16'
female=bpy.data.scenes['Banvy | Golfer atelier']
male=bpy.data.scenes['Banvy | Male golfer atelier']
bpy.context.window.scene=male
rig=next(o for o in male.objects if o.type=='ARMATURE')
rig.animation_data.action=next(a for a in bpy.data.actions if a.get('banvy_character')=='male' and a.get('clip_name')=='Idle')
rig.animation_data.action_slot=rig.animation_data.action.slots[0]
male.frame_set(16);male.cycles.samples=32;male.cycles.use_denoising=True
male.render.filepath=str(out/'golfer-male-portrait.png')
bpy.ops.render.render(write_still=True)

name='Banvy | Two golfers'
old=bpy.data.scenes.get(name)
if old:
    assert old.get('banvy_pair')
    for ob in list(old.objects):
        if ob.users_scene==(old,):bpy.data.objects.remove(ob,do_unlink=True)
    bpy.data.scenes.remove(old)
scene=bpy.data.scenes.new(name);scene['banvy_pair']=True
bpy.context.window.scene=scene
for source_scene,x,yaw in [(female,-.57,-.08),(male,.57,.08)]:
    character='female' if source_scene==female else 'male'
    col=bpy.data.collections.new('Pair | '+character);scene.collection.children.link(col)
    original_rig=next(o for o in source_scene.objects if o.type=='ARMATURE')
    mapping={}
    for source in original_rig.users_collection[0].objects:
        ob=source.copy();ob.name='Pair_'+character+'_'+source.name;col.objects.link(ob);mapping[source]=ob
    for source,ob in mapping.items():
        if source.parent in mapping:ob.parent=mapping[source.parent]
        for mod in ob.modifiers:
            if mod.type=='ARMATURE' and mod.object in mapping:mod.object=mapping[mod.object]
        if source==original_rig:
            ob.location.x=x;ob.rotation_euler.z=yaw
        if 'Club_' in source.name:
            ob.hide_render='Iron' not in source.name;ob.hide_set(ob.hide_render)
    mapping[original_rig].animation_data.action=next(a for a in bpy.data.actions if (a.get('clip_name',a.name)=='Idle') and (a.get('banvy_character')=='male')==(character=='male'))
    mapping[original_rig].animation_data.action_slot=mapping[original_rig].animation_data.action.slots[0]
stage=bpy.data.collections.new('Pair | Stage');scene.collection.children.link(stage)
for source in female.objects:
    if source.type not in {'CAMERA','LIGHT'} and source.name!='Warm stone stage':continue
    ob=source.copy();ob.data=source.data.copy();ob.name='Pair_'+source.name;stage.objects.link(ob)
    if source==female.camera:scene.camera=ob
scene.world=female.world.copy();scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.render.fps=60;scene.view_settings.view_transform='AgX'
scene.camera.location=(3.0,-9,3.0)
scene.camera.rotation_euler=(Vector((0,-.01,1.05))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.type='ORTHO';scene.camera.data.ortho_scale=3.8
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(out/'golfer-pair.png')
scene.frame_set(16)
bpy.ops.render.render(write_still=True)
actions={a for a in bpy.data.actions if a.get('banvy_golfer')}
native=out/'banvy-golfer-pair.blend'
bpy.data.libraries.write(str(native),{scene,female,male}|actions,fake_user=True,compress=True)
audit={}
for stem,expected in [('banvy-golfer',20),('banvy-golfer-male',20),('banvy-golfer-pair',40)]:
    with bpy.data.libraries.load(str(out/(stem+'.blend')),link=False) as (src,dst):
        assert len(src.actions)==expected,(stem,src.actions)
        audit[stem]={'scenes':src.scenes,'actions':src.actions,'fileBytes':(out/(stem+'.blend')).stat().st_size}
(out/'blender-pair-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
print(json.dumps({'pair':str(native),'render':scene.render.filepath,'actions':len(actions)}))
