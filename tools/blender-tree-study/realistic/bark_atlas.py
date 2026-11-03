"""THE BARK MODELLED IN BLENDER (treeset v2, 3 November). The realistic trunks carried their bark
as a colour per vertex only, so a trunk read as a smooth painted pole close up. Here each
species' bark is modelled as a tileable patch of real relief -- a displaced grid, its heights
periodic in both directions so the patch wraps round a trunk and repeats up it without a seam:

- birch: smooth, the dark horizontal lenticels pressed in, a few peeling strips raised;
- pine: plates (a periodic Voronoi stretched up the trunk), flat-topped, parted by deep cracks;
- spruce: small round scales, shallow cracks;
- oak: deep vertical furrows between broken ridges;
- alder: smooth, fine vertical fissures.

It is rendered from above with Cycles on the CPU (six threads; the GPU untouched) as two
emission-only passes, as the sprigs are (sprig_atlas.py): a near-neutral colour (the trunk's
own tone per height still comes from its vertex colour), and the normal in the patch's frame
(R, G) with the relief's height (B). The grid overhangs the frame by a tenth on every side so its
normals are whole to the edge. Run through the MCP:

    exec(open(r'<repo>/tools/blender-tree-study/realistic/bark_atlas.py').read())
    result = render_bark(r'<outdir>')

It writes <outdir>/bark-<key>-colour.png and bark-<key>-normal.png (512 px); pack_bark.mjs (in
pack_sprigs.mjs's manner) makes the atlases. Seeded."""
import math
import os
import random

import bpy
import numpy as np

SCENE = 'BanvyTreesV2Bark'
SIZE = 512
GRID = 300            # vertices a side over [-0.1, 1.1]
MEAN = 0.8
SEEDS = {'björk': 6101, 'ek': 6203, 'al': 6307, 'tall': 6409, 'gran': 6511}


def periodic_noise(u, v, nu, nv, rnd):
    """value noise on an nu x nv lattice that wraps: smooth, periodic in u and v over [0, 1]"""
    lat = np.array([[rnd.random() for _ in range(nv)] for _ in range(nu)])
    x, y = u * nu, v * nv
    i0, j0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - i0, y - j0
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    g = lambda i, j: lat[i % nu, j % nv]
    a = g(i0, j0) * (1 - sx) + g(i0 + 1, j0) * sx
    b = g(i0, j0 + 1) * (1 - sx) + g(i0 + 1, j0 + 1) * sx
    return a * (1 - sy) + b * sy


def fbm(u, v, nu, nv, rnd, octaves=4):
    out, amp, total = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + periodic_noise(u, v, nu * 2 ** o, nv * 2 ** o, rnd) * amp
        total += amp; amp *= 0.5
    return out / total


def periodic_voronoi(u, v, nu, nv, rnd, jitter=0.85):
    """the nearest and second-nearest feature distances on a wrapping nu x nv grid (cell units), and the cell id"""
    pts = np.array([[(rnd.random() - 0.5) * jitter + 0.5, (rnd.random() - 0.5) * jitter + 0.5] for _ in range(nu * nv)]).reshape(nu, nv, 2)
    x, y = u * nu, v * nv
    ci, cj = np.floor(x).astype(int), np.floor(y).astype(int)
    f1 = np.full(x.shape, 9.0); f2 = np.full(x.shape, 9.0); cid = np.zeros(x.shape)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            i, j = ci + di, cj + dj
            p = pts[i % nu, j % nv]
            d = np.hypot(i + p[..., 0] - x, j + p[..., 1] - y)
            nearer = d < f1
            f2 = np.where(nearer, f1, np.minimum(f2, d))
            cid = np.where(nearer, (i % nu) * nv + (j % nv), cid)
            f1 = np.where(nearer, d, f1)
    return f1, f2, cid


