"""Build a separate, georeferenced Visby architecture scene through Blender MCP.

Existing scene selection, file path and objects are preserved. Only Visby-owned
generated data is refreshed on reruns. Export/render happens in a separate process.
"""
from pathlib import Path
import array
import hashlib
import importlib
import json
import math
import sys
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
HERE=ROOT/'visbybuild/facilities';OUT=HERE/'output';OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(HERE))
import model_primitives,model_clubhouse,model_facilities,model_range
for module in (model_primitives,model_clubhouse,model_facilities,model_range):importlib.reload(module)
from model_primitives import Builder,Frame

SCENE='Visby | Kronholmen facilities'
model=json.loads((ROOT/'visbybuild/course-model.json').read_text(encoding='utf-8'))
inventory=json.loads((HERE/'facility-inventory.json').read_text(encoding='utf-8'))
# The range layout: mats detected on the 2026 panel, the traced east net, and
# the studio and covered-bay roofs with their photo-informed heights
# (trace-range-layout.py writes it; nothing in it is typed by hand).
range_layout=json.loads((HERE/'range-layout.json').read_text(encoding='utf-8'))
observations={f['id']:f for f in inventory['facilities']}
station={c['id']:c for c in json.loads((HERE/'reference/station-roof-components.json').read_text(encoding='utf-8'))['components']}
ground_file=ROOT/'visbybuild/cache/terrain-review/terrain-1m.f32'
heights=array.array('f');heights.frombytes(ground_file.read_bytes())
assert len(heights)==4097*4097
if sys.byteorder!='little':heights.byteswap()


def ground(x,y):
    col=x+687748.5-685700.5;row=6372999.5-(y+6370951.5)
    assert 0<=col<4096 and 0<=row<4096
    c,r=int(col),int(row);tx,ty=col-c,row-r
    def h(dx,dy):return heights[(r+dy)*4097+c+dx]
    return (h(0,0)*(1-tx)+h(1,0)*tx)*(1-ty)+(h(0,1)*(1-tx)+h(1,1)*tx)*ty


