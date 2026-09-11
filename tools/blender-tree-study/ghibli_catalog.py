"""Ghibli tree catalogue: twelve Swedish species, four seeded variants each.
Every tree is a recipe (a parameter dict) plus a seed; the seed varies height,
crown width, trunk bow, lean, tier counts and clump sizes within the species'
own ranges, and an Object Info random shifts each tree's hue and value a
little in the shader. Renders one row per species to OUTDIR/catalog-<sp>.png.
Separate scene "GhibliStudy"; the user's scene is restored at the end."""
import bpy, bmesh, math, random, json, os
from mathutils import Vector, Matrix, noise

OUTDIR = r"__OUTDIR__"
SCENE = "GhibliStudy"
user_scene = bpy.data.scenes["Scene"]
if SCENE in bpy.data.scenes:
    sc = bpy.data.scenes[SCENE]
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)
else:
    sc = bpy.data.scenes.new(SCENE)
bpy.context.window.scene = sc
coll = sc.collection

def srgb(h):
    c = ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255)
    return tuple(x ** 2.2 for x in c)

# ------------------------------------------------------------ painterly toon material
def toon(name, deep, shadow, mid, light, dab, rim, dapple=0.16, dabs=True, vcol=True, vary=(0.02, 0.10), marks=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    N = lambda t: nt.nodes.new(t); L = nt.links.new
    out = N("ShaderNodeOutputMaterial")
    diff = N("ShaderNodeBsdfDiffuse"); s2r = N("ShaderNodeShaderToRGB"); L(diff.outputs[0], s2r.inputs[0])
    lum = N("ShaderNodeRGBToBW"); L(s2r.outputs[0], lum.inputs[0])
    tc = N("ShaderNodeTexCoord")
    nz = N("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 0.9; nz.inputs["Detail"].default_value = 3.0; nz.inputs["Roughness"].default_value = 0.6
    L(tc.outputs["Object"], nz.inputs["Vector"])
    sub = N("ShaderNodeMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = 0.5; L(nz.outputs["Fac"], sub.inputs[0])
    mul = N("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = dapple; L(sub.outputs[0], mul.inputs[0])
    add = N("ShaderNodeMath"); add.operation = "ADD"; L(lum.outputs[0], add.inputs[0]); L(mul.outputs[0], add.inputs[1])
    ramp = N("ShaderNodeValToRGB"); cr = ramp.color_ramp; cr.interpolation = "CONSTANT"
    cr.elements[0].position = 0.0; cr.elements[0].color = (*deep, 1)
    cr.elements[1].position = 0.10; cr.elements[1].color = (*shadow, 1)
    e = cr.elements.new(0.26); e.color = (*mid, 1)
    e = cr.elements.new(0.74); e.color = (*light, 1)
    L(add.outputs[0], ramp.inputs[0]); col = ramp.outputs[0]
    if dabs:
        # sun dabs: large sparse blobs, only on lit, upward-facing leaf tops
        nz2 = N("ShaderNodeTexNoise"); nz2.inputs["Scale"].default_value = 1.5; nz2.inputs["Detail"].default_value = 1.5
        L(tc.outputs["Object"], nz2.inputs["Vector"])
        th = N("ShaderNodeMath"); th.operation = "GREATER_THAN"; th.inputs[1].default_value = 0.66; L(nz2.outputs["Fac"], th.inputs[0])
        lit = N("ShaderNodeMath"); lit.operation = "GREATER_THAN"; lit.inputs[1].default_value = 0.72; L(add.outputs[0], lit.inputs[0])
        geo = N("ShaderNodeNewGeometry"); sxyz = N("ShaderNodeSeparateXYZ"); L(geo.outputs["Normal"], sxyz.inputs[0])
        up = N("ShaderNodeMath"); up.operation = "GREATER_THAN"; up.inputs[1].default_value = 0.35; L(sxyz.outputs["Z"], up.inputs[0])
        a1 = N("ShaderNodeMath"); a1.operation = "MULTIPLY"; L(th.outputs[0], a1.inputs[0]); L(lit.outputs[0], a1.inputs[1])
        a2 = N("ShaderNodeMath"); a2.operation = "MULTIPLY"; L(a1.outputs[0], a2.inputs[0]); L(up.outputs[0], a2.inputs[1])
        mixd = N("ShaderNodeMix"); mixd.data_type = "RGBA"; mixd.inputs[7].default_value = (*dab, 1)
        L(a2.outputs[0], mixd.inputs[0]); L(col, mixd.inputs[6]); col = mixd.outputs[2]
    lw = N("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.35
    rimt = N("ShaderNodeMath"); rimt.operation = "GREATER_THAN"; rimt.inputs[1].default_value = 0.84; L(lw.outputs["Facing"], rimt.inputs[0])
    dark = N("ShaderNodeMath"); dark.operation = "LESS_THAN"; dark.inputs[1].default_value = 0.30; L(add.outputs[0], dark.inputs[0])
    rimm = N("ShaderNodeMath"); rimm.operation = "MULTIPLY"; L(rimt.outputs[0], rimm.inputs[0]); L(dark.outputs[0], rimm.inputs[1])
    mixr = N("ShaderNodeMix"); mixr.data_type = "RGBA"; mixr.inputs[7].default_value = (*rim, 1)
    L(rimm.outputs[0], mixr.inputs[0]); L(col, mixr.inputs[6]); col = mixr.outputs[2]
    if vcol:
        va = N("ShaderNodeVertexColor"); va.layer_name = "Depth"
        mixv = N("ShaderNodeMix"); mixv.data_type = "RGBA"; mixv.blend_type = "MULTIPLY"; mixv.inputs[0].default_value = 1.0
        L(col, mixv.inputs[6]); L(va.outputs["Color"], mixv.inputs[7]); col = mixv.outputs[2]
    if marks:
        mscale, mth, mdark = marks
        nm = N("ShaderNodeTexNoise"); nm.inputs["Scale"].default_value = mscale; nm.inputs["Detail"].default_value = 1.0
        L(tc.outputs["Object"], nm.inputs["Vector"])
        mt = N("ShaderNodeMath"); mt.operation = "GREATER_THAN"; mt.inputs[1].default_value = mth; L(nm.outputs["Fac"], mt.inputs[0])
        mm = N("ShaderNodeMath"); mm.operation = "MULTIPLY"; mm.inputs[1].default_value = -(1 - mdark); L(mt.outputs[0], mm.inputs[0])
        mo = N("ShaderNodeMath"); mo.operation = "ADD"; mo.inputs[1].default_value = 1.0; L(mm.outputs[0], mo.inputs[0])
        mx = N("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"; mx.inputs[0].default_value = 1.0
        L(col, mx.inputs[6]); L(mo.outputs[0], mx.inputs[7]); col = mx.outputs[2]
    # per-object variation: hue and value nudged by the object's random
    oi = N("ShaderNodeObjectInfo")
    hs = N("ShaderNodeHueSaturation")
    hmap = N("ShaderNodeMapRange"); hmap.inputs[3].default_value = 0.5 - vary[0]; hmap.inputs[4].default_value = 0.5 + vary[0]
    vmap = N("ShaderNodeMapRange"); vmap.inputs[3].default_value = 1 - vary[1]; vmap.inputs[4].default_value = 1 + vary[1]
    L(oi.outputs["Random"], hmap.inputs[0]); L(oi.outputs["Random"], vmap.inputs[0])
    L(hmap.outputs[0], hs.inputs["Hue"]); L(vmap.outputs[0], hs.inputs["Value"]); L(col, hs.inputs["Color"])
    emit = N("ShaderNodeEmission"); L(hs.outputs[0], emit.inputs[0]); L(emit.outputs[0], out.inputs[0])
    m.diffuse_color = (*mid, 1)
    return m

def leafmat(name, deep, shadow, mid, light, dab=None):
    return toon(name, srgb(deep), srgb(shadow), srgb(mid), srgb(light), srgb(dab or light) if dab else srgb(light), srgb(0x9fd8e8))

M = {
    "oak":    leafmat("c-oak",    0x144230, 0x1f7238, 0x3fae32, 0x7ad83e, 0xa8ec56),
    "maple":  leafmat("c-maple",  0x164630, 0x28783a, 0x54b832, 0x92dc40, 0xbcec5a),
    "linden": leafmat("c-linden", 0x184a34, 0x2c8040, 0x5cbe38, 0x9ce048, 0xc4ee62),
    "ash":    leafmat("c-ash",    0x174a38, 0x287846, 0x4cb23a, 0x88d648, 0xb4ea60),
    "birch":  leafmat("c-birch",  0x1e5a30, 0x2e8c36, 0x62bc3a, 0x9cdc48, 0xc6ee62),
    "aspen":  leafmat("c-aspen",  0x1e5236, 0x308a40, 0x64c040, 0x9ee04c, 0xc8f066),
    "alder":  leafmat("c-alder",  0x103e2c, 0x1c6236, 0x329a30, 0x62c444, 0x8cdc58),
    "willow": leafmat("c-willow", 0x1c5040, 0x2f8252, 0x5cb452, 0x96d868, 0xbcea80),
    "pine":   leafmat("c-pine",   0x0f3e38, 0x1c6846, 0x349c3c, 0x6cca4a, 0x98dc62),
    "spruce": leafmat("c-spruce", 0x0c3634, 0x185a40, 0x288a40, 0x58bc50, 0x84d264),
    "juniper":leafmat("c-juniper",0x0c3232, 0x18544a, 0x2a7e5a, 0x50a86a, 0x78c480),
    "bark":   toon("c-bark", srgb(0x1c110c), srgb(0x3a2418), srgb(0x6a4630), srgb(0x9a7150), srgb(0xb08a63), srgb(0x8fb9c8), dapple=0.10, dabs=False, vcol=False, vary=(0.02, 0.12)),
    "pinebark": toon("c-pinebark", srgb(0x2a150c), srgb(0x5a3020), srgb(0x9a5a34), srgb(0xd08a52), srgb(0xe0a068), srgb(0x8fb9c8), dapple=0.10, dabs=False, vcol=False, vary=(0.02, 0.12)),
    "birchbark": toon("c-birchbark", srgb(0x4a4a44), srgb(0x8c8a80), srgb(0xd8d5c4), srgb(0xf3f1e4), srgb(0xffffff), srgb(0xcfe8f0), dapple=0.10, dabs=False, vcol=False, vary=(0.0, 0.06), marks=(9.0, 0.70, 0.22)),
    "greybark": toon("c-greybark", srgb(0x3a3f38), srgb(0x6a6f62), srgb(0x9aa08e), srgb(0xc4c8b4), srgb(0xd8dcc8), srgb(0xcfe8f0), dapple=0.10, dabs=False, vcol=False, vary=(0.02, 0.1)),
    "berry":  toon("c-berry", srgb(0x7a1a10), srgb(0xb8301a), srgb(0xe85a2a), srgb(0xff8a4a), srgb(0xffb070), srgb(0xffd0a0), dapple=0.0, dabs=False, vcol=False, vary=(0.0, 0.1)),
    "ground": toon("c-ground", srgb(0x1c5a2c), srgb(0x2f8c30), srgb(0x4fba30), srgb(0x80da3e), srgb(0xa8ec58), srgb(0xa8dcd0), dapple=0.22, dabs=False, vcol=False, vary=(0, 0)),
}

# Detail tiers. hero: everything. full: clumps one subdivision lower, twigs kept.
# decimated: small clumps dropped and the rest thinned, only trunks and limbs kept.
LOD_TIERS = {
    # keepEvery: of clumps smaller than thinBelow, keep one in N; grow: scale the survivors so the crown stays closed
    "hero":      dict(sub=2, minTube=0.0,  minClump=0.0,  thinBelow=0.0, keepEvery=1, grow=1.0,  segs=1.0, inner=True,  whorlStep=1, coneSegs=24),
    "full":      dict(sub=1, minTube=0.07, minClump=0.0,  thinBelow=0.0, keepEvery=1, grow=1.15, segs=0.7, inner=False, whorlStep=1, boughs=0.7, tipTube=False, coneSegs=12),
    "decimated": dict(sub=1, minTube=0.16, minClump=0.35, thinBelow=1.6, keepEvery=2, grow=1.35, segs=0.5, inner=False, whorlStep=2, coneSegs=8),
    "lite":      dict(sub=1, minTube=0.22, minClump=0.35, thinBelow=3.0, keepEvery=3, grow=1.8,  segs=0.5, inner=False, whorlStep=3, coneSegs=6),
}
LOD = LOD_TIERS["hero"]
_lodcount = [0]
def lod_keep(size):
    """whether a clump of this size survives the current tier"""
    if size < LOD["minClump"]: return False
    if size < LOD["thinBelow"]:
        _lodcount[0] += 1
        return (_lodcount[0] % LOD["keepEvery"]) == 0
    return True

def new_obj(name, bm, material, at, smooth=True):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(material)
    for p in me.polygons: p.use_smooth = smooth
    o = bpy.data.objects.new(name, me); o.location = at; coll.objects.link(o)
    return o

def finish_crown(o, centres, blend, depth_centre, depth_r):
    me = o.data; normals = []
    for v in me.vertices:
        c = min(centres, key=lambda c: (v.co - c).length_squared)
        d = (v.co - c); d.normalize()
        n = (v.normal * (1 - blend) + d * blend); n.normalize(); normals.append(n)
    me.normals_split_custom_set_from_vertices(normals)
    ca = me.color_attributes.new(name="Depth", type="FLOAT_COLOR", domain="POINT")
    WARM = (1.10, 1.04, 0.80); COOL = (0.82, 0.92, 1.12)   # sunlit leaf tops / shaded undersides, as multipliers on the species green
    for i, v in enumerate(me.vertices):
        p = v.co - depth_centre
        r = math.sqrt((p.x / depth_r[0]) ** 2 + (p.y / depth_r[1]) ** 2 + (p.z / depth_r[2]) ** 2)
        k = 0.50 + 0.50 * min(1.0, r) ** 1.4                                    # deep inside darker
        hf = min(1.0, max(0.0, (p.z / depth_r[2] + 1) * 0.5))                    # low in the crown darker and cooler
        k *= 0.78 + 0.22 * hf
        n = normals[i]
        e = min(1.0, max(0.0, n.z * 0.5 + 0.5)) * 0.6 + hf * 0.4                  # exposure: facing up and high = warm
        col = tuple(COOL[j] + (WARM[j] - COOL[j]) * e for j in range(3))
        ca.data[i].color = (k * col[0], k * col[1], k * col[2], 1.0)

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)

def tube(bm, p0, p1, r0, r1, segs=8):
    d = p1 - p0
    if d.length < 1e-6 or r0 < LOD["minTube"]: return
    segs = max(3, int(round(segs * LOD["segs"])))
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=segs, radius1=r0, radius2=r1,
                          depth=d.length, matrix=Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4())

def clump(bm, c, rx, ry, rz, seed, sub=2, amp=0.10, undercut=0.7):
    if not lod_keep(max(rx, ry, rz)): return
    g = LOD["grow"]; rx, ry, rz = rx * g, ry * g, rz * g
    sub = max(1, min(sub, LOD["sub"]))
    res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0, matrix=Matrix.Translation(c))
    for v in res["verts"]:
        p = v.co - c
        s = 1 + amp * noise.noise(p * 1.6 + Vector((seed * 0.37, seed * 0.11, seed * 0.53)))
        s += 0.11 * noise.noise(p * 3.4 + Vector((seed * 0.7, 0, seed * 0.2)))   # leafy scallops on the rim
        zz = p.z * rz * s * (1.0 if p.z > 0 else undercut)
        v.co = c + Vector((p.x * rx * s, p.y * ry * s, zz))

def curved_trunk(bm, base, top, r0, r1, bow=0.6, segs=8, n=5, rnd=None, flare=True):
    a = rnd.uniform(0, 6.28)
    side = Vector((math.cos(a), math.sin(a), 0))
    pts = [base.lerp(top, i / n) + side * (bow * math.sin(i / n * math.pi)) for i in range(n + 1)]
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        tube(bm, pts[i], pts[i + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, segs)
    if flare:
        tube(bm, base - Vector((0, 0, 0.05)), base + Vector((0, 0, 0.9)), r0 * 1.7, r0 * 1.0, segs)
    return pts

def U(rnd, lo, hi): return rnd.uniform(lo, hi)

# ------------------------------------------------------------ generic broadleaf recipe
def broadleaf(at, seed, P):
    """P: height range, fork (fraction of height), limbs, crown rx/rz (fraction of height),
    tiers (list of (zoff, R, n, r) in crown units), stems, bark, leaf, undercut, blend, berries."""
    rnd = random.Random(seed)
    H = U(rnd, *P["height"]); fork = H * U(rnd, *P["fork"])
    lean = math.radians(U(rnd, 0, P.get("lean", 6)))
    la = U(rnd, 0, 6.28)
    bmt = bmesh.new(); bmc = bmesh.new(); centres = []
    r0 = H * P.get("trunk", 0.036); r1 = r0 * 0.5
    stems = P.get("stems", 1)
    crown_tops = []
    if stems == 1:
        top = Vector((math.sin(lean) * math.cos(la) * fork, math.sin(lean) * math.sin(la) * fork, math.cos(lean) * fork))
        pts = curved_trunk(bmt, Vector((0, 0, 0)), top, r0, r1, bow=H * U(rnd, *P.get("bow", (0.02, 0.07))), rnd=rnd)
        nl = P.get("limbs", 3)
        for i in range(nl):
            az = i * 6.283 / nl + U(rnd, -0.4, 0.4)
            reach = H * U(rnd, *P.get("limb", (0.10, 0.18)))
            tip = pts[-1] + Vector((math.cos(az) * reach, math.sin(az) * reach, reach * U(rnd, 0.7, 1.3)))
            tube(bmt, pts[-1], tip, r1 * 0.9, r1 * 0.3, 6)
            crown_tops.append(tip)
        Cc = pts[-1] + Vector((0, 0, H * P["crown_z"]))
    else:
        base = Vector((0, 0, 0)); Cc = Vector((0, 0, fork + H * P["crown_z"]))
        reach = Cc.z + H * 0.04
        for s_i in range(stems):
            az = s_i * 6.283 / stems + U(rnd, -0.3, 0.3); sl = math.radians(U(rnd, 6, 16))
            top = Vector((math.sin(sl) * math.cos(az) * reach, math.sin(sl) * math.sin(az) * reach, math.cos(sl) * reach))
            curved_trunk(bmt, base, top, r0 * 0.75, r1 * 0.6, bow=H * 0.02, n=3, rnd=rnd, flare=(s_i == 0))
            crown_tops.append(top)
    Cc = Cc + Vector((math.cos(la) * H * 0.025, math.sin(la) * H * 0.025, 0))
    rx = H * U(rnd, *P["crown_rx"]); rz = H * U(rnd, *P["crown_rz"])
    for tier, (zoff, R, n, r) in enumerate(P["tiers"]):
        n = max(1, int(round(n * U(rnd, 0.8, 1.2))))
        for j in range(n):
            az = j / n * 6.283 + tier * 0.7 + U(rnd, -0.25, 0.25)
            c = Cc + Vector((math.cos(az) * R * rx * U(rnd, 0.85, 1.05), math.sin(az) * R * rx * U(rnd, 0.85, 1.05), zoff * rz + U(rnd, -0.08, 0.08) * rz))
            rr = r * rx * U(rnd, 0.85, 1.15)
            clump(bmc, c, rr, rr, rr * P.get("clump_z", 0.85), seed * 7 + tier * 13 + j, sub=2, amp=P.get("amp", 0.10), undercut=P.get("undercut", 0.7))
            centres.append(c)
    anchors = crown_tops if crown_tops else [Vector((0, 0, fork))]
    for c in centres:
        src = min(anchors, key=lambda a_: (a_ - c).length_squared)
        tube(bmt, src, c, H * 0.010, H * 0.004, 4)
    if P.get("core", 0):
        clump(bmc, Cc, rx * P["core"], rx * P["core"], rz * P["core"] * 0.9, seed, sub=3, amp=0.05)
    if P.get("berries"):
        bmb = bmesh.new()
        for k in range(int(P["berries"] * U(rnd, 0.7, 1.3))):
            c = rnd.choice(centres); d = (c - Cc); d.z += rx * 0.6; d.normalize(); c = c + d * rx * 0.42 + Vector((U(rnd, -1, 1), U(rnd, -1, 1), 0)) * rx * 0.15
            bmesh.ops.create_icosphere(bmb, subdivisions=1, radius=rx * 0.09, matrix=Matrix.Translation(c))
        new_obj("berries", bmb, M["berry"], at)
    crown = new_obj("crown", bmc, M[P["leaf"]], at)
    finish_crown(crown, centres, P.get("blend", 0.5), Cc, (rx * 1.35, rx * 1.35, rz * 1.3))
    trunk = new_obj("trunk", bmt, M[P["bark"]], at)
    return crown, trunk, H

def pine(at, seed, P):
    """Scots pine (tall): a tall trunk, grey-brown below and orange above, bowed
    twice; a crown of branches in the top third that reach out, dip, and curve
    up at the tip, each forking into twigs that end in tufts, so every bit of
    foliage sits on wood and the tufts overlap into rounded pads; a flat-topped
    crown on a mature tree, a leader on a young one."""
    rnd = random.Random(seed)
    H = U(rnd, *P["height"]); lean = math.radians(U(rnd, 0, 6)); la = U(rnd, 0, 6.28)
    young = H < 15.5
    bmt = bmesh.new(); bmo = bmesh.new(); bmc = bmesh.new(); centres = []
    # trunk: lower part grey-brown, upper part orange, one polyline for both
    a = U(rnd, 0, 6.28); side = Vector((math.cos(a), math.sin(a), 0))
    top = Vector((math.sin(lean) * math.cos(la) * H, math.sin(lean) * math.sin(la) * H, math.cos(lean) * H))
    n = 7; pts = []
    bow = H * U(rnd, 0.03, 0.07)
    for i in range(n + 1):
        t = i / n
        pts.append(top * t * 0.97 + side * (bow * math.sin(t * math.pi) + bow * 0.4 * math.sin(t * 2.3 * math.pi)))
    r0, r1 = H * 0.032, H * 0.006
    split = 0.42
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        target = bmt if t0 < split else bmo
        tube(target, pts[i], pts[i + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, 8)
    tube(bmt, Vector((0, 0, -0.05)), Vector((0, 0, 0.9)), r0 * 1.7, r0, 8)
    def axis(z):
        f = z / (H * 0.97) * n; i = min(n - 1, int(f)); return pts[i].lerp(pts[i + 1], f - i)
    # branches in the top third; the lowest one or two are the big character limbs
    crown_from = U(rnd, *P["crown_from"])
    nb = int(round(U(rnd, 9, 12)))
    pad_centres = []
    for i in range(nb):
        t = i / (nb - 1)
        z = H * (crown_from + (0.93 - crown_from) * t ** 1.15)
        az = i * 2.4 + U(rnd, -0.5, 0.5)
        L = H * (0.30 - 0.20 * t) * U(rnd, 0.8, 1.25)
        if i == 0: L *= 1.25                                    # one long low limb
        base = axis(z)
        e0 = math.radians(U(rnd, 8, 22) - 14 * (1 - t))         # reaches out, dips low, ...
        e1 = math.radians(U(rnd, 25, 45))                       # ... then curves up at the tip
        mid = base + Vector((math.cos(az) * math.cos(e0) * L * 0.55, math.sin(az) * math.cos(e0) * L * 0.55, math.sin(e0) * L * 0.55))
        tip = mid + Vector((math.cos(az) * math.cos(e1) * L * 0.45, math.sin(az) * math.cos(e1) * L * 0.45, math.sin(e1) * L * 0.45))
        rb = H * 0.009 - H * 0.004 * t
        tube(bmo, base, mid, rb, rb * 0.6, 6); tube(bmo, mid, tip, rb * 0.6, rb * 0.3, 5)
        # twigs off the outer half, each ending in a tuft; the tufts overlap into a pad
        ntw = 4 if L > H * 0.1 else 3
        tufts = []
        for k in range(ntw + 1):
            if k == ntw:
                tw_end = tip                                       # the branch's own tip carries a tuft
            else:
                f = 0.55 + 0.4 * k / max(1, ntw - 1)
                b = mid.lerp(tip, (f - 0.55) / 0.45) if f > 0.55 else mid
                taz = az + U(rnd, -1.1, 1.1); tl = L * U(rnd, 0.14, 0.26)
                tw_end = b + Vector((math.cos(taz) * tl, math.sin(taz) * tl, tl * U(rnd, 0.35, 0.8)))
                tube(bmo, b, tw_end, rb * 0.35, rb * 0.15, 4)
            r = L * U(rnd, 0.3, 0.42)
            c = tw_end + Vector((0, 0, r * 0.2))                  # the tuft grows up from the twig end
            clump(bmc, c, r * 1.15, r * 1.15, r * 0.7, seed * 31 + i * 9 + k, sub=2, amp=0.12, undercut=0.5)
            tufts.append(c)
        pc = sum(tufts, Vector()) / len(tufts); pad_centres.append(pc); centres.extend(tufts)
        clump(bmc, pc - Vector((0, 0, L * 0.02)), L * 0.42, L * 0.38, L * 0.14, seed * 41 + i, sub=2, amp=0.1, undercut=0.4)   # the pad the tufts stand on
    # the top: a flat rounded crown of short up-curving twigs on a mature tree, a leader on a young one
    tp = axis(H * 0.955)
    if young:
        tube(bmo, tp, tp + Vector((0, 0, H * 0.05)), H * 0.004, H * 0.001, 4)
        clump(bmc, tp + Vector((0, 0, H * 0.035)), H * 0.035, H * 0.035, H * 0.045, seed * 3, sub=2, amp=0.1, undercut=0.7)
        centres.append(tp + Vector((0, 0, H * 0.035)))
    else:
        for k in range(7):
            taz = k * 0.9 + U(rnd, -0.3, 0.3); tl = H * U(rnd, 0.05, 0.10)
            e = tp + Vector((math.cos(taz) * tl, math.sin(taz) * tl, tl * 0.6))
            tube(bmo, tp, e, H * 0.004, H * 0.0015, 4)
            r = H * U(rnd, 0.05, 0.07)
            clump(bmc, e + Vector((0, 0, r * 0.2)), r * 1.2, r * 1.2, r * 0.6, seed * 17 + k, sub=2, amp=0.12, undercut=0.5)
            centres.append(e)
    crown = new_obj("crown", bmc, M["pine"], at, smooth=True)
    # normals bend toward each branch's own pad centre so a pad shades as one mass with tuft edges
    finish_crown(crown, pad_centres + [tp], 0.55, axis(H * 0.8), (H * 0.32, H * 0.32, H * 0.22))
    new_obj("trunk-low", bmt, M["bark"], at, smooth=True)
    trunk = new_obj("trunk", bmo, M["pinebark"], at, smooth=True)
    return crown, trunk, H

def bough(bm, base, tip, along, across, thick, seed, undercut=0.55, hang=0.28, sub=1):
    """A spruce bough's foliage: a flattened ellipsoid lying along the branch from
    base to tip, wider than thick, its outer half hanging down and its underside
    cut flat, so the whorl reads as a layered fan and not a ball on a stick."""
    d = tip - base; d.z = 0
    if d.length < 1e-6: d = Vector((1, 0, 0))
    d.normalize(); side = Vector((-d.y, d.x, 0)); up = Vector((0, 0, 1))
    c = base.lerp(tip, 0.55)
    if not lod_keep(max(along, across)): return
    g = LOD["grow"]; along, across, thick = along * g, across * g, thick * g
    sub = max(1, min(sub, LOD["sub"]))
    res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0, matrix=Matrix.Translation(c))
    for v in res["verts"]:
        p = v.co - c
        s = 1 + 0.16 * noise.noise(p * 2.2 + Vector((seed * 0.37, seed * 0.11, seed * 0.53)))
        z = p.z * thick * s * (1.0 if p.z > 0 else undercut)
        z -= max(0.0, p.x) * along * hang            # the outer half hangs
        v.co = c + d * (p.x * along * s) + side * (p.y * across * s) + up * z

def bell_cone(bm, base, r, hh, segs, lobes=6, phase=0.0, rings=3, fringe=False):
    """A spruce tier: a cone whose profile bellies out and droops at the rim
    (a bough hangs), with a lobed rim where the branch tips sit lower between
    the lobes. Apex at base.z + hh/2, rim just below base.z - hh/2, where the
    plain cone had them. Built as a lathe of 'rings' rings plus the apex."""
    apex = bm.verts.new((base.x, base.y, base.z + hh * 0.5))
    ringverts = []
    for ri in range(1, rings + 1):
        f = ri / rings                                   # 0 apex .. 1 rim
        prof = f ** 1.35                                 # bellied: narrow high up, flaring at the rim
        row = []
        for j in range(segs):
            a = j / segs * 6.283185
            lobe = 0.5 + 0.5 * math.cos(lobes * a + phase)
            rr = r * prof * (1 + 0.10 * (lobe - 0.5) * f)
            droop = hh * (0.14 * f * f) * (0.6 + 0.4 * (1 - lobe))   # the rim hangs, most between the lobes
            if ri == rings and fringe:                                   # needle fringe: every other rim vertex a tip
                tip = (j % 2 == 1)
                rr *= 1.0 if tip else 0.93
                droop += hh * 0.07 if tip else 0.0
            row.append(bm.verts.new((base.x + math.cos(a) * rr, base.y + math.sin(a) * rr, base.z + hh * 0.5 - hh * f - droop)))
        ringverts.append(row)
    for j in range(segs):
        bm.faces.new([apex, ringverts[0][j], ringverts[0][(j + 1) % segs]])
    for ri in range(rings - 1):
        a_, b_ = ringverts[ri], ringverts[ri + 1]
        for j in range(segs):
            bm.faces.new([a_[j], b_[j], b_[(j + 1) % segs], a_[(j + 1) % segs]])
    # the underside, so the tier is closed from below
    centre = bm.verts.new((base.x, base.y, base.z - hh * 0.5 - hh * 0.02))
    rim = ringverts[-1]
    for j in range(segs):
        bm.faces.new([centre, rim[(j + 1) % segs], rim[j]])

def spruce(at, seed, P):
    """The original engine spruce, authored: a stack of drooping cones on a
    short trunk, grown by the same kind of seeded noise (skirts ragged, tiers
    not parallel), flat-shaded on purpose -- the owner prefers this silhouette.
    Per variant: cone count, spread, tier spacing, a slight lean."""
    rnd = random.Random(seed)
    H = U(rnd, *P["height"]); k = H / 14.0            # the recipe is written at 14 m
    nc = int(round(U(rnd, 6, 8)))
    spread = U(rnd, 0.9, 1.15); lean = math.radians(U(rnd, 0, 3)); la = U(rnd, 0, 6.28)
    top_y = 2.6 + 9.6 + 1.8
    bmc = bmesh.new()
    for i in range(nc):
        if i % LOD["whorlStep"] and i != nc - 1: continue
        t = i / (nc - 1)
        r = (3.5 * (1 - t * 0.8) + 0.45) * spread * k
        hh = 3.6 * (1 - t * 0.35) * k * (7 / nc) ** 0.5
        y = (2.6 + t * 9.6) * k
        segs = LOD.get("coneSegs", 12)     # the original: 24 at hero, 12 full, 6 decimated
        cx, cz = math.sin(lean) * math.cos(la) * y, math.sin(lean) * math.sin(la) * y
        cx += U(rnd, -0.12, 0.12) * k; cz += U(rnd, -0.12, 0.12) * k      # each tier a little off-axis
        fine = LOD["coneSegs"] >= 12
        bell_cone(bmc, Vector((cx, cz, y)), r, hh, segs, lobes=int(round(U(rnd, 5, 8))), phase=U(rnd, 0, 6.28), rings=(3 if fine else 2), fringe=fine)
        if fine and i < nc - 1:
            # the under-layer: a smaller darker tier hanging half a step below, so the stack has depth
            bell_cone(bmc, Vector((cx + U(rnd, -0.2, 0.2) * k, cz + U(rnd, -0.2, 0.2) * k, y - hh * 0.32)), r * 0.72, hh * 0.7, max(8, segs // 2),
                      lobes=int(round(U(rnd, 4, 6))), phase=U(rnd, 0, 6.28), rings=2, fringe=False)
    # grown, as grownCrown() does it: a seeded noise pushes every vertex radially and vertically
    amp = 0.15
    for v in bmc.verts:
        p = v.co
        rr = math.hypot(p.x, p.y)
        n = noise.noise(Vector((p.x * 1.6 / k + seed * 0.7, p.y * 1.6 / k - p.z * 0.7 / k + seed * 0.3, seed * 0.11)))
        if rr > 0.05:
            f = 1 + n * amp
            v.co = Vector((p.x * f, p.y * f, p.z))
        v.co.z += noise.noise(Vector((p.z * 0.9 / k + seed * 0.2, p.x * 1.2 / k - seed * 0.5, seed * 0.37))) * amp * 1.5 * k
    crown = new_obj("crown", bmc, M["spruce"], at, smooth=False)
    # the depth tint only (warm tops, cool undersides, dark inside); no bent normals -- flat facets are the point
    me = crown.data
    ca = me.color_attributes.new(name="Depth", type="FLOAT_COLOR", domain="POINT")
    WARM = (1.10, 1.04, 0.80); COOL = (0.82, 0.92, 1.12)
    cz0 = top_y * k * 0.5
    for i, v in enumerate(me.vertices):
        p = v.co
        hf = min(1.0, max(0.0, p.z / (top_y * k)))
        rmax = (3.5 * (1 - hf * 0.8) + 0.45) * spread * k        # this height's tier radius
        rr = min(1.0, math.hypot(p.x, p.y) / max(0.3, rmax))
        kk = 0.50 + 0.50 * rr ** 0.9                              # rim bright, interior dark
        kk *= 0.74 + 0.26 * hf                                    # low tiers older and darker
        e = 0.45 * rr + 0.55 * hf
        col = tuple(COOL[j] + (WARM[j] - COOL[j]) * e for j in range(3))
        ca.data[i].color = (kk * col[0], kk * col[1], kk * col[2], 1.0)
    me.color_attributes.active_color = ca
    bmt = bmesh.new()
    bmesh.ops.create_cone(bmt, cap_ends=True, cap_tris=True, segments=9, radius1=0.42 * k, radius2=0.18 * k, depth=3.2 * k,
                          matrix=Matrix.Translation((0, 0, 1.6 * k)))
    trunk = new_obj("trunk", bmt, M["bark"], at, smooth=False)
    return crown, trunk, H

def juniper(at, seed, P):
    rnd = random.Random(seed)
    H = U(rnd, *P["height"]); form = U(rnd, 0, 1)  # 0 columnar .. 1 bushy
    bmc = bmesh.new(); centres = []
    n = int(round(3 + 4 * form))
    for k in range(n):
        az = U(rnd, 0, 6.28); rr = H * (0.06 + 0.22 * form) * U(rnd, 0.3, 1.0)
        h = H * U(rnd, 0.55, 1.0) * (1 - 0.35 * form)
        c = Vector((math.cos(az) * rr, math.sin(az) * rr, h * 0.55))
        clump(bmc, c, H * (0.12 + 0.12 * form), H * (0.12 + 0.12 * form), h * 0.55, seed * 5 + k, sub=2, amp=0.14, undercut=0.9)
        centres.append(c)
    crown = new_obj("crown", bmc, M["juniper"], at)
    finish_crown(crown, centres, 0.45, Vector((0, 0, H * 0.45)), (H * 0.35, H * 0.35, H * 0.55))
    bmt = bmesh.new(); tube(bmt, Vector((0, 0, 0)), Vector((0, 0, H * 0.3)), H * 0.02, H * 0.01, 6)
    trunk = new_obj("trunk", bmt, M["bark"], at)
    return crown, trunk, H

def birch2(at, seed, P):
    """Weeping birch: one white trunk forking high into two or three leaders,
    branches that rise and then hang in curtains of thin twigs, each twig
    carrying a tall narrow tuft, the crown open enough to see sky through."""
    rnd = random.Random(seed)
    H = U(rnd, *P["height"]); lean = math.radians(U(rnd, 2, 9)); la = U(rnd, 0, 6.28)
    bmt = bmesh.new(); bmc = bmesh.new(); centres = []; masses = []
    forkz = H * U(rnd, 0.35, 0.5)
    fork = Vector((math.sin(lean) * math.cos(la) * forkz, math.sin(lean) * math.sin(la) * forkz, math.cos(lean) * forkz))
    r0 = H * 0.02
    tube(bmt, Vector((0, 0, 0)), fork, r0, r0 * 0.7, 8)
    tube(bmt, Vector((0, 0, -0.05)), Vector((0, 0, 0.6)), r0 * 1.6, r0, 8)
    nl = 4 if rnd.random() < 0.4 else 3
    for s in range(nl):
        az = s * 6.283 / nl + U(rnd, -0.4, 0.4); sl = math.radians(U(rnd, 8, 20))
        Lh = H - forkz
        top = fork + Vector((math.sin(sl) * math.cos(az) * Lh, math.sin(sl) * math.sin(az) * Lh, math.cos(sl) * Lh * 0.95))
        tube(bmt, fork, top, r0 * 0.7, r0 * 0.12, 6)
        nb = 6
        for i in range(nb):
            if rnd.random() < 0.12: continue                      # a gap for the sky
            f = 0.2 + 0.75 * i / (nb - 1)
            b = fork.lerp(top, f)
            baz = az + U(rnd, -1.8, 1.8); bl = H * U(rnd, 0.13, 0.22) * (1.25 - 0.55 * f)
            e = math.radians(U(rnd, 20, 45))
            elbow = b + Vector((math.cos(baz) * math.cos(e) * bl, math.sin(baz) * math.cos(e) * bl, math.sin(e) * bl))
            tube(bmt, b, elbow, r0 * 0.3, r0 * 0.12, 5)
            # curtain: three or four twigs hang from the branch's outer half, each with a tall tuft
            ntw = 4 if bl > H * 0.14 else 3
            # a tuft on the branch itself, then the curtain of hanging twigs
            cb = b.lerp(elbow, 0.6) + Vector((0, 0, H * 0.02)); rb_ = H * U(rnd, 0.055, 0.07)
            clump(bmc, cb, rb_ * 1.25, rb_ * 1.25, rb_ * 1.2, seed * 29 + s * 17 + i, sub=2, amp=0.14, undercut=0.9); centres.append(cb)
            for k in range(ntw):
                g = 0.35 + 0.65 * k / max(1, ntw - 1)
                p = b.lerp(elbow, g)
                drop = H * U(rnd, 0.06, 0.12)
                q = p + Vector((math.cos(baz) * drop * 0.25 + U(rnd, -0.3, 0.3), math.sin(baz) * drop * 0.25 + U(rnd, -0.3, 0.3), -drop))
                tube(bmt, p, q, r0 * 0.1, r0 * 0.04, 3)
                r = H * U(rnd, 0.065, 0.085)
                c = q + Vector((0, 0, drop * 0.5))
                clump(bmc, c, r, r, r * 1.3, seed * 23 + s * 31 + i * 7 + k, sub=2, amp=0.12, undercut=0.95)
                centres.append(c)
            masses.append(elbow)
        # a cluster round each leader top
        for k in range(3):
            d = Vector((math.cos(k * 2.09 + s), math.sin(k * 2.09 + s), U(rnd, -0.6, 0.3))); d.normalize()
            c = top + Vector((d.x * H * 0.05, d.y * H * 0.05, d.z * H * 0.05 - H * 0.02)); r = H * U(rnd, 0.06, 0.075)
            clump(bmc, c, r, r, r * 1.25, seed * 3 + s * 7 + k, sub=2, amp=0.14, undercut=1.0); centres.append(c)
        masses.append(top)
    crown = new_obj("crown", bmc, M["birch"], at, smooth=True)
    finish_crown(crown, masses, 0.4, fork + Vector((0, 0, H * 0.28)), (H * 0.3, H * 0.3, H * 0.35))
    trunk = new_obj("trunk", bmt, M["birchbark"], at, smooth=True)
    return crown, trunk, H

def alder2(at, seed, P):
    """Grey alder on a shore: two or three stems from one base, leaning the same
    way (toward the water), dark crowns of medium clumps on short branches,
    narrow and irregular, the stems showing between the masses."""
    rnd = random.Random(seed)
    H = U(rnd, *P["height"]); la = U(rnd, 0, 6.28); lean_all = math.radians(U(rnd, 6, 16))
    bmt = bmesh.new(); bmc = bmesh.new(); centres = []; masses = []
    ns = 3 if rnd.random() < 0.6 else 2
    r0 = H * 0.022
    tube(bmt, Vector((0, 0, -0.05)), Vector((0, 0, 0.5)), r0 * 2.0, r0 * 1.4, 8)
    for s in range(ns):
        az = la + U(rnd, -0.7, 0.7); sl = lean_all + math.radians(U(rnd, -4, 6))
        Ls = H * U(rnd, 0.8, 1.0)
        top = Vector((math.sin(sl) * math.cos(az) * Ls, math.sin(sl) * math.sin(az) * Ls, math.cos(sl) * Ls))
        base = Vector((math.cos(az + s * 2.1) * r0 * 1.2, math.sin(az + s * 2.1) * r0 * 1.2, 0))
        tube(bmt, base, top, r0, r0 * 0.15, 7)
        nb = int(round(U(rnd, 10, 13)))
        for i in range(nb):
            f = 0.28 + 0.7 * i / (nb - 1)
            b = base.lerp(top, f)
            baz = U(rnd, 0, 6.28); bl = H * U(rnd, 0.09, 0.16) * (1.15 - 0.6 * f)
            e = math.radians(U(rnd, 10, 35))
            tip = b + Vector((math.cos(baz) * math.cos(e) * bl, math.sin(baz) * math.cos(e) * bl, math.sin(e) * bl))
            tube(bmt, b, tip, r0 * 0.3, r0 * 0.08, 4)
            r = bl * U(rnd, 0.6, 0.85) + H * 0.01
            c = tip + Vector((0, 0, r * 0.3))
            clump(bmc, c, r, r, r * 0.9, seed * 19 + s * 13 + i, sub=2, amp=0.14, undercut=0.75)
            centres.append(c); masses.append(c)
        c = top + Vector((0, 0, H * 0.01)); clump(bmc, c, H * 0.045, H * 0.045, H * 0.06, seed * 5 + s, sub=2, amp=0.14, undercut=0.8); centres.append(c); masses.append(c)
    crown = new_obj("crown", bmc, M["alder"], at, smooth=True)
    finish_crown(crown, masses, 0.45, Vector((0, 0, H * 0.6)), (H * 0.28, H * 0.28, H * 0.42))
    trunk = new_obj("trunk", bmt, M["greybark"], at, smooth=True)
    return crown, trunk, H

def oak2(at, seed, P):
    """Pasture oak: a short massive trunk, three to five thick limbs that kink
    twice on their way out, secondary branches, and the foliage as separate
    masses at the branch ends with sky in the gaps between them."""
    rnd = random.Random(seed)
    H = U(rnd, *P["height"]); la = U(rnd, 0, 6.28)
    bmt = bmesh.new(); bmc = bmesh.new(); centres = []; masses = []
    r0 = H * 0.045
    trunk_h = H * U(rnd, 0.22, 0.32)
    lean = math.radians(U(rnd, 0, 6))
    fork = Vector((math.sin(lean) * math.cos(la) * trunk_h, math.sin(lean) * math.sin(la) * trunk_h, math.cos(lean) * trunk_h))
    tube(bmt, Vector((0, 0, 0)), fork, r0, r0 * 0.85, 9)
    tube(bmt, Vector((0, 0, -0.05)), Vector((0, 0, 0.9)), r0 * 1.7, r0, 9)
    nl = int(round(U(rnd, 3, 5)))
    for i in range(nl):
        az = i * 6.283 / nl + U(rnd, -0.5, 0.5)
        e0 = math.radians(U(rnd, 50, 72)); e1 = math.radians(U(rnd, 25, 50)); e2 = math.radians(U(rnd, 10, 45))
        L = H * U(rnd, 0.22, 0.34)
        p0 = fork
        p1 = p0 + Vector((math.cos(az) * math.cos(e0) * L * 0.4, math.sin(az) * math.cos(e0) * L * 0.4, math.sin(e0) * L * 0.4))
        az1 = az + U(rnd, -0.5, 0.5)
        p2 = p1 + Vector((math.cos(az1) * math.cos(e1) * L * 0.35, math.sin(az1) * math.cos(e1) * L * 0.35, math.sin(e1) * L * 0.35))
        az2 = az1 + U(rnd, -0.5, 0.5)
        p3 = p2 + Vector((math.cos(az2) * math.cos(e2) * L * 0.25, math.sin(az2) * math.cos(e2) * L * 0.25, math.sin(e2) * L * 0.25))
        tube(bmt, p0, p1, r0 * 0.55, r0 * 0.42, 7); tube(bmt, p1, p2, r0 * 0.42, r0 * 0.28, 6); tube(bmt, p2, p3, r0 * 0.28, r0 * 0.14, 5)
        ends = [p3]
        for k in range(2):  # secondary branches off the second kink
            saz = az1 + U(rnd, -1.4, 1.4); sl = L * U(rnd, 0.25, 0.45); se = math.radians(U(rnd, 10, 50))
            q = p1.lerp(p2, U(rnd, 0.3, 1.0))
            tip = q + Vector((math.cos(saz) * math.cos(se) * sl, math.sin(saz) * math.cos(se) * sl, math.sin(se) * sl))
            tube(bmt, q, tip, r0 * 0.22, r0 * 0.08, 5)
            ends.append(tip)
        # a foliage mass at every branch end: a group of clumps on a pad
        for e in ends:
            R = H * U(rnd, 0.10, 0.14)
            mc = e + Vector((0, 0, R * 0.6)); masses.append(mc)
            clump(bmc, mc, R * 1.3, R * 1.3, R * 1.1, seed * 41 + i * 9, sub=2, amp=0.1, undercut=0.55)
            for j in range(3):
                d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.1, 1.0))); d.normalize()
                c = mc + Vector((d.x * R * 0.9, d.y * R * 0.9, d.z * R * 0.9)); r = R * U(rnd, 0.6, 0.85)
                clump(bmc, c, r, r, r * 0.95, seed * 43 + i * 11 + j + int(e.x * 3), sub=2, amp=0.12, undercut=0.6)
                centres.append(c)
    topc = fork + Vector((0, 0, H * 0.42)); masses.append(topc)
    tube(bmt, fork, topc - Vector((0, 0, H * 0.04)), r0 * 0.5, r0 * 0.15, 6)
    for j in range(4):
        d = Vector((math.cos(j * 1.6 + seed), math.sin(j * 1.6 + seed), U(rnd, 0.2, 0.8))); d.normalize()
        c = topc + Vector((d.x * H * 0.08, d.y * H * 0.08, d.z * H * 0.05)); r = H * U(rnd, 0.075, 0.1)
        clump(bmc, c, r, r, r * 0.9, seed * 53 + j, sub=2, amp=0.12, undercut=0.6); centres.append(c)
    crown = new_obj("crown", bmc, M["oak"], at, smooth=True)
    finish_crown(crown, masses, 0.55, fork + Vector((0, 0, H * 0.38)), (H * 0.38, H * 0.38, H * 0.34))
    trunk = new_obj("trunk", bmt, M["bark"], at, smooth=True)
    return crown, trunk, H

SPECIES = {
    # name: (builder, params)
    "ek (oak)":        (oak2, dict(height=(14, 22), fork=(0.32, 0.42), limbs=4, limb=(0.12, 0.2), crown_z=0.16, crown_rx=(0.30, 0.38), crown_rz=(0.22, 0.28), leaf="oak", bark="bark", trunk=0.04,
                          tiers=[(-0.6, 0.95, 9, 0.5), (0.05, 0.8, 8, 0.48), (0.65, 0.5, 5, 0.42), (0.85, 0.15, 2, 0.4)], core=0.9, undercut=0.7, blend=0.5)),
    "lönn (maple)":    (broadleaf, dict(height=(12, 18), fork=(0.28, 0.36), limbs=4, limb=(0.1, 0.16), crown_z=0.2, crown_rx=(0.28, 0.34), crown_rz=(0.28, 0.34), leaf="maple", bark="greybark", trunk=0.034,
                          tiers=[(-0.7, 0.8, 8, 0.5), (-0.1, 0.85, 8, 0.5), (0.5, 0.6, 6, 0.45), (0.95, 0.2, 2, 0.4)], core=0.95, undercut=0.75, blend=0.55)),
    "lind (linden)":   (broadleaf, dict(height=(16, 24), fork=(0.22, 0.3), limbs=3, limb=(0.08, 0.12), crown_z=0.28, crown_rx=(0.20, 0.25), crown_rz=(0.36, 0.42), leaf="linden", bark="greybark", trunk=0.034,
                          tiers=[(-0.8, 0.8, 7, 0.55), (-0.3, 0.9, 8, 0.55), (0.2, 0.75, 7, 0.5), (0.6, 0.45, 4, 0.45), (0.78, 0.1, 1, 0.45)], core=0.9, undercut=0.7, blend=0.55)),
    "ask (ash)":       (broadleaf, dict(height=(16, 24), fork=(0.35, 0.45), limbs=5, limb=(0.14, 0.22), crown_z=0.2, crown_rx=(0.24, 0.3), crown_rz=(0.22, 0.28), leaf="ash", bark="greybark", trunk=0.032,
                          tiers=[(-0.5, 0.9, 6, 0.55), (0.2, 0.7, 5, 0.55), (0.6, 0.3, 2, 0.5)], core=0.5, undercut=0.65, blend=0.45, amp=0.14)),
    "björk (birch)":   (birch2, dict(height=(12, 20), fork=(0.25, 0.35), stems=3, crown_z=0.42, crown_rx=(0.16, 0.22), crown_rz=(0.26, 0.34), leaf="birch", bark="birchbark", trunk=0.026,
                          tiers=[(-0.8, 0.6, 5, 0.4), (-0.25, 0.8, 6, 0.42), (0.3, 0.7, 6, 0.4), (0.7, 0.35, 3, 0.38)], core=0.7, undercut=1.15, clump_z=1.35, blend=0.45, amp=0.14)),
    "asp (aspen)":     (broadleaf, dict(height=(14, 22), fork=(0.42, 0.55), limbs=4, limb=(0.06, 0.1), crown_z=0.18, crown_rx=(0.16, 0.2), crown_rz=(0.24, 0.3), leaf="aspen", bark="greybark", trunk=0.026, lean=3,
                          tiers=[(-0.7, 0.8, 6, 0.46), (-0.15, 0.9, 7, 0.46), (0.4, 0.7, 5, 0.44), (0.72, 0.3, 2, 0.4)], core=0.95, undercut=0.8, clump_z=1.0, blend=0.5, amp=0.12)),
    "al (alder)":      (alder2, dict(height=(10, 16), fork=(0.18, 0.26), stems=2, crown_z=0.3, crown_rx=(0.18, 0.24), crown_rz=(0.34, 0.42), leaf="alder", bark="bark", trunk=0.03,
                          tiers=[(-0.9, 0.9, 7, 0.45), (-0.4, 0.85, 7, 0.42), (0.1, 0.7, 6, 0.4), (0.5, 0.5, 4, 0.36), (0.72, 0.15, 1, 0.38)], core=0.8, undercut=0.7, blend=0.55)),
    "sälg (willow)":   (broadleaf, dict(height=(6, 11), fork=(0.15, 0.22), stems=4, crown_z=0.22, crown_rx=(0.32, 0.4), crown_rz=(0.3, 0.36), leaf="willow", bark="greybark", trunk=0.03,
                          tiers=[(-0.8, 0.8, 7, 0.45), (-0.2, 0.9, 8, 0.45), (0.4, 0.6, 5, 0.42), (0.7, 0.2, 2, 0.4)], core=0.85, undercut=0.8, blend=0.55)),
    "tall (pine)":     (pine, dict(height=(14, 24), crown_from=(0.5, 0.66))),
    "gran (spruce)":   (spruce, dict(height=(12, 24), wide=(0.16, 0.24))),
    "en (juniper)":    (juniper, dict(height=(2.5, 6))),
}

# ------------------------------------------------------------ scene furniture
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=120)
ground = new_obj("ground", bm, M["ground"], (0, 0, 0))
cam_data = bpy.data.cameras.new("CatCam"); cam = bpy.data.objects.new("CatCam", cam_data); coll.objects.link(cam); cam_data.lens = 40; sc.camera = cam
sun_data = bpy.data.lights.new("CatSun", "SUN"); sun_data.energy = 4.0; sun_data.angle = math.radians(3); sun_data.color = (1.0, 0.96, 0.88)
sun = bpy.data.objects.new("CatSun", sun_data); sun.rotation_euler = (math.radians(50), math.radians(14), math.radians(-42)); coll.objects.link(sun)
w = bpy.data.worlds.get("GhibliWorld3") or bpy.data.worlds.new("GhibliWorld3")
w.use_nodes = True; nt = w.node_tree; nt.nodes.clear()
wo = nt.nodes.new("ShaderNodeOutputWorld"); bg = nt.nodes.new("ShaderNodeBackground")
tc = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
rmp = nt.nodes.new("ShaderNodeValToRGB"); rmp.color_ramp.interpolation = "EASE"
rmp.color_ramp.elements[0].position = 0.0; rmp.color_ramp.elements[0].color = (*srgb(0xd4ecf8), 1)
rmp.color_ramp.elements[1].position = 0.45; rmp.color_ramp.elements[1].color = (*srgb(0x3f98e6), 1)
mr = nt.nodes.new("ShaderNodeMapRange"); mr.inputs[1].default_value = -0.05; mr.inputs[2].default_value = 0.6
nt.links.new(tc.outputs["Generated"], sep.inputs[0]); nt.links.new(sep.outputs["Z"], mr.inputs[0])
nt.links.new(mr.outputs[0], rmp.inputs[0]); nt.links.new(rmp.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], wo.inputs[0])
sc.world = w
sc.render.engine = "BLENDER_EEVEE_NEXT"; sc.eevee.taa_render_samples = 10
sc.render.resolution_x = 1800; sc.render.resolution_y = 700; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"; sc.view_settings.view_transform = "Standard"

