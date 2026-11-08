"""Textures for the v3 golfers.

Fabric, leather and hair detail are small tileable normal maps made from
numpy height fields. The skin is baked by Cycles into a 2048^2 atlas built
from the body's UDIM tiles: base colour (lips, brows, cheek warmth, stubble,
nails) from shader masks in object space, and a normal map from the CC0
sculpt's finest multires level onto the runtime mesh. The irises are baked
into the eyes' own UVs.
"""
import bpy, math
import numpy as np
from mathutils import Vector as V
import cloth_v3 as C


def mix(a, b, t):
    return a + (b - a) * t


def tileable_noise(n, scale, seed, aniso=(1.0, 1.0)):
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((n, n))
    fx = np.fft.fftfreq(n)[:, None] * aniso[1]; fy = np.fft.fftfreq(n)[None, :] * aniso[0]
    f = np.sqrt(fx * fx + fy * fy)
    spectrum = np.fft.fft2(white) * np.exp(-(f * scale) ** 2)
    out = np.real(np.fft.ifft2(spectrum))
    out -= out.min(); out /= max(out.max(), 1e-9)
    return out


def height_to_normal(h, strength):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * .5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * .5
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * .5 + .5


def to_image(name, rgb, alpha=None, non_color=False):
    """A packed image from an array.

    Data images are created as data (Non-Color) before their pixels are written:
    switching a generated image's colour space afterwards regenerates it, which
    blanked every fabric normal map to black until 8 November.
    """
    h, w = rgb.shape[:2]
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=False, is_data=non_color)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    if not non_color:
        # Colour arrays are linear; the image stores sRGB bytes (as glTF reads them).
        c = np.clip(rgb, 0, 1)
        rgb = np.where(c <= .0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - .055)
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = rgb
    if alpha is not None:
        px[..., 3] = alpha
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()
    check = np.array(img.pixels[:]).reshape(-1, 4)[:, :3].mean(0)
    if not np.allclose(check, rgb.reshape(-1, 3).mean(0), atol=.02):
        raise RuntimeError(f'{name}: packed pixels {check} differ from the array')
    return img


class Library:
    def __init__(self, variant):
        self.v = variant; self.cache = {}

    def normal(self, kind):
        if kind in self.cache:
            return self.cache[kind]
        n = 256
        y, x = np.mgrid[0:n, 0:n] / n
        if kind == 'pique':
            # A knitted pique: offset rows of small raised cells.
            row = np.floor(y * 24)
            xs = x * 24 + (row % 2) * .5
            cell = np.abs(np.sin(np.pi * xs)) * np.abs(np.sin(np.pi * y * 24))
            h = cell ** .6 + .15 * tileable_noise(n, 3, 1)
            s = 9
        elif kind == 'twill':
            h = .5 + .5 * np.sin(2 * np.pi * (x + y) * 18) + .25 * tileable_noise(n, 2.5, 2)
            s = 5
        elif kind == 'leather':
            h = tileable_noise(n, 9, 3) * .6 + tileable_noise(n, 3, 4) * .4
            h = np.abs(h - .5) * 2
            s = 6
        elif kind == 'rib':
            h = .5 + .5 * np.sin(2 * np.pi * x * 20) + .1 * tileable_noise(n, 2, 5)
            s = 6
        elif kind == 'hair':
            # Strands run along U (the noise is stretched along the image rows):
            # fine stripes across V, long and slightly wavy.
            base = tileable_noise(n, 1.2, 6, aniso=(1.0, .02))
            wave = tileable_noise(n, 2.5, 7, aniso=(1.0, .08))
            h = .7 * base + .3 * wave
            s = 14
        else:
            raise KeyError(kind)
        img = to_image(f'Golfer v3 | {kind} normal', height_to_normal(h, s).astype(np.float32), non_color=True)
        self.cache[kind] = img
        return img

    def hair_color(self, base_hex, hi_hex):
        key = ('hair_color', base_hex)
        if key in self.cache:
            return self.cache[key]
        n = 256
        base = np.array(C.lin(C.hexrgb(base_hex))); hi = np.array(C.lin(C.hexrgb(hi_hex)))
        streak = tileable_noise(n, 1.2, 6, aniso=(1.0, .02))
        broad = tileable_noise(n, 10, 8, aniso=(1.0, .2))
        t = np.clip(.55 * streak + .45 * broad, 0, 1) ** 1.6
        rgb = base[None, None, :] * (1 - t[..., None]) + hi[None, None, :] * t[..., None]
        img = to_image(f'Golfer v3 | hair colour {base_hex}', rgb.astype(np.float32))
        self.cache[key] = img
        return img


