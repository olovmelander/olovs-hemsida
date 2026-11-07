"""Every clip of the v3 golfer, as pose functions of time.

The runtime contract is unchanged: the same twenty clip names, in-place
locomotion with a manifest speed, quarter turns whose heading the runtime
applies, and strokes with an impact time and contact point.

Off the course the club rests on the trail (right) shoulder -- a golfer's
carry that reads the same with every club length -- and the free lead arm
swings against the legs.
"""
import math
from mathutils import Vector as V, Matrix
from rig_math import (Spline, frame, mat4, rot_axis, smooth, smoother, mix, clamp,
                      UP, FWD, LEFT, PI)
from swing_v3 import Swing, CHIP, CHIP_GOALS, SWINGS, scaled
import clubs_v3

D = math.radians
TAU = 2 * PI

# --- putting: the shoulders rock the arms-and-putter triangle -------------------
PUTT = dict(
    t=[0.0, .30, .86, 1.22, 1.58, 2.9],
    pelvis_yaw=[0] * 6, pelvis_x=[0] * 6, pelvis_y=[0] * 6, pelvis_z=[0] * 6,
    thorax_yaw=[0, 0, -9.5, 0, 9.5, 9.5],
    tilt=[0, 0, 0, 0, 0, 0], side=[0, 0, -.5, 0, .6, .6],
    lift=[0] * 6, across=[0] * 6, hinge=[0, 0, 1.5, 0, -1, -1], flex=[0] * 6,
    roll=[0, 0, 1.0, 0, -1.0, -1.0], elbow=[3] * 6,
    trail_roll=[0] * 6, trail_yaw=[0] * 6, lead_roll=[0] * 6,
    clav_lead=[(0, 0)] * 6, clav_trail=[(0, 0)] * 6,
)
SWINGS['Putter'] = dict(table=PUTT, impact_index=3, goals={})


class Stroke:
    """A stroke clip: the swing, then watching the ball."""

    def __init__(self, G, cid):
        self.sw = Swing(G, cid)
        self.duration = self.sw.duration
        self.impact = self.sw.impact

    def pose(self, t):
        return self.sw.pose(t)


class Address:
    """The address held as a loop: breathing, a look down the line, a waggle."""

    def __init__(self, G, cid, duration=4.0):
        self.sw = Swing(G, cid)
        self.duration = duration
        self.cid = cid
        self.putt = cid == 'Putter'

    def pose(self, t):
        sw = self.sw; d = self.duration
        p = t / d
        breath = math.sin(TAU * p * 2) * .5 + .5          # two breaths per loop
        # Look at the target: the head swivels about the spine, then back.
        look = smooth((t - .9) / .45) * (1 - smooth((t - 1.85) / .5))
        waggle = 0 if self.putt else math.sin(PI * clamp((t - 2.55) / .7)) ** 2
        spec = sw.spec(0.0)
        # Breathing: a little rise of the chest and shoulders.
        spec['clavicle'] = {s: (v[0] + D(1.2) * breath, v[1]) for s, v in spec['clavicle'].items()}
        if waggle:
            # Re-solve the lead hand with a hinge waggle (the club head lifts).
            T = spec['thorax_rot']
            probe = sw.b.solve(dict(pelvis_pos=spec['pelvis_pos'], pelvis_rot=spec['pelvis_rot'],
                                    thorax_rot=T, feet=spec['feet'], clavicle=spec['clavicle']))
            hand_l, elbow_l = sw.lead_hand(0.0, probe['UpperArm_L'].translation.copy(), T, (0, 2 * waggle, 14 * waggle, -4 * waggle))
            club = hand_l @ sw.GLi
            spec.update(hands={'L': hand_l, 'R': club @ sw.GR}, club=club,
                        fingers={side: sw.grip.fingers(side, club) for side in 'LR'})
        target = sw.st.ball + V((18, 0, 1.2))
        spec['look'] = sw.st.ball.lerp(target, look * .92)
        spec['eyes'] = sw.st.ball.lerp(target, look)
        spec['level'] = .25 + .45 * look
        spec['pelvis_pos'] = spec['pelvis_pos'] + V((.004 * math.sin(TAU * p), 0, -.002 * breath))
        return sw.b.solve(spec)


