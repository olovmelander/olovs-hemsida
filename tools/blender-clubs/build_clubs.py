"""Author original, unbranded reference-inspired clubs through the live Blender MCP.

node tools/blender-flag/blender-bridge.mjs tools/blender-clubs/build_clubs.py
The active work is left intact; this owns only the 'Banvy club atelier' scene.
Metres, Z up, head at origin; exported glTF uses Y up.
"""
import bpy, math, json, hashlib, runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/golf/public/models/clubs'
DOC = ROOT / 'docs/graphics/clubs'
OUT.mkdir(parents=True, exist_ok=True)
DOC.mkdir(parents=True, exist_ok=True)
previous_scene = bpy.context.window.scene
only_irons = globals().get('ONLY_IRONS', False)
only_woods = globals().get('ONLY_WOODS', False)
only_hybrid = globals().get('ONLY_HYBRID', False)
only_wedges = globals().get('ONLY_WEDGES', False)
only_putter = globals().get('ONLY_PUTTER', False)
if sum([only_irons,only_woods,only_hybrid,only_wedges,only_putter])>1:raise RuntimeError('Choose one partial build family')
partial = only_irons or only_woods or only_hybrid or only_wedges or only_putter
replace_keys = {'putter'} if only_putter else ({'pw','gw','sw','lw'} if only_wedges else ({'hybrid-4'} if only_hybrid else ({'iron-5','iron-6','iron-7','iron-8','iron-9'} if only_irons else {'driver','wood-3','wood-5'})))
old = bpy.data.scenes.get('Banvy club atelier')
if partial and not old and (DOC/'unbranded-clubs.blend').exists():
    with bpy.data.libraries.load(str(DOC/'unbranded-clubs.blend'),link=False) as (source,target):
        target.scenes=['Banvy club atelier']
    old=target.scenes[0]
if old and partial:
    for ob in list(old.objects):
        # The atelier is script-owned. Clear any unjoined intermediate geometry
        # left by a failed build as well as the selected family's exports.
        if ob.name.removeprefix('Club_') in replace_keys or not ob.name.startswith('Club_'):
            bpy.data.objects.remove(ob,do_unlink=True)
    scene=old
