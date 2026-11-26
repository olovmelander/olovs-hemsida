"""Model a low, multi-stem shrub for the existing undergrowth instances.

Run from the repository root with blender -b -P tools/blender-tree-study/realistic/woodland_shrub.py.
The packed mesh shares the resident broadleaf sprig atlas. Axes and extents in
the exported mesh match the existing Y-up ground-cover template, in metres.
"""
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


def build_shrub():
    rng = random.Random(81206)
    vertices, normals, faces, cells = [], [], [], []
    # Several stems share a low stool. Lateral shoots form the lower skirt,
    # with younger upright shoots above it. Sprigs overlap in depth.
    for stem in range(10):
        angle = stem * 2.39996 + rng.uniform(-0.15, 0.15)
        radial = Vector((math.cos(angle), math.sin(angle), 0))
        side = Vector((-radial.y, radial.x, 0))
        outer = stem < 7
        reach = rng.uniform(0.34, 0.49) if outer else rng.uniform(0.12, 0.26)
        rise = rng.uniform(0.33, 0.46) if outer else rng.uniform(0.50, 0.65)
        leader = radial * reach + Vector((0, 0, rise))
        for fork in (-1, 0, 1):
            base = leader * (0.34 if fork else 0.08)
            tip = leader + side * (0.22 * fork) + Vector((0, 0, rng.uniform(-0.02, 0.08)))
            direction = (tip - base).normalized()
            face = (radial + side * fork * 0.70 + Vector((0, 0, rng.uniform(0.1, 0.4)))).normalized()
            across = direction.cross(face).normalized() * rng.uniform(0.16, 0.23)
            start = len(vertices)
            cells.append(rng.randrange(4))
            for p in (base - across, base + across, tip + across, tip - across):
                vertices.append(p)
                normal = Vector((p.x, p.y, (p.z - 0.27) * 1.9))
                normals.append((normal.normalized() * 0.73 + face * 0.27).normalized())
            faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new('Woodland shrub sprays')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.polygons.foreach_set('use_smooth', [True] * len(faces))
    mesh.normals_split_custom_set_from_vertices(normals)
    sprig_uv = mesh.uv_layers.new(name='Sprig')
    for poly, cell in zip(mesh.polygons, cells):
        for loop, (u, v) in zip(poly.loop_indices, ((0, 0), (1, 0), (1, 1), (0, 1))):
            sprig_uv.data[loop].uv = ((cell % 2 + 0.02 + 0.96 * u) / 2, (1 - cell // 2 + 0.02 + 0.96 * v) / 2)
    scene = bpy.data.scenes.new('Banvy woodland shrub')
    scene.collection.objects.link(bpy.data.objects.new(mesh.name, mesh))
    return mesh


def export(mesh):
    positions = [Vector((v.co.x, v.co.z, -v.co.y)) for v in mesh.vertices]
    source_min = [min(p[i] for p in positions) for i in range(3)]
    source_max = [max(p[i] for p in positions) for i in range(3)]
    # The bound of puffyBushGeometry, including its existing ground sink.
    low = (-0.638674, -0.021339, -0.647899)
    high = (0.578500, 0.717805, 0.574278)
    scale = [(high[i] - low[i]) / (source_max[i] - source_min[i]) for i in range(3)]
    uv = mesh.uv_layers.active
    result = dict(position=[], normal=[], uv=[], index=[])
    for poly in mesh.polygons:
        base = len(result['position']) // 3
        for loop in poly.loop_indices:
            p = positions[mesh.loops[loop].vertex_index]
            n = mesh.corner_normals[loop].vector
            normal = Vector((n.x / scale[0], n.z / scale[1], -n.y / scale[2])).normalized()
            result['position'].extend(round(low[i] + (p[i] - source_min[i]) * scale[i], 5) for i in range(3))
            result['normal'].extend(round(v, 5) for v in normal)
            u, v = uv.data[loop].uv
            result['uv'].extend((round(u, 4), round(1 - v, 4)))
        result['index'].extend(base + i for i in (0, 1, 2, 0, 2, 3))
    target = Path('apps/golf/src/data/woodland-shrub.json')
    target.write_text(json.dumps(result, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    export(build_shrub())
