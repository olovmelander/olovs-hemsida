"""Photo-referenced exterior models; run inside Blender via the bridge on 9876.

Only the generated scene is replaced on reruns. Existing scenes are preserved.
XY are model-plan metres, Z is up. Heights are photo estimates, not a survey.
"""
import bpy
import bmesh
import json
import math
import hashlib
import zlib
from pathlib import Path
from mathutils import Vector

ROOT = Path(globals().get('VECK_REPO_ROOT', r'C:\Users\olov_\repos\olovs-hemsida'))
HERE = ROOT / 'geobuild/landmarks-2026-09-13'
OUT = ROOT / 'apps/golf/public/models/veckefjarden'
SCENE = 'Veckefjarden | Photo landmarks 2026-09-13'
PREFIX = 'VECK LANDMARK | '
TERRAIN = json.loads((HERE / 'terrain-samples.json').read_text())
TAU = math.tau


def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


PALETTE = {
    'plaster': ('eeeae0', .88, 0), 'trim': ('f4f1e9', .75, 0),
    'granite': ('96938c', .95, 0), 'glass': ('344447', .27, .10),
    'copper': ('796149', .74, .18), 'copper_seams': ('89745b', .68, .18),
    'upper_roof': ('4d4b41', .72, .18), 'patina': ('6b7867', .7, .12),
    'gold': ('d4aa43', .32, .65), 'door': ('555b5a', .8, 0),
    'clock': ('e6dfc9', .75, 0), 'dark': ('30332f', .82, 0),
    'timber': ('777365', .91, 0), 'timber_light': ('969487', .95, 0),
    'timber_dark': ('494a43', .94, 0), 'steel': ('969e9d', .65, .35),
    'track': ('4d6846', .92, 0), 'rail': ('b7bdb9', .44, .45),
    'landing': ('316b50', .96, 0), 'landing_alt': ('356e53', .96, 0),
    'markings': ('e1e3ca', .91, 0), 'red_markings': ('ab5547', .9, 0),
    'ballast': ('74736c', .95, 0),
}


class Builder:
    """Named editable parts in Blender, merged by material only for GLB export."""
    def __init__(self, scene, name):
        self.collection = bpy.data.collections.new(PREFIX + name)
        scene.collection.children.link(self.collection)
        self.parts = {}
        self.objects = []
        self.materials = {}
        for key, (colour, roughness, metalness) in PALETTE.items():
            m = bpy.data.materials.new(PREFIX + name + ' ' + key)
            rgb = tuple(linear(int(colour[i:i+2], 16) / 255) for i in (0, 2, 4))
            m.diffuse_color = (*rgb, 1)
            m.use_nodes = True
            p = m.node_tree.nodes.get('Principled BSDF')
            p.inputs['Base Color'].default_value = (*rgb, 1)
            p.inputs['Roughness'].default_value = roughness
            p.inputs['Metallic'].default_value = metalness
            self.materials[key] = m

    def mesh(self, part, mat, vertices, faces):
        v, f = self.parts.setdefault((part, mat), ([], []))
        offset = len(v)
        assert all(math.isfinite(c) for p in vertices for c in p)
        v.extend(vertices)
        f.extend(tuple(i + offset for i in face) for face in faces)

    def box(self, part, mat, center, dims, angle=0):
        x, y, z = center
        a, b, h = [d / 2 for d in dims]
        assert min(dims) > 0
        c, s = math.cos(angle), math.sin(angle)
        vertices = [(x + u*c-v*s, y+u*s+v*c, z+w) for w in (-h, h)
                    for u, v in [(-a, -b), (a, -b), (a, b), (-a, b)]]
        self.mesh(part, mat, vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])

    def beam(self, part, mat, a, b, width=.08, depth=None):
        a, b = Vector(a), Vector(b)
        d = b-a
        if d.length < 1e-7:
            return
        q, mid = d.to_track_quat('Z', 'Y'), (a+b)/2
        w, h = width/2, (depth or width)/2
        vertices = [tuple(mid + q @ Vector((u,v,z))) for z in (-d.length/2,d.length/2)
                    for u,v in [(-w,-h),(w,-h),(w,h),(-w,h)]]
        self.mesh(part, mat, vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])

    def loft(self, part, mat, levels, sides=8, phase=TAU/16, center=(0,0)):
        vertices = [(center[0]+r*math.cos(i*TAU/sides+phase),
                     center[1]+r*math.sin(i*TAU/sides+phase), z)
                    for z, r in levels for i in range(sides)]
        faces = [tuple(reversed(range(sides))), tuple(range((len(levels)-1)*sides, len(levels)*sides))]
        for j in range(len(levels)-1):
            for i in range(sides):
                k=(i+1)%sides
                faces.append((j*sides+i,j*sides+k,(j+1)*sides+k,(j+1)*sides+i))
        self.mesh(part, mat, vertices, faces)

    def finish(self):
        for (part, mat), (vertices, faces) in self.parts.items():
            mesh = bpy.data.meshes.new(PREFIX + part)
            mesh.from_pydata(vertices, [], faces)
            mesh.update()
            bm=bmesh.new(); bm.from_mesh(mesh)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts)>4])
            bm.to_mesh(mesh); bm.free()
            mesh.materials.append(self.materials[mat])
            obj=bpy.data.objects.new(PREFIX + part,mesh)
            obj['photo_referenced'] = True
            obj['dimensions_status'] = 'Mapped plan; photo-estimated exterior dimensions'
            self.collection.objects.link(obj)
            self.objects.append(obj)
        return self.objects


