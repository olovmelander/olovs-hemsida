"""Bounded branch-shaped foliage for the spruce and a spreading silver birch."""
import math, random
from mathutils import Vector
from pine_meshes import Mesh
from foliage_envelopes import field, rotate

def birch_layout():
    rng=random.Random(5000);h=rng.uniform(12,20);tubes=[];clumps=[];pads=[]
    def tube(a,b,r0,r1):tubes.append((a,b,r0,r1))
    def tuft(c,r,phase):
        clumps.append((c,Vector(r),phase,0.));pads.append(c)
    base=Vector((0,0,0));bend=Vector((h*.025,h*.014,h*.19));fork=Vector((h*.01,0,h*.39))
    tube(base,bend,h*.026,h*.021);tube(bend,fork,h*.021,h*.016)
    for leader in range(3):
        az=leader*math.tau/3+.25
        out=Vector((math.cos(az),math.sin(az),0))
        top=fork+out*h*(.13+.018*leader)+Vector((0,0,h*(.56-.035*leader)))
        elbow=fork.lerp(top,.53)-out*h*.03+Vector((0,0,h*.04))
        tube(fork,elbow,h*.013,h*.009);tube(elbow,top,h*.009,h*.003)
        for j in range(4):
            f=.20+j*.20;b=fork.lerp(top,f)
            a=az+(-.85 if j%2 else .75)+rng.uniform(-.18,.18)
            direction=Vector((math.cos(a),math.sin(a),0));length=h*(.235-.12*f)*rng.uniform(.9,1.08)
            arch=b+direction*length*.62+Vector((0,0,h*.07))
            end=b+direction*length+Vector((0,0,h*.025))
            tube(b,arch,h*.0078,h*.0048);tube(arch,end,h*.0048,h*.0018)
            hanging=end+direction*h*.025-Vector((0,0,h*.115))
            tube(end,hanging,h*.0032,h*.0008)
            phase=5000+leader*100+j*7
            tuft(arch+Vector((0,0,h*.016)),(h*.088,h*.084,h*.077),phase)
            tuft(end-Vector((0,0,h*.032)),(h*.078,h*.071,h*.091),phase+1)
            tuft(hanging+Vector((0,0,h*.018)),(h*.054,h*.050,h*.098),phase+2)
        tuft(top-Vector((0,0,h*.006)),(h*.088,h*.085,h*.106),5300+leader)
    return h,tubes,clumps,pads

def spruce_layout():
    rng=random.Random(10000);h=rng.uniform(12,24);tubes=[];clumps=[];pads=[]
    tubes.append((Vector((0,0,0)),Vector((h*.02,0,h*.99)),h*.024,h*.0018))
    # Staggered whorls and broad drooping tips make the silhouette visibly branchy.
    levels=[(.18,.235),(.285,.25),(.40,.207),(.505,.19),(.615,.145),(.73,.124),(.835,.092),(.93,.053)]
    for level,(z,width) in enumerate(levels):
        number=6 if level<5 else 5
        for j in range(number):
            a=j*math.tau/number+level*1.19+rng.uniform(-.24,.24)
            length=h*width*rng.uniform(.82,1.13)
            b=Vector((h*.02*z,0,h*z+rng.uniform(-.015,.015)*h))
            direction=Vector((math.cos(a),math.sin(a),0))
            elbow=b+direction*length*.55-Vector((0,0,h*.034))
            end=b+direction*length-Vector((0,0,h*(.036+.021*(1-z))))
            tubes.append((b,elbow,h*.0068*(1-z*.65),h*.0035))
            tubes.append((elbow,end,h*.0035,h*.0012))
            c=b.lerp(end,.62)+Vector((0,0,h*.014))
            clumps.append((c,Vector((length*.61,length*.28,h*(.046+.027*z))),10000+level*31+j,a))
            pads.append(c)
        # Small centres join neighbouring boughs without a continuous cone shell.
        clumps.append((Vector((h*.02*z,0,h*z)),Vector((h*width*.34,h*width*.34,h*.083)),10800+level,0.))
    clumps.append((Vector((h*.02,0,h*.98)),Vector((h*.025,h*.025,h*.063)),10999,0.))
    return h,tubes,clumps,pads

