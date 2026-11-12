"""Teeth, gums and a tongue (12 November).

The CC0 bodies have a mouth cavity and nothing in it, so a mouth that opened
(a smile, a shout after a holed putt) showed a dark hole. Both dental arches
are modelled here, tooth by tooth to the second premolars, with their gums and
a tongue. The upper arch is rigid on the head, the lower arch and the tongue on
the jaw.

Where they stand is measured on the body: behind the lips' inner wall, found
from the mouth's own landmarks, and then checked: no tooth may be seen from the
front with the mouth at rest. If one is, the arches step back a millimetre and
are checked again.
"""
import bpy, math
import numpy as np
from mathutils import Vector as V
from mathutils.bvhtree import BVHTree
import cloth_v3 as C

# Crown widths along the arch and heights, millimetres, from the midline out: central
# and lateral incisor, canine, first and second premolar.
UPPER = dict(widths=(8.4, 6.5, 7.5, 6.9, 6.7), heights=(9.6, 8.2, 9.4, 7.6, 7.2), A=23.5, B=28.0)
LOWER = dict(widths=(5.3, 5.9, 6.8, 6.9, 7.0), heights=(8.2, 8.4, 9.2, 7.6, 7.2), A=21.0, B=25.0)
# Along a crown from its biting edge to the gum: (share of the height, half-width share, half-depth mm).
INCISOR = ((0.0, .44, .45), (.09, .50, .95), (.34, .50, 1.75), (.70, .45, 2.3), (1.0, .37, 2.4))
PREMOLAR = ((0.0, .40, 1.9), (.10, .49, 2.9), (.36, .50, 3.5), (.72, .46, 3.6), (1.0, .38, 3.3))


def arch_point(spec, s_mm, k):
    """The point and tangent of an arch at arc length s (mm, signed) from the midline, in metres round (0, 0)."""
    A, B = spec['A'], spec['B']
    phi = 0.0; step = .002; acc = 0.0; target = abs(s_mm)
    while acc < target and phi < 1.5:
        dx = A * math.cos(phi) * step; dy = B * math.sin(phi) * step
        acc += math.hypot(dx, dy); phi += step
    sgn = 1 if s_mm >= 0 else -1
    x = sgn * A * math.sin(phi); y = B * (1 - math.cos(phi))
    t = V((sgn * A * math.cos(phi), B * math.sin(phi), 0))
    t = t.normalized() if t.length > 1e-9 else V((sgn, 0, 0))
    return V((x * .001 * k, y * .001 * k, 0)), t


def tooth(centre, tangent, width, height, profile, up, k, sides=12):
    """One crown: rings from the biting edge to the gum. `up` is +1 for an upper tooth (the gum above the edge)."""
    normal = V((-tangent.y, tangent.x, 0))                      # radial, in the arch's plane
    verts = []; faces = []
    for share, hw, hd in profile:
        z = centre.z + up * share * height * .001 * k
        a = hw * width * .001 * k; b = hd * .001 * k
        for j in range(sides):
            th = 2 * math.pi * j / sides
            c = math.cos(th); s = math.sin(th)
            # A rounded box across, as a crown is.
            cx = math.copysign(abs(c) ** .7, c); sy = math.copysign(abs(s) ** .7, s)
            p = V((centre.x, centre.y, z)) + tangent * (a * cx) + normal * (b * sy)
            verts.append(tuple(p))
    rings = len(profile)
    for i in range(rings - 1):
        for j in range(sides):
            a_ = i * sides + j; b_ = i * sides + (j + 1) % sides
            faces.append((a_, b_, b_ + sides, a_ + sides))
    faces.append(tuple(range(sides)))                           # the biting edge
    return verts, faces


def arch(spec, origin, edge_z, up, k, name, collection, shift=0.0):
    """One dental arch as a single mesh, and the gum line's points along it."""
    verts = []; faces = []; gum = []
    for side in (1, -1):
        s = 0.0
        for i, (w, h) in enumerate(zip(spec['widths'], spec['heights'])):
            mid = side * (s + w / 2)
            p, t = arch_point(spec, mid, k)
            c = V((origin.x + p.x, origin.y + p.y + shift, edge_z))
            profile = INCISOR if i < 3 else PREMOLAR
            # A canine comes to a point: a narrower edge. Edges are not level: laterals sit a touch short.
            lift = (.0, .55, -.25, .35, .5)[i] * .001 * k * up
            cc = c + V((0, 0, lift))
            tv, tf = tooth(cc, t, w * .96, h, profile, up, k)
            base = len(verts)
            verts += tv; faces += [tuple(base + j for j in f) for f in tf]
            gum.append((mid, V((cc.x, cc.y, cc.z + up * h * .001 * k))))
            s += w
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    ob = bpy.data.objects.new(name, me); collection.objects.link(ob)
    for poly in me.polygons:
        poly.use_smooth = True
    import bmesh
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    gum.sort(key=lambda g: g[0])
    return ob, [g[1] for g in gum]


