"""Replace the blockout with a tailored golfer based on Blender Studio's CC0 anatomy.

Requires build_golfer.py and output/golfer-source/human_base_meshes_bundle.blend.
Only modifies Banvy's generated atelier. The sculptable source and 20 actions are retained.
"""
import bpy, bmesh, math, json, hashlib
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/graphics/golfer-2026-09-16'
ASSET=ROOT/'experiments/golfer/assets'
MALE=globals().get('GOLFER_VARIANT')=='male'
scene=globals().get('CHARACTER_SCENE') or bpy.data.scenes['Banvy | Golfer atelier'];bpy.context.window.scene=scene
rig=globals().get('CHARACTER_RIG') or scene.objects['Golfer_Rig'];rig.animation_data.action=None
actions=globals().get('CHARACTER_ACTIONS') or [a for a in bpy.data.actions if a.get('banvy_golfer') and not a.get('banvy_character')]
def clip_name(action):return action.get('clip_name',action.name)
def is_club(ob):return ob.name.startswith('Club_') or bool(ob.get('club_id'))
def club_id(ob):return ob.get('club_id',ob.name.removeprefix('Club_'))
for pb in rig.pose.bones: pb.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update()
collection=rig.users_collection[0]
for ob in list(collection.objects):
    if ob.type=='MESH' and not is_club(ob): bpy.data.objects.remove(ob,do_unlink=True)
V=Vector;pi=math.pi

def material(name,code,rough=.75,metal=0):
    m=bpy.data.materials.new('Golfer refined | '+name);m.use_nodes=True
    c=[int(code[i:i+2],16)/255 for i in (0,2,4)];rgb=[x/12.92 if x<.04045 else ((x+.055)/1.055)**2.4 for x in c]
    m.diffuse_color=(*rgb,1)
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*rgb,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
    return m
skin=material('Warm peach skin','c99270' if MALE else 'dca080',.84)
pink=material('Sage pique' if MALE else 'Raspberry pique','71917b' if MALE else 'c64173',.86)
pinklight=material('Raised stitching','bdc7a7' if MALE else 'ec97b0',.92)
pinkdark=material('Forest seams' if MALE else 'Rose shadow seams','304f43' if MALE else '8c2b53',.91)
ivory=material('Ivory performance jersey','f1eddf',.87)
hair=material('Sculpted chestnut hair','392b2b',.74)
hairlight=material('Hair ridges','564036',.81)
solemat=material('Forest charcoal rubber','303f3d',.82)
iris=material('Amber hazel eyes','755332',.47)
black=material('Ink lashes and pupils','201e25',.47)
eyewhite=material('Warm sclera','f1e9e0',.40)
lip=material('Muted rose lips','a56f5c' if MALE else 'b86462',.8)
metal=material('Satin metal','aeb8ba',.33,.72)
lens=material('Smoky plum lenses','2e283d',.14,.3)
created=[]

def mesh(name,vs,fs,mat,weights=None):
    d=bpy.data.meshes.new(name);d.from_pydata(vs,[],fs);d.update()
    o=bpy.data.objects.new(name,d);collection.objects.link(o);d.materials.append(mat)
    for f in d.polygons:f.use_smooth=True
    if weights:
        groups={}
        for i,ws in enumerate(weights):
            for n,w in ws.items():
                if w<=0:continue
                if n not in groups:groups[n]=o.vertex_groups.new(name=n)
                groups[n].add([i],w,'REPLACE')
    created.append(o);return o

def tube(name,points,radii,mat,bone='Head',sides=12):
    vs=[];fs=[];ws=[]
    for i,p in enumerate(points):
        tangent=(V(points[min(i+1,len(points)-1)])-V(points[max(0,i-1)])).normalized()
        ref=V((1,0,0)) if abs(tangent.x)<.9 else V((0,1,0))
        u=(ref-tangent*tangent.dot(ref)).normalized();v=tangent.cross(u)
        rx,ry=radii[i] if isinstance(radii[i],tuple) else (radii[i],radii[i])
        for j in range(sides):
            a=2*pi*j/sides;vs.append(V(p)+u*rx*math.cos(a)+v*ry*math.sin(a));ws.append({bone:1})
    for i in range(len(points)-1):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides;fs.append((a,b,b+sides,a+sides))
    fs.extend([tuple(reversed(range(sides))),tuple((len(points)-1)*sides+j for j in range(sides))])
    return mesh(name,vs,fs,mat,ws)

def ellipsoid(name,c,scale,mat,bone='Head',seg=32,lat=16):
    vs=[];fs=[]
    for j in range(lat+1):
        a=pi*j/lat
        for i in range(seg):
            b=2*pi*i/seg;vs.append(V(c)+V((scale[0]*math.sin(a)*math.cos(b),scale[1]*math.sin(a)*math.sin(b),scale[2]*math.cos(a))))
    for j in range(lat):
        for i in range(seg):
            a=j*seg+i;b=j*seg+(i+1)%seg;fs.append((a,b,b+seg,a+seg))
    return mesh(name,vs,fs,mat,[{bone:1}]*len(vs))

def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)
def mix(a,b,t):return a+(b-a)*t
def mapz(z):
    rows=[(-.004,.016),(.085,.105),(.48,.545),(.84,.98),(1.0,1.16),(1.20,1.43),(1.29,1.565),(1.34,1.64),(1.4633,1.80),(1.6132,1.985)]
    for (a,b),(c,d) in zip(rows,rows[1:]):
        if z<=c:return mix(b,d,(z-a)/(c-a))
    return 1.985+(z-1.6132)*1.15

