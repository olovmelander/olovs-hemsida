"""Billstavägen 47A as a Ghibli-style study, built in scene "HouseStudy".
Read off four Street View photos (July 2025): two storeys, white vertical
boarding, white two-pane windows, dark grey tile saddle roof with a ridge
chimney, two cross-gables (frontespiser) on the road side, grey plinth, gravel
drive, two birches by the road, a Falu-red barn with a rusted roof behind.
Dimensions are estimates from the photographs, not a survey."""
import bpy, bmesh, math, random, json, os
from mathutils import Vector, Matrix, noise

OUT = r"__OUT__"
SCENE = "HouseStudy"
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
def toon(name, deep, shadow, mid, light, dab=None, rim=None, dapple=0.16, dabs=False, vcol=False, vary=(0.0, 0.0),
         stripes=None):
    """stripes: (axis, period, strength) draws board/tile lines: axis 'h' = lines vary along x+y
    (vertical boards), 'v' = lines vary along z (tile rows)."""
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
        nz2 = N("ShaderNodeTexNoise"); nz2.inputs["Scale"].default_value = 1.5; nz2.inputs["Detail"].default_value = 1.5
        L(tc.outputs["Object"], nz2.inputs["Vector"])
        th = N("ShaderNodeMath"); th.operation = "GREATER_THAN"; th.inputs[1].default_value = 0.66; L(nz2.outputs["Fac"], th.inputs[0])
        lit = N("ShaderNodeMath"); lit.operation = "GREATER_THAN"; lit.inputs[1].default_value = 0.72; L(add.outputs[0], lit.inputs[0])
        geo = N("ShaderNodeNewGeometry"); sxyz = N("ShaderNodeSeparateXYZ"); L(geo.outputs["Normal"], sxyz.inputs[0])
        up = N("ShaderNodeMath"); up.operation = "GREATER_THAN"; up.inputs[1].default_value = 0.35; L(sxyz.outputs["Z"], up.inputs[0])
        a1 = N("ShaderNodeMath"); a1.operation = "MULTIPLY"; L(th.outputs[0], a1.inputs[0]); L(lit.outputs[0], a1.inputs[1])
        a2 = N("ShaderNodeMath"); a2.operation = "MULTIPLY"; L(a1.outputs[0], a2.inputs[0]); L(up.outputs[0], a2.inputs[1])
        mixd = N("ShaderNodeMix"); mixd.data_type = "RGBA"; mixd.inputs[7].default_value = (*(dab or light), 1)
        L(a2.outputs[0], mixd.inputs[0]); L(col, mixd.inputs[6]); col = mixd.outputs[2]
    if rim:
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
    if stripes:
        axis, period, strength = stripes
        sep = N("ShaderNodeSeparateXYZ"); L(tc.outputs["Object"], sep.inputs[0])
        if axis == "h":
            sm = N("ShaderNodeMath"); sm.operation = "ADD"; L(sep.outputs["X"], sm.inputs[0]); L(sep.outputs["Y"], sm.inputs[1]); coord = sm.outputs[0]
        else:
            coord = sep.outputs["Z"]
        dv = N("ShaderNodeMath"); dv.operation = "DIVIDE"; dv.inputs[1].default_value = period; L(coord, dv.inputs[0])
        fr = N("ShaderNodeMath"); fr.operation = "FRACT"; L(dv.outputs[0], fr.inputs[0])
        ln = N("ShaderNodeMath"); ln.operation = "LESS_THAN"; ln.inputs[1].default_value = 0.16; L(fr.outputs[0], ln.inputs[0])
        sc_ = N("ShaderNodeMath"); sc_.operation = "MULTIPLY"; sc_.inputs[1].default_value = -strength; L(ln.outputs[0], sc_.inputs[0])
        one = N("ShaderNodeMath"); one.operation = "ADD"; one.inputs[1].default_value = 1.0; L(sc_.outputs[0], one.inputs[0])
        mixs = N("ShaderNodeMix"); mixs.data_type = "RGBA"; mixs.blend_type = "MULTIPLY"; mixs.inputs[0].default_value = 1.0
        L(col, mixs.inputs[6]); L(one.outputs[0], mixs.inputs[7])
        # MULTIPLY expects a colour in B; a float links fine (broadcast)
        col = mixs.outputs[2]
    if vary[0] or vary[1]:
        oi = N("ShaderNodeObjectInfo"); hs = N("ShaderNodeHueSaturation")
        hmap = N("ShaderNodeMapRange"); hmap.inputs[3].default_value = 0.5 - vary[0]; hmap.inputs[4].default_value = 0.5 + vary[0]
        vmap = N("ShaderNodeMapRange"); vmap.inputs[3].default_value = 1 - vary[1]; vmap.inputs[4].default_value = 1 + vary[1]
        L(oi.outputs["Random"], hmap.inputs[0]); L(oi.outputs["Random"], vmap.inputs[0])
        L(hmap.outputs[0], hs.inputs["Hue"]); L(vmap.outputs[0], hs.inputs["Value"]); L(col, hs.inputs["Color"]); col = hs.outputs[0]
    emit = N("ShaderNodeEmission"); L(col, emit.inputs[0]); L(emit.outputs[0], out.inputs[0])
    m.diffuse_color = (*mid, 1)
    return m

