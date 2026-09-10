"""Author Lidingö range facilities using the production Context API.

The input roof/ground frame is Blender metres, X east, Y north, Z RH2000-25.
No Blender connection or application mutation occurs in this module.
"""
import hashlib
import json
import math
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
LAYOUT=HERE/'authored-layout.json'
RED=0x893B2E
RED_LIGHT=0x984538
RED_DARK=0x693129
ROOF=0x303A40
STEEL=0x354345
GALV=0x9AA6A6
WHITE=0xD8D9CF
GLASS=0x253C42
TURF=0x63833D
RUBBER=0x202C28


def xy(point):
    return [point[0]-677700.5,point[1]-6586399.5]


def mean(points):
    return [sum(p[i] for p in points)/len(points) for i in range(len(points[0]))]


def lerp(a,b,t):
    return [a[i]+(b[i]-a[i])*t for i in range(len(a))]


def dist(a,b):
    return math.sqrt(sum((x-y)**2 for x,y in zip(a,b)))


def ring_unique(ring):
    ring=[list(p[:2]) for p in ring]
    return ring[:-1] if dist(ring[0],ring[-1])<1e-7 else ring


def source_ring(ctx,identifier):
    for record in ctx.model['buildingFootprints']+ctx.model.get('supplementaryReferences',[]):
        if record['id']==identifier:
            return ring_unique(record['rings'][0])
    for record in ctx.model['facilities']:
        if record['id']==identifier:
            return ring_unique(record['polygons'][0]['rings'][0])
    raise ValueError('Missing exact retained source '+identifier)


def traced_ring(layout,record):
    image=layout['images'][record['image']]
    e,_,_,n=image['boundsEpsg3006']; resolution=image['resolutionMetres']
    return [xy([e+p[0]*resolution,n-p[1]*resolution]) for p in record['pixelVertices']]


def traced_points(layout,record):
    image=layout['images'][record['image']]
    e,_,_,n=image['boundsEpsg3006']; resolution=image['resolutionMetres']
    return [xy([e+p[0]*resolution,n-p[1]*resolution]) for p in record['pixelCentres']]


def bounds_ring(points,margin=0):
    lo=[min(p[i] for p in points)-margin for i in range(2)]
    hi=[max(p[i] for p in points)+margin for i in range(2)]
    return [[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]]


def upward_face(points):
    area=sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))
    return tuple(range(len(points))) if area>0 else tuple(reversed(range(len(points))))


def roof_sampler(ctx,identifier):
    meshes=[m for m in ctx.model['architectureMeshes'] if m['buildingId']==identifier and m['part']=='roof-plane']
    triangles=[]
    for m in meshes:
        for i in range(0,len(m['triangleIndices']),3):
            triangles.append([m['vertices'][j] for j in m['triangleIndices'][i:i+3]])
    def height(x,y):
        hits=[]
        for a,b,c in triangles:
            den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-10: continue
            u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
            v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
            if min(u,v,1-u-v)>=-1e-5:
                hits.append(u*a[2]+v*b[2]+(1-u-v)*c[2])
        return max(hits) if hits else None
    return height


class Batch:
    """Small boxes/strands share one mesh per material, avoiding object proliferation."""
    def __init__(self): self.vertices=[]; self.faces=[]
    def quad(self,points):
        start=len(self.vertices); self.vertices.extend(points)
        self.faces.append(tuple(range(start,start+4)))
    def segment(self,a,b,width,depth=None):
        length=dist(a,b)
        if length<1e-6: return
        depth=width if depth is None else depth
        direction=[(b[i]-a[i])/length for i in range(3)]
        helper=[0,0,1] if abs(direction[2])<.9 else [1,0,0]
        side=[direction[1]*helper[2]-direction[2]*helper[1],direction[2]*helper[0]-direction[0]*helper[2],direction[0]*helper[1]-direction[1]*helper[0]]
        size=math.sqrt(sum(v*v for v in side)); side=[v/size*width/2 for v in side]
        up=[direction[1]*side[2]-direction[2]*side[1],direction[2]*side[0]-direction[0]*side[2],direction[0]*side[1]-direction[1]*side[0]]
        size=math.sqrt(sum(v*v for v in up)); up=[v/size*depth/2 for v in up]
        start=len(self.vertices)
        for p in (a,b):
            self.vertices.extend([[p[i]+s*side[i]+t*up[i] for i in range(3)] for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]])
        self.faces.extend([tuple(start+j for j in face) for face in [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]])
    def emit(self,ctx,parent,name,color,roughness=.8,metallic=0):
        if self.faces:
            return ctx.mesh(parent,name,self.vertices,self.faces,color,roughness=roughness,metallic=metallic)


