"""Author Banvy's golfer through Blender 4.5's local MCP bridge.

Run: python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/build_golfer.py --timeout 240
Creates its own scene and writes a standalone library; existing scenes/files survive.
Metres, Z up, character facing -Y. Animation poses use analytic limb IK, baked at 30 Hz.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector, Matrix, Euler

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/graphics/golfer-2026-09-16'
ASSET = ROOT / 'experiments/golfer/assets'
OUT.mkdir(parents=True, exist_ok=True)
ASSET.mkdir(parents=True, exist_ok=True)
V = Vector
pi = math.pi
# Rebuild only this script's atelier, leaving the user's other Blender scenes intact.
old=bpy.data.scenes.get('Banvy | Golfer atelier')
if old:
    for ob in list(old.objects): bpy.data.objects.remove(ob,do_unlink=True)
    bpy.data.scenes.remove(old)
    for a in list(bpy.data.actions):
        if a.get('banvy_golfer') and not a.get('banvy_character'):
            bpy.data.actions.remove(a)
scene = bpy.data.scenes.new('Banvy | Golfer atelier')
bpy.context.window.scene = scene
scene.render.fps = 30
scene.unit_settings.system = 'METRIC'
collection = bpy.data.collections.new('Golfer | Export')
scene.collection.children.link(collection)

def mat(name, hexcode, rough=.8, metal=0):
    m = bpy.data.materials.new('Golfer | ' + name)
    rgb = tuple(int(hexcode[i:i+2], 16)/255 for i in (0, 2, 4))
    linear = tuple(c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in rgb)
    m.diffuse_color = (*linear, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*linear, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m

skin = mat('Warm skin', 'dfab83', .87)
skinshade = mat('Ear and lip warmth', 'ba7a5e', .9)
shirt = mat('Sage pique', '719180', .96)
dark = mat('Forest trim', '243e37', .85)
cream = mat('Sand twill', 'e4d8bb', .92)
fold = mat('Twill seams', 'c6b899', .9)
white = mat('Ivory leather', 'f4eddb', .66)
hair = mat('Espresso hair', '342a24', .88)
eye = mat('Eye whites', 'eee6d5', .45)
iris = mat('Warm brown iris', '574339', .65)
pupil = mat('Pupil', '1d2525', .34)
gold = mat('Brass', 'c4a56a', .35, .65)
steel = mat('Brushed club steel', 'abb7b7', .29, .82)
graphite = mat('Graphite', '293735', .35, .35)

meshes = []
def mesh(name, verts, faces, material, weights):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    collection.objects.link(ob)
    ob.data.materials.append(material)
    for p in data.polygons:
        p.use_smooth = True
    groups = {}
    for i, ws in enumerate(weights):
        for bone, w in ws.items():
            if w <= 0: continue
            if bone not in groups: groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([i], w, 'REPLACE')
    meshes.append(ob)
    return ob

def rings(name, rows, material, bone, sides=20):
    # Rows: centre, local x radius, local y radius, optional bone weights.
    verts, weights, faces = [], [], []
    for row in rows:
        c, rx, ry = row[:3]
        w = row[3] if len(row)>3 else {bone: 1}
        for j in range(sides):
            a = 2*pi*j/sides
            verts.append((c[0]+rx*math.cos(a), c[1]+ry*math.sin(a), c[2]))
            weights.append(w)
    for r in range(len(rows)-1):
        for j in range(sides):
            a=r*sides+j; b=r*sides+(j+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(reversed(range(sides))), tuple((len(rows)-1)*sides+j for j in range(sides))])
    return mesh(name, verts, faces, material, weights)

def ellipsoid(name, center, scale, material, bone, seg=20, lat=12, rotation=None):
    verts, faces = [], []
    rot = Euler(rotation or (0,0,0)).to_matrix()
    for j in range(lat+1):
        a = pi*j/lat
        for i in range(seg):
            b = 2*pi*i/seg
            p=V((scale[0]*math.sin(a)*math.cos(b), scale[1]*math.sin(a)*math.sin(b), scale[2]*math.cos(a)))
            verts.append(V(center)+rot@p)
    for j in range(lat):
        for i in range(seg):
            k=j*seg+i; n=j*seg+(i+1)%seg
            faces.append((k,n,n+seg,k+seg))
    return mesh(name, verts, faces, material, [{bone:1} for _ in verts])

def tube(name, points, radii, material, bones, sides=16):
    verts, weights, faces = [], [], []
    for i,p in enumerate(points):
        p=V(p)
        tangent=V(points[min(i+1,len(points)-1)])-V(points[max(0,i-1)])
        tangent.normalize()
        # A stable ring frame avoids a 180-degree roll at a nearly vertical knee.
        ref=V((1,0,0)) if abs(tangent.x)<.9 else V((0,1,0))
        u=(ref-tangent*tangent.dot(ref)).normalized();v=tangent.cross(u)
        rx,ry=radii[i] if isinstance(radii[i],tuple) else (radii[i],radii[i])
        w=bones[i] if isinstance(bones,list) else {bones:1}
        for j in range(sides):
            a=2*pi*j/sides
            verts.append(p+u*(rx*math.cos(a))+v*(ry*math.sin(a)))
            weights.append(w)
    for i in range(len(points)-1):
        for j in range(sides):
            a=i*sides+j; b=i*sides+(j+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(reversed(range(sides))),tuple((len(points)-1)*sides+j for j in range(sides))])
    return mesh(name,verts,faces,material,weights)

def patch(name, verts, material, bone):
    return mesh(name,verts,[tuple(range(len(verts)))],material,[{bone:1} for _ in verts])

# Soft athletic proportions and an expressive, slightly enlarged animation-style head.
rings('Polo | tailored body', [((0,0,1.00),.165,.109,{'Hips':.7,'Spine':.3}),
    ((0,0,1.06),.175,.115,{'Hips':.3,'Spine':.7}),((0,0,1.16),.178,.122,{'Spine':1}),
    ((0,0,1.30),.218,.137,{'Spine':.5,'Chest':.5}),((0,0,1.43),.25,.14,{'Chest':1}),
    ((0,0,1.49),.247,.126,{'Chest':1}),((0,0,1.53),.185,.10,{'Chest':1}),
    ((0,0,1.565),.078,.068,{'Chest':1})],shirt,'Chest',32)
rings('Trousers | seat', [((0,0,.925),.157,.105),((0,0,.965),.169,.113),((0,0,1.025),.163,.108)],cream,'Hips',28)
rings('Belt | woven forest', [((0,0,1.017),.168,.115),((0,0,1.053),.17,.117)],dark,'Hips',32)
ellipsoid('Belt | brass buckle',(0,-.12,1.036),(.027,.009,.019),gold,'Hips',16,8)
rings('Neck',[((0,0,1.50),.065,.062),((0,0,1.64),.074,.068)],skin,'Neck',24)
rings('Polo | collar stand',[((0,0,1.535),.09,.078),((0,0,1.568),.082,.074)],dark,'Chest',28)
for s in [-1,1]:
    patch('Polo | collar',[(s*.012,-.079,1.565),(s*.08,-.062,1.562),(s*.12,-.126,1.49),(s*.034,-.15,1.482)],cream,'Chest')
    patch('Polo | shoulder panel',[(s*.092,-.084,1.539),(s*.225,-.086,1.50),(s*.23,-.125,1.467),(s*.09,-.126,1.501)],dark,'Chest')
patch('Polo | placket',[(-.013,-.145,1.48),(.013,-.145,1.48),(.012,-.145,1.365),(-.012,-.145,1.365)],dark,'Chest')
for z in [1.451,1.414,1.38]: ellipsoid('Polo | button',(0,-.151,z),(.004,.003,.004),cream,'Chest',10,6)
ellipsoid('Polo | chest crest',(.135,-.14,1.397),(.019,.003,.024),cream,'Chest',12,8)
patch('Polo | crest flag',[(.129,-.145,1.385),(.129,-.145,1.411),(.145,-.145,1.403)],dark,'Chest')

# Face contours: full brow, cheek planes, tapered jaw and defined chin.
rings('Face | sculpted silhouette',[
    ((0,-.014,1.619),.055,.052),((0,-.018,1.64),.079,.076),((0,-.008,1.682),.105,.09),
    ((0,0,1.738),.122,.102),((0,.002,1.79),.127,.11),((0,.01,1.849),.123,.108),
    ((0,.014,1.91),.102,.088),((0,.014,1.941),.061,.058),((0,.014,1.95),.008,.008)],skin,'Head',32)
for s in [-1,1]:
    ellipsoid('Face | ear',(s*.12,.001,1.748),(.026,.018,.044),skin,'Head',16,10)
    ellipsoid('Face | inner ear',(s*.135,-.013,1.75),(.012,.006,.025),skinshade,'Head',12,8)
    ellipsoid('Face | eye socket',(s*.053,-.092,1.788),(.042,.017,.026),skinshade,'Head',20,10)
    ellipsoid('Face | eye',(s*.053,-.108,1.792),(.035,.014,.021),eye,'Head',24,12)
    ellipsoid('Face | iris',(s*.052,-.121,1.792),(.014,.004,.017),iris,'Head',20,10)
    ellipsoid('Face | pupil',(s*.052,-.125,1.792),(.007,.0015,.010),pupil,'Head',16,8)
    ellipsoid('Face | catchlight',(s*.052-.003,-.127,1.797),(.0025,.001,.003),white,'Head',10,6)
    tube('Face | brow',[(s*.023,-.106,1.821),(s*.048,-.113,1.829),(s*.079,-.095,1.823)],[(.006,.009),(.008,.009),(.003,.004)],hair,'Head',10)
    tube('Hair | sideburn',[(s*.115,.016,1.875),(s*.122,.007,1.807),(s*.113,.006,1.775)],[.018,.014,.008],hair,'Head',12)
# Projecting nose with bridge and nostril wings, understated smile.
ellipsoid('Face | nose bridge',(0,-.102,1.765),(.015,.018,.03),skin,'Head',20,12)
ellipsoid('Face | nose tip',(0,-.117,1.746),(.017,.020,.014),skin,'Head',20,10)
for s in [-1,1]: ellipsoid('Face | nostril',(s*.017,-.130,1.739),(.005,.004,.003),skinshade,'Head',10,6)
tube('Face | mouth',[(-.037,-.088,1.698),(-.018,-.1,1.694),(0,-.105,1.693),(.018,-.1,1.694),(.037,-.088,1.698)],[.002,.003,.003,.003,.002],skinshade,'Head',8)
ellipsoid('Face | lower lip',(0,-.1,1.686),(.024,.005,.006),skin,'Head',18,8)
rings('Cap | tailored crown',[((0,.014,1.864),.128,.112),((0,.018,1.89),.131,.115),
    ((0,.025,1.938),.12,.104),((0,.025,1.972),.083,.072),((0,.025,1.985),.014,.014)],dark,'Head',32)
rings('Cap | sweatband',[((0,.014,1.861),.129,.113),((0,.014,1.879),.13,.114)],shirt,'Head',32)
ellipsoid('Cap | curved peak',(0,-.123,1.868),(.136,.113,.012),dark,'Head',32,8,(-.07,0,0))
ellipsoid('Cap | piping',(0,-.202,1.859),(.09,.011,.004),cream,'Head',24,6)
ellipsoid('Cap | embroidered badge',(0,-.097,1.919),(.023,.004,.025),cream,'Head',16,8)
patch('Cap | badge flag',[(-.005,-.103,1.905),(-.005,-.103,1.934),(.012,-.103,1.924)],dark,'Head')

bonespec = {}
def bone(name,head,tail,parent=None): bonespec[name]=(V(head),V(tail),parent)
bone('Root',(0,0,0),(0,0,.16))
bone('Hips',(0,0,.98),(0,0,1.10),'Root')
bone('Spine',(0,0,1.10),(0,0,1.33),'Hips')
bone('Chest',(0,0,1.33),(0,0,1.53),'Spine')
bone('Neck',(0,0,1.53),(0,0,1.64),'Chest')
bone('Head',(0,0,1.64),(0,0,1.92),'Neck')
for s,side in [(1,'L'),(-1,'R')]:
    shoulder=V((s*.237,0,1.49)); elbow=V((s*.365,-.014,1.21)); wrist=V((s*.438,-.044,.943))
    handtip=wrist+V((s*.02,-.008,-.105))
    bone('UpperArm_'+side,shoulder,elbow,'Chest')
    bone('Forearm_'+side,elbow,wrist,'UpperArm_'+side)
    bone('Hand_'+side,wrist,handtip,'Forearm_'+side)
    armpts=[shoulder, shoulder.lerp(elbow,.2),shoulder.lerp(elbow,.5),shoulder.lerp(elbow,.82),elbow,elbow.lerp(wrist,.16),elbow.lerp(wrist,.5),elbow.lerp(wrist,.86),wrist]
    aw=[{'UpperArm_'+side:1}]*3+[{'UpperArm_'+side:.85,'Forearm_'+side:.15},{'UpperArm_'+side:.5,'Forearm_'+side:.5},{'UpperArm_'+side:.15,'Forearm_'+side:.85}]+[{'Forearm_'+side:1}]*3
    tube('Arms | '+side,armpts,[.067,.073,.067,.054,.048,.052,.05,.034,.031],skin,aw,20)
    ellipsoid('Polo | shoulder '+side,shoulder,(.088,.095,.085),shirt,'UpperArm_'+side,24,12)
    tube('Polo | sleeve '+side,[shoulder+V((-s*.025,0,.024)), shoulder.lerp(elbow,.18),shoulder.lerp(elbow,.45),shoulder.lerp(elbow,.52)],[.09,.086,.076,.071],shirt,'UpperArm_'+side,24)
    tube('Polo | sleeve piping '+side,[shoulder.lerp(elbow,.50),shoulder.lerp(elbow,.54)],[.073,.072],dark,'UpperArm_'+side,24)
    palm=wrist.lerp(handtip,.44)
    ellipsoid('Hands | palm '+side,palm,(.042,.031,.059),white if side=='L' else skin,'Hand_'+side,20,12,(0,-s*.12,0))
    for j in range(4):
        start=wrist+V(((j-1.5)*.019,-.013,-.061))
        mid=start+V((s*.006,-.014,-.04+(abs(j-1.5)*.005)))
        tip=mid+V((0,-.024,-.024))
        b1='Finger%dA_%s'%(j,side); b2='Finger%dB_%s'%(j,side)
        bone(b1,start,mid,'Hand_'+side); bone(b2,mid,tip,b1)
        tube('Hands | finger %d %s'%(j,side),[start,start.lerp(mid,.5),mid,mid.lerp(tip,.5),tip],[.011,.011,.01,.009,.005],white if side=='L' else skin,[{b1:1},{b1:1},{b1:.5,b2:.5},{b2:1},{b2:1}],12)
    start=wrist+V((-s*.034,-.016,-.014)); mid=start+V((-s*.025,-.019,-.03)); tip=mid+V((s*.008,-.028,-.022))
    bone('ThumbA_'+side,start,mid,'Hand_'+side); bone('ThumbB_'+side,mid,tip,'ThumbA_'+side)
    tube('Hands | thumb '+side,[start,mid,tip],[.017,.014,.007],white if side=='L' else skin,[{'ThumbA_'+side:1},{'ThumbA_'+side:.5,'ThumbB_'+side:.5},{'ThumbB_'+side:1}],12)
    if side=='L':
        tube('Glove | cuff',[wrist+V((0,0,.015)),wrist+V((0,0,-.018))],[.034,.034],white,'Hand_'+side,20)
    hip=V((s*.099,0,.956)); knee=V((s*.107,-.027,.545)); ankle=V((s*.115,0,.105)); toe=ankle+V((0,-.20,-.027))
    bone('Thigh_'+side,hip,knee,'Hips'); bone('Shin_'+side,knee,ankle,'Thigh_'+side); bone('Foot_'+side,ankle,toe,'Shin_'+side)
    points=[hip+V((0,0,.035)),hip.lerp(knee,.2),hip.lerp(knee,.55),hip.lerp(knee,.86),knee,knee.lerp(ankle,.13),knee.lerp(ankle,.5),knee.lerp(ankle,.88),ankle+V((0,0,.025))]
    lw=[{'Thigh_'+side:1}]*3+[{'Thigh_'+side:.85,'Shin_'+side:.15},{'Thigh_'+side:.5,'Shin_'+side:.5},{'Thigh_'+side:.15,'Shin_'+side:.85}]+[{'Shin_'+side:1}]*3
    tube('Trousers | leg '+side,points,[(.097,.101),(.098,.097),(.084,.088),(.066,.077),(.064,.073),(.067,.071),(.060,.063),(.047,.054),(.047,.052)],cream,lw,24)
    tube('Trousers | hem '+side,[ankle+V((0,0,.045)),ankle+V((0,0,.065))],[(.048,.055),(.049,.056)],fold,'Shin_'+side,20)
    ellipsoid('Shoes | sole '+side,(s*.115,-.071,.032),(.072,.148,.031),dark,'Foot_'+side,24,10)
    ellipsoid('Shoes | midsole '+side,(s*.115,-.071,.05),(.074,.15,.026),white,'Foot_'+side,24,10)
    ellipsoid('Shoes | leather '+side,(s*.115,-.065,.091),(.066,.139,.057),white,'Foot_'+side,24,12)
    ellipsoid('Shoes | heel '+side,(s*.115,.035,.104),(.06,.036,.053),dark,'Foot_'+side,20,10)
    ellipsoid('Shoes | saddle '+side,(s*.115,-.049,.129),(.06,.045,.025),shirt,'Foot_'+side,20,8)
    for y in [-.038,-.059,-.08]: tube('Shoes | lace '+side,[(s*.115-.027,y,.146),(s*.115+.027,y,.146)],[.003,.003],white,'Foot_'+side,8)

# A common animated grip socket, with separate selectable club meshes.
bone('ClubGrip',(0,-.4,.95),(0,-.4,.75),'Root')
clubs=[]
for name,length in [('Driver',1.08),('Wood',1.015),('Iron',.94),('Wedge',.88),('Putter',.84)]:
    start=len(meshes)
    top=V((0,-.4,.95)); end=top+V((0,0,-length))
    tube('Club '+name+' | shaft',[top,end],[.006,.004],graphite if name in ['Driver','Wood'] else steel,'ClubGrip',12)
    tube('Club '+name+' | grip',[top+V((0,0,.032)),top,top+V((0,0,-.205))],[.011,.013,.010],dark,'ClubGrip',16)
    for i in range(10):
        z=top.z-.015-i*.018
        tube('Club '+name+' | grip rib',[(0,-.4,z),(0,-.4,z-.002)],[.013,.013],shirt,'ClubGrip',12)
    if name in ['Driver','Wood']:
        ellipsoid('Club '+name+' | head',end+V((.036,-.01,.012)),(.077 if name=='Driver' else .062,.056,.04),graphite,'ClubGrip',24,12)
        ellipsoid('Club '+name+' | face',end+V((.045,-.057,.012)),(.06,.008,.03),steel,'ClubGrip',20,8)
        tube('Club '+name+' | crown inlay',[end+V((.017,-.042,.043)),end+V((.063,-.023,.046))],[.003,.003],gold,'ClubGrip',8)
    elif name=='Putter':
        ellipsoid('Club Putter | head',end+V((.033,-.025,0)),(.073,.026,.018),steel,'ClubGrip',16,8)
        tube('Club Putter | alignment',[end+V((.033,-.045,.018)),end+V((.033,-.006,.018))],[.002,.002],white,'ClubGrip',8)
    else:
        ob=ellipsoid('Club '+name+' | head',end+V((.034,-.014,.014)),(.061,.018,.034),steel,'ClubGrip',20,10,(.28 if name=='Wedge' else .12,0,-.1))
        for i in range(4): tube('Club '+name+' | face groove',[end+V((0,-.033,-.004+i*.009)),end+V((.067,-.033,-.004+i*.009))],[.001,.001],graphite,'ClubGrip',8)
    # One mesh and two/three material primitives per club rather than one draw per detail.
    bpy.ops.object.select_all(action='DESELECT')
    for ob in meshes[start:]: ob.select_set(True)
    bpy.context.view_layer.objects.active=meshes[start]
    bpy.ops.object.join()
    club=bpy.context.object; club.name='Club_'+name
    clubs.append(club)
    meshes[start:]=[club]

body=[o for o in meshes if o not in clubs]
bpy.ops.object.select_all(action='DESELECT')
for ob in body: ob.select_set(True)
bpy.context.view_layer.objects.active=body[0]
bpy.ops.object.join()
body=bpy.context.object; body.name='Golfer_Outfit_and_Body'
armdata=bpy.data.armatures.new('Banvy humanoid')
rig=bpy.data.objects.new('Golfer_Rig',armdata)
collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(head,tail,parent) in bonespec.items():
    b=armdata.edit_bones.new(name);b.head=head;b.tail=tail
    if parent: b.parent=armdata.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
for ob in [body]+clubs:
    ob.parent=rig
    mod=ob.modifiers.new('Weighted character rig','ARMATURE');mod.object=rig
rig.show_in_front=True
rig['design']='Original Banvy golfer; gentle Ghibli-inspired character, sage / sand / forest palette.'
rig['forward']='Blender -Y / glTF +Z'
rig['height_m']=1.985

# The same motion authoring code serves the blockout and both refined anatomies.
import runpy
motion_api=runpy.run_path(str(ROOT/'tools/blender-golfer/animation.py'))
built_actions,manifest,motion_audit=motion_api['bake'](rig,scene)
grip_errors=[]

rig.animation_data.action=bpy.data.actions.get('Idle')
scene.frame_set(1)
scene.frame_end=193
for c in clubs: c.hide_render=c.name!='Club_Iron'
# Export all clubs; runtime toggles visibility. Animation uses a single rig and socket.
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True);body.select_set(True)
for c in clubs: c.hide_render=False;c.select_set(True)
bpy.context.view_layer.objects.active=rig
exportfile=ASSET/'banvy-golfer.glb'
rig.animation_data.action=None
for action in built_actions:
    track=rig.animation_data.nla_tracks.new();track.name=action.name
    strip=track.strips.new(action.name,1,action);strip.extrapolation='NOTHING';track.mute=True
bpy.ops.export_scene.gltf(filepath=str(exportfile),export_format='GLB',use_selection=True,use_active_scene=True,
    export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,
    export_def_bones=True,export_bake_animation=True,export_anim_single_armature=False,
    export_anim_slide_to_zero=True,export_frame_range=False,export_cameras=False,export_lights=False,
    export_extras=True)
for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
rig.animation_data.action=next(a for a in built_actions if a.name=='Idle');scene.frame_set(1)

# Review scene is separate from the export, with the same warm light as the course.
for c in clubs: c.hide_render=c.name!='Club_Iron';c.hide_set(c.name!='Club_Iron')
stage=bpy.data.collections.new('Atelier | Lighting and stage');scene.collection.children.link(stage)
def stage_obj(name,data):
    ob=bpy.data.objects.new(name,data);stage.objects.link(ob);return ob
floor=bpy.data.meshes.new('Ground');floor.from_pydata([(-200,-200,0),(200,-200,0),(200,200,0),(-200,200,0)],[],[(0,1,2,3)])
ground=stage_obj('Warm stone stage',floor);ground.data.materials.append(mat('Stage','cbd0bb'))
for name,loc,energy,size,color in [('Warm key',(-3,-4,6),650,4,(1,.85,.65)),('Cool fill',(4,-2,4),400,5,(.7,.83,1)),('Rim',(0,3,4),700,3,(1,.92,.75))]:
    l=bpy.data.lights.new(name,'AREA');l.energy=energy;l.shape='DISK';l.size=size;l.color=color
    ob=stage_obj(name,l);ob.location=loc;ob.rotation_euler=(V((0,0,1))-ob.location).to_track_quat('-Z','Y').to_euler()
cam=stage_obj('Portrait camera',bpy.data.cameras.new('Portrait camera'))
cam.location=(3.25,-6.6,2.7);cam.rotation_euler=(V((0,-.02,1.03))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.65
scene.camera=cam
scene.world=bpy.data.worlds.new('Atelier world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.38,.46,.53,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
scene.render.engine='CYCLES';scene.cycles.samples=32
scene.view_settings.view_transform='AgX'
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'golfer-portrait.png')
scene['source_script']='tools/blender-golfer/build_golfer.py'
scene['animation_note']='Authored keyframes with anatomical limb planes, baked 60 fps. In-place locomotion and native quarter-turn root motion.'
report={'schema':1,'name':'Banvy Golfer','file':'banvy-golfer.glb','height':1.985,'forward':'+Z','bones':len(bonespec),'clips':manifest,
    'clubs':[{'id':n,'length':l} for n,l in [('Driver',1.08),('Wood',1.015),('Iron',.94),('Wedge',.88),('Putter',.84)]],
    'bytes':exportfile.stat().st_size,'vertices':len(body.data.vertices),'triangles':sum(len(p.vertices)-2 for p in body.data.polygons),
    'max_unreachable_grip_m':max(grip_errors,default=0),'status':'authored first pass; visual review required'}
(ASSET/'golfer.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
(OUT/'build-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
bpy.data.libraries.write(str(OUT/'banvy-golfer.blend'),{scene}|set(built_actions),fake_user=True)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
print(json.dumps(report))