report = {}
keep = {ground, cam, sun}
ONLY = __ONLY__
for si, (name, (builder, P)) in enumerate(SPECIES.items()):
    if ONLY and name.split(" ")[0] not in ONLY: continue
    for o in list(sc.objects):
        if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
    hs = []; tri = []
    NV = __NV__
    Hs = [random.Random(1000 * (si + 1) + 17 * v).uniform(*P["height"]) for v in range(NV)]
    sp = min(14.0, max(5.0, max(Hs) * 0.62))
    for v in range(NV):
        c, t, H = builder((-(NV - 1) / 2 * sp + sp * v, 0, 0), 1000 * (si + 1) + 17 * v, P)
        hs.append(H); tri.append(tris(c) + tris(t))
    Hm = max(hs)
    vfov = 2 * math.atan(18 * 700 / 1800 / 40); hfov = 2 * math.atan(18 / 40)
    dist = max(Hm * 1.25 / 2 / math.tan(vfov / 2), ((NV - 1) * sp + Hm * 0.9) / 2 / math.tan(hfov / 2))
    cam.location = (0, -dist, Hm * 0.52); cam.rotation_euler = (math.radians(90), 0, 0)
    slug = name.split(" ")[0].replace("ö", "o").replace("ä", "a")
    out = os.path.join(OUTDIR, f"catalog-{si:02d}-{slug}.png")
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    report[name] = {"heights": [round(h, 1) for h in hs], "tris": tri, "png": os.path.basename(out)}