def frame(ring):
    # Retained barn rings start NW, NE, SE and finish SW (west has one extra south-edge vertex).
    a,b,c,d=ring[0],ring[1],ring[2],ring[-1]
    width,length=dist(a,b),dist(a,d)
    u=[(b[i]-a[i])/width for i in range(2)]
    v=[(d[i]-a[i])/length for i in range(2)]
    def point(s,t): return [a[i]+u[i]*s+v[i]*t for i in range(2)]
    return point,u,v,width,length,math.atan2(u[1],u[0])


def surface_box(ctx,parent,name,p,z,size,yaw,color):
    return ctx.box(parent,name,[p[0],p[1],z],size,color,yaw=yaw)


def barn(ctx,record):
    identifier=record['id']; ring=source_ring(ctx,identifier)
    evidence=dict(status='photo-informed-display-model',footprint='exact retained '+identifier,
        roof='existing roof-derived architectural envelope retained; source TIN remains separately preserved',
        references=['commons-Sticklinge-g-rds-lada-2020a-jpg','gallery-2026-gfx28464','range-buildings-detail-lm-2025'],
        sourceDateRange='2020 photos /2021 laser/2025 ortho/2026 gallery',
        estimated='Facade openings, siding relief, roof seams and fixture dimensions are appearance estimates.',
        use=record['role']+'; current internal functions not reassigned from historical labels')
    parent=ctx.facility('range-west-barn' if identifier.endswith('210') else 'range-east-barn',[identifier],ring,evidence)
    ctx.import_parts(parent,identifier,omit_parts=('facade-glazing',),recolor={'closed-wall':RED,'roof-plane':ROOF,'fascia':STEEL,'soffit':RED_DARK})
    roof=roof_sampler(ctx,identifier)
    boards=Batch(); seams=Batch(); foundation=Batch()
    clockwise=sum(ring[i][0]*ring[(i+1)%len(ring)][1]-ring[(i+1)%len(ring)][0]*ring[i][1] for i in range(len(ring)))<0
    for a,b in zip(ring,ring[1:]+ring[:1]):
        length=dist(a,b); tangent=[(b[i]-a[i])/length for i in range(2)]
        normal=[-tangent[1],tangent[0]] if clockwise else [tangent[1],-tangent[0]]
        for j in range(1,max(2,math.ceil(length/.32))):
            t=j/max(2,math.ceil(length/.32)); p=lerp(a,b,t)
            top=roof(*p)
            if top is None: continue
            bottom=ctx.ground(*p)+.08
            if top-bottom<.4: continue
            p1=[p[k]+normal[k]*.027-tangent[k]*.016 for k in range(2)]
            p2=[p[k]+normal[k]*.027+tangent[k]*.016 for k in range(2)]
            boards.quad([[*p1,bottom],[*p2,bottom],[*p2,top-.12],[*p1,top-.12]])
        for t in [.24,.48,.72,.96,1.20,1.44,1.68,1.92,2.16,2.4]:
            a2=[a[i]+normal[i]*.04 for i in range(2)]; b2=[b[i]+normal[i]*.04 for i in range(2)]
            # Photo-documented horizontal lower boarding; follow ground at edge ends for a restrained relief line.
            za,zb=ctx.ground(*a)+t,ctx.ground(*b)+t
            ra,rb=roof(*a),roof(*b)
            if ra is not None and rb is not None and za<ra-.4 and zb<rb-.4:
                seams.segment([*a2,za],[*b2,zb],.015)
        a2=[a[i]+normal[i]*.025 for i in range(2)]; b2=[b[i]+normal[i]*.025 for i in range(2)]
        foundation.quad([[*a2,ctx.ground(*a)-.02],[*b2,ctx.ground(*b)-.02],[*b2,ctx.ground(*b)+.24],[*a2,ctx.ground(*a)+.24]])
    boards.emit(ctx,parent,'subtle vertical timber board joints',RED_LIGHT)
    seams.emit(ctx,parent,'lower horizontal boarding joints',RED_DARK)
    foundation.emit(ctx,parent,'low dark foundation band',0x3E4240)
    point,u,v,width,length,yaw=frame(ring)
    ribbing=Batch()
    for j in range(1,math.ceil(length/.7)):
        t=j*length/math.ceil(length/.7)
        for k in range(18):
            s0=.025+(width-.05)*k/18; s1=.025+(width-.05)*(k+1)/18
            p0,p1=point(s0,t),point(s1,t)
            z0,z1=roof(*p0),roof(*p1)
            if z0 is None or z1 is None: continue
            ribbing.quad([[p0[0]-v[0]*.022,p0[1]-v[1]*.022,z0+.024],[p1[0]-v[0]*.022,p1[1]-v[1]*.022,z1+.024],
                         [p1[0]+v[0]*.022,p1[1]+v[1]*.022,z1+.024],[p0[0]+v[0]*.022,p0[1]+v[1]*.022,z0+.024]])
    ribbing.emit(ctx,parent,'corrugated metal roof standing seams',0x566166,.48,.45)

    def side_opening(side,t,w,h,kind='door',base=0):
        s=-.065 if side=='west' else width+.065
        p=point(s,t*length); inside=point(.02 if side=='west' else width-.02,t*length)
        ground=ctx.ground(*inside); limit=roof(*inside)
        if limit is None: return
        h=min(h,limit-ground-base-.3)
        if h<.4: return
        color=RED_DARK if kind=='door' else GLASS
        surface_box(ctx,parent,kind+' dark reveal',p,ground+base+h/2,[.075,w+.14,h+.12],yaw,STEEL)
        # Glass and red doors are offset outward from their reveal.
        offset=-.046 if side=='west' else .046
        p2=[p[i]+u[i]*offset for i in range(2)]
        surface_box(ctx,parent,kind+' inset face',p2,ground+base+h/2,[.035,w,h],yaw,color)
        if kind=='door':
            handle=[p2[i]+v[i]*w*.32 for i in range(2)]
            surface_box(ctx,parent,'door handle',handle,ground+base+min(h*.45,1.1),[.085,.05,.18],yaw,GALV)
        else:
            for z in [ground+base,ground+base+h]: surface_box(ctx,parent,'white window trim',p2,z,[.075,w+.12,.07],yaw,WHITE)
            for sign in [-1,1]:
                q=[p2[i]+v[i]*sign*w/2 for i in range(2)]
                surface_box(ctx,parent,'white window trim',q,ground+base+h/2,[.075,.07,h],yaw,WHITE)
    if identifier=='way/26408211':
        for t in [.16,.35,.56,.79]: side_opening('west',t,2.3,2.25)
        for t in [.27,.78]: side_opening('west',t,.8,1.35,'window',4.0)
        for t,w in [(.24,1.0),(.66,3.2)]: side_opening('east',t,w,2.1)
        # South gable welcome plaque visible in Commons photo. It is plain geometry, not copied photo lettering.
        p=point(width*.48,length+.075); ground=ctx.ground(*point(width*.48,length-.05))
        surface_box(ctx,parent,'south gable pale welcome plaque',p,ground+5.15,[2.15,.09,1.32],yaw,WHITE)
        p=point(width*.86,length+.07)
        surface_box(ctx,parent,'south gable service door',p,ctx.ground(*p)+1.1,[.93,.09,2.2],yaw,RED_DARK)
    else:
        for t in [.18,.48,.78]: side_opening('east',t,2.1,2.1)
        for t in [.27,.69]: side_opening('west',t,.72,1.0,'window',4.2)
    # Real rainwater details; positions are corner appearance estimates.
    for side in [0,width]:
        p=point(side,.35); z=roof(*p)
        if z is not None:
            ctx.beam(parent,'dark downpipe',[*p,ctx.ground(*p)+.08],[*p,z-.16],.09,.09,STEEL)
    return parent