class Carry:
    """Shared upright body with the club resting on the trail shoulder."""

    def __init__(self, G):
        self.G = G; self.b = G['bodypose']; self.s = G['skel']; self.J = G['joints']
        # Carrying a club over the shoulder is not a golf grip: the shaft crosses the
        # palm at the angle that lets the wrist stay neutral.
        import grip_v3
        P = {'lead': dict(grip_v3.DEFAULT['lead']),
             'trail': dict(grip_v3.DEFAULT['trail'], alpha=math.radians(37), gamma=math.radians(-10), y=.74)}
        self.grip = grip_v3.Grip(self.b, P)
        self.k = max(self.J['head_top'].z, 1.0) / 1.70
        self.GR = self.grip.hand_frame('R')
        self.GRi = self.GR.inverted()
        self.hips0 = self.s.head['Hips'].copy()
        f = self.b.foot
        self.ankle_x = {side: f[side]['ankle'].x for side in 'LR'}

    def plant(self, side, x, y, yaw=0.0):
        f = self.b.foot[side]
        d = rot_axis(UP, yaw) @ (f['ankle'] - f['ball_ground'])
        return V((x - d.x, y - d.y, 0))

    def carry_frame(self):
        """The carrying hand in chest coordinates.

        The shaft runs from the hand, in front of the chest, over the top of the
        trail shoulder with the head behind. Of the hand orientations that hold
        the grip along that line, the one closest to the forearm (the most
        neutral wrist) is chosen. Solved once: the carry is fixed to the chest.
        """
        if getattr(self, '_carry', None) is not None:
            return self._carry
        from rig_math import two_bone
        k = self.k; s = self.s
        hand_pt = V((-.03, -.13, -.085)) * k          # the fist just in front of the shoulder
        over = V((.025, .045, .07)) * k                # the top of the shoulder
        self.carry_hint = V((-.25, .2, -1)).normalized()   # the elbow hangs below the fist
        shaft = (over - hand_pt).normalized()
        along = self.grip.along('R')
        butt = hand_pt - shaft * along
        GRi = self.GRi; GR = self.GR
        D_local = GRi.to_3x3() @ V((0, 1, 0))          # the shaft in hand coordinates
        base = D_local.rotation_difference(shaft).to_matrix()
        H = None
        wrist = hand_pt
        for _ in range(3):
            elbow, _w = two_bone(V(), wrist, s.length['UpperArm_R'], s.length['Forearm_R'], self.carry_hint)
            fore = (wrist - elbow).normalized()
            best = None
            for r in range(0, 360, 2):
                Hr = rot_axis(shaft, D(r)) @ base
                cost = (Hr @ V((0, 1, 0))).angle(fore)
                if best is None or cost < best[0]:
                    best = (cost, Hr)
            club = mat4(best[1] @ GRi.to_3x3(), butt)
            H = club @ GR
            wrist = H.translation
        self.carry_wrist_deg = math.degrees(best[0])
        self._carry = H
        return H

    def club_on_shoulder(self, chest, shoulder_r, bob=0.0, lift=0.0, sway=0.0):
        """Club frame for the trail-shoulder carry, following the chest and shoulder."""
        T = chest
        H = self.carry_frame()
        hand = mat4(T @ H.to_3x3(), shoulder_r + T @ (H.translation + V((0, -sway, 0))) + V((0, 0, bob)))
        if lift:
            pivot = shoulder_r + T @ (V((.025, .045, .07)) * self.k)
            R = rot_axis(T @ LEFT, D(lift))
            hand = mat4(R @ hand.to_3x3(), pivot + R @ (hand.translation - pivot))
        return hand @ self.GRi

    def free_arm(self, side, shoulder, T, swing, abduct=8, elbow=12, wrist=6):
        """A relaxed hanging arm by forward kinematics (swing > 0 is forward)."""
        s = self.s; sgn = 1 if side == 'L' else -1
        l1 = s.length['UpperArm_' + side]; l2 = s.length['Forearm_' + side]
        down = T @ V((0, 0, -1))
        lat = T @ LEFT
        d1 = rot_axis(lat, -D(swing)) @ rot_axis(T @ FWD, sgn * D(abduct)) @ down
        hinge = rot_axis(lat, -D(swing)) @ lat
        d2 = rot_axis(hinge, -D(elbow)) @ d1
        elbow_p = shoulder + d1 * l1
        wrist_p = elbow_p + d2 * l2
        dorsal = (T @ V((sgn, 0, 0)))
        hand_dir = rot_axis(hinge, -D(wrist)) @ d2
        H = frame(hand_dir, dorsal)
        bend = (T @ V((0, 1, -.1)))
        return mat4(H, wrist_p), bend

    def base(self, pelvis_pos, pelvis_rot, thorax_rot, feet, look, root=None, lead_swing=0.0,
             lead_elbow=12, club_bob=0.0, clav=None, head_rot=None, lead_hand=None, lead_fingers=None,
             club_twirl=0.0, club_lift=0.0, right_hand=None, club_sway=0.0):
        b = self.b
        clav = clav or {'L': (0.0, 0.0), 'R': (D(4), D(6))}
        spec = dict(pelvis_pos=pelvis_pos, pelvis_rot=pelvis_rot, thorax_rot=thorax_rot,
                    feet=feet, clavicle=clav)
        if root is not None:
            spec['root'] = root
        probe = b.solve(dict(spec))
        rootm = root if root is not None else Matrix.Identity(4)
        # Solve-space (root-local) shoulder positions and chest rotation.
        sh = {side: rootm.inverted() @ probe['UpperArm_' + side].translation for side in 'LR'}
        chest = thorax_rot
        club = self.club_on_shoulder(chest, sh['R'], club_bob, club_lift, club_sway)
        held = club
        hand_r = right_hand if right_hand is not None else held @ self.GR
        if club_twirl:
            # The club spins in the fingers; the hand stays put.
            shaft = club.to_3x3().col[1]
            pivot = club @ V((0, self.grip.along('R'), 0))
            R = rot_axis(shaft, club_twirl) @ club.to_3x3()
            club = mat4(R, pivot - R @ V((0, self.grip.along('R'), 0)))
        if lead_hand is None:
            hand_l, bend_l = self.free_arm('L', sh['L'], chest, lead_swing, elbow=lead_elbow)
        else:
            hand_l, bend_l = lead_hand
        spec['hands'] = {'L': rootm @ hand_l, 'R': rootm @ hand_r}
        self.carry_frame()
        spec['elbow'] = {'L': rootm.to_3x3() @ bend_l, 'R': rootm.to_3x3() @ (chest @ self.carry_hint)}
        spec['club'] = club
        spec['fingers'] = {'R': self.grip.fingers('R', rootm @ held)}
        if lead_fingers is not None:
            spec['fingers']['L'] = lead_fingers
        if head_rot is not None:
            spec['head_rot'] = head_rot
        else:
            spec['look'] = look
            spec['level'] = .9
        spec['eyes'] = look
        return spec


