"""THE SPRIGS MODELLED IN 3D (treeset v2, 3 November; owner request: better-designed leaves,
spruces and pines). The first atlases were drawn flat (make_leaf_atlas.mjs). Here every
sprig is modelled in Blender -- real leaf meshes folded along the midrib and curled,
on stalks off a tube twig; a pine's needle brushes and a spruce's combed sprays as needle
meshes -- and rendered from above into the species' 2 x 2 atlas, twice:

- COLOUR: each leaf's own near-neutral colour (lightness and a warm/cool turn round the
  catalogue's mean), its midrib paler, its base darker; the twig brown. Emission only, so the
  picture is the albedo itself, and alpha is the sprig's coverage;
- NORMAL AND LIGHT THROUGH: the surface's normal in the card's frame (x right, y up the
  sprig, z toward the eye: the camera's own frame from above) in R and G, and in B how much
  light passes through -- the leaves and needles, never the twig.

So a card is lit leaf by leaf as the leaves tilt and fold, and the sun shines through the
leaves alone (ghibli-foliage-material.mjs). Rendered with Cycles on the CPU (six threads, no
GPU), in its own scene `BanvyTreesV2Sprigs` built with the data API; nothing else in the file
is touched. Run through the MCP:

    exec(open(r'<repo>/tools/blender-tree-study/realistic/sprig_atlas.py').read())
    result = render_atlases(r'<outdir>')

It writes <outdir>/<key>-colour.png and <key>-normal.png; pack_sprigs.mjs makes the atlases.
Seeded: the same sprigs every run."""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

SCENE = 'BanvyTreesV2Sprigs'
MEAN = 0.8
SIZE = 1024
SEEDS = {'björk': 5101, 'ek': 5203, 'al': 5307, 'tall': 5409, 'gran': 5511, 'kust': 5613}

# broadleaf outlines (the drawn atlas's): length range (cell units), width share, leaves a sprig,
# the half-width profile along the midrib, the margin, the stalk share, the droop
def birch_profile(u): return math.pow(math.sin(math.pi * math.pow(u, 0.75)), 0.9) * (0.85 + u * 0.6 if u < 0.25 else 1)
def birch_edge(u, s): return 1 - 0.09 * abs(math.sin(u * 46)) - 0.05 * abs(math.sin(u * 23))
def oak_profile(u): return math.pow(max(0.0, math.sin(math.pi * math.pow(u, 1.25))), 0.7) * (0.45 + 0.55 * u)
def oak_edge(u, s): return 0.58 + 0.42 * math.pow(abs(math.sin(u * math.pi * 4.5 + (0.6 if s > 0 else 0))), 0.55)
def alder_profile(u): return math.pow(max(0.0, math.sin(math.pi * math.pow(u, 1.15))), 0.62) * (1 - (u - 0.93) * 4 if u > 0.93 else 1)
def alder_edge(u, s): return 1 - 0.05 * abs(math.sin(u * 34))
SHAPES = {
    'björk': dict(len=(0.15, 0.21), width=0.64, leaves=(80, 90), profile=birch_profile, edge=birch_edge, stalk=0.35, hang=0.9, fold=0.22, curl=0.10),
    'ek': dict(len=(0.2, 0.27), width=0.5, leaves=(46, 54), profile=oak_profile, edge=oak_edge, stalk=0.08, hang=0.25, fold=0.16, curl=0.14),
    'al': dict(len=(0.17, 0.23), width=0.74, leaves=(48, 56), profile=alder_profile, edge=alder_edge, stalk=0.25, hang=0.45, fold=0.2, curl=0.08),
}
TWIG = (0.62, 0.5, 0.38)


def ensure_scene():
    sc = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 12
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 6
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    cam = bpy.data.objects.get('sprig-camera')
    if cam is None:
        cam = bpy.data.objects.new('sprig-camera', bpy.data.cameras.new('sprig-camera'))
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.0
    cam.data.clip_start = 0.01
    cam.data.clip_end = 40
    cam.location = (0.0, 0.0, 10.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)
    sc.camera = cam
    return sc


