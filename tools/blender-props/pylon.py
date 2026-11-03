"""A steel lattice pylon for the 130 kV lines (3 November, owner request: "fix the
power grids and lines").

Run in Blender 5.x through the Blender MCP. Built with the data API in a scene of
its own ("BanvyPylon"): it touches no other scene or object in the file, and exports
only that scene. One GLB with two meshes:

- `pylon_body`: the galvanised lattice -- four tapering corner legs (3.2 m apart at
  the foot, 0.9 m at the 22 m peak), K-bracing on every face in seven panels, a
  latticed crossarm 7.6 m wide at 20.3 m, and a peak to 23.2 m; light grey,
  darker low down;
- `pylon_trim`: the insulator strings -- one down from each arm end to 19.5 m
  (the outer phases, 3.2 m out) and one from the peak to 22.4 m (the middle
  phase), in brown glazed porcelain.

Axes: Blender X across the line (the crossarm), Y along it, Z up, the foot at
z = 0; the glTF exporter writes X across, Y up, Z along. The wires attach at
(+-3.2, 19.5) and (0, 22.4).
"""
import math
import os

import bpy

OUT = os.environ.get('BANVY_PROP_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'pylon.glb')
SCENE = 'BanvyPylon'

HEIGHT, BASE, TOP = 22.0, 1.6, 0.45      # the shaft: half-widths at the foot and the top
PANELS = 7
LEG, BRACE = 0.11, 0.06                  # member widths, metres
ARM_Z, ARM_HALF = 20.3, 3.8
PEAK = 23.2
PHASES = [(-3.2, 19.5), (3.2, 19.5), (0.0, 22.4)]
STEEL, STEEL_LOW = (0.64, 0.66, 0.68), (0.52, 0.54, 0.56)
PORCELAIN = (0.36, 0.22, 0.14)


def half_width(z):
    return BASE + (TOP - BASE) * min(1.0, z / HEIGHT)


class Builder:
    def __init__(self):
        self.verts, self.faces, self.colours = [], [], []

    def beam(self, a, b, width, colour):
        """A square member from a to b, `width` across."""
        ax, ay, az = a
        dx, dy, dz = b[0] - ax, b[1] - ay, b[2] - az
        length = math.sqrt(dx * dx + dy * dy + dz * dz) or 1e-6
        t = (dx / length, dy / length, dz / length)
        up = (0.0, 0.0, 1.0) if abs(t[2]) < 0.9 else (1.0, 0.0, 0.0)
        u = (t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0])
        ul = math.sqrt(sum(c * c for c in u)); u = tuple(c / ul for c in u)
        v = (t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0])
        h = width / 2
        base = len(self.verts)
        for end in (a, b):
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = tuple(end[i] + u[i] * su * h + v[i] * sv * h for i in range(3))
                self.verts.append(p)
                shade = STEEL_LOW if p[2] < 4 else colour
                k = min(1.0, max(0.0, p[2] / 8))
                self.colours.append(tuple(STEEL_LOW[i] + (colour[i] - STEEL_LOW[i]) * k for i in range(3)) + (1.0,) if colour is STEEL else tuple(colour) + (1.0,))
        for i in range(4):
            j = (i + 1) % 4
            self.faces.append((base + i, base + j, base + 4 + j, base + 4 + i))
        self.faces.append((base + 3, base + 2, base + 1, base + 0))
        self.faces.append((base + 4, base + 5, base + 6, base + 7))

    def disc_stack(self, top, bottom, radius, colour, discs=6):
        """An insulator string: a rod with porcelain sheds."""
        self.beam(top, bottom, 0.035, colour)
        for k in range(discs):
            z = top[2] + (bottom[2] - top[2]) * (k + 0.5) / discs
            self.beam((top[0], top[1], z + 0.03), (top[0], top[1], z - 0.03), radius * 2, colour)


def body():
    b = Builder()
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    levels = [HEIGHT * i / PANELS for i in range(PANELS + 1)]
    def corner(c, z):
        w = half_width(z)
        return (c[0] * w, c[1] * w, z)
    # the four legs, panel by panel
    for c in corners:
        for z0, z1 in zip(levels, levels[1:]):
            b.beam(corner(c, z0), corner(c, z1), LEG, STEEL)
    # every face: a horizontal at each level and a K (two diagonals to the middle of the panel above)
    for f in range(4):
        c0, c1 = corners[f], corners[(f + 1) % 4]
        for z0, z1 in zip(levels, levels[1:]):
            a0, a1 = corner(c0, z0), corner(c1, z0)
            b0, b1 = corner(c0, z1), corner(c1, z1)
            b.beam(a0, a1, BRACE, STEEL)
            mid = tuple((b0[i] + b1[i]) / 2 for i in range(3))
            b.beam(a0, mid, BRACE, STEEL)
            b.beam(a1, mid, BRACE, STEEL)
        top0, top1 = corner(c0, HEIGHT), corner(c1, HEIGHT)
        b.beam(top0, top1, BRACE, STEEL)
    # the crossarm: two chords each side, latticed, out to the phases
    w = half_width(ARM_Z)
    for side in (-1, 1):
        root_lo, root_hi = (side * w, 0, ARM_Z - 0.6), (side * w, 0, ARM_Z + 0.2)
        tip = (side * ARM_HALF, 0, ARM_Z)
        for y in (-0.35, 0.35):
            b.beam((root_lo[0], y, root_lo[2]), (tip[0], y * 0.3, tip[2]), BRACE * 1.3, STEEL)
            b.beam((root_hi[0], y, root_hi[2]), (tip[0], y * 0.3, tip[2]), BRACE * 1.3, STEEL)
        for k in range(1, 4):
            t = k / 4
            x = side * (w + (ARM_HALF - w) * t)
            b.beam((x, -0.35 * (1 - 0.7 * t), ARM_Z - 0.6 * (1 - t)), (x, 0.35 * (1 - 0.7 * t), ARM_Z + 0.2 * (1 - t)), BRACE, STEEL)
    # the peak: the legs drawn in to a point above the shaft, for the middle phase
    for c in corners:
        b.beam(corner(c, HEIGHT), (0, 0, PEAK), LEG * 0.9, STEEL)
    return b


def trim():
    b = Builder()
    for x, z in PHASES:
        top = (x, 0, ARM_Z) if z < 21 else (0, 0, PEAK - 0.1)
        b.disc_stack(top, (x, 0, z), 0.13, PORCELAIN)
    return b


def make_object(sc, name, builder):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(builder.verts, [], builder.faces)
    mesh.validate()
    attr = mesh.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for i, c in enumerate(builder.colours):
        attr.data[i].color = c
    mesh.color_attributes.active_color = attr
    for poly in mesh.polygons:
        poly.use_smooth = False
    ob = bpy.data.objects.new(name, mesh)
    sc.collection.objects.link(ob)
    return ob


def build():
    old = bpy.data.scenes.get(SCENE)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(SCENE)
    objects = [make_object(sc, 'pylon_body', body()), make_object(sc, 'pylon_trim', trim())]
    return sc, objects


def export(sc, objects):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    layer = sc.view_layers[0]
    for ob in objects:
        ob.select_set(True, view_layer=layer)
    with bpy.context.temp_override(scene=sc, view_layer=layer):
        bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, use_active_scene=True,
                                  export_apply=True, export_vertex_color='ACTIVE', export_materials='NONE',
                                  export_yup=True, export_normals=True, export_texcoords=False)
    return OUT


def triangles(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


if __name__ == '__main__':
    sc, objects = build()
    print({'glb': export(sc, objects), 'tris': {ob.name: triangles(ob) for ob in objects}})
