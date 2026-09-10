"""Photo-informed clubhouse geometry. Import inside Blender; build performs no I/O.

Dimensions in plan follow the supplied orthophoto roof rectangle. Heights, wall
inset and furniture dimensions remain explicit architectural estimates.
"""
import math
import statistics


def build(g, feature, ground):
    ring = [tuple(p[:2]) for p in feature['ringBlenderXY']]
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    assert len(ring) >= 4
    edge = max(zip(ring, ring[1:] + ring[:1]),
               key=lambda e: math.dist(e[0], e[1]))
    dx, dy = edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]
    if dx < 0:
        dx, dy = -dx, -dy
    angle = math.atan2(dy, dx)
    c, s = math.cos(angle), math.sin(angle)
    projected = [(x*c + y*s, -x*s + y*c) for x, y in ring]
    lo_x, hi_x = min(p[0] for p in projected), max(p[0] for p in projected)
    lo_y, hi_y = min(p[1] for p in projected), max(p[1] for p in projected)
    local_center = ((lo_x + hi_x)/2, (lo_y + hi_y)/2)
    cx, cy = (local_center[0]*c - local_center[1]*s,
              local_center[0]*s + local_center[1]*c)
    roof_length, roof_width = hi_x - lo_x, hi_y - lo_y
    overhang = .36
    length, width = roof_length - overhang*2, roof_width - overhang*2
    assert length > width > 2
    levels = [ground(x, y) for x, y in ring] + [ground(cx, cy)]
    base = statistics.median(levels) + .14
    foundation_bottom = min(levels) - .18
    eave, ridge = base + 4.55, base + 6.95
    g.feature = feature['id']
    n = feature['id'] + ' | '

    def p(x, y, z):
        return (cx + c*x - s*y, cy + s*x + c*y, z)

    def box(name, x, y, z, a, b, h, mat):
        return g.box(n + name, p(x, y, z), (a, b, h), mat, angle)

    def beam(name, a, b, thickness, mat='trim', depth=None):
        return g.beam(n + name, p(*a), p(*b), thickness, mat, depth)

    box('stone foundation', 0, 0, (foundation_bottom + base)/2,
        length, width, base - foundation_bottom, 'stone')
    box('yellow timber walls', 0, 0, (base + eave)/2,
        length, width, eave - base, 'yellow')
    g.roof(n + 'weathered clay gable roof', (cx, cy), roof_length, roof_width,
           eave, ridge, angle, 'tile')
    # Yellow gables cover the roof volume's end triangles at the wall position.
    wall_ridge = ridge - .055
    for side in (-1, 1):
        x = side*(length/2 + .025)
        g.mesh(n + f'{side} yellow gable infill',
               [p(x,-width/2,eave-.025), p(x,width/2,eave-.025), p(x,0,wall_ridge)],
               [(0,1,2)], 'yellow')
        for y in (-width/2, width/2):
            box(f'{side} {y} pale corner board', x, y, (base+eave)/2,
                .14, .14, eave-base, 'trim')
        # Sparse raised cover strips represent real vertical board-and-batten siding.
        count = max(1, round(width/.21))
        for j in range(1, count):
            y = -width/2 + width*j/count
            top = eave + (wall_ridge-eave)*(1-abs(y)/(width/2))
            box(f'{side} gable cover strip {j}', x, y, (base+top)/2,
                .025, .035, top-base, 'yellow')
        for y in (-roof_width/2, roof_width/2):
            beam(f'{side} {y} pale bargeboard',
                 (side*roof_length/2,y,eave),
                 (side*roof_length/2,0,ridge), .14, 'trim', .09)
    for side in (-1, 1):
        y = side*(width/2 + .025)
        count = max(1, round(length/.21))
        for j in range(1, count):
            x = -length/2 + length*j/count
            box(f'{side} long wall cover strip {j}', x,y,(base+eave)/2,
                .035,.025,eave-base,'yellow')
        beam(f'{side} dark gutter', (-roof_length/2,side*roof_width/2,eave+.02),
             (roof_length/2,side*roof_width/2,eave+.02), .11, 'metal')
    for x in (-length/2, length/2):
        beam(f'{x} south downpipe', (x,-width/2-.11,eave),
             (x,-width/2-.11,base+.12), .075, 'metal')

    # Low mesh roof relief: horizontal tile laps and selected longitudinal joints.
    slope_length = math.hypot(roof_width/2, ridge-eave)
    courses = max(1, round(slope_length/.33))
    for side in (-1, 1):
        for j in range(1, courses):
            t = j/courses
            y = side*roof_width/2*(1-t)
            z = eave + (ridge-eave)*t + .018
            beam(f'{side} tile course {j}', (-roof_length/2,y,z),
                 (roof_length/2,y,z), .025, 'tile_light' if j%4 == 0 else 'tile')
    beam('ridge clay capping', (-roof_length/2,0,ridge+.045),
         (roof_length/2,0,ridge+.045), .17, 'tile_light', .12)
    chimney_x = -length*.19
    box('red brick chimney', chimney_x, .18, ridge+.36, .59,.66,1.15,'tile_light')
    box('chimney stone cap', chimney_x,.18,ridge+.97,.72,.79,.11,'stone')
    box('small galvanized roof vent', length*.04, .18, ridge+.08,.30,.30,.29,'trim')

    def window(name, face, u, height, w, h, rows=4, door=False):
        # face is south, east or west; u runs along that face in local XY.
        z = base+height
        depth = .09
        if face == 'south':
            center = (u,-width/2-.07,z)
            dims = (w,depth,h)
            def q(a,b): return (u+a,-width/2-.125,z+b)
        else:
            side = 1 if face == 'east' else -1
            center = (side*(length/2+.07),u,z)
            dims = (depth,w,h)
            def q(a,b): return (side*(length/2+.125),u+a,z+b)
        box(name+' dark glass', *center, *dims, 'glass')
        for a in (-w/2,w/2):
            beam(name+' upright '+str(a),q(a,-h/2),q(a,h/2),.095)
        for b in (-h/2,h/2):
            beam(name+' surround '+str(b),q(-w/2,b),q(w/2,b),.095)
        beam(name+' center mullion',q(0,-h/2),q(0,h/2),.045)
        for j in range(1, rows):
            b = -h/2+h*j/rows
            beam(name+' crossbar '+str(j),q(-w/2,b),q(w/2,b),.035)
        if door:
            beam(name+' handle',q(w*.28,-.15),q(w*.28,.10),.032,'metal')

    # Only photographed elevations receive detailed openings.
    for x in (-length*.31, length*.02, length*.32):
        window(f'south upper two-pane light {x}', 'south',x,3.95,.88,.36,1)
    for x in (-length*.31, length*.31):
        window(f'south tall window {x}', 'south',x,1.94,1.45,1.94)
    window('south entrance glazed door','south',-.10,1.53,1.03,2.38,4,True)
    window('south middle glazed opening','south',length*.105,1.94,1.0,1.94)
    window('east upper gable window','east',0,4.60,1.27,1.66)
    window('east lower window','east',width*.265,1.35,1.25,1.32)
    window('east glazed side door','east',-width*.20,1.35,1.05,2.25,1,True)
    window('west upper gable window','west',0,4.60,1.22,1.62)
    window('west lower gable window','west',width*.03,1.58,1.23,1.85)
    # Characteristic circular west-gable light visible beside the lower window.
    circle_y, circle_z, radius = -width*.28, base+2.01, .36
    ring_points = [( -length/2-.10, circle_y+radius*math.cos(j*math.tau/24),
                     circle_z+radius*math.sin(j*math.tau/24)) for j in range(24)]
    g.mesh(n+'west circular glass',[p(*a) for a in ring_points],[tuple(range(24))],'glass')
    for j in range(24):
        beam('west circular trim '+str(j),ring_points[j],ring_points[(j+1)%24],.075)

    terrace_depth, terrace_west = 3.20, 2.05
    deck_top = base+.26
    deck_south = -width/2-terrace_depth
    deck_west = -length/2-terrace_west
    # Terrace follows the south facade and wraps the west gable, as in club-136.
    box('south restaurant timber deck', -terrace_west/2,-width/2-terrace_depth/2,deck_top-.12,
        length+terrace_west,terrace_depth,.24,'wood')
    box('west timber deck return',-length/2-terrace_west/2,-.60,deck_top-.12,
        terrace_west,width-1.2,.24,'wood')
    for j in range(round((length+terrace_west)/.25)):
        x = deck_west+j*.25
        beam('south deck board seam '+str(j),(x,-width/2,deck_top+.012),
             (x,deck_south,deck_top+.012),.014,'trim')

    def railing(name, a, b):
        run = math.dist(a,b)
        count = max(1,round(run/1.75))
        points = [(a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count) for j in range(count+1)]
        for j,(x,y) in enumerate(points):
            beam(name+f' post {j}',(x,y,deck_top),(x,y,deck_top+.97),.09)
        beam(name+' upper rail',(*a,deck_top+.95),(*b,deck_top+.95),.085)
        beam(name+' lower rail',(*a,deck_top+.12),(*b,deck_top+.12),.065)
        for j,(start,end) in enumerate(zip(points,points[1:])):
            beam(name+f' X rising {j}',(*start,deck_top+.17),(*end,deck_top+.88),.055)
            beam(name+f' X falling {j}',(*start,deck_top+.88),(*end,deck_top+.17),.055)

    stair_x, stair_width = length*.20, 1.62
    railing('south west railing',(deck_west,deck_south),(stair_x-stair_width/2,deck_south))
    railing('south east railing',(stair_x+stair_width/2,deck_south),(length/2,deck_south))
    railing('east terrace end',(length/2,deck_south),(length/2,-width/2))
    railing('west terrace edge',(deck_west,deck_south),(deck_west,width/2-1.2))
    # Stair sizes are inferred from the photographs, sampled ground fixes the last riser.
    stair_ground = ground(*p(stair_x,deck_south-.95,0)[:2])
    step_rise = max(.10,(deck_top-stair_ground)/3)
    for j in range(3):
        top = deck_top-step_rise*j
        box('south terrace stair '+str(j),stair_x,deck_south-.20-.30*j,
            (top+stair_ground)/2,stair_width,.35,max(.08,top-stair_ground),'wood')
    # Pale retractable striped awning; ribs use geometry, without copied pixels.
    awning_z = base+3.18
    awning_projection = .66
    for side in (-1,1):
        x = side*length*.265
        a = length*.41
        vertices=[p(x-a/2,-width/2-.10,awning_z),p(x+a/2,-width/2-.10,awning_z),
                  p(x+a/2,-width/2-awning_projection,awning_z-.13),p(x-a/2,-width/2-awning_projection,awning_z-.13)]
        g.mesh(n+f'{side} pale folding awning',vertices,[(0,1,2,3)],'white')
        beam(f'{side} awning front', (x-a/2,-width/2-awning_projection,awning_z-.13),
             (x+a/2,-width/2-awning_projection,awning_z-.13),.08,'trim')
    # Furniture distribution is illustrative, not an inventory of movable objects.
    for i,(x,y) in enumerate([(-length*.29,-width/2-1.70),(length*.05,-width/2-1.7),
                               (length*.34,-width/2-1.72)]):
        box(f'terrace table {i}',x,y,deck_top+.76,1.10,.76,.06,'trim')
        for lx in (-.4,.4):
            for ly in (-.25,.25):
                beam(f'table {i} leg {lx} {ly}',(x+lx,y+ly,deck_top),(x+lx,y+ly,deck_top+.74),.045,'metal')
        for side in (-1,1):
            chair_y = y+side*.67
            box(f'chair {i} {side} seat',x,chair_y,deck_top+.44,.43,.44,.045,'trim')
            box(f'chair {i} {side} back',x,chair_y+side*.2,deck_top+.75,.43,.045,.48,'trim')
            for lx in (-.17,.17):
                for ly in (-.17,.17):
                    beam(f'chair {i} {side} leg {lx} {ly}',(x+lx,chair_y+ly,deck_top),
                         (x+lx,chair_y+ly,deck_top+.44),.026,'metal')
        if i < 2:
            umbrella_top = deck_top+2.60
            beam(f'umbrella {i} pole',(x,y,deck_top),(x,y,umbrella_top),.045,'trim')
            umbrella_radius = 1.40 if i == 0 else 1.05
            points = [p(x,y,umbrella_top)] + [p(x+umbrella_radius*math.cos(j*math.tau/8),
                       y+umbrella_radius*math.sin(j*math.tau/8),umbrella_top-.35) for j in range(8)]
            g.mesh(n+f'umbrella {i} canopy',points,[(0,1+j,1+(j+1)%8) for j in range(8)],'trim' if i==0 else 'green')
    return {
        'id': feature['id'], 'type': 'photo-informed-clubhouse',
        'centerBlenderXY': [cx,cy], 'angleRadians': angle,
        'roofPlanMetres': [roof_length,roof_width], 'wallPlanMetres': [length,width],
        'baseRh2000': base, 'foundationBottomRh2000': foundation_bottom,
        'groundSampleRangeRh2000': [min(levels),max(levels)],
        'eaveHeightAboveBaseM': 4.55, 'ridgeHeightAboveBaseM': 6.95,
        'heightEvidence': 'Photographic architectural estimates, not surveyed heights.',
        'planEvidence': 'Supplied traced orthophoto roof outline; wall inset .36 m is estimated.',
        'photoReferences': ['club-127','club-136','club-128'],
        'terraceEvidence': 'South deck and west return visible in club-136; dimensions and furniture layout estimated.',
        'unresolved': ['North facade openings unseen and left plain.',
                       'Exact measured eave/ridge and terrace dimensions unavailable.',
                       'Some central facade openings partially occluded by umbrellas.',
                       'Roof service fittings simplified; no people, logos or source textures reproduced.'],
    }
