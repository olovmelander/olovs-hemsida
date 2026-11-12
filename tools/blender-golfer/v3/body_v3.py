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
# Three names are historical and say less than they hold (measured 12 November):
#   mouth (7)  the mouth cavity's upper inside, from the upper lip's inner edge back over the palate;
#   chin (8)   the cavity's lower inside, its floor;
#   jaw (22)   the lower face's skin: the lower lip, the chin and the jaw up to 2 cm above the lips' line.
# The upper lip's skin belongs to head (17).
MOUTH_INSIDE = (7, 8)
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
        if 'mouth_corner_' + side in J:
            # The lower lid rises in a smile and in a squint.
            bone('LidLow_' + side, c, c + V((0, -.025, -.004)), 'Head', z=UP)
    if 'mouth_corner_L' in J:
        # The face: each bone turns about the skull's centre, so the skin it carries slides
        # over the skull as a face's does (a smile lifts the corner up and back, a brow rides up).
        skull = V((0, J['ears'].y + .008, J['ears'].z + .012))
        for side in 'LR':
            bone('Mouth_' + side, skull, J['mouth_corner_' + side], 'Head', z=UP)
            bone('Brow_' + side, skull, J['brow_' + side], 'Head', z=UP)
        # The upper lip rises in a smile and shows the teeth.
        bone('LipUp', skull, J['lip_line'] + V((0, 0, .005)), 'Head', z=UP)
        bone('Jaw', J['jaw_hinge'], J['chin_front'], 'Head', z=UP)
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


NON_DEFORM_FOR_HEAT = ('Root', 'ClubGrip', 'Eye_', 'Lid_', 'LidLow_', 'Braid', 'Mouth_', 'Brow_', 'Jaw', 'LipUp')


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


def face_joints(me, J, variant):
    """Landmarks for the face rig, measured on the fitting cage: mouth corners, brows, the jaw's hinge."""
    import numpy as np
    k = J['head_top'].z / HEIGHTS[variant]
    co = np.array([v.co[:] for v in me.vertices])
    fsets = face_sets(me)
    per = set_vertices(me, fsets)
    eye = (J['eye_L'] + J['eye_R']) / 2
    mouth = co[sorted(per[FS['mouth']])]
    front = mouth[np.abs(mouth[:, 0]) < .006 * k]
    y_front = float(front[:, 1].min()); z_line = float(front[:, 2].min())
    head = co[sorted(set().union(*(per[FS[n]] for n in ('head', 'jaw', 'chin', 'mouth'))))]

    def surface(x, z, reach=.006):
        near = head[(np.abs(head[:, 0] - x) < reach * k) & (np.abs(head[:, 2] - z) < reach * k) & (head[:, 1] < J['ears'].y - .02)]
        if not len(near):
            return V((x, y_front + .01, z))
        return V((x, float(near[:, 1].min()), z))

    half = .0245 * k
    out = {}
    for side, s in (('L', 1), ('R', -1)):
        out['mouth_corner_' + side] = surface(s * half, z_line - .0015 * k)
        out['brow_' + side] = surface(s * .036 * k, eye.z + .0225 * k)
    out['jaw_hinge'] = V((0, J['ears'].y - .012 * k, J['ears'].z - .006 * k))
    chin = co[sorted(per[FS['chin']])]
    out['chin_front'] = V((0, float(chin[:, 1].min()), float(chin[:, 2].min()) + .012 * k))
    out['lip_line'] = V((0, y_front, z_line))
    return out