def tm(name, deep, shadow, mid, light, **kw):
    return toon(name, srgb(deep), srgb(shadow), srgb(mid), srgb(light), **kw)

M = {
    "wall":    tm("h-wall", 0x7f98a8, 0xaac2d0, 0xeaf0ee, 0xffffff, dapple=0.06, stripes=("h", 0.14, 0.06)),
    "trim":    tm("h-trim", 0x9aa8ae, 0xc6d0d2, 0xf0f2ee, 0xffffff, dapple=0.03),
    "roof":    tm("h-roof", 0x1a2430, 0x2c3a48, 0x455868, 0x6a8090, dapple=0.06, stripes=("v", 0.34, 0.10)),
    "glass":   tm("h-glass", 0x1e3a52, 0x2c5878, 0x4a84a8, 0x9ccce0, dapple=0.04),
    "plinth":  tm("h-plinth", 0x4a4e4a, 0x6e736c, 0x969a90, 0xb4b8ae, dapple=0.06),
    "chimney": tm("h-chimney", 0x3a3230, 0x5a4e48, 0x7a6c64, 0x958880, dapple=0.06),
    "door":    tm("h-door", 0x2a2018, 0x4a3828, 0x6a5238, 0x8a6e50, dapple=0.04),
    "red":     tm("h-red", 0x4a100c, 0x8a1e14, 0xc23a24, 0xdc5a3c, dapple=0.08, stripes=("h", 0.16, 0.05)),
    "rust":    tm("h-rust", 0x5a2a14, 0x8e4820, 0xb86a30, 0xd08a44, dapple=0.14, stripes=("v", 0.6, 0.08)),
    "gravel":  tm("h-gravel", 0x6a6e66, 0x8e9288, 0xb2b4a6, 0xcfd0c2, dapple=0.20),
    "ground":  tm("h-ground", 0x1c5a2c, 0x2f8c30, 0x4fba30, 0x80da3e, dapple=0.20, dabs=True, dab=srgb(0xa8ec58)),
    "meadow":  tm("h-meadow", 0x2a6a24, 0x4a9a2e, 0x78c23a, 0xa4dc48, dapple=0.24, dabs=True, dab=srgb(0xc8ec62)),
    "birch":   tm("h-birch", 0x1e5a30, 0x2e8c36, 0x62bc3a, 0x9cdc48, dab=srgb(0xc6ee62), rim=srgb(0x9fd8e8), dabs=True, vcol=True, vary=(0.02, 0.1)),
    "bush":    tm("h-bush", 0x144a30, 0x22803a, 0x3fae36, 0x74d448, dab=srgb(0xa4e858), rim=srgb(0x9fd8e8), dabs=True, vcol=True, vary=(0.03, 0.12)),
    "birchbark": tm("h-birchbark", 0x4a4a44, 0x8c8a80, 0xd8d5c4, 0xf3f1e4, dapple=0.10),
    "lupin":   tm("h-lupin", 0x2a1478, 0x4c2ab8, 0x7a54e6, 0xa890ff, dapple=0.1, vary=(0.06, 0.15)),
}

def new_obj(name, bm, material, at=(0, 0, 0), smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(material)
    for p in me.polygons: p.use_smooth = smooth
    o = bpy.data.objects.new(name, me); o.location = at; coll.objects.link(o)
    return o

def box(bm, cx, cy, z0, sx, sy, sz):
    """axis-aligned box, base at z0"""
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((cx, cy, z0 + sz / 2)) @ Matrix.Diagonal((sx, sy, sz, 1)))

def prism(bm, verts_xy, z0, z1):
    """extrude a convex polygon (list of (x,y)) from z0 to z1"""
    vs0 = [bm.verts.new((x, y, z0)) for x, y in verts_xy]
    vs1 = [bm.verts.new((x, y, z1)) for x, y in verts_xy]
    bm.faces.new(vs0[::-1]); bm.faces.new(vs1)
    n = len(vs0)
    for i in range(n):
        bm.faces.new([vs0[i], vs0[(i + 1) % n], vs1[(i + 1) % n], vs1[i]])

