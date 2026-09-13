"""Five-species study. Fixed topology, bounded budgets, background Blender only."""
import bpy, math, random, json, sys, ast, hashlib, time
from types import SimpleNamespace
from pathlib import Path
from mathutils import Vector
assert bpy.app.background
HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[1]
sys.path.insert(0,str(HERE))
from pine_meshes import Mesh, material, linear, catmull, layout as pine_layout, build as pine_build
from foliage_envelopes import make_canopy
from branch_canopies import birch_layout, spruce_layout as branch_spruce_layout, make_branch_canopy
OUT=ROOT/'apps/golf/public/models/trees/foliage-study'
DOC=ROOT/'docs/graphics/tree-atelier-2026-09-13'
BUDGET={'hero':4500,'full':1700,'lite':420}
CONFIG={
 'tall':dict(name='Scots pine',swedish='Tall',colour=0x427823,atlas='needle-sprays.png'),
 'gran':dict(name='Norway spruce',swedish='Gran',colour=0x2f6532,atlas='gran-leaves.png',seed=10000,height=(12,24)),
 'bjork':dict(name='Silver birch',swedish='Björk',colour=0x6e992a,atlas='bjork-leaves.png',seed=5000,height=(12,20),fn='birch2'),
 'al':dict(name='Grey alder',swedish='Al',colour=0x397936,atlas='al-leaves.png',seed=7000,height=(10,16),fn='alder2'),
 'ek':dict(name='Pasture oak',swedish='Ek',colour=0x537e20,atlas='ek-leaves.png',seed=1000,height=(14,22),fn='oak2'),
}

scene=bpy.context.scene; scene.name='Ghibli | Five fluffy Swedish trees'
for ob in list(scene.objects):bpy.data.objects.remove(ob,do_unlink=True)

def broad_layout(key):
    cfg=CONFIG[key]; tubes=[]; clumps=[]; pads=[]
    def tube(bm,a,b,r0,r1,segs=8): tubes.append((a.copy(),b.copy(),r0,r1))
    def clump(bm,c,rx,ry,rz,seed,**kwargs): clumps.append((c.copy(),Vector((rx,ry,rz)),seed,0.))
    ns=dict(math=math,random=random,Vector=Vector,U=lambda r,a,b:r.uniform(a,b),tube=tube,clump=clump,
        bmesh=SimpleNamespace(new=lambda:None),new_obj=lambda *a,**k:None,
        finish_crown=lambda obj,centres,*args:pads.extend(centres),M={k:None for k in ['oak','bark','alder','greybark','birch','birchbark']})
    tree=ast.parse((HERE/'ghibli_catalog.py').read_text(encoding='utf-8'))
    fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==cfg['fn'])
    exec(compile(ast.Module(body=[fn],type_ignores=[]),'original-species-layout','exec'),ns)
    _,_,height=ns[cfg['fn']]((0,0,0),cfg['seed'],{'height':cfg['height']})
    assert len(clumps)<160 and len(tubes)<200
    return height,tubes,clumps,pads

def spruce_layout():
    rng=random.Random(10000); h=rng.uniform(12,24); tubes=[]; clumps=[]; pads=[]
    tubes.append((Vector((0,0,0)),Vector((h*.018,0,h*.985)),h*.025,h*.0018))
    for level in range(8):
        f=level/7; z=h*(.16+.77*f); radius=h*(.215*(1-f)**.88+.012)
        number=7 if level<5 else 5
        for j in range(number):
            a=j*math.tau/number+level*1.13+rng.uniform(-.17,.17)
            length=radius*rng.uniform(.88,1.1)
            b=Vector((h*.018*z/h,0,z))
            tip=b+Vector((math.cos(a)*length,math.sin(a)*length,-h*.027*(1-f)))
            tubes.append((b,tip,h*.007*(1-f*.7),h*.0015))
            c=b.lerp(tip,.65)+Vector((0,0,h*.012)); pads.append(c)
            clumps.append((c,Vector((length*.58,length*.26,h*(.044+.014*(1-f)))),10000+level*31+j,a))
        # Overlapping inner growth joins the boughs into a full conifer crown.
        clumps.append((Vector((h*.018*z/h,0,z+h*.018)),Vector((radius*.57,radius*.57,h*.073)),10800+level,0.))
    clumps.append((Vector((h*.018,0,h*.976)),Vector((h*.026,h*.026,h*.068)),10999,0.))
    return h,tubes,clumps,pads

def bark_colour(key,p,h,theta):
    if key=='bjork':
        colour=linear(0xd9dacc)
        # Short charcoal lenticels; broken angular coverage avoids rings.
        row=math.floor(p.z/(h*.027))
        patch=math.sin(theta*3.7+row*2.31)>.65 and (p.z/(h*.027))%1<.15
        factor=.28 if patch else .96+.04*math.sin(theta*2+p.z)
    else:
        colour=linear({'gran':0x795238,'al':0x6e5a45,'ek':0x745036}[key])
        factor=.88+.12*math.sin(theta*3+p.z*.35)**2
    return tuple(x*factor for x in colour)