source=ROOT/'output/golfer-source/human_base_meshes_bundle.blend'
with bpy.data.libraries.load(str(source),link=False) as (src,dst):
    dst.objects=['GEO-body_male_stylized' if MALE else 'GEO-body_female_stylized']
base=dst.objects[0];base.name='Source | Blender Studio stylized '+('male' if MALE else 'female')+' CC0'
raw=[v.co.copy() for v in base.data.vertices]
faces=[tuple(p.vertices) for p in base.data.polygons]
sets=[d.value for d in base.data.attributes['.sculpt_face_set'].data]

# Normalize the male sculpt to the same joint landmarks, retaining its authored
# jaw, chest and limb volume. Both bodies then share the locomotion/club contract.
def male_normalize(p):
    rows=[(-.004,-.004),(.10,.085),(.485,.48),(.84,.84),(1.05,1.0),(1.34,1.20),(1.448,1.29),(1.49,1.34),(1.63,1.4633),(1.79418,1.6132)]
    z=1.6132
    for (a,b),(c,d) in zip(rows,rows[1:]):
        if p.z<=c:z=mix(b,d,(p.z-a)/(c-a));break
    width=mix(.82,.92,smooth((p.z-.85)/.35))
    width=mix(width,1.10,smooth((p.z-1.40)/.12))
    if abs(p.x)>.21:width=.82
    return V((p.x*width,p.y*.94,z))
if MALE:raw=[male_normalize(p) for p in raw]

# Fit the artist-authored anatomy to the existing animation skeleton using the
# source's anatomical face sets. Neighbouring vertices receive blended transforms.
srcbones={
 'UpperArm':(V((.15,.014,1.23)),V((.235,.016,1.066))),
 'Forearm':(V((.235,.016,1.066)),V((.321,-.003,.885))),
 'Hand':(V((.321,-.003,.885)),V((.345,-.012,.795))),
}
if MALE:
    srcbones={k:tuple(male_normalize(V(p)) for p in points) for k,points in {
        'UpperArm':((.212,.032,1.376),(.311,.032,1.154)),
        'Forearm':((.311,.032,1.154),(.408,.012,.938)),
        'Hand':((.408,.012,.938),(.421,-.006,.823)),
    }.items()}
members=[set() for _ in raw]
for f,g in zip(faces,sets):
    for i in f:members[i].add(g)
armsets={262,263,273,272,274,275,276,277,278,279,280,281,282,283,284,285,286,359}

def arm_map(p,part,s):
    a,b=srcbones[part];a=V((s*a.x,a.y,a.z));b=V((s*b.x,b.y,b.z))
    bone=rig.data.bones[part+'_'+('L' if s>0 else 'R')]
    a2=bone.head_local;b2=bone.tail_local
    rotation=(b-a).normalized().rotation_difference((b2-a2).normalized())
    # Slim, athletic arms. The axial fit preserves elbow/wrist alignment.
    axis=(b-a).normalized();t=(p-a).dot(axis);side=(p-a)-axis*t
    axial=.78 if part=='Hand' else (b2-a2).length/(b-a).length
    return a2+rotation@(axis*t*axial+side*1.03)

def transform(p,groups=None):
    s=1 if p.x>=0 else -1
    shoulder_width=.33*math.exp(-((p.z-1.21)/.085)**2)
    out=V((p.x*(1.19+shoulder_width),p.y*1.08,mapz(p.z)))
    if groups and groups&armsets:
        if p.z>1.04:
            upper=arm_map(p,'UpperArm',s);fore=arm_map(p,'Forearm',s)
            a=smooth((1.10-p.z)/.085);mapped=upper.lerp(fore,a)
        elif p.z>.85:
            fore=arm_map(p,'Forearm',s);hand=arm_map(p,'Hand',s)
            a=smooth((.92-p.z)/.065);mapped=fore.lerp(hand,a)
        else:mapped=arm_map(p,'Hand',s)
        a=smooth((abs(p.x)-.128)/.075);out=out.lerp(mapped,a)
    return out

def nearest_weights(p):
    if p.z>1.65:return {'Head':1}
    if p.z>1.54 and abs(p.x)<.095:
        t=smooth((p.z-1.55)/.10);return {'Neck':1-t,'Head':t}
    if abs(p.x)>.255 and p.z>.8:
        side='L' if p.x>0 else 'R';names=['UpperArm_'+side,'Forearm_'+side,'Hand_'+side]
    elif p.z<.98:
        side='L' if p.x>0 else 'R';names=['Hips','Thigh_'+side,'Shin_'+side,'Foot_'+side]
    else:names=['Hips','Spine','Chest','Neck']+(['UpperArm_L' if p.x>0 else 'UpperArm_R'] if abs(p.x)>.14 else [])
    scores=[]
    for n in names:
        b=rig.data.bones[n];a=b.head_local;d=b.tail_local-a
        t=max(0,min(1,(p-a).dot(d)/d.length_squared))
        dist=(p-(a+d*t)).length
        scores.append((dist,n))
    scores.sort();selected=scores[:2]
    # Compact influence neighbourhood reduces rubbery shoulders and knees.
    values=[1/max(.013,d)**4 for d,n in selected];total=sum(values)
    return {n:w/total for (d,n),w in zip(selected,values)}

verts=[transform(p,members[i]) for i,p in enumerate(raw)]
fitted_normals=None
if MALE:
    fitted=bpy.data.meshes.new('Male fitted normals');fitted.from_pydata(verts,[],faces);fitted.update()
    fitted_normals=[v.normal.copy() for v in fitted.vertices];bpy.data.meshes.remove(fitted)
