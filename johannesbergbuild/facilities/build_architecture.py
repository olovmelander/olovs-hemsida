"""Create a new Johannesberg architecture scene, preserving the live project."""
import hashlib
import json
import math
from pathlib import Path
import runpy
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
HERE=ROOT/'johannesbergbuild/facilities'
OUT=ROOT/'johannesbergbuild/cache/facilities-model'
G=runpy.run_path(str(HERE/'model_geometry.py'))
Architecture,frame,material=G['Architecture'],G['frame'],G['material']
clip_recent_faces=runpy.run_path(str(HERE/'roof_clip.py'))['clip_recent_faces']
ORIGIN=G['ORIGIN']


def crossrail(A,P,name,u0,u1,v,z,height=1):
    bays=max(1,round((u1-u0)/1.4))
    A.box(name+' handrail',P,(u0+u1)/2,v,z+height,u1-u0,.10,.10,'wood')
    for i in range(bays+1):
        u=u0+(u1-u0)*i/bays
        A.box(name+' post',P,u,v,z+height/2,.10,.10,height,'wood')
        if i<bays:
            nxt=u0+(u1-u0)*(i+1)/bays
            A.beam(name+' brace',P(u,v,z+.12),P(nxt,v,z+height-.1),.055,'wood')
            A.beam(name+' brace',P(nxt,v,z+.12),P(u,v,z+height-.1),.055,'wood')


def pavilion(A,c):
    P=frame(c['centerEPSG3006'],c['axisDegGridNorth'])
    L,W,z,e,r=c['lengthM'],c['widthM'],c['baseRH2000M'],c['eaveRH2000M'],c['ridgeRH2000M']
    A.box('Pavilion deck',P,0,0,z-.1,L,W,.22,'wood')
    for side in (-1,1):
        for i in range(4):
            u=-L/2+i*L/3
            A.box('Pavilion post',P,u,side*W/2,(z+e)/2,.16,.16,e-z,'white')
        crossrail(A,P,'Pavilion low rail',-L/2,L/2,side*W/2,z,.85)
    A.roof('Pavilion roof',P,L,W,e,r,'hip','tile-red','white',.18,False)


