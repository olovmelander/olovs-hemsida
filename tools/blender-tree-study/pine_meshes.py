"""Fixed-size mesh builder. Reuses the original pine's seeded branch layout.
No subdivision, remeshing or decimation operators; topology has hard budgets.
"""
import ast, math, random
from types import SimpleNamespace
from pathlib import Path
import bpy
from mathutils import Vector

BUDGET = {'hero': 4500, 'full': 1700, 'lite': 420}

def clamp(x):
    return max(0., min(1., x))

def linear(value):
    rgb = [(value >> s & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in rgb)

def material(name, colour, vertex=True):
    m = bpy.data.materials.new(name); m.use_nodes = True; m.diffuse_color = (*colour, 1)
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*colour, 1)
    bs.inputs['Roughness'].default_value = .96; bs.inputs['Specular IOR Level'].default_value = .1
    if vertex:
        vc = m.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Paint'
        mix = m.node_tree.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1; mix.inputs[2].default_value = (*colour, 1)
        m.node_tree.links.new(vc.outputs['Color'], mix.inputs[1]); m.node_tree.links.new(mix.outputs[0], bs.inputs['Base Color'])
    return m

class Mesh:
    def __init__(self):
        self.positions, self.normals, self.colours, self.faces = [], [], [], []

    def vert(self, p, n, c):
        assert len(self.positions) < 7000
        self.positions.append(tuple(p)); self.normals.append(tuple(n)); self.colours.append((*c, 1))
        return len(self.positions) - 1

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def object(self, name, mat, collection):
        assert all(math.isfinite(v) for p in self.positions for v in p)
        me = bpy.data.meshes.new(name); me.from_pydata(self.positions, [], self.faces); me.update()
        for p in me.polygons:
            p.use_smooth = True
        me.normals_split_custom_set_from_vertices(self.normals)
        attr = me.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='POINT')
        for d, colour in zip(attr.data, self.colours):
            d.color = colour
        me.color_attributes.active_color = attr; me.materials.append(mat)
        ob = bpy.data.objects.new(name, me); collection.objects.link(ob)
        return ob

def layout(seed):
    branches, clumps, pads = [], [], []
    def tube(_mesh, a, b, r0, r1, segments=8):
        branches.append((a.copy(), b.copy(), r0, r1)); assert len(branches) < 160
    def clump(_mesh, c, rx, ry, rz, seed, sub=2, amp=.1, undercut=.7):
        clumps.append((c.copy(), (rx, ry, rz), seed, undercut)); assert len(clumps) < 100
    def finish(_object, centres, *_args):
        pads.extend(centres)
    source = Path(__file__).with_name('ghibli_catalog.py').read_text(encoding='utf-8')
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'pine')
    ns = dict(math=math, random=random, Vector=Vector, U=lambda rng, a, b: rng.uniform(a, b),
              bmesh=SimpleNamespace(new=lambda: None), tube=tube, clump=clump,
              new_obj=lambda *args, **kwargs: None, finish_crown=finish,
              M={'pine': None, 'pinebark': None, 'bark': None})
    exec(compile(ast.Module(body=[node], type_ignores=[]), 'original-pine-layout', 'exec'), ns)
    _, _, height = ns['pine']((0, 0, 0), seed, {'height': (14, 24), 'crown_from': (.5, .66)})
    return height, branches, clumps, pads

def foliage(mesh, centre, radii, seed, undercut, pad, tier):
    segs, rings = {'hero': (8, 4), 'full': (5, 3), 'lite': (5, 3)}[tier]
    rx, ry, rz = radii
    phase = (seed * .6180339887 % 1) * math.tau
    def point(lat, az):
        co, si = math.cos(lat), math.sin(lat)
        n = Vector((co * math.cos(az), co * math.sin(az), si))
        scallop = 1 + .065 * math.sin(az * 3 + phase) * co * co
        p = centre + Vector((n.x * rx * scallop, n.y * ry * scallop,
                              n.z * rz * (1 if n.z >= 0 else max(.55, undercut))))
        local = Vector((n.x, n.y, n.z * 1.1)).normalized()
        group = Vector(((p.x - pad.x) / rx, (p.y - pad.y) / ry, (p.z - pad.z) / max(rz, .1))).normalized()
        normal = (local * .75 + group * .25).normalized()
        exposure = clamp(.5 + n.z * .5)
        pigment = .85 + .12 * exposure + .035 * math.sin(az * 3 + phase) * co
        colour = (pigment * (.97 + .06 * exposure), pigment, pigment * (1.03 - .12 * exposure))
        return mesh.vert(p, normal, colour)
    bottom, top = point(-math.pi / 2, 0), point(math.pi / 2, 0)
    rows = [[point(-math.pi / 2 + math.pi * j / rings, math.tau * k / segs)
             for k in range(segs)] for j in range(1, rings)]
    for k in range(segs):
        n = (k + 1) % segs
        mesh.faces.extend([(bottom, rows[0][n], rows[0][k]), (top, rows[-1][k], rows[-1][n])])
    for a, b in zip(rows, rows[1:]):
        for k in range(segs):
            n = (k + 1) % segs; mesh.faces.append((a[k], a[n], b[n], b[k]))

