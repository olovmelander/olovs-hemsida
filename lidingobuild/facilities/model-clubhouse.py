"""Photo-informed clubhouse model. build(ctx) is Blender-independent geometry code.

Horizontal source rings and measured roof plates are retained. All authored
facade, furnishing and ancillary dimensions are explicitly appearance estimates.
"""
import math
from collections import defaultdict

WHITE = 0xEAE9E1
TRIM = 0xF4F2EB
DARK = 0x252E31
ROOF = 0x3C4142
GLASS = 0x344C50
BLUE = 0x174680
WOOD = 0x918574
METAL = 0x738080
SOURCE_PHOTOS = [
    "vikingaskeppet-2024-20240706_171448721_ios",
    "vikingaskeppet-2024-20240706_171448717_ios",
    "venuu-134", "venuu-137", "venuu-136",
]


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def mul(a, scalar):
    return tuple(x * scalar for x in a)


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def unit(a):
    length = math.sqrt(sum(x*x for x in a))
    return tuple(x/length for x in a)


class Frame:
    def __init__(self, a, b, side=1, z_offset=0):
        self.a = a
        self.length = math.hypot(b[0]-a[0], b[1]-a[1])
        self.u = ((b[0]-a[0])/self.length, (b[1]-a[1])/self.length, 0)
        self.v = (-self.u[1]*side, self.u[0]*side, 0)
        self.z_offset = z_offset

    def P(self, u, v, z):
        return (self.a[0]+self.u[0]*u+self.v[0]*v,
                self.a[1]+self.u[1]*u+self.v[1]*v, z+self.z_offset)


def face_frame(ring, edge):
    a, b = ring[edge], ring[(edge+1) % (len(ring)-1)]
    center = tuple(sum(p[k] for p in ring[:-1])/(len(ring)-1) for k in (0, 1))
    trial = Frame(a, b)
    side = 1 if sum((center[k]-a[k])*trial.v[k] for k in (0, 1)) > 0 else -1
    return Frame(a, b, side)


class Batch:
    """Emit a few material meshes instead of thousands of primitive objects."""
    def __init__(self, ctx, parent):
        self.ctx, self.parent = ctx, parent
        self.groups = defaultdict(lambda: [[], []])
        self.triangles = 0

    def poly(self, points, faces, color, roughness=.8, metallic=0, alpha=1):
        key = (color, roughness, metallic, alpha)
        vertices, indices = self.groups[key]
        start = len(vertices)
        vertices.extend(points)
        for face in faces:
            for i in range(1, len(face)-1):
                indices.extend((start+face[0], start+face[i], start+face[i+1]))

    def quad(self, points, color, **material):
        self.poly(points, [(0, 1, 2, 3)], color, **material)

    def box(self, f, u0, u1, v0, v1, z0, z1, color, **material):
        if min(u1-u0, v1-v0, z1-z0) <= 1e-5:
            return
        p = [f.P(u,v,z) for z in (z0,z1) for u,v in
             ((u0,v0),(u1,v0),(u1,v1),(u0,v1))]
        faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        # A clockwise local horizontal frame reverses mesh orientation.
        if f.u[0]*f.v[1]-f.u[1]*f.v[0] < 0:
            faces = [tuple(reversed(face)) for face in faces]
        self.poly(p, faces, color, **material)

    def beam(self, a, b, width, depth, color, **material):
        if math.dist(a,b) < 1e-5:
            return
        axis = unit(sub(b,a))
        side = unit(cross(axis, (0,0,1) if abs(axis[2]) < .95 else (0,1,0)))
        up = cross(axis,side)
        p = [add(c,add(mul(side,s*width/2),mul(up,t*depth/2)))
             for c in (a,b) for s,t in ((-1,-1),(1,-1),(1,1),(-1,1))]
        self.poly(p, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], color, **material)

    def tube(self, a, b, radius, color, segments=12, **material):
        if math.dist(a,b) < 1e-5:
            return
        axis = unit(sub(b,a))
        side = unit(cross(axis, (0,0,1) if abs(axis[2]) < .95 else (0,1,0)))
        up = cross(axis,side)
        p = [add(c,add(mul(side,math.cos(i*math.tau/segments)*radius),
                       mul(up,math.sin(i*math.tau/segments)*radius)))
             for c in (a,b) for i in range(segments)]
        faces = [tuple(reversed(range(segments))), tuple(range(segments,2*segments))]
        faces += [(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)]
        self.poly(p,faces,color,**material)

    def flush(self):
        count = 0
        for i, ((color, roughness, metallic, alpha), (vertices, indices)) in enumerate(self.groups.items()):
            if not indices:
                continue
            self.ctx.mesh(self.parent, f"authored_{i:02d}_{color:06x}", vertices, indices,
                          color, roughness=roughness, metallic=metallic, alpha=alpha)
            count += len(indices)//3
        return count


