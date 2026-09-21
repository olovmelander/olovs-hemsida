"""Banvy's pin flag, baked in Blender for the app.

The app's flag -- 0.78 x 0.5 m of cloth on a 2.6 m stick, hoist on the pole's
surface -- simulated as cloth in a wind field once per WIND BAND, each band cut
into a seamless loop and written as JSON for tools/build-flag-cloth.mjs to pack
into apps/golf/public/models/flag/. The app blends adjacent measured wind
states with smooth interpolation (engine/flag-cloth.mjs).

The lower bands are art-calibrated against the golfer's reading of a flag,
the app used before the bake: about four degrees of flag per mph, nine per m/s
-- limp in calm, 45 deg in 5 m/s, straight out from 10. Blender's wind strength
is not a speed; the hang it produces is what is matched. MODE='calibrate'
sweeps strengths and prints the hang each one gives, so the table below is a
measurement of the animation. Beyond full extension, explicit 16 and 24 m/s
states vary the flutter instead. This is a visual model, not an anemometer.

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
It builds its own scene ('Banvy flag refinement') and touches nothing else.
Coordinates written are the APP's flag-local frame: x along the fly from the
pole's axis, y up from the pole's foot, z the lateral (Blender's -y)."""
import bpy, math, time, json, os
import numpy as np

MODE = globals().get('MODE', 'bake')
OUT = globals().get('OUT') or os.path.join(os.path.dirname(os.path.abspath(globals().get('__file__', '.'))), 'cache', 'flag-bake.json')

SCENE = 'Banvy flag refinement'
PREFIX = 'Flag refinement '
NX, NZ = globals().get('NX', 25), globals().get('NZ', 17)
# Simulate on the exported grid, scaling both mass and air damping with vertex
# count. Moving turbulence keeps light winds from settling into frozen folds.
STRIDE = globals().get('STRIDE', 1)
SNX, SNZ = (NX - 1) * STRIDE + 1, (NZ - 1) * STRIDE + 1
W, H, X0, TOP = 0.78, 0.5, 0.024, 2.53
# Blender's cloth mass is PER VERTEX: a finer grid must carry less per vertex
# or the flag grows heavier. Scaled so the total stays that of the 17 x 11 grid.
MASS = globals().get('MASS', 0.05 * 187 / (SNX * SNZ))
NOISE = globals().get('NOISE', 0.6)          # wind noise: the eddies that ripple a flag
TSIZE = globals().get('TSIZE', 0.6)          # turbulence cell size
FPS = 30
SETTLE, RECORD = globals().get('SETTLE', 210), globals().get('RECORD', 480)
LOOP, CROSS, STEP = 180, 36, 1   # six seconds, retain every simulated frame
RULE_DEG_PER_MS = 8.95           # four degrees per mph

# One simulation per band: Blender wind strength and turbulence, plus any
# cloth or air setting that band overrides -- chosen with MODE='calibrate'.
# A broad initial fold lets calm cloth fall under gravity without turbulence.
# A light wind needs less air damping
# and small, strong turbulence, or the cloth settles into one fold and freezes
# -- a still flag at 45 deg reads as sheet metal, not cloth. The export records
# measured hang, speed and flutter for every band; audit-cloth.mjs verifies the
# packed artifact. A shared simulation position keeps the noise reproducible.
BANDS = [
    {'name': 'calm', 'strength': 0, 'turbulence': 0, 'air': 1, 'bending': 0.03, 'broadFold': True, 'staticRest': True},
    {'name': 'light', 'strength': 80, 'turbulence': 6, 'air': 0.8, 'tsize': 0.8, 'noise': 0.1, 'bending': 0.03, 'broadFold': True},
    # One coherent low-wind shape avoids blending several differently folded
    # sheets over a narrow speed range. Lift into moderate wind is continuous.
    # Keep the broad fold on the same side as the light-wind drape. Opposite
    # fold handedness cancels triangles during blending and makes them snap.
    {'name': 'moderate', 'strength': 480, 'turbulence': 60, 'air': 0.5, 'tsize': 0.8, 'noise': 0.15, 'bending': 0.02, 'broadFold': True, 'mirrorZ': True},
    {'name': 'gale', 'strength': 6000, 'turbulence': 900},
    {'name': 'strong-gale', 'strength': 12000, 'turbulence': 1000, 'ms': 16},
    {'name': 'storm', 'strength': 22000, 'turbulence': 1200, 'ms': 24},
]


