"""Banvy golfer v3 -- anatomy and rig.

The realistic female and male of Blender Studio's Human Base Meshes v1.4.1
(CC0) share one topology and one set of 102 sculpt face sets. Every joint of
the rig is read from the boundary between two face sets (wrist = forearm/hand,
each finger joint = phalanx/phalanx), so the same code fits both bodies.

Axes: metres, Z up, the character faces -Y, its left is +X. A right-handed
shot travels +X. glTF converts (x, y, z) -> (x, z, -y).
"""
import bpy, math
from collections import defaultdict
from mathutils import Vector as V, Matrix

SOURCE_NAMES = {'female': 'GEO-body_female_realistic', 'male': 'GEO-body_male_realistic'}
HEIGHTS = {'female': 1.68, 'male': 1.80}

# Face sets, identical in both realistic bodies. L is +X.
FS = dict(
    torso=1, eyelid_R=3, eyelid_L=2, ear_L=4, ear_R=5, mouth=7, chin=8,
    hand_L=9, hand_R=10, forearm_R=11, forearm_L=12, foot_R=13, foot_L=14,
    shin_L=15, shin_R=16, head=17, pelvis=18, belly=19, upper_R=20, upper_L=21,
    jaw=22, thigh_R=23, thigh_L=24,
)
# Phalanx face sets: proximal, middle, distal, tip cap.
FINGERS = {
    'L': {'Index': (76, 77, 78, 79), 'Middle': (72, 73, 74, 75), 'Ring': (68, 69, 70, 71),
          'Pinky': (64, 65, 66, 67), 'Thumb': (80, 81, 82, 83)},
    'R': {'Index': (88, 89, 90, 91), 'Middle': (92, 93, 94, 95), 'Ring': (96, 97, 98, 99),
          'Pinky': (100, 101, 102, 103), 'Thumb': (84, 85, 86, 87)},
}
TOES = {'L': set(range(46, 64)), 'R': set(range(27, 46))}
FOREFOOT = {'L': 25, 'R': 26}


def link(ob, collection):
    collection.objects.link(ob)
    return ob


