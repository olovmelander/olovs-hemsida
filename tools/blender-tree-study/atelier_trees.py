"""Initial tree study, rejected by the user for its rounded foliage treatment.

Execute build_atelier.py through the Blender MCP on localhost:9876.
The active direction is refine_pine.py: keep the existing silhouettes.
All geometry is opaque, vertex coloured and texture free. Layout is generated
once per seed; detail tiers sample the same branch paths and crown envelopes.
"""
import bpy, math, random
from mathutils import Vector

TAU = math.tau
UP = Vector((0, 0, 1))
PALETTE = {'gran': 0x426746, 'tall': 0x557746, 'björk': 0x83a550,
           'al': 0x537e52, 'ek': 0x6b8a43}
NAMES = {'gran': 'Norway spruce', 'tall': 'Scots pine', 'björk': 'Silver birch',
         'al': 'Grey alder', 'ek': 'Pasture oak'}
TIERS = {'hero': (12, 6, 8, 0), 'full': (8, 4, 5, 0), 'lite': (6, 3, 4, 0)}

def linear(hex_value):
    rgb = [(hex_value >> s & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb)

def clamp(x, lo=0., hi=1.):
    return max(lo, min(hi, x))

def direction(a):
    return Vector((math.cos(a), math.sin(a), 0))

def bezier(a, b, c, t):
    return a * (1 - t) ** 2 + b * (2 * t * (1 - t)) + c * t ** 2

class Mesh:
    def __init__(self):
        self.vertices, self.faces, self.colours, self.normals = [], [], [], []

    def vertex(self, p, col, normal=None):
        self.vertices.append(tuple(p))
        self.colours.append((*col, 1))
        self.normals.append(tuple(normal) if normal is not None else (0, 0, 0))
        return len(self.vertices) - 1

    def object(self, name, collection, material):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.vertices, [], self.faces)
        me.update()
        for p in me.polygons:
            p.use_smooth = True
        attr = me.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='POINT')
        for i, col in enumerate(self.colours):
            attr.data[i].color = col
        me.color_attributes.active_color = attr
        if name.startswith('crown'):
            # Local form remains visible; a modest convex bias unifies each
            # spray without shading the whole canopy like a smooth balloon.
            normals = [(Vector(n) * .62 + v.normal * .38).normalized()
                       for n, v in zip(self.normals, me.vertices)]
            me.normals_split_custom_set_from_vertices(normals)
        me.materials.append(material)
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob

def bark_colour(key, p, theta, seed):
    ridge = .90 + .10 * math.sin(theta * 9 + p.z * .8)
    if key == 'björk':
        col = linear(0xd8d5bf)
        # Broken horizontal lenticels, baked into the geometry's colour field.
        mark = math.sin(p.z * 15 + .7 * math.sin(theta * 3 + seed))
        cut = math.sin(theta * 5 + math.floor(p.z * 2.8) * 2.4)
        if mark > .52 and cut > -.05:
            col = linear(0x5b6254)
        if p.z < .6:
            col = linear(0x7e8061)
    elif key == 'tall':
        f = clamp((p.z - 4) / 6)
        low, high = linear(0x665642), linear(0xb3794f)
        col = tuple(a + (b - a) * f for a, b in zip(low, high))
    else:
        col = linear({'gran': 0x655742, 'al': 0x777968, 'ek': 0x796848}[key])
    return tuple(v * ridge for v in col)

def tube(mesh, path, radius, end_radius, key, seed, tier):
    sides = TIERS[tier][2]
    steps = (8 if radius > .12 else 4) if tier == 'hero' else (4 if tier == 'full' else 2)
    a, b, c = path
    rows = []
    for j in range(steps + 1):
        t = j / steps
        p = bezier(a, b, c, t)
        axis = (b - a).lerp(c - b, t).normalized()
        ref = Vector((0, 1, 0)) if abs(axis.z) > .9 else UP
        u = axis.cross(ref).normalized()
        v = axis.cross(u).normalized()
        rr = radius * (1 - t) ** 1.15 + end_radius * t
        if a.z < .03:
            rr *= 1 + .42 * math.exp(-t * 24)
        row = []
        for k in range(sides):
            theta = TAU * k / sides
            normal = u * math.cos(theta) + v * math.sin(theta)
            q = p + normal * rr * (1 + .055 * math.sin(theta * 5 + seed + t * 4))
            row.append(mesh.vertex(q, bark_colour(key, q, theta, seed)))
        rows.append(row)
    for arow, brow in zip(rows, rows[1:]):
        for k in range(sides):
            n = (k + 1) % sides
            mesh.faces.append((arow[k], arow[n], brow[n], brow[k]))
    mesh.faces.extend([tuple(reversed(rows[0])), tuple(rows[-1])])

