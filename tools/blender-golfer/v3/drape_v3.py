"""Drape a garment over the body with Blender's cloth solver.

Until 12 November the garments were shells: the body's own faces lifted a
centimetre off the skin and smoothed, with sine-wave folds. They read as
painted on. Cloth has more fabric than the body under it and hangs from where
it is held, so here each garment is:

  1. subdivided (folds need edges well under a centimetre),
  2. given a few per cent more fabric than its shell (the solver's shrink
     factor, negative), which is what makes folds,
  3. pinned where it is held (the collar seam, the waistband) and released
     everywhere else,
  4. settled under gravity against the body for a second or two,
  5. frozen: the settled shape becomes the garment's rest mesh.

The runtime still skins the garment (no cloth simulation in the browser); the
folds are the rest shape's, as a tailored garment's largely are.
"""
import bpy
import numpy as np
import cloth_v3 as C

PIN = 'DrapePin'


def subdivide(ob, levels=1, simple=False):
    """Smooth subdivision that keeps the vertex groups, UVs and face attributes."""
    mod = ob.modifiers.new('Drape density', 'SUBSURF')
    mod.levels = levels; mod.render_levels = levels
    mod.subdivision_type = 'SIMPLE' if simple else 'CATMULL_CLARK'
    mod.boundary_smooth = 'PRESERVE_CORNERS'
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in ob.data.polygons:
        p.use_smooth = True
    return len(ob.data.vertices)


def set_pin(ob, weights):
    g = ob.vertex_groups.get(PIN) or ob.vertex_groups.new(name=PIN)
    w = np.clip(np.asarray(weights, dtype=np.float64), 0, 1)
    g.remove(list(range(len(w))))
    for i in np.nonzero(w > 1e-4)[0]:
        g.add([int(i)], float(w[i]), 'REPLACE')
    return g


def collider(ob, thickness=.003, friction=12.0):
    mod = next((m for m in ob.modifiers if m.type == 'COLLISION'), None) or ob.modifiers.new('Drape collider', 'COLLISION')
    c = ob.collision
    c.thickness_outer = thickness; c.thickness_inner = .012
    c.cloth_friction = friction; c.damping = .6
    return mod


def remove_collider(ob):
    for m in [m for m in ob.modifiers if m.type == 'COLLISION']:
        ob.modifiers.remove(m)


def drape(ob, colliders, pin, frames=44, grow=.03, bending=1.2, tension=18.0, shear=6.0, mass=.28,
          gap=.0035, quality=8, gravity=1.0, self_collision=False, air=1.4, fps=24, label=''):
    """Settle `ob` under gravity over the colliders; its mesh takes the settled shape.

    pin: per-vertex weights (1 holds a vertex where it is, 0 leaves it free).
    grow: the extra fabric as a share of every edge (0.03 = 3 % more cloth).
    Returns how far the cloth moved (mean and maximum, metres).
    """
    scene = bpy.context.scene
    before = C.coords(ob.data).copy()
    set_pin(ob, pin)
    made = [collider(c, gap) for c in colliders]
    mod = ob.modifiers.new('Drape', 'CLOTH')
    s = mod.settings
    s.quality = quality; s.mass = mass; s.time_scale = 1.0
    s.tension_stiffness = tension; s.compression_stiffness = tension
    s.shear_stiffness = shear; s.bending_stiffness = bending
    s.tension_damping = 6; s.compression_damping = 6; s.shear_damping = 6; s.bending_damping = .6
    s.air_damping = air
    s.vertex_group_mass = PIN; s.pin_stiffness = 1.0
    s.shrink_min = -abs(grow)
    s.effector_weights.gravity = gravity
    c = mod.collision_settings
    c.use_collision = True; c.distance_min = gap; c.collision_quality = 4
    c.use_self_collision = self_collision
    if self_collision:
        c.self_distance_min = .0025; c.self_friction = 5
    keep = (scene.frame_start, scene.frame_end, scene.frame_current, scene.render.fps)
    scene.render.fps = fps
    scene.frame_start = 1; scene.frame_end = frames + 1
    mod.point_cache.frame_start = 1; mod.point_cache.frame_end = frames + 1
    for f in range(1, frames + 2):
        scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    after = np.empty(len(ev.data.vertices) * 3); ev.data.vertices.foreach_get('co', after)
    after = after.reshape(-1, 3)
    ob.modifiers.remove(mod)
    for cob in colliders:
        remove_collider(cob)
    scene.frame_start, scene.frame_end = keep[0], keep[1]
    scene.render.fps = keep[3]
    scene.frame_set(keep[2])
    if len(after) != len(before) or not np.isfinite(after).all():
        raise RuntimeError(f'drape {label}: the solver returned a broken mesh')
    C.set_coords(ob.data, after)
    g = ob.vertex_groups.get(PIN)
    if g is not None:
        ob.vertex_groups.remove(g)
    moved = np.linalg.norm(after - before, axis=1)
    report = dict(vertices=len(after), mean_mm=round(float(moved.mean()) * 1000, 1), max_mm=round(float(moved.max()) * 1000, 1))
    print('DRAPE', label, report)
    return report


