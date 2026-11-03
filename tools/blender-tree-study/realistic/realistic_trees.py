"""THE REALISTIC CATALOGUE (treeset v2, 3 November; owner request: trees as
realistic as the new grass). Each species is grown from its own branching:

- a trunk (leaning toward its crown's centre), its limbs set round it by the
  golden angle at the species' own angles and lengths, each limb's twigs off
  alternate sides, and the leaf cards -- sprigs from the species' atlas
  (make_leaf_atlas.mjs) -- along the twigs' outer reach, so a crown is many
  small clusters with sky between its limbs;
- the crown's box is the approved catalogue's (ghibli-fluffy.json's hero tier):
  its height, crown base, centre and half-widths, so the loader's fit
  (fitFoliageTier) leaves every tree standing as tall and wide as before and
  placements and shadows still match;
- each card's normal is soft: mostly the crown's own outward direction, some of
  its limb's cluster and a little of the card's face, so the analytic light
  reads a volume and each card keeps a little of its own tilt;
- the wood is tapered tubes carrying the bark colour per vertex (a pine grey
  below and orange above, a birch white with dark lenticels and a dark foot).

Run inside Blender through the MCP (data API only, in its own scene
`BanvyTreesV2`; nothing else in the file is touched):

    exec(open(r'<repo>/tools/blender-tree-study/realistic/realistic_trees.py').read())
    result = build_catalogue(r'<outdir>')

It writes <outdir>/<key>-<tier>.json (crown: position, normal, uv, index;
trunk: position, normal, color, index; in glTF's Y-up metres) and links a
preview object for each into the scene. pack_catalogue.mjs makes the GLBs.
Seeded: the same trees every run."""
import json
import math
import os
import random

try:
    import bpy
    from mathutils import Vector
except ImportError:  # outside Blender: a small stand-in for the arithmetic
    bpy = None
    class Vector(tuple):
        def __new__(cls, v): return tuple.__new__(cls, (float(v[0]), float(v[1]), float(v[2])))
        x = property(lambda s: s[0]); y = property(lambda s: s[1]); z = property(lambda s: s[2])
        def __add__(s, o): return Vector((s[0] + o[0], s[1] + o[1], s[2] + o[2]))
        def __sub__(s, o): return Vector((s[0] - o[0], s[1] - o[1], s[2] - o[2]))
        def __mul__(s, k): return Vector((s[0] * k, s[1] * k, s[2] * k))
        __rmul__ = __mul__
        def __truediv__(s, k): return Vector((s[0] / k, s[1] / k, s[2] / k))
        def __neg__(s): return Vector((-s[0], -s[1], -s[2]))
        def dot(s, o): return s[0] * o[0] + s[1] * o[1] + s[2] * o[2]
        def cross(s, o): return Vector((s[1] * o[2] - s[2] * o[1], s[2] * o[0] - s[0] * o[2], s[0] * o[1] - s[1] * o[0]))
        @property
        def length(s): return math.sqrt(s.dot(s))
        def normalized(s):
            L = s.length or 1.0
            return Vector((s[0] / L, s[1] / L, s[2] / L))
        def lerp(s, o, t): return s + (o - s) * t
        def copy(s): return Vector(s)

UP = Vector((0.0, 1.0, 0.0))
TIERS = ('hero', 'full')

