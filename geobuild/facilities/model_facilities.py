"""Source-constrained Veckefjarden ancillary facility meshes for Blender.

The parent scene supplies a context with metre-based XY geometry and RH2000
terrain sampling. Roof/surface XY comes from inventory.json; all vertical
dimensions and obscured details are reconstruction estimates, not survey data.
No downloaded photograph is used as a model texture.
"""

import math


ESTIMATES = {
    "hotelEavesAboveBaseMetres": 2.95,
    "hotelRoofRiseMetres": 2.35,
    "hotelWallInsetFromRoofMetres": 0.24,
    "poolCoverRiseMetres": 1.55,
    "gazeboEavesAboveBaseMetres": 2.25,
    "gazeboRoofRiseMetres": 1.35,
    "translucentStructureEavesAboveBaseMetres": 2.25,
    "translucentStructureRoofRiseMetres": 0.8,
    "padelEndEnclosureHeightMetres": 4.0,
    "padelSideEnclosureHeightMetres": 3.0,
    "padelGlassHeightMetres": 3.0,
    "padelFloodlightHeightMetres": 6.0,
    "rangeEavesAboveBaseMetres": 2.8,
    "rangeRoofRiseMetres": 1.5,
    "rangeFlagpoleHeightMetres": 6.0,
    "westernBuildingEavesAboveBaseMetres": 3.8,
    "westernBuildingRoofRiseMetres": 2.0,
}

# Individually read from the native 0.16 m source image. Centres, dimensions and
# classification are approximate visual interpretations, not a bay-count survey.
RANGE_MAT_PIXELS = [
    [221, 683], [229, 662], [236, 645], [244, 627], [250, 609],
    [259, 593], [270, 574], [279, 555], [287, 538], [296, 518],
    [315, 481], [331, 459], [345, 438], [358, 417], [378, 395],
    [390, 382], [408, 365], [423, 348], [437, 329], [452, 314],
    [467, 299], [481, 286], [496, 274], [511, 263], [524, 253],
]
RANGE_POLE_PIXELS = [
    [204, 654], [210, 631], [218, 608], [225, 586], [238, 564],
    [247, 542], [258, 519], [269, 496], [286, 479], [300, 456],
    [316, 431], [333, 412], [348, 394], [364, 375], [385, 356],
    [403, 337], [419, 315], [438, 292], [454, 275], [474, 255],
    [493, 236], [513, 222],
]


def _clean(ring):
    ring = [tuple(p[:2]) for p in ring]
    return ring[:-1] if ring[0] == ring[-1] else ring


def _frame(ring, core=None):
    """Orient along the longest edge of the four main roof corners."""
    p = _clean(core or ring)
    edge = max(zip(p, p[1:] + p[:1]), key=lambda e: math.dist(*e))
    angle = math.atan2(edge[1][1] - edge[0][1], edge[1][0] - edge[0][0])
    c, s = math.cos(angle), math.sin(angle)
    uv = [(x * c + y * s, -x * s + y * c) for x, y in p]
    u0, u1 = min(p[0] for p in uv), max(p[0] for p in uv)
    v0, v1 = min(p[1] for p in uv), max(p[1] for p in uv)
    u, v = (u0 + u1) / 2, (v0 + v1) / 2
    return (u * c - v * s, u * s + v * c, u1-u0, v1-v0, angle)


def _world(f, u, v, z):
    x, y, _, _, a = f
    return (x + u * math.cos(a) - v * math.sin(a),
            y + u * math.sin(a) + v * math.cos(a), z)


def _local(f, point):
    x, y, _, _, a = f
    dx, dy = point[0] - x, point[1] - y
    return (dx * math.cos(a) + dy * math.sin(a),
            -dx * math.sin(a) + dy * math.cos(a))


def _rect(f, u0, u1, v0, v1):
    return [_world(f, u, v, 0)[:2] for u, v in
            [(u0,v0), (u1,v0), (u1,v1), (u0,v1)]]


def _clip(poly, side):
    """Clip a simple roof ring against its longitudinal ridge."""
    out = []
    for a, b in zip(poly, poly[1:] + poly[:1]):
        ia, ib = a[1] * side >= -1e-8, b[1] * side >= -1e-8
        if ia:
            out.append(a)
        if ia != ib:
            t = -a[1] / (b[1] - a[1])
            out.append((a[0] + t * (b[0] - a[0]), 0.0))
    return out


