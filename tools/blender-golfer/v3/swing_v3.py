"""The full swing, chip and putt as a kinematic sequence.

The swing is driven the way it is coached, through the P1-P10 positions:
the pelvis and thorax turn about their own tilted axes (pelvis leads the
downswing, the thorax follows: the X-factor stretch), the pelvis shifts and
squats, the lead arm moves across and up the chest, the lead wrist hinges,
holds its lag and releases. The club follows the lead hand; the trail hand
is solved onto the grip. At impact a small Gauss-Newton correction makes the
face meet the ball square, blended out smoothly on either side.

Angles are degrees in the tables. Conventions: yaw > 0 opens toward the
target; lift > 0 raises the lead arm up the chest; across > 0 carries it
toward the trail side; hinge > 0 cocks the lead wrist; roll > 0 rotates the
lead forearm open (face opens), < 0 rolls it over through release.
"""
import math
from mathutils import Vector as V, Matrix
from rig_math import Spline, frame, mat4, rot_axis, smooth, mix, clamp, UP, FWD, LEFT
from stance_v3 import Stance
import clubs_v3

D = math.radians

# Keyframes: (time s, value). Shared P-position timings per swing family.
FULL = dict(
    # P1 addr, settle, P2, P3, P4 top, P5, P6, P7 impact, P8, P9, rising, P10 finish, hold, relax, rest
    t=[0.0, .22, .52, .74, 1.02, 1.15, 1.23, 1.30, 1.36, 1.45, 1.6, 1.78, 2.5, 3.05, 3.45],
    pelvis_yaw=[0, 0, -12, -28, -46, -22, 8, 38, 54, 68, 80.0, 92, 94, 86, 84],
    thorax_yaw=[0, 0, -28, -60, -98, -70, -38, 16, 52, 78, 95.0, 112, 114, 96, 92],
    pelvis_x=[0, 0, -.010, -.016, -.020, .030, .062, .085, .098, .108, 0.1165, .125, .125, .105, .100],
    pelvis_z=[0, 0, 0, .003, .006, -.026, -.032, -.012, .004, .016, 0.026, .036, .038, .030, .030],
    pelvis_y=[0, 0, 0, .004, .010, .012, .010, .004, -.004, -.012, -0.021, -.030, -.030, -.024, -.022],
    tilt=[0, 0, 0, 1, 2, 2, 1, 0, -6, -14, -22.0, -30, -31, -33, -34],
    side=[0, 0, 1, 0, -4, 2, 8, 12, 10, 6, 0.0, -6, -6, -4, -4],
    lift=[0, 0, 6, 38, 78, 46, 18, 1, 22, 60, 88.0, 116, 118, 40, 30],
    across=[0, 0, 10, 24, 34, 18, 6, -10, -52, -78, -85.0, -92, -93, -60, -55],
    hinge=[0, 0, 12, 72, 92, 96, 80, 8, -18, 30, 54.0, 78, 80, 30, 20],
    flex=[0, 0, 0, -4, -10, -12, -10, -8, 0, 10, 17.0, 24, 24, 8, 4],
    roll=[0, 0, 28, 38, 40, 38, 32, 0, -62, -96, -107.0, -118, -120, -80, -70],
    elbow=[3, 3, 3, 4, 8, 6, 4, 2, 6, 34, 65.0, 96, 98, 40, 30],
    trail_roll=[0, 0, 0, 0, 0, 0, 0, 14, 38, 58, 67.0, 76, 76, 30, 12],
    trail_yaw=[0, 0, 0, 0, 0, 0, 0, 6, 16, 26, 32.0, 38, 38, 34, 32],
    lead_roll=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -2.0, -4, -4, -2, 0],
    clav_lead=[(0, 0)] * 2 + [(0, 6), (2, 12), (4, 16), (2, 10), (0, 4), (-2, 0), (-1, -8), (4, -14), (7, -15), (10, -16), (10, -16), (2, -6), (0, -4)],
    clav_trail=[(0, 0)] * 2 + [(2, -4), (5, -8), (8, -10), (3, -2), (-2, 6), (-6, 14), (-6, 20), (-2, 18), (2, 13), (6, 8), (6, 8), (0, 8), (0, 6)],
)


