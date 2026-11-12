"""The club carried on the shoulder rests on it (12 November).

Off the course the club lies on the trail shoulder, its carry fixed to the chest
(clips_v3.Carry). The carry was placed by eye from the shoulder joint, and the
draped polo stands off the body, so the shaft ran 2-5 cm through the shirt and
the shoulder under it.

Now each carrying clip is baked twice. The first bake keeps the club in contact:
its authored bounces and lifts off the shoulder are left out. The posed body and
outfit are then read by Blender's own armature at frames through it. At each
frame the carry (hand and club together) is raised along the chest's up until
every point of the shaft past the hand clears the nearest surface by its own
radius plus GAP. That is the smallest such rise, so the club rests on the shirt,
not above it. The rises, lightly smoothed and interpolated between the frames
read, ride the club on the shoulder as it moves. The second bake adds them, with
the authored bounces and lifts on top. If an authored lift still turns the shaft
into the shirt, the extra rise those frames need is fitted on that bake (never
less than none) and added, and the clip is baked a third time. measure() then
reports how far the club still goes in, and the build fails past LIMIT.

The shaft keeps its angle: a club over the shoulder lies across it, its head
behind the back. (Tilting the shaft about the hand instead stood it up beside
the head.)
"""
import math, os
import bpy
from mathutils import Vector as V
from mathutils.bvhtree import BVHTree

GAP = .0015            # the shaft rests this far off the shirt (m)
LIMIT = .0015          # the build fails if the club goes deeper than this into anything
RISE_RANGE = (-.03, .12)    # m along the chest's up: down onto a shoulder it floats over, up off one it enters
# What the club may touch: the shoulder, the collar, the head's hair and headwear.
PARTS = ('Body', 'Polo', 'Collar', 'CollarTipping', 'SleeveBands', 'PoloSeams', 'Hair',
         'Visor', 'Bill', 'Cap', 'CapRim', 'CapSeams', 'CapButton', 'CapClosure', 'CapClasp')
# Which side of a surface a point is on means something only for a closed volume (the body)
# and for a garment wrapped round one: a point under the polo, the hair or the cap is inside
# only within the layer between it and the skin. Behind a thin open part (a seam strip, the
# collar, a bill) there is only air, so those count by plain distance.
SHELLS = ('Polo', 'Trousers', 'Hair', 'Cap')
PAST_HAND = .10        # the shaft is measured from this far past the carrying hand...
SHORT_OF_HEAD = .12    # ...to this far short of the club's sole (the head is not round)


def parts(G):
    prefix = f'Golfer_v3_{G["variant"]}_'
    return [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(prefix)
            and o.name[len(prefix):] in PARTS and not o.hide_render]


def surfaces(objects):
    dg = bpy.context.evaluated_depsgraph_get()
    trees = []
    for ob in objects:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        verts = [mw @ v.co for v in me.vertices]
        trees.append((ob.name.rsplit('_', 1)[-1], BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in me.polygons])))
        ev.to_mesh_clear()
    return trees


def clearance(trees, p):
    """Signed distance from p to the nearest surface (negative inside) and that part's name."""
    best = None
    body = next((tree for name, tree in trees if name == 'Body'), None)
    for name, tree in trees:
        loc, nrm, _i, dist = tree.find_nearest(p, .08)
        if loc is None:
            continue
        behind = (p - loc).dot(nrm) < 0
        if name == 'Body':
            signed = -dist if behind else dist
        elif name in SHELLS and behind and body is not None:
            # Under a garment only square to a face: past its open hem (where the nearest point
            # is on the edge, off to one side) the face's normal says nothing about the side.
            square = dist < 1e-6 or (p - loc).normalized().dot(nrm) < -.7
            skin = body.find_nearest(loc, .08)
            layer = skin[3] if skin[0] is not None else 0.0
            signed = -dist if square and dist <= layer + .004 else dist
        else:
            signed = dist
        if best is None or signed < best[0]:
            best = (signed, name)
    return best or (1.0, None)


def club_profile(club, P):
    """The club's radius by distance down the shaft (1 cm bins), from its own mesh."""
    Pi = P.inverted()
    mw = club.matrix_world
    bins = {}
    for v in club.data.vertices:
        q = Pi @ (mw @ v.co)
        i = int(round(q.y * 100))
        r = math.hypot(q.x, q.z)
        if r > bins.get(i, 0.0):
            bins[i] = r
    return lambda s: max(bins.get(int(round(s * 100)) + d, 0.0) for d in (-1, 0, 1))


