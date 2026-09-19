"""Banvy's pin flag, baked in Blender for the app.

The app's flag -- 0.78 x 0.5 m of cloth on a 2.6 m stick, hoist on the pole's
surface -- simulated as cloth in a wind field once per WIND BAND, each band cut
into a seamless loop and written as JSON for tools/build-flag-cloth.mjs to pack
into apps/golf/public/models/flag/. The app plays the band nearest the live
wind and crossfades between them (engine/flag-cloth.mjs).

Every band is CALIBRATED against the golfer's reading of a flag, the same rule
the app used before the bake: about four degrees of flag per mph, nine per m/s
-- limp in calm, 45 deg in 5 m/s, straight out from 10. Blender's wind strength
is not a speed; the hang it produces is what is matched. MODE='calibrate'
sweeps strengths and prints the hang each one gives, so the table below is a
measurement, not a guess.

Three things a flat cloth in Blender needs before it will fly at all, each
learned the hard way in the first study:
  - a crumple: a perfectly flat vertical sheet never leaves its plane, because
    gravity and a wind along it both act IN the plane -- and the crumple must
    be only the STARTING shape, never the rest shape: Blender takes a cloth's
    rest angles from its mesh, so a crumpled mesh keeps its crumples for ever
    and every edge comes out serrated like foil. A flat shape key is the rest;
  - wind a few degrees off the flag's axis: Blender's wind pushes only through
    face normals, so wind exactly along the sheet pushes nothing;
  - turbulence: the life in a real flag is gusty air.

Run it in a live Blender over the 9876 bridge (prepend MODE / OUT globals) or
headless:
    blender --background --python tools/blender-flag/bake_flag_cloth.py
It builds its own scene ('Banvy flag bake') and touches nothing else.
Coordinates written are the APP's flag-local frame: x along the fly from the
pole's axis, y up from the pole's foot, z the lateral (Blender's -y)."""
import bpy, math, time, json, os

MODE = globals().get('MODE', 'bake')
OUT = globals().get('OUT') or os.path.join(os.path.dirname(os.path.abspath(globals().get('__file__', '.'))), 'cache', 'flag-bake.json')

SCENE = 'Banvy flag bake'
NX, NZ = 17, 11                  # the EXPORTED grid: 16 x 10 cells, ~4.9 x 5 cm
# Simulated on the exported grid. Twice as fine was tried and hangs beautifully
# limp, but Blender damps air PER VERTEX, so its four times lighter vertices
# were damped four times harder and the flag never flapped (free edge 2-6 cm/s
# at a 45 deg hang, against 1-4 Hz of real flapping on this grid).
STRIDE = globals().get('STRIDE', 1)
SNX, SNZ = (NX - 1) * STRIDE + 1, (NZ - 1) * STRIDE + 1
W, H, X0, TOP = 0.78, 0.5, 0.045, 2.53
# Blender's cloth mass is PER VERTEX: a finer grid must carry less per vertex
# or the flag grows heavier. Scaled so the total stays that of the 17 x 11 grid.
MASS = globals().get('MASS', 0.05 * 187 / (SNX * SNZ))
NOISE = globals().get('NOISE', 0.6)          # wind noise: the eddies that ripple a flag
TSIZE = globals().get('TSIZE', 0.6)          # turbulence cell size
FPS, SETTLE, RECORD = 30, 150, 330
LOOP, CROSS, STEP = 120, 24, 2   # a 4 s loop at 30 fps, 0.8 s crossfade, kept at 15 fps
RULE_DEG_PER_MS = 8.95           # four degrees per mph

# One simulation per band: Blender wind strength and turbulence, plus any
# cloth or air setting that band overrides -- chosen with MODE='calibrate'.
# Even calm air needs a little turbulence, or the flag never leaves the plane
# it started in and hangs half-extended; a light wind needs less air damping
# and small, strong turbulence, or the cloth settles into one fold and freezes
# -- a still flag at 45 deg reads as sheet metal, not cloth. Calibrated at the
# shared spot (below), 2026-09-19, flat rest shape, bending 0.003:
#   band      hang   free-edge speed   tail rhythm   tail swing
#   calm       3.6      0.016 m/s        --            7 cm
#   light     17.7      0.158            0.18 Hz      18
#   gentle    28.3      0.144            0.27         18
#   moderate  41.2      0.130            0.43         12
#   brisk     52.5      0.145            0.86          9
#   fresh     60.7      0.404            0.50         20
#   strong    73.7      1.200            1.00         46
#   gale      87.6      3.629            3.14         36
BANDS = [
    {'name': 'calm', 'strength': 0, 'turbulence': 20, 'air': 0.3, 'tsize': 0.4},
    {'name': 'light', 'strength': 200, 'turbulence': 150, 'air': 0.3, 'tsize': 0.4},
    {'name': 'gentle', 'strength': 450, 'turbulence': 250, 'air': 0.3, 'tsize': 0.4},
    {'name': 'moderate', 'strength': 480, 'turbulence': 300, 'air': 0.25, 'tsize': 0.4},
    {'name': 'brisk', 'strength': 550, 'turbulence': 250, 'air': 0.35, 'tsize': 0.4},
    {'name': 'fresh', 'strength': 800, 'turbulence': 350, 'air': 0.4, 'tsize': 0.5},
    {'name': 'strong', 'strength': 1000, 'turbulence': 400, 'air': 0.4, 'tsize': 0.5},
    {'name': 'gale', 'strength': 6000, 'turbulence': 900},
]