def facade_point(angle, distance, u, z):
    return (math.cos(angle)*distance-math.sin(angle)*u,
            math.sin(angle)*distance+math.cos(angle)*u, z)


def arch(b, part, angle, distance, u, bottom, width, height, frame=.10, louvers=False):
    r=width/2
    spring=bottom+height-r
    path=[(-r,bottom),(r,bottom),(r,spring)]
    path += [(r*math.cos(t*math.pi/12),spring+r*math.sin(t*math.pi/12)) for t in range(1,13)]
    path += [(-r,bottom)]
    p=lambda x,z,off=0:facade_point(angle,distance+off,u+x,z)
    b.mesh(part+' glazing', 'dark' if louvers else 'glass', [p(x,z) for x,z in path[:-1]], [tuple(range(len(path)-1))])
    for (x,z),(x2,z2) in zip(path,path[1:]):
        b.beam(part+' surround','trim',p(x,z,.05),p(x2,z2,.05),frame,frame*.75)
    if louvers:
        z=bottom+.12
        while z<spring+.12:
            b.beam(part+' louver slats','door',p(-r+.10,z,.04),p(r-.10,z,.04),.055,.08)
            z+=.19
    else:
        b.beam(part+' mullions','trim',p(0,bottom,.04),p(0,spring+r-.04,.04),.05)
        for i in range(1,max(2,round(height/.55))):
            z=bottom+i*(spring-bottom)/max(2,round(height/.55))
            b.beam(part+' mullions','trim',p(-r+.04,z,.04),p(r-.04,z,.04),.045)
        for d in [-.65,.65]:
            b.beam(part+' arch tracery','trim',p(0,spring-.05,.04),p(d*r,spring+.76*r,.04),.042)
        sill=facade_point(angle,distance+.12,u,bottom-.09)
        b.box(part+' sill','granite',sill,(.26,width+.22,.14),angle)


def round_face(b, part, angle, distance, z, radius, clock=False):
    p=lambda u,h,off=0:facade_point(angle,distance+off,u,h)
    vertices=[p(radius*math.cos(i*TAU/48),z+radius*math.sin(i*TAU/48)) for i in range(48)]
    b.mesh(part, 'clock' if clock else 'dark', vertices,[tuple(range(48))])
    for i in range(48):
        a0=i*TAU/48; a1=(i+1)*TAU/48
        b.beam(part+' rim','gold' if clock else 'trim',
               p(radius*math.cos(a0),z+radius*math.sin(a0),.02),
               p(radius*math.cos(a1),z+radius*math.sin(a1),.02),.05)
    if clock:
        for i in range(12):
            a=i*TAU/12
            b.beam(part+' hour markers','dark',p(.77*radius*math.sin(a),z+.77*radius*math.cos(a),.045),
                   p(.91*radius*math.sin(a),z+.91*radius*math.cos(a),.045),.043)
        for a,l,w in [(math.pi*2/3,.64,.045),(math.pi/3,.44,.065)]:
            b.beam(part+' hands','dark',p(0,z,.065),p(l*math.sin(a),z+l*math.cos(a),.065),w)


def roof_seams(b, part, z0, r0, z1, r1, mat, spacing=.85):
    for k in range(8):
        a=k*TAU/8+TAU/16; a2=(k+1)*TAU/8+TAU/16
        v0=Vector((r0*math.cos(a),r0*math.sin(a),z0+.025))
        v1=Vector((r0*math.cos(a2),r0*math.sin(a2),z0+.025))
        w0=Vector((r1*math.cos(a),r1*math.sin(a),z1+.025))
        w1=Vector((r1*math.cos(a2),r1*math.sin(a2),z1+.025))
        count=max(2,round((v1-v0).length/spacing))
        for i in range(count+1):
            t=i/count
            b.beam(part,mat,v0.lerp(v1,t),w0.lerp(w1,t),.027,.045)
        for j in range(1,5):
            t=j/5
            b.beam(part,mat,v0.lerp(w0,t),v1.lerp(w1,t),.021,.025)


