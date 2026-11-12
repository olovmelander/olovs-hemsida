"""The skin's texture set (12 November).

Until now the skin was one tone with soft noise, painted by a shader and baked.
It read as wax: no creases, no pores, smudged brows, one roughness everywhere.

Here the body's atlas is first baked into data maps: every texel's position and
normal in the body's own space, the face-set masks, and from the CC0 sculpt's
finest level the tangent normals, ambient occlusion and curvature. The skin is
then painted in numpy from those maps, in three dimensions, so nothing depends
on where the UV seams fall:

  colour     tone zones (a warmer mid-face, a sallower forehead, cooler jaw),
             mottling at two scales, creases that darken toward red (as light
             under skin does), brows drawn hair by hair, shaped lips with their
             fine vertical lines, a lash line, real nails, knuckles, elbows and
             knees, freckles for her, stubble and a faded crop for him;
  normal     the sculpt's, with fine grain, lip lines and knuckle creases added;
  ORM        occlusion, and a roughness that is not one number: an oilier
             T-zone and nose, wet lips, glossy nails, drier stubble.

Colours are linear here and stored as sRGB (as glTF reads them).
"""
import bpy, math
import numpy as np
from mathutils import Vector as V
import cloth_v3 as C
import textures_v3 as TX
from body_v3 import FS, FINGERS, TOES, FOREFOOT

SIZE = 2048
OFFSET = np.array([2.0, 2.0, 1.0], dtype=np.float32)      # positions are baked positive


# -- small numerics ------------------------------------------------------------------
def lin(hexcode):
    return np.array(C.lin(C.hexrgb(hexcode)), dtype=np.float32)


def sstep(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.uint32) * np.uint32(374761393) + iy.astype(np.uint32) * np.uint32(668265263)
         + iz.astype(np.uint32) * np.uint32(2147483647) + np.uint32(seed * 1274126177 & 0xFFFFFFFF))
    h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
    h = h ^ (h >> np.uint32(16))
    return h.astype(np.float32) * np.float32(1 / 4294967296)


def vnoise(P, scale, seed=0):
    """Value noise in 3D, 0..1 (P: (K, 3) metres; scale: cells per metre)."""
    q = P * np.float32(scale) + np.float32(100.0)
    i = np.floor(q); f = q - i; i = i.astype(np.int64)
    u = f * f * (3 - 2 * f)
    out = np.zeros(len(P), dtype=np.float32)
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                out += _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed) * (wx * wy * wz)
    return out


def fbm(P, scale, octaves=3, seed=0, gain=.5):
    out = np.zeros(len(P), dtype=np.float32); amp = 1.0; total = 0.0
    for o in range(octaves):
        out += vnoise(P, scale * 2 ** o, seed + o * 17) * amp
        total += amp; amp *= gain
    return out / total


def cells(P, scale, seed=0):
    """Distance to the nearest of a jittered lattice of points (0 at a point), and that point's own random number."""
    q = P * np.float32(scale) + np.float32(100.0)
    i = np.floor(q).astype(np.int64); f = (q - np.floor(q)).astype(np.float32)
    best = np.full(len(P), 9.0, dtype=np.float32); ident = np.zeros(len(P), dtype=np.float32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                cx = i[:, 0] + dx; cy = i[:, 1] + dy; cz = i[:, 2] + dz
                px = dx + _hash(cx, cy, cz, seed) - f[:, 0]
                py = dy + _hash(cx, cy, cz, seed + 1) - f[:, 1]
                pz = dz + _hash(cx, cy, cz, seed + 2) - f[:, 2]
                d = px * px + py * py + pz * pz
                near = d < best
                best = np.where(near, d, best)
                ident = np.where(near, _hash(cx, cy, cz, seed + 3), ident)
    return np.sqrt(best), ident


def blob(P, centre, radii, soft=.5):
    """1 inside an ellipsoid, easing to 0 at its surface from `soft` of the way out."""
    d = (P - np.asarray(centre, dtype=np.float32)) / np.asarray(radii, dtype=np.float32)
    r = np.sqrt((d * d).sum(axis=1))
    return 1 - sstep(r, soft, 1.0)


def blur(img, sigma):
    """Gaussian blur of an (H, W) or (H, W, C) array (periodic; the atlas has gutters)."""
    h, w = img.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.rfftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy)).astype(np.float32)
    if img.ndim == 2:
        return np.fft.irfft2(np.fft.rfft2(img) * g, s=(h, w)).astype(np.float32)
    return np.stack([np.fft.irfft2(np.fft.rfft2(img[..., c]) * g, s=(h, w)) for c in range(img.shape[2])], axis=-1).astype(np.float32)