def gable_roof(bm, cx, cy, z_eave, sx, sy, z_ridge, along="x", over=0.45, thick=0.12):
    """a saddle roof: ridge along 'along', eaves overhanging by 'over' on all sides; a thin slab per pitch"""
    if along == "x":
        hx, hy = sx / 2 + over, sy / 2 + over
        # ridge runs along x at y = cy; slopes in y
        for s in (1, -1):
            eave = Vector((0, s * hy, z_eave - over * (z_ridge - z_eave) / (sy / 2)))
            ridge = Vector((0, 0, z_ridge))
            # slab as a quad extruded by thickness along its normal
            d = (ridge - eave); nrm = Vector((0, -s * d.z, abs(d.y))); nrm.normalize()
            p = [Vector((cx - hx, cy + eave.y, eave.z)), Vector((cx + hx, cy + eave.y, eave.z)),
                 Vector((cx + hx, cy, z_ridge)), Vector((cx - hx, cy, z_ridge))]
            q = [v + nrm * thick for v in p]
            vs = [bm.verts.new(v) for v in p + q]
            bm.faces.new(vs[3::-1] if s > 0 else vs[0:4]); bm.faces.new(vs[4:8] if s > 0 else vs[7:3:-1])
            for i in range(4):
                a, b = i, (i + 1) % 4
                f = [vs[a], vs[b], vs[4 + b], vs[4 + a]]
                bm.faces.new(f if s > 0 else f[::-1])
    else:
        hx, hy = sx / 2 + over, sy / 2 + over
        for s in (1, -1):
            ez = z_eave - over * (z_ridge - z_eave) / (sx / 2)
            d = Vector((-s * hx, 0, z_ridge - ez)); nrm = Vector((s * d.z, 0, hx)); nrm.normalize()
            p = [Vector((cx + s * hx, cy - hy, ez)), Vector((cx + s * hx, cy + hy, ez)),
                 Vector((cx, cy + hy, z_ridge)), Vector((cx, cy - hy, z_ridge))]
            q = [v + nrm * thick for v in p]
            vs = [bm.verts.new(v) for v in p + q]
            bm.faces.new(vs[0:4] if s > 0 else vs[3::-1]); bm.faces.new(vs[7:3:-1] if s > 0 else vs[4:8])
            for i in range(4):
                a, b = i, (i + 1) % 4
                f = [vs[a], vs[b], vs[4 + b], vs[4 + a]]
                bm.faces.new(f[::-1] if s > 0 else f)

# ------------------------------------------------------------ the house
# frame: house long axis along x, road side is -y (the camera stands on the road, south-west)
LX, LY = 13.0, 8.6          # footprint (estimate)
PLINTH = 0.6
EAVE = PLINTH + 2 * 2.85     # two storeys of ~2.85 m
PITCH = math.radians(38)
RIDGE = EAVE + (LY / 2) * math.tan(PITCH)

bm = bmesh.new(); box(bm, 0, 0, -0.1, LX + 0.1, LY + 0.1, PLINTH + 0.1); new_obj("plinth", bm, M["plinth"])
bm = bmesh.new()
# main body walls, with gable triangles on the x ends
prism(bm, [(-LX / 2, -LY / 2), (LX / 2, -LY / 2), (LX / 2, LY / 2), (-LX / 2, LY / 2)], PLINTH, EAVE)
for sx_ in (-1, 1):
    x = sx_ * LX / 2
    vs = [bm.verts.new((x, -LY / 2, EAVE)), bm.verts.new((x, LY / 2, EAVE)), bm.verts.new((x, 0, RIDGE))]
    bm.faces.new(vs if sx_ > 0 else vs[::-1])
# two cross-gables (frontespiser) on the road side: 4.2 m wide, projecting 0.9 m, own ridge at the main ridge height minus a little
FRONT = []
for fx in (-3.4, 2.6):
    w, proj = 4.2, 0.9
    y0, y1 = -LY / 2 - proj, -LY / 2 + 0.2
    prism(bm, [(fx - w / 2, y0), (fx + w / 2, y0), (fx + w / 2, y1), (fx - w / 2, y1)], PLINTH, EAVE)
    top = EAVE + (w / 2) * math.tan(PITCH)
    vs = [bm.verts.new((fx - w / 2, y0, EAVE)), bm.verts.new((fx + w / 2, y0, EAVE)), bm.verts.new((fx, y0, top))]
    bm.faces.new(vs[::-1])
    FRONT.append((fx, y0, w, top, proj))
walls = new_obj("walls", bm, M["wall"])

bm = bmesh.new()
gable_roof(bm, 0, 0, EAVE, LX, LY, RIDGE, along="x", over=0.5)
for fx, y0, w, top, proj in FRONT:
    # cross gable roof: ridge along y from the front gable back into the main roof
    depth = proj + 0.2 + (LY / 2)  # run it well into the main roof so the valley reads
    gable_roof(bm, fx, y0 + depth / 2, EAVE, w, depth, top, along="y", over=0.45)
roof = new_obj("roof", bm, M["roof"])
bm = bmesh.new(); box(bm, -3.4, -LY / 2 - 0.9 - 0.02, -0.1, 4.3, 1.0, PLINTH + 0.1); box(bm, 2.6, -LY / 2 - 0.9 - 0.02, -0.1, 4.3, 1.0, PLINTH + 0.1); new_obj("plinth2", bm, M["plinth"])

# chimney on the ridge, left third
bm = bmesh.new(); box(bm, -3.4, 0.4, RIDGE - 0.6, 0.9, 0.7, 1.9); new_obj("chimney", bm, M["chimney"])