def fresh_scene():
    old = bpy.data.scenes.get(SCENE)
    if old:
        bpy.data.scenes.remove(old)
    for o in [o for o in bpy.data.objects if o.name.startswith(PREFIX)]:
        bpy.data.objects.remove(o, do_unlink=True)
    for m in [m for m in bpy.data.meshes if m.name.startswith(PREFIX)]:
        bpy.data.meshes.remove(m)
    for c in [c for c in bpy.data.collections if c.name.startswith(PREFIX)]:
        bpy.data.collections.remove(c)
    sc = bpy.data.scenes.new(SCENE)
    if bpy.context.window:
        bpy.context.window.scene = sc
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, SETTLE + RECORD
    sc.use_gravity = True
    sc.gravity = (0.0, 0.0, -9.81)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.020, depth=2.6, location=(0, 0, 1.3))
    pole = bpy.context.object
    pole.name = PREFIX + 'collision pole'
    pole.data.name = PREFIX + 'collision pole'
    pole.modifiers.new('Pole collision', 'COLLISION')
    pole.collision.thickness_outer = 0.001
    pole.collision.cloth_friction = 3.0
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
    coll = bpy.data.collections.new(f'{PREFIX}{tag}')
    sc.collection.children.link(coll)
    verts = [(x_offset + X0 + W * i / (SNX - 1),
              (0.05 * (i / (SNX - 1)) * math.sin(2 * math.pi * i / (SNX - 1) + math.pi * j / (SNZ - 1) * 0.5)
               if spec.get('broadFold') else 0.015 * (i / (SNX - 1)) * math.sin(i * 0.85 + j * 1.15)),
              TOP - H * j / (SNZ - 1)) for j in range(SNZ) for i in range(SNX)]
    faces = [(j * SNX + i, j * SNX + i + 1, (j + 1) * SNX + i + 1, (j + 1) * SNX + i)
             for j in range(SNZ - 1) for i in range(SNX - 1)]
    me = bpy.data.meshes.new(f'{PREFIX}{tag}')
    me.from_pydata(verts, [], faces)
    me.update()
    flag = bpy.data.objects.new(f'{PREFIX}{tag}', me)
    coll.objects.link(flag)
    flag.vertex_groups.new(name='hoist').add([j * SNX for j in range(SNZ)], 1.0, 'REPLACE')
    # the crumple is where the cloth STARTS; it rests flat (see the docstring)
    flag.shape_key_add(name='Basis')
    flat = flag.shape_key_add(name='flat', from_mix=False)
    for v in flat.data:
        v.co.y = 0.0
    cm = flag.modifiers.new('Cloth', 'CLOTH')
    cs = cm.settings
    cs.quality = 12
    cs.mass = spec.get('mass', MASS)
    cs.air_damping = spec.get('air', 1.0) * 187 / (SNX * SNZ)
    cs.tension_stiffness = 20
    cs.compression_stiffness = 20
    cs.shear_stiffness = 5
    cs.bending_stiffness = spec.get('bending', 0.003)     # soft nylon: it must fold, not buckle
    # Doubled fabric at the hoist and turned hems resists bending more than the
    # single-layer field. The fly remains soft enough for small travelling folds.
    hems = flag.vertex_groups.new(name='sewn hems')
    for j in range(SNZ):
        for i in range(SNX):
            u, v = i / (SNX - 1), j / (SNZ - 1)
            weight = max(max(0, 1-u/0.08),
                         0.6 * max(0, 1-min(v,1-v)/0.05),
                         0.4 * max(0, 1-(1-u)/0.05))
            if weight > 0: hems.add([j*SNX+i], weight, 'REPLACE')
    cs.vertex_group_bending = hems.name
    cs.bending_stiffness_max = max(0.012, cs.bending_stiffness * 2)
    cs.vertex_group_mass = 'hoist'
    cs.rest_shape_key = flat
    cs.pin_stiffness = 1.0
    cm.collision_settings.use_self_collision = True
    cm.collision_settings.distance_min = 0.003
    cm.collision_settings.self_distance_min = 0.003
    cm.collision_settings.self_friction = 2.0
    cm.point_cache.frame_start, cm.point_cache.frame_end = 1, sc.frame_end
    wind = effector(sc, coll, 'WIND', f'{PREFIX}{tag} wind', (x_offset - 1.5, 0.0, 2.3),
                    (0.0, math.radians(90), math.radians(6)))     # +X, 6 deg off the sheet
    wind.field.strength = strength
    wind.field.noise = spec.get('noise', NOISE)
    wind.field.seed = 7
    turb = effector(sc, coll, 'TURBULENCE', f'{PREFIX}{tag} turbulence', (x_offset + 0.4, 0.0, 2.3))
    turb.field.strength = turbulence
    turb.field.size = spec.get('tsize', TSIZE)
    turb.field.seed = 11
    # Advect the eddies and vary the wind gently. A fixed turbulence field can
    # settle light cloth into one frozen fold, even with low air damping.
    for frame in (range(1, sc.frame_end + 13, 12) if strength > 0 else []):
        t = (frame - 1) / FPS
        wind.field.strength = strength * (1 + 0.13 * math.sin(t * 1.7) + 0.06 * math.sin(t * 3.13 + 0.8))
        wind.field.keyframe_insert(data_path='strength', frame=frame)
        wind.rotation_euler.z = math.radians(6 + 3 * math.sin(t * 1.13) + 1.5 * math.sin(t * 2.37))
        wind.keyframe_insert(data_path='rotation_euler', frame=frame)
        turb.location.x = x_offset + 0.4 + t * 0.18
        turb.location.y = 0.16 * math.sin(t * 0.9)
        turb.keyframe_insert(data_path='location', frame=frame)
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
        if fr % 30 == 0:
            os.makedirs(os.path.dirname(OUT), exist_ok=True)
            with open(OUT + '.progress.json', 'w') as progress:
                json.dump({'frame': fr, 'total': sc.frame_end, 'seconds': round(time.time() - t0, 1)}, progress)
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


