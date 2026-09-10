"""Editable Ängsö courtyard architecture, authored from the curated reference pack.

Called inside Blender by build_facility_models.py. Geometry uses metres, grid
east/north, and RH2000 minus 8 m. The 2025 roof traces set the horizontal frame;
2021 roof-plane intersections constrain ridge elevations. Joinery, wall insets,
floor levels, roof intersections and concealed elevations remain reconstruction
estimates. Web photographs are references only and are never used as textures.
"""
import math


PHOTOS = {
    'B01': ['clubhouse-courtyard', 'restaurant-entrance', 'campus-drone-north',
            'historic-parking-side-panorama'],
    'B02': ['campus-drone-north', 'historic-parking-side-panorama'],
    'B03': ['clubhouse-courtyard', 'historic-parking-side-panorama'],
    'B04': ['annex-exterior', 'clubhouse-courtyard', 'campus-drone-north'],
    'B04a': ['campus-drone-north'],
    'S06': ['campus-drone-north', 'historic-parking-side-panorama'],
}
BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


class Parts:
    """Batch repeated details by component/material, keeping authoring editable."""
    def __init__(self, ctx, fid, center, angle):
        self.ctx, self.fid = ctx, fid
        self.cx, self.cy = center
        self.c, self.s = math.cos(angle), math.sin(angle)
        self.groups = {}
        self.counts = {'windows': 0, 'doors': 0, 'dormers': 0,
                       'rooflights': 0, 'chimneys': 0}

    def point(self, x, y, z):
        return (self.cx + x*self.c-y*self.s,
                self.cy + x*self.s+y*self.c, z)

    def ground(self, x, y):
        xx, yy, _ = self.point(x, y, 0)
        return self.ctx.ground(xx, yy)

    def mesh(self, group, vertices, faces, mat):
        key = (group, mat)
        verts, ff = self.groups.setdefault(key, ([], []))
        start = len(verts)
        verts.extend(self.point(*p) for p in vertices)
        ff.extend(tuple(start+i for i in f) for f in faces)

    def box(self, group, xyz, size, mat, angle=0):
        x, y, z = xyz
        hx, hy, hz = (a/2 for a in size)
        if min(size) <= 0:
            raise ValueError((self.fid, group, size))
        c, s = math.cos(angle), math.sin(angle)
        pts = [(x+u*c-v*s, y+u*s+v*c, z+w)
               for w in (-hz, hz)
               for u, v in [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]]
        self.mesh(group, pts, BOX_FACES, mat)

    def beam(self, group, a, b, width, mat, depth=None):
        d = [b[i]-a[i] for i in range(3)]
        length = math.sqrt(sum(v*v for v in d))
        if length < 1e-7:
            return
        d = [v/length for v in d]
        ref = [0, 0, 1] if abs(d[2]) < .95 else [0, 1, 0]
        u = [d[1]*ref[2]-d[2]*ref[1], d[2]*ref[0]-d[0]*ref[2],
             d[0]*ref[1]-d[1]*ref[0]]
        norm = math.sqrt(sum(v*v for v in u))
        u = [v/norm for v in u]
        v = [d[1]*u[2]-d[2]*u[1], d[2]*u[0]-d[0]*u[2],
             d[0]*u[1]-d[1]*u[0]]
        depth = depth or width
        pts = [tuple(p[i]+u[i]*du*width/2+v[i]*dv*depth/2 for i in range(3))
               for p in (a, b) for du, dv in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
        self.mesh(group, pts, BOX_FACES, mat)

    def wallbox(self, name, x0, x1, y0, y1, floor, eave, mat='red'):
        base = min(self.ground(x, y) for x in (x0, x1) for y in (y0, y1))-.16
        self.box(name+' foundation', ((x0+x1)/2, (y0+y1)/2, (base+floor)/2),
                 (x1-x0, y1-y0, max(.15, floor-base)), 'foundation')
        self.box(name+' walls', ((x0+x1)/2, (y0+y1)/2, (floor+eave)/2),
                 (x1-x0, y1-y0, eave-floor), mat)

    def battens(self, x0, x1, y, z0, z1, spacing=.24, axis='x'):
        count = max(1, int((x1-x0)/spacing))
        for i in range(count+1):
            x = x0+(x1-x0)*i/count
            center, dims = ((x, y, (z0+z1)/2), (.031, .045, z1-z0))
            if axis == 'y':
                center, dims = ((y, x, (z0+z1)/2), (.045, .031, z1-z0))
            self.box('Raised vertical timber battens', center, dims, 'red_batten')

    def trim_corners(self, x0, x1, y0, y1, bottom, top):
        for x in (x0, x1):
            for y in (y0, y1):
                self.box('White corner boards', (x, y, (bottom+top)/2),
                         (.12, .12, top-bottom), 'white')

    def opening(self, x, y, bottom, width=1.15, height=1.5,
                side=-1, door=False, axis='x', diamond=False, divided=True):
        """Casings cover the simplified solid wall behind opaque window glass."""
        self.counts['doors' if door else 'windows'] += 1
        def box(group, u, out, z, w, dep, h, mat):
            center, dims = ((x+u, y+side*out, z), (w, dep, h))
            if axis == 'y':
                center, dims = ((x+side*out, y+u, z), (dep, w, h))
            self.box(group, center, dims, mat)
        z = bottom+height/2
        box('Opening recesses', 0, .035, z, width+.16, .06, height+.16, 'metal')
        box('Door leaves' if door else 'Opaque window panes', 0, .075, z,
            width, .055, height, 'white' if door and diamond else 'glass')
        for dx in (-width/2-.047, width/2+.047):
            box('Window and door casings', dx, .13, z, .095, .14, height+.2, 'white')
        for zz in (bottom-.046, bottom+height+.046):
            box('Window and door casings', 0, .13, zz, width+.19, .14, .092, 'white')
        if divided and not diamond:
            box('Glazing mullions', 0, .14, z, .052, .08, height, 'white')
            for f in (.33, .67):
                box('Glazing mullions', 0, .14, bottom+height*f, width, .08, .042, 'white')
        if not door:
            box('Projecting window sills', 0, .19, bottom-.10,
                width+.28, .28, .085, 'white')
        else:
            box('Door hardware', width*.32, .23, bottom+.95, .03, .08, .19, 'metal')
            if diamond:
                r = min(width*.27, .25)
                verts = [(-r, 0), (0, r*1.35), (r, 0), (0, -r*1.35)]
                def p(du, dz, out):
                    return (x+du, y+side*out, bottom+height*.67+dz) if axis == 'x' else (
                        x+side*out, y+du, bottom+height*.67+dz)
                self.mesh('Diamond door lights', [p(du, dz, .12) for du, dz in verts],
                          [(0, 1, 2, 3)], 'glass')
                for i in range(4):
                    a, b = verts[i], verts[(i+1)%4]
                    self.beam('Diamond door molding', p(*a, .15), p(*b, .15), .038, 'white')

    def pitched_roof(self, x0, x1, halfwidth, eave, ridge,
                     front='roof_tile', back='roof_tile', ycenter=0, tiled=True):
        for side, mat in [(-1, front), (1, back)]:
            yy = ycenter+side*halfwidth
            self.mesh('Main pitched roof', [(x0, yy, eave), (x1, yy, eave),
                      (x1, ycenter, ridge), (x0, ycenter, ridge)], [(0, 1, 2, 3)], mat)
            self.beam('Eaves fascia', (x0, yy, eave-.09), (x1, yy, eave-.09), .19, 'white', .13)
            self.beam('Eaves gutters', (x0-.07, yy+side*.04, eave-.025),
                      (x1+.07, yy+side*.04, eave-.025), .10, 'metal')
            for xx in (x0, x1):
                self.beam('White gable bargeboards', (xx, yy, eave-.04),
                          (xx, ycenter, ridge+.04), .16, 'white', .14)
            spacing = .29 if mat == 'roof_tile' else .58
            n = max(1, int((x1-x0)/spacing))
            for j in range(n+1):
                xx = x0+(x1-x0)*j/n
                self.beam('Tile rolls' if mat == 'roof_tile' else 'Roof standing seams',
                          (xx, yy, eave+.025), (xx, ycenter, ridge+.025),
                          .044 if mat == 'roof_tile' else .025,
                          'tile_highlight' if mat == 'roof_tile' else 'roof_seam', .038)
            if mat == 'roof_tile' and tiled:
                for row in range(1, max(2, int(halfwidth/.38))):
                    t = row/max(2, int(halfwidth/.38))
                    z = eave+(ridge-eave)*t+.025
                    self.beam('Tile courses', (x0, yy+(ycenter-yy)*t, z),
                              (x1, yy+(ycenter-yy)*t, z), .022, 'tile_shadow', .029)
        self.beam('Ridge cap', (x0-.04, ycenter, ridge+.035),
                  (x1+.04, ycenter, ridge+.035), .16, 'roof_tile', .11)

    def gable_wall(self, x, halfwidth, eave, ridge, bottom, mat='red'):
        self.mesh('Timber gable infill', [(x, -halfwidth, eave), (x, halfwidth, eave),
                  (x, 0, ridge)], [(0, 1, 2)], mat)
        n = max(1, int(halfwidth*2/.24))
        for i in range(1, n):
            yy = -halfwidth+2*halfwidth*i/n
            top = ridge-(ridge-eave)*abs(yy)/halfwidth-.04
            if top > eave:
                self.box('Gable timber battens', (x, yy, (eave+top)/2),
                         (.045, .033, top-eave), 'red_batten')

    def dormer(self, x, side, halfwidth, roof_eave, roof_ridge,
               width=1.85, large=False):
        self.counts['dormers'] += 1
        yf = side*(halfwidth-.36)
        bottom = roof_eave+.35
        eave = roof_eave+(1.55 if not large else 2.45)
        ridge = min(roof_ridge+.10, eave+width*.45)
        # The dormer cheeks terminate on the actual main roof plane. Keeping
        # their back edge at the main ridge height would produce tall wedges.
        y_side = side*halfwidth*max(0, (roof_ridge-eave)/(roof_ridge-roof_eave))
        y_ridge = side*halfwidth*max(0, (roof_ridge-ridge)/(roof_ridge-roof_eave))
        verts = [(x-width/2, yf, bottom), (x+width/2, yf, bottom),
                 (x+width/2, yf, eave), (x-width/2, yf, eave),
                 (x, yf, ridge), (x-width/2, y_side, eave),
                 (x+width/2, y_side, eave), (x, y_ridge, ridge)]
        self.mesh('Dormer timber faces', verts, [(0, 1, 2, 3), (3, 2, 4),
                  (0, 3, 5), (1, 6, 2)], 'red' if large else 'dormer_dark')
        # Two roof cheeks meeting the existing main roof; independent for editing.
        dormer_roof = 'roof_dark' if self.fid == 'B01' and side == 1 else 'roof_tile'
        self.mesh('Dormer roofing', [(x-width/2-.15, yf+side*.16, eave+.07),
                  (x, yf+side*.16, ridge+.08), (x+width/2+.15, yf+side*.16, eave+.07),
                  (x-width/2-.15, y_side, eave+.07), (x, y_ridge, ridge+.08),
                  (x+width/2+.15, y_side, eave+.07)],
                  [(0, 1, 4, 3), (1, 2, 5, 4)], dormer_roof)
        for xx in (x-width/2-.15, x+width/2+.15):
            self.beam('Dormer white bargeboards', (xx, yf+side*.18, eave+.06),
                      (x, yf+side*.18, ridge+.09), .13, 'white')
        if large:
            for dx in (-width*.27, width*.27):
                self.opening(x+dx, yf, bottom+.20, width*.34, 1.55, side=side)
        else:
            self.opening(x, yf, bottom+.16, .83, .98, side=side)

    def downpipes(self, x0, x1, y, bottom, eave, side):
        for xx in (x0+.26, x1-.26):
            self.beam('Rainwater downpipes', (xx, y+side*.05, eave-.15),
                      (xx, y-side*.12, eave-.43), .075, 'white')
            self.beam('Rainwater downpipes', (xx, y-side*.12, eave-.43),
                      (xx, y-side*.12, bottom+.2), .075, 'white')
            self.beam('Rainwater shoes', (xx, y-side*.12, bottom+.2),
                      (xx, y+side*.23, bottom+.09), .075, 'white')

    def railing(self, a, b, floor, height=1.0, mat='white', solid=False):
        length = math.dist(a, b)
        for z in (floor+.11, floor+height-.10, floor+height):
            self.beam('Balcony horizontal rails', (*a, z), (*b, z), .085, mat)
        n = max(1, int(length/(.12 if solid else .17)))
        for i in range(n+1):
            t = i/n
            x, y = a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t
            self.box('Balcony vertical balusters', (x, y, floor+height/2),
                     (.075 if solid else .055, .075 if solid else .055, height-.12), mat)

    def finish(self, metadata):
        self.ctx.begin_facility(self.fid)
        for (group, mat), (vertices, faces) in self.groups.items():
            obj = self.ctx.mesh(self.fid+' / '+group, vertices, faces, mat)
            self.ctx.tag(obj, self.fid, '2025 traced roof plan; 2021 laser ridge elevation; photo-informed detail')
            obj['reference_photo_ids'] = ','.join(PHOTOS[self.fid])
            obj['architectural_detail_status'] = 'inferred dimensions and hidden elevations; not surveyed'
            obj['height_status'] = metadata.get('heightEvidence',
                'laser-constrained roof ridge; estimated eaves and finished floors')
        report = dict(metadata, id=self.fid, details=self.counts,
                      editableMeshGroups=len(self.groups),
                      sourcePhotos=PHOTOS[self.fid],
                      horizontalBasis='2025 orthophoto roof outline; wall inset estimated',
                      limitations='2021/2025 evidence epochs differ; hidden joinery and exact floor/eave elevations inferred')
        if hasattr(self.ctx, 'record_facility'):
            self.ctx.record_facility(self.fid, report)
        return report


def _ridge(ctx, fid, fallback):
    records = ctx.height(fid).get('candidateGableRidges', [])
    if records:
        values = records[0]['heightsRH2000']
        return sum(values)/len(values)-8
    return fallback


def _restaurant(ctx):
    # Main ridge is independently supported by the two steep 2021 roof planes.
    b = Parts(ctx, 'B01', (-3.08, 10.70), math.atan2(15.307, 20.26))
    ridge = _ridge(ctx, 'B01', 7.465)
    floor, eave, half, x0, x1 = .07, 3.22, 5.47, -12.7, 13.40
    b.wallbox('Restaurant main volume', x0+.3, x1-.3, -half+.3, half-.3, floor, eave)
    b.pitched_roof(x0, x1, half, eave, ridge, 'roof_tile', 'roof_dark')
    for x in (x0+.30, x1-.30):
        b.gable_wall(x, half-.30, eave, ridge-.14, floor)
    for side in (-1, 1):
        b.battens(x0+.3, x1-.3, side*(half-.28), floor+.12, eave-.10)
        b.downpipes(x0, x1, side*half, floor, eave, side)
    b.trim_corners(x0+.3, x1-.3, -half+.3, half-.3, floor, eave)
    # Courtyard side: divided white windows and the photographed center porch.
    for xx in (-10.65, -7.10, -3.8, 3.95, 7.1, 10.65):
        b.opening(xx, -half+.29, floor+.60, 1.25, 1.63, side=-1)
    b.opening(.15, -half+.28, floor+.12, 1.12, 2.23, side=-1, door=True, diamond=True)
    b.opening(2.0, -half+.28, floor+1.36, .70, .79, side=-1)
    for side in (-1, 1):
        for xx in (-9.45, -5.9, 5.75, 9.35):
            b.dormer(xx, side, half, eave, ridge)
        b.dormer(.1, side, half, eave, ridge, width=4.35, large=True)
    # Broad northwest glazed restaurant extension: the pitched roof occupies
    # only part of B01's composite plan. Its shallow plane is present in LiDAR.
    rx0, rx1, ry0, ry1 = -20.05, 11.00, 5.17, 10.18
    b.wallbox('Northwest glazed extension', rx0, rx1, ry0, ry1, floor, 2.72)
    b.mesh('Northwest shallow roof', [(rx0-.18, ry0-.15, 3.55),
           (rx1+.18, ry0-.15, 3.55), (rx1+.18, ry1+.16, 2.72),
           (rx0-.18, ry1+.16, 2.72)], [(0, 1, 2, 3)], 'roof_dark')
    b.beam('Glazed extension front fascia', (rx0-.2, ry1+.18, 2.67),
           (rx1+.2, ry1+.18, 2.67), .18, 'white')
    # Long continuous white glazing is the strongest feature in the drone view.
    for i in range(23):
        xx = rx0+.80+i*(rx1-rx0-1.60)/22
        b.opening(xx, ry1, floor+.60, 1.02, 1.65, side=1, divided=True)
    for xx in (rx0, rx1):
        for yy in (6.45, 8.40):
            b.opening(xx, yy, floor+.65, 1.25, 1.57,
                      side=-1 if xx == rx0 else 1, axis='y')
    b.trim_corners(rx0, rx1, ry0, ry1, floor, 2.72)
    # Low southwest service return follows the stepped outline.
    sx0, sx1, sy0, sy1 = -20.05, -12.40, -.55, 5.18
    b.wallbox('Southwest return', sx0, sx1, sy0, sy1, floor, 2.90)
    b.mesh('Southwest return roof', [(sx0-.22, sy0-.2, 2.86),
           (sx1+.12, sy0-.2, 3.30), (sx1+.12, sy1, 3.48),
           (sx0-.22, sy1, 2.97)], [(0, 1, 2, 3)], 'roof_dark')
    b.battens(sx0, sx1, sy0-.03, floor+.1, 2.78)
    b.opening(-16.5, sy0, floor+.15, 1.2, 2.2, side=-1, door=True)
    for yy in (1.2, 3.6):
        b.opening(sx0, yy, floor+.62, 1.15, 1.58, side=-1, axis='y')
    # Photographed deep porch and first-floor white balcony, with real posts,
    # rails and balusters instead of a solid white block.
    px0, px1, py0, py1 = -2.30, 2.55, -7.30, -5.08
    deck, upper = floor+.20, 3.14
    for z in (deck, upper):
        b.box('Porch and balcony decking', ((px0+px1)/2, (py0+py1)/2, z),
              (px1-px0, py1-py0, .19), 'wood' if z == deck else 'white')
    for xx in (px0+.10, px1-.10):
        for yy in (py0+.10, py1-.05):
            b.box('Two-storey porch white posts', (xx, yy, (deck+upper)/2),
                  (.15, .15, upper-deck), 'white')
    for a, bb in [((px0, py0), (px1, py0)), ((px0, py0), (px0, py1)),
                  ((px1, py0), (px1, py1))]:
        b.railing(a, bb, upper+.10, 1.02, solid=True)
    for a, bb in [((px0, py0), (-.75, py0)), ((.7, py0), (px1, py0)),
                  ((px0, py0), (px0, py1)), ((px1, py0), (px1, py1))]:
        b.railing(a, bb, deck+.08, .87)
    for k in range(2):
        b.box('Porch steps', (-.03, py0-.30-k*.30, floor+.10-k*.09),
              (1.46, .63, .18), 'foundation')
    # Roof stacks visible in historic photos and the oblique overview.
    for xx, yy in [(-4.0, .1), (6.50, .65)]:
        b.box('Restaurant chimney flashing', (xx, yy, ridge-.45), (.85, .9, .15), 'roof_seam')
        b.box('Restaurant chimney stacks', (xx, yy, ridge+.30), (.55, .60, 1.30), 'brick')
        b.box('Restaurant chimney caps', (xx, yy, ridge+.98), (.68, .75, .13), 'metal')
        b.counts['chimneys'] += 1
    # Simple mechanical plant box seen at the rear; exact equipment is inferred.
    b.box('Rear plant enclosure', (8.60, 10.70, floor+.69), (1.60, .95, 1.22), 'roof_seam')
    for i in range(7):
        b.box('Plant grille slats', (8.60, 11.185, floor+.22+i*.14), (1.39, .02, .043), 'metal')
    return b.finish({'label': 'Restaurant and clubhouse', 'ridgeRH2000': round(ridge+8, 3),
                     'eaveRH2000': eave+8, 'roofCondition': 'Dark northwest slope and terracotta courtyard slope from latest ortho',
                     'reconstructedFeatures': ['ten gabled dormers', 'two-storey white entrance porch',
                      'long white glazed northwest extension', 'southwest service return', 'two roof stacks']})


def _reception(ctx):
    ring = ctx.ring('B03')
    center = (sum(p[0] for p in ring)/4, sum(p[1] for p in ring)/4)
    dx, dy = ring[2][0]-ring[1][0], ring[2][1]-ring[1][1]
    length = math.hypot(dx, dy)
    angle = math.atan2(dy, dx)
    width = abs(-(ring[0][0]-ring[1][0])*math.sin(angle)+(ring[0][1]-ring[1][1])*math.cos(angle))
    b = Parts(ctx, 'B03', center, angle)
    ridge, floor = _ridge(ctx, 'B03', 6.894), .18
    eave, half, x0, x1 = 3.57, width/2, -length/2, length/2
    b.wallbox('Reception main volume', x0+.28, x1-.28, -half+.25, half-.25, floor, eave)
    b.pitched_roof(x0, x1, half, eave, ridge)
    for side in (-1, 1):
        b.battens(x0+.30, x1-.30, side*(half-.23), floor+.05, eave-.06)
        b.downpipes(x0, x1, side*half, floor, eave, side)
        for xx in (-5.0, .1, 5.0):
            if side == 1 or abs(xx) > 1:
                b.opening(xx, side*(half-.25), floor+.74, 1.13, 1.48, side=side)
    # Courtyard elevation faces northeast (+local Y).
    b.opening(.10, half-.24, floor+.08, 1.15, 2.15, side=1, door=True)
    b.box('Reception entrance step', (.10, half+.20, floor+.015), (1.80, 1.20, .19), 'foundation')
    b.mesh('Reception shallow entrance hood', [(-1.45, half-.05, 2.94),
           (1.65, half-.05, 2.94), (1.65, half+1.25, 2.58), (-1.45, half+1.25, 2.58)],
           [(0, 1, 2, 3)], 'roof_tile')
    for xx in (-1.32, 1.52):
        b.box('Reception porch posts', (xx, half+1.12, (floor+2.58)/2), (.11, .11, 2.58-floor), 'white')
    for xx in (x0+.28, x1-.28):
        b.gable_wall(xx, half-.25, eave, ridge-.10, floor)
        b.opening(xx, 0, 4.02, 1.28, 1.48, side=-1 if xx < 0 else 1, axis='y')
        b.battens(-half+.30, half-.30, xx, floor+.08, eave-.04, axis='y')
    b.trim_corners(x0+.28, x1-.28, -half+.25, half-.25, floor, eave)
    for xx in (-3.3, 3.05):
        b.box('Reception brick chimney', (xx, .24, ridge+.37), (.62, .69, 1.54), 'brick')
        b.box('Reception chimney cap', (xx, .24, ridge+1.17), (.76, .83, .13), 'metal')
        for j in range(9):
            b.box('Chimney masonry courses', (xx, .24, ridge-.31+j*.16), (.632, .702, .016), 'brick_mortar')
        b.counts['chimneys'] += 1
    return b.finish({'label': 'Reception and club office', 'ridgeRH2000': round(ridge+8, 3),
                     'eaveRH2000': eave+8, 'roofPlanMetres': [round(length, 2), round(width, 2)],
                     'reconstructedFeatures': ['red vertical timber', 'white gable windows', 'two brick chimneys', 'courtyard entrance canopy']})


def _annex(ctx):
    ring = ctx.ring('B04')
    a, end, across = ring[0], ring[-1], ring[1]
    dx, dy = end[0]-a[0], end[1]-a[1]
    length, angle = math.hypot(dx, dy), math.atan2(dy, dx)
    c, s = math.cos(angle), math.sin(angle)
    width = abs(-(across[0]-a[0])*s+(across[1]-a[1])*c)
    center = (a[0]+dx/2-s*width/2, a[1]+dy/2+c*width/2)
    b = Parts(ctx, 'B04', center, angle)
    ridge, floor = _ridge(ctx, 'B04', 6.87), .91
    eave, half, x0, x1 = 3.77, width/2, -length/2, length/2
    b.wallbox('Annex white lower level', x0+.26, x1-.26, -half+.28, half-.28, floor, 2.75, 'white_wall')
    b.box('Annex red upper wall band', (0, 0, (2.75+eave)/2),
          (length-.52, width-.56, eave-2.75), 'red')
    b.pitched_roof(x0, x1, half, eave, ridge)
    for side in (-1, 1):
        b.battens(x0+.26, x1-.26, side*(half-.25), 2.77, eave-.06)
        b.downpipes(x0, x1, side*half, floor, eave, side)
    for xx in (x0+.26, x1-.26):
        b.gable_wall(xx, half-.28, eave, ridge-.12, floor)
    b.trim_corners(x0+.26, x1-.26, -half+.28, half-.28, floor, eave)
    # Courtyard side is southwest (-local Y): separate changing-room access.
    for xx in (-6.55, -2.72, 1.27, 5.5):
        b.opening(xx, -half+.27, floor+.04, .89, 1.92, side=-1,
                  door=True, diamond=True, divided=False)
        b.box('Annex door thresholds', (xx, -half-.10, floor+.02), (1.22, .82, .15), 'foundation')
    for xx in (-4.57, -.7, 3.39, 7.1):
        b.opening(xx, -half+.27, floor+1.11, .55, .64, side=-1)
    for xx in (-5.8, -1.25, 3.70, 6.30):
        b.opening(xx, half-.28, floor+.75, .93, 1.16, side=1)
    for xx in (2.05, 5.28):
        b.dormer(xx, -1, half, eave, ridge, width=1.67)
    b.dormer(-4.2, 1, half, eave, ridge, width=1.67)
    # Flush rooflights in the northern half, visible in the accommodation photo.
    for xx in (-6.3, -4.85, -3.25):
        yy = -half*.51
        zz = eave+(ridge-eave)*.49+.045
        tilt = math.atan2(ridge-eave, half)
        # Make the glass and white frame genuinely follow the roof pitch.
        w, h = .77, 1.02
        def light_point(u, v, lift=0):
            return (xx+u, yy+v*math.cos(tilt), zz+v*math.sin(tilt)+lift)
        pts = [light_point(u, v) for u, v in [(-w/2, -h/2), (w/2, -h/2), (w/2, h/2), (-w/2, h/2)]]
        b.mesh('Annex rooflight glass', pts, [(0, 1, 2, 3)], 'glass')
        for i in range(4):
            b.beam('Annex rooflight frames', pts[i], pts[(i+1)%4], .06, 'roof_seam')
        b.counts['rooflights'] += 1
    # South gable external access balcony, timber posts and straight return stair.
    deck = 3.73
    bx0, bx1, by0, by1 = x1-.30, x1+2.05, -half+.1, half-.1
    b.box('South gable balcony deck', ((bx0+bx1)/2, 0, deck), (bx1-bx0, by1-by0, .20), 'wood_light')
    for xx in (bx0+.12, bx1-.12):
        for yy in (by0+.12, by1-.12):
            base = b.ground(xx, yy)
            b.box('South balcony timber posts', (xx, yy, (base+deck)/2), (.15, .15, deck-base), 'wood_light')
    b.railing((bx1, by0), (bx1, by1), deck+.10, 1.05, 'wood_light')
    b.railing((bx0, by0), (bx1, by0), deck+.10, 1.05, 'wood_light')
    b.railing((bx0+1.10, by1), (bx1, by1), deck+.10, 1.05, 'wood_light')
    b.opening(x1-.25, 0, deck+.14, .99, 1.97, side=1, axis='y', door=True)
    stair_x0, stair_x1 = bx0+.05, bx0+1.08
    run = 3.90
    stair_bottom = b.ground((stair_x0+stair_x1)/2, by1+run)+.05
    n = max(5, int((deck-stair_bottom)/.18))
    for i in range(n):
        t = i/n
        yy = by1+run*t
        zz = deck+(stair_bottom-deck)*t
        b.box('Annex exterior stair treads', ((stair_x0+stair_x1)/2, yy, zz),
              (stair_x1-stair_x0, run/n+.07, .055), 'wood_light')
    for xx in (stair_x0, stair_x1):
        b.beam('Annex stair stringers', (xx, by1, deck-.12),
               (xx, by1+run, stair_bottom-.12), .16, 'wood_light', .21)
        b.beam('Annex stair handrails', (xx, by1, deck+1.05),
               (xx, by1+run, stair_bottom+1.05), .075, 'wood_light')
        for i in range(n+1):
            t = i/n
            yy, zz = by1+run*t, deck+(stair_bottom-deck)*t
            b.box('Annex stair balusters', (xx, yy, zz+.5), (.055, .055, 1.0), 'wood_light')
    # Small east roof projection in the 2025 trace is a lean-to, not another floor.
    ex0, ex1, ey0, ey1 = 2.4, x1-.25, half-.24, half+1.30
    b.wallbox('East annex shallow projection', ex0, ex1, ey0, ey1, floor, 2.95, 'white_wall')
    b.mesh('East annex projection roof', [(ex0-.15, ey0-.05, 3.69),
           (ex1+.15, ey0-.05, 3.69), (ex1+.15, ey1+.13, 2.99),
           (ex0-.15, ey1+.13, 2.99)], [(0, 1, 2, 3)], 'roof_dark')
    return b.finish({'label': 'Changing rooms and lodging annex', 'ridgeRH2000': round(ridge+8, 3),
                     'eaveRH2000': eave+8, 'roofPlanMetres': [round(length, 2), round(width, 2)],
                     'reconstructedFeatures': ['white lower facade and red timber upper band',
                      'four separate courtyard doors', 'gable dormers and flush rooflights',
                      'south gable timber balcony with usable stair geometry', 'east shallow roof projection']})


def _annex_extension(ctx):
    ring = ctx.ring('B04a')
    center = (sum(p[0] for p in ring)/len(ring), sum(p[1] for p in ring)/len(ring))
    dx, dy = ring[1][0]-ring[0][0], ring[1][1]-ring[0][1]
    length, angle = math.hypot(dx, dy), math.atan2(dy, dx)
    width = abs(-(ring[2][0]-ring[1][0])*math.sin(angle)+(ring[2][1]-ring[1][1])*math.cos(angle))
    b = Parts(ctx, 'B04a', center, angle)
    floor = max(.62, b.ground(0, 0)+.12)
    eave, ridge = floor+2.35, floor+3.1
    b.wallbox('Small annex extension', -length/2+.2, length/2-.2, -width/2+.2, width/2-.2, floor, eave)
    b.pitched_roof(-length/2, length/2, width/2, eave, ridge, 'roof_dark', 'roof_dark', tiled=False)
    for xx in (-length/2+.2, length/2-.2):
        b.gable_wall(xx, width/2-.2, eave, ridge-.1, floor)
    b.trim_corners(-length/2+.2, length/2-.2, -width/2+.2, width/2-.2, floor, eave)
    b.opening(0, width/2-.19, floor+.06, .91, 1.96, side=1, door=True)
    return b.finish({'label': 'Small northwest annex extension', 'roofRH2000': [eave+8, ridge+8],
                     'interpretation': 'Conservative external envelope; connection, function and hidden openings unresolved'})


def _terrace(ctx):
    angle = math.atan2(15.307, 20.26)
    b = Parts(ctx, 'S06', (-3.08, 10.70), angle)
    ring = [((x-b.cx)*b.c+(y-b.cy)*b.s, -(x-b.cx)*b.s+(y-b.cy)*b.c)
            for x, y in ctx.ring('S06')]
    deck = max(.12, max(b.ground(*p) for p in ring)+.08)
    n = len(ring)
    b.mesh('Traced northwest terrace paving',
           [(x, y, z) for z in (deck-.16, deck) for x, y in ring],
           [tuple(reversed(range(n))), tuple(range(n, 2*n))]+
           [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)], 'terrace_paving')
    # The white cross-braced edge is visible in the historic parking panorama.
    # Keep entrances along the inner edge unobstructed.
    for i, j in [(5, 6), (6, 7), (7, 8), (8, 0), (0, 1)]:
        a, end = ring[i], ring[j]
        length = math.dist(a, end)
        count = max(1, round(length/1.75))
        b.beam('Terrace white top rails', (*a, deck+.98), (*end, deck+.98), .10, 'white')
        b.beam('Terrace white lower rails', (*a, deck+.20), (*end, deck+.20), .09, 'white')
        pts = [(a[0]+(end[0]-a[0])*k/count, a[1]+(end[1]-a[1])*k/count)
               for k in range(count+1)]
        for xx, yy in pts:
            base = b.ground(xx, yy)
            b.box('Terrace white posts', (xx, yy, (base+deck+1.05)/2),
                  (.13, .13, deck+1.05-base), 'white')
        for start, stop in zip(pts, pts[1:]):
            b.beam('Terrace crossed railing', (*start, deck+.23), (*stop, deck+.91), .065, 'white')
            b.beam('Terrace crossed railing', (*start, deck+.91), (*stop, deck+.23), .065, 'white')
    # Two small furniture groups are generic fittings, not claims about current
    # occupancy or measured table locations.
    for xx, yy in [(-22.80, 10.75), (-22.27, 4.18)]:
        b.box('Terrace table tops', (xx, yy, deck+.75), (.85, .85, .055), 'wood')
        for dx in (-.31, .31):
            for dy in (-.31, .31):
                b.box('Terrace table legs', (xx+dx, yy+dy, deck+.36), (.045, .045, .73), 'metal')
        for side in (-1, 1):
            b.box('Terrace chair seats', (xx, yy+side*.91, deck+.44), (.45, .45, .045), 'wood')
            b.box('Terrace chair backs', (xx, yy+side*1.12, deck+.70), (.45, .045, .47), 'wood')
            for dx in (-.17, .17):
                for dy in (-.17, .17):
                    b.box('Terrace chair legs', (xx+dx, yy+side*.91+dy, deck+.21), (.035, .035, .43), 'metal')
    return b.finish({'label': 'Restaurant northwest terrace', 'deckRH2000': round(deck+8, 3),
                     'heightEvidence': 'Traced platform; finished deck elevation estimated above measured ground',
                     'reconstructedFeatures': ['traced paved footprint', 'white crossed boundary railing', 'generic movable patio furniture']})


