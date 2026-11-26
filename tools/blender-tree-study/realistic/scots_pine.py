"""Blender models for the inland and Kronholmen Scots pines.

Run from the repository root:
  blender -b --factory-startup -P tools/blender-tree-study/realistic/scots_pine.py -- <work>
  blender -b --factory-startup -P tools/blender-tree-study/realistic/scots_pine_sprigs.py -- <work>
  node tools/blender-tree-study/realistic/pack_scots_pine.mjs <work>

Metres, original variant seeds, all six faces of the crown envelope, the root
anchor, and both tiers' budgets come from the corresponding shipped catalogue.
"""
import json
import math
import random
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from realistic_trees import Wood, coastal_wood, flat, preview, variant_params

ROOT = Path('apps/golf/public/models/trees')
UP = Vector((0, 1, 0))
GOLDEN = math.pi * (3 - math.sqrt(5))


def along(path, t):
    at = min(1, max(0, t)) * (len(path) - 1)
    index = min(int(at), len(path) - 2)
    return path[index].lerp(path[index + 1], at - index)


def radial(angle):
    return Vector((math.cos(angle), 0, math.sin(angle)))


def bowed(a, b, bend, n):
    return [a.lerp(b, t) + bend * (4 * t * (1 - t)) for t in (i / n for i in range(n + 1))]


class Skeleton:
    def __init__(self):
        self.stems = []

    def tube(self, path, radii, sides, *unused):
        self.stems.append((path, radii, sides))


def inland_skeleton(skeleton, h, r, rng, variant):
    phase = rng.uniform(0, math.tau)
    lean = radial(phase + 1) * r * (.09, .16, .21)[variant]
    trunk_path = []
    for t in (0, .025, .085, .21, .37, .53, .63, .73, .83, .91, 1):
        p = UP * (-.12 + h * .95 * t) + lean * t ** 1.35
        p += radial(phase + .9) * math.sin(t * math.pi * 2) * r * .023
        if t > .52:
            p += radial(phase - .4) * (t - .52) * r * .34
        trunk_path.append(p)
    trunk_radius = h * (.0155, .017, .019)[variant]
    skeleton.tube(trunk_path, [trunk_radius * f for f in (1.65, 1.2, 1.04, .98, .89, .76, .65, .50, .34, .19, .035)], 13)
    branchlets = []
    for i in range(15):
        fraction = (i + rng.uniform(.12, .88)) / 15
        az = phase + i * GOLDEN + rng.uniform(-.41, .41)
        d, side = radial(az), radial(az + math.pi / 2)
        origin = along(trunk_path, .40 + .55 * fraction)
        # Older lower branches first droop, then turn up. Forked co-leaders
        # in the middle of the crown carry the younger irregular upper pads.
        reach = r * (.79 - .49 * fraction) * rng.uniform(.79, 1.19)
        rise = min(h * (1 - fraction) * .40 + .3, h * rng.uniform(.085, .18))
        tip = origin + d * reach + UP * rise
        bend = -UP * reach * rng.uniform(.08, .23) + side * reach * rng.uniform(-.13, .13)
        limb = bowed(origin, tip, bend, 5)
        br = trunk_radius * (.63 - .36 * fraction) * rng.uniform(.81, 1.26)
        skeleton.tube(limb, [br * f for f in (1, .76, .58, .40, .23, .07)], 6)
        for j in range(4):
            w = .30 + .64 * (j + rng.uniform(.15, .85)) / 4
            start = along(limb, w)
            direction = radial(az + (-1 if j % 2 else 1) * rng.uniform(.58, 1.23))
            span = reach * rng.uniform(.29, .53) * (1 - .36 * w)
            end = start + direction * span + UP * span * rng.uniform(.16, .50)
            p = bowed(start, end, -UP * span * .14 + d * span * .09, 3)
            br2 = br * (1 - .41 * w) * .50
            skeleton.tube(p, [br2, br2 * .66, br2 * .31, br2 * .07], 4)
            branchlets.append(p)
        branchlets.append(limb[-3:])
    # Broken branch stubs catch the light on the bare bole at playing height.
    for i in range(4 + variant):
        start = along(trunk_path, .24 + .17 * rng.random())
        end = start + radial(phase + i * GOLDEN) * rng.uniform(.20, .52) - UP * rng.uniform(.07, .24)
        skeleton.tube([start, end], [trunk_radius * .22, trunk_radius * .075], 5)
    return branchlets