def trunk_mesh(key,h,tubes,tier):
    mesh=Mesh(); i=0
    while i<len(tubes):
        a,b,r0,r1=tubes[i]; i+=1
        if a.z<.05 and b.z<1.1:continue # old separate root-flare segment
        if r0<h*{'hero':.005,'full':.01,'lite':.019}[tier]:continue
        points=[a,b]
        while i<len(tubes) and (b-tubes[i][0]).length<1e-5 and abs(r1-tubes[i][2])<1e-6:
            b=tubes[i][1];r1=tubes[i][3];points.append(b);i+=1
        main=r0>=h*.013
        sides=({'hero':8,'full':6,'lite':4}[tier] if main else {'hero':5,'full':4,'lite':3}[tier])
        if len(points)==2 and main:
            count=10 if tier=='hero' else 5 if tier=='full' else 2
            points=[a.lerp(b,j/count)+Vector((math.sin(j/count*math.pi)*h*.012,0,0)) for j in range(count+1)]
        elif len(points)>2:points=catmull(points,2 if tier=='hero' else 1)
        rows=[]
        for k,p in enumerate(points):
            tangent=(points[min(k+1,len(points)-1)]-points[max(0,k-1)]).normalized()
            u=tangent.cross(Vector((0,1,0))).normalized();v=tangent.cross(u).normalized()
            radius=(r0+(r1-r0)*k/(len(points)-1))*(1+.36*math.exp(-max(p.z,0)/.4))
            row=[]
            for j in range(sides):
                theta=j*math.tau/sides;n=u*math.cos(theta)+v*math.sin(theta);q=p+n*radius
                row.append(mesh.vert(q,n,bark_colour(key,q,h,theta)))
            rows.append(row)
        for ar,br in zip(rows,rows[1:]):
            for j in range(sides): mesh.faces.append((ar[j],ar[(j+1)%sides],br[(j+1)%sides],br[j]))
        mesh.faces.extend([tuple(reversed(rows[0])),tuple(rows[-1])])
    return mesh

def cluster_groups(clumps,limit):
    if len(clumps)<=limit:return clumps
    # Deterministic spatial grouping retains the outside bounds of the crown.
    centres=[max(clumps,key=lambda p:p[0].z)[0]]
    while len(centres)<limit:
        centres.append(max(clumps,key=lambda p:min((p[0]-c).length_squared for c in centres))[0])
    groups=[[] for _ in centres]
    for entry in clumps:groups[min(range(limit),key=lambda i:(entry[0]-centres[i]).length_squared)].append(entry)
    result=[]
    for entries in groups:
        # Rotated spruce bough bounds are expressed in world axes first.
        bounds=[]
        for c,r,seed,yaw in entries:
            ext=Vector((abs(math.cos(yaw))*r.x+abs(math.sin(yaw))*r.y,abs(math.sin(yaw))*r.x+abs(math.cos(yaw))*r.y,r.z))
            bounds.append((c-ext,c+ext))
        lo=Vector(tuple(min(b[0][k] for b in bounds) for k in range(3)))
        hi=Vector(tuple(max(b[1][k] for b in bounds) for k in range(3)))
        result.append(((lo+hi)*.5,(hi-lo)*.5,entries[0][2],0.))
    return result


def approved_pine_canopy(tier):
    before=set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(OUT/(tier+'.glb')))
    objects=[ob for ob in scene.objects if ob not in before]
    source=next(ob for ob in objects if ob.type=='MESH' and ob.name.startswith('crown'))
    data=source.data;mesh=Mesh();uv=[]
    normal_matrix=source.matrix_world.to_3x3().inverted().transposed()
    colours=data.color_attributes.active_color
    for vertex in data.vertices:
        colour=colours.data[vertex.index].color[:3] if colours and colours.domain=='POINT' else (1,1,1)
        mesh.vert(source.matrix_world@vertex.co,normal_matrix@vertex.normal,colour);uv.append((.25,.25))
    for loop in data.loops:
        i=loop.vertex_index
        if data.uv_layers.active:uv[i]=tuple(data.uv_layers.active.data[loop.index].uv)
        mesh.normals[i]=tuple((normal_matrix@data.corner_normals[loop.index].vector).normalized())
        if colours and colours.domain=='CORNER':mesh.colours[i]=tuple(colours.data[loop.index].color)
    mesh.faces=[tuple(p.vertices) for p in data.polygons]
    for ob in objects:bpy.data.objects.remove(ob,do_unlink=True)
    return mesh,uv

def foliage_material(key):
    cfg=CONFIG[key];m=material(cfg['name']+' | Leaves',linear(cfg['colour']));m.use_backface_culling=False;m.surface_render_method='DITHERED'
    image=bpy.data.images.load(str(OUT/cfg['atlas']));image.pack()
    nodes=m.node_tree.nodes;links=m.node_tree.links;bs=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage');tex.image=image
    mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
    links.new(bs.inputs['Base Color'].links[0].from_socket,mix.inputs[1]);links.new(tex.outputs['Color'],mix.inputs[2]);links.new(mix.outputs[0],bs.inputs['Base Color']);links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
    return m