def relax(ob, iterations=2, factor=.3, keep=None):
    """A light smoothing after the solve: it takes the last solver noise off the folds."""
    C.smooth(ob.data, iterations, factor, pin=keep if keep is not None else C.boundary_vertices(ob.data))


def calm(ob, limit=.5, rounds=6):
    """Take crumples out: where a face has turned far from its neighbours' average, smooth there.

    The solver has no self-collision here (it would triple the build time), so a
    pinched spot can fold over itself. Such a spot shows as faces whose normals
    disagree sharply with the faces round them; those vertices are relaxed until
    the surface is a fold again, not a knot.
    """
    me = ob.data
    nb = C.neighbours(me)
    total = 0
    for _ in range(rounds):
        me.update()
        pn = np.empty(len(me.polygons) * 3); me.polygons.foreach_get('normal', pn); pn = pn.reshape(-1, 3)
        vn = C.normals(me)
        bad = set()
        for p in me.polygons:
            for v in p.vertices:
                if float(pn[p.index] @ vn[v]) < limit:
                    bad.add(v)
        if not bad:
            break
        ring = set(bad)
        for v in bad:
            ring.update(nb[v])
        co = C.coords(me)
        new = co.copy()
        for _it in range(4):
            for v in ring:
                if nb[v]:
                    new[v] = co[v] * .4 + co[nb[v]].mean(axis=0) * .6
            co = new.copy()
        C.set_coords(me, co)
        total = max(total, len(bad))
    print('CALM', ob.name, total)
    return total


def thin(ob, ratio, protect=(), rings=1, label=''):
    """Take a draped garment down to a share of its faces, where the cloth is flat.

    The solver needs edges well under a centimetre; the runtime does not need
    them where the cloth lies smooth. An error-driven collapse keeps the folds'
    edges and merges the flat cloth between them. The garment's borders (hems,
    the neckline) and any protected vertices (a seam another part is cut along)
    stay exactly where they are, with a ring of cloth round them.
    """
    me = ob.data
    before = len(me.polygons)
    keep = set(C.boundary_vertices(me)) | set(protect)
    nb = C.neighbours(me)
    for _ in range(rings):
        keep |= {j for i in keep for j in nb[i]}
    g = ob.vertex_groups.new(name='DrapeThin')
    free = [i for i in range(len(me.vertices)) if i not in keep]
    g.add(free, 1.0, 'REPLACE')
    mod = ob.modifiers.new('Drape thin', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'; mod.ratio = ratio
    # A vertex outside the group costs its edges' length fifty times over: it is not collapsed.
    mod.vertex_group = 'DrapeThin'; mod.vertex_group_factor = 50.0
    mod.use_collapse_triangulate = False; mod.use_symmetry = False
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    g = ob.vertex_groups.get('DrapeThin')
    if g is not None:
        ob.vertex_groups.remove(g)
    for p in ob.data.polygons:
        p.use_smooth = True
    report = dict(faces_before=before, faces_after=len(ob.data.polygons), vertices=len(ob.data.vertices))
    print('THIN', label, report)
    return report
