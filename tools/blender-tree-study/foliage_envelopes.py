"""Connected, bounded canopy surfaces with a continuous foliage normal field."""
import math, random
from mathutils import Vector
from pine_meshes import Mesh

def rotate(v,yaw):
    return Vector((v.x*math.cos(yaw)-v.y*math.sin(yaw),v.x*math.sin(yaw)+v.y*math.cos(yaw),v.z))

def field(clumps):
    bounds=[]
    for c,r,seed,yaw in clumps:
        ext=Vector((abs(math.cos(yaw))*r.x+abs(math.sin(yaw))*r.y,abs(math.sin(yaw))*r.x+abs(math.cos(yaw))*r.y,r.z))
        bounds.append((c-ext,c+ext))
    lo=Vector(tuple(min(b[0][k] for b in bounds) for k in range(3)))
    hi=Vector(tuple(max(b[1][k] for b in bounds) for k in range(3)))
    centre=(lo+hi)*.5;radius=(hi-lo)*.5
    return {'centre':centre,'radius':radius,'clumps':clumps}

def reach(n,f):
    # Ray/ellipsoid intersections retain a tree's original crown outline.
    # A broad support volume fills the gaps between its former small clumps.
    end=.52
    for c,r,seed,yaw in f['clumps']:
        direction=rotate(Vector(tuple(n[k]*f['radius'][k] for k in range(3))),-yaw)
        offset=rotate(f['centre']-c,-yaw)
        a=sum((direction[k]/max(r[k],.08))**2 for k in range(3))
        b=2*sum(direction[k]*offset[k]/max(r[k],.08)**2 for k in range(3))
        cc=sum((offset[k]/max(r[k],.08))**2 for k in range(3))-1
        disc=b*b-4*a*cc
        if disc>=0:end=max(end,(-b+math.sqrt(disc))/(2*a))
    return .14+.80*end

