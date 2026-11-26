"""Grow and light the playing-height tree catalogue in Blender.

From the repository root:
  blender -b -P tools/blender-tree-study/realistic/playing_height_trees.py -- <intermediate-directory>
  node tools/blender-tree-study/realistic/pack_playing_height.mjs <intermediate-directory>

Both tiers share the wood skeleton, shoot sites and measured template envelope.
Only template detail is authored here. Instance placement belongs to each course.
"""
import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from realistic_trees import Wood, flat, preview

UP = Vector((0, 1, 0))
# Stem diameter relative to height, fork height, original clean bole, scaffold
# count and relative crown breadth. Species' dimensions come from the catalogue.
HABIT = {
    'björk': dict(bark='birch', trunk=.016, fork=.29, base=.30, limbs=6, width=.82, droop=.94),
    'al': dict(bark='alder', trunk=.019, fork=.15, base=.20, limbs=5, width=.86, droop=.23),
    'ek': dict(bark='oak', trunk=.035, fork=.26, base=.30, limbs=6, width=.94, droop=.15),
    'gran': dict(bark='spruce', trunk=.016, base=.055),
}
GOLDEN = math.pi * (3 - math.sqrt(5))


def radial(azimuth):
    return Vector((math.cos(azimuth), 0, math.sin(azimuth)))


def arc(a, b, bend, count):
    return [a.lerp(b, t) + bend * (4 * t * (1 - t))
            for t in (i / count for i in range(count + 1))]


def along(path, fraction):
    u = min(len(path) - 1, max(0, fraction * (len(path) - 1)))
    j = min(int(u), len(path) - 2)
    return path[j].lerp(path[j + 1], u - j)


def broadleaf(key, height, radius, rng):
    h = HABIT[key]
    bark_radius = height * h['trunk']
    phase = rng.uniform(0, math.tau)
    lean = radial(phase) * rng.uniform(.09, .16) * radius
    foot = Vector((0, -.10, 0))
    bole_end = UP * height * (h['fork'] + .13) + lean * .35
    main = arc(foot, bole_end, radial(phase + 1.3) * .10 * radius, 6)
    wood = [(main, [bark_radius * v for v in (1.54, 1.1, 1, .94, .88, .78, .66)], 11, 7)]
    sprays = []
    for i in range(h['limbs']):
        az = phase + i * GOLDEN + rng.uniform(-.17, .17)
        outward, side = radial(az), radial(az + math.pi / 2)
        upright = i < 2
        root = along(main, rng.uniform(.54, .95))
        summit = rng.uniform(.89, .99) if upright else rng.uniform(.66, .88)
        span = radius * rng.uniform(.13, .47) if upright else radius * rng.uniform(.51, .82)
        tip = outward * span + UP * (height * summit) + lean
        elbow = side * rng.uniform(-.13, .13) * radius + outward * (radius * (.12 if key == 'ek' else .035))
        stem = arc(root, tip, elbow, 5)
        r = bark_radius * rng.uniform(.46, .68)
        wood.append((stem, [r * v for v in (1, .83, .66, .47, .26, .07)], 8, 5))
        # Unequal forks and branch order leave windows through each crown.
        for j in range(7):
            u = .14 + .82 * (j + rng.uniform(.1, .9)) / 7
            origin = along(stem, u)
            direction = radial(az + (-1 if j % 2 else 1) * rng.uniform(.42, 1.38))
            width = radius * h['width'] * (1 - .66 * u) * rng.uniform(.65, 1)
            end = origin + direction * width + UP * height * rng.uniform(.07, .19)
            end.y = min(height * (.99 if upright else .91), end.y)
            branch = arc(origin, end, UP * height * (.025 if key == 'ek' else .045)
                         + side * radius * rng.uniform(-.06, .06), 4)
            r2 = r * (1 - .57 * u) * .56
            wood.append((branch, [r2 * v for v in (1, .75, .51, .30, .06)], 4, 3))
            # The twig's atlas supplies its slender wood, including winter leaf
            # gaps between the larger limbs. Birch has distinct pendant sprays.
            for k in range(7):
                w = .24 + .75 * (k + rng.random()) / 7
                attach = along(branch, w)
                fan = radial(az + (-1 if k % 2 else 1) * rng.uniform(.55, 1.7))
                twig = (direction * .62 + fan * .83).normalized() * radius * rng.uniform(.09, .19)
                twig += UP * height * rng.uniform(-.055 * h['droop'], .045)
                endpoint = attach + twig
                endpoint.y = max(height * h['base'], endpoint.y)
                sprays.append((endpoint, twig.normalized(), rng.uniform(.75, 1.18), 'leaf'))
    return wood, sprays