# The approved crowns' boxes (ghibli-fluffy.json, hero tier): height, crown base, centre (x, z) and half-widths (x, z).
SPECIES = {
    'björk': dict(name='Silver birch', seed=4101, height=14.9, base=4.5, centre=(0.1, 0.05), half=(5.3, 5.35),
                  trunk=dict(r=0.34, top=0.93, sides=(10, 6), wobble=0.10, fork=0.0),
                  limbs=dict(count=(34, 22), start=0.30, end=0.96, rise=(30, 64), curve=0.10, droop=0.45, reach=(0.5, 1.0), r=0.32),
                  twigs=dict(spacing=0.55, length=(0.9, 1.7), angle=55, droop=0.55, r=0.25),
                  cards=dict(count=(1900, 700), size=0.92, hang=0.55, outward=0.45, along=(0.25, 1.0)),
                  puff=dict(r=(0.6, 0.55), outward=0.8, up=0.15, mid=0.55),
                  shape='ovoid', bark='birch'),
    'ek': dict(name='Pasture oak', seed=4203, height=16.5, base=5.1, centre=(-0.35, -0.4), half=(8.45, 9.2),
               trunk=dict(r=0.62, top=0.04, sides=(12, 7), wobble=0.18, fork=5),
               limbs=dict(count=(30, 20), start=0.36, end=0.95, rise=(22, 58), curve=0.18, droop=0.10, reach=(0.55, 1.0), r=0.36),
               twigs=dict(spacing=0.6, length=(1.2, 2.4), angle=60, droop=0.15, r=0.28),
               cards=dict(count=(1900, 720), size=1.25, hang=0.15, outward=0.6, along=(0.35, 1.0)),
               puff=dict(r=(0.95, 0.75), outward=0.9, up=0.3, mid=0.65),
               shape='dome', bark='oak'),
    'al': dict(name='Grey alder', seed=4307, height=12.2, base=2.4, centre=(-0.35, -1.4), half=(2.85, 3.3),
               trunk=dict(r=0.26, top=0.95, sides=(9, 6), wobble=0.10, fork=0.0),
               limbs=dict(count=(36, 22), start=0.22, end=0.97, rise=(40, 62), curve=0.08, droop=0.12, reach=(0.7, 1.0), r=0.3),
               twigs=dict(spacing=0.45, length=(0.6, 1.2), angle=55, droop=0.2, r=0.25),
               cards=dict(count=(1800, 780), size=0.98, hang=0.25, outward=0.55, along=(0.2, 1.0)),
               puff=dict(r=(0.65, 0.6), outward=0.8, up=0.2, mid=0.55),
               shape='ovoid', bark='alder'),
    'tall': dict(name='Scots pine', seed=4409, height=18.9, base=10.4, centre=(2.0, -0.75), half=(8.9, 7.35),
                 trunk=dict(r=0.36, top=0.9, sides=(10, 6), wobble=0.55, fork=0.0),
                 limbs=dict(count=(20, 14), start=0.02, end=0.9, rise=(4, 30), curve=0.16, droop=0.0, reach=(0.6, 1.0), r=0.42),
                 twigs=dict(spacing=0.5, length=(1.0, 2.2), angle=62, droop=-0.1, r=0.32),
                 cards=dict(count=(1700, 600), size=1.6, hang=-0.35, outward=0.25, along=(0.62, 1.0)),
                 puff=dict(r=(1.15, 0.42), outward=0.3, up=1.4, mid=0.45),
                 shape='umbrella', bark='pine'),
    'gran': dict(name='Norway spruce', seed=4511, height=19.4, base=0.9, centre=(0.35, -0.3), half=(6.55, 6.5),
                 trunk=dict(r=0.34, top=1.0, sides=(10, 6), wobble=0.03, fork=0.0),
                 limbs=dict(count=(78, 44), start=0.05, end=0.985, rise=(-18, 8), curve=-0.05, droop=0.35, reach=(0.85, 1.0), r=0.22),
                 twigs=dict(spacing=0.42, length=(0.5, 1.1), angle=70, droop=0.65, r=0.22),
                 cards=dict(count=(2300, 800), size=1.45, hang=0.45, outward=0.25, along=(0.1, 1.0)),
                 puff=dict(spacing=0.2),
                 shape='cone', bark='spruce'),
}

def envelope(shape, t):
    """The crown's radius share at t up its height (0 its base, 1 its top)."""
    t = min(max(t, 0.0), 1.0)
    if shape == 'cone':
        return max(0.04, (1 - t) ** 0.92)
    if shape == 'dome':
        return max(0.05, math.sqrt(max(0.0, 1 - ((t - 0.32) / 0.68) ** 2)) if t > 0.32 else 0.62 + 0.38 * math.sin(t / 0.32 * math.pi / 2))
    if shape == 'umbrella':
        return max(0.08, math.sin(math.pi * (0.25 + 0.75 * t)) ** 0.6)
    return max(0.05, math.sin(math.pi * t ** 0.85) ** 0.75)   # ovoid

