"""Editable, material-batched Blender architecture in metres (east, north, RH2000)."""
import math
from collections import defaultdict
import bpy
import bmesh
from mathutils import Vector


PALETTE = {
    'render': ('e4e3dc', .83, 0), 'trim': ('f1f0e9', .68, 0),
    'roof': ('35424e', .48, .30), 'seam': ('4a5966', .50, .35),
    'redwood': ('93483f', .88, 0), 'redbatten': ('a65549', .85, 0),
    'darkwood': ('50524b', .9, 0), 'glass': ('355663', .24, .18),
    'recess': ('263338', .68, 0), 'stone': ('b8b4a2', .95, 0),
    'stonejoint': ('9e9d8d', .96, 0), 'deck': ('a29c87', .92, 0),
    'steel': ('333b3a', .56, .45), 'silverroof': ('a7aca6', .60, .30),
    'asphalt': ('62665f', .95, 0), 'mat': ('315d45', .98, 0),
    'grass': ('5e7745', .98, 0), 'sand': ('b9b18c', 1, 0),
    'water': ('537c86', .23, .1), 'canvas': ('e7e1d0', .9, 0),
    'rangegrass': ('496d52', .98, 0), 'hittingmat': ('254b3c', .98, 0),
    'matinsert': ('52745b', .98, 0), 'rubber': ('252c29', .95, 0),
    'concrete': ('c0bfb0', .96, 0), 'rangewood': ('343e36', .93, 0),
    'galvanized': ('929994', .63, .5), 'net': ('353e33', .96, 0),
    'screen': ('203b43', .30, .05), 'orange': ('df7132', .7, 0),
    'netpole': ('635a3b', .95, 0), 'signblue': ('47788c', .85, 0),
}


def linear(hexcolor):
    rgb=[int(hexcolor[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb)


class Builder:
    def __init__(self,scene):
        self.scene=scene; self.materials={}; self.buffers=defaultdict(lambda:[[],[]]); self.groups={}
        for key,(color,rough,metal) in PALETTE.items():
            m=bpy.data.materials.new('Visby / '+key);m.use_nodes=True
            bsdf=m.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value=(*linear(color),1)
            bsdf.inputs['Roughness'].default_value=rough;bsdf.inputs['Metallic'].default_value=metal
            m.diffuse_color=(*linear(color),1);self.materials[key]=m

    def group(self,key,name,properties):
        obj=bpy.data.objects.new(name,None);self.scene.collection.objects.link(obj)
        for k,v in properties.items():obj[k]=v
        self.groups[key]=obj;return obj

    def mesh(self,key,part,verts,faces,mat):
        vv,ff=self.buffers[(key,part,mat)];offset=len(vv)
        vv.extend(tuple(float(v) for v in p) for p in verts)
        ff.extend(tuple(offset+i for i in f) for f in faces)

    def box(self,key,part,center,dimensions,mat,angle=0):
        cx,cy,cz=center;dx,dy,dz=[v/2 for v in dimensions];c,s=math.cos(angle),math.sin(angle)
        assert min(dimensions)>0
        v=[(cx+x*c-y*s,cy+x*s+y*c,cz+z) for z in (-dz,dz) for x,y in [(-dx,-dy),(dx,-dy),(dx,dy),(-dx,dy)]]
        self.mesh(key,part,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)

    def prism(self,key,part,ring,z0,z1,mat):
        ring=ring[:-1] if ring[0]==ring[-1] else ring;n=len(ring)
        v=[(x,y,z) for z in (z0,z1) for x,y in ring]
        self.mesh(key,part,v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat)

    def beam(self,key,part,a,b,width,mat,depth=None):
        a,b=Vector(a),Vector(b);d=b-a;q=d.to_track_quat('Z','Y');m=(a+b)/2;h=depth or width
        v=[tuple(m+q@Vector((x,y,z))) for z in (-d.length/2,d.length/2) for x,y in [(-width/2,-h/2),(width/2,-h/2),(width/2,h/2),(-width/2,h/2)]]
        self.mesh(key,part,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)

    def cylinder(self,key,part,center,radius,height,mat,sides=16):
        x,y,z=center;r=[(x+radius*math.cos(i*math.tau/sides),y+radius*math.sin(i*math.tau/sides)) for i in range(sides)]
        self.prism(key,part,r,z-height/2,z+height/2,mat)

    def finish(self):
        objects=[]
        for (key,part,mat),(verts,faces) in self.buffers.items():
            assert all(math.isfinite(x) for p in verts for x in p)
            data=bpy.data.meshes.new('Visby / '+key+' / '+part+' / '+mat);data.from_pydata(verts,[],faces);data.update()
            bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
            bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4]);bm.to_mesh(data);bm.free()
            data.materials.append(self.materials[mat])
            obj=bpy.data.objects.new(data.name,data);self.scene.collection.objects.link(obj);obj.parent=self.groups[key]
            obj['sourceFacilityId']=key;obj['architecturalHeightStatus']='photo-estimated unless parent supplies measured source'
            objects.append(obj)
        return objects


