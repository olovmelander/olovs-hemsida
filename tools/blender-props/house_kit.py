"""The house kit: the parts a Swedish house is made of, for the inner ring's houses
(8 November, owner request: "i want more things like houses etc to be modelled in
Blender to not just look like Boxes, do this for the inner detailed ring!").

Run headless (no open scene is touched):

    blender --background --factory-startup --python tools/blender-props/house_kit.py

or through the Blender MCP, which builds in a scene of its own ("BanvyHouseKit")
with the data API and exports only that scene. One GLB, every mesh named
`<part>__<channel>`:

- the channel says what colours it: `wall`, `trim`, `roof` and `accent` are
  painted WHITE (with their own shading) and take the house's wall, trim, roof
  and door colour per instance; `fixed` keeps its own colours; `glass` is the
  panes, drawn with a glossier material.
- the player (engine/house-kit.mjs) lays the parts on each footprint: windows
  and doors along its walls, corner boards at its corners, a porch at its front
  door, a chimney on its ridge.

Each part's frame, in glTF (the exporter's Y-up): x along the wall, y up, z out
of the wall; the wall's face is z = 0 and nothing is behind it, since the wall
the engine draws is solid. In Blender here that is X along, -Y out, Z up; the
helpers take `out` (metres in front of the wall) so the code reads as the wall.

Origins: windows at the middle of their casing's foot; doors, porches, garage,
barn and roller doors, entrances and balconies at their threshold (the floor);
a chimney at its axis on the ridge; a corner board at the corner, the house
inside x > 0, z < 0 (Blender X > 0, Y > 0), one metre tall (stretched to the
wall); a downpipe at the wall, one metre tall (stretched to the eaves).
"""
import math
import os

import bpy

OUT = os.environ.get('BANVY_PROP_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'house-kit.glb')
SCENE = 'BanvyHouseKit'


def lin(hex_rgb):
    """An sRGB literal as linear floats: the player's vertex colours are linear."""
    out = []
    for shift in (16, 8, 0):
        v = ((hex_rgb >> shift) & 255) / 255
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return tuple(out)


WHITE = (1.0, 1.0, 1.0)
GLASS = lin(0x26313a)
GLASS_DARK = lin(0x1b2228)
ALU = lin(0x3c4044)           # dark anodised aluminium
STEEL = lin(0xb9bdbf)         # galvanised / light sheet
STEEL_DARK = lin(0x5d6265)
CONCRETE = lin(0x9d9a93)
CONCRETE_DARK = lin(0x7d7a74)
DECK = lin(0x8b7a66)          # weathered deck boards
PLASTER = lin(0xd8d3c8)
BRICK = lin(0x8e3f2c)
TIN = lin(0x2b2d2f)           # black sheet metal: caps, flashing
BRASS = lin(0x9c7f45)


class Part:
    """One kit part: a mesh per channel, faces painted in their own colour."""

    def __init__(self, name):
        self.name = name
        self.channels = {}

    def _bucket(self, channel):
        return self.channels.setdefault(channel, ([], [], []))

    def face(self, channel, points, rgb, shade=True):
        """`points` in (x, out, z); counter-clockwise seen from the side it faces."""
        verts, faces, colours = self._bucket(channel)
        base = len(verts)
        pts = [(p[0], -p[1], p[2]) for p in points]
        verts.extend(pts)
        faces.append(tuple(range(base, base + len(pts))))
        k = 1.0
        if shade:
            # a little of the light a painter puts in: undersides darker, tops a touch lighter
            ax, ay, az = (pts[1][i] - pts[0][i] for i in range(3))
            bx, by, bz = (pts[2][i] - pts[0][i] for i in range(3))
            nz = ax * by - ay * bx
            nl = math.sqrt((ay * bz - az * by) ** 2 + (az * bx - ax * bz) ** 2 + nz ** 2) or 1
            nz /= nl
            k = 0.72 if nz < -0.5 else 1.04 if nz > 0.6 else 1.0
        colours.append(tuple(min(1.0, c * k) for c in rgb))

    def quad(self, channel, a, b, c, d, rgb, shade=True):
        self.face(channel, [a, b, c, d], rgb, shade)

    def tri(self, channel, a, b, c, rgb, shade=True):
        self.face(channel, [a, b, c], rgb, shade)

    def box(self, channel, x0, x1, o0, o1, z0, z1, rgb, skip=('back',)):
        """An axis-aligned box: x along the wall, o out of it, z up. `back` faces the wall."""
        F = {
            'front': [(x0, o1, z0), (x1, o1, z0), (x1, o1, z1), (x0, o1, z1)],
            'back': [(x0, o0, z0), (x0, o0, z1), (x1, o0, z1), (x1, o0, z0)],
            'left': [(x0, o0, z0), (x0, o1, z0), (x0, o1, z1), (x0, o0, z1)],
            'right': [(x1, o1, z0), (x1, o0, z0), (x1, o0, z1), (x1, o1, z1)],
            'top': [(x0, o1, z1), (x1, o1, z1), (x1, o0, z1), (x0, o0, z1)],
            'bottom': [(x0, o0, z0), (x1, o0, z0), (x1, o1, z0), (x0, o1, z0)],
        }
        for key, pts in F.items():
            if key not in skip:
                self.face(channel, pts, rgb)

    def beam(self, channel, a, b, width, depth, o0, rgb):
        """A flat board on the wall from a=(x, z) to b=(x, z), `width` across, standing `depth` proud of o0."""
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz) or 1e-6
        nx, nz = -dz / length * width / 2, dx / length * width / 2
        o1 = o0 + depth
        p = [(a[0] - nx, a[1] - nz), (b[0] - nx, b[1] - nz), (b[0] + nx, b[1] + nz), (a[0] + nx, a[1] + nz)]
        self.quad(channel, (p[0][0], o1, p[0][1]), (p[1][0], o1, p[1][1]), (p[2][0], o1, p[2][1]), (p[3][0], o1, p[3][1]), rgb)
        for i in range(4):
            q, r = p[i], p[(i + 1) % 4]
            self.quad(channel, (q[0], o0, q[1]), (r[0], o0, r[1]), (r[0], o1, r[1]), (q[0], o1, q[1]), rgb)

    def triangles(self):
        return sum(sum(len(f) - 2 for f in faces) for _, faces, _ in self.channels.values())