def load_source(variant, collection):
    """Append the CC0 body and its eyes, normalised to feet at z=0 and the design height."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[3]
    path = root / 'output/golfer-source/human_base_meshes_bundle.blend'
    if not path.exists():
        raise FileNotFoundError(f'{path} -- run tools/blender-golfer/fetch_source.py')
    name = SOURCE_NAMES[variant]
    with bpy.data.libraries.load(str(path), link=False) as (src, dst):
        dst.objects = [name, name + '.eye.L', name + '.eye.R']
    body, eye_l, eye_r = dst.objects
    for ob in (body, eye_l, eye_r):
        link(ob, collection)
    bpy.context.view_layer.update()
    worlds = {ob: ob.matrix_world.copy() for ob in (body, eye_l, eye_r)}
    xs = [v.co for v in body.data.vertices]
    zmin = min(c.z for c in xs); zmax = max(c.z for c in xs)
    scale = HEIGHTS[variant] / (zmax - zmin)
    offset = body.matrix_world.translation.copy()
    normalise = Matrix.Scale(scale, 4) @ Matrix.Translation((-offset.x, -offset.y, -offset.z - zmin))
    for ob in (eye_l, eye_r):
        ob.parent = None
        ob.data.transform(normalise @ worlds[ob])
        ob.matrix_world = Matrix.Identity(4)
    # The sculpted body keeps its multires; its object matrix carries the
    # normalisation, and each evaluated level is transformed into place.
    body.matrix_world = normalise @ worlds[body]
    return body, eye_l, eye_r, body.matrix_world.copy(), scale


def evaluated_level(body, level, name, collection, keep_groups=True):
    """A real mesh at one multires level, in normalised world coordinates."""
    mod = next(m for m in body.modifiers if m.type == 'MULTIRES')
    mod.levels = level
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(body.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.transform(body.matrix_world)
    me.name = name
    ob = bpy.data.objects.new(name, me)
    link(ob, collection)
    return ob


def cage_copy(body, collection):
    me = body.data.copy(); me.transform(body.matrix_world); me.name = 'Golfer v3 | fitting cage'
    ob = bpy.data.objects.new(me.name, me); link(ob, collection)
    return ob


def face_sets(me):
    return [d.value for d in me.attributes['.sculpt_face_set'].data]


def set_vertices(me, fsets):
    out = defaultdict(set)
    for p, f in zip(me.polygons, fsets):
        out[f].update(p.vertices)
    return out


def centroid(points):
    points = list(points)
    return sum(points, V()) / len(points)


class Landmarks:
    def __init__(self, me):
        self.me = me
        self.fsets = face_sets(me)
        self.verts = set_vertices(me, self.fsets)

    def co(self, ids):
        return [self.me.vertices[i].co.copy() for i in ids]

    def seam(self, a, b):
        a = a if isinstance(a, (set, tuple, list)) else (a,)
        b = b if isinstance(b, (set, tuple, list)) else (b,)
        va = set().union(*(self.verts[x] for x in a)); vb = set().union(*(self.verts[x] for x in b))
        both = va & vb
        if not both:
            raise ValueError(f'No seam between face sets {a} and {b}')
        return centroid(self.co(both))

    def region(self, *sets):
        return self.co(set().union(*(self.verts[x] for x in sets)))


def fit_joints(me):
    """Joint centres in the normalised A-pose, from the anatomical face sets."""
    L = Landmarks(me)
    j = {}
    for side, s in (('L', 1), ('R', -1)):
        k = lambda n: FS[n + '_' + side]
        j['elbow_' + side] = L.seam(k('upper'), k('forearm'))
        j['shoulder_' + side] = humerus_head(L, side, s, j['elbow_' + side])
        j['wrist_' + side] = L.seam(k('forearm'), k('hand'))
        hip_ring = L.seam(FS['pelvis'], k('thigh'))
        j['hip_ring_' + side] = hip_ring
        j['knee_' + side] = L.seam(k('thigh'), k('shin'))
        j['ankle_' + side] = L.seam(k('shin'), k('foot'))
        toes = TOES[side]
        j['ball_' + side] = L.seam(k('foot'), FOREFOOT[side])
        foot = L.region(k('foot'), FOREFOOT[side], *toes)
        j['toe_tip_' + side] = min(foot, key=lambda c: c.y)
        j['heel_' + side] = max(foot, key=lambda c: c.y)
        j['sole_z_' + side] = min(c.z for c in foot)
        for finger, (a, b, c, tip) in FINGERS[side].items():
            base = L.seam(k('hand'), a)
            j[f'{finger}1_{side}'] = base
            j[f'{finger}2_{side}'] = L.seam(a, b)
            j[f'{finger}3_{side}'] = L.seam(b, c)
            cap = L.region(tip)
            j[f'{finger}4_{side}'] = max(cap, key=lambda q: (q - j[f'{finger}3_{side}']).length)
    neck_ring = L.seam(FS['torso'], FS['head'])
    j['neck_base'] = neck_ring
    ears = centroid([L.seam(FS['ear_L'], FS['head']), L.seam(FS['ear_R'], FS['head'])])
    j['ears'] = ears
    head = L.region(FS['head'])
    j['head_top'] = V((0, ears.y, max(c.z for c in head)))
    j['chin'] = centroid(L.region(FS['chin']))
    # Hip joints: the thigh seam is a slanted ring from crotch to iliac crest;
    # the femoral head lies above its centre and toward the midline.
    for side, s in (('L', 1), ('R', -1)):
        ring = j['hip_ring_' + side]
        j['hip_' + side] = V((s * max(.075, abs(ring.x) - .012), ring.y + .004, ring.z + .045))
    return j


def humerus_head(L, side, s, elbow):
    """The shoulder joint on the line through the upper arm's cross-sections.

    The upper-arm face set reaches onto the chest, so its seam with the torso
    is not the joint. Slices of the free arm below the armpit give the humerus
    axis; the head of the humerus sits about 2.2 % of the height below the top
    of the deltoid on that line.
    """
    arm = L.region(FS['upper_' + side]); torso = L.region(FS['torso'])
    centres = []
    for i in range(7):
        z = elbow.z + .03 + .02 * i
        trunk = [abs(c.x) for c in torso if abs(c.z - z) < .008]
        half = max(trunk) if trunk else .12
        ring = [c for c in arm if abs(c.z - z) < .008 and s * c.x > half + .012]
        if len(ring) >= 6:
            centres.append(centroid(ring))
    if len(centres) < 3:
        raise ValueError('Could not find the upper-arm axis for ' + side)
    zs = [c.z for c in centres]; zm = sum(zs) / len(zs)
    def fit(k):
        vals = [c[k] for c in centres]; vm = sum(vals) / len(vals)
        slope = sum((z - zm) * (v - vm) for z, v in zip(zs, vals)) / sum((z - zm) ** 2 for z in zs)
        return lambda z: vm + slope * (z - zm)
    fx, fy = fit(0), fit(1)
    height = max(c.z for c in L.region(FS['head']))
    # The deltoid's crown: upper-arm verts outside the trunk, near the axis.
    column = [c for c in arm if c.z > elbow.z + .12 and s * c.x > s * fx(c.z) - .03
              and abs(c.y - fy(c.z)) < .05]
    top = max(c.z for c in column)
    z = top - .022 * height
    return V((fx(z), fy(z), z))


def torso_back(me, z, half=.05):
    """Front and back extents of the trunk at a height, near the midline."""
    ys = [v.co.y for v in me.vertices if abs(v.co.z - z) < .015 and abs(v.co.x) < half]
    return min(ys), max(ys)


def build_rig(variant, me, joints, collection, braid=False):
    """A game-style humanoid with names the runtime already relies on."""
    J = joints
    hip_mid = (J['hip_L'] + J['hip_R']) / 2
    neck = J['neck_base']
    span = neck.z - hip_mid.z

    def spine_point(t):
        z = hip_mid.z + span * t
        front, back = torso_back(me, z)
        # The vertebral bodies sit about two thirds of the way to the back.
        return V((0, front + (back - front) * .64, z))

    arm = bpy.data.armatures.new(f'Banvy golfer v3 {variant}')
    rig = bpy.data.objects.new(f'Golfer_v3_{variant}_Rig', arm)
    link(rig, collection)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    FWD = V((0, -1, 0)); UP = V((0, 0, 1))

    def bone(name, head, tail, parent=None, z=None, connect=False, deform=True):
        b = eb.new(name); b.head = V(head); b.tail = V(tail)
        if z is not None:
            b.align_roll(V(z))
        if parent:
            b.parent = eb[parent]; b.use_connect = connect
        b.use_deform = deform
        return b

    bone('Root', (0, 0, 0), (0, 0, .2), z=FWD, deform=False)
    p = [spine_point(t) for t in (0, .14, .40, .68)]
    hips_head = V((0, p[0].y, hip_mid.z))
    bone('Hips', hips_head, p[1], 'Root', z=FWD)
    bone('Spine', p[1], p[2], 'Hips', z=FWD, connect=True)
    bone('Chest', p[2], p[3], 'Spine', z=FWD, connect=True)
    neck_b = V((0, neck.y + .012, neck.z - .012))
    bone('UpperChest', p[3], neck_b, 'Chest', z=FWD, connect=True)
    head_j = V((0, J['ears'].y + .008, J['ears'].z - .032))
    bone('Neck', neck_b, head_j, 'UpperChest', z=FWD, connect=True)
    bone('Head', head_j, J['head_top'], 'Neck', z=FWD, connect=True)
    for side, s in (('L', 1), ('R', -1)):
        sh = J['shoulder_' + side]
        sc = V((s * .022, neck.y - .035, neck.z - .045))  # sternoclavicular joint
        bone('Clavicle_' + side, sc, sh, 'UpperChest', z=UP)
        el = J['elbow_' + side]; wr = J['wrist_' + side]
        arm_dir = (el - sh).normalized()
        bone('UpperArm_' + side, sh, el, 'Clavicle_' + side, z=FWD, connect=True)
        bone('Forearm_' + side, el, wr, 'UpperArm_' + side, z=FWD, connect=True)
        mid = el.lerp(wr, .5)
        bone('ForearmTwist_' + side, mid, wr, 'Forearm_' + side, z=FWD)
        knuckles = (J['Index1_' + side] + J['Pinky1_' + side]) / 2
        dorsal = V((s, 0, 0))
        bone('Hand_' + side, wr, knuckles, 'Forearm_' + side, z=dorsal, connect=True)
        for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
            pts = [J[f'{f}{i}_{side}'] for i in range(1, 5)]
            parent = 'Hand_' + side
            for i in range(3):
                name = f'{f}{i + 1}_{side}'
                # Each finger's back faces the back of the hand, the thumb's
                # turns toward the front of the hand.
                ref = dorsal if f != 'Thumb' else (dorsal + FWD * .9).normalized()
                bone(name, pts[i], pts[i + 1], parent, z=ref, connect=i > 0)
                parent = name
        hip = J['hip_' + side]; knee = J['knee_' + side]; ankle = J['ankle_' + side]
        bone('Thigh_' + side, hip, knee, 'Hips', z=FWD)
        bone('Shin_' + side, knee, ankle, 'Thigh_' + side, z=FWD, connect=True)
        ball = J['ball_' + side]
        bone('Foot_' + side, ankle, ball, 'Shin_' + side, z=UP, connect=True)
        tip = J['toe_tip_' + side]
        bone('Toe_' + side, ball, V((ball.x, tip.y, ball.z)), 'Foot_' + side, z=UP, connect=True)
    for side, eye in (('L', 'eye_L'), ('R', 'eye_R')):
        c = J[eye]
        bone('Eye_' + side, c, c + V((0, -.03, 0)), 'Head', z=UP)
        # The upper lid pivots about the eye's centre: it closes over the eyeball.
        bone('Lid_' + side, c, c + V((0, -.025, 0)), 'Head', z=UP)
    if braid:
        start = V((0, J['head_top'].y + .085, J['ears'].z - .005))
        pts = [start + V((0, .012 * i, -.062 * i)) for i in range(7)]
        parent = 'Head'
        for i in range(6):
            bone(f'Braid{i + 1}', pts[i], pts[i + 1], parent, z=V((0, 1, 0)), connect=i > 0)
            parent = f'Braid{i + 1}'
    # The club socket follows the hands in world space; it is not a deform bone.
    bone('ClubGrip', (0, -.35, .95), (0, -.35, .75), 'Root', z=V((1, 0, 0)), deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    rig['source_joints'] = {k: list(v) for k, v in J.items() if isinstance(v, V)}
    return rig


NON_DEFORM_FOR_HEAT = ('Root', 'ClubGrip', 'Eye_', 'Lid_', 'Braid')


def heat_weights(cage, rig):
    """Bone-heat weights on the fitting cage, cleaned per anatomical region."""
    held = []
    for b in rig.data.bones:
        if b.name.startswith(NON_DEFORM_FOR_HEAT) and b.use_deform:
            b.use_deform = False; held.append(b.name)
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    cage.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for name in held:
        rig.data.bones[name].use_deform = True
    me = cage.data
    fsets = face_sets(me)
    per_vertex = set_vertices(me, fsets)
    groups = {g.name: g.index for g in cage.vertex_groups}
    names = {i: n for n, i in groups.items()}
    allowed = {}
    for side in ('L', 'R'):
        for finger, sets in FINGERS[side].items():
            ok = {f'{finger}{i}_{side}' for i in (1, 2, 3)} | {'Hand_' + side}
            for fs in sets:
                for v in per_vertex[fs]:
                    allowed[v] = ok
        for fs in TOES[side] | {FOREFOOT[side]}:
            for v in per_vertex[fs]:
                allowed.setdefault(v, {'Foot_' + side, 'Toe_' + side})
    for v in me.vertices:
        ok = allowed.get(v.index)
        weights = {names[g.group]: g.weight for g in v.groups if g.weight > 1e-4}
        if ok is not None:
            weights = {n: w for n, w in weights.items() if n in ok}
            if not weights:
                weights = {sorted(ok)[0]: 1.0}
        # At most four influences, as the runtime's skinning uses.
        top = sorted(weights.items(), key=lambda kv: -kv[1])[:4]
        total = sum(w for _, w in top) or 1
        for g in list(v.groups):
            cage.vertex_groups[g.group].remove([v.index])
        for n, w in top:
            if n not in groups:
                groups[n] = cage.vertex_groups.new(name=n).index; names[groups[n]] = n
            cage.vertex_groups[groups[n]].add([v.index], w / total, 'REPLACE')
    return cage


def copy_groups(src, dst):
    """Same topology: copy vertex groups by index (cage -> multires base)."""
    for g in list(dst.vertex_groups):
        dst.vertex_groups.remove(g)
    made = {}
    for g in src.vertex_groups:
        made[g.index] = dst.vertex_groups.new(name=g.name)
    for v in src.data.vertices:
        for g in v.groups:
            made[g.group].add([v.index], g.weight, 'REPLACE')


def lid_weights(body, joints, eyes):
    """Weight each upper eyelid to its Lid bone.

    The lid set's vertices above the eye are measured by their angle about the
    eye's lateral axis: the margin (lowest angle at each x) follows the bone
    fully, the skin toward the brow less and less, so a blink slides the lid
    over the eyeball and the crease above it folds gently.
    """
    import numpy as np
    me = body.data
    fsets = face_sets(me)
    per_vertex = set_vertices(me, fsets)
    head = body.vertex_groups.get('Head')
    out = {}
    for side, setid, eye in (('L', FS['eyelid_L'], eyes[0]), ('R', FS['eyelid_R'], eyes[1])):
        c = sum((v.co for v in eye.data.vertices), V()) / len(eye.data.vertices)
        ids = sorted(per_vertex[setid])
        co = np.array([me.vertices[i].co[:] for i in ids])
        rel = co - np.array(c[:])
        phi = np.degrees(np.arctan2(rel[:, 2], -rel[:, 1]))          # 0 ahead, +90 up
        upper = rel[:, 2] > -.0015
        # The visible lid lies in front of the eye; the lid's lining folds back into the
        # socket behind the eyeball's front and simply follows the lid (it stays hidden).
        front = rel[:, 1] < -.006
        xs = rel[:, 0]
        margin = np.empty(len(ids))
        for j in range(len(ids)):
            near = upper & front & (np.abs(xs - xs[j]) < .0018)
            margin[j] = phi[near].min() if near.any() else 90.0
        span = 46.0
        t = np.clip((phi - margin) / span, 0, 1)
        w = np.where(front, 1 - t * t * (3 - 2 * t), 1.0)
        # Fade out toward the corners so the canthi stay put.
        half = max(np.abs(xs[upper]).max(), 1e-4)
        corner = np.clip((half - np.abs(xs)) / (half * .35), 0, 1)
        w = w * (corner * corner * (3 - 2 * corner)) * upper
        g = body.vertex_groups.get('Lid_' + side) or body.vertex_groups.new(name='Lid_' + side)
        n = 0
        for i, wi in zip(ids, w):
            if wi < 1e-3:
                continue
            v = me.vertices[i]
            # Scale the existing influences down and give the lid its share.
            for ge in v.groups:
                ge.weight *= (1 - wi)
            g.add([i], float(wi), 'REPLACE')
            n += 1
        out[side] = dict(vertices=n, margin_deg=round(float(np.median(margin[upper & front])), 1))
    return out
