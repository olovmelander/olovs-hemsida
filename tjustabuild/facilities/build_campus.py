"""Tjusta Gård's buildings by the course, modelled from measured levels (Blender 5.2+, headless, data API only).

    blender --background --factory-startup --python tjustabuild/facilities/build_campus.py -- --out tjustabuild/cache/facilities

The clubhouse is the farm's big barn (OSM way 48232863): a gambrel-roofed barn 56 m long with a cross wing at
its north end, a terrace on posts west of it, an annex on its south gable and a canopy on its west wall. Beside
it stand the farm's two machine halls, and at the range the open tee shelter.

Levels are RH 2000 from Laserdata Skog 2021-04-17 (tjustabuild/cache/microterrain, read along each building's own
ridge with tools/facility-pipeline/measure-building.mjs and fitted lines through the ridge and eave returns);
plans from the 2025-06-14 orthophoto with 2023, 2021 and 2019 beside it; the order of the barn's north front,
its west wing and the terrace from the club's own photographs, and the shelter's from another (reference only,
never textures). What no source shows is listed in README.md.

Each building is drawn in its own frame (u along its ridge, v to the left of it, z in RH 2000); the scene is
laid out so the glTF exporter gives exactly the app's frame (tools/facility-pipeline/campus_mesh.py).
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/facility-pipeline'))
from campus_mesh import Frame, Mesh, Terrain, linear, write_campus  # noqa: E402

ORIGIN = (669130.5, 6611250.5)
TERRAIN = ROOT / 'packages/course-geo/toolchain/.cache/acquisition/tjusta-ground-rings'
ground = None

# sRGB colours read off the photographs, each under the glow's threshold; roughness
MATERIALS = {
    'falu': (linear(0x8a3a2e), 0.92),            # the barn's boards: falu red, as the scenery module's clubhouse
    'falu_shade': (linear(0x74302a), 0.92),      # the same under a deck or a canopy
    'roof': (linear(0x3a3c3d), 0.85),            # weathered dark corrugated sheets
    'roof_black': (linear(0x232528), 0.7),       # the terrace building's and the black hall's newer sheet
    'trim': (linear(0x4a4f55), 0.8),             # corner boards, bargeboards, doors: dark grey
    'frame': (linear(0xe2ded2), 0.7),            # window frames, the vents' louvres
    'glass': (linear(0x1c2228), 0.15),
    'concrete': (linear(0x8f8c84), 0.95),
    'deck': (linear(0x9a917f), 0.9),             # weathered timber
    'door_green': (linear(0x35594f), 0.6),
    'sign': (linear(0x2f6fb0), 0.5),
    'sheet_dark': (linear(0x3b4350), 0.6),       # the black hall's walls: blue-black where the photo shows a gable
    'sheet_grey': (linear(0x8d9498), 0.6),       # the grey hall's walls
    'sheet_roof': (linear(0x666d73), 0.5),       # the grey hall's roof
    'sheet_white': (linear(0xd9d8cf), 0.7),      # the shelter's lining
}


def base(frame, corners, sink=0.6):
    """The lowest ground under a plan, less a little: walls go down into the terrain, which is drawn over them."""
    return min(ground(*frame.grid(u, v)) for u, v in corners) - sink


def block(m, wall, roof, edge, a0, a1, half, eave, ridge, z0, axis='u', centre=0.0, over=0.45, verge=0.4, ends=(True, True), sides=(True, True)):
    """A gabled block: walls `half` either side of `centre`, eaves `over` out at `eave`, the ridge at `ridge`."""
    rise = (ridge - eave) / (half + over)
    top = eave + rise * over                              # the roof's height over the wall
    P = (lambda along, c: (along, c)) if axis == 'u' else (lambda along, c: (c, along))
    out = (lambda s: (0, s)) if axis == 'u' else (lambda s: (s, 0))
    m.roof(roof, [(centre - half - over, eave), (centre, ridge), (centre + half + over, eave)], a0 - verge * ends[0], a1 + verge * ends[1], axis, edge)
    for s, on in ((-1, sides[0]), (1, sides[1])):
        if on:
            m.wall(wall, P(a0, centre + s * half), P(a1, centre + s * half), z0, top - 0.02, out(s))
    section = [(centre - half, z0), (centre + half, z0), (centre + half, top - 0.02), (centre, ridge - 0.03), (centre - half, top - 0.02)]
    for at, on, s in ((a0, ends[0], -1), (a1, ends[1], 1)):
        if on:
            m.gable(wall, section, at, axis, s)
    return top


# ---------------------------------------------------------------------------------------------- the clubhouse

BARN = dict(e=669118.12, n=6611343.57, bearing=17.29)     # on the ridge, mid-length; u runs north-north-east
B_S, B_N = -27.8, 28.4                                     # the south and north gable walls
B_HALF, B_EAVE_OUT = 7.6, 8.05                             # walls and eave edges either side of the ridge
B_EAVE, B_BREAK_V, B_BREAK, B_RIDGE = 26.55, 5.5, 30.9, 33.69
W_RIDGE_U, W_HALF, W_OUT, W_EAVE, W_RIDGE = 22.5, 5.7, 6.15, 25.55, 30.08   # the cross wing, its ridge along v
W_WEST, W_EAST = 15.2, -18.0                               # the wings' gable walls


def clubhouse():
    f = Frame(ORIGIN, BARN['e'], BARN['n'], BARN['bearing'])
    m = Mesh(f)
    z0 = base(f, [(B_S, -B_HALF), (B_S, B_HALF), (B_N, -B_HALF), (B_N, B_HALF), (W_RIDGE_U, W_WEST), (W_RIDGE_U, W_EAST)])
    lower = (B_BREAK - B_EAVE) / (B_EAVE_OUT - B_BREAK_V)
    wall_top = B_EAVE + lower * (B_EAVE_OUT - B_HALF)
    # the barn: a gambrel roof on walls 15.2 m apart
    m.roof('roof', [(-B_EAVE_OUT, B_EAVE), (-B_BREAK_V, B_BREAK), (0, B_RIDGE), (B_BREAK_V, B_BREAK), (B_EAVE_OUT, B_EAVE)], B_S - 0.45, B_N + 0.45, 'u', 'trim', 0.28)
    section = [(-B_HALF, z0), (B_HALF, z0), (B_HALF, wall_top - 0.02), (B_BREAK_V, B_BREAK - 0.04), (0, B_RIDGE - 0.04), (-B_BREAK_V, B_BREAK - 0.04), (-B_HALF, wall_top - 0.02)]
    m.gable('falu', section, B_S, 'u', -1)
    m.gable('falu', section, B_N, 'u', 1)
    for s in (-1, 1):
        m.wall('falu', (B_S, s * B_HALF), (B_N, s * B_HALF), z0, wall_top - 0.02, (0, s))
        for u in (B_S, B_N):                                   # corner boards
            m.panel('trim', (u - 0.11, s * B_HALF), (u + 0.11, s * B_HALF), z0, wall_top - 0.05, (0, s), 0.03)
    for v in (-B_HALF, B_HALF):
        m.panel('trim', (B_N, v - 0.11), (B_N, v + 0.11), z0, wall_top - 0.05, (1, 0), 0.03)
        m.panel('trim', (B_S, v - 0.11), (B_S, v + 0.11), z0, wall_top - 0.05, (-1, 0), 0.03)
    # the north front: a low door, two round vents under the gambrel's break, a concrete dock at its foot
    gn = ground(*f.grid(B_N + 1.5, 0))
    m.panel('trim', (B_N, -1.0), (B_N, 0.0), gn + 0.9, gn + 2.95, (1, 0), 0.05)
    for v in (-2.35, -0.65):
        m.panel('trim', (B_N, v - 0.52), (B_N, v + 0.52), 29.88, 30.92, (1, 0), 0.04)
        m.disc('frame', (B_N, v, 30.4), 0.36, (1, 0), 0.07)
    m.box('concrete', B_N, B_N + 2.0, -7.0, 7.4, z0, gn + 0.9)
    m.box('concrete', B_N + 2.0, B_N + 2.9, -0.5, 7.4, z0, gn + 0.45)
    # the cross wing: one gabled roof across the barn's north end, its ridge 3.6 m under the barn's
    for v0, v1, end in ((B_HALF, W_WEST, 1), (-B_HALF, W_EAST, -1)):
        a0, a1 = (v0, v1 + 0.4) if end > 0 else (v1 - 0.4, v0)
        m.roof('roof', [(W_RIDGE_U - W_OUT, W_EAVE), (W_RIDGE_U, W_RIDGE), (W_RIDGE_U + W_OUT, W_EAVE)], a0, a1, 'v', 'trim', 0.24)
        rise = (W_RIDGE - W_EAVE) / W_OUT
        # where the wing's roof runs up the barn's lower slope: the two valleys, from the wall line to the wing's ridge
        meet, reach = B_EAVE_OUT - (W_RIDGE - B_EAVE) / lower, (W_RIDGE - wall_top) / rise
        for s in (-1, 1):
            m.face('roof', [(W_RIDGE_U, end * B_HALF, W_RIDGE), (W_RIDGE_U, end * meet, W_RIDGE), (W_RIDGE_U + s * reach, end * B_HALF, wall_top)], (0, 0, 1))
        top = W_EAVE + rise * (W_OUT - W_HALF)
        for s in (-1, 1):
            m.wall('falu', (W_RIDGE_U + s * W_HALF, v0), (W_RIDGE_U + s * W_HALF, v1), z0, top - 0.02, (s, 0))
            m.panel('trim', (W_RIDGE_U + s * W_HALF, v0), (W_RIDGE_U + s * W_HALF, v1), top - 0.42, top - 0.06, (s, 0), 0.03)   # the dark band under the eave
            m.panel('trim', (W_RIDGE_U + s * W_HALF, v1 - end * 0.22), (W_RIDGE_U + s * W_HALF, v1), z0, top - 0.06, (s, 0), 0.04)
        m.gable('falu', [(W_RIDGE_U - W_HALF, z0), (W_RIDGE_U + W_HALF, z0), (W_RIDGE_U + W_HALF, top - 0.02), (W_RIDGE_U, W_RIDGE - 0.03), (W_RIDGE_U - W_HALF, top - 0.02)], v1, 'v', end)
    north = W_RIDGE_U + W_HALF
    # the east wing: the wide grey double door beside the barn, and the open doorway in its gable
    ge = ground(*f.grid(north + 1.5, -12.0))
    m.panel('trim', (north, -11.9), (north, -8.3), ge + 0.05, ge + 2.95, (1, 0), 0.05)
    m.panel('falu_shade', (north, -10.12), (north, -10.08), ge + 0.05, ge + 2.95, (1, 0), 0.06)
    gg = ground(*f.grid(W_RIDGE_U, W_EAST - 1.5))
    m.panel('glass', (W_RIDGE_U - 2.0, W_EAST), (W_RIDGE_U + 1.6, W_EAST), gg + 0.05, gg + 3.3, (0, -1), 0.04)
    # the west wing, the club's own front: three windows above, two below, and the door under its little roof
    gw = ground(*f.grid(north + 1.5, 11.0))
    for v in (8.9, 11.5, 13.35):
        m.window((north, v - 0.5), (north, v + 0.5), gw + 3.45, gw + 4.6, (1, 0))
    for v in (9.0, 11.4):
        m.window((north, v - 0.5), (north, v + 0.5), gw + 0.95, gw + 2.1, (1, 0))
    dv = 13.75
    m.panel('door_green', (north, dv - 0.5), (north, dv + 0.5), gw + 0.1, gw + 2.15, (1, 0), 0.05)
    m.panel('trim', (north, dv - 0.62), (north, dv - 0.5), gw + 0.1, gw + 2.25, (1, 0), 0.06)
    m.panel('trim', (north, dv + 0.5), (north, dv + 0.62), gw + 0.1, gw + 2.25, (1, 0), 0.06)
    m.roof('roof_black', [(dv - 1.05, gw + 2.5), (dv, gw + 3.05), (dv + 1.05, gw + 2.5)], north, north + 1.1, 'u', 'trim', 0.12)
    m.gable('falu', [(dv - 0.95, gw + 2.42), (dv + 0.95, gw + 2.42), (dv, gw + 2.98)], north + 1.0, 'u', 1)
    m.disc('sign', (north + 1.0, dv, gw + 2.66), 0.2, (1, 0), 0.04)
    for v in (dv - 0.95, dv + 0.95):
        m.box('trim', north + 0.92, north + 1.04, v - 0.06, v + 0.06, gw, gw + 2.45)
    # the annex on the south gable: a small gabled room, its ridge 4.2 m up
    az = base(f, [(-33.0, -1.6), (-33.0, 7.0)])
    block(m, 'falu', 'roof', 'trim', -32.9, B_S, 4.3, 23.5, 25.35, az, 'u', centre=2.7, over=0.3, verge=0.3, ends=(True, False))
    gs = ground(*f.grid(-34.0, 2.7))
    m.panel('trim', (-32.9, 1.7), (-32.9, 3.7), gs + 0.05, gs + 2.3, (-1, 0), 0.05)
    # the canopy on the west wall: a flat roof at 24.15 on four posts
    gc = base(f, [(-27.3, 11.0), (-17.7, 11.0)], 0.3)
    m.box('roof_black', -27.3, -17.7, B_HALF, 11.2, 24.0, 24.15, bottom=True)
    for u in (-27.1, -24.0, -21.0, -17.9):
        m.box('trim', u - 0.07, u + 0.07, 10.95, 11.09, gc, 24.0)
    # the yard side: two tall doors in the barn's east wall (estimated)
    for u in (-14.0, 4.0):
        gy = ground(*f.grid(u, -B_HALF - 1.5))
        m.panel('trim', (u - 1.9, -B_HALF), (u + 1.9, -B_HALF), gy + 0.05, gy + 3.9, (0, -1), 0.05)
    return m, f


T_EAVE, T_RIDGE, T_RIDGE_U, T_HALF, T_OUT = 23.86, 26.58, 23.0, 4.0, 4.4
T_V0, T_V1 = W_WEST + 0.05, 29.6
DECK = 22.26
D_U0, D_U1, D_V0, D_V1 = T_RIDGE_U + T_HALF, 30.5, 16.0, 31.0


def terrace():
    f = Frame(ORIGIN, BARN['e'], BARN['n'], BARN['bearing'])
    m = Mesh(f)
    z0 = base(f, [(19.0, T_V0), (19.0, T_V1), (D_U1, D_V0), (D_U1, D_V1)])
    # the low building behind the terrace: black sheet roof, its eave just over the deck's rail
    block(m, 'falu_shade', 'roof_black', 'trim', T_V0, T_V1, T_HALF, T_EAVE, T_RIDGE, z0, 'v', centre=T_RIDGE_U, over=T_OUT - T_HALF, verge=0.4, ends=(False, True))
    # the deck: a timber floor 2.3 to 2.6 m over the lawn, on posts
    m.box('deck', D_U0 - 0.2, D_U1, D_V0, D_V1, DECK - 0.2, DECK, bottom=True)
    m.box('deck', D_U1 - 0.12, D_U1, D_V0, D_V1, DECK - 0.42, DECK - 0.2, bottom=True)
    for i in range(6):
        v = D_V0 + 0.3 + (D_V1 - D_V0 - 0.6) * i / 5
        for u in (D_U1 - 0.2, D_U0 + 1.2):
            g = ground(*f.grid(u, v)) - 0.3
            m.box('deck', u - 0.08, u + 0.08, v - 0.08, v + 0.08, g, DECK - 0.2)
    m.rail('deck', (D_U1 - 0.06, D_V0), (D_U1 - 0.06, D_V1), DECK)
    m.rail('deck', (D_U0 + 1.0, D_V0 + 0.06), (D_U1 - 0.06, D_V0 + 0.06), DECK)
    m.rail('deck', (D_U0 + 2.3, D_V1 - 0.06), (D_U1 - 0.06, D_V1 - 0.06), DECK)
    # the stair at its west end, down to the lawn (its place from the club's photograph, its steps estimated)
    gs = ground(*f.grid(D_U0 + 1.2, D_V1 + 3.0))
    steps = max(4, round((DECK - gs) / 0.19))
    for i in range(steps):
        zt = DECK - (i + 1) * (DECK - gs) / steps
        m.box('deck', D_U0 + 0.3, D_U0 + 2.1, D_V1 + i * 0.28, D_V1 + (i + 1) * 0.28, zt - 0.06, zt, bottom=True)
    # under the deck: the wall's noticeboards, as the photograph shows them
    gw = ground(*f.grid(D_U0 + 0.5, 20.0))
    for v in (18.2, 21.0):
        m.panel('frame', (D_U0, v - 0.55), (D_U0, v + 0.55), gw + 0.9, gw + 1.75, (1, 0), 0.04)
    return m, f


# ---------------------------------------------------------------------------------------------- the two halls

def black_hall():
    f = Frame(ORIGIN, 669109.23, 6611285.33, 106.91)
    m = Mesh(f)
    u0, u1, half = -33.7, 28.9, 11.2
    z0 = base(f, [(u0, -half), (u0, half), (u1, -half), (u1, half)])
    block(m, 'sheet_dark', 'roof_black', 'trim', u0, u1, half, 26.09, 31.54, z0, 'u', over=0.43, verge=0.3)
    # tall sliding doors toward the yard (estimated: no photograph shows this hall's walls from the ground)
    for u in (-22.0, -4.0, 14.0):
        g = ground(*f.grid(u, half + 1.5))
        m.panel('trim', (u - 2.6, half), (u + 2.6, half), g + 0.05, g + 4.1, (0, 1), 0.05)
        m.panel('sheet_dark', (u - 0.03, half), (u + 0.03, half), g + 0.05, g + 4.1, (0, 1), 0.06)
    return m, f


def grey_hall():
    f = Frame(ORIGIN, 669181.40, 6611329.07, 106.45)
    m = Mesh(f)
    u0, half, eave, ridge = -21.2, 9.6, 26.0, 30.2
    cu, c_w, c_e, v_s, v_n = 16.2, 8.6, 25.5, -16.9, 10.0
    z0 = base(f, [(u0, -half), (u0, half), (c_e, v_s), (c_e, v_n)])
    # the main hall: a plain gabled roof, its ridge measured, its eaves from four returns at 25.8 to 26.4
    block(m, 'sheet_grey', 'sheet_roof', 'trim', u0, cu, half, eave, ridge, z0, 'u', over=0.4, verge=0.3, ends=(True, False))
    # the cross hall at its east end: its ridge meets the main one, its east roof runs lower and longer
    rise = (ridge - eave) / (cu - c_w)
    m.roof('sheet_roof', [(c_w, eave), (cu, ridge), (c_e, 22.9)], v_s - 0.3, v_n + 0.3, 'v', 'trim')
    w_top, e_top = eave + rise * 0.4, 22.9 + (ridge - 22.9) / (c_e - cu) * 0.4
    section = [(c_w + 0.4, z0), (c_e - 0.4, z0), (c_e - 0.4, e_top - 0.02), (cu, ridge - 0.03), (c_w + 0.4, w_top - 0.02)]
    m.gable('sheet_grey', section, v_s, 'v', -1)
    m.gable('sheet_grey', section, v_n, 'v', 1)
    m.wall('sheet_grey', (c_e - 0.4, v_s), (c_e - 0.4, v_n), z0, e_top - 0.02, (1, 0))
    m.wall('sheet_grey', (c_w + 0.4, v_s), (c_w + 0.4, -half), z0, w_top - 0.02, (-1, 0))
    for u in (-12.0, 0.0):                                     # doors to the yard (estimated)
        g = ground(*f.grid(u, -half - 1.5))
        m.panel('trim', (u - 2.4, -half), (u + 2.4, -half), g + 0.05, g + 4.3, (0, -1), 0.05)
    return m, f


# --------------------------------------------------------------------------------------------- the range's shelter

def range_shelter():
    f = Frame(ORIGIN, 669081.47, 6611532.75, 23.1)
    m = Mesh(f)
    u0, u1, back, front, high, low = -8.6, 2.0, -1.4, 4.6, 21.7, 20.45
    z0 = base(f, [(u0, back), (u0, front), (u1, back), (u1, front)], 0.4)
    gf = ground(*f.grid((u0 + u1) / 2, front + 1.0))
    # a single-pitch black roof, high over the open front toward the range
    m.roof('roof_black', [(back - 0.3, low - 0.06), (front + 0.5, high + 0.1)], u0 - 0.25, u1 + 0.25, 'u', 'trim', 0.2)
    wall_at = lambda v: low + (high - low) * (v - back) / (front - back)
    for u, s in ((u0, -1), (u1, 1)):                            # the red ends, white inside
        m.gable('falu', [(back, z0), (front, z0), (front, wall_at(front) - 0.05), (back, wall_at(back) - 0.05)], u, 'u', s)
        m.gable('sheet_white', [(back + 0.05, gf), (front - 0.05, gf), (front - 0.05, wall_at(front) - 0.1), (back + 0.05, wall_at(back) - 0.1)], u - s * 0.06, 'u', -s)
    m.wall('falu', (u0, back), (u1, back), z0, wall_at(back) - 0.05, (0, -1))
    m.wall('sheet_white', (u0 + 0.06, back + 0.06), (u1 - 0.06, back + 0.06), gf, wall_at(back) - 0.1, (0, 1))
    mid = (u0 + u1) / 2
    for s in (-1, 1):                                             # the wall between the two bays, under the roof's slope
        m.gable('sheet_white', [(back + 0.06, gf), (front - 0.3, gf), (front - 0.3, wall_at(front - 0.3) - 0.14), (back + 0.06, wall_at(back + 0.06) - 0.14)], mid + s * 0.06, 'u', s)
    m.wall('sheet_white', (mid - 0.06, front - 0.3), (mid + 0.06, front - 0.3), gf, wall_at(front - 0.3) - 0.14, (0, 1))
    for a, b in ((u0 + 0.7, mid - 0.7), (mid + 0.7, u1 - 0.7)):   # the band of frosted panes in the back wall
        m.panel('frame', (a, back + 0.06), (b, back + 0.06), gf + 1.75, gf + 2.35, (0, 1), 0.03)
    m.box('concrete', u0, u1, back, front + 0.4, z0, gf + 0.03)
    return m, f


def plan(frame, corners):
    return [frame.grid(u, v) for u, v in corners]


def main():
    global ground
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args(argv)
    ground = Terrain(TERRAIN)
    laser = 'Laserdata Skog 2021-04-17'
    built = []

    def add(build, **spec):
        mesh, frame = build()
        built.append(dict(mesh=mesh, anchor=frame.grid(*spec.pop('anchor')), footprint=plan(frame, spec.pop('corners')), **spec))

    north = W_RIDGE_U + W_HALF
    south = W_RIDGE_U - W_HALF
    add(clubhouse, id='clubhouse', node='Tjusta-Clubhouse', sources=['w48232863'], anchor=(0, 0),
        corners=[(-32.9, -1.6), (-32.9, 7.0), (B_S, 7.0), (B_S, B_HALF), (south, B_HALF), (south, W_WEST), (north, W_WEST), (north, W_EAST), (south, W_EAST), (south, -B_HALF), (B_S, -B_HALF), (B_S, -1.6)],
        evidence=dict(levels=f'{laser}: ridge 33.69, gambrel break 30.9, eaves 26.55; wing ridge 30.08, eaves 25.55; annex ridge 25.35, eaves 23.5; west canopy 24.15',
                      plan='ridge and eave lines fitted through the laser returns; orthophotos of 2025, 2023, 2021 and 2019',
                      front="the club's photograph of the north front (private cache, reference only): door, vents, dock, the wing's windows and porch",
                      estimated='the east wall and its doors, the south gable and annex door, every wall no photograph shows'))
    add(terrace, id='clubhouse-terrace', node='Tjusta-Terrace', sources=[], anchor=(T_RIDGE_U, 22.0),
        corners=[(T_RIDGE_U - T_HALF, T_V0), (D_U1, T_V0), (D_U1, D_V1), (T_RIDGE_U - T_HALF, D_V1)],
        evidence=dict(levels=f'{laser}: deck floor 22.26, rail 23.32, building ridge 26.58, eaves 23.86', plan='laser returns of the floor and rail; orthophoto 2025-06-14',
                      order="the club's photographs (reference only): deck on posts before a low black-roofed building, stair at its west end", estimated='post spacing, the stair, the wall under the deck'))
    add(black_hall, id='machine-hall', node='Tjusta-MachineHall', sources=['w48232860'], anchor=(0, 0), corners=[(-33.7, -11.2), (28.9, -11.2), (28.9, 11.2), (-33.7, 11.2)],
        evidence=dict(levels=f'{laser}: ridge 31.54, eaves 26.09', plan='ridge and both eaves fitted through the laser returns',
                      walls='dark on the orthophotos where the west gable leans into view', estimated='the doors'))
    add(grey_hall, id='grey-hall', node='Tjusta-GreyHall', sources=['w189730445'], anchor=(0, 0), corners=[(-21.2, -9.6), (9.0, -9.6), (9.0, -16.9), (25.1, -16.9), (25.1, 10.0), (-21.2, 9.6)],
        evidence=dict(levels=f'{laser}: ridge 30.2 (three returns), east eave 22.9; the main eaves 26.0 from four returns', plan='orthophotos of 2025 and 2019: a gabled hall and a cross hall whose roofs meet in two valleys',
                      estimated='the eaves of the main hall, every wall, the doors'))
    add(range_shelter, id='range-shelter', node='Tjusta-RangeShelter', sources=['w293867832'], anchor=(-3.3, 1.6), corners=[(-8.6, -1.4), (2.0, -1.4), (2.0, 4.6), (-8.6, 4.6)],
        evidence=dict(levels=f'{laser}: the roof\'s high edge 21.7, ground 17.3', plan='laser returns of the high edge; orthophoto 2025-06-14',
                      order="the club's photograph (reference only): two open bays lined in white under a single-pitch black roof, red ends", estimated='the low edge of the roof, the depth of the bays'))
    write_campus(args.out, ground_id='tjusta', course_slugs=['tjusta'], origin=ORIGIN, scene_name='BanvyTjustaCampus',
                 materials=MATERIALS, facilities=built, terrain=ground)


if __name__ == '__main__':
    main()