# --------------------------------------------------------------------------- windows

def casing(part, W, H, board=0.1, proud=0.05, sill=True, head=True, channel='trim', colour=WHITE):
    """The window's or door's casing (foder): four boards round the opening, a sill, a head."""
    x0, x1 = -W / 2, W / 2
    part.box(channel, x0, x0 + board, 0, proud, 0, H, colour)
    part.box(channel, x1 - board, x1, 0, proud, 0, H, colour)
    part.box(channel, x0 + board, x1 - board, 0, proud, H - board, H, colour, skip=('back', 'left', 'right'))
    if sill is not None and sill is not False:
        part.box(channel, x0 + board, x1 - board, 0, proud, 0, board, colour, skip=('back', 'left', 'right'))
    if sill:
        # the sill board, standing out past the casing, its top sloped to shed the rain
        so = proud + 0.06
        a0, a1 = x0 - 0.04, x1 + 0.04
        part.quad(channel, (a0, so, -0.025), (a1, so, -0.025), (a1, so, 0.0), (a0, so, 0.0), colour)
        part.quad(channel, (a0, so, 0.0), (a1, so, 0.0), (a1, 0, 0.035), (a0, 0, 0.035), colour)
        part.quad(channel, (a0, 0, -0.025), (a1, 0, -0.025), (a1, so, -0.025), (a0, so, -0.025), colour)
        part.quad(channel, (a0, 0, -0.025), (a0, so, -0.025), (a0, so, 0.0), (a0, 0, 0.035), colour)
        part.quad(channel, (a1, so, -0.025), (a1, 0, -0.025), (a1, 0, 0.035), (a1, so, 0.0), colour)
    if head:
        # the head (overstycke): a small cornice over the casing, its top sloped back to the wall
        ho = proud + 0.05
        hz0, hz1 = H, H + 0.075
        part.box(channel, x0 - 0.05, x1 + 0.05, 0, ho, hz0, hz1, colour, skip=('back', 'top'))
        part.quad(channel, (x0 - 0.05, ho, hz1), (x1 + 0.05, ho, hz1), (x1 + 0.05, 0, hz1 + 0.05), (x0 - 0.05, 0, hz1 + 0.05), colour)
        part.tri(channel, (x0 - 0.05, 0, hz1), (x0 - 0.05, ho, hz1), (x0 - 0.05, 0, hz1 + 0.05), colour)
        part.tri(channel, (x1 + 0.05, ho, hz1), (x1 + 0.05, 0, hz1), (x1 + 0.05, 0, hz1 + 0.05), colour)