elif old:
    for ob in list(old.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    if previous_scene==old:previous_scene=None
    bpy.data.scenes.remove(old)
    scene=bpy.data.scenes.new('Banvy club atelier')
else:
    scene=bpy.data.scenes.new('Banvy club atelier')
bpy.context.window.scene = scene

def material(name, rgb, metal=0, rough=.3):
    m = bpy.data.materials.get('Club / '+name) or bpy.data.materials.new('Club / '+name)
    m.diffuse_color = (*rgb,1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb,1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    return m

chrome = material('polished steel', (.68,.72,.75), 1, .19)
satin = material('brushed steel', (.48,.52,.55), .94, .32)
face_mat = material('milled steel', (.39,.43,.46), .87, .4)
dark = material('graphite ceramic', (.022,.027,.030), .72, .27)
black = material('satin carbon', (.012,.017,.020), .4, .26)
rubber = material('rubber grip', (.019,.025,.024), 0, .8)
groove = material('recessed scorelines', (.06,.075,.081), .65, .48)
inlay = material('cavity shadow', (.30,.34,.37), .88, .42)
grip_detail = material('grip crosshatch', (.07,.08,.077), 0, .92)

def mesh(name, verts, faces, mat, bevel=0):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for p in me.polygons: p.use_smooth=True
    if bevel:
        mod = ob.modifiers.new('Soft machined edges', 'BEVEL')
        mod.width=bevel; mod.segments=3
        mod = ob.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL')
        mod.keep_sharp=True; mod.weight=40
    return ob

def smooth_outline(points, steps=5):
    result=[]
    for i,p1 in enumerate(points):
        p0,p2,p3=points[i-1],points[(i+1)%len(points)],points[(i+2)%len(points)]
        for k in range(steps):
            t=k/steps
            result.append(tuple(.5*((2*p1[d])+(-p0[d]+p2[d])*t+(2*p0[d]-5*p1[d]+4*p2[d]-p3[d])*t*t+(-p0[d]+3*p1[d]-3*p2[d]+p3[d])*t*t*t) for d in range(2)))
    return result

def plate(name, outline, front, back, mat, bevel=.0006):
    n=len(outline)
    verts=[(x,y,z) for y in [front,back] for x,z in outline]
    faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,verts,faces,mat,bevel)

def tube(name,a,b,r1,r2,mat,segments=32):
    direction=Vector(b)-Vector(a)
    bpy.ops.mesh.primitive_cone_add(vertices=segments,radius1=r1,radius2=r2,depth=direction.length,location=(Vector(a)+Vector(b))/2)
    ob=bpy.context.object; ob.name=name
    ob.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
    ob.data.materials.append(mat)
    for p in ob.data.polygons: p.use_smooth=True
    return ob

def line(name,points,radius,mat):
    cu=bpy.data.curves.new(name,'CURVE'); cu.dimensions='3D'
    cu.bevel_depth=radius; cu.bevel_resolution=2
    sp=cu.splines.new('POLY'); sp.points.add(len(points)-1)
    for p,co in zip(sp.points,points): p.co=(*co,1)
    ob=bpy.data.objects.new(name,cu); scene.collection.objects.link(ob); cu.materials.append(mat)
    return ob

def shaft(base, length, graphite=False, putter=False, integrated_neck=False, lie=None, ferrule_mat=None):
    axis=Vector((math.cos(math.radians(lie)),0,math.sin(math.radians(lie)))) if lie else Vector((.34 if not putter else .22,0,.94 if not putter else .976)).normalized()
    start=Vector(base)
    def at(t):return start+axis*t
    if not integrated_neck:tube('Hosel',at(-.009),at(.031),.0063,.0052,chrome if not graphite else dark)
    if integrated_neck:
        # Flush with the authored hosel; the old oversized collar and silver
        # band introduced two ledges where the iron should meet the shaft.
        tube('Ferrule',at(.031),at(.045),.0052,.00412,ferrule_mat or black,64)
    else:
        tube('Ferrule',at(.030),at(.045),.0055,.0044,black)
        tube('Ferrule silver ring',at(.033),at(.034),.0055,.0055,chrome)
    tube('Tapered shaft',at(.041),at(length),.004,.007,black if graphite else chrome)
    if not graphite:
        for i in range(8):
            t=.14+i*.052
            r=.004+.003*t/length
            tube('Steel shaft step',at(t),at(t+.002),r+.00015,r+.00015,satin,24)
    grip_start=length-.255
    tube('Tapered rubber grip',at(grip_start),at(length+.008),.009,.013 if not putter else .016,rubber)
    tube('Grip collar',at(grip_start),at(grip_start+.003),.0094,.0094,grip_detail)
    tube('Grip cap',at(length+.006),at(length+.012),.0133 if not putter else .0163,.0128 if not putter else .0158,rubber)
    side=Vector((axis.z,0,-axis.x)); tangent=Vector((0,1,0))
    for j in range(10):
        pts=[]
        for k in range(65):
            t=k/64; along=grip_start+.012+t*.234
            angle=j*math.tau/10+t*math.pi*1.7
            radius=.009+(.004 if not putter else .007)*((along-grip_start)/.263)+.00007
            pts.append(at(along)+(side*math.cos(angle)+tangent*math.sin(angle))*radius)
        line('Grip diagonal texture',pts,.00017,grip_detail)

def iron(loft, wedge=False):
    outline=smooth_outline([(-.046,.009),(-.049,.033),(-.039,.053 if wedge else .050),(-.018,.052 if wedge else .047),(.019,.032),(.035,.015),(.029,.005),(-.016,.002)])
    before=set(scene.objects)
    plate('Forged head',outline,-.005,.003,chrome,.0012)
    # A real open cavity: perimeter rim and sloping inner walls around a recessed floor.
    inner=[(x*.79,z*.70+.008) for x,z in outline]
    if not wedge:
        n=len(outline)
        verts=[(x,.010,z) for x,z in outline]+[(x,.010,z) for x,z in inner]+[(x,.0035,z) for x,z in inner]+[(x,.003,z) for x,z in outline]
        faces=[]
        for i in range(n):
            j=(i+1)%n
            faces.extend([(i,j,j+n,i+n),(i+n,j+n,j+n*2,i+n*2),(j,i,i+3*n,j+3*n)])
        mesh('Polished cavity perimeter',verts,faces,chrome,.0008)
        plate('Recessed cavity floor',inner,.0031,.004,inlay,.0002)
        plate('Brushed diagonal muscle',smooth_outline([(-.040,.010),(-.029,.018),(.021,.030),(.027,.023),(-.023,.008)],3),.0042,.009,satin,.0007)
        plate('Lower polished muscle',smooth_outline([(-.041,.009),(-.010,.005),(.023,.009),(.026,.017),(-.010,.012)],3),.004,.013,chrome,.0009)
    else:
        plate('Sculpted wedge muscle',smooth_outline([(-.044,.008),(-.034,.025),(.005,.023),(.028,.014),(.018,.004)],4),.003,.011,satin,.0014)
    hitting=[(x*.93,z*.94+.0013) for x,z in outline]
    plate('Blasted hitting face',hitting,-.00535,-.0051,face_mat,.00015)
    for i in range(12 if wedge else 11):
        z=.007+i*.0032
        cuts=[]
        for j,(x0,z0) in enumerate(hitting):
            x1,z1=hitting[(j+1)%len(hitting)]
            if min(z0,z1)<=z<max(z0,z1):cuts.append(x0+(x1-x0)*(z-z0)/(z1-z0))
        if len(cuts)>=2:
            left=max(-.040,min(cuts)+.004);right=min(.025,max(cuts)-.004)
            if right>left:line('Face scoreline',[(left,-.00565,z),(right,-.00565,z)],.00017,groove)
    for ob in set(scene.objects)-before:
        ob.rotation_euler.x=math.radians(-loft)
        ob.location.z=.011
    shaft((.034,.006,.030),.89-(loft-24)*.0015 if not wedge else .84-(loft-44)*.0008)

def wood(driver=True, hybrid=False, loft=10.5):
    sx=.062 if driver else (.046 if hybrid else .051)
    sy=.058 if driver else (.037 if hybrid else .044)
    sz=.029 if driver else (.018 if hybrid else .021)
    # Pear-shaped shell; truncated at the front to meet the independent striking face.
    verts=[]; rings=22; segments=64
    for j in range(rings+1):
        latitude=-math.pi/2+j/rings*math.pi
        c=math.cos(latitude)
        for i in range(segments):
            a=i/segments*math.tau
            x=sx*c*math.cos(a)*(1-.10*math.sin(a))
            y=max(-sy*.66,sy*c*math.sin(a))
            z=.033+sz*math.sin(latitude)*(.72 if latitude<0 else 1)
            verts.append((x,y,z))
    faces=[]
    for j in range(rings):
        for i in range(segments):
            a=j*segments+i; b=j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    body=mesh('Pear shaped crown and shell',verts,faces,black)
    # Curved face, with bulge and roll. Dark titanium, visibly separate from crown.
    verts=[]; nx=40; nz=16
    for j in range(nz+1):
        v=j/nz*2-1
        for i in range(nx+1):
            u=i/nx*2-1
            x=u*sx*.85
            z=.033+v*sz*.70*math.sqrt(1-.65*u*u)*(.72 if v<0 else 1)
            zz=(z-.033)/(sz*(.72 if v<0 else 1))
            y=max(-sy*.66,-sy*math.sqrt(max(.01,1-(x/sx)**2-zz**2)))-.00065
            verts.append((x,y,z))
    faces=[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i) for j in range(nz) for i in range(nx)]
    mesh('Curved titanium face',verts,faces,dark)
    # Close the rolled face perimeter back into the shell.
    boundary=list(range(nx+1))+[j*(nx+1)+nx for j in range(1,nz+1)]+[nz*(nx+1)+i for i in range(nx-1,-1,-1)]+[j*(nx+1) for j in range(nz-1,0,-1)]
    edge=[verts[i] for i in boundary]; n=len(edge)
    rimverts=edge+[(x,y+.0008,z) for x,y,z in edge]
    mesh('Face return edge',rimverts,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],dark)
    for j in range(-3,4):
        v=j/4
        for side in [-1,1]:
            pts=[]
            for i in range(17):
                u=side*(.26+i/16*.49)
                x=u*sx*.85
                z=.033+v*sz*.70*math.sqrt(1-.65*u*u)*(.72 if v<0 else 1)
                zz=(z-.033)/(sz*(.72 if v<0 else 1))
                y=max(-sy*.66,-sy*math.sqrt(max(.01,1-(x/sx)**2-zz**2)))-.00085
                pts.append((x,y,z))
            line('Wood face scorelines',pts,.00016,satin)
    # Sculpted central sole panel with polished rail accents, no text or emblems.
    panel_outline=[(-sx*.63,-sy*.30),(sx*.63,-sy*.30),(sx*.48,sy*.50),(0,sy*.78),(-sx*.48,sy*.50)]
    def sole_surface(name, triangles, mat, offset):
        v=[]; f=[]; steps=12
        for a,b,c in triangles:
            indices={}
            for i in range(steps+1):
                for j in range(steps+1-i):
                    u=i/steps;w=j/steps
                    x=a[0]*(1-u-w)+b[0]*u+c[0]*w;y=a[1]*(1-u-w)+b[1]*u+c[1]*w
                    z=.033-sz*.72*math.sqrt(max(.08,1-(x/sx)**2-(y/sy)**2))-offset
                    indices[i,j]=len(v);v.append((x,y,z))
            for i in range(steps):
                for j in range(steps-i):
                    f.append((indices[i,j],indices[i+1,j],indices[i,j+1]))
                    if j<steps-i-1:f.append((indices[i+1,j],indices[i+1,j+1],indices[i,j+1]))
        return mesh(name,v,f,mat)
    inner=[(x*.90,y*.90) for x,y in panel_outline]
    triangles=[]
    for i in range(5):
        j=(i+1)%5
        triangles.extend([(panel_outline[i],panel_outline[j],inner[i]),(inner[i],panel_outline[j],inner[j])])
    sole_surface('Angular sole perimeter',triangles,satin,.0008)
    sole_surface('Recessed graphite sole panel',[((0,sy*.08),inner[i],inner[(i+1)%5]) for i in range(5)],dark,.00065)
    # Sole rails follow the underside ellipsoid rather than floating above it.
    for sign in [-1,1]:
        pts=[]
        for i in range(28):
            y=-sy*.30+i/27*sy*.99; x=sign*sx*(.66-.26*(i/27))
            z=.033-sz*.72*math.sqrt(max(.08,1-(x/sx)**2-(y/sy)**2))-.0005
            pts.append((x,y,z))
        line('Silver sole rail',pts,.0017,chrome)
    weight_z=.033-sz*.72*math.sqrt(1-.65**2)-.002
    tube('Rear sole weight', (0,sy*.65,weight_z),(0,sy*.65,weight_z+.003),.009,.009,dark)
    tube('Weight port screw',(0,sy*.65,weight_z-.0002),(0,sy*.65,weight_z),.0024,.0024,satin,24)
    shaft((sx*.75,-sy*.38,.044),1.08 if driver else (.95 if hybrid else 1.01-(loft-15)*.005),True)

