"""Hands on the club: a fitted two-handed grip.

Socket-local coordinates (the ClubGrip bone frame): x = t, y = s (down the
shaft from the butt), z = f (the square face, toward the target at address).
The golfer's eyes see the -t side of the grip at address ("the top").

The lead (left) hand holds the grip diagonally from the heel pad under the
pinky to the middle of the index finger, its back turned toward the target
and a little up (a neutral-to-strong grip). The trail hand sits below it in
the fingers, palm toward the target, its lifeline over the lead thumb.
Each finger then curls until its palm side touches the grip.
"""
import math
from mathutils import Vector as V, Matrix
from rig_math import mat4, frame, clamp
from body_pose import FINGER_NAMES

DEFAULT = dict(
    lead=dict(along=.046, alpha=math.radians(58), beta=math.radians(30), y=.55, z=-.026, x=.0),
    trail=dict(alpha=math.radians(52), gamma=math.radians(14), y=.80, z=-.022, x=0.0, gap=.004),
)


def grip_radius(s, putter=False):
    if putter:
        return .0150 - .006 * clamp(s / .26)
    return .0124 - .0115 * clamp(s / .26)


class Grip:
    def __init__(self, body, params=DEFAULT, putter=False):
        self.b = body; self.s = body.s
        self.p = params; self.putter = putter
        self.hand_len = {side: self.s.length['Hand_' + side] for side in 'LR'}
        # Hand width ~ the span from index to pinky knuckle, plus padding.
        J = body.j
        self.hand_width = {side: (J['Index1_' + side] - J['Pinky1_' + side]).length + .028 for side in 'LR'}
        self.thick = 1.0 if self.hand_width['L'] < .095 else 1.12
        self._cache = {}

    def hand_frame(self, side):
        """Hand bone frame (columns X, Y, Z and wrist origin) in socket-local coords."""
        if side in self._cache:
            return self._cache[side][0]
        P = self.p['lead'] if side == 'L' else self.p['trail']
        Lh = self.hand_len[side]
        eD = V((0, 1, 0))                          # down the shaft
        if side == 'L':
            a, b = P['alpha'], P['beta']
            eZ = V((-math.sin(b), 0, math.cos(b)))  # back of the lead hand: target, turned up
            along = P['along']
            Dh = V((math.cos(a), math.sin(a), 0))
        else:
            a, g = P['alpha'], P['gamma']
            eZ = V((math.sin(g), 0, -math.cos(g)))  # back of the trail hand: away from target
            along = self.p['lead']['along'] + self.hand_width['L'] * .66 + P['gap']
            Dh = V((-math.cos(a), math.sin(a), 0))
        Zh = V((0, 0, 1)); Nh = Dh.cross(Zh)
        eN = eD.cross(eZ)
        # Hand basis expressed in socket-local coordinates.
        def image(h):
            return eD * h.dot(Dh) + eN * h.dot(Nh) + eZ * h.dot(Zh)
        X = image(V((1, 0, 0))); Y = image(V((0, 1, 0))); Z = image(V((0, 0, 1)))
        R = Matrix((X, Y, Z)).transposed()
        Ph = V((P['x'], P['y'] * Lh, P['z'] * self.thick))   # hand-local point on the shaft axis
        Ps = V((0, along, 0))
        origin = Ps - R @ Ph
        m = mat4(R, origin)
        self._cache[side] = (m, along)
        return m

    def along(self, side):
        self.hand_frame(side)
        return self._cache[side][1]

    def _dist(self, p):
        return math.hypot(p.x, p.z) - grip_radius(p.y, self.putter)

    def finger_angles(self, side):
        """Wrap each finger: every phalanx settles tangent to the grip.

        Segment by segment from the knuckle, choose the flexion whose far end
        lies on the grip surface without the segment sinking into it.
        """
        key = ('fingers', side)
        if key in self._cache:
            return self._cache[key]
        H = self.hand_frame(side)
        rho = [.0088 * self.thick, .0078 * self.thick, .0068 * self.thick]
        limits = [(-.15, 1.35), (.10, 1.85), (.05, 1.45)]
        out = {}
        for finger in FINGER_NAMES:
            angles = [0.0, 0.0, 0.0]
            for seg in range(3):
                lo, hi = limits[seg]
                best, best_score = lo, 1e9
                steps = 80
                for k in range(steps + 1):
                    a = lo + (hi - lo) * k / steps
                    trial = angles[:seg] + [a] + [0.0] * (2 - seg)
                    chain = self.b.finger_chain(H, side, finger, trial)
                    bone = chain[f'{finger}{seg + 1}_{side}']
                    L = self.s.length[f'{finger}{seg + 1}_{side}']
                    ds = [self._dist(bone @ V((0, L * t, -rho[seg]))) for t in (.25, .5, .75, 1.0)]
                    score = abs(ds[-1]) + 6 * max(0.0, -min(ds) - .0012) + .002 * a
                    if score < best_score:
                        best, best_score = a, score
                angles[seg] = best
            angles[2] = max(angles[2], .55 * angles[1])
            out[finger] = angles
        self._cache[key] = out
        return out

    def thumb_pose(self, side, hand_world, club_world):
        """Lead thumb down the top of the grip; trail thumb across its lead side."""
        s = self.s
        along = self.along(side)
        r = grip_radius(along + .05, self.putter) + .0085 * self.thick
        if side == 'L':
            around = V((-math.cos(math.radians(28)), 0, -math.sin(math.radians(28))))
            target_local = V((0, along + .072, 0)) + around * r
        else:
            around = V((-math.cos(math.radians(55)), 0, math.sin(math.radians(55))))
            target_local = V((0, along + .060, 0)) + around * r
        target = club_world @ target_local
        name1 = 'Thumb1_' + side
        local1 = s.rest['Hand_' + side].inverted() @ s.rest[name1]
        base = hand_world @ local1
        chain = self.b.finger_chain(hand_world, side, 'Thumb', (.0, .12, .18))
        tip = chain['Thumb3_' + side] @ V((0, s.length['Thumb3_' + side], 0))
        head = base.translation
        q = (tip - head).rotation_difference(target - head)
        rot = q.to_matrix()
        b1 = mat4(rot @ base.to_3x3(), head)
        # Rebuild the chain from the turned base (its own flexions unchanged).
        out = {name1: b1 @ Matrix.Rotation(0, 4, 'X')}
        parent = out[name1]; pname = name1
        for i, a in ((2, .12), (3, .18)):
            name = f'Thumb{i}_{side}'
            m = parent @ (s.rest[pname].inverted() @ s.rest[name]) @ Matrix.Rotation(-a, 4, 'X')
            out[name] = m; parent = m; pname = name
        return out

    def fingers(self, side, club_world):
        """A callable for Body.solve: the full gripping hand."""
        angles = self.finger_angles(side)
        def build(hand_world):
            pose = {}
            for finger in FINGER_NAMES:
                pose.update(self.b.finger_chain(hand_world, side, finger, angles[finger]))
            pose.update(self.thumb_pose(side, hand_world, club_world))
            return pose
        return build

    def hands(self, club_world):
        return {side: club_world @ self.hand_frame(side) for side in 'LR'}