def make_leafy_crown(clumps,tier,available,seed):
    """Overlapping, recessed interiors and a thick, irregular foliage volume."""
    mesh=Mesh();uv=[];rng=random.Random(seed);whole=field(clumps)
    # Middle-distance groups retain the same bounds with fewer solid interiors.
    limit=56 if tier=='hero' else 22
    if len(clumps)>limit:
        centres=[max(clumps,key=lambda c:c[0].z)[0]]
        while len(centres)<limit:
            centres.append(max(clumps,key=lambda p:min((p[0]-c).length_squared for c in centres))[0])
        groups=[[] for _ in centres]
        for item in clumps:
            groups[min(range(limit),key=lambda i:(item[0]-centres[i]).length_squared)].append(item)
        clumps=[(f['centre'],f['radius'],g[0][2],0.) for g in groups for f in [field(g)]]
    def normal_at(p,c,r):
        local=Vector(tuple((p[k]-c[k])/max(r[k],.1) for k in range(3))).normalized()
        broad=Vector(tuple((p[k]-whole['centre'][k])/max(whole['radius'][k],.1) for k in range(3))).normalized()
        return (local*.45+broad*.55+Vector((0,0,.12))).normalized()
    for c,r,phase,yaw in clumps:
        rows=[]
        for lat in [-math.pi/6,math.pi/6]:
            row=[]
            for k in range(6):
                a=k*math.tau/6
                n=Vector((math.cos(lat)*math.cos(a),math.cos(lat)*math.sin(a),math.sin(lat)))
                p=c+Vector(tuple(n[k]*r[k]*.43 for k in range(3)))
                row.append(mesh.vert(p,normal_at(p,c,r),(.95,.97,.93)));uv.append((.25,.25))
            rows.append(row)
        bottom=mesh.vert(c-Vector((0,0,r.z*.43)),normal_at(c-Vector((0,0,r.z)),c,r),(.95,.97,.93));uv.append((.25,.25))
        top=mesh.vert(c+Vector((0,0,r.z*.43)),normal_at(c+Vector((0,0,r.z)),c,r),(.95,.97,.93));uv.append((.25,.25))
        for j in range(6):
            n=(j+1)%6
            mesh.faces.extend([(bottom,rows[0][n],rows[0][j]),(top,rows[1][j],rows[1][n]),(rows[0][j],rows[0][n],rows[1][n],rows[1][j])])
    count=min((available-mesh.triangles())//2,(6900-len(mesh.positions))//4)
    for index,(c,r,phase,yaw) in enumerate(clumps):
        cards=count//len(clumps)+(index<count%len(clumps))
        for j in range(cards):
            z=1-2*(j+.5)/cards;a=j*2.39996323+phase
            direction=Vector((math.sqrt(1-z*z)*math.cos(a),math.sqrt(1-z*z)*math.sin(a),z))
            centre=c+Vector(tuple(direction[k]*r[k] for k in range(3)))*rng.uniform(.50,.89)
            face=Vector((rng.uniform(-1,1),rng.uniform(-1,1),rng.uniform(-1,1))).normalized()
            u=face.cross(Vector((0,0,1))).normalized();v=face.cross(u).normalized()
            size=math.sqrt(r.x*r.y)*(.62 if tier=='hero' else .76)*rng.uniform(.85,1.14)
            tile=rng.randrange(4);ids=[];pigment=rng.uniform(.92,1.05)
            for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                p=centre+(u*x*(1-.12*y)+v*y*1.13)*size
                ids.append(mesh.vert(p,normal_at(p,c,r),(pigment,pigment,pigment*.98)))
                uv.append(((tile%2+(x+1)/2)/2,(tile//2+(y+1)/2)/2))
            mesh.faces.append(tuple(ids))
    return mesh,uv

def make_canopy(clumps,tier,available,key,seed,height):
    if key=='bjork' and tier!='lite':
        centre=field(clumps)['centre']
        clumps=[(Vector((centre.x+(c.x-centre.x)*1.17,centre.y+(c.y-centre.y)*1.17,c.z)),Vector((r.x*.66,r.y*.66,r.z*1.08)),phase,yaw) for c,r,phase,yaw in clumps]
        return make_leafy_crown(clumps,tier,available,seed)
    mesh=Mesh();uv=[]
    if key=='tall':
        low=min(c.z for c,r,s,a in clumps);high=max(c.z for c,r,s,a in clumps)
        bands=[[] for _ in range(3)]
        for item in clumps:bands[min(2,int((item[0].z-low)/max(high-low,.1)*2.99))].append(item)
        fields=[field(b) for b in bands if b]
    else:fields=[field(clumps)]
    segs,rings={'hero':(16,10),'full':(10,6),'lite':(8,4)}[tier]
    if key=='gran':segs,rings={'hero':(16,24),'full':(12,14),'lite':(8,10)}[tier]
    def add(p,n,colour=(.97,.99,.95)):
        i=mesh.vert(p,n,colour);uv.append((.25,.25));return i
    if key=='gran':
        # A continuous tapered interior gives the spruce real crown density.
        rows=[]
        for j in range(rings):
            t=j/rings;z=height*(.135+.875*t)
            rad=height*.224*(1-t)**.84
            row=[]
            for k in range(segs):
                a=k*math.tau/segs;phase=t*math.tau*7+a*.32+.3
                scallop=(1+.18*math.cos(phase))*(1+.12*math.sin(a*5+t*13)+.05*math.sin(a*9-t*8))
                inset=1 if tier=='lite' else .93
                p=Vector((height*.018*t+math.cos(a)*rad*scallop*inset,math.sin(a)*rad*scallop*inset,z))
                n=Vector((math.cos(a),math.sin(a),.40+.30*math.sin(phase))).normalized()
                row.append(add(p,n))
            rows.append(row)
        bottom=add(Vector((0,0,height*.135)),Vector((0,0,-1)))
        top=add(Vector((height*.018,0,height*1.03)),Vector((0,0,1)))
        for j in range(segs):
            n=(j+1)%segs;mesh.faces.extend([(bottom,rows[0][n],rows[0][j]),(top,rows[-1][j],rows[-1][n])])
        for ar,br in zip(rows,rows[1:]):
            for j in range(segs):mesh.faces.append((ar[j],ar[(j+1)%segs],br[(j+1)%segs],br[j]))
    else:
      for f in fields:
        directions=[];values=[]
        for j in range(1,rings):
            lat=-math.pi/2+math.pi*j/rings
            row=[Vector((math.cos(lat)*math.cos(k*math.tau/segs),math.cos(lat)*math.sin(k*math.tau/segs),math.sin(lat))) for k in range(segs)]
            directions.append(row);values.append([reach(n,f) for n in row])
        # Smooth the envelope's radii, rather than averaging disjoint meshes.
        for _ in range(1):
            values=[[values[j][k]*.4+(values[j][(k-1)%segs]+values[j][(k+1)%segs]+values[max(0,j-1)][k]+values[min(len(values)-1,j+1)][k])*.15 for k in range(segs)] for j in range(len(values))]
        f['radials']=[[reach(Vector((0,0,-1)),f)]*segs]+values+[[reach(Vector((0,0,1)),f)]*segs]
        rows=[]
        for row,radials in zip(directions,values):
            rows.append([add(f['centre']+Vector(tuple(n[k]*f['radius'][k]*scale for k in range(3))),n) for n,scale in zip(row,radials)])
        bottom=add(f['centre']+Vector((0,0,-f['radius'].z*reach(Vector((0,0,-1)),f))),Vector((0,0,-1)))
        top=add(f['centre']+Vector((0,0,f['radius'].z*reach(Vector((0,0,1)),f))),Vector((0,0,1)))
        for j in range(segs):
            n=(j+1)%segs;mesh.faces.extend([(bottom,rows[0][n],rows[0][j]),(top,rows[-1][j],rows[-1][n])])
        for ar,br in zip(rows,rows[1:]):
            for j in range(segs):mesh.faces.append((ar[j],ar[(j+1)%segs],br[(j+1)%segs],br[j]))
    if tier=='lite':return mesh,uv
    core_tri=mesh.triangles()
    card_count=min(len(clumps)*34,(available-core_tri)//2,(6900-len(mesh.positions))//4)
    assert card_count>=0
    rng=random.Random(seed)
    card_index=0
    for index,(c,r,phase,yaw) in enumerate(clumps):
        cards=card_count//len(clumps)+(index<card_count%len(clumps))
        f=min(fields,key=lambda f:abs(c.z-f['centre'].z))
        for j in range(cards):
            card_index+=1
            a=card_index*2.39996323+seed
            z=2*((card_index*.754877666+seed*.13)%1)-1
            direction=Vector((math.sqrt(1-z*z)*math.cos(a),math.sqrt(1-z*z)*math.sin(a),z))
            if key=='gran':
                t=((card_index*.754877666)%1)**.85*.978
                phase=t*math.tau*7+a*.32+.3
                radial=height*.224*(1-t)**.84*(1+.18*math.cos(phase))*(1+.12*math.sin(a*5+t*13)+.05*math.sin(a*9-t*8))*rng.uniform(.94,1.06)
                centre=Vector((height*.018*t+math.cos(a)*radial,math.sin(a)*radial,height*(.135+.875*t)))
                surface_normal=Vector((math.cos(a),math.sin(a),.45)).normalized()
                centre+=surface_normal*height*.004
                size=height*(.025+.035*(1-t))*rng.uniform(.88,1.12)
            else:
                # Interpolate the connected surface and scatter directly on it.
                # Foliage cannot disappear inside the former independent clumps.
                lat=(math.asin(z)+math.pi/2)*rings/math.pi
                row=min(rings-1,int(lat));vlat=lat-row
                az=(a%math.tau)*segs/math.tau;col=int(az);uaz=az-col
                values=f['radials']
                r0=values[row][col]*(1-uaz)+values[row][(col+1)%segs]*uaz
                r1=values[row+1][col]*(1-uaz)+values[row+1][(col+1)%segs]*uaz
                radial=(r0*(1-vlat)+r1*vlat)*rng.uniform(1.015,1.045)
                centre=f['centre']+Vector(tuple(direction[k]*f['radius'][k]*radial for k in range(3)))
                surface_normal=direction
                size=math.sqrt(r.x*r.y)*(.64 if tier=='hero' else .82)*rng.uniform(.9,1.1)
            noise=Vector((rng.uniform(-1,1),rng.uniform(-1,1),rng.uniform(-1,1))).normalized()
            face=(surface_normal*.6+noise*.4).normalized()
            u=face.cross(Vector((0,0,1))).normalized();v=face.cross(u).normalized()
            tile=rng.randrange(4);ids=[];pigment=rng.uniform(.97,1.02)
            for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                p=centre+(u*x+v*y)*size
                if key=='gran':
                    az=math.atan2(p.y,p.x-height*.018*t)
                    normal=Vector((math.cos(az),math.sin(az),.40+.30*math.sin(phase))).normalized()
                else:
                    normal=Vector(tuple((p[k]-f['centre'][k])/max(f['radius'][k],.1) for k in range(3))).normalized()
                    nearest=min(clumps,key=lambda item:(item[0]-p).length_squared)
                    detail=Vector(tuple((p[k]-nearest[0][k])/max(nearest[1][k],.1) for k in range(3))).normalized()
                    normal=(normal*.70+detail*.27+face*.03).normalized()
                exposure=max(0,normal.z)
                colour=(pigment*(.98+.03*exposure),pigment,pigment*(1.01-.055*exposure))
                ids.append(mesh.vert(p,normal,colour));uv.append(((tile%2+(x+1)/2)/2,(tile//2+(y+1)/2)/2))
            mesh.faces.append(tuple(ids))
    return mesh,uv
