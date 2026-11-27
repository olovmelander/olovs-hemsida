"""Bro Hof's campus, modelled from measured levels (Blender 5.2+, headless, data API only).

    blender --background --factory-startup --python brohofbuild/facilities/build_campus.py -- --out brohofbuild/cache/facilities

Levels are RH 2000 from Laserdata Skog 2020-11-06 (brohofbuild/cache/microterrain, tabulated along the
castle's own axes), plans from the 2025-06-14 orthophoto and OSM footprints, and the north facade's
order from Wikimedia Commons "Bro Hof Slott Entre.jpg" (CC BY-SA 4.0, reference only). What no source
shows (the south facade's window count, railings, the halfway house's walls) is a restrained repeat of
the north facade and is listed as such in README.md.

Blender X = easting - 649094.5, Y = northing - 6598568.5, Z = RH 2000 metres; the glTF exporter's Y-up
conversion then gives exactly the app's frame (east +x, up +y, south +z).
"""
import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

ORIGIN = (649094.5, 6598568.5)
# linear base colours, every one under the glow's threshold (0.86); roughness
MATERIALS = {
    'plaster': ((0.66, 0.64, 0.585), 0.88), 'plaster_shade': ((0.50, 0.485, 0.445), 0.9), 'trim': ((0.70, 0.685, 0.635), 0.8),
    'slate': ((0.045, 0.055, 0.068), 0.78), 'slate_edge': ((0.075, 0.085, 0.098), 0.7), 'zinc': ((0.33, 0.355, 0.355), 0.45),
    'zinc_dark': ((0.22, 0.24, 0.245), 0.5), 'glass': ((0.028, 0.036, 0.045), 0.12), 'frame': ((0.40, 0.41, 0.40), 0.6),
    'iron': ((0.018, 0.019, 0.021), 0.5), 'gold': ((0.55, 0.36, 0.09), 0.35), 'stone': ((0.52, 0.50, 0.46), 0.9),
    'granite': ((0.22, 0.215, 0.205), 0.9), 'door': ((0.10, 0.115, 0.12), 0.5), 'hedge': ((0.035, 0.075, 0.022), 0.95),
    'timber': ((0.17, 0.115, 0.07), 0.85), 'clock': ((0.60, 0.585, 0.53), 0.7),
    # the grounds' furniture (27 November): flags, parasols and the range's kit
    'pole': ((0.68, 0.68, 0.66), 0.45), 'flag_blue': ((0.0, 0.13, 0.36), 0.8), 'flag_yellow': ((0.80, 0.52, 0.0), 0.8),
    'flag_white': ((0.72, 0.72, 0.70), 0.85), 'flag_red': ((0.52, 0.03, 0.025), 0.8), 'canvas': ((0.70, 0.69, 0.65), 0.9),
    'turf_strip': ((0.028, 0.07, 0.028), 0.95), 'turf_mat': ((0.05, 0.12, 0.042), 0.9), 'ball': ((0.72, 0.72, 0.69), 0.4),
    'sign_green': ((0.012, 0.045, 0.022), 0.6), 'bag': ((0.022, 0.025, 0.03), 0.6), 'dispenser': ((0.03, 0.09, 0.045), 0.5),
}


TERRAIN = Path(os.environ.get('BROHOF_TERRAIN') or Path(__file__).resolve().parents[2] / 'packages/course-geo/toolchain/.cache/acquisition/bro-hof-ground-rings')
_grid = None


def ground(e, n):
    """The acquired 1 m terrain (RH 2000), bilinear."""
    global _grid
    if _grid is None:
        meta = json.loads((TERRAIN / 'l0.json').read_text(encoding='utf-8'))
        _grid = (np.memmap(TERRAIN / 'l0.f32', dtype='<f4', mode='r', shape=(meta['height'], meta['width'])), meta)
    z, meta = _grid
    x, y = e - meta['originEasting'], meta['originNorthing'] - n
    i, j = int(x), int(y)
    a, b = x - i, y - j
    return float((z[j, i] * (1 - a) + z[j, i + 1] * a) * (1 - b) + (z[j + 1, i] * (1 - a) + z[j + 1, i + 1] * a) * b)