weights=[]
for i,p in enumerate(verts):
    if members[i]&armsets:
        side='L' if raw[i].x>0 else 'R'
        if raw[i].z<.905:
            t=smooth((.905-raw[i].z)/.025)
            weights.append({'Hand_'+side:t,'Forearm_'+side:1-t})
        else:
            t=smooth((1.10-raw[i].z)/.08)
            chest=(1-smooth((abs(raw[i].x)-.135)/.11))*smooth((raw[i].z-1.10)/.13)
            weights.append({'Chest':chest,'UpperArm_'+side:(1-t)*(1-chest),'Forearm_'+side:t*(1-chest)})
    else:weights.append(nearest_weights(p))

# Fit the existing finger controls to the new hand topology. Their baked rest
# transforms were identity, so the main limb clips remain compatible.
digits=[(278,283,282),(277,279,272),(280,274,275),(281,286,276)]
fingerbind={}
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for s,side in [(1,'L'),(-1,'R')]:
    for j,groups in enumerate(digits+[(359,285,284)]):
        allids=[i for i,g in enumerate(members) if g.intersection(groups) and raw[i].x*s>0]
        proximal=[i for i in allids if groups[0] in members[i]]
        distal=[i for i in allids if groups[-1] in members[i]]
        def mean_end(ids,top):
            zs=[raw[i].z for i in ids];limit=mix(min(zs),max(zs),.75 if top else .25)
            chosen=[i for i in ids if (raw[i].z>=limit if top else raw[i].z<=limit)]
            return sum((verts[i] for i in chosen),V())/len(chosen)
        a=mean_end(proximal,True);b=mean_end(proximal,False);c=mean_end(distal,False)
        n1=('ThumbA_' if j==4 else 'Finger%dA_'%j)+side
        n2=('ThumbB_' if j==4 else 'Finger%dB_'%j)+side
        rig.data.edit_bones[n1].head=a;rig.data.edit_bones[n1].tail=b
        rig.data.edit_bones[n2].head=b;rig.data.edit_bones[n2].tail=c
        z1=max(raw[i].z for i in proximal);z2=min(raw[i].z for i in proximal)
        for i in allids:
            t=smooth((z2+.009-raw[i].z)/.018)
            palm=1-smooth((z1-raw[i].z)/.015)
            weights[i]={'Hand_'+side:palm,n1:(1-palm)*(1-t),n2:(1-palm)*t}
        fingerbind[n1]=(s,j,False);fingerbind[n2]=(s,j,True)
bpy.ops.object.mode_set(mode='OBJECT')
for action in actions:
    gripping=clip_name(action).startswith(('Address','Swing')) or clip_name(action) in ['Putt','ChipWedge']
    for slot in action.slots:
        for layer in action.layers:
            for strip in layer.strips:
                bag=strip.channelbag(slot)
                if not bag:continue
                for n,(s,j,distal) in fingerbind.items():
                    fist=gripping or s<0 or clip_name(action)=='Celebrate'
                    angle=(1.0 if distal else .72) if fist else (.24 if distal else .12)
                    if j==4:angle*=.5
                    axis=rig.data.bones[n].matrix_local.to_quaternion().inverted()@V((0,s,0))
                    q=Quaternion(axis,angle)
                    for fc in bag.fcurves:
                        if fc.data_path=='pose.bones["'+n+'"].rotation_quaternion':
                            for key in fc.keyframe_points:key.co.y=q[fc.array_index]

# Recreate artist-authored skin without the torso/upper legs hidden by clothing.
# Covered geometry stays in the editable source; the runtime avoids poke-through.
skinfaces=[];skinsets=[]
for f,g in zip(faces,sets):
    c=sum((raw[i] for i in f),V())/len(f)
    if g in {258,259,260} or (g==263 and (not MALE or c.z>1.12)) or (g==262 and not MALE):continue
    if g==256 and c.z>.62:continue
    if MALE and g in {256,257}:continue
    if MALE and g in armsets-{262,263} and c.x>0:continue
    if g==6 and c.z<(1.265 if MALE else 1.295):continue
    if g in {288,316,317,318,319,320,321,322}:continue
    skinfaces.append(f);skinsets.append(g)
body=mesh('Golfer | sculpted face, hands and legs',verts,skinfaces,skin,weights)
body.data.materials.append(lip)
# The original mouth topology carries the lips; subtle shading stays inside it.
for poly,g in zip(body.data.polygons,skinsets):
    c=sum((raw[i] for i in poly.vertices),V())/len(poly.vertices)
    if g in {47,48} and c.y<-.125:poly.material_index=1