# windows: two-pane, white frame proud of the wall, glass set back
def window(bm_f, bm_g, x, y, z, w=1.15, h=1.35, face="y-"):
    d = 0.08
    if face == "y-":
        box(bm_f, x, y - d / 2, z, w + 0.24, d, h + 0.24); box(bm_g, x, y - d - 0.005, z + 0.12, w, 0.02, h)
        box(bm_f, x, y - d - 0.01, z + 0.12, 0.08, 0.03, h)             # mullion
        box(bm_f, x, y - d - 0.01, z + 0.12 + h * 0.55, w, 0.03, 0.06)   # transom
    elif face == "y+":
        box(bm_f, x, y + d / 2, z, w + 0.24, d, h + 0.24); box(bm_g, x, y + d + 0.005, z + 0.12, w, 0.02, h)
        box(bm_f, x, y + d + 0.01, z + 0.12, 0.08, 0.03, h); box(bm_f, x, y + d + 0.01, z + 0.12 + h * 0.55, w, 0.03, 0.06)
    elif face == "x+":
        box(bm_f, x + d / 2, y, z, d, w + 0.24, h + 0.24); box(bm_g, x + d + 0.005, y, z + 0.12, 0.02, w, h)
        box(bm_f, x + d + 0.01, y, z + 0.12, 0.03, 0.08, h); box(bm_f, x + d + 0.01, y, z + 0.12 + h * 0.55, 0.03, w, 0.06)
    else:
        box(bm_f, x - d / 2, y, z, d, w + 0.24, h + 0.24); box(bm_g, x - d - 0.005, y, z + 0.12, 0.02, w, h)
        box(bm_f, x - d - 0.01, y, z + 0.12, 0.03, 0.08, h); box(bm_f, x - d - 0.01, y, z + 0.12 + h * 0.55, 0.03, w, 0.06)

bmf = bmesh.new(); bmg = bmesh.new()
Z0, Z1 = PLINTH + 0.9, PLINTH + 2.85 + 0.75
yf = -LY / 2 - 0.9  # front gables' face
# road side: windows in each frontespis (both floors) and on the wall between/beside them
for fx, y0, w, top, proj in FRONT:
    window(bmf, bmg, fx, y0, Z0); window(bmf, bmg, fx, y0, Z1)
for x in (-6.0 + 0.4, -0.4, 5.6):
    window(bmf, bmg, x, -LY / 2, Z0); window(bmf, bmg, x, -LY / 2, Z1)
# back (drive) side: five bays on both floors, the entrance-side door under one of them
for x in (-4.8, -2.4, 0.0, 2.4, 4.8):
    window(bmf, bmg, x, LY / 2, Z1)
    if x != 0.0: window(bmf, bmg, x, LY / 2, Z0)
# gable ends: two windows per floor
for xs in (-1, 1):
    for y in (-2.0, 2.0):
        window(bmf, bmg, xs * LX / 2, y, Z0, face="x+" if xs > 0 else "x-"); window(bmf, bmg, xs * LX / 2, y, Z1, face="x+" if xs > 0 else "x-")
    window(bmf, bmg, xs * LX / 2, 0, EAVE + 0.5, w=0.8, h=0.9, face="x+" if xs > 0 else "x-")
new_obj("frames", bmf, M["trim"]); new_obj("glass", bmg, M["glass"])
# corner boards and the eave board
bm = bmesh.new()
for x in (-LX / 2, LX / 2):
    for y in (-LY / 2, LY / 2):
        box(bm, x, y, PLINTH, 0.22, 0.22, EAVE - PLINTH)
for fx, y0, w, top, proj in FRONT:
    box(bm, fx - w / 2, y0, PLINTH, 0.22, 0.22, EAVE - PLINTH); box(bm, fx + w / 2, y0, PLINTH, 0.22, 0.22, EAVE - PLINTH)
    # bargeboards on the cross gable
new_obj("corners", bm, M["trim"])
# entrance door on the drive side with a small canopy and steps
bm = bmesh.new(); box(bm, 0, LY / 2 + 0.03, PLINTH, 1.0, 0.06, 2.1); new_obj("door", bm, M["door"])
bm = bmesh.new(); box(bm, 0, LY / 2 + 0.6, PLINTH + 2.3, 1.8, 1.2, 0.08); new_obj("canopy", bm, M["roof"])
bm = bmesh.new(); box(bm, 0, LY / 2 + 0.45, 0, 1.6, 0.9, PLINTH); box(bm, 0, LY / 2 + 1.0, 0, 1.6, 0.5, PLINTH * 0.5); new_obj("steps", bm, M["plinth"])
# downpipes at the corners
bm = bmesh.new()
for x, y in ((-LX / 2 - 0.35, -LY / 2 - 0.3), (LX / 2 + 0.35, -LY / 2 - 0.3), (LX / 2 + 0.35, LY / 2 + 0.3)):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.05, radius2=0.05, depth=EAVE - 0.3, matrix=Matrix.Translation((x, y, (EAVE - 0.3) / 2 + 0.2)))
new_obj("pipes", bm, M["trim"])

# ------------------------------------------------------------ the barn behind (Falu red, rusted sheet roof), the drive, the lawn, the road
bm = bmesh.new()
prism(bm, [(16, 2), (34, 2), (34, 10), (16, 10)], 0, 3.4)
for sx_ in (16, 34):
    vs = [bm.verts.new((sx_, 2, 3.4)), bm.verts.new((sx_, 10, 3.4)), bm.verts.new((sx_, 6, 5.6))]
    bm.faces.new(vs if sx_ > 16 else vs[::-1])
new_obj("barn", bm, M["red"], smooth=False)
bm = bmesh.new(); gable_roof(bm, 25, 6, 3.4, 18, 8, 5.6, along="x", over=0.4); new_obj("barnroof", bm, M["rust"])

bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=600); new_obj("lawn", bm, M["ground"], at=(0, 0, -0.02))
# gravel drive: from the road (south-west) curving to the entrance side
bm = bmesh.new()
pts = [(-30, -30), (-18, -22), (-8, -14), (2, -9), (10, -3), (12, 5), (10, 10)]
for i in range(len(pts) - 1):
    (x0, y0), (x1, y1) = pts[i], pts[i + 1]
    d = Vector((x1 - x0, y1 - y0, 0)); L_ = d.length; d.normalize(); n = Vector((-d.y, d.x, 0)) * 1.8
    prism(bm, [(x0 + n.x, y0 + n.y), (x1 + n.x, y1 + n.y), (x1 - n.x, y1 - n.y), (x0 - n.x, y0 - n.y)], 0.0, 0.04)
new_obj("drive", bm, M["gravel"])
# the road along the south-west, and the rough verge with lupins
bm = bmesh.new(); prism(bm, [(-60, -34), (60, -34), (60, -28), (-60, -28)], 0.0, 0.06); new_obj("road", bm, M["gravel"])
bm = bmesh.new(); prism(bm, [(-60, -28), (60, -28), (60, -21), (-60, -21)], 0.0, 0.05); new_obj("verge", bm, M["meadow"])

# ------------------------------------------------------------ trees and bushes (the Ghibli recipes)
def tube(bm, p0, p1, r0, r1, segs=8):
    d = p1 - p0
    if d.length < 1e-6: return
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=segs, radius1=r0, radius2=r1, depth=d.length,
                          matrix=Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4())

def clump(bm, c, rx, ry, rz, seed, sub=2, amp=0.10, undercut=0.7):
    res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0, matrix=Matrix.Translation(c))
    for v in res["verts"]:
        p = v.co - c
        s = 1 + amp * noise.noise(p * 1.6 + Vector((seed * 0.37, seed * 0.11, seed * 0.53)))
        s += 0.05 * noise.noise(p * 4.5 + Vector((seed * 0.7, 0, seed * 0.2)))
        zz = p.z * rz * s * (1.0 if p.z > 0 else undercut)
        v.co = c + Vector((p.x * rx * s, p.y * ry * s, zz))

def finish_crown(o, centres, blend, depth_centre, depth_r):
    me = o.data; normals = []
    for v in me.vertices:
        c = min(centres, key=lambda c: (v.co - c).length_squared)
        d = (v.co - c); d.normalize()
        n = (v.normal * (1 - blend) + d * blend); n.normalize(); normals.append(n)
    me.normals_split_custom_set_from_vertices(normals)
    ca = me.color_attributes.new(name="Depth", type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(me.vertices):
        p = v.co - depth_centre
        r = math.sqrt((p.x / depth_r[0]) ** 2 + (p.y / depth_r[1]) ** 2 + (p.z / depth_r[2]) ** 2)
        k = 0.55 + 0.45 * min(1.0, r) ** 1.5
        k *= 0.82 + 0.18 * min(1.0, max(0.0, (p.z / depth_r[2] + 1) * 0.5))
        ca.data[i].color = (k, k * 0.98, k * 0.95, 1.0)

def birch(at, seed, H):
    """a big roadside birch: one trunk, a broad hanging crown"""
    rnd = random.Random(seed)
    bmt = bmesh.new(); bmc = bmesh.new(); centres = []
    lean = math.radians(rnd.uniform(3, 8)); la = rnd.uniform(0, 6.28)
    fork = Vector((math.sin(lean) * math.cos(la) * H * 0.45, math.sin(lean) * math.sin(la) * H * 0.45, math.cos(lean) * H * 0.45))
    tube(bmt, Vector((0, 0, 0)), fork, H * 0.03, H * 0.02, 8)
    tube(bmt, Vector((0, 0, -0.05)), Vector((0, 0, 0.8)), H * 0.05, H * 0.03, 8)
    Cc = fork + Vector((0, 0, H * 0.25))
    for s_i in range(3):
        az = s_i * 2.09 + rnd.uniform(-0.3, 0.3); sl = math.radians(rnd.uniform(10, 22))
        top = fork + Vector((math.sin(sl) * math.cos(az) * H * 0.4, math.sin(sl) * math.sin(az) * H * 0.4, math.cos(sl) * H * 0.4))
        tube(bmt, fork, top, H * 0.018, H * 0.006, 6)
    rx, rz = H * 0.32, H * 0.3
    for tier, (zoff, R, n, r) in enumerate([(-0.8, 0.7, 7, 0.4), (-0.25, 0.9, 8, 0.42), (0.3, 0.75, 7, 0.4), (0.7, 0.35, 3, 0.38)]):
        for j in range(n):
            az = j / n * 6.283 + tier * 0.7 + rnd.uniform(-0.25, 0.25)
            c = Cc + Vector((math.cos(az) * R * rx, math.sin(az) * R * rx, zoff * rz))
            rr = r * rx * rnd.uniform(0.85, 1.15)
            clump(bmc, c, rr, rr, rr * 1.35, seed * 7 + tier * 13 + j, amp=0.14, undercut=1.15); centres.append(c)
    clump(bmc, Cc, rx * 0.7, rx * 0.7, rz * 0.6, seed, sub=3, amp=0.05)
    crown = new_obj("birch-crown", bmc, M["birch"], at, smooth=True)
    finish_crown(crown, centres, 0.45, Cc, (rx * 1.35, rx * 1.35, rz * 1.3))
    new_obj("birch-trunk", bmt, M["birchbark"], at, smooth=True)

def bush(at, seed, r):
    rnd = random.Random(seed); bm = bmesh.new(); centres = []
    for k in range(6):
        c = Vector((rnd.uniform(-0.6, 0.6) * r, rnd.uniform(-0.6, 0.6) * r, r * 0.55 + rnd.uniform(-0.2, 0.2)))
        clump(bm, c, r * 0.7, r * 0.7, r * 0.6, seed * 3 + k, amp=0.12); centres.append(c)
    o = new_obj("bush", bm, M["bush"], at, smooth=True)
    finish_crown(o, centres, 0.5, Vector((0, 0, r * 0.5)), (r * 1.3, r * 1.3, r * 1.1))

birch((14, -16, 0), 21, 16.0)
birch((21, -13, 0), 22, 14.0)
birch((-22, 6, 0), 23, 15.0)
for i, (x, y, r) in enumerate([(-9, -8, 1.4), (-6.5, -8.5, 1.1), (4, -8.2, 1.2), (6.5, -8, 1.0), (-14, -12, 2.2), (-17, -15, 1.8), (-2, 8, 1.3)]):
    bush((x, y, 0), 50 + i, r)
# lupins on the verge
bm = bmesh.new(); rnd = random.Random(3)
for k in range(110):
    x = rnd.uniform(-30, 10); y = rnd.uniform(-27.5, -22)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=5, radius1=0.07, radius2=0.01, depth=rnd.uniform(0.3, 0.5), matrix=Matrix.Translation((x, y, 0.25)))