def clear(sc):
    for ob in list(sc.collection.objects):
        if ob.name.startswith('sprig-') and ob.type == 'MESH':
            me = ob.data
            bpy.data.objects.remove(ob)
            if me and me.users == 0: bpy.data.meshes.remove(me)


def material(name, kind):
    """kind 'colour': the albedo as emitted; 'normal': (n.x, n.y) mapped to 0..1 and the light through."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Col'
    if kind == 'colour':
        nt.links.new(at.outputs['Color'], em.inputs['Color'])
    else:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
        def remap(sock):
            mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY_ADD'
            mul.inputs[1].default_value = 0.5; mul.inputs[2].default_value = 0.5
            nt.links.new(sock, mul.inputs[0])
            return mul.outputs[0]
        comb = nt.nodes.new('ShaderNodeCombineColor')
        nt.links.new(remap(sep.outputs['X']), comb.inputs[0])
        nt.links.new(remap(sep.outputs['Y']), comb.inputs[1])
        nt.links.new(at.outputs['Alpha'], comb.inputs[2])
        nt.links.new(comb.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


class Sprig:
    """One cell's geometry: positions in the cell (x right, y up the sprig, z toward the eye), a colour and a
    light-through value per vertex."""
    def __init__(self): self.V, self.C, self.F = [], [], []
    def vert(self, p, col, through):
        self.V.append(p); self.C.append((col[0], col[1], col[2], through)); return len(self.V) - 1
    def tube(self, pts, radii, col, sides=6):
        base = len(self.V)
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(a).normalized(); b = t.cross(n)
            for s in range(sides):
                th = 2 * math.pi * s / sides
                self.vert(p + (n * math.cos(th) + b * math.sin(th)) * radii[i], col, 0.0)
        for i in range(len(pts) - 1):
            for s in range(sides):
                a0 = base + i * sides + s; a1 = base + i * sides + (s + 1) % sides
                self.F.append((a0, a1, a1 + sides)); self.F.append((a0, a1 + sides, a0 + sides))
    def strip(self, rows, cols):
        """quads between consecutive rows of vertex indices"""
        for r in range(len(rows) - 1):
            for c in range(len(rows[r]) - 1):
                a, b, d, e = rows[r][c], rows[r][c + 1], rows[r + 1][c], rows[r + 1][c + 1]
                self.F.append((a, b, e)); self.F.append((a, e, d))


def leaf(sp, at, ang, length, shape, rnd):
    """A leaf at `at` (its blade's base), pointing along angle `ang` in the card's plane, folded along its midrib,
    curled and tilted at random, its colour its own."""
    S = shape
    light = 0.88 + rnd.random() * 0.26; warm = (rnd.random() - 0.5) * 2
    base_col = (MEAN * light * (1 + 0.05 * warm), MEAN * light, MEAN * light * (1 - 0.09 * warm))
    fold = S['fold'] * rnd.uniform(0.6, 1.3); curl = S['curl'] * rnd.uniform(0.4, 1.4)
    # the leaf's frame: along it, across it, and its tilt out of the card's plane
    rot = Matrix.Rotation(ang - math.pi / 2, 4, 'Z') @ Matrix.Rotation(rnd.uniform(-0.5, 0.5), 4, 'Y') @ Matrix.Rotation(rnd.uniform(-0.35, 0.35), 4, 'X')
    lift = Vector((0, 0, rnd.uniform(0.0, 0.05)))
    rows = []
    N = 16
    half = length * S['width']
    for i in range(N + 1):
        u = i / N
        w = S['profile'](u)
        row = []
        for side in (-1, 0, 1):
            x = side * w * S['edge'](u, side) * half
            z = abs(x) * fold - curl * length * u * u
            p = Vector((x, u * length, z))
            p = at + lift + (rot @ p.to_4d()).to_3d()
            k = (1.08 if side == 0 else 1.0) * (0.92 + 0.08 * u)
            row.append(sp.vert(p, tuple(c * k for c in base_col), 1.0))
        rows.append(row)
    sp.strip(rows, 3)


def needle(sp, a, b, width, col, rnd):
    """A needle: a thin strip from a to b, turned a little about its length, light passing through it."""
    d = (b - a); L = d.length
    if L < 1e-6: return
    d.normalize()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4: side = Vector((1, 0, 0))
    side.normalize()
    side = (side * math.cos(rnd.uniform(-0.6, 0.6)) + d.cross(side) * math.sin(rnd.uniform(-0.6, 0.6))).normalized()
    i0 = sp.vert(a - side * width * 0.5, col, 0.85); i1 = sp.vert(a + side * width * 0.5, col, 0.85)
    i2 = sp.vert(b + side * width * 0.15, tuple(c * 1.06 for c in col), 0.9); i3 = sp.vert(b - side * width * 0.15, tuple(c * 1.06 for c in col), 0.9)
    sp.F.append((i0, i1, i2)); sp.F.append((i0, i2, i3))


def broadleaf_sprig(sp, key, rnd):
    S = SHAPES[key]
    twig_col = tuple(MEAN * c * 0.9 for c in TWIG)
    x, y, ang = 0.42 + rnd.random() * 0.16, 0.02, math.pi / 2 + (rnd.random() - 0.5) * 0.5
    main = [Vector((x, y, 0))]
    for i in range(14):
        x += math.cos(ang) * 0.054; y += math.sin(ang) * 0.054; ang += (rnd.random() - 0.5) * 0.35
        main.append(Vector((x, y, rnd.uniform(-0.01, 0.01))))
    twigs = [main]
    for s in range(5):
        at = main[2 + int(rnd.random() * 8)].copy(); side = 1 if s % 2 else -1
        sa = math.pi / 2 + side * (0.55 + rnd.random() * 0.5); seg = [at]
        for i in range(6):
            at = at + Vector((math.cos(sa) * 0.05, math.sin(sa) * 0.05, 0)); seg.append(at); sa += side * 0.12 + (rnd.random() - 0.5) * 0.3
        twigs.append(seg)
    for t in twigs:
        sp.tube(t, [0.009 * (1 - 0.7 * i / len(t)) + 0.003 for i in range(len(t))], twig_col)
    segs = [(t[i], t[i + 1]) for t in twigs for i in range(len(t) - 1)]
    count = S['leaves'][0] + int(rnd.random() * (S['leaves'][1] - S['leaves'][0]))
    for i in range(count):
        a, b = segs[int(math.pow(rnd.random(), 0.55 if key == 'ek' else 0.9) * len(segs)) % len(segs)]
        p = a.lerp(b, rnd.random())
        seg_ang = math.atan2(b.y - a.y, b.x - a.x)
        side = 1 if i % 2 else -1
        la = seg_ang + side * (0.6 + rnd.random() * 0.9)
        # and droops by the species' own share toward the cell's foot
        d = math.atan2(math.sin(-math.pi / 2 - la), math.cos(-math.pi / 2 - la))
        la += d * S['hang'] * rnd.random() * 0.25
        length = S['len'][0] + rnd.random() * (S['len'][1] - S['len'][0])
        stalk = length * S['stalk'] * (0.6 + rnd.random() * 0.6)
        tip = p + Vector((math.cos(la), math.sin(la), 0)) * (stalk + length)
        pad = length * S['width'] + 0.01
        if not (pad < tip.x < 1 - pad and pad < tip.y < 1 - pad): continue
        base = p + Vector((math.cos(la), math.sin(la), 0.004)) * stalk
        if stalk > 0.003: sp.tube([p, base], [0.003, 0.0022], tuple(MEAN * c for c in TWIG), sides=4)
        leaf(sp, base, la + (rnd.random() - 0.5) * 0.3, length, S, rnd)


def pine_sprig(sp, rnd):
    twig_col = tuple(MEAN * c * 0.95 for c in TWIG)
    tufts = [(0.5, 0.38, 0.62), (0.27, 0.5, 0.48), (0.73, 0.52, 0.5), (0.42, 0.7, 0.44), (0.62, 0.73, 0.42)]
    for (tx, ty, s) in tufts:
        cx = tx + (rnd.random() - 0.5) * 0.06; cy = ty + (rnd.random() - 0.5) * 0.06
        shoots = 9 + int(rnd.random() * 3)
        for k in range(shoots):
            a = math.pi / 2 + (k / (shoots - 1) - 0.5) * 2.6 + (rnd.random() - 0.5) * 0.3
            L = s * (0.2 + rnd.random() * 0.12)
            root = Vector((cx, cy - s * 0.08, 0)); end = Vector((cx + math.cos(a) * L, cy + math.sin(a) * L, rnd.uniform(0, 0.03)))
            sp.tube([root, end], [0.006, 0.003], twig_col, sides=4)
            for i in range(82):
                t = 0.35 + 0.65 * math.pow(rnd.random(), 0.7)
                p = root.lerp(end, t)
                na = a + (rnd.random() - 0.5) * 1.9 * (0.45 + 0.55 * t)
                nl = s * (0.11 + rnd.random() * 0.07)
                up = rnd.uniform(-0.25, 0.5)
                q = p + Vector((math.cos(na) * nl, math.sin(na) * nl, up * nl))
                tone = 0.86 + rnd.random() * 0.3
                needle(sp, p, q, 0.0068, (MEAN * 0.98 * tone, MEAN * 1.02 * tone, MEAN * 0.97 * tone), rnd)


def coastal_sprig(sp, rnd):
    """A coastal pine's shoots (Visby): tapered brushes standing up and out of one low base. The needles sweep
    forward and gather to each shoot's point, so the outline keeps its spikes in the mipmaps, where the inland
    pine's round fans turn to blobs; the stems are needle-coloured and covered from the foot, so no spots show."""
    stem = tuple(MEAN * c * 0.6 for c in (0.95, 1.0, 0.9))
    shoots = 8 + int(rnd.random() * 2)
    for k in range(shoots):
        f = k / (shoots - 1) - 0.5
        a = math.pi / 2 - f * 1.68 + (rnd.random() - 0.5) * 0.16
        L = (0.8 - abs(f) * 0.7) * (0.84 + rnd.random() * 0.16)
        root = Vector((0.5 + f * 0.14, 0.04, 0.0))
        end = root + Vector((math.cos(a) * L, math.sin(a) * L, rnd.uniform(0, 0.03)))
        sp.tube([root, end], [0.008, 0.002], stem, sides=4)
        for i in range(150):
            t = 0.04 + 0.96 * math.pow(rnd.random(), 0.8)
            p = root.lerp(end, t)
            na = a + rnd.uniform(-1, 1) * (0.62 * math.pow(1 - t, 0.6) + 0.1)
            nl = L * (0.16 + 0.1 * rnd.random()) * (1 - 0.35 * t)
            q = p + Vector((math.cos(na) * nl, math.sin(na) * nl, rnd.uniform(-0.2, 0.4) * nl))
            tone = 0.86 + rnd.random() * 0.3
            needle(sp, p, q, 0.009, (MEAN * 0.98 * tone, MEAN * 1.02 * tone, MEAN * 0.97 * tone), rnd)


def spruce_sprig(sp, rnd):
    twig_col = tuple(MEAN * c * 0.85 for c in TWIG)
    x, y, ang = 0.5, 0.03, math.pi / 2 + (rnd.random() - 0.5) * 0.15
    axis = [Vector((x, y, 0))]
    for i in range(12):
        x += math.cos(ang) * 0.075; y += math.sin(ang) * 0.075; ang += (rnd.random() - 0.5) * 0.12
        axis.append(Vector((x, y, 0)))
    twigs = [axis]
    for i in range(1, len(axis) - 1):
        for side in (-1, 1):
            if rnd.random() < 0.15: continue
            length = 0.1 + 0.3 * math.sin(math.pi * (i / len(axis))) * (0.7 + rnd.random() * 0.5)
            sa = math.pi / 2 - side * (0.95 + rnd.random() * 0.3); p = axis[i].copy(); seg = [p]
            for j in range(4):
                p = p + Vector((math.cos(sa) * length / 4, math.sin(sa) * length / 4, rnd.uniform(-0.01, 0.01))); seg.append(p); sa += side * 0.08
            twigs.append(seg)
    for t in twigs:
        sp.tube(t, [0.008 * (1 - 0.6 * i / len(t)) + 0.002 for i in range(len(t))], twig_col, sides=4)
    for t in twigs:
        for a, b in zip(t, t[1:]):
            d = b - a; L = d.length; ang2 = math.atan2(d.y, d.x)
            count = int(math.ceil(L / 0.0042))
            for i in range(count):
                for side in (-1, 1):
                    p = a.lerp(b, (i + rnd.random() * 0.5) / count)
                    na = ang2 + side * (0.75 + rnd.random() * 0.5); nl = 0.03 + rnd.random() * 0.018
                    q = p + Vector((math.cos(na) * nl, math.sin(na) * nl, rnd.uniform(-0.1, 0.45) * nl))
                    tone = 0.84 + rnd.random() * 0.28
                    needle(sp, p, q, 0.0055, (MEAN * 0.98 * tone, MEAN * 1.02 * tone, MEAN * 0.97 * tone), rnd)


def build_species(sc, key):
    """The four sprigs of a species, each in its cell of the 2 x 2 atlas (cell 0 top left, as the atlas's uv)."""
    rnd = random.Random(SEEDS[key])
    objs = []
    for cell in range(4):
        sp = Sprig()
        if key == 'tall': pine_sprig(sp, rnd)
        elif key == 'kust': coastal_sprig(sp, rnd)
        elif key == 'gran': spruce_sprig(sp, rnd)
        else: broadleaf_sprig(sp, key, rnd)
        cx, cy = cell % 2, cell // 2
        # the cell's place in the camera's view: x in [-1, 0] or [0, 1]; the top row (cy 0) above
        off = Vector((cx - 1.0, -cy, 0.0))
        me = bpy.data.meshes.new(f'sprig-{key}-{cell}')
        me.from_pydata([tuple(v + off) for v in sp.V], [], sp.F)
        me.update()
        col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(sp.C): col.data[i].color = c
        # every face toward the eye: the camera looks down, and a leaf tilted past edge-on is seen from below
        bm = bmesh.new(); bm.from_mesh(me)
        for f in bm.faces:
            if f.normal.z < 0: f.normal_flip()
        for f in bm.faces: f.smooth = True
        bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(me.name, me)
        sc.collection.objects.link(ob)
        objs.append(ob)
    return objs


def render_atlases(outdir, keys=None):
    os.makedirs(outdir, exist_ok=True)
    sc = ensure_scene()
    colour, normal = material('sprig-colour', 'colour'), material('sprig-normal', 'normal')
    report = {}
    for key in (keys or list(SEEDS)):
        clear(sc)
        objs = build_species(sc, key)
        for kind, mat, view in (('colour', colour, 'Standard'), ('normal', normal, 'Raw')):
            for ob in objs:
                ob.data.materials.clear(); ob.data.materials.append(mat)
            try: sc.view_settings.view_transform = view
            except TypeError: sc.view_settings.view_transform = 'Standard'
            sc.view_settings.look = 'None'
            sc.view_settings.exposure = 0.0; sc.view_settings.gamma = 1.0
            sc.render.filepath = os.path.join(outdir, f'{key}-{kind}.png')
            bpy.ops.render.render(write_still=True, scene=sc.name)
        report[key] = dict(faces=sum(len(o.data.polygons) for o in objs), verts=sum(len(o.data.vertices) for o in objs))
    return report