def panes(part, x0, x1, z0, z1, cols, rows, bar=0.05, proud=0.03, glass_out=0.014, channel='trim', colour=WHITE,
          glass=GLASS, frame=0.055):
    """Sashes in an opening: a frame ring, the mullions and muntins, and the glass behind them."""
    part.quad('glass', (x0, glass_out, z0), (x1, glass_out, z0), (x1, glass_out, z1), (x0, glass_out, z1), glass, shade=False)
    # the sash frame ring
    part.box(channel, x0, x0 + frame, 0, proud, z0, z1, colour, skip=('back', 'left'))
    part.box(channel, x1 - frame, x1, 0, proud, z0, z1, colour, skip=('back', 'right'))
    part.box(channel, x0 + frame, x1 - frame, 0, proud, z1 - frame, z1, colour, skip=('back', 'left', 'right', 'top'))
    part.box(channel, x0 + frame, x1 - frame, 0, proud, z0, z0 + frame * 1.3, colour, skip=('back', 'left', 'right', 'bottom'))
    for i in range(1, cols):
        x = x0 + (x1 - x0) * i / cols
        part.box(channel, x - bar, x + bar, 0, proud, z0 + frame, z1 - frame, colour, skip=('back', 'top', 'bottom'))
    for z in rows:
        zz = z0 + (z1 - z0) * z
        part.box(channel, x0 + frame, x1 - frame, 0, proud * 0.8, zz - bar * 0.45, zz + bar * 0.45, colour, skip=('back', 'left', 'right'))


def window(name, W, H, cols, rows=(), board=0.1, head=True):
    p = Part(name)
    casing(p, W, H, board=board, head=head)
    panes(p, -W / 2 + board, W / 2 - board, board, H - board, cols, rows)
    return p


def window_alu(name, W, H, cols, kick=0.0):
    """A modern window or shop front: a thin dark aluminium frame flush round wide panes."""
    p = Part(name)
    f = 0.07
    p.box('fixed', -W / 2, W / 2, 0, 0.06, H - f, H, ALU, skip=('back',))
    p.box('fixed', -W / 2, -W / 2 + f, 0, 0.06, 0, H - f, ALU, skip=('back', 'top'))
    p.box('fixed', W / 2 - f, W / 2, 0, 0.06, 0, H - f, ALU, skip=('back', 'top'))
    p.box('fixed', -W / 2 + f, W / 2 - f, 0, 0.06, 0, f + kick, ALU if not kick else ALU, skip=('back', 'left', 'right'))
    for i in range(1, cols):
        x = -W / 2 + W * i / cols
        p.box('fixed', x - 0.035, x + 0.035, 0, 0.05, f + kick, H - f, ALU, skip=('back', 'top', 'bottom'))
    p.quad('glass', (-W / 2 + f, 0.02, f + kick), (W / 2 - f, 0.02, f + kick), (W / 2 - f, 0.02, H - f), (-W / 2 + f, 0.02, H - f), GLASS_DARK, shade=False)
    # a sheet-metal sill
    p.quad('fixed', (-W / 2 - 0.03, 0.1, -0.03), (W / 2 + 0.03, 0.1, -0.03), (W / 2 + 0.03, 0, 0.02), (-W / 2 - 0.03, 0, 0.02), ALU)
    return p


# --------------------------------------------------------------------------- doors

def door(name='door'):
    """A panelled front door with a light over it, its casing, a handle and a stone step."""
    p = Part(name)
    W, H = 1.18, 2.25
    casing(p, W, H, board=0.1, sill=None)
    x0, x1, z0, z1 = -W / 2 + 0.1, W / 2 - 0.1, 0.0, H - 0.1
    # the leaf, a hand proud of the wall; its panels raised a little more
    p.quad('accent', (x0, 0.025, z0), (x1, 0.025, z0), (x1, 0.025, 1.75), (x0, 0.025, 1.75), WHITE)
    for (a, b) in ((0.18, 0.86), (0.98, 1.62)):
        for (u0, u1) in ((x0 + 0.1, -0.03), (0.03, x1 - 0.1)):
            p.box('accent', u0, u1, 0.025, 0.045, a, b, WHITE, skip=('back',))
    # the light over the door, in its own bar
    p.box('accent', x0, x1, 0.0, 0.045, 1.75, 1.83, WHITE, skip=('back',))
    panes(p, x0, x1, 1.83, z1, 2, (), channel='accent')
    p.box('fixed', x1 - 0.16, x1 - 0.1, 0.045, 0.1, 0.98, 1.02, BRASS, skip=('back',))
    # the step stone, deep enough to stand on and down past the plinth into the ground
    p.box('fixed', -0.85, 0.85, 0, 0.75, -1.4, -0.02, CONCRETE, skip=('back', 'bottom'))
    p.box('fixed', -0.75, 0.75, 0.75, 1.05, -1.4, -0.24, CONCRETE_DARK, skip=('back', 'bottom'))
    return p