def bark_colour(kind, h, height, rnd, theta):
    """Linear bark colour at height h: per-vertex, with a little noise."""
    n = 0.9 + 0.2 * rnd.random()
    if kind == 'birch':
        foot = max(0.0, 1 - h / 1.6)
        if rnd.random() < 0.16 + 0.3 * foot:   # the dark lenticels and fissures
            return (0.07 * n, 0.065 * n, 0.06 * n)
        w = 0.78 * n * (1 - 0.75 * foot)
        return (w, w * 0.985, w * 0.93)
    if kind == 'pine':
        up = min(1.0, max(0.0, (h / height - 0.42) / 0.22))
        lo, hi = (0.11, 0.085, 0.07), (0.42, 0.17, 0.065)
        return tuple((lo[i] + (hi[i] - lo[i]) * up) * n for i in range(3))
    if kind == 'oak':
        f = 0.75 + 0.25 * math.sin(theta * 7 + h * 3.1)
        return (0.085 * n * f, 0.075 * n * f, 0.062 * n * f)
    if kind == 'alder':
        return (0.13 * n, 0.12 * n, 0.105 * n)
    return (0.06 * n, 0.045 * n, 0.035 * n)     # spruce

BARK_TILE = 0.6   # metres of bark a repeat of its atlas covers (bark_atlas.py)

class Wood:
    def __init__(self): self.P, self.N, self.C, self.U, self.I = [], [], [], [], []
    def tube(self, pts, radii, sides, kind, height, rnd, cap=False):
        """A tapered tube along `pts`: parallel-transported rings, normals radial; uv round it in whole repeats
        of the bark's tile (a seam column, so the bark wraps without a stretch) and up it by its length, v
        falling upward (the atlases' image is up the trunk toward smaller v, as the sprigs')."""
        if len(pts) < 2 or sides < 3: return
        t0 = (pts[1] - pts[0]).normalized()
        a = UP if abs(t0.dot(UP)) < 0.9 else Vector((1.0, 0.0, 0.0))
        nrm = t0.cross(a).normalized()
        base = len(self.P)
        rounds = max(1, round(2 * math.pi * radii[0] / BARK_TILE))
        along = 0.0
        for i, p in enumerate(pts):
            if i: along += (p - pts[i - 1]).length
            tan = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            nrm = (nrm - tan * nrm.dot(tan)).normalized()
            bin_ = tan.cross(nrm)
            first = None
            for s in range(sides + 1):
                th = 2 * math.pi * s / sides
                d = nrm * math.cos(th) + bin_ * math.sin(th)
                q = p + d * radii[i]
                # the seam's vertex takes the ring's first colour: drawing one more would shift every seeded choice after it
                c = first if s == sides else bark_colour(kind, q.y, height, rnd, th)
                if s == 0: first = c
                self.P.append(q); self.N.append(d); self.C.append(c)
                self.U.append((rounds * s / sides, -along / BARK_TILE))
        ring = sides + 1
        for i in range(len(pts) - 1):
            for s in range(sides):
                a0 = base + i * ring + s
                a1 = a0 + 1
                b0, b1 = a0 + ring, a1 + ring
                self.I += [a0, b0, a1, a1, b0, b1]

def polyline(start, direction, length, segs, curve, droop, rnd, wobble):
    pts, d, p = [start], direction.normalized(), start
    for i in range(segs):
        step = length / segs
        d = (d + UP * curve * step / max(length, 1e-3) * 2 - UP * droop * (i / segs) * step / max(length, 1e-3) * 2
             + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * wobble).normalized()
        p = p + d * step
        pts.append(p)
    return pts

VARIANTS = 3

def variant_params(key, variant):
    """The species' parameters for one variant: the first as written, the others turned by their own
    seed -- the crown's centre and base, its limbs' count and angles, the trunk's bow -- so no two
    neighbours of a species stand alike, each still fitted to the approved box (fitted())."""
    import copy
    S = copy.deepcopy(SPECIES[key])
    if variant == 0: return S
    j = random.Random(S['seed'] * 31 + variant * 7919)
    S['seed'] = S['seed'] + 101 * variant
    S['centre'] = (S['centre'][0] + S['half'][0] * j.uniform(-0.14, 0.14), S['centre'][1] + S['half'][1] * j.uniform(-0.14, 0.14))
    S['base'] = S['base'] * j.uniform(0.85, 1.15)
    L = S['limbs']
    L['count'] = tuple(max(6, round(c * j.uniform(0.85, 1.18))) for c in L['count'])
    d = j.uniform(-6, 6); L['rise'] = (L['rise'][0] + d, L['rise'][1] + d)
    S['trunk']['wobble'] = S['trunk']['wobble'] * j.uniform(0.6, 1.7)
    return S