def garment(name,choose,mat,offset=.01,smoothing=4):
    chosen=[f for f,g in zip(faces,sets) if choose(g,sum((raw[i] for i in f),V())/len(f))]
    used=sorted({i for f in chosen for i in f});mapping={i:j for j,i in enumerate(used)}
    points=[]
    for i in used:
        p=verts[i].copy();normal=fitted_normals[i] if fitted_normals else base.data.vertices[i].normal.copy()
        p+=normal*offset
        points.append(p)
    obj=mesh(name,points,[tuple(mapping[i] for i in f) for f in chosen],mat,[weights[i] for i in used])
    # One smoothing pass turns the anatomical surface into fabric, then the
    # solidified edge makes actual collars/cuffs instead of floating planes.
    bpy.context.view_layer.objects.active=obj
    if smoothing:
        mod=obj.modifiers.new('Tailored cloth smoothing','SMOOTH');mod.factor=.7;mod.iterations=smoothing
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bm=bmesh.new();bm.from_mesh(obj.data)
    boundary={v for e in bm.edges if e.is_boundary for v in e.verts}
    while boundary:
        seed=boundary.pop();loop={seed};todo=[seed]
        while todo:
            v=todo.pop()
            for edge in v.link_edges:
                if edge.is_boundary:
                    other=edge.other_vert(v)
                    if other in boundary:boundary.remove(other);loop.add(other);todo.append(other)
        if len(loop)<5:continue
        centre=sum((v.co for v in loop),V())/len(loop)
        if abs(centre.x)>.23:
            n='UpperArm_'+('L' if centre.x>0 else 'R') if centre.z>1.15 else 'Forearm_'+('L' if centre.x>0 else 'R')
            b=rig.data.bones[n];normal=(b.tail_local-b.head_local).normalized()
        else:normal=V((0,0,1))
        for v in loop:v.co-=normal*(v.co-centre).dot(normal)
    bm.to_mesh(obj.data);bm.free()
    sol=obj.modifiers.new('Sewn edge','SOLIDIFY');sol.thickness=.003;sol.offset=0
    bpy.ops.object.modifier_apply(modifier=sol.name)
    return obj

polo=garment('Polo | shaped torso and sleeves',lambda g,c:(g in {258,259,260} and c.z>.918) or (g==263 and c.z>1.10) or (g==6 and c.z<1.29),pink,.016)
sleeves=None if MALE else garment('Polo | ivory undersleeves',lambda g,c:g in {262,263} and c.z<1.135,ivory,.008)
if MALE:
    # The cuff is woven into the sleeve surface, so it cannot intersect it.
    polo.data.materials.append(ivory)
    bm=bmesh.new();bm.from_mesh(polo.data)
    for side in ['L','R']:
        bone=rig.data.bones['UpperArm_'+side];axis=bone.tail_local-bone.head_local
        cutoff=bone.head_local+axis*.60;axis.normalize()
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=cutoff,plane_no=axis)
        for face in bm.faces:
            c=face.calc_center_median()
            if (c.x>0)==(side=='L') and abs(c.x)>.26 and (c-cutoff).dot(axis)>.00001:face.material_index=1
    bm.to_mesh(polo.data);bm.free();polo.data.update()
for cloth in [o for o in [polo,sleeves] if o is not None]:
    neighbours=[set() for _ in cloth.data.vertices]
    for edge in cloth.data.edges:
        a,b=edge.vertices;neighbours[a].add(b);neighbours[b].add(a)
    values=[{g.group:g.weight for g in v.groups} for v in cloth.data.vertices]
    for _ in range(5):
        updated=[]
        for i,ws in enumerate(values):
            avg={g:w*.4 for g,w in ws.items()}
            if neighbours[i]:
                for j in neighbours[i]:
                    for g,w in values[j].items():avg[g]=avg.get(g,0)+w*.6/len(neighbours[i])
            total=sum(avg.values());updated.append({g:w/total for g,w in avg.items()})
        values=updated
    for i,ws in enumerate(values):
        for g,w in ws.items():cloth.vertex_groups[g].add([i],w,'REPLACE')
# On the course, a smooth collar and placket read more clearly than noisy texture.
collarpts=[]
for i in range(41):
    a=2*pi*i/40;collarpts.append(((.098 if MALE else .078)*math.cos(a),-.008+(.078 if MALE else .063)*math.sin(a),1.565+.022*(1+math.sin(a))))
tube('Polo | collar roll',collarpts,[(.008,.014)]*len(collarpts),pink,'Chest',12)
for s in [-1,1]:
    vs=[(s*.008,-.077,1.568),(s*.067,-.067,1.576),(s*.105,-.118,1.50),(s*.035,-.135,1.482)]
    leaf=mesh('Polo | collar point',vs,[(0,1,2,3)],pink,[{'Chest':1}]*4)
    sol=leaf.modifiers.new('Collar thickness','SOLIDIFY');sol.thickness=.005
    bpy.context.view_layer.objects.active=leaf;bpy.ops.object.modifier_apply(modifier=sol.name)
    tube('Polo | collar stitch',[vs[1],vs[2],vs[3]],[.0013]*3,pinklight,'Chest',8)
tube('Polo | button placket',[(0,-.13,1.488),(0,-.157,1.428),(0,-.163,1.39)],[(.015,.004)]*3,pinkdark,'Chest',12)
for z,y in [(1.46,-.148),(1.427,-.164),(1.397,-.17)]:ellipsoid('Polo | pearl button',(0,y,z),(.0045,.002,.0045),ivory,'Chest',12,8)

