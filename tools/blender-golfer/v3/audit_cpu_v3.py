"""The motion audit on the CPU, inside Blender (12 November).

audit_motion_v3.mjs measures the exported GLB in Chrome on the GPU. This is
the same audit, with the same thresholds, read from the rig itself, so a build
checks its own motion with no browser and no GPU. build_v3.py runs it after
the bake (and --audit-only stops there).

Measured at 120 samples a second (the frames between the 60 fps keys too):
loop seams, abrupt rotations, soles under the ground, hands off the grip,
wrist bend, a pivoting toe that slides, planted feet that slide, arm and leg
opposition in the gaits, elbows and knees bending the wrong way, and at
impact the contact point, the strike direction, the face and the ball height.

Frames: glTF's (x, y, z) is Blender's (x, z, -y). The checks are written here
in Blender's own frame: up is +Z, the golfer faces -Y, the shot travels +X.
"""
import bpy, json, math
import numpy as np
from mathutils import Vector as V, Quaternion, Matrix

HZ = 120
LIMITS = dict(loop_seam=.002, joint_step=25.0, sole=-.008, grip=.008, toe_slide=.001, wrist=70.0, stance_drift=.004,
              arm_foot=-.95, elbow_back=.025, knee_forward=.01, contact=.001, forward=.95, face=.99, ball=.02135)


def _sole_samples(G):
    """Vertices that follow one foot bone almost wholly, with that bone's rest-space position."""
    out = {'L': [], 'R': []}
    rig = G['rig']
    for ob in rig.children:
        if ob.type != 'MESH' or ob.get('golfer_motion_marker') or ob.get('golfer_source'):
            continue
        names = {g.index: g.name for g in ob.vertex_groups}
        for i in range(0, len(ob.data.vertices), 5):
            v = ob.data.vertices[i]
            for ge in v.groups:
                n = names.get(ge.group, '')
                if ge.weight > .98 and n in ('Foot_L', 'Foot_R'):
                    out[n[-1]].append(V(v.co)); break
    rest = {s: rig.data.bones['Foot_' + s].matrix_local.inverted() for s in 'LR'}
    return {s: [rest[s] @ p for p in pts] for s, pts in out.items()}


def _markers(G):
    """Each audit marker as (bone, the point in that bone's own space).

    Read from the parenting itself, not from the marker's current world matrix: the
    carry fit (carry_v3.py) leaves the rig posed, and a posed marker is not at rest.
    """
    rig = G['rig']; out = {}
    for ob in rig.children:
        if ob.get('golfer_motion_marker'):
            b = rig.data.bones[ob.parent_bone]
            tail = b.matrix_local @ Matrix.Translation((0, b.length, 0))
            at_rest = rig.matrix_world @ tail @ ob.matrix_parent_inverse @ ob.matrix_basis
            out[ob.name] = (ob.parent_bone, b.matrix_local.inverted() @ (rig.matrix_world.inverted() @ at_rest).translation)
    return out


def _axis_offset(a, b, c):
    ac = (c - a).normalized(); ab = b - a
    return ab - ac * ab.dot(ac)


