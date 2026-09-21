"""Kronholmen martall silhouettes: rooted wood, open scaffolds, swept needle fans.

Coordinates are authored proportions, not surveyed specimen measurements.
The four habits have independent skeletons; all tiers share the same skeleton.
"""
import math, random
from mathutils import Vector
from pine_meshes import Mesh, catmull, linear
from branch_canopies import grouped

NAMES = ['Vindpinad tall', 'Krokig flerstammig martall', 'Låg kustmartall', 'Öppen skärmtall']
PALETTE = [0x182e27, 0x385343, 0x738368]


def layout(index):
    paths, pads = [], []
    def wood(points, r0, r1, detail=0, dead=False):
        path = [Vector(p) for p in points]
        paths.append((path, r0, r1, detail, dead))
        return path
    # The hero's low fork and long leeward arm follow the club's 465 photograph.
    if index == 0:
        stem = wood([(0,0,0),(.28,.04,.65),(.92,-.06,1.65),(1.58,.08,2.55),(2.32,.0,3.35)],.48,.27)
        leaders = [wood([stem[-1],(2.63,.13,4.18),(2.62,.2,5.05),(3.35,.08,6.12)],.27,.08),
                   wood([stem[-2],(2.85,-.18,3.5),(4.14,-.22,4.3),(5.55,-.08,4.78),(6.85,.0,4.73)],.25,.07),
                   wood([stem[-1],(1.72,.23,4.04),(.92,.4,4.8),(.08,.55,5.12)],.19,.05)]
        ends = [(0,1,(-1.5,.2,4.45),1.13),(2,2,(-.85,-.45,5.45),1.28),
                (0,2,(1.1,.15,6.2),1.38),(0,3,(2.7,.0,6.8),1.30),
                (0,3,(4.35,.2,6.5),1.45),(1,2,(5.4,-.25,5.8),1.34),
                (1,3,(6.8,.05,5.25),1.31),(1,4,(8.35,.15,4.15),1.18),
                (0,2,(2.3,-2.15,5.45),1.20),(1,2,(4.7,-2.1,4.85),1.16),
                (0,2,(2.25,2.1,5.8),1.25),(1,3,(5.35,1.95,5.25),1.24)]
    elif index == 1:
        stem = wood([(0,0,0),(.25,-.1,1.0),(-.05,.12,2.02),(.6,.05,2.85)],.52,.31)
        leaders = [wood([stem[-1],(-.65,.0,3.7),(-.85,.1,4.65),(-1.8,.0,5.15),(-2.5,.2,5.6)],.27,.07),
                   wood([stem[-1],(1.8,.3,3.6),(2.4,.24,4.7),(1.95,.1,5.5),(2.6,.2,6.65)],.31,.07),
                   wood([stem[1],(.05,1.1,2.3),(.95,1.7,3.4),(.6,1.9,4.9),(1.3,1.85,6.2)],.23,.06)]
        ends = [(0,2,(-3.25,-.2,5.2),1.10),(0,3,(-2.65,.4,6.0),1.18),
                (0,4,(-1.3,-.25,6.45),1.20),(1,2,(3.8,-.25,5.55),1.15),
                (1,3,(4.25,.2,6.7),1.24),(1,4,(2.9,.1,7.25),1.30),
                (1,4,(1.25,-.45,7.4),1.14),(2,3,(.0,2.75,5.8),1.15),
                (2,4,(2.8,2.2,6.6),1.20),(0,2,(-2.2,-1.8,5.0),1.04),
                (1,2,(2.2,-2.0,5.5),1.04)]
    elif index == 2:
        stem = wood([(0,0,0),(.24,.02,.72),(1.1,-.14,1.55),(2.3,.1,2.35),(3.6,.16,2.78)],.42,.21)
        leaders = [wood([stem[-2],(3.1,.08,3.2),(4.2,.12,3.55),(5.8,.15,3.6)],.20,.065),
                   wood([stem[2],(1.8,-.3,2.5),(2.0,-.15,3.45),(2.8,-.05,3.95)],.17,.05),
                   wood([stem[-1],(4.2,.75,2.7),(5.2,1.05,2.6),(6.3,1.25,3.2)],.13,.04)]
        ends = [(1,2,(1.75,-.1,4.15),1.1),(1,3,(3.15,-.25,4.4),1.22),
                (0,2,(4.65,.1,4.3),1.31),(0,3,(6.25,.05,4.02),1.24),
                (0,3,(7.85,.0,3.78),1.18),(2,3,(7.0,1.25,3.1),1.0),
                (1,1,(2.2,-1.6,3.25),.96),(0,1,(4.1,-1.55,3.7),1.16),
                (0,2,(5.85,-1.65,3.42),1.12),(2,1,(4.15,1.7,3.55),1.13)]
    else:
        stem = wood([(0,0,0),(-.15,.06,1.3),(.2,.0,2.7),(.05,.13,3.8),(.62,.15,4.6)],.46,.26)
        leaders = [wood([stem[-1],(.3,.1,5.45),(1.0,.0,6.2),(.8,.2,7.2)],.23,.065),
                   wood([stem[-2],(-1.15,-.05,4.1),(-2.1,.0,4.7),(-2.6,.1,5.6)],.20,.06),
                   wood([stem[-1],(1.7,.2,4.6),(2.7,.15,5.05),(3.8,.25,5.85)],.21,.06)]
        ends = [(1,2,(-3.9,.1,5.5),1.24),(1,3,(-2.7,.05,6.35),1.34),
                (0,1,(-1.15,.0,6.7),1.2),(0,2,(.15,.0,7.25),1.22),
                (0,3,(1.65,.2,7.55),1.25),(2,2,(2.65,.1,6.7),1.22),
                (2,3,(4.35,.15,6.2),1.27),(1,1,(-1.8,-2.25,5.5),1.08),
                (0,1,(.5,-2.0,6.2),1.13),(2,2,(3.05,-1.85,5.8),1.14),
                (0,2,(.1,2.05,6.65),1.2),(2,1,(2.45,2.05,5.6),1.13)]
    rng = random.Random(21900 + index * 101)
    for j,(leader,k,target,size) in enumerate(ends):
        root = leaders[leader][k]
        tip = Vector(target)
        elbow = root.lerp(tip,.60) + Vector((-.12,.10*math.sin(j),-.25))
        wood([root,elbow,tip],.09 if j<7 else .075,.018,1)
        # Uneven, thin foliage fans stay at branch ends. Smaller offset fans
        # interrupt the edge without closing the large windows in the skeleton.
        pad = tip + Vector((.12,0,.13))
        # Broad overlapping top on the hero; larger crown windows on the
        # contorted and umbrella forms. Unequal fans avoid a row of pom-poms.
        spread = 1.17 if index==0 and j in (2,3,4,5,6,8,10,11) else 1.04
        radii = Vector((size*spread,size*.78,size*(.35 if index==2 else .46)))
        pads.append((pad,radii,21900+index*100+j,.07*math.sin(j)))
        if j%3 != 1:
            fork = tip + Vector((.55,(-1 if j%2 else 1)*.48,-.18))
            wood([elbow,tip.lerp(fork,.6),fork],.045,.009,2)
            pads.append((fork+Vector((.08,0,.16)),radii*.65,22900+index*100+j,.12))
        # Bare hooked twigs below the needle-bearing ends.
        if j%2 == 0:
            a = elbow.lerp(tip,.35)
            b = a + Vector((.4,-.20,-.4))
            wood([a,b,b+Vector((.35,.07,-.12))],.028,.004,2,True)
    # Trunk-attached broken branches: pale weathered ends, no floating sticks.
    a=stem[2]
    wood([a,a+Vector((-.42,-.4,.1)),a+Vector((-.85,-.55,.02))],.074,.026,1,True)
    if index==0:
        # The club specimen has a substantial, broken canopy body above the
        # low fork, not an evenly trimmed arch of separate terminal pads.
        for j,(target,radii) in enumerate([
            ((3.65,-.55,5.25),(1.25,.92,.80)),
            ((5.45,.65,4.60),(1.30,.90,.70)),
            ((.25,.10,4.20),(1.12,.82,.62)),
        ]):
            tip=Vector(target);root=leaders[1 if j<2 else 2][1]
            wood([root,root.lerp(tip,.65)-Vector((0,0,.16)),tip],.075,.012,1)
            pads.append((tip,Vector(radii),23900+j,.1))
    return paths,pads


