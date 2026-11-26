"""What a ground's campus build needs from Blender, shared (Blender 5.2+, headless, data API only).

A campus script (`<build>/facilities/build_campus.py`) states its buildings in their own frames, from measured
levels, and this writes the GLB and the manifest the app's loader reads (apps/golf/src/engine/scenery/
campus-facilities.mjs). Bro Hof's script, the first, carries its own copy of these ideas; Tjusta's is the first
to use this module.

Frames. A building is drawn in its own metres: u along its ridge, v to the left of u, z in RH 2000. `Frame`
turns that onto the ground's grid, and the scene is laid out so that the glTF exporter's Y-up conversion gives
the app's frame exactly: Blender X = easting - origin, Y = northing - origin, Z = RH 2000.

Faces. Every face is given with the way it looks (`out`, a rough direction in the building's own frame), and is
wound to face that way, so a roof is lit from above and a wall from outside whatever order its corners came in.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy
import numpy as np


def linear(hex_colour):
    """An sRGB colour (0xRRGGBB) as the linear triple a Principled BSDF takes."""
    def one(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(round(one((hex_colour >> shift) & 255), 4) for shift in (16, 8, 0))


class Terrain:
    """The acquired 1 m terrain of a ground (RH 2000), bilinear."""

    def __init__(self, directory):
        meta = json.loads((Path(directory) / 'l0.json').read_text(encoding='utf-8'))
        self.meta = meta
        self.z = np.memmap(Path(directory) / 'l0.f32', dtype='<f4', mode='r', shape=(meta['height'], meta['width']))

    def __call__(self, e, n):
        x, y = e - self.meta['originEasting'], self.meta['originNorthing'] - n
        i, j = int(x), int(y)
        a, b = x - i, y - j
        z = self.z
        return float((z[j, i] * (1 - a) + z[j, i + 1] * a) * (1 - b) + (z[j + 1, i] * (1 - a) + z[j + 1, i + 1] * a) * b)


class Frame:
    """A building's own frame on the ground's grid: an origin in EPSG:3006 and the bearing of its u axis."""

    def __init__(self, ground_origin, easting, northing, bearing_degrees):
        b = math.radians(bearing_degrees)
        self.ground = ground_origin
        self.at = (easting, northing)
        self.u = (math.sin(b), math.cos(b))
        self.v = (-self.u[1], self.u[0])

    def grid(self, u, v):
        """A point of the frame in EPSG:3006."""
        return (self.at[0] + u * self.u[0] + v * self.v[0], self.at[1] + u * self.u[1] + v * self.v[1])

    def scene(self, p):
        e, n = self.grid(p[0], p[1])
        return (e - self.ground[0], n - self.ground[1], p[2])

    def turn(self, d):
        """A direction of the frame in the scene."""
        return (d[0] * self.u[0] + d[1] * self.v[0], d[0] * self.u[1] + d[1] * self.v[1], d[2])


class Mesh:
    """Faces by material, given in one or more frames and kept in the scene's metres."""

    def __init__(self, frame):
        self.frame = frame
        self.parts = {}

    def face(self, mat, pts, out):
        """A convex face as a fan, wound to look the way `out` points (the frame's own directions)."""
        own = [self.frame.scene(p) for p in pts]
        hint = self.frame.turn(out)
        n = [0.0, 0.0, 0.0]
        for a, b in zip(own, own[1:] + own[:1]):      # Newell's normal
            n[0] += (a[1] - b[1]) * (a[2] + b[2])
            n[1] += (a[2] - b[2]) * (a[0] + b[0])
            n[2] += (a[0] - b[0]) * (a[1] + b[1])
        if math.hypot(*n) < 1e-9:
            return
        if n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0:
            own.reverse()
        verts, faces = self.parts.setdefault(mat, ([], []))
        k = len(verts)
        verts.extend(own)
        faces.extend((k, k + i, k + i + 1) for i in range(1, len(own) - 1))

    def box(self, mat, u0, u1, v0, v1, z0, z1, bottom=False):
        u0, u1, v0, v1, z0, z1 = min(u0, u1), max(u0, u1), min(v0, v1), max(v0, v1), min(z0, z1), max(z0, z1)
        self.face(mat, [(u0, v0, z0), (u1, v0, z0), (u1, v0, z1), (u0, v0, z1)], (0, -1, 0))
        self.face(mat, [(u0, v1, z0), (u1, v1, z0), (u1, v1, z1), (u0, v1, z1)], (0, 1, 0))
        self.face(mat, [(u0, v0, z0), (u0, v1, z0), (u0, v1, z1), (u0, v0, z1)], (-1, 0, 0))
        self.face(mat, [(u1, v0, z0), (u1, v1, z0), (u1, v1, z1), (u1, v0, z1)], (1, 0, 0))
        self.face(mat, [(u0, v0, z1), (u1, v0, z1), (u1, v1, z1), (u0, v1, z1)], (0, 0, 1))
        if bottom:
            self.face(mat, [(u0, v0, z0), (u1, v0, z0), (u1, v1, z0), (u0, v1, z0)], (0, 0, -1))

    @staticmethod
    def _point(axis, along, across, z):
        return (along, across, z) if axis == 'u' else (across, along, z)

    def roof(self, mat, profile, a0, a1, axis='u', edge=None, drop=0.22):
        """A roof whose section `profile` [(across, z), ...] runs from a0 to a1 along `axis`; `edge` hangs a
        board `drop` deep under both eaves and both verges."""
        P = lambda along, c, z: self._point(axis, along, c, z)
        for (c0, z0), (c1, z1) in zip(profile, profile[1:]):
            self.face(mat, [P(a0, c0, z0), P(a1, c0, z0), P(a1, c1, z1), P(a0, c1, z1)], (0, 0, 1))
        if not edge:
            return
        side = (lambda s: (s, 0, 0)) if axis == 'u' else (lambda s: (0, s, 0))
        across = (lambda s: (0, s, 0)) if axis == 'u' else (lambda s: (s, 0, 0))
        for a, s in ((a0, -1), (a1, 1)):               # the verges
            for (c0, z0), (c1, z1) in zip(profile, profile[1:]):
                self.face(edge, [P(a, c0, z0), P(a, c1, z1), P(a, c1, z1 - drop), P(a, c0, z0 - drop)], side(s))
        for (c, z), s in ((profile[0], -1 if profile[0][0] < profile[-1][0] else 1), (profile[-1], 1 if profile[0][0] < profile[-1][0] else -1)):
            self.face(edge, [P(a0, c, z), P(a1, c, z), P(a1, c, z - drop), P(a0, c, z - drop)], across(s))

    def gable(self, mat, section, at, axis='u', out=1):
        """An end wall: `section` [(across, z), ...] is its outline, standing at `at` along `axis`."""
        P = lambda c, z: self._point(axis, at, c, z)
        self.face(mat, [P(c, z) for c, z in section], (out, 0, 0) if axis == 'u' else (0, out, 0))

    def wall(self, mat, p, q, z0, z1, out):
        """An upright wall from p to q (u, v), looking the way `out` (u, v) points."""
        self.face(mat, [(p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1), (p[0], p[1], z1)], (out[0], out[1], 0))

    def panel(self, mat, p, q, z0, z1, out, proud=0.04):
        """A board, door or pane laid on a wall, `proud` metres off it."""
        d = math.hypot(out[0], out[1]) or 1.0
        o = (out[0] / d * proud, out[1] / d * proud)
        self.wall(mat, (p[0] + o[0], p[1] + o[1]), (q[0] + o[0], q[1] + o[1]), z0, z1, out)

    def window(self, p, q, z0, z1, out, frame='frame', glass='glass', surround='trim', bars=(2, 2)):
        """A window laid on a wall between p and q: a surround, a frame and panes with glazing bars."""
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        d = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
        at = lambda s: (p[0] + d[0] * s, p[1] + d[1] * s)
        self.panel(surround, at(-0.14), at(L + 0.14), z0 - 0.14, z1 + 0.14, out, 0.03)
        self.panel(frame, at(0), at(L), z0, z1, out, 0.05)
        t = 0.07
        self.panel(glass, at(t), at(L - t), z0 + t, z1 - t, out, 0.06)
        for i in range(1, bars[0]):
            s = L * i / bars[0]
            self.panel(frame, at(s - 0.02), at(s + 0.02), z0 + t, z1 - t, out, 0.07)
        for j in range(1, bars[1]):
            z = z0 + (z1 - z0) * j / bars[1]
            self.panel(frame, at(t), at(L - t), z - 0.02, z + 0.02, out, 0.07)

    def disc(self, mat, centre, radius, out, proud=0.05, n=16):
        """A round vent or sign on a wall: `centre` is (u, v, z) on the wall."""
        d = math.hypot(out[0], out[1]) or 1.0
        o = (out[0] / d, out[1] / d)
        t = (-o[1], o[0])
        c = (centre[0] + o[0] * proud, centre[1] + o[1] * proud, centre[2])
        self.face(mat, [(c[0] + t[0] * radius * math.cos(2 * math.pi * i / n), c[1] + t[1] * radius * math.cos(2 * math.pi * i / n),
                         c[2] + radius * math.sin(2 * math.pi * i / n)) for i in range(n)], (out[0], out[1], 0))

    def rail(self, mat, p, q, z, height=1.05, posts=1.6, slat=0.13):
        """A timber balustrade from p to q on a floor at z: posts, a top and a bottom rail, and upright slats."""
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        if L < 0.3:
            return
        d = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
        n = (d[1], -d[0])

        def bar(s0, s1, half, za, zb):
            c = [(p[0] + d[0] * s + n[0] * o, p[1] + d[1] * s + n[1] * o) for s, o in ((s0, half), (s1, half), (s1, -half), (s0, -half))]
            self.face(mat, [(*c[0], za), (*c[1], za), (*c[1], zb), (*c[0], zb)], (n[0], n[1], 0))
            self.face(mat, [(*c[3], za), (*c[2], za), (*c[2], zb), (*c[3], zb)], (-n[0], -n[1], 0))
            self.face(mat, [(*c[0], za), (*c[3], za), (*c[3], zb), (*c[0], zb)], (-d[0], -d[1], 0))
            self.face(mat, [(*c[1], za), (*c[2], za), (*c[2], zb), (*c[1], zb)], (d[0], d[1], 0))
            self.face(mat, [(*c[0], zb), (*c[1], zb), (*c[2], zb), (*c[3], zb)], (0, 0, 1))
        bar(0, L, 0.045, z + height - 0.07, z + height)
        bar(0, L, 0.03, z + 0.1, z + 0.17)
        k = max(1, round(L / posts))
        for i in range(k + 1):
            s = L * i / k
            bar(max(0, s - 0.06), min(L, s + 0.06), 0.06, z, z + height + 0.03)
        m = max(1, int(L / slat))
        for i in range(m):
            s = (i + 0.5) * L / m
            self.face(mat, [(p[0] + d[0] * (s - 0.04), p[1] + d[1] * (s - 0.04), z + 0.17), (p[0] + d[0] * (s + 0.04), p[1] + d[1] * (s + 0.04), z + 0.17),
                            (p[0] + d[0] * (s + 0.04), p[1] + d[1] * (s + 0.04), z + height - 0.07), (p[0] + d[0] * (s - 0.04), p[1] + d[1] * (s - 0.04), z + height - 0.07)], (n[0], n[1], 0))

    def bounds(self):
        pts = [v for verts, _ in self.parts.values() for v in verts]
        return [min(p[k] for p in pts) for k in range(3)], [max(p[k] for p in pts) for k in range(3)]

    def triangles(self):
        return sum(len(faces) for _, faces in self.parts.values())

    def build(self, name, collection):
        obj = bpy.data.objects.new(name, None)
        collection.objects.link(obj)
        for mat, (verts, faces) in sorted(self.parts.items()):
            me = bpy.data.meshes.new(f'{name}-{mat}')
            me.from_pydata(verts, [], faces)
            me.materials.append(bpy.data.materials[mat])
            me.validate()
            me.shade_smooth()                    # corners are shared only inside one flat face
            child = bpy.data.objects.new(f'{name}-{mat}', me)
            child.parent = obj
            collection.objects.link(child)
        return obj


