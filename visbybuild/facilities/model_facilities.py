"""Individually modeled Visby lighthouse station, auxiliary and practice buildings."""
import math
from model_primitives import Frame


def rectangle(ring):
    r=ring[:-1] if ring[0]==ring[-1] else ring
    best=None
    for a,b in zip(r,r[1:]+r[:1]):
        angle=math.atan2(b[1]-a[1],b[0]-a[0]);c,s=math.cos(angle),math.sin(angle)
        uv=[(x*c+y*s,-x*s+y*c) for x,y in r]
        u0,v0=min(x for x,y in uv),min(y for x,y in uv);u1,v1=max(x for x,y in uv),max(y for x,y in uv)
        candidate=((u1-u0)*(v1-v0),angle,u0,u1,v0,v1)
        if best is None or candidate[0]<best[0]:best=candidate
    _,angle,u0,u1,v0,v1=best;c,s=math.cos(angle),math.sin(angle)
    cx=(u0+u1)/2*c-(v0+v1)/2*s;cy=(u0+u1)/2*s+(v0+v1)/2*c
    length,width=u1-u0,v1-v0
    if length<width:length,width=width,length;angle+=math.pi/2
    # Predictable west-to-east orientation for facade-specific details.
    if math.cos(angle)<0:angle+=math.pi
    return cx,cy,length,width,angle


def battens(f,length,width,eave,mat='redbatten'):
    for side in (-1,1):
        for i in range(int(length/.22)+1):
            x=-length/2+i*.22
            f.box('Vertical timber battens',x,side*(width/2+.025),eave/2,(.027,.045,eave),mat)


