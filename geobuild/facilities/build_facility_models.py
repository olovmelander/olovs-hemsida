"""Build a separate architectural scene through Blender MCP; preserve other work.

The two model modules consume reviewed plan coordinates and photo-based details.
Physical heights remain labeled estimates. Terrain uses verified RH2000 samples.
"""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

ROOT=Path(globals().get('VECK_REPO_ROOT',r'C:\Users\olov_\repos\olovs-hemsida'))
HERE=ROOT/'geobuild/facilities'
OUT=ROOT/'geobuild/cache/facilities-model-2026-09-10'
SCENE='Veckefjarden | Facility architecture 2026-09-10 v2'
PREFIX='VECK MODEL | '


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Builder:
    def __init__(self,scene,collection,inventory,ground):
        self.scene=scene
        self.collection=collection
        self.inventory={f['id']:f for f in inventory['features']}
        self.ground_spec=ground
        self.grid=json.loads((ROOT/ground['gridPath']).read_text(encoding='utf-8'))
        self.materials={}
        for name,color,rough,metal,alpha in [
            ('wall_yellow',(.73,.61,.32),.8,0,1),('white',(.91,.90,.81),.6,0,1),
            ('roof_grey',(.105,.12,.14),.53,.3,1),('roof_seam',(.19,.21,.23),.5,.4,1),
            ('glass',(.11,.22,.26),.16,.15,.48),('foundation',(.30,.31,.29),.88,0,1),
            ('clubhouse_basement',(.28,.38,.26),.78,0,1),('wood',(.36,.24,.13),.86,0,1),
            ('metal',(.07,.09,.10),.48,.5,1),('asphalt',(.30,.29,.25),.94,0,1),
            ('water',(.055,.46,.62),.12,.1,.92),('blue',(.055,.26,.48),.82,0,1),
            ('grass',(.22,.30,.13),1,0,1),('sand',(.52,.45,.30),1,0,1)]:
            self.material(name,color,rough,metal,alpha)

    def feature(self,feature_id):
        return self.inventory[feature_id]

    def ring(self,feature_id):
        return self.feature(feature_id)['ringBlenderXY']

    def ground(self,x,y):
        g=self.grid;fx=(x-g['x0'])/g['step'];fy=(y-g['y0'])/g['step']
        if not(-1e-5<=fx<=g['width']-1+1e-5 and -1e-5<=fy<=g['height']-1+1e-5):
            raise ValueError(f'Model outside measured ground: {x,y}')
        fx=max(0,min(g['width']-1,fx));fy=max(0,min(g['height']-1,fy))
        col=int(fx);row=int(fy);cc=min(col+1,g['width']-1);rr=min(row+1,g['height']-1)
        tx=fx-col;ty=fy-row
        def at(c,r):return g['heights'][r*g['width']+c]
        return (at(col,row)*(1-tx)+at(cc,row)*tx)*(1-ty)+(at(col,rr)*(1-tx)+at(cc,rr)*tx)*ty

    def material(self,name,color,roughness=.8,metallic=0,alpha=1):
        if name in self.materials:return self.materials[name]
        m=bpy.data.materials.new(PREFIX+name);m.diffuse_color=(*color[:3],alpha);m.use_nodes=True
        bsdf=m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value=(*color[:3],alpha)
        bsdf.inputs['Roughness'].default_value=roughness
        bsdf.inputs['Metallic'].default_value=metallic
        bsdf.inputs['Alpha'].default_value=alpha
        if alpha<1:
            m.surface_render_method='DITHERED'
        self.materials[name]=m
        return m

    def mesh(self,name,vertices,faces,materialKey):
        if not all(all(math.isfinite(v) for v in p) for p in vertices):raise ValueError(name+' nonfinite vertices')
        data=bpy.data.meshes.new(PREFIX+name);data.from_pydata(vertices,[],faces);data.update()
        bm=bmesh.new();bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
        bm.to_mesh(data);bm.free()
        mat=self.materials[materialKey] if isinstance(materialKey,str) else materialKey
        data.materials.append(mat)
        obj=bpy.data.objects.new(PREFIX+name,data);self.collection.objects.link(obj)
        obj['generated_facility_model']=True
        obj['height_status']='photo/model estimate; not surveyed'
        return obj

    def box(self,name,center,dimensions,materialKey,angle=0):
        dx,dy,dz=[v/2 for v in dimensions];cx,cy,cz=center;c=math.cos(angle);s=math.sin(angle)
        if min(dimensions)<=0:raise ValueError(name+' nonpositive box dimensions')
        pts=[(cx+x*c-y*s,cy+x*s+y*c,cz+z) for z in (-dz,dz) for x,y in [(-dx,-dy),(dx,-dy),(dx,dy),(-dx,dy)]]
        return self.mesh(name,pts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],materialKey)

    def prism(self,name,ring,z0,z1,materialKey):
        if ring[0]==ring[-1]:ring=ring[:-1]
        n=len(ring)
        pts=[(p[0],p[1],z) for z in (z0,z1) for p in ring]
        faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        return self.mesh(name,pts,faces,materialKey)

    def drape(self,name,ring,materialKey,lift=.10):
        # Tessellate the actual concave boundary, then refine every triangle so
        # parking and paths follow interior terrain, not only their perimeter.
        polygon=[Vector((p[0],p[1],0)) for p in ring]
        pending=[tuple(tuple(polygon[i][:2]) for i in t) for t in tessellate_polygon([polygon])]
        vertices=[];faces=[];lookup={}
        while pending:
            tri=pending.pop();edges=[math.dist(tri[i],tri[(i+1)%3]) for i in range(3)]
            i=max(range(3),key=edges.__getitem__)
            if edges[i]>1.4:
                a,b,c=tri[i],tri[(i+1)%3],tri[(i+2)%3]
                mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
                pending.extend([(a,mid,c),(mid,b,c)])
                continue
            face=[]
            for x,y in tri:
                key=(round(x,8),round(y,8))
                if key not in lookup:
                    lookup[key]=len(vertices);vertices.append((x,y,self.ground(x,y)+lift))
                face.append(lookup[key])
            faces.append(tuple(face))
        return self.mesh(name,vertices,faces,materialKey)

    def beam(self,name,a,b,width,depth,materialKey):
        a=Vector(a);b=Vector(b);direction=b-a
        if direction.length<1e-7:raise ValueError(name+' zero beam length')
        q=direction.to_track_quat('Z','Y');center=(a+b)/2
        pts=[tuple(center+q@Vector((x,y,z))) for z in (-direction.length/2,direction.length/2) for x,y in [(-width/2,-depth/2),(width/2,-depth/2),(width/2,depth/2),(-width/2,depth/2)]]
        return self.mesh(name,pts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],materialKey)

    def cylinder(self,name,center,radius,depth,materialKey,vertices=12):
        cx,cy,cz=center
        ring=[(cx+radius*math.cos(i*math.tau/vertices),cy+radius*math.sin(i*math.tau/vertices)) for i in range(vertices)]
        return self.prism(name,ring,cz-depth/2,cz+depth/2,materialKey)

    def gable(self,name,cx,cy,length,width,eaveZ,ridgeZ,angle,materialKey='roof_grey'):
        c,s=math.cos(angle),math.sin(angle)
        pts=[]
        for x,y,z in [(-length/2,-width/2,eaveZ),(length/2,-width/2,eaveZ),(length/2,0,ridgeZ),(-length/2,0,ridgeZ),(-length/2,width/2,eaveZ),(length/2,width/2,eaveZ)]:
            pts.append((cx+c*x-s*y,cy+s*x+c*y,z))
        return self.mesh(name,pts,[(0,1,2,3),(3,2,5,4)],materialKey)

    def tag(self,obj,featureId,evidence='photo-estimated'):
        if featureId not in self.inventory:raise ValueError('Unknown feature '+str(featureId))
        obj['source_feature']=featureId;obj['geometry_evidence']=evidence
        obj['source_inventory']='geobuild/facilities/inventory.json'
        obj['reference_only']=False
        return obj


