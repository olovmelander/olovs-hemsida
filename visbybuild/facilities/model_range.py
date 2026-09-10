"""Source-positioned range architecture; metres east, north and RH2000.

The April 2026 aerial supplies plan geometry. The club's March 2024 range
announcement supplies four covered screen bays and six additional screens.
Unseen construction details are explicitly recorded as visual estimates.
"""
import math
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
from model_primitives import Frame
from model_facilities import rectangle


def open_ring(ring):
    return ring[:-1] if ring[0] == ring[-1] else ring


def terrain_surface(ctx, key, part, ring, ground, material, lift=.035):
    """Triangulate the actual outline and sample its interior onto the DTM."""
    ring = open_ring(ring)
    triangles = tessellate_polygon([[Vector((x, y, 0)) for x, y in ring]])
    verts, faces = [], []
    for a, b, c in triangles:
        steps = max(1, math.ceil(max((a-b).length, (b-c).length, (c-a).length) / 1.8))
        indices = {}
        for i in range(steps+1):
            for j in range(steps+1-i):
                p = a + (b-a)*(i/steps) + (c-a)*(j/steps)
                indices[i,j] = len(verts)
                verts.append((p.x,p.y,ground(p.x,p.y)+lift))
        for i in range(steps):
            for j in range(steps-i):
                faces.append((indices[i,j],indices[i+1,j],indices[i,j+1]))
                if i+j < steps-1:
                    faces.append((indices[i+1,j],indices[i+1,j+1],indices[i,j+1]))
    ctx.mesh(key,part,verts,faces,material)