def church(scene):
    b=Builder(scene,'Sjalevads kyrka - editable architecture')
    b.loft('Granite foundation','granite',[(-1.3,18.52),(.72,18.52)])
    b.loft('Octagonal rendered nave','plaster',[(.70,18.40),(11.60,18.40)])
    for z,r,h in [(.72,18.57,.20),(10.65,18.52,.20),(11.12,18.62,.18),(11.46,18.85,.24)]:
        b.loft('Nave cornices','trim',[(z,r),(z+h,r)])
    # Four diagonal window walls; separate upper arches and lower six-pane lights.
    for k in range(8):
        a=k*TAU/8
        if k%2:
            for u in [-4.65,-1.55,1.55,4.65]:
                arch(b,'Nave windows',a,17.03,u,1.70,1.20,6.60)
                p=lambda x,z:facade_point(a,17.12,x,z)
                b.beam('Window dividing transoms','trim',p(u-.64,4.35),p(u+.64,4.35),.20,.14)
        # Corner pilasters on the octagonal masonry.
        for u in [-6.87,6.87]:
            b.box('Wall pilasters','trim',facade_point(a,17.03,u,5.67),(.18,.36,9.86),a)
    # Four tetrastyle porticos. No invented detached sacristy.
    for k in range(4):
        a=k*TAU/4
        P=lambda d,u,z:facade_point(a,d,u,z)
        for j in range(5):
            b.box('Entrance granite steps','granite',P(19.15+.18*j,0,.07+j*.14),
                  (3.0-.32*j,15.25-.10*j,.14),a)
        b.box('Portico stylobate','granite',P(18.70,0,.64),(3.50,15.20,.26),a)
        for u in [-6.25,-2.085,2.085,6.25]:
            x,y,_=P(19.50,u,0)
            b.box('Column square plinths','granite',(x,y,.86),(1.12,1.12,.25),a)
            b.loft('Doric column bases','trim',[(.98,.61),(1.10,.61),(1.25,.53)],24,0,(x,y))
            b.loft('Sixteen tapered columns','plaster',[(1.25,.49),(4.8,.48),(9.92,.40)],24,0,(x,y))
            b.loft('Doric ring capitals','trim',[(9.91,.40),(10.03,.47),(10.22,.59),(10.34,.59)],24,0,(x,y))
            b.box('Capital abaci','trim',(x,y,10.39),(1.26,1.26,.21),a)
        b.box('Portico entablature','plaster',P(18.80,0,10.92),(3.00,15.25,1.00),a)
        for z,d,w,h in [(10.47,3.2,15.48,.18),(11.12,3.2,15.48,.16),(11.48,3.55,15.82,.22)]:
            b.box('Portico cornice mouldings','trim',P(18.80,0,z),(d,w,h),a)
        for i in range(19):
            u=-7.05+i*.783
            b.box('Entablature triglyphs','trim',P(20.34,u,10.92),(.08,.26,.38),a)
            for off in [-.074,.074]:
                b.box('Triglyph channels','granite',P(20.388,u+off,10.92),(.006,.022,.30),a)
        front=20.56
        b.mesh('Triangular temple pediments','plaster',
               [P(front,u,z) for u,z in [(-7.8,11.56),(7.8,11.56),(0,14.00)]],[(0,1,2)])
        for side in [-1,1]:
            b.beam('Raking pediment cornices','trim',P(front+.03,side*7.90,11.56),P(front+.03,0,14.12),.26,.34)
            b.mesh('Portico copper roofs','copper',[P(d,u,z) for d,u,z in
                   [(20.72,side*8.03,11.73),(12.5,side*8.03,11.73),(12.5,0,14.16),(20.72,0,14.16)]],[(0,1,2,3)])
            if k != 2:
                for i in range(17):
                    t=(i+.5)/17
                    b.box('Pediment dentils','trim',P(front+.015,side*7.7*(1-t),11.49+2.46*t),(.24,.20,.20),a)
        round_face(b,'Pediment oculus',a,front+.05,12.30,.31)
        if k != 2:
            b.box('Double entrance doors','door',P(17.065,0,2.45),(.09,2.4,3.50),a)
            for u in [-.59,.59]:
                for z in [1.45,2.35,3.25]:
                    b.box('Door raised panels','dark',P(17.12,u,z),(.07,.91,.67),a)
            for u in [-1.35,1.35]:
                b.box('Door jambs','trim',P(17.14,u,2.48),(.23,.20,3.60),a)
            b.box('Entrance lintels','trim',P(17.14,0,4.35),(.28,2.91,.27),a)
            b.box('Entrance memorial plaque','dark',P(17.10,0,6.0),(.09,2.05,1.10),a)
            for u in [-4.25,4.25]:
                arch(b,'Portico side windows',a,17.04,u,2.1,1.1,6.2)
        else:
            for u in [-4,0,4]:
                arch(b,'West windows',a,17.04,u,2.0,1.2,6.3)
        if k == 0:
            for side in [-1,1]:
                for d in [20.10,21.1]:
                    b.beam('Entrance handrails','door',P(d,side*1.95,.2),P(d,side*1.95,1.3),.055)
                b.beam('Entrance handrails','door',P(20.10,side*1.95,1.3),P(21.1,side*1.95,1.3),.055)
    b.loft('Broad copper nave roof','copper',[(11.80,19.04),(16.35,9.65)])
    roof_seams(b,'Nave copper standing seams',11.80,19.04,16.35,9.65,'copper_seams')
    b.loft('Lantern base flashing','copper',[(16.32,9.80),(16.54,9.8)])
    b.loft('Octagonal clerestory','plaster',[(16.48,9.48),(21.40,9.48)])
    for z,r,h in [(16.5,9.60,.20),(21.14,9.64,.20),(21.38,9.90,.18)]:
        b.loft('Clerestory cornices','trim',[(z,r),(z+h,r)])
    for k in range(8):
        a=k*TAU/8
        for u in [-1.40,0,1.40]:
            arch(b,'Clerestory triple windows',a,8.78,u,17.00,.83,3.05,.085)
        for u in [-3.43,3.43]:
            b.box('Clerestory corner boards','trim',facade_point(a,8.77,u,18.96),(.14,.22,4.65),a)
    b.loft('Upper copper tent roof','upper_roof',[(21.60,10.02),(24.32,3.35),(25.35,2.70)])
    roof_seams(b,'Upper roof seams',21.60,10.02,24.32,3.35,'copper_seams',.7)
    roof_seams(b,'Upper neck seams',24.32,3.35,25.35,2.70,'copper_seams',.5)
    b.loft('White bell and clock tower','plaster',[(25.30,2.65),(30.68,2.65)])
    b.loft('Bell tower foot cornice','trim',[(25.26,2.78),(25.51,2.78)])
    for k in range(8):
        a=k*TAU/8
        arch(b,'Belfry arched louvers',a,2.46,0,25.85,.82,2.65,.075,True)
        round_face(b,'Four tower clocks' if k%2==0 else 'Four round tower windows',a,2.48,29.43,.48,k%2==0)
        p=lambda u,z:facade_point(a,2.46,u,z)
        b.mesh('Eight pointed white tower gables','plaster',[p(-1.02,30.65),p(1.02,30.65),p(0,32.75)],[(0,1,2)])
        for u in [-1.02,1.02]:
            b.beam('Tower gable edge trim','trim',p(u,30.65),p(0,32.75),.08)
    b.loft('Patinated copper spire','patina',[(30.55,2.56),(33.10,1.91),(33.38,1.98),(39.50,.17),(40.10,.09)])
    for z,r in [(32.7,1.995),(33.37,2.02),(34.8,1.56),(36.2,1.13),(37.6,.72),(38.8,.36)]:
        b.loft('Spire copper horizontal seams','upper_roof',[(z,r),(z+.035,r)])
    roof_seams(b,'Spire standing seams',33.40,1.97,39.5,.17,'upper_roof',.8)
    b.loft('Gilded finial globe','gold',[(40.05,.10),(40.16,.28),(40.36,.35),(40.55,.28),(40.66,.1)],20,0)
    b.beam('Gilded cross','gold',(0,0,40.60),(0,0,42.45),.13)
    b.beam('Gilded cross','gold',(-.57,0,41.87),(.57,0,41.87),.13)
    # Copper drainpipes follow actual facade corners without terrain-scale clutter.
    for k in range(8):
        a=k*TAU/8+TAU/16
        x,y=18.58*math.cos(a),18.58*math.sin(a)
        b.beam('Rainwater downpipes','copper',(x,y,.75),(x,y,11.45),.10)
    b.finish()
    return b


