"""Golf shoes for the v3 golfers (12 November).

The shoes of 8 November were a 30-station loft of the foot's own extents with a
flat prism under it: faceted, a duck-bill toe, laces as five bars. These are
modelled as a shoe is made:

  upper     a smooth loft over the foot's measured outline: a round heel, flat
            quarters, a domed toe box; cut open below the ankle bone;
  collar    a padded roll round the opening, and a tongue rising up the instep;
  saddle    a panel across the midfoot (the classic golf saddle), a toe cap and
            a heel counter, each edged with a stitch line;
  laces     crossed through five pairs of eyelets, tied in a bow;
  midsole   a profiled rand: toe spring, a bevelled heel, a little flare;
  outsole   a darker tread plate carrying seven soft cleats.

A shoe is rigid on the foot: every part is weighted to the foot bone, and to
the toe bone forward of the ball joint (so the shoe creases where a shoe does).
Soles stand on z = 0, as the animation's ground contact assumes.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector as V
import cloth_v3 as C
import textures_v3 as TX
from body_v3 import FS, TOES, FOREFOOT

STATIONS = 52
RING = 44


def mix(a, b, t):
    return a + (b - a) * t


def ease(x):
    x = min(1.0, max(0.0, float(x))); return x * x * (3 - 2 * x)


def spow(c, e):
    return math.copysign(abs(c) ** e, c)


def _smooth1d(a, rounds=3):
    a = np.asarray(a, dtype=np.float64).copy()
    for _ in range(rounds):
        b = a.copy(); b[1:-1] = (a[:-2] + 2 * a[1:-1] + a[2:]) / 4; a = b
    return a


def _mesh(name, verts, faces, col, smooth=True, sharp=None):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
    ob = bpy.data.objects.new(name, me); col.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = smooth
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    if sharp is not None and hasattr(me, 'set_sharp_from_angle'):
        me.set_sharp_from_angle(angle=math.radians(sharp))
    return ob


def foot_weights(ob, side, ball_y, blend=.016):
    """Foot bone, easing to the toe bone forward of the ball joint (the feet point along -Y)."""
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    foot = ob.vertex_groups.new(name='Foot_' + side); toe = ob.vertex_groups.new(name='Toe_' + side)
    for v in ob.data.vertices:
        w = ease((ball_y + blend - v.co.y) / (2 * blend))
        if w < .999:
            foot.add([v.index], 1 - w, 'REPLACE')
        if w > .001:
            toe.add([v.index], w, 'REPLACE')


def build(O, side, sgn):
    """One shoe on Outfit O. Returns the parts made (already parented to the rig)."""
    P = O.P; k = O.k; J = O.J; v = O.v
    co_body = C.coords(O.me)
    vfs = {}
    for p, f in zip(O.me.polygons, O.fs):
        for i in p.vertices:
            vfs.setdefault(i, set()).add(f)
    ankle = J['ankle_' + side]; ball = J['ball_' + side]
    sets = {FS['foot_' + side], FOREFOOT[side]} | TOES[side] | {FS['shin_' + side]}
    foot = np.array([co_body[i] for i, fs in vfs.items() if fs & sets and co_body[i][2] < ankle.z + .03 * k])
    y0, y1 = foot[:, 1].max() + .007 * k, foot[:, 1].min() - .011 * k            # heel back, toe front
    length = y0 - y1

    # -- the foot's outline, station by station, smoothed along the shoe
    ts = .5 - .5 * np.cos(np.pi * np.linspace(0, 1, STATIONS + 1))     # denser at the heel and the toe, where the shoe rounds
    xmin = np.empty(len(ts)); xmax = np.empty(len(ts)); ztop = np.empty(len(ts))
    for i, t in enumerate(ts):
        y = mix(y0, y1, t)
        band = foot[np.abs(foot[:, 1] - y) < .009 * k]
        if len(band) < 4:
            band = foot[np.abs(foot[:, 1] - y) < .022 * k]
        xmin[i], xmax[i], ztop[i] = band[:, 0].min(), band[:, 0].max(), band[:, 2].max()
    xmin = _smooth1d(xmin, 4); xmax = _smooth1d(xmax, 4); ztop = _smooth1d(ztop, 3)
    xm = (xmin + xmax) / 2
    half = (xmax - xmin) / 2 + .0075 * k
    for i, t in enumerate(ts):
        if t < .15:
            half[i] *= math.sqrt(max(0.0, 1 - (1 - t / .15) ** 2))       # a round heel: a half circle in plan
        if t > .78:
            u = (t - .78) / .22
            half[i] *= max(0.0, 1 - u ** 2.6) ** .5
    half[0] = max(half[0], .004 * k); half[-1] = max(half[-1], .003 * k)
    half = np.maximum(half, .003 * k)

    # -- the sole's own line: the bottom of the shoe, with toe spring and a bevelled heel
    def sole_bottom(t):
        return (.003 + .010 * max(0.0, (t - .78) / .22) ** 1.6 + .004 * max(0.0, (.06 - t) / .06)) * k

    def sole_thick(t):
        return mix(.0155, .0105, ease(t / .7)) * k

    # -- the upper's crown
    throat_t = (y0 - (ankle.y - .050 * k)) / length          # where the opening meets the laces
    def crown(i):
        t = ts[i]
        base = sole_bottom(t) + sole_thick(t)
        instep = ztop[i] + .0075 * k
        if t < throat_t:
            top = ankle.z + .022 * k                         # inside the opening that is cut away below
        else:
            u = (t - throat_t) / max(1e-6, 1 - throat_t)
            toe_box = base + mix(.034, .020, ease((u - .55) / .45)) * k
            top = max(instep, toe_box) * (1 - .0 * u)
            top = mix(top, base + .012 * k, max(0.0, (t - .93) / .07) ** 1.5)
        return base, top

    verts = []
    for i, t in enumerate(ts):
        base, top = crown(i)
        ex = mix(.60, .82, ease((t - .62) / .30))            # flat quarters, a round toe
        ex = mix(.9, ex, ease(t / .2))                       # and a round heel
        ez = mix(.62, .86, ease((t - .60) / .32))            # a flat lace bed, a domed toe box
        y = mix(y0, y1, t)
        for j in range(RING):
            th = 2 * math.pi * j / RING
            cx = math.cos(th); sz = math.sin(th)
            x = xm[i] + half[i] * spow(cx, ex)
            if sz >= 0:
                z = base - .002 * k + (top - base + .002 * k) * abs(sz) ** ez
            else:
                z = base - .002 * k - .003 * k * abs(sz) ** .5
            verts.append((x, y, z))
    faces = []
    for i in range(STATIONS):
        for j in range(RING):
            a = i * RING + j; b = i * RING + (j + 1) % RING
            faces.append((a, b, b + RING, a + RING))
    faces.append(tuple(reversed(range(RING))))
    faces.append(tuple(STATIONS * RING + j for j in range(RING)))
    upper = _mesh(f'Golfer_v3_{v}_Shoe_{side}', verts, faces, O.col)
    C.smooth(upper.data, 3, .35)
    solid_bvh = None
    from mathutils.bvhtree import BVHTree
    solid_bvh = BVHTree.FromObject(upper, bpy.context.evaluated_depsgraph_get())

    # -- panels: saddle, toe cap, heel counter (by where each face lies on the loft)
    mats = dict(
        leather=O.mat('shoe leather', P['shoe'], .42, normal_image=O.textures.normal('leather'), normal_strength=.16, specular=.4),
        panel=O.mat('shoe panel', P.get('shoe_panel', '#D5DAE2'), .5, normal_image=O.textures.normal('leather'), normal_strength=.2, specular=.34),
        accent=O.mat('shoe accent', P['accent'], .5),
        lining=O.mat('shoe lining', P.get('shoe_lining', '#C9CDD3'), .85),
    )
    me = upper.data
    me.materials.clear()
    for key in ('leather', 'panel', 'accent'):
        me.materials.append(mats[key])
    saddle = (.36, .60); cap = .80; counter = .13
    def station_of(p):
        return (y0 - p.center.y) / length
    for p in me.polygons:
        t = station_of(p)
        side_ness = abs(p.center.x - np.interp(t, ts, xm)) / max(1e-6, np.interp(t, ts, half))
        high = p.center.z > sole_bottom(t) + sole_thick(t) + .002 * k
        if saddle[0] < t < saddle[1] and high and side_ness > .30:
            p.material_index = 1
        elif t < counter and high:
            # The heel counter, with a pull tab in the accent colour at its top centre.
            p.material_index = 2 if (p.center.z > .043 * k and side_ness < .5) else 1

    # -- the opening below the ankle bone
    cut_p = V((ankle.x, ankle.y + .014 * k, ankle.z - .006 * k)); cut_n = V((0, .34, 1)).normalized()
    C.cut_plane(upper, cut_p, cut_n, keep_positive=False)
    loops = O._loops(upper)
    rim = max(loops, key=len) if loops else []
    rim_pts = [V(me.vertices[i].co) for i in rim]
    C.solidify(upper, .0026 * k, -1)
    TX.scale_uv_box(upper, 34)
    parts = [upper]

    # -- the padded collar round the opening
    if len(rim_pts) > 8:
        pad = C.tube(f'Golfer_v3_{v}_ShoeCollar_{side}', [p + V((0, 0, .0004 * k)) for p in rim_pts],
                     [(.0040 * k, .0036 * k)] * len(rim_pts), O.col, 10, closed=True, caps=False)
        pad.data.materials.append(mats['lining'])
        parts.append(pad)

    # -- the tongue: up the instep, under the laces, to above the opening's front
    # A padded flap from the throat up the front of the ankle. It is laid on the foot and
    # the shin themselves, seven points across, so it wraps them (a flat board stood proud).
    # Over the instep the surface is found from above; up the shin, from in front (a ray
    # from above there starts inside the leg and finds the sole).
    rows_t = []
    cx0 = ankle.x + sgn * .003
    across = np.linspace(-1, 1, 7)
    def tongue_row(cast, half_w, lift):
        row = []
        for s in across:
            q = cast(cx0 + s * half_w)
            if q is None:
                return None
            row.append(q + lift * (1 - .25 * s * s))
        return row
    for y, hw in ((ankle.y - .070 * k, .019 * k), (ankle.y - .056 * k, .021 * k)):
        def cast(x, y=y):
            hit = O.bvh.ray_cast(V((x, y, ankle.z + .06 * k)), V((0, 0, -1)), .3)
            return hit[0] if hit[0] is not None and hit[0].z > .02 * k else None
        r = tongue_row(cast, hw, V((0, 0, .0072 * k)))
        if r:
            rows_t.append(r)
    for z, hw in ((ankle.z - .002 * k, .022 * k), (ankle.z + .014 * k, .0225 * k), (ankle.z + .030 * k, .021 * k), (ankle.z + .041 * k, .016 * k)):
        def cast(x, z=z):
            hit = O.bvh.ray_cast(V((x, ankle.y - .3, z)), V((0, 1, 0)), .6)
            return hit[0]
        r = tongue_row(cast, hw, V((0, -.0075 * k, 0)))
        if r:
            rows_t.append(r)
    path = [r[len(across) // 2] for r in rows_t]
    tongue = None
    if len(rows_t) >= 4:
        nacross = len(across)
        tv = [p for r in rows_t for p in r]
        tf = [(i * nacross + j, i * nacross + j + 1, (i + 1) * nacross + j + 1, (i + 1) * nacross + j)
              for i in range(len(rows_t) - 1) for j in range(nacross - 1)]
        tongue = _mesh(f'Golfer_v3_{v}_ShoeTongue_{side}', tv, tf, O.col)
        sub = tongue.modifiers.new('Tongue density', 'SUBSURF'); sub.levels = 2
        with bpy.context.temp_override(object=tongue, active_object=tongue, selected_objects=[tongue]):
            bpy.ops.object.modifier_apply(modifier=sub.name)
        C.solidify(tongue, .0042 * k, -1)
        for poly in tongue.data.polygons:
            poly.use_smooth = True
        tongue.data.materials.append(mats['leather'])
        TX.scale_uv_box(tongue, 34)
        parts.append(tongue)

    # -- laces: five pairs of eyelets, crossed, and a bow
    lace_mat = O.mat('laces', P['accent'] if v == 'male' else P['navy'], .78, normal_image=O.textures.normal('rib'), normal_strength=.35)
    eye_mat = O.mat('eyelet', '#8E949C', .35, metal=1.0)
    rows = 5; gap = .0185 * k
    grid = []
    lace_bvh = BVHTree.FromObject(tongue, bpy.context.evaluated_depsgraph_get()) if tongue is not None else solid_bvh
    def on_shoe(x, y, lift):
        best = None
        for bvh in (lace_bvh, solid_bvh):
            hit = bvh.ray_cast(V((x, y, .4)), V((0, 0, -1)), .6)
            if hit[0] is not None and (best is None or hit[0].z > best.z):
                best = hit[0].copy()
        return None if best is None else best + V((0, 0, lift))
    for r in range(rows):
        # The lacing lies forward of the opening (the opening must reach the shin's front).
        y = mix(ankle.y - .122 * k, ankle.y - .060 * k, r / (rows - 1))
        cx = float(np.interp((y0 - y) / length, ts, xm))
        spread = gap * (1 + .12 * r / (rows - 1))
        grid.append((y, cx - spread, cx + spread, cx))
    lace_parts = []; eyelets = []
    def lace(a, b, sag=.0):
        pts = []
        for u in np.linspace(0, 1, 7):
            q = on_shoe(mix(a[0], b[0], u), mix(a[1], b[1], u), .0019 * k + sag * math.sin(math.pi * u))
            if q is not None:
                pts.append(q)
        if len(pts) >= 4:
            lace_parts.append(C.tube(f'Golfer_v3_{v}_Lace', pts, [(.0021 * k, .0013 * k)] * len(pts), O.col, 6))
    for r in range(rows):
        y, xl, xr, cx = grid[r]
        for x in (xl, xr):
            q = on_shoe(x, y, .0009 * k)
            if q is not None:
                e = C.tube(f'Golfer_v3_{v}_Eyelet', [q - V((0, 0, .0012 * k)), q + V((0, 0, .0006 * k))], [.0031 * k, .0031 * k], O.col, 10)
                eyelets.append(e)
        if r == 0:
            lace((xl, y), (xr, y))
        if r < rows - 1:
            y2, xl2, xr2, _ = grid[r + 1]
            lace((xl, y), (xr2, y2), .0006 * k); lace((xr, y), (xl2, y2), .0)
    # The bow: two loops and two ends from the top pair.
    y, xl, xr, cx = grid[-1]
    knot = on_shoe(cx, y + .004 * k, .004 * k)
    if knot is not None:
        for s2 in (-1, 1):
            loop = []
            for u in np.linspace(0, 1, 9):
                a = math.pi * u
                p = knot + V((s2 * (.004 + .020 * math.sin(a)) * k, (.003 - .010 * math.sin(a) * .4) * k - .006 * k * math.sin(a), (.002 + .006 * math.sin(a) ** .8 * (1 - .5 * u)) * k))
                loop.append(p)
            lace_parts.append(C.tube(f'Golfer_v3_{v}_Bow', loop, [(.0019 * k, .0012 * k)] * len(loop), O.col, 6))
            end = [knot + V((s2 * .003 * k, -.002 * k, .002 * k)), knot + V((s2 * .012 * k, -.014 * k, .0005 * k)),
                   knot + V((s2 * .017 * k, -.027 * k, -.004 * k))]
            lace_parts.append(C.tube(f'Golfer_v3_{v}_BowEnd', end, [(.0018 * k, .0011 * k)] * 3, O.col, 6))
        lace_parts.append(C.tube(f'Golfer_v3_{v}_Knot', [knot - V((.004 * k, 0, 0)), knot + V((.004 * k, 0, 0))], [(.0034 * k, .0028 * k)] * 2, O.col, 8))
    lj = C.join(lace_parts, f'Golfer_v3_{v}_Laces_{side}')
    if lj:
        TX.scale_uv_box(lj, 120)
        lj.data.materials.clear(); lj.data.materials.append(lace_mat); parts.append(lj)
    ej = C.join(eyelets, f'Golfer_v3_{v}_Eyelets_{side}')
    if ej:
        ej.data.materials.clear(); ej.data.materials.append(eye_mat); parts.append(ej)

    # -- stitch lines along the panels' edges
    stitches = []
    def arc(t, lo=.16, hi=.84, lift=.0007):
        """Points over the upper at one station, from one side over the top to the other."""
        y = mix(y0, y1, t)
        cx = float(np.interp(t, ts, xm)); hw = float(np.interp(t, ts, half))
        pts = []
        for u in np.linspace(lo, hi, 15):
            x = cx + hw * 1.3 * math.cos(math.pi * u)
            hit = solid_bvh.ray_cast(V((x, y, .4)), V((0, 0, -1)), .6)
            if hit[0] is not None and hit[0].z > sole_bottom(t) + sole_thick(t) + .004 * k:
                q = hit[0] + hit[1] * lift * k
                if (q - cut_p).dot(cut_n) < -.002 * k:      # not across the opening
                    pts.append(q)
        return pts
    for t in (cap, cap - .012):
        pts = arc(t, .2, .8)
        if len(pts) >= 5:
            stitches.append(C.tube(f'Golfer_v3_{v}_Stitch', pts, [.00055 * k] * len(pts), O.col, 4))
    for t in saddle:
        for lo, hi in ((.10, .40), (.60, .90)):
            pts = arc(t, lo, hi)
            if len(pts) >= 4:
                stitches.append(C.tube(f'Golfer_v3_{v}_Stitch', pts, [.00055 * k] * len(pts), O.col, 4))
    sj = C.join(stitches, f'Golfer_v3_{v}_ShoeStitch_{side}')
    if sj:
        sj.data.materials.clear(); sj.data.materials.append(O.mat('shoe stitch', P.get('shoe_stitch', '#AEB4BD'), .8)); parts.append(sj)

    # -- midsole and outsole: the outline, profiled
    n_out = 2 * len(ts)
    def outline(grow):
        left = [(xm[i] + half[i] + grow, mix(y0, y1, ts[i])) for i in range(len(ts))]
        right = [(xm[i] - half[i] - grow, mix(y0, y1, ts[i])) for i in range(len(ts) - 1, -1, -1)]
        return left + right
    def t_of(y):
        return (y0 - y) / length
    profile = [(-.0015, 0.0), (.0030, .22), (.0034, .62), (.0026, .93), (.0006, 1.0)]       # (flare, share of the thickness)
    sv = []; sf = []
    for flare, share in profile:
        for x, y in outline(flare * k):
            t = t_of(y)
            sv.append((x, y, sole_bottom(t) + sole_thick(t) * share))
    for l in range(len(profile) - 1):
        for j in range(n_out):
            a = l * n_out + j; b = l * n_out + (j + 1) % n_out
            sf.append((a, b, b + n_out, a + n_out))
    sf.append(tuple(reversed(range(n_out)))); sf.append(tuple((len(profile) - 1) * n_out + j for j in range(n_out)))
    sole = _mesh(f'Golfer_v3_{v}_Sole_{side}', sv, sf, O.col, smooth=True, sharp=42)
    sole.data.materials.append(O.mat('midsole', P['sole'], .58, specular=.3))
    sole.data.materials.append(O.mat('outsole', P['outsole'], .82))
    for p in sole.data.polygons:
        t = t_of(p.center.y)
        if p.center.z < sole_bottom(t) + sole_thick(t) * .24:
            p.material_index = 1
    parts.append(sole)
    # Soft cleats under the forefoot and the heel.
    cleats = []
    for t, across in ((.16, -.45), (.16, .45), (.30, .0), (.58, -.55), (.58, .55), (.72, .0), (.84, -.35), (.84, .35)):
        cx = float(np.interp(t, ts, xm)) + across * float(np.interp(t, ts, half))
        y = mix(y0, y1, t); zb = sole_bottom(t)
        cleats.append(C.tube(f'Golfer_v3_{v}_Cleat', [V((cx, y, zb + .0005 * k)), V((cx, y, max(0.0, zb - .0032 * k)))],
                             [.0072 * k, .0050 * k], O.col, 10))
    cj = C.join(cleats, f'Golfer_v3_{v}_Cleats_{side}')
    if cj:
        cj.data.materials.clear(); cj.data.materials.append(O.mat('cleat', P.get('cleat', '#2A2E35'), .7)); parts.append(cj)

    for ob in parts:
        foot_weights(ob, side, ball.y)
        ob.parent = O.rig
        mod = ob.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = O.rig
        O.parts.append(ob)
    return dict(parts=parts, top=float(max(p.z for p in rim_pts)) if rim_pts else ankle.z, length=float(length))