def crown_colour(n, phase, p, tint=1):
    # Low-frequency pigment patches and cool undersides; no baked sun direction.
    patch = math.sin(p.x * 3.5 + phase) * math.sin(p.y * 3.1 - phase) * math.sin(p.z * 3.9 + phase)
    exposure = clamp(n.z * .65 + .5)
    value = (.63 + .33 * exposure + .10 * patch) * tint
    cool, warm = (.84, .97, 1.08), (1.08, 1.03, .77)
    return tuple(value * (a + (b - a) * exposure) for a, b in zip(cool, warm))

def spruce_spray(mesh, centre, scale, phase, tier, axis, tint):
    """Closed, feathered bough: a raised centre and alternating drooping tips.
    Broad needles are grouped as sprays, with real gaps between their tips.
    """
    length, width, depth = scale
    u, v = direction(axis), direction(axis + math.pi / 2)
    count = {'hero': 14, 'full': 10, 'lite': 6}[tier]
    rows = []
    for j in range(count + 1):
        t = j / count
        feather = 1.0 if j % 2 else .66
        envelope = max(.025, math.sin(math.pi * t) ** .72)
        w = width * envelope * feather
        spine = centre + u * length * (t * 2 - 1) + UP * (math.sin(t * math.pi) * depth * .28 - t * t * depth * 1.35)
        tip_offset = length * .07 * (j % 2)
        points = [spine - v * w + u * tip_offset - UP * depth * .18,
                  spine + UP * depth * envelope * .48,
                  spine + v * w + u * tip_offset - UP * depth * .18,
                  spine - UP * depth * envelope * .30]
        normals = [(-v + UP * .7).normalized(), UP, (v + UP * .7).normalized(), -UP]
        rows.append([mesh.vertex(p, crown_colour(n, phase, p, tint), n) for p, n in zip(points, normals)])
    for a, b in zip(rows, rows[1:]):
        for k in range(4):
            mesh.faces.append((a[k], b[k], b[(k + 1) % 4], a[(k + 1) % 4]))
    mesh.faces.extend([tuple(rows[0]), tuple(reversed(rows[-1]))])

def foliage(mesh, centre, scale, phase, tier, axis=0, kind='broad', tint=1):
    if kind == 'spruce':
        return spruce_spray(mesh, centre, scale, phase, tier, axis, tint)
    seg, rings, _, leaf_count = TIERS[tier]
    u, v = direction(axis), direction(axis + math.pi / 2)
    sx, sy, sz = scale
    def surface(n):
        az = math.atan2(n.y, n.x)
        # Continuous shape functions preserve silhouettes between tiers.
        lobes = 1 + .19 * math.sin(5 * az + phase) * (1 - n.z * n.z)
        lobes += .13 * math.sin(n.x * 8 + phase) * math.cos(n.y * 7 - phase) * math.cos(n.z * 6 + phase)
        p = u * (n.x * sx) + v * (n.y * sy) + UP * (n.z * sz)
        if kind == 'spire':
            p.x *= .65 - n.z * .45
            p.y *= .65 - n.z * .45
        # Retain small convex shapes, with an upward bias for painted lighting.
        normal = (u * (n.x * .85) + v * (n.y * .85) + UP * (n.z + .18)).normalized()
        return centre + p * lobes, normal
    bottom = mesh.vertex(*((lambda pn: (pn[0], crown_colour(pn[1], phase, pn[0], tint), pn[1]))(surface(-UP))))
    rows = []
    for j in range(1, rings):
        lat = -math.pi / 2 + math.pi * j / rings
        row = []
        for k in range(seg):
            az = TAU * k / seg
            n = Vector((math.cos(lat) * math.cos(az), math.cos(lat) * math.sin(az), math.sin(lat)))
            p, normal = surface(n)
            row.append(mesh.vertex(p, crown_colour(normal, phase, p, tint), normal))
        rows.append(row)
    p, normal = surface(UP)
    top = mesh.vertex(p, crown_colour(normal, phase, p, tint), normal)
    for k in range(seg):
        nxt = (k + 1) % seg
        mesh.faces.append((bottom, rows[0][nxt], rows[0][k]))
        mesh.faces.append((top, rows[-1][k], rows[-1][nxt]))
    for arow, brow in zip(rows, rows[1:]):
        for k in range(seg):
            nxt = (k + 1) % seg
            mesh.faces.append((arow[k], arow[nxt], brow[nxt], brow[k]))
    # Opaque folded leaf/spray strokes: real silhouette detail, no alpha shimmer.
    for i in range(leaf_count):
        az = phase + i * 2.39996
        z = -.25 + 1.14 * ((i * .61803398875 + phase * .13) % 1)
        n = Vector((math.sqrt(1 - z * z) * math.cos(az), math.sqrt(1 - z * z) * math.sin(az), z))
        p, normal = surface(n)
        cross = normal.cross(UP)
        if cross.length < .01:
            cross = Vector((1, 0, 0))
        cross.normalize()
        tangent = normal.cross(cross).normalized()
        length = min(sx, sy) * (.22 if kind == 'spruce' else .20)
        width = length * (.32 if kind == 'spruce' else .63)
        p += normal * length * .14
        coords = [p - tangent * length, p + cross * width, p + tangent * length, p - cross * width, p + normal * length * .20]
        ids = [mesh.vertex(q, crown_colour(normal, phase + i, q, tint * 1.10), normal) for q in coords]
        for k in range(4):
            mesh.faces.append((ids[k], ids[(k + 1) % 4], ids[4]))
        mesh.faces.append(tuple(reversed(ids[:4])))