def upright_feet(c, stance=.105, yaw=D(5)):
    k = c.k
    return {'L': c.plant('L', stance * k, c.s.head['Foot_L'].y, yaw),
            'R': c.plant('R', -stance * k, c.s.head['Foot_R'].y, -yaw)}


class Idle(Carry):
    """Standing at ease: weight in one hip, breathing, a look around."""
    duration = 6.4

    def pose(self, t):
        b = self.b; d = self.duration; p = t / d
        breath = .5 - .5 * math.cos(TAU * p * 3)
        sway = math.sin(TAU * p)
        plants = upright_feet(self, .11)
        feet = {s: b.foot_pose(s, plants[s], D(7) if s == 'L' else D(-9)) for s in 'LR'}
        # Weight in the left hip (contrapposto), easing across and back.
        shift = .022 * self.k * (.6 + .4 * sway)
        pel = self.hips0 + V((shift, .008, -.012 - .004 * breath))
        prot = rot_axis(FWD, D(-3.5) * (.6 + .4 * sway)) @ rot_axis(UP, D(3) * sway)
        trot = rot_axis(FWD, D(2.5) * (.6 + .4 * sway)) @ rot_axis(LEFT, D(2 + .8 * breath)) @ rot_axis(UP, D(-2) * sway)
        # Looks: down the course, back, a glance down.
        yaw = 34 * smooth((t - 1.2) / .6) * (1 - smooth((t - 2.7) / .7)) - 26 * smooth((t - 3.9) / .5) * (1 - smooth((t - 5.0) / .6))
        pitch = -8 * math.sin(PI * clamp((t - 5.1) / 1.0)) ** 2
        eye = V((0, -.06, 1.58)) * self.k
        look = eye + rot_axis(UP, D(yaw)) @ (rot_axis(LEFT, D(pitch - 3)) @ V((0, -6, 0)))
        lead = self.lead_on_hip(trot, t)
        spec = self.base(pel, prot, trot, feet, look, clav={'L': (D(1.5 * breath), D(-4)), 'R': (D(4 + 1.5 * breath), D(6))},
                         lead_hand=lead[0:2], lead_fingers=lead[2])
        return b.solve(spec)

    def lead_on_hip(self, T, t):
        """The free hand rests on the hip, fingers forward."""
        probe = self.b.solve(dict(pelvis_pos=self.hips0, pelvis_rot=Matrix.Identity(3), thorax_rot=T,
                                  feet={s: self.b.foot_pose(s, V(), 0) for s in 'LR'}))
        hip_pt = self.s.head['Thigh_L'] + V((.085, .015, .095)) * self.k
        hand_dir = V((-.15, -.55, -.82)).normalized()
        H = frame(hand_dir, V((1, .2, .2)))
        wrist = hip_pt - hand_dir * .055 * self.k
        def fingers(hand_m):
            return self.b.relaxed_fingers(hand_m, 'L', amount=.45, spread=.6)
        return mat4(H, wrist), V((.6, .5, -.2)), fingers