def door_plain(name='door_plain'):
    """A steel side door for halls and sheds: flush, a dark frame, a handle."""
    p = Part(name)
    W, H = 1.12, 2.15
    p.box('fixed', -W / 2, W / 2, 0, 0.05, H - 0.06, H, ALU)
    p.box('fixed', -W / 2, -W / 2 + 0.06, 0, 0.05, 0, H - 0.06, ALU, skip=('back', 'top'))
    p.box('fixed', W / 2 - 0.06, W / 2, 0, 0.05, 0, H - 0.06, ALU, skip=('back', 'top'))
    p.quad('accent', (-W / 2 + 0.06, 0.02, 0), (W / 2 - 0.06, 0.02, 0), (W / 2 - 0.06, 0.02, H - 0.06), (-W / 2 + 0.06, 0.02, H - 0.06), WHITE)
    p.box('fixed', W / 2 - 0.22, W / 2 - 0.12, 0.02, 0.07, 1.0, 1.04, STEEL_DARK, skip=('back',))
    p.box('fixed', -0.75, 0.75, 0, 0.6, -0.8, -0.02, CONCRETE, skip=('back', 'bottom'))
    return p


def door_board(name='door_board'):
    """A board door with a white Z-brace: the bod's, the shed's, the barn's small door."""
    p = Part(name)
    W, H = 1.1, 2.0
    casing(p, W + 0.2, H + 0.1, board=0.1, sill=None, head=False)
    x0, x1 = -W / 2, W / 2
    p.quad('wall', (x0, 0.02, 0), (x1, 0.02, 0), (x1, 0.02, H), (x0, 0.02, H), WHITE)
    for z in (0.18, H - 0.18):
        p.box('trim', x0 + 0.04, x1 - 0.04, 0.02, 0.05, z - 0.07, z + 0.07, WHITE, skip=('back',))
    p.beam('trim', (x0 + 0.12, 0.28), (x1 - 0.12, H - 0.28), 0.13, 0.03, 0.02, WHITE)
    p.box('fixed', -0.7, 0.7, 0, 0.45, -0.8, -0.02, CONCRETE, skip=('back', 'bottom'))
    return p


def garage_door(name='garage_door'):
    """A sectional garage door: four slats with shadow lines, a white casing."""
    p = Part(name)
    W, H = 2.75, 2.3
    casing(p, W, H, board=0.12, sill=None, head=False)
    x0, x1 = -W / 2 + 0.12, W / 2 - 0.12
    top = H - 0.12
    p.quad('fixed', (x0, 0.006, 0), (x1, 0.006, 0), (x1, 0.006, top), (x0, 0.006, top), lin(0x2e2f30), shade=False)
    n = 4
    for i in range(n):
        za, zb = top * i / n + 0.012, top * (i + 1) / n - 0.012
        # each slat leans out a little at its foot, so the lines between them read in any light
        p.quad('trim', (x0, 0.04, za), (x1, 0.04, za), (x1, 0.025, zb), (x0, 0.025, zb), WHITE)
        p.quad('trim', (x0, 0.006, za), (x1, 0.006, za), (x1, 0.04, za), (x0, 0.04, za), WHITE)
    # the drive's apron at the door
    p.box('fixed', x0 - 0.1, x1 + 0.1, 0, 0.5, -0.9, -0.03, CONCRETE, skip=('back', 'bottom'))
    return p