def building(ctx,record,base):
    key=record['id'];ring=[(x,-z) for x,z in record['ring']]
    cx,cy,length,width,angle=rectangle(ring);f=Frame(ctx,key,cx,cy,angle,base)
    id=record['id'].split('/')[-1]
    wall='darkwood';roof='roof';eave=2.85;ridge=eave+width*.40
    if id=='530655632':wall='redwood';eave=2.95;ridge=6.25
    elif id=='530655633':wall='render';eave=2.65;ridge=5.3
    elif id=='530655627':wall='darkwood';roof='silverroof';eave=2.9;ridge=4.25
    elif id=='530655629':wall='darkwood';eave=2.45;ridge=3.25
    elif id=='530655630':wall='darkwood';eave=3.15;ridge=6.25
    elif id=='530655628':wall='redwood';eave=3.8;ridge=6.6
    wall=record.get('wallMaterial',wall);roof=record.get('roofMaterial',roof)
    eave=record.get('eaveEstimate',eave);ridge=record.get('ridgeEstimate',ridge)
    foundation_min=record.get('foundationMinRH2000',base-.3)
    ctx.prism(key,'Terrain-reaching limestone foundation',ring,foundation_min,base+.17,'stone')
    if id=='530655628':
        # The large eastern service structure has a concave footprint. Preserve
        # that footprint, including annexes, and clip both roof slopes at ridge.
        ctx.prism(key,'Service walls',ring,base+.12,base+eave,wall)
        c,s=math.cos(angle),math.sin(angle)
        local=[((x-cx)*c+(y-cy)*s,-(x-cx)*s+(y-cy)*c) for x,y in ring[:-1]]
        for side in (-1,1):
            clipped=[]
            for a,b in zip(local,local[1:]+local[:1]):
                ina=a[1]*side>=0;inb=b[1]*side>=0
                if ina:clipped.append(a)
                if ina!=inb:
                    t=-a[1]/(b[1]-a[1]);clipped.append((a[0]+t*(b[0]-a[0]),0))
            f.mesh('Service clipped roof',[(x,y,ridge-(ridge-eave)*abs(y)/(width/2)) for x,y in clipped],[tuple(range(len(clipped)))],roof)
        edges=list(zip(local,local[1:]+local[:1]))
        # Concave annex boundaries do not all sit at the enclosing rectangle's
        # eave line. Close each actual perimeter up to its intersecting roof.
        for a,b in edges:
            za=ridge-(ridge-eave)*abs(a[1])/(width/2);zb=ridge-(ridge-eave)*abs(b[1])/(width/2)
            if max(za,zb)>eave+.01:f.mesh('Service roof infill',[(*a,eave),(*b,eave),(*b,zb),(*a,za)],[(0,1,2,3)],wall)
        candidates=[(a,b) for a,b in edges if (a[1]+b[1])/2<0]
        a,b=max(candidates,key=lambda edge:math.dist(*edge));edge_length=math.dist(a,b)
        edge_angle=math.atan2(b[1]-a[1],b[0]-a[0]);c=Frame(ctx,key,*f.p((a[0]+b[0])/2,(a[1]+b[1])/2,0)[:2],angle+edge_angle,base)
        for x in (-edge_length*.28,0,edge_length*.28):
            c.box('Service door frames',x,0,1.65,(3.15,.20,3.2),'trim')
            for side in (-1,1):c.box('Service roller doors',x,side*.115,1.62,(2.92,.04,3.00),'steel')
    elif id=='530655627' or record.get('openShelter'):
        f.gable('Shelter roof',0,0,length,width,eave,ridge,wall,roof,walls=False)
        f.box('Shelter rear wall',0,-width/2,eave/2,(length,.13,eave),wall)
        for end in (-1,1):f.box('Shelter end panels',end*length/2,0,eave/2,(.13,width,eave),wall)
        for i in range(5):f.box('Shelter posts',-length/2+length*i/4,width/2,eave/2,(.13,.13,eave),'trim')
        f.box('Shelter practice floor',0,0,.22,(length-.2,width-.2,.10),'mat')
    else:f.gable('Main',0,0,length,width,eave,ridge,wall,roof)
    if id=='530655630':
        c=Frame(ctx,key,*f.p(-length*.22,0,0)[:2],angle+math.pi/2,base)
        c.gable('Cross gable',0,0,width,5.8,eave,5.8,wall,roof)
    if id in ('530655632','530655633','530655630'):
        battens(f,length,width,eave,'redbatten' if wall=='redwood' else ('trim' if wall=='render' else 'darkwood'))
        for side in (-1,1):
            if id=='530655632' and side==1:continue
            for x in (-length*.28,0,length*.28):f.window(x,side*(width/2+.04),.85,1.08,1.35,side)
        for side in (-1,1):
            for end in (-1,1):f.box('Corner trim',end*(length/2-.04),side*(width/2+.035),eave/2,(.14,.09,eave),'trim')
        f.box('Chimney',-length*.12,0,ridge+.30,(.62,.66,1.05),'stone')
        f.box('Chimney cap',-length*.12,0,ridge+.84,(.78,.82,.10),'steel')
    elif id=='530655629':
        for x in (-length*.25,length*.25):f.window(x,-width/2-.03,.18,1.8,2.20,-1,'Glazed doors')
    if id=='530655632':
        # CHAB p8 identifies northwest glazing enclosed under the existing roof
        # overhang, and an eastern addition. The light south roof area in the
        # orthophoto is the main roof slope, not a separate southern veranda.
        count=max(3,int(length*.65/1.55));span=length*.65
        for i in range(count):f.window(-span/2+(i+.5)*span/count,width/2+.05,.75,span/count-.15,1.65,1,'Northwest veranda glazing')
        f.box('East extension',length/2+.75,0,1.30,(1.5,width,2.60),'redwood')
        f.mesh('East extension roof',[(length/2,-width/2,3.3),(length/2,width/2,3.3),(length/2+1.8,width/2,2.65),(length/2+1.8,-width/2,2.65)],[(0,1,2,3)],'roof')
        g=Frame(ctx,key,*f.p(-length/2-.04,0,0)[:2],angle+math.pi/2,base)
        g.window(0,0,3.8,.85,1.1,1,'Gable attic window')
    if id=='530655633':
        # Historic lamp bay is at the west gable, visible in modern lodging photos.
        g=Frame(ctx,key,*f.p(-length/2,0,0)[:2],angle+math.pi/2,base)
        bay=[(-2.1,0),(-2.1,1.1),(-1.15,2.15),(1.15,2.15),(2.1,1.1),(2.1,0)]
        ctx.prism(key,'Faceted bay stone base',[g.p(x,y,0)[:2] for x,y in bay],foundation_min,base+.48,'stone')
        for a,b in zip(bay,bay[1:]):
            g.mesh('Faceted bay glazing',[(*a,.55),(*b,.55),(*b,2.48),(*a,2.48)],[(0,1,2,3)],'glass')
            g.beam('Faceted bay joinery',(*a,.45),(*a,2.56),.12,'trim')
            for z in (.5,1.6,2.5):g.beam('Faceted bay joinery',(*a,z),(*b,z),.10,'trim')
            g.mesh('Faceted bay shallow roof',[(*a,2.62),(*b,2.62),(0,0,3.12)],[(0,1,2)],'roof')
    return {'id':key,'dimensionsMetres':[round(length,2),round(width,2)],'eaveEstimateMetres':eave,'ridgeEstimateMetres':ridge,
            'footprintEvidence':'OSM geometry cross-checked with April 2026 orthophoto',
            'facadeEvidence':'photos for lighthouse station and east auxiliary; conservative estimates for service and range buildings'}


