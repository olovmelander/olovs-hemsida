"""Observed Angso ancillary architecture and campus fittings.

All plan geometry uses the April 2025 orthophoto in the reference pack. Heights
use the 2021 laser supports where reliable. Unseen walls and structural details
are deliberately modest reconstructions, recorded in the build report. Nothing
from the proposed 41 m range/studio development is represented as completed.

build(ctx) is called by build_facility_models.py in Blender. Repeated construction
details are batched by material inside each independently exported facility.
"""
import math
from statistics import median


def _frame(ring):
    """Fit a rectangle along the longest measured roof edge, not world axes."""
    points = [tuple(p[:2]) for p in ring]
    if points[0] == points[-1]:
        points.pop()
    a, b = max(zip(points, points[1:] + points[:1]),
               key=lambda pair: math.dist(*pair))
    angle = math.atan2(b[1] - a[1], b[0] - a[0])
    # Deterministic positive east direction makes facade orientation explicit.
    if math.cos(angle) < 0:
        angle += math.pi
    c, s = math.cos(angle), math.sin(angle)
    us = [x*c+y*s for x, y in points]
    vs = [-x*s+y*c for x, y in points]
    u, v = (min(us)+max(us))/2, (min(vs)+max(vs))/2
    return (u*c-v*s, u*s+v*c, max(us)-min(us), max(vs)-min(vs), angle)