def scale_uv(ob, factor):
    me = ob.data
    if not me.uv_layers:
        return scale_uv_box(ob, factor * 2.5)
    a = np.empty(len(me.loops) * 2); me.uv_layers[0].data.foreach_get('uv', a)
    me.uv_layers[0].data.foreach_set('uv', a * factor)


def scale_uv_box(ob, factor):
    me = ob.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > max(abs(n.x), abs(n.y)):
                u, v = co.x, co.y
            elif abs(n.x) > abs(n.y):
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            uv.data[li].uv = (u * factor, v * factor)


def cylinder_uv(ob, point, axis, factor, radius=.15):
    """Fabric UVs wrapped round an axis: one consistent tangent frame, a seam at the back."""
    me = ob.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    axis = V(axis).normalized(); ref = V((0, -1, 0)); ref = (ref - axis * axis.dot(ref)).normalized(); ref2 = axis.cross(ref)
    per = 2 * math.pi * radius * factor
    for p in me.polygons:
        vals = []
        for li in p.loop_indices:
            d = me.vertices[me.loops[li].vertex_index].co - V(point)
            phi = math.atan2(d.dot(ref2), d.dot(ref))
            vals.append([(phi / (2 * math.pi)) * per, d.dot(axis) * factor])
        us = [v[0] for v in vals]
        if max(us) - min(us) > per * .5:
            for v in vals:
                if v[0] < 0:
                    v[0] += per
        for li, v in zip(p.loop_indices, vals):
            uv.data[li].uv = v


def hair_uv(ob, centre, root_dir):
    """Strand-aligned UVs: meridians that converge where the hair is gathered."""
    me = ob.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    axis = root_dir.normalized(); ref = axis.orthogonal().normalized(); ref2 = axis.cross(ref)
    rep_u, rep_v = 7.0, 2.2
    for p in me.polygons:
        vals = []
        for li in p.loop_indices:
            d = me.vertices[me.loops[li].vertex_index].co - centre
            theta = math.acos(max(-1, min(1, d.normalized().dot(axis))))
            phi = math.atan2(d.dot(ref2), d.dot(ref))
            vals.append([(phi / (2 * math.pi) + .5) * rep_u, theta / math.pi * rep_v])
        us = [v[0] for v in vals]
        if max(us) - min(us) > rep_u * .5:
            for v in vals:
                if v[0] < rep_u * .5:
                    v[0] += rep_u
        for li, v in zip(p.loop_indices, vals):
            uv.data[li].uv = v


# -- skin ---------------------------------------------------------------------------------
# UDIM tile -> (atlas x, atlas y, size). Faces' tiles: see the v3 README.
ATLAS = {
    (0, 0): (.0, .5, .5), (0, 2): (.5, .5, .5),                      # face halves
    (2, 0): (.0, .25, .25), (2, 2): (.25, .25, .25),                 # hands
    (3, 0): (.5, .25, .25), (3, 2): (.75, .25, .25),                 # arms
    (5, 0): (.0, .125, .125), (6, 0): (.125, .125, .125), (7, 0): (.25, .125, .125), (8, 0): (.375, .125, .125),
    (5, 2): (.5, .125, .125), (6, 2): (.625, .125, .125), (7, 2): (.75, .125, .125), (8, 2): (.875, .125, .125),
    (1, 0): (.0, .0, .125), (1, 2): (.125, .0, .125),                # mouth
    (0, 1): (.25, .0, .125), (0, 3): (.375, .0, .125), (1, 1): (.5, .0, .125), (1, 3): (.625, .0, .125),
    (2, 1): (.75, .0, .125), (2, 3): (.875, .0, .125),
}