def spruce(height, radius, rng):
    h = HABIT['gran']
    phase = rng.uniform(0, math.tau)
    apex = UP * height * .989 + radial(phase) * radius * rng.uniform(.025, .10)
    leader = arc(Vector((0, -.10, 0)), apex, radial(phase + 1.8) * .045 * radius, 12)
    bole = height * h['trunk']
    wood = [(leader, [bole * (1 - i / 12) ** .78 + .008 for i in range(13)], 9, 6)]
    sprays = []
    for whorl in range(17):
        t = .075 + .875 * (whorl + rng.random() * .4) / 17
        phase += rng.uniform(.46, 1.7)
        count = 5 if whorl < 12 else 4
        for j in range(count):
            az = phase + j * math.tau / count + rng.uniform(-.25, .25)
            forward, side = radial(az), radial(az + math.pi / 2)
            origin = along(leader, t + rng.uniform(-.012, .012))
            reach = radius * (1 - t) ** .86 * rng.uniform(.81, 1.08)
            rise = (t * .34 - .12) * reach
            end = origin + forward * reach + UP * rise
            # Lower boughs droop from weight, turning back up at their tips.
            axis = arc(origin, end, -UP * reach * (.135 - t * .07)
                       + side * reach * rng.uniform(-.10, .10), 3)
            r = max(.012, bole * (1 - t) * .27)
            wood.append((axis, [r, r * .67, r * .38, r * .08], 3, 3))
            for k in range(9):
                u = .08 + .90 * (k + rng.random()) / 9
                attach = along(axis, u)
                for sign in (-1, 1):
                    length = reach * (.08 + .16 * math.sin(math.pi * u)) * rng.uniform(.70, 1.05)
                    spray = (forward * .52 + side * sign * .84 - UP * (.77 - .56 * t)).normalized()
                    sprays.append((attach + spray * length, spray, .37 + .74 * (1 - t), 'needle'))
    # A slender leader of shoots, with needles above the end of the wood.
    for i in range(30):
        t = .89 + .109 * i / 29
        d = (radial(i * GOLDEN) * (.46 - .30 * (i / 29)) + UP).normalized()
        sprays.append((along(leader, t) + d * .18, d, .39 - .20 * i / 29, 'leader'))
    return wood, sprays


def build_wood(skeleton, spec, height, hero, seed):
    wood = Wood()
    bark_rng = random.Random(seed + 201)
    for path, radii, fine, coarse in skeleton:
        if not hero:
            keep = list(range(0, len(path) - 1, 2)) + [len(path) - 1]
            path, radii = [path[j] for j in keep], [radii[j] for j in keep]
        wood.tube(path, radii, fine if hero else coarse, spec['bark'], height, bark_rng)
    return dict(P=wood.P, N=wood.N, C=wood.C, U=wood.U, I=wood.I)