def face_weights(body, joints, eyes, variant):
    """Weight the face to its bones: fields over the skin, measured from each landmark.

    Each vertex's existing influences (the head, the neck, an upper lid) are scaled
    down by what the face bones take, as the upper lids' weights are.
    """
    import numpy as np
    J = joints
    if 'mouth_corner_L' not in J or body.vertex_groups.get('Head') is None:
        return {}
    me = body.data
    k = J['head_top'].z / HEIGHTS[variant]
    fsets = face_sets(me)
    per = set_vertices(me, fsets)
    names = ('head', 'jaw', 'chin', 'mouth', 'eyelid_L', 'eyelid_R')
    ids = np.array(sorted(set().union(*(per[FS[n]] for n in names))))
    P = np.array([me.vertices[i].co[:] for i in ids])
    index = {int(v): n for n, v in enumerate(ids)}

    def ease(x):
        x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)

    W = {}
    z_line = J['lip_line'].z
    # The jaw carries the lower lip, the chin and the mouth's floor (see MOUTH_INSIDE above for
    # what the sets hold). The lower lip's edge follows it fully, so the lips part where they
    # meet; up the sides of the face the pull fades out over two centimetres.
    low = np.zeros(len(ids))
    for n in ('chin', 'jaw'):
        for v in per[FS[n]]:
            low[index[v]] = 1.0
    nb = [[] for _ in ids]
    for e in me.edges:
        a, b = e.vertices
        if a in index and b in index:
            nb[index[a]].append(index[b]); nb[index[b]].append(index[a])
    side_fall = 1 - ease((P[:, 2] - (z_line + .001 * k)) / (.018 * k))
    low = low * side_fall
    for _ in range(2):                                   # soften the sets' edge over a couple of rings
        soft = np.array([(low[i] * 2 + sum(low[j] for j in nb[i])) / (2 + len(nb[i])) for i in range(len(ids))])
        # ...but never across the slit: the upper lip's edge stays with the head.
        low = np.where(low > .98, low, soft)
    upper_inside = np.zeros(len(ids), dtype=bool)
    for v in per[FS['mouth']]:
        upper_inside[index[v]] = True
    low[upper_inside & (P[:, 2] > z_line - .0004 * k)] = 0.0
    W['Jaw'] = low * .97
    for side, s in (('L', 1), ('R', -1)):
        c = np.array(J['mouth_corner_' + side][:])
        d = np.linalg.norm(P - c, axis=1)
        same = ease((P[:, 0] * s + .006 * k) / (.012 * k))
        # The corner pulls its lips and, more gently, the cheek above it.
        cheek = c + np.array([s * .012 * k, .004, .022 * k])
        W['Mouth_' + side] = np.maximum(np.exp(-(d / (.019 * k)) ** 2) * .9,
                                        np.exp(-(np.linalg.norm(P - cheek, axis=1) / (.026 * k)) ** 2) * .36) * same
        b = np.array(J['brow_' + side][:])
        q = (P - b) / np.array([.027 * k, .034 * k, .0115 * k])
        W['Brow_' + side] = np.exp(-(q * q).sum(axis=1)) * .92 * ease((P[:, 0] * s + .004 * k) / (.01 * k))
    # The upper lip: the skin above the slit, fading out up the philtrum and toward the corners.
    lip = np.array([0.0, J['lip_line'].y, z_line + .005 * k])
    q = (P - lip) / np.array([.021 * k, .022 * k, .0105 * k])
    above = ease((P[:, 2] - (z_line - .0006 * k)) / (.0016 * k))
    W['LipUp'] = np.exp(-(q * q).sum(axis=1)) * .8 * above
    # Lower lids: the skin under each eye (most of it belongs to the head's set, not the lids').
    for side, eye in (('L', eyes[0]), ('R', eyes[1])):
        c = np.array((sum((v.co for v in eye.data.vertices), V()) / len(eye.data.vertices))[:])
        low_c = c + np.array([0.0, -.011 * k, -.0085 * k])
        q = (P - low_c) / np.array([.0165 * k, .014 * k, .0068 * k])
        under = ease((c[2] - .0008 * k - P[:, 2]) / (.002 * k)) * (P[:, 1] < c[1] - .004 * k)
        W['LidLow_' + side] = np.exp(-(q * q).sum(axis=1)) * .85 * under
    # At a corner the mouth's own bone leads: the jaw's share gives way to it, late, so an
    # open mouth is a U and not a V.
    W['Jaw'] = W['Jaw'] * (1 - .8 * np.maximum(W['Mouth_L'], W['Mouth_R']) ** 1.7)
    W['LipUp'] = W['LipUp'] * (1 - .7 * np.maximum(W['Mouth_L'], W['Mouth_R']))
    total = np.zeros(len(ids))
    for w in W.values():
        total += w
    scale = np.where(total > .96, .96 / np.maximum(total, 1e-9), 1.0)
    groups = {n: (body.vertex_groups.get(n) or body.vertex_groups.new(name=n)) for n in W}
    count = 0
    for n_i, vi in enumerate(ids):
        share = float(total[n_i] * scale[n_i])
        if share < 2e-3:
            continue
        v = me.vertices[int(vi)]
        for ge in v.groups:
            ge.weight *= (1 - share)
        for name, w in W.items():
            wv = float(w[n_i] * scale[n_i])
            if wv > 1e-3:
                groups[name].add([int(vi)], wv, 'REPLACE')
        count += 1
    return dict(vertices=count, jaw=int((W['Jaw'] > .05).sum()), mouth=int((W['Mouth_L'] > .05).sum()),
                brow=int((W['Brow_L'] > .05).sum()), lid_low=int((W['LidLow_L'] > .05).sum()))
