"""Build Ribbingsfors references and original facility models via local Blender MCP.

Never clears an existing scene or overwrites an existing deliverable. A saved
library contains only the two new scenes and their packed dependencies.
"""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT/'ribbingsforsbuild/facilities'
OUT = ROOT/'ribbingsforsbuild/cache/facilities-model-2026-09-10'
sys.path.insert(0,str(HERE))
from geometry import Geometry
import model_clubhouse


def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def collection(scene,name):
    c=bpy.data.collections.new('RIBB | '+name);scene.collection.children.link(c);return c
def make_scene(name):
    s=bpy.data.scenes.new(name);s.unit_settings.system='METRIC';s.unit_settings.scale_length=1
    s['horizontal_crs']='EPSG:3006';s['origin_easting_northing']=[448975.5,6536024.5]
    s['vertical_crs']='EPSG:5613';s['vertical_origin_rh2000']=0.0
    s['axis_contract']='X east, Y grid north, Z absolute RH2000 metres'
    s['reference_date']='2026-09-10';s['architectural_heights_measured']=False
    return s
def camera(scene,coll,name,location,target,scale):
    data=bpy.data.cameras.new('RIBB | '+name);data.type='ORTHO';data.ortho_scale=scale;data.clip_end=5000
    ob=bpy.data.objects.new('RIBB | '+name,data);coll.objects.link(ob);ob.location=location
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
    if not scene.camera:scene.camera=ob
    return ob
def render_settings(scene):
    scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=1500;scene.render.resolution_y=1100
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='AgX'
    scene.world=bpy.data.worlds.new('RIBB | '+scene.name+' world');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.36,.43,.52,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7