def clubhouse(A,p):
    cby={c['id']:c for c in p['components']}
    origin=p['frame']['originEPSG3006'];angle=cby['clubhouse-main-walls']['axisDegGridNorth'];P=frame(origin,angle)
    for c in p['components']:
        C=frame(c['centerEPSG3006'],c['axisDegGridNorth'])
        L,W=c['lengthM'],c['widthM'];base=c['baseRH2000M'];e=c['eaveRH2000M'];r=c['ridgeRH2000M'];name=c['id']
        if c['kind']=='wall-mass':
            A.box(name,C,0,0,(base+e)/2,L,W,e-base,'falu-red')
            A.box(name+' foundation',C,0,0,base-.25,L+.08,W+.08,.6,'foundation')
            for u in (-L/2,L/2):
                for v in (-W/2,W/2):
                    A.box(name+' corner trim',C,u,v,(base+e)/2,.12,.12,e-base,'white')
            for side in (-1,1):
                A.box(name+' floor band',C,0,side*(W/2+.02),18.55,L,.07,.10,'white')
                for i in range(1,int(L/.30)):
                    A.box(name+' timber boards',C,-L/2+i*.30,side*(W/2+.012),(base+e)/2,.018,.018,e-base,'falu-red')
        elif c['kind']=='roof-only':
            A.roof(name,C,L,W,e,r,'gable','tile-red','falu-red',0,True)
        elif c['kind']=='crossgable':
            A.box(name+' frontispiece',C,0,0,(base+e)/2,L,W,e-base,'falu-red')
            A.roof(name,C,L,W,e,r,'gable','tile-red','falu-red',0,False)
        elif c['kind'] in ('balcony','deck'):
            A.box(name+' deck',C,0,0,base,L,W,.18,'wood')
            crossrail(A,C,name,-L/2,L/2,-W/2,base,c.get('railHeightM',1))
            for sign in (-1,1):
                Q=frame(c['centerEPSG3006'],angle+90)
                crossrail(A,Q,name+' return',-W/2,W/2,sign*L/2,base,c.get('railHeightM',1))
            for post in c.get('supportPosts',[]):
                u,v=post['uv'];bottom,top=post['baseRH2000M'],post['topRH2000M']
                A.box(name+' support',P,u,v,(bottom+top)/2,.18,.18,top-bottom,'wood')
        elif c['kind']=='veranda':
            deck=c['deckRH2000M']
            A.box(name+' deck',C,0,0,deck-.1,L,W,.2,'wood')
            # Gable-side lean-to falls from the clubhouse wall towards +U.
            Q=frame(c['centerEPSG3006'],angle-90)
            A.roof(name+' lean-to',Q,W,L,e,r,'shed','tile-red','falu-red',.15,False)
            for v in (-W/2,-W/4,0):
                A.box(name+' porch post',C,L/2,v,(deck+e)/2,.13,.13,e-deck,'white')
            A.box(name+' rear enclosure',C,0,W/4,(base+e)/2,L,W/2,e-base,'falu-red')
            for v in (.8,2.6,4.6):
                # Outer gable facade, window axes along old V.
                A.window(name+' glazed porch',Q,v,-L/2-.05,18.9,1.2,1.35,-1)
    for f in p['facadeFeatures']:
        rear=f['side']=='rear';sign=1 if rear else -1
        v=7.95 if rear else -4.35
        if f['bottomRH2000M']>21:
            v=8.5 if rear else -5.1
        if f['kind']=='window':
            A.window(f['id'],P,f['centerU'],v+sign*.06,f['bottomRH2000M'],f['widthM'],f['heightM'],sign)
        else:
            A.door(f['id'],P,f['centerU'],v+sign*.06,f['bottomRH2000M'],f['widthM'],f['heightM'],sign)
            if f.get('smallGableCanopy'):
                d=f['smallGableCanopy'];u=f['centerU'];v=8.8
                world=P(u,v,0);center=[world[0]+ORIGIN[0],world[1]+ORIGIN[1]]
                R=frame(center,angle+90)
                A.roof('Rear entry canopy',R,d['depthM'],d['widthM'],d['eaveRH2000M'],d['ridgeRH2000M'],'gable','tile-red','white',.1,False)
    for d in p['dormers']:
        u,v=d['centerUV'];rear=d['side']=='rear';depth=d['depthV'];sign=1 if rear else -1
        centerV=v-sign*depth/2
        world=P(u,centerV,0);center=[world[0]+ORIGIN[0],world[1]+ORIGIN[1]]
        C=frame(center,angle+(180 if rear else 0))
        base,e,r=d['faceBottomRH2000M'],d['faceEaveRH2000M'],d['ridgeRH2000M']
        A.box(d['id']+' body',C,0,0,(base+e)/2,d['widthU'],depth,e-base,'falu-red')
        R=frame(center,angle+90)
        A.roof(d['id']+' roof',R,depth,d['widthU'],e,r,'gable','tile-red','falu-red',.1,False)
        w=d['window'];A.window(d['id'],C,0,-depth/2-.03,w['bottomRH2000M'],w['widthM'],w['heightM'],-1)
    for end in p['gableEnds']:
        # Q u=-V,v=U; side sign picks the actual outward gable plane.
        Q=frame(origin,angle+90);sign=1 if end['U']>0 else -1
        for w in end.get('atticWindows',end.get('upperWindows',[])):
            A.window('Gable windows',Q,-w['V'],end['U']+sign*.04,w['bottomRH2000M'],w['widthM'],w['heightM'],sign)
    for u in (-13,-7):
        A.window('Annex terrace window estimate',P,u,.35,19.0,1.15,1.35,-1)
    terrace=cby['clubhouse-annex-front-deck']
    A.door('Annex terrace entrance estimate',P,-10,.33,terrace['entranceThresholdRH2000M'],1.4,terrace['entranceHeightM'],-1)
    # The elevated 2024 rear photo shows openings in the lower annex as well.
    for u in (-14.8,-13.1,-11.4,-9.7,-8,-6.3):
        A.window('Annex rear upper window estimate',P,u,7.91,19.0,1.0,1.45,1)
    for i in range(7):
        u=-15.1+(i+.5)*10.1/7
        A.window('Annex rear lower glazed frontage estimate',P,u,7.92,15.95,10.1/7-.12,1.7,1,False)
    for vent in p['roofDetails']['vents']:
        u,v=vent['centerUV'];h=26.8-abs(v-1.7)*5.2/6.6
        A.box('Roof vent',P,u,v,h+vent['heightAboveRoofM']/2,vent['widthM'],vent['depthM'],vent['heightAboveRoofM'],'dark-metal')
        A.box('Roof vent cap',P,u,v,h+vent['heightAboveRoofM'],vent['widthM']+.15,vent['depthM']+.15,.12,'grey-metal')