def barn_door(name='barn_door'):
    """The barn's double door: red boards, a white frame, a white X on each leaf."""
    p = Part(name)
    W, H = 3.4, 3.1
    casing(p, W + 0.3, H + 0.15, board=0.15, sill=None, head=False)
    x0, x1 = -W / 2, W / 2
    p.quad('wall', (x0, 0.02, 0), (x1, 0.02, 0), (x1, 0.02, H), (x0, 0.02, H), WHITE)
    for (a, b) in ((x0, -0.015), (0.015, x1)):
        p.box('trim', a, b, 0.02, 0.055, 0, 0.16, WHITE, skip=('back',))
        p.box('trim', a, b, 0.02, 0.055, H - 0.16, H, WHITE, skip=('back',))
        p.box('trim', a, a + 0.14, 0.02, 0.055, 0.16, H - 0.16, WHITE, skip=('back', 'top', 'bottom'))
        p.box('trim', b - 0.14, b, 0.02, 0.055, 0.16, H - 0.16, WHITE, skip=('back', 'top', 'bottom'))
        p.beam('trim', (a + 0.14, 0.16), (b - 0.14, H - 0.16), 0.14, 0.03, 0.02, WHITE)
        p.beam('trim', (b - 0.14, 0.16), (a + 0.14, H - 0.16), 0.14, 0.025, 0.02, WHITE)
    # the earth ramp up to it, in stone
    p.quad('fixed', (x0 - 0.2, 0.0, -0.02), (x1 + 0.2, 0.0, -0.02), (x1 + 0.4, 1.4, -0.9), (x0 - 0.4, 1.4, -0.9), CONCRETE_DARK)
    return p


def roller_door(name='roller_door'):
    """An industrial roller door: ribbed slats between guides, a box over it."""
    p = Part(name)
    W, H = 4.0, 4.2
    x0, x1 = -W / 2, W / 2
    n = 22
    for i in range(n):
        za, zb = H * i / n, H * (i + 1) / n
        zm = (za + zb) / 2
        p.quad('fixed', (x0, 0.035, za), (x1, 0.035, za), (x1, 0.05, zm), (x0, 0.05, zm), STEEL)
        p.quad('fixed', (x0, 0.05, zm), (x1, 0.05, zm), (x1, 0.03, zb), (x0, 0.03, zb), lin(0xa3a8aa))
    for x in (x0 - 0.12, x1):
        p.box('fixed', x, x + 0.12, 0, 0.12, 0, H, STEEL_DARK)
    p.box('fixed', x0 - 0.18, x1 + 0.18, 0, 0.5, H, H + 0.55, STEEL_DARK)
    p.box('fixed', x0 - 0.2, x1 + 0.2, 0, 1.2, -0.9, -0.03, CONCRETE, skip=('back', 'bottom'))
    return p


def entrance(name='entrance'):
    """A block's or shop's entrance: glazed double doors, a flat canopy on rods, a step."""
    p = Part(name)
    W, H = 2.1, 2.35
    f = 0.08
    p.box('fixed', -W / 2, W / 2, 0, 0.08, H - f, H, ALU)
    p.box('fixed', -W / 2, -W / 2 + f, 0, 0.08, 0, H - f, ALU, skip=('back', 'top'))
    p.box('fixed', W / 2 - f, W / 2, 0, 0.08, 0, H - f, ALU, skip=('back', 'top'))
    p.box('fixed', -0.04, 0.04, 0, 0.07, 0, H - f, ALU, skip=('back', 'top'))
    for (a, b) in ((-W / 2 + f, -0.04), (0.04, W / 2 - f)):
        p.box('fixed', a, b, 0, 0.06, 0, 0.22, ALU, skip=('back', 'left', 'right'))
        p.box('fixed', a, b, 0, 0.06, 1.0, 1.06, ALU, skip=('back', 'left', 'right'))
    p.quad('glass', (-W / 2 + f, 0.025, 0.22), (W / 2 - f, 0.025, 0.22), (W / 2 - f, 0.025, H - f), (-W / 2 + f, 0.025, H - f), GLASS_DARK, shade=False)
    # the canopy, and the two rods that hang it from the wall
    cz0, cz1, cw, cd = 2.75, 2.93, 1.6, 1.45
    p.box('fixed', -cw, cw, 0, cd, cz0, cz1, ALU, skip=('back',))
    for x in (-cw + 0.15, cw - 0.15):
        a, b = (x, 0.0, 3.75), (x, cd - 0.08, cz1)
        dz = a[2] - b[2]
        do = b[1] - a[1]
        L = math.hypot(dz, do)
        ux, uz = do / L * 0.02, dz / L * 0.02
        p.quad('fixed', (x - 0.02, a[1], a[2]), (x + 0.02, a[1], a[2]), (x + 0.02, b[1], b[2]), (x - 0.02, b[1], b[2]), STEEL_DARK)
        p.quad('fixed', (x - 0.02, b[1] + ux, b[2] + uz), (x + 0.02, b[1] + ux, b[2] + uz), (x + 0.02, a[1] + ux, a[2] + uz), (x - 0.02, a[1] + ux, a[2] + uz), STEEL_DARK)
    p.box('fixed', -1.5, 1.5, 0, 1.3, -0.9, -0.02, CONCRETE, skip=('back', 'bottom'))
    return p