def putter():
    # Half-round mid-mallet footprint, stepped rear shoulders and slant neck.
    outline=[(-.050,-.012),(.050,-.012)]
    outline += [(.05*math.cos(i/36*math.pi),-.004+.041*math.sin(i/36*math.pi)) for i in range(37)]
    # Horizontal extrusion of the top outline (plate is defined in XZ).
    head=plate('Half round milled mallet',outline,-.012,.012,satin,.0016)
    head.rotation_euler.x=-math.pi/2; head.location.z=.017
    front=smooth_outline([(-.046,.006),(.046,.006),(.049,.009),(.049,.026),(.046,.028),(-.046,.028),(-.049,.026),(-.049,.009)],3)
    plate('Milled putter face',front,-.0128,-.0124,chrome,.0008)
    # Fine curved milling, authored geometry visible under grazing studio light.
    for i in range(95):
        x=-.046+i*.00098
        pts=[(x+.00045*math.sin(j/12*math.pi),-.0130,.009+j/12*.016) for j in range(13)]
        line('Putter milling',pts,.000065,face_mat)
    line('Single black alignment line',[(0,-.004,.0294),(0,.034,.0294)],.00055,black)
    for x in [-.033,.033]:
        tube('Recessed sole weight',(x,.005,.0037),(x,.005,.0042),.0075,.0075,chrome)
        tube('Sole weight fastener',(x,.005,.0034),(x,.005,.0038),.0023,.0023,dark,6)
    tube('Slant neck',(.037,-.003,.024),(.043,-.011,.051),.0044,.0044,chrome)
    shaft((.044,-.011,.052),.80,putter=True)

