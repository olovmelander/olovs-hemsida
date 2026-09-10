"""Author Lidingö facilities in an isolated Blender scene using reviewed inputs.

Invoked through Blender MCP. Exports only an owned scene library; packaging and
GLB export run in a separate background Blender process.
"""
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(r'C:/Users/olov_/repos/olovs-hemsida')
OUT = ROOT/'lidingobuild/cache/facilities-model-2026-09-10'
SCENE = 'Lidingö | Authored facilities 2026-09-10 | r2'
PREFIX = 'LID MODEL | '


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def srgb(value):
    return value/12.92 if value<=.04045 else ((value+.055)/1.055)**2.4


class Context:
    def __init__(self, scene):
        self.scene = scene
        self.model = json.loads((ROOT/'lidingobuild/cache/facilities-reference-2026-09-10/model-reference.json').read_text(encoding='utf-8'))
        self.terrain = json.loads((OUT/'terrain-1m.json').read_text(encoding='utf-8'))
        self.materials, self.facilities = {}, []

    def ground(self, x, y):
        e,n=x+677700.5,y+6586399.5
        tile=next((t for t in self.terrain['tiles'] if t['bounds']['minEasting']<=e<=t['bounds']['maxEasting'] and t['bounds']['minNorthing']<=n<=t['bounds']['maxNorthing']),None)
        if tile is None:
            raise ValueError(f'Terrain unavailable at {x},{y}')
        b,g,h=tile['bounds'],tile['grid'],tile['heights']
        u,v=e-b['minEasting'],b['maxNorthing']-n
        i,j=min(g['width']-2,math.floor(u)),min(g['height']-2,math.floor(v))
        a,c=u-i,v-j
        k=j*g['width']+i
        return (h[k]*(1-a)+h[k+1]*a)*(1-c)+(h[k+g['width']]*(1-a)+h[k+g['width']+1]*a)*c-25

    def facility(self, id, source_ids, footprintXY, evidence, exclude_vegetation=True):
        assert id and not any(f['id']==id for f in self.facilities)
        assert all(s.startswith('way/') for s in source_ids), 'source_ids contains a non-building evidence reference'
        assert not set(source_ids).intersection(s for f in self.facilities for s in f['sourceBuildingIds']), 'Duplicate source building replacement'
        assert len(footprintXY)>=3 and all(len(p)>=2 and all(math.isfinite(v) for v in p[:2]) for p in footprintXY)
        ring=[list(p[:2]) for p in footprintXY]
        parent=bpy.data.objects.new('lidingo_'+id.replace('/','_').replace(' ','_'),None)
        self.scene.collection.objects.link(parent)
        parent['facilityId']=id
        parent['sourceBuildingIds']=source_ids
        parent['evidence']=json.dumps(evidence,ensure_ascii=False)
        parent['appearance_model']=True
        parent['footprint_blender_xy']=json.dumps(ring)
        x=sum(p[0] for p in ring)/len(ring)
        y=sum(p[1] for p in ring)/len(ring)
        self.facilities.append({'id':id,'nodeName':parent.name,'sourceBuildingIds':list(source_ids),
          'footprintLocal':[[px,-py] for px,py in ring], 'groundAnchorLocal':[x,-y],
          'groundAnchorRh2000M':self.ground(x,y)+25,'placement':'absolute-rh2000',
          'evidence':evidence,'excludeVegetation':exclude_vegetation})
        return parent

    def material(self,color,roughness=.8,metallic=0,alpha=1):
        key=(color,roughness,metallic,alpha)
        if key in self.materials:
            return self.materials[key]
        rgb=tuple(srgb(((color>>n)&255)/255) for n in (16,8,0))
        mat=bpy.data.materials.new(PREFIX+f'{color:06x}_{roughness}_{metallic}_{alpha}')
        mat.diffuse_color=(*rgb,alpha)
        mat.use_nodes=True
        shader=mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=(*rgb,1)
        shader.inputs['Roughness'].default_value=roughness
        shader.inputs['Metallic'].default_value=metallic
        shader.inputs['Alpha'].default_value=alpha
        if alpha<1:
            mat.surface_render_method='DITHERED'
            if hasattr(mat,'use_transparent_shadow'):
                mat.use_transparent_shadow=False
        self.materials[key]=mat
        return mat

    def mesh(self,parent,name,vertices,triangleIndices,color,roughness=.8,metallic=0,alpha=1):
        assert all(len(v)==3 and all(math.isfinite(x) for x in v) for v in vertices),name
        if triangleIndices and isinstance(triangleIndices[0],(list,tuple)):
            faces=triangleIndices
        else:
            assert len(triangleIndices)%3==0,name
            faces=[triangleIndices[i:i+3] for i in range(0,len(triangleIndices),3)]
        data=bpy.data.meshes.new(PREFIX+name)
        data.from_pydata(vertices,[],faces)
        data.update()
        data.materials.append(self.material(color,roughness,metallic,alpha))
        obj=bpy.data.objects.new(PREFIX+name,data)
        self.scene.collection.objects.link(obj)
        obj.parent=parent
        obj['authoredPart']=name
        obj['srgbColor']=f'#{color:06x}'
        return obj

    def box(self,parent,name,centerXYZ,sizeXYZ,color,yaw=0,roughness=.8,metallic=0,alpha=1):
        x,y,z=centerXYZ
        a,b,c=[v/2 for v in sizeXYZ]
        co,si=math.cos(yaw),math.sin(yaw)
        vertices=[(x+u*co-v*si,y+u*si+v*co,z+w) for u,v,w in
                  [(-a,-b,-c),(a,-b,-c),(a,b,-c),(-a,b,-c),(-a,-b,c),(a,-b,c),(a,b,c),(-a,b,c)]]
        faces=[(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]
        return self.mesh(parent,name,vertices,faces,color,roughness,metallic,alpha)

    def beam(self,parent,name,startXYZ,endXYZ,width,depth,color):
        a,b=Vector(startXYZ),Vector(endXYZ)
        d=b-a
        assert d.length>1e-6,name
        rot=d.to_track_quat('Z','Y')
        half=d.length/2
        vertices=[tuple((a+b)/2+rot@Vector((u,v,w))) for u,v,w in
                  [(-width/2,-depth/2,-half),(width/2,-depth/2,-half),(width/2,depth/2,-half),(-width/2,depth/2,-half),
                   (-width/2,-depth/2,half),(width/2,-depth/2,half),(width/2,depth/2,half),(-width/2,depth/2,half)]]
        return self.mesh(parent,name,vertices,[(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],color)

    def cylinder(self,parent,name,centerXYZ,radius,depth,color,vertices=12):
        x,y,z=centerXYZ
        points=[(x+radius*math.cos(i*2*math.pi/vertices),y+radius*math.sin(i*2*math.pi/vertices),z+dz)
                for dz in (-depth/2,depth/2) for i in range(vertices)]
        faces=[tuple(reversed(range(vertices))),tuple(range(vertices,2*vertices))]
        faces += [(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
        return self.mesh(parent,name,points,faces,color)

    def import_parts(self,parent,building_id,omit_parts=(),recolor={}):
        objects=[]
        for p in self.model['architectureMeshes']:
            if p['buildingId']!=building_id or p['part'] in omit_parts:
                continue
            color=recolor.get(p['part'],recolor.get(p['color'],p['color']))
            objects.append(self.mesh(parent,building_id+' '+p['part'],p['vertices'],p['triangleIndices'],color))
        return objects


def build():
    assert bpy.data.scenes.get(SCENE) is None, 'Preserve previous authored scene; choose a new revision name'
    path=OUT/'lidingo-authored-r2.library.blend'
    assert not path.exists(),'Preserve previous authored library'
    before={s.name:[(o.name,tuple(v for row in o.matrix_world for v in row)) for o in s.objects] for s in bpy.data.scenes}
    active,file=bpy.context.scene.name,bpy.data.filepath
    scene=bpy.data.scenes.new(SCENE)
    scene.unit_settings.system='METRIC'
    scene['horizontalCrs']='EPSG:3006'
    scene['verticalCrs']='EPSG:5613 / RH2000'
    scene['originEasting']=677700.5
    scene['originNorthing']=6586399.5
    scene['originHeightRH2000']=25.0
    scene['axisContract']='X east, Y north, Z RH2000 minus25; 1 unit=1m'
    ctx=Context(scene)
    modules=[]
    for name in ('model-clubhouse','model-range','model-ancillary'):
        source=ROOT/f'lidingobuild/facilities/{name}.py'
        module_spec=importlib.util.spec_from_file_location(name.replace('-','_'),source)
        module=importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        result=module.build(ctx)
        modules.append({'path':source.relative_to(ROOT).as_posix(),'sha256':sha(source),'result':result})
    scene['facilityInventory']=json.dumps(ctx.facilities,ensure_ascii=False)
    scene['modelSources']=json.dumps(modules,ensure_ascii=False)
    notes=bpy.data.texts.new(PREFIX+'Modelling evidence')
    notes.write('Lidingö authored facilities. Photo-informed appearance and roof-derived scale; not a building survey.\n')
    for path_note in ('model-clubhouse-notes.md','model-range-notes.md','model-ancillary-notes.md'):
        p=ROOT/'lidingobuild/facilities'/path_note
        if p.exists(): notes.write('\n'+p.read_text(encoding='utf-8'))
    notes.use_fake_user=True
    scene['readmeText']=notes.name
    after={s.name:[(o.name,tuple(v for row in o.matrix_world for v in row)) for o in s.objects] for s in bpy.data.scenes}
    assert all(after[n]==objects for n,objects in before.items()),'Existing scene changed'
    assert bpy.context.scene.name==active and bpy.data.filepath==file
    bpy.data.libraries.write(str(path),{scene,notes},fake_user=True,compress=True)
    result={'scene':SCENE,'libraryPath':path.relative_to(ROOT).as_posix(),'librarySha256':sha(path),
      'facilities':ctx.facilities,'materials':len(ctx.materials),'objects':len(scene.objects),
      'modules':modules,'previousScenesPreserved':True}
    (OUT/'authoring-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('facilities','modules')},ensure_ascii=False))


build()
