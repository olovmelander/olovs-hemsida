"""The golfer carries the app's own bag clubs (docs/graphics/clubs).

Each club is appended from unbranded-clubs.blend, decimated for a carried
prop, and re-seated in the ClubGrip socket's rest frame: origin at the butt
of the grip, bone Y down the shaft toward the head, bone Z the square face
(target) direction, bone X = Y x Z. In that frame the club's ball contact
point, face normal and sole are recorded for the swing solver.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector as V, Matrix

ROOT = Path(__file__).resolve().parents[3]
CLUB_SOURCE = ROOT / 'docs/graphics/clubs/unbranded-clubs.blend'
# Runtime id -> bag model, loft (deg) and the face materials that locate the hitting area.
CLUBS = {
    'Driver': ('Club_driver', 10.5, ('wood forged face',)),
    'Wood': ('Club_wood-3', 15.0, ('wood forged face',)),
    'Iron': ('Club_iron-7', 30.5, ('recessed scorelines',)),
    'Wedge': ('Club_sw', 56.0, ('wedge blasted face',)),
    'Putter': ('Club_putter', 3.5, ('putter milled face',)),
}
# Where the sole sits at impact (m, ground = 0): woods sweep, irons take turf.
SOLE_AT_IMPACT = {'Driver': .004, 'Wood': -.001, 'Iron': -.006, 'Wedge': -.004, 'Putter': .003}
BALL_R = .02135
DECIMATE = {'Driver': .32, 'Wood': .32, 'Iron': .4, 'Wedge': .4, 'Putter': .3}


def load_clubs(collection):
    names = [v[0] for v in CLUBS.values()]
    with bpy.data.libraries.load(str(CLUB_SOURCE), link=False) as (src, dst):
        dst.objects = names
    out = {}
    for (cid, (name, loft, face_mats)), ob in zip(CLUBS.items(), dst.objects):
        collection.objects.link(ob)
        out[cid] = (ob, loft, face_mats)
    return out


def seat(ob, cid, loft, face_mats, grip_rest, scale=1.0):
    """Transform a bag club into the ClubGrip rest frame; return its data."""
    me = ob.data
    me.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
    # Golfer frame: the bag models face -Y with the grip leaning +X; the golfer
    # faces -Y with the target at +X, so the club turns +90 degrees about Z.
    me.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
    mats = [m.name for m in me.materials]
    grip_ids = set(); face_ids = []
    for p in me.polygons:
        n = mats[p.material_index]
        if 'grip' in n and 'rubber' in n:
            grip_ids.update(p.vertices)
        if any(f in n for f in face_mats):
            face_ids.append(p)
    pts = [me.vertices[i].co for i in grip_ids]
    c = sum(pts, V()) / len(pts)
    # Principal axis of the grip tube.
    cov = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
    for p in pts:
        d = p - c
        for i in range(3):
            for k in range(3):
                cov[i][k] += d[i] * d[k]
    axis = V((0, .5, .85))
    for _ in range(60):
        axis = (cov @ axis).normalized()
    if axis.z < 0:
        axis = -axis
    allv = [v.co for v in me.vertices]
    butt_along = max((p - c).dot(axis) for p in allv)
    butt = c + axis * butt_along
    shaft = -axis                                   # butt -> head
    square = V((1, 0, 0)); square = (square - shaft * shaft.dot(square)).normalized()
    # Map (shaft, square) onto the socket's rest (Y, Z) and the butt onto its head.
    src = Matrix((shaft.cross(square), shaft, square)).transposed()
    dst = grip_rest.to_3x3()
    R = (dst @ src.transposed()).to_4x4()
    # Fitted length: a taller golfer carries slightly longer clubs (scaled about the butt).
    M = Matrix.Translation(grip_rest.translation) @ Matrix.Scale(scale, 4) @ R @ Matrix.Translation(-butt)
    me.transform(M)
    # Club data in socket-local coordinates (x = t, y = s, z = f).
    inv = grip_rest.inverted()
    local = [inv @ v.co for v in me.vertices]
    centres = [inv @ p.center for p in face_ids]
    area = [p.area for p in face_ids]
    fc = sum((c_ * a for c_, a in zip(centres, area)), V()) / sum(area)
    # Socket-local axes: s = +Y (down the shaft), f = +Z (square), t = +X.
    # 'up' is world up when the club is soled at its lie (the bag model's +Z).
    up = (inv.to_3x3() @ (R.to_3x3() @ V((0, 0, 1)))).normalized()
    square_l = V((0, 0, 1))
    up = (up - square_l * square_l.dot(up)).normalized()
    L = math.radians(loft)
    normal = (square_l * math.cos(L) + up * math.sin(L)).normalized()
    lie_rest_up = up
    sole = min(local, key=lambda p: p.dot(lie_rest_up))
    length = max(p.y for p in local)
    ob.name = 'Club_' + cid; ob.data.name = 'Club_' + cid
    return dict(face_centre=fc, normal=normal, sole=sole, up=lie_rest_up, length=length,
                lie=math.degrees(math.asin(max(-1, min(1, -lie_rest_up.y)))), loft=loft)


def decimate(ob, ratio):
    mod = ob.modifiers.new('Carried prop detail', 'DECIMATE')
    mod.ratio = ratio; mod.use_collapse_triangulate = False
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def contact_point(data, cid):
    """Club-local point that must touch the ball, for a ball on the ground.

    At address the club is soled square with the shaft at its lie. The contact
    lies on the face plane, at the face's heel-toe centre, at the height where
    a grounded ball touches it when the sole is SOLE_AT_IMPACT above ground.
    """
    up = data['up']; n = data['normal']; fc = data['face_centre']
    sole_h = data['sole'].dot(up)
    want = sole_h - SOLE_AT_IMPACT[cid] + BALL_R - n.dot(up) * BALL_R
    # Move along the face plane (perpendicular to the normal) in the up direction.
    along = (up - n * n.dot(up)).normalized()
    p = fc + along * ((want - fc.dot(up)) / max(1e-6, along.dot(up)))
    return p, p + n * BALL_R  # contact point, ball centre at contact
