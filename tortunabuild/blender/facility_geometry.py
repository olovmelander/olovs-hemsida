"""Measured roof planes and photo-informed architectural detail for facilities.

Local coordinates are each building's u/v metres and absolute RH2000. Convex
roof patches are cut at real intersections; the T-shaped house retains its
unbuilt corners instead of becoming a rectangular block.
"""
import math
from architecture import Architecture


class FacilityGeometry(Architecture):
    def __init__(self, collection, row):
        f=row['frame']
        super().__init__(collection,f['anchorEpsg3006RH2000'],f['originEpsg3006'],f['uAxis'],f['vAxis'])
        self.row=row
        self.prefix='Tortuna facility | '+row['label']+' | '

    def material(self,name,color,roughness=.8,metallic=0):
        super().material(name,color,roughness,metallic)
        self.materials[name].name=self.prefix+name

    def build(self):
        objects=super().build()
        for obj in objects:
            suffix=obj.data.materials[0].name.removeprefix(self.prefix)
            obj.name=self.prefix+suffix
            obj.data.name=self.prefix+suffix
        return objects

    def roof(self,vertices,material='Roof tile',seams=True):
        self.face(vertices,material)
        if not seams:return
        # Use one height grid per measured plane, so clipping a roof into
        # convex pieces cannot move the tile courses at internal cut lines.
        p,q,r=vertices[:3]
        a=(q[0]-p[0],q[1]-p[1],q[2]-p[2]);b=(r[0]-p[0],r[1]-p[1],r[2]-p[2])
        normal=(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
        length=math.sqrt(sum(n*n for n in normal))
        if length<1e-8:return
        pitch=abs(normal[2])/length;step=max(.065,.34*math.sqrt(max(0,1-pitch*pitch)))
        low=min(p[2] for p in vertices);high=max(p[2] for p in vertices)
        for i in range(math.floor(low/step)+1,math.ceil(high/step)):
            z=i*step;hits=[]
            for a,b in zip(vertices,vertices[1:]+vertices[:1]):
                if (a[2]<=z<b[2]) or (b[2]<=z<a[2]):
                    t=(z-a[2])/(b[2]-a[2]);hits.append(tuple(a[j]+t*(b[j]-a[j])+(.012 if j==2 else 0) for j in range(3)))
            if len(hits)==2 and math.dist(*hits)>.02:self.beam(*hits,.024,'Tile course')


def plane_at(plane,u,v):
    a,b,c=plane
    return a*u+b*v+c


def clip(poly,a,b,c):
    result=[]
    for p,q in zip(poly,poly[1:]+poly[:1]):
        dp=a*p[0]+b*p[1]+c; dq=a*q[0]+b*q[1]+c
        if dp>=-1e-7: result.append(p)
        if (dp>1e-7 and dq < -1e-7) or (dp < -1e-7 and dq>1e-7):
            t=dp/(dp-dq)
            result.append((p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])))
    return result


def area(poly):
    return abs(sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(poly,poly[1:]+poly[:1])))/2


def subtract(poly,cut):
    # Both polygons are convex and cut is counterclockwise.
    out=[]; inside=poly
    for p,q in zip(cut,cut[1:]+cut[:1]):
        a=p[1]-q[1]; b=q[0]-p[0]; c=-a*p[0]-b*p[1]
        outside=clip(inside,-a,-b,-c)
        if len(outside)>=3 and area(outside)>1e-7: out.append(outside)
        inside=clip(inside,a,b,c)
        if len(inside)<3: break
    return out


def rectangle(u0,u1,v0,v1):
    return [(u0,v0),(u1,v0),(u1,v1),(u0,v1)]


def gable_patches(rect,planes,ridge_axis='u'):
    u0,u1,v0,v1=rect
    domain=rectangle(u0,u1,v0,v1)
    p,q=planes
    # A gable roof is the lower envelope of its two opposing planes.
    return [(clip(domain,*(q[i]-p[i] for i in range(3))),p),
            (clip(domain,*(p[i]-q[i] for i in range(3))),q)]