def woody_mesh(paths,tier,original_colours=False):
    mesh=Mesh()
    for index,(path,r0,r1,detail,dead) in enumerate(paths):
        if tier=='lite' and detail>0:continue
        if tier=='full' and detail>1:continue
        steps=3 if tier=='hero' and detail==0 else 2 if tier=='hero' else 1
        points=catmull(path,steps)
        sides=(16 if r0>.3 else 10 if r0>.15 else 5 if detail<2 else 3) if tier=='hero' else (6 if r0>.2 else 4) if tier=='full' else 4
        if tier=='lite':points=[points[0],points[len(points)//2],points[-1]]
        rows=[]
        for k,c in enumerate(points):
            t=k/(len(points)-1)
            axis=(points[min(k+1,len(points)-1)]-points[max(0,k-1)]).normalized()
            ref=Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0))
            u=axis.cross(ref).normalized();v=axis.cross(u).normalized()
            radius=r0*(1-t)**.85+r1*t
            radius*=1+.30*math.exp(-max(0,c.z)*4)
            row=[]
            for j in range(sides):
                angle=math.tau*j/sides+.11*math.sin(c.z*1.5+index)
                n=u*math.cos(angle)+v*math.sin(angle)
                ridge=1+.10*math.sin(angle*5+c.z*.9)+.045*math.sin(angle*3-c.z*1.7)
                p=c+n*radius*ridge;p.z=max(0,p.z)
                warm=max(0,min(.68,(p.z-3.5)/5))
                low,high=linear(0x514b40),linear(0x99765a)
                grain=.72+.28*(.5+.5*math.sin(angle*5+c.z*.7))
                if dead:low,high=linear(0x776f5e),linear(0x9a907b)
                if original_colours:
                    # The previous Visby model's bark ramp and pigment strength.
                    warm=max(0,min(.75,(p.z-2.5)/6))
                    low,high=linear(0x605a49),linear(0xaa8056)
                    grain=.82+.18*math.sin(angle*3+p.z*.8)**2
                colour=tuple((a+(b-a)*warm)*grain for a,b in zip(low,high))
                row.append(mesh.vert(p,n,colour))
            rows.append(row)
        for a,b in zip(rows,rows[1:]):
            for j in range(sides):mesh.faces.append((a[j],a[(j+1)%sides],b[(j+1)%sides],b[j]))
        mesh.faces.extend([tuple(reversed(rows[0])),tuple(rows[-1])])
        if tier=='hero' and r0>.2:
            # Broken bark plates lie on the wood surface. Geometry and vertex
            # pigment survive the geometry-only GLB and distant atlas bake.
            for k in range(len(rows)-1):
                for j in range(0,sides,2):
                    if (k*7+j*3+index)%5==0:continue
                    n=(j+1)%sides
                    a,b=Vector(mesh.positions[rows[k][j]]),Vector(mesh.positions[rows[k][n]])
                    c,d=Vector(mesh.positions[rows[k+1][j]]),Vector(mesh.positions[rows[k+1][n]])
                    normal=Vector(mesh.normals[rows[k][j]])
                    shift=.13+.08*math.sin(k*2.4+j)
                    low=a.lerp(b,shift);high=c.lerp(d,shift+.10)
                    along=high-low
                    width=(b-a)*(.09 if j%4 else .17)
                    offset=normal*.013
                    col=linear(0x35332d if (k+j)%3 else 0x817661)
                    if original_colours:
                        col=linear(0x605a49 if (k+j)%3 else 0xaa8056)
                    ids=[]
                    for p in (low+along*.12,low+along*.23+width,high-along*.06+width*.5,high-along*.03):
                        q=p+offset;q.z=max(0,q.z)
                        ids.append(mesh.vert(q,normal,col))
                    mesh.faces.append(tuple(ids))
    return mesh