class Parts:
    """Small indexed-mesh accumulator; no dependency on Blender operators."""
    def __init__(self, ctx, fid, frame):
        self.ctx, self.fid, self.frame, self.groups = ctx, fid, frame, {}
        self.cx, self.cy, self.length, self.width, self.angle = frame
        self.c, self.s = math.cos(self.angle), math.sin(self.angle)

    def point(self, u, v, z):
        return self.cx+self.c*u-self.s*v, self.cy+self.s*u+self.c*v, z

    def add(self, mat, points, faces):
        vertices, indices = self.groups.setdefault(mat, ([], []))
        first = len(vertices)
        vertices.extend(points)
        indices.extend(tuple(first+i for i in face) for face in faces)

    def box(self, u, v, z, length, width, height, mat):
        assert min(length, width, height) > 0, (self.fid, length, width, height)
        points = [self.point(u+x, v+y, z+h)
                  for h in (-height/2, height/2)
                  for x, y in [(-length/2, -width/2), (length/2, -width/2),
                               (length/2, width/2), (-length/2, width/2)]]
        self.add(mat, points, [(0,3,2,1),(4,5,6,7),(0,1,5,4),
                              (1,2,6,5),(2,3,7,6),(3,0,4,7)])

    def beam(self, a, b, width, depth, mat):
        a, b = self.point(*a), self.point(*b)
        axis = tuple(b[i]-a[i] for i in range(3))
        length = math.sqrt(sum(v*v for v in axis))
        if length < .0001:
            return
        axis = tuple(v/length for v in axis)
        ref = (0., 0., 1.) if abs(axis[2]) < .9 else (1., 0., 0.)
        cross = lambda a,b: (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
        right = cross(axis, ref)
        scale = math.sqrt(sum(v*v for v in right))
        right = tuple(v/scale for v in right)
        up = cross(axis, right)
        points = [tuple(p[i]+r*width/2*right[i]+t*depth/2*up[i] for i in range(3))
                  for p in (a,b) for r,t in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        self.add(mat, points, [(0,3,2,1),(4,5,6,7),(0,1,5,4),
                              (1,2,6,5),(2,3,7,6),(3,0,4,7)])

    def cylinder(self, u, v, z, radius, height, mat, n=10):
        points = [self.point(u+radius*math.cos(i*math.tau/n),
                             v+radius*math.sin(i*math.tau/n), z+h)
                  for h in (-height/2,height/2) for i in range(n)]
        faces = [tuple(reversed(range(n))),tuple(range(n,n*2))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        self.add(mat, points, faces)

    def roof_plane(self, height_at, material, thickness=.12, seams=.55):
        corners = [(-self.length/2,-self.width/2),
                   (self.length/2,-self.width/2),
                   (self.length/2,self.width/2),(-self.length/2,self.width/2)]
        verts = [self.point(u,v,height_at(u,v)+dz)
                 for dz in (-thickness,0) for u,v in corners]
        self.add(material, verts, [(0,3,2,1),(4,5,6,7),(0,1,5,4),
                                    (1,2,6,5),(2,3,7,6),(3,0,4,7)])
        for i in range(int(self.length/seams)+1):
            u = -self.length/2+i*seams
            self.beam((u,-self.width/2,height_at(u,-self.width/2)+.012),
                      (u,self.width/2,height_at(u,self.width/2)+.012),
                      .022,.025,'roof_seam' if material != 'roof_tile' else 'tile_detail')
        for v in (-self.width/2,self.width/2):
            self.beam((-self.length/2,v,height_at(-self.length/2,v)-.08),
                      (self.length/2,v,height_at(self.length/2,v)-.08),.12,.18,'white')
        for u in (-self.length/2,self.length/2):
            self.beam((u,-self.width/2,height_at(u,-self.width/2)-.08),
                      (u,self.width/2,height_at(u,self.width/2)-.08),.12,.18,'white')

    def roof_gable(self, eave, ridge, material='roof_dark', wall=None):
        l,w = self.length/2,self.width/2
        for sign in (-1,1):
            coords = [(-l,sign*w,eave),(l,sign*w,eave),(l,0,ridge),(-l,0,ridge)]
            verts = [self.point(u,v,z+dz) for dz in (-.12,0) for u,v,z in coords]
            self.add(material,verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),
                                     (1,2,6,5),(2,3,7,6),(3,0,4,7)])
            for i in range(int(self.length/.52)+1):
                u=-l+i*.52
                self.beam((u,sign*w,eave+.017),(u,0,ridge+.017),.022,.025,
                          'tile_detail' if material=='roof_tile' else 'roof_seam')
            self.beam((-l,sign*w,eave-.06),(l,sign*w,eave-.06),.14,.18,'white')
        self.beam((-l,0,ridge+.025),(l,0,ridge+.025),.16,.12,material)
        for u in (-l,l):
            self.beam((u,-w,eave-.04),(u,0,ridge-.04),.14,.18,'white')
            self.beam((u,0,ridge-.04),(u,w,eave-.04),.14,.18,'white')
            if wall:
                self.add(wall,[self.point(u*.987,-w+.22,eave-.10),
                               self.point(u*.987,w-.22,eave-.10),
                               self.point(u*.987,0,ridge-.17)],[(0,1,2)])

    def opening(self,u,side,z,width,height,door=False,glass=True):
        v=side*(self.width/2-.205)
        self.box(u,v,z,width+.16,.12,height+.16,'white')
        self.box(u,v+side*.072,z,width,.035,height,'glass' if glass else 'door_grey')
        if not door and glass:
            self.box(u,v+side*.095,z,.055,.04,height,'white')
            self.box(u,v+side*.095,z,width,.04,.055,'white')
        if door:
            self.box(u+width*.30,v+side*.105,z,.06,.06,.15,'metal')

    def posts(self, eave_at, floor, bays, rear=True, front=True):
        for i in range(bays+1):
            u=(-self.length/2+.35)+(self.length-.7)*i/bays
            for side in ((-1,1) if rear and front else (-1,) if front else (1,)):
                v=side*(self.width/2-.3)
                top=eave_at(u,v)-.16
                self.box(u,v,(floor+top)/2,.16,.16,top-floor,'wood_light')
                self.box(u,v,floor+.035,.30,.30,.14,'foundation')
                self.beam((u,v,top-.45),(u+(.40 if i<bays else -.40),v,top),.08,.09,'wood_light')

    def walls(self, floor, eave, material='red', half_open=False, batten=True):
        l,w=self.length-.50,self.width-.50
        self.box(0,0,floor-.10,l,w,.28,'foundation')
        for sign in (-1,1):
            h=(eave-floor-.10)*(.52 if half_open and sign==-1 else 1)
            self.box(0,sign*w/2,floor+h/2,l,.13,h,material)
            if batten:
                for i in range(int(l/.35)+1):
                    self.box(-l/2+i*.35,sign*(w/2+.079),floor+h/2,.042,.028,h,'red_batten')
        for sign in (-1,1):
            h=eave-floor-.10
            self.box(sign*l/2,0,floor+h/2,.13,w,h,material)
        for u in (-l/2,l/2):
            for v in (-w/2,w/2):
                self.box(u,v,(floor+eave)/2,.15,.15,eave-floor,'white')

    def bench(self,u,v,floor,length=1.65):
        for d in (-.135,0,.135):
            self.box(u,v+d,floor+.46,length,.11,.055,'wood_light')
        for d in (-length*.34,length*.34):
            self.box(u+d,v,floor+.24,.085,.37,.43,'metal')
        for z in (.73,.89):
            self.box(u,v+.235,floor+z,length,.06,.115,'wood_light')
        for d in (-length*.34,length*.34):
            self.box(u+d,v+.23,floor+.67,.055,.055,.47,'metal')

    def table(self,u,v,floor):
        self.box(u,v,floor+.74,1.45,.78,.075,'wood_light')
        for du in (-.49,.49):
            self.box(u+du,v,floor+.36,.09,.60,.72,'metal')
        for side in (-1,1):
            self.box(u,v+side*.69,floor+.45,1.5,.31,.06,'wood_light')
            for du in (-.49,.49):
                self.box(u+du,v+side*.69,floor+.23,.08,.24,.43,'metal')

    def flush(self):
        counts={'vertices':0,'triangles':0,'meshes':0}
        for material,(vertices,faces) in self.groups.items():
            self.ctx.mesh(f'{self.fid} | {material}',vertices,faces,material)
            counts['vertices']+=len(vertices)
            counts['triangles']+=sum(len(f)-2 for f in faces)
            counts['meshes']+=1
        return counts


def _roof_height(record, parts):
    plane=record['planes'][0]['coefficientsLocalEN']
    ox,oy=record['originBlenderXY']
    def height(u,v):
        x,y,_=parts.point(u,v,0)
        return plane[0]*(x-ox)+plane[1]*(y-oy)+plane[2]-8.0
    return height


def _base(ctx, fid, frame):
    cx,cy,l,w,a=frame
    c,s=math.cos(a),math.sin(a)
    samples=[ctx.ground(cx+c*u-s*v,cy+s*u+c*v)
             for u in (-l*.42,0,l*.42) for v in (-w*.40,0,w*.40)]
    # Floors are level. A shallow foundation joins small terrain undulations.
    return median(samples)+.10, min(samples)


def _campus_pixel(point):
    return -95.12+point[0]*.16,150.08-point[1]*.16


def _surface(ctx,name,pixels,mat='campus_gravel',lift=.12):
    return ctx.drape(name,[_campus_pixel(p) for p in pixels],mat,lift)


def _path(ctx,name,pixels,width,material='campus_gravel'):
    points=[_campus_pixel(p) for p in pixels]
    normals=[]
    for a,b in zip(points,points[1:]):
        dx,dy=b[0]-a[0],b[1]-a[1]
        length=math.hypot(dx,dy)
        assert length>1e-5, name+' duplicated path centerline point'
        normals.append((-dy/length,dx/length))
    left,right=[],[]
    for i,(x,y) in enumerate(points):
        if i==0:
            mx,my=normals[0];scale=width/2
        elif i==len(points)-1:
            mx,my=normals[-1];scale=width/2
        else:
            previous,following=normals[i-1],normals[i]
            mx,my=previous[0]+following[0],previous[1]+following[1]
            length=math.hypot(mx,my)
            assert length>.01, name+' reversing path segment'
            mx,my=mx/length,my/length
            # The offset edges meet on the angle bisector. A single polygon
            # closes the wedges that disconnected segment rectangles leave.
            cosine=mx*previous[0]+my*previous[1]
            scale=min(width,(width/2)/max(.1,cosine))
        left.append((x+mx*scale,y+my*scale))
        right.append((x-mx*scale,y-my*scale))
    ctx.drape(name,left+list(reversed(right)),material,.12)


def build(ctx):
    for name,color,roughness,metal in [
        ('wood_light',(.48,.35,.20),.88,0),('tile_detail',(.27,.105,.066),.85,0),
        ('campus_gravel',(.40,.39,.34),.97,0),('range_paving',(.47,.39,.30),.93,0),
        ('mat_rubber',(.055,.074,.059),.93,0),('range_turf',(.075,.28,.075),.95,0),
        ('door_grey',(.33,.36,.34),.75,0),('roof_silver',(.61,.64,.63),.58,.35),
        ('service_cladding',(.36,.38,.35),.82,.1),('charging_orange',(.78,.28,.06),.66,0),
        ('charging_green',(.14,.35,.27),.65,0),('cart_body',(.72,.74,.67),.6,.08),
        ('cart_seat',(.16,.18,.15),.83,0),('notice_cream',(.82,.80,.68),.85,0)]:
        ctx.material(name,color,roughness,metal)
    result={'scope':'April 2025 observed facilities; no proposed range/studio',
            'coordinateOrigin':[605530,6605140,8], 'facilities':[], 'site':[]}

    for fid in ('B05','B06','B07','B08','B09','B10','B11','B12','B13'):
        ctx.begin_facility(fid)
        record=ctx.height(fid)
        frame=_frame(ctx.ring(fid))
        p=Parts(ctx,fid,frame)
        floor,lowest=_base(ctx,fid,frame)
        h=_roof_height(record,p)
        notes=[]
        p.box(0,0,(floor+lowest-.18)/2,p.length-.55,p.width-.55,
              floor-lowest+.18,'foundation')

        if fid in ('B05','B06'):
            p.roof_plane(h,'roof_tile',.12,.43)
            p.posts(h,floor,2)
            for v in (-p.width/2+.3,p.width/2-.3):
                p.beam((-p.length/2+.25,v,h(-p.length/2+.25,v)-.20),
                       (p.length/2-.25,v,h(p.length/2-.25,v)-.20),.14,.18,'wood_light')
            for u in (-p.length*.25,p.length*.25):
                p.table(u,0,floor)
            notes.append('Open canopy construction and picnic tables are conservative interpretations; roof plane follows low laser support.')

        elif fid=='B07':
            p.roof_plane(h,'roof_tile',.12,.48)
            bays=6
            p.posts(h,floor,bays)
            # Orient the open face toward the road, west of the carport.
            road_side=-1 if -p.s>0 else 1
            back=-road_side
            for u in [-p.length/2+.32+i*.35 for i in range(int((p.length-.6)/.35)+1)]:
                v=back*(p.width/2-.3)
                top=h(u,v)-.16
                p.box(u,v,(floor+top)/2,.30,.08,top-floor,'red')
            for v in (-p.width/2+.3,p.width/2-.3):
                p.beam((-p.length/2+.3,v,h(-p.length/2+.3,v)-.22),
                       (p.length/2-.3,v,h(p.length/2-.3,v)-.22),.17,.19,'wood_light')
            # Three parked carts establish scale while preserving the open bays.
            for i in (0,2,4):
                u=-p.length/2+(i+.5)*p.length/bays
                v=0
                p.box(u,v,floor+.49,1.04,2.04,.23,'cart_body')
                p.box(u,v+.15*back,floor+.91,.88,.45,.16,'cart_seat')
                p.box(u,v+.43*back,floor+1.12,.88,.14,.46,'cart_seat')
                p.box(u,v,floor+1.80,1.10,1.78,.09,'cart_body')
                for du in (-.47,.47):
                    for dv in (-.73,.73):
                        p.box(u+du,v+dv,floor+.28,.21,.39,.40,'mat_rubber')
                        p.box(u+du,v+dv*.76,floor+1.25,.045,.045,1.05,'metal')
            notes.append('Cart use documented by club map; six structural bays and three sample carts are scale reconstructions, not a current fleet inventory.')

        elif fid=='B08':
            eave=min(h(u,v) for u in (-p.length/2,p.length/2)
                     for v in (-p.width/2,p.width/2))-.12
            p.walls(floor,eave)
            p.roof_plane(h,'roof_dark',.13,.6)
            side=-1 if -p.s>0 else 1
            p.opening(-p.length*.15,side,floor+1.45,2.25,1.15)
            p.box(-p.length*.15,side*(p.width/2-.10),floor+.90,2.60,.35,.10,'white')
            p.opening(p.length*.32,side,floor+1.02,.84,1.94,True,False)
            p.opening(-p.length*.23,-side,floor+1.02,.84,1.94,True,False)
            p.opening(p.length*.23,-side,floor+1.02,.84,1.94,True,False)
            notes.append('Kiosk/toilets identity from club diagram; opening spacing and concealed sanitary doors approximate. Roof follows near-flat laser plane.')

        elif fid=='B09':
            ridge=median(record['candidateGableRidges'][0]['heightsRH2000'])-8
            eave=ridge-math.tan(math.radians(33.4))*p.width/2
            p.walls(floor,eave,half_open=True)
            p.roof_gable(eave,ridge,'roof_dark','red')
            for u in (-p.length*.39,0,p.length*.39):
                p.box(u,-p.width/2+.26,(floor+eave)/2,.13,.13,eave-floor,'white')
            p.beam((-p.length*.45,-p.width/2+.24,eave-.12),
                   (p.length*.45,-p.width/2+.24,eave-.12),.12,.14,'white')
            notes.append('Annex exterior photo corroborates red lower panels and open upper shelter side; function remains unassigned.')

        elif fid=='B10':
            # Only one roof slope has reliable support; use its measured pitch
            # with an explicitly reconstructed opposite slope.
            ridge=record['planes'][0]['coefficientsLocalEN'][2]-8
            eave=ridge-math.tan(math.radians(record['planes'][0]['slopeDegrees']))*p.width/2
            p.walls(floor,eave)
            p.roof_gable(eave,ridge,'roof_dark','red')
            for i in range(6):
                u=-p.length*.40+i*p.length*.16
                p.opening(u,-1,floor+1.03,1.5,1.94,True,False)
            notes.append('Long dark roof and light south-side row observed in ortho; six facade panels are approximate. Opposite gable slope and function unconfirmed.')

        elif fid=='B11':
            eave=min(h(u,v) for u in (-p.length/2,p.length/2)
                     for v in (-p.width/2,p.width/2))-.08
            p.walls(floor,eave)
            p.roof_plane(h,'roof_tile',.10,.40)
            p.opening(0,-1,floor+.92,.82,1.78,True,False)
            notes.append('Tiny shallow roof follows 2021 laser support; facade opening approximate and no facility function assigned.')

        elif fid=='B12':
            ridge=median(record['candidateGableRidges'][0]['heightsRH2000'])-8
            eave=ridge-math.tan(math.radians(13.3))*p.width/2
            p.roof_gable(eave,ridge,'roof_tile')
            p.posts(lambda u,v:eave,floor,6)
            # South-facing open range; red back boards, exposed rafters and
            # green rubber-backed mats match the observed current shelter.
            rear=p.width/2-.30
            p.box(0,rear,floor+1.12,p.length-.55,.12,2.24,'red')
            for i in range(int(p.length/.35)):
                p.box(-p.length/2+.35+i*.35,rear-.074,floor+1.12,.045,.03,2.24,'red_batten')
            p.box(0,rear,floor+2.32,p.length-.45,.15,.13,'white')
            for i in range(7):
                u=-p.length/2+.3+i*(p.length-.6)/6
                p.beam((u,-p.width/2+.25,eave-.12),(u,0,ridge-.16),.11,.18,'wood_light')
                p.beam((u,0,ridge-.16),(u,p.width/2-.25,eave-.12),.11,.18,'wood_light')
                if i<6:
                    center=u+(p.length-.6)/12
                    p.box(center,-p.width*.20,floor+.035,1.70,1.75,.07,'mat_rubber')
                    p.box(center,-p.width*.20,floor+.080,1.48,1.50,.03,'range_turf')
            p.box(-p.length*.43,p.width*.14,floor+.60,.72,.85,1.2,'door_grey')
            p.box(-p.length*.43,p.width*.14-.44,floor+.85,.34,.035,.26,'metal')
            notes.append('Existing April 2025 roughly 21m shelter, six provisional bays; no proposed 41.430m studio or bag store. Rear enclosure and ball-dispenser silhouette approximate.')

        elif fid=='B13':
            ridge=median(record['candidateGableRidges'][0]['heightsRH2000'])-8
            eave=ridge-math.tan(math.radians(30.68))*p.width/2
            p.walls(floor,eave,'service_cladding',batten=False)
            p.roof_gable(eave,ridge,'roof_silver','service_cladding')
            for v in (-p.width/2+.22,p.width/2-.22):
                for i in range(int(p.length/.65)):
                    p.box(-p.length/2+.38+i*.65,v,(floor+eave)/2,.035,.035,eave-floor-.14,'roof_seam')
            # Unobserved elevations stay plain; no club logo or invented doors.
            notes.append('Northern service-context roof dimensions and ridge supported by aerial/laser. Neutral cladding represents unseen elevations; use/ownership unconfirmed.')

        stats=p.flush()
        entry={'id':fid,'lengthM':round(p.length,3),'widthM':round(p.width,3),
               'floorHeightRH2000':round(floor+8,3),'details':notes,**stats}
        result['facilities'].append(entry)
        if hasattr(ctx,'record_facility'):
            ctx.record_facility(fid,entry)

    # Keep the extensive service yard in its own site node. The roof's
    # vegetation-exclusion footprint must not expand to cover the whole yard.
    ctx.begin_facility('S07')
    ctx.drape('S07 | observed northern service yard',ctx.ring('S07'),'campus_gravel',.12)
    result['site'].append({'id':'S07','evidence':'Eastern and southern service-yard hardstanding traced from northern-service-native orthophoto; use/ownership unconfirmed.'})

    # Traced parking boundaries supersede the coarse inherited hardstanding.
    for fid in ('S01','S02'):
        ctx.begin_facility(fid)
        ctx.drape(fid+' | observed parking',ctx.ring(fid),'campus_gravel',.12)
        result['site'].append({'id':fid,'geometry':'orthophoto traced draped hardstanding; no invented painted parking layout'})

    ctx.begin_facility('S01')
    pad_parts=Parts(ctx,'S01 camper/charging fittings',(0,0,1,1,0))
    # Eight hard pads individually visible east of the north hardstanding.
    for x,y in [(435,326),(441,368),(447,410),(451,453),
                (455,496),(459,540),(466,584),(471,631)]:
        _surface(ctx,'S01 | observed camper pad',[(x-20,y-8),(x+19,y-11),
                    (x+20,y+7),(x-19,y+10)],'foundation',.13)
    # Six inset grass pads on the gravel column are equally visible in ortho.
    for x,y in [(325,311),(331,354),(337,399),(342,443),(347,488),(353,533)]:
        _surface(ctx,'S01 | grass camper inset',[(x-19,y-7),(x+18,y-9),
                    (x+20,y+6),(x-18,y+8)],'grass',.145)
    for x,y in [(391,338),(399,382),(405,426),(412,471),(419,515),(428,560),(436,606)]:
        px,py=_campus_pixel((x,y));z=ctx.ground(px,py)
        pad_parts.box(px,py,z+.77,.20,.14,1.54,'charging_orange')
        pad_parts.box(px,py-.09,z+1.09,.19,.10,.64,'charging_green')
        pad_parts.box(px,py-.151,z+1.18,.09,.018,.14,'metal')
        pad_parts.box(px,py,z+.07,.40,.35,.12,'foundation')
    pad_parts.flush()
    result['site'].append({'id':'S01-fittings','visiblePads':14,'chargingPosts':7,
       'evidence':'Pads traced from ortho. Seven charging posts documented/photo-correlated; exact north-parking positions estimated, not surveyed.'})

    ctx.begin_facility('S02')
    # Centerlines digitized against campus-native.png, with measured apparent
    # widths. A continuous offset polygon closes all joins at direction changes.
    for name,pixels,width in [
        ('west restaurant approach',[(394,966),(388,900),(396,856),(430,822),(492,791),(575,737),(642,691),(690,656)],3.0),
        ('cart/kiosk path',[(690,656),(718,619),(731,565),(714,514),(683,478),(650,433),(614,379),(590,308),(556,254)],2.7),
        ('courtyard main walk',[(470,945),(502,987),(546,1040),(587,1085),(641,1110),(688,1146),(726,1190),(768,1228),(812,1260),(823,1308),(829,1356),(890,1401),(973,1467)],2.9),
        ('annex east walk',[(724,978),(737,1020),(753,1061),(780,1096),(805,1139)],2.0),
        ('putting west loop',[(444,1030),(441,1104),(443,1168),(446,1219),(467,1268),(502,1303),(554,1320),(621,1332),(700,1345),(780,1366),(839,1388)],2.45),
        ('eastern practice path',[(811,1259),(866,1270),(933,1285),(1012,1299),(1093,1316),(1170,1331),(1241,1358),(1300,1347)],2.6)]:
        _path(ctx,name,pixels,width)
    _surface(ctx,'S02 | courtyard seating pavement',[(526,928),(635,849),(699,938),
              (647,990),(593,1033)],'range_paving',.12)
    _surface(ctx,'S02 | south courtyard apron',[(610,1066),(697,995),(756,1044),
              (803,1101),(798,1141),(716,1125)],'campus_gravel',.12)
    site_parts=Parts(ctx,'S02 path furniture',(0,0,1,1,0))
    for x,y in [(571,1086),(791,1375),(652,1331)]:
        px,py=_campus_pixel((x,y));site_parts.bench(px,py,ctx.ground(px,py))
    for x,y in [(592,1024),(782,1076),(817,1372)]:
        px,py=_campus_pixel((x,y));z=ctx.ground(px,py)
        site_parts.cylinder(px,py,z+.46,.23,.89,'charging_green')
        site_parts.cylinder(px,py,z+.92,.255,.06,'metal')
    site_parts.flush()
    result['site'].append({'id':'S02-paths','evidence':'Campus orthophoto digitized centerlines and courtyard paving; path furniture representative and approximate.'})

    ctx.begin_facility('S04')
    ctx.drape('S04 | existing range paving',ctx.ring('S04'),'range_paving',.07)
    # The 18 individual dark/green mats are visible along the gently curved
    # strip. Positions interpolate the north edge, rather than a straight line.
    spine=[(502,1359),(568,1366),(645,1382),(729,1401),(805,1426)]
    points=[_campus_pixel(p) for p in spine]
    lengths=[math.dist(a,b) for a,b in zip(points,points[1:])]
    total=sum(lengths)
    range_groups={}
    for i in range(18):
        distance=(i+.5)*total/18
        segment=0
        while segment<len(lengths)-1 and distance>lengths[segment]:
            distance-=lengths[segment];segment+=1
        t=distance/lengths[segment]
        a,b=points[segment],points[segment+1]
        x,y=a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t
        angle=math.atan2(b[1]-a[1],b[0]-a[0])
        z=ctx.ground(x,y)
        m=Parts(ctx,f'S04 mat {i+1:02}',(x,y,1.68,1.75,angle))
        m.groups=range_groups
        m.box(0,0,z+.13,1.66,1.76,.09,'mat_rubber')
        m.box(0,0,z+.192,1.43,1.51,.035,'range_turf')
        # Low separator frames match the visible metal advertising dividers;
        # leave the panels unbranded because no media rights are assumed.
        if i%2==0:
            for v in (-.64,.64):
                m.box(1.20,v,z+.42,.045,.045,.70,'charging_green')
            m.box(1.20,0,z+.76,.045,1.34,.05,'charging_green')
            m.box(1.20,0,z+.46,.035,1.14,.39,'notice_cream')
    m.fid='S04 mats and dividers'
    m.flush()
    result['site'].append({'id':'S04','outdoorMats':18,'evidence':'Current strip geometry and mat count interpreted from April2025 aerial; pad materials from range-mat-detail photo.'})

    ctx.begin_facility('S05')
    ring=ctx.ring('S05');frame=_frame(ring)
    p=Parts(ctx,'S05',frame)
    z=median(ctx.ground(x,y) for x,y in ring)+.16
    p.box(0,0,z,p.length,p.width,.14,'wood')
    for i in range(int(p.length/.16)):
        p.box(-p.length/2+.07+i*.16,0,z+.082,.135,p.width,.025,'wood_light')
    p.flush()
    result['site'].append({'id':'S05','evidence':'Narrow kiosk terrace traced in ortho; low timber platform inferred; no unsupported railings added.'})
    return result