class Gait(Carry):
    """Walk, jog, backward walk and side steps -- in place, feet planted at speed."""

    def __init__(self, G, kind):
        super().__init__(G)
        self.kind = kind
        k = self.k
        if kind == 'Walk':
            self.duration, self.stride, self.stance = 1.12, 1.30 * k, .62
        elif kind == 'Jog':
            self.duration, self.stride, self.stance = .72, 1.86 * k, .46
        elif kind == 'WalkBackward':
            self.duration, self.stride, self.stance = 1.20, .86 * k, .64
        else:
            self.duration, self.stride, self.stance = 1.20, .82 * k, .64
        self.speed = self.stride / self.duration
        self.direction = {'Walk': (0, -1), 'Jog': (0, -1), 'WalkBackward': (0, 1),
                          'StrafeLeft': (1, 0), 'StrafeRight': (-1, 0)}[kind]

    def foot(self, side, phase):
        """Planted-foot travel and roll for one leg at its own phase."""
        b = self.b; beta = self.stance; S = self.stride
        jog = self.kind == 'Jog'; back = self.kind == 'WalkBackward'
        strafe = self.kind.startswith('Strafe')
        half = beta * S / 2
        if phase < beta:
            u = phase / beta
            along = mix(half, -half, u)                    # moves back under the body
            lift = 0.0
            if strafe or back:
                roll = 0.0 if strafe else mix(D(8), D(-10), smooth((u - .55) / .45))
            else:
                heel = D(-16 if not jog else -6) * (1 - smooth(u / (.16 if not jog else .1)))
                toe = D(38 if not jog else 42) * smooth((u - (.60 if not jog else .82)) / (.40 if not jog else .18))
                roll = heel + toe
            pitch = 0.0
        else:
            u = (phase - beta) / (1 - beta)
            along = mix(-half, half, smoother(u))
            lift = (.11 if not jog else .17) * self.k * math.sin(PI * u) ** (1.4 if not jog else 1.1)
            if jog:
                lift += .06 * self.k * math.sin(PI * clamp(u / .6)) ** 2  # heel kick
            roll = 0.0
            if strafe:
                pitch = 0.0
            elif back:
                pitch = D(-10) * math.sin(PI * u)
            else:
                # Toe-off flexion straightens, then the toes rise for the heel strike.
                pitch = D(38 if not jog else 42) * (1 - smooth(u / .45)) - D(14 if not jog else 8) * smooth((u - .55) / .45)
                toe_release = D(38 if not jog else 42) * (1 - smooth(u / .3))
        sgn = 1 if side == 'L' else -1
        dx, dy = self.direction
        width = (.105 if not jog else .085) * self.k
        if strafe:
            x = sgn * (width + .04 * self.k) + along * dx
            y = self.s.head['Foot_' + side].y
        else:
            x = sgn * width
            y = self.s.head['Foot_' + side].y + (-along if not back else along)
        yaw = sgn * D(6)
        plant = self.plant(side, x, y, yaw)
        self.travel = getattr(self, 'travel', {}); self.travel[side] = along / max(half, 1e-6)
        if phase >= beta and not strafe and not back:
            # Leave the ground still rolled on the ball, then ease into flight.
            u = (phase - beta) / (1 - beta)
            end_roll = D(38 if not jog else 42)
            A = b.foot_pose(side, plant, yaw, roll=end_roll, lift=V((0, 0, lift)))
            B = b.foot_pose(side, plant, yaw, lift=V((0, 0, lift)), pitch=pitch, toe_bend=toe_release)
            w = smooth(u / .38)
            return tuple(mat4(a.to_quaternion().slerp(bb.to_quaternion(), w).to_matrix(), a.translation.lerp(bb.translation, w))
                         for a, bb in zip(A, B))
        return b.foot_pose(side, plant, yaw, roll=roll, lift=V((0, 0, lift)), pitch=pitch)

    def pose(self, t):
        b = self.b; d = self.duration; p = t / d
        jog = self.kind == 'Jog'; strafe = self.kind.startswith('Strafe'); back = self.kind == 'WalkBackward'
        feet = {'L': self.foot('L', p % 1), 'R': self.foot('R', (p + .5) % 1)}
        # Pelvis: lowest at double support (walk) / mid-stance (jog), sway over the stance leg.
        if jog:
            bob = -.045 * self.k * math.cos(TAU * 2 * (p - .20))
            base_drop = -.035 * self.k
        else:
            bob = .022 * self.k * math.cos(TAU * 2 * (p - .27))
            base_drop = -.026 * self.k
        sway = (.018 if not jog else .012) * self.k * math.sin(TAU * (p - .06))
        fwd = 0.0
        pel = self.hips0 + V((sway if not strafe else .0, fwd, base_drop + bob))
        lean = 9 if jog else 3 if not back else -2
        yaw = (5 if not jog else 7) * math.cos(TAU * p) * (0 if strafe else 1) * (-1 if back else 1)
        drop = (3.5 if not jog else 2) * math.sin(TAU * (p - .06))
        prot = rot_axis(UP, D(-yaw)) @ rot_axis(FWD, D(drop)) @ rot_axis(LEFT, D(lean * .6))
        trot = rot_axis(UP, D(yaw * .7)) @ rot_axis(LEFT, D(lean)) @ rot_axis(FWD, D(-drop * .3))
        if strafe:
            prot = rot_axis(FWD, D(drop * .5)); trot = rot_axis(LEFT, D(2))
        # The free arm swings against the left leg; the carrying hand sways a little against the right.
        lead_fwd = self.travel['L']            # +1 = left foot forward
        arm = (-24 if not jog else -34) * lead_fwd * (0 if strafe else 1)
        if back:
            arm *= -.6        # walking backward the foot moves the other way along the stride
        sway = (.022 if not jog else .03) * (1.6 if back else 1) * self.k * (-self.travel['R']) * (0 if strafe else 1) * (-1 if back else 1)
        elbow = (16 if not jog else 82) + (10 if not jog else 8) * max(0, -math.cos(TAU * p))
        look = V((0, -8, 1.55 * self.k)) if not strafe else V((0, -8, 1.52 * self.k))
        spec = self.base(pel, prot, trot, feet, look, lead_swing=arm + (8 if jog else 2), lead_elbow=elbow,
                         club_bob=(-.004 if jog else 0) * math.cos(TAU * 2 * p), club_sway=sway)
        return b.solve(spec)