# ============================================================ the stand: a forest edge at course spacing, from tee height
TIERS = __TIERS__
if TIERS:
    for o in list(sc.objects):
        if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
    names = ["gran (spruce)", "tall (pine)", "björk (birch)", "ek (oak)"]
    tiercount = {}
    x = -48
    for name in names:
        builder, P = SPECIES[name]
        for tier in ("hero", "full", "decimated", "lite"):
            LOD = LOD_TIERS[tier]; _lodcount[0] = 0
            c, t, H = builder((x, 0, 0), 2000 + 17, P)
            tiercount.setdefault(name, {})[tier] = [tris(c), tris(t), len(c.data.vertices)]
            x += 6.4
        x += 2.5
    LOD = LOD_TIERS["hero"]
    cam.location = (2, -100, 9); cam_data.lens = 40; cam.rotation_euler = (math.radians(90), 0, 0)
    sc.render.resolution_x = 2400; sc.render.resolution_y = 800
    sc.render.filepath = os.path.join(OUTDIR, "tiers.png"); bpy.ops.render.render(write_still=True)
    report["tiers"] = tiercount
HERO = __HERO__
if HERO:
    LOD = LOD_TIERS["hero"]
    for name in ["gran (spruce)", "tall (pine)", "björk (birch)", "ek (oak)", "al (alder)"]:
        for o in list(sc.objects):
            if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
        builder, P = SPECIES[name]
        c, tr, H = builder((0, 0, 0), 2017, P)
        # the golfer view: eye height, a bit more than a tree height back, the crown centred
        dist = H * 1.15 + 4
        cam.location = (dist * 0.35, -dist * 0.94, 1.7); cam_data.lens = 35
        d = Vector((0, 0, H * 0.55)) - Vector(cam.location); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.render.resolution_x = 900; sc.render.resolution_y = 1400
        slug = name.split(" ")[0].replace("ö", "o").replace("ä", "a")
        sc.render.filepath = os.path.join(OUTDIR, f"hero-{slug}.png"); bpy.ops.render.render(write_still=True)
        report["hero-" + slug] = tris(c) + tris(tr)