def mat(ctx, key, item, ground, base=None):
    x,y=item['centerBlenderXY'];angle=item['angleRadians']
    width=item.get('widthMetres',1.5);depth=item.get('depthMetres',1.5)
    f=Frame(ctx,key,x,y,angle,0)
    corners=[f.p(a*width/2,b*depth/2,0) for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    # A flat removable mat meets a shallow supporting tray; neither floats above
    # the high edge of the 1m terrain nor sinks into the low edge.
    z=max(ground(px,py) for px,py,_ in corners)+.045 if base is None else base
    f.base=z
    f.box('Individual recessed mat trays',0,0,.015,(width+.07,depth+.07,.045),'rubber')
    f.box('Individual replaceable hitting mats',0,0,.041,(width,depth,.025),'hittingmat')
    # Narrow tee insert distinguishes a hitting mat from the surrounding carpet.
    f.box('Tee insert',width*.35,0,.056,(.14,depth*.84,.008),'matinsert')
    for yy in (-depth*.25,depth*.25):
        ctx.cylinder(key,'Rubber tees',f.p(width*.35,yy,.072),.018,.035,'rubber',6)


def terminal(f, x, y):
    """Conservative fixed-screen form; the source confirms count, not hardware CAD."""
    f.box('Trackman terminal footing',x,y,.10,(.40,.42,.16),'steel')
    f.box('Trackman terminal pedestal',x,y,.69,(.10,.13,1.10),'steel')
    f.box('Trackman display enclosure',x,y,1.36,(.58,.14,.40),'recess')
    f.box('Trackman display glass',x,y-.078,1.36,(.51,.012,.32),'screen')
    f.box('Display status accent',x,y-.09,1.15,(.11,.015,.018),'orange')


def net(ctx, key, item, ground):
    points=item['polesBlenderXY'];heights=item.get('poleHeightsMetres',[item.get('heightEstimateMetres',9)]*len(points))
    assert len(heights)==len(points)
    for (x,y),height in zip(points,heights):
        z=ground(x,y)
        ctx.cylinder(key,'Galvanized pole footings',(x,y,z+.045),.22,.12,'stone',10)
        ctx.cylinder(key,'Tall timber safety net poles',(x,y,z+height/2),.12,height,'netpole',12)
        ctx.cylinder(key,'Pole caps',(x,y,z+height+.025),.09,.05,'steel',10)
    strands=0
    for index,(a,b) in enumerate(zip(points,points[1:])):
        za,zb=ground(*a),ground(*b);ha,hb=heights[index:index+2]
        length=math.dist(a,b);sag=min(.35,length*.018)
        nx=max(2,math.ceil(length/.40));nz=max(2,math.ceil(max(ha,hb)/.40))
        def p(t,v):
            x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
            low=ground(x,y)+.06
            top=(za+ha)*(1-t)+(zb+hb)*t-4*sag*t*(1-t)
            return x,y,low+(top-low)*v
        # Top tension cable follows a shallow sag between observed pole bases.
        for j in range(8):
            ctx.beam(key,'Sagging net tension cable',p(j/8,1),p((j+1)/8,1),.025,'net')
        for j in range(nz+1):
            v=j/nz
            for k in range(4):
                ctx.beam(key,'Safety net horizontal strands',p(k/4,v),p((k+1)/4,v),.006,'net')
                strands+=1
        for j in range(nx+1):
            t=j/nx
            ctx.beam(key,'Safety net vertical strands',p(t,0),p(t,1),.006,'net')
            strands+=1
    return {'id':key,'observedPoles':len(points),'spanMetres':round(sum(math.dist(a,b) for a,b in zip(points,points[1:])),2),
            'poleHeightsMetres':heights,'heightEvidence':item.get('heightEvidence','shadow-informed visual estimate'),
            'netConstruction':'0.40m visual mesh spacing, 6mm strands; simplified open geometry, not a measured mesh specification',
            'strandSegments':strands}


def studio(ctx,key,item,ground):
    ring=item['roofCornersBlenderXY'];cx,cy,length,width,angle=rectangle(ring)
    base=ground(cx,cy);f=Frame(ctx,key,cx,cy,angle,base)
    eave=item.get('eaveEstimateMetres',2.9);ridge=item.get('ridgeEstimateMetres',4.25)
    ctx.prism(key,'Studio concrete slab',open_ring(ring),min(ground(x,y) for x,y in ring)-.12,base+.12,'concrete')
    # Silver roof belongs to the teaching studio; keep a real enclosed rear
    # volume and a broad opening toward the field instead of public bay posts.
    f.gable('Studio',0,0,length-.45,width-.45,eave,ridge,'rangewood','silverroof',walls=False)
    f.box('Studio rear wall',0,-width/2+.22,eave/2,(length-.45,.16,eave),'rangewood')
    for side in (-1,1):f.box('Studio side walls',side*(length/2-.22),0,eave/2,(.16,width-.45,eave),'rangewood')
    opening=length*.34
    for x,span in [(-length*.455,length*.07),(0,length*.20),(length*.455,length*.07)]:
        f.box('Studio front wall piers',x,width/2-.22,eave/2,(span,.18,eave),'rangewood')
        f.box('Studio white inner lining',x,width/2-.33,eave/2,(span,.045,eave),'trim')
    f.box('Studio front header',0,width/2-.22,eave-.16,(length-.45,.22,.32),'rangewood')
    f.box('Studio white rear lining',0,-width/2+.32,eave/2,(length-.65,.045,eave-.1),'render')
    f.box('Studio floor',0,0,.135,(length-.65,width-.65,.06),'rangegrass')
    for x in (-length*.27,length*.27):
        p=f.p(x,width*.20,0)
        mat(ctx,key,{'centerBlenderXY':p[:2],'angleRadians':angle,'widthMetres':1.5,'depthMetres':1.5},ground,base+.17)
        for side in (-1,1):f.box('Sectional door guides',x+side*opening/2,width/2-.20,1.36,(.065,.13,2.50),'galvanized')
        # Open segmented doors match the two openings visible in club studio photos.
        f.box('Raised studio sectional doors',x,width/2-.2,2.53,(opening,.10,.40),'trim')
        f.box('Raised door glazing',x,width/2-.14,2.56,(opening-.25,.025,.18),'glass')
    return {'id':key,'use':'teaching swing studio, west of the public covered bays','dimensionsMetres':[length,width],
            'eaveEstimateMetres':eave,'ridgeEstimateMetres':ridge,'interiorEvidence':'two broad sectional-door openings and white inner walls in official studio photographs'}


def shelter(ctx,key,item,ground):
    ring=item['roofCornersBlenderXY'];cx,cy,length,width,angle=rectangle(ring)
    base=ground(cx,cy);f=Frame(ctx,key,cx,cy,angle,base)
    eave=item.get('rearEaveEstimateMetres',2.55);ridge=item.get('frontEaveEstimateMetres',3.5)
    l,w=length-.55,width-.55
    ctx.prism(key,'Shelter concrete slab',open_ring(ring),min(ground(x,y) for x,y in ring)-.12,base+.12,'concrete')
    # The genuine 2024 construction photograph shows one slope, high toward
    # the field. A tonal line in the orthophoto is not evidence of a roof ridge.
    f.mesh('Monopitch shelter roof',[(-length/2,-width/2,eave),(length/2,-width/2,eave),
        (length/2,width/2,ridge),(-length/2,width/2,ridge)],[(0,1,2,3)],'roof')
    f.box('Shelter rear weatherboarding',0,-w/2,eave/2,(l,.14,eave),'rangewood')
    for side in (-1,1):
        f.mesh('Shelter side weatherboarding',[(side*l/2,-w/2,.10),(side*l/2,w/2,.10),
            (side*l/2,w/2,ridge-.06),(side*l/2,-w/2,eave+.04)],[(0,1,2,3)],'rangewood')
        f.beam('Shelter roof side fascia',(side*length/2,-width/2,eave),(side*length/2,width/2,ridge),.15,'rangewood')
    for j in range(int(length/.60)+1):
        x=-length/2+j*length/int(length/.60)
        f.beam('Monopitch roof standing seams',(x,-width/2,eave+.025),(x,width/2,ridge+.025),.021,'seam')
    for y,z in [(-width/2,eave),(width/2,ridge)]:f.beam('Shelter roof fascia',(-length/2,y,z),(length/2,y,z),.15,'rangewood')
    f.box('Shelter carpet',0,0,.15,(l-.18,w-.18,.06),'rangegrass')
    # Four covered places are documented by the club, independently of roof pixels.
    count=4;spacing=l/count
    for i in range(count+1):
        x=-l/2+i*spacing
        f.box('Shelter front posts',x,w/2,ridge/2,(.105,.105,ridge),'galvanized')
        f.beam('Exposed monopitch rafters',(x,-w/2,eave-.12),(x,w/2,ridge-.12),.11,'rangewood',.19)
        if 0<i<count:
            f.box('Low bay dividers',x,w*.22,.45,(.075,2.2,.65),'rangewood')
    f.box('Front roof beam',0,w/2,ridge-.16,(l,.19,.24),'rangewood')
    for i in range(count):
        x=-l/2+(i+.5)*spacing;px,py,_=f.p(x,w*.22,0)
        mat(ctx,key,{'centerBlenderXY':[px,py],'angleRadians':angle,'widthMetres':1.5,'depthMetres':1.5},ground,base+.20)
        terminal(f,x-spacing*.34,w*.05)
        f.box('Rear equipment benches',x,-w*.30,.57,(spacing*.60,.38,.08),'deck')
        for dx in (-spacing*.22,spacing*.22):f.box('Bench legs',x+dx,-w*.30,.31,(.06,.29,.48),'steel')
    return {'id':key,'coveredBays':4,'fixedScreens':4,'dimensionsMetres':[length,width],
            'roofForm':'monopitch, front high','rearEaveEstimateMetres':eave,'frontEaveEstimateMetres':ridge,
            'countSource':'https://www.visbygk.com/nyheter/trana-med-trackman-range/',
            'interiorDetailStatus':'supports, partitions, screen mounts and benches visually estimated; roof footprint traced'}