class Turn(Carry):
    """A quarter turn in two steps; the runtime turns the actor with the same smoothstep."""
    duration = .9

    def __init__(self, G, kind):
        super().__init__(G)
        self.sign = 1 if kind == 'TurnLeft' else -1
        self.angle = self.sign * PI / 2

    def pose(self, t):
        b = self.b; p = t / self.duration
        yaw = self.angle * smooth(p)
        root = Matrix.Rotation(yaw, 4, 'Z')
        # Each foot steps from the start heading to the end heading, the turn-side foot first.
        lead_side = 'L' if self.sign > 0 else 'R'
        feet = {}
        for side in 'LR':
            first = side == lead_side
            a, z = (.06, .52) if first else (.40, .92)
            u = smooth((p - a) / (z - a))
            stance = .11 * self.k
            sgn = 1 if side == 'L' else -1
            start = Matrix.Rotation(0, 3, 'Z'); end = Matrix.Rotation(self.angle, 3, 'Z')
            pos0 = V((sgn * stance, self.s.head['Foot_' + side].y, 0))
            pos1 = end @ pos0
            heading = self.angle * u
            pos = pos0.lerp(pos1, u)
            lift = .07 * self.k * math.sin(PI * u)
            plant_world = self.plant(side, pos.x, pos.y, heading)
            fm, tm = b.foot_pose(side, plant_world, heading, lift=V((0, 0, lift)), pitch=D(8) * math.sin(PI * u))
            inv = root.inverted()
            feet[side] = (inv @ fm, inv @ tm)
        dip = -.012 * self.k * math.sin(PI * p) ** 2
        lean_into = self.sign * D(3) * math.sin(PI * p)
        pel = self.hips0 + V((0, 0, -.018 * self.k + dip))
        prot = rot_axis(UP, self.sign * D(6) * math.sin(PI * p)) @ rot_axis(FWD, -lean_into * .5)
        trot = rot_axis(UP, self.sign * D(12) * math.sin(PI * clamp(p * 1.3))) @ rot_axis(LEFT, D(2))
        # The head leads the turn.
        look_yaw = self.angle * smooth(clamp(p * 1.35)) - yaw
        look = rot_axis(UP, look_yaw) @ V((0, -8, 1.55 * self.k))
        spec = self.base(pel, prot, trot, feet, look, root=root, lead_swing=6 * math.sin(TAU * p))
        return b.solve(spec)