def posed(rig, action, frame):
    """Pose the rig at a baked frame (1-based, as bake_action keys them); the club frame and chest's up."""
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    bpy.context.scene.frame_set(frame)
    P = rig.matrix_world @ rig.pose.bones['ClubGrip'].matrix
    pb = rig.pose.bones['UpperChest']
    R = rig.matrix_world.to_3x3() @ pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()
    return P, (R @ V((0, 0, 1))).normalized()


def frames_read(count):
    """Which baked frames (0-based) are read: every one in a short clip, fewer in a long one."""
    step = 1 if count <= 90 else 2 if count <= 180 else 4
    out = list(range(0, count + 1, step))
    if out[-1] != count:
        out.append(count)
    return out


def shaft_points(P, along, length):
    s = along + PAST_HAND
    out = []
    while s < length - SHORT_OF_HEAD:
        out.append((s, P @ V((0, s, 0))))
        s += .01
    return out


def needed_rise(trees, P, up, along, length, radius):
    """The smallest rise (m) at which the shaft clears every surface by its radius + GAP."""
    pts = shaft_points(P, along, length)

    def ok(dz):
        return all(clearance(trees, p + up * dz)[0] >= radius(s) + GAP for s, p in pts)

    lo, hi = RISE_RANGE
    if ok(lo):
        return lo
    if not ok(hi):
        return hi
    for _ in range(13):
        mid = .5 * (lo + hi)
        lo, hi = (lo, mid) if ok(mid) else (mid, hi)
    return hi


def fit(G, action, entry, along, count, loop, floor=None):
    """The rise the carry needs through a baked clip: a function of time (s).

    With `floor` (a correction on top of an earlier rise) no frame's rise goes below it.
    """
    rig = G['rig']
    club = G['clubs'][entry['club']]
    length = G['club_data'][entry['club']]['length']
    objects = parts(G)
    radius = None
    read = frames_read(count)
    rises = []
    for f in read:
        P, up = posed(rig, action, f + 1)
        if radius is None:
            radius = club_profile(club, P)
        r = needed_rise(surfaces(objects), P, up, along, length, radius)
        rises.append(r if floor is None else max(floor, r))
    return curve(read, rises, count, loop, entry['duration'])


def curve(read, values, count, loop, duration):
    """Every frame's value from the frames read: linear between them, and a little smoothing
    that never lets a frame below the largest value among its neighbours. A function of time (s)."""
    per = []
    for f in range(count + 1):
        below = [k for k in range(len(read)) if read[k] <= f]
        i = max(below) if below else 0
        if read[i] >= f or i + 1 >= len(read):
            per.append(values[i])
        else:
            u = (f - read[i]) / (read[i + 1] - read[i])
            per.append(values[i] * (1 - u) + values[i + 1] * u)
    n = len(per)
    def at(i):
        if loop:
            return per[i % (n - 1)]          # the last frame is the first again
        return per[min(max(i, 0), n - 1)]
    lifted = [max(at(i - 1), at(i), at(i + 1)) for i in range(n)]
    def lat(i):
        if loop:
            return lifted[i % (n - 1)]
        return lifted[min(max(i, 0), n - 1)]
    smooth = [sum(lat(i + d) * w for d, w in ((-2, 1), (-1, 2), (0, 3), (1, 2), (2, 1))) / 9 for i in range(n)]
    if loop:
        smooth[-1] = smooth[0]
    fps = count / duration

    def rise(t):
        x = min(max(t * fps, 0.0), count)
        i = min(int(x), count - 1)
        u = x - i
        return smooth[i] * (1 - u) + smooth[i + 1] * u
    rise.samples = [(round(f / fps, 3), round(r, 4)) for f, r in zip(read, values)]
    return rise


def measure(G, action, entry, along, count):
    """How far the shaft past the hand goes into anything (m, 0 if clear), and the closest it comes."""
    rig = G['rig']
    club = G['clubs'][entry['club']]
    length = G['club_data'][entry['club']]['length']
    objects = parts(G)
    radius = None
    depth = 0.0; where = None; closest = 1.0
    for f in frames_read(count):
        P, _up = posed(rig, action, f + 1)
        if radius is None:
            radius = club_profile(club, P)
        trees = surfaces(objects)
        for s, p in shaft_points(P, along, length):
            signed, name = clearance(trees, p)
            gap = signed - radius(s)
            closest = min(closest, gap)
            if -gap > depth:
                depth = -gap; where = (name, f)
    return dict(depth_mm=round(depth * 1000, 1), closest_mm=round(closest * 1000, 1),
                part=where[0] if where else None, frame=where[1] if where else None)