def scaled(table, **mult):
    out = dict(table)
    for k, m in mult.items():
        if k == 't':
            out['t'] = [x * m for x in table['t']]
        else:
            out[k] = [x * m if not isinstance(x, tuple) else tuple(y * m for y in x) for x in table[k]]
    return out


CHIP = dict(
    t=[0.0, .20, .46, .64, .80, .90, 1.30, 2.0],
    pelvis_yaw=[0, 0, -6, -10, 10, 22, 30, 30],
    thorax_yaw=[0, 0, -18, -30, 4, 30, 44, 44],
    pelvis_x=[0, 0, 0, 0, .012, .018, .022, .022],
    pelvis_z=[0, 0, 0, 0, -.004, 0, .006, .006],
    pelvis_y=[0] * 8,
    tilt=[0, 0, 0, 0, 0, -2, -6, -6],
    side=[0, 0, 0, 0, 2, 3, 2, 2],
    lift=[0, 0, 8, 18, 1, 14, 30, 30],
    across=[0, 0, 6, 10, -6, -22, -34, -34],
    hinge=[0, 0, 10, 26, 4, -2, 4, 4],
    flex=[0, 0, 0, -2, -6, -6, -4, -4],
    roll=[0, 0, 10, 14, 0, -16, -24, -24],
    elbow=[3, 3, 3, 3, 2, 6, 16, 16],
    trail_roll=[0, 0, 0, 0, 0, 6, 12, 12],
    trail_yaw=[0, 0, 0, 0, 0, 2, 4, 4],
    lead_roll=[0] * 8,
    clav_lead=[(0, 0)] * 2 + [(0, 3), (1, 5), (0, 0), (0, -4), (1, -6), (1, -6)],
    clav_trail=[(0, 0)] * 2 + [(1, -2), (2, -3), (-1, 3), (-2, 6), (-2, 8), (-2, 8)],
)

# P-position goals in the golfer's frame (target +X, facing -Y, up +Z):
# u = lead shoulder -> wrist, s = shaft from butt to head. Solved into the
# lead arm (lift, across) and wrist (hinge, roll) channels at each key.
FULL_GOALS = {
    2: dict(u=(-.30, -.36, -.88), s=(-1, .02, .02), toe=(0, 0, 1)),        # P2: shaft parallel, toe up
    3: dict(u=(-.90, -.40, .02), s=(.04, .42, .91)),  # P3: lead arm parallel, club up
    4: dict(u=(-.50, .36, .79), s=(1, .10, -.06)),                         # P4: top, shaft parallel to the target line
    5: dict(u=(-.86, -.36, -.18), s=(.18, .40, .90)),                      # P5: lead arm parallel, lag held
    6: dict(u=(-.62, -.33, -.71), s=(-1, .05, .04), toe=(0, -.3, .95)),     # P6: shaft parallel, deep lag
    8: dict(u=(.40, -.40, -.82), s=(1, -.02, .02), toe=(0, .1, 1)),        # P8: shaft parallel past impact, toe up
    9: dict(u=(.78, -.30, .10), s=(-.05, .40, .92)),    # P9: trail arm parallel, club up
    10: dict(u=(.56, .02, .83), s=(-.45, .50, .74)),    # rising into the finish, both hands on
    11: dict(u=(.22, .32, .92), s=(-.72, .42, -.55)),                      # P10: finish, club behind the neck
    12: dict(u=(.22, .32, .92), s=(-.72, .42, -.55)),                      # ... held while the ball flies
}
CHIP_GOALS = {
    2: dict(u=(-.22, -.36, -.90), s=(-.86, -.30, -.40)),
    3: dict(u=(-.32, -.36, -.88), s=(-.90, -.12, .42)),
    5: dict(u=(.28, -.38, -.88), s=(.85, -.22, -.48)),
    6: dict(u=(.38, -.36, -.85), s=(.72, -.05, .69)),
    7: dict(u=(.38, -.36, -.85), s=(.72, -.05, .69)),
}

SWINGS = {
    'Driver': dict(table=scaled(FULL, t=1.06, pelvis_x=1.15, thorax_yaw=1.04, pelvis_yaw=1.02), impact_index=7, goals=FULL_GOALS, release=True),
    'Wood': dict(table=scaled(FULL, t=1.03, pelvis_x=1.06), impact_index=7, goals=FULL_GOALS, release=True),
    'Iron': dict(table=FULL, impact_index=7, goals=FULL_GOALS, release=True),
    'Wedge': dict(table=CHIP, impact_index=4, goals=CHIP_GOALS),
}


