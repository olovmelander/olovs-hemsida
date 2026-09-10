"""Small deterministic mesh authoring helpers, used only inside Blender."""
import math
import bpy
import bmesh
from mathutils import Vector


class Geometry:
    def __init__(self, collection, prefix='RIBB | '):
        self.collection = collection
        self.prefix = prefix
        self.materials = {}
        self.feature = 'unassigned'
        for name, rgb in {
            'yellow': (.72,.55,.29), 'trim': (.58,.60,.54),
            'white': (.85,.84,.74), 'tile': (.38,.115,.044),
            'tile_light': (.48,.18,.065), 'slate': (.065,.085,.095),
            'red': (.30,.055,.028), 'wood': (.26,.20,.13),
            'glass': (.052,.095,.10), 'stone': (.31,.32,.29),
            'gravel': (.40,.36,.28), 'metal': (.065,.07,.068),
            'grass': (.22,.31,.095), 'mat': (.06,.20,.12),
            'water': (.08,.19,.24), 'sand': (.59,.48,.29),
            'green': (.13,.29,.12), 'amber': (1,.39,.04),
            'cyan': (.04,.7,.9)
        }.items():
            m = bpy.data.materials.new(prefix+name)
            m.diffuse_color = (*rgb, 1)
            m.use_nodes = True
            bsdf = m.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = (*rgb,1)
            bsdf.inputs['Roughness'].default_value = .28 if name=='glass' else .78
            self.materials[name] = m

    def mesh(self, name, vertices, faces, mat):
        assert vertices and all(all(math.isfinite(v) for v in p) for p in vertices), name
        data = bpy.data.meshes.new(self.prefix+name)
        data.from_pydata(vertices, [], faces)
        data.update()
        bm = bmesh.new(); bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(data); bm.free()
        data.materials.append(self.materials[mat] if isinstance(mat,str) else mat)
        obj = bpy.data.objects.new(self.prefix+name, data)
        self.collection.objects.link(obj)
        obj['facility_id'] = self.feature
        obj['height_status'] = 'Architectural heights estimated from photographs; not surveyed'
        return obj

    def box(self, name, center, dims, mat, angle=0):
        assert min(dims)>0, name
        a,b,h = (d/2 for d in dims); cx,cy,cz=center
        c,s=math.cos(angle),math.sin(angle)
        vertices=[(cx+x*c-y*s,cy+x*s+y*c,cz+z) for z in (-h,h)
                  for x,y in [(-a,-b),(a,-b),(a,b),(-a,b)]]
        return self.mesh(name,vertices,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)

    def beam(self,name,a,b,width,mat,depth=None):
        a,b=Vector(a),Vector(b); d=b-a
        assert d.length>1e-6,name
        q=d.to_track_quat('Z','Y'); mid=(a+b)/2
        w=width/2; h=(depth or width)/2
        vertices=[tuple(mid+q@Vector((x,y,z))) for z in (-d.length/2,d.length/2)
                  for x,y in [(-w,-h),(w,-h),(w,h),(-w,h)]]
        return self.mesh(name,vertices,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)

    def prism(self,name,ring,z0,z1,mat):
        if ring[0]==ring[-1]:ring=ring[:-1]
        n=len(ring)
        return self.mesh(name,[(x,y,z) for z in (z0,z1) for x,y in ring],
                         [tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat)

    def cylinder(self,name,center,radius,height,mat,n=12):
        x,y,z=center
        return self.prism(name,[(x+radius*math.cos(i*math.tau/n),y+radius*math.sin(i*math.tau/n)) for i in range(n)],z-height/2,z+height/2,mat)

    def roof(self,name,center,length,width,eave,ridge,angle,mat='tile',hip=False):
        cx,cy=center;c,s=math.cos(angle),math.sin(angle)
        inset=min(width*.45,length*.2) if hip else 0
        local=[(-length/2,-width/2,eave),(length/2,-width/2,eave),
               (length/2,width/2,eave),(-length/2,width/2,eave),
               (-length/2+inset,0,ridge),(length/2-inset,0,ridge)]
        v=[(cx+c*x-s*y,cy+s*x+c*y,z) for x,y,z in local]
        # Closed thin roofing, leaving the timber gable visible behind its overhang.
        # A solid triangular tile volume would incorrectly cover the entire gable.
        top=[(0,1,5,4),(5,2,3,4)]
        perimeter=[0,1,5,2,3,4]
        if hip:
            top.extend([(0,4,3),(1,2,5)]);perimeter=[0,1,2,3]
        v.extend((x,y,z-.09) for x,y,z in list(v))
        faces=top+[tuple(i+6 for i in reversed(f)) for f in top]
        faces.extend((a,a+6,b+6,b) for a,b in zip(perimeter,perimeter[1:]+perimeter[:1]))
        return self.mesh(name,v,faces,mat)

    def line(self,name,points,mat='cyan',width=.07,closed=False):
        d=bpy.data.curves.new(self.prefix+name,'CURVE');d.dimensions='3D'
        d.bevel_depth=width;d.bevel_resolution=0
        sp=d.splines.new('POLY');sp.points.add(len(points)-1)
        for p,co in zip(sp.points,points):p.co=(*co,1)
        sp.use_cyclic_u=closed;d.materials.append(self.materials[mat])
        ob=bpy.data.objects.new(self.prefix+name,d);self.collection.objects.link(ob)
        ob['facility_id']=self.feature
        return ob