def flat_roof_hut(ctx,identifier,ring,height,rise,evidence,source_ids=(),color=RED):
    parent=ctx.facility(identifier,list(source_ids),ring,evidence)
    center=mean(ring); base=ctx.ground(*center)
    vertices=[[p[0],p[1],ctx.ground(*p)-.02] for p in ring]+[[p[0],p[1],base+height+(rise if i<2 else 0)] for i,p in enumerate(ring)]
    faces=[(i,(i+1)%len(ring),(i+1)%len(ring)+len(ring),i+len(ring)) for i in range(len(ring))]
    ctx.mesh(parent,'timber service walls',vertices,faces,color)
    roof_points=vertices[len(ring):]
    center2=mean([p[:2] for p in roof_points])
    roof_points=[[p[0]+(p[0]-center2[0])*.035,p[1]+(p[1]-center2[1])*.035,p[2]+.08] for p in roof_points]
    ctx.mesh(parent,'shallow dark roof',roof_points,[upward_face(roof_points)],ROOF,.6,.25)
    a,b=ring[-1],ring[-2]; tangent=[(b[i]-a[i])/dist(a,b) for i in range(2)]; yaw=math.atan2(tangent[1],tangent[0])
    p=lerp(a,b,.52); normal=[-tangent[1],tangent[0]]; p=[p[i]-normal[i]*.05 for i in range(2)]
    ctx.box(parent,'dark doorway',[*p,base+1.04],[min(1.05,dist(a,b)*.4),.085,2.08],0x272D29,yaw=yaw)
    siding=Batch()
    for a,b in zip(ring,ring[1:]+ring[:1]):
        for j in range(1,math.ceil(dist(a,b)/.25)):
            p=lerp(a,b,j/math.ceil(dist(a,b)/.25)); q=lerp(p,center,-.01)
            siding.segment([*q,ctx.ground(*p)+.05],[*q,base+height-.08],.018)
    siding.emit(ctx,parent,'service hut timber joints',RED_LIGHT if color==RED else 0x64635C)
    return parent


