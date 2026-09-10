"""Visby clubhouse roof assembly traced from native April 2026 orthophoto.

Roof pixel coordinates refer to clubhouse-finish.png, not a resized preview.
The photographs constrain architectural character; hidden joinery is estimated.
"""
import math
from model_primitives import Frame


SOURCE_TRANSFORM=[687097.12,.16,0,6370904.32,0,-.16]


def xy(pixel):return (SOURCE_TRANSFORM[0]+pixel[0]*.16-687748.5,SOURCE_TRANSFORM[3]-pixel[1]*.16-6370951.5)


def build(ctx,base):
    key='clubhouse'
    # Independent intersecting roofs retain the north additions and the restaurant
    # running toward the sea. Z dimensions are estimates, never DTM building heights.
    bars=[
        ('North wing',(826,906),13.0,10.0,-.018,2.85,4.45),
        ('Northwest wing',(779,930),16.0,9.5,-.014,2.85,4.60),
        ('Central gable',(835,993),18.0,11.5,-.013,3.65,6.65),
    ]
    for name,pixel,length,width,angle,eave,ridge in bars:
        cx,cy=xy(pixel);f=Frame(ctx,key,cx,cy,angle,base)
        f.box(name+' limestone plinth',0,0,-.52,(length+.12,width+.12,1.48),'stone')
        f.gable(name,0,0,length,width,eave,ridge)
        # North/rear joinery is conservative because most reference photographs
        # show the two western gables and the south restaurant, not these doors.
        if name!='Central gable':
            for xx in (-length*.30,0,length*.30):f.window(xx,width/2,.95,1.35,1.25,side=1)
        # Windows in the actual west-facing gable rather than an invented floor.
        gf=Frame(ctx,key,*f.p(-length/2,0,0)[:2],angle+math.pi/2,base)
        positions=(-width*.36,-width*.17,0,width*.17,width*.36) if name=='Central gable' else (-width*.25,0,width*.25)
        for xx in positions:gf.window(xx,0,.95,1.18,1.4,side=1)
        if name=='Central gable':
            for xx in (-1.1,1.1):gf.window(xx,0,4.10,.9,1.10,side=1)
        for end in (-1,1):
            f.beam(name+' downpipes',(end*(length/2-.10),-width/2-.29,.25),(end*(length/2-.10),-width/2-.29,eave-.18),.09,'steel')

    # The long restaurant roof, viewed from the west terrace. Its southern end
    # has a faceted bay, visible in both current orthophoto and club aerial.
    cx,cy=xy((852,1050));r=Frame(ctx,key,cx,cy,-math.pi/2-.025,base)
    length=18.6;width=13.4;eave=3.45;ridge=6.50;l=length/2;w=width/2
    r.box('Restaurant limestone plinth',0,0,-.52,(length+.12,width+.12,1.48),'stone')
    r.box('Restaurant walls',0,0,eave/2,(length,width,eave),'render')
    r.mesh('Restaurant roof',[
        (-l-.28,-w-.28,eave),(-l-.28,w+.28,eave),(-l-.28,0,ridge),
        (l,0,ridge),(l+3.0,-w*.55,eave),(l+3.8,0,eave),(l+3.0,w*.55,eave),
        (l,-w-.28,eave),(l,w+.28,eave)],
        [(0,7,3,2),(2,3,8,1)],'roof')
    r.mesh('Restaurant south gable',[(l,-w,eave),(l,w,eave),(l,0,ridge)],[(0,1,2)],'render')
    # Roof seams follow the roof slopes; whole meshes remain editable by material.
    for i in range(28):
        x=-l+i*(length-1)/27
        for side in (-1,1):
            if (side==-1 and abs(x-3)<1.65) or (side==1 and abs(x-5.5)<1.65):continue
            r.beam('Restaurant roof seams',(x,side*(w+.25),eave+.04),(x,0,ridge+.035),.025,'seam')
    for side in (-1,1):r.beam('Restaurant gutter',(-l,-side*(w+.3),eave-.08),(l,-side*(w+.3),eave-.08),.13,'steel')
    # Faceted, glazed sea-facing southern bay.
    bay=[(l,-w),(l+3.0,-w*.55),(l+3.8,0),(l+3.0,w*.55),(l,w)]
    for a,b in zip(bay,bay[1:]):
        r.mesh('South bay glass',[(a[0],a[1],.55),(b[0],b[1],.55),(b[0],b[1],2.85),(a[0],a[1],2.85)],[(0,1,2,3)],'glass')
        r.beam('South bay joinery',(*a,.30),(*a,2.95),.15,'trim')
        for z in (.48,2.65,2.90):r.beam('South bay joinery',(*a,z),(*b,z),.12,'trim')
        r.mesh('Conservatory shallow roof',[(*a,3.0),(*b,3.0),(l+.2,0,3.65)],[(0,1,2)],'silverroof')
        r.mesh('Conservatory stone base',[(*a,-1.25),(*b,-1.25),(*b,.48),(*a,.48)],[(0,1,2,3)],'stone')
    for xx in (-2.6,.2,3.0,5.8):
        r.window(xx,-w,.52,2.22,2.50,side=-1,part='Restaurant west glazing')
    for xx in (1.5,4.4,7):r.window(xx,w,.55,2.1,2.3,side=1,part='Restaurant east glazing')
    # Two triangular dormers visible in the orthophoto; their full joinery is estimated.
    for x,side in [(3.0,-1),(5.5,1)]:
        y=side*4.65;z=4.00
        r.mesh('Dormer front',[(x-1.5,y,z),(x+1.5,y,z),(x+1.5,y,5.6),(x,y,6.45),(x-1.5,y,5.6)],[(0,1,2,3,4)],'roof')
        r.mesh('Dormer roof',[(x-1.6,y+side*.18,5.65),(x+1.6,y+side*.18,5.65),(x,y+side*.18,6.50),(x-1.6,side*.8,6.18),(x+1.6,side*.8,6.18),(x,side*.8,6.50)],[(0,2,5,3),(2,1,4,5)],'roof')
        r.window(x,y+side*.035,z+.08,2.10,1.5,side=side,part='Dormer windows')
        r.mesh('Dormer upper glazing',[(x-1.05,y+side*.08,5.60),(x+1.05,y+side*.08,5.60),(x,y+side*.08,6.18)],[(0,1,2)],'glass')
    # East entry annex observed beside restaurant.
    ex,ey=xy((903,1061));a=Frame(ctx,key,ex,ey,-.03,base)
    a.gable('East entry',0,0,4.9,7.0,2.8,4.7)
    a.window(0,-3.51,.20,1.7,2.3,side=-1,part='Entry door')

    # Traced terrace, rather than the previous circular/generic clubhouse apron.
    terrace_pixels=[(751,1030),(804,1034),(808,1102),(748,1102)]
    terrace=[xy(p) for p in terrace_pixels]
    ctx.prism(key,'West limestone terrace',terrace,base-1.25,base+.30,'stone')
    ctx.prism(key,'West terrace paving',terrace,base+.30,base+.36,'deck')
    for a,b in zip(terrace,terrace[1:]+terrace[:1]):
        # Low stone boundary on lawn-facing south/west; open against the facade.
        if max(a[0],b[0])<xy((805,0))[0] or min(a[1],b[1])<xy((0,1100))[1]:
            ctx.beam(key,'Terrace low limestone wall',(*a,base+.53),(*b,base+.53),.35,'stone',.45)
            ctx.beam(key,'Terrace coping',(*a,base+.79),(*b,base+.79),.42,'trim',.09)
    south_terrace=[xy(p) for p in [(887,1086),(923,1085),(921,1130),(871,1133),(855,1113),(887,1111)]]
    ctx.prism(key,'South terrace',south_terrace,base-1.25,base+.30,'stone')
    # Furniture represents the observed arrangement, not a count of today's tables.
    for px,py in [(765,1045),(787,1047),(765,1070),(787,1090),(766,1093),(908,1100),(902,1120)]:
        tx,ty=xy((px,py));ctx.cylinder(key,'Terrace tables',(tx,ty,base+1.05),.64,.10,'deck')
        ctx.cylinder(key,'Terrace table legs',(tx,ty,base+.70),.08,.65,'steel',8)
        for dx,dy in [(-1,0),(1,0),(0,-1),(0,1)]:
            ctx.box(key,'Terrace chairs',(tx+dx,ty+dy,base+.68),(.45,.45,.10),'deck')
            ctx.box(key,'Terrace chair backs',(tx+dx*1.18,ty+dy*1.18,base+.98),(.07,.48,.55) if dx else (.48,.07,.55),'deck')
            for lx in (-.17,.17):ctx.box(key,'Terrace chairs',(tx+dx+lx,ty+dy,base+.50),(.045,.32,.40),'steel')
    # Visible slender pale chimney stacks on the roofs.
    for px,py,z in [(790,1014,5.7),(851,1000,6.6),(817,878,4.0)]:
        sx,sy=xy((px,py));ctx.box(key,'Chimneys',(sx,sy,base+z),(.50,.62,1.15),'stone')
        ctx.box(key,'Chimney cap',(sx,sy,base+z+.58),(.66,.78,.12),'steel')
    return {'roofSource':'April 10 2026 native 0.16m orthophoto clubhouse-finish',
            'roofTracePixelSpace':'original 1902x1869, top-left edges',
            'architecturalHeights':'photo-estimated, approximately +/-1m',
            'photoEvidence':['club-contact--497_VisbyGK_JacobSjoman_16BITS_V1-copy.jpg','semester--DSC4580.jpg','commons-clubhouse-2009.jpg'],
            'components':['north wing','northwest wing','central gable','restaurant with faceted south bay','two dormers','east entry','west and south terraces']}