def window(b, f, u0, u1, z0, z1, *, v=-.065, bays=1, frame=TRIM, door=False):
    """Physical frame, reveals, mullions and opaque tinted glazing; no photo pixels."""
    if z1-z0 < .45 or u1-u0 < .4:
        return
    b.box(f,u0,u1,v-.045,v+.025,z0,z1,DARK,roughness=.5)
    b.box(f,u0+.06,u1-.06,v-.068,v-.04,z0+.075,z1-.075,GLASS,roughness=.23,metallic=.22)
    for a,c in ((u0-.045,u0+.05),(u1-.05,u1+.045)):
        b.box(f,a,c,v-.09,v+.07,z0-.05,z1+.05,frame,roughness=.6)
    for a,c in ((z0-.05,z0+.055),(z1-.055,z1+.05)):
        b.box(f,u0-.045,u1+.045,v-.09,v+.07,a,c,frame,roughness=.6)
    b.box(f,u0-.065,u1+.065,v-.19,v+.09,z0-.075,z0-.025,0xC4C8C1)
    for j in range(1,bays):
        u = u0+(u1-u0)*j/bays
        b.box(f,u-.035,u+.035,v-.095,v+.05,z0+.06,z1-.06,frame,roughness=.55)
    # A narrow transom makes the frame read in close view without fake reflections.
    if z1-z0 > 1.9:
        b.box(f,u0+.04,u1-.04,v-.085,v+.025,z1-.4,z1-.355,frame,roughness=.55)
    if door:
        u=u1-.28
        for z in (z0+.78,z0+1.24):
            b.beam(f.P(u,v-.12,z),f.P(u,v-.22,z),.024,.024,0xB8C1BE,metallic=.75)
        b.tube(f.P(u,v-.22,z0+.78),f.P(u,v-.22,z0+1.24),.018,0xB8C1BE,segments=12,metallic=.75)


def clock_face(b, f, u, v, z, radius=.32):
    b.tube(f.P(u,v+.02,z),f.P(u,v-.045,z),radius,DARK,segments=48)
    b.tube(f.P(u,v-.045,z),f.P(u,v-.065,z),radius*.925,TRIM,segments=48)
    for i in range(12):
        ang=i*math.tau/12
        a=(u+math.sin(ang)*radius*.72,z+math.cos(ang)*radius*.72)
        c=(u+math.sin(ang)*radius*.83,z+math.cos(ang)*radius*.83)
        b.beam(f.P(a[0],v-.075,a[1]),f.P(c[0],v-.075,c[1]),.012,.01,DARK)
    b.beam(f.P(u,v-.08,z),f.P(u-.12,v-.08,z+.1),.024,.015,DARK)
    b.beam(f.P(u,v-.083,z),f.P(u+.03,v-.083,z+.23),.018,.015,DARK)


def rooftop(b, f):
    # Existing roof plates/service room/chimney stay; small details are separate.
    high=lambda u,v:37.692-.001*u-.029*v
    for v in [1.0+i*1.15 for i in range(12)]:
        b.beam(f.P(.4,v,high(.4,v)+.016),f.P(20.65,v,high(20.65,v)+.016),.019,.016,0x4A4D49)
    for v in [16+i*1.1 for i in range(10)]:
        b.beam(f.P(9.0,v,high(9,v)+.016),f.P(20.6,v,high(20.6,v)+.016),.019,.016,0x4A4D49)
    # Plant room: door, vertical standing seams, small access ladder.
    b.box(f,9.25,10.25,22.145,22.19,37.12,39.22,0xA7AEAB,roughness=.65)
    b.box(f,9.33,10.17,22.10,22.145,37.2,39.13,0x909A98)
    for u in [8.8+i*.3 for i in range(16)]:
        if not 9.17<u<10.33:
            b.box(f,u,u+.018,22.155,22.195,37.03,39.87,0x495152)
    for u in (12.65,13.11):
        b.tube(f.P(u,21.91,37.18),f.P(u,21.91,40.47),.027,0xABB4AE,segments=10,metallic=.65)
    for i in range(11):
        z=37.35+i*.27
        b.tube(f.P(12.65,21.9,z),f.P(13.11,21.9,z),.022,0xABB4AE,segments=10,metallic=.65)
    # Rooftop ventilators show grills, fan housings, curbs and connecting duct.
    for u,v in ((13.5,20.3),(16,18.5)):
        h=high(u,v)
        b.box(f,u-.10,u+1.2,v-.1,v+1.6,h,h+.12,0x717B7A)
        for k in range(9):
            z=h+.19+k*.055
            b.box(f,u+.08,u+1.02,v-.016,v+.025,z,z+.016,0x4A5454,roughness=.6)
        b.tube(f.P(u+.55,v+.75,h+.75),f.P(u+.55,v+.75,h+.87),.34,0x737C7B,segments=32,metallic=.4)
        for k in range(9):
            y=v+.48+k*.066
            b.beam(f.P(u+.32,y,h+.883),f.P(u+.78,y,h+.883),.012,.012,0x374342)
    b.box(f,13.0,16.3,19.4,19.88,37.22,37.73,0x889390,roughness=.55,metallic=.5)
    # Subtle masonry courses and flashing on the existing pale chimney.
    for i in range(18):
        h=37.05+i*.185
        b.box(f,17.994,19.406,12.79,12.812,h,h+.01,0x8C8678)
        b.box(f,19.39,19.412,12.81,14.3,h,h+.01,0x8C8678)
    b.box(f,17.83,19.57,12.64,14.46,37.0,37.15,0x687170,metallic=.45)