new_obj("lupins", bm, M["lupin"])


# ============================================================ environment, read off the photos
M["bark"] = tm("h-bark", 0x1c110c, 0x3a2418, 0x6a4630, 0x9a7150, dapple=0.10)
M["asphalt"] = tm("h-asphalt", 0x30363c, 0x464e56, 0x5c6670, 0x7a8590, dapple=0.10)
M["line"]    = tm("h-line", 0xa0a8b0, 0xd0d6da, 0xf4f6f6, 0xffffff, dapple=0.02)
M["cloud"]   = tm("h-cloud", 0x8fb4d6, 0xb8d2ea, 0xf2f7fb, 0xffffff, dapple=0.05, rim=srgb(0xffffff))
M["hill"]    = tm("h-hill", 0x0f3a2a, 0x175236, 0x24703c, 0x3a8c48, dapple=0.14)
M["farspruce"] = tm("h-farspruce", 0x0c3230, 0x16503c, 0x22703c, 0x3c9848, dab=srgb(0x60b458), dabs=True, vary=(0.02, 0.14))
M["grass"]   = tm("h-grass", 0x2a6a24, 0x4a9a2e, 0x78c23a, 0xa4dc48, dapple=0.2, vary=(0.03, 0.15))
M["parsley"] = tm("h-parsley", 0xb8c0b0, 0xd8dcd0, 0xf6f8f2, 0xffffff, dapple=0.02)
M["stem"]    = tm("h-stem", 0x1e4a24, 0x2f7030, 0x4a9a3a, 0x6cb84a, dapple=0.05)
M["yellow"]  = tm("h-yellow", 0x7a6a10, 0xb89a1a, 0xe8c828, 0xffe860, dapple=0.08, dabs=True, vcol=True, dab=srgb(0xfff2a0))
M["redtile"] = tm("h-redtile", 0x5a2416, 0x8a3a22, 0xb85632, 0xd0764a, dapple=0.08, stripes=("v", 0.34, 0.10))
M["ditch"]   = tm("h-ditch", 0x1c4a20, 0x2c6a28, 0x4a8e32, 0x6ca83c, dapple=0.24)

# --- asphalt road with a dashed centre line and the verge/ditch on the house side
for o in list(sc.objects):
    if o.name in ("road", "verge"): bpy.data.objects.remove(o, do_unlink=True)
bm = bmesh.new(); prism(bm, [(-90, -36), (90, -36), (90, -29), (-90, -29)], 0.0, 0.08); new_obj("road", bm, M["asphalt"])
bm = bmesh.new()
for i in range(-30, 30):
    box(bm, i * 6 + 1.5, -32.5, 0.08, 3.0, 0.14, 0.01)
box(bm, 0, -29.3, 0.08, 180, 0.12, 0.01); box(bm, 0, -35.7, 0.08, 180, 0.12, 0.01)
new_obj("lines", bm, M["line"])
# the ditch: a shallow trough between road and lawn, its far bank rising to the lawn
bm = bmesh.new()
xs = list(range(-90, 91, 6))
prof = [(-29.0, 0.06), (-27.5, -0.35), (-25.5, -0.55), (-23.5, -0.25), (-21.5, 0.05), (-20.0, 0.0)]
vs = [[bm.verts.new((x, y, z)) for (y, z) in prof] for x in xs]
for i in range(len(xs) - 1):
    for j in range(len(prof) - 1):
        bm.faces.new([vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]])
new_obj("ditch", bm, M["ditch"], smooth=True)