class Frame:
    def __init__(self,ctx,key,cx,cy,angle=0,base=0):self.ctx=ctx;self.key=key;self.cx=cx;self.cy=cy;self.angle=angle;self.base=base
    def p(self,x,y,z):
        c,s=math.cos(self.angle),math.sin(self.angle)
        return (self.cx+c*x-s*y,self.cy+s*x+c*y,self.base+z)
    def box(self,part,x,y,z,dimensions,mat):self.ctx.box(self.key,part,self.p(x,y,z),dimensions,mat,self.angle)
    def beam(self,part,a,b,width,mat,depth=None):self.ctx.beam(self.key,part,self.p(*a),self.p(*b),width,mat,depth)
    def mesh(self,part,verts,faces,mat):self.ctx.mesh(self.key,part,[self.p(*p) for p in verts],faces,mat)
    def window(self,x,y,bottom,w=1.25,h=1.45,side=-1,part='Windows',mullion=True):
        self.box(part,x,y,bottom+h/2,(w+.13,.13,h+.13),'recess')
        self.box(part,x,y+side*.08,bottom+h/2,(w,.035,h),'glass')
        for dx in (-w/2-.035,w/2+.035):self.box(part,x+dx,y+side*.11,bottom+h/2,(.075,.10,h+.20),'trim')
        for z in (bottom-.055,bottom+h+.055):self.box(part,x,y+side*.11,z,(w+.20,.1,.09),'trim')
        if mullion:self.box(part,x,y+side*.135,bottom+h/2,(.055,.06,h),'trim')
    def gable(self,part,x,y,length,width,eave,ridge,wall='render',roof='roof',seams=True,walls=True):
        if walls:self.box(part+' walls',x,y,eave/2,(length,width,eave),wall)
        l=length/2;w=width/2;o=.30
        self.mesh(part+' gables',[(x+a*l,y+b*w,eave) for a,b in [(-1,-1),(-1,1),(1,-1),(1,1)]]+[(x-l,y,ridge),(x+l,y,ridge)],[(0,4,1),(2,3,5)],wall)
        self.mesh(part+' roof',[(x-l-o,y-w-o,eave-.12),(x+l+o,y-w-o,eave-.12),(x+l+o,y,ridge),(x-l-o,y,ridge),(x-l-o,y+w+o,eave-.12),(x+l+o,y+w+o,eave-.12)],[(0,1,2,3),(3,2,5,4)],roof)
        for a in (-1,1):
            for b in (-1,1):self.beam(part+' bargeboards',(x+a*(l+o),y+b*(w+o),eave-.13),(x+a*(l+o),y,ridge),.16,'trim')
        for b in (-1,1):self.beam(part+' gutters',(x-l-o,y+b*(w+o),eave-.15),(x+l+o,y+b*(w+o),eave-.15),.13,'steel')
        self.beam(part+' ridge cap',(x-l-o,y,ridge+.025),(x+l+o,y,ridge+.025),.14,roof)
        if seams:
            n=int(length/.62)
            for i in range(n+1):
                xx=x-l+i*length/n
                for b in (-1,1):self.beam(part+' roof seams',(xx,y+b*(w+o),eave-.08),(xx,y,ridge+.03),.025,'seam')