def restaurant(ctx, footprint):
    ring=footprint['rings'][0]
    p=ctx.facility('clubhouse-restaurant',[footprint['id']],[r[:2] for r in ring],
                   {'basis':'retained footprint/roof + reviewed 2024 aerial and close public exterior photographs',
                    'photoIds':SOURCE_PHOTOS,
                    'dimensions':'roof planes constrained by 2021 laser; facade and rooftop accessories are visual estimates'})
    ctx.import_parts(p,footprint['id'],omit_parts=('upper-glazing','reception-glazing','door-handle',
        'balcony-deck','balcony-apron','balcony-panels','balcony-rail','balcony-columns',
        'blue-awnings','awning-valance','clock','clock-hands','facade-glazing'))
    b=Batch(ctx,p);f=Frame(ring[2],ring[0],1,-25);deck=33.55;facade=2.1
    ground=lambda u,v:ctx.ground(*f.P(u,v,0)[:2])+25
    # Full facade glazing rhythm and three real round supporting columns.
    window(b,f,1.5,5.2,34.1,36.55,v=facade-.055,bays=2,frame=DARK)
    window(b,f,6.5,20.5,33.78,36.75,v=facade-.055,bays=7,frame=DARK)
    window(b,f,23,26.5,34.1,36.0,v=facade-.055,bays=2,frame=DARK)
    floor=max(ground(6.5,facade),ground(20.5,facade))+.06
    for i,(u0,u1) in enumerate(((6.5,9.0),(9.12,11.65),(11.78,14.7),(14.85,17.6),(17.75,20.5))):
        window(b,f,u0,u1,floor,deck-.27,v=facade-.055,bays=2 if i in (0,2,4) else 1,frame=DARK,door=i in (1,3))
    b.box(f,6.17,21.08,-.12,2.12,deck-.19,deck,WOOD)
    # Board rhythm is narrow and real relief, rather than an opaque flat slab.
    for i in range(87):
        u=6.19+i*.17
        b.box(f,u,min(u+.158,21.05),-.185,-.065,deck-.14,deck+.61,TRIM if i%5 else WHITE)
    for z in (deck-.15,deck+.61):
        b.box(f,6.14,21.10,-.21,-.03,z,z+.055,TRIM)
    for u in (6.22,21.02):
        for j in range(11):
            angle=(math.pi/2)*j/10
            # Curved apron end returns soften the characteristic balcony corners.
            x=u+(-1 if u<10 else 1)*math.sin(angle)*.15
            v=-.07+(1-math.cos(angle))*.15
            b.tube(f.P(x,v,deck-.12),f.P(x,v,deck+.61),.036,TRIM,segments=8)
        b.box(f,u-.05,u+.05,-.01,1.97,deck-.10,deck+.61,TRIM)
    for u in (6.42,13.53,20.82):
        g=ground(u,.16)-.1
        b.tube(f.P(u,.16,g),f.P(u,.16,deck-.17),.145,TRIM,segments=48)
        b.tube(f.P(u,.16,g),f.P(u,.16,g+.09),.177,0xD2D4CC,segments=48)
        b.tube(f.P(u,.16,deck-.26),f.P(u,.16,deck-.17),.165,TRIM,segments=48)
    b.tube(f.P(6.22,-.21,deck+.97),f.P(21.05,-.21,deck+.97),.035,DARK,segments=16)
    for i in range(12):
        u=6.27+i*1.34
        b.tube(f.P(u,-.21,deck+.63),f.P(u,-.21,deck+.97),.024,DARK,segments=10)
    for i in range(14):
        v=.05+i*.145
        b.box(f,6.3,20.95,v,v+.132,deck+.004,deck+.025,0x928778 if i%3 else 0x9B9082)
    # The recessed ceiling, paired retractable awnings and folding support arms.
    for i in range(15):
        u=6.3+i*.98
        b.box(f,u,u+.955,-.08,2.07,36.98,37.025,0x92988F if i%3 else 0xA0A498)
    for a,c in ((6.5,13.4),(13.6,20.5)):
        b.quad([f.P(a,2.025,36.92),f.P(c,2.025,36.92),f.P(c,-.33,35.67),f.P(a,-.33,35.67)],BLUE,roughness=.91)
        b.quad([f.P(a,-.33,35.67),f.P(c,-.33,35.67),f.P(c,-.33,35.47),f.P(a,-.33,35.47)],0x123A6B,roughness=.91)
        b.tube(f.P(a,2.01,36.95),f.P(c,2.01,36.95),.065,0x9BABA5,segments=16,metallic=.55)
        b.beam(f.P(a,-.34,35.68),f.P(c,-.34,35.68),.045,.045,0x62747A)
        for u in (a+.32,c-.32):
            b.beam(f.P(u,1.95,36.91),f.P(u+.15,.80,36.36),.038,.045,0x727F80)
            b.beam(f.P(u+.15,.80,36.36),f.P(u,-.27,35.71),.038,.045,0x727F80)
            b.box(f,u-.12,u+.12,1.80,2.1,36.83,37.00,0x717F7E)
    clock_face(b,f,22,facade-.1,35.5)
    # Wall lanterns are visible in the covered balcony photograph.
    for u in (7.6,10.6,13.8,17,19.6):
        b.box(f,u-.13,u+.13,1.71,1.98,35.44,35.93,DARK)
        b.box(f,u-.09,u+.09,1.655,1.74,35.50,35.85,0xBCAB7B,roughness=.4)
        b.box(f,u-.18,u+.18,1.62,2.02,35.93,36.025,DARK)
    rooftop(b,f)
    # A small number of observed side features, not a generic repeated window grid.
    side=face_frame(ring,10)
    sidefloor=ctx.ground(*side.P(side.length*.5,0,0)[:2])
    clock_face(b,side,side.length*.46,-.07,sidefloor+2.7,.58)
    # Round window's center is dark; the circular rim is the important silhouette.
    b.tube(side.P(side.length*.46,-.15,sidefloor+2.7),side.P(side.length*.46,-.19,sidefloor+2.7),.50,GLASS,segments=48,roughness=.24)
    # Slender rainwater downpipes at observed facade ends.
    for u,v in ((.45,2.07),(27.4,2.05)):
        h=ground(u,v)
        b.tube(f.P(u,v-.11,h+.15),f.P(u,v-.11,36.8),.052,DARK,segments=12)
    return b.flush()