def mat(ctx,parent,p,yaw,label):
    ground=ctx.ground(*p)
    ctx.box(parent,label+' rubber edge',[*p,ground+.06],[1.88,1.69,.10],RUBBER,yaw=yaw)
    ctx.box(parent,label+' artificial turf',[*p,ground+.125],[1.7,1.5,.035],TURF,yaw=yaw)
    # Low divider/sign lies behind the mat along its cross-range edge.
    u=[math.cos(yaw),math.sin(yaw)]; v=[-u[1],u[0]]
    rear=[p[i]-v[i]*1.10 for i in range(2)]
    ctx.box(parent,label+' divider frame',[*rear,ground+.42],[1.72,.08,.57],STEEL,yaw=yaw)
    ctx.box(parent,label+' restrained pale divider',[rear[0]+v[0]*.046,rear[1]+v[1]*.046,ground+.42],[1.58,.026,.43],0xCBD2C5,yaw=yaw)
    tray=[p[i]-v[i]*.78+u[i]*.60 for i in range(2)]
    ctx.box(parent,label+' ball tray',[*tray,ground+.18],[.44,.34,.10],0x4E3B32,yaw=yaw)


def shelter(ctx,layout,record):
    ring=traced_ring(layout,record); front=[ring[i] for i in record['frontEdge']]
    # Back edge pairing follows the same along-roof direction as the front.
    back=[ring[1],ring[0]] if record['frontEdge']==[3,2] else [ring[3],ring[2]]
    if record['frontEdge']==[3,2]: back=[ring[0],ring[1]]
    evidence=dict(status='authored-from-traced-2025-roof',layoutPath='lidingobuild/facilities/authored-layout.json',
                  roofPixelVertices=record['pixelVertices'],sourceImage=layout['images'][record['image']]['id'],
                  height='photo-informed estimate '+str(record['displayEaveHeightMetres'])+'m',note=record['evidence'])
    parent=ctx.facility(record['id'],[],ring,evidence)
    frontground=[ctx.ground(*p) for p in front]
    base=sum(frontground)/2
    zfront=base+record['displayEaveHeightMetres']; zback=zfront+record['displayBackRiseMetres']
    points=[[*front[0],zfront],[*front[1],zfront],[*back[1],zback],[*back[0],zback]]
    roof_color=0x8A9599 if record['image']=='north' else ROOF
    ctx.mesh(parent,'thin corrugated canopy roof',points,[upward_face(points)],roof_color,.55,.3)
    structure=Batch(); roof_ribs=Batch(); bays=record['postBays']
    for i in range(bays+1):
        t=i/bays; f,b=lerp(front[0],front[1],t),lerp(back[0],back[1],t)
        structure.segment([*f,ctx.ground(*f)],[*f,zfront],.11,.11)
        structure.segment([*b,ctx.ground(*b)],[*b,zback],.10,.10)
        structure.segment([*f,zfront],[*b,zback],.10,.13)
        brace=lerp(f,b,.32)
        structure.segment([*f,zfront-.7],[*brace,zfront+(zback-zfront)*.32],.065,.065)
        if i<bays:
            # Bays hidden under the roof cannot be counted directly in ortho; number is an explicit display estimate.
            c=lerp(front[0],front[1],(i+.5)/bays); rear=lerp(back[0],back[1],(i+.5)/bays)
            p=lerp(c,rear,.27)
            yaw=math.atan2(front[1][1]-front[0][1],front[1][0]-front[0][0])
            if record['image']=='north': yaw+=math.pi
            mat(ctx,parent,p,yaw,'covered bay '+str(i+1))
    structure.segment([*front[0],zfront],[*front[1],zfront],.13,.16)
    structure.segment([*back[0],zback],[*back[1],zback],.13,.16)
    for i in range(math.ceil(dist(*front)/.65)+1):
        t=i/math.ceil(dist(*front)/.65); f,b=lerp(front[0],front[1],t),lerp(back[0],back[1],t)
        roof_ribs.segment([*f,zfront+.017],[*b,zback+.017],.028,.022)
    structure.emit(ctx,parent,'canopy posts beams and knee braces',STEEL)
    roof_ribs.emit(ctx,parent,'canopy metal sheet ribs',0xB0B8B7 if record['image']=='north' else 0x4B565A,.55,.3)
    return parent


