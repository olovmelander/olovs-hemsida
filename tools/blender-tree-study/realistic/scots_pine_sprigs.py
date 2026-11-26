"""Model Scots pine branchlets per region and bake colour and needle relief with Cycles."""
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sprig_atlas import Sprig, ensure_scene, material


def curve(a, b, bend, t):
    return a.lerp(b, t) + bend * (4 * t * (1 - t))


def needles(sp, a, b, bend, coastal, age, rng):
    axis = (b - a).normalized()
    radial = axis.cross(Vector((0, 0, 1))).normalized()
    depth = radial.cross(axis).normalized()
    phase = rng.random() * math.tau
    length = (b - a).length
    # A fascicle carries two curved needles. Basal wood remains visible where
    # old needles have shed, while this year's tips show a lighter flush.
    count = max(18, round(length * 305))
    for i in range(count):
        t = .05 + .93 * (i + rng.random()) / count
        if t < .32 and rng.random() < .50 * age:
            continue
        pos = curve(a, b, bend, t)
        phase += 2.39996
        needle_length = rng.uniform(.031, .055) * (1 - .23 * t) * (.89 if coastal else 1)
        splay = rng.uniform(.89, 1.2) - .25 * t
        tone = rng.uniform(.80, 1.03) * (.85 + .14 * t)
        flush = t > .83 and age < .35
        pigment = (.83 * tone, .92 * tone, (.78 if flush else .90) * tone)
        for angle in (phase - .19, phase + .19):
            fan = radial * math.cos(angle) + depth * math.sin(angle)
            direction = (axis * (.66 + .37 * t) + fan * splay).normalized()
            width_dir = direction.cross(Vector((0, 0, 1)))
            if width_dir.length < .01:
                width_dir = radial.copy()
            width_dir.normalize()
            mid = pos + direction * needle_length * .54 + fan * needle_length * .085
            tip = pos + direction * needle_length + axis * needle_length * .06
            half = width_dir * rng.uniform(.00155, .00245)
            # Fold the lamina slightly at its midrib; its two sides have
            # independent normals and the baked light-through follows the tip.
            ridge = direction.cross(width_dir).normalized() * half.length * .42
            indices = [sp.vert(pos, pigment, .50), sp.vert(mid - half, pigment, .76),
                       sp.vert(mid + ridge, tuple(min(1, c * 1.07) for c in pigment), .86),
                       sp.vert(mid + half, pigment, .76), sp.vert(tip, pigment, .94)]
            lo, left, middle, right, hi = indices
            sp.F.extend([(lo, left, middle), (lo, middle, right), (left, hi, middle), (middle, hi, right)])


def shoot(cell, coastal):
    rng = random.Random((83009 if coastal else 72019) + cell * 181)
    sp = Sprig()
    start = Vector((rng.uniform(.38, .59), .09, -.045))
    tip = Vector((rng.uniform(.32, .64), rng.uniform(.66, .79), rng.uniform(-.04, .10)))
    bend = Vector((rng.uniform(-.13, .13), .01, .025))
    stems, leafed = [(start, tip, bend, 1)], []
    # This is a metre-scale branch system with several growth years. Needles
    # occur on its recent shoots, never along the whole oldest limb. Unequal
    # fans sit to either side and shorten progressively along the parent.
    branch_count = 7 + cell % 3
    for j in range(branch_count):
        t = .10 + .82 * (j + rng.random()) / branch_count
        root = curve(start, tip, bend, t)
        side = 1 if j % 2 else -1
        end = root + Vector((side * rng.uniform(.20, .39) * (1 - .33 * t),
                             rng.uniform(.12, .23), rng.uniform(-.095, .11)))
        elbow = Vector((side * .018, -.018, rng.uniform(-.02, .03)))
        stems.append((root, end, elbow, .61))
        # Each terminal bud whorl divides into two to four short shoots. The
        # density lies in many small tufts with differing direction and age.
        for k in range(5):
            at = curve(root, end, elbow, .21 + .76 * (k + rng.random()) / 5)
            theta = rng.uniform(.2, 1.0) if k % 2 else rng.uniform(1.0, 2.25)
            d = Vector((side * math.cos(theta), math.sin(theta), rng.uniform(-.50, .56))).normalized()
            twig = at + d * rng.uniform(.052, .115)
            stems.append((at, twig, Vector((side * .005, -.005, .009)), .28))
            for bud in range(rng.randint(2, 4)):
                origin = at.lerp(twig, rng.uniform(.64, .98))
                turn = rng.uniform(-1.20, 1.20)
                heading = theta + turn
                direction = Vector((side * math.cos(heading), math.sin(heading), rng.uniform(-.59, .68))).normalized()
                length = rng.uniform(.056, .122) * (.90 if coastal else 1)
                leafed.append((origin, origin + direction * length,
                               Vector((side * .004, rng.uniform(-.01, .011), .008)), rng.uniform(0, .38)))
    for a, b, bend, age in stems + leafed:
        path = [curve(a, b, bend, t) for t in (0, .32, .67, 1)]
        r = .0014 + .0044 * age
        sp.tube(path, [r, r * .83, r * .65, r * .35], (.37, .28, .19), sides=4)
    for a, b, bend, age in leafed:
        needles(sp, a, b, bend, coastal, age, rng)
    return sp


def render(output):
    """Keep the approved 2×2 cell layout, including when an offline mesh uses this atlas."""
    sc = ensure_scene()
    sc.cycles.samples = 8
    mats = [(kind, material('Scots pine ' + kind, kind), view)
            for kind, view in [('colour', 'Standard'), ('normal', 'Raw')]]
    for family in ('inland', 'coastal'):
        objects = []
        for cell in range(4):
            sp = shoot(cell, family == 'coastal')
            lo = [min(v[d] for v in sp.V) for d in (0, 1)]
            hi = [max(v[d] for v in sp.V) for d in (0, 1)]
            scale = .94 / max(hi[0] - lo[0], hi[1] - lo[1])
            offset = Vector((-.5 + cell % 2 - (hi[0] + lo[0]) * scale / 2,
                             .5 - cell // 2 - (hi[1] + lo[1]) * scale / 2, 0))
            mesh = bpy.data.meshes.new(f'{family} fascicles {cell}')
            mesh.from_pydata([p * scale + offset for p in sp.V], [], sp.F)
            mesh.update()
            col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
            col.data.foreach_set('color', [v for rgba in sp.C for v in rgba])
            for poly in mesh.polygons:
                if poly.normal.z < 0:
                    poly.flip()
                poly.use_smooth = True
            obj = bpy.data.objects.new(mesh.name, mesh)
            sc.collection.objects.link(obj)
            objects.append(obj)
        for kind, mat, view in mats:
            for obj in objects:
                obj.data.materials.clear()
                obj.data.materials.append(mat)
            sc.view_settings.view_transform = view
            sc.view_settings.look = 'None'
            sc.render.filepath = str(output / f'{family}-{kind}.png')
            bpy.ops.render.render(write_still=True, scene=sc.name)
        for obj in objects:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)


if __name__ == '__main__':
    directory = Path(sys.argv[sys.argv.index('--') + 1])
    directory.mkdir(parents=True, exist_ok=True)
    render(directory)