def build(ctx):
    for name, rgb, rough in [
        ('tile_highlight', (.43, .16, .065), .87),
        ('tile_shadow', (.25, .070, .028), .9),
        ('dormer_dark', (.080, .052, .043), .88),
        ('white_wall', (.78, .79, .74), .96),
        ('wood_light', (.45, .31, .12), .90),
        ('brick', (.43, .135, .055), .96),
        ('brick_mortar', (.25, .19, .145), .95),
        ('terrace_paving', (.48, .49, .44), .96),
    ]:
        ctx.material(name, rgb, roughness=rough)
    reports = [_restaurant(ctx), _reception(ctx),
               _annex(ctx), _annex_extension(ctx), _terrace(ctx)]
    return {'facilities': reports, 'referenceTextureCount': 0,
            'omittedReferences': [{
                'id': 'B02', 'status': 'Unresolved shadow-like orthophoto strip; no generated geometry',
                'reason': 'The strip sits outside the northwest glazed-extension roof. Neither the authentic parking panorama nor drone overview supports an additional freestanding canopy; only 2% of the neighboring low-plane laser support falls within this trace.',
                'retainedEvidence': 'Original B02 trace and height-plane study remain in the reference package; inference is not a confirmed shadow classification',
            }],
            'geometryFrame': 'EPSG3006 east/north; origin E605530 N6605140; Z=RH2000-8',
            'method': 'Orthophoto-plan and laser-ridge reconstruction; photo-informed details labeled as inference'}
