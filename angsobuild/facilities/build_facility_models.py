"""Build editable Ängsö architecture through the live bridge, preserving existing scenes."""
from array import array
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'angsobuild/cache/facilities-model-2026-09-10'
PREFIX = 'ANG MODEL | '


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Builder:
    def __init__(self, scene, collection, inputs):
        self.scene, self.collection, self.inputs = scene, collection, inputs
        self.inventory = {f['id']:f for f in inputs['features']}
        self.heights = {f['id']:f for f in json.loads((HERE/'height-reference.json').read_text(encoding='utf-8'))['facilities']}
        self.roots, self.records = {}, {}
        self.current_id = None
        raw = (ROOT/inputs['raster']['path']).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == inputs['raster']['sha256']
        self.grid = array('f'); self.grid.frombytes(raw)
        self.materials = {}
        for name, color, rough, metallic in [
            ('red',(.29,.042,.025),.84,0),('red_batten',(.36,.054,.035),.86,0),
            ('white',(.83,.82,.76),.68,0),('roof_tile',(.52,.16,.065),.90,0),
            ('roof_dark',(.045,.060,.063),.67,.15),('roof_seam',(.095,.11,.11),.62,.1),
            ('glass',(.035,.080,.105),.19,.12),('foundation',(.27,.28,.25),.96,0),
            ('wood',(.32,.20,.105),.88,0),('metal',(.035,.045,.040),.5,.55),
            ('asphalt',(.18,.18,.16),.96,0),('grass',(.12,.19,.055),1,0),
            ('sand',(.48,.40,.26),1,0)]: self.material(name,color,rough,metallic)

    def feature(self, fid): return self.inventory[fid]
    def ring(self, fid): return [tuple(p) for p in self.inventory[fid]['ringBlenderXY']]
    def height(self, fid): return self.heights.get(fid, {})

    def ground(self, x, y):
        g = self.inputs['lattice']; e0,n0 = self.inputs['originEPSG3006']
        fx=(x+e0-g['originEasting'])/g['sampleSpacingMetres']
        fy=(g['originNorthing']-(y+n0))/g['sampleSpacingMetres']
        col,row=int(fx),int(fy)
        assert 0<=col<g['width']-1 and 0<=row<g['height']-1, f'Ground outside source: {x,y}'
        u,v=fx-col,fy-row
        def at(c,r): return self.grid[r*g['width']+c]
        h=(at(col,row)*(1-u)+at(col+1,row)*u)*(1-v)+(at(col,row+1)*(1-u)+at(col+1,row+1)*u)*v
        assert math.isfinite(h) and -5<h<80, 'Invalid ground sample'
        return h-self.inputs['originHeightRH2000']

    def begin_facility(self, fid):
        assert fid in self.inventory, 'Unknown facility '+fid
        self.current_id=fid
        if fid not in self.roots:
            obj=bpy.data.objects.new(PREFIX+fid,None);self.collection.objects.link(obj)
            obj['facilityId']=fid;obj['sourceBuildingIds']=self.inventory[fid]['sourceBuildingIds']
            obj['source_inventory']='angsobuild/facilities/model-inputs.json'
            self.roots[fid]=obj
            self.records[fid]={k:v for k,v in self.inventory[fid].items()
                               if k in ('id','nodeName','label','kind','vegetationExclusion','sourceBuildingIds',
                                        'groundAnchorLocal','groundAnchorRh2000M','footprintLocal','placement',
                                        'sourceParkingIndices','sourceParkingRingsLocal','notes')}
        return self.roots[fid]

    def record_facility(self, fid, metadata):
        self.records[fid]['modelInterpretation']=metadata

    def material(self,name,color,roughness=.8,metallic=0,alpha=1):
        if name in self.materials:return self.materials[name]
        mat=bpy.data.materials.new(PREFIX+name);mat.diffuse_color=(*color[:3],alpha);mat.use_nodes=True
        bsdf=mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value=(*color[:3],alpha)
        bsdf.inputs['Roughness'].default_value=roughness;bsdf.inputs['Metallic'].default_value=metallic
        bsdf.inputs['Alpha'].default_value=alpha
        if alpha<1:mat.surface_render_method='DITHERED'
        self.materials[name]=mat
        return mat

    def mesh(self,name,vertices,faces,materialKey):
        assert vertices and faces and all(len(p)==3 and all(math.isfinite(v) for v in p) for p in vertices), name
        data=bpy.data.meshes.new(PREFIX+name);data.from_pydata(vertices,[],faces);data.update()
        bm=bmesh.new();bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
        bm.to_mesh(data);bm.free()
        assert not data.validate(verbose=False), 'Invalid mesh '+name
        data.materials.append(self.materials[materialKey] if isinstance(materialKey,str) else materialKey)
        obj=bpy.data.objects.new(PREFIX+name,data);self.collection.objects.link(obj)
        if self.current_id:
            obj.parent=self.roots[self.current_id]
            obj['facilityId']=self.current_id
            obj['generated_facility_model']=True
            obj['geometry_evidence']='orthophoto and laser guided; facade details interpreted from photographs'
        else:obj['context_only']=True
        return obj

    def tag(self,obj,fid,evidence='photo-estimated'):
        assert fid in self.inventory
        obj['source_feature']=fid;obj['geometry_evidence']=evidence;obj['reference_only']=False
        return obj

    def box(self,name,center,dimensions,materialKey,angle=0):
        assert min(dimensions)>0, name+' invalid box'
        dx,dy,dz=[v/2 for v in dimensions];cx,cy,cz=center;c,s=math.cos(angle),math.sin(angle)
        vertices=[(cx+x*c-y*s,cy+x*s+y*c,cz+z) for z in (-dz,dz)
                  for x,y in [(-dx,-dy),(dx,-dy),(dx,dy),(-dx,dy)]]
        return self.mesh(name,vertices,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],materialKey)

    def prism(self,name,ring,z0,z1,materialKey):
        if ring[0]==ring[-1]:ring=ring[:-1]
        count=len(ring);vertices=[(p[0],p[1],z) for z in (z0,z1) for p in ring]
        return self.mesh(name,vertices,[tuple(reversed(range(count))),tuple(range(count,count*2))]
                         +[(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)],materialKey)

    def beam(self,name,a,b,width,depth,materialKey):
        a,b=Vector(a),Vector(b);direction=b-a
        assert direction.length>1e-7,name+' zero beam'
        rotation=direction.to_track_quat('Z','Y');center=(a+b)/2
        vertices=[tuple(center+rotation@Vector((x,y,z))) for z in (-direction.length/2,direction.length/2)
                  for x,y in [(-width/2,-depth/2),(width/2,-depth/2),(width/2,depth/2),(-width/2,depth/2)]]
        return self.mesh(name,vertices,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],materialKey)

    def cylinder(self,name,center,radius,depth,materialKey,vertices=12):
        cx,cy,cz=center
        ring=[(cx+radius*math.cos(i*math.tau/vertices),cy+radius*math.sin(i*math.tau/vertices)) for i in range(vertices)]
        return self.prism(name,ring,cz-depth/2,cz+depth/2,materialKey)

    def gable(self,name,cx,cy,length,width,eaveZ,ridgeZ,angle,materialKey='roof_dark'):
        c,s=math.cos(angle),math.sin(angle)
        vertices=[(cx+c*x-s*y,cy+s*x+c*y,z) for x,y,z in [(-length/2,-width/2,eaveZ),(length/2,-width/2,eaveZ),
                  (length/2,0,ridgeZ),(-length/2,0,ridgeZ),(-length/2,width/2,eaveZ),(length/2,width/2,eaveZ)]]
        return self.mesh(name,vertices,[(0,1,2,3),(3,2,5,4)],materialKey)

    def drape(self,name,ring,materialKey,lift=.06):
        if ring[0]==ring[-1]:ring=ring[:-1]
        if self.current_id:
            self.records[self.current_id].setdefault('groundSurfaceRingsBlenderXY',[]).append([list(p) for p in ring])
        vectors=[Vector((p[0],p[1],0)) for p in ring]
        triangles=tessellate_polygon([vectors]);pending=[]
        for tri in triangles:
            pending.append(tuple(tuple((vectors[v] if isinstance(v,int) else v)[:2]) for v in tri))
        vertices,faces,lookup=[],[],{}
        while pending:
            tri=pending.pop();edges=[math.dist(tri[i],tri[(i+1)%3]) for i in range(3)];i=max(range(3),key=edges.__getitem__)
            if edges[i]>1.25:
                a,b,c=tri[i],tri[(i+1)%3],tri[(i+2)%3];mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
                pending.extend([(a,mid,c),(mid,b,c)]);continue
            face=[]
            for x,y in tri:
                key=(round(x,7),round(y,7))
                if key not in lookup:lookup[key]=len(vertices);vertices.append((x,y,self.ground(x,y)+lift))
                face.append(lookup[key])
            faces.append(face)
        obj=self.mesh(name,vertices,faces,materialKey)
        obj['surface_overlay']=True
        for face in obj.data.polygons:face.use_smooth=True
        return obj