def roof_height_for_low(ring, point, pavilion):
    f=Frame(ring[0],ring[1],-1)
    delta=(point[0]-ring[0][0],point[1]-ring[0][1])
    u=sum(delta[i]*f.u[i] for i in (0,1));v=sum(delta[i]*f.v[i] for i in (0,1))
    return (32.30-.006*u+.045*v if pavilion else 31.92+.002*u-.024*v)-25


def low_building(ctx, footprint, pavilion):
    ring=footprint['rings'][0]
    # Exclusion follows the original outline with only the actual appendages
    # inserted into their facade edge; no bounding box and no source-ring edit.
    edge=9 if pavilion else 5
    front=face_frame(ring,edge)
    if pavilion:
        outline_uv=[(.8,0),(.8,-1.25),(3.7,-1.25),(3.7,-4.25),
                    (7.5,-4.25),(7.5,-1.25),(11.45,-1.25),(11.45,0)]
    else:
        outline_uv=[(5.45,0),(5.45,-1.75),(6.25,-1.75),(6.25,-2.55),
                    (8.15,-2.55),(8.15,-1.75),(8.95,-1.75),(8.95,0)]
    exclusion=[list(r[:2]) for r in ring[:edge+1]]
    exclusion.extend([list(front.P(u,v,0)[:2]) for u,v in outline_uv])
    exclusion.extend([list(r[:2]) for r in ring[edge+1:]])
    p=ctx.facility('clubhouse-pavilion' if pavilion else 'clubhouse-annex',
        [footprint['id']],
        exclusion, {'basis':'retained footprint/roof; 2024 aerial group and pavilion photo',
        'photoIds':['vikingaskeppet-2024-20240706_171448717_ios','gallery-015_lidingo_gk_16bits-copy'],
        'use':'descriptive pavilion/annex association; historic B2/B3/B4 map assignment unresolved',
        'exclusionOutline':'authored outline: original source ring plus edge-inserted veranda/porch/stair extents; source geometry unchanged',
        'dimensions':'siding, glazing, porch and stairs are photo-informed visual estimates'})
    ctx.import_parts(p,footprint['id'],omit_parts=('facade-glazing','veranda-posts','veranda-rail'))
    b=Batch(ctx,p)
    # Narrow battens and lower trim create white timber siding with restrained relief.
    for edge in range(len(ring)-1):
        f=face_frame(ring,edge)
        count=max(1,int(f.length/.19))
        for i in range(count+1):
            u=min(f.length-.035,.025+i*f.length/count)
            pt=f.P(u,0,0);g=ctx.ground(*pt[:2]);h=roof_height_for_low(ring,pt,pavilion)
            b.box(f,u,u+.024,-.024,.006,g+.10,h-.27,0xD9DDD5)
        for u in (.045,max(.055,f.length-.08)):
            pt=f.P(u,0,0);g=ctx.ground(*pt[:2]);h=roof_height_for_low(ring,pt,pavilion)
            b.box(f,u-.04,u+.04,-.072,.007,g+.10,h-.22,TRIM)
        # Terrain-following base plinth, split in short lengths to avoid floating.
        for i in range(max(1,int(math.ceil(f.length)))):
            u0=i*f.length/math.ceil(f.length);u1=(i+1)*f.length/math.ceil(f.length)
            g=min(ctx.ground(*f.P(u0,0,0)[:2]),ctx.ground(*f.P(u1,0,0)[:2]))
            b.box(f,u0,u1,-.042,.028,g-.13,g+.18,0xA7AFA7)
    if pavilion:
        # North courtyard facade: small/ordinary windows, service doors, clock.
        f=face_frame(ring,8)
        for u0,u1 in ((1.1,3.2),(4.1,6.3),(11.0,13.1),(14.15,16.1)):
            g=ctx.ground(*f.P((u0+u1)/2,0,0)[:2]);h=roof_height_for_low(ring,f.P(u0,0,0),True)
            window(b,f,u0,u1,g+.75,min(g+2.0,h-.35),bays=2)
        for u0,u1 in ((7.25,8.65),(18.7,21.2)):
            g=ctx.ground(*f.P((u0+u1)/2,0,0)[:2]);h=roof_height_for_low(ring,f.P(u0,0,0),True)
            window(b,f,u0,u1,g+.04,min(g+2.35,h-.24),frame=DARK,door=True)
        cg=ctx.ground(*f.P(6.45,0,0)[:2]);clock_face(b,f,6.45,-.10,cg+2.1,.29)
        # Course-facing veranda belongs to east elevation, with a wide stair.
        f=face_frame(ring,9);floor=max(ctx.ground(*f.P(u,0,0)[:2]) for u in (1,5,9))+.12
        roof=min(roof_height_for_low(ring,f.P(u,0,0),True) for u in (1,9))-.25
        for u in (1.0,3.65,6.3,8.95):
            window(b,f,u,u+2.35,floor+.47,roof-.12,bays=2)
        b.box(f,.8,11.45,-1.25,.02,floor-.20,floor,WOOD)
        for i in range(60):
            u=.85+i*.175
            b.box(f,u,u+.165,-1.2,-.04,floor+.006,floor+.035,0x958A7B if i%3 else 0xA09689)
        for u in (.9,3.5,6.1,8.7,11.25):
            b.box(f,u-.065,u+.065,-1.15,-1.02,floor,roof,TRIM)
        b.box(f,.85,11.35,-1.18,-1.00,roof-.12,roof,TRIM)
        for u0,u1 in ((.85,3.5),(7.7,11.35)):
            b.box(f,u0,u1,-1.17,-1.07,floor+.72,floor+.82,TRIM)
            for j in range(int((u1-u0)/.18)):
                u=u0+j*.18+.08
                b.box(f,u,u+.035,-1.15,-1.10,floor+.10,floor+.74,TRIM)
        stair(b,ctx,f,3.7,7.5,-1.25,-4.25,floor,0x96958A)
        for u0 in (12.25,15.1,17.95,20.8,23.65,26.5,29.35):
            g=ctx.ground(*f.P(u0+1,0,0)[:2]);h=roof_height_for_low(ring,f.P(u0,0,0),True)
            window(b,f,u0,u0+2.25,g+.9,min(g+2.35,h-.38),bays=2)
        # Sparse side/back windows to avoid inventing an unsupported full facade.
        for edge,positions in ((0,((2.0,3.5),(8.5,10.0))), (1,((2,3.4),(10,11.4)))):
            f=face_frame(ring,edge)
            for u0,u1 in positions:
                if u1>=f.length-.4:continue
                g=ctx.ground(*f.P(u0,0,0)[:2]);h=roof_height_for_low(ring,f.P(u0,0,0),True)
                window(b,f,u0,u1,g+.85,min(g+2.15,h-.4))
    else:
        # Parking-facing doors and modest windows are visible in the aerial.
        f=face_frame(ring,4)
        for u0,u1 in ((1.0,3.1),(7.6,9.8)):
            g=ctx.ground(*f.P(u0,0,0)[:2]);h=roof_height_for_low(ring,f.P(u0,0,0),False)
            window(b,f,u0,u1,g+.95,min(g+2.1,h-.35),bays=2)
        window(b,f,11.4,13.0,3.52,6.32,frame=DARK,door=True)
        f=face_frame(ring,0)
        for u0 in (2.5,9.0,15.5):
            g=ctx.ground(*f.P(u0,0,0)[:2]);h=roof_height_for_low(ring,f.P(u0,0,0),False)
            window(b,f,u0,u0+1.35,g+1.05,min(g+2.0,h-.35))
        # Small glazed projecting porch near the course-facing end.
        f=face_frame(ring,5);floor=ctx.ground(*f.P(7.2,0,0)[:2])+.14;top=floor+2.2
        b.box(f,5.6,8.8,-1.6,.03,floor-.15,floor,0x9D9B90)
        b.box(f,5.45,8.95,-1.75,.14,top,top+.12,DARK)
        window(b,f,5.72,8.68,floor+.45,top-.08,v=-1.55,bays=4)
        for u in (5.62,8.78):
            b.box(f,u-.055,u+.055,-1.62,.0,floor,top,TRIM)
        stair(b,ctx,f,6.25,8.15,-1.6,-2.55,floor,0xABA89A)
    return b.flush()