class Mesh:
    """Triangles and quads by material, in a local frame (u, v, z) turned and placed on the map."""

    def __init__(self, origin_e, origin_n, ux, uy):
        self.o = (origin_e - ORIGIN[0], origin_n - ORIGIN[1])
        self.u, self.v = (ux, uy), (-uy, ux)
        self.parts = {}

    def w(self, p):
        return (self.o[0] + p[0] * self.u[0] + p[1] * self.v[0], self.o[1] + p[0] * self.u[1] + p[1] * self.v[1], p[2])

    def face(self, mat, *pts):
        """A convex face as a fan; a corner that closes on itself (an arch's crown) leaves no sliver behind."""
        own = [self.w(p) for p in pts]
        tris = []
        for i in range(1, len(own) - 1):
            a, b, c = own[0], own[i], own[i + 1]
            u, v = [b[k] - a[k] for k in range(3)], [c[k] - a[k] for k in range(3)]
            if math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) > 1e-6:
                tris.append((i, i + 1))
        if not tris:
            return
        verts, faces = self.parts.setdefault(mat, ([], []))
        k = len(verts)
        verts.extend(own)
        faces.extend((k, k + i, k + j) for i, j in tris)

    def box(self, mat, u0, u1, v0, v1, z0, z1, bottom=False):
        a, b, c, d = (u0, v0), (u1, v0), (u1, v1), (u0, v1)
        for p, q in ((a, b), (b, c), (c, d), (d, a)):
            self.face(mat, (*p, z0), (*q, z0), (*q, z1), (*p, z1))
        self.face(mat, (*a, z1), (*b, z1), (*c, z1), (*d, z1))
        if bottom:
            self.face(mat, (*d, z0), (*c, z0), (*b, z0), (*a, z0))

    def rings(self, mat, rings, cap=True):
        """Skin successive (u, v, z) rings of equal length, outward by their own winding (CCW from above)."""
        n = len(rings[0])
        for lo, hi in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                self.face(mat, lo[i], lo[j], hi[j], hi[i])
        if cap:
            self.face(mat, *rings[-1])

    def lathe(self, mat, cu, cv, profile, n=12, cap=True, turn=0.0):
        self.rings(mat, [[(cu + r * math.cos(turn + 2 * math.pi * i / n), cv + r * math.sin(turn + 2 * math.pi * i / n), z) for i in range(n)]
                         for z, r in profile], cap)

    def square_ring(self, cu, cv, half, z, chamfer):
        h, c = half, min(chamfer, half * 0.5)
        return [(cu + x, cv + y, z) for x, y in ((h, -h + c), (h, h - c), (h - c, h), (-h + c, h), (-h, h - c), (-h, -h + c), (-h + c, -h), (h - c, -h))]

    def hip(self, mat, u0, u1, v0, v1, z0, z1, ridge_in, axis='u', edge='slate_edge', over=0.35):
        """A hipped roof on a rectangle with eaves `over` out; `ridge_in` is how far the ridge ends stand in."""
        a, b, c, d = (u0 - over, v0 - over, z0), (u1 + over, v0 - over, z0), (u1 + over, v1 + over, z0), (u0 - over, v1 + over, z0)
        if axis == 'u':
            m = (v0 + v1) / 2
            r0, r1 = (u0 + ridge_in, m, z1), (u1 - ridge_in, m, z1)
            self.face(mat, a, b, r1, r0)
            self.face(mat, c, d, r0, r1)
            self.face(mat, b, c, r1)
            self.face(mat, d, a, r0)
        else:
            m = (u0 + u1) / 2
            r0, r1 = (m, v0 + ridge_in, z1), (m, v1 - ridge_in, z1)
            self.face(mat, b, c, r1, r0)
            self.face(mat, d, a, r0, r1)
            self.face(mat, a, b, r0)
            self.face(mat, c, d, r1)
        for p, q in ((a, b), (b, c), (c, d), (d, a)):
            self.face(edge, (p[0], p[1], z0 - 0.18), (q[0], q[1], z0 - 0.18), q, p)
        self.face(edge, (d[0], d[1], z0 - 0.18), (c[0], c[1], z0 - 0.18), (b[0], b[1], z0 - 0.18), (a[0], a[1], z0 - 0.18))

    # -- walls with openings --------------------------------------------------------------

    def wall(self, mat, p, q, z0, z1, openings=(), reveal=0.22, surround='trim', door=None):
        """A wall from p to q (outside on the right of p->q) with openings
        dict(s=centre along, w, z0, z1, arch='none'|'seg'|'round', cross=bool, kind='window'|'door')."""
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        d = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
        n = (d[1], -d[0])
        at = lambda s, z, out=0.0: (p[0] + d[0] * s + n[0] * out, p[1] + d[1] * s + n[1] * out, z)
        rise = lambda o: {'none': 0.0, 'seg': 0.16 * o['w'], 'round': o['w'] / 2}[o.get('arch', 'none')]
        s_cuts = sorted({0.0, L, *(o['s'] - o['w'] / 2 for o in openings), *(o['s'] + o['w'] / 2 for o in openings)})
        z_cuts = sorted({z0, z1, *(o['z0'] for o in openings), *(o['z1'] for o in openings)})
        for s0, s1 in zip(s_cuts, s_cuts[1:]):
            for a, b in zip(z_cuts, z_cuts[1:]):
                sm, zm = (s0 + s1) / 2, (a + b) / 2
                if any(abs(sm - o['s']) < o['w'] / 2 and o['z0'] < zm < o['z1'] for o in openings):
                    continue
                self.face(mat, at(s0, a), at(s1, a), at(s1, b), at(s0, b))
        for o in openings:
            s0, s1, zb, zt = o['s'] - o['w'] / 2, o['s'] + o['w'] / 2, o['z0'], o['z1']
            r = rise(o)
            spring = zt - r
            if r > 0:
                k = 6
                if o['arch'] == 'round':
                    arc = [(o['s'] + o['w'] / 2 * math.cos(math.pi * i / k), spring + r * math.sin(math.pi * i / k)) for i in range(k + 1)]
                else:
                    arc = [(s1 - o['w'] * i / k, spring + r * (1 - (2 * i / k - 1) ** 2)) for i in range(k + 1)]
                for (sa, za), (sb, zb2) in zip(arc, arc[1:]):  # the spandrel above the arch
                    self.face(mat, at(sb, zb2), at(sa, za), at(sa, zt), at(sb, zt))
                    self.face(mat, at(sa, za), at(sb, zb2), at(sb, zb2, -reveal), at(sa, za, -reveal))
                outline = [(s0, zb), (s1, zb), *arc]
                self.face('glass', *[at(s, z, -reveal) for s, z in outline])
                for (sa, za), (sb, zb2) in zip(arc, arc[1:]):  # the archivolt
                    f = 1 + 0.16 / (o['w'] / 2)
                    out = lambda s, z: (o['s'] + (s - o['s']) * f, spring + (z - spring) * (f if o['arch'] == 'round' else 1) + (0 if o['arch'] == 'round' else 0.15))
                    self.face(surround, at(sa, za, 0.07), at(*out(sa, za), 0.07), at(*out(sb, zb2), 0.07), at(sb, zb2, 0.07))
            else:
                self.face('glass', at(s0, zb, -reveal), at(s1, zb, -reveal), at(s1, zt, -reveal), at(s0, zt, -reveal))
                self.face(mat, at(s1, zt), at(s0, zt), at(s0, zt, -reveal), at(s1, zt, -reveal))
            for s, sign in ((s0, 1), (s1, -1)):
                pts = [at(s, zb), at(s, zb, -reveal), at(s, spring, -reveal), at(s, spring)]
                self.face(mat, *(pts if sign > 0 else pts[::-1]))
            self.face(surround, at(s0, zb), at(s1, zb), at(s1, zb, -reveal), at(s0, zb, -reveal))

            def strip(sa, sb, za, zb2, m='frame', front=-reveal + 0.05):
                self.face(m, at(sa, za, front), at(sb, za, front), at(sb, zb2, front), at(sa, zb2, front))
            t = 0.075
            strip(s0, s0 + t, zb, spring)
            strip(s1 - t, s1, zb, spring)
            strip(s0, s1, zb, zb + t)
            strip(s0, s1, spring - t / 2, spring + t / 2)
            strip(o['s'] - t / 2, o['s'] + t / 2, zb, zt - 0.02)
            if o.get('cross', True):
                zc = zb + (spring - zb) * 0.64
                strip(s0, s1, zc - t / 2, zc + t / 2)
            # architrave: jambs, sill and, over a flat head, a cornice
            def bar(sa, sb, za, zb2, out, m=surround):
                a, b, c, e = at(sa, za, out), at(sb, za, out), at(sb, zb2, out), at(sa, zb2, out)
                self.face(m, a, b, c, e)
                self.face(m, at(sa, zb2), e, c, at(sb, zb2))
                self.face(m, at(sa, za), a, e, at(sa, zb2))
                self.face(m, b, at(sb, za), at(sb, zb2), c)
                self.face(m, at(sb, za), b, a, at(sa, za))
            if o.get('kind', 'window') == 'window':
                bar(s0 - 0.28, s1 + 0.28, zb - 0.2, zb, 0.16)
            bar(s0 - 0.2, s0, zb, spring, 0.07)
            bar(s1, s1 + 0.2, zb, spring, 0.07)
            if o.get('arch', 'none') == 'none':
                bar(s0 - 0.2, s1 + 0.2, zt, zt + 0.22, 0.07)
                if o.get('hood', False):
                    bar(s0 - 0.36, s1 + 0.36, zt + 0.34, zt + 0.56, 0.24)

    def course(self, mat, pts, z0, z1, out, closed=True):
        """A moulding round a CCW outline, `out` metres proud."""
        n = len(pts)
        off = []
        for i in range(n):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
            d0, d1 = (b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])
            l0, l1 = math.hypot(*d0), math.hypot(*d1)
            n0, n1 = (d0[1] / l0, -d0[0] / l0), (d1[1] / l1, -d1[0] / l1)
            m = (n0[0] + n1[0], n0[1] + n1[1])
            k = 2 * out / max(0.4, m[0] ** 2 + m[1] ** 2)
            off.append((b[0] + m[0] * k, b[1] + m[1] * k))
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            self.face(mat, (*off[i], z0), (*off[j], z0), (*off[j], z1), (*off[i], z1))
            self.face(mat, (*off[i], z1), (*off[j], z1), (*pts[j], z1), (*pts[i], z1))
            self.face(mat, (*pts[i], z0), (*pts[j], z0), (*off[j], z0), (*off[i], z0))

    def balustrade(self, p, q, z, height=0.95, mat='trim', step=0.42, posts=2.8):
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        if L < 0.3:
            return
        d = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
        n = (d[1], -d[0])

        def bar(s0, s1, t, za, zb):
            pts = [(p[0] + d[0] * s + n[0] * o, p[1] + d[1] * s + n[1] * o) for s, o in ((s0, t), (s1, t), (s1, -t), (s0, -t))]
            for i in range(4):
                a, b = pts[i], pts[(i + 1) % 4]
                self.face(mat, (*a, za), (*b, za), (*b, zb), (*a, zb))
            self.face(mat, *[(*a, zb) for a in pts])
        bar(0, L, 0.13, z, z + 0.16)
        bar(0, L, 0.15, z + height - 0.14, z + height)
        k = max(1, round(L / posts))
        for i in range(k + 1):
            s = L * i / k
            bar(max(0, s - 0.16), min(L, s + 0.16), 0.17, z, z + height + 0.08)
        m = int(L / step)
        for i in range(m):
            s = (i + 0.5) * L / m
            bar(s - 0.06, s + 0.06, 0.06, z + 0.16, z + height - 0.14)

    def band(self, mat, line, width, height, sink=0.3, cap=None, cap_out=0.06, closed=False, step=2.0):
        """A hedge or low wall along a polyline in EPSG:3006 metres; each end stands on the ground under it."""
        pts = [tuple(p) for p in line]
        if closed:
            pts.append(pts[0])
        dense = []
        for p, q in zip(pts, pts[1:]):
            k = max(1, math.ceil(math.hypot(q[0] - p[0], q[1] - p[1]) / step))
            dense += [(p[0] + (q[0] - p[0]) * i / k, p[1] + (q[1] - p[1]) * i / k) for i in range(k)]
        dense.append(pts[-1])
        n = len(dense)
        sides = []
        for i, p in enumerate(dense):
            before = dense[i - 1] if i else (dense[-2] if closed else None)
            after = dense[i + 1] if i + 1 < n else (dense[1] if closed else None)
            d0 = (p[0] - before[0], p[1] - before[1]) if before else None
            d1 = (after[0] - p[0], after[1] - p[1]) if after else None
            d0, d1 = d0 or d1, d1 or d0
            l0, l1 = math.hypot(*d0), math.hypot(*d1)
            n0, n1 = (-d0[1] / l0, d0[0] / l0), (-d1[1] / l1, d1[0] / l1)
            m = (n0[0] + n1[0], n0[1] + n1[1])
            k = 2 / max(0.8, m[0] ** 2 + m[1] ** 2)
            sides.append((m[0] * k, m[1] * k))
        own = lambda e, nn, z: ((e - ORIGIN[0] - self.o[0]) * self.u[0] + (nn - ORIGIN[1] - self.o[1]) * self.u[1],
                                (e - ORIGIN[0] - self.o[0]) * self.v[0] + (nn - ORIGIN[1] - self.o[1]) * self.v[1], z)
        lev = [ground(*p) for p in dense]

        def shell(m, half, z0, z1, floor=False):
            rows = []
            for p, s_, g in zip(dense, sides, lev):
                l_ = (p[0] + s_[0] * half, p[1] + s_[1] * half)
                r_ = (p[0] - s_[0] * half, p[1] - s_[1] * half)
                rows.append((own(*l_, g + z0), own(*r_, g + z0), own(*r_, g + z1), own(*l_, g + z1)))
            for a, b in zip(rows, rows[1:]):
                self.face(m, a[1], b[1], b[2], a[2])
                self.face(m, b[0], a[0], a[3], b[3])
                self.face(m, a[2], b[2], b[3], a[3])
                if floor:
                    self.face(m, a[0], b[0], b[1], a[1])
            if not closed:
                a, b = rows[0], rows[-1]
                self.face(m, a[0], a[1], a[2], a[3])
                self.face(m, b[1], b[0], b[3], b[2])
        shell(mat, width / 2, -sink, height)
        if cap:
            shell(cap, width / 2 + cap_out, height, height + 0.1, floor=True)

    def build(self, name, collection):
        obj = bpy.data.objects.new(name, None)
        collection.objects.link(obj)
        for mat, (verts, faces) in sorted(self.parts.items()):
            me = bpy.data.meshes.new(f'{name}-{mat}')
            me.from_pydata(verts, [], faces)
            me.materials.append(bpy.data.materials[mat])
            me.validate()
            me.shade_smooth()                    # corners are shared only inside one flat face
            child = bpy.data.objects.new(f'{name}-{mat}', me)
            child.parent = obj
            collection.objects.link(child)
        return obj


# -------------------------------------------------------------------- the castle