def envelope_patches(patches):
    visible=[]
    for index,(poly,plane) in enumerate(patches):
        parts=[poly]
        for other_index,(other,other_plane) in enumerate(patches):
            if other_index==index: continue
            delta=[other_plane[i]-plane[i] for i in range(3)]
            # Equal planes are allowed in adjoining domains, not subtracted twice.
            if max(abs(n) for n in delta)<1e-8: continue
            cut=clip(other,*delta)
            if len(cut)<3 or area(cut)<1e-7: continue
            parts=[piece for part in parts for piece in subtract(part,cut)]
        visible.extend((p,plane) for p in parts if len(p)>=3 and area(p)>1e-7)
    return visible


def contains(poly,u,v):
    return all((q[0]-p[0])*(v-p[1])-(q[1]-p[1])*(u-p[0])>=-1e-6
               for p,q in zip(poly,poly[1:]+poly[:1]))


def roof_height(patches,u,v):
    heights=[plane_at(p,u,v) for poly,p in patches if contains(poly,u,v)]
    if not heights: raise ValueError(f'Wall outside roof at {u},{v}')
    return max(heights)


def trim_window(A,opening,base):
    A.window((opening['u'],opening['v'],base+opening['sill']),opening['width'],opening['height'],
             axis=opening.get('axis','v'),sign=opening.get('sign',1),door=opening.get('type')=='glazed-door')


def panel(A,o,base):
    u,v=o['u'],o['v']; width=o['width']; height=o['height']; axis=o.get('axis','v'); sign=o.get('sign',1)
    z=base+o.get('sill',.12)
    def point(t,d,h):
        return (u+t,v+sign*d,z+h) if axis=='v' else (u+sign*d,v+t,z+h)
    mat='White trim' if o.get('type') in ('white-door','white-panel') else 'Door panel'
    A.face([point(-width/2,.045,0),point(width/2,.045,0),point(width/2,.045,height),point(-width/2,.045,height)],mat)
    for t in (-width/2,width/2): A.beam(point(t,.07,0),point(t,.07,height),.10,'White trim')
    A.beam(point(-width/2,.07,height),point(width/2,.07,height),.1,'White trim')
    if o.get('double',False): A.beam(point(0,.075,0),point(0,.075,height),.04,'Metal')
    if o.get('brace',False):
        A.beam(point(-width/2+.15,.075,.15),point(width/2-.15,.075,height-.15),.08,'Door panel')
    A.features['panels' if o.get('type')=='white-panel' else 'doors']+=1


def open_bay(A,o,base):
    u,v=o['u'],o['v'];w=o['width'];h=o['height'];sign=o.get('sign',1);axis=o.get('axis','v')
    bottom=base+o.get('sill',.06);depth=o.get('depth',1.6)
    def p(t,d,z):return (u+t,v+sign*d,bottom+z) if axis=='v' else (u+sign*d,v+t,bottom+z)
    for t in [-w/2,w/2]:
        A.face([p(t,.02,0),p(t,-depth,0),p(t,-depth,h),p(t,.02,h)],'Timber')
        A.beam(p(t,.07,0),p(t,.07,h),.14,'White trim')
    A.face([p(-w/2,-depth,0),p(w/2,-depth,0),p(w/2,-depth,h),p(-w/2,-depth,h)],'Interior shadow')
    A.face([p(-w/2,.02,h),p(w/2,.02,h),p(w/2,-depth,h),p(-w/2,-depth,h)],'Interior shadow')
    A.face([p(-w/2,.02,0),p(w/2,.02,0),p(w/2,-depth,0),p(-w/2,-depth,0)],'Foundation')
    A.beam(p(-w/2,.07,h),p(w/2,.07,h),.14,'White trim')
    A.features['recessedBays']+=1