def coastal_skeleton(skeleton, variant):
    # The approved wind-leaning, low-forked and sheltered scaffolds each
    # retain their own photographed limb layout and trunk inclination.
    s = variant_params('kust', variant)
    limbs = coastal_wood(s, True, s['height'], s['base'], *s['centre'], *s['half'], skeleton)
    return [p for p, _, _ in limbs]


def wood_mesh(skeleton, family, h, seed, hero):
    wood, rng = Wood(), random.Random(seed + 102)
    for path, radii, fine in skeleton.stems:
        sides = (3 if fine <= 4 else fine) if hero else max(3, round(fine * .58))
        if hero and fine <= 4 and len(path) == 4:
            path = [path[0], path[2], path[-1]]
            radii = [radii[0], radii[2], radii[-1]]
        if not hero and len(path) > 2:
            # Large forks keep their bend. Small branches keep their tip and
            # base and give the cheaper tier room for more translucent shoots.
            ids = list(range(0, len(path) - 1, 3 if fine <= 5 else 2)) + [len(path) - 1]
            path, radii = [path[i] for i in ids], [radii[i] for i in ids]
        wood.tube(path, radii, sides, 'coastal' if family == 'coastal' else 'pine', h, rng)
    # The legacy tube helper winds its faces toward the wood's centre.
    # These pines use front-facing bark, with radial normals on the same side.
    for i in range(0, len(wood.I), 3):
        wood.I[i + 1], wood.I[i + 2] = wood.I[i + 2], wood.I[i + 1]
    return dict(P=wood.P, N=wood.N, C=wood.C, U=wood.U, I=wood.I)


def foliage_sites(branches, r, seed):
    rng = random.Random(seed + 507)
    sites = []
    for limb in branches:
        tangent = (limb[-1] - limb[0]).normalized()
        side = tangent.cross(UP).normalized()
        length = (limb[-1] - limb[0]).length
        for q in range(9):
            u = .30 + .67 * (q + rng.random()) / 9
            root = along(limb, u)
            outward = (tangent * rng.uniform(.45, .87) + side * (-1 if q % 2 else 1) * rng.uniform(.65, 1.2)).normalized()
            reach = min(length * .71, r * .16) * rng.uniform(.46, 1.25)
            terminal = root + outward * reach + UP * reach * rng.uniform(.08, .44)
            # Condense into three-dimensional terminal shoots. Old inner
            # portions of branches remain bare against the sky.
            for k in range(4):
                d = (outward * rng.uniform(.62, 1.10) + side * rng.uniform(-.92, .92) + UP * rng.uniform(-.19, .76)).normalized()
                centre = root.lerp(terminal, .53 + .45 * k / 3) + d * r * rng.uniform(.015, .049)
                vigour = rng.uniform(.76, 1.22)
                sites.append((centre, d, side, vigour))
    rng.shuffle(sites)
    return sites