def castle():
    a = math.radians(-24.35)
    m = Mesh(648636.91, 6598165.06, math.cos(a), math.sin(a))
    B0, EAVE = 13.0, 24.0
    U, VS, VN = 14.15, -8.82, 6.22
    win = lambda s, z0, z1, w=1.5, **k: dict(s=s, w=w, z0=z0, z1=z1, **k)
    XS = (6.05, 9.7, 13.0)
    # north wall, west to east is right to left seen from outside: walk east -> west with outside on the right
    L = 2 * U
    s_of = lambda u: U - u                       # along the north wall walked from +U to -U
    ground = [win(s_of(sg * x), 14.95, 17.55, 1.42, arch='seg') for x in XS for sg in (-1, 1)]
    upper = [win(s_of(sg * x), 20.3, 23.0, 1.5, hood=True) for x in XS for sg in (-1, 1)]
    m.wall('plaster', (U, VN), (4.3, VN), B0, EAVE, [dict(o, s=o['s']) for o in ground + upper if o['s'] < U - 4.3])
    m.wall('plaster', (-4.3, VN), (-U, VN), B0, EAVE, [dict(o, s=o['s'] - (U + 4.3)) for o in ground + upper if o['s'] > U + 4.3])
    # central bay, 0.35 m proud, three arches above the porch
    VB = VN + 0.35
    arches = [win(4.3 - u, 20.15, 23.45, 1.55, arch='round') for u in (-2.5, 0.0, 2.5)]
    doors = [win(4.3 - u, 13.95, 17.4, 1.6, arch='round', kind='door') for u in (-2.5, 0.0, 2.5)]
    m.wall('plaster', (4.3, VN), (4.3, VB), B0, EAVE)
    m.wall('plaster', (4.3, VB), (-4.3, VB), B0, EAVE, arches + doors)
    m.wall('plaster', (-4.3, VB), (-4.3, VN), B0, EAVE)
    # south wall with its central bay under a pediment; the terrace covers it to 15.1
    sg_ = [win(U + sg * x, 15.15, 18.2, 1.45, arch='seg', kind='door') for x in XS for sg in (-1, 1)]
    su = [win(U + sg * x, 20.3, 23.0, 1.5, hood=True) for x in XS for sg in (-1, 1)]
    VC = -9.78
    m.wall('plaster', (-U, VS), (-4.2, VS), 11.2, EAVE, [o for o in sg_ + su if o['s'] < U - 4.2])
    m.wall('plaster', (4.2, VS), (U, VS), 11.2, EAVE, [dict(o, s=o['s'] - (U + 4.2)) for o in sg_ + su if o['s'] > U + 4.2])
    m.wall('plaster', (-4.2, VS), (-4.2, VC), 11.2, EAVE)
    m.wall('plaster', (4.2, VC), (4.2, VS), 11.2, EAVE)
    m.wall('plaster', (-4.2, VC), (4.2, VC), 11.2, EAVE,
           [win(4.2 + u, 20.15, 23.45, 1.5, arch='round') for u in (-2.5, 0, 2.5)] + [win(4.2 + u, 15.15, 18.5, 1.55, arch='round', kind='door') for u in (-2.5, 0, 2.5)])
    # side walls: three windows above each wing
    for sign in (-1, 1):
        p, q = ((U, VS), (U, VN)) if sign > 0 else ((-U, VN), (-U, VS))
        span = VN - VS
        mids = [span * f for f in (0.22, 0.5, 0.78)]
        m.wall('plaster', p, q, 11.2 if sign > 0 else 12.6, EAVE, [win(s, 20.5, 23.0, 1.4) for s in mids])
    outline = [(-U, VS), (-4.2, VS), (-4.2, VC), (4.2, VC), (4.2, VS), (U, VS), (U, VN), (4.3, VN), (4.3, VB), (-4.3, VB), (-4.3, VN), (-U, VN)]
    m.course('trim', outline, 18.95, 19.2, 0.14)
    m.course('trim', outline, 19.2, 19.42, 0.24)
    m.course('trim', outline, 23.55, 23.75, 0.12)
    m.course('trim', outline, 23.95, 24.3, 0.5)
    m.course('slate_edge', outline, 24.3, 24.42, 0.56)
    m.course('granite', outline, 11.2, 14.35, 0.1)
    # dentils under the cornice, north and south
    for v, n in ((VN, 1), (VS, -1)):
        u = -U + 0.4
        while u < U - 0.2:
            if not (abs(u) < 4.5):
                v0, v1 = (v, v + 0.3) if n > 0 else (v - 0.3, v)
                m.box('trim', u, u + 0.24, v0, v1, 23.75, 23.95, bottom=True)
            u += 0.6
    # pilasters on the upper floor
    for u in (-13.95, -11.35, -7.87, -4.75, 4.75, 7.87, 11.35, 13.95):
        m.box('trim', u - 0.32, u + 0.32, VN, VN + 0.13, 19.42, 23.55)
        if abs(u) > 4.6:
            m.box('trim', u - 0.32, u + 0.32, VS - 0.13, VS, 19.42, 23.55)
    for u in (-3.9, -1.25, 1.25, 3.9):
        m.box('trim', u - 0.22, u + 0.22, VB, VB + 0.12, 19.42, 23.55)
    # channelled ground floor: thin shadow lines between the openings
    for k in range(9):
        z = 14.5 + k * 0.48
        for u0, u1 in ((-14.1, -13.85), (-12.1, -10.6), (-8.8, -6.95), (-5.15, -4.35), (4.35, 5.15), (6.95, 8.8), (10.6, 12.1), (13.85, 14.1)):
            m.face('plaster_shade', (u1, VN + 0.012, z), (u0, VN + 0.012, z), (u0, VN + 0.012, z + 0.06), (u1, VN + 0.012, z + 0.06))

    # mansard: a steep slate slope to 27.9, a lead roll, then a low hip to 29.05
    o, i_ = 0.4, 2.75
    lo = [(-U - o, VS - o, 24.42), (U + o, VS - o, 24.42), (U + o, VN + o, 24.42), (-U - o, VN + o, 24.42)]
    hi = [(-U + i_, VS + i_, 27.9), (U - i_, VS + i_, 27.9), (U - i_, VN - i_, 27.9), (-U + i_, VN - i_, 27.9)]
    m.rings('slate', [lo, hi], cap=False)
    roll = [(p[0] * 1.0 + (0.12 if p[0] > 0 else -0.12), p[1] + (0.12 if p[1] > 0 else -0.12)) for p in hi]
    m.rings('slate_edge', [[(*p, 27.85) for p in roll], [(*p, 28.05) for p in roll]], cap=False)
    r0, r1 = (-7.2, -1.3, 29.05), (7.2, -1.3, 29.05)
    t = [(*p, 28.05) for p in roll]
    m.face('slate', t[0], t[1], r1, r0)
    m.face('slate', t[2], t[3], r0, r1)
    m.face('slate', t[1], t[2], r1)
    m.face('slate', t[3], t[0], r0)
    for u in (-9.0, 6.15):                      # the two long black chimney stacks on the ridge
        m.box('iron', u - 1.5, u + 1.5, -1.95, -0.65, 28.4, 30.3)
        m.box('slate_edge', u - 1.62, u + 1.62, -2.07, -0.53, 30.1, 30.22)
    # bull's-eye dormers, and flat skylights on the south slope
    for v, n in ((VN, 1), (VS, -1)):
        for u in (-9.7, 9.7):
            zc, dv = 25.75, (25.75 - 24.42) / 3.48 * (i_ + o)
            vv = v + n * (o - dv)
            face = vv + n * 0.5
            m.box('slate_edge', u - 0.6, u + 0.6, min(face, vv - n * 0.9), max(face, vv - n * 0.9), zc - 0.55, zc + 0.62)
            pts = [(u + 0.36 * math.cos(2 * math.pi * k / 12), face + n * 0.02, zc + 0.36 * math.sin(2 * math.pi * k / 12)) for k in range(12)]
            rim = [(u + 0.52 * math.cos(2 * math.pi * k / 12), face + n * 0.015, zc + 0.52 * math.sin(2 * math.pi * k / 12)) for k in range(12)]
            m.face('trim', *(rim if n < 0 else rim[::-1]))
            m.face('glass', *[(p[0], p[1] + n * 0.02, p[2]) for p in (pts if n < 0 else pts[::-1])])
            m.lathe('gold', u, vv, [(zc + 0.62, 0.09), (zc + 0.8, 0.11), (zc + 1.0, 0.02)], 6)
    # attic over the central bay, with its clock
    m.box('plaster', -4.2, 4.2, VB - 1.0, VB, 24.3, 25.65)
    m.course('trim', [(-4.2, VB - 1.0), (4.2, VB - 1.0), (4.2, VB), (-4.2, VB)], 25.65, 25.9, 0.18)
    m.box('trim', -1.25, 1.25, VB - 0.9, VB + 0.1, 25.2, 27.2)
    arc = [(1.25 * math.cos(math.pi * k / 10), 27.2 + 1.15 * math.sin(math.pi * k / 10)) for k in range(11)]
    for (ua, za), (ub, zb) in zip(arc, arc[1:]):
        m.face('trim', (ua, VB + 0.1, za), (ub, VB + 0.1, zb), (0, VB + 0.1, 27.2))
        m.face('trim', (ua, VB + 0.1, za), (ua, VB - 0.9, za), (ub, VB - 0.9, zb), (ub, VB + 0.1, zb))
    clock = [(0.72 * math.cos(2 * math.pi * k / 20), VB + 0.14, 27.05 + 0.72 * math.sin(2 * math.pi * k / 20)) for k in range(20)]
    dial = [(0.56 * math.cos(2 * math.pi * k / 20), VB + 0.17, 27.05 + 0.56 * math.sin(2 * math.pi * k / 20)) for k in range(20)]
    m.face('gold', *clock[::-1])
    m.face('clock', *dial[::-1])
    for ang, ln in ((math.radians(60), 0.34), (math.radians(150), 0.46)):
        du, dz = math.cos(ang), math.sin(ang)
        m.face('iron', *[(x, VB + 0.19, z) for x, z in ((-dz * 0.03, 27.05 + du * 0.03), (du * ln - dz * 0.02, 27.05 + dz * ln + du * 0.02), (du * ln + dz * 0.02, 27.05 + dz * ln - du * 0.02), (dz * 0.03, 27.05 - du * 0.03))])
    for u in (-3.9, 3.9):
        m.lathe('trim', u, VB - 0.5, [(25.9, 0.3), (26.1, 0.22), (26.6, 0.34), (27.3, 0.2), (27.9, 0.1)], 8)
        m.lathe('gold', u, VB - 0.5, [(27.9, 0.1), (28.1, 0.16), (28.4, 0.02)], 6)
    # the bell roof, the gallery, the lantern, its dome and spire (laser: dome top 38.9; photo: spire to about 41.5)
    tv = 2.75
    bell = [(24.9, 3.65), (25.8, 3.6), (26.8, 3.45), (27.8, 3.22), (28.8, 2.92), (29.7, 2.58), (30.5, 2.22), (31.2, 1.86), (31.9, 1.58)]
    m.rings('zinc', [m.square_ring(0, tv, h, z, 0.5) for z, h in bell])
    half_at = lambda z: next(h0 + (h1 - h0) * (z - z0) / (z1 - z0) for (z0, h0), (z1, h1) in zip(bell, bell[1:]) if z0 <= z <= z1)
    for k in range(11):                         # the shingles' courses
        z = 25.2 + 0.58 * k
        m.rings('zinc_dark', [m.square_ring(0, tv, half_at(z) + 0.03, z, 0.5), m.square_ring(0, tv, half_at(z + 0.07) + 0.03, z + 0.07, 0.5)], cap=False)
    for k in range(8):                          # ribs up the chamfers
        for (z0, h0), (z1, h1) in zip(bell, bell[1:]):
            p0, p1 = m.square_ring(0, tv, h0 + 0.05, z0, 0.5)[k], m.square_ring(0, tv, h1 + 0.05, z1, 0.5)[k]
            q0, q1 = m.square_ring(0, tv, h0 + 0.05, z0, 0.62)[k], m.square_ring(0, tv, h1 + 0.05, z1, 0.62)[k]
            m.face('zinc_dark', p0, q0, q1, p1)
            m.face('zinc_dark', p1, q1, q0, p0)
    m.rings('zinc_dark', [m.square_ring(0, tv, 1.62, 31.85, 0.4), m.square_ring(0, tv, 1.7, 32.1, 0.4), m.square_ring(0, tv, 1.35, 32.3, 0.4), m.square_ring(0, tv, 1.45, 32.65, 0.4),
                          m.square_ring(0, tv, 2.05, 32.9, 0.5), m.square_ring(0, tv, 2.05, 33.1, 0.5)])
    g = m.square_ring(0, tv, 1.98, 33.1, 0.5)
    for a0, a1 in zip(g, g[1:] + g[:1]):
        m.balustrade(a0[:2], a1[:2], 33.1, 1.0, 'trim', 0.3, 3.0)
    for k in range(8):
        ang = math.pi / 8 + k * math.pi / 4
        m.lathe('trim', 1.18 * math.cos(ang), tv + 1.18 * math.sin(ang), [(33.1, 0.2), (33.3, 0.14), (35.6, 0.12), (35.8, 0.2)], 6)
    m.lathe('zinc_dark', 0, tv, [(33.1, 0.75), (35.7, 0.7)], 8)
    m.lathe('trim', 0, tv, [(35.6, 1.38), (36.25, 1.42)], 8, turn=math.pi / 8)
    m.lathe('zinc_dark', 0, tv, [(36.15, 2.0), (36.3, 2.02), (36.75, 1.35)], 8, turn=math.pi / 8)
    m.lathe('zinc', 0, tv, [(36.75, 1.28), (37.2, 1.34), (37.7, 1.28), (38.2, 1.02), (38.6, 0.66), (38.9, 0.34)], 12)
    m.lathe('gold', 0, tv, [(38.9, 0.36), (39.05, 0.4), (39.2, 0.28)], 8)
    m.lathe('zinc', 0, tv, [(39.2, 0.24), (41.2, 0.07)], 8)
    m.lathe('gold', 0, tv, [(41.2, 0.07), (41.35, 0.15), (41.5, 0.1), (41.75, 0.02)], 8)
    # south pediment over the terrace bay
    m.face('plaster', (-4.2, VC, 24.3), (4.2, VC, 24.3), (0, VC, 26.35))
    m.face('slate', (4.7, VC - 0.4, 24.3), (4.7, VC + 4.2, 24.3), (0, VC + 4.2, 26.6), (0, VC - 0.4, 26.6))
    m.face('slate', (-4.7, VC + 4.2, 24.3), (-4.7, VC - 0.4, 24.3), (0, VC - 0.4, 26.6), (0, VC + 4.2, 26.6))
    m.face('trim', (-4.7, VC - 0.4, 24.02), (0, VC - 0.4, 26.32), (0, VC - 0.4, 26.6), (-4.7, VC - 0.4, 24.3))
    m.face('trim', (0, VC - 0.4, 26.32), (4.7, VC - 0.4, 24.02), (4.7, VC - 0.4, 24.3), (0, VC - 0.4, 26.6))

    # porch: four dark columns under a balustraded balcony
    m.box('stone', -3.75, 4.0, VB, 10.05, 13.2, 13.9)
    for u in (-3.3, -1.25, 1.25, 3.5):
        m.lathe('iron', u, 9.45, [(13.9, 0.3), (14.15, 0.24), (18.4, 0.2), (18.6, 0.3)], 10)
    m.box('trim', -3.62, 3.9, VB, 9.8, 18.6, 19.35, bottom=True)
    m.box('trim', -3.75, 4.05, VB, 9.95, 19.35, 19.6)
    for a0, a1 in (((3.9, VB), (3.9, 9.8)), ((3.9, 9.8), (-3.62, 9.8)), ((-3.62, 9.8), (-3.62, VB))):
        m.balustrade(a0, a1, 19.6, 0.85)

    # the two wings, one storey, arched, low hipped slate roofs at 19.5
    for sign, v0, v1 in ((-1, -7.86, 6.2), (1, -7.81, 6.62)):
        ui, uo = sign * U, sign * 19.79
        e0, e1 = ((ui, v0), (uo, v0)) if sign > 0 else ((uo, v0), (ui, v0))
        mid = abs(uo - ui) / 2
        m.wall('plaster', e0, e1, 11.2, 18.4, [win(mid, 15.0, 17.9, 1.5, arch='round')])
        f0, f1 = ((uo, v1), (ui, v1)) if sign > 0 else ((ui, v1), (uo, v1))
        m.wall('plaster', f0, f1, 12.8, 18.4, [win(mid, 15.0, 17.9, 1.5, arch='round')])
        p, q = ((uo, v0), (uo, v1)) if sign > 0 else ((uo, v1), (uo, v0))
        span = v1 - v0
        m.wall('plaster', p, q, 11.2, 18.4, [win(span * f, 15.0, 17.9, 1.45, arch='round') for f in (0.2, 0.5, 0.8)])
        ring = [(min(ui, uo), v0), (max(ui, uo), v0), (max(ui, uo), v1), (min(ui, uo), v1)]
        m.course('trim', ring, 18.2, 18.5, 0.3)
        m.course('granite', ring, 11.2, 14.35, 0.08)
        m.hip('slate', min(ui, uo), max(ui, uo), v0, v1, 18.55, 19.75, 2.6, axis='v', over=0.25)
    return m