def build():
    output=OUT/'veckefjarden-facilities-v2.blend'
    if bpy.data.scenes.get(SCENE) or output.exists():
        raise RuntimeError('Architecture scene/output already exists; revise only this generated scene or use a new version')
    inventory=json.loads((HERE/'inventory.json').read_text(encoding='utf-8'))
    ground=json.loads((HERE/'model-ground.json').read_text(encoding='utf-8'))
    assert sha(ROOT/ground['gridPath'])==ground['gridSha256']
    assert sha(HERE/'inventory.json')==ground['inventory']['sha256']
    before={s.name:tuple(sorted(o.name for o in s.objects)) for s in bpy.data.scenes}
    active=bpy.context.scene.name;filepath=bpy.data.filepath
    scene=bpy.data.scenes.new(SCENE);scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene['horizontal_crs']='EPSG:3006';scene['vertical_crs']='EPSG:5613'
    scene['origin_easting_northing']=ground['originEPSG3006'];scene['origin_height_rh2000']=ground['originHeightRH2000']
    scene['axis_contract']='X east, Y north, Z up relative to origin RH2000 height'
    scene['height_status']='Terrain measured; building dimensions in Z and hidden details estimated from photographs'
    def collection(name):
        c=bpy.data.collections.new(PREFIX+name);scene.collection.children.link(c);return c
    club=collection('01 Clubhouse');facilities=collection('02 Facilities');land=collection('03 Terrain context');rig=collection('04 Lighting and cameras')
    ctx=Builder(scene,club,inventory,ground)
    reports={}
    for filename,coll in [('model_clubhouse.py',club),('model_facilities.py',facilities)]:
        ctx.collection=coll
        module_spec=importlib.util.spec_from_file_location('veck_'+filename[:-3],HERE/filename)
        mod=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(mod)
        reports[filename]=mod.build(ctx)
    ctx.collection=land
    g=ctx.grid;vertices=[];faces=[]
    for row in range(g['height']):
        for col in range(g['width']):vertices.append((g['x0']+col*g['step'],g['y0']+row*g['step'],g['heights'][row*g['width']+col]-.10))
    for row in range(g['height']-1):
        for col in range(g['width']-1):
            i=row*g['width']+col;faces.append((i,i+1,i+g['width']+1,i+g['width']))
    terrain=ctx.mesh('RH2000 terrain context',vertices,faces,'grass')
    terrain['context_only']=True;terrain['terrain_grid_sha256']=ground['gridSha256']
    for polygon in terrain.data.polygons:polygon.use_smooth=True
    for path_record in ground.get('access',[]):
        verts=[];faces=[];width=path_record['widthEstimateMetres']
        for a,b in path_record['segments']:
            length=math.dist(a,b)
            if length<1e-6:continue
            nx=-(b[1]-a[1])/length*width/2;ny=(b[0]-a[0])/length*width/2
            points=[(a[0]+nx,a[1]+ny),(a[0]-nx,a[1]-ny),(b[0]-nx,b[1]-ny),(b[0]+nx,b[1]+ny)]
            base=len(verts);verts.extend((x,y,ctx.ground(x,y)+.12) for x,y in points)
            faces.append(tuple(base+i for i in range(4)))
        if faces:
            obj=ctx.mesh('Mapped access '+path_record['id'],verts,faces,'asphalt')
            obj['context_only']=True;obj['source_model_path']=path_record['sourceModelPath']
            obj['width_status']='estimated; existing mapped context only'

    # Deterministic procedural ground color, with no photographic texture dependency.
    mat=ctx.materials['grass'];nodes=mat.node_tree.nodes;links=mat.node_tree.links
    noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=.24
    ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.12,.18,.07,1);ramp.color_ramp.elements[1].color=(.31,.40,.17,1)
    links.new(noise.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs[0],nodes.get('Principled BSDF').inputs['Base Color'])

    def aim(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    def camera(name,location,target,scale):
        data=bpy.data.cameras.new(PREFIX+name);data.type='ORTHO';data.ortho_scale=scale;data.clip_end=2500
        obj=bpy.data.objects.new(PREFIX+name,data);obj.location=location;rig.objects.link(obj);aim(obj,target);return obj
    cameras={
        'clubhouse-west':camera('Clubhouse course side',(-66,-25,23),(0,0,4),62),
        'clubhouse-east':camera('Clubhouse entrance',(62,-34,25),(0,0,4),69),
        'campus':camera('Campus',(-180,-210,185),(0,-60,-1),235),
        'hotel-pool':camera('Hotel and pool',(95,-130,60),(22,-75,-2),110),
        'range':camera('Range',(-170,-330,75),(-84,-258,9),150),
        'western':camera('Western buildings',(-275,-150,32),(-196,-86,-10),105),
    }
    scene.camera=cameras['clubhouse-west']
    sun_data=bpy.data.lights.new(PREFIX+'Sun','SUN');sun_data.energy=2.4;sun_data.angle=.12
    sun=bpy.data.objects.new(PREFIX+'Sun',sun_data);rig.objects.link(sun);sun.rotation_euler=(.55,-.45,-.65)
    area_data=bpy.data.lights.new(PREFIX+'Sky fill','AREA');area_data.energy=2200;area_data.shape='DISK';area_data.size=110
    area=bpy.data.objects.new(PREFIX+'Sky fill',area_data);area.location=(-25,-35,75);rig.objects.link(area);aim(area,(0,-20,0))
    scene.world=bpy.data.worlds.new(PREFIX+'World');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.32,.42,.52,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
    scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
    scene.render.filepath=str(OUT/'clubhouse-west.png')
    notes=bpy.data.texts.new(PREFIX+'Modeling notes');notes.write(json.dumps(reports,indent=2,ensure_ascii=False));notes.use_fake_user=True
    scene['modeling_notes']=notes.name
    assert bpy.context.scene.name==active and bpy.data.filepath==filepath
    assert all(tuple(sorted(o.name for o in bpy.data.scenes[n].objects))==v for n,v in before.items())
    OUT.mkdir(parents=True,exist_ok=True)
    bpy.data.libraries.write(str(output),{scene,notes},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
    mesh_objects=[o for o in scene.objects if o.type=='MESH' and not o.get('context_only')]
    counts={'objects':len(mesh_objects),'vertices':sum(len(o.data.vertices) for o in mesh_objects),'polygons':sum(len(o.data.polygons) for o in mesh_objects)}
    report={'schemaVersion':1,'passed':True,'scene':scene.name,'blendPath':output.relative_to(ROOT).as_posix(),'blendSha256':sha(output),
            'sourceInputs':[{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p)} for p in [HERE/'inventory.json',HERE/'photo-sources.json',HERE/'model-ground.json',HERE/'model_clubhouse.py',HERE/'model_facilities.py',HERE/'build_facility_models.py']],
            'counts':counts,'originEPSG3006':ground['originEPSG3006'],'originHeightRH2000':ground['originHeightRH2000'],
            'existingScenesPreserved':True,'activeScenePreserved':active,'currentFilePreserved':True,
            'cameras':{k:v.name for k,v in cameras.items()},'modeling':reports,'physicalBuildingHeightsVerified':False}
    (HERE/'model-build-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('modeling','sourceInputs')},ensure_ascii=False))


if __name__=='__main__':build()
