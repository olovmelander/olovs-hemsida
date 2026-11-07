"""Address posture for each club, solved for this body and this club.

Golfer frame: faces -Y, target +X (lead = left side), ball in front at -y.
"""
import math
from mathutils import Vector as V, Matrix
from rig_math import frame, mat4, rot_axis, UP, FWD, LEFT, mix, clamp
import clubs_v3

# Per club: ankle half-width (m at 1.70 m), ball x from stance centre, pelvis
# hinge, thorax tilt from vertical, side bend away from target, knee flex,
# pelvis shift toward the target, shaft lean (hands ahead, deg), feet yaw.
ADDRESS = {
    'Driver': dict(width=.235, ball_x=.105, hinge=19, tilt=36, side=12, knee=21, shift=.000, lean=-1.0, lead_yaw=16, trail_yaw=-6, flatten=7, clav_r=(-14, 24)),
    'Wood':   dict(width=.215, ball_x=.060, hinge=21, tilt=38, side=10, knee=21, shift=.012, lean=1.0, lead_yaw=15, trail_yaw=-5, flatten=5, clav_r=(-13, 22)),
    'Iron':   dict(width=.190, ball_x=.005, hinge=23, tilt=40, side=8, knee=22, shift=.024, lean=3.0, lead_yaw=14, trail_yaw=-4, flatten=1.5, clav_r=(-11, 20)),
    'Wedge':  dict(width=.125, ball_x=-.035, hinge=25, tilt=42, side=5, knee=23, shift=.040, lean=6.0, lead_yaw=24, trail_yaw=-2, flatten=0, clav_r=(-10, 18)),
    'Putter': dict(width=.150, ball_x=.030, hinge=28, tilt=46, side=3, knee=17, shift=.012, lean=2.0, lead_yaw=6, trail_yaw=-4, flatten=0, clav_r=(-9, 18)),
}