def visible_from_front(ob, bvh, line_z, k):
    """How many of a part's vertices a ray straight ahead leaves the head without meeting the lips."""
    n = 0
    for v in ob.data.vertices:
        if abs(v.co.z - line_z) < .003 * k:
            continue                                            # level with the slit between the lips
        hit = bvh.ray_cast(v.co + V((0, -.0006, 0)), V((0, -1, 0)), .05)
        if hit[0] is None:
            n += 1
    return n


def build(O):
    """Teeth, gums and tongue on Outfit O. Returns a small report."""
    J = O.J; k = O.k; v = O.v
    if 'lip_line' not in J or 'Jaw' not in O.rig.data.bones:
        return {}
    line = J['lip_line']
    teeth_mat = C.material(f'Golfer v3 {v} | teeth', '#EDE7D8', .22, specular=.5, coat=.5)
    # Teeth stand a centimetre inside the lips, where little light reaches: a little of their
    # own colour as emission keeps a smile's teeth from reading as a dark gap.
    b = teeth_mat.node_tree.nodes['Principled BSDF']
    b.inputs['Emission Color'].default_value = (*C.lin(C.hexrgb('#EDE7D8')), 1.0)
    b.inputs['Emission Strength'].default_value = .16
    gum_mat = C.material(f'Golfer v3 {v} | gums', '#B4606A', .38, specular=.45)
    tongue_mat = C.material(f'Golfer v3 {v} | tongue', '#B45A62', .42, specular=.45)
    # The upper incisors hang two millimetres below the lips' line and overlap the lower ones.
    upper_edge = line.z - .0020 * k; lower_edge = line.z - .0034 * k
    report = {}
    made = {}
    for shift_mm in range(0, 7):
        shift = shift_mm * .001 * k
        up_ob, up_gum = arch(UPPER, V((0, line.y + .0096 * k, 0)), upper_edge, 1, k, f'Golfer_v3_{v}_TeethUpper', O.col, shift)
        lo_ob, lo_gum = arch(LOWER, V((0, line.y + .0135 * k, 0)), lower_edge, -1, k, f'Golfer_v3_{v}_TeethLower', O.col, shift)
        seen = visible_from_front(up_ob, O.bvh, line.z, k) + visible_from_front(lo_ob, O.bvh, line.z, k)
        if seen == 0 or shift_mm == 6:
            made = dict(upper=up_ob, lower=lo_ob, up_gum=up_gum, lo_gum=lo_gum)
            report.update(shift_mm=shift_mm, seen=seen)
            break
        for ob in (up_ob, lo_ob):
            bpy.data.objects.remove(ob, do_unlink=True)
    parts = []
    for key, bone in (('upper', 'Head'), ('lower', 'Jaw')):
        ob = made[key]
        ob.data.materials.append(teeth_mat)
        C.rigid(ob, bone); parts.append(ob)
    # Gums: a soft band over each arch's gum line.
    for pts, up, bone, name in ((made['up_gum'], 1, 'Head', 'GumUpper'), (made['lo_gum'], -1, 'Jaw', 'GumLower')):
        path = [p + V((0, .0012 * k, up * .0034 * k)) for p in pts]
        g = C.tube(f'Golfer_v3_{v}_{name}', path, [(.0046 * k, .0036 * k)] * len(path), O.col, 10)
        g.data.materials.append(gum_mat)
        C.rigid(g, bone); parts.append(g)
    # The tongue, lying on the mouth's floor behind the lower teeth.
    c = V((0, line.y + (.030 + report['shift_mm'] * .001) * k, line.z - .0105 * k))
    rings = 9; sides = 14
    verts = []; faces = []
    for i in range(rings + 1):
        u = i / rings
        y = c.y + (u - .42) * .040 * k
        r = math.sin(math.pi * min(1.0, .06 + .94 * u)) ** .62
        tip = 1 - .55 * max(0.0, (.3 - u) / .3) ** 2                 # the tip narrows
        for j in range(sides):
            th = 2 * math.pi * j / sides
            verts.append((c.x + .0165 * k * r * tip * math.cos(th), y,
                          c.z + (.0062 * k * r * math.sin(th) if math.sin(th) > 0 else .0034 * k * r * math.sin(th))
                          + .0012 * k * max(0.0, (.3 - u) / .3)))
    for i in range(rings):
        for j in range(sides):
            a_ = i * sides + j; b_ = i * sides + (j + 1) % sides
            faces.append((a_, b_, b_ + sides, a_ + sides))
    faces.append(tuple(reversed(range(sides)))); faces.append(tuple(rings * sides + j for j in range(sides)))
    me = bpy.data.meshes.new(f'Golfer_v3_{v}_Tongue'); me.from_pydata(verts, [], faces); me.update()
    tongue = bpy.data.objects.new(me.name, me); O.col.objects.link(tongue)
    for poly in me.polygons:
        poly.use_smooth = True
    C.smooth(me, 2, .4)
    tongue.data.materials.append(tongue_mat)
    C.rigid(tongue, 'Jaw'); parts.append(tongue)
    for ob in parts:
        ob['no_shade'] = True                                  # inside the mouth at rest: baked occlusion would leave them black
        ob.parent = O.rig
        mod = ob.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = O.rig
        O.parts.append(ob)
    report['parts'] = len(parts)
    print('MOUTH', report)
    return report