# --- verge planting: tall grass, lupins with beaded spikes, cow parsley umbels, a hedgerow of bushes
rnd = random.Random(11)
bm = bmesh.new()
for k in range(900):
    x = rnd.uniform(-60, 40); y = rnd.uniform(-28.5, -20.5)
    z = -0.4 if -27.5 < y < -23.5 else 0.0
    h = rnd.uniform(0.25, 0.55)
    bmesh.ops.create_cone(bm, cap_ends=False, segments=3, radius1=0.035, radius2=0.0, depth=h, matrix=Matrix.Translation((x, y, z + h / 2)) @ Matrix.Rotation(rnd.uniform(-0.3, 0.3), 4, "X"))
new_obj("tallgrass", bm, M["grass"])
for o in list(sc.objects):
    if o.name == "lupins": bpy.data.objects.remove(o, do_unlink=True)
bms = bmesh.new(); bmf = bmesh.new()
for k in range(70):
    x = rnd.uniform(-34, 12); y = rnd.uniform(-28.5, -21)
    z = -0.4 if -27.5 < y < -23.5 else 0.0
    h = rnd.uniform(0.8, 1.3)
    bmesh.ops.create_cone(bms, cap_ends=False, segments=4, radius1=0.025, radius2=0.012, depth=h, matrix=Matrix.Translation((x, y, z + h / 2)))
    for j in range(9):
        t = 0.55 + 0.45 * j / 8
        r = 0.07 * (1 - 0.5 * (j / 8))
        bmesh.ops.create_icosphere(bmf, subdivisions=1, radius=r, matrix=Matrix.Translation((x, y, z + h * t)))
    for j in range(3):  # a few palmate leaves as flat discs
        a = rnd.uniform(0, 6.28)
        bmesh.ops.create_cone(bms, cap_ends=True, segments=6, radius1=0.16, radius2=0.16, depth=0.01, matrix=Matrix.Translation((x + math.cos(a) * 0.14, y + math.sin(a) * 0.14, z + 0.25)))
new_obj("lupin-stems", bms, M["stem"]); new_obj("lupin-flowers", bmf, M["lupin"])
bms = bmesh.new(); bmf = bmesh.new()
for k in range(45):
    x = rnd.uniform(-50, 30); y = rnd.uniform(-28.5, -21)
    z = -0.4 if -27.5 < y < -23.5 else 0.0
    h = rnd.uniform(0.7, 1.2)
    bmesh.ops.create_cone(bms, cap_ends=False, segments=4, radius1=0.02, radius2=0.012, depth=h, matrix=Matrix.Translation((x, y, z + h / 2)))
    for j in range(5):
        a = j / 5 * 6.283
        bmesh.ops.create_icosphere(bmf, subdivisions=1, radius=0.07, matrix=Matrix.Translation((x + math.cos(a) * 0.1, y + math.sin(a) * 0.1, z + h)) @ Matrix.Diagonal((1, 1, 0.5, 1)))
new_obj("parsley-stems", bms, M["stem"]); new_obj("parsley", bmf, M["parsley"])
for i, (x, y, r) in enumerate([(-30, -19.5, 2.0), (-25, -19, 1.5), (-19, -19.5, 2.0), (-13, -19, 1.6), (-7, -19.5, 1.3), (4, -19.5, 1.8), (9, -19, 1.3)]):
    bush((x, y, 0), 80 + i, r)
# the yellow-flowering shrub by the house wall (photo 2), and a small rowan on the verge
bm = bmesh.new(); centres = []
for k in range(5):
    c = Vector((rnd.uniform(-0.8, 0.8), rnd.uniform(-0.5, 0.5), 0.9 + rnd.uniform(-0.2, 0.2)))
    clump(bm, c, 1.0, 1.0, 0.9, 90 + k, amp=0.14); centres.append(c)
o = new_obj("yellowbush", bm, M["yellow"], (-8.6, -5.6, 0), smooth=True); finish_crown(o, centres, 0.5, Vector((0, 0, 0.9)), (1.8, 1.8, 1.5))

# --- the neighbour's red cottage with a red tile roof (photo 4, far left)
bm = bmesh.new(); prism(bm, [(-36, 4), (-27, 4), (-27, 11), (-36, 11)], 0, 3.0)
for sx_ in (-36, -27):
    vs = [bm.verts.new((sx_, 4, 3.0)), bm.verts.new((sx_, 11, 3.0)), bm.verts.new((sx_, 7.5, 5.0))]
    bm.faces.new(vs if sx_ > -36 else vs[::-1])
new_obj("cottage", bm, M["red"])
bm = bmesh.new(); gable_roof(bm, -31.5, 7.5, 3.0, 9, 7, 5.0, along="x", over=0.4); new_obj("cottageroof", bm, M["redtile"])

# --- forested hills behind: two ridges of low hills, and a dense low-poly spruce forest on them
HILLS = []
def hill_z_of(P, x, y):
    cx, cy, sx, sy, hmax, seed = P
    u = (x - cx) / sx; v = (y - cy) / sy
    if abs(u) > 0.5 or abs(v) > 0.5: return 0.0
    edge = max(0.0, 1 - (2 * abs(u)) ** 2) * max(0.0, 1 - (2 * abs(v)) ** 2)
    return max(0.0, hmax * edge * (0.7 + 0.5 * noise.noise(Vector((x * 0.012 + seed, y * 0.012, 0)))))

