"""Build a separate male golfer through MCP, preserving the female atelier.

Uses the same animation contract, with independent rig data and action copies.
"""
import bpy
from pathlib import Path

root=Path(__file__).resolve().parents[2]
female=bpy.data.scenes['Banvy | Golfer atelier']
name='Banvy | Male golfer atelier'
old=bpy.data.scenes.get(name)
if old:
    assert old.get('banvy_character')=='male', 'Refusing to replace an unowned scene'
    for ob in list(old.objects):
        if ob.users_scene==(old,):bpy.data.objects.remove(ob,do_unlink=True)
    bpy.data.scenes.remove(old)
for action in list(bpy.data.actions):
    if action.get('banvy_character')=='male':bpy.data.actions.remove(action)
scene=bpy.data.scenes.new(name);scene['banvy_character']='male'
bpy.context.window.scene=scene
collection=bpy.data.collections.new('Male | Character');scene.collection.children.link(collection)
source_rig=female.objects['Golfer_Rig']
rig=source_rig.copy();rig.data=source_rig.data.copy();rig.animation_data_clear()
rig.name='Male_Golfer_Rig';collection.objects.link(rig);rig.animation_data_create()
actions=[]
for action in bpy.data.actions:
    if action.get('banvy_golfer') and not action.get('banvy_character'):
        clone=action.copy();clone.name='Male | '+action.name;clone['banvy_character']='male';clone['clip_name']=action.name;clone.use_fake_user=True;actions.append(clone)
for source in source_rig.users_collection[0].objects:
    if not source.name.startswith('Club_'):continue
    ob=source.copy();ob.data=source.data.copy();ob.name='Male_'+source.name;ob['club_id']=source.name[5:]
    collection.objects.link(ob);ob.parent=rig
    for modifier in ob.modifiers:
        if modifier.type=='ARMATURE':modifier.object=rig
stage=bpy.data.collections.new('Male | Stage');scene.collection.children.link(stage)
for source in female.objects:
    if source.type not in {'CAMERA','LIGHT'} and source.name!='Warm stone stage':continue
    ob=source.copy();ob.data=source.data.copy();ob.name='Male_'+source.name;stage.objects.link(ob)
    if source==female.camera:scene.camera=ob
scene.world=female.world.copy();scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.view_settings.view_transform='AgX';scene.render.fps=30
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
path=root/'tools/blender-golfer/refine_golfer.py'
exec(compile(path.read_text(encoding='utf-8'),str(path),'exec'),{
    '__file__':str(path),'__name__':'__main__','GOLFER_VARIANT':'male',
    'CHARACTER_SCENE':scene,'CHARACTER_RIG':rig,'CHARACTER_ACTIONS':actions,
})