def canopy(pads,tier,available,seed,original_colours=False):
    mesh=Mesh();uv=[];rng=random.Random(seed)
    if tier=='lite':pads=grouped(pads,min(14,available//16))
    # Small solid hearts stop the crown disappearing at grazing angles.
    # Outside them, individually oriented sprays establish the foliage edge.
    sides=4 if tier=='lite' else 5
    def normal(p,c,r):
        local=Vector(((p.x-c.x)/r.x,(p.y-c.y)/r.y,(p.z-c.z)/r.z)).normalized()
        return (local+Vector((0,0,.22))).normalized()
    for c,r,phase,yaw in pads:
        rows=[];scale=.84 if tier=='lite' else .54
        for z in [-.48,.48]:
            row=[]
            for j in range(sides):
                a=j*math.tau/sides
                p=c+Vector((math.cos(a)*r.x*.87,math.sin(a)*r.y*.87,r.z*z))*scale
                row.append(mesh.vert(p,normal(p,c,r),(.95,.97,.94) if original_colours else (.90,.93,.91)));uv.append((.25,.25))
            rows.append(row)
        bottom=mesh.vert(c-Vector((0,0,r.z*scale)),(0,0,-1),(.95,.97,.94) if original_colours else (.86,.90,.88));uv.append((.25,.25))
        top=mesh.vert(c+Vector((0,0,r.z*scale)),(0,0,1),(.95,.97,.94) if original_colours else (.95,.97,.95));uv.append((.25,.25))
        for j in range(sides):
            n=(j+1)%sides
            mesh.faces.extend([(bottom,rows[0][n],rows[0][j]),(top,rows[1][j],rows[1][n]),(rows[0][j],rows[0][n],rows[1][n],rows[1][j])])
    if tier=='lite':return mesh,uv
    count=min((available-mesh.triangles())//2,(6900-len(mesh.positions))//4)
    assert count>=len(pads)*5,(tier,available,len(pads),count)
    weights=[r.x*r.y for c,r,_,_ in pads];total=sum(weights)
    allocation=[5+int((count-len(pads)*5)*w/total) for w in weights]
    for i in range(count-sum(allocation)):allocation[i%len(pads)]+=1
    for (c,r,phase,yaw),number in zip(pads,allocation):
        for j in range(number):
            z=1-2*(j+.5)/number;a=j*2.39996323+phase
            radial=Vector((math.sqrt(1-z*z)*math.cos(a),math.sqrt(1-z*z)*math.sin(a),z))
            centre=c+Vector(tuple(radial[k]*r[k] for k in range(3)))*rng.uniform(.45,.92)
            # All terminal shoots reach upward and leeward; azimuth variation
            # and depth-facing fans keep a full 3D crown when orbiting.
            v=Vector((rng.uniform(.25,.6),rng.uniform(-.30,.30),rng.uniform(.6,1))).normalized()
            face=Vector((math.cos(a),math.sin(a),rng.uniform(-.4,.4)))
            u=v.cross(face).normalized()
            scale=math.sqrt(r.x*r.y)*(.43 if tier=='hero' else .65)*rng.uniform(.82,1.18)
            tile=rng.randrange(4);pigment=rng.uniform(.94,1.05) if original_colours else rng.uniform(.88,1.04);ids=[]
            for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                p=centre+u*x*scale*.72+v*y*scale
                ids.append(mesh.vert(p,normal(p,c,r),(pigment if original_colours else pigment*.97,pigment,pigment*.98)))
                uv.append(((tile%2+(x+1)/2)/2,(tile//2+(y+1)/2)/2))
            mesh.faces.append(tuple(ids))
    assert mesh.triangles()<=available
    return mesh,uv
