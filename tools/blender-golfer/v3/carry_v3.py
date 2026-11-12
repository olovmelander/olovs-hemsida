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
import math
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
SHELLS = ('Polo', 'Hair', 'Cap')
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
            skin = body.find_nearest(loc, .08)
            layer = skin[3] if skin[0] is not None else 0.0
            signed = -dist if dist <= layer + .004 else dist
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
    # Every frame's rise: linear between the frames read, a little smoothing that never
    # lets the club below the largest rise among its neighbours.
    per = []
    for f in range(count + 1):
        i = max(k for k in range(len(read)) if read[k] <= f)
        if read[i] == f or i + 1 >= len(read):
            per.append(rises[i])
        else:
            u = (f - read[i]) / (read[i + 1] - read[i])
            per.append(rises[i] * (1 - u) + rises[i + 1] * u)
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
    fps = count / entry['duration']

    def rise(t):
        x = min(max(t * fps, 0.0), count)
        i = min(int(x), count - 1)
        u = x - i
        return smooth[i] * (1 - u) + smooth[i + 1] * u
    rise.samples = [(round(f / fps, 3), round(r, 4)) for f, r in zip(read, rises)]
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