def terrace():
    a = math.radians(-24.35)
    m = Mesh(648636.91, 6598165.06, math.cos(a), math.sin(a))
    U0, U1, V0, V1, Z = -14.6, 13.9, -21.0, -8.8, 15.1
    S0, S1 = -4.0, 1.5
    m.face('stone', (U0, V0, Z), (U1, V0, Z), (U1, V1, Z), (U0, V1, Z))
    for p, q in (((U0, V0), (S0, V0)), ((S1, V0), (U1, V0)), ((U1, V0), (U1, V1)), ((U0, V1), (U0, V0))):
        m.wall('plaster', p, q, 10.6, Z)
        m.balustrade(p, q, Z, 0.95)
    m.course('trim', [(U0, V0), (U1, V0), (U1, V1), (U0, V1)], Z - 0.32, Z - 0.02, 0.16)
    # the flight down to the lawn: 22 risers, 6.5 m
    n, depth, drop = 22, 6.5, Z - 11.3
    for k in range(n):
        v1, v0 = V0 - depth * k / n, V0 - depth * (k + 1) / n
        m.box('stone', S0, S1, v0, v1, 10.6, Z - drop * (k + 1) / n)
    for u in (S0 - 0.35, S1 + 0.05):
        for k in range(6):
            v1, v0 = V0 - depth * k / 6, V0 - depth * (k + 1) / 6
            m.box('trim', u, u + 0.3, v0, v1, 10.6, Z - drop * (k + 0.2) / 6 + 0.55)
    for u in (S0 - 0.2, S1 + 0.2):
        m.box('trim', u - 0.35, u + 0.35, V0 - depth - 0.35, V0 - depth + 0.35, 10.6, 12.5)
        m.lathe('trim', u, V0 - depth, [(12.5, 0.2), (12.65, 0.42), (12.95, 0.46), (13.25, 0.28), (13.35, 0.04)], 10)
    # glazed side rooms either end of the terrace (white frames, glass roofs at 14.6)
    for u0, u1, v0, v1, floor in ((-19.9, U0, -19.2, -12.4, 11.4), (U1, 17.5, -19.6, -12.4, 11.8)):
        m.box('granite', u0, u1, v0, v1, floor - 1.0, floor + 0.35)
        for p, q in (((u0, v0), (u1, v0)), ((u1, v0), (u1, v1)), ((u1, v1), (u0, v1)), ((u0, v1), (u0, v0))):
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            k = max(2, round(L / 1.25))
            m.face('glass', (*p, floor + 0.35), (*q, floor + 0.35), (*q, 14.35), (*p, 14.35))
            for i in range(k + 1):
                x, y = p[0] + (q[0] - p[0]) * i / k, p[1] + (q[1] - p[1]) * i / k
                m.box('trim', x - 0.07, x + 0.07, y - 0.07, y + 0.07, floor + 0.35, 14.45)
        m.box('trim', u0 - 0.15, u1 + 0.15, v0 - 0.15, v1 + 0.15, 14.4, 14.62)
        k = 4
        for i in range(k):
            s0, s1 = v0 + (v1 - v0) * i / k + 0.1, v0 + (v1 - v0) * (i + 1) / k - 0.1
            m.face('glass', (u0 + 0.1, s0, 14.63), (u1 - 0.1, s0, 14.63), (u1 - 0.1, s1, 14.63), (u0 + 0.1, s1, 14.63))
    return m


def pavilion():
    """The round pavilion on its plate below the terrace (orthophoto 2025; built after the laser: height from its shadow)."""
    m = Mesh(648660.4, 6598065.0, 1, 0)
    z = 17.0
    m.lathe('stone', 0, 0, [(z - 1.6, 4.1), (z + 0.05, 4.1)], 28)
    m.lathe('trim', 0, 0, [(z + 0.05, 1.75), (z + 0.3, 1.75)], 16)
    for k in range(8):
        a = k * math.pi / 4
        m.lathe('trim', 1.5 * math.cos(a), 1.5 * math.sin(a), [(z + 0.3, 0.13), (z + 2.75, 0.1)], 8)
    m.lathe('trim', 0, 0, [(z + 2.7, 1.72), (z + 3.0, 1.75)], 16)
    m.lathe('iron', 0, 0, [(z + 2.95, 1.85), (z + 3.3, 1.72), (z + 3.75, 1.4), (z + 4.1, 0.9), (z + 4.3, 0.3)], 16)
    m.lathe('gold', 0, 0, [(z + 4.3, 0.12), (z + 4.45, 0.22), (z + 4.6, 0.05)], 8)
    return m


def halfway_stadium():
    """The octagonal halfway house on its terrace (OSM way 1235353673, laser 6.3-11.7 m, orthophoto 2025)."""
    m = Mesh(649264.7, 6598524.4, 1, 0)
    z0, eave, top, r = 6.5, 9.3, 11.05, 4.6
    t = math.radians(17.5)
    pts = [(r * math.cos(t + k * math.pi / 4), r * math.sin(t + k * math.pi / 4)) for k in range(8)]
    for k in range(8):
        p, q = pts[k], pts[(k + 1) % 8]
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        door = k in (3, 5, 6)                   # doors onto the paths and the terrace
        m.wall('plaster', p, q, z0 - 1.6, eave, [dict(s=L / 2, w=1.7, z0=z0 + (0.1 if door else 0.9), z1=z0 + 2.4, arch='none', kind='door' if door else 'window')])
    m.course('trim', pts, eave - 0.25, eave, 0.2)
    over = [(1.16 * x, 1.16 * y, eave) for x, y in pts]
    m.rings('slate', [over, [(0.24 * x, 0.24 * y, top) for x, y in pts]], cap=False)
    m.rings('slate_edge', [[(x, y, eave - 0.16) for x, y, _ in over], over], cap=False)
    m.face('slate_edge', *[(x, y, eave - 0.16) for x, y, _ in over][::-1])
    lant = [(0.22 * x, 0.22 * y) for x, y in pts]
    m.rings('glass', [[(*p, top - 0.1) for p in lant], [(*p, top + 0.5) for p in lant]], cap=False)
    m.rings('slate', [[(1.25 * x, 1.25 * y, top + 0.5) for x, y in lant], [(0.05 * x, 0.05 * y, top + 0.95) for x, y in lant]])
    m.lathe('gold', 0, 0, [(top + 0.9, 0.07), (top + 1.05, 0.12), (top + 1.2, 0.02)], 8)
    w = lambda e, n: (e - 649264.7, n - 6598524.4)
    deck = [w(*p) for p in ((649257.0, 6598516.9), (649260.9, 6598516.3), (649265.0, 6598515.4), (649269.9, 6598515.3), (649270.3, 6598519.4), (649270.7, 6598522.9),
                            (649270.9, 6598526.6), (649268.1, 6598530.9), (649261.9, 6598531.7), (649258.1, 6598528.4), (649257.8, 6598524.8), (649257.1, 6598520.9))]
    m.rings('stone', [[(*p, 4.6) for p in deck], [(*p, z0 + 0.06) for p in deck]])
    return m