def stair(b,ctx,f,u0,u1,v0,v1,top,color):
    """Stair descends outward (decreasing v), with side stringers and rails."""
    bottom=ctx.ground(*f.P((u0+u1)/2,v1,0)[:2])+.04
    count=max(2,min(12,int(math.ceil(max(.2,top-bottom)/.17))))
    if bottom>=top-.03:
        bottom=top-.20
    for i in range(count):
        a=v0+(v1-v0)*i/count;c=v0+(v1-v0)*(i+1)/count
        z=top-(top-bottom)*(i+1)/count
        b.box(f,u0,u1,min(a,c),max(a,c),z-.14,z,color)
        b.box(f,u0,u1,min(a,c),min(a,c)+.035,z,z+.025,0xC2C0B3)
    for u in (u0+.07,u1-.07):
        b.beam(f.P(u,v0,top-.12),f.P(u,v1,bottom-.12),.11,.22,DARK)
        b.beam(f.P(u,v0,top+.95),f.P(u,v1,bottom+.95),.052,.055,DARK)
        for t in (0,.5,1):
            v=v0+(v1-v0)*t;z=top+(bottom-top)*t
            b.box(f,u-.025,u+.025,v-.025,v+.025,z,z+.98,DARK)


def glass_railing(b,f,u0,u1,v0,v1,z):
    a=f.P(u0,v0,z);c=f.P(u1,v1,z);length=math.dist(a,c)
    count=max(1,int(math.ceil(length/1.32)))
    for i in range(count+1):
        t=i/count;u=u0+(u1-u0)*t;v=v0+(v1-v0)*t
        b.box(f,u-.032,u+.032,v-.032,v+.032,z,z+1.055,DARK,roughness=.55)
    for i in range(count):
        ta=(i+.055)/count;tc=(i+.945)/count
        ua=u0+(u1-u0)*ta;va=v0+(v1-v0)*ta;uc=u0+(u1-u0)*tc;vc=v0+(v1-v0)*tc
        b.quad([f.P(ua,va,z+.15),f.P(uc,vc,z+.15),f.P(uc,vc,z+.97),f.P(ua,va,z+.97)],
               0xBCD4D0,roughness=.18,metallic=.02,alpha=.24)
    b.beam(f.P(u0,v0,z+1.05),f.P(u1,v1,z+1.05),.055,.052,DARK,roughness=.55)