COLORS={'barn-red':'falu-red','manor-blush':'peach','warm-plaster':'cream','charcoal-metal':'roof-dark',
        'tile-red':'tile-red','pale-metal':'grey-metal','zinc-grey':'grey-metal','dark-timber':'wood','weathered-timber':'wood','utility-brown':'wood'}


def estate(A,p):
    wall=COLORS.get(p['materials']['wall'],'cream');roof=COLORS.get(p['materials']['roof'],'roof-dark')
    floor=p['heights']['floorReferenceRh2000M'];ground=p['groundContext'];bottom=min(floor-.3,ground['groundPerimeterRH2000'][0]-.8)
    low_wall=min(floor,ground['groundPerimeterRH2000'][1]+.3)
    if p['facilityId']=='johannesberg-range-shelter':
        c=p['roof']['components'][0];P=frame(c['centerEPSG3006'],c['axisDegGridNorth']);L,W=c['lengthM'],c['widthM'];e=c['eaveRh2000M']
        for u in (-L/2,L/2):
            for v in (-W/2,W/2):A.box('Shelter posts',P,u,v,(floor+e)/2,.12,.12,e-floor,'falu-red')
        A.roof('Shelter roof',P,L,W,e,c['ridgeRh2000M'],'shed',roof,wall,.05,False)
        return
    for c in p['roof']['components']:
        P=frame(c['centerEPSG3006'],c['axisDegGridNorth']);L,W=c['lengthM'],c['widthM'];e,r=c['eaveRh2000M'],c['ridgeRh2000M']
        def on_wall(u,v,halfwidth=0):
            ring=p['footprint']['ringEPSG3006']
            def distance(pt):
                best=math.inf
                for a,b in zip(ring,ring[1:]+ring[:1]):
                    dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
                    t=max(0,min(1,((pt[0]-a[0])*dx+(pt[1]-a[1])*dy)/den)) if den else 0
                    best=min(best,math.hypot(pt[0]-a[0]-t*dx,pt[1]-a[1]-t*dy))
                return best
            return all(distance((q[0]+ORIGIN[0],q[1]+ORIGIN[1]))<.30 for q in [P(u-halfwidth,v,0),P(u,v,0),P(u+halfwidth,v,0)])
        glazed=c['type']=='glazed-hipped'
        for ring in c['wallRingsEPSG3006']:
            A.prism(c['id']+' foundation',ring,bottom,low_wall+.1,'foundation')
            A.prism(c['id']+' walls',ring,low_wall,e,'glass' if glazed else wall)
        kind={'hipped':'hip','glazed-hipped':'hip','lean-to':'shed','pyramidal':'hip'}.get(c['type'],c['type'])
        roof_start=len(A.faces)
        A.roof(c['id']+' roof',P,L,W,e,r,kind,'glass-light' if glazed else roof,wall,.25,c['type']=='gable',c.get('breakpointRatio'),c.get('breakHeightRh2000M'))
        if p.get('roofMaskEPSG3006'):clip_recent_faces(A,roof_start,p['roofMaskEPSG3006'])
        rows=max(1,min(3,int((e-floor)/2.8)))
        if glazed:
            for side in (-1,1):
                for i in range(int(L/1.4)+1):
                    u=-L/2+i*L/int(L/1.4)
                    if on_wall(u,side*(W/2+.04)):
                        A.box('Conservatory mullion',P,u,side*(W/2+.04),(floor+e)/2,.09,.10,e-floor,'white')
        elif p['materials'].get('windows'):
            count=max(1,min(18,int(L/(1.4 if glazed else 3.3))))
            for side in (-1,1):
                for row in range(rows):
                    b=floor+.8+row*2.9
                    if b+1.5>e-.1:continue
                    for i in range(count):
                        u=-L/2+(i+.5)*L/count
                        if on_wall(u,side*(W/2+.04),.62):A.window(c['id']+' windows',P,u,side*(W/2+.04),b,1.05,1.5,side)
            if on_wall(0,-W/2-.08,.73):A.door(c['id']+' entrance',P,0,-W/2-.08,floor+.03,1.25,2.25,-1)
        for u in (-L/2,L/2):
            for v in (-W/2,W/2):
                if on_wall(u,v):A.box(c['id']+' corner',P,u,v,(low_wall+e)/2,.14,.14,e-low_wall,'white')
    main=p['roof']['components'][0];P=frame(main['centerEPSG3006'],main['axisDegGridNorth']);L,W=main['lengthM'],main['widthM'];e,r=main['eaveRh2000M'],main['ridgeRh2000M']
    df=p.get('detailFrame',{});center=df.get('originEPSG3006',main['centerEPSG3006']);D=frame(center,df.get('axisDegGridNorth',main['axisDegGridNorth']))
    for f in p['distinctiveFeatures']:
        kind=f['kind']
        if kind=='dormerRows':
            count=f['countPerLongSideEstimate']
            for side in (-1,1):
                for i in range(count):
                    u=-L*.39+(i+.5)*L*.78/count;v=side*W*.37
                    q=P(u,v,0);center=[q[0]+ORIGIN[0],q[1]+ORIGIN[1]]
                    A.dormer('Mansard dormer',center,main['axisDegGridNorth']+(180 if side>0 else 0),e+.55,1.15,1.6,1.5,wall,roof)
        elif kind=='tower':
            C=frame(f['centerEPSG3006'],f['axisDegGridNorth']);base=f['baseRh2000M'];top=f['eaveRh2000M']
            A.box('Roof tower',C,0,0,(base+top)/2,f['lengthM'],f['widthM'],top-base,wall)
            A.roof('Tower cap',C,f['lengthM'],f['widthM'],top,f['ridgeRh2000M'],'hip',roof,wall,.2,False)
            for sign in (-1,1):A.window('Tower window',C,0,sign*(f['widthM']/2+.04),top-2,1,1.5,sign)
        elif kind in ('portico','frontVeranda'):
            u,v=f.get('centerUVMetres',[0,W/2+1]);v=-v
            width=f['widthMetresEstimate'];depth=f['depthMetresEstimate'];z=f['floorRh2000M'];top=f['topRh2000M']
            A.box(kind+' deck',D,u,v,z-.1,width,depth,.25,'concrete')
            A.box(kind+' balcony roof',D,u,v,top,width+.2,depth+.2,.25,'white' if kind=='portico' else roof)
            count=f.get('columnCount',f.get('postsEstimate',4))
            for i in range(count):
                x=u-width/2+i*width/(count-1);size=f.get('columnWidthMetresEstimate',.18)
                A.box(kind+' pier',D,x,v-depth/2,(z+top)/2,size,size,top-z,'white')
            if kind=='portico':
                A.railing('Portico balcony',D,u-width/2,u+width/2,v-depth/2,top+.1,.9,'dark-metal')
                span=width/(count-1)
                for i in range(count-1):
                    A.arch('Portico arch',D,u-width/2+(i+.5)*span,v-depth/2,top-.9,(span-.42)/2,.75,.16,'white')
            for i in range(5):A.box('Entrance steps',D,u,v-depth/2-.18*(5-i),z-.16*(5-i),width*.55,.4,.2,'concrete')
        elif kind in ('centralEntrance','centralFacadeGable','frontGables'):
            width=f.get('widthMetresEstimate',3.8)
            positions=[-L*.32,0,L*.32] if kind=='frontGables' else [0]
            for u in positions:
                q=P(u,-W/2+.35,0);center=[q[0]+ORIGIN[0],q[1]+ORIGIN[1]]
                if kind in ('frontGables','centralFacadeGable'):
                    A.curved_gable('Curved facade gable',P,u,-W/2-.07,e-.35,width,2.2)
                else:
                    A.dormer('Pale facade gable',center,main['axisDegGridNorth'],e-.35,width,2.0,2.0,'white',roof)
        elif kind=='cupola':
            u,v=f['centerUVMetres'];v=-v;z=f['baseRh2000M'];top=f['topRh2000M'];w=f['widthMetresEstimate']
            A.box('Cupola plinth',D,u,v,z,w,w,.25,'dark-metal')
            for x in (-w*.35,w*.35):
                for y in (-w*.35,w*.35):A.box('Cupola open posts',D,u+x,v+y,(z+top)/2,.12,.12,top-z-.4,'dark-metal')
            q=D(u,v,0);C=frame([q[0]+ORIGIN[0],q[1]+ORIGIN[1]],main['axisDegGridNorth'])
            A.roof('Cupola crown',C,w,w,top-.4,top,'hip','roof-dark','dark-metal',.1,False)
            A.beam('Cupola finial',D(u,v,top),D(u,v,top+.65),.08,'dark-metal')
        elif kind=='solarPanels':
            # One restrained continuous upper field, without invented module count.
            span=L*f.get('coverageFractionEstimate',.5)
            br=main.get('breakpointRatio',.65);bh=main.get('breakHeightRh2000M',e+(r-e)*.68)
            panel=[]
            for u,v in [(-span/2,-W*.21),(span/2,-W*.21),(span/2,-W*.03),(-span/2,-W*.03)]:
                panel.append(P(u,v,r-(r-bh)*abs(v)/(W*br/2)+.045))
            A.mesh('Observed dark upper roof field',panel,[(0,1,2,3)],'black')
        elif kind=='chimneys':
            for i in range(f.get('countEstimate',1)):
                A.box('Chimney estimate',P,(-.25+i*.5)*L,0,r+.4,.7,.8,1.1,'dark-metal')
        elif kind=='balconies':
            for row in range(f.get('levelsEstimate',1)):
                z=floor+2.9*(row+1);width=f['widthMetresEstimate'];v=-W/2-f['depthMetresEstimate']/2
                A.box('Villa balcony deck',P,0,v,z,width,f['depthMetresEstimate'],.14,'white')
                A.railing('Villa balcony',P,-width/2,width/2,v-f['depthMetresEstimate']/2,z+.08,.9,'dark-metal')
        elif kind=='facadeBands':
            for row in range(1,f.get('levelsEstimate',2)):
                for side in (-1,1):A.box('Facade storey band',P,0,side*(W/2+.05),floor+row*2.9,L,.12,.18,'wood')
        elif kind=='exteriorStair':
            for i in range(18):A.box('Exterior stair estimate',P,-L*.25+i*.25,-W/2-.75,floor+.17*i,.32,1.3,.15,'dark-metal')