class Builder:
    def __init__(self, ctx):
        self.ctx = ctx
        self.features = set()
        self.counts = {}

    def tag(self, obj, fid, evidence="photo-estimated"):
        self.ctx.tag(obj, fid, evidence=evidence)
        obj["vertical_dimensions_status"] = "photo estimate; not measured"
        obj["roof_plan_source"] = "Lantmateriet 2024-06-27; inventory.json"
        obj["facade_detail_status"] = "photo interpretation; hidden faces estimated"
        self.features.add(fid)
        self.counts[fid] = self.counts.get(fid, 0) + 1
        return obj

    def box(self, fid, name, p, dims, mat, a=0, evidence="photo-estimated"):
        return self.tag(self.ctx.box(fid + "_" + name, p, dims, mat, angle=a), fid, evidence)

    def beam(self, fid, name, a, b, w, d, mat):
        return self.tag(self.ctx.beam(fid + "_" + name, a, b, w, d, mat), fid)

    def mesh(self, fid, name, v, faces, mat, evidence="photo-estimated"):
        return self.tag(self.ctx.mesh(fid + "_" + name, v, faces, mat), fid, evidence)

    def prism(self, fid, name, ring, z0, z1, mat, evidence="photo-estimated"):
        return self.tag(self.ctx.prism(fid + "_" + name, ring, z0, z1, mat), fid, evidence)

    def cylinder(self, fid, name, p, radius, depth, mat, n=12):
        return self.tag(self.ctx.cylinder(fid + "_" + name, p, radius, depth, mat, vertices=n), fid)

    def surface(self, fid, name, ring=None, mat="asphalt", lift=0.045):
        ring = _clean(ring or self.ctx.ring(fid))
        if hasattr(self.ctx, 'drape'):
            return self.tag(self.ctx.drape(fid+'_'+name,ring,mat,lift=max(lift,.10)),fid,'ortho-roof-plan')
        # Intermediate edge samples follow the authoritative terrain instead of
        # spanning a whole sloping parking lot with a flat slab.
        edge = []
        for a, b in zip(ring, ring[1:] + ring[:1]):
            n = max(1, math.ceil(math.dist(a, b)/2))
            edge.extend([(a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n) for i in range(n)])
        # The range apron is concave. A centroid fan can bridge across the lawn
        # outside the apron; let Blender tessellate the actual boundary instead.
        verts = [(x,y,self.ctx.ground(x,y)+lift) for x,y in edge]
        faces = [tuple(range(len(edge)))]
        return self.mesh(fid,name,verts,faces,mat,"ortho-roof-plan")

    def window(self, fid, f, u, v, z, w=1.25, h=1.25, suffix="window"):
        a = f[4]
        direction = 1 if v > 0 else -1
        self.box(fid,suffix+"_trim",_world(f,u,v,z),(w+.17,.11,h+.17),"white",a)
        self.box(fid,suffix+"_glass",_world(f,u,v+direction*.067,z),(w,.038,h),"glass",a)
        self.box(fid,suffix+"_mullion",_world(f,u,v+direction*.097,z),(.05,.04,h),"white",a)
        self.box(fid,suffix+"_sill",_world(f,u,v+direction*.13,z-h/2-.06),(w+.25,.28,.09),"white",a)

    def door(self, fid, f, u, v, z, suffix="door", mat="white"):
        direction = 1 if v > 0 else -1
        self.box(fid,suffix+"_frame",_world(f,u,v,z+1.04),(1.03,.14,2.08),"white",f[4])
        self.box(fid,suffix+"_leaf",_world(f,u,v+direction*.08,z+1.01),(.88,.055,1.96),mat,f[4])
        self.box(fid,suffix+"_handle",_world(f,u+.3,v+direction*.13,z+.99),(.06,.05,.15),"metal",f[4])
        self.box(fid,suffix+"_step",_world(f,u,v+direction*.35,z+.025),(1.2,.72,.14),"foundation",f[4])

    def roof(self, fid, ring, f, eaves, rise, mat="roof_grey"):
        """Preserve the traced exterior ring; split sloped planes at ridge."""
        poly = [_local(f, p) for p in ring]
        half = f[3]/2
        for side in [-1,1]:
            part = _clip(poly,side)
            if len(part)<3:
                continue
            verts = [_world(f,u,v,eaves+max(0.0,1-abs(v)/half)*rise) for u,v in part]
            self.mesh(fid,"roof_slope_"+str(side),verts,[tuple(range(len(verts)))],mat,"ortho-roof-plan")
        # Edge boards follow the measured eaves, including small annexes.
        for i,(a,b) in enumerate(zip(poly,poly[1:]+poly[:1])):
            za=eaves+max(0.,1-abs(a[1])/half)*rise
            zb=eaves+max(0.,1-abs(b[1])/half)*rise
            self.beam(fid,"eaves_edge_%02d"%i,_world(f,*a,za),_world(f,*b,zb),.12,.16,"white")
        self.beam(fid,"ridge_cap",_world(f,-f[2]/2,0,eaves+rise+.035),_world(f,f[2]/2,0,eaves+rise+.035),.12,.1,mat)
        # Raised standing seams are visible in hotel-167 and club-149. Stop at
        # the principal roof edges rather than extrapolating annex dimensions.
        for i in range(1,int(f[2]/1.25)):
            u=-f[2]/2+i*f[2]/int(f[2]/1.25)
            for side in [-1,1]:
                self.beam(fid,"standing_seam_%02d_%s"%(i,side),
                          _world(f,u,0,eaves+rise+.035),
                          _world(f,u,side*f[3]/2,eaves+.035),.025,.025,mat)

    def building(self,fid,eave_height,rise,detail=True,wall="wall_yellow",core=None):
        ring=_clean(self.ctx.ring(fid))
        core=core or ring[:4]
        f=_frame(ring,core)
        ground=[self.ctx.ground(x,y) for x,y in ring]
        base=sum(ground)/len(ground)+.12
        eaves=base+eave_height
        inset=.24
        inner=[]
        for x,y in ring:
            u,v=_local(f,(x,y))
            u-=math.copysign(inset,u) if abs(u)>inset else 0
            v-=math.copysign(inset,v) if abs(v)>inset else 0
            inner.append(_world(f,u,v,0)[:2])
        self.prism(fid,"foundation",inner,min(ground)-.15,base+.28,"foundation")
        self.prism(fid,"timber_walls",inner,base+.18,eaves-.1,wall)
        self.roof(fid,ring,f,eaves,rise)
        # The attic volume fills the triangular gable ends; roof overhang remains
        # separate from the inward wall approximation.
        for side in [-1,1]:
            u=side*(f[2]/2-inset)
            verts=[_world(f,u,-f[3]/2+inset,eaves-.11),
                   _world(f,u,f[3]/2-inset,eaves-.11),
                   _world(f,u,0,eaves+rise-.06)]
            self.mesh(fid,"gable_wall_"+str(side),verts,[(0,1,2)],wall)
        for side in [-1,1]:
            v=side*(f[3]/2-inset)
            self.beam(fid,"gutter_"+str(side),_world(f,-f[2]/2,v,eaves-.1),_world(f,f[2]/2,v,eaves-.1),.12,.13,"roof_grey")
            for end in [-1,1]:
                u=end*(f[2]/2-.65)
                self.beam(fid,"downpipe_%s_%s"%(side,end),_world(f,u,v,base+.2),_world(f,u,v,eaves-.05),.085,.085,"roof_grey")
            if detail:
                count=max(3,round(f[2]/3.9))
                for i in range(count):
                    u=-f[2]/2+1.7+i*(f[2]-3.4)/max(1,count-1)
                    self.window(fid,f,u,v+side*.045,base+1.58,suffix="room_window_%s_%02d"%(side,i))
                for i in [0, max(1,count//2)]:
                    u=-f[2]/2+3.0+i*(f[2]-3.4)/max(1,count-1)
                    if u < f[2]/2-1:
                        self.door(fid,f,u,v+side*.055,base+.2,suffix="room_door_%s_%02d"%(side,i))
                # Horizontal lower cladding and white corner boards, as visible
                # on the hotel courtyard photograph. Geometry is kept lightweight.
                for row in range(5):
                    self.box(fid,"cladding_line_%s_%02d"%(side,row),
                             _world(f,0,v+side*.02,base+.33+row*.115),
                             (f[2]-.52,.018,.022),"white",f[4])
            for u in [-f[2]/2+.3,f[2]/2-.3]:
                self.box(fid,"corner_board",_world(f,u,v+side*.04,base+eave_height/2),(.13,.12,eave_height-.2),"white",f[4])
        if detail:
            for i,u in enumerate([-f[2]*.24,f[2]*.22]):
                z=eaves+rise+.32
                self.box(fid,"vent_stack_%s"%i,_world(f,u,0,z),(.48,.48,.73),"roof_grey",f[4])
                self.box(fid,"vent_cap_%s"%i,_world(f,u,0,z+.4),(.68,.65,.12),"metal",f[4])
        return f,base,eaves

    def hotel(self):
        for fid in ["R03","R04","R05"]:
            self.building(fid,2.95,2.35)
        # Small west attachments remain in the exact roof ring and wall shell.

    @property
    def _hotel_middle(self):
        ring=_clean(self.ctx.ring("R04"))
        f=_frame(ring,ring[:4])
        base=sum(self.ctx.ground(x,y) for x,y in ring)/len(ring)+.12
        return f,base,base+2.95

    def hotel_deck(self):
        fid="R04"
        f,base,eaves=self._hotel_middle
        # Core lengthaxis points approximately south. The pool-facing deck is
        # on its southern gable. Its outer dimensions are photo estimates.
        south_sign=1 if math.sin(f[4])<0 else -1
        u0=south_sign*f[2]/2
        u1=u0+south_sign*3.7
        deck=_rect(f,min(u0,u1),max(u0,u1),-f[3]/2+.4,f[3]/2-.4)
        self.prism(fid,"courtyard_deck_photo_estimate",deck,base+.05,base+.25,"wood")
        for i in range(19):
            v=-f[3]/2+.55+i*(f[3]-1.1)/18
            self.beam(fid,"deck_plank_joint_%02d"%i,_world(f,u0,v,base+.258),_world(f,u1,v,base+.258),.018,.013,"foundation")
        for side in [-1,1]:
            v=side*(f[3]/2-.45)
            for u in [u0,u1]:
                self.box(fid,"rope_rail_post",_world(f,u,v,base+.78),(.12,.12,1.1),"wood",f[4])
            self.beam(fid,"rope_rail",_world(f,u0,v,base+1.23),_world(f,u1,v,base+1.23),.035,.035,"sand")
        for i,v in enumerate([-2.7,1.5]):
            u=u0+south_sign*1.9
            self.cylinder(fid,"deck_table_%s"%i,_world(f,u,v,base+1.01),.54,.09,"metal",16)
            self.cylinder(fid,"table_leg_%s"%i,_world(f,u,v,base+.61),.06,.75,"metal")
            for k in [-1,1]:
                seat=_world(f,u,v+k*.83,base+.64)
                self.box(fid,"deck_chair_seat",seat,(.48,.46,.07),"metal",f[4])
                self.box(fid,"deck_chair_back",_world(f,u,v+k*1.0,base+.91),(.48,.06,.51),"metal",f[4])
                for du in [-.17,.17]:
                    self.beam(fid,"chair_leg",_world(f,u+du,v+k*.83,base+.27),_world(f,u+du,v+k*.83,base+.62),.035,.035,"metal")
        # Retractable white awning as a light, sloped fabric plane.
        verts=[_world(f,u0,-1.9,base+2.6),_world(f,u0,2.6,base+2.6),
               _world(f,u1-south_sign*.3,2.6,base+2.2),_world(f,u1-south_sign*.3,-1.9,base+2.2)]
        self.mesh(fid,"white_retractable_awning",verts,[(0,1,2,3)],"white")
        self.beam(fid,"awning_front_bar",verts[2],verts[3],.07,.07,"white")

    def pool(self):
        fid="S02"
        ring=_clean(self.ctx.ring(fid))
        f=_frame(ring)
        base=sum(self.ctx.ground(x,y) for x,y in ring)/len(ring)+.12
        length,width=f[2],f[3]
        deck=_rect(f,-length/2-1.,length/2+1.,-width/2-.95,width/2+.95)
        self.prism(fid,"timber_surround_estimate",deck,base-.12,base+.09,"wood")
        self.prism(fid,"white_pool_coping",_rect(f,-length/2-.17,length/2+.17,-width/2-.17,width/2+.17),base+.09,base+.22,"white")
        self.prism(fid,"water_measured_edge",ring,base+.221,base+.24,"water","ortho-roof-plan")
        # Partially retracted cover leaves the measured visible water open.
        # Cross sections use the photo's curved aluminium/translucent structure.
        cover_u=[-length/2-.78,-length/2-.31,-length/2+.18,-length/2+.66]
        half=width/2+.17
        coververts=[]
        for j,u in enumerate(cover_u):
            points=[]
            for k in range(13):
                theta=k*math.pi/12
                p=_world(f,u,-half*math.cos(theta),base+.28+1.55*math.sin(theta))
                coververts.append(p)
                points.append(p)
            for k in range(12):
                self.beam(fid,"cover_rib_%s_%s"%(j,k),points[k],points[k+1],.04,.035,"white")
        faces=[(j*13+k,j*13+k+1,(j+1)*13+k+1,(j+1)*13+k) for j in range(3) for k in range(12)]
        self.mesh(fid,"retracted_translucent_pool_cover",coververts,faces,"translucent")
        for side in [-1,1]:
            self.beam(fid,"cover_guide_rail",_world(f,-length/2-.82,side*half,base+.28),_world(f,length/2+.2,side*half,base+.28),.055,.04,"white")
        for i in range(23):
            u=-length/2-.92+i*(length+1.84)/22
            for side in [-1,1]:
                self.beam(fid,"deck_plank",_world(f,u,side*(width/2+.2),base+.099),_world(f,u,side*(width/2+.91),base+.099),.017,.01,"foundation")

    def gazebo(self):
        fid="R07"
        ring=_clean(self.ctx.ring(fid))
        cx=sum(p[0] for p in ring)/len(ring)
        cy=sum(p[1] for p in ring)/len(ring)
        base=self.ctx.ground(cx,cy)+.16
        self.prism(fid,"deck",ring,base-.16,base+.04,"wood")
        roof=[(x,y,base+2.25) for x,y in ring]+[(cx,cy,base+3.6)]
        faces=[(i,(i+1)%len(ring),len(ring)) for i in range(len(ring))]
        self.mesh(fid,"polygonal_roof",roof,faces,"roof_grey","ortho-roof-plan")
        for i,(x,y) in enumerate(ring):
            x,y=cx+(x-cx)*.86,cy+(y-cy)*.86
            self.box(fid,"timber_post_%s"%i,(x,y,base+1.17),(.13,.13,2.26),"wood")
            nx,ny=ring[(i+1)%len(ring)]
            nx,ny=cx+(nx-cx)*.86,cy+(ny-cy)*.86
            self.beam(fid,"ring_beam_%s"%i,(x,y,base+2.19),(nx,ny,base+2.19),.16,.17,"wood")
            self.beam(fid,"roof_hip_%s"%i,roof[i],roof[-1],.06,.07,"roof_grey")
            if i not in [1,2]:
                self.beam(fid,"bench_%s"%i,(x,y,base+.52),(nx,ny,base+.52),.38,.08,"wood")
        self.cylinder(fid,"roof_vent",(cx,cy,base+3.72),.19,.38,"metal")
        self.cylinder(fid,"roof_vent_cap",(cx,cy,base+3.96),.29,.08,"metal")

    def translucent_structure(self):
        fid="R06"
        ring=_clean(self.ctx.ring(fid))
        f=_frame(ring)
        base=sum(self.ctx.ground(x,y) for x,y in ring)/len(ring)+.12
        self.prism(fid,"unidentified_base",ring,base-.12,base+.08,"foundation")
        length,width=f[2],f[3]
        eaves=base+2.25
        self.roof(fid,ring,f,eaves,.8,"translucent")
        # Ribs and clear side panels express the orthophoto appearance without
        # assigning a conservatory, swimming-pool or horticultural function.
        for side in [-1,1]:
            v=side*(width/2-.07)
            n=max(3,round(length/1.55))
            for i in range(n+1):
                u=-length/2+i*length/n
                self.box(fid,"frame_post",_world(f,u,v,base+1.16),(.075,.075,2.22),"white",f[4])
            for i in range(n):
                u=-length/2+(i+.5)*length/n
                self.box(fid,"translucent_wall",_world(f,u,v,base+1.15),(length/n-.08,.035,2.16),"translucent",f[4])
        for i in range(max(3,round(length/1.55))+1):
            u=-length/2+i*length/max(3,round(length/1.55))
            for side in [-1,1]:
                self.beam(fid,"translucent_roof_rib",_world(f,u,side*width/2,eaves),_world(f,u,0,eaves+.8),.055,.055,"white")

    def wire_panel(self,fid,name,a,b,z0,z1,spacing=.18):
        """Mesh strips make visible wire without thousands of object nodes."""
        dx,dy=b[0]-a[0],b[1]-a[1]
        length=math.hypot(dx,dy)
        verts=[]; faces=[]
        def strip(p,q,width):
            idx=len(verts)
            # Thin ribbon in the panel plane, sufficient for campus-scale views.
            if abs(p[2]-q[2])<1e-7:
                off=(0,0,width/2)
            else:
                off=(dx/length*width/2,dy/length*width/2,0)
            verts.extend([tuple(p[k]-off[k] for k in range(3)),tuple(q[k]-off[k] for k in range(3)),tuple(q[k]+off[k] for k in range(3)),tuple(p[k]+off[k] for k in range(3))])
            faces.append(tuple(range(idx,idx+4)))
        for i in range(math.ceil(length/spacing)+1):
            t=min(1,i*spacing/length)
            strip((a[0]+dx*t,a[1]+dy*t,z0),(a[0]+dx*t,a[1]+dy*t,z1),.013)
        for i in range(math.ceil((z1-z0)/spacing)+1):
            z=min(z1,z0+i*spacing)
            strip((a[0],a[1],z),(b[0],b[1],z),.013)
        return self.mesh(fid,name,verts,faces,"metal")

    def padel(self):
        fid="S03"
        ring=_clean(self.ctx.ring(fid))
        f=_frame(ring)
        length,width=f[2],f[3]
        base=sum(self.ctx.ground(x,y) for x,y in ring)/len(ring)+.16
        self.prism(fid,"court_subbase",ring,base-.2,base+.015,"foundation","ortho-roof-plan")
        self.prism(fid,"blue_playing_surface",ring,base+.015,base+.045,"blue","ortho-roof-plan")
        for u in [-length/2+3.0,length/2-3.0]:
            self.box(fid,"service_line",_world(f,u,0,base+.055),(.05,width-.06,.012),"white",f[4])
        for side in [-1,1]:
            self.box(fid,"service_centre_line",_world(f,side*(length/4-1.5),0,base+.055),(length/2-3.,.05,.012),"white",f[4])
        for side in [-1,1]:
            u=side*length/2
            a=_world(f,u,-width/2,base)
            b=_world(f,u,width/2,base)
            self.box(fid,"end_glass",_world(f,u,0,base+1.52),(.04,width,3.),"court_glass",f[4])
            self.wire_panel(fid,"end_upper_mesh",a,b,base+3.,base+4.)
            for i in range(6):
                v=-width/2+i*width/5
                self.box(fid,"end_enclosure_post",_world(f,u,v,base+2.),(.09,.09,4.),"metal",f[4])
            for z in [0,3.,4.]:
                self.beam(fid,"end_enclosure_rail",_world(f,u,-width/2,base+z+.05),_world(f,u,width/2,base+z+.05),.075,.075,"metal")
        for side in [-1,1]:
            v=side*width/2
            # Central access gaps remain open on both long sides.
            for end in [-1,1]:
                ua=end*1.05; ub=end*length/2
                a=_world(f,ua,v,base); b=_world(f,ub,v,base)
                self.wire_panel(fid,"side_mesh",a,b,base+.08,base+3.)
                n=max(2,round(abs(ub-ua)/2.))
                for i in range(n+1):
                    u=ua+(ub-ua)*i/n
                    self.box(fid,"side_post",_world(f,u,v,base+1.5),(.08,.08,3.),"metal",f[4])
                for z in [.08,3.0]:
                    self.beam(fid,"side_rail",_world(f,ua,v,base+z),_world(f,ub,v,base+z),.07,.07,"metal")
                # Corner glass returns seen in the official padel photographs.
                u=end*(length/2-1.5)
                self.box(fid,"corner_glass_return",_world(f,u,v,base+1.5),(3.,.035,3.),"court_glass",f[4])
            for u in [-length*.27,length*.27]:
                self.box(fid,"floodlight_mast",_world(f,u,v+side*.14,base+3.),(.12,.12,6.),"metal",f[4])
                self.box(fid,"floodlight_crossbar",_world(f,u,v+side*.14,base+6.),(1.25,.10,.1),"metal",f[4])
                for du in [-.38,.38]:
                    self.box(fid,"floodlight_head",_world(f,u+du,v+side*.14,base+6.05),(.43,.29,.15),"metal",f[4])
                    self.box(fid,"floodlight_lens",_world(f,u+du,v+side*.14,base+5.968),(.34,.24,.015),"white",f[4])
        a=_world(f,0,-width/2+.07,base)
        b=_world(f,0,width/2-.07,base)
        self.wire_panel(fid,"playing_net",a,b,base+.06,base+.92,.11)
        self.beam(fid,"net_white_headband",(*a[:2],base+.93),(*b[:2],base+.93),.052,.045,"white")
        for v in [-width/2+.06,width/2-.06]:
            self.box(fid,"net_post",_world(f,0,v,base+.52),(.075,.075,1.04),"metal",f[4])

    def unknown_buildings(self):
        # R08 has pale cladding and dark pitched roof corroborated by club-149.
        # Functions of all four structures remain explicitly unassigned.
        self.building("R08",3.0,2.1,detail=False)
        for fid in ["R10","R11","R12"]:
            f,base,eaves=self.building(fid,3.8,2.0,detail=False,wall="neutral_timber")
            for i,u in enumerate([-f[2]*.25,f[2]*.25]):
                self.box(fid,"unverified_service_opening_%s"%i,_world(f,u,-f[3]/2+.22,base+1.35),(2.55,.065,2.55),"roof_grey",f[4])
                for row in range(6):
                    self.box(fid,"door_horizontal_joint",_world(f,u,-f[3]/2+.17,base+.22+row*.42),(2.5,.022,.024),"metal",f[4])

    def range(self):
        fid="R09"
        ring=_clean(self.ctx.ring(fid))
        f=_frame(ring)
        base=sum(self.ctx.ground(x,y) for x,y in ring)/len(ring)+.1
        eaves=base+2.8
        self.prism(fid,"covered_bay_slab",ring,base-.12,base+.12,"foundation","ortho-roof-plan")
        self.roof(fid,ring,f,eaves,1.5)
        # Range lies south/southeast of the roof. Leave that elevation open;
        # support spacing and panel division are estimated, not counted in photo.
        back=1 if math.cos(f[4])>0 else -1
        for side in [-1,1]:
            v=side*(f[3]/2-.32)
            for u in [-f[2]/2+.32,0,f[2]/2-.32]:
                self.box(fid,"support_post",_world(f,u,v,base+1.45),(.16,.16,2.7),"wood",f[4])
        self.box(fid,"estimated_back_wall",_world(f,0,back*(f[3]/2-.3),base+1.35),(f[2]-.5,.12,2.5),"wall_yellow",f[4])
        for i,u in enumerate([-f[2]/3,0,f[2]/3]):
            self.box(fid,"estimated_covered_mat_%s"%i,_world(f,u,-back*(f[3]/2-1.1),base+.14),(1.55,1.55,.035),"range_mat",f[4])
        self.surface("S08","curved_apron",mat="range_apron",lift=.055)
        def pixel(p):
            return (684234.88+.16*p[0]-684390,7022850.08-.16*p[1]-7023040)
        for i,p in enumerate(RANGE_MAT_PIXELS):
            x,y=pixel(p)
            prev=pixel(RANGE_MAT_PIXELS[max(0,i-1)])
            nxt=pixel(RANGE_MAT_PIXELS[min(len(RANGE_MAT_PIXELS)-1,i+1)])
            a=math.atan2(nxt[1]-prev[1],nxt[0]-prev[0])
            obj=self.box("S08","interpreted_mat_%02d"%(i+1),(x,y,self.ctx.ground(x,y)+.115),(1.5,1.4,.045),"range_mat",a,"ortho-roof-plan")
            obj["source_panel_id"]="range-tee-native"
            obj["source_pixel_centre"]=p
            obj["centre_interpretation_uncertainty_metres"]=.6
            obj["mat_dimensions_status"]="estimate; some small green patches ambiguous"
        for i,p in enumerate(RANGE_POLE_PIXELS):
            x,y=pixel(p)
            z=self.ctx.ground(x,y)
            obj=self.cylinder("S08","interpreted_pole_%02d"%(i+1),(x,y,z+3),.035,6.,"white")
            obj["source_panel_id"]="range-tee-native"
            obj["source_pixel_centre"]=p
            obj["centre_interpretation_uncertainty_metres"]=.7
            self.mesh("S08","plain_flag_%02d"%(i+1),[(x,y,z+5.8),(x+.62,y+.10,z+5.7),(x+.58,y+.11,z+3.95),(x,y,z+4.05)],[(0,1,2,3)],"white")

    def parking_and_island(self):
        for fid in ["S04","S05","S06"]:
            self.surface(fid,"reviewed_parking_surface",mat="parking_gravel",lift=.06)
        fid="S07"
        ring=_clean(self.ctx.ring(fid))
        self.surface(fid,"entrance_island",mat="island_gravel",lift=.08)
        for i,(a,b) in enumerate(zip(ring,ring[1:]+ring[:1])):
            self.beam(fid,"low_edge_%s"%i,(a[0],a[1],self.ctx.ground(*a)+.14),(b[0],b[1],self.ctx.ground(*b)+.14),.17,.2,"foundation")
        # The centre is not embellished with an invented statue or flagpole.


def build(ctx):
    """Build ancillary facilities and return explicit provenance/estimate notes."""
    extra_materials={
        "neutral_timber":((.61,.60,.52,1),.84,0,1),
        "translucent":((.71,.86,.84,.26),.21,0,.26),
        "court_glass":((.44,.65,.69,.09),.1,0,.09),
        "range_mat":((.045,.23,.16,1),.95,0,1),
        "range_apron":((.39,.405,.39,1),.95,0,1),
        "parking_gravel":((.49,.475,.43,1),.96,0,1),
        "island_gravel":((.60,.585,.535,1),.95,0,1),
    }
    for name,(color,roughness,metallic,alpha) in extra_materials.items():
        ctx.material(name,color,roughness=roughness,metallic=metallic,alpha=alpha)
    b=Builder(ctx)
    b.hotel()
    b.hotel_deck()
    b.pool()
    b.gazebo()
    b.translucent_structure()
    b.padel()
    b.unknown_buildings()
    b.range()
    b.parking_and_island()
    return {
        "module":"model_facilities.py",
        "featureIds":sorted(b.features),
        "objectCountsByFeature":dict(sorted(b.counts.items())),
        "estimates":ESTIMATES,
        "rangeDetailInterpretation":{
            "sourcePanelId":"range-tee-native",
            "matPixelCentres":RANGE_MAT_PIXELS,
            "polePixelCentres":RANGE_POLE_PIXELS,
            "status":"approximate visual interpretation; no bay-count or height survey",
        },
        "assumptions":[
            "Roof and hard-surface plan geometry uses the 2024-06-27 Lantmateriet traced rings in inventory.json.",
            "Building eaves, ridges, glazing, hidden elevations and support counts are reconstruction estimates, not measured heights.",
            "R03/R04/R05 are modeled as the low accommodation cluster; assigning individual hotel functions to each block remains unconfirmed.",
            "Hotel character follows hotel-167: pale timber, white joinery, low dark standing-seam roofs, gutters and roof vents. The 2024 plan governs over historical oblique geometry.",
            "Hotel courtyard deck, rope rails and awning derive from hotel-167; exact present-day deck boundary and configuration are unresolved.",
            "S02 uses the reviewed visible water edge. The coping, surround and partially retracted arched cover are photo estimates; visible water does not establish the entire pool basin.",
            "R06 remains an unidentified translucent structure; R08/R10/R11/R12 retain unverified building functions. Western shell material and facade openings are generic estimates.",
            "Padel enclosure, floodlights, net and colours follow club-149/club-155. Heights and glass/mesh division are estimates.",
            "Range mats and pole bases are independently interpreted native-image positions with 0.6-0.7 m placement uncertainty; small patches and support structure remain ambiguous.",
            "Parking has no invented space striping; entrance island has no invented central sculpture or sign. Northern neighboring buildings N01-N05 are excluded.",
            "No web photograph is applied as a texture or embedded in exported facility geometry.",
        ],
    }