def blend_constraints():
    """Disjoint edge sets let NumPy solve structural/shear constraints in place."""
    groups = [[] for _ in range(8)]
    for j in range(NZ):
        for i in range(NX):
            a = j * NX + i
            if i + 1 < NX: groups[i % 2].append((a, a + 1))
            if j + 1 < NZ: groups[2 + j % 2].append((a, a + NX))
            if i + 1 < NX and j + 1 < NZ:
                groups[4 + j % 2].append((a, a + NX + 1))
                groups[6 + j % 2].append((a + 1, a + NX))
    return [np.array(g, dtype=np.int32) for g in groups]


BLEND_EDGES = blend_constraints()


def relax_blend(frame, first, second, weight):
    """Preserve the two source poses' local fabric metric during a loop blend.
    A plain position crossfade can erase half the cloth area when folds oppose.
    The hoist has zero inverse mass; the source edge lengths include simulation
    strain rather than forcing the cloth to a new idealized rectangular shape.
    """
    p = np.array(frame).reshape((-1, 3))
    a, b = np.array(first).reshape((-1, 3)), np.array(second).reshape((-1, 3))
    inverse = np.ones(NX * NZ); inverse[::NX] = 0
    targets = [(1-weight)*np.linalg.norm(a[e[:,1]]-a[e[:,0]],axis=1)
               + weight*np.linalg.norm(b[e[:,1]]-b[e[:,0]],axis=1) for e in BLEND_EDGES]
    for _ in range(14):
        for edges, target in zip(BLEND_EDGES, targets):
            left, right = edges[:,0], edges[:,1]
            delta = p[right]-p[left]
            length = np.maximum(np.linalg.norm(delta, axis=1), 1e-9)
            total = np.maximum(inverse[left]+inverse[right], 1)
            correction = delta*((length-target)/length/total*0.85)[:,None]
            p[left] += correction*inverse[left,None]
            p[right] -= correction*inverse[right,None]
    return p.ravel().tolist()


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
            w = (t - (LOOP - CROSS)) / CROSS
            w = w ** 3 * (10 - 15 * w + 6 * w * w)
            g = frames[a + t - LOOP]
            blended = [p * (1 - w) + q * w for p, q in zip(f, g)]
            f = relax_blend(blended, f, g, w)
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