def build(version='v1'):
    implementation_sha=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    spec_path=HERE/'architecture-spec.json';spec=json.loads(spec_path.read_text(encoding='utf-8'))
    for source in spec['sources']:
        assert hashlib.sha256((ROOT/source['path']).read_bytes()).hexdigest()==source['sha256'],source['path']
    name='Johannesberg | Facilities architecture 2026-09-10 '+version
    output=OUT/('johannesberg-facilities-'+version+'-library.blend')
    assert not bpy.data.scenes.get(name) and not output.exists(),'Use a new architecture version to preserve previous work'
    def snapshot():return {s.name:[(o.name,tuple(v for row in o.matrix_world for v in row)) for o in s.objects] for s in bpy.data.scenes}
    before=snapshot();active=bpy.context.scene.name;file=bpy.data.filepath;selection=[o.name for o in bpy.context.selected_objects]
    scene=bpy.data.scenes.new(name);scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene['horizontal_crs']='EPSG:3006';scene['height_origin_rh2000_m']=16;scene['origin_easting_northing']=[679200,6626160]
    scene['model_status']=spec['status'];scene['source_spec_sha256']=hashlib.sha256(spec_path.read_bytes()).hexdigest()
    collection=bpy.data.collections.new(name+' | Buildings');scene.collection.children.link(collection)
    context=bpy.data.collections.new(name+' | Modelling context - not exported');scene.collection.children.link(context)
    estate_profiles={p['facilityId']:p for p in spec['estate']['profiles']}
    pavilion_profile=next(c for c in spec['clubhouse']['components'] if c['kind']=='open-pavilion')
    result=[]
    for f in spec['inventory']['facilities']:
        A=Architecture(f['id'])
        if f['id']=='johannesberg-clubhouse':clubhouse(A,spec['clubhouse'])
        elif f['sourceBuildingId']=='w296165897':pavilion(A,pavilion_profile)
        else:estate(A,estate_profiles[f['id']])
        root=bpy.data.objects.new(f['id'],None);collection.objects.link(root)
        root['sourceBuildingId']=f['sourceBuildingId'];root['facilityId']=f['id'];root['authored_facility']=True
        obj,stats=A.finish(collection,root,{'sourceBuildingId':f['sourceBuildingId']})
        result.append({'id':f['id'],'sourceBuildingId':f['sourceBuildingId'],'nodeName':root.name,**stats})
    # Dated orthophoto draped over a class-2 ground reference for Blender review.
    grid=json.loads((ROOT/spec['ground']['gridPath']).read_text(encoding='utf-8'))
    vertices=[(grid['x0']+c*grid['step'],grid['y0']+r*grid['step'],grid['heights'][r*grid['width']+c])
              for r in range(grid['height']) for c in range(grid['width'])]
    faces=[]
    for row in range(grid['height']-1):
        for col in range(grid['width']-1):
            i=row*grid['width']+col;w=grid['width'];faces.extend([(i,i+1,i+w+1),(i,i+w+1,i+w)])
    mesh=bpy.data.meshes.new(name+' terrain');mesh.from_pydata(vertices,[],faces);mesh.update()
    terrain=bpy.data.objects.new(name+' ground reference',mesh);context.objects.link(terrain);terrain['context_only']=True
    m=bpy.data.materials.new(name+' orthophoto context');m.use_nodes=True
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'johannesbergbuild/cache/facilities-reference/orthophoto/facilities-hub-native.png'),check_existing=False);tex.image.pack()
    m.node_tree.links.new(tex.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    mesh.materials.append(m);uv=mesh.uv_layers.new(name='Georeferenced native orthophoto')
    for loop in mesh.loops:
        x,y,z=vertices[loop.vertex_index];uv.data[loop.index].uv=((x+679200-679130.08)/620,(y+6626160-6625980)/420)
    world=bpy.data.worlds.new(name+' world');world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.55,.65,.8,1);world.node_tree.nodes.get('Background').inputs[1].default_value=.7;scene.world=world
    sun_data=bpy.data.lights.new(name+' sun','SUN');sun_data.energy=3;sun_data.angle=.12
    sun=bpy.data.objects.new(name+' sun',sun_data);context.objects.link(sun);sun.rotation_euler=(math.radians(25),math.radians(-35),math.radians(-35))
    cameras={}
    for key,position,target,scale in [('clubhouse-front',(63,-78,44),(7,8,6),70),('clubhouse-rear',(-52,77,33),(6,9,6),67),('estate-overview',(430,-390,355),(220,80,9),650),('manor-front',(190,130,72),(114,181,17),80)]:
        data=bpy.data.cameras.new(name+' '+key);data.type='ORTHO';data.ortho_scale=scale;data.clip_end=3000
        camera=bpy.data.objects.new(name+' '+key,data);context.objects.link(camera);camera.location=position;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();cameras[key]=camera.name
    scene.camera=scene.objects[cameras['clubhouse-front']]
    scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=1800;scene.render.resolution_y=1200;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
    notes=bpy.data.texts.new(name+' modelling notes');notes.write(spec['status']+'\nAll models use procedural materials. The orthophoto ground is context only and excluded from runtime export.\n'+json.dumps(spec['sources'],indent=2));notes.use_fake_user=True
    after=snapshot();assert all(after[k]==v for k,v in before.items());assert bpy.context.scene.name==active and bpy.data.filepath==file and [o.name for o in bpy.context.selected_objects]==selection
    OUT.mkdir(parents=True,exist_ok=True)
    bpy.data.libraries.write(str(output),{scene,notes},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
    report={'passed':True,'scene':name,'blendPath':output.relative_to(ROOT).as_posix(),'blendSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
            'implementationSha256':implementation_sha,
            'specSha256':hashlib.sha256(spec_path.read_bytes()).hexdigest(),'facilities':result,'cameras':cameras,
            'totalTriangles':sum(f['triangles'] for f in result),'existingScenesAndSelectionPreserved':True,'previousActiveScene':active,
            'coordinateContract':'Blender X=E-679200,Y=N-6626160,Z=RH2000-16; export bakes exact app frame offline',
            'sourceDates':{'orthophoto':'2025-06-14','laser':'2021-04-17'},'surveyedArchitecture':False}
    (HERE/'model-build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='facilities'}))
    return scene