if not MALE:
    # A flared, pleated skort, with an original woven check built as a Blender image.
    plaid=material('Woven raspberry check','ffffff',.96)
    image=bpy.data.images.new('Golfer | woven check',width=512,height=512)
    pixels=[]
    palette=[(.91,.70,.74),(.97,.91,.84),(.73,.29,.43)]
    for y in range(512):
        for x in range(512):
            u=x%128;v=y%128
            stripe=(38<u<58)+(38<v<58)
            thin=(u<3 or 12<u<15 or v<3 or 12<v<15)
            c=palette[2] if thin else (palette[0] if stripe else palette[1])
            weave=.985 if (x+y)%2 else 1
            pixels.extend([*(q*weave for q in c),1])
    image.pixels.foreach_set(pixels);image.pack()
    nodes=plaid.node_tree.nodes;tex=nodes.new('ShaderNodeTexImage');tex.image=image
    plaid.node_tree.links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    vs=[];fs=[];ws=[];uvs=[]
    rows=14;sides=160
    for j in range(rows+1):
        t=j/rows;z=mix(1.08,.70,t)
        rx=mix(.168,.22,min(1,t/.3)) if t<.3 else mix(.22,.26,(t-.3)/.7)
        ry=mix(.119,.18,min(1,t/.3)) if t<.3 else mix(.18,.201,(t-.3)/.7)
        for i in range(sides):
            a=2*pi*i/sides;fold=max(0,(t-.40)/.6)*(.004+.009*(math.cos(16*a)**2))
            vs.append(((rx+fold)*math.cos(a),(ry+fold)*math.sin(a)-.004,z+.004*t*math.cos(16*a)))
            # The hem follows its own thigh slightly; the centre stays on the pelvis.
            leg=.72*smooth((t-.20)/.80);left=.5+.5*math.cos(a)
            ws.append({'Hips':1-leg,'Thigh_L':leg*left,'Thigh_R':leg*(1-left)});uvs.append((i/sides*2,1-t*.92))
    for j in range(rows):
        for i in range(sides):
            a=j*sides+i;b=j*sides+(i+1)%sides;fs.append((a,b,b+sides,a+sides))
    skirt=mesh('Skort | tailored pleats',vs,fs,plaid,ws)
    uv=skirt.data.uv_layers.new(name='Woven check')
    for poly in skirt.data.polygons:
        for li in poly.loop_indices:
            index=skirt.data.loops[li].vertex_index;u,v=uvs[index]
            if index%sides==0 and any(skirt.data.loops[k].vertex_index%sides==sides-1 for k in poly.loop_indices):u=2
            uv.data[li].uv=(u,v)
    bpy.context.view_layer.objects.active=skirt;sol=skirt.modifiers.new('Skort hem thickness','SOLIDIFY');sol.thickness=.003;bpy.ops.object.modifier_apply(modifier=sol.name)
    # Fitted opaque shorts under the skort keep every stride and swing covered.
    shorts=garment('Skort | undershorts',lambda g,c:(g in {256,258} and .635<c.z<.92),pinkdark,.003)
    # Leave clearance for the different skirt/leg weights during the full finish.
    for v in shorts.data.vertices:v.co.x*=.80;v.co.y*=.84
    for z,r in [(1.065,.167),(1.096,.158)]:
        pts=[(r*math.cos(i*2*pi/80),.119*math.sin(i*2*pi/80)-.004,z) for i in range(81)]
        tube('Skort | waistband piping',pts,[.003]*81,pinklight,'Hips',8)
    pts=[(.165*math.cos(i*2*pi/80),.123*math.sin(i*2*pi/80)-.004,1.075) for i in range(81)]
    tube('Skort | rose belt',pts,[(.014,.01)]*81,pinkdark,'Hips',12)
    ellipsoid('Skort | buckle',(0,-.138,1.075),(.024,.005,.018),metal,'Hips',20,8)

else:
    # Tailored trousers use the connected anatomical seat/crotch and knee loops.
    twill=material('Cream brushed twill','ded7be',.95)
    seam=material('Twill seam thread','b9b39b',.93)
    trousers=garment('Trousers | tailored seat and legs',lambda g,c:g in {256,257,258} and .14<c.z<.945,twill,.020)
    for v in trousers.data.vertices:
        # Smooth garment cross-sections remove anatomical kneecaps and calf bulges.
        if v.co.z<.88:
            side=1 if v.co.x>0 else -1
            rows=[(.16,.115,0,.057,.065),(.30,.112,-.008,.065,.072),(.545,.107,-.027,.074,.081),(.74,.103,-.014,.086,.086),(.88,.10,-.006,.095,.09)]
            z=v.co.z
            for a,b in zip(rows,rows[1:]):
                if z<=b[0]:
                    t=max(0,(z-a[0])/(b[0]-a[0]));cx,cy,rx,ry=[mix(a[k],b[k],t) for k in range(1,5)];break
            angle=math.atan2((v.co.y-cy)/ry,(v.co.x-side*cx)/rx)
            fit=V((side*cx+rx*math.cos(angle),cy+ry*math.sin(angle),z))
            v.co=v.co.lerp(fit,1-smooth((z-.80)/.08))
        if .86<v.co.z<1.11 and v.co.y<-.118:
            v.co.y=-.118+(v.co.y+.118)*.12
    for s,side in [(1,'L'),(-1,'R')]:
        ankle=rig.data.bones['Foot_'+side].head_local
        pts=[(ankle.x+.055*math.cos(i*2*pi/48),.064*math.sin(i*2*pi/48)+.01,.185) for i in range(49)]
        tube('Trousers | cuff stitch',pts,[.002]*49,seam,'Shin_'+side,8)
    pts=[(.166*math.cos(i*2*pi/80),.123*math.sin(i*2*pi/80)-.004,1.075) for i in range(81)]
    tube('Trousers | forest woven belt',pts,[(.017,.010)]*81,pinkdark,'Hips',12)
    ellipsoid('Trousers | satin buckle',(0,-.137,1.075),(.024,.006,.019),metal,'Hips',20,8)
    for s in [-1,1]:
        tube('Trousers | slanted pocket seam',[(s*.13,-.102,1.05),(s*.164,-.090,.985),(s*.167,-.087,.95)],[.0018]*3,seam,'Hips',8)
        tube('Trousers | belt loop',[(s*.105,-.100,1.05),(s*.107,-.115,1.097)],[.006]*2,twill,'Hips',8)
    # A small matching golf crest keeps the two outfits in the same family.
    ellipsoid('Polo | chest crest',(.127,-.152,1.398),(.017,.003,.021),ivory,'Chest',20,8)
    tube('Polo | crest flagpole',[(.123,-.157,1.386),(.123,-.157,1.410)],[.0014]*2,pinkdark,'Chest',8)