def net(ctx,record):
    points=[xy(p) for p in record['pointsEpsg3006']]
    parent=ctx.facility(record['id'],[],bounds_ring(points,.2),
        dict(status='range-safety-net-display-approximation',alignmentSources=record['sourceIds'],note=record['evidence'],
             heightMetres=record['displayHeightMetres'],heightStatus='estimated; pole spacing and fine net weave not surveyed'),exclude_vegetation=False)
    posts=[]
    for a,b in zip(points,points[1:]):
        steps=math.ceil(dist(a,b)/record['maximumPolePitchMetres'])
        posts.extend(lerp(a,b,i/steps) for i in range(steps))
    posts.append(points[-1])
    wires=Batch(); supports=Batch(); height=record['displayHeightMetres']
    for index,p in enumerate(posts):
        ground=ctx.ground(*p)
        ctx.cylinder(parent,'slender net pole '+str(index+1),[*p,ground+height/2],.08,height,GALV,vertices=8)
        if record['id']=='range-road-safety-net' and index%3==0:
            # Slender paired legs and diagonal ties suggest the documented tall silver truss masts.
            q=[p[0]+.36,p[1]]
            supports.segment([*q,ctx.ground(*q)],[*q,ground+height],.045)
            for j in range(7):
                lo=ground+j*height/7; hi=ground+(j+1)*height/7
                supports.segment([*p,lo],[*q,hi],.025)
    for a,b in zip(posts,posts[1:]):
        za,zb=ctx.ground(*a),ctx.ground(*b)
        # Sparse geometric weave preserves visibility and avoids opaque net planes.
        count=math.ceil(dist(a,b)/1.15)
        for i in range(count+1):
            t=i/count; p=lerp(a,b,t); z=za+(zb-za)*t
            sag=.35*4*t*(1-t)
            wires.segment([*p,z+.15],[*p,z+height-sag],.012)
        for j in range(1,math.ceil(height/1.10)+1):
            h=min(height,j*1.10); middle=lerp(a,b,.5); zm=(za+zb)/2+h-(.30 if h>height-.5 else .09)
            wires.segment([*a,za+h],[*middle,zm],.012)
            wires.segment([*middle,zm],[*b,zb+h],.012)
    supports.emit(ctx,parent,'slender silver truss mast ties',GALV,.6,.45)
    wires.emit(ctx,parent,'open geometric safety net strands',0x4C5850,.95)
    return len(posts)