class Stance:
    """The address of one club: feet, pelvis, thorax, club and hands."""

    def __init__(self, G, cid, overrides=None):
        self.G = G; self.cid = cid
        self.b = G['bodypose']; self.s = G['skel']; self.J = G['joints']
        self.data = G['club_data'][cid]; self.grip = G['grips'][cid]
        self.P = dict(ADDRESS[cid], **(overrides or {}))
        h = max(self.J['head_top'].z, 1.0)
        self.k = h / 1.70
        if self.k > 1.02:
            # A taller golfer flexes the knees and hinges a little more over the same clubs.
            self.P['knee'] += 5 * (self.k - 1) / .06
            self.P['hinge'] += 3 * (self.k - 1) / .06
            self.P.setdefault('hang', 12 - 7 * (self.k - 1) / .06)
        self._solve()

    def foot_at_ankle(self, side, ax, ay, yaw):
        f = self.b.foot[side]
        d = rot_axis(UP, yaw) @ (f['ankle'] - f['ball_ground'])
        return V((ax - d.x, ay - d.y, 0))

    def feet(self):
        P = self.P; w = P['width'] * self.k
        ay = self.s.head['Foot_L'].y
        plants = {'L': self.foot_at_ankle('L', w, ay, math.radians(P['lead_yaw'])),
                  'R': self.foot_at_ankle('R', -w, ay, math.radians(P['trail_yaw']))}
        yaws = {'L': math.radians(P['lead_yaw']), 'R': math.radians(P['trail_yaw'])}
        return plants, yaws

    def pelvis(self, plants, yaws):
        """Pelvis tilt and height for the knee flex; returns (pos, rot)."""
        P = self.P; s = self.s
        rot = rot_axis(LEFT, math.radians(P['hinge']))
        l1 = s.length['Thigh_L']; l2 = s.length['Shin_L']
        kf = math.radians(P['knee'])
        d = math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * math.cos(kf))
        rest = s.head['Hips'].copy()
        # Hips sit back over the heels as the trunk hinges forward.
        pos = V((P['shift'] * self.k, rest.y + .085 * self.k * math.sin(math.radians(P['hinge'])) / math.sin(math.radians(24)), rest.z))
        ankles = {}
        for side in 'LR':
            fm, _ = self.b.foot_pose(side, plants[side], yaws[side])
            ankles[side] = fm.translation
        for _ in range(4):
            zs = []
            for side in 'LR':
                hip = pos + rot @ self.b.hip_offset[side]
                a = ankles[side]
                horiz = V((hip.x - a.x, hip.y - a.y)).length
                zs.append(a.z + math.sqrt(max(0, d * d - horiz * horiz)) - (rot @ self.b.hip_offset[side]).z)
            pos.z = sum(zs) / 2
        return pos, rot

    def thorax(self):
        P = self.P
        return rot_axis(LEFT, math.radians(P['tilt'])) @ rot_axis(FWD, math.radians(P['side']))

    def club_rotation(self):
        """Soled at its lie, square to the target, leaned by the shaft lean."""
        d = self.data
        # Rest socket axes in armature space: Y down, Z = +X target.
        rest = self.s.rest3['ClubGrip']
        up_rest = rest @ d['up']                    # 'soled up' at rest, world
        # Rotate about the target axis so 'soled up' becomes world up.
        q = up_rest.rotation_difference(UP)
        R = q.to_matrix() @ rest
        # Shaft lean: hands toward the target, about the axis normal to the shaft and target.
        # Long clubs are held a little flatter than their lie (toe up, hands lower).
        R = rot_axis(V((1, 0, 0)), -math.radians(self.P.get('flatten', 0))) @ R
        shaft = R @ V((0, 1, 0)); axis = shaft.cross(V((1, 0, 0))).normalized()
        return rot_axis(axis, -math.radians(self.P['lean'])) @ R

    def _solve(self):
        s = self.s; b = self.b
        plants, yaws = self.feet()
        self.plants, self.yaws = plants, yaws
        self.pelvis_pos, self.pelvis_rot = self.pelvis(plants, yaws)
        self.club_rot = self.club_rotation()
        self.arm = {side: s.length['UpperArm_' + side] + s.length['Forearm_' + side] for side in 'LR'}
        self.feet_m = {side: b.foot_pose(side, plants[side], yaws[side]) for side in 'LR'}
        base_tilt, base_side = self.P['tilt'], self.P['side']
        hang_goal = math.radians(self.P.get('hang', 12))
        # The arms hang nearly straight down: choose the spine tilt for the
        # lead arm's hang, the side bend for a soft trail arm, the ball
        # distance for a straight lead arm.
        lo, hi = base_tilt - 14, base_tilt + 16
        for _ in range(9):
            tilt = (lo + hi) / 2
            hang = self._fit(tilt, base_side)
            if hang > hang_goal:
                hi = tilt
            else:
                lo = tilt
        self._fit((lo + hi) / 2, base_side)
        self.ball = V((self.P['ball_x'] * self.k, -self.by, clubs_v3.BALL_R))
        self.club = self.club_at(self.ball)
        self.hands = self.grip.hands(self.club)
        self.reach = {side: (self.hands[side].translation - self.shoulder[side]).length / self.arm[side] for side in 'LR'}

    def _fit(self, tilt, base_side):
        b = self.b
        bx = self.P['ball_x'] * self.k
        self.P['tilt'] = tilt
        for extra in range(0, 17):
            self.P['side'] = base_side + extra
            self.thorax_rot = self.thorax()
            probe = b.solve(dict(pelvis_pos=self.pelvis_pos, pelvis_rot=self.pelvis_rot, thorax_rot=self.thorax_rot,
                                 feet=self.feet_m, clavicle=self.clavicles()))
            self.shoulder = {side: probe['UpperArm_' + side].translation.copy() for side in 'LR'}
            # Reach is least with the hands under the shoulder; search outward from there.
            c = self.grip.hands(self.club_at(V((bx, 0, clubs_v3.BALL_R))))['L'].translation.y
            lo, hi = max(.2, c - self.shoulder['L'].y), 1.4
            for _ in range(36):
                by = (lo + hi) / 2
                hands = self.grip.hands(self.club_at(V((bx, -by, clubs_v3.BALL_R))))
                if (hands['L'].translation - self.shoulder['L']).length / self.arm['L'] > self.P.get('lead_reach', .972):
                    hi = by
                else:
                    lo = by
            self.by = by
            hands = self.grip.hands(self.club_at(V((bx, -by, clubs_v3.BALL_R))))
            trail = (hands['R'].translation - self.shoulder['R']).length / self.arm['R']
            if trail < self.P.get('trail_reach', .972):
                break
        d = hands['L'].translation - self.shoulder['L']
        hang = math.atan2(-d.y, -d.z)
        self.trace = getattr(self, 'trace', []) + [(round(tilt, 1), self.P['side'], round(self.by, 3), round(math.degrees(hang), 1),
                      round((hands['L'].translation - self.shoulder['L']).length / self.arm['L'], 3), round(trail, 3),
                      [round(x, 3) for x in self.shoulder['L']], [round(x, 3) for x in hands['L'].translation])]
        return hang

    def clavicles(self):
        # The trail shoulder drops and comes forward a little to reach the grip.
        cr = self.P.get('clav_r', (-11, 20))
        return {'L': (math.radians(-2), math.radians(4)), 'R': (math.radians(cr[0]), math.radians(cr[1]))}

    def club_at(self, ball, rot=None, address=True):
        """ClubGrip frame placing the ball against the face's contact point."""
        R = rot if rot is not None else self.club_rot
        d = self.data
        butt = ball - R @ d['ball']
        if address:
            # Soled at the ground, the face 8 mm behind the ball.
            butt += V((-.008, 0, -clubs_v3.SOLE_AT_IMPACT[self.cid]))
        return mat4(R, butt)

    def spec(self, look=None):
        b = self.b
        return dict(
            pelvis_pos=self.pelvis_pos, pelvis_rot=self.pelvis_rot, thorax_rot=self.thorax_rot,
            look=look if look is not None else self.ball + V((0, 0, 0)), level=.25,
            eyes=self.ball, club=self.club, hands=self.hands,
            elbow={'L': V((-.35, 1, -.55)), 'R': V((.45, 1, -.55))},
            feet={side: b.foot_pose(side, self.plants[side], self.yaws[side]) for side in 'LR'},
            fingers={side: self.grip.fingers(side, self.club) for side in 'LR'},
            clavicle=self.clavicles(),
        )