# Anatomical eyes are inset in the authored eyelids. Colour the iris without
# oversized floating eyeballs or sphere-built facial features.
for s in [-1,1]:
    c=transform(male_normalize(V((s*.040658,-.084327,1.630014)))) if MALE else transform(V((s*.04733,-.0804,1.46328)))
    eye=ellipsoid('Face | inset eye',c,(.045,.039,.044) if MALE else (.0448,.0415,.045),eyewhite)
    centre=c+V((0,-.0405,0))
    ellipsoid('Face | iris',centre,(.0175,.0035,.021),iris,seg=32,lat=12)
    ellipsoid('Face | pupil',centre+V((0,-.003,0)),(.008,.0018,.012),black,seg=24,lat=10)
    ellipsoid('Face | eye glint',centre+V((-.004,-.005,.007)),(.003,.001,.0035),ivory,seg=12,lat=8)
    if not MALE:ellipsoid('Face | earring',(s*.159,-.016,1.727),(.006,.005,.006),metal,seg=16,lat=8)

# Surface-conforming brows, liner and a little hand-authored cheek colour.
bvh=BVHTree.FromPolygons(verts,faces,all_triangles=False)
def surface(x,z,offset=.002):
    hit,normal,idx,dist=bvh.ray_cast(V((x,-.6,z)),V((0,1,0)),1)
    return hit+normal*offset if hit else V((x,-.11,z))
for s in [-1,1]:
    points=[surface(s*x,z,.003) for x,z in [(.027,1.848),(.05,1.859),(.076,1.856),(.10,1.84)]]
    tube('Face | shaped eyebrow',points,[(.004,.007),(.005,.010),(.005,.008),(.001,.002)] if MALE else [(.003,.005),(.004,.007),(.004,.006),(.001,.001)],hair,'Head',12)
    points=[surface(s*x,z,.0025) for x,z in [(.019,1.802),(.038,1.820),(.067,1.824),(.093,1.814),(.105,1.819)]]
    if not MALE:tube('Face | upper eyelash',points,[.0015,.0022,.0025,.002,.0007],black,'Head',8)

# Hair is a scalp volume and tapered swept locks, with a tied-back ponytail.
hairfaces=[f for f,g in zip(faces,sets) if g==44 and (sum(raw[i].z for i in f)/len(f)>1.505 or (sum(raw[i].y for i in f)/len(f)>.0 and sum(raw[i].z for i in f)/len(f)>1.40))]
if MALE:hairfaces=[f for f in hairfaces if sum(verts[i].z for i in f)/len(f)<1.885]
hairvs=[p+base.data.vertices[i].normal*.008 for i,p in enumerate(verts)]
mesh('Hair | fitted scalp',hairvs,hairfaces,hair,[{'Head':1}]*len(hairvs))
for s in [-1,1]:
    tube('Hair | temple sweep',[(s*.115,.01,1.906),(s*.133,-.004,1.862),(s*.133,-.002,1.804),(s*.123,.006,1.765)],[(.025,.012),(.022,.012),(.016,.009),(.003,.002)],hair,'Head',18)
    tube('Hair | temple highlight',[(s*.126,-.012,1.901),(s*.14,-.010,1.847),(s*.135,-.008,1.807)],[.002,.0025,.0005],hairlight,'Head',8)
for j in range(0 if MALE else 7):
    x=(j-3)*.01
    points=[(x,.091,1.851),(x,.163,1.828),(x+.015,.225,1.75),(x+.043,.219,1.665),(x+.08,.18,1.59+.023*math.sin(j*1.8))]
    tube('Hair | ponytail lock',points,[(.023,.016),(.025,.021),(.024,.025),(.018,.02),(.002,.003)],hair if j%2 else hairlight,'Head',16)
if not MALE:ellipsoid('Hair | ribbon',(0,.144,1.846),(.048,.018,.025),pinkdark)
if MALE:
    for j in range(5):
        x=-.095+j*.032
        pts=[(x,-.107,1.883),(x+.012,-.126,1.880),(x+.029,-.137,1.863),(x+.035,-.137,1.857)]
        tube('Hair | short swept fringe',pts,[(.018,.008),(.021,.009),(.011,.006),(.001,.001)],hair,'Head',16)
        tube('Hair | combed ridge',[(p[0],p[1]-.010,p[2]+.003) for p in pts],[.0015,.002,.001,.0002],hairlight,'Head',8)

# Sculpted cap shell, curved bill, two stitched panels, and sunglasses on the bill.
vs=[];fs=[];sides=64;rows=12
for j in range(rows+1):
    t=j/rows;angle=t*pi*.49;rx=.146*math.cos(angle);ry=.161*math.cos(angle);z=1.892+.133*math.sin(angle)
    for i in range(sides):
        a=2*pi*i/sides;vs.append((rx*math.cos(a),.01+ry*math.sin(a),z-.01*max(0,-math.sin(a))))
