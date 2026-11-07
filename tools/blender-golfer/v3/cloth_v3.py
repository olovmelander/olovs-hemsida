"""Garment geometry tools: regions cut from the fitted body and tailored.

A garment starts as a copy of the body faces it covers (same topology, so the
skin weights copy across). It is then shaped like cloth: lifted off the skin,
smoothed so no anatomy shows through, bridged across hollows (each horizontal
slice is blended toward its convex hull), and cut square at its hems.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector as V, Matrix
from mathutils.bvhtree import BVHTree


def lin(rgb):
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb)


def hexrgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def material(name, color, rough=.7, metal=0.0, sheen=0.0, normal_image=None, normal_strength=.6, uv_scale=None,
             color_image=None, specular=.5, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    rgb = lin(hexrgb(color)) if isinstance(color, str) else lin(color)
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = specular
    # No sheen: glTF carries it as KHR_materials_sheen, which washes fabric out in three.js.
    if coat and 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = coat
    m.diffuse_color = (*rgb, 1)
    if color_image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = color_image
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if normal_image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = normal_image
        normal_image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


# -- mesh helpers --------------------------------------------------------------

def coords(me):
    a = np.empty(len(me.vertices) * 3, dtype=np.float64); me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def set_coords(me, a):
    me.vertices.foreach_set('co', np.asarray(a, dtype=np.float64).ravel()); me.update()


def normals(me):
    me.update()
    a = np.empty(len(me.vertices) * 3, dtype=np.float64)
    if hasattr(me, 'vertex_normals'):
        me.vertex_normals.foreach_get('vector', a)
    else:
        me.vertices.foreach_get('normal', a)
    return a.reshape(-1, 3)


def face_sets(me):
    a = np.empty(len(me.polygons), dtype=np.int32)
    me.attributes['.sculpt_face_set'].data.foreach_get('value', a)
    return a


def extract(body, face_mask, name, collection, copy_weights=True):
    """New object from the body faces where face_mask is True (same vertex order map)."""
    me = body.data
    polys = [p for p, keep in zip(me.polygons, face_mask) if keep]
    used = sorted({i for p in polys for i in p.vertices})
    remap = {o: n for n, o in enumerate(used)}
    co = coords(me)[used]
    faces = [[remap[i] for i in p.vertices] for p in polys]
    new = bpy.data.meshes.new(name)
    new.from_pydata(co.tolist(), [], faces); new.update()
    # UVs (the body's UDIM layout, used for tiling fabric textures).
    if me.uv_layers:
        src = me.uv_layers[0].data; uv = new.uv_layers.new(name='UVMap')
        k = 0
        for p in polys:
            for li in p.loop_indices:
                uv.data[k].uv = src[li].uv; k += 1
    ob = bpy.data.objects.new(name, new); collection.objects.link(ob)
    for p in new.polygons:
        p.use_smooth = True
    if '.sculpt_face_set' in me.attributes:
        src_fs = face_sets(me)[np.array([p.index for p in polys])]
        attr = new.attributes.new('body_face_set', 'INT', 'FACE')
        attr.data.foreach_set('value', src_fs.astype(np.int32))
    if copy_weights:
        names = {g.index: g.name for g in body.vertex_groups}
        groups = {}
        for n_i, o_i in enumerate(used):
            for g in me.vertices[o_i].groups:
                gn = names[g.group]
                if gn not in groups:
                    groups[gn] = ob.vertex_groups.new(name=gn)
                groups[gn].add([n_i], g.weight, 'REPLACE')
    ob['source_vertices'] = used
    return ob, np.array(used)


def neighbours(me):
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices; nb[a].append(b); nb[b].append(a)
    return nb


def boundary_vertices(me):
    bm = bmesh.new(); bm.from_mesh(me)
    out = {v.index for e in bm.edges if e.is_boundary for v in e.verts}
    bm.free(); return out


def smooth(me, iterations=10, factor=.5, pin=None, weights=None):
    """Laplacian smoothing; pinned vertices stay put, weights scale per vertex."""
    co = coords(me); nb = neighbours(me)
    pin = pin if pin is not None else set()
    w = np.ones(len(co)) * factor if weights is None else np.asarray(weights) * factor
    idx = [np.array(n, dtype=np.int64) for n in nb]
    for _ in range(iterations):
        avg = np.array([co[n].mean(axis=0) if len(n) else co[i] for i, n in enumerate(idx)])
        new = co + (avg - co) * w[:, None]
        for i in pin:
            new[i] = co[i]
        co = new
    set_coords(me, co)


def inflate(me, amount):
    """Move each vertex out along its normal (amount: scalar or per-vertex)."""
    co = coords(me); n = normals(me)
    amt = np.asarray(amount, dtype=np.float64)
    if amt.ndim == 0:
        amt = np.full(len(co), float(amt))
    set_coords(me, co + n * amt[:, None])


def hull2d(points):
    pts = sorted(set(map(tuple, points)))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def project_to_hull(p, hull, centre):
    """Point on the hull boundary along the ray from centre through p."""
    d = np.array(p) - centre
    best = None
    n = len(hull)
    for i in range(n):
        a = np.array(hull[i]); b = np.array(hull[(i + 1) % n])
        e = b - a
        m = np.array([[d[0], -e[0]], [d[1], -e[1]]])
        det = np.linalg.det(m)
        if abs(det) < 1e-12:
            continue
        t, u = np.linalg.solve(m, a - centre)
        if t > 0 and -1e-6 <= u <= 1 + 1e-6:
            if best is None or t < best:
                best = t
    if best is None:
        return np.array(p)
    return centre + d * best


def bridge_slices(me, axis_point, axis_dir, amount, step=.012, select=None, outward_only=True):
    """Blend each slice perpendicular to an axis toward its convex hull.

    Cloth spans the hollows of the body (under the bust, the small of the back,
    between the shoulder blades) instead of following them.
    """
    co = coords(me)
    a = np.array(axis_point, dtype=np.float64); d = np.array(axis_dir, dtype=np.float64); d /= np.linalg.norm(d)
    ref = np.array([1.0, 0, 0]) if abs(d[0]) < .9 else np.array([0, 1.0, 0])
    e1 = ref - d * d.dot(ref); e1 /= np.linalg.norm(e1); e2 = np.cross(d, e1)
    rel = co - a
    h = rel @ d; u = rel @ e1; v = rel @ e2
    idx = np.arange(len(co)) if select is None else np.asarray(select)
    out = co.copy()
    amt = np.asarray(amount, dtype=np.float64)
    if amt.ndim == 0:
        amt = np.full(len(co), float(amt))
    lo, hi = h[idx].min(), h[idx].max()
    k = lo
    while k <= hi:
        band = idx[(h[idx] >= k - step * .5) & (h[idx] < k + step * .5)]
        if len(band) >= 6:
            pts = np.stack([u[band], v[band]], axis=1)
            hull = hull2d([tuple(np.round(p, 6)) for p in pts])
            if len(hull) >= 3:
                c = pts.mean(axis=0)
                for i in band:
                    p = np.array([u[i], v[i]])
                    q = project_to_hull(p, hull, c)
                    if outward_only and np.linalg.norm(q - c) < np.linalg.norm(p - c):
                        continue
                    nq = p + (q - p) * amt[i]
                    out[i] = a + d * h[i] + e1 * nq[0] + e2 * nq[1]
        k += step
    set_coords(me, out)


def cut_plane(ob, point, normal, keep_positive=True):
    """Bisect a garment by a plane and drop one side (a clean hem)."""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=V(point), plane_no=V(normal),
                           clear_inner=keep_positive, clear_outer=not keep_positive)
    bm.to_mesh(me); bm.free(); me.update()


def solidify(ob, thickness, offset=-1.0, rim=True):
    mod = ob.modifiers.new('Cloth thickness', 'SOLIDIFY')
    mod.thickness = thickness; mod.offset = offset; mod.use_rim = rim; mod.use_even_offset = False
    mod.thickness_clamp = 1.0; mod.use_quality_normals = True
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def smooth_weights(ob, iterations=4, keep=.45):
    me = ob.data; nb = neighbours(me)
    names = [g.name for g in ob.vertex_groups]
    W = np.zeros((len(me.vertices), len(names)))
    for v in me.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    for _ in range(iterations):
        avg = np.array([W[n].mean(axis=0) if n else W[i] for i, n in enumerate(nb)])
        W = W * keep + avg * (1 - keep)
    # Top four influences, normalised.
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    groups = [ob.vertex_groups.new(name=n) for n in names]
    for i in range(len(W)):
        row = W[i]; top = np.argsort(-row)[:4]; s = row[top].sum()
        if s <= 0:
            continue
        for j in top:
            if row[j] > 1e-4:
                groups[j].add([i], float(row[j] / s), 'REPLACE')


def transfer_weights(target, source, max_distance=.2):
    """Nearest-surface weights from source (e.g. the body) onto a new mesh."""
    mod = target.modifiers.new('Weights from body', 'DATA_TRANSFER')
    mod.object = source; mod.use_vert_data = True; mod.data_types_verts = {'VGROUP_WEIGHTS'}
    mod.vert_mapping = 'POLYINTERP_NEAREST'
    mod.layers_vgroup_select_src = 'ALL'; mod.layers_vgroup_select_dst = 'NAME'
    for g in source.vertex_groups:
        if g.name not in target.vertex_groups:
            target.vertex_groups.new(name=g.name)
    with bpy.context.temp_override(object=target, active_object=target, selected_objects=[target]):
        bpy.ops.object.datalayout_transfer(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=mod.name)


def rigid(ob, bone, weight=1.0):
    g = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), weight, 'REPLACE')


def assign_material(ob, mat, faces=None):
    me = ob.data
    if mat.name not in [m.name for m in me.materials if m]:
        me.materials.append(mat)
    idx = [m.name for m in me.materials].index(mat.name)
    for p in me.polygons:
        if faces is None or p.index in faces:
            p.material_index = idx


def tube(name, points, radii, collection, sides=12, closed=False, caps=True):
    verts = []; faces = []
    pts = [V(p) for p in points]; n = len(pts)
    prev = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]) if not closed else (pts[(i + 1) % n] - pts[(i - 1) % n])
        t.normalize()
        if prev is None:
            ref = V((0, 0, 1)) if abs(t.z) < .9 else V((1, 0, 0))
            u = (ref - t * t.dot(ref)).normalized()
        else:
            u = (prev - t * t.dot(prev)).normalized()
        prev = u; w = t.cross(u)
        rx, ry = radii[i] if isinstance(radii[i], (tuple, list)) else (radii[i], radii[i])
        for j in range(sides):
            a = 2 * math.pi * j / sides
            verts.append(p + u * (rx * math.cos(a)) + w * (ry * math.sin(a)))
    rings = n if not closed else n
    for i in range(rings - (0 if closed else 1)):
        for j in range(sides):
            a = i * sides + j; b = i * sides + (j + 1) % sides
            c = ((i + 1) % n) * sides + (j + 1) % sides; d = ((i + 1) % n) * sides + j
            faces.append((a, b, c, d))
    if caps and not closed:
        faces.append(tuple(reversed(range(sides)))); faces.append(tuple((n - 1) * sides + j for j in range(sides)))
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
    ob = bpy.data.objects.new(name, me); collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def join(objects, name):
    objects = [o for o in objects if o is not None]
    if not objects:
        return None
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    with bpy.context.temp_override(active_object=objects[0], object=objects[0], selected_objects=objects,
                                   selected_editable_objects=objects):
        bpy.ops.object.join()
    ob = objects[0]; ob.name = name
    return ob


def delete_body_faces(body, face_mask):
    """Remove skin hidden under clothes (keeps the runtime free of poke-through)."""
    me = body.data
    bm = bmesh.new(); bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    kill = [bm.faces[i] for i, k in enumerate(face_mask) if k]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me); bm.free(); me.update()


def shrink_mask(me, mask, rings=2):
    """Erode a face mask by n rings of neighbouring faces (a margin under hems)."""
    mask = np.array(mask, dtype=bool)
    vf = [[] for _ in me.vertices]
    for p in me.polygons:
        for v in p.vertices:
            vf[v].append(p.index)
    for _ in range(rings):
        edge = set()
        for p in me.polygons:
            if mask[p.index]:
                for v in p.vertices:
                    if any(not mask[f] for f in vf[v]):
                        edge.add(p.index); break
        for i in edge:
            mask[i] = False
    return mask