def write_campus(out, *, ground_id, course_slugs, origin, scene_name, materials, facilities, terrain):
    """Build every facility, export one GLB and write the manifest beside it.

    `materials`: name -> (linear rgb, roughness). `facilities`: dicts with id, node, mesh (a built Mesh), sources,
    anchor (e, n), footprint [(e, n), ...] or None, plants (keeps its vegetation) and evidence."""
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.data.scenes.new(scene_name)
    col = bpy.data.collections.new(scene_name)
    scene.collection.children.link(col)
    for name, (rgb, rough) in materials.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = 0.0
        mat.use_backface_culling = False
    records = []
    for spec in facilities:
        mesh = spec['mesh']
        obj = mesh.build(spec['node'], col)
        obj['facilityId'] = spec['id']
        obj['sourceBuildingIds'] = spec['sources']
        lo, hi = mesh.bounds()
        plan = spec.get('footprint') or [(origin[0] + x, origin[1] + y) for x, y in ((lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1]))]
        records.append(dict(id=spec['id'], nodeName=spec['node'], sourceBuildingIds=spec['sources'],
                            footprintLocal=[[round(e - origin[0], 2), round(origin[1] - n, 2)] for e, n in plan],
                            groundAnchorLocal=[round(spec['anchor'][0] - origin[0], 2), round(origin[1] - spec['anchor'][1], 2)],
                            groundAnchorRh2000M=round(terrain(*spec['anchor']), 2), placement='absolute-rh2000',
                            boundsLocalRh2000=dict(min=[round(lo[0], 3), round(lo[2], 3), round(-hi[1], 3)], max=[round(hi[0], 3), round(hi[2], 3), round(-lo[1], 3)]),
                            excludeVegetation=not spec.get('plants', False), triangles=mesh.triangles(), evidence=spec['evidence']))
        print(spec['id'], 'triangles', mesh.triangles())
    glb = out / 'facilities.glb'
    win = bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None
    if win:
        win.scene = scene
    with bpy.context.temp_override(scene=scene):
        bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_active_scene=True, export_yup=True, export_apply=False,
                                  export_texcoords=False, export_normals=True, export_tangents=False, export_materials='EXPORT',
                                  export_animations=False, export_skins=False, export_morph=False, export_lights=False, export_cameras=False,
                                  export_extras=True)
    data = glb.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    manifest = dict(schemaVersion=1, groundId=ground_id, courseSlugs=course_slugs,
                    coordinateFrame=dict(kind='epsg3006-local-rh2000', originEasting=origin[0], originNorthing=origin[1], axes='east-up-south', heightDatum='RH2000'),
                    asset=dict(url=f'models/{ground_id}/facilities-{digest}.glb', sha256=digest, bytes=len(data)),
                    replacesRangeFacilities=False, replacesCourtyard=False, facilities=records)
    (out / 'facilities-v1.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf-8', newline='\n')
    print('glb', len(data), digest, 'triangles', sum(r['triangles'] for r in records))
    return manifest