def build():
    output=OUT/'ribbingsfors-facilities.blend'
    if output.exists() or bpy.data.scenes.get('Ribbingsfors | Facilities 2026-09-10'):
        raise RuntimeError('Ribbingsfors scene/output already exists; choose a new revision to preserve edits')
    inputs=[HERE/'reference/orthophoto-manifest.json', HERE/'reference/reviewed-ortho-traces.json',
            HERE/'reference/facility-ground.json',HERE/'photo-reference-manifest.json']
    ortho,traces,ground_spec,photos=map(read,inputs)
    features=traces['features']; lookup={f['id']:f for f in features}
    before={s.name:tuple(sorted(o.name for o in s.objects)) for s in bpy.data.scenes}
    active_before=bpy.context.scene.name;file_before=bpy.data.filepath
    def ground(x,y):
        for panel in ground_spec['panels']:
            step=panel.get('spacingM',panel.get('spacingMetres',panel.get('stepMetres',1)))
            fx=(x-panel['x0'])/step;fz=(-y-panel['z0'])/step
            w,h=panel['width'],panel['height']
            if not(0<=fx<=w-1 and 0<=fz<=h-1):continue
            c=min(int(fx),w-2);r=min(int(fz),h-2);tx=fx-c;tz=fz-r
            a=panel['heightsRH2000M']; at=lambda cc,rr:a[rr*w+cc]
            return (at(c,r)*(1-tx)+at(c+1,r)*tx)*(1-tz)+(at(c,r+1)*(1-tx)+at(c+1,r+1)*tx)*tz
        raise ValueError('Outside measured terrain '+str((x,y)))

    ref=make_scene('Ribbingsfors | Source references 2026-09-10')
    ref['axis_contract']='XY georeferenced; maps/outlines at arbitrary flat reference Z=0, not elevation'
    maps=collection(ref,'References / Lantmateriet orthophotos')
    lines=collection(ref,'References / reviewed geometry')
    boards=collection(ref,'References / exterior photos')
    labels=collection(ref,'References / labels and cameras')
    rg=Geometry(lines,'RIBB REF | ')
    def label(body,x,y,size=2):
        d=bpy.data.curves.new('RIBB | '+body,'FONT');d.body=body;d.size=size
        d.materials.append(rg.materials['white'])
        ob=bpy.data.objects.new('RIBB | '+body,d);ob.location=(x,y,1);labels.objects.link(ob)
        return ob
    def image_plane(name,path,bounds,z,target,metadata):
        img=bpy.data.images.load(str(path),check_existing=False);img.name='RIBB SOURCE | '+name;img.pack()
        m=bpy.data.materials.new('RIBB SOURCE | '+name);m.use_nodes=True
        nodes=m.node_tree.nodes;nodes.clear();texture=nodes.new('ShaderNodeTexImage');texture.image=img
        em=nodes.new('ShaderNodeEmission');out=nodes.new('ShaderNodeOutputMaterial')
        m.node_tree.links.new(texture.outputs['Color'],em.inputs['Color']);m.node_tree.links.new(em.outputs[0],out.inputs[0])
        x0,y0,x1,y1=bounds
        old=rg.collection;rg.collection=target
        ob=rg.mesh(name,[(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z)],[(0,1,2,3)],m)
        rg.collection=old;uv=ob.data.uv_layers.new(name='North up')
        coords=[(0,0),(1,0),(1,1),(0,1)]
        for loop in ob.data.loops:uv.data[loop.index].uv=coords[loop.vertex_index]
        ob['reference_only']=True
        for k,v in metadata.items():ob[k]=json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v
        return ob
    for i,p in enumerate(ortho['panels']):
        path=ROOT/p['png'];assert sha(path)==p['pngSha256'],path
        w,s,e,n=p['boundsEpsg3006']
        image_plane(p['id'],path,[w-448975.5,s-6536024.5,e-448975.5,n-6536024.5],.02*i,maps,
                    {'source_panel':p['id'],'capture_dates':p['sourceCaptureDates'],'pixel_size_metres':p['pixelSizeMetres']})
    for f in features:
        rg.feature=f['id'];ring=f.get('ringBlenderXY',[])
        if ring:
            ob=rg.line(f['id'],[(x,y,.45) for x,y in ring],closed=True,width=.10)
            ob['source_evidence']=json.dumps(f,ensure_ascii=False)
            x=sum(p[0] for p in ring)/len(ring);y=sum(p[1] for p in ring)/len(ring)
        else:
            x,y=f['centerBlenderXY'];rg.line(f['id'],[(x-.6,y,.45),(x+.6,y,.45)],width=.08)
        if f['kind']!='range-mat':label(f['id'],x,y+2,1.1)
    label('RIBBINGSFORS / LANTMATERIET 2024-05-17 / 0.16 m',400,690,6)
    label('Source-image edges; architectural heights remain estimates.',400,679,3)
    rg.line('50 metre scale',[(410,650,.5),(460,650,.5)],width=.3);label('50 m',426,654,3)
    rg.line('Grid north',[(815,620,.5),(815,660,.5),(809,651,.5)],width=.3);label('N',812,665,5)
    valid_photos=[p for p in photos['records'] if p.get('localPath') and (HERE/p['localPath']).exists()]
    for i,p in enumerate(valid_photos):
        path=HERE/p['localPath'];assert sha(path)==p['sha256'],path
        col,row=i%4,i//4;x=1050+col*100;y=670-row*95
        # Use image-native aspect, with generous margins for portrait photos.
        temp=bpy.data.images.load(str(path),check_existing=True);w,h=temp.size
        width=min(90,72*w/h);height=width*h/w
        image_plane(p['id'],path,[x,y-height,x+width,y],0,boards,
                    {'source_url':p['sourceUrl'],'credit':p.get('credit') or 'See source manifest',
                     'capture_date':p.get('captureDate') or 'unknown','source_pixels_for_internal_reference_only':True})
        label(p['id'],x,y-height-4,2)
    ref_cams={
        'reference-campus':camera(ref,labels,'Reference campus',(620,420,1500),(620,420,0),590),
        'reference-clubhouse':camera(ref,labels,'Reference clubhouse',(490,459,600),(490,459,0),125),
        'reference-range':camera(ref,labels,'Reference range',(625,370,800),(625,370,0),320),
        'reference-photos':camera(ref,labels,'Exterior photo boards',(1240,510,1000),(1240,510,0),465),
        'reference-yard':camera(ref,labels,'Reference maintenance',(-350,-185,600),(-350,-185,0),170)}
    ref.camera=ref_cams['reference-campus'];render_settings(ref);ref.view_settings.view_transform='Standard'

    scene=make_scene('Ribbingsfors | Facilities 2026-09-10')
    club=collection(scene,'Models / Clubhouse and terrace')
    fac=collection(scene,'Models / Range and nearby buildings')
    site=collection(scene,'Context / terrain and observed surfaces')
    rig=collection(scene,'Review / cameras and lighting')
    g=Geometry(club)
    clubhouse=lookup['clubhouse-main']
    clubhouse['terrace']=lookup.get('clubhouse-terrace')
    reports={'clubhouse':model_clubhouse.build(g,clubhouse,ground)}
    g.collection=fac
    import model_facilities
    reports['facilities']=model_facilities.build(g,features,ground)
    g.collection=site;g.feature='measured-terrain-context'
    for panel in ground_spec['panels']:
        w,h=panel['width'],panel['height'];a=panel['heightsRH2000M'];v=[];faces=[]
        # Decimate only display mesh to 2m; foundations retain 1m interpolation.
        cols=list(range(0,w,2));rows=list(range(0,h,2))
        for r in rows:
            for c in cols:v.append((panel['x0']+c,-panel['z0']-r,a[r*w+c]-.07))
        ww=len(cols)
        for r in range(len(rows)-1):
            for c in range(ww-1):
                i=r*ww+c;faces.append((i,i+ww,i+ww+1,i+1))
        obj=g.mesh('Terrain / '+panel['id'],v,faces,'grass');obj['context_only']=True
        for face in obj.data.polygons:face.use_smooth=True
    # Physical surface outlines are native-image observations, draped to measured terrain.
    for f in features:
        if f['kind'] not in ('practice-green','range-apron','parking','yard','range-field','path','pond'):continue
        ring=f.get('ringBlenderXY',[])
        if len(ring)<3:continue
        g.feature=f['id'];poly=[Vector((x,y,0)) for x,y in ring]
        tris=tessellate_polygon([poly]);v=[];faces=[]
        for tri in tris:
            points=[poly[i] if isinstance(i,int) else i for i in tri]
            pending=[[(p.x,p.y) for p in points]]
            while pending:
                t=pending.pop();lengths=[math.dist(t[i],t[(i+1)%3]) for i in range(3)];i=lengths.index(max(lengths))
                if lengths[i]>3:
                    a,b,c=t[i],t[(i+1)%3],t[(i+2)%3];mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
                    pending.extend([[a,mid,c],[mid,b,c]]);continue
                idx=len(v);v.extend((x,y,ground(x,y)+.025) for x,y in t);faces.append((idx,idx+1,idx+2))
        obj=g.mesh(f['id'],v,faces,'green' if f['kind']=='practice-green' else 'grass' if f['kind']=='range-field' else 'water' if f['kind']=='pond' else 'gravel')
        obj['context_only']=True;obj['source_evidence']=json.dumps(f)
    cams={
        'clubhouse':camera(scene,rig,'Clubhouse terrace',(520,414,109),(481,454,80),51),
        'clubhouse-west':camera(scene,rig,'Clubhouse west',(442,421,105),(480,457,80),50),
        'range-bays':camera(scene,rig,'Range open bays',(608,403,101),(645,435,80),94),
        'range-overview':camera(scene,rig,'Driving range',(810,150,270),(620,335,77),385),
        'campus':camera(scene,rig,'Whole campus',(975,-40,495),(602,475,78),560),
        'manor':camera(scene,rig,'Manor precinct',(630,470,130),(522,566,76),185),
        'maintenance':camera(scene,rig,'Maintenance context',(-275,-300,140),(-350,-190,81),160)}
    scene.camera=cams['clubhouse'];render_settings(scene)
    sun_data=bpy.data.lights.new('RIBB | Sun','SUN');sun_data.energy=2.5;sun_data.angle=.09
    sun=bpy.data.objects.new('RIBB | Sun',sun_data);rig.objects.link(sun);sun.rotation_euler=(.4,-.5,-.45)
    scene.render.filepath=str(OUT/'clubhouse.png')
    notes=bpy.data.texts.new('RIBB | Evidence and modelling notes');notes.write(json.dumps(reports,indent=2,ensure_ascii=False))
    notes.use_fake_user=True
    scene['modeling_report']=notes.name
    assert bpy.data.filepath==file_before and bpy.context.scene.name==active_before
    assert all(tuple(sorted(o.name for o in bpy.data.scenes[n].objects))==names for n,names in before.items())
    OUT.mkdir(parents=True,exist_ok=True)
    bpy.data.libraries.write(str(output),{ref,scene,notes},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
    report={'schemaVersion':1,'passed':True,'blendPath':output.relative_to(ROOT).as_posix(),'blendSha256':sha(output),
            'scenes':[ref.name,scene.name],'sourceSceneCount':len(before),'existingScenesPreserved':True,
            'previousActiveScene':active_before,'currentFilePreserved':True,
            'referenceImagesPacked':len(ortho['panels'])+len(valid_photos),'reviewedFeatures':len(features),
            'modelMeshCount':sum(o.type=='MESH' and not o.get('context_only') for o in scene.objects),
            'cameras':{k:v.name for k,v in {**ref_cams,**cams}.items()},'modeling':reports,
            'sourceInputs':[{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p)} for p in inputs]}
    (HERE/'blender-build-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('sourceInputs','modeling')},ensure_ascii=False))


if __name__=='__main__':build()