# --------------------------------------------------------------------------- porches, balconies, chimneys

def stoop(p, half, deep, steps=3):
    """A deck at the floor on a skirt down into the ground, and steps down from it."""
    p.box('fixed', -half, half, 0, deep, -0.16, 0, DECK, skip=('back',))
    p.box('fixed', -half + 0.04, half - 0.04, 0, deep - 0.06, -1.4, -0.16, CONCRETE_DARK, skip=('back', 'top', 'bottom'))
    for k in range(steps):
        o0, o1 = deep + 0.3 * k, deep + 0.3 * (k + 1)
        z = -0.17 * (k + 1)
        p.box('fixed', -0.7, 0.7, o0 - 0.3 if k else o0, o1, -1.4, z, DECK if k == 0 else CONCRETE, skip=('back', 'bottom'))


def porch(name='porch'):
    """The farstukvist: a gabled roof on two posts over the front door, a deck and steps, side rails."""
    p = Part(name)
    half, deep = 1.25, 1.75
    stoop(p, half, deep)
    ze, rw, rd = 2.45, 1.42, deep + 0.22
    rise = rw * math.tan(math.radians(42))
    zr, t = ze + rise, 0.12
    for s in (-1, 1):
        x = s * (half - 0.1)
        p.box('trim', x - 0.065, x + 0.065, deep - 0.2, deep - 0.07, 0, ze, WHITE, skip=())
        # the side rail and three balusters
        p.box('trim', x - 0.03, x + 0.03, 0.15, deep - 0.2, 0.86, 0.93, WHITE, skip=())
        for o in (0.55, 0.95, 1.35):
            p.box('trim', x - 0.025, x + 0.025, o - 0.025, o + 0.025, 0, 0.86, WHITE, skip=('bottom',))
    # the beam over the posts, carried back to the wall
    for s in (-1, 1):
        p.box('trim', s * (half - 0.1) - 0.05, s * (half - 0.1) + 0.05, 0, deep - 0.07, ze - 0.2, ze, WHITE)
    p.box('trim', -half + 0.04, half - 0.04, deep - 0.18, deep - 0.06, ze - 0.24, ze, WHITE)
    # the roof's two slopes, with their thickness, eaves and underside
    for s in (-1, 1):
        a, b = (s * rw, 0, ze), (0, 0, zr)
        top = [(s * rw, rd, ze), (0, rd, zr), (0, 0, zr), (s * rw, 0, ze)]
        if s < 0:
            top = [top[1], top[0], top[3], top[2]]
        p.face('roof', top, WHITE)
        under = [(x, o, z - t) for (x, o, z) in top][::-1]
        p.face('roof', under, WHITE)
        # the eave's edge
        e = [(s * rw, 0, ze - t), (s * rw, rd, ze - t), (s * rw, rd, ze), (s * rw, 0, ze)]
        if s < 0:
            e = e[::-1]
        p.face('trim', e, WHITE)
        # the barge board along the front
        f = [(s * rw, rd, ze - t - 0.05), (0, rd, zr - t - 0.05), (0, rd, zr + 0.01), (s * rw, rd, ze + 0.01)]
        if s > 0:
            f = f[::-1]
        p.face('trim', [(x, o + 0.02, z) for (x, o, z) in f], WHITE)
    # the gable's triangle, set back under the roof, in the house's colour
    p.tri('wall', (-rw + 0.12, deep - 0.06, ze), (rw - 0.12, deep - 0.06, ze), (0, deep - 0.06, zr - 0.14), WHITE)
    return p


