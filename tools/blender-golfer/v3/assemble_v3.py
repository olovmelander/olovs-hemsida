"""Assemble a v3 golfer: fitted body, rig, eyes and the bag's clubs."""
import bpy, math
from mathutils import Vector as V, Matrix
import body_v3, clubs_v3
from rig_math import Skeleton
from body_pose import Body
from grip_v3 import Grip


def bone_parent(ob, rig, bone):
    """Rigid child of a bone that keeps its current armature-space placement."""
    b = rig.data.bones[bone]
    tail = b.matrix_local @ Matrix.Translation((0, b.length, 0))
    ob.parent = rig; ob.parent_type = 'BONE'; ob.parent_bone = bone
    ob.matrix_parent_inverse = (rig.matrix_world @ tail).inverted()


def rigid_weights(ob, rig, bone):
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    ob.parent = rig
    mod = ob.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = rig


def build(variant, collection, level=1, with_clubs=True):
    body_src, eye_l, eye_r, M, scale = body_v3.load_source(variant, collection)
    cage = body_v3.cage_copy(body_src, collection)
    J = body_v3.fit_joints(cage.data)
    for side, eye in (('L', eye_l), ('R', eye_r)):
        J['eye_' + side] = sum((v.co for v in eye.data.vertices), V()) / len(eye.data.vertices)
    J.update(body_v3.face_joints(cage.data, J, variant))
    rig = body_v3.build_rig(variant, cage.data, J, collection, braid=variant == 'female')
    body_v3.heat_weights(cage, rig)
    body_v3.copy_groups(cage, body_src)
    body = body_v3.evaluated_level(body_src, level, f'Golfer_v3_{variant}_Body', collection)
    for p in body.data.polygons:
        p.use_smooth = True
    body.parent = rig
    mod = body.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = rig
    lids = body_v3.lid_weights(body, J, (eye_l, eye_r))
    print('LIDS', lids)
    print('FACE', body_v3.face_weights(body, J, (eye_l, eye_r), variant))
    for side, eye in (('L', eye_l), ('R', eye_r)):
        eye.name = f'Golfer_v3_{variant}_Eye_{side}'
        rigid_weights(eye, rig, 'Eye_' + side)
    cage.hide_render = True; cage.hide_set(True)
    body_src.hide_render = True; body_src.hide_set(True)
    skel = Skeleton(rig)
    out = dict(variant=variant, rig=rig, body=body, eyes=(eye_l, eye_r), cage=cage, source=body_src,
               joints=J, skel=skel, bodypose=Body(skel, J), clubs={}, club_data={})
    if with_clubs:
        rest = rig.data.bones['ClubGrip'].matrix_local.copy()
        for cid, (ob, loft, faces) in clubs_v3.load_clubs(collection).items():
            fit = {'female': 1.0, 'male': 1.035}[variant]
            data = clubs_v3.seat(ob, cid, loft, faces, rest, fit)
            clubs_v3.decimate(ob, clubs_v3.DECIMATE[cid])
            contact, ball = clubs_v3.contact_point(data, cid)
            data['contact'] = contact; data['ball'] = ball
            ob['club_id'] = cid
            bone_parent(ob, rig, 'ClubGrip')
            out['clubs'][cid] = ob; out['club_data'][cid] = data
    out['grips'] = {cid: Grip(out['bodypose'], putter=cid == 'Putter') for cid in ('Driver', 'Wood', 'Iron', 'Wedge', 'Putter')}
    if with_clubs:
        add_markers(out, collection)
    return out


def add_markers(G, collection):
    """Bone-parented empties the browser audits read (no draw calls)."""
    rig = G['rig']
    def marker(name, bone, armature_point):
        ob = bpy.data.objects.new(name, None); collection.objects.link(ob)
        ob.empty_display_size = .02; ob['golfer_motion_marker'] = True
        ob.matrix_world = rig.matrix_world @ Matrix.Translation(armature_point)
        b = rig.data.bones[bone]
        tail = b.matrix_local @ Matrix.Translation((0, b.length, 0))
        ob.parent = rig; ob.parent_type = 'BONE'; ob.parent_bone = bone
        ob.matrix_parent_inverse = (rig.matrix_world @ tail).inverted()
        ob.matrix_world = rig.matrix_world @ Matrix.Translation(armature_point)
        return ob
    rest = rig.data.bones['ClubGrip'].matrix_local
    for cid, d in G['club_data'].items():
        # The ball's centre at contact (the manifest's contact point) and the face direction.
        marker('Contact_' + cid, 'ClubGrip', rest @ d['ball'])
        marker('Face_' + cid, 'ClubGrip', rest @ (d['ball'] + V((0, 0, .05))))
    marker('ShaftAxis', 'ClubGrip', rest @ V((0, .2, 0)))
    grip = G['grips']['Iron']
    for side in 'LR':
        H = grip.hand_frame(side)          # hand frame in socket coordinates
        P = grip.p['lead'] if side == 'L' else grip.p['trail']
        point_hand = V((P['x'], P['y'] * grip.hand_len[side], P['z'] * grip.thick))
        hand_rest = rig.data.bones['Hand_' + side].matrix_local
        marker('Grip_' + side, 'Hand_' + side, hand_rest @ point_hand)