class ClubChange(Carry):
    """The club comes off the shoulder, twirls once as it changes, and goes back."""
    duration = 1.4

    def pose(self, t):
        b = self.b; p = t / self.duration
        plants = upright_feet(self, .11)
        feet = {s: b.foot_pose(s, plants[s], D(6) if s == 'L' else D(-6)) for s in 'LR'}
        down = math.sin(PI * clamp((t - .05) / 1.25)) ** 2
        twirl = TAU * smoother((t - .38) / .72)
        pel = self.hips0 + V((.004, 0, -.014 * self.k))
        trot = rot_axis(LEFT, D(4 + 6 * down)) @ rot_axis(UP, D(-6 * down))
        prot = Matrix.Identity(3)
        look_pt = V((-.05, -.55, 1.05)) * self.k
        look = V((0, -8, 1.5 * self.k)).lerp(look_pt, down)
        spec = self.base(pel, prot, trot, feet, look, lead_swing=4 + 10 * down, lead_elbow=12 + 30 * down,
                         club_lift=-62 * down, club_twirl=twirl)
        return b.solve(spec)


class Celebrate(Carry):
    """A fist pump: a little crouch, the lead fist drives down to the hip, then a proud stand."""
    duration = 2.2

    def pose(self, t):
        b = self.b; k = self.k
        plants = upright_feet(self, .12)
        crouch = math.sin(PI * clamp((t - .30) / .70)) ** 2
        feet = {s: b.foot_pose(s, plants[s], D(7) if s == 'L' else D(-7)) for s in 'LR'}
        pel = self.hips0 + V((.01 * crouch, .012 * crouch, -(.012 + .045 * crouch) * k))
        prot = rot_axis(LEFT, D(9 * crouch)) @ rot_axis(UP, D(6 * crouch))
        trot = rot_axis(LEFT, D(13 * crouch)) @ rot_axis(UP, D(10 * crouch))
        # Raise the fist in front (forearm up), drive it down to the hip, hold, relax.
        up = smooth(t / .28) * (1 - smooth((t - 1.55) / .55))
        pump = smooth((t - .42) / .22) * (1 - .25 * smooth((t - .85) / .4))
        probe = b.solve(dict(pelvis_pos=pel, pelvis_rot=prot, thorax_rot=trot, feet=feet,
                             clavicle={'L': (0, 0), 'R': (D(4), D(6))}))
        sh = probe['UpperArm_L'].translation
        T = trot
        rest = sh + T @ V((.05, .03, -.50)) * k
        high = sh + T @ V((.05, -.24, .10)) * k         # fist raised above the shoulder
        low = sh + T @ V((.06, -.20, -.34)) * k         # fist driven down to the hip
        wrist = rest.lerp(high.lerp(low, pump), up)
        fore_up = (T @ V((0, -.15, 1))).normalized(); fore_down = (T @ V((0, -.55, .2))).normalized()
        hang = T @ V((0, 0, -1))
        d = hang.slerp(fore_up.slerp(fore_down, pump), up).normalized()
        H = frame(d, T @ V((1, .25, 0)))
        def fingers(hand_m):
            return b.fist(hand_m, 'L', .25 + .75 * up)
        look = V((.0, -8, (1.62 + .6 * crouch) * k))
        spec = self.base(pel, prot, trot, feet, look, lead_hand=(mat4(H, wrist), T @ V((.4, .3, -1))), lead_fingers=fingers,
                         clav={'L': (D(6 * up - 6 * pump), D(6 * up)), 'R': (D(4), D(6))})
        return b.solve(spec)