def add_reference_panel(collection,panel):
    im=bpy.data.images.load(str(ROOT/panel['png']),check_existing=False);im.pack()
    gt=panel['geoTransform'];w,h=im.size;x0=gt[0]-687748.5;y1=gt[3]-6370951.5;spanx=w*gt[1];spany=-h*gt[5]
    nx,ny=int(spanx/2)+1,int(spany/2)+1;verts=[];faces=[]
    for row in range(ny):
        for col in range(nx):
            x=x0+spanx*col/(nx-1);y=y1-spany*row/(ny-1);verts.append((x,y,ground(x,y)-.05))
    for row in range(ny-1):
        for col in range(nx-1):
            i=row*nx+col;faces.append((i,i+nx,i+nx+1,i+1))
    mesh=bpy.data.meshes.new('Visby / Reference '+panel['id']);mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new()
    for poly in mesh.polygons:
        for loop in poly.loop_indices:
            point=mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv=((point.x-x0)/spanx,1-(y1-point.y)/spany)
    mat=bpy.data.materials.new(mesh.name);mat.use_nodes=True;tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im
    mat.node_tree.links.new(tex.outputs['Color'],mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=1;mesh.materials.append(mat)
    obj=bpy.data.objects.new(mesh.name,mesh);collection.objects.link(obj);obj['referenceOnly']=True
    obj['geoTransform']=gt;obj['attribution']=panel['attribution'];obj['sourcePanel']=panel['id']


def build():
    active=bpy.context.scene.name;oldfile=bpy.data.filepath
    previous={s.name:tuple(sorted(o.name for o in s.objects)) for s in bpy.data.scenes if s.name!=SCENE}
    existing=bpy.data.scenes.get(SCENE)
    if existing:
        assert existing.get('generator')=='visbybuild/facilities/build_blender_scene.py','Scene name belongs to user data'
        assert active!=SCENE,'Select another scene before rebuilding this generated scene'
        for obj in list(existing.objects):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.scenes.remove(existing)
    scene=bpy.data.scenes.new(SCENE);scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene['generator']='visbybuild/facilities/build_blender_scene.py'
    scene['horizontalCrs']='EPSG:3006';scene['heightDatum']='RH2000'
    scene['originEpsg3006']=[687748.5,6370951.5];scene['axisContract']='X east, Y north, Z absolute RH2000 metres'
    scene['architecturalAccuracy']='Reference-based visual reconstruction, not a measured survey. Hidden facades and architectural heights estimated.'
    ctx=Builder(scene);facilities=[];reports=[]
    names={'530655627':'Range practice building','530655628':'Eastern service building','530655629':'Parking auxiliary building',
           '530655630':'Eastern clubhouse auxiliary','530655631':'Clubhouse and terraces','530655632':'Red former keeper house','530655633':'Fyrhuset lodging'}
    for record in model['infra']['buildings']:
        record=dict(record)
        short=record['id'].split('/')[-1]
        if short not in names:continue
        if short=='530655629':record['ring']=[[x,-y] for x,y in observations[record['id']]['roofObservation']['roofEnvelopeBlenderXY']]
        if short in ('530655632','530655633'):
            component=station['keeper-core' if short=='530655632' else 'fyrhuset-core']
            record['ring']=[[x,-y] for x,y in component['roofCornersBlenderXY']]
            if record['ring'][0]!=record['ring'][-1]:record['ring'].append(record['ring'][0])
        ring=record['ring'][:-1];x=sum(p[0] for p in ring)/len(ring);z=sum(p[1] for p in ring)/len(ring)
        ground_height=ground(x,-z)
        record['foundationMinRH2000']=min(ground(px+dx,-pz+dy) for px,pz in ring for dx,dy in [(0,0),(-2,0),(2,0),(0,-2),(0,2)])-.15
        key='clubhouse' if short=='530655631' else record['id']
        name='Visby '+names[short]
        ctx.group(key,name,{'sourceBuildingId':record['id'],'facilityId':key,'referenceBased':True})
        facilities.append({'id':key,'nodeName':name,'sourceBuildingId':record['id'],'groundAnchorLocal':[x,z],
                           'groundAnchorRh2000M':ground_height,'placement':'absolute-rh2000'})
        if key=='clubhouse':reports.append(model_clubhouse.build(ctx,ground_height))
        elif short=='530655627':reports.append(model_range.studio(ctx,key,range_layout['structures']['studio'],ground))
        else:reports.append(model_facilities.building(ctx,record,ground_height))
    new_roofs={
        'range-parking-building-2026':{'eaveEstimate':2.8,'ridgeEstimate':4.6},
        'service-west-north-2026':{'eaveEstimate':3.25,'ridgeEstimate':4.55,'wallMaterial':'redwood'},
        'service-west-south-2026':{'eaveEstimate':4.1,'ridgeEstimate':6.5,'wallMaterial':'redwood'},
        'service-north-small-2026':{'eaveEstimate':2.2,'ridgeEstimate':3.1,'wallMaterial':'redwood'},
    }
    for key,profile in new_roofs.items():
        observation=observations[key];xy=observation['footprintBlenderXY'];ring=[[x,-y] for x,y in xy]
        cx=sum(p[0] for p in xy[:-1])/(len(xy)-1);cy=sum(p[1] for p in xy[:-1])/(len(xy)-1);base=ground(cx,cy)
        record={'id':key,'ring':ring,'foundationMinRH2000':min(ground(x,y) for x,y in xy)-.12,**profile}
        ctx.group(key,'Visby '+key,{'sourceFeatureId':key,'facilityId':key,'geometryEvidence':'2026 orthophoto roof envelope',
                                  'architecturalHeights':'explicit model estimates; compare source envelopes in inventory'})
        reports.append(model_facilities.building(ctx,record,base))
        facilities.append({'id':key,'nodeName':ctx.groups[key].name,'sourceFeatureId':key,'footprintLocal':ring,
                           'groundAnchorLocal':[cx,-cy],'groundAnchorRh2000M':base,'placement':'absolute-rh2000'})
    # The range: individually detected mats on their turf strips, the east net
    # on its traced poles, the covered bays as one monopitch roof, and the
    # studio under its OSM footprint (handled in the building loop above).
    model_range.build(ctx,range_layout,ground,facilities,reports,ctx.group)
    key='skansudde-lighthouse';x,z=-603.3,190.4;base=ground(x,-z)
    ctx.group(key,'Visby Skansudde lighthouse',{'sourceLandmarkId':key,'facilityId':key,'publishedTotalHeightMetres':10.4})
    facilities.append({'id':key,'nodeName':ctx.groups[key].name,'sourceLandmarkId':key,'groundAnchorLocal':[x,z],
                       'groundAnchorRh2000M':base,'placement':'absolute-rh2000'})
    reports.append(model_facilities.lighthouse(ctx,base))

    # The small red shoreline shed is missing from OSM but visible in both 2023
    # ground photos and April 2026 ortho. Roof center measured in native pixels.
    key='shoreline-shed';cx,cy=model_clubhouse.xy((655,1148));base=ground(cx,cy)
    footprint=[[cx-1.6,-cy-2],[cx+1.6,-cy-2],[cx+1.6,-cy+2],[cx-1.6,-cy+2]]
    ctx.group(key,'Visby shoreline shed',{'sourceFeatureId':key,'facilityId':key,'referenceBased':True})
    f=Frame(ctx,key,cx,cy,-.18,base);f.box('Shore stone plinth',0,0,-.1,(3.4,3.0,.65),'stone');f.gable('Shore shed',0,0,3.3,2.9,2.1,3.10,'redwood')
    model_facilities.battens(f,3.3,2.9,2.1);f.window(.8,-1.48,1.0,.5,.5,-1)
    facilities.append({'id':key,'nodeName':ctx.groups[key].name,'sourceFeatureId':key,'footprintLocal':footprint,
                       'groundAnchorLocal':[cx,-cy],'groundAnchorRh2000M':base,'placement':'absolute-rh2000'})
    objects=ctx.finish()

    # Orthophoto on actual 1m source terrain is a modeling reference only. It is
    # packed in the blend and excluded from public geometry and glTF exports.
    ref=bpy.data.collections.new('Visby / Source references (excluded from export)');scene.collection.children.link(ref)
    image_path=HERE/'reference/ortho/clubhouse-finish.png'
    im=bpy.data.images.load(str(image_path),check_existing=False);im.pack()
    gt=model_clubhouse.SOURCE_TRANSFORM;w,h=im.size
    x0=gt[0]-687748.5;y1=gt[3]-6370951.5;spanx=w*.16;spany=h*.16
    nx,ny=int(spanx/2)+1,int(spany/2)+1;v=[];faces=[]
    for row in range(ny):
        for col in range(nx):
            x=x0+spanx*col/(nx-1);y=y1-spany*row/(ny-1);v.append((x,y,ground(x,y)-.045))
    for row in range(ny-1):
        for col in range(nx-1):
            i=row*nx+col;faces.append((i,i+nx,i+nx+1,i+1))
    mesh=bpy.data.meshes.new('Visby / Orthophoto terrain reference');mesh.from_pydata(v,[],faces);mesh.update()
    uv=mesh.uv_layers.new()
    for poly in mesh.polygons:
        for loop in poly.loop_indices:
            point=mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv=((point.x-x0)/spanx,1-(y1-point.y)/spany)
    mat=bpy.data.materials.new('Visby / 2026 aerial reference');mat.use_nodes=True
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im
    bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=1
    mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color']);mesh.materials.append(mat)
    terrain=bpy.data.objects.new(mesh.name,mesh);ref.objects.link(terrain);terrain['referenceOnly']=True
    terrain['attribution']='Ortofoto Nedladdning ©Lantmäteriet, CC BY 4.0; flight 2026-04-10'
    terrain['geoTransform']=gt
    panels=json.loads((HERE/'reference/orthophoto-manifest.json').read_text(encoding='utf-8'))['panels']
    for panel in panels:
        if panel['id'] in ('range-firing-line','range-net-north','service-yard'):add_reference_panel(ref,panel)
    # Complete surrounding footprint inventory remains visible for further
    # authoring as source outlines; only club facilities become runtime models.
    for item in inventory['facilities']:
        if not item.get('footprintBlenderXY'):continue
        curve=bpy.data.curves.new('Visby / Source footprint '+item['id'],'CURVE');curve.dimensions='3D'
        spline=curve.splines.new('POLY');points=item['footprintBlenderXY'];spline.points.add(len(points)-1)
        for p,(x,y) in zip(spline.points,points):p.co=(x,y,ground(x,y)+.20,1)
        curve.bevel_depth=.035
        obj=bpy.data.objects.new(curve.name,curve);ref.objects.link(obj);obj['referenceOnly']=True;obj.hide_render=True
        obj['sourceInventoryId']=item['id'];obj['scope']=item.get('scope','context')
    photo_names=['semester--DSC4580.jpg','semester--DSC4575.jpg','club-contact--497_VisbyGK_JacobSjoman_16BITS_V1-copy.jpg',
                 'commons-clubhouse-2009.jpg','fyrhuset--725_Visby_GK_Jacob_Sjomanbild-2026-2-scaled.jpg']
    packed=[]
    for i,filename in enumerate(photo_names):
        path=HERE/'reference/photos'/filename
        if not path.exists():continue
        photo=bpy.data.images.load(str(path),check_existing=False);photo.pack();packed.append(filename)
        empty=bpy.data.objects.new('Visby / Photo '+filename,None);empty.empty_display_type='IMAGE';empty.data=photo
        empty.empty_display_size=25;empty.location=(-665+i*29,-80,20);empty.rotation_euler=(math.pi/2,0,0)
        empty['referenceOnly']=True;ref.objects.link(empty)
    rig=bpy.data.collections.new('Visby / Cameras and lighting');scene.collection.children.link(rig)
    def camera(name,pos,target,scale):
        data=bpy.data.cameras.new('Visby / '+name);data.type='ORTHO';data.ortho_scale=scale;data.clip_end=5000
        obj=bpy.data.objects.new(data.name,data);obj.location=pos;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
        rig.objects.link(obj);return obj
    cameras={
        'clubhouse-seaward':camera('Clubhouse seaward',(-570,-235,29),(-520,-211,5),56),
        'clubhouse-entry':camera('Clubhouse entry',(-458,-170,33),(-520,-208,4),65),
        'lighthouse':camera('Lighthouse',(-635,-163,21),(-599,-199,5),48),
        'campus':camera('Campus',(-700,-330,165),(-490,-160,1),340),
        'roof-plan':camera('Roof plan',(-520,-205,100),(-520,-205,0),62),
        'range':camera('Range',(-350,-210,85),(-292,-82,3),185),
        'service-yard':camera('Service yard',(115,-40,100),(216,80,5),215),
    }
    scene.camera=cameras['clubhouse-seaward']
    light=bpy.data.lights.new('Visby / Sun','SUN');light.energy=2.5;light.angle=.12
    sun=bpy.data.objects.new(light.name,light);sun.rotation_euler=(.50,-.45,-.55);rig.objects.link(sun)
    scene.world=bpy.data.worlds.new('Visby / Daylight');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.48,.62,.76,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
    scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=1440;scene.render.resolution_y=1000
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
    notes=bpy.data.texts.new('Visby / Evidence and estimates');notes.write(json.dumps(reports,indent=2));notes.use_fake_user=True
    scene['notesText']=notes.name
    assert bpy.context.scene.name==active and bpy.data.filepath==oldfile
    assert all(tuple(sorted(o.name for o in bpy.data.scenes[n].objects))==v for n,v in previous.items())
    blend=OUT/'visby-facilities.blend'
    bpy.data.libraries.write(str(blend),{scene,notes},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
    report={'passed':True,'sceneName':SCENE,'blendPath':blend.relative_to(ROOT).as_posix(),
            'blendSha256':hashlib.sha256(blend.read_bytes()).hexdigest(),'preservedActiveScene':active,'preservedExistingScenes':True,
            'facilityCount':len(facilities),'meshObjects':len(objects),'vertices':sum(len(o.data.vertices) for o in objects),
            'facilities':facilities,'cameras':{k:v.name for k,v in cameras.items()},'packedPhotoReferences':packed,
            'modeling':reports,'groundSourceSha256':hashlib.sha256(ground_file.read_bytes()).hexdigest()}
    (HERE/'blender-build-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('facilities','modeling')}))


if __name__=='__main__':build()