def porch_low(name='porch_low'):
    """A lean-to porch for a one-storey house: a sloped roof from the wall to two posts."""
    p = Part(name)
    half, deep = 1.25, 1.75
    stoop(p, half, deep)
    zw, zf, rw, rd, t = 2.5, 2.22, 1.45, deep + 0.25, 0.1
    for s in (-1, 1):
        x = s * (half - 0.1)
        p.box('trim', x - 0.065, x + 0.065, deep - 0.2, deep - 0.07, 0, zf - 0.04, WHITE, skip=())
        p.box('trim', x - 0.03, x + 0.03, 0.15, deep - 0.2, 0.86, 0.93, WHITE, skip=())
        for o in (0.55, 0.95, 1.35):
            p.box('trim', x - 0.025, x + 0.025, o - 0.025, o + 0.025, 0, 0.86, WHITE, skip=('bottom',))
    p.box('trim', -half + 0.04, half - 0.04, deep - 0.18, deep - 0.06, zf - 0.22, zf - 0.04, WHITE)
    top = [(-rw, rd, zf), (rw, rd, zf), (rw, 0, zw), (-rw, 0, zw)]
    p.face('roof', top, WHITE)
    p.face('roof', [(x, o, z - t) for (x, o, z) in top][::-1], WHITE)
    p.quad('trim', (-rw, rd, zf - t), (rw, rd, zf - t), (rw, rd, zf + 0.01), (-rw, rd, zf + 0.01), WHITE)
    for s in (-1, 1):
        side = [(s * rw, 0, zw - t), (s * rw, rd, zf - t), (s * rw, rd, zf), (s * rw, 0, zw)]
        p.face('trim', side if s > 0 else side[::-1], WHITE)
    return p


def balcony(name='balcony'):
    """A block's balcony: a concrete slab, coloured sheet fronts, a dark handrail."""
    p = Part(name)
    hw, d = 1.65, 1.45
    p.box('fixed', -hw, hw, 0, d, -0.2, 0, lin(0xb4b0a8), skip=('back',))
    p.box('accent', -hw, hw, d - 0.05, d, 0.02, 1.0, WHITE, skip=('back', 'top'))
    for s in (-1, 1):
        x0, x1 = (s * hw - 0.05, s * hw) if s > 0 else (s * hw, s * hw + 0.05)
        p.box('accent', x0, x1, 0, d - 0.05, 0.02, 1.0, WHITE, skip=('back', 'top'))
    p.box('fixed', -hw - 0.02, hw + 0.02, d - 0.07, d + 0.02, 1.0, 1.06, ALU, skip=('back',))
    for s in (-1, 1):
        x = s * (hw - 0.015)
        p.box('fixed', x - 0.035, x + 0.035, 0, d - 0.07, 1.0, 1.06, ALU, skip=('back',))
    return p


def chimney(name, colour, band=None):
    """A chimney on the ridge: its shaft down into the roof, a corbel band, a black sheet hood on legs."""
    p = Part(name)
    s = 0.31
    p.box('fixed', -s, s, -s, s, -2.2, 1.05, colour, skip=('bottom',))
    p.box('fixed', -s - 0.05, s + 0.05, -s - 0.05, s + 0.05, 1.05, 1.2, band or colour, skip=())
    for (x, o) in ((-s, -s), (s - 0.05, -s), (s - 0.05, s - 0.05), (-s, s - 0.05)):
        p.box('fixed', x, x + 0.05, o, o + 0.05, 1.2, 1.42, TIN, skip=('bottom', 'top'))
    p.box('fixed', -s - 0.1, s + 0.1, -s - 0.1, s + 0.1, 1.42, 1.47, TIN, skip=())
    return p


def corner(name='corner'):
    """Corner boards (hornbrador): two boards over a corner, the house inside x > 0, z < 0 (glTF)."""
    p = Part(name)
    w, t = 0.14, 0.032
    # in (x, out, z): the first wall runs along +x with its face at out = 0; the second runs
    # into the house (out < 0) with its face at x = 0, outward toward -x
    for (z0, z1) in ((0.0, 1.0),):
        p.quad('trim', (-t, t, z0), (w, t, z0), (w, t, z1), (-t, t, z1), WHITE)
        p.quad('trim', (w, t, z0), (w, 0, z0), (w, 0, z1), (w, t, z1), WHITE)
        p.quad('trim', (-t, -w, z0), (-t, t, z0), (-t, t, z1), (-t, -w, z1), WHITE)
        p.quad('trim', (0, -w, z0), (-t, -w, z0), (-t, -w, z1), (0, -w, z1), WHITE)
    return p


def downpipe(name='downpipe'):
    """A downpipe (stuprör) on the wall, one metre tall, stretched to the eaves, and its shoe."""
    p = Part(name)
    r, o, n = 0.05, 0.09, 8
    ring = [(math.cos(2 * math.pi * k / n) * r, o + math.sin(2 * math.pi * k / n) * r) for k in range(n)]
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]
        p.quad('fixed', (b[0], b[1], 0.0), (a[0], a[1], 0.0), (a[0], a[1], 1.0), (b[0], b[1], 1.0), lin(0x3d4042))
    return p


