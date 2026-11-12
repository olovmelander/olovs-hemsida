"""High-level body posing for the v3 golfer.

Body.solve(spec) turns a compact description -- pelvis, thorax, head, clavicles,
hand targets, foot plants, finger shapes, eye target, club -- into a complete
armature-space pose for the fitted rig.
"""
import math
from mathutils import Vector as V, Matrix, Quaternion
from rig_math import (frame, mat4, rot_axis, two_bone, swing_twist, clamp, mix, smooth,
                      UP, FWD, LEFT, PI)

FINGER_NAMES = ('Index', 'Middle', 'Ring', 'Pinky')
SIDES = (('L', 1), ('R', -1))
# Upper lids (radians about the head's lateral axis, + closes): a relaxed droop over
# the top of the iris, a share of the gaze's downward pitch, and closed for a blink.
LID_DROOP = math.radians(13)
LID_FOLLOW = .55
LID_CLOSED = math.radians(60)


def limb_axis(bend, hint, axis, length):
    """The bend direction of a limb, falling back to the hint as it straightens."""
    perp = V(hint) - axis * axis.dot(V(hint))
    perp = perp.normalized() if perp.length > 1e-6 else axis.orthogonal().normalized()
    if bend.length < 1e-6:
        return perp
    w = smooth(bend.length / (.03 * length))
    return (bend.normalized() * w + perp * (1 - w)).normalized()


def hinge_frame(upper, direction):
    """The lower segment shares the upper segment's hinge (X) axis: no flips at deep bends."""
    x = upper.col[0].normalized(); y = V(direction).normalized()
    y = (y - x * x.dot(y)).normalized()
    return Matrix((x, y, x.cross(y))).transposed()


def slerp3(r, t):
    q = r.to_quaternion()
    return Quaternion().slerp(q, t).to_matrix()