STADIUM_WALLS = [
    [(649247.5, 6598525.6), (649257.8, 6598524.6), (649258.1, 6598528.4), (649261.9, 6598531.7), (649268.1, 6598530.9), (649270.9, 6598526.6), (649270.7, 6598522.9), (649278.9, 6598521.7)],
    [(649250.1, 6598521.7), (649257.1, 6598520.9), (649257.0, 6598516.9), (649260.9, 6598516.3), (649260.3, 6598509.6), (649256.3, 6598512.2), (649252.7, 6598516.3), (649250.1, 6598521.7)],
    [(649269.9, 6598519.4), (649278.4, 6598518.2), (649277.9, 6598515.8), (649274.8, 6598512.2), (649269.7, 6598509.6), (649264.5, 6598509.0), (649265.0, 6598515.4), (649269.9, 6598515.3), (649269.9, 6598519.4)],
]


def halfway_stadium_walls():
    """The white-capped garden walls and the parapet round the octagon (orthophoto 2025; height from their shadows, about 0.8 m)."""
    m = Mesh(649264.7, 6598524.4, 1, 0)
    for k, line in enumerate(STADIUM_WALLS):
        m.band('plaster', line[:-1] if k else line, 0.38, 0.75, sink=0.6, cap='trim', closed=k > 0)
    return m


def halfway_castle():
    """The Castle's halfway house, a white gabled house with a south terrace (orthophoto 2025; no OSM footprint, no laser)."""
    a = math.atan2(2.0, 10.4)
    m = Mesh(649248.3, 6599259.1, math.cos(a), math.sin(a))
    z0 = 10.75
    U, V = 4.9, 4.75
    eave, ridge = z0 + 2.8, z0 + 5.4
    win = lambda s, w=1.2, **k: dict(s=s, w=w, z0=z0 + 0.95, z1=z0 + 2.3, **k)
    door = lambda s, w=1.7: dict(s=s, w=w, z0=z0 + 0.1, z1=z0 + 2.35, kind='door')
    m.wall('plaster', (-U, -V), (U, -V), z0 - 1.0, eave, [door(2.0), door(4.9), door(7.8)])
    m.wall('plaster', (U, -V), (U, V), z0 - 1.0, eave, [win(2.6), win(6.9)])
    m.wall('plaster', (U, V), (-U, V), z0 - 1.2, eave, [win(2.3), win(4.9), win(7.5)])
    m.wall('plaster', (-U, V), (-U, -V), z0 - 1.2, eave, [win(2.6), win(6.9)])
    for u, sign in ((U, 1), (-U, -1)):
        tri = [(u, -V, eave), (u, V, eave), (u, 0, ridge - 0.1)]
        m.face('plaster', *(tri if sign > 0 else tri[::-1]))
    o, slope = 0.45, (ridge - eave) / V
    lo = eave - o * slope
    for sv in (-1, 1):
        low = [(-U - o, sv * (V + o), lo), (U + o, sv * (V + o), lo)]
        top = [(U + o, 0, ridge), (-U - o, 0, ridge)]
        up = [*low, *top] if sv < 0 else [low[1], low[0], top[1], top[0]]
        m.face('slate', *[(x, y, z + 0.05) for x, y, z in up])
        m.face('slate_edge', *[(x, y, z - 0.11) for x, y, z in up[::-1]])
        edge = [up[0], up[1]]
        m.face('slate_edge', (*edge[0][:2], lo - 0.11), (*edge[1][:2], lo - 0.11), (*edge[1][:2], lo + 0.05), (*edge[0][:2], lo + 0.05))
        for x, flip in ((U + o, sv < 0), (-U - o, sv > 0)):
            q = [(x, sv * (V + o), lo - 0.11), (x, 0, ridge - 0.11), (x, 0, ridge + 0.05), (x, sv * (V + o), lo + 0.05)]
            m.face('trim', *(q if flip else q[::-1]))
    m.box('stone', -U, U + 1.1, -V - 4.7, -V, z0 - 1.5, z0 + 0.05)
    m.box('stone', U, U + 1.1, -V, V, z0 - 1.5, z0 + 0.05)
    return m


def halfway_castle_garden():
    """The hedges round the terrace and the white cart bay (orthophoto 2025)."""
    m = Mesh(649248.3, 6599259.1, 1, 0)
    for line in ([(649243.6, 6599253.0), (649244.4, 6599247.6)], [(649244.6, 6599248.4), (649248.6, 6599248.8)], [(649250.2, 6599249.3), (649255.6, 6599250.2)], [(649255.9, 6599250.6), (649256.2, 6599253.4)]):
        m.band('hedge', line, 0.9, 0.95)
    m.band('plaster', [(649250.8, 6599248.5), (649251.2, 6599246.8), (649255.9, 6599247.8), (649255.6, 6599249.0)], 0.3, 0.55, sink=0.5, cap='trim')
    return m


C0 = (648651.3, 6598197.6)                      # the fountain, on the castle's own axis
AXIS = math.radians(-24.35)


def courtyard():
    """The forecourt: the clipped ring with its four bays, the fountain, and the hedges round the gravel (orthophoto 2025)."""
    m = Mesh(*C0, 1, 0)
    ring = []
    for k in range(4):                          # bays on the castle's two axes
        a = AXIS + k * math.pi / 2
        c, s_ = math.cos(a), math.sin(a)
        at = lambda out, side: (C0[0] + out * c - side * s_, C0[1] + out * s_ + side * c)
        ring += [at(9.0, -1.9), at(10.9, -1.9), at(10.9, 1.9), at(9.0, 1.9)]
        for i in range(1, 6):
            b = a + math.radians(12.0 + (90 - 24.0) * i / 6)
            ring.append((C0[0] + 9.2 * math.cos(b), C0[1] + 9.2 * math.sin(b)))
    m.band('hedge', ring, 0.8, 0.85, closed=True)
    for line in ([(648638.4, 6598226.6), (648643.6, 6598223.7), (648648.0, 6598227.4)], [(648657.6, 6598233.4), (648663.2, 6598230.2)], [(648667.4, 6598228.4), (648671.2, 6598226.0)],
                 [(648671.2, 6598221.2), (648674.6, 6598218.7), (648676.8, 6598215.2), (648677.7, 6598211.4), (648676.9, 6598207.6), (648681.6, 6598205.3)],
                 [(648616.6, 6598218.2), (648613.2, 6598217.2), (648607.0, 6598203.6), (648608.2, 6598195.8), (648616.4, 6598192.0), (648618.6, 6598195.2)]):
        m.band('hedge', line, 1.0, 1.05)
    z = ground(*C0)
    m.lathe('trim', 0, 0, [(z - 0.4, 1.55), (z + 0.45, 1.6), (z + 0.5, 1.75), (z + 0.6, 1.7)], 20)
    m.lathe('glass', 0, 0, [(z + 0.6, 1.5), (z + 0.605, 1.45)], 20)
    m.lathe('trim', 0, 0, [(z + 0.4, 0.3), (z + 1.3, 0.2), (z + 1.4, 0.75), (z + 1.55, 0.8), (z + 1.6, 0.25), (z + 2.1, 0.14), (z + 2.2, 0.36), (z + 2.35, 0.3), (z + 2.5, 0.05)], 14)
    return m