def jump(scene):
    b=Builder(scene,'Paradiskullen K90 - editable structure')
    g=TERRAIN['jump']; length=g['length']
    def ground(s,t=0):
        rows=g['samples']; f=(s-rows[0][0]['s'])/2
        i=max(0,min(len(rows)-2,math.floor(f))); f=max(0,min(1,f-i))
        # Samples use app right-of-axis; model +Y is left-of-axis.
        q=max(0,min(40,(-t+40)/2)); j=min(39,math.floor(q)); q-=j
        value=lambda row:row[j]['height']*(1-q)+row[j+1]['height']*q
        return value(rows[i])*(1-f)+value(rows[i+1])*f-g['ground']
    # Photo-derived 35 degree straight inrun blending continuously into an 11
    # degree takeoff. Fit once to the ground, never wiggle the deck with DEM noise.
    transition=52.; slope0=math.tan(math.radians(35)); slope1=math.tan(math.radians(11))
    def drop(s):
        if s<=transition:return s*slope0
        d=s-transition; span=length-transition
        return transition*slope0+slope0*d+(slope1-slope0)*d*d/(2*span)
    start_height=max(ground(s,t)+2.6+drop(s) for s in range(0,87,2) for t in [-3,0,3])
    def deck(s):return start_height-drop(s)
    # +X down the ramp. Model +Y maps to the left of its downhill direction.
    segments=96
    for i in range(segments):
        s0=length*i/segments; s1=length*(i+1)/segments
        z0,z1=deck(s0),deck(s1)
        b.mesh('Continuous curved inrun deck','track',[(s0,-1.55,z0),(s1,-1.55,z1),(s1,1.55,z1),(s0,1.55,z0)],[(0,1,2,3)])
        for side in [-1,1]:
            y=side*1.86
            # Substantial timber parapets with a board-clad underside.
            b.mesh('Timber ramp parapets','timber_light',[(s0,y,z0-.65),(s1,y,z1-.65),(s1,y,z1+.87),(s0,y,z0+.87)],[(0,1,2,3)])
            for zoff in [-.61,-.12,.33,.84]:
                b.beam('Horizontal weatherboard courses','timber', (s0,y+side*.025,z0+zoff),(s1,y+side*.025,z1+zoff),.055,.035)
            b.beam('Ramp coping','timber_dark',(s0,y,z0+.93),(s1,y,z1+.93),.17,.12)
        for y in [-.27,.27]:
            for off in [-.035,.035]:
                b.beam('Twin ceramic ski runners','rail',(s0,y+off,z0+.035),(s1,y+off,z1+.035),.035,.045)
        b.beam('Maintenance walkway','timber',(s0,1.29,z0+.04),(s1,1.29,z1+.04),.46,.07)
    for i in range(49):
        s=length*i/48; z=deck(s)
        for side in [-1,1]:
            b.beam('Parapet uprights','timber_dark',(s,side*1.88,z-.69),(s,side*1.88,z+1.03),.105,.11)
    supports=[0,10,20,30,40,50,60,70,80,length-1]
    for s in supports:
        for side in [-1,1]:
            y=side*1.62; foot=ground(s,y)-.45; top=deck(s)-.67
            b.box('Concrete support footings','granite',(s,y,foot+.30),(1.45,1.20,.60))
            # I-section steel columns and capitals.
            for off in [-.18,.18]:
                b.box('Steel trestle column flanges','steel',(s+off,y,(top+foot)/2),(.07,.40,top-foot))
            b.box('Steel trestle column webs','steel',(s,y,(top+foot)/2),(.34,.07,top-foot))
            b.box('Steel bearing plates','steel',(s,y,top),(.70,.64,.15))
        top=deck(s)-.65
        b.beam('Transverse deck crossbeams','steel',(s,-2.0,top),(s,2.0,top),.25,.37)
        low=max(ground(s,-1.62),ground(s,1.62))+.4
        if top-low>3:
            b.beam('Cross bracing between legs','steel',(s,-1.62,low),(s,1.62,top),.14)
            b.beam('Cross bracing between legs','steel',(s,1.62,low),(s,-1.62,top),.14)
    for s0,s1 in zip(supports,supports[1:]):
        for side in [-1,1]:
            y=side*1.62
            b.beam('Longitudinal ramp girders','steel',(s0,y,deck(s0)-.65),(s1,y,deck(s1)-.65),.24,.56)
            if s0<50:
                b.beam('Trestle diagonal braces','steel',(s0,y,ground(s0,y)+1.0),(s1,y,deck(s1)-.90),.16)
    # Elevated rectangular start house with boarded walls and glazed upper band.
    floor=deck(0)+.20
    b.box('Start house floor','steel',(-2.60,0,floor-.2),(6.3,5.5,.4))
    b.box('Timber start house','timber_dark',(-2.70,0,floor+2.70),(6.0,5.25,5.40))
    b.box('Start house overhanging roof','dark',(-2.70,0,floor+5.56),(6.9,6.10,.27))
    for x in [-5.7,.3]:
        for j in range(27):
            y=-2.59+j*.20
            b.box('Start house vertical cladding','timber',(x,y,floor+2.60),(.045,.06,5.18))
        for y in [-1.98,-.67,.67,1.98]:
            b.box('Start house upper windows','glass',(x+(.035 if x>0 else -.035),y,floor+4.05),(.045,1.16,1.22))
    for side in [-1,1]:
        y=side*2.64
        for j in range(30):
            x=-5.58+j*.195
            b.box('Start house side cladding','timber',(x,y,floor+2.6),(.055,.055,5.18))
        for x in [-4.7,-3.4,-2.1,-.8]:
            b.box('Start house side windows','glass',(x,y+side*.035,floor+4.05),(1.14,.06,1.22))
    b.box('Start gate doorway','dark',(.345,0,floor+1.10),(.06,1.2,2.2))
    for y in [-.65,.65]:
        b.box('Start gate door jambs','steel',(.39,y,floor+1.14),(.07,.08,2.32))
    for x in [-5.10,-.15]:
        for y in [-2.05,2.05]:
            low=ground(x,y)-.40
            b.box('Tower concrete foundations','granite',(x,y,low+.3),(1.8,1.6,.6))
            b.beam('Start tower main columns','steel',(x,y,low),(x,y,floor-.40),.44,.50)
        for z in range(4,int(floor)-1,6):
            b.beam('Tower horizontal braces','steel',(x,-2.05,z),(x,2.05,z),.20)
            b.beam('Tower cross bracing','steel',(x,-2.05,z-5),(x,2.05,z),.17)
            b.beam('Tower cross bracing','steel',(x,2.05,z-5),(x,-2.05,z),.17)
    # Flight-by-flight steel access stair beside the upper trestles.
    levels=max(2,math.ceil((floor-ground(0,3.2))/3.2))
    bottom=ground(0,3.2)+.3
    for i in range(levels):
        z0=bottom+(floor-bottom)*i/levels; z1=bottom+(floor-bottom)*(i+1)/levels
        x0,x1=(-5.3,1.0) if i%2==0 else (1.0,-5.3)
        y=3.48
        steps=18
        for j in range(steps):
            x=x0+(x1-x0)*(j+.5)/steps; z=z0+(z1-z0)*(j+1)/steps
            b.box('Access stair treads','steel',(x,y,z),(.37,1.18,.08))
        for side in [-1,1]:
            yy=y+side*.65
            b.beam('Stair stringers','steel',(x0,yy,z0-.1),(x1,yy,z1-.1),.12,.22)
            b.beam('Stair handrails','rail',(x0,yy,z0+1.02),(x1,yy,z1+1.02),.045)
            for j in range(5):
                t=j/4; x=x0+(x1-x0)*t; z=z0+(z1-z0)*t
                b.beam('Stair balusters','rail',(x,yy,z),(x,yy,z+1.04),.042)
        b.box('Stair landings','steel',(x1,y,z1),(1.5,1.6,.12))
    # Start platform, timing hut and lamps visible in the reference side view.
    for s in [22,45,67]:
        z=deck(s)
        b.beam('Inrun lamp poles','steel',(s,-2.03,z),(s,-2.03,z+4.0),.08)
        b.beam('Inrun lamp arms','steel',(s,-2.03,z+4.0),(s,-.15,z+4.50),.06)
        b.box('Inrun lamp heads','rail',(s,-.10,z+4.47),(.50,.26,.18))
    b.box('Timing equipment platform','steel',(23,-3.0,deck(23)-.05),(5.0,2.3,.20))
    for s in [20.7,25.3]:
        for y in [-4.05,-2.05]:
            b.beam('Platform rail uprights','steel',(s,y,deck(23)),(s,y,deck(23)+1.1),.055)
    b.beam('Platform rail','rail',(20.7,-4.05,deck(23)+1.1),(25.3,-4.05,deck(23)+1.1),.05)
    for s,h in [(21.6,7.0),(24.3,5.0)]:
        b.beam('Timing antenna poles','steel',(s,-3.7,deck(23)),(s,-3.7,deck(23)+h),.065)
        b.box('Timing aerials','dark',(s,-3.7,deck(23)+h),(.14,.15,.70))
    # The landing and outrun use their OWN mapped polygon, not an invented
    # extension of the inrun rectangle. Dense rows follow the sampled hillside.
    surroundings=json.loads((ROOT/'geobuild/surroundings.json').read_text(encoding='utf-8'))
    source=next(p for p in surroundings['pistes'] if p['id']=='w370784603')
    dx,dz=g['direction']; ax,az=g['start']
    ring=[((x-ax)*dx+(z-az)*dz,(x-ax)*dz-(z-az)*dx) for x,z in source['ring']]
    def edges(s):
        ys=[]
        for (x,y),(xx,yy) in zip(ring,ring[1:]+ring[:1]):
            if (x<=s<xx) or (xx<=s<x):ys.append(y+(yy-y)*(s-x)/(xx-x))
        return min(ys),max(ys)
    start=min(p[0] for p in ring)+.06; finish=max(p[0] for p in ring)-.02
    def surface(s,y):return ground(s,y)+.30
    stations=sorted(set([start,finish]+[p[0] for p in ring if start<p[0]<finish]+
                        [float(s) for s in range(math.ceil(start),math.floor(finish)+1)]))
    for i,(s0,s1) in enumerate(zip(stations,stations[1:])):
        l0,r0=edges(s0); l1,r1=edges(s1)
        for j in range(12):
            u,v=j/12,(j+1)/12
            y0=l0+(r0-l0)*u; y1=l0+(r0-l0)*v
            y2=l1+(r1-l1)*v; y3=l1+(r1-l1)*u
            b.mesh('Mapped green landing and outrun','landing' if j%3 else 'landing_alt',
                   [(s0,y0,surface(s0,y0)),(s1,y3,surface(s1,y3)),
                    (s1,y2,surface(s1,y2)),(s0,y1,surface(s0,y1))],[(0,1,2,3)])
        for y0,y1 in [(l0,l1),(r0,r1)]:
            z0,z1=surface(s0,y0),surface(s1,y1)
            b.mesh('Landing timber retaining barriers','timber_light',
                   [(s0,y0,z0-.45),(s1,y1,z1-.45),(s1,y1,z1+1.05),(s0,y0,z0+1.05)],[(0,1,2,3)])
            b.beam('Landing barrier top rails','timber',(s0,y0,z0+1.08),(s1,y1,z1+1.08),.10)
            if i%3==0:
                b.beam('Landing barrier posts','timber_dark',(s0,y0,z0-.50),(s0,y0,z0+1.17),.12)
    # Transverse distance lines and the K-point side stripes are geometry, so no
    # reference photograph is redistributed as a texture.
    for s in range(116,231,8):
        l,r=edges(s); width=(r-l)*.36
        for j in range(12):
            y0=-width+2*width*j/12; y1=-width+2*width*(j+1)/12
            b.mesh('Landing distance markings','markings',
                   [(x,y,surface(x,y)+.022) for x,y in [(s,y0),(s+.16,y0),(s+.16,y1),(s,y1)]],[(0,1,2,3)])
    for s in range(180,195):
        l,r=edges(s)
        for y in [l+.45,r-.95]:
            b.mesh('K-point side bands','red_markings',
                   [(x,yy,surface(x,yy)+.026) for x,yy in [(s,y),(s+1,y),(s+1,y+.50),(s,y+.50)]],[(0,1,2,3)])
    # Lattice floodlights down the left edge, with the two poles visible in the
    # supplied front view. Additional local lamps along the inrun are above.
    for s,y,h in [(110,-10,23),(175,-14,26),(240,15,22)]:
        low=ground(s,y)-.2
        b.box('Floodlight concrete pads','granite',(s,y,low+.2),(2,2,.5))
        corners=[(-.62,-.62),(.62,-.62),(.62,.62),(-.62,.62)]
        for xoff,yoff in corners:
            b.beam('Floodlight lattice columns','steel',(s+xoff,y+yoff,low),(s+xoff*.63,y+yoff*.63,low+h),.11)
        for z in range(0,h-2,3):
            for (x0,y0),(x1,y1) in zip(corners,corners[1:]+corners[:1]):
                b.beam('Floodlight lattice diagonals','steel',(s+x0,y+y0,low+z),(s+x1,y+y1,low+z+3),.055)
        b.beam('Floodlight head gantry','steel',(s,y-1.8,low+h),(s,y+1.8,low+h),.16)
        for off in [-1.25,-.42,.42,1.25]:
            b.box('Floodlight housings','dark',(s+.10,y+off,low+h-.2),(.55,.64,.72))
            b.box('Floodlight glass','rail',(s+.395,y+off,low+h-.2),(.03,.52,.55))
    # Three-storey judges tower: facade proportions from the supplied front
    # reference; its lateral placement is an estimate, not an OSM building.
    s,y=139,-27; low=ground(s,y)-.35
    b.box('Judges tower concrete plinth','granite',(s,y,low+.45),(5.7,5.3,.90))
    b.box('Judges timber tower','timber_dark',(s,y,low+5.75),(5.5,5.1,10.70))
    b.box('Judges flat overhanging roof','dark',(s,y,low+11.22),(6.1,5.75,.26))
    for z in [2.5,5.65,8.8]:
        for off in [-1.8,-.6,.6,1.8]:
            b.box('Judges observation windows','glass',(s+2.78,y+off,low+z),(.045,1.02,1.80))
            for yy in [off-.55,off+.55]:
                b.box('Judges window frames','trim',(s+2.83,y+yy,low+z),(.065,.06,1.93))
            for zz in [z-.94,z+.94]:
                b.box('Judges window frames','trim',(s+2.83,y+off,low+zz),(.065,1.16,.07))
    for off in [-2.6,2.6]:
        b.box('Judges corner boards','timber_light',(s+2.80,y+off,low+5.6),(.08,.11,10.8))
    # The mapped railway crosses OVER the outrun. The old terrain-following
    # ballast strips sagged through it. Model the two bridge spans between
    # their mapped abutments, including rails, sleepers, girders and parapets.
    raw=(ROOT/'apps/golf/public/courses/veckefjarden/pack.bin').read_bytes()
    header_length=int.from_bytes(raw[4:8],'little')
    header=json.loads(raw[8:8+header_length])
    vector_offset=8+header_length+header['HF0']['bytes']+header['HF1']['bytes']
    model=json.loads(zlib.decompress(raw[vector_offset:],-15))
    bridge_ids=['w75298818','w75298820']
    bridges=[r for r in model['infra']['railway'] if r.get('id') in bridge_ids]
    assert len(bridges)==2
    for bridge in bridges:
        def local(p):
            x,z=p[0]-ax,p[1]-az
            return Vector((x*dx+z*dz,x*dz-z*dx,0))
        a,c=local(bridge['line'][0]),local(bridge['line'][-1])
        a.z=ground(a.x,a.y)+.14; c.z=ground(c.x,c.y)+.14
        along=c-a; along.z=0; along.normalize()
        across=Vector((-along.y,along.x,0))
        def P(t,off=0,lift=0):return a.lerp(c,t)+across*off+Vector((0,0,lift))
        b.mesh('Railway bridge concrete slabs','granite',
               [tuple(P(t,off,z)) for z in [-1.20,-.10] for t,off in [(0,-2.05),(1,-2.05),(1,2.05),(0,2.05)]],
               [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
        b.mesh('Railway bridge ballast','ballast',[tuple(P(t,off)) for t,off in [(0,-1.95),(1,-1.95),(1,1.95),(0,1.95)]],[(0,1,2,3)])
        for off in [-.75,.75]:
            b.beam('Railway bridge rails','rail',P(0,off,.20),P(1,off,.20),.065,.12)
        count=round((c-a).length/.75)
        for i in range(count+1):
            t=i/count
            b.beam('Railway sleepers','timber_dark',P(t,-1.3,.07),P(t,1.3,.07),.17,.13)
        # Only the two OUTSIDE parapets; tracks share their inner edge.
        outer=2.05 if bridge['id']=='w75298818' else -2.05
        b.beam('Railway concrete parapets','granite',P(0,outer,.22),P(1,outer,.22),.22,.6)
        b.beam('Railway safety handrails','steel',P(0,outer,.97),P(1,outer,.97),.055)
        for i in range(26):
            t=i/25
            b.beam('Railway safety rail posts','steel',P(t,outer,.38),P(t,outer,.98),.05)
        # Retaining piers stand either side of the landing, never on its mat.
        for y_side in [-13,14]:
            t=(y_side-a.y)/(c.y-a.y)
            p=P(t); low=ground(p.x,p.y)-.40
            b.box('Railway bridge abutments','granite',(p.x,p.y,(low+p.z-1.2)/2),(4.0,1.5,p.z-1.2-low))
        for t in [.06,.94]:
            p=P(t,outer+(.75 if outer>0 else -.75))
            b.beam('Bridge overhead line masts','steel',p,p+Vector((0,0,7.2)),.12)
            b.beam('Bridge catenary arms','steel',p+Vector((0,0,6.6)),P(t,0,6.6),.08)
        b.beam('Bridge overhead wires','dark',P(0,0,6.4),P(1,0,6.4),.03)
    profile_extra={'landingSourceId':source['id'],'landingRing':source['ring'],
                   'landingStations':[start,finish],'judgesTowerPlacement':'photo-estimated',
                   'bridgeSourceIds':bridge_ids}
    b.finish()
    return b, {'startDeckMetresAboveAnchor':start_height,'takeoffMetresAboveAnchor':deck(length),
               'profile':'35 degree straight; continuous quadratic transition to 11 degree takeoff',
               'supportStations':supports,**profile_extra}


def export_asset(scene,builder,node_name,filename,angle=0):
    # Export copies merged by material; keep authored components editable.
    coll=bpy.data.collections.new(PREFIX+'TEMP export');scene.collection.children.link(coll)
    root=bpy.data.objects.new(node_name,None);coll.objects.link(root)
    root.rotation_euler.z=angle
    root['landmark_id']=node_name
    meshes=[]
    for mat in builder.materials.values():
        originals=[o for o in builder.objects if o.data.materials[0]==mat]
        if not originals:continue
        vertices=[];faces=[]
        for o in originals:
            offset=len(vertices)
            vertices.extend(tuple(v.co) for v in o.data.vertices)
            faces.extend(tuple(offset+i for i in p.vertices) for p in o.data.polygons)
        data=bpy.data.meshes.new(node_name+' '+mat.name.split(' ')[-1]);data.from_pydata(vertices,[],faces);data.update()
        data.materials.append(mat)
        obj=bpy.data.objects.new(data.name,data);coll.objects.link(obj);obj.parent=root
        meshes.append(obj)
    for obj in scene.objects:obj.select_set(False)
    root.select_set(True)
    for obj in meshes:obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    OUT.mkdir(parents=True,exist_ok=True)
    path=OUT/filename
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
                             export_yup=True,export_extras=True,export_cameras=False,
                             export_lights=False,export_animations=False)
    scene.view_layers.update()
    bounds=[root.matrix_world @ Vector(p) for obj in meshes for p in obj.bound_box]
    # Blender world -> exported glTF: X, Z, -Y.
    points=[(v.x,v.z,-v.y) for v in bounds]
    report={'url':'models/veckefjarden/'+filename,'bytes':path.stat().st_size,
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'meshes':len(meshes),'triangles':sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in meshes),
            'bounds':{'min':[min(p[i] for p in points) for i in range(3)],
                      'max':[max(p[i] for p in points) for i in range(3)]}}
    for obj in [*meshes,root]:
        data=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
        if data and data.users==0:bpy.data.meshes.remove(data)
    bpy.data.collections.remove(coll)
    return report