class Body:
    def __init__(self, skel, joints, finger_radius=.0085):
        self.s = skel
        self.j = joints
        self.finger_radius = finger_radius
        self.blink = 0.0            # set per frame by the bake
        self.face = None            # the expression, set per frame by the bake (see bake_v3.expression)
        s = skel
        self.hip_offset = {side: s.head['Thigh_' + side] - s.head['Hips'] for side, _ in SIDES}
        self.lengths = {n: s.length[n] for n in s.order}
        self.foot = {}
        for side, _ in SIDES:
            ankle = s.head['Foot_' + side]; ball = s.head['Toe_' + side]
            sole = joints['sole_z_' + side]
            heel = V((joints['heel_' + side].x, joints['heel_' + side].y, sole))
            tip = V((ball.x, joints['toe_tip_' + side].y, sole))
            self.foot[side] = dict(ankle=ankle, ball=ball, heel=heel, tip=tip, sole=sole,
                                   ball_ground=V((ball.x, ball.y, sole)))

    # -- feet ---------------------------------------------------------------
    def foot_pose(self, side, plant, yaw=0.0, roll=0.0, lift=V(), pitch=0.0, toe_bend=None, clamp_ground=True):
        """Foot and toe frames.

        plant: world xy (z ignored) of the ball-of-foot ground contact.
        roll > 0 raises the heel about the ball, keeping the toes flat (up to
        about 55 deg, then the whole foot pivots on the toe tip); roll < 0
        lifts the toes about the heel. pitch tilts the whole foot in flight
        about the ankle; lift translates it.
        """
        f = self.foot[side]; s = self.s
        yawm = rot_axis(UP, yaw)
        ground = V((plant[0], plant[1], f['sole']))
        def place(p):  # rest point -> flat planted world point
            return ground + yawm @ (p - f['ball_ground'])
        lateral = yawm @ LEFT
        foot_rot = yawm.copy(); toe_rot = yawm.copy()
        ankle = place(f['ankle']); ball = place(f['ball'])
        if roll > 0:
            ball_roll = min(roll, math.radians(55)); tip_roll = roll - ball_roll
            r = rot_axis(lateral, ball_roll)      # heel up about the ball
            pivot = place(f['ball_ground'])
            ankle = pivot + r @ (ankle - pivot); foot_rot = r @ foot_rot
            if tip_roll > 0:
                r2 = rot_axis(lateral, tip_roll); pivot2 = place(f['tip'])
                ankle = pivot2 + r2 @ (ankle - pivot2); ball = pivot2 + r2 @ (ball - pivot2)
                foot_rot = r2 @ foot_rot; toe_rot = r2 @ toe_rot
        elif roll < 0:
            r = rot_axis(lateral, roll)            # toes up about the heel
            pivot = place(f['heel'])
            ankle = pivot + r @ (ankle - pivot); ball = pivot + r @ (ball - pivot)
            foot_rot = r @ foot_rot; toe_rot = r @ toe_rot
        if pitch:
            r = rot_axis(lateral, pitch)
            ball = ankle + r @ (ball - ankle); foot_rot = r @ foot_rot; toe_rot = r @ toe_rot
        if toe_bend is not None:
            toe_rot = rot_axis(lateral, -toe_bend) @ foot_rot
        ankle = ankle + V(lift); ball = ball + V(lift)
        if clamp_ground:
            # No part of the sole may go below the ground.
            def world(p):
                return ankle + foot_rot @ (yawm.transposed() @ (place(p) - place(f['ankle'])))
            lowest = min(world(f['heel']).z, world(f['tip']).z, world(f['ball_ground']).z) - f['sole']
            toe_tip = ball + toe_rot @ (yawm.transposed() @ (place(f['tip']) - place(f['ball'])))
            lowest = min(lowest, toe_tip.z - f['sole'])
            if lowest < 0:
                ankle = ankle + V((0, 0, -lowest)); ball = ball + V((0, 0, -lowest))
        foot_m = mat4(foot_rot @ s.rest3['Foot_' + side], ankle)
        toe_m = mat4(toe_rot @ s.rest3['Toe_' + side], ball)
        return foot_m, toe_m

    # -- fingers ------------------------------------------------------------
    def finger_chain(self, hand_m, side, finger, angles, base_extra=None):
        s = self.s; out = {}
        parent_name = 'Hand_' + side; parent_m = hand_m
        for i in range(3):
            name = f'{finger}{i + 1}_{side}'
            local = s.rest[parent_name].inverted() @ s.rest[name]
            basis = Matrix.Rotation(-angles[i], 4, 'X')
            if i == 0 and base_extra is not None:
                basis = base_extra @ basis
            m = parent_m @ local @ basis
            out[name] = m; parent_m = m; parent_name = name
        return out

    def relaxed_fingers(self, hand_m, side, amount=.35, spread=0.0):
        pose = {}
        for k, finger in enumerate(FINGER_NAMES):
            a = amount * (1 + .18 * k)
            extra = Matrix.Rotation(spread * (k - 1.2) * .06, 4, 'Z')
            pose.update(self.finger_chain(hand_m, side, finger, (a * .55, a * 1.0, a * .7), extra))
        pose.update(self.finger_chain(hand_m, side, 'Thumb', (amount * .2, amount * .35, amount * .3)))
        return pose

    def fist(self, hand_m, side, amount=1.0):
        pose = {}
        for finger in FINGER_NAMES:
            pose.update(self.finger_chain(hand_m, side, finger, (1.45 * amount, 1.6 * amount, 1.0 * amount)))
        pose.update(self.finger_chain(hand_m, side, 'Thumb', (.5 * amount, .7 * amount, .6 * amount),
                                      Matrix.Rotation(.5 * amount, 4, 'Z')))
        return pose

    # -- whole body ---------------------------------------------------------
    def solve(self, spec):
        """spec keys:
        root (4x4, optional), pelvis_pos (V), pelvis_rot (3x3 world rotation of rest),
        thorax_rot (3x3), head_rot (3x3) or look (V), clavicle {side: (elev, protract)},
        hands {side: 4x4 absolute hand frame at the wrist}, elbow {side: bend hint},
        feet {side: (foot_m, toe_m)}, knee {side: hint}, fingers {side: dict of bone 4x4 or
        callable(hand_m)->dict}, eyes (V), club (4x4 absolute ClubGrip frame), extra {bone: 4x4}.
        """
        s = self.s; pose = {}
        root = spec.get('root', Matrix.Identity(4))
        pose['Root'] = root @ s.rest['Root']
        R = root.to_3x3()
        def W(p):
            return root @ V(p)
        pr = R @ spec.get('pelvis_rot', Matrix.Identity(3))
        tr = R @ spec.get('thorax_rot', spec.get('pelvis_rot', Matrix.Identity(3)))
        pelvis_pos = V(spec['pelvis_pos'])
        if spec.get('fit_legs', True) and 'feet' in spec:
            # A planted foot the leg cannot reach lowers the pelvis instead.
            pl = spec.get('pelvis_rot', Matrix.Identity(3))
            for side, _ in SIDES:
                foot_m = spec['feet'][side][0]
                ankle = foot_m.translation
                off = pl @ self.hip_offset[side]
                L = (s.length['Thigh_' + side] + s.length['Shin_' + side]) * .993
                hip = pelvis_pos + off
                horiz = V((hip.x - ankle.x, hip.y - ankle.y)).length
                if horiz < L:
                    zmax = ankle.z + math.sqrt(L * L - horiz * horiz) - off.z
                    if pelvis_pos.z > zmax:
                        pelvis_pos.z = zmax
        hips_head = W(pelvis_pos)
        pose['Hips'] = mat4(pr @ s.rest3['Hips'], hips_head)
        rel = pr.transposed() @ tr
        weights = spec.get('spine_share', (.30, .66, 1.0))
        parent = 'Hips'
        for name, w in zip(('Spine', 'Chest', 'UpperChest'), weights):
            head = (pose[parent] @ s.rest[parent].inverted() @ s.rest[name]).translation
            pose[name] = mat4(pr @ slerp3(rel, w) @ s.rest3[name], head)
            parent = name
        ut = pose['UpperChest'].to_3x3() @ s.rest3['UpperChest'].transposed()
        # Head: either a world rotation or a look-at with a level-ish horizon.
        if 'look' in spec:
            eye_mid = (s.head['Eye_L'] + s.head['Eye_R']) / 2
            neck_head = (pose['UpperChest'] @ s.rest['UpperChest'].inverted() @ s.rest['Neck']).translation
            approx_eye = neck_head + ut @ (eye_mid - s.head['Neck'])
            d = (W(spec['look']) - approx_eye).normalized()
            up_ref = (ut @ UP).lerp(R @ UP, spec.get('level', .55)).normalized()
            look_rot = frame(-d, up_ref)         # head rest: -Y forward, Z up
            rest_look = frame(-FWD, UP)
            hr = look_rot @ rest_look.transposed()
            if 'head_tilt' in spec:
                hr = rot_axis(d, spec['head_tilt']) @ hr
        else:
            hr = R @ spec.get('head_rot', spec.get('thorax_rot', Matrix.Identity(3)))
        relh = ut.transposed() @ hr
        neck_head = (pose['UpperChest'] @ s.rest['UpperChest'].inverted() @ s.rest['Neck']).translation
        pose['Neck'] = mat4(ut @ slerp3(relh, .42) @ s.rest3['Neck'], neck_head)
        head_head = (pose['Neck'] @ s.rest['Neck'].inverted() @ s.rest['Head']).translation
        pose['Head'] = mat4(hr @ s.rest3['Head'], head_head)
        # Clavicles, arms, hands.
        hands = spec.get('hands', {})
        for side, sgn in SIDES:
            cl = 'Clavicle_' + side
            base = pose['UpperChest'] @ s.rest['UpperChest'].inverted() @ s.rest[cl]
            elev, protract = spec.get('clavicle', {}).get(side, (0.0, 0.0))
            fwd_t = ut @ FWD; up_t = ut @ UP
            crot = rot_axis(up_t, -sgn * protract) @ rot_axis(fwd_t, sgn * elev)
            pose[cl] = mat4(crot @ base.to_3x3(), base.translation)
            shoulder = (pose[cl] @ V((0, s.length[cl], 0)))
            ua, fa, hn = 'UpperArm_' + side, 'Forearm_' + side, 'Hand_' + side
            if side in hands:
                hand_m = hands[side]
                wrist = hand_m.translation
                hint = spec.get('elbow', {}).get(side, ut @ V((sgn * .3, 1, -.2)))
                l1, l2 = s.length[ua], s.length[fa]
                rel_rest = s.rest3[fa].transposed() @ s.rest3[hn]
                def arm_frames(h):
                    elbow, wrist2 = two_bone(shoulder, wrist, l1, l2, h)
                    axis = (wrist2 - shoulder).normalized()
                    bend = elbow - (shoulder + axis * (elbow - shoulder).dot(axis))
                    b = limb_axis(bend, h, axis, l1 + l2)
                    F1 = frame(elbow - shoulder, -b)
                    return elbow, wrist2, F1, hinge_frame(F1, wrist2 - elbow)
                if spec.get('elbow_auto', {}).get(side):
                    # Choose the elbow plane that needs the least forearm twist and wrist bend.
                    axis = (wrist - shoulder).normalized()
                    best = None
                    for kk in range(-12, 13):
                        h = rot_axis(axis, PI / 3 * kk / 12) @ V(hint)
                        elbow, wrist2, F1, F2 = arm_frames(h)
                        rel = F2.transposed() @ hand_m.to_3x3()
                        tw = abs(swing_twist((rel @ rel_rest.transposed()).to_quaternion(), V((0, 1, 0))))
                        bendw = hand_m.to_3x3().col[1].angle(wrist2 - elbow)
                        cost = tw + 2.0 * max(0.0, bendw - 1.05) + 1.1 * h.angle(V(hint))
                        if best is None or cost < best[0]:
                            best = (cost, h)
                    hint = best[1]
                elbow, wrist2, F1, F2 = arm_frames(hint)
                pose[ua] = mat4(F1, shoulder)
                pose[fa] = mat4(F2, elbow)
                hm = hand_m.copy(); hm.translation = wrist2
                pose[hn] = hm
                self.max_reach_gap = max(getattr(self, 'max_reach_gap', 0.0), (wrist2 - wrist).length)
            else:
                # Hanging arms if no target: follow the clavicle rigidly.
                pose[ua] = s.child_rigid(pose, ua); pose[fa] = s.child_rigid(pose, fa); pose[hn] = s.child_rigid(pose, hn)
            # Forearm twist takes half the hand's roll about the forearm.
            fa_m = pose[fa]; tw = 'ForearmTwist_' + side
            rel_rest = s.rest3[fa].transposed() @ s.rest3[hn]
            rel_now = fa_m.to_3x3().transposed() @ pose[hn].to_3x3()
            q = (rel_now @ rel_rest.transposed()).to_quaternion()
            raw = swing_twist(q, V((0, 1, 0)))
            # Continuous through the +-180 wrap: past 115 deg the share eases back to zero.
            a = abs(raw); lim = 2.0
            share = a if a <= lim else lim * (PI - a) / (PI - lim)
            angle = math.copysign(share, raw)
            twist_rot = fa_m.to_3x3() @ Matrix.Rotation(angle * .5, 3, 'Y')
            tw_head = (fa_m @ s.rest[fa].inverted() @ s.rest[tw]).translation
            pose[tw] = mat4(twist_rot @ (s.rest3[fa].transposed() @ s.rest3[tw]), tw_head)
            # Fingers.
            fingers = spec.get('fingers', {}).get(side)
            if callable(fingers):
                pose.update(fingers(pose[hn]))
            elif isinstance(fingers, dict):
                pose.update(fingers)
            else:
                pose.update(self.relaxed_fingers(pose[hn], side))
        # Legs.
        feet = spec['feet']
        for side, sgn in SIDES:
            th, sh, ft, to = 'Thigh_' + side, 'Shin_' + side, 'Foot_' + side, 'Toe_' + side
            hip = (pose['Hips'] @ s.rest['Hips'].inverted() @ s.rest[th]).translation
            foot_m, toe_m = feet[side]
            foot_m = root @ foot_m; toe_m = root @ toe_m
            ankle = foot_m.translation
            foot_fwd = (foot_m.to_3x3() @ s.rest3[ft].transposed()) @ FWD
            hint = spec.get('knee', {}).get(side, (foot_fwd + R @ V((sgn * .12, 0, 0))).normalized())
            knee, ankle2 = two_bone(hip, ankle, s.length[th], s.length[sh], hint)
            self.max_leg_gap = max(getattr(self, 'max_leg_gap', 0.0), (ankle2 - ankle).length)
            axis = (ankle2 - hip).normalized()
            bend = knee - (hip + axis * (knee - hip).dot(axis))
            bend = limb_axis(bend, hint, axis, s.length[th] + s.length[sh])
            F1 = frame(knee - hip, bend)
            pose[th] = mat4(F1, hip)
            pose[sh] = mat4(hinge_frame(F1, ankle2 - knee), knee)
            fm = foot_m.copy(); fm.translation = ankle2
            pose[ft] = fm
            tm = toe_m.copy(); tm.translation = (fm @ s.rest[ft].inverted() @ s.rest[to]).translation
            pose[to] = tm
        # Eyes.
        for side, _ in SIDES:
            e = 'Eye_' + side
            base = pose['Head'] @ s.rest['Head'].inverted() @ s.rest[e]
            if 'eyes' in spec:
                d = (W(spec['eyes']) - base.translation).normalized()
                hf = pose['Head'].to_3x3() @ s.rest3['Head'].transposed()
                fwd = hf @ FWD
                ang = fwd.angle(d)
                limit = math.radians(32)
                if ang > limit:
                    d = fwd.slerp(d, limit / ang) if hasattr(fwd, 'slerp') else d
                pose[e] = mat4(frame(d, hf @ UP), base.translation)
            else:
                pose[e] = base
            # The upper lid: a relaxed droop over the iris, following the gaze down
            # (and a little up), and the blink closing it over the eyeball.
            lid = 'Lid_' + side
            if lid in s.rest:
                hf = pose['Head'].to_3x3() @ s.rest3['Head'].transposed()
                gaze = pose[e].to_3x3() @ s.rest3[e].transposed() @ FWD
                local = hf.transposed() @ gaze
                pitch = math.atan2(local.z, -local.y)
                open_a = LID_DROOP + LID_FOLLOW * max(0.0, -pitch) - .35 * max(0.0, pitch)
                blink = spec.get('blink', self.blink)
                a = open_a + (LID_CLOSED - open_a) * blink
                lbase = pose['Head'] @ s.rest['Head'].inverted() @ s.rest[lid]
                rot = hf @ Matrix.Rotation(a, 3, 'X') @ hf.transposed()
                push = hf @ V((0, -.0009 * blink, 0))
                pose[lid] = mat4(rot @ lbase.to_3x3(), lbase.translation + push)
        # The face: jaw (degrees, + opens), smile 0..1, brow -1 (drawn down) .. 1 (raised), squint 0..1.
        face = spec.get('face', self.face)
        if face and 'Jaw' in s.rest:
            H = pose['Head'] @ s.rest['Head'].inverted()
            hf = H.to_3x3()

            def turn(name, rx=0.0, rz=0.0):
                base = H @ s.rest[name]
                R = hf @ (Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(rx, 3, 'X')) @ hf.transposed()
                pose[name] = mat4(R @ base.to_3x3(), base.translation)

            smile = clamp(face.get('smile', 0.0), 0, 1); brow = clamp(face.get('brow', 0.0), -1, 1)
            squint = clamp(face.get('squint', 0.0), 0, 1)
            # About the head's lateral axis a positive turn carries the face's front down.
            turn('Jaw', rx=math.radians(face.get('jaw', 0.0)))
            for side, sgn in SIDES:
                # A smile lifts each corner up and draws it back and out.
                turn('Mouth_' + side, rx=-math.radians(4.2) * smile, rz=sgn * math.radians(2.6) * smile)
                # A raised brow rides up; a drawn brow comes down and in.
                turn('Brow_' + side, rx=-math.radians(2.6 * brow if brow > 0 else 1.9 * brow),
                     rz=-sgn * math.radians(1.3) * max(0.0, -brow))
                turn('LidLow_' + side, rx=-math.radians(11) * max(squint, .7 * smile))
            # The upper lip lifts off the teeth in a smile, and a little as the jaw drops.
            if 'LipUp' in s.rest:
                turn('LipUp', rx=-math.radians(2.0 * smile + .09 * max(0.0, face.get('jaw', 0.0))))
        if 'club' in spec:
            pose['ClubGrip'] = root @ spec['club']
        for name, m in spec.get('extra', {}).items():
            pose[name] = m
        return s.fill(pose)