def flat_window(name, frame_channel, frame_rgb, glass=GLASS, bar=True):
    """A far house's window: one metre square, stretched to the near part's size -- a frame plate,
    the glass in front of it and a glazing bar, six triangles where the near window has about ninety."""
    p = Part(name)
    p.quad(frame_channel, (-0.5, 0.03, 0.0), (0.5, 0.03, 0.0), (0.5, 0.03, 1.0), (-0.5, 0.03, 1.0), frame_rgb)
    p.quad('glass', (-0.4, 0.034, 0.12), (0.4, 0.034, 0.12), (0.4, 0.034, 0.9), (-0.4, 0.034, 0.9), glass, shade=False)
    if bar:
        p.quad(frame_channel, (-0.035, 0.038, 0.12), (0.035, 0.038, 0.12), (0.035, 0.038, 0.9), (-0.035, 0.038, 0.9), frame_rgb)
    return p


def flat_door(name='door_far'):
    """A far house's door: its casing and its leaf as two plates, one metre square, stretched."""
    p = Part(name)
    p.quad('trim', (-0.5, 0.03, 0.0), (0.5, 0.03, 0.0), (0.5, 0.03, 1.0), (-0.5, 0.03, 1.0), WHITE)
    p.quad('accent', (-0.41, 0.034, 0.0), (0.41, 0.034, 0.0), (0.41, 0.034, 0.94), (-0.41, 0.034, 0.94), WHITE)
    return p


def build_parts():
    return [
        flat_window('window_far', 'trim', WHITE), flat_window('window_far_alu', 'fixed', ALU, glass=GLASS_DARK, bar=False),
        flat_door(),
        window('window', 1.12, 1.38, 2, rows=(0.66,)),
        window('window_small', 0.72, 0.72, 2, rows=(0.5,), board=0.08, head=False),
        window('window_tall', 1.3, 1.55, 2),
        window('window_wide', 2.1, 1.42, 3, rows=(0.7,)),
        window_alu('window_strip', 3.0, 0.78, 4),
        window_alu('shopfront', 2.8, 2.35, 2, kick=0.3),
        window_alu('window_modern', 1.4, 1.45, 2),
        door(), door_plain(), door_board(), garage_door(), barn_door(), roller_door(), entrance(),
        porch(), porch_low(), balcony(),
        chimney('chimney', PLASTER), chimney('chimney_brick', BRICK, band=lin(0x7c3626)),
        corner(), downpipe(),
    ]


def ensure_scene():
    old = bpy.data.scenes.get(SCENE)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    return bpy.data.scenes.new(SCENE)


def to_objects(scene, parts):
    mat = bpy.data.materials.get('house_kit_paint') or bpy.data.materials.new('house_kit_paint')
    objects, report = [], {}
    for part in parts:
        for channel, (verts, faces, colours) in sorted(part.channels.items()):
            name = f'{part.name}__{channel}'
            old = bpy.data.meshes.get(name)
            if old:
                bpy.data.meshes.remove(old)
            mesh = bpy.data.meshes.new(name)
            mesh.from_pydata(verts, [], faces)
            mesh.validate(clean_customdata=False)
            attr = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
            for poly, rgb in zip(mesh.polygons, colours):
                for li in poly.loop_indices:
                    attr.data[li].color = (rgb[0], rgb[1], rgb[2], 1.0)
            mesh.color_attributes.active_color = attr
            mesh.materials.append(mat)
            ob = bpy.data.objects.new(name, mesh)
            scene.collection.objects.link(ob)
            objects.append(ob)
            report[name] = sum(len(p.vertices) - 2 for p in mesh.polygons)
    return objects, report


def export(scene, objects):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    layer = scene.view_layers[0]
    for ob in objects:
        ob.select_set(True, view_layer=layer)
    with bpy.context.temp_override(scene=scene, view_layer=layer):
        bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True,
                                  export_vertex_color='ACTIVE', export_materials='NONE', export_yup=True,
                                  export_normals=True, export_texcoords=False)
    return OUT


def main():
    scene = ensure_scene()
    objects, report = to_objects(scene, build_parts())
    out = export(scene, objects)
    return {'glb': out, 'meshes': report, 'triangles': sum(report.values())}


if __name__ == '__main__':
    print('HOUSE_KIT', main())
