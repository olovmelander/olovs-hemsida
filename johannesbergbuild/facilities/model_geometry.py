"""Procedural architectural geometry for the evidence-led Johannesberg models.

All authored vertices are metres in EPSG3006-local XY and RH2000-local Z.
Each facility becomes one static mesh with shared procedural PBR materials.
"""
import math
import bpy
import bmesh
from mathutils import Vector

ORIGIN = (679200, 6626160, 16)
PALETTE = {
    'falu-red': '#8b352b', 'tile-red': '#ad5237', 'tile-light': '#b86543',
    'roof-dark': '#353b3b', 'roof-seam': '#4c5352', 'white': '#eee9db',
    'cream': '#e5d3aa', 'peach': '#d7b496', 'pale-yellow': '#ddd0a6',
    'plaster': '#d8d4c6', 'foundation': '#777972', 'glass': '#314d5c',
    'glass-light': '#547482', 'wood': '#806949', 'dark-metal': '#303636',
    'grey-metal': '#969b96', 'concrete': '#ada994', 'grass': '#637444',
    'black': '#202522', 'gold': '#b18e47', 'door': '#594f40',
}


def material(name, color=None):
    key = 'JOH ARCH | ' + name
    existing = bpy.data.materials.get(key)
    if existing:
        return existing
    color = color or PALETTE.get(name, '#d8d4c6')
    if isinstance(color, str):
        color = tuple(int(color.lstrip('#')[i:i+2], 16)/255 for i in (0, 2, 4))
    linear = tuple(c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in color)
    m = bpy.data.materials.new(key)
    m.diffuse_color = (*linear, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*linear, 1)
    bsdf.inputs['Roughness'].default_value = .28 if name.startswith('glass') else .78
    bsdf.inputs['Metallic'].default_value = .2 if 'metal' in name else 0
    return m


def frame(center, angle):
    """Clockwise bearing from grid north, with V left of the U axis."""
    a = math.radians(angle)
    u, v = (math.sin(a), math.cos(a)), (-math.cos(a), math.sin(a))

    def point(x, y, h):
        return (center[0]-ORIGIN[0]+u[0]*x+v[0]*y,
                center[1]-ORIGIN[1]+u[1]*x+v[1]*y, h-ORIGIN[2])
    return point