def layout(key, seed):
    r = random.Random(seed)
    paths, masses = [], []
    H = {'gran': 15.2, 'tall': 16.4, 'björk': 13.7, 'al': 12.1, 'ek': 13.0}[key] * r.uniform(.93, 1.07)
    def branch(a, b, c, radius, end=.012):
        paths.append((tuple(a), tuple(b), tuple(c), radius, end))
    def mass(c, scale, axis=0, kind='broad', tint=1):
        masses.append((tuple(c), scale, r.uniform(0, TAU), axis, kind, tint))
    lean = direction(r.uniform(0, TAU)) * H * r.uniform(.015, .045)
    def stem(z):
        return lean * ((z / H) ** 1.35) + UP * z
    if key == 'gran':
        branch(Vector((0, 0, 0)), stem(H * .5), stem(H), .27, .025)
        for j in range(12):
            t = j / 12
            z = H * (.14 + .82 * t)
            span = H * .225 * (1 - t) ** .88
            phase = j * 2.39996 + seed
            for k in range(7):
                az = phase + k * TAU / 7 + r.uniform(-.15, .15)
                d = direction(az)
                start = stem(z + r.uniform(-.16, .16))
                length = span * r.uniform(.82, 1.15)
                tip = start + d * length - UP * length * .18
                elbow = start + d * length * .55 - UP * length * .26
                branch(start, elbow, tip, max(.025, .085 * (1 - t)), .008)
                mass(start + d * length * .52, (length * .59, length * .39, length * .34), az, 'spruce', .90 + .1 * t)
            # Irregular inner shoots connect the whorls and keep the leader
            # tapered instead of leaving a bare pole above the lower branches.
            mass(stem(z + H * .028), (span * .46, span * .43, H * .095), phase, 'spire', .93)
        mass(stem(H * .963), (H * .018, H * .018, H * .045), kind='spire', tint=1.03)
    elif key == 'tall':
        branch(Vector((0, 0, 0)), stem(H * .43) + Vector((.45, -.15, 0)), stem(H * .96), .34, .05)
        for j in range(14):
            t = j / 13
            z = H * (.53 + .38 * t)
            az = j * 2.39996 + seed * .1
            d = direction(az)
            span = H * (.23 - .13 * t) * r.uniform(.82, 1.15)
            a = stem(z)
            b = a + d * span * .42 - UP * H * .025
            end = a + d * span + UP * H * (.045 + .02 * t)
            branch(a, b, end, .10 * (1 - .65 * t), .018)
            for k in range(5):
                angle = az + (k - 2) * .63
                c = end + direction(angle) * span * r.uniform(.08, .38) + UP * r.uniform(-.12, .45)
                size = H * r.uniform(.040, .059) * (1 - .22 * t)
                branch(end - d * span * .22, end, c, .035, .009)
                mass(c, (size * 1.35, size * .98, size * .75), angle, 'pine', r.uniform(.94, 1.08))
        for j in range(4):
            az = j * 1.7 + seed
            mass(stem(H * .96) + direction(az) * H * .035, (H * .07, H * .065, H * .055), az, 'pine')
    else:
        birch, alder = key == 'björk', key == 'al'
        fork_h = H * (.43 if birch else .12 if alder else .27)
        radius = H * (.020 if birch else .023 if alder else .042)
        fork = stem(fork_h)
        branch(Vector((0, 0, 0)), stem(fork_h * .6), fork, radius, radius * .68)
        leaders = 3 if birch or alder else 5
        for j in range(leaders):
            az = j * TAU / leaders + seed * .2 + r.uniform(-.30, .30)
            d = direction(az)
            spread = H * (.11 if birch else .12 if alder else .24)
            start = fork if not alder else direction(az) * .22
            tip = stem(H * r.uniform(.86, .98)) + d * spread
            elbow = start.lerp(tip, .53) + d * spread * .25
            branch(start, elbow, tip, radius * .62, .022)
            for k in range(6):
                t = .22 + .74 * k / 5
                a = bezier(start, elbow, tip, t)
                angle = az + k * 2.4 + r.uniform(-.35, .35)
                reach = H * (.155 if birch else .125 if alder else .195) * (1 - .40 * t)
                end = a + direction(angle) * reach + UP * reach * .25
                bend = a.lerp(end, .6) + UP * reach * .22
                branch(a, bend, end, radius * .22, .008)
                for q in range(4):
                    side = direction(angle + (q - 1.5) * 1.1)
                    c = end + side * reach * r.uniform(.15, .45)
                    size = H * r.uniform(.038, .054) if birch else H * r.uniform(.046, .063) if alder else H * r.uniform(.060, .080)
                    if birch:
                        c -= UP * reach * (.15 + q * .14)
                        branch(end, c + UP * size, c - UP * size * .40, .015, .005)
                        # Tapered, cascading sprays made from smaller clusters,
                        # spread along the twig rather than fused into one ball.
                        for cascade in range(3):
                            f = cascade / 2
                            cc = c + side * size * (.60 * f) - UP * size * (1.45 * f)
                            rr = size * (.69 - .19 * f)
                            mass(cc, (rr, rr * .80, rr * .88), angle, tint=r.uniform(.92, 1.08))
                    else:
                        mass(c, (size, size * .86, size * .84), angle, tint=r.uniform(.92, 1.08))
            size = H * (.068 if birch else .082 if alder else .105)
            mass(tip, (size, size * .9, size * (1.2 if birch else .9)))
        if not birch:
            # Buttress roots connect the weight of a broad crown to the ground.
            for j in range(6):
                d = direction(j * TAU / 6 + seed)
                branch(d * radius * 3.2, d * radius * 1.4 + UP * .10, UP * .9,
                       radius * .24, radius * .30)
    return H, paths, masses

def material(name, colour, vertex=True):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*colour, 1)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*colour, 1)
    bs.inputs['Roughness'].default_value = .90
    bs.inputs['Specular IOR Level'].default_value = .12
    if vertex:
        attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Paint'
        mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1
        mix.inputs[2].default_value = (*colour, 1)
        nt.links.new(attr.outputs['Color'], mix.inputs[1])
        nt.links.new(mix.outputs[0], bs.inputs['Base Color'])
    return m

def build(key, seed, tier, collection, materials):
    H, paths, masses = layout(key, seed)
    crown, trunk = Mesh(), Mesh()
    for a, b, c, radius, end in paths:
        # The far tier omits sub-pixel twigs but keeps the principal skeleton.
        if radius < (.028 if tier == 'lite' else .016 if tier == 'full' else 0):
            continue
        tube(trunk, tuple(Vector(p) for p in (a, b, c)), radius, end, key, seed, tier)
    for c, scale, phase, axis, kind, tint in masses:
        foliage(crown, Vector(c), scale, phase, tier, axis, kind, tint)
    c = crown.object('crown', collection, materials[key])
    t = trunk.object('trunk', collection, materials['bark'])
    return c, t, H