def gate():
    """The avenue's gate: four ball-topped piers, two sweeping walls and wrought iron (Commons entrance photo for the order, orthophoto 2025 for the plan)."""
    c = (648741.95, 6598396.25)
    m = Mesh(*c, math.cos(AXIS), math.sin(AXIS))
    g = ground(*c)

    def pier(u, v, half, h, ball):
        m.box('plaster', u - half, u + half, v - half, v + half, g - 0.8, g + h)
        for k in range(4):
            z = g + 0.55 + k * (h - 0.7) / 4
            m.course('plaster_shade', [(u - half, v - half), (u + half, v - half), (u + half, v + half), (u - half, v + half)], z, z + 0.05, 0.012)
        m.box('trim', u - half - 0.1, u + half + 0.1, v - half - 0.1, v + half + 0.1, g + h, g + h + 0.18)
        if ball:
            m.lathe('trim', u, v, [(g + h + 0.18, 0.22), (g + h + 0.3, 0.12), (g + h + 0.38, ball * 0.7), (g + h + 0.38 + ball * 0.45, ball * 0.98), (g + h + 0.38 + ball, ball),
                                   (g + h + 0.38 + ball * 1.5, ball * 0.86), (g + h + 0.38 + ball * 1.9, ball * 0.4), (g + h + 0.38 + ball * 2, 0.02)], 12)
    for sg in (-1, 1):
        pier(sg * 2.6, 0, 0.45, 3.0, 0.32)
        pier(sg * 4.45, 0, 0.38, 2.5, 0.25)
        arc = [(sg * (4.8 + 3.8 * math.sin(math.radians(90) * k / 7)), 3.8 * (1 - math.cos(math.radians(90) * k / 7))) for k in range(8)]
        for k, (p, q) in enumerate(zip(arc, arc[1:])):     # the wall sweeps down toward its end pier
            za, zb = g + 2.15 - 0.9 * (k / 7) ** 1.4, g + 2.15 - 0.9 * ((k + 1) / 7) ** 1.4
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            n = (-(q[1] - p[1]) / L * 0.16, (q[0] - p[0]) / L * 0.16)
            f = [(p[0] + n[0], p[1] + n[1]), (q[0] + n[0], q[1] + n[1]), (q[0] - n[0], q[1] - n[1]), (p[0] - n[0], p[1] - n[1])]
            m.face('plaster', (*f[1], g - 0.8), (*f[0], g - 0.8), (*f[0], za), (*f[1], zb))
            m.face('plaster', (*f[3], g - 0.8), (*f[2], g - 0.8), (*f[2], zb), (*f[3], za))
            m.face('iron', (*f[0], za + 0.06), (*f[1], zb + 0.06), (*f[2], zb + 0.06), (*f[3], za + 0.06))
            m.face('iron', (*f[0], za), (*f[1], zb), (*f[1], zb + 0.06), (*f[0], za + 0.06))
            m.face('iron', (*f[2], zb), (*f[3], za), (*f[3], za + 0.06), (*f[2], zb + 0.06))
        pier(sg * 8.75, 4.0, 0.38, 1.45, 0)
        # the iron: side leaf and a carriage leaf standing open inward is not evidenced, so both stand closed
        for u0, u1, h in ((4.07, 3.05, 1.75), (2.15, 0.03, 2.05)):
            a0, a1 = sorted((sg * u0, sg * u1))
            for z0_, z1_ in ((0.12, 0.17), (0.55, 0.6), (1.1, 1.14), (h - 0.35, h - 0.3)):
                m.box('iron', a0, a1, -0.025, 0.025, g + z0_, g + z1_, bottom=True)
            k = max(2, round((a1 - a0) / 0.16))
            for i in range(k + 1):
                u = a0 + (a1 - a0) * i / k
                rise = 0.45 * (1 - abs(u) / 2.15) if u0 < 2.5 else 0.0
                m.box('iron', u - 0.014, u + 0.014, -0.014, 0.014, g + 0.12, g + h + rise - 0.18)
                m.lathe('gold' if u0 < 2.5 else 'iron', u, 0, [(g + h + rise - 0.18, 0.026), (g + h + rise - 0.02, 0.004)], 4)
        # the railing onward from the end pier
        ends = ((sg * 9.15, 4.0), (sg * 14.6, 4.6))
        for z0_, z1_ in ((0.15, 0.2), (0.95, 1.0), (1.25, 1.29)):
            p, q = ends if sg > 0 else ends[::-1]
            m.face('iron', (*p, g + z0_), (*q, g + z0_), (*q, g + z1_), (*p, g + z1_))
        for i in range(37):
            u, v = ends[0][0] + (ends[1][0] - ends[0][0]) * i / 36, ends[0][1] + (ends[1][1] - ends[0][1]) * i / 36
            m.box('iron', u - 0.013, u + 0.013, v - 0.013, v + 0.013, g - 0.2, g + 1.45)
        pier(sg * 15.0, 4.65, 0.36, 1.5, 0)
    return m


# ------------------------------------------- the grounds' furniture (27 November, owner request:
# "the range needs all the assets and props", "flags and things around the clubhouse")

def merge(dst, src):
    """Append another frame's faces (already on the map) to this mesh."""
    for mat, (verts, faces) in src.parts.items():
        dv, df = dst.parts.setdefault(mat, ([], []))
        k = len(dv)
        dv.extend(verts)
        df.extend(tuple(k + i for i in f) for f in faces)
    return dst


def facing(fe, fn):
    """(ux, uy) for a Mesh whose v is the facing (fe, fn) and whose u is the right hand of someone facing it."""
    s = math.hypot(fe, fn)
    return fn / s, -fe / s


# Flags stand out toward the east, before Malardalen's prevailing westerly: one wind for them all, broadside to the
# 18th's approach and the terrace (a north-easterly fly showed them edge-on from both).
WIND = (1.0, 0.0)


def flag_cloth(m, top, length, height, colour_at, phase=0.0, segments=12, hoist=0.05):
    """A cloth flying out along u from a mast at the frame's origin, with a ripple that grows toward the fly and a
    slight droop. `colour_at(x, y)` names the material at a point of the cloth (x from the hoist, y from the foot, 0..1);
    its optional `xs` and `ys` are the seams the cloth must be cut along."""
    xs = sorted(set([i / segments for i in range(segments + 1)] + list(getattr(colour_at, 'xs', ()))))
    ys = sorted(set([0.0, 1.0] + list(getattr(colour_at, 'ys', ()))))

    def at(x, y):
        wave = 0.075 * length * x * math.sin(2 * math.pi * 1.3 * x + phase)
        return (hoist + x * length, wave, top - (1 - y) * height - 0.06 * length * x * x)
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            m.face(colour_at((x0 + x1) / 2, (y0 + y1) / 2), at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1))


def swedish(x, y):
    """The Swedish flag, 5:2:9 along and 4:2:4 across."""
    return 'flag_yellow' if 5 / 16 <= x < 7 / 16 or 0.4 <= y < 0.6 else 'flag_blue'


swedish.xs, swedish.ys = (5 / 16, 7 / 16), (0.4, 0.6)


def plain(mat):
    return lambda x, y: mat


_GLYPHS = {}


def glyphs(text):
    """The text's filled outline in Blender's built-in font, as triangles in its own plane: centred, one unit tall."""
    if text not in _GLYPHS:
        curve = bpy.data.curves.new('BroHofDigits', 'FONT')
        curve.body, curve.align_x, curve.align_y = text, 'CENTER', 'CENTER'
        obj = bpy.data.objects.new('BroHofDigits', curve)
        bpy.context.scene.collection.objects.link(obj)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = obj.evaluated_get(depsgraph)
        bm = bmesh.new()
        bm.from_mesh(evaluated.to_mesh())
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        tris = [tuple((v.co.x, v.co.y) for v in f.verts) for f in bm.faces]
        bm.free()
        evaluated.to_mesh_clear()
        bpy.data.objects.remove(obj)
        bpy.data.curves.remove(curve)
        ys = [p[1] for t in tris for p in t]
        tall, mid = max(ys) - min(ys), (max(ys) + min(ys)) / 2
        _GLYPHS[text] = [tuple((x / tall, (y - mid) / tall) for x, y in t) for t in tris]
    return _GLYPHS[text]


# The eight flagpoles round the sunken putting green south-west of the terrace, along the path below it and by the
# castle's south-east corner. The laser (Laserdata Skog 2020-11-06) holds every one: the tree pipeline took them for
# conifers 8.7-9.4 m tall with crowns 1.1-1.6 m across (review-2026-11-24, candidates.csv), and each stands where the
# 2025-06-14 photo has a pole's thin shadow with a flag at its end, on open lawn. So the poles stand at those records'
# positions and heights, and each one's part keeps a 1.2 m clearing (excludeVegetation); since tree round r1b the eight
# records are decided not-tree in the tree data too. The club's aerial photograph shows a Swedish flag on the pole by the path and white flags on
# the rest; whatever is printed on those is not drawn. (27 November, owner: "the flags are standing exactly where there
# are trees"; the first five poles were read off the photo, 1.0-1.5 m from these, and drew beside their own trees.)
FLAGPOLES = [
    ('a', 'tree-bro-hof-014041', (648586.3, 6598159.8), 9.4, 'white'),
    ('b', 'tree-bro-hof-014308', (648584.8, 6598140.8), 8.7, 'white'),
    ('c', 'tree-bro-hof-014011', (648589.8, 6598122.3), 9.3, 'white'),
    ('d', 'tree-bro-hof-014115', (648603.8, 6598108.3), 8.8, 'sweden'),
    ('e', 'tree-bro-hof-014034', (648618.8, 6598100.8), 9.3, 'white'),
    ('f', 'tree-bro-hof-014528', (648638.3, 6598100.8), 9.2, 'white'),
    ('g', 'tree-bro-hof-014012', (648655.3, 6598109.8), 9.0, 'white'),
    ('h', 'tree-bro-hof-014116', (648668.8, 6598123.3), 9.1, 'white'),
]
POLE_CLEARING = 1.2                             # metres round a pole's record in which no tree is drawn


def flagpole(k):
    _, _, (e, n), height, flag = FLAGPOLES[k]
    p, g = Mesh(e, n, *WIND), ground(e, n)
    p.lathe('pole', 0, 0, [(g - 0.3, 0.075), (g + 0.05, 0.075), (g + height, 0.045)], 10)
    p.lathe('gold', 0, 0, [(g + height - 0.01, 0.0), (g + height + 0.03, 0.065), (g + height + 0.1, 0.075),
                           (g + height + 0.17, 0.05), (g + height + 0.2, 0.0)], 10, cap=False)
    length = height / 4                         # the Swedish rule of thumb: a flag a quarter of its pole
    flag_cloth(p, g + height - 0.12, length, length * 10 / 16, swedish if flag == 'sweden' else plain('flag_white'), phase=1.7 * k)
    return p


# The terrace's six square parasols, white on the 2025 photo, square to the castle; the tables under them are not seen.
PARASOLS = [(648623.9, 6598156.0), (648628.7, 6598152.9), (648624.5, 6598150.0), (648633.8, 6598151.5),
            (648638.3, 6598149.7), (648642.2, 6598147.0)]
TERRACE_FLOOR = 15.1


def parasols():
    m = Mesh(*PARASOLS[0], 1, 0)
    z = TERRACE_FLOOR
    for e, n in PARASOLS:
        p = Mesh(e, n, math.cos(AXIS), math.sin(AXIS))
        h, eave, apex = 1.95, z + 2.3, z + 3.0
        p.lathe('pole', 0, 0, [(z, 0.03), (z + 3.05, 0.025)], 8)
        corners = [(-h, -h), (h, -h), (h, h), (-h, h)]
        for (a, b), (c, d) in zip(corners, corners[1:] + corners[:1]):
            p.face('canvas', (a, b, eave), (c, d, eave), (0, 0, apex))
            p.face('canvas', (a, b, eave - 0.18), (c, d, eave - 0.18), (c, d, eave), (a, b, eave))
        p.lathe('pole', 0, 0, [(z, 0.25), (z + 0.03, 0.2), (z + 0.1, 0.04), (z + 0.72, 0.04)], 8, cap=False)
        p.lathe('flag_white', 0, 0, [(z + 0.72, 0.45), (z + 0.76, 0.45)], 14)
        merge(m, p)
    return m


# The practice surfaces as the course model traces them (brohofbuild/course-model.json, the app's own frame: x east of
# the origin, z south of it). The engine draws them as turf and nothing on them, so their flags are here.
MODEL = json.loads((Path(__file__).resolve().parents[1] / 'course-model.json').read_text(encoding='utf-8'))


def model_rings(kind):
    """Every traced ring of `kind`, by id, on the map (easting, northing)."""
    found = {}

    def walk(o):
        if isinstance(o, dict):
            if o.get('kind') == kind and o.get('rings') and o.get('id'):
                found[o['id']] = [(ORIGIN[0] + x, ORIGIN[1] - z) for x, z in o['rings'][0]]
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(MODEL)
    return dict(sorted(found.items()))