def atlas_uv(me):
    src = me.uv_layers['UVMap']
    a = np.empty(len(me.loops) * 2); src.data.foreach_get('uv', a); a = a.reshape(-1, 2)
    out = np.empty_like(a)
    # Per-face tile so no face straddles two slots.
    for p in me.polygons:
        idx = list(p.loop_indices)
        c = a[idx].mean(axis=0); tile = (int(math.floor(c[0])), int(math.floor(c[1])))
        slot = ATLAS.get(tile)
        for i in idx:
            if slot is None:
                out[i] = (.998, .998)
            else:
                f = np.clip(a[i] - np.array(tile), 0, 1)
                pad = .004
                out[i] = (slot[0] + slot[2] * (pad + f[0] * (1 - 2 * pad)), slot[1] + slot[2] * (pad + f[1] * (1 - 2 * pad)))
    layer = me.uv_layers.get('SkinAtlas') or me.uv_layers.new(name='SkinAtlas')
    layer.data.foreach_set('uv', out.ravel())
    return layer


def vertex_mask(me, name, sets, fsets):
    """Float attribute: 1 on vertices of the given face sets, softened one ring."""
    v = np.zeros(len(me.vertices))
    for p, f in zip(me.polygons, fsets):
        if f in sets:
            for i in p.vertices:
                v[i] = 1.0
    nb = C.neighbours(me)
    v = np.array([max(v[i], np.mean([v[j] for j in nb[i]]) if nb[i] else 0) for i in range(len(v))])
    attr = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT')
    attr.data.foreach_set('value', v.astype(np.float32))


class Nodes:
    """Tiny helper to write shader maths."""

    def __init__(self, nt):
        self.nt = nt; self.x = 0

    def node(self, kind, **inputs):
        n = self.nt.nodes.new(kind); n.location = (self.x, 0); self.x += 30
        for k, v in inputs.items():
            if k.startswith('op'):
                n.operation = v; continue
            idx = int(k[1:]) if k.startswith('i') and k[1:].isdigit() else k
            sock = n.inputs[idx]
            if hasattr(v, 'is_linked') or hasattr(v, 'node'):
                self.nt.links.new(v, sock)
            else:
                sock.default_value = v
        return n

    def vmath(self, op, a, b=None, scale=None):
        n = self.nt.nodes.new('ShaderNodeVectorMath'); n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if hasattr(v, 'node'):
                self.nt.links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        if scale is not None:
            n.inputs[3].default_value = scale
        return n.outputs['Value'] if op in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else n.outputs['Vector']

    def math(self, op, a, b=0.0, clamp=False):
        n = self.nt.nodes.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if hasattr(v, 'node'):
                self.nt.links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def smoothstep(self, x, lo, hi):
        n = self.nt.nodes.new('ShaderNodeMapRange'); n.interpolation_type = 'SMOOTHSTEP'
        self.nt.links.new(x, n.inputs['Value'])
        n.inputs['From Min'].default_value = lo; n.inputs['From Max'].default_value = hi
        n.inputs['To Min'].default_value = 0; n.inputs['To Max'].default_value = 1
        return n.outputs['Result']

    def mixc(self, a, b, f):
        n = self.nt.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.blend_type = 'MIX'
        for sock, v in ((n.inputs[0], f), (n.inputs[6], a), (n.inputs[7], b)):
            if hasattr(v, 'node'):
                self.nt.links.new(v, sock)
            else:
                sock.default_value = v if not isinstance(v, (tuple, list)) or len(v) == 4 else (*v, 1)
        return n.outputs[2]

    def attr(self, name):
        n = self.nt.nodes.new('ShaderNodeAttribute'); n.attribute_name = name; n.attribute_type = 'GEOMETRY'
        return n.outputs['Fac']