class Architecture:
    def __init__(self, feature_id):
        self.id, self.vertices, self.faces, self.colors, self.parts = feature_id, [], [], [], {}

    def mesh(self, part, points, faces, color):
        start = len(self.vertices)
        self.vertices.extend(tuple(p) for p in points)
        for f in faces:
            self.faces.append(tuple(start+i for i in f))
            self.colors.append(color)
        self.parts[part] = self.parts.get(part, 0) + len(faces)

    def box(self, part, P, u, v, z, length, width, height, color):
        if min(length, width, height) <= 0:
            raise ValueError('Nonpositive box: ' + part)
        points = [P(u+x*length/2, v+y*width/2, z+h*height/2)
                  for h in (-1, 1) for x, y in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        self.mesh(part, points, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], color)

    def beam(self, part, a, b, width, color, depth=None):
        a, b = Vector(a), Vector(b)
        direction = b-a
        if direction.length < 1e-6:
            return
        q, center = direction.to_track_quat('Z', 'Y'), (a+b)/2
        d = depth or width
        points = [center+q@Vector((x*width/2, y*d/2, z*direction.length/2))
                  for z in (-1,1) for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        self.mesh(part, points, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], color)

    def cylinder(self, part, P, u, v, z, radius, height, color, sides=10):
        points = [P(u+radius*math.cos(i*math.tau/sides),v+radius*math.sin(i*math.tau/sides),h)
                  for h in (z-height/2,z+height/2) for i in range(sides)]
        faces = [tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
        faces += [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
        self.mesh(part, points, faces, color)

    def window(self, part, P, u, v, bottom, width=1.05, height=1.45, normal=-1, mullion=True):
        self.box(part+' trim', P,u,v,bottom+height/2,width+.18,.11,height+.18,'white')
        self.box(part+' glass', P,u,v+normal*.065,bottom+height/2,width,.035,height,'glass')
        if mullion:
            self.box(part+' mullion',P,u,v+normal*.09,bottom+height/2,.055,.035,height,'white')
            self.box(part+' transom',P,u,v+normal*.09,bottom+height*.56,width,.035,.045,'white')
        self.box(part+' sill',P,u,v+normal*.1,bottom-.10,width+.28,.29,.09,'white')

    def door(self, part, P, u, v, bottom, width=1.05, height=2.15, normal=-1, glazed=True):
        self.box(part+' frame',P,u,v,bottom+height/2,width+.2,.15,height+.18,'white')
        self.box(part+' leaf',P,u,v+normal*.095,bottom+height/2,width,.055,height,'door')
        if glazed:
            self.box(part+' glass',P,u,v+normal*.13,bottom+height*.67,width*.70,.02,height*.43,'glass')
        self.box(part+' handle',P,u+width*.35,v+normal*.17,bottom+1,.035,.06,.15,'gold')

    def railing(self, part, P, u0, u1, v, bottom, height=1.0, color='white'):
        self.box(part+' top',P,(u0+u1)/2,v,bottom+height,u1-u0,.12,.12,color)
        self.box(part+' foot',P,(u0+u1)/2,v,bottom+.12,u1-u0,.08,.08,color)
        count = max(1,math.ceil((u1-u0)/.22))
        for i in range(count+1):
            self.box(part+' baluster',P,u0+(u1-u0)*i/count,v,bottom+height/2,.048,.048,height,color)

    def arch(self, part, P, u, v, spring, halfwidth, rise, band=.16, color='white'):
        points=[]
        count=16
        for depth in (-.12,.12):
            for outer in (False,True):
                for i in range(count+1):
                    a=math.pi*i/count
                    points.append(P(u+(halfwidth+(band if outer else 0))*math.cos(a),v+depth,
                                    spring+(rise+(band if outer else 0))*math.sin(a)))
        k=count+1;faces=[]
        for i in range(count):
            faces.extend([(i,i+1,k+i+1,k+i),(2*k+i,3*k+i,3*k+i+1,2*k+i+1),
                          (i,2*k+i,2*k+i+1,i+1),(k+i,k+i+1,3*k+i+1,3*k+i)])
        self.mesh(part,points,faces,color)

    def curved_gable(self, part, P, u, v, base, width, height):
        outline=[(-width/2,base),(width/2,base)]
        outline += [(width/2*math.cos(i*math.pi/16),base+.4+height*math.sin(i*math.pi/16)) for i in range(17)]
        n=len(outline);points=[P(u+x,v+d,z) for d in (-.13,.13) for x,z in outline]
        self.mesh(part,points,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'white')
        # A restrained round/oval upper window in the curved frontispiece.
        pts=[P(u+.45*math.cos(i*math.tau/20),v-.15,base+.9+.6*math.sin(i*math.tau/20)) for i in range(20)]
        self.mesh(part+' oval window',pts,[tuple(range(20))],'glass')

    def roof(self, part, P, length, width, eave, ridge, kind='gable', roof='tile-red', wall='falu-red', overhang=.25, detail=True, break_ratio=None, break_h=None):
        L, W = length+overhang*2, width+overhang*2
        rise = max(.25, ridge-eave)
        if kind in ('flat','shed','mono-pitch'):
            hi = ridge if kind != 'flat' else eave+.22
            pts = [P(u,v,z) for u,v,z in [(-L/2,-W/2,eave),(L/2,-W/2,eave),
                  (L/2,W/2,hi),(-L/2,W/2,hi),(-L/2,-W/2,eave-.15),
                  (L/2,-W/2,eave-.15),(L/2,W/2,hi-.15),(-L/2,W/2,hi-.15)]]
            self.mesh(part,pts,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],roof)
        elif 'hip' in kind or 'mansard' in kind:
            mansard = 'mansard' in kind
            inset = min(W*(1-(break_ratio or .65))/2, L*.18) if mansard else min(W*.42,L*.25)
            mid_h = (break_h or eave+rise*.68) if mansard else eave+rise*.78
            rings = [[P(u,v,eave) for u,v in [(-L/2,-W/2),(L/2,-W/2),(L/2,W/2),(-L/2,W/2)]],
                     [P(u,v,mid_h) for u,v in [(-L/2+inset,-W/2+inset),(L/2-inset,-W/2+inset),
                                              (L/2-inset,W/2-inset),(-L/2+inset,W/2-inset)]]]
            r = max(0.15,L/2-W*.48)
            points = rings[0]+rings[1]+[P(-r,0,ridge),P(r,0,ridge)]
            self.mesh(part,points,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),
                                  (4,5,9,8),(5,6,9),(6,7,8,9),(7,4,8)],roof)
        else:
            points = [P(u,v,z) for u in (-L/2,L/2) for v,z in [(-W/2,eave),(W/2,eave),(0,ridge)]]
            self.mesh(part+' slopes',points,[(0,3,5,2),(2,5,4,1),(0,1,4,3)],roof)
            self.mesh(part+' gables',points,[(0,2,1),(3,4,5)],wall)
            for u in (-L/2,L/2):
                self.beam(part+' barge',P(u,-W/2,eave),P(u,0,ridge),.13,'white')
                self.beam(part+' barge',P(u,0,ridge),P(u,W/2,eave),.13,'white')
            self.beam(part+' ridge cap',P(-L/2,0,ridge+.04),P(L/2,0,ridge+.04),.14,roof)
            if detail:
                # Subtle geometry carries roof texture without third-party photos.
                for sign in (-1,1):
                    count = max(2,int(math.hypot(W/2,rise)/.48))
                    for i in range(1,count):
                        v = sign*W/2*i/count
                        h = ridge-rise*i/count+.018
                        self.beam(part+' tile courses',P(-L/2,v,h),P(L/2,v,h),.025,
                                  'tile-light' if roof=='tile-red' else 'roof-seam')
        for v in (-W/2,W/2):
            edge_h=ridge if kind in ('shed','mono-pitch') and v>0 else eave
            self.box(part+' fascia',P,0,v,edge_h-.09,L,.12,.20,'white')
            self.box(part+' gutter',P,0,v,edge_h-.02,L,.12,.09,'dark-metal')

    def building(self, part, center, angle, length, width, bottom, floor, eave, ridge,
                 roof_kind='gable', wall='falu-red', roof='tile-red', storeys=1,
                 windows=True, front_side=-1, detail=True):
        P = frame(center,angle)
        self.box(part+' foundation',P,0,0,(bottom+floor)/2,length+.08,width+.08,max(.2,floor-bottom),'foundation')
        self.box(part+' walls',P,0,0,(floor+eave)/2,length,width,max(.4,eave-floor),wall)
        for u in (-length/2,length/2):
            for v in (-width/2,width/2):
                self.box(part+' corner',P,u,v,(floor+eave)/2,.13,.13,eave-floor+.08,'white')
        self.roof(part+' roof',P,length,width,eave,ridge,roof_kind,roof,wall,detail=detail)
        if windows:
            count = max(1,min(14,int(length/3.1)))
            for side in (-1,1):
                for row in range(storeys):
                    base = floor+.8+row*2.9
                    if base+1.5 > eave-.2:
                        continue
                    for i in range(count):
                        u = -length/2+(i+.5)*length/count
                        self.window(part+' window',P,u,side*(width/2+.04),base,normal=side)
            self.door(part+' entrance',P,0,front_side*(width/2+.06),floor+.04,normal=front_side)
        return P

    def prism(self, part, ring_epsg, bottom, top, color):
        ring = ring_epsg[:-1] if ring_epsg[0] == ring_epsg[-1] else ring_epsg
        n=len(ring)
        points=[(p[0]-ORIGIN[0],p[1]-ORIGIN[1],z-ORIGIN[2]) for z in (bottom,top) for p in ring]
        self.mesh(part,points,[tuple(reversed(range(n))),tuple(range(n,n*2))]+
                  [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],color)

    def dormer(self, part, center, angle, base, width=1.35, depth=1.7, height=1.5, wall='white', roof='tile-red'):
        P=frame(center,angle)
        self.box(part+' body',P,0,0,base+height/2,width,depth,height,wall)
        # Dormer ridge runs across the building roof towards its facade.
        R=frame(center,angle+90)
        self.roof(part+' roof',R,depth,width,base+height,base+height+.55,'gable',roof,wall,.1,False)
        self.window(part+' window',P,0,-depth/2-.04,base+.16,width*.70,height*.72,-1,False)

    def finish(self, collection, root, extras):
        assert self.vertices and all(all(math.isfinite(v) for v in p) for p in self.vertices)
        data=bpy.data.meshes.new(self.id+' | architecture')
        data.from_pydata(self.vertices,[],self.faces)
        names=list(dict.fromkeys(self.colors))
        for name in names:
            data.materials.append(material(name))
        for poly,color in zip(data.polygons,self.colors):
            poly.material_index=names.index(color)
        bm=bmesh.new();bm.from_mesh(data)
        unused=[v for v in bm.verts if not v.link_faces]
        if unused:bmesh.ops.delete(bm,geom=unused,context='VERTS')
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        bm.to_mesh(data);bm.free();data.update()
        obj=bpy.data.objects.new(self.id+' | architecture',data)
        collection.objects.link(obj);obj.parent=root
        for k,v in extras.items():
            obj[k]=v
        obj['procedural_model']=True
        obj['geometry_status']='Evidence-led appearance model; dimensions include explicit estimates'
        return obj, {'vertices':len(data.vertices),'triangles':len(data.polygons),'materials':len(names),'parts':self.parts}