def ring_inside(p, ring):
    inside = False
    for i in range(len(ring)):
        (x0, y0), (x1, y1) = ring[i - 1], ring[i]
        if (y0 > p[1]) != (y1 > p[1]) and p[0] < x0 + (p[1] - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def ring_centroid(ring):
    a = cx = cy = 0.0
    for i in range(len(ring)):
        (x0, y0), (x1, y1) = ring[i - 1], ring[i]
        c = x0 * y1 - x1 * y0
        a, cx, cy = a + c, cx + (x0 + x1) * c, cy + (y0 + y1) * c
    return (cx / (3 * a), cy / (3 * a))


def cups(ring, count, spread=0.5):
    """`count` spots along the ring's long axis, staggered across it, each kept inside (else the centroid)."""
    c = ring_centroid(ring)
    pts = np.array(ring) - c
    _, vectors = np.linalg.eigh(pts.T @ pts)
    major, minor = vectors[:, 1], vectors[:, 0]
    along, across = np.abs(pts @ major).max(), np.abs(pts @ minor).max()
    out = []
    for k in range(count):
        t = 0.0 if count == 1 else spread * (2 * k / (count - 1) - 1)
        s = 0.25 * (1 if k % 2 else -1) if count > 1 else 0.0
        p = (c[0] + major[0] * t * along + minor[0] * s * across, c[1] + major[1] * t * along + minor[1] * s * across)
        out.append(p if ring_inside(p, ring) else c)
    return out


def spread_cups(ring, count, clearance=2.0):
    """`count` spots spread over a large green (farthest-point sampling on a 1 m grid, kept off the edge)."""
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    grid = [(x + 0.5, y + 0.5) for x in range(int(min(xs)), int(max(xs))) for y in range(int(min(ys)), int(max(ys)))]
    edge = lambda p: min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in ring[::2])
    grid = [p for p in grid if ring_inside(p, ring) and edge(p) > clearance]
    chosen = [min(grid, key=lambda p: math.hypot(p[0] - ring_centroid(ring)[0], p[1] - ring_centroid(ring)[1]))]
    far = [math.hypot(p[0] - chosen[0][0], p[1] - chosen[0][1]) for p in grid]
    while len(chosen) < count:
        i = max(range(len(grid)), key=far.__getitem__)
        chosen.append(grid[i])
        far = [min(f, math.hypot(p[0] - grid[i][0], p[1] - grid[i][1])) for f, p in zip(far, grid)]
    return chosen


PUTTING_GREENS = ['practice-green-castle-west', 'practice-green-castle-south', 'practice-green-first-tee',
                  'practice-green-castle-first-tee', 'practice-green-range']
SHORT_GAME_GREENS = ['practice-green-short-a', 'practice-green-short-b', 'practice-green-short-c', 'practice-green-short-d']
PUTTING_COURSE = 'putting-course'


def short_flag(m, e, n, phase):
    p, g = Mesh(e, n, *WIND), ground(e, n)
    p.lathe('pole', 0, 0, [(g - 0.05, 0.009), (g + 0.76, 0.009)], 6)
    flag_cloth(p, g + 0.75, 0.3, 0.2, plain('flag_yellow'), phase=phase, segments=4, hoist=0.009)
    merge(m, p)


def practice_flags():
    """Short flags on the putting greens (three a green) and the putting course (its 18), a full pin on the short-game
    greens (two a green). No photo resolves a cup: the spots are placed on the traced greens."""
    greens = model_rings('practice_green')
    m = Mesh(*ring_centroid(greens[PUTTING_GREENS[0]]), 1, 0)
    k = 0
    for gid in PUTTING_GREENS:
        for e, n in cups(greens[gid], 3):
            short_flag(m, e, n, k)
            k += 1
    for e, n in spread_cups(greens[PUTTING_COURSE], 18):
        short_flag(m, e, n, k)
        k += 1
    for gid in SHORT_GAME_GREENS:
        for e, n in cups(greens[gid], 2, spread=0.35):
            p, g = Mesh(e, n, *WIND), ground(e, n)
            p.lathe('pole', 0, 0, [(g - 0.1, 0.012), (g + 2.13, 0.012)], 6)
            flag_cloth(p, g + 2.1, 0.5, 0.36, plain('flag_red'), phase=k, segments=6, hoist=0.012)
            merge(m, p)
            k += 1
    return m


# THE RANGE. Its year-round tee is a strip of artificial turf along the path (both photos, 2021-04-16 and 2025-06-14),
# with a ball pile at every bay; the grass tee west of it is used in summer, and the 2025 photo has golfers along its
# north edge. The strip's ends are read off the photo; its 30 bays at 3 m are counted on the 2021 photo, where the
# piles show best.
MAT_LINE = ((648380.0, 6598114.8), (648449.7, 6598176.0))
MAT_MIDDLE = ((MAT_LINE[0][0] + MAT_LINE[1][0]) / 2, (MAT_LINE[0][1] + MAT_LINE[1][1]) / 2)
BAYS, BAY_PITCH = 30, 3.0
DISPENSER = (648446.0, 6598181.0)


def range_mats():
    (e0, n0), (e1, n1) = MAT_LINE
    length = math.hypot(e1 - e0, n1 - n0)
    te, tn = (e1 - e0) / length, (n1 - n0) / length
    m = Mesh(e0, n0, te, tn)                    # u along the line, v toward the field (north-west)
    at = lambda u, v: ground(e0 + u * te - v * tn, n0 + u * tn + v * te)
    back, front, lift = -1.5, 1.7, 0.04
    stations = [length * i / 31 for i in range(32)]
    for u0, u1 in zip(stations, stations[1:]):
        a, b, c, d = (u0, back), (u1, back), (u1, front), (u0, front)
        m.face('turf_strip', *[(u, v, at(u, v) + lift) for u, v in (a, b, c, d)])
        for p, q in ((d, c), (b, a)):           # its front and back edges, down into the ground
            m.face('turf_strip', (*p, at(*p) - 0.1), (*q, at(*q) - 0.1), (*q, at(*q) + lift), (*p, at(*p) + lift))
    start = (length - (BAYS - 1) * BAY_PITCH) / 2
    for k in range(BAYS):
        u = start + k * BAY_PITCH
        z = at(u, 0.4) + lift
        m.box('turf_mat', u - 0.75, u + 0.75, -0.35, 1.15, z, z + 0.025)
        m.lathe('ball', u - 0.55, -0.8, [(z, 0.24), (z + 0.08, 0.2), (z + 0.13, 0.12), (z + 0.155, 0.0)], 8)
        if k % 4 == 1:                          # a bag on its stand in some of the bays
            m.lathe('bag', u + 0.6, -1.15, [(z, 0.11), (z + 0.82, 0.13), (z + 0.92, 0.09)], 8)
    d = Mesh(*DISPENSER, *facing(tn, -te))     # its front to the path, south-east
    g = ground(*DISPENSER)
    d.box('dispenser', -0.55, 0.55, -0.4, 0.4, g - 0.2, g + 1.85)
    d.box('pole', -0.32, 0.32, 0.4, 0.43, g + 0.95, g + 1.45)
    d.box('iron', -0.12, 0.12, 0.4, 0.62, g + 0.62, g + 0.7)
    d.box('slate', -0.62, 0.62, -0.47, 0.47, g + 1.85, g + 1.95)
    return merge(m, d)


GRASS_LINE = ((648331.0, 6598117.5), (648364.0, 6598117.5))


def range_grass_tee():
    """The summer tee: a ball pile at each station along the 2025 photo's line of golfers, and a rope on stakes in front."""
    (e0, n0), (e1, n1) = GRASS_LINE
    m = Mesh(e0, n0, 1, 0)                      # u east, v north toward the field
    stations = int(round((e1 - e0) / BAY_PITCH))
    for k in range(stations + 1):
        u = k * BAY_PITCH
        g = ground(e0 + u, n0)
        if k < stations:
            m.lathe('ball', u + 1.0, -0.6, [(g, 0.24), (g + 0.08, 0.2), (g + 0.13, 0.12), (g + 0.155, 0.0)], 8)
            if k % 3 == 0:
                m.lathe('bag', u + 2.1, -1.0, [(g, 0.11), (g + 0.82, 0.13), (g + 0.92, 0.09)], 8)
        gs = ground(e0 + u, n0 + 1.6)
        m.box('pole', u - 0.025, u + 0.025, 1.575, 1.625, gs - 0.15, gs + 0.55)
        if k < stations:
            gn = ground(e0 + u + BAY_PITCH, n0 + 1.6)
            m.face('flag_yellow', (u, 1.6, gs + 0.46), (u + BAY_PITCH, 1.6, gn + 0.46), (u + BAY_PITCH, 1.6, gn + 0.49), (u, 1.6, gs + 0.49))
    return m


# The range's five target greens as traced (their centroids); the four greens with bunkers on the field's east side are
# the short-game area's, flagged with the practice greens. Each target has a flag and a board with its distance in metres
# from the middle of the mat line, rounded to 5 m: the club's own boards are in no source.
RANGE_TARGETS = [ring_centroid(r) for r in model_rings('range_target_surface').values()]
TARGET_FLAGS = ['flag_red', 'flag_white', 'flag_yellow', 'flag_blue']


def target_distance(e, n):
    return int(5 * round(math.hypot(e - MAT_MIDDLE[0], n - MAT_MIDDLE[1]) / 5))


def range_targets():
    m = Mesh(*RANGE_TARGETS[0], 1, 0)
    for k, (e, n) in enumerate(sorted(RANGE_TARGETS, key=lambda p: target_distance(*p))):
        p, g = Mesh(e, n, *WIND), ground(e, n)
        p.lathe('pole', 0, 0, [(g - 0.1, 0.02), (g + 2.6, 0.017)], 6)
        flag_cloth(p, g + 2.58, 0.75, 0.5, plain(TARGET_FLAGS[k % len(TARGET_FLAGS)]), phase=0.9 * k, segments=6, hoist=0.02)
        merge(m, p)
        # the board, six metres short of the flag toward the mats and two to its right, facing the mats
        de, dn = MAT_MIDDLE[0] - e, MAT_MIDDLE[1] - n
        s = math.hypot(de, dn)
        de, dn = de / s, dn / s
        be, bn = e + 6 * de + 2 * dn, n + 6 * dn - 2 * de
        b, gb = Mesh(be, bn, *facing(de, dn)), ground(be, bn)
        for side in (-0.6, 0.6):
            b.box('timber', side - 0.04, side + 0.04, -0.04, 0.04, gb - 0.3, gb + 1.8)
        b.box('sign_green', -0.85, 0.85, -0.03, 0.03, gb + 0.9, gb + 1.78)
        for tri in glyphs(str(target_distance(e, n))):
            # read from in front: the reader's right is the board's -u
            b.face('flag_white', *[(-x * 0.62, 0.034, gb + 1.34 + y * 0.62) for x, y in tri])
        merge(m, b)
    return m