CLIP_ORDER = ['Idle', 'Walk', 'WalkBackward', 'StrafeLeft', 'StrafeRight', 'Jog', 'TurnLeft', 'TurnRight',
              'AddressDriver', 'AddressWood', 'AddressIron', 'AddressWedge', 'AddressPutter',
              'SwingDriver', 'SwingWood', 'SwingIron', 'ChipWedge', 'Putt', 'ClubChange', 'Celebrate']
STROKE_CLUB = {'SwingDriver': 'Driver', 'SwingWood': 'Wood', 'SwingIron': 'Iron', 'ChipWedge': 'Wedge', 'Putt': 'Putter'}


def make_clip(G, name):
    if name == 'Idle':
        return Idle(G), 'Iron', True
    if name in ('Walk', 'Jog', 'WalkBackward', 'StrafeLeft', 'StrafeRight'):
        return Gait(G, name), 'Iron', True
    if name.startswith('Turn'):
        return Turn(G, name), 'Iron', False
    if name.startswith('Address'):
        cid = name[len('Address'):]
        return Address(G, cid), cid, True
    if name in STROKE_CLUB:
        return Stroke(G, STROKE_CLUB[name]), STROKE_CLUB[name], False
    if name == 'ClubChange':
        return ClubChange(G), 'Iron', False
    if name == 'Celebrate':
        return Celebrate(G), 'Iron', False
    raise KeyError(name)