def hill(name, cx, cy, sx, sy, hmax, seed):
    HILLS.append((cx, cy, sx, sy, hmax, seed))
    bm = bmesh.new(); n = 40
    grid = [[None] * (n + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        for j in range(n + 1):
            u = i / n - 0.5; v = j / n - 0.5
            x = cx + u * sx; y = cy + v * sy
            grid[i][j] = bm.verts.new((x, y, hill_z_of((cx, cy, sx, sy, hmax, seed), x, y)))
    for i in range(n):
        for j in range(n):
            bm.faces.new([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
    o = new_obj(name, bm, M["hill"], smooth=True)
    return o

hills = [hill("hill-a", 60, 260, 520, 260, 55, 1.0), hill("hill-b", -140, 340, 480, 220, 70, 7.0), hill("hill-c", 240, 200, 260, 160, 32, 3.0)]
# sample hill height by nearest vertex (cheap enough for a few hundred trees)
def hill_height(x, y):
    return max([hill_z_of(P, x, y) for P in HILLS] + [0.0])

bmt = bmesh.new(); bmc = bmesh.new(); rnd = random.Random(5); planted = 0
for k in range(2600):
    x = rnd.uniform(-380, 380); y = rnd.uniform(110, 440)
    if y < 140 and abs(x) < 60: continue          # keep the lawn's far edge open
    z = hill_height(x, y)
    if z <= 0.3 and y < 130: continue
    H = rnd.uniform(11, 18)
    bmesh.ops.create_cone(bmt, cap_ends=False, segments=4, radius1=H * 0.02, radius2=0.02, depth=H * 0.5, matrix=Matrix.Translation((x, y, z + H * 0.25)))
    for j in range(4):
        t = j / 3; R = H * 0.16 * (1 - 0.75 * t) + 0.4
        bmesh.ops.create_icosphere(bmc, subdivisions=0, radius=1.0, matrix=Matrix.Translation((x, y, z + H * (0.3 + 0.6 * t))) @ Matrix.Diagonal((R, R, R * 0.6, 1)))
    planted += 1
new_obj("forest-trunks", bmt, M["bark"]); new_obj("forest", bmc, M["farspruce"])

# --- cumulus clouds
bm = bmesh.new(); rnd = random.Random(9); ccentres = []
for k in range(11):
    cx = rnd.uniform(-320, 320); cy = rnd.uniform(120, 520); cz = rnd.uniform(70, 130); S_ = rnd.uniform(30, 60)
    for j in range(7):
        c = Vector((cx + rnd.uniform(-1, 1) * S_ * 0.9, cy + rnd.uniform(-0.4, 0.4) * S_, cz + rnd.uniform(0, 0.55) * S_))
        r = S_ * rnd.uniform(0.35, 0.6)
        clump(bm, c, r, r * 0.8, r * 0.75, 100 + k * 9 + j, sub=2, amp=0.12, undercut=0.35); ccentres.append(c)
    # a flat base
    clump(bm, Vector((cx, cy, cz + S_ * 0.05)), S_ * 0.95, S_ * 0.6, S_ * 0.2, 200 + k, sub=2, amp=0.06, undercut=0.2); ccentres.append(Vector((cx, cy, cz)))
clouds = new_obj("clouds", bm, M["cloud"], smooth=True)
me = clouds.data; normals = []
for v in me.vertices:
    c = min(ccentres, key=lambda c: (v.co - c).length_squared); d = v.co - c; d.normalize()
    n = v.normal * 0.4 + d * 0.6; n.normalize(); normals.append(n)
me.normals_split_custom_set_from_vertices(normals)

# ------------------------------------------------------------ camera (the fourth photo: from the road, south-west, looking north-east), sun, sky
cam_data = bpy.data.cameras.new("HouseCam"); cam = bpy.data.objects.new("HouseCam", cam_data); coll.objects.link(cam)
VIEWS = [("a", (-27, -33, 2.6), (1, -1, 4.2), 32), ("b", (-6, -34, 2.2), (6, -6, 7.0), 24)]
def aim(loc, tgt, lens):
    cam.location = loc; cam_data.lens = lens
    d = Vector(tgt) - Vector(loc); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
sun_data = bpy.data.lights.new("HouseSun", "SUN"); sun_data.energy = 4.0; sun_data.angle = math.radians(3); sun_data.color = (1.0, 0.96, 0.88)
sun = bpy.data.objects.new("HouseSun", sun_data); sun.rotation_euler = (math.radians(52), math.radians(10), math.radians(-60)); coll.objects.link(sun)
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
sc.render.engine = "BLENDER_EEVEE_NEXT"; sc.eevee.taa_render_samples = 12
sc.render.resolution_x = 1600; sc.render.resolution_y = 1000; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"; sc.view_settings.view_transform = "Standard"
for tag, loc, tgt, lens in VIEWS:
    aim(loc, tgt, lens); sc.render.filepath = OUT + "-" + tag + ".png"; bpy.ops.render.render(write_still=True)
tri = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in sc.objects if o.type == "MESH" and o.name in ("plinth", "walls", "roof", "frames", "glass", "corners", "chimney", "door", "canopy", "steps", "pipes", "plinth2"))
bpy.context.window.scene = user_scene
print(json.dumps({"out": OUT, "planted": planted, "houseTris": tri, "active": bpy.context.window.scene.name}))