def render_preview(scene,builder,filename,target,offset,scale):
    for collection in scene.collection.children:
        collection.hide_render=collection!=builder.collection
    rig=bpy.data.collections.new(PREFIX+'Preview rig');scene.collection.children.link(rig)
    camera_data=bpy.data.cameras.new(PREFIX+'Preview camera')
    camera=bpy.data.objects.new(camera_data.name,camera_data);rig.objects.link(camera)
    camera.location=Vector(target)+Vector(offset)
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type='ORTHO';camera_data.ortho_scale=scale;scene.camera=camera
    light_data=bpy.data.lights.new(PREFIX+'Preview sun','SUN');light_data.energy=3.;light_data.angle=.12
    light=bpy.data.objects.new(light_data.name,light_data);rig.objects.link(light)
    light.rotation_euler=(math.radians(28),math.radians(-24),math.radians(-35))
    area_data=bpy.data.lights.new(PREFIX+'Preview fill','AREA');area_data.energy=2400;area_data.shape='DISK';area_data.size=50
    area=bpy.data.objects.new(area_data.name,area_data);rig.objects.link(area);area.location=(20,-35,50)
    area.rotation_euler=(Vector(target)-area.location).to_track_quat('-Z','Y').to_euler()
    scene.world=bpy.data.worlds.new(PREFIX+'Studio');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.22,.28,.32,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
    scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True
    scene.render.resolution_x=1500;scene.render.resolution_y=1300;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
    scene.view_settings.view_transform='AgX'
    scene.render.filepath=str(HERE/filename)
    bpy.ops.render.render(write_still=True)
    for collection in scene.collection.children:collection.hide_render=False
    rig.hide_render=True