for j in range(rows):
    for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;fs.append((a,b,b+sides,a+sides))
mesh('Cap | six-panel shell',vs,fs,ivory if MALE else pink,[{'Head':1}]*len(vs))
vs=[];fs=[]
for j in range(7):
    t=j/6
    for i in range(49):
        a=mix(-pi*.5,pi*.5,i/48);x=.146*math.sin(a);y=-.075-.135*math.cos(a)*t
        z=1.89-.026*t+.014*(x/.146)**2
        vs.append((x,y,z))
for j in range(6):
    for i in range(48):a=j*49+i;fs.append((a,a+1,a+50,a+49))
bill=mesh('Cap | curved bill',vs,fs,pinkdark if MALE else pink,[{'Head':1}]*len(vs))
bpy.context.view_layer.objects.active=bill;sol=bill.modifiers.new('Bill thickness','SOLIDIFY');sol.thickness=.007;bpy.ops.object.modifier_apply(modifier=sol.name)
tube('Cap | ivory edge',[vs[6*49+i] for i in range(49)],[.003]*49,ivory,'Head',10)
for s in [-1,1]:
    points=[(s*.04*math.cos(t*pi*.5),.01-.127*math.cos(t*pi*.5),1.896+.121*math.sin(t*pi*.5)) for t in [i/20 for i in range(21)]]
    tube('Cap | panel stitching',points,[.0012]*len(points),pinklight,'Head',8)
    if not MALE:
        c=V((s*.07,-.145,1.952))
        pts=[c+V((.049*math.cos(i*2*pi/48),-.013*math.sin(i*2*pi/48),.031*math.sin(i*2*pi/48))) for i in range(49)]
        tube('Cap | sunglasses frame',pts,[.003]*49,solemat,'Head',10)
        ellipsoid('Cap | sunglasses lens',c,(.045,.008,.029),lens)
if not MALE:tube('Cap | sunglasses bridge',[(-.021,-.15,1.96),(0,-.157,1.968),(.021,-.15,1.96)],[.003]*3,solemat,'Head',10)
if MALE:
    ellipsoid('Cap | stitched crest',(0,-.126,1.952),(.025,.004,.026),pinkdark)
    tube('Cap | crest flagpole',[(-.005,-.132,1.938),(-.005,-.132,1.966)],[.0018]*2,ivory,'Head',8)
    mesh('Cap | crest pennant',[(-.004,-.132,1.966),(.014,-.132,1.960),(-.004,-.132,1.953)],[(0,1,2)],ivory,[{'Head':1}]*3)
ellipsoid('Cap | top button',(0,.01,2.015),(.010,.010,.004),pinkdark,seg=16,lat=8)

# A fitted glove uses the actual connected hand topology, with cuffs and strap.
handsets={272,273,274,275,276,277,278,279,280,281,282,283,284,285,286,359}
garment('Glove | fitted leather',lambda g,c:g in handsets and c.x>0,ivory,.0035 if MALE else .0025,smoothing=0 if MALE else 4)
for s,side in [(1,'L'),(-1,'R')]:
    # Structured shoes, understated panels and short ribbed socks.
    ankle=rig.data.bones['Foot_'+side].head_local
    tube('Socks | knitted ankle',[(ankle.x,0,.09),(ankle.x,0,.14),(ankle.x,0,.18)],[(.044,.047),(.045,.048),(.046,.05)],ivory,'Shin_'+side,24)
    for z in [.177]:
        pts=[(ankle.x+.045*math.cos(i*2*pi/40),.046*math.sin(i*2*pi/40),z) for i in range(41)]
        tube('Socks | rolled cuff',pts,[.006]*41,ivory,'Shin_'+side,8)
    # Loafed surfaces are dense rings with a shaped instep, not stacked spheres.
    vs=[];fs=[]
    shoe_rows=[(-.228,.015,.046,.025),(-.20,.06,.061,.039),(-.12,.075,.069,.048),(-.04,.066,.085,.057),(.027,.059,.083,.068),(.064,.047,.066,.045),(.071,.009,.055,.015)]
    for y,rx,cz,rz in shoe_rows:
        for i in range(32):
            a=2*pi*i/32;vs.append((ankle.x+rx*math.cos(a),y,max(.028,cz+rz*math.sin(a))))
    for j in range(len(shoe_rows)-1):
        for i in range(32):a=j*32+i;b=j*32+(i+1)%32;fs.append((a,b,b+32,a+32))
    fs.extend([tuple(reversed(range(32))),tuple((len(shoe_rows)-1)*32+i for i in range(32))])
    shoe=mesh('Shoes | leather upper',vs,fs,ivory,[{'Foot_'+side:1}]*len(vs))
    ellipsoid('Shoes | rubber outsole',(ankle.x,-.078,.027),(.076,.151,.021),solemat,'Foot_'+side,40,10)
    ellipsoid('Shoes | cushioned midsole',(ankle.x,-.078,.044),(.077,.152,.018),ivory,'Foot_'+side,40,10)
    for z in [.082,.09]:tube('Shoes | rose heel stripe',[(ankle.x-.052,.028,z),(ankle.x,.068,z),(ankle.x+.052,.028,z)],[.006]*3,pink,'Foot_'+side,10)
    for y in [-.035,-.056,-.077,-.098]:tube('Shoes | woven laces',[(ankle.x-.029,y,.138),(ankle.x+.029,y,.138)],[.0025]*2,ivory,'Foot_'+side,8)