def crown_mesh(sites, wood, r, seed, budget, coastal):
    count = (budget - len(wood['I']) // 3) // 2
    if count <= 100:
        raise ValueError('Insufficient needle geometry budget')
    crown = dict(P=[], N=[], U=[], I=[])
    diameter = (6.4 if coastal else 6.8) * r / math.sqrt(count)
    rng = random.Random(seed + 202)
    for i in range(count):
        centre, axis, branch_side, vigour = sites[i % len(sites)]
        jitter = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
        size = diameter * vigour
        origin = centre + jitter * size * rng.uniform(.03, .17)
        aim = (axis + jitter * .54).normalized()
        # Sprays rise from either face of the bough. A card follows its shoot
        # axis, with oblique rolls so it keeps its shape from beneath a crown.
        n = (UP * rng.uniform(.1, .8) + branch_side * rng.uniform(-1.24, 1.24) + jitter * .51).normalized()
        width = aim.cross(n)
        if width.length < .04:
            width = aim.cross(branch_side)
        width.normalize()
        face = width.cross(aim).normalized()
        outward = Vector((origin.x, r * .18, origin.z)).normalized()
        width_scale = size * rng.uniform(.77, 1.17)
        cell, mirror = rng.randrange(4), rng.random() < .5
        start = len(crown['P'])
        for u, v in ((0, 0), (1, 0), (1, 1), (0, 1)):
            p = origin + width * ((u - .5) * width_scale) + aim * ((v - .33) * size)
            crown['P'].append(p)
            branch_normal = (p - centre + outward * size * .32).normalized()
            crown['N'].append((branch_normal * .56 + outward * .23 + face * .21).normalized())
            crown['U'].append(((cell % 2 + .02 + .96 * (1 - u if mirror else u)) / 2,
                               (cell // 2 + .98 - .96 * v) / 2))
        crown['I'].extend(start + j for j in (0, 1, 2, 0, 2, 3))
    return crown


def source_crown(variant):
    blob = (ROOT / variant['tiers']['hero']['file']).read_bytes()
    length = struct.unpack_from('<I', blob, 12)[0]
    gltf = json.loads(blob[20:20 + length])
    lo, hi = [], []
    for name in ('crown', 'trunk'):
        node = next(n for n in gltf['nodes'] if n['name'] == name)
        attr = gltf['meshes'][node['mesh']]['primitives'][0]['attributes']['POSITION']
        a = gltf['accessors'][attr]
        for dst, bound in ((lo, 'min'), (hi, 'max')):
            dst.append(Vector([v * s / 32767 + t for v, s, t in zip(a[bound], node['scale'], node['translation'])]))
    r0 = max(abs(p[k]) for p in lo + hi for k in (0, 2))
    sx = variant['templateRadius'] / r0
    sy = variant['templateHeight'] / max(p.y for p in hi)
    return [Vector((p.x * sx, p.y * sy, p.z * sx)) for p in (lo[0], hi[0])]


def fit(tree, bounds):
    crown = tree['crown']['P']
    source = [[min(p[k] for p in crown) for k in range(3)], [max(p[k] for p in crown) for k in range(3)]]
    ky = (bounds[1].y - bounds[0].y) / (source[1][1] - source[0][1])
    for part in (tree['trunk'], tree['crown']):
        for i, p in enumerate(part['P']):
            sx = bounds[p.x > 0].x / source[p.x > 0][0]
            sz = bounds[p.z > 0].z / source[p.z > 0][2]
            sy = ky if p.y >= source[0][1] else bounds[0].y / source[0][1]
            y = bounds[0].y + (p.y - source[0][1]) * ky if p.y >= source[0][1] else p.y * sy
            part['P'][i] = Vector((p.x * sx, y, p.z * sz))
            n = part['N'][i]
            part['N'][i] = Vector((n.x / sx, n.y / sy, n.z / sz)).normalized()


def ambient_normals(crown):
    quads = [tuple(range(i, i + 4)) for i in range(0, len(crown['P']), 4)]
    bvh = BVHTree.FromPolygons(crown['P'], quads)
    directions = [Vector((x, y, z)).normalized() for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    for quad in quads:
        centre = sum((crown['P'][i] for i in quad), Vector()) / 4
        open_light = Vector()
        for d in directions:
            hit, _, _, distance = bvh.ray_cast(centre + d * .09, d, 3)
            open_light += d * (1 if hit is None else .31 + .14 * distance)
        for i in quad:
            crown['N'][i] = (crown['N'][i] + open_light * .24).normalized()


def build(directory):
    directory.mkdir(parents=True, exist_ok=True)
    scene = bpy.data.scenes.new('Scots pine crown and branch studies')
    for family, manifest in [('inland', 'realistic-v2.json'), ('coastal', 'realistic-visby.json')]:
        entries = json.loads((ROOT / manifest).read_text(encoding='utf-8'))['species']
        models = next(s for s in entries if s['key'] == 'tall')['variants']
        for i, variant in enumerate(models):
            seed, h, r = variant['seed'], variant['templateHeight'], variant['templateRadius']
            skeleton = Skeleton()
            coastal = family == 'coastal'
            branches = coastal_skeleton(skeleton, i) if coastal else inland_skeleton(skeleton, h, r, random.Random(seed), i)
            sites = foliage_sites(branches, r, seed)
            for tier in ('hero', 'full'):
                wood = wood_mesh(skeleton, family, h, seed, tier == 'hero')
                crown = crown_mesh(sites, wood, r, seed, variant['tiers'][tier]['tris'], coastal)
                tree = dict(key=family, tier=tier, crown=crown, trunk=wood)
                fit(tree, source_crown(variant))
                ambient_normals(crown)
                preview(scene, tree, i * 27, (29 if tier == 'full' else 0) + (58 if coastal else 0))
                data = {}
                for name, part in [('crown', crown), ('trunk', wood)]:
                    data[name] = dict(position=flat(part['P'], 3), normal=flat(part['N'], 3),
                                      uv=flat(part['U'], 2), index=part['I'])
                data['trunk']['color'] = flat(wood['C'], 3)
                (directory / f'{family}-{i}-{tier}.json').write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    build(Path(sys.argv[sys.argv.index('--') + 1]))