def build():
    # Reruns may replace only our exact scene and namespaced object data.
    previous=bpy.data.scenes.get(SCENE)
    if previous:
        for obj in list(previous.objects):
            if not obj.name.startswith(PREFIX):
                raise RuntimeError('Generated scene contains user objects; preserve it and choose a new scene name')
        collections=list(previous.collection.children)
        for obj in list(previous.objects):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.scenes.remove(previous)
        for coll in collections:
            if coll.users==0:bpy.data.collections.remove(coll)
    # Clean only this generator's orphan data, including remnants from preview
    # rigs. Other scenes and shared data blocks retain their existing users.
    for blocks in [bpy.data.meshes,bpy.data.materials,bpy.data.cameras,bpy.data.lights,bpy.data.worlds]:
        for block in list(blocks):
            if block.name.startswith(PREFIX) and block.users==0:blocks.remove(block)
    before={s.name:sorted(o.name for o in s.objects) for s in bpy.data.scenes}
    scene=bpy.data.scenes.new(SCENE);scene.unit_settings.system='METRIC'
    scene['model_evidence']='Internet photo references; see README.md. Not survey-grade dimensions.'
    bpy.context.window.scene=scene
    church_builder=church(scene)
    jump_builder,profile=jump(scene)
    manifest={'schemaVersion':1,'courseSlugs':['veckefjarden','veckefjarden-korthalsbanan'],
              'coordinateFrame':'legacy-local-ground-relative','landmarks':[]}
    for builder,ident,node,filename,anchor,angle,extra in [
        (church_builder,'w104048726','sjalevads-kyrka','sjalevads-kyrka-v1.glb',TERRAIN['church']['anchor'],math.radians(5),{}),
        (jump_builder,'w70606159','paradiskullen-k90','paradiskullen-k90-v1.glb',TERRAIN['jump']['start'],
         -math.atan2(TERRAIN['jump']['direction'][1],TERRAIN['jump']['direction'][0]),profile),
    ]:
        asset=export_asset(scene,builder,node,filename,angle)
        manifest['landmarks'].append({'id':ident,'nodeName':node,'anchor':anchor,'asset':asset,
                                     'heightStatus':'photo-estimated','profile':extra})
    (OUT/'landmarks-v1.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    assert before=={s.name:sorted(o.name for o in s.objects) for s in bpy.data.scenes if s!=scene},'Existing scene changed'
    # Native project includes both editable component collections. Preview rigs
    # are separate and never exported to the application.
    render_preview(scene,church_builder,'sjalevads-kyrka-preview.png',(0,0,20),(65,-85,42),66)
    render_preview(scene,jump_builder,'paradiskullen-preview.png',(36,0,11),(50,-95,42),110)
    render_preview(scene,jump_builder,'paradiskullen-full-preview.png',(150,0,-27),(200,-80,90),330)
    scene.camera=None
    # Lay out the two independent models side by side in the editable project.
    # The exported GLBs above retain their local origin and course orientation.
    for obj in church_builder.objects:obj.location.x=-65
    for obj in scene.objects:obj.select_set(False)
    for obj in church_builder.objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=church_builder.objects[0]
    old_versions=bpy.context.preferences.filepaths.save_version
    try:
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'veckefjarden-landmarks.blend'),copy=True)
    finally:bpy.context.preferences.filepaths.save_version=old_versions
    print(json.dumps({'manifest':manifest,'blend':str(HERE/'veckefjarden-landmarks.blend'),
                      'preservedScenes':list(before)},ensure_ascii=False))


if __name__=='__main__':build()
