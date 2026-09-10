"""Small geometry helpers for metre-scale, texture-free Blender architecture.

Coordinates supplied to this builder are (southeast, northeast, RH2000).
Only the final vertices are rotated into east/north/up relative to the anchor.
Faces are grouped by material, keeping the game asset inexpensive to draw.
"""
import math
from collections import defaultdict
import bpy
from mathutils import Vector


def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


class Architecture:
    def __init__(self, collection, anchor, origin, u, v):
        self.collection, self.anchor, self.origin = collection, anchor, origin
        self.u, self.v = u, v
        self.parts = defaultdict(lambda: [[], []])
        self.materials = {}
        self.features = defaultdict(int)

    def material(self, name, color, roughness=.8, metallic=0):
        material = bpy.data.materials.new('Tortuna | ' + name)
        rgb = [linear(int(color[i:i+2], 16) / 255) for i in (0, 2, 4)]
        material.diffuse_color = (*rgb, 1)
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
        self.materials[name] = material

    def face(self, vertices, material):
        points, faces = self.parts[material]
        faces.append(tuple(range(len(points), len(points) + len(vertices))))
        points.extend(vertices)

    def box(self, lo, hi, material):
        x, y, z = lo
        X, Y, Z = hi
        assert X > x and Y > y and Z > z, (lo, hi)
        p = [(x,y,z),(X,y,z),(X,Y,z),(x,Y,z),(x,y,Z),(X,y,Z),(X,Y,Z),(x,Y,Z)]
        for ids in [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]:
            self.face([p[i] for i in ids], material)

    def beam(self, a, b, width, material, depth=None):
        a, b = Vector(a), Vector(b)
        direction = (b-a).normalized()
        normal = Vector((0,0,1)) if abs(direction.z) < .95 else Vector((0,1,0))
        cross = direction.cross(normal).normalized() * width / 2
        up = direction.cross(cross).normalized() * (depth or width) / 2
        p = [tuple(q + c*cross + d*up) for q in (a,b) for c,d in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        for ids in [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]:
            self.face([p[i] for i in ids], material)

    def window(self, center, width, height, axis='v', sign=1, door=False):
        # Window glass and projecting white trim; no copied photo textures.
        u, v, bottom = center
        def box(a, b, material):
            if axis == 'v':
                self.box((u+a[0],v+a[1]*sign,bottom+a[2]) if sign>0 else (u+a[0],v-b[1],bottom+a[2]),
                         (u+b[0],v+b[1]*sign,bottom+b[2]) if sign>0 else (u+b[0],v-a[1],bottom+b[2]),material)
            else:
                self.box((u+a[1],v+a[0],bottom+a[2]) if sign>0 else (u-b[1],v+a[0],bottom+a[2]),
                         (u+b[1],v+b[0],bottom+b[2]) if sign>0 else (u-a[1],v+b[0],bottom+b[2]),material)
        box((-width/2, .018, 0),(width/2,.065,height),'Glass')
        for x in (-width/2, width/2):
            box((x-.065,.035,-.08),(x+.065,.15,height+.08),'White trim')
        for z in (0, height):
            box((-width/2-.09,.035,z-.065),(width/2+.09,.15,z+.065),'White trim')
        box((-.032,.055,.02),(.032,.145,height-.02),'White trim')
        if door:
            box((-width/2+.04,.07,.06),(width/2-.04,.12,height*.32),'White trim')
        self.features['doors' if door else 'windows'] += 1

    def railing(self, a, b, z, height=1.0, material='Metal rail'):
        self.beam((*a,z+height),(*b,z+height),.055,material)
        self.beam((*a,z+.13),(*b,z+.13),.035,material)
        distance = math.dist(a,b)
        count = max(1, math.ceil(distance/.9))
        for i in range(count+1):
            t = i/count
            p = tuple(a[j]+(b[j]-a[j])*t for j in range(2))
            self.beam((*p,z),(*p,z+height),.045,material)
        for i in range(1,max(2,math.ceil(distance/.18))):
            t=i/math.ceil(distance/.18)
            p=tuple(a[j]+(b[j]-a[j])*t for j in range(2))
            self.beam((*p,z+.13),(*p,z+height),.018,material)

    def roof(self, vertices, material='Roof tile', seams=True):
        # Require upper-facing winding for these nonplanar-free polygons.
        p=[Vector(v) for v in vertices]
        if (p[1]-p[0]).cross(p[2]-p[0]).z < 0:
            vertices=list(reversed(vertices))
        self.face(vertices, material)
        if seams:
            # Parallel tile courses clipped to each convex roof polygon. These
            # restrained relief lines read in close views without tiny textures.
            low=min(v[2] for v in vertices); high=max(v[2] for v in vertices)
            rise = high-low
            if rise < .08: return
            normal=(p[1]-p[0]).cross(p[2]-p[0]).normalized()
            pitch=max(.12, abs(normal.z))
            step=max(.065,.34*math.sqrt(max(0,1-pitch*pitch)))
            for i in range(1,int(rise/step)+1):
                z=low+i*step
                hits=[]
                for a,b in zip(vertices,vertices[1:]+vertices[:1]):
                    if (a[2]<=z<b[2]) or (b[2]<=z<a[2]):
                        t=(z-a[2])/(b[2]-a[2])
                        hits.append(tuple(a[j]+t*(b[j]-a[j])+(0.012 if j==2 else 0) for j in range(3)))
                if len(hits)==2 and math.dist(*hits)>.1:
                    self.beam(hits[0],hits[1],.024,'Tile course')

    def build(self):
        objects=[]
        for material,(points,faces) in self.parts.items():
            vertices=[(self.origin[0]+p[0]*self.u[0]+p[1]*self.v[0]-self.anchor[0],
                       self.origin[1]+p[0]*self.u[1]+p[1]*self.v[1]-self.anchor[1],
                       p[2]-self.anchor[2]) for p in points]
            mesh=bpy.data.meshes.new('Tortuna | '+material)
            mesh.from_pydata(vertices,[],faces)
            mesh.materials.append(self.materials[material])
            mesh.update()
            obj=bpy.data.objects.new('Clubhouse | '+material,mesh)
            self.collection.objects.link(obj)
            objects.append(obj)
        return objects