start=time.monotonic(); report={'design':'five-species-painted-study','studyOnly':True,'budgets':BUDGET,'species':[]}

for index,key in enumerate(['tall','gran','bjork','al','ek']):
    cfg=CONFIG[key]
    if key=='tall':
        h,tubes,old_clumps,pads=pine_layout(9000)
        clumps=[(c,Vector(r),seed,0.) for c,r,seed,under in old_clumps]
    elif key=='gran':h,tubes,clumps,pads=branch_spruce_layout()
    elif key=='bjork':h,tubes,clumps,pads=birch_layout()
    else:h,tubes,clumps,pads=broad_layout(key)
    leaf=foliage_material(key);bark=material(cfg['name']+' | Bark',(1,1,1));entry={**cfg,'key':key,'height':h,'tiers':{}}
    for tier in ['hero','full','lite']:
        assert time.monotonic()-start<60,'Build time ceiling exceeded'
        if key=='tall':
            old,wood=pine_build(9000,tier,scene.collection,{'leaf':leaf,'bark':bark})
            trunk=Mesh()
            for vertex,colour in zip(wood.data.vertices,wood.data.color_attributes['Paint'].data):trunk.vert(vertex.co,vertex.normal,colour.color[:3])
            trunk.faces=[tuple(p.vertices) for p in wood.data.polygons]
            for ob in (old,wood):bpy.data.objects.remove(ob,do_unlink=True)
        else:trunk=trunk_mesh(key,h,tubes,tier)
        if key=='tall':canopy,uv=approved_pine_canopy(tier)
        else:
            builder=make_branch_canopy if key in ('gran','bjork') else make_canopy
            canopy,uv=builder(clumps,tier,BUDGET[tier]-trunk.triangles(),key,cfg.get('seed',9000),h)
        leaf_mat=leaf if tier!='lite' else material(cfg['name']+' | Distant foliage',linear(cfg['colour']))
        crown=canopy.object('crown',leaf_mat,scene.collection);wood=trunk.object('trunk',bark,scene.collection)
        attr=crown.data.uv_layers.new(name='UVMap')
        for loop in crown.data.loops:attr.data[loop.index].uv=uv[loop.vertex_index]
        tris=trunk.triangles()+canopy.triangles();assert tris<=BUDGET[tier],(key,tier,tris)
        bpy.ops.object.select_all(action='DESELECT')
        for ob in (crown,wood):ob.select_set(True)
        bpy.context.view_layer.objects.active=crown
        temp=OUT/f'{key}-{tier}.glb'
        bpy.ops.export_scene.gltf(filepath=str(temp),export_format='GLB',use_selection=True,export_yup=True,
            export_normals=True,export_texcoords=True,export_vertex_color='ACTIVE',export_materials='EXPORT',
            export_cameras=False,export_lights=False,export_animations=False,export_skins=False,export_morph=False)
        entry['tiers'][tier]={'file':temp.name,'triangles':tris,'crown':canopy.triangles(),'trunk':trunk.triangles(),
            'bytes':temp.stat().st_size,'sha256':hashlib.sha256(temp.read_bytes()).hexdigest()}
        print('SPECIES_PROGRESS',key,tier,tris,flush=True)
        if tier=='hero':
            for ob in (crown,wood):ob.location.x=(index-2)*18;ob.name=key+' | '+ob.name
        else:
            for ob in (crown,wood):bpy.data.objects.remove(ob,do_unlink=True)
    report['species'].append(entry)
report['buildSeconds']=round(time.monotonic()-start,2)
(OUT/'species-study.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(DOC/'species-build-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
from painted_blender_material import painted_material, birch_bark_material
birch_bark=birch_bark_material()
for key,cfg in CONFIG.items():
    brush=bpy.data.images.load(str(OUT/cfg['atlas']));brush.pack()
    paint=painted_material(cfg['name'],cfg['colour'],brush,key)
    for ob in scene.objects:
        if ob.type=='MESH' and ob.name.startswith(key+' | crown'):
            ob.data.materials.clear();ob.data.materials.append(paint)
        elif key=='bjork' and ob.type=='MESH' and ob.name.startswith('bjork | trunk'):
            ob.data.materials.clear();ob.data.materials.append(birch_bark)
world=bpy.data.worlds.new('Swedish study | Sky');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.74,.83,1);world.node_tree.nodes['Background'].inputs[1].default_value=.65;scene.world=world
bpy.ops.mesh.primitive_plane_add(size=250);bpy.context.object.location.z=-.05
bpy.context.object.data.materials.append(material('Swedish study | Paper',linear(0xdfe4d1),False))
bpy.ops.object.light_add(type='SUN',location=(0,0,30));bpy.context.object.data.energy=2.2
bpy.context.object.rotation_euler=Vector((10,10,-24)).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(20,-110,34));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,10))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=96;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.transparent_max_bounces=48
scene.render.resolution_x=2200;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene['preview_url']='http://localhost:5173/foliage-study.html'
bpy.ops.wm.save_as_mainfile(filepath=str(DOC/'fluffy-swedish-trees.blend'))
print('SPECIES_BUILD_COMPLETE',report['buildSeconds'],flush=True)