def bark(p, height, theta):
    f = clamp((p.z / height - .28) / .45); f = f * f * (3 - 2 * f)
    low, high = linear(0x77654f), linear(0xb57c52)
    grain = .97 + .03 * math.sin(theta * 7 + p.z * .45)
    return tuple((a + (b - a) * f) * grain for a, b in zip(low, high))

def tube_mesh(mesh, centres, radii, height, sides, flare=False):
    rows = []
    for i, (p, radius) in enumerate(zip(centres, radii)):
        tangent = (centres[min(i + 1, len(centres) - 1)] - centres[max(i - 1, 0)]).normalized()
        ref = Vector((0, 1, 0)) if abs(tangent.y) < .9 else Vector((1, 0, 0))
        u = tangent.cross(ref).normalized(); v = tangent.cross(u).normalized()
        if flare:
            radius *= 1 + .34 * math.exp(-max(0, p.z) / .36)
        row = []
        for j in range(sides):
            theta = math.tau * j / sides
            n = u * math.cos(theta) + v * math.sin(theta); q = p + n * radius
            row.append(mesh.vert(q, n, bark(q, height, theta)))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for j in range(sides):
            n = (j + 1) % sides; mesh.faces.append((a[j], a[n], b[n], b[j]))
    mesh.faces.extend([tuple(reversed(rows[0])), tuple(rows[-1])])

def catmull(points, steps):
    result = []
    for i in range(len(points) - 1):
        a, b, c, d = points[max(0, i - 1)], points[i], points[i + 1], points[min(len(points) - 1, i + 2)]
        for j in range(steps):
            t = j / steps
            result.append((b * 2 + (c - a) * t + (a * 2 - b * 5 + c * 4 - d) * t * t
                           + (-a + b * 3 - c * 3 + d) * t * t * t) * .5)
    return result + [points[-1]]

def build(seed, tier, collection, mats):
    height, branches, clumps, pads = layout(seed)
    crown, trunk = Mesh(), Mesh()
    if tier == 'lite':
        # Merge overlapping tufts by supporting bough, conserving their bounds.
        grouped = {i: [] for i in range(len(pads))}
        for c, r, phase, under in clumps:
            key = min(range(len(pads)), key=lambda i: (pads[i] - c).length_squared)
            grouped[key].append((c, r))
        merged = []
        for i, parts in grouped.items():
            if not parts:
                continue
            lo = Vector(tuple(min(c[k] - r[k] * (1 if k < 2 else .6) for c, r in parts) for k in range(3)))
            hi = Vector(tuple(max(c[k] + r[k] for c, r in parts) for k in range(3)))
            merged.append(((lo + hi) / 2, tuple((hi - lo) / 2), seed + i, 1.0))
        clumps = merged
    for c, r, phase, under in clumps:
        if tier == 'full' and r[2] < min(r[:2]) * .4:
            continue  # overlapping inner pads contribute little at this distance
        foliage(crown, c, r, phase, under, min(pads, key=lambda p: (p - c).length_squared), tier)
    controls = [branches[0][0]] + [branch[1] for branch in branches[:7]]
    centres = catmull(controls, 2 if tier == 'hero' else 1)
    r0, r1 = branches[0][2], branches[6][3]
    radii = [r0 + (r1 - r0) * i / (len(centres) - 1) for i in range(len(centres))]
    tube_mesh(trunk, centres, radii, height, {'hero': 8, 'full': 5, 'lite': 4}[tier], flare=True)
    i = 8
    while i < len(branches):
        a, b, r0, r1 = branches[i]; controls = [a, b]
        if i + 1 < len(branches) and (b - branches[i + 1][0]).length < 1e-5 and abs(r1 - branches[i + 1][2]) < 1e-6:
            controls.append(branches[i + 1][1]); r1 = branches[i + 1][3]; i += 1
        i += 1
        if r0 < {'hero': .070, 'full': .12, 'lite': .17}[tier]:
            continue
        centres = catmull(controls, 2 if tier == 'hero' else 1)
        radii = [r0 + (r1 - r0) * k / (len(centres) - 1) for k in range(len(centres))]
        tube_mesh(trunk, centres, radii, height, 5 if tier == 'hero' else 3)
    total = crown.triangles() + trunk.triangles()
    assert total <= BUDGET[tier], f'{seed}/{tier}: {total} exceeds {BUDGET[tier]}'
    return crown.object('crown', mats['leaf'], collection), trunk.object('trunk', mats['bark'], collection)