def straighten(loop, force=False):
    """Blender's wind came 6 deg off the axis; the app points the flag by the
    reading, so take out each band's own mean azimuth about the pole."""
    a = sum(hang_and_azimuth(f)[1] for f in loop) / len(loop)
    if not force and sum(hang_and_azimuth(f)[0] for f in loop) / len(loop) < 15:
        return loop, 0.0          # a limp flag points nowhere: turning it would only drag the hoist round the pole
    c, s = math.cos(a), math.sin(a)
    out = []
    for f in loop:
        g = list(f)
        for i in range(0, len(g), 3):
            x, z = g[i] - X0, g[i + 2]
            g[i], g[i + 2] = X0 + x * c + z * s, -x * s + z * c
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
previous_scene = bpy.context.window.scene if bpy.context.window else None
sc = fresh_scene()
if MODE == 'calibrate':
    # a list of band-like dicts, each a candidate simulation
    specs = [dict(c, name=c.get('name', f"c{k}")) for k, c in enumerate(globals().get('CAL', BANDS))]
else:
    specs = globals().get('SPECS', BANDS)
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
        if spec.get('staticRest'):
            # Calm is one settled drape, not a frozen instant of turbulent
            # crumpling. Broad smoothing removes small simulation creases.
            rest = smooth_grid([fr[-1]], rounds=6)[0]
            loop, start, seam = [rest] * (LOOP // STEP), len(fr)-1, 0.0
            loop, azimuth = straighten(loop, force=True)
        else:
            loop, start, seam = seamless_loop(fr)
            loop, azimuth = straighten(smooth_grid(loop))
        if spec.get('mirrorZ'):
            loop = [[-v if c % 3 == 2 else v for c, v in enumerate(frame)] for frame in loop]
        st = stats(loop, STEP / FPS)
        bands.append({**spec, 'ms': spec.get('ms', 0.0 if spec['strength'] == 0 else round(st['hangDeg'] / RULE_DEG_PER_MS, 2)),
                      **st, 'azimuthRemovedDeg': round(azimuth, 2), 'loopStartFrame': SETTLE + 1 + start,
                      'loopSeamRmsM': round(seam, 4),
                      'frames': [[round(v, 5) for v in f] for f in loop]})
    # Actual measured hang, rather than force-field strength, defines ordering.
    bands.sort(key=lambda b: b['ms'])
    doc = {'format': 'banvy-flag-bake-v1', 'blender': bpy.app.version_string,
           'grid': {'nx': NX, 'nz': NZ, 'width': W, 'height': H, 'hoistX': X0, 'top': TOP},
           'fps': FPS // STEP, 'frames': LOOP // STEP, 'ruleDegPerMs': RULE_DEG_PER_MS,
           'cloth': {'quality': 12, 'massPerVertex': MASS, 'simGrid': [SNX, SNZ], 'airDampingScale': 187 / (SNX * SNZ), 'selfCollision': True, 'poleCollisionRadius': 0.020, 'tension': 20, 'compression': 20,
                     'shear': 5, 'bending': 0.003, 'restShape': 'flat shape key', 'crumpleM': 0.01, 'windYawDeg': 6, 'windNoise': NOISE,
                     'turbulenceSize': TSIZE, 'settleFrames': SETTLE, 'recordFrames': RECORD, 'crossfadeFrames': CROSS,
                     'crossfadeMetricIterations': 14, 'advectedTurbulence': True,
                     'hemBending': 0.012, 'hemVertexGroup': 'sewn hems'},
           'bands': bands}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh)
    print(json.dumps({'seconds': round(time.time() - t0, 1), 'out': OUT,
                      'bands': [{k: v for k, v in b.items() if k != 'frames'} for b in bands]}))
if previous_scene and bpy.context.window and previous_scene.name in bpy.data.scenes:
    bpy.context.window.scene = previous_scene