def bark_field(key, u, v, rnd):
    """height (0..1) and near-neutral colour (r, g, b arrays) at u (round the trunk) and v (up it)"""
    if key == 'björk':
        base = fbm(u, v, 6, 6, rnd) * 0.15
        rows = (v * 22 + periodic_noise(u, v, 4, 4, rnd) * 0.6) % 1.0
        dash = periodic_noise(u, v, 18, 22, rnd)
        lent = (rows < 0.13) & (dash > 0.6)
        strips = fbm(u, v, 3, 10, rnd) > 0.64
        h = 0.55 + base - lent * 0.35 + strips * 0.12
        tone = 0.95 + fbm(u, v, 8, 8, rnd) * 0.1
        k = np.where(lent, 0.12, np.where(strips, tone * 0.92, tone))
        return h, (k * 1.0, k * 0.99, k * 0.95)
    if key == 'tall':
        # plates longer up the trunk than round it: fewer cells in v, and the pattern still wraps both ways
        f1, f2, cid = periodic_voronoi(u, v, 6, 3, rnd)
        crack = np.clip((f2 - f1) / 0.12, 0, 1)
        plate = (cid * 0.6180339) % 1.0
        h = crack ** 0.5 * (0.75 + plate * 0.25) + fbm(u, v, 12, 12, rnd) * 0.08
        k = np.where(crack < 0.35, 0.55, 0.85 + plate * 0.22) * (0.95 + fbm(u, v, 10, 10, rnd) * 0.1)
        return h, (k, k * 0.97, k * 0.92)
    if key == 'gran':
        # thin flaky scales, flat-topped and overlapping a little, not round stones
        f1, f2, cid = periodic_voronoi(u, v, 12, 16, rnd)
        crack = np.clip((f2 - f1) / 0.16, 0, 1)
        plate = (cid * 0.6180339) % 1.0
        lip = np.clip(1 - f1 / 0.9, 0, 1)
        h = crack ** 0.3 * (0.55 + plate * 0.3 + lip * 0.15) + fbm(u, v, 10, 10, rnd) * 0.06
        k = np.where(crack < 0.3, 0.6, 0.86 + plate * 0.18)
        return h, (k, k * 0.98, k * 0.95)
    if key == 'ek':
        wob = fbm(u, v, 3, 6, rnd) * 0.5
        ridge = np.abs(np.sin(2 * math.pi * (u * 7 + wob)))
        breaks = periodic_noise(u, v, 7, 9, rnd) > 0.78
        h = ridge ** 0.35 * (1 - breaks * 0.6) + fbm(u, v, 10, 12, rnd) * 0.12
        k = (0.62 + 0.38 * ridge ** 0.5) * (0.93 + fbm(u, v, 9, 9, rnd) * 0.14)
        return np.clip(h, 0, 1), (k, k * 0.97, k * 0.93)
    # alder
    # smooth grey bark, fine vertical fissures that run on and break off
    fiss = np.abs(np.sin(2 * math.pi * (u * 6 + fbm(u, v, 2, 3, rnd) * 0.35)))
    runs = periodic_noise(u, v, 6, 4, rnd) > 0.4
    depth = np.clip(1 - fiss / 0.12, 0, 1) * runs
    h = 0.6 + fbm(u, v, 6, 6, rnd) * 0.12 - depth * 0.35
    k = (0.9 + fbm(u, v, 7, 7, rnd) * 0.12) * (1 - depth * 0.3)
    return h, (k, k * 0.98, k * 0.96)


RELIEF = {'björk': 0.012, 'tall': 0.05, 'gran': 0.03, 'ek': 0.07, 'al': 0.015}


def ensure_scene():
    sc = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 8
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
    cam = bpy.data.objects.get('bark-camera')
    if cam is None:
        cam = bpy.data.objects.new('bark-camera', bpy.data.cameras.new('bark-camera'))
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.0
    cam.location = (0.5, 0.5, 5.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)
    sc.camera = cam
    return sc


def material(name, kind):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Col'
    if kind == 'colour':
        nt.links.new(at.outputs['Color'], em.inputs['Color'])
    else:
        geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
        comb = nt.nodes.new('ShaderNodeCombineColor')
        for i, axis in enumerate(('X', 'Y')):
            mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY_ADD'
            mul.inputs[1].default_value = 0.5; mul.inputs[2].default_value = 0.5
            nt.links.new(sep.outputs[axis], mul.inputs[0]); nt.links.new(mul.outputs[0], comb.inputs[i])
        nt.links.new(at.outputs['Alpha'], comb.inputs[2])
        nt.links.new(comb.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def build(sc, key):
    for ob in list(sc.collection.objects):
        if ob.name.startswith('bark-') and ob.type == 'MESH':
            me = ob.data; bpy.data.objects.remove(ob)
            if me and me.users == 0: bpy.data.meshes.remove(me)
    rnd = random.Random(SEEDS[key])
    t = np.linspace(-0.1, 1.1, GRID)
    U, V = np.meshgrid(t, t, indexing='xy')
    h, (r, g, b) = bark_field(key, U % 1.0, V % 1.0, rnd)
    h = np.clip(h, 0, 1)
    verts = np.stack([U, V, h * RELIEF[key]], axis=-1).reshape(-1, 3)
    faces = []
    for j in range(GRID - 1):
        for i in range(GRID - 1):
            a = j * GRID + i
            faces.append((a, a + 1, a + GRID + 1, a + GRID))
    me = bpy.data.meshes.new(f'bark-{key}')
    me.from_pydata([tuple(p) for p in verts], [], faces)
    me.update()
    for p in me.polygons: p.use_smooth = True
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    rr, gg, bb, hh = (np.clip(x, 0, 2).reshape(-1) for x in (r * MEAN, g * MEAN, b * MEAN, h))
    col.data.foreach_set('color', np.stack([rr, gg, bb, hh], axis=-1).reshape(-1).astype(np.float32))
    ob = bpy.data.objects.new(me.name, me)
    sc.collection.objects.link(ob)
    return ob


def render_bark(outdir, keys=None):
    os.makedirs(outdir, exist_ok=True)
    sc = ensure_scene()
    colour, normal = material('bark-colour', 'colour'), material('bark-normal', 'normal')
    report = {}
    for key in (keys or list(SEEDS)):
        ob = build(sc, key)
        for kind, mat, view in (('colour', colour, 'Standard'), ('normal', normal, 'Raw')):
            ob.data.materials.clear(); ob.data.materials.append(mat)
            sc.view_settings.view_transform = view
            sc.view_settings.look = 'None'; sc.view_settings.exposure = 0.0; sc.view_settings.gamma = 1.0
            sc.render.filepath = os.path.join(outdir, f'bark-{key}-{kind}.png')
            bpy.ops.render.render(write_still=True, scene=sc.name)
        report[key] = dict(verts=len(ob.data.vertices))
    return report