def grow(key, tier, k=(1.0, 1.0), variant=0):
    """`k`: the box's correction (half-widths, heights) so the grown tree, cards and all, fills the
    approved box and the loader's fit stays near 1 on both axes (see fitted())."""
    S = variant_params(key, variant)
    hero = tier == 'hero'
    rnd = random.Random(S['seed'])
    H, B = S['height'] * k[1], S['base'] * k[1]
    cx, cz = S['centre']; hx, hz = S['half'][0] * k[0], S['half'][1] * k[0]
    T, L, W, Cd = S['trunk'], S['limbs'], S['twigs'], S['cards']
    wood = Wood()
    sides_t = T['sides'][0 if hero else 1]
    crown_centre = Vector((cx, B + (H - B) * 0.5, cz))

    # THE TRUNK: from the ground toward the crown's centre, a little bowed
    top_y = B + (H - B) * T['top']
    segs = 14 if hero else 7
    trunk_pts, trunk_r = [], []
    lean = Vector((cx, 0.0, cz)) * 0.85
    for i in range(segs + 1):
        t = i / segs
        y = -0.2 + (top_y + 0.2) * t
        bow = math.sin(math.pi * t) * T['wobble']
        p = Vector((lean.x * t + bow * math.cos(S['seed']), y, lean.z * t + bow * math.sin(S['seed'])))
        trunk_pts.append(p)
        flare = 1 + 0.6 * max(0.0, 1 - y / 0.9) ** 2
        trunk_r.append(T['r'] * (1 - 0.68 * t) * flare)
    rings = 1 if not hero or S['bark'] != 'birch' else 2   # a birch's lenticels need more rings
    if rings > 1:
        dense, dr = [], []
        for i in range(len(trunk_pts) - 1):
            for k in range(rings):
                dense.append(trunk_pts[i].lerp(trunk_pts[i + 1], k / rings)); dr.append(trunk_r[i] + (trunk_r[i + 1] - trunk_r[i]) * k / rings)
        dense.append(trunk_pts[-1]); dr.append(trunk_r[-1])
        trunk_pts, trunk_r = dense, dr
    wood.tube(trunk_pts, trunk_r, sides_t, S['bark'], H, rnd)

    def trunk_at(y):
        for i in range(len(trunk_pts) - 1):
            if trunk_pts[i + 1].y >= y:
                t = (y - trunk_pts[i].y) / max(trunk_pts[i + 1].y - trunk_pts[i].y, 1e-6)
                return trunk_pts[i].lerp(trunk_pts[i + 1], t), trunk_r[i] + (trunk_r[i + 1] - trunk_r[i]) * t
        return trunk_pts[-1], trunk_r[-1]

    # THE LIMBS: by the golden angle up the crown, each as long as the crown's envelope there reaches
    n_limbs = L['count'][0 if hero else 1]
    limbs = []
    golden = math.radians(137.508)
    az0 = rnd.uniform(0, 2 * math.pi)
    for i in range(n_limbs):
        f = L['start'] + (L['end'] - L['start']) * (i + rnd.uniform(0.1, 0.9)) / n_limbs
        y = B * 0.92 + (H - B * 0.92) * f if key not in ('gran', 'tall') else B + (H - B) * f
        root, r_here = trunk_at(min(y, top_y))
        # an oak's bole ends low and its great limbs (the fork) carry every other limb
        if T['fork'] and i >= T['fork'] and len(limbs) >= T['fork']:
            gpts, gradii, _ = limbs[rnd.randrange(T['fork'])]
            u = rnd.uniform(0.35, 0.95)
            seg = min(int(u * (len(gpts) - 1)), len(gpts) - 2)
            root = gpts[seg].lerp(gpts[seg + 1], u * (len(gpts) - 1) - seg)
            r_here = gradii[seg] * 1.4
            y = root.y
        t_crown = (y - B) / (H - B)
        az = az0 + i * golden + rnd.uniform(-0.25, 0.25)
        dirh = Vector((math.cos(az), 0.0, math.sin(az)))
        # reach to the crown's elliptical edge at this height, from the limb's own root
        er = envelope(S['shape'], t_crown)
        edge = Vector((cx + dirh.x * hx * er, y, cz + dirh.z * hz * er))
        span = Vector((edge.x - root.x, 0.0, edge.z - root.z))
        reach = max(0.6, span.dot(dirh)) * rnd.uniform(*L['reach'])
        rise = math.radians(rnd.uniform(*L['rise']))
        d = (dirh * math.cos(rise) + UP * math.sin(rise)).normalized()
        length = reach / max(0.3, math.cos(rise))
        if key == 'ek' and i < T['fork']:   # the oak's bole splits into its great limbs
            d = (dirh * 0.8 + UP * 0.6).normalized(); length = (H - y) * 0.75
        pts = polyline(root, d, length, 3, L['curve'], L['droop'], rnd, 0.08)
        # no limb reaches past the crown's top: its tip and the half card on it stay under H
        ceiling = H - Cd['size'] * 0.55
        if pts[-1].y > ceiling and pts[-1].y > root.y + 1e-3:
            f = max(0.2, (ceiling - root.y) / (pts[-1].y - root.y))
            pts = [root + (q - root) * f for q in pts]
            length *= f
        r0 = max(0.025, r_here * (0.62 if (T['fork'] and i < T['fork']) else L['r']))
        radii = [r0 * (1 - 0.8 * k / (len(pts) - 1)) for k in range(len(pts))]
        limbs.append((pts, radii, length))
        # a spruce's limbs are hidden in its sprays: three sides are enough, and the triangles go to the foliage
        sides = 3 if key == 'gran' else (6 if r0 > 0.14 else 5 if r0 > 0.09 else 4 if r0 > 0.045 else 3) if hero else (4 if r0 > 0.07 else 3)
        wood.tube(pts, radii, sides, S['bark'], H, rnd)

    # THE TWIGS AND THEIR CARDS: the twigs first, then the card budget spread over them
    twigs = []
    for li, (pts, radii, length) in enumerate(limbs):
        centroid = pts[-1].lerp(pts[len(pts) // 2], 0.35)
        n_twigs = max(2, int(length / W['spacing']))
        for k in range(n_twigs):
            s = 0.2 + 0.8 * (k + rnd.uniform(0, 0.8)) / n_twigs
            seg = min(int(s * (len(pts) - 1)), len(pts) - 2)
            u = s * (len(pts) - 1) - seg
            at = pts[seg].lerp(pts[seg + 1], u)
            ld = (pts[seg + 1] - pts[seg]).normalized()
            side = Vector((rnd.uniform(-1, 1), rnd.uniform(-0.4, 0.6), rnd.uniform(-1, 1)))
            side = (side - ld * side.dot(ld)).normalized()
            ang = math.radians(W['angle'] + rnd.uniform(-15, 15))
            td = (ld * math.cos(ang) + side * math.sin(ang) - UP * W['droop'] * 0.6).normalized()
            tl = rnd.uniform(*W['length']) * (1.15 - 0.5 * s)
            tw = polyline(at, td, tl, 2, 0.0, W['droop'], rnd, 0.12)
            r_t = max(0.008, radii[seg] * W['r'])
            # only the stoutest twigs are drawn as wood: the rest are the sprigs' own stems
            if hero and r_t > 0.02 and key != 'gran':
                wood.tube(tw, [r_t, r_t * 0.4, r_t * 0.15], 3, S['bark'], H, rnd)
            twigs.append((tw, centroid, li))
        twigs.append(([pts[-2], pts[-1]], centroid, li))

    # THE LEAF CLUSTERS (owner, 3 November: fuller, fluffier crowns). A crown is many puffs of leaves --
    # SpeedTree's and the Odyssey forest's leaf clusters -- each a few sprig cards seated round a centre at a
    # twig's or a limb's tip, facing out of the puff and out of the crown, so every puff shades as its own
    # soft ball and the sky shows between them. The spruce lays its sprays along each branch instead, flat
    # and hanging in curtains; the pine's puffs are flattened into pads.
    P_ = S['puff']
    clusters = []
    if key == 'gran':
        for li, (pts, radii, length) in enumerate(limbs):
            n_sp = max(3, int(length / P_['spacing']))
            for k in range(n_sp):
                # from the trunk itself out to the tip, so the stem is hidden as a spruce hides it
                u = 0.02 + 0.98 * (k + rnd.random()) / n_sp
                seg = min(int(u * (len(pts) - 1)), len(pts) - 2)
                at = pts[seg].lerp(pts[seg + 1], u * (len(pts) - 1) - seg)
                ld = (pts[seg + 1] - pts[seg]).normalized()
                clusters.append(('spray', at, ld, li))
    else:
        for (tw, centroid, li) in twigs:
            clusters.append(('puff', tw[-1], (tw[-1] - tw[0]).normalized(), li))
            if len(tw) > 2 and rnd.random() < P_['mid']:
                clusters.append(('puff', tw[1], (tw[-1] - tw[0]).normalized(), li))
    rnd.shuffle(clusters)
    hero_count, keep = Cd['count'][0], Cd['count'][0 if hero else 1]
    per = max(2, round(hero_count / max(1, len(clusters))))
    candidates = []
    for (kind, c, ld, li) in clusters:
        for j in range(per):
            if kind == 'spray':
                # along the branch, a little below it; every third a curtain hanging from it
                along = ld * rnd.uniform(-0.15, 0.15)
                p = c + along - UP * rnd.uniform(0.0, 0.2)
                candidates.append((kind, p, ld, c, li, j % 3 == 2))
            else:
                g = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
                radial = Vector(((c.x - cx) / hx, (c.y - crown_centre.y) / ((H - B) * 0.5), (c.z - cz) / hz))
                radial = radial.normalized() if radial.length > 1e-3 else UP
                d = (g + radial * P_['outward'] + UP * P_['up']).normalized()
                r = rnd.uniform(0.25, 1.0)
                p = c + Vector((d.x * P_['r'][0], d.y * P_['r'][1], d.z * P_['r'][0])) * r
                candidates.append((kind, p, d, c, li, False))
    # no card reaching the ground: the spruce's lowest sprays dragged on it as streaks
    candidates = [q for q in candidates if q[1].y > Cd['size'] * 0.75 + 0.3]
    candidates = candidates[:hero_count]
    chosen = candidates[:keep]
    # the full tier's fewer cards are larger, so the crown keeps its area
    # (the pine's full tier keeps the whole area: its pads must stay solid to agree with its impostor's shadow;
    # so does the birch's: with the modelled sprigs its lighter crown kept 0.66 of its shadow at a 2.25 m texel)
    grow_k = math.sqrt(len(candidates) / max(1, len(chosen))) * (1.0 if hero or key in ('tall', 'björk') else 0.92)
    crown = dict(P=[], N=[], U=[], I=[])
    for (kind, p, d, centre, li, curtain) in chosen:
        size = Cd['size'] * rnd.uniform(0.8, 1.2) * grow_k
        radial = Vector(((p.x - cx) / hx, (p.y - crown_centre.y) / ((H - B) * 0.5), (p.z - cz) / hz))
        radial = radial.normalized() if radial.length > 1e-3 else UP
        jitter = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        out = Vector((p.x - cx, 0.0, p.z - cz)); out = out.normalized() if out.length > 1e-3 else Vector((1.0, 0.0, 0.0))
        if kind == 'spray':
            if curtain:   # hanging from the branch, facing out
                face = (out + jitter * 0.25).normalized()
                want = -UP + d * 0.3
            else:         # laid along the branch, facing up and out
                face = (UP * 0.9 + out * 0.5 + jitter * 0.25).normalized()
                want = d
        else:
            face = (d * 0.7 + radial * 0.3 + jitter * 0.15).normalized()
            want = Vector((rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.3), rnd.uniform(-1, 1))) - UP * Cd['hang']
        up_dir = want - face * want.dot(face)
        if up_dir.length < 1e-3:
            up_dir = face.cross(Vector((rnd.uniform(-1, 1), 0.0, rnd.uniform(-1, 1))))
        up_dir = up_dir.normalized()
        roll = rnd.uniform(-0.6, 0.6) if kind == 'spray' else rnd.uniform(-1.0, 1.0)
        side_dir = face.cross(up_dir).normalized()
        up_dir = (up_dir * math.cos(roll) + side_dir * math.sin(roll)).normalized()
        right = up_dir.cross(face).normalized()
        cell = rnd.randrange(4); mirror = rnd.random() < 0.5
        u0, v0 = (cell % 2) * 0.5, (cell // 2) * 0.5
        # a broadleaf sprig and a pine's tufts are centred on their place; a spruce spray starts at its branch
        back = 0.08 if kind == 'spray' else 0.5
        o = p - up_dir * size * back
        corners = [(-0.5, 0.0), (0.5, 0.0), (0.5, 1.0), (-0.5, 1.0)]
        base = len(crown['P'])
        for (a, b) in corners:
            q = o + right * (a * size) + up_dir * (b * size)
            rq = Vector(((q.x - cx) / hx, (q.y - crown_centre.y) / ((H - B) * 0.5), (q.z - cz) / hz)).normalized()
            pq = (q - centre).normalized() if (q - centre).length > 1e-3 else rq
            soft = (rq * 0.45 + pq * 0.4 + face * 0.15).normalized()
            crown['P'].append(q); crown['N'].append(soft)
            uu = (0.5 - a) if mirror else (a + 0.5)
            # glTF uv: v from the image's top; the sprig's base is the cell's lower edge
            crown['U'].append((u0 + 0.5 * (0.02 + 0.96 * uu), v0 + 0.5 * (1.0 - (0.02 + 0.96 * b))))
        crown['I'] += [base, base + 1, base + 2, base, base + 2, base + 3]
    return dict(key=key, tier=tier, crown=crown, trunk=dict(P=wood.P, N=wood.N, C=wood.C, U=wood.U, I=wood.I),
                stats=dict(cards=len(chosen), candidates=len(candidates), clusters=len(clusters), crownTris=len(crown['I']) // 3, trunkTris=len(wood.I) // 3))

def fitted(key, tier, variant=0):
    """Grow until the tree's own box matches the approved one (the loader fits radius and height
    separately, so a crown whose cards overhang its box would be squashed and shrunk)."""
    S = SPECIES[key]
    k = [1.0, 1.0]
    for _ in range(4):
        tree = grow(key, tier, tuple(k), variant)
        P = tree['crown']['P'] + tree['trunk']['P']
        r = max(max(abs(p[0]) for p in P), max(abs(p[2]) for p in P))
        top = max(p[1] for p in P)
        target_r = max(abs(S['centre'][0]) + S['half'][0], abs(S['centre'][1]) + S['half'][1])
        k[0] = min(1.8, max(0.6, k[0] * target_r / r))
        k[1] = min(1.4, max(0.6, k[1] * S['height'] / top))
    tree['stats']['box'] = dict(radius=round(r, 2), top=round(top, 2), k=[round(v, 3) for v in k])
    return tree

def flat(vs, n):
    out = []
    for v in vs:
        for i in range(n): out.append(round(float(v[i]), 5))
    return out

def preview(scene, tree, offset, row=0.0):
    """Link the tree into the scene (Blender Z-up) for a look; nothing outside the scene is touched."""
    for part in ('trunk', 'crown'):
        d = tree[part]
        me = bpy.data.meshes.new(f"v2-{tree['key']}-{tree['tier']}-{int(row // 24)}-{part}")
        verts = [(p[0] + offset, -p[2] + row, p[1]) for p in d['P']]
        faces = [tuple(d['I'][i:i + 3]) for i in range(0, len(d['I']), 3)]
        me.from_pydata(verts, [], faces)
        me.update()
        ob = bpy.data.objects.new(me.name, me)
        scene.collection.objects.link(ob)

def build_catalogue(outdir, with_preview=True):
    os.makedirs(outdir, exist_ok=True)
    scene = None
    if bpy and with_preview:
        scene = bpy.data.scenes.get('BanvyTreesV2') or bpy.data.scenes.new('BanvyTreesV2')
        for ob in list(scene.collection.objects):
            if ob.name.startswith('v2-'):
                me = ob.data; bpy.data.objects.remove(ob)
                if me and me.users == 0: bpy.data.meshes.remove(me)
    report = {}
    for i, key in enumerate(SPECIES):
      for v in range(VARIANTS):
        for tier in TIERS:
            tree = fitted(key, tier, v)
            rec = dict(key=key, tier=tier, name=SPECIES[key]['name'],
                       crown=dict(position=flat(tree['crown']['P'], 3), normal=flat(tree['crown']['N'], 3), uv=flat(tree['crown']['U'], 2), index=tree['crown']['I']),
                       trunk=dict(position=flat(tree['trunk']['P'], 3), normal=flat(tree['trunk']['N'], 3), color=flat(tree['trunk']['C'], 3),
                                  uv=flat(tree['trunk']['U'], 2), index=tree['trunk']['I']))
            with open(os.path.join(outdir, f"{key}-{tier}-{v}.json"), 'w', encoding='utf-8') as f:
                json.dump(rec, f, ensure_ascii=False)
            report[f"{key}-{tier}-{v}"] = tree['stats']
            if scene is not None and tier == 'hero': preview(scene, tree, i * 24.0, v * 24.0)
    return report