def build(ctx):
    layout=json.loads(LAYOUT.read_text(encoding='utf-8'))
    for image in layout['images'].values():
        assert hashlib.sha256((ROOT/image['path']).read_bytes()).hexdigest()==image['sha256'], 'Range tracing image changed'
    for record in layout['sourceBuildings'][:2]: barn(ctx,record)
    for record in layout['sourceBuildings'][2:]:
        ring=source_ring(ctx,record['id'])
        flat_roof_hut(ctx,'range-side-small-shed' if record['id']=='way/221846983' else 'south-practice-small-building',ring,
            record['displayEaveHeightMetres'],record['displayRoofRiseMetres'],
            dict(status='cautious-aerial-appearance-estimate',sourceFootprintId=record['id'],note=record['limitation'],
                 estimatedHeightsMetres=[record['displayEaveHeightMetres'],record['displayRoofRiseMetres']]),[record['id']],color=0x565650)
    for record in layout['roofTraces']:
        if 'covered-bays' in record['id']:
            shelter(ctx,layout,record)
        else:
            ring=traced_ring(layout,record)
            parent=flat_roof_hut(ctx,record['id'],ring,record['displayEaveHeightMetres'],record['displayRoofRiseMetres'],
                dict(status='2025-roof-trace-with-estimated-facades',sourceImageId=layout['images'][record['image']]['id'],
                     roofPixelVertices=record['pixelVertices'],note=record['evidence']))
            if record['image']=='north':
                # Dispenser is represented by the service hut's opening; its exact machine type is not identifiable.
                a,b=ring[-1],ring[-2]; p=lerp(a,b,.55); ground=ctx.ground(*p)
                ctx.box(parent,'ball service dispenser cabinet',[*p,ground+.70],[.66,.58,1.40],0x394B3D)
                ctx.box(parent,'dispenser control face',[p[0],p[1]-.32,ground+1.05],[.32,.03,.24],0xA0AAA3)
                # Club photo shows a blue waste bin and barrel planter on the north hardstanding.
                image=layout['images']['north']; e,_,_,n=image['boundsEpsg3006']
                q=xy([e+246*.16,n-127*.16]); ground=ctx.ground(*q)
                ctx.box(parent,'blue waste bin photo approximation',[*q,ground+.55],[.48,.48,1.1],0x294E68)
                ctx.box(parent,'waste bin dark lid',[*q,ground+1.12],[.52,.52,.08],STEEL)
                q=[q[0]+1.05,q[1]]; ground=ctx.ground(*q)
                ctx.cylinder(parent,'barrel planter photo approximation',[*q,ground+.42],.42,.84,0x91744B,vertices=12)
    for record in layout['matRows']:
        points=traced_points(layout,record)
        platform='lidingo-range-north-platform-2019' if record['image']=='north' else 'lidingo-range-south-platform-2019'
        parent=ctx.facility(record['id'],[],source_ring(ctx,platform),dict(status='individually-traced-visible-mats',sourceFacilityId=platform,note=record['evidence'],
            count=len(points),countStatus='visible exposed positions only; covered/occluded bays separately estimated'))
        for index,p in enumerate(points):
            a=points[max(0,index-1)]; b=points[min(len(points)-1,index+1)]
            yaw=math.atan2(b[1]-a[1],b[0]-a[0])
            if record['shotDirection']=='south': yaw+=math.pi
            mat(ctx,parent,p,yaw,'exposed bay '+str(index+1))
    pole_count=sum(net(ctx,record) for record in layout['netAlignments'])
    for record in layout.get('parkingMarkings',[]):
        ring=traced_ring(layout,record)
        parent=ctx.facility(record['id'],[],ring,dict(status='photo-traced-paint-layout',sourceImageId=layout['images'][record['image']]['id'],
            sourceFacilityIds=['lidingo-upper-parking-north-2019','lidingo-upper-parking-south-2019'],note=record['evidence']),exclude_vegetation=False)
        marking=Batch()
        def line(a,b):
            # Sample each paint stripe to follow the real terrain without a floating rigid rectangle.
            steps=max(1,math.ceil(dist(a,b)))
            for j in range(steps):
                p,q=lerp(a,b,j/steps),lerp(a,b,(j+1)/steps)
                tangent=[(q[i]-p[i])/dist(p,q) for i in range(2)]; normal=[-tangent[1],tangent[0]]
                width=record['paintWidthMetres']/2
                marking.quad([[p[0]-normal[0]*width,p[1]-normal[1]*width,ctx.ground(*p)+.035],
                              [q[0]-normal[0]*width,q[1]-normal[1]*width,ctx.ground(*q)+.035],
                              [q[0]+normal[0]*width,q[1]+normal[1]*width,ctx.ground(*q)+.035],
                              [p[0]+normal[0]*width,p[1]+normal[1]*width,ctx.ground(*p)+.035]])
        for a,b in zip(ring,ring[1:]+ring[:1]): line(a,b)
        line(lerp(ring[0],ring[3],.5),lerp(ring[1],ring[2],.5))
        for i in range(1,record['stallsAlongLength']): line(lerp(ring[0],ring[1],i/record['stallsAlongLength']),lerp(ring[3],ring[2],i/record['stallsAlongLength']))
        marking.emit(ctx,parent,'terrain-following worn parking paint',0xC7C9BD)
    return dict(module='range-facilities',layoutPath='lidingobuild/facilities/authored-layout.json',layoutSha256=hashlib.sha256(LAYOUT.read_bytes()).hexdigest(),
        sourceBarns=2,sourceSmallBuildings=2,tracedCanopies=2,tracedHuts=2,exposedMats=sum(len(r['pixelCentres']) for r in layout['matRows']),
        coveredBaysEstimated=sum(r.get('postBays',0) for r in layout['roofTraces']),netPolesEstimated=pole_count,parkingMarkingBanks=len(layout.get('parkingMarkings',[])),
        deliberatelyUnlocated=layout['outOfScopeUnlocated'],geometryAuthority='appearance model; measurements and estimates remain distinguished in facility metadata')