def ellipsoid(N, pos, centre, scale, soft=.5):
    d = N.vmath('SUBTRACT', pos, tuple(centre))
    d = N.vmath('DIVIDE', d, tuple(scale))
    r = N.vmath('LENGTH', d)
    return N.math('SUBTRACT', 1.0, N.smoothstep(r, soft, 1.0))


def rgba(h):
    return (*C.lin(C.hexrgb(h)), 1.0)


def skin_shader(G, P, variant, target_image):
    """An emission shader (for baking) painting the skin's features in object space."""
    J = G['joints']; me = G['body'].data
    fsets = C.face_sets(me)
    from body_v3 import FS
    vertex_mask(me, 'lip_mask', {FS['mouth']}, fsets)
    vertex_mask(me, 'lid_mask', {FS['eyelid_L'], FS['eyelid_R']}, fsets)
    vertex_mask(me, 'ear_mask', {FS['ear_L'], FS['ear_R']}, fsets)
    tips = set()
    from body_v3 import FINGERS
    for side in 'LR':
        for f in FINGERS[side].values():
            tips.add(f[3])
    vertex_mask(me, 'nail_mask', tips, fsets)
    vertex_mask(me, 'beard_mask', {FS['jaw'], FS['chin']}, fsets)
    mat = bpy.data.materials.new(f'Golfer v3 {variant} | skin bake')
    mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    N = Nodes(nt)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(emit.outputs[0], out.inputs['Surface'])
    tc = nt.nodes.new('ShaderNodeTexCoord'); pos = tc.outputs['Object']
    k = J['head_top'].z / (1.68 if variant == 'female' else 1.80)
    eye = (J['eye_L'] + J['eye_R']) / 2
    base = rgba(P['skin'])
    # Mottling: two scales of soft noise, warm and cool.
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 70; noise.inputs['Detail'].default_value = 4
    nt.links.new(pos, noise.inputs['Vector'])
    fine = nt.nodes.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 420; fine.inputs['Detail'].default_value = 2
    nt.links.new(pos, fine.inputs['Vector'])
    warm = tuple(min(1, c * f) for c, f in zip(base[:3], (1.06, .93, .9))) + (1,)
    cool = tuple(min(1, c * f) for c, f in zip(base[:3], (.94, .97, 1.03))) + (1,)
    col = N.mixc(cool, warm, noise.outputs['Fac'])
    col = N.mixc(col, tuple(c * .93 for c in base[:3]) + (1,), N.math('MULTIPLY', fine.outputs['Fac'], .35))
    # Warmth: cheeks, nose, ears, lips, knuckles.
    blush = rgba('#D88A7A' if variant == 'female' else '#A8664C')
    for s in (-1, 1):
        m = ellipsoid(N, pos, (s * .038 * k, eye.y - .004, eye.z - .030 * k), (.030 * k, .034 * k, .026 * k), soft=.0)
        col = N.mixc(col, blush, N.math('MULTIPLY', m, .15 if variant == 'female' else .08))
    nose = ellipsoid(N, pos, (0, eye.y - .028, eye.z - .045 * k), (.014 * k, .02 * k, .016 * k))
    col = N.mixc(col, blush, N.math('MULTIPLY', nose, .22))
    col = N.mixc(col, blush, N.math('MULTIPLY', N.attr('ear_mask'), .28))
    # Under-eye shade and the upper-lid line.
    for s in (-1, 1):
        under = ellipsoid(N, pos, (s * .033 * k, eye.y + .004, eye.z - .015 * k), (.017 * k, .02 * k, .007 * k))
        col = N.mixc(col, tuple(c * .82 for c in base[:3]) + (1,), N.math('MULTIPLY', under, .25))
    lid = N.attr('lid_mask')
    liner = rgba('#3A2A26' if variant == 'female' else '#5A3C30')
    lid_line = N.math('MULTIPLY', lid, N.smoothstep(N.vmath('DOT_PRODUCT', pos, (0, 0, 1)), eye.z + .002 * k, eye.z + .009 * k))
    col = N.mixc(col, liner, N.math('MULTIPLY', lid_line, .55 if variant == 'female' else .3))
    # Lips: the mouth face set holds only the upper lip (and the philtrum above it);
    # the lower lip belongs to the chin set. Paint both lips as a soft ellipse on the
    # measured mouth line instead, with a darker line where they meet.
    co = np.array([v.co[:] for v in me.vertices])
    mouth_ids = set()
    for poly, f in zip(me.polygons, fsets):
        if f == FS['mouth']:
            mouth_ids.update(poly.vertices)
    m_ids = np.array(sorted(mouth_ids))
    mp = co[m_ids]
    front = mp[(np.abs(mp[:, 0]) < .006 * k)]
    y_front = float(front[:, 1].min()) if len(front) else eye.y - .035
    z_line = float(front[:, 2].min()) if len(front) else eye.z - .068 * k
    lips = ellipsoid(N, pos, (0, y_front + .006, z_line + .0005), (.0245 * k, .016, .0108 * k), soft=.42)
    lip_col = rgba(P['lip'])
    col = N.mixc(col, lip_col, N.math('MULTIPLY', lips, .78 if variant == 'female' else .5))
    seam = ellipsoid(N, pos, (0, y_front + .006, z_line + .0005), (.022 * k, .016, .0016 * k), soft=.2)
    col = N.mixc(col, tuple(c * .55 for c in lip_col[:3]) + (1,), N.math('MULTIPLY', seam, .45))
    # Brows: an arched band above each eye, broken into hairs.
    brow_col = rgba('#3B2717' if variant == 'female' else '#1C1410')
    hairs = nt.nodes.new('ShaderNodeTexNoise'); hairs.inputs['Scale'].default_value = 900
    stretch = N.vmath('MULTIPLY', pos, (1.0, 1.0, 6.0))
    nt.links.new(stretch, hairs.inputs['Vector'])
    for s in (-1, 1):
        # A tapered arch: fuller at the inner end, peaking two thirds out, a thin tail.
        fem = variant == 'female'
        brow = None
        for i in range(17):
            t = i / 16
            x = s * mix(.014, .058, t) * k
            z = eye.z + (.0185 + (.0068 if fem else .0045) * math.sin(math.pi * min(1.0, t / .72) * .5 + (0 if t < .72 else 0))
                         - (.006 if fem else .004) * max(0.0, (t - .72) / .28) ** 1.6) * k
            hz = ((.0054 if fem else .0070) * (1 - .5 * t ** 1.3)) * k
            hx = .0095 * k
            m = ellipsoid(N, pos, (x, eye.y - .004, z), (hx, .03 * k, hz), soft=.2)
            brow = m if brow is None else N.math('MAXIMUM', brow, m)
        col = N.mixc(col, brow_col, N.math('MULTIPLY', brow, N.math('ADD', .68, N.math('MULTIPLY', hairs.outputs['Fac'], .4))))
    if variant == 'male':
        # Close-cut stubble on the jaw, chin and upper lip.
        beard = N.math('MAXIMUM', N.attr('beard_mask'),
                       ellipsoid(N, pos, (0, eye.y - .01, eye.z - .075 * k), (.05 * k, .06 * k, .045 * k), soft=.6))
        upper_lip = ellipsoid(N, pos, (0, eye.y - .03, eye.z - .058 * k), (.022 * k, .03 * k, .007 * k), soft=.5)
        beard = N.math('MAXIMUM', beard, upper_lip)
        beard = N.math('MULTIPLY', beard, N.math('SUBTRACT', 1.0, N.attr('lip_mask')))
        dots = nt.nodes.new('ShaderNodeTexNoise'); dots.inputs['Scale'].default_value = 1400
        nt.links.new(pos, dots.inputs['Vector'])
        stub = N.math('MULTIPLY', beard, N.smoothstep(dots.outputs['Fac'], .42, .6))
        col = N.mixc(col, rgba('#2C2420'), N.math('MULTIPLY', stub, .55))
        col = N.mixc(col, tuple(c * .86 for c in base[:3]) + (1,), N.math('MULTIPLY', beard, .3))
    if variant == 'male':
        # A short crop's fade: dense dots darkening the scalp above the hairline.
        crop = N.math('MULTIPLY', N.attr('scalp_mask'), N.smoothstep(dots.outputs['Fac'], .32, .52))
        col = N.mixc(col, rgba('#1E1612'), N.math('MULTIPLY', crop, .9))
        col = N.mixc(col, tuple(c * .72 for c in base[:3]) + (1,), N.math('MULTIPLY', N.attr('scalp_mask'), .45))
    # Nails.
    col = N.mixc(col, rgba('#F0D3C8' if variant == 'female' else '#D9B4A4'), N.math('MULTIPLY', N.attr('nail_mask'), .7))
    nt.links.new(col, emit.inputs['Color'])
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = target_image
    nt.nodes.active = tex
    return mat