def build():
    global PREFIX
    OUT.mkdir(parents=True,exist_ok=True)
    revision=1
    while (OUT/f'angso-facilities-v{revision}.blend').exists() or bpy.data.scenes.get(f'Angso | Facility architecture v{revision}'):
        revision+=1
    name=f'Angso | Facility architecture v{revision}';PREFIX=f'ANG MODEL {revision} | '
    inputs=json.loads((HERE/'model-inputs.json').read_text(encoding='utf-8'))
    for item in inputs['sourceInputs']:assert sha(ROOT/item['path'])==item['sha256'],item['path']
    def snapshot():
        return {s.name:[(o.name,tuple(v for row in o.matrix_world for v in row)) for o in s.objects] for s in bpy.data.scenes}
    before=snapshot();active=bpy.context.scene.name;current_file=bpy.data.filepath
    selection=sorted(o.name for o in bpy.context.selected_objects)
    scene=bpy.data.scenes.new(name);scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene['originEPSG3006']=inputs['originEPSG3006'];scene['originHeightRH2000']=8.
    scene['axis_contract']='X east, Y grid north, Z up; EPSG3006 origin605530,6605140; RH2000 minus8'
    scene['model_status']='Finished environment assets; unseen architectural details are estimates'
    def collection(label):
        c=bpy.data.collections.new(PREFIX+label);scene.collection.children.link(c);return c
    architecture=collection('01 Editable architecture');context=collection('02 Ground context - not exported');rig=collection('03 Review lighting and cameras')
    ctx=Builder(scene,architecture,inputs);reports={}
    for filename in ('model_clubhouse.py','model_facilities.py'):
        spec=importlib.util.spec_from_file_location('angso_'+filename[:-3],HERE/filename)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        reports[filename]=module.build(ctx)
    # B02 remains a candidate reference: photo review identifies the apparent
    # narrow roof band as likely shadow, with insufficient laser support.
    assert all(fid in ctx.roots for fid in ['B01','B03','B04','B04a','B05','B06','B07','B08','B09','B10','B11','B12','B13',
                                          'S01','S02','S04','S05','S06','S07']), 'Missing facility'
    assert 'B02' not in ctx.roots, 'Unconfirmed shadow-like trace must not become architecture'
    for fid,record in ctx.records.items():
        if record['kind']=='site' and 'groundSurfaceRingsBlenderXY' not in record:
            record['groundSurfaceRingsBlenderXY']=[ctx.inventory[fid]['ringBlenderXY']]
    ctx.current_id=None;ctx.collection=context
    for label,bounds,step in [('Campus terrain',(-135,-170,155,175),2),('Northern terrain',(15,910,160,1100),3)]:
        x0,y0,x1,y1=bounds;nx=math.ceil((x1-x0)/step)+1;ny=math.ceil((y1-y0)/step)+1
        vertices=[(x0+x*step,y0+y*step,ctx.ground(x0+x*step,y0+y*step)-.08) for y in range(ny) for x in range(nx)]
        faces=[]
        for row in range(ny-1):
            for col in range(nx-1):
                i=row*nx+col;faces.append((i,i+1,i+nx+1,i+nx))
        obj=ctx.mesh(label,vertices,faces,'grass')
        for face in obj.data.polygons:face.use_smooth=True
    def aim(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    def camera(label,position,target,scale):
        data=bpy.data.cameras.new(PREFIX+label);data.type='ORTHO';data.ortho_scale=scale;data.clip_end=4000
        obj=bpy.data.objects.new(PREFIX+label,data);rig.objects.link(obj);obj.location=position;aim(obj,target);return obj
    cameras={
        'courtyard':camera('Courtyard',(-36,-68,32),(2,-7,3),74),
        'restaurant-rear':camera('Restaurant rear',(-63,65,28),(-6,13,3),76),
        'campus':camera('Campus',(170,-220,210),(0,0,1),280),
        'range':camera('Range',(120,-200,40),(40,-105,0),112),
        'kiosk-carts':camera('Kiosk and cart shelter',(-36,78,24),(26,84,2),70),
        'northern':camera('Northern service context',(25,940,45),(75,1000,10),96),
    }
    scene.camera=cameras['courtyard']
    data=bpy.data.lights.new(PREFIX+'Sun','SUN');data.energy=2.7;data.angle=.10
    sun=bpy.data.objects.new(PREFIX+'Sun',data);rig.objects.link(sun);sun.rotation_euler=(.45,-.55,-.5)
    data=bpy.data.lights.new(PREFIX+'Sky fill','AREA');data.energy=1800;data.shape='DISK';data.size=100
    fill=bpy.data.objects.new(PREFIX+'Sky fill',data);rig.objects.link(fill);fill.location=(-15,-30,70);aim(fill,(0,0,0))
    scene.world=bpy.data.worlds.new(PREFIX+'World');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.38,.46,.56,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
    scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=1600;scene.render.resolution_y=1100
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
    notes=bpy.data.texts.new(PREFIX+'Model source and interpretation');notes.use_fake_user=True
    notes.write(json.dumps({'origin':inputs['originEPSG3006'],'heightOrigin':8,'facilities':list(ctx.records.values()),'reports':reports},ensure_ascii=False,indent=2))
    output=OUT/f'angso-facilities-v{revision}.blend'
    after=snapshot();assert all(after[k]==v for k,v in before.items())
    assert bpy.context.scene.name==active and bpy.data.filepath==current_file and sorted(o.name for o in bpy.context.selected_objects)==selection
    bpy.data.libraries.write(str(output),{scene,notes},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
    meshes=[o for o in scene.objects if o.type=='MESH' and o.get('generated_facility_model')]
    for fid,root in ctx.roots.items():
        assert any(o.type=='MESH' for o in root.children),fid+' empty'
        ctx.records[fid]['blenderNodeName']=root.name
    report={'schemaVersion':1,'passed':True,'scene':scene.name,'revision':revision,'blendPath':output.relative_to(ROOT).as_posix(),
            'blendSha256':sha(output),'originEPSG3006':inputs['originEPSG3006'],'originHeightRH2000':8,
            'facilities':list(ctx.records.values()),'modeling':reports,'existingScenesPreserved':True,'activeScenePreserved':active,
            'currentFilePreserved':True,'selectionPreserved':True,'cameras':{k:v.name for k,v in cameras.items()},
            'counts':{'facilities':len(ctx.roots),'meshObjects':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes)},
            'sourceInputs':[{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p)} for p in [HERE/'model-inputs.json',HERE/'model_clubhouse.py',HERE/'model_facilities.py',HERE/'build_facility_models.py']]}
    (HERE/'model-build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['passed','scene','blendPath','counts','existingScenesPreserved']}))


if __name__=='__main__':build()
