"""Pose maths for the v3 golfer: frames, limb IK, foot roll, splines, baking.

A pose is a dict of bone -> armature-space 4x4 matrices. Every bone's rest
frame has Y along the bone; its Z is an anatomical reference set at rest by
body_v3 (forward for the trunk and limbs, dorsal for hands and fingers, up for
the feet). A posed frame is built from a new Y and a new Z reference, so the
mesh turns with the anatomy it was weighted to.
"""
import math
from mathutils import Vector as V, Matrix, Quaternion

PI = math.pi
UP = V((0, 0, 1)); FWD = V((0, -1, 0)); LEFT = V((1, 0, 0))


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smooth(x):
    x = clamp(x); return x * x * (3 - 2 * x)


def smoother(x):
    x = clamp(x); return x * x * x * (x * (6 * x - 15) + 10)


def mix(a, b, t):
    return a + (b - a) * t


def frame(y, z):
    """Columns X, Y, Z with Y along y and Z the part of z normal to it."""
    y = V(y).normalized(); z = V(z) - y * y.dot(V(z))
    if z.length < 1e-6:
        z = y.orthogonal()
    z.normalize(); x = y.cross(z).normalized()
    return Matrix((x, y, z)).transposed()


def mat4(rot, pos):
    m = rot.to_4x4() if rot.__len__() == 3 else rot.copy()
    m.translation = V(pos)
    return m


def rot_axis(axis, angle):
    return Matrix.Rotation(angle, 3, V(axis).normalized())


def swing_twist(q, axis):
    """Split rotation q into swing * twist about axis; returns the twist angle."""
    axis = V(axis).normalized()
    p = V((q.x, q.y, q.z)).dot(axis)
    twist = Quaternion((q.w, *(axis * p)))
    if twist.magnitude < 1e-9:
        return 0.0
    twist.normalize()
    angle = 2 * math.atan2(V((twist.x, twist.y, twist.z)).dot(axis), twist.w)
    return (angle + PI) % (2 * PI) - PI


def two_bone(a, target, l1, l2, bend_hint):
    """Elbow/knee position for a limb from a to target bending toward bend_hint.

    Returns the joint and the (possibly shortened) end point. A target out of
    reach is pulled in along the line so the limb never stretches.
    """
    d = target - a; dist = d.length
    reach = (l1 + l2) * .9995
    if dist > reach:
        target = a + d.normalized() * reach; d = target - a; dist = reach
    dist = max(dist, abs(l1 - l2) + 1e-4)
    axis = d.normalized()
    along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - along * along))
    perp = V(bend_hint) - axis * axis.dot(V(bend_hint))
    if perp.length < 1e-6:
        perp = axis.orthogonal()
    return a + axis * along + perp.normalized() * h, target


class Spline:
    """Keyed channels with time-aware Catmull-Rom tangents (C1, no overshoot
    at a held key: equal neighbours give a zero tangent)."""

    def __init__(self, keys, hold=()):
        self.keys = sorted(((float(t), [float(x) for x in (v if isinstance(v, (list, tuple)) else [v])]) for t, v in keys))
        self.hold = set(hold)

    def __call__(self, t):
        k = self.keys
        if t <= k[0][0]:
            return list(k[0][1])
        if t >= k[-1][0]:
            return list(k[-1][1])
        for i in range(len(k) - 1):
            t0, a = k[i]; t1, b = k[i + 1]
            if t <= t1:
                break
        dt = t1 - t0; u = (t - t0) / dt
        out = []
        for j in range(len(a)):
            def tangent(n):
                if n <= 0 or n >= len(k) - 1:
                    return 0.0
                tp, vp = k[n - 1]; tn, vn = k[n + 1]; v = k[n][1][j]
                if (vp[j] - v) * (vn[j] - v) > 0:   # a local extreme holds still
                    return 0.0
                return (vn[j] - vp[j]) / (tn - tp)
            m0 = tangent(i) * dt; m1 = tangent(i + 1) * dt
            u2 = u * u; u3 = u2 * u
            out.append((2 * u3 - 3 * u2 + 1) * a[j] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b[j] + (u3 - u2) * m1)
        return out

    def scalar(self, t):
        return self(t)[0]


class Skeleton:
    """Rest data and pose assembly for one rig."""

    def __init__(self, rig):
        self.rig = rig
        bones = rig.data.bones
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.head = {b.name: b.head_local.copy() for b in bones}
        self.tail = {b.name: b.tail_local.copy() for b in bones}
        self.length = {b.name: b.length for b in bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.order = [b.name for b in bones]  # parents precede children
        self.rest3 = {n: m.to_3x3() for n, m in self.rest.items()}

    def zref(self, name):
        return self.rest3[name].col[2].copy()

    def yref(self, name):
        return self.rest3[name].col[1].copy()

    def child_rigid(self, pose, name):
        """World matrix of a bone that keeps its rest offset to its parent."""
        p = self.parent[name]
        return pose[p] @ self.rest[p].inverted() @ self.rest[name]

    def rotated(self, name, rot3, head):
        """The bone's rest frame turned by a world rotation, at a head position."""
        return mat4(rot3 @ self.rest3[name], head)

    def basis(self, pose):
        """Pose-bone matrix_basis values from armature-space matrices."""
        out = {}
        for name in self.order:
            m = pose[name]; p = self.parent[name]
            if p:
                local = self.rest[p].inverted() @ self.rest[name]
                out[name] = local.inverted() @ pose[p].inverted() @ m
            else:
                out[name] = self.rest[name].inverted() @ m
        return out

    def fill(self, pose):
        """Complete a partial pose: missing bones follow their parents rigidly."""
        for name in self.order:
            if name not in pose:
                pose[name] = self.child_rigid(pose, name) if self.parent[name] else self.rest[name].copy()
        return pose


def bake_action(rig, action, frames, skel, location_bones=('Root', 'Hips', 'ClubGrip')):
    """Write per-frame basis matrices as linear F-curves (fast path)."""
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    names = skel.order
    rots = {n: [] for n in names}; locs = {n: [] for n in names}
    for basis in frames:
        for n in names:
            m = basis[n]
            q = m.to_quaternion()
            prev = rots[n][-1] if rots[n] else None
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            rots[n].append(q); locs[n].append(m.translation.copy())
    count = len(frames)
    for n in names:
        path = f'pose.bones["{n}"]'
        series = [('rotation_quaternion', i, [q[i] for q in rots[n]]) for i in range(4)]
        moved = n in location_bones or max(v.length for v in locs[n]) > 1e-5
        if moved:
            series += [('location', i, [v[i] for v in locs[n]]) for i in range(3)]
        for prop, index, values in series:
            fc = action.fcurve_ensure_for_datablock(rig, f'{path}.{prop}', index=index, group_name=n)
            fc.keyframe_points.clear()
            fc.keyframe_points.add(count)
            flat = [0.0] * (2 * count)
            for f, v in enumerate(values):
                flat[2 * f] = f + 1; flat[2 * f + 1] = v
            fc.keyframe_points.foreach_set('co', flat)
            fc.keyframe_points.foreach_set('interpolation', [1] * count)  # LINEAR
            fc.update()
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