def lighthouse(ctx,base):
    key='skansudde-lighthouse';x,y=-603.3,-190.4
    # 10.4m is total height, not a 10.4m shaft plus a second lantern above it.
    ctx.cylinder(key,'Circular plinth',(x,y,base+.12),1.65,.24,'stone',24)
    ctx.cylinder(key,'White concrete shaft',(x,y,base+3.37),1.24,6.50,'render',32)
    ctx.cylinder(key,'Gallery',(x,y,base+6.65),1.54,.20,'trim',16)
    ctx.cylinder(key,'Lantern opaque panels',(x,y,base+7.98),1.20,2.46,'render',8)
    # Dark optical aperture faces the water, rather than glass over all eight panels.
    f=Frame(ctx,key,x,y,0,base);f.window(0,-1.22,8.60,.74,.52,-1,'Optical aperture',False)
    for i in range(8):
        a=i*math.tau/8;b=(i+1)*math.tau/8
        p=(x+1.23*math.cos(a),y+1.23*math.sin(a));q=(x+1.23*math.cos(b),y+1.23*math.sin(b))
        ctx.beam(key,'Lantern corner trim',(*p,base+6.78),(*p,base+9.20),.075,'trim')
        ctx.mesh(key,'Lantern cap',[(*p,base+9.21),(*q,base+9.21),(x,y,base+9.96)],[(0,1,2)],'trim')
    ctx.cylinder(key,'Roof finial',(x,y,base+10.15),.08,.50,'trim',8)
    # Thin open gallery rail, not a heavy second concrete drum.
    for i in range(16):
        a=i*math.tau/16;b=(i+1)*math.tau/16
        p=(x+1.51*math.cos(a),y+1.51*math.sin(a));q=(x+1.51*math.cos(b),y+1.51*math.sin(b))
        for z in (7.10,7.55):ctx.beam(key,'Gallery rail',(*p,base+z),(*q,base+z),.035,'trim')
        ctx.beam(key,'Gallery stanchions',(*p,base+6.76),(*p,base+7.55),.032,'trim')
    f.box('Shaft access door',0,-1.245,.99,(.69,.08,1.72),'trim')
    f.box('Shaft access panel',0,-1.299,.99,(.50,.03,1.50),'stone')
    return {'id':key,'totalHeightMetres':10.4,'heightSource':'Svenska Fyrsallskapet Skansudde, current 1936 tower',
            'radiusEstimateMetres':1.24,'otherDimensions':'photo-estimated from DSC4575 proportions'}