# --- The free hand on the hip (12 November) ---------------------------------------------
# In Idle the lead hand rests on the hip. It had been placed at a fixed point on the rest
# skeleton with its fingers aimed down and forward, so it ignored the clothes, the hip's
# shape and the weight shift into that hip: the fingers ran 8 cm and more into the body,
# and on him came out through the front of the trousers. Now the palm is laid on the
# outermost garment at the waist (hip_surface), the hand follows the pelvis, and the same
# kind of fit pushes it along that surface's normal until the glove clears everything by
# HAND_GAP: the hand rests on the shirt. Frames where the hand is off the hip are skipped.
HIP_PARTS = ('Body', 'Polo', 'Trousers', 'Belt', 'BeltLoops', 'Buckle', 'BeltTip', 'Tailoring', 'Fly', 'PoloSeams')
HAND_GAP = .0015
PUSH_RANGE = (-.03, .10)
LEFT_ARM = ('Hand_L', 'Forearm_L', 'ForearmTwist_L')
FINGER = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')


def hip_surface(G, k, aim=V((-.15, -.55, -.82))):
    """Where the free hand rests, at rest: the palm's point on the outermost garment at the left
    side of the waist, at the belt and a little forward of the side seam; the hand's normal; and
    the hand's line along the surface (aim, the authored direction of the fingers, laid on the
    surface as the chord from the palm to the point under the fingers, so it follows the hip's flare)."""
    prefix = f'Golfer_v3_{G["variant"]}_'
    garments = [bpy.data.objects.get(prefix + n) for n in ('Polo', 'Belt', 'BeltLoops', 'Trousers')]
    garments = [o for o in garments if o is not None]
    belt = bpy.data.objects.get(prefix + 'Belt')
    if belt is not None:
        pts = [belt.matrix_world @ v.co for v in belt.data.vertices]
        side = max(p.x for p in pts)
        top = max(p.z for p in pts if p.x > .7 * side)
    else:
        top = G['rig'].data.bones['Hips'].head_local.z + .10 * k
    verts = []; polys = []
    sources = garments or [G['body']]
    for ob in sources:
        base = len(verts)
        mw = ob.matrix_world
        verts += [mw @ v.co for v in ob.data.vertices]
        for p in ob.data.polygons:
            if ob is G['body'] and any(abs(verts[base + i].x) > .24 * k for i in p.vertices):
                continue                     # the plain body: the torso only, not the resting arms
            polys.append(tuple(base + i for i in p.vertices))
    tree = BVHTree.FromPolygons(verts, polys)
    origin = V((1.0, -.012 * k, top + .004 * k))
    loc, nrm, _i, _d = tree.ray_cast(origin, V((-1, 0, 0)))
    if loc is None:
        raise RuntimeError('hip_surface: no garment at the waist')
    if nrm.x < 0:
        nrm = -nrm
    nrm = nrm.normalized()
    aim = V(aim).normalized()
    along = (aim - nrm * aim.dot(nrm)).normalized()
    probe = loc + along * .085 * k + nrm * .06 * k
    under, nrm2, _i, _d = tree.ray_cast(probe, -nrm)
    if under is None:
        return loc, nrm, along
    if nrm2.dot(nrm) < 0:
        nrm2 = -nrm2
    axis = (under - loc).normalized()
    normal = (nrm + nrm2.normalized())
    normal = (normal - axis * normal.dot(axis)).normalized()
    return loc, normal, axis


def _hand_body(G):
    """The body's left forearm and hand (the glove lies on them: not a surface to clear), and the hand's skin."""
    body = G['body']
    ids = {g.index for g in body.vertex_groups
           if g.name in LEFT_ARM or (g.name.endswith('_L') and g.name.startswith(FINGER))}
    hand = {g.index for g in body.vertex_groups if g.name == 'Hand_L' or (g.name.endswith('_L') and g.name.startswith(FINGER))}
    arm = set(); skin = []
    for v in body.data.vertices:
        if sum(ge.weight for ge in v.groups if ge.group in ids) > .3:
            arm.add(v.index)
        if sum(ge.weight for ge in v.groups if ge.group in hand) > .5:
            skin.append(v.index)
    return arm, skin