# Join the export body while preserving skin weights, UVs and material slots.
bpy.ops.object.select_all(action='DESELECT')
for o in created:o.select_set(True)
bpy.context.view_layer.objects.active=body;bpy.ops.object.join();body=bpy.context.object;body.name='Golfer_Outfit_and_Body'
body.parent=rig;mod=body.modifiers.new('Weighted humanoid','ARMATURE');mod.object=rig
variant='male' if MALE else 'female'
filename='banvy-golfer-male' if MALE else 'banvy-golfer'
manifest_name='golfer-male.json' if MALE else 'golfer.json'
rig['design']=('Sage-green polo, cream tailored trousers, ivory cap, short swept hair, glove and golf shoes.' if MALE else 'Birdie-inspired original golfer: raspberry polo, tailored check skort, ivory undersleeves, dark sculpted hair, cap and sunglasses.')
rig['base_mesh']='Blender Studio Human Base Meshes v1.4.1 / stylized '+variant+' / CC0'
rig['height_m']=2.019
clubs=[o for o in collection.objects if is_club(o)]
# Explicit NLA tracks isolate each character's 20 actions in a multi-rig document.
# The public clip names stay identical even though native actions are independent.
rig.animation_data.action=None
for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
for action in actions:
    track=rig.animation_data.nla_tracks.new();track.name=clip_name(action)
    strip=track.strips.new(clip_name(action),1,action);strip.extrapolation='NOTHING';track.mute=True
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True)
for c in clubs:c.hide_set(False);c.hide_render=False;c.select_set(True)
bpy.context.view_layer.objects.active=rig
export=ASSET/(filename+'.glb')
bpy.ops.export_scene.gltf(filepath=str(export),export_format='GLB',use_selection=True,use_active_scene=True,
    export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_def_bones=True,
    export_bake_animation=True,export_anim_single_armature=False,export_anim_slide_to_zero=True,
    export_frame_range=False,export_cameras=False,export_lights=False,export_extras=True)
# Strip only the generated male namespace from GLB node names. Bone names and
# binary buffers are unchanged; the shared runtime finds the same club sockets.
import struct
payload=export.read_bytes();size,kind=struct.unpack_from('<II',payload,12)
document=json.loads(payload[20:20+size])
for node in document.get('nodes',[]):
    if node.get('name','').startswith('Male_'):node['name']=node['name'][5:]
assert {a['name'] for a in document.get('animations',[])}=={clip_name(a) for a in actions}, [a.get('name') for a in document.get('animations',[])]
encoded=json.dumps(document,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
tail=payload[20+size:]
export.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),kind)+encoded+tail)
for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
rig.animation_data.action=next(a for a in actions if clip_name(a)=='Idle');scene.frame_set(1)
for c in clubs:c.hide_render=club_id(c)!='Iron';c.hide_set(club_id(c)!='Iron')
report=json.loads((ASSET/'golfer.json').read_text());report.update({'id':variant,'name':'Banvy '+variant.title()+' Golfer','file':filename+'.glb','design':rig['design'],'height':2.019,'bytes':export.stat().st_size,'vertices':len(body.data.vertices),'triangles':sum(len(p.vertices)-2 for p in body.data.polygons),'source':{'asset':'Blender Studio Human Base Meshes v1.4.1 - stylized '+variant,'license':'CC0','url':'https://download.blender.org/demo/asset-bundles/human-base-meshes/'},'sha256':hashlib.sha256(export.read_bytes()).hexdigest(),'status':'refined 3D character; animation and visual review in progress'})
(ASSET/manifest_name).write_text(json.dumps(report,indent=2),encoding='utf-8');(OUT/('build-report-male.json' if MALE else 'build-report.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
scene.render.filepath=str(OUT/('golfer-male-portrait.png' if MALE else 'golfer-portrait.png'))
# Keep the untouched CC0 sculpt available for future native editing.
source_name=('Male | ' if MALE else 'Golfer | ')+'Sculpt source CC0'
source_col=bpy.data.collections.get(source_name)
if source_col:
    for o in list(source_col.objects):bpy.data.objects.remove(o,do_unlink=True)
    bpy.data.collections.remove(source_col)
source_col=bpy.data.collections.new(source_name);scene.collection.children.link(source_col)
source_col.objects.link(base);source_col.hide_render=True;source_col.hide_viewport=True
base.location=(0,0,0);base['license']='CC0 - Blender Studio Human Base Meshes v1.4.1'
notes_name='Banvy '+variant+' golfer - Read me'
notes=bpy.data.texts.get(notes_name) or bpy.data.texts.new(notes_name)
notes.clear();notes.write('Original Banvy '+variant+' golf outfit and animation study. Base anatomy: Blender Studio Human Base Meshes v1.4.1, CC0. Select the armature and choose an Action in the Action Editor. All 20 actions are retained. Club meshes are separate and use ClubGrip. The hidden Sculpt source CC0 collection contains the original base.\n')
scene['readme']=notes.name
bpy.data.libraries.write(str(OUT/(filename+'.blend')),{scene,notes}|set(actions),fake_user=True)
print(json.dumps(report))

# Anatomy and finger placement are final now; regenerate motion for this exact
# rig instead of retaining the blockout's hand transforms and old clip metadata.
import runpy
motion_api=runpy.run_path(str(ROOT/'tools/blender-golfer/animation.py'))
export_api=runpy.run_path(str(ROOT/'tools/blender-golfer/rebake_animations.py'))
actions,clips,audit=motion_api['bake'](rig,scene)
print(json.dumps(export_api['export_character'](scene,rig,actions,clips,audit)))