def solve_linear(A, b):
    """Gaussian elimination with partial pivoting (small dense systems)."""
    n = len(b); M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-12:
            return None
        M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, n + 1):
                    M[r][k] -= f * M[c][k]
    return [M[i][n] / M[i][i] for i in range(n)]


class Swing:
    """Pose generator for one club's stroke (or its address, at t = 0)."""

    def __init__(self, G, cid, table=None):
        self.G = G; self.cid = cid
        self.st = Stance(G, cid)
        self.b = G['bodypose']; self.s = G['skel']
        self.grip = G['grips'][cid]; self.data = G['club_data'][cid]
        spec = SWINGS[cid]
        self.table = dict(table or spec['table'])
        # Keys land on baked frames, so the impact pose is exactly the one stored.
        self.table['t'] = [round(x * 60) / 60 for x in self.table['t']]
        self.impact = self.table['t'][spec['impact_index']]
        self.duration = self.table['t'][-1]
        T = self.table['t']
        self.ch = {}
        for k, vals in self.table.items():
            if k == 't':
                continue
            self.ch[k] = Spline(list(zip(T, vals)))
        st = self.st
        self.k = st.k
        # Address references.
        pose0 = self.b.solve(st.spec())
        self.S0 = pose0['UpperArm_L'].translation.copy()
        self.T0 = st.thorax_rot.copy()
        w0 = pose0['Hand_L'].translation.copy()
        self.a0 = self.T0.transposed() @ (w0 - self.S0)
        self.l0 = self.a0.length
        self.H0rel = self.T0.transposed() @ st.hands['L'].to_3x3()
        self.GL = self.grip.hand_frame('L'); self.GLi = self.GL.inverted()
        self.GR = self.grip.hand_frame('R')
        e0 = pose0['Forearm_L'].translation - (self.S0 + (w0 - self.S0).normalized() * (pose0['Forearm_L'].translation - self.S0).dot((w0 - self.S0).normalized()))
        self.elbow0 = self.T0.transposed() @ (e0.normalized() if e0.length > 1e-5 else V((-.35, 1, -.55)).normalized())
        self.base_tilt = st.P['tilt']; self.base_side = st.P['side']
        self.correction = None
        self.impact_index = spec['impact_index']
        self.has_release = spec.get('release', False)
        self.table = {k: list(v) for k, v in self.table.items()}
        self.goal_report = {}
        for key, goal in sorted(spec.get('goals', {}).items()):
            self.goal_report[key] = self._solve_key(key, goal)
        if self.has_release:
            # Admiring the shot: the lead hand keeps the club in the finish while the
            # body stands taller and the trail hand lets go (the last three keys are
            # the held finish, the relax and the rest).
            n = len(self.table['t'])
            for name in ('lift', 'across', 'hinge', 'flex', 'roll', 'elbow'):
                for i in (n - 2, n - 1):
                    self._set(name, i, self.table[name][n - 3])
        self._solve_impact()

    # -- channels -------------------------------------------------------------
    def c(self, name, t):
        v = self.ch[name](t)
        return v[0] if len(v) == 1 else v

    def thorax(self, t, extra=0.0):
        tilt = self.base_tilt + self.c('tilt', t); side = self.base_side + self.c('side', t)
        yaw = self.c('thorax_yaw', t) + extra
        return rot_axis(LEFT, D(tilt)) @ rot_axis(FWD, D(side)) @ rot_axis(UP, D(yaw))

    def pelvis(self, t):
        st = self.st
        rot = st.pelvis_rot @ rot_axis(UP, D(self.c('pelvis_yaw', t)))
        pos = st.pelvis_pos + V((self.c('pelvis_x', t), self.c('pelvis_y', t), self.c('pelvis_z', t))) * self.k
        return pos, rot

    def clavicles(self, t):
        base = self.st.clavicles()
        lead = self.c('clav_lead', t); trail = self.c('clav_trail', t)
        return {'L': (base['L'][0] + D(lead[0]), base['L'][1] + D(lead[1])),
                'R': (base['R'][0] + D(trail[0]), base['R'][1] + D(trail[1]))}

    def feet(self, t):
        st = self.st; b = self.b
        return {
            'L': b.foot_pose('L', st.plants['L'], st.yaws['L'] + D(self.c('lead_roll', t)) * 0, roll=D(self.c('lead_roll', t))),
            'R': self._trail_foot(t),
        }

    def _trail_foot(self, t):
        st = self.st; b = self.b
        roll = D(self.c('trail_roll', t)); yaw = st.yaws['R'] + D(self.c('trail_yaw', t))
        # The trail foot turns on its toes: the toe tip stays where it was planted.
        f = b.foot['R']
        off = f['tip'] - f['ball_ground']
        tip = st.plants['R'] + rot_axis(UP, st.yaws['R']) @ off
        plant = tip - rot_axis(UP, yaw) @ off
        return b.foot_pose('R', V((plant.x, plant.y, 0)), yaw, roll=roll)

    # -- the lead side drives the club ------------------------------------------
    def lead_hand(self, t, shoulder, T, delta=(0, 0, 0, 0)):
        lift = D(self.c('lift', t) + delta[0]); across = D(self.c('across', t) + delta[1])
        hinge = D(self.c('hinge', t) + delta[2]); roll = D(self.c('roll', t) + delta[3])
        flex = D(self.c('flex', t)); elbow = D(self.c('elbow', t))
        Rarm = rot_axis(UP, -across) @ rot_axis(LEFT, -lift)
        l1 = self.s.length['UpperArm_L']; l2 = self.s.length['Forearm_L']
        straight = math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * math.cos(D(self.c('elbow', 0.0))))
        bent = math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * math.cos(elbow))
        wrist = shoulder + T @ (Rarm @ self.a0) * (bent / straight)
        # Folding the elbow turns the hand with the forearm about the elbow hinge.
        hinge_axis = T @ (Rarm @ self.elbow0).cross(T @ (Rarm @ self.a0)).normalized()
        fold = rot_axis(hinge_axis, (elbow - D(self.c('elbow', 0.0))) * .9)
        local = Matrix.Rotation(roll, 3, 'Y') @ Matrix.Rotation(-hinge, 3, 'Z') @ Matrix.Rotation(flex, 3, 'X')
        H = fold @ T @ Rarm @ self.H0rel @ local
        return mat4(H, wrist), T @ (Rarm @ self.elbow0)

    def spec(self, t, delta=None):
        delta = delta if delta is not None else self._delta(t)
        b = self.b; st = self.st
        pos, prot = self.pelvis(t)
        T = self.thorax(t)
        clav = self.clavicles(t)
        feet = self.feet(t)
        probe = b.solve(dict(pelvis_pos=pos, pelvis_rot=prot, thorax_rot=T, feet=feet, clavicle=clav))
        shoulder = probe['UpperArm_L'].translation.copy()
        hand_l, elbow_l = self.lead_hand(t, shoulder, T, delta)
        club = hand_l @ self.GLi
        hand_r = club @ self.GR
        # The trail elbow hangs toward the ground through the whole stroke (toward the hip
        # at address, under the club at the top, tucked in the downswing, down at the finish).
        elbow_r = ((T @ V((.35, .9, -.5))).normalized() * .45 + V((0, .15, -1)).normalized() * .55).normalized()
        release = self.release(t)
        if release > 0:
            # After the held finish the trail hand lets go and falls to the side.
            from rig_math import two_bone
            sh_r = probe['UpperArm_R'].translation
            k = self.k
            l1, l2 = self.s.length['UpperArm_R'], self.s.length['Forearm_R']
            wrist = sh_r + T @ (V((-.03, -.06, -.47)) * k)
            # A hanging arm's elbow points back, never along the arm.
            elbow_r = elbow_r.slerp((T @ V((-.25, 1, -.1))).normalized(), release)
            hint = elbow_r
            # Where the grip hand's wrist will travel, the forearm it will sit on.
            path = hand_r.translation.lerp(wrist, release)
            elbow, _ = two_bone(sh_r, path, l1, l2, hint)
            fore = (path - elbow).normalized()
            # The hand turns by the least rotation that lines it up with its forearm,
            # then twists a little toward a natural hang; it never rolls half a turn.
            R0 = hand_r.to_3x3()
            y_old = R0.col[1].normalized()
            y_new = y_old.slerp(fore, release) if y_old.angle(fore) < 3.0 else y_old
            R1 = y_old.rotation_difference(y_new).to_matrix() @ R0
            natural = (T @ V((-1, .1, 0))); natural = (natural - y_new * natural.dot(y_new)).normalized()
            z = R1.col[2]; z = (z - y_new * z.dot(y_new)).normalized()
            phi = math.atan2(y_new.dot(z.cross(natural)), z.dot(natural))
            phi *= .5 * release * release * clamp((3.0 - abs(phi)) / .6)
            hand_r = mat4(rot_axis(y_new, phi) @ R1, path)
            self._release_hint = hint
        look, eyes = self.gaze(t)
        fingers = {side: self.grip.fingers(side, club) for side in 'LR'}
        if release > 0:
            held = fingers['R']; w = smooth((release - .1) / .6)
            def opening(hand_m, held=held, w=w):
                a = held(hand_m); r = self.b.relaxed_fingers(hand_m, 'R', amount=.4)
                out = {}
                for name, m in a.items():
                    q0 = m.to_quaternion(); q1 = r[name].to_quaternion()
                    if q0.dot(q1) < 0:
                        q1.negate()
                    out[name] = mat4(q0.slerp(q1, w).to_matrix(), m.translation.lerp(r[name].translation, w))
                return out
            fingers['R'] = opening
        return dict(pelvis_pos=pos, pelvis_rot=prot, thorax_rot=T, feet=feet, clavicle=clav,
                    hands={'L': hand_l, 'R': hand_r}, elbow={'L': elbow_l, 'R': elbow_r},
                    club=club, look=look, eyes=eyes, level=.25, fingers=fingers)

    def release(self, t):
        """0 while both hands hold the club; rises to 1 as the trail hand lets go after the finish."""
        if not self.has_release:
            return 0.0
        return smooth((t - self.table['t'][-3]) / .45)

    def gaze(self, t):
        """On the ball until just after impact, then out along the ball's flight."""
        ball = self.st.ball
        after = t - self.impact
        if after <= .06:
            return ball.copy(), ball.copy()
        u = after - .06
        dist = 38 * u if self.cid != 'Wedge' else 9 * u
        height = (12 if self.cid in ('Driver', 'Wood') else 9 if self.cid == 'Iron' else 3) * smooth(u / 1.1)
        target = ball + V((dist, -.35 * dist * .05, height))
        w = smooth(u / .35)
        look = ball.lerp(target, w)
        return look, target

    # -- key solves ----------------------------------------------------------------
    def _delta(self, t):
        return (0, 0, 0, 0)

    def _set(self, name, index, value):
        self.table[name][index] = value
        T = self.table['t']
        self.ch[name] = Spline(list(zip(T, self.table[name])))

    def _measure(self, t):
        self._release_now = self.release(t)
        sp = self.spec(t)
        club = sp['club']
        probe = self.b.solve(dict(pelvis_pos=sp['pelvis_pos'], pelvis_rot=sp['pelvis_rot'], thorax_rot=sp['thorax_rot'],
                                  feet=sp['feet'], clavicle=sp['clavicle']))
        shoulder = probe['UpperArm_L'].translation
        u = (sp['hands']['L'].translation - shoulder).normalized()
        s = club.to_3x3().col[1].normalized()
        arm = self.s.length['UpperArm_R'] + self.s.length['Forearm_R']
        self.trail_reach = (sp['hands']['R'].translation - probe['UpperArm_R'].translation).length / arm
        full = self.b.solve(sp)
        self.wrist = {side: full['Hand_' + side].to_3x3().col[1].angle(full['Hand_' + side].translation - full['Forearm_' + side].translation)
                      for side in 'LR'}
        return u, s, club

    def _trail_penalty(self):
        limit = math.radians(61)   # aim a little inside the 70-degree anatomical limit
        if self._release_now > 0:
            return [0.0, 4.5 * max(0.0, self.wrist['L'] - limit), 0.0]
        return [6.0 * max(0.0, self.trail_reach - .965),
                4.5 * max(0.0, self.wrist['L'] - limit), 4.5 * max(0.0, self.wrist['R'] - limit)]

    def _newton(self, names, index, residual, iters=14, step=.5, limit=25.0):
        t = self.table['t'][index]
        x = [self.table[n][index] for n in names]
        def r(vals):
            for n, v in zip(names, vals):
                self._set(n, index, v)
            return residual(t)
        e = r(x)
        lam = 1e-3
        for _ in range(iters):
            J = []
            for i in range(len(x)):
                xx = list(x); xx[i] += step
                e2 = r(xx)
                J.append([(a - b) / step for a, b in zip(e2, e)])
            r(x)
            n, m = len(x), len(e)
            JtJ = [[sum(J[i][k] * J[j][k] for k in range(m)) + (lam if i == j else 0) for j in range(n)] for i in range(n)]
            Jte = [-sum(J[i][k] * e[k] for k in range(m)) for i in range(n)]
            dx = solve_linear(JtJ, Jte)
            if dx is None:
                break
            trial = [xi + max(-limit, min(limit, d)) for xi, d in zip(x, dx)]
            e_new = r(trial)
            if sum(v * v for v in e_new) < sum(v * v for v in e):
                x, e = trial, e_new; lam *= .5
                if sum(v * v for v in e) < 1e-8:
                    break
            else:
                r(x); lam *= 8
        r(x)
        return x, e

    def _solve_key(self, index, goal):
        ug = V(goal['u']).normalized(); sg = V(goal['s']).normalized()
        e1 = sg.orthogonal().normalized(); e2 = sg.cross(e1)
        tg = V(goal['toe']).normalized() if 'toe' in goal else None
        def arm(t):
            u, s, _ = self._measure(t)
            return [(u - ug).x, (u - ug).y, (u - ug).z]
        def full(t):
            u, s, club = self._measure(t)
            r = [s.dot(e1), s.dot(e2), max(0.0, -s.dot(sg)) * 2]
            r += [.7 * (u - ug).x, .7 * (u - ug).y, .7 * (u - ug).z]
            if tg is not None:
                toe = club.to_3x3().col[0].normalized()
                toe = (toe - s * s.dot(toe)).normalized()
                want = (tg - s * s.dot(tg)).normalized()
                r += [.3 * (toe - want).x, .3 * (toe - want).y, .3 * (toe - want).z]
            return r + self._trail_penalty()
        self._newton(['lift', 'across'], index, arm)
        if tg is None:
            def shaft(t):
                u, s, _ = self._measure(t)
                return [s.dot(e1), s.dot(e2), max(0.0, -s.dot(sg)) * 2]
            self._newton(['hinge', 'roll'], index, shaft)
        self._newton(['lift', 'across', 'hinge', 'roll'], index, full, iters=20)
        u, s, club = self._measure(self.table['t'][index])
        rep = dict(lift=round(self.table['lift'][index], 1), across=round(self.table['across'][index], 1),
                   hinge=round(self.table['hinge'][index], 1), roll=round(self.table['roll'][index], 1),
                   arm_err_deg=round(math.degrees(u.angle(ug)), 1), shaft_err_deg=round(math.degrees(s.angle(sg)), 1),
                   trail_reach=round(self.trail_reach, 3),
                   wrist_deg={k: round(math.degrees(v), 1) for k, v in self.wrist.items()})
        if tg is not None:
            toe = club.to_3x3().col[0]
            rep['toe_err_deg'] = round(math.degrees((toe - s * s.dot(toe)).angle(tg - s * s.dot(tg))), 1)
        return rep

    def contact_error(self, t=None):
        t = self.impact if t is None else t
        sp = self.spec(t)
        club = sp['club']
        err = club @ self.data['ball'] - self.st.ball
        face = club.to_3x3() @ self.data['normal']
        face_h = V((face.x, face.y, 0)).normalized()
        yaw_err = math.degrees(math.atan2(face_h.y, face_h.x))
        square = club.to_3x3().col[2]
        # A chip keeps its loft: the square face stays level rather than tipping down with hand lean.
        level = square.z * (0.0 if self.cid == 'Putter' else .012)
        return [err.x, err.y, err.z, yaw_err * .012, level]

    def _solve_impact(self):
        x, e = self._newton(['lift', 'across', 'hinge', 'roll', 'tilt'], self.impact_index, self.contact_error, iters=25)
        self.impact_error = self.contact_error()
        self.impact_values = [round(v, 2) for v in x]

    def pose(self, t):
        return self.b.solve(self.spec(t))