def dilate(img, valid, rounds=14):
    """Spread colours out over the gutters, so mip-maps never bring the background in."""
    img = img.copy(); known = valid.copy()
    for _ in range(rounds):
        acc = np.zeros_like(img); cnt = np.zeros(known.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            k = np.roll(known, (dy, dx), axis=(0, 1))
            acc += np.roll(img, (dy, dx), axis=(0, 1)) * (k[..., None] if img.ndim == 3 else k)
            cnt += k
        new = (~known) & (cnt > 0)
        if not new.any():
            break
        div = np.maximum(cnt, 1)
        img[new] = (acc / (div[..., None] if img.ndim == 3 else div))[new]
        known |= new
    return img


# -- baking ---------------------------------------------------------------------------
def _image(name, size, data=True):
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    return bpy.data.images.new(name, size, size, alpha=False, float_buffer=True, is_data=data)


def _read(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)[..., :3].copy()


def _select(active, others=()):
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in others:
        ob.select_set(True)
    active.select_set(True); bpy.context.view_layer.objects.active = active


def _emission(name):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(emit.outputs[0], out.inputs['Surface'])
    return mat, nt, emit


def _target(nt, image):
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = image
    for n in nt.nodes:
        n.select = False
    tex.select = True; nt.nodes.active = tex
    return tex


def _combine(nt, r, g, b):
    n = nt.nodes.new('ShaderNodeCombineXYZ')
    for sock, v in zip(n.inputs, (r, g, b)):
        if hasattr(v, 'node'):
            nt.links.new(v, sock)
        else:
            sock.default_value = v
    return n.outputs[0]


def _attr(nt, name):
    n = nt.nodes.new('ShaderNodeAttribute'); n.attribute_name = name; n.attribute_type = 'GEOMETRY'
    return n.outputs['Fac']


def vertex_masks(G):
    """Per-vertex masks from the anatomical face sets (baked into the atlas below)."""
    me = G['body'].data
    fsets = C.face_sets(me)
    tips = {f[3] for side in 'LR' for f in FINGERS[side].values()}
    fingers = {s for side in 'LR' for f in FINGERS[side].values() for s in f}
    toes = set(TOES['L']) | set(TOES['R']) | set(FOREFOOT.values())
    TX.vertex_mask(me, 'lip_mask', {FS['mouth']}, fsets)
    TX.vertex_mask(me, 'lid_mask', {FS['eyelid_L'], FS['eyelid_R']}, fsets)
    TX.vertex_mask(me, 'ear_mask', {FS['ear_L'], FS['ear_R']}, fsets)
    TX.vertex_mask(me, 'nail_mask', tips, fsets)
    TX.vertex_mask(me, 'beard_mask', {FS['jaw'], FS['chin']}, fsets)
    TX.vertex_mask(me, 'hand_mask', {FS['hand_L'], FS['hand_R']} | fingers, fsets)
    TX.vertex_mask(me, 'head_mask', {FS['head'], FS['jaw'], FS['chin'], FS['mouth'], FS['eyelid_L'], FS['eyelid_R'],
                                     FS['ear_L'], FS['ear_R']}, fsets)
    TX.vertex_mask(me, 'foot_mask', {FS['foot_L'], FS['foot_R']} | toes, fsets)
    if 'scalp_mask' not in me.attributes:
        me.attributes.new('scalp_mask', 'FLOAT', 'POINT')


def bake_maps(G, variant, size=SIZE, ao_samples=24):
    """Bake the body's atlas into data maps (numpy arrays, rows bottom to top)."""
    import body_v3
    scene = bpy.context.scene
    body = G['body']; me = body.data
    layer = TX.atlas_uv(me)
    me.uv_layers.active = layer; layer.active_render = True
    vertex_masks(G)
    engine = scene.render.engine
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'
    scene.render.bake.use_clear = True
    if scene.world is None:
        scene.world = bpy.data.worlds.new('Golfer v3 | bake world')
    try:
        scene.world.light_settings.distance = .05      # occlusion reaches five centimetres: creases, not the pose
    except Exception as error:
        print('SKIN occlusion distance not set:', error)
    keep_mats = list(me.materials)
    maps = {}

    def bake_emit(key, build, margin):
        mat, nt, emit = _emission(f'Golfer v3 {variant} | bake {key}')
        nt.links.new(build(nt), emit.inputs['Color'])
        img = _image(f'Golfer v3 {variant} | map {key}', size)
        _target(nt, img)
        me.materials.clear(); me.materials.append(mat)
        _select(body)
        scene.cycles.samples = 1
        bpy.ops.object.bake(type='EMIT', margin=margin)
        maps[key] = _read(img)
        bpy.data.images.remove(img); bpy.data.materials.remove(mat)

    def position(nt):
        tc = nt.nodes.new('ShaderNodeTexCoord')
        add = nt.nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'
        nt.links.new(tc.outputs['Object'], add.inputs[0]); add.inputs[1].default_value = tuple(float(v) for v in OFFSET)
        return add.outputs['Vector']

    def normal(nt):
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        mad = nt.nodes.new('ShaderNodeVectorMath'); mad.operation = 'MULTIPLY_ADD'
        nt.links.new(geo.outputs['Normal'], mad.inputs[0])
        mad.inputs[1].default_value = (.5, .5, .5); mad.inputs[2].default_value = (.5, .5, .5)
        return mad.outputs['Vector']

    bake_emit('pos', position, 0)
    bake_emit('nrm', normal, 0)
    bake_emit('m1', lambda nt: _combine(nt, _attr(nt, 'lip_mask'), _attr(nt, 'lid_mask'), _attr(nt, 'ear_mask')), 0)
    bake_emit('m2', lambda nt: _combine(nt, _attr(nt, 'nail_mask'), _attr(nt, 'beard_mask'), _attr(nt, 'scalp_mask')), 0)
    bake_emit('m3', lambda nt: _combine(nt, _attr(nt, 'hand_mask'), _attr(nt, 'head_mask'), _attr(nt, 'foot_mask')), 0)

    # From the sculpt's finest level onto the runtime body.
    src_mod = next(m for m in G['source'].modifiers if m.type == 'MULTIRES')
    level = min(3, src_mod.total_levels)
    high = body_v3.evaluated_level(G['source'], level, f'Golfer v3 {variant} | sculpt L{level}', body.users_collection[0])
    high.hide_render = False
    hmat, hnt, hemit = _emission(f'Golfer v3 {variant} | bake curvature')
    geo = hnt.nodes.new('ShaderNodeNewGeometry')
    hnt.links.new(geo.outputs['Pointiness'], hemit.inputs['Color'])
    high.data.materials.clear(); high.data.materials.append(hmat)
    mat, nt, emit = _emission(f'Golfer v3 {variant} | bake target')
    me.materials.clear(); me.materials.append(mat)
    # The sculpt's tangent normals onto the runtime body.
    normal_img = _image(f'Golfer v3 {variant} | map tan', size)
    _target(nt, normal_img)
    _select(body, [high])
    scene.cycles.samples = 2
    bpy.ops.object.bake(type='NORMAL', use_selected_to_active=True, cage_extrusion=.006, max_ray_distance=.02,
                        margin=12, normal_space='TANGENT')
    maps['tan'] = _read(normal_img)
    # Occlusion and curvature are baked on the sculpt itself, in the same atlas. (Baked
    # from the sculpt onto the runtime body, the runtime body shadows it: the two
    # surfaces cross everywhere, and half the texels came out black.)
    hl = TX.atlas_uv(high.data)
    high.data.uv_layers.active = hl; hl.active_render = True
    body.hide_render = True

    def bake_self(key, kind, samples):
        img = _image(f'Golfer v3 {variant} | map {key}', size)
        _target(hnt, img)
        _select(high)
        scene.cycles.samples = samples
        bpy.ops.object.bake(type=kind, margin=12)
        maps[key] = _read(img)
        bpy.data.images.remove(img)

    bake_self('ao', 'AO', ao_samples)
    bake_self('curv', 'EMIT', 1)
    body.hide_render = False
    bpy.data.objects.remove(high, do_unlink=True)
    bpy.data.materials.remove(hmat); bpy.data.materials.remove(mat)
    me.materials.clear()
    for m in keep_mats:
        me.materials.append(m)
    scene.render.engine = engine
    maps['normal_image'] = normal_img
    maps['layer'] = layer
    maps['multires_level'] = level
    return maps


# -- the canvas ------------------------------------------------------------------------
class Canvas:
    """The atlas's covered texels as flat arrays (K of them), with their 3D positions."""

    def __init__(self, maps):
        pos = maps['pos']
        self.h, self.w = pos.shape[:2]
        self.valid = pos[..., 0] > .5
        self.iy, self.ix = np.nonzero(self.valid)
        self.P = pos[self.valid] - OFFSET
        self.N = maps['nrm'][self.valid] * 2 - 1
        n = np.linalg.norm(self.N, axis=1, keepdims=True); self.N /= np.maximum(n, 1e-6)
        self.K = len(self.P)

    def take(self, img):
        return img[self.valid]

    def put(self, values, fill=0.0):
        shape = (self.h, self.w) + values.shape[1:]
        out = np.full(shape, fill, dtype=np.float32)
        out[self.valid] = values
        return out

    def front_grid(self, x0, x1, z0, z1, y_max, cell=.0004):
        """(x, z) -> index of the frontmost covered texel there (a face is a height field from the front)."""
        nx = int((x1 - x0) / cell) + 1; nz = int((z1 - z0) / cell) + 1
        P = self.P
        sel = np.nonzero((P[:, 0] >= x0) & (P[:, 0] <= x1) & (P[:, 2] >= z0) & (P[:, 2] <= z1) & (P[:, 1] < y_max))[0]
        cx = ((P[sel, 0] - x0) / cell).astype(int); cz = ((P[sel, 2] - z0) / cell).astype(int)
        order = np.argsort(-P[sel, 1])                 # the frontmost (smallest y) is written last
        grid = np.full((nz, nx), -1, dtype=np.int64)
        grid[cz[order], cx[order]] = sel[order]
        for _ in range(8):                             # close pinholes between texels
            hole = grid < 0
            if not hole.any():
                break
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                nb = np.roll(grid, (dy, dx), axis=(0, 1))
                fill = hole & (nb >= 0)
                grid[fill] = nb[fill]; hole = grid < 0
        return dict(grid=grid, x0=x0, z0=z0, cell=cell, nx=nx, nz=nz)

    def lookup(self, fg, x, z):
        cx = np.clip(((np.asarray(x) - fg['x0']) / fg['cell']).astype(int), 0, fg['nx'] - 1)
        cz = np.clip(((np.asarray(z) - fg['z0']) / fg['cell']).astype(int), 0, fg['nz'] - 1)
        return fg['grid'][cz, cx]


def strokes(canvas, polylines, width=1.25, opacity=.7):
    """Draw hairs into the atlas. polylines: list of (n, 2) arrays of (pixel x, pixel y); returns coverage (H, W)."""
    acc = np.zeros(canvas.h * canvas.w, dtype=np.float32)
    k = np.arange(-2, 3)
    oy, ox = np.meshgrid(k, k, indexing='ij'); oy = oy.ravel(); ox = ox.ravel()
    for pts, w_px, alpha in polylines:
        if len(pts) < 2:
            continue
        seg = np.diff(pts, axis=0); length = np.linalg.norm(seg, axis=1)
        if length.max() > 40:                          # a jump across a UV seam: not a hair
            continue
        n = np.maximum(2, (length / .5).astype(int))
        xs = np.concatenate([np.linspace(pts[i, 0], pts[i + 1, 0], n[i], endpoint=False) for i in range(len(seg))])
        ys = np.concatenate([np.linspace(pts[i, 1], pts[i + 1, 1], n[i], endpoint=False) for i in range(len(seg))])
        t = np.linspace(0, 1, len(xs))
        taper = np.clip(np.minimum(t / .12, (1 - t) / .45), 0, 1) ** .7          # fine at the root, finer at the tip
        px = np.floor(xs)[:, None] + ox[None, :]; py = np.floor(ys)[:, None] + oy[None, :]
        d2 = (px + .5 - xs[:, None]) ** 2 + (py + .5 - ys[:, None]) ** 2
        a = alpha * taper[:, None] * np.exp(-d2 / (2 * (w_px * width * .5) ** 2))
        ok = (px >= 0) & (px < canvas.w) & (py >= 0) & (py < canvas.h)
        flat = (py[ok].astype(np.int64) * canvas.w + px[ok].astype(np.int64))
        np.maximum.at(acc, flat, a[ok].astype(np.float32))
    return acc.reshape(canvas.h, canvas.w)


# -- landmarks ---------------------------------------------------------------------------
def face_landmarks(G, variant):
    """Measured on the body: the mouth's line and width, the nose tip, the eyes."""
    J = G['joints']; me = G['body'].data
    k = J['head_top'].z / (1.68 if variant == 'female' else 1.80)
    co = C.coords(me)
    eye = (J['eye_L'] + J['eye_R']) / 2
    fsets = C.face_sets(me)
    mouth_ids = set()
    for poly, f in zip(me.polygons, fsets):
        if f == FS['mouth']:
            mouth_ids.update(poly.vertices)
    mp = co[np.array(sorted(mouth_ids))]
    front = mp[np.abs(mp[:, 0]) < .006 * k]
    y_front = float(front[:, 1].min()) if len(front) else eye.y - .035
    z_line = float(front[:, 2].min()) if len(front) else eye.z - .068 * k
    # The line between the lips is the upper lip's free edge (the mouth set's lowest front
    # point); toward the corners it falls a millimetre and a half.
    half = .0245 * k
    curve = np.array([-.0015 * k / (half * half), 0.0, z_line])
    mid = co[(np.abs(co[:, 0]) < .008 * k) & (co[:, 2] > z_line + .012 * k) & (co[:, 2] < eye.z - .012 * k)]
    tip = mid[int(np.argmin(mid[:, 1]))] if len(mid) else np.array([0, y_front - .02, eye.z - .04 * k])
    eyes = G['eyes']
    radius = float(np.mean([np.linalg.norm(np.array(v.co) - np.array(J['eye_L'])) for v in eyes[0].data.vertices]))
    return dict(k=k, eye=np.array(eye, dtype=np.float32), eye_L=np.array(J['eye_L'], dtype=np.float32),
                eye_R=np.array(J['eye_R'], dtype=np.float32), eye_radius=radius, y_front=y_front, z_line=z_line,
                lip_curve=curve, nose_tip=np.array(tip, dtype=np.float32), ears=np.array(J['ears'], dtype=np.float32),
                head_top=float(J['head_top'].z), chin=np.array(J['chin'], dtype=np.float32))


# -- painting ----------------------------------------------------------------------------
def paint(G, P_, variant, maps, hairline=None):
    """Colour, roughness and added relief for every covered texel. Returns dict of (H, W[, 3]) arrays."""
    cv = Canvas(maps)
    P = cv.P; N = cv.N; K = cv.K
    L = face_landmarks(G, variant)
    k = L['k']; eye = L['eye']; fem = variant == 'female'
    J = G['joints']
    m1 = cv.take(maps['m1']); m2 = cv.take(maps['m2']); m3 = cv.take(maps['m3'])
    lip_set, lid, ear = m1[:, 0], m1[:, 1], m1[:, 2]
    tipcap, beard_set, scalp = m2[:, 0], m2[:, 1], m2[:, 2]
    hand, head, foot = m3[:, 0], m3[:, 1], m3[:, 2]
    ao = np.clip(cv.take(maps['ao'])[:, 0], 0, 1)
    curv_img = maps['curv'][..., 0]
    curv = cv.take(curv_img - blur(dilate(curv_img, cv.valid, 10), 6.0))        # local: ridges +, creases -
    curv = np.clip(curv / max(float(np.percentile(np.abs(curv), 98)), 1e-5), -1, 1)

    base = lin(P_['skin'])
    def tone(mult):
        return np.clip(base * np.asarray(mult, dtype=np.float32), 0, 1)
    warm = tone((1.07, .93, .88)); cool = tone((.94, .97, 1.02)); sallow = tone((1.03, 1.0, .86))
    red = lin('#D86A5E' if fem else '#9A5240')
    deep = tone((.62, .44, .38))                       # where light does not reach: darker and redder, never grey
    col = np.tile(base, (K, 1)).astype(np.float32)

    def mix(colour, amount):
        nonlocal col
        a = np.clip(amount, 0, 1)[:, None]
        col = col * (1 - a) + np.asarray(colour, dtype=np.float32) * a

    # Mottling: broad warm and cool patches, then finer blotches.
    n_broad = fbm(P, 38, 3, 1); n_mid = fbm(P, 150, 3, 5); n_fine = fbm(P, 620, 2, 9)
    col = cool * (1 - n_broad[:, None]) + warm * n_broad[:, None]
    mix(tone((.93, .9, .88)), (n_mid - .5) * .5 + .12)
    col *= (1 + (n_fine[:, None] - .5) * .09)

    # Tone zones of a face.
    cheek = np.maximum(blob(P, (.040 * k, eye[1] - .002, eye[2] - .034 * k), (.034 * k, .04 * k, .030 * k), 0),
                       blob(P, (-.040 * k, eye[1] - .002, eye[2] - .034 * k), (.034 * k, .04 * k, .030 * k), 0))
    nose = blob(P, L['nose_tip'] + np.array([0, .008, .004 * k], dtype=np.float32), (.019 * k, .024 * k, .021 * k), .2)
    chin = blob(P, (0, L['y_front'] + .012, L['z_line'] - .034 * k), (.024 * k, .03 * k, .018 * k), .1)
    brow_z = eye[2] + .022 * k
    forehead = head * sstep(P[:, 2], brow_z + .006 * k, brow_z + .03 * k) * sstep(-P[:, 1], -(L['ears'][1] - .02), -(L['ears'][1] - .06))
    mix(red, cheek * (.30 if fem else .13) * (.75 + .5 * n_mid))
    mix(red, nose * (.30 if fem else .22))
    mix(red, chin * (.12 if fem else .06))
    mix(red, ear * (.30 if fem else .2))
    mix(sallow, forehead * .22)
    for s in (-1, 1):
        under = blob(P, (s * .033 * k, eye[1] + .004, eye[2] - .016 * k), (.019 * k, .022 * k, .009 * k), .1)
        mix(tone((.80, .68, .74)), under * (.26 if fem else .3))
        socket = blob(P, (s * .033 * k, eye[1] + .002, eye[2] + .010 * k), (.022 * k, .022 * k, .010 * k), .2)
        mix(tone((.86, .72, .66)), socket * lid * (.34 if fem else .22))

    # Hands, elbows, knees, feet: joints are redder and a little darker.
    joint_red = np.zeros(K, dtype=np.float32)
    for side, s in (('L', 1), ('R', -1)):
        for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb'):
            for j, r in ((1, .011), (2, .008), (3, .0065)):
                c = np.array(J[f'{f}{j}_{side}'], dtype=np.float32)
                joint_red = np.maximum(joint_red, blob(P, c, (r * k,) * 3, .1) * sstep(N[:, 0] * s, -.1, .5))
        joint_red = np.maximum(joint_red, blob(P, np.array(J['elbow_' + side], dtype=np.float32), (.045 * k,) * 3, .1)
                               * sstep(N[:, 1], -.1, .6) * .8)
        joint_red = np.maximum(joint_red, blob(P, np.array(J['knee_' + side], dtype=np.float32) + np.array([0, -.03, .0], dtype=np.float32),
                                               (.05 * k, .05 * k, .06 * k), .1) * sstep(-N[:, 1], .0, .7) * .7)
    mix(red, joint_red * (.26 if fem else .16))
    mix(tone((.9, .82, .8)), joint_red * .15)
    palm = hand * sstep(-N[:, 0] * np.sign(P[:, 0]), .25, .8)
    mix(tone((1.06, .98, .97)), palm * .35)

    # Creases and hollows: darker toward red. Ridges catch a little more light.
    occl = 1 - ao
    mix(deep, np.clip(occl * 1.15, 0, 1) ** 1.25 * .62)
    mix(deep, np.clip(-curv, 0, 1) * .16)
    col *= (1 + np.clip(curv, 0, 1)[:, None] * .045)

    # Freckles for her: a scatter over the nose and cheeks, each its own strength.
    if fem:
        d, ident = cells(P, 520, 31)
        spot = (1 - sstep(d, .10, .30)) * (ident > .62) * ident
        zone = np.clip(nose * .9 + cheek * .9, 0, 1) * head
        mix(tone((.70, .52, .40)), spot * zone * .34)

    # Lips: the vermilion, shaped from the front, on the measured line between the lips.
    w = (.0240 if fem else .0255) * k
    u = P[:, 0] / w
    z_line = np.polyval(L['lip_curve'], P[:, 0])
    dz = P[:, 2] - z_line
    au = np.abs(u)
    hu = (.0072 if fem else .0058) * k * np.clip(1 - au ** 2.2, 0, 1) ** .8 * (1 + .20 * np.exp(-((au - .22) / .12) ** 2) - .12 * np.exp(-(u / .09) ** 2))
    hl = (.0098 if fem else .0088) * k * np.clip(1 - au ** 2.4, 0, 1) ** .7
    edge = .0009 * k
    near_mouth = head * (np.abs(P[:, 1] - L['y_front']) < .028) * (au < 1.06)
    inside = sstep(dz, -hl - edge, -hl + edge) * (1 - sstep(dz, hu - edge, hu + edge))
    lips = inside * near_mouth * (1 - sstep(au, .93, 1.03))
    lip_col = lin(P_['lip'])
    lines = fbm(np.stack([P[:, 0] * 1.0, P[:, 1] * .15, P[:, 2] * .12], axis=1), 2300, 2, 41)
    body_l = lip_col * (.86 + .28 * lines[:, None])
    centre_light = np.exp(-(u / .5) ** 2) * sstep(-dz, .0015 * k, .006 * k)
    body_l = body_l * (1 + .16 * centre_light[:, None])
    mix(body_l, lips * (.9 if fem else .62))
    seam = np.exp(-(dz / (.0011 * k)) ** 2) * near_mouth * (au < 1.0)
    mix(lip_col * .42, seam * .62)
    corner = np.maximum(blob(P, (w, L['y_front'] + .012, float(np.polyval(L['lip_curve'], w))), (.006 * k, .02, .004 * k), .0),
                        blob(P, (-w, L['y_front'] + .012, float(np.polyval(L['lip_curve'], w))), (.006 * k, .02, .004 * k), .0))
    mix(deep, corner * head * .4)
    # Inside the mouth (behind the lips): dark.
    # The mouth's inside has its own tiles (the atlas's lower left): dark, wherever it shows between the lips.
    inner = ((cv.ix < cv.w * .25) & (cv.iy < cv.h * .125)).astype(np.float32)
    mix(lin('#3E1C1C'), inner * .92)

    # Nails: the back of each fingertip, glossy and pale with a lighter free edge.
    nail = tipcap * sstep(N[:, 0] * np.sign(P[:, 0]), .30, .62) * hand
    mix(lin('#F2CFC6' if fem else '#DDB7A8'), nail * .82)

    # Stubble and the crop's fade (him).
    stubble = np.zeros(K, dtype=np.float32)
    if not fem:
        beard = np.maximum(beard_set, blob(P, (0, eye[1] - .01, eye[2] - .078 * k), (.052 * k, .06 * k, .046 * k), .55))
        beard = np.maximum(beard, blob(P, (0, eye[1] - .03, eye[2] - .058 * k), (.024 * k, .03 * k, .008 * k), .4))
        beard = beard * head * (1 - lips) * sstep(-(P[:, 2] - (eye[2] - .028 * k)), 0, .02 * k)
        d, ident = cells(P, 1500, 51)
        dots = (1 - sstep(d, .16, .42)) * (ident > .25)
        stubble = beard * dots
        mix(tone((.72, .74, .80)), beard * .34)
        mix(lin('#231C19'), stubble * .62)
        d2, id2 = cells(P, 1250, 61)
        crop = scalp * (1 - sstep(d2, .2, .5)) * (id2 > .12)
        mix(tone((.66, .62, .62)), scalp * .5)
        mix(lin('#17110E'), crop * .92)

    # The hairline: skin darkens into the hair's shade just under it, with a few fine hairs (drawn below).
    hair_shade = np.zeros(K, dtype=np.float32)
    if hairline is not None and fem:
        hz = hairline(P)
        hair_shade = head * sstep(P[:, 2], hz - .012 * k, hz + .002 * k) * (1 - ear)
        mix(lin(P_['hair']) * 1.25, hair_shade * .5)

    # The lash line and the lid's fold.
    lash = np.zeros(K, dtype=np.float32)
    for c in (L['eye_L'], L['eye_R']):
        r = np.linalg.norm(P - c, axis=1)
        on_margin = np.exp(-((r - L['eye_radius']) / .0011) ** 2) * lid * (np.abs(P[:, 0] - c[0]) < .019 * k)
        upper = sstep(P[:, 2] - c[2], -.001, .003)
        lash = np.maximum(lash, on_margin * (upper * 1.0 + (1 - upper) * .35))
    mix(lin('#2A1D1A' if fem else '#3A2A24'), lash * (.85 if fem else .55))
    if fem:
        for s in (-1, 1):
            shadow = blob(P, (s * .034 * k, eye[1] + .002, eye[2] + .008 * k), (.020 * k, .02 * k, .0085 * k), .2) * lid
            mix(tone((.80, .60, .52)), shadow * .3)

    colour = cv.put(col, 0.0)

    # Brows: hair by hair, on the (x, z) grid of the face's front.
    fg = cv.front_grid(-.085 * k, .085 * k, eye[2] - .01 * k, eye[2] + .05 * k, L['ears'][1] - .02)
    rng = np.random.default_rng(7 if fem else 11)
    hairs = []
    arch = .0068 if fem else .0045; tail = .006 if fem else .004
    def centre(t):
        z = eye[2] + (.0185 + arch * np.sin(np.pi * np.minimum(1.0, t / .72) * .5) - tail * np.maximum(0.0, (t - .72) / .28) ** 1.6) * k
        return (.014 + (.058 - .014) * t) * k, z
    count = 900 if fem else 1050
    for s in (-1, 1):
        for _ in range(count):
            t = rng.beta(1.25, 1.35)
            half = ((.0048 if fem else .0064) * (1 - .62 * t ** 1.25)) * k
            v = rng.uniform(-1, 1)
            x0, zc = centre(t); z0 = zc + v * half
            # Direction: upright and fanning at the inner end, swept along the arch further out;
            # the upper hairs lean down and the lower hairs up, onto the brow's centre line.
            x1, z1 = centre(min(1.0, t + .05)); along = np.array([x1 - x0, z1 - zc]); along /= max(np.linalg.norm(along), 1e-9)
            upright = np.array([.25, 1.0]); upright /= np.linalg.norm(upright)
            mixw = sstep(np.array(t), .0, .34).item()
            d = upright * (1 - mixw) + along * mixw
            d = d + np.array([0.0, -v * .42 * mixw]); d /= np.linalg.norm(d)
            length = ((.0062 if fem else .0072) * (.6 + .5 * rng.random()) * (1 - .35 * t)) * k
            bend = (rng.random() - .35) * .5 * mixw
            pts = []
            for q in np.linspace(0, 1, 6):
                dd = d + np.array([q * bend * .6, -q * bend]); dd /= np.linalg.norm(dd)
                pts.append((x0 + dd[0] * length * q, z0 + dd[1] * length * q))
            pts = np.array(pts); pts[:, 0] *= s
            ids = cv.lookup(fg, pts[:, 0], pts[:, 1])
            if (ids < 0).any():
                continue
            pix = np.stack([cv.ix[ids] + .5, cv.iy[ids] + .5], axis=1).astype(np.float32)
            hairs.append((pix, .8 if fem else .95, (.34 + .36 * rng.random()) * (1 - .25 * t)))
    brow = strokes(cv, hairs, width=1.25)
    brow_soft = blur(brow, 3.0)
    brow_col = lin('#4A3222' if fem else '#19120E')
    a = np.clip(brow * .8 + brow_soft * 1.5, 0, .93)[..., None]
    colour = colour * (1 - a) + brow_col * a

    # Fine hairs at her hairline (temples and forehead), so the hair does not start as an edge.
    if hairline is not None and fem:
        fg2 = cv.front_grid(-.09 * k, .09 * k, eye[2] + .03 * k, eye[2] + .11 * k, L['ears'][1] + .0)
        wisps = []
        for _ in range(520):
            x = rng.uniform(-.074, .074) * k
            zline = float(hairline(np.array([[x, L['y_front'], 0.0]], dtype=np.float32))[0])
            z0 = zline - rng.uniform(.0, .009) * k
            length = rng.uniform(.006, .014) * k
            lean = (x / (.074 * k)) * .7 + rng.normal(0, .18)
            q = np.linspace(0, 1, 5)
            pts = np.stack([x + lean * length * q * .6, z0 + length * q], axis=1)
            ids = cv.lookup(fg2, pts[:, 0], pts[:, 1])
            if (ids < 0).any():
                continue
            pix = np.stack([cv.ix[ids] + .5, cv.iy[ids] + .5], axis=1).astype(np.float32)
            wisps.append((pix, .9, .35 + .3 * rng.random()))
        wisp = strokes(cv, wisps, width=1.2)
        a = np.clip(wisp, 0, 1)[..., None] * .8
        colour = colour * (1 - a) + (lin(P_['hair']) * 1.1) * a

    # Roughness.
    rough = np.full(K, .50 if fem else .54, dtype=np.float32)
    tzone = np.clip(nose * .9 + forehead * .55 + chin * .35, 0, 1)
    rough -= tzone * .13
    rough -= cheek * .04
    rough += (n_fine - .5) * .08
    rough += np.clip(occl, 0, 1) * .10
    rough = rough * (1 - lips) + (.28 if fem else .36) * lips
    rough = rough * (1 - nail) + .18 * nail
    rough += stubble * .12
    rough = np.clip(rough, .12, .9)

    # Added relief (a height field in metres-ish units, differenced in the atlas): fine grain,
    # the lips' vertical lines, knuckle creases, stubble.
    grain = fbm(P, 1150, 2, 71) - .5
    height = grain * (.42 + .25 * head) * (1 - lips) * (1 - nail)
    height += (lines - .5) * 1.6 * lips
    d3, _ = cells(P, 900, 81)
    height += (sstep(d3, .0, .5) - .6) * .5 * joint_red
    height += stubble * .9
    return dict(canvas=cv, colour=colour, rough=cv.put(rough, .5), ao=cv.put(ao, 1.0), height=cv.put(height, 0.0),
                brow=brow, landmarks=L)


def compose_normal(tan, height, valid, strength=.5):
    """The sculpt's tangent normal with the painted height's slope added."""
    h = dilate(height, valid, 6)
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * .5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * .5
    n = tan * 2 - 1
    n[..., 0] -= dx * strength; n[..., 1] -= dy * strength
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    return n * .5 + .5


def occlusion_group():
    """The node group the glTF exporter reads a material's occlusion from."""
    name = 'glTF Material Output'
    g = bpy.data.node_groups.get(name)
    if g is None:
        g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g.nodes.new('NodeGroupInput')
    return g


def skin_material(variant, colour, normal, orm, base_hex):
    mat = bpy.data.materials.new(f'Golfer v3 {variant} | skin')
    mat.use_nodes = True; nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    ct = nt.nodes.new('ShaderNodeTexImage'); ct.image = colour; nt.links.new(uvn.outputs['UV'], ct.inputs['Vector'])
    nt.links.new(ct.outputs['Color'], b.inputs['Base Color'])
    ntx = nt.nodes.new('ShaderNodeTexImage'); ntx.image = normal; nt.links.new(uvn.outputs['UV'], ntx.inputs['Vector'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'; nm.inputs['Strength'].default_value = 1.0
    nt.links.new(ntx.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    ot = nt.nodes.new('ShaderNodeTexImage'); ot.image = orm; nt.links.new(uvn.outputs['UV'], ot.inputs['Vector'])
    sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(ot.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    grp = nt.nodes.new('ShaderNodeGroup'); grp.node_tree = occlusion_group()
    nt.links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    b.inputs['Metallic'].default_value = 0.0
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = .42
    mat.diffuse_color = (*C.lin(C.hexrgb(base_hex)), 1.0)
    return mat


def build(G, P_, variant, hairline=None):
    """Bake, paint and assign the skin. Returns the material and a small report."""
    maps = bake_maps(G, variant)
    out = paint(G, P_, variant, maps, hairline)
    cv = out['canvas']
    colour = dilate(out['colour'], cv.valid, 16)
    colour_img = TX.to_image(f'Golfer v3 {variant} | skin colour', colour)
    normal = compose_normal(maps['tan'], out['height'], cv.valid)
    normal_img = TX.to_image(f'Golfer v3 {variant} | skin normal', normal.astype(np.float32), non_color=True)
    bpy.data.images.remove(maps['normal_image'])
    orm = np.stack([dilate(out['ao'], cv.valid, 16), dilate(out['rough'], cv.valid, 16), np.zeros_like(out['rough'])], axis=-1)
    orm_img = TX.to_image(f'Golfer v3 {variant} | skin orm', orm.astype(np.float32), non_color=True)
    me = G['body'].data
    layer = maps['layer']
    me.uv_layers.active = layer; layer.active_render = True
    old = me.uv_layers.get('UVMap')
    if old is not None and old != layer:
        me.uv_layers.remove(old)
    me.uv_layers[0].name = 'UVMap'
    mat = skin_material(variant, colour_img, normal_img, orm_img, P_['skin'])
    me.materials.clear(); me.materials.append(mat)
    report = dict(texels=int(cv.K), multires_level=maps['multires_level'],
                  ao_mean=round(float(out['ao'][cv.valid].mean()), 3), brow_px=int((out['brow'] > .2).sum()))
    print('SKIN', report)
    return dict(material=mat, report=report, landmarks=out['landmarks'])