def chair(b,f,u,v,z,yaw=0):
    a=f.P(u,v,z);c=(a[0]+math.cos(yaw),a[1]+math.sin(yaw),0);q=Frame(a,c)
    for x in (-.25,.25):
        for y in (-.23,.23):
            b.box(q,x-.025,x+.025,y-.025,y+.025,z,z+.46,0x49544F)
    for i in range(5):
        y=-.25+i*.103
        b.box(q,-.29,.29,y,y+.084,z+.45,z+.48,0x887B65)
    for x in (-.27,.27):
        b.beam(q.P(x,.24,z+.43),q.P(x,.30,z+.93),.032,.032,0x49544F)
    for i in range(5):
        z1=z+.52+i*.075
        b.box(q,-.26,.26,.26,.30,z1,z1+.052,0x897D68)


def terrace(ctx, restaurant_footprint):
    r=restaurant_footprint['rings'][0];rf=Frame(r[2],r[0],1,-25)
    anchor=rf.P(27.1,-.6,25)
    # Match retained terrace axes: east and north, not rotated with restaurant.
    f=Frame((anchor[0]-28.8,anchor[1]+.6),(anchor[0]-27.8,anchor[1]+.6),1,-25)
    footprint=[f.P(u,v,25)[:2] for u,v in ((26.7,-21.3),(35.45,-21.3),(35.45,2.3),(28.55,2.3),(28.55,-16.0),(26.7,-16.0))]
    p=ctx.facility('courtyard',[],footprint,
        {'basis':'three levels, timber boards, black/glass balustrade and stair relationships observed in July 2024 aerials',
         'sourceIds':['courtyard'], 'photoIds':SOURCE_PHOTOS,
         'dimensions':'authored dimensions follow retained appearance anchor/levels; not a stair survey'})
    b=Batch(ctx,p);levels=[(-7,2.1,33.55),(-14,-9,32.5),(-21,-16,31.45)]
    for level,(v0,v1,h) in enumerate(levels):
        b.box(f,28.8,35.2,v0,v1,h-.25,h-.04,0x716D61)
        for i in range(43):
            u=28.815+i*.148
            b.box(f,u,min(u+.138,35.19),v0+.012,v1-.012,h-.04,h,
                  (0x9B9080,0x8F8372,0xA19685,0x948877)[i%4])
        # Skirt and timber retaining structure down to sampled terrain.
        for i in range(int(math.ceil((v1-v0)/.19))):
            v=v0+.02+i*.19;pt=f.P(35.15,v,25);g=ctx.ground(*pt[:2])+25
            b.box(f,35.15,35.25,v,min(v+.178,v1),min(g,h-.30)-.1,h-.12,0x555C4C if i%3 else 0x65664F)
        for u in (29.0,35.0):
            for v in (v0+.18,v1-.18):
                g=ctx.ground(*f.P(u,v,25)[:2])+25
                b.box(f,u-.105,u+.105,v-.105,v+.105,g-.15,h-.2,DARK)
        glass_railing(b,f,35.13,35.13,v0+.04,v1-.04,h)
        # Courtyard side has a real access gap on the lowest tier.
        if level==2:
            glass_railing(b,f,28.88,28.88,v0,-20.3,h)
            glass_railing(b,f,28.88,28.88,-17.7,v1,h)
        else:glass_railing(b,f,28.88,28.88,v0,v1,h)
        if level==2:glass_railing(b,f,28.88,35.13,v0,v0,h)
        if level>0:glass_railing(b,f,32.2,35.13,v1,v1,h)
        # Small, deliberately sparse terrace furniture: appearance props, no occupancy claim.
        for u,v in ((33.6,v0+(v1-v0)*.37),(30.5,v0+(v1-v0)*.74)):
            b.box(f,u-.58,u+.58,v-.38,v+.38,h+.72,h+.775,0x978A71)
            for du in (-.45,.45):
                for dv in (-.27,.27):b.box(f,u+du-.025,u+du+.025,v+dv-.025,v+dv+.025,h,h+.74,DARK)
            chair(b,f,u,v-.91,h-25,0)
            chair(b,f,u,v+.91,h-25,math.pi)
    # Stepped inter-level circulation; rails follow rise rather than stay horizontal.
    for i in range(2):
        upper=levels[i];lower=levels[i+1]
        count=6
        for s in range(count):
            va=upper[0]-s/3;vc=upper[0]-(s+1)/3;h=upper[2]-(s+1)*(upper[2]-lower[2])/count
            b.box(f,29,32.1,vc,va,h-.16,h,0x9F9585)
            b.box(f,29,32.1,vc,vc+.034,h,h+.022,0xB2A797)
        for u in (29.05,32.06):
            b.beam(f.P(u,upper[0],upper[2]+1),f.P(u,lower[1],lower[2]+1),.055,.06,DARK)
            for t in (0,.5,1):
                v=upper[0]+(lower[1]-upper[0])*t;h=upper[2]+(lower[2]-upper[2])*t
                b.box(f,u-.03,u+.03,v-.03,v+.03,h,h+1.02,DARK)
    # Entry stair runs westward, across the opening in lowest terrace rail.
    entry=f.P(26.9,-19,25);g=ctx.ground(*entry[:2])+25;top=31.45
    for i in range(7):
        u=26.9+i*1.9/7;h=g+(i+1)*(top-g)/7
        b.box(f,u,u+1.9/7,-20.3,-17.7,h-.17,h,0x9A9080)
    return b.flush()