def grow_cards(sites, wood, key, height, radius, limit, seed):
    # Each card has its own seed; both tiers sample the same branch population.
    count = (limit - len(wood['I']) // 3) // 2
    if count <= 0:
        raise ValueError('wood exceeds triangle budget')
    rng = random.Random(seed + 302)
    centres = list(sites)
    rng.shuffle(centres)
    crown = dict(P=[], N=[], U=[], I=[])
    compact = 1 / math.sqrt(count)
    for i in range(count):
        # Keep the thin spruce leader in both tiers even with a smaller budget.
        site = sites[-1 - i] if key == 'gran' and i < 30 else centres[i % len(centres)]
        pos, branch, vigour, kind = site
        radial_n = Vector((pos.x, (pos.y - height * .6) * radius / height * 2, pos.z)).normalized()
        jitter = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
        side = branch.cross(UP)
        if side.length < .05:
            side = radial(i * GOLDEN)
        side.normalize()
        if kind == 'leaf':
            diameter = radius * compact * (9.8 if key == 'björk' else 7.3) * vigour
            pos = pos + (jitter + radial_n * .30) * diameter * .28
            direction = (branch + jitter * .64 - UP * HABIT[key]['droop']).normalized()
            normal = (radial_n * .58 + jitter * .65 + UP * .33).normalized()
            aspect = rng.uniform(.77, 1.07)
        else:
            diameter = radius * compact * 12.6 * vigour
            pos = pos + side * rng.uniform(-.15, .15) * diameter
            direction = (branch + side * rng.uniform(-.33, .33) - UP * (.19 if kind == 'needle' else 0)).normalized()
            normal = (side * rng.uniform(-.83, .83) + UP * .80 + radial_n * .46).normalized()
            aspect = rng.uniform(.81, 1.10)
        width = direction.cross(normal)
        if width.length < .02:
            width = side
        width.normalize()
        face = width.cross(direction).normalized()
        cell = rng.randrange(4)
        mirror = rng.random() < .5
        start = len(crown['P'])
        for u,v in ((0,0), (1,0), (1,1), (0,1)):
            p = pos + width * ((u - .5) * diameter * aspect) + direction * ((v - .30) * diameter)
            outward = (p - pos + radial_n * diameter * .24).normalized()
            crown['P'].append(p)
            crown['N'].append((outward * .53 + radial_n * .31 + face * .16).normalized())
            crown['U'].append(((cell % 2 + .02 + .96 * (1-u if mirror else u)) * .5,
                               (cell // 2 + .98 - v * .96) * .5))
        crown['I'].extend(start + j for j in (0,1,2,0,2,3))
    return crown


def fit(parts, height, radius):
    positions = [p for part in parts for p in part['P']]
    ky = height / max(p.y for p in positions)
    kh = radius / max(max(abs(p.x), abs(p.z)) for p in positions)
    for part in parts:
        part['P'] = [Vector((p.x * kh, p.y * ky, p.z * kh)) for p in part['P']]
        part['N'] = [Vector((n.x / kh, n.y / ky, n.z / kh)).normalized() for n in part['N']]


def light_canopy(crown):
    # Integrate exterior visibility at the sprig centre, along the six axial
    # and eight diagonal directions. Count up to three translucent layers.
    faces = [tuple(range(i, i + 4)) for i in range(0, len(crown['P']), 4)]
    bvh = BVHTree.FromPolygons(crown['P'], faces)
    directions = [Vector((a,b,c)).normalized() for a in (-1,0,1) for b in (-1,0,1) for c in (-1,0,1)
                  if abs(a)+abs(b)+abs(c) in (1,3)]
    for face in faces:
        centre = sum((crown['P'][i] for i in face), Vector()) / 4
        moment = Vector()
        for d in directions:
            origin = centre + d * .09
            visibility = 1.0
            for _ in range(3):
                hit, _, _, _ = bvh.ray_cast(origin, d, 5.0)
                if hit is None:
                    break
                visibility *= .55
                origin = hit + d * .12
            moment += d * visibility
        for i in face:
            crown['N'][i] = (crown['N'][i] + moment * .31).normalized()


def build(outdir):
    outdir.mkdir(parents=True, exist_ok=True)
    source = Path('apps/golf/public/models/trees/realistic-v2.json')
    scene = bpy.data.scenes.new('Banvy playing-height woodland')
    for row, species in enumerate(json.loads(source.read_text(encoding='utf-8'))['species']):
        key = species['key']
        if key not in HABIT:
            continue
        for index, variant in enumerate(species['variants']):
            height, radius, seed = variant['templateHeight'], variant['templateRadius'], variant['seed']
            rng = random.Random(seed)
            skeleton, sites = spruce(height, radius, rng) if key == 'gran' else broadleaf(key, height, radius, rng)
            for tier in ('hero','full'):
                wood = build_wood(skeleton, HABIT[key], height, tier == 'hero', seed)
                crown = grow_cards(sites, wood, key, height, radius, variant['tiers'][tier]['tris'], seed)
                fit((wood,crown), height, radius)
                light_canopy(crown)
                tree = dict(key=key, tier=tier, crown=crown, trunk=wood)
                preview(scene, tree, row * 26.0, index * 56 + (0 if tier == 'hero' else 28))
                data = {}
                for name in ('trunk','crown'):
                    part = tree[name]
                    data[name] = dict(position=flat(part['P'],3), normal=flat(part['N'],3),
                                      uv=flat(part['U'],2), index=part['I'])
                    if name == 'trunk':
                        data[name]['color'] = flat(part['C'],3)
                target = outdir / f'{key}-{index}-{tier}.json'
                target.write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')


if __name__ == '__main__':
    build(Path(sys.argv[sys.argv.index('--')+1]))