def bake_skin(G, P, variant, size=2048):
    scene = bpy.context.scene
    body = G['body']; me = body.data
    layer = atlas_uv(me)
    me.uv_layers.active = layer
    color = bpy.data.images.new(f'Golfer v3 {variant} | skin colour', size, size, alpha=False)
    normal = bpy.data.images.new(f'Golfer v3 {variant} | skin normal', size, size, alpha=False)
    normal.colorspace_settings.name = 'Non-Color'
    engine = scene.render.engine
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'; scene.cycles.samples = 1
    bake = skin_shader(G, P, variant, color)
    me.materials.clear(); me.materials.append(bake)
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    body.select_set(True); bpy.context.view_layer.objects.active = body
    scene.render.bake.margin = 12; scene.render.bake.use_clear = True
    bpy.ops.object.bake(type='EMIT', margin=12)
    # Normal detail from the sculpt's finest level onto the runtime body.
    import body_v3
    high = body_v3.evaluated_level(G['source'], 3, f'Golfer v3 {variant} | sculpt L3', body.users_collection[0])
    high.hide_render = False
    tex = bake.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = normal; bake.node_tree.nodes.active = tex
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    high.select_set(True); body.select_set(True); bpy.context.view_layer.objects.active = body
    scene.cycles.samples = 2
    bpy.ops.object.bake(type='NORMAL', use_selected_to_active=True, cage_extrusion=.006, max_ray_distance=.02,
                        normal_space='TANGENT', margin=12)
    bpy.data.objects.remove(high, do_unlink=True)
    color.pack(); normal.pack()
    scene.render.engine = engine
    # Final skin: the baked maps on a principled surface, sampled through the atlas.
    mat = bpy.data.materials.new(f'Golfer v3 {variant} | skin')
    mat.use_nodes = True; nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'SkinAtlas'
    ct = nt.nodes.new('ShaderNodeTexImage'); ct.image = color; nt.links.new(uvn.outputs['UV'], ct.inputs['Vector'])
    nt.links.new(ct.outputs['Color'], b.inputs['Base Color'])
    ntx = nt.nodes.new('ShaderNodeTexImage'); ntx.image = normal; nt.links.new(uvn.outputs['UV'], ntx.inputs['Vector'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'SkinAtlas'; nm.inputs['Strength'].default_value = .9
    nt.links.new(ntx.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = .47
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = .46
    mat.diffuse_color = rgba(P['skin'])
    # The UDIM layout stays only as a second UV set for the garments that were cut from it.
    me.uv_layers.active = layer
    layer.active_render = True
    old = me.uv_layers.get('UVMap')
    if old is not None:
        me.uv_layers.remove(old)
    layer.name = 'UVMap'
    nm.uv_map = 'UVMap'; uvn.uv_map = 'UVMap'
    return dict(material=mat, color=color, normal=normal)


def eye_material(variant, iris_hex):
    """Sclera, a fibred iris with a darker limbal ring, and the pupil, painted by angle."""
    name = f'Golfer v3 {variant} | eye'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    n = 256
    img = bpy.data.images.new(f'Golfer v3 {variant} | iris', n, n, alpha=False)
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = .12
    if 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = .6
    mat['iris'] = iris_hex
    return mat


def bake_eyes(G, P, variant):
    """Bake the eye texture with Cycles from the left eye (both share its UVs)."""
    scene = bpy.context.scene
    eye = G['eyes'][0]
    mat = eye_material(variant, P['iris'])
    img = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    bm = bpy.data.materials.new(f'Golfer v3 {variant} | eye bake'); bm.use_nodes = True
    nt = bm.node_tree; nt.nodes.clear(); N = Nodes(nt)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(emit.outputs[0], out.inputs['Surface'])
    tc = nt.nodes.new('ShaderNodeTexCoord'); pos = tc.outputs['Object']
    c = sum((v.co for v in eye.data.vertices), V()) / len(eye.data.vertices)
    d = N.vmath('NORMALIZE', N.vmath('SUBTRACT', pos, tuple(c)))
    cos = N.vmath('DOT_PRODUCT', d, (0, -1, 0))
    ang = N.math('ARCCOSINE', cos)
    iris = rgba(P['iris']); deep = tuple(x * .45 for x in iris[:3]) + (1,)
    fib = nt.nodes.new('ShaderNodeTexNoise'); fib.inputs['Scale'].default_value = 60; fib.inputs['Detail'].default_value = 6
    nt.links.new(N.vmath('MULTIPLY', d, (1, .1, 1)), fib.inputs['Vector'])
    # A human iris spans about 29 degrees of the eyeball's radius: larger than drawn
    # before, so the eye no longer stares. A warm sclera darkens toward the corners.
    col = N.mixc(rgba('#E8E0D5'), rgba('#D6B3A8'), N.smoothstep(ang, .7, 1.3))
    ring = N.smoothstep(ang, .38, .50)
    bright = tuple(min(1.0, x * 1.35) for x in iris[:3]) + (1,)
    inner = N.mixc(bright, iris, N.smoothstep(ang, .17, .30))
    col = N.mixc(N.mixc(deep, inner, fib.outputs['Fac']), col, N.smoothstep(ang, .49, .53))
    col = N.mixc(col, rgba('#22252B'), N.math('MULTIPLY', N.math('MULTIPLY', ring, .8), N.math('SUBTRACT', 1.0, N.smoothstep(ang, .49, .53))))
    col = N.mixc(rgba('#060709'), col, N.smoothstep(ang, .15, .18))
    # Eye occlusion: the upper lid shades the top of the eyeball (and a little the
    # bottom), as the lids would in a soft-shadowed render. Without it the white stares.
    up = N.vmath('DOT_PRODUCT', d, (0, 0, 1))
    shade_top = N.smoothstep(up, .05, .62)
    shade_bot = N.smoothstep(N.math('MULTIPLY', up, -1.0), .25, .8)
    occl = N.math('ADD', N.math('MULTIPLY', shade_top, .42), N.math('MULTIPLY', shade_bot, .18))
    col = N.mixc(col, rgba('#6E5A52'), occl)
    nt.links.new(col, emit.inputs['Color'])
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; nt.nodes.active = t
    keep = list(eye.data.materials)
    eye.data.materials.clear(); eye.data.materials.append(bm)
    engine = scene.render.engine; scene.render.engine = 'CYCLES'; scene.cycles.samples = 1
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    eye.select_set(True); bpy.context.view_layer.objects.active = eye
    bpy.ops.object.bake(type='EMIT', margin=4)
    scene.render.engine = engine
    img.pack()
    for e in G['eyes']:
        e.data.materials.clear(); e.data.materials.append(mat)
    bpy.data.materials.remove(bm)
    return mat