def closed_building(A,row,appearance):
    body=row['body']; roof=row['roof']; base=body['baseRH2000']
    components=row.get('bodyComponents')
    if components:
        patches=[]
        for component in components:
            rect=[component['roofBoundsUV'][k] for k in ('uMin','uMax','vMin','vMax')]
            planes=[roof['planes'][i]['coefficients'] for i in component['roofPlaneIndices']]
            patches.extend(gable_patches(rect,planes))
        boundary=row['wallOutlineUV']
    else:
        rect=[roof[k] for k in ('eaveUMin','eaveUMax','eaveVMin','eaveVMax')]
        patches=[(rectangle(*rect),roof['planes'][0]['coefficients'])] if roof['type']=='shed' else gable_patches(rect,[p['coefficients'] for p in roof['planes'][:2]])
        boundary=rectangle(*[body[k] for k in ('uMin','uMax','vMin','vMax')])
    patches=envelope_patches(patches)
    # Exact architectural edge faces, with split points at every roof intersection.
    for a,b in zip(boundary,boundary[1:]+boundary[:1]):
        cuts={0.,1.}
        for poly,plane in patches:
            for p,q in zip(poly,poly[1:]+poly[:1]):
                aa=p[1]-q[1];bb=q[0]-p[0];cc=-aa*p[0]-bb*p[1]
                d0=aa*a[0]+bb*a[1]+cc;d1=aa*b[0]+bb*b[1]+cc
                if abs(d0-d1)>1e-9:
                    t=d0/(d0-d1)
                    if 0<t<1:cuts.add(t)
        steps=sorted(cuts)
        for t0,t1 in zip(steps,steps[1:]):
            p=(a[0]+t0*(b[0]-a[0]),a[1]+t0*(b[1]-a[1]))
            q=(a[0]+t1*(b[0]-a[0]),a[1]+t1*(b[1]-a[1]))
            hp=roof_height(patches,*p);hq=roof_height(patches,*q)
            A.face([(*p,base-.45),(*q,base-.45),(*q,base+.25),(*p,base+.25)],'Foundation')
            wall=[(t0,base+.25),(t1,base+.25),(t1,hq),(t0,hp)]
            parts=[wall]
            for opening in appearance.get('openings',[]):
                if opening.get('type')!='open-bay':continue
                axis=opening.get('axis','v');j=1 if axis=='v' else 0;k=1-j
                if abs(a[j]-b[j])>.01 or abs(a[j]-opening['v' if axis=='v' else 'u'])>.08:continue
                center=opening['u' if axis=='v' else 'v'];width=opening['width']
                ends=sorted([(center-width/2-a[k])/(b[k]-a[k]),(center+width/2-a[k])/(b[k]-a[k])])
                cut=rectangle(ends[0],ends[1],base+opening.get('sill',.06),base+opening.get('sill',.06)+opening['height'])
                parts=[piece for part in parts for piece in subtract(part,cut)]
            for part in parts:A.face([(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),z) for t,z in part],'Timber')
        A.beam((*a,base+.27),(*b,base+.27),.09,'White trim')
        A.beam((*a,base+.25),(*a,roof_height(patches,*a)-.12),.13,'White trim')
        # Vertical boards stop at openings and follow gables to their roof line.
        length=math.dist(a,b); n=max(1,int(length/.23))
        normal=((b[1]-a[1])/length,-(b[0]-a[0])/length)
        for i in range(1,n):
            u=a[0]+i/n*(b[0]-a[0]);v=a[1]+i/n*(b[1]-a[1])
            low=base+.33;high=roof_height(patches,u,v)-.17
            intervals=[(low,high)]
            for o in appearance.get('openings',[]):
                axis=o.get('axis','v'); normal_coord=v if axis=='v' else u
                normal_target=o['v'] if axis=='v' else o['u']
                along=u if axis=='v' else v; target=o['u'] if axis=='v' else o['v']
                if abs(normal_coord-normal_target)<.08 and abs(along-target)<o['width']/2+.1:
                    bottom=base+o.get('sill',.12)-.13;top=base+o.get('sill',.12)+o['height']+.13
                    intervals=[part for lo,hi in intervals for part in [(lo,min(hi,bottom)),(max(lo,top),hi)] if part[1]>part[0]+.02]
            for lo,hi in intervals:
                A.beam((u+normal[0]*.02,v+normal[1]*.02,lo),(u+normal[0]*.02,v+normal[1]*.02,hi),.023,'Batten')
    flashing=set()
    all_vertices=[p for poly,_ in patches for p in poly]
    for poly,plane in patches:
        A.roof([(*p,plane_at(plane,*p)) for p in poly])
        for p,q in zip(poly,poly[1:]+poly[:1]):
            # Partitioned coplanar patches are an implementation detail. Flash
            # only real roof boundaries, ridges and valleys, exactly once.
            length=math.dist(p,q)
            if length<1e-5:continue
            cuts={0.,1.}
            for r in all_vertices:
                t=sum((r[j]-p[j])*(q[j]-p[j]) for j in (0,1))/length**2
                if 0<t<1 and math.dist(r,tuple(p[j]+t*(q[j]-p[j]) for j in (0,1)))<1e-6:cuts.add(t)
            cuts=sorted(cuts)
            for t0,t1 in zip(cuts,cuts[1:]):
                a=tuple(p[j]+t0*(q[j]-p[j]) for j in (0,1));b=tuple(p[j]+t1*(q[j]-p[j]) for j in (0,1))
                mid=tuple((a[j]+b[j])/2 for j in (0,1))
                coplanar=sum(contains(other,*mid) and max(abs(op[j]-plane[j]) for j in range(3))<1e-7 for other,op in patches)
                if coplanar>1 or math.dist(a,b)<1e-5:continue
                key=tuple(sorted(tuple(round(x,6) for x in v) for v in (a,b)))
                if key in flashing:continue
                flashing.add(key)
                A.beam((*a,plane_at(plane,*a)+.018),(*b,plane_at(plane,*b)+.018),.075,'Roof flashing')
    for o in appearance.get('openings',[]):
        if o.get('type')=='open-bay':open_bay(A,o,base)
        elif o.get('type') in ('door','barn-door','white-door','white-panel'):panel(A,o,base)
        else:trim_window(A,o,base)
    for stack in appearance.get('chimneys',[]):
        u,v=stack['u'],stack['v'];z=roof_height(patches,u,v)
        w=stack.get('width',.5);d=stack.get('depth',.55);height=stack.get('height',.85)
        A.box((u-w/2,v-d/2,z-.2),(u+w/2,v+d/2,z+height),'Brick')
        A.box((u-w/2-.07,v-d/2-.07,z+height),(u+w/2+.07,v+d/2+.07,z+height+.07),'Roof flashing')
    for fixture in appearance.get('roofStructures',[]):
        bounds=[fixture[k] for k in ('uMin','uMax','vMin','vMax')]
        top=gable_patches(bounds,fixture['planes'])
        outline=rectangle(*bounds)
        bottom=min(roof_height(patches,*p) for p in outline)-.15
        for a,b in zip(outline,outline[1:]+outline[:1]):
            cuts={0.,1.}
            for poly,_ in top:
                for p,q in zip(poly,poly[1:]+poly[:1]):
                    aa=p[1]-q[1];bb=q[0]-p[0];cc=-aa*p[0]-bb*p[1]
                    d0=aa*a[0]+bb*a[1]+cc;d1=aa*b[0]+bb*b[1]+cc
                    if abs(d0-d1)>1e-8:
                        t=d0/(d0-d1)
                        if 0<t<1:cuts.add(t)
            cuts=sorted(cuts)
            for t0,t1 in zip(cuts,cuts[1:]):
                p=tuple(a[j]+t0*(b[j]-a[j]) for j in (0,1));q=tuple(a[j]+t1*(b[j]-a[j]) for j in (0,1))
                A.face([(*p,bottom),(*q,bottom),(*q,roof_height(top,*q)),(*p,roof_height(top,*p))],'White trim')
        for poly,plane in top:A.roof([(*p,plane_at(plane,*p)) for p in poly],seams=False)
        A.features['raisedRoofStructures']+=1
    return patches