def fresh_scene():
    old = bpy.data.scenes.get(SCENE)
    if old:
        bpy.data.scenes.remove(old)
    for o in [o for o in bpy.data.objects if o.name.startswith('Bake ')]:
        bpy.data.objects.remove(o, do_unlink=True)
    for m in [m for m in bpy.data.meshes if m.name.startswith('bake ')]:
        bpy.data.meshes.remove(m)
    for c in [c for c in bpy.data.collections if c.name.startswith('bake ')]:
        bpy.data.collections.remove(c)
    sc = bpy.data.scenes.new(SCENE)
    if bpy.context.window:
        bpy.context.window.scene = sc
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, SETTLE + RECORD
    sc.use_gravity = True
    sc.gravity = (0.0, 0.0, -9.81)
    return sc


def effector(sc, coll, kind, name, location, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.object.effector_add(type=kind, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    for c in list(o.users_collection):
        c.objects.unlink(o)
    coll.objects.link(o)
    return o


def build_flag(sc, spec, x_offset):
    tag, strength, turbulence = spec['name'], spec['strength'], spec['turbulence']
    coll = bpy.data.collections.new(f'bake {tag}')
    sc.collection.children.link(coll)
    verts = [(x_offset + X0 + W * i / (SNX - 1),
              0.015 * (i / (SNX - 1)) * math.sin(i * 0.85 + j * 1.15),  # the crumple
              TOP - H * j / (SNZ - 1)) for j in range(SNZ) for i in range(SNX)]
    faces = [(j * SNX + i, j * SNX + i + 1, (j + 1) * SNX + i + 1, (j + 1) * SNX + i)
             for j in range(SNZ - 1) for i in range(SNX - 1)]
    me = bpy.data.meshes.new(f'bake {tag}')
    me.from_pydata(verts, [], faces)
    me.update()
    flag = bpy.data.objects.new(f'Bake {tag}', me)
    coll.objects.link(flag)
    flag.vertex_groups.new(name='hoist').add([j * SNX for j in range(SNZ)], 1.0, 'REPLACE')
    # the crumple is where the cloth STARTS; it rests flat (see the docstring)
    flag.shape_key_add(name='Basis')
    flat = flag.shape_key_add(name='flat', from_mix=False)
    for v in flat.data:
        v.co.y = 0.0
    cm = flag.modifiers.new('Cloth', 'CLOTH')
    cs = cm.settings
    cs.quality = 10
    cs.mass = spec.get('mass', MASS)
    cs.air_damping = spec.get('air', 1.0)
    cs.tension_stiffness = 20
    cs.compression_stiffness = 20
    cs.shear_stiffness = 5
    cs.bending_stiffness = spec.get('bending', 0.003)     # soft nylon: it must fold, not buckle
    cs.vertex_group_mass = 'hoist'
    cs.rest_shape_key = flat
    cs.pin_stiffness = 1.0
    cm.collision_settings.use_self_collision = False
    cm.point_cache.frame_start, cm.point_cache.frame_end = 1, sc.frame_end
    wind = effector(sc, coll, 'WIND', f'Bake {tag} wind', (x_offset - 1.5, 0.0, 2.3),
                    (0.0, math.radians(90), math.radians(6)))     # +X, 6 deg off the sheet
    wind.field.strength = strength
    wind.field.noise = spec.get('noise', NOISE)
    wind.field.seed = 7
    turb = effector(sc, coll, 'TURBULENCE', f'Bake {tag} turbulence', (x_offset + 0.4, 0.0, 2.3))
    turb.field.strength = turbulence
    turb.field.size = spec.get('tsize', TSIZE)
    turb.field.seed = 11
    cs.effector_weights.collection = coll           # each flag feels only its own air
    return flag


def record(sc, flags, x_offsets):
    """Every frame after the settle, every flag, in the app's flag-local frame,
    on the exported grid (every STRIDE-th simulated vertex)."""
    dg = sc.view_layers[0].depsgraph                # this scene's own evaluation
    keep = [j * STRIDE * SNX + i * STRIDE for j in range(NZ) for i in range(NX)]
    out = [[] for _ in flags]
    sc.frame_set(1)
    for fr in range(1, sc.frame_end + 1):
        sc.frame_set(fr)
        if fr <= SETTLE:
            continue
        for k, f in enumerate(flags):
            ev = f.evaluated_get(dg)
            m = ev.to_mesh()
            ox = x_offsets[k]
            flat = []
            vs = m.vertices
            for n in keep:
                v = vs[n].co
                flat.extend((v.x - ox, v.z, -v.y))
            out[k].append(flat)
            ev.to_mesh_clear()
    return out


def hang_and_azimuth(frame):
    hx = hy = hz = fx = fy = fz = 0.0
    for j in range(NZ):
        h, f = 3 * (j * NX), 3 * (j * NX + NX - 1)
        hx += frame[h]; hy += frame[h + 1]; hz += frame[h + 2]
        fx += frame[f]; fy += frame[f + 1]; fz += frame[f + 2]
    dx, dy, dz = (fx - hx) / NZ, (fy - hy) / NZ, (fz - hz) / NZ
    return math.degrees(math.atan2(math.hypot(dx, dz), -dy)), math.atan2(dz, dx), dz


def edge_speeds(frames):
    """the mean speed of the free edge between consecutive frames, per frame"""
    fly = [3 * (j * NX + NX - 1) for j in range(NZ)]
    out = [0.0]
    for f, g in zip(frames, frames[1:]):
        out.append(sum(math.dist(f[i:i + 3], g[i:i + 3]) for i in fly) / NZ * FPS)
    return out


def seamless_loop(frames):
    """The LOOP-frame window whose end best meets its start, the last CROSS
    frames crossfaded into the frames just before it, so t = LOOP-1 runs into
    t = 0 with no seam. Kept every STEP-th frame.
    Only windows that move at least 90% as much as the band does on AVERAGE
    are considered: the best seam on its own picks the STILLEST four seconds --
    stillness loops most easily -- and the first bake's light and moderate
    winds came out a tenth as lively as their simulations. The average, not the
    median, because a flag in a moderate wind moves in bursts: its median
    window is a still one."""
    speed = edge_speeds(frames)
    starts = list(range(CROSS, len(frames) - LOOP))
    motion = {a: sum(speed[a:a + LOOP]) / LOOP for a in starts}
    typical = sum(motion.values()) / len(motion)
    best = None
    for a in starts:
        if motion[a] < 0.9 * typical:
            continue
        d = sum((p - q) ** 2 for p, q in zip(frames[a], frames[a + LOOP]))
        if best is None or d < best[0]:
            best = (d, a)
    err, a = best
    loop = []
    for t in range(LOOP):
        f = frames[a + t]
        if t >= LOOP - CROSS:
            w = (t - (LOOP - CROSS) + 1) / (CROSS + 1)
            w = w * w * (3 - 2 * w)
            g = frames[a + t - LOOP]
            f = [p * (1 - w) + q * w for p, q in zip(f, g)]
        loop.append(f)
    return loop[::STEP], a, math.sqrt(err / (NX * NZ))


def smooth_grid(loop, rounds=2, lam=0.5, mu=-0.53):
    """Taubin smoothing on every frame: a cloth soft enough to fold is soft
    enough to zigzag at the scale of one grid cell, and 5 cm serrations along
    a free edge read as crumpled foil, not nylon. Taubin's shrink-free pair of
    passes takes the zigzag and keeps the folds and the outline. The hoist
    stays pinned, the fly corners stay put, and an edge is smoothed only ALONG
    itself, so the flag keeps its size."""
    def neighbours(i, j):
        if i == 0 or (i == NX - 1 and j in (0, NZ - 1)):
            return None                                   # pinned hoist, fly corners
        if j in (0, NZ - 1):
            return [(i - 1, j), (i + 1, j)]               # top and bottom edges
        if i == NX - 1:
            return [(i, j - 1), (i, j + 1)]               # the free edge
        return [(i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1)]
    nb = [neighbours(n % NX, n // NX) for n in range(NX * NZ)]
    out = []
    for frame in loop:
        f = list(frame)
        for _ in range(rounds):
            for w in (lam, mu):
                g = list(f)
                for n, ns in enumerate(nb):
                    if not ns:
                        continue
                    for c in range(3):
                        avg = sum(f[3 * (b * NX + a) + c] for a, b in ns) / len(ns)
                        g[3 * n + c] = f[3 * n + c] + w * (avg - f[3 * n + c])
                f = g
        out.append(f)
    return out


def straighten(loop):
    """Blender's wind came 6 deg off the axis; the app points the flag by the
    reading, so take out each band's own mean azimuth about the pole."""
    a = sum(hang_and_azimuth(f)[1] for f in loop) / len(loop)
    if sum(hang_and_azimuth(f)[0] for f in loop) / len(loop) < 15:
        return loop, 0.0          # a limp flag points nowhere: turning it would only drag the hoist round the pole
    c, s = math.cos(a), math.sin(a)
    out = []
    for f in loop:
        g = list(f)
        for i in range(0, len(g), 3):
            x, z = g[i], g[i + 2]
            g[i], g[i + 2] = x * c + z * s, -x * s + z * c
        out.append(g)
    return out, math.degrees(a)


def stats(loop, dt):
    """What the eye reads off a flag: its hang, how fast its free edge moves,
    and the rhythm of its tail corners (an edge AVERAGE hides ripples that
    run in opposite directions along it)."""
    hangs = [hang_and_azimuth(f)[0] for f in loop]
    fly = [3 * (j * NX + NX - 1) for j in range(NZ)]
    speeds = []
    for f, g in zip(loop, loop[1:]):
        speeds.append(sum(math.dist(f[i:i + 3], g[i:i + 3]) for i in fly) / NZ / dt)
    hz = []
    for corner in (fly[0], fly[-1]):
        lat = [f[corner + 2] for f in loop]
        mean = sum(lat) / len(lat)
        hz.append(sum(1 for p, q in zip(lat, lat[1:]) if (p - mean) * (q - mean) < 0) / 2 / (len(loop) * dt))
    tip = [f[fly[-1] + 2] for f in loop]
    return {'hangDeg': round(sum(hangs) / len(hangs), 2), 'hangMinDeg': round(min(hangs), 2),
            'hangMaxDeg': round(max(hangs), 2), 'edgeSpeedMs': round(sum(speeds) / len(speeds), 3),
            'tailHz': round(sum(hz) / 2, 2), 'tailSwingM': round((max(tip) - min(tip)) / 2, 3),
            'lowestY': round(min(f[i] for f in loop for i in range(1, len(f), 3)), 3)}


t0 = time.time()
sc = fresh_scene()
if MODE == 'calibrate':
    # a list of band-like dicts, each a candidate simulation
    specs = [dict(c, name=c.get('name', f"c{k}")) for k, c in enumerate(globals().get('CAL', BANDS))]
else:
    specs = BANDS
# Every flag at the SAME spot: Blender's wind and turbulence noise depend on
# position, and this regime is chaotic -- a spec that flaps at one spot can
# freeze at another. They never touch (no collisions; each feels only its own
# collection's air), so sharing the spot is what makes a calibration hold.
offsets = [0.0] * len(specs)
flags = [build_flag(sc, spec, offsets[k]) for k, spec in enumerate(specs)]
frames = record(sc, flags, offsets)

if MODE == 'calibrate':
    rows = []
    for spec, fr in zip(specs, frames):
        st = stats(fr, 1 / FPS)
        rows.append({**{k: v for k, v in spec.items()}, **st, 'ruleMs': round(st['hangDeg'] / RULE_DEG_PER_MS, 2)})
    print(json.dumps({'seconds': round(time.time() - t0, 1), 'rows': rows}))
else:
    bands = []
    for spec, fr in zip(specs, frames):
        loop, start, seam = seamless_loop(fr)
        loop, azimuth = straighten(smooth_grid(loop))
        st = stats(loop, STEP / FPS)
        bands.append({**spec, 'ms': 0.0 if spec['strength'] == 0 else round(st['hangDeg'] / RULE_DEG_PER_MS, 2),
                      **st, 'azimuthRemovedDeg': round(azimuth, 2), 'loopStartFrame': SETTLE + 1 + start,
                      'loopSeamRmsM': round(seam, 4),
                      'frames': [[round(v, 5) for v in f] for f in loop]})
    doc = {'format': 'banvy-flag-bake-v1', 'blender': bpy.app.version_string,
           'grid': {'nx': NX, 'nz': NZ, 'width': W, 'height': H, 'hoistX': X0, 'top': TOP},
           'fps': FPS // STEP, 'frames': LOOP // STEP, 'ruleDegPerMs': RULE_DEG_PER_MS,
           'cloth': {'quality': 10, 'massPerVertex': MASS, 'simGrid': [SNX, SNZ], 'airDamping': 1.0, 'tension': 20, 'compression': 20,
                     'shear': 5, 'bending': 0.003, 'restShape': 'flat shape key', 'crumpleM': 0.01, 'windYawDeg': 6, 'windNoise': NOISE,
                     'turbulenceSize': TSIZE, 'settleFrames': SETTLE, 'recordFrames': RECORD, 'crossfadeFrames': CROSS},
           'bands': bands}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh)
    print(json.dumps({'seconds': round(time.time() - t0, 1), 'out': OUT,
                      'bands': [{k: v for k, v in b.items() if k != 'frames'} for b in bands]}))