def hand_scene(G, dg, arm, skin):
    """The surfaces the hand may touch, posed, and the hand's own points (the glove, else its skin)."""
    prefix = f'Golfer_v3_{G["variant"]}_'
    gloved = any(o.name.startswith(prefix + 'Glove') for o in bpy.data.objects)
    trees = []; pts = []
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or not ob.name.startswith(prefix) or ob.hide_render:
            continue
        name = ob.name[len(prefix):]
        glove = name.startswith('Glove')
        if not glove and name not in HIP_PARTS:
            continue
        ev = ob.evaluated_get(dg); me = ev.to_mesh(); mw = ob.matrix_world
        verts = [mw @ v.co for v in me.vertices]
        if glove:
            pts += verts[::3]
        elif name == 'Body':
            trees.append((name, BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in me.polygons
                                                              if not any(i in arm for i in p.vertices)])))
            if not gloved:
                pts += [verts[i] for i in skin[::2]]
        else:
            trees.append((name, BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in me.polygons])))
        ev.to_mesh_clear()
    trees.sort(key=lambda t: t[0] != 'Body')
    return trees, pts


def pelvis_normal(rig, normal_local):
    pb = rig.pose.bones['Hips']
    R = rig.matrix_world.to_3x3() @ pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()
    return (R @ normal_local).normalized()


def needed_push(trees, pts, n, why=None):
    """The smallest push along n (m) at which every hand point clears every surface by HAND_GAP.

    With `why` (a function naming a point), prints which point binds at the push found."""
    near = [p for p in pts if clearance(trees, p)[0] < PUSH_RANGE[1] + .02]

    def ok(d):
        return all(clearance(trees, p + n * d)[0] >= HAND_GAP for p in near)

    lo, hi = PUSH_RANGE
    if ok(lo):
        return lo
    if not ok(hi):
        return hi
    for _ in range(12):
        mid = .5 * (lo + hi)
        lo, hi = (lo, mid) if ok(mid) else (mid, hi)
    if why is not None:
        worst = min(near, key=lambda p: clearance(trees, p + n * lo)[0])
        print('HIPBIND', round(hi * 1000, 1), why(worst), clearance(trees, worst + n * lo)[1])
    return hi


def hip_frames(count, step=8):
    out = list(range(0, count + 1, step))
    if out[-1] != count:
        out.append(count)
    return out


def fit_hip(G, action, entry, count, loop, clip, floor=None):
    """The push along the hip's normal that rests the hand on it: a function of time (s)."""
    rig = G['rig']
    arm, skin = _hand_body(G)
    fps = count / entry['duration']
    read = []; pushes = []
    for f in hip_frames(count):
        if clip.hip_free(f / fps) > 0:
            continue                         # the hand is off the hip (shading the eyes)
        posed(rig, action, f + 1)
        dg = bpy.context.evaluated_depsgraph_get()
        trees, pts = hand_scene(G, dg, arm, skin)
        why = None
        if os.environ.get('GOLFER_DEBUG_HIP') and f % 64 == 0:
            bones = [b for b in rig.pose.bones if b.name.endswith('_L') and (b.name == 'Hand_L' or b.name.startswith(FINGER))]
            def why(p, bones=bones):
                def dist(b):
                    a = rig.matrix_world @ b.head; c = rig.matrix_world @ b.tail
                    u = max(0.0, min(1.0, (p - a).dot(c - a) / max((c - a).length_squared, 1e-9)))
                    return (p - (a + (c - a) * u)).length
                return min(bones, key=dist).name
        r = needed_push(trees, pts, pelvis_normal(rig, clip.hip_normal), why)
        read.append(f); pushes.append(r if floor is None else max(floor, r))
    return curve(read, pushes, count, loop, entry['duration'])


def measure_hip(G, action, entry, count, clip):
    """How far the hand goes into anything while it rests on the hip (m, 0 if clear), and the closest it comes."""
    rig = G['rig']
    arm, skin = _hand_body(G)
    fps = count / entry['duration']
    depth = 0.0; where = None; closest = 1.0
    for f in hip_frames(count, 4):
        if clip.hip_free(f / fps) > 0:
            continue
        posed(rig, action, f + 1)
        dg = bpy.context.evaluated_depsgraph_get()
        trees, pts = hand_scene(G, dg, arm, skin)
        for p in pts:
            signed, name = clearance(trees, p)
            closest = min(closest, signed)
            if -signed > depth:
                depth = -signed; where = (name, f)
    return dict(depth_mm=round(depth * 1000, 1), closest_mm=round(closest * 1000, 1),
                part=where[0] if where else None, frame=where[1] if where else None)