def grouped(clumps,limit):
    if len(clumps)<=limit:return clumps
    centres=[max(clumps,key=lambda p:p[0].z)[0]]
    while len(centres)<limit:
        centres.append(max(clumps,key=lambda p:min((p[0]-c).length_squared for c in centres))[0])
    groups=[[] for _ in centres]
    for item in clumps:groups[min(range(limit),key=lambda i:(item[0]-centres[i]).length_squared)].append(item)
    return [(f['centre'],f['radius'],g[0][2],0.) for g in groups for f in [field(g)]]

def make_branch_canopy(clumps,tier,available,key,seed,height):
    mesh=Mesh();uv=[];whole=field(clumps);rng=random.Random(seed)
    if tier=='full':clumps=grouped(clumps,24 if key=='gran' else 19)
    if tier=='lite':clumps=grouped(clumps,min(18,available//16))
    sides=4 if tier=='lite' else 6
    core_scale=.87 if tier=='lite' else .64
    def normal_at(p,c,r,yaw):
        q=rotate(p-c,-yaw)
        local=rotate(Vector(tuple(q[k]/max(r[k],.08) for k in range(3))).normalized(),yaw)
        broad=Vector(tuple((p[k]-whole['centre'][k])/max(whole['radius'][k],.1) for k in range(3))).normalized()
        local_weight=.67 if key=='gran' else .48
        return (local*local_weight+broad*(1-local_weight)+Vector((0,0,.20))).normalized()
    for c,r,phase,yaw in clumps:
        rows=[]
        for lat in [-math.pi/6,math.pi/6]:
            row=[]
            for k in range(sides):
                a=k*math.tau/sides;n=Vector((math.cos(lat)*math.cos(a),math.cos(lat)*math.sin(a),math.sin(lat)))
                p=c+rotate(Vector(tuple(n[k]*r[k]*core_scale for k in range(3))),yaw)
                row.append(mesh.vert(p,normal_at(p,c,r,yaw),(.95,.97,.94)));uv.append((.25,.25))
            rows.append(row)
        bottom=mesh.vert(c-Vector((0,0,r.z*core_scale)),normal_at(c-Vector((0,0,r.z)),c,r,yaw),(.95,.97,.94));uv.append((.25,.25))
        top=mesh.vert(c+Vector((0,0,r.z*core_scale)),normal_at(c+Vector((0,0,r.z)),c,r,yaw),(.95,.97,.94));uv.append((.25,.25))
        for j in range(sides):
            n=(j+1)%sides
            mesh.faces.extend([(bottom,rows[0][n],rows[0][j]),(top,rows[1][j],rows[1][n]),(rows[0][j],rows[0][n],rows[1][n],rows[1][j])])
    if tier=='lite':return mesh,uv
    count=min((available-mesh.triangles())//2,(6900-len(mesh.positions))//4)
    weights=[(r.x*r.y+r.x*r.z+r.y*r.z)**.65 for c,r,phase,yaw in clumps]
    minimum=8 if tier=='hero' else 3
    assert count>=len(clumps)*minimum
    spare=count-len(clumps)*minimum;total=sum(weights)
    allocation=[minimum+int(spare*w/total) for w in weights]
    for i in range(count-sum(allocation)):allocation[i%len(clumps)]+=1
    for (c,r,phase,yaw),cards in zip(clumps,allocation):
        for j in range(cards):
            z=1-2*(j+.5)/cards;a=j*2.39996323+phase
            direction=Vector((math.sqrt(1-z*z)*math.cos(a),math.sqrt(1-z*z)*math.sin(a),z))
            centre=c+rotate(Vector(tuple(direction[k]*r[k] for k in range(3))),yaw)*rng.uniform(.48,.85)
            face=Vector((rng.uniform(-1,1),rng.uniform(-1,1),rng.uniform(-1,1))).normalized()
            u=face.cross(Vector((0,0,1))).normalized();v=face.cross(u).normalized()
            size=math.sqrt(r.x*r.y)*(.60 if tier=='hero' else .77)*rng.uniform(.88,1.13)
            tile=rng.randrange(4);pigment=rng.uniform(.94,1.05);ids=[]
            for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                p=centre+(u*x+v*y*(1.13 if key=='bjork' else 1))*size
                ids.append(mesh.vert(p,normal_at(p,c,r,yaw),(pigment,pigment,pigment*.98)))
                uv.append(((tile%2+(x+1)/2)/2,(tile//2+(y+1)/2)/2))
            mesh.faces.append(tuple(ids))
    assert mesh.triangles()<=available
    return mesh,uv