specs=[('driver','driver',10.5),('wood-3','fairway',15),('wood-5','fairway',18),('hybrid-4','hybrid',22),
       ('iron-5','iron',24.5),('iron-6','iron',27.5),('iron-7','iron',30.5),('iron-8','iron',34.5),('iron-9','iron',39),
       ('pw','wedge',44),('gw','wedge',50),('sw','wedge',56),('lw','wedge',60),('putter','putter',3.5)]
refined_iron=runpy.run_path(str(Path(__file__).with_name('iron_geometry.py')))['build_iron']
refined_wood=runpy.run_path(str(Path(__file__).with_name('wood_geometry.py')))['build_wood']
refined_wedge=runpy.run_path(str(Path(__file__).with_name('wedge_geometry.py')))['build_wedge']
refined_putter=runpy.run_path(str(Path(__file__).with_name('putter_geometry.py')))['build_putter']
catalogue=json.loads((OUT/'catalogue.json').read_text()) if partial else {}
audit=json.loads((DOC/'model-audit.json').read_text()) if partial else []
iron_audit=[]
wood_audit=[]
hybrid_audit=[]
wedge_audit=[]
putter_audit=[]
for index,(key,kind,loft) in enumerate(specs):
    if partial and key not in replace_keys:continue
    before=set(scene.objects)
    if kind=='iron':iron_audit.append(refined_iron(scene,loft,int(key[-1]),globals()))
    elif kind=='wedge':wedge_audit.append(refined_wedge(scene,key,loft,globals()))
    elif kind=='putter':putter_audit.append(refined_putter(scene,loft,globals()))
    elif kind in {'driver','fairway'}: wood_audit.append(refined_wood(scene,key,loft,globals()))
    elif kind=='hybrid': hybrid_audit.append(refined_wood(scene,key,loft,globals()))
    else:raise RuntimeError(f'Unsupported club kind: {kind}')
    objects=list(set(scene.objects)-before)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.convert(target='MESH')
    # Apply bevels before joining; one object with shared PBR materials per club.
    for ob in list(bpy.context.selected_objects):
        bpy.context.view_layer.objects.active=ob
        for mod in list(ob.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.join()
    ob=bpy.context.object; ob.name='Club_'+key
    bpy.context.scene.cursor.location=(0,0,0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # Correct normals on procedural closed geometry and smooth curved sections.
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    temp=OUT/(key+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(temp),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=False)
    digest=hashlib.sha256(temp.read_bytes()).hexdigest()[:12]
    dest=OUT/(key+'-'+digest+'.glb');temp.replace(dest)
    catalogue[key]={'file':'models/clubs/'+dest.name,'kind':kind,'loft':loft}
    audit=[entry for entry in audit if entry['id']!=key]
    audit.append({'id':key,'vertices':len(ob.data.vertices),'faces':len(ob.data.polygons),'bytes':dest.stat().st_size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
    ob.location.x=(index%7)*.24; ob.location.y=(index//7)*.42

# Save this scene on its own, without copying the user's unrelated Blender work.
if len(scene.objects)!=14:raise RuntimeError(f'Expected 14 finished clubs in the atelier, found {len(scene.objects)}')
world=bpy.data.worlds.new('Club studio world');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.23,.25,.27,1);scene.world=world
bpy.data.libraries.write(str(DOC/'unbranded-clubs.blend'),{scene},fake_user=True,compress=True)
(OUT/'catalogue.json').write_text(json.dumps(catalogue,indent=2)+'\n',encoding='utf-8')
(ROOT/'apps/golf/src/engine/club-assets.mjs').write_text('// Generated by tools/blender-clubs/build_clubs.py through Blender MCP.\nexport const CLUB_ASSETS = '+json.dumps(catalogue,indent=2)+';\n',encoding='utf-8')
(DOC/'model-audit.json').write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
for family,results in [('iron',iron_audit),('wood',wood_audit),('hybrid',hybrid_audit),('wedge',wedge_audit),('putter',putter_audit)]:
    if results:
        (DOC/(family+'-refinement')/'geometry-audit.json').parent.mkdir(exist_ok=True)
        (DOC/(family+'-refinement')/'geometry-audit.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
bpy.context.window.scene=previous_scene or scene
print(json.dumps({'clubs':len(audit),'bytes':sum(x['bytes'] for x in audit),'blend':str(DOC/'unbranded-clubs.blend'),'restoredScene':bpy.context.window.scene.name,'irons':iron_audit,'woods':wood_audit,'hybrids':hybrid_audit,'wedges':wedge_audit,'putters':putter_audit}))