STAND = __STAND__
if STAND:
    for o in list(sc.objects):
        if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
    rnd = random.Random(2026)
    mix = [("gran (spruce)", 0.42), ("tall (pine)", 0.30), ("björk (birch)", 0.18), ("asp (aspen)", 0.05), ("al (alder)", 0.05)]
    def pick():
        r = rnd.random(); acc = 0
        for name, w in mix:
            acc += w
            if r < acc: return name
        return mix[0][0]
    count = {}; tri_total = 0
    for row, y in enumerate((22, 28, 34, 40, 46, 52, 58)):
        x = -72 + rnd.uniform(0, 4)
        while x < 72:
            name = pick()
            if row == 0 and rnd.random() < 0.35: name = "björk (birch)"      # birch and aspen like the light at the edge
            builder, P = SPECIES[name]
            c, t, H = builder((x + rnd.uniform(-1.5, 1.5), y + rnd.uniform(-2.5, 2.5), 0), 5000 + row * 100 + int(x), P)
            count[name] = count.get(name, 0) + 1; tri_total += tris(c) + tris(t)
            x += rnd.uniform(4.5, 7.5)
    cam.location = (0, -42, 1.7); cam_data.lens = 30
    d = Vector((0, 30, 10)) - Vector(cam.location); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x = 1800; sc.render.resolution_y = 800
    sc.render.filepath = os.path.join(OUTDIR, "stand.png"); bpy.ops.render.render(write_still=True)
    report["stand"] = {"trees": count, "tris": tri_total}

bpy.context.window.scene = user_scene
print(json.dumps(report))
