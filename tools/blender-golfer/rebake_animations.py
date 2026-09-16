"""Replace both rigs' motion and export the reviewed geometry unchanged."""
import bpy,json,hashlib,struct,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/graphics/golfer-2026-09-16'
ASSET=ROOT/'experiments/golfer/assets'

def export_character(scene,rig,actions,clips,audit):
    male=rig.name.startswith('Male_');variant='male' if male else 'female'
    stem='banvy-golfer-male' if male else 'banvy-golfer';manifest='golfer-male.json' if male else 'golfer.json'
    bpy.context.window.scene=scene
    rig.animation_data.action=None
    for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
    for action in actions:
        name=action.get('clip_name',action.name)
        track=rig.animation_data.nla_tracks.new();track.name=name
        strip=track.strips.new(name,1,action);strip.extrapolation='NOTHING';track.mute=True
        if action.slots:strip.action_slot=action.slots[0]
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
    clubs=[]
    for ob in rig.children:
        if ob.type=='MESH' or ob.get('golfer_motion_marker'):
            ob.hide_set(False);ob.hide_render=False;ob.select_set(True)
            if 'Club_' in ob.name:clubs.append(ob)
    bpy.context.view_layer.objects.active=rig
    path=ASSET/(stem+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,
        export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,
        export_def_bones=True,export_bake_animation=True,export_anim_single_armature=False,
        export_anim_slide_to_zero=True,export_frame_range=False,export_cameras=False,export_lights=False,export_extras=True)
    data=path.read_bytes();size,kind=struct.unpack_from('<II',data,12);gltf=json.loads(data[20:20+size])
    for node in gltf['nodes']:
        if node.get('name','').startswith('Male_'):node['name']=node['name'][5:]
    assert {a['name'] for a in gltf['animations']}=={c['name'] for c in clips}
    encoded=json.dumps(gltf,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);tail=data[20+size:]
    path.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),kind)+encoded+tail)
    for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
    rig.animation_data.action=actions[0]
    if actions[0].slots:rig.animation_data.action_slot=actions[0].slots[0]
    scene.frame_set(2);scene.frame_set(1);bpy.context.view_layer.update()
    for ob in clubs:ob.hide_render='Iron' not in ob.name;ob.hide_set(ob.hide_render)
    report=json.loads((ASSET/manifest).read_text());report.update(clips=clips,animation=audit,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),status='animation revision 2; audit in progress')
    (ASSET/manifest).write_text(json.dumps(report,indent=2),encoding='utf-8')
    (OUT/('build-report-male.json' if male else 'build-report.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
    notes=bpy.data.texts.get(scene.get('readme',''))
    bpy.data.libraries.write(str(OUT/(stem+'.blend')),{scene}|set(actions)|({notes} if notes else set()),fake_user=True,compress=True)
    return {'character':variant,**audit,'clips':len(clips),'bytes':report['bytes']}

if __name__=='__main__':
    api=runpy.run_path(str(ROOT/'tools/blender-golfer/animation.py'))
    for name in ['Banvy | Golfer atelier','Banvy | Male golfer atelier']:
        scene=bpy.data.scenes[name];bpy.context.window.scene=scene
        rig=next(o for o in scene.objects if o.type=='ARMATURE')
        actions,clips,audit=api['bake'](rig,scene)
        print(json.dumps(export_character(scene,rig,actions,clips,audit)))
