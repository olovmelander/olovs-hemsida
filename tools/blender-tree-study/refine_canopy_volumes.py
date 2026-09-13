"""Refine existing foliage in Blender, with identical triangle/UV budgets.

Run through bl.mjs. A separate scene and immutable GLBs preserve the input
assets and user scene. Writes a candidate manifest for review, not the default.
"""
import bpy, json, math, hashlib, copy
from pathlib import Path
from mathutils import Vector

ROOT=Path(r'C:/Users/olov_/repos/olovs-hemsida')
DOC=ROOT/'docs/graphics/canopy-refinement-2026-09-13'
ASSETS=ROOT/'apps/golf/public/models/trees'
source=json.loads((DOC/'before-manifest.json').read_text(encoding='utf-8'))
manifest=copy.deepcopy(source)
manifest['revision']='continuous-canopy-2026-09-13'
previous=bpy.context.window.scene
scene=bpy.data.scenes.new('Ghibli | Continuous canopy study')
bpy.context.window.scene=scene
report={'source':'before-manifest.json','meshes':[],'userScene':previous.name}

def ease(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)

def deform(p,key,height,radius):
    x,y,z=p; t=z/height; rho=math.hypot(x,y)/radius; angle=math.atan2(y,x)
    if key=='gran':
        # Broader drooping shoulders, a staggered outside edge, a slight lean.
        radial=1+.075*math.sin(angle*3+t*8)+.045*math.cos(angle*2-t*13)
        radial*=1+.09*math.exp(-((t-.68)/.19)**2)
        z-=height*.025*min(rho,1.2)**1.5*(.75+.25*math.sin(angle+t*7))
        x=x*radial+height*.022*ease(.35,1,t)
        y=y*radial-height*.012*ease(.2,1,t)
    elif key=='bjork':
        # The same arch flows through branches and leaves. Broaden the lower
        # shoulders, break the oval outline, and let the outside growth hang.
        radial=1+.13*math.exp(-((t-.61)/.20)**2)
        radial*=1+.055*math.sin(angle*3+t*9)
        z-=height*.040*min(rho,1.2)**1.7*ease(.35,.65,t)
        x=x*radial+height*.045*ease(.4,1,t)
        y=y*radial+height*.020*math.sin(t*3)*ease(.3,.8,t)
    return Vector((x,y,z))

def broad_normal(p,key,centre,radius):
    delta=p-centre
    if key=='gran':
        # Broad, overlapping bough layers; small cluster centres no longer
        # switch the normal sharply at every overlapping foliage card.
        a=math.atan2(delta.y,delta.x)
        return Vector((math.cos(a),math.sin(a),.36+.16*math.sin(p.z/radius.z*5+a*.35))).normalized()
    if key=='tall':
        # A pine retains separate branch platforms instead of one round crown.
        return Vector((delta.x/max(radius.x,.1),delta.y/max(radius.y,.1),.55+delta.z/max(radius.z,.1)*.45)).normalized()
    return Vector((delta.x/max(radius.x,.1),delta.y/max(radius.y,.1),delta.z/max(radius.z,.1)+.12)).normalized()

def export_pair(objects,target):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,
      export_yup=True,export_apply=True,export_normals=True,export_texcoords=True,
      export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_materials='NONE',
      export_cameras=False,export_lights=False,export_animations=False,export_skins=False,export_morph=False)

try:
 for species in manifest['species']:
    key=species['foliage']['key'];variant=species['variants'][0]
    height=variant['templateHeight'];template_radius=variant['templateRadius']
    for tier,record in variant['tiers'].items():
        before=set(scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(ASSETS/record['file']))
        objects=[ob for ob in scene.objects if ob not in before and ob.type=='MESH']
        for ob in objects:
            ob.name='crown' if ob.name.startswith('crown') else 'trunk'
            # glTF Y-up is imported into Blender Z-up. Bake transforms before
            # deriving a common crown field and applying the smooth deformation.
            bpy.ops.object.select_all(action='DESELECT');ob.select_set(True)
            bpy.context.view_layer.objects.active=ob
            bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        crown=next(ob for ob in objects if ob.name=='crown')
        original_tris=sum(len(p.vertices)-2 for ob in objects for p in ob.data.polygons)
        assert original_tris==record['tris'],(key,tier,original_tris,record['tris'])
        normals=[n.vector.copy() for n in crown.data.corner_normals]
        for ob in objects:
            for v in ob.data.vertices:v.co=deform(v.co,key,height,template_radius)
            ob.data.update()
        lo=Vector(tuple(min(v.co[k] for v in crown.data.vertices) for k in range(3)))
        hi=Vector(tuple(max(v.co[k] for v in crown.data.vertices) for k in range(3)))
        centre=(lo+hi)*.5;radius=(hi-lo)*.5
        # Retain a small local component for rounded boughs, then use a shared
        # smooth field for the majority of the light across the crown.
        broad_share={'gran':.78,'bjork':.76,'tall':.32,'al':.50,'ek':.50}[key]
        refined=[]
        for loop,normal in zip(crown.data.loops,normals):
            broad=broad_normal(crown.data.vertices[loop.vertex_index].co,key,centre,radius)
            n=normal.lerp(broad,broad_share).normalized()
            assert all(math.isfinite(v) for v in n)
            refined.append(n)
        for polygon in crown.data.polygons:polygon.use_smooth=True
        crown.data.normals_split_custom_set(refined)
        # Preserve broad canopy pigments; compress only tiny vertex-to-vertex
        # brightness variations, without touching the authored bark colours.
        paint=crown.data.color_attributes.active_color
        if paint:
            for item in paint.data:
                item.color=tuple(.98+(v-.98)*.45 for v in item.color[:3])+(item.color[3],)
        for ob in objects:
            for v in ob.data.vertices:assert all(math.isfinite(a) for a in v.co)
        assert sum(len(p.vertices)-2 for ob in objects for p in ob.data.polygons)==original_tris
        temporary=DOC/'export.glb';export_pair(objects,temporary)
        blob=temporary.read_bytes();sha=hashlib.sha256(blob).hexdigest()
        file='ghibli-fluffy/'+sha+'.glb';(ASSETS/file).write_bytes(blob)
        original_bytes=record['bytes']
        record.update(file=file,bytes=len(blob),sha256=sha)
        # Store the actual close bounds. The loader fits every other tier to
        # these bounds, retaining the existing per-tree height/radius contract.
        if tier=='hero':
            variant['templateHeight']=max(v.co.z for ob in objects for v in ob.data.vertices)
            variant['templateRadius']=max(max(abs(v.co.x),abs(v.co.y)) for ob in objects for v in ob.data.vertices)
        report['meshes'].append({'species':key,'tier':tier,'triangles':original_tris,
          'bytesBefore':original_bytes,'bytesAfter':len(blob),'normalBlend':broad_share})
        # Only the close tree is retained in the review scene.
        if tier=='hero':
            for ob in objects:
                ob.name=key+' | '+ob.name
                ob.location.x=['tall','gran','bjork','al','ek'].index(key)*24-48
        else:
            for ob in objects:bpy.data.objects.remove(ob,do_unlink=True)
 (DOC/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
 (DOC/'blender-validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
 bpy.data.libraries.write(str(DOC/'continuous-canopy.blend'),{scene},fake_user=True,compress=True)
 print('CANOPY_REFINEMENT_COMPLETE '+json.dumps(report))
finally:
 bpy.context.window.scene=previous