_world = lambda origin, axis, pts:[(origin[0] + u * math.cos(axis) - v * math.sin(axis), origin[1] + u * math.sin(axis) + v * math.cos(axis)) for u, v in pts]
CASTLE = (648636.91, 6598165.06)
CASTLE_UV = [(-19.79, 6.2), (-3.75, 6.2), (-3.75, 10.05), (4.0, 10.05), (4.0, 6.62), (19.79, 6.62), (19.79, -7.81), (14.15, -7.82), (14.15, -8.82), (4.2, -8.82), (4.2, -9.78), (-4.2, -9.78), (-4.2, -8.82), (-14.15, -8.82), (-14.15, -7.86), (-19.79, -7.86)]
TERRACE_UV = [(-14.6, -8.8), (-14.6, -12.4), (-19.9, -12.4), (-19.9, -19.2), (-14.6, -19.2), (-14.6, -21.0), (-4.4, -21.0), (-4.4, -27.9), (1.9, -27.9), (1.9, -21.0), (13.9, -21.0), (13.9, -19.6), (17.5, -19.6), (17.5, -12.4), (13.9, -12.4), (13.9, -8.8)]
HALF_AXIS = math.atan2(2.0, 10.4)
_circle = lambda c, r, n=24: [(c[0] + r * math.cos(2 * math.pi * k / n), c[1] + r * math.sin(2 * math.pi * k / n)) for k in range(n)]

FACILITIES = [
    dict(id='castle', node='BroHof-Castle', build=castle, sources=['w319035128'], anchor=(648640.5, 6598178.5), footprint=_world(CASTLE, AXIS, CASTLE_UV),
         evidence=dict(levels='Laserdata Skog 2020-11-06: courtyard 13.7, eaves 24.3, mansard break 27.9, ridge 29, wings 19.5, dome top 38.9', facade='Wikimedia Commons Bro Hof Slott Entre.jpg (CC BY-SA 4.0, reference only), north side; the south side repeats it')),
    dict(id='castle-terrace', node='BroHof-Terrace', build=terrace, sources=[], anchor=(648620.0, 6598137.0), footprint=_world(CASTLE, AXIS, TERRACE_UV),
         evidence=dict(levels='Laserdata Skog: floor 15.1, lawn 11.3, side rooms 14.6', plan='orthophoto 2025-06-14', balustrade='estimated')),
    dict(id='pavilion', node='BroHof-Pavilion', build=pavilion, sources=[], anchor=(648660.4, 6598065.0), footprint=_circle((648660.4, 6598065.0), 4.1),
         evidence=dict(plan='orthophoto 2025-06-14', height='its shadow; built after the laser')),
    dict(id='halfway-stadium', node='BroHof-HalfwayStadium', build=halfway_stadium, sources=['w1235353673'], anchor=(649263.0, 6598518.0),
         footprint=[(649257.0, 6598516.9), (649265.0, 6598515.4), (649269.9, 6598515.3), (649270.7, 6598522.9), (649270.9, 6598526.6), (649268.1, 6598530.9), (649261.9, 6598531.7), (649258.1, 6598528.4), (649257.8, 6598524.8)],
         evidence=dict(levels='Laserdata Skog: ground 6.3, roof 11.7', plan='OSM octagon and orthophoto 2025-06-14', walls='estimated')),
    dict(id='halfway-stadium-walls', node='BroHof-HalfwayStadiumWalls', build=halfway_stadium_walls, sources=[], anchor=(649250.0, 6598522.0), plants=True,
         evidence=dict(plan='orthophoto 2025-06-14', height='their shadows')),
    dict(id='halfway-castle', node='BroHof-HalfwayCastle', build=halfway_castle, sources=['ortho-halfway-house-castle'], anchor=(649248.2, 6599258.6),
         footprint=_world((649248.3, 6599259.1), HALF_AXIS, [(-4.9, -9.45), (6.0, -9.45), (6.0, 4.75), (-4.9, 4.75)]), evidence=dict(plan='orthophoto 2025-06-14', walls='estimated')),
    dict(id='halfway-castle-garden', node='BroHof-HalfwayCastleGarden', build=halfway_castle_garden, sources=[], anchor=(649249.0, 6599248.8), plants=True,
         evidence=dict(plan='orthophoto 2025-06-14', height='estimated')),
    dict(id='courtyard', node='BroHof-Courtyard', build=courtyard, sources=[], anchor=C0, plants=True,
         evidence=dict(plan='orthophoto 2025-06-14', height='estimated from the entrance photo')),
    dict(id='avenue-gate', node='BroHof-Gate', build=gate, sources=[], anchor=(648741.95, 6598396.25), plants=True,
         evidence=dict(plan='orthophoto 2025-06-14', order='Wikimedia Commons Bro Hof Slott Entre.jpg (CC BY-SA 4.0, reference only)')),
    *[dict(id=f'flagpole-{letter}', node=f'BroHof-Flagpole-{letter.upper()}', build=(lambda k=k: flagpole(k)), sources=[], anchor=at,
           footprint=_circle(at, POLE_CLEARING, 12),
           evidence=dict(position=f'Laserdata Skog 2020-11-06: {record}, which the tree pipeline took for a conifer', height=f'{height} m, the same record',
                         photo='orthophoto 2025-06-14: a pole shadow with a flag at its end, on open lawn',
                         flag='the club aerial photograph (Wikimedia Commons, reference only): a Swedish flag by the path, white on the rest; prints not drawn',
                         clears=f'{record}: no tree is drawn within {POLE_CLEARING} m of the pole'))
      for k, (letter, record, at, height, flag) in enumerate(FLAGPOLES)],
    dict(id='terrace-parasols', node='BroHof-TerraceParasols', build=parasols, sources=[], anchor=(648632.0, 6598151.5), plants=True,
         evidence=dict(position='orthophoto 2025-06-14', size='orthophoto', height='estimated', tables='estimated')),
    dict(id='practice-green-flags', node='BroHof-PracticeGreenFlags', build=practice_flags, sources=[], anchor=(648620.0, 6598118.0), plants=True,
         evidence=dict(greens='the course model: five putting greens, the putting course and the four short-game greens',
                       cups='placed on the traced greens: no photo resolves a cup; the putting course has 18 numbered flags (club page), their numbers not drawn')),
    dict(id='range-mat-line', node='BroHof-RangeMatLine', build=range_mats, sources=[], anchor=MAT_MIDDLE, plants=True,
         evidence=dict(line='orthophoto 2021-04-16 and 2025-06-14: the artificial-turf strip and a ball pile at each bay', bays='30 at 3 m, counted on the 2021 photo',
                       dispenser='orthophoto 2025-06-14, its form estimated', bags='estimated')),
    dict(id='range-grass-tee', node='BroHof-RangeGrassTee', build=range_grass_tee, sources=[], anchor=(648347.5, 6598117.5), plants=True,
         evidence=dict(line='orthophoto 2025-06-14: the golfers along the grass tee', rope='estimated')),
    dict(id='range-targets', node='BroHof-RangeTargets', build=range_targets, sources=[], anchor=(648330.0, 6598290.0), plants=True,
         evidence=dict(greens='the five traced target greens (course model)', flags='estimated',
                       distances='metres from the middle of the mat line, rounded to 5 m; the club boards are in no source')),
]


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    scene = bpy.data.scenes.new('BanvyBroHofCampus')
    col = bpy.data.collections.new('BroHof')
    scene.collection.children.link(col)
    for name, (rgb, rough) in MATERIALS.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = 0.0
        mat.use_backface_culling = False
    records = []
    for spec in FACILITIES:
        mesh = spec['build']()
        obj = mesh.build(spec['node'], col)
        obj['facilityId'] = spec['id']
        obj['sourceBuildingIds'] = spec['sources']
        pts = [v for verts, _ in mesh.parts.values() for v in verts]
        lo = [min(p[k] for p in pts) for k in range(3)]
        hi = [max(p[k] for p in pts) for k in range(3)]
        tris = sum(len(f) - 2 for _, faces in mesh.parts.values() for f in faces)
        # what keeps its plants (hedges, walls, the gate) is only bounded; a building states its own plan
        plan = spec.get('footprint') or [(ORIGIN[0] + x, ORIGIN[1] + y) for x, y in ((lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1]))]
        records.append(dict(id=spec['id'], nodeName=spec['node'], sourceBuildingIds=spec['sources'],
                            footprintLocal=[[round(e - ORIGIN[0], 2), round(ORIGIN[1] - n, 2)] for e, n in plan],
                            groundAnchorLocal=[round(spec['anchor'][0] - ORIGIN[0], 2), round(ORIGIN[1] - spec['anchor'][1], 2)],
                            groundAnchorRh2000M=round(ground(*spec['anchor']), 2), placement='absolute-rh2000',
                            boundsLocalRh2000=dict(min=[round(lo[0], 3), round(lo[2], 3), round(-hi[1], 3)], max=[round(hi[0], 3), round(hi[2], 3), round(-lo[1], 3)]),
                            excludeVegetation=not spec.get('plants', False), triangles=tris, evidence=spec['evidence']))
        print(spec['id'], 'triangles', tris)
    glb = args.out / 'facilities.glb'
    win = bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None
    if win:
        win.scene = scene
    with bpy.context.temp_override(scene=scene):
        bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_active_scene=True, export_yup=True, export_apply=False,
                                  export_texcoords=False, export_normals=True, export_tangents=False, export_materials='EXPORT',
                                  export_animations=False, export_skins=False, export_morph=False, export_lights=False, export_cameras=False,
                                  export_extras=True)
    data = glb.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    manifest = dict(schemaVersion=1, groundId='bro-hof', courseSlugs=['bro-hof-stadium', 'bro-hof-castle'],
                    coordinateFrame=dict(kind='epsg3006-local-rh2000', originEasting=ORIGIN[0], originNorthing=ORIGIN[1], axes='east-up-south', heightDatum='RH2000'),
                    asset=dict(url=f'models/bro-hof/facilities-{digest}.glb', sha256=digest, bytes=len(data)),
                    replacesRangeFacilities=False, replacesCourtyard=False, facilities=records)
    (args.out / 'facilities-v1.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf-8', newline='\n')
    print('glb', len(data), digest, 'triangles', sum(r['triangles'] for r in records))


if __name__ == '__main__':
    main()
