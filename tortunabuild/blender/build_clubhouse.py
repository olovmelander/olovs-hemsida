"""Run through mcp_client.py --exec; rebuild only our dedicated Blender scene.

The public GLB contains original geometry/materials, never the reference photos.
The .blend is a portable editable scene, written without changing the user's
current .blend file. Architectural details are interpreted, not survey controls.
"""
from pathlib import Path
import sys, math, json, hashlib
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tortunabuild/blender'))
import importlib
import architecture
importlib.reload(architecture)
from architecture import Architecture

OUT = ROOT/'tortunabuild/clubhouse'
CACHE = ROOT/'tortunabuild/cache/clubhouse-model'
CACHE.mkdir(parents=True, exist_ok=True)
parameters = json.loads((OUT/'model-parameters.json').read_text())
frame = parameters['frame']
anchor = frame['anchorEpsg3006RH2000']
name = 'Tortuna | Clubhouse architecture'
previous_scene = bpy.context.window.scene
owned = bpy.data.scenes.get(name)
if owned:
    if previous_scene == owned:
        previous_scene = next((s for s in bpy.data.scenes if s != owned), None)
        if previous_scene is None: previous_scene = bpy.data.scenes.new('Scene')
        bpy.context.window.scene = previous_scene
    for obj in list(owned.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(owned)
# Retire only unused data created by this builder, preserving every other scene.
for datablocks in [bpy.data.meshes,bpy.data.materials,bpy.data.collections,bpy.data.worlds,bpy.data.cameras,bpy.data.lights]:
    for block in list(datablocks):
        if block.name.startswith('Tortuna | ') and block.users == 0: datablocks.remove(block)
scene = bpy.data.scenes.new(name)
bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
collection = bpy.data.collections.new('Tortuna | Authored clubhouse')
scene.collection.children.link(collection)
A = Architecture(collection, anchor, frame['originEpsg3006'], frame['uSoutheast'], frame['vNortheast'])
for material, color, rough, metal in [
    ('Ochre timber','CBA548',.85,0), ('Timber battens','BC923B',.85,0),
    ('White trim','E8E8DE',.65,0), ('Roof tile','59473E',.88,0),
    ('Tile course','665046',.88,0), ('Roof flashing','655F59',.5,.25),
    ('Glass','344A4D',.22,.18), ('Foundation','7F7D73',.95,0),
    ('Metal rail','747E7C',.5,.5), ('Deck timber','847764',.9,0),
    ('Awning','D9D7C8',.95,0), ('Brick','8A5141',.95,0),
]: A.material(material,color,rough,metal)

body = parameters['body']
u0,u1,v0,v1 = (body[k] for k in ('uMin','uMax','vMin','vMax'))
base,eave,brk,ridge = (body[k] for k in ('baseRH2000','eaveRH2000','roofBreakRH2000','ridgeRH2000'))
roof = parameters['roof']
vb0,vb1,vr = (roof[k] for k in ('breakVMin','breakVMax','ridgeV'))
ur0,ur1 = roof['ridgeUMin'],roof['ridgeUMax']
gable = roof['crossGableHalfWidth']
uc = roof['crossGableU']
overhang=.27
eu0,eu1=roof['eaveUMin'],roof['eaveUMax']
ev0,ev1=roof['eaveVMin'],roof['eaveVMax']

# Main envelope. Windows are recessed dark panels with raised white surrounds;
# the roof is a planar architectural shell rather than a point triangulation.
A.box((u0,v0,base-.4),(u1,v1,base+.35),'Foundation')
A.box((u0,v0,base+.3),(u1,v1,eave),'Ochre timber')
# Full upper yellow short-end walls, with chamfered mansard shoulders.
for u in [u0,u1]:
    face=[(u,v0,eave),(u,v1,eave),(u,vb1,brk),(u,vb0,brk)]
    if u == u0: face.reverse()
    A.face(face,'Ochre timber')
    A.beam((u,v0,base+.3),(u,v0,eave),.18,'White trim')
    A.beam((u,v1,base+.3),(u,v1,eave),.18,'White trim')
    A.beam((u,v0,eave),(u,vb0,brk),.18,'White trim')
    A.beam((u,v1,eave),(u,vb1,brk),.18,'White trim')

# Hipped shallow upper roof, with an intersecting northeast central cross-gable.
R0=(ur0,vr,ridge); R1=(ur1,vr,ridge); C=(uc,vr,ridge)
B00=(eu0,vb0,brk); B10=(eu1,vb0,brk)
B01=(eu0,vb1,brk); B11=(eu1,vb1,brk)
A.roof([B00,R0,C,(uc-gable,vb0,brk)])
A.roof([C,R1,B10,(uc+gable,vb0,brk)])
A.roof([B00,R0,B01])
A.roof([B10,B11,R1])
A.roof([B01,R0,C,(uc-gable,vb1,brk)])
A.roof([C,R1,B11,(uc+gable,vb1,brk)])
for side in [-1,1]:
    x=uc+side*gable
    A.roof([C,(x,vb1,brk),(x,v1+overhang,brk),(uc,v1+overhang,ridge)])
    A.beam((x,v1+overhang,brk),(uc,v1+overhang,ridge),.17,'White trim')
A.box((uc-gable,v1-.02,eave),(uc+gable,v1+.05,brk),'Ochre timber')
A.face([(uc,v1+.05,ridge),(uc+gable,v1+.05,brk),(uc-gable,v1+.05,brk)],'Ochre timber')
for u in (uc-gable,uc+gable): A.beam((u,v1+.08,base+.35),(u,v1+.08,brk),.15,'White trim')

# South-west main skirt and the photographed small central projecting wing.
for left,right in [(eu0,uc-gable),(uc+gable,eu1)]:
    A.roof([(left,ev0,eave),(right,ev0,eave),(right,vb0,brk),(left,vb0,brk)])
wing=parameters['southwestWing']
w=gable; end=wing['vEnd']; wh=brk; wr=ridge
A.box((uc-w,end,base+.2),(uc+w,v0+.1,wh),'Ochre timber')
A.face([(uc+w,end,wh),(uc,end,wr),(uc-w,end,wh)],'Ochre timber')
for side in (-1,1):
    x=uc+side*w
    A.roof([C,(x,vb0,brk),(x,end-overhang,brk),(uc,end-overhang,ridge)])
    A.beam((x,end,wh),(uc,end,wr),.16,'White trim')
    A.beam((x,end,base+.3),(x,end,wh),.16,'White trim')
A.beam(C,(uc,end-overhang,ridge),.11,'Roof flashing')

# Northeast dormers. The skirt is genuinely cut around their faces.
dormers=roof['dormerU']; dw=.68
breakpoints=sorted(set([eu0,uc-gable,uc+gable,eu1]+[x+s*dw for x in dormers for s in (-1,1)]))
dh=eave+1.53
for left,right in zip(breakpoints,breakpoints[1:]):
    middle=(left+right)/2
    if uc-gable<middle<uc+gable: continue
    if any(abs(middle-x)<dw for x in dormers):
        A.roof([(left,vb1,brk),(right,vb1,brk),(right,v1+.05,dh+.17),(left,v1+.05,dh+.17)])
        continue
    A.roof([(left,vb1,brk),(right,vb1,brk),(right,ev1,eave),(left,ev1,eave)])
for u in dormers:
    A.box((u-dw,v1-.08,eave),(u+dw,v1+.07,dh),'Ochre timber')
    for x in (u-dw,u+dw):
        A.face([(x,v1,eave),(x,v1,dh+.17),(x,vb1,brk)],'Roof flashing')
        A.beam((x,vb1,brk),(x,v1+.12,dh+.17),.10,'White trim')
    A.beam((u-dw,v1+.12,dh+.17),(u+dw,v1+.12,dh+.17),.1,'White trim')
    A.window((u,v1+.07,eave+.18),.8,1.05)
    A.features['dormers']+=1

# White cornices and subtle vertical boarding, clipped away from openings.
for v in (v0,v1):
    A.beam((u0,v,base+.32),(u1,v,base+.32),.11,'White trim')
    A.beam((u0-overhang,v,eave),(u1+overhang,v,eave),.14,'White trim')
for u in (u0,u1): A.beam((u,vb0,brk),(u,vb1,brk),.17,'White trim')
long_windows = parameters['openings']['northeastGroundU']
upper_windows = parameters['openings']['centralUpperU']
for u in long_windows: A.window((u,v1,base+1.0),1.25,1.75)
for u in upper_windows: A.window((u,v1+.06,eave+.5),1.25,1.75)
for u in long_windows:
    if abs(u-uc)>w+.8: A.window((u,v0,base+1.0),1.2,1.65,sign=-1)
for v in parameters['openings']['pondUpperV']:
    A.window((u1,v,base+4.15),1.55,1.9,axis='u',door=v in parameters['openings']['pondDoorV'])
for v in parameters['openings']['entranceGroundV']:
    A.window((u0,v,base+.9),1.2,1.75,axis='u',sign=-1)
for v in parameters['openings']['entranceUpperV']:
    A.window((u0,v,base+4.05),1.2,1.65,axis='u',sign=-1)
A.window((uc,end,base+.25),1.45,2.35,sign=-1,door=True)
for u in [uc-3.1,uc+3.1]: A.window((u,end,base+.95),1.2,1.5,sign=-1)
for u in [uc-3.1,uc,uc+3.1]: A.window((u,end,eave+.15),1.35,1.85,sign=-1,door=u==uc)
# Courtyard upper porch wraps the projecting central wing; source photos show
# white timber rails, a raised entry gallery and short side landings.
gallery=30.7
for left,right,edge in [(u0,uc-w,v0),(uc-w,uc+w,end),(uc+w,u1,v0)]:
    A.box((left,edge-1.5,gallery-.17),(right,edge,gallery),'Deck timber')
    A.railing((left,edge-1.5),(right,edge-1.5),gallery,material='White trim')
    for u in [left,right]: A.beam((u,edge-1.5,base),(u,edge-1.5,gallery),.12,'White trim')
for u in (uc-w,uc+w):
    A.box((u-.55,end-1.5,gallery-.17),(u+.55,v0,gallery),'Deck timber')
    A.railing((u,end-1.5),(u,v0-1.5),gallery,material='White trim')

# Batten relief on selected photographed facades; avoid drawing over openings.
def battens_u(v,sign):
    n=int((u1-u0)/.19)
    for i in range(1,n):
        u=u0+i*(u1-u0)/n
        top = eave-.1
        zones=[(base+.4,top)]
        if any(abs(u-x)<.75 for x in long_windows): zones=[(base+.4,base+.87),(base+2.89,top)]
        for low,high in zones:
            if high>low: A.box((u-.012,min(v,v+sign*.025),low),(u+.012,max(v,v+sign*.025),high),'Timber battens')
battens_u(v1,1)
for u in (u0,u1):
    for i in range(1,int((v1-v0)/.2)):
        v=v0+i*.2
        if any(abs(v-x)<.9 for x in parameters['openings']['pondUpperV']):
            top=base+3.98
        else: top=min(brk-.13,eave+(min(v-v0,v1-v)*1.8))
        if u==u1: A.box((u,v-.012,base+.4),(u+.025,v+.012,top),'Timber battens')

# Pond-facing restaurant, raised deck, slim railings and the visible exterior stair.
terrace=parameters['terrace']
tu=terrace['uEnd']; tv0=terrace['vMin']; tv1=terrace['vMax']; deck=terrace['deckRH2000']
A.box((u1-.02,tv0,base-.1),(tu,tv1,deck-.22),'Ochre timber')
A.box((u1,tv0,deck-.22),(tu,tv1,deck),'White trim')
A.box((u1+.03,tv0+.08,deck),(tu-.06,tv1-.06,deck+.035),'Deck timber')
A.railing((tu,tv0),(tu,tv1-1.2),deck)
A.railing((u1,tv0),(tu,tv0),deck)
# Stair descends along the end face of the restaurant as in the pond photo.
stair_v0=tv1; stair_v1=tv1-5.9; count=20
for i in range(count):
    low=stair_v0+(stair_v1-stair_v0)*i/count
    high=stair_v0+(stair_v1-stair_v0)*(i+1)/count
    z=deck-(deck-base)*i/count
    A.box((tu+.12,min(low,high),z-.09),(tu+1.32,max(low,high),z),'Metal rail')
for x in [tu+.12,tu+1.32]:
    A.beam((x,stair_v0,deck-.1),(x,stair_v1,base-.1),.12,'Metal rail')
    A.beam((x,stair_v0,deck+.96),(x,stair_v1,base+.96),.055,'Metal rail')
    for i in range(0,count+1,3):
        t=i/count; v=stair_v0+(stair_v1-stair_v0)*t; z=deck+(base-deck)*t
        A.beam((x,v,z),(x,v,z+.96),.035,'Metal rail')
A.railing((u1,tv1),(tu,tv1),deck)
A.window((tu,tv1-2,base+.12),1.0,2.25,axis='u',door=True)
for v in [tv0+1.7,tv0+4.0]: A.window((tu,v,base+1.05),1.65,1.2,axis='u')
# Low adjacent tiled canopy / retractable cream awning (geometry estimate).
awning=parameters['awning']
av0,av1=awning['vMin'],awning['vMax']
au=awning['uEnd']; ah=awning['topRH2000']
A.roof([(u1,av0,ah+.23),(tu,av0,ah+.23),(tu,av1,ah),(u1,av1,ah)],'Roof tile')
A.roof([(tu,av0,ah),(au,av0,ah-.35),(au,av1,ah-.35),(tu,av1,ah)],'Awning',seams=False)
A.box((u1,v0,base-.1),(tu,tv0,ah-.16),'Ochre timber')
for v in [-3.7,-1.5]: A.window((tu,v,base+1.05),1.55,1.2,axis='u')
A.box((tu,av0,base),(au+.25,av1,base+.09),'Deck timber')
A.beam((au,av0,ah-.35),(au,av1,ah-.35),.10,'White trim')
for v in [av0,av1]: A.beam((au,v,base+.1),(au,v,ah-.35),.06,'Metal rail')

# Roof vents/chimneys visible in the drone and orthophoto references.
for c in parameters['roofObjects']:
    u,v,z=c['center']; w,d,h=c['size']
    A.box((u-w/2,v-d/2,z),(u+w/2,v+d/2,z+h),c['material'])
    A.box((u-w/2-.1,v-d/2-.1,z+h),(u+w/2+.1,v+d/2+.1,z+h+.1),'Roof flashing')
for a,b in [(R0,C),(C,R1),(B00,R0),(B01,R0),(B10,R1),(B11,R1),(C,(uc,v1+overhang,ridge))]:
    A.beam(a,b,.11,'Roof flashing')

objects=A.build()
for obj in objects:
    obj['buildingId']='way/1163533127'
    obj['appearanceStatus']='photo-informed-display-model'
    obj['metres']=True
    obj.select_set(True)
scene['anchorEpsg3006RH2000']=anchor
scene['evidence']='tortunabuild/clubhouse/reference-review.md; geometry-evidence.json; model-parameters.json'
scene['sourceFootprintUnchanged']=True

# Export only the authored mesh collection. Blender's normal glTF conversion is
# x=east,y=up,z=south; runtime only adds the explicit geographic anchor.
export_path=CACHE/'clubhouse.glb'
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.export_scene.gltf(filepath=str(export_path),export_format='GLB',use_selection=True,use_active_scene=True,
                          export_yup=True,export_apply=True,export_animations=False,
                          export_cameras=False,export_lights=False,export_extras=True,
                          export_materials='EXPORT')
payload=export_path.read_bytes(); sha=hashlib.sha256(payload).hexdigest()
public=ROOT/'apps/golf/public/courses/tortuna/architecture'
public.mkdir(parents=True,exist_ok=True)
(public/(sha+'.glb')).write_bytes(payload)

# Neutral studio lights are Blender-only review aids, excluded from the GLB.
world=bpy.data.worlds.new('Tortuna | Review world'); scene.world=world
world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.19,.22,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.6
def light(name,position,energy,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=position
    obj.rotation_euler=(Vector((0,0,4))-obj.location).to_track_quat('-Z','Y').to_euler()
light('Tortuna | Key',(10,-25,40),35000,30)
light('Tortuna | Fill',(-25,10,25),18000,25)
camera_data=bpy.data.cameras.new('Tortuna | Review camera')
camera=bpy.data.objects.new('Tortuna | Review camera',camera_data)
scene.collection.objects.link(camera);scene.camera=camera
camera_data.type='ORTHO';camera_data.ortho_scale=53
def worldpoint(u,v,z):
    return Vector((frame['originEpsg3006'][0]+u*frame['uSoutheast'][0]+v*frame['vNortheast'][0]-anchor[0],
                   frame['originEpsg3006'][1]+u*frame['uSoutheast'][1]+v*frame['vNortheast'][1]-anchor[1],z-anchor[2]))
camera.location=worldpoint(48,52,55)
camera.rotation_euler=(worldpoint(2,2,31.2)-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
scene.render.filepath=str(OUT/'clubhouse-blender-')
bpy.data.libraries.write(str(OUT/'tortuna-clubhouse.blend'),{scene},path_remap='RELATIVE',fake_user=True,compress=True)
counts={'meshes':len(objects),'vertices':sum(len(o.data.vertices) for o in objects),
        'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects),
        'features':dict(A.features)}
receipt={'schemaVersion':1,'asset':{'url':f'courses/tortuna/architecture/{sha}.glb','sha256':sha,'bytes':len(payload)},
         'anchorEpsg3006RH2000':anchor,'blenderVersion':bpy.app.version_string,**counts,
         'coordinateConvention':'Blender X=east,Y=north,Z=up; glTF X=east,Y=up,Z=south; metres relative to anchor',
         'sourceFootprintUnchanged':True,'sourceTinUnchanged':True,'photosEmbedded':False}
(OUT/'model-export.json').write_bytes((json.dumps(receipt,indent=2)+'\n').encode('utf8'))
print(json.dumps(receipt))