def courtyard_details(ctx):
    src=next(x for x in ctx.model['facilities'] if x['id']=='lidingo-courtyard-putting-green-2019')
    ring=src['polygons'][0]['rings'][0]
    p=ctx.facility('clubhouse-green-kerb-and-rope',[],[p[:2] for p in ring],
        {'basis':'retained putting outline; curb and light rope boundary observed in exterior photos',
         'sourceIds':[src['id']], 'photoIds':['venuu-134'],
         'dimensions':'curb section and stake intervals estimated'},exclude_vegetation=False)
    ctx.import_parts(p,'courtyard',omit_parts=('terrace-deck','terrace-skirt','terrace-planks','terrace-handrail',
        'terrace-posts','terrace-supports','terrace-stairs','courtyard-access-stairs'))
    b=Batch(ctx,p)
    for a,c in zip(ring,ring[1:]):
        f=Frame(a,c);n=max(1,int(math.ceil(f.length/2.7)))
        for i in range(n):
            u0=i*f.length/n;u1=(i+1)*f.length/n
            xy=f.P(u0,0,0);z=ctx.ground(*xy[:2])+.10
            b.tube((xy[0],xy[1],z),(xy[0],xy[1],z+.54),.019,DARK,segments=10)
            previous=None
            for j in range(9):
                t=j/8;u=u0+(u1-u0)*t;pt=f.P(u,0,0)
                point=(pt[0],pt[1],ctx.ground(*pt[:2])+.60-.17*math.sin(math.pi*t))
                if previous:b.tube(previous,point,.013,0xDDDACE,segments=6)
                previous=point
    # Entrance wall sits on the mapped western hardstanding edge; gap is photo-estimated.
    entry=ctx.facility('clubhouse-courtyard-entrance',[],
        [[-61.8,80.8],[-60.0,80.8],[-59.7,99.8],[-61.0,100.0]],
        {'basis':'entrance pillars and west courtyard wall visible in 2020 exterior and 2024 aerial',
         'sourceIds':['lidingo-courtyard-hardstanding-2019'],
         'photoIds':['commons-Liding-Golfklubb-febr-2020-1-jpg','vikingaskeppet-2024-20240706_171448721_ios'],
         'dimensions':'wall centerline follows mapped courtyard boundary approximately; gap/pillar dimensions estimated'})
    e=Batch(ctx,entry)
    points=[(-60.86,81.9),(-61.18,87.1),(-61.26,90.6),(-60.2,99.7)]
    for a,c in ((points[0],points[1]),(points[2],points[3])):
        f=Frame(a,c);n=int(math.ceil(f.length/.7))
        for i in range(n):
            u0=i*f.length/n;u1=(i+1)*f.length/n
            g0=ctx.ground(*f.P(u0,0,0)[:2]);g1=ctx.ground(*f.P(u1,0,0)[:2]);g=(g0+g1)/2
            e.box(f,u0,u1,-.17,.17,min(g0,g1)-.06,g+1.0,WHITE)
            e.box(f,u0,u1,-.185,.185,g+.99,g+1.055,0x53635D)
            e.box(f,u0,u1,-.19,-.17,min(g0,g1)-.08,min(g0,g1)+.13,DARK)
    f=Frame(points[1],points[2])
    for i,(x,y) in enumerate((points[1],points[2])):
        g=ctx.ground(x,y);u=0 if i==0 else f.length
        e.box(f,u-.26,u+.26,-.26,.26,g-.10,g+2.05,WHITE)
        e.box(f,u-.27,u+.27,-.27,.27,g-.08,g+.22,DARK)
        e.box(f,u-.33,u+.33,-.33,.33,g+2.045,g+2.105,DARK)
        e.box(f,u-.29,u+.29,-.29,.29,g+2.10,g+2.14,0x66726E)
        # Circular plaques remain geometry; source emblems are not copied as pixels.
        e.tube(f.P(u,-.272,g+1.4),f.P(u,-.292,g+1.4),.19,0xD4C998,segments=48)
        e.tube(f.P(u,-.294,g+1.4),f.P(u,-.31,g+1.4),.17,0x273D43,segments=48)
    return b.flush()+e.flush()


def build(ctx):
    footprints={b['id']:b for b in ctx.model['buildingFootprints']}
    counts={
        'restaurant':restaurant(ctx,footprints['way/32262183']),
        'pavilion':low_building(ctx,footprints['way/32262176'],True),
        'annex':low_building(ctx,footprints['way/32262169'],False),
        'terrace':terrace(ctx,footprints['way/32262183']),
        'courtyard':courtyard_details(ctx),
    }
    return {'authoredTriangles':sum(counts.values()),'parts':counts,
            'sourceShells':'imported separately; retained measured roof/wall baseline',
            'evidence':'lidingobuild/facilities/web-reference.json'}