def audit(G, clips, pose_at):
    """clips: the manifest's clip entries. pose_at(name, t) -> {bone: armature-space matrix}."""
    soles = _sole_samples(G); markers = _markers(G)
    grip = {side: G['grips']['Iron'].along(side) for side in 'LR'}
    skel = G['skel']
    report = []; failures = []

    def check(ok, message):
        if not ok:
            failures.append(message)

    for data in clips:
        name = data['name']; duration = data['duration']
        n = math.ceil(duration * HZ)

        def at(t):
            pose = pose_at(name, t)
            def mark(key):
                bone, local = markers[key]
                return pose[bone] @ local
            return pose, mark

        grip_error = 0.0; min_contact = math.inf; max_step = 0.0; worst = ''; max_wrist = 0.0; min_sole = math.inf
        min_elbow_back = math.inf; min_knee_forward = math.inf; toe_slide = 0.0
        toe_start = {}; old = {}; first = {}; last = {}; hand_foot = {'L': [], 'R': []}
        for index in range(n + 1):
            t = min(duration - 1e-6, index / HZ)
            pose, mark = at(t)
            pos = lambda b: pose[b].translation
            hip = pos('Hips')
            for side in 'LR':
                shoulder, elbow, hand = pos('UpperArm_' + side), pos('Forearm_' + side), pos('Hand_' + side)
                # glTF's -z is Blender's +y: "back" is +Y here.
                min_elbow_back = min(min_elbow_back, _axis_offset(shoulder, elbow, hand).y)
                knee = _axis_offset(pos('Thigh_' + side), pos('Shin_' + side), pos('Foot_' + side))
                min_knee_forward = min(min_knee_forward, -knee.y)
                hand_foot[side].append((-(hand.y - hip.y), -(pos('Foot_' + side).y - hip.y)))
                axis = pose['Hand_' + side].to_3x3() @ V((0, 1, 0))
                max_wrist = max(max_wrist, math.degrees(axis.angle(hand - elbow)))
            if index % 4 == 0:
                for side in 'LR':
                    m = pose['Foot_' + side]
                    for p in soles[side]:
                        min_sole = min(min_sole, (m @ p).z)
            if name.startswith('Swing') and 'PivotToe_L' in markers:
                for side in 'LR':
                    toe = mark('PivotToe_' + side).copy(); toe.z = 0
                    toe_start.setdefault(side, toe.copy())
                    toe_slide = max(toe_slide, (toe - toe_start[side]).length)
            if name.startswith('Address') or data.get('impact') is not None:
                origin = pose['ClubGrip'].translation
                shaft = (mark('ShaftAxis') - origin).normalized()
                for side in 'LR':
                    if side == 'R' and data.get('trailRelease') is not None and t > data['trailRelease']:
                        continue
                    hand = mark('Grip_' + side) - origin
                    along = hand.dot(shaft)
                    grip_error = max(grip_error, (hand - shaft * along).length, abs(along - grip[side]))
                min_contact = min(min_contact, mark('Contact_' + data['club']).z)
            basis = skel.basis(pose)
            for bone, m in basis.items():
                q = m.to_quaternion()
                if bone in old:
                    step = math.degrees(q.rotation_difference(old[bone]).angle)
                    if step > 180:
                        step = 360 - step
                    if step > max_step:
                        max_step = step; worst = bone
                old[bone] = q
                p = pose[bone].translation.copy()
                first.setdefault(bone, p); last[bone] = p
        seam = max(((first[b] - last[b]).length for b in first), default=0.0) if data.get('loop') else 0.0
        entry = dict(name=name, loopSeamMetres=seam, maxJointStepDegrees=max_step, worstJoint=worst, gripErrorMetres=grip_error,
                     maxWristBendDegrees=max_wrist, minSoleHeight=min_sole, toeSlideMetres=toe_slide,
                     minElbowBackMetres=min_elbow_back, minKneeForwardMetres=min_knee_forward,
                     minContactHeight=None if min_contact == math.inf else min_contact)
        tag = f'{G["variant"]} {name}'
        check(seam < LIMITS['loop_seam'], f'{tag}: loop seam ({seam:.4f})')
        check(max_step < LIMITS['joint_step'], f'{tag}: abrupt rotation ({max_step:.1f} deg at {worst})')
        check(min_sole > LIMITS['sole'], f'{tag}: foot below ground ({min_sole:.4f})')
        check(grip_error < LIMITS['grip'], f'{tag}: hand separated from handle ({grip_error:.4f})')
        check(toe_slide < LIMITS['toe_slide'], f'{tag}: toe slides during follow-through ({toe_slide:.4f})')
        check(max_wrist < LIMITS['wrist'], f'{tag}: wrist bends too far ({max_wrist:.1f})')
        if name in ('Walk', 'WalkBackward', 'Jog'):
            corr = {}
            for side, values in hand_foot.items():
                a = np.array(values); c = np.corrcoef(a[:, 0], a[:, 1])[0, 1]
                corr[side] = float(c)
            entry['armFootCorrelation'] = corr
            check(corr['L'] < LIMITS['arm_foot'] and corr['R'] < LIMITS['arm_foot'], f'{tag}: arm/leg phase ({corr})')
            check(min_elbow_back > LIMITS['elbow_back'], f'{tag}: elbows bending forward ({min_elbow_back:.4f})')
            check(min_knee_forward > LIMITS['knee_forward'], f'{tag}: knees bending backwards ({min_knee_forward:.4f})')
        if data.get('speed'):
            # travelDirection is in glTF's frame: (x, y, z) -> Blender (x, -z, y).
            d = data['travelDirection']; travel = V((d[0], -d[2], d[1]))
            world = []
            for phase in (.17, .27, .37):
                t = phase * duration
                pose, _ = at(t)
                world.append(pose['Foot_L'].translation + travel * (data['speed'] * t))
            drift = max((world[0] - world[1]).length, (world[1] - world[2]).length)
            entry['stanceDriftMetres'] = drift
            check(drift < LIMITS['stance_drift'], f'{tag}: planted-foot slide ({drift:.4f})')
        if data.get('impact') is not None:
            ti = data['impact']
            _, m0 = at(ti - 1 / HZ); before = m0('Contact_' + data['club']).copy()
            _, m1 = at(ti + 1 / HZ); after = m1('Contact_' + data['club']).copy()
            _, mi = at(ti); point = mi('Contact_' + data['club']).copy()
            face = (mi('Face_' + data['club']) - point).normalized()
            velocity = (after - before) * (HZ / 2)
            c = data['contact']; meta = V((c[0], -c[2], c[1]))
            forward = velocity.normalized().dot(V((1, 0, 0)))
            entry['impact'] = dict(position=list(point), metadataError=(point - meta).length, velocity=list(velocity),
                                   forwardAlignment=forward, faceAlignment=face.dot(V((1, 0, 0))))
            check((point - meta).length < LIMITS['contact'], f'{tag}: ball/contact position ({(point - meta).length:.4f})')
            check(forward > LIMITS['forward'] and face.dot(V((1, 0, 0))) > LIMITS['face'], f'{tag}: strike/face direction')
            check(velocity.x > .1, f'{tag}: club stops at impact')
            check(abs(point.z - LIMITS['ball']) < .001, f'{tag}: club misses ball height ({point.z:.4f})')
        report.append(entry)
    return dict(sampleHz=HZ, motions=report, failures=failures, passed=not failures)


def directions(G, clips):
    """check_directions_v3.mjs's rig facts: the turns' angles and the shot's direction."""
    out = []; failures = []
    for data in clips:
        if data.get('turnAngle') is not None:
            want = math.pi / 2 if data['name'] == 'TurnLeft' else -math.pi / 2
            ok = abs(data['turnAngle'] - want) < 1e-4
            out.append(dict(clip=data['name'], turnAngle=data['turnAngle'], ok=ok))
            if not ok:
                failures.append(f'{G["variant"]} {data["name"]}: turn angle {data["turnAngle"]}')
        if data.get('impact') is not None:
            d = data.get('shotDirection', [1, 0, 0])
            ok = abs(d[0] - 1) < 1e-6 and abs(d[1]) < 1e-6 and abs(d[2]) < 1e-6
            out.append(dict(clip=data['name'], shotDirection=d, ok=ok))
            if not ok:
                failures.append(f'{G["variant"]} {data["name"]}: shot direction {d}')
    return dict(checks=out, failures=failures, passed=not failures)
