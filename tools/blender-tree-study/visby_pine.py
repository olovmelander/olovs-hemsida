"""Photo-guided Kronholmen Scots pines. Run in background Blender via MCP.

Uses the existing painted needle atlas and bounded mesh builder. No remeshing.
All tiers share their branch paths and foliage pads; roots stay at the origin.
"""
import bpy, sys, math, json, hashlib, copy
from pathlib import Path
from mathutils import Vector

assert bpy.app.background
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from pine_meshes import Mesh, material, linear, catmull
from branch_canopies import make_branch_canopy
from painted_blender_material import painted_material

OUT = ROOT / 'apps/golf/public/models/trees'
DOC = ROOT / 'docs/graphics/visby-coastal-pine-2026-09-16'
(OUT / 'visby-pine').mkdir(parents=True, exist_ok=True)
DOC.mkdir(parents=True, exist_ok=True)
BUDGET = {'hero': 4500, 'full': 1700, 'lite': 420}
source = json.loads((OUT / 'ghibli-fluffy.json').read_text(encoding='utf-8'))
manifest = copy.deepcopy(source)
manifest['revision'] = 'visby-coastal-pine-2026-09-16'
manifest['course'] = 'visby'
pine = next(s for s in manifest['species'] if s['key'] == 'tall')
pine['name'] = 'Kronholmen coastal Scots pine (Pinus sylvestris)'
pine['variants'] = []
scene = bpy.context.scene
scene.name = 'Visby GK | Coastal Scots pines'
for ob in list(scene.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
atlas = bpy.data.images.load(str(OUT / pine['foliage']['atlas']['file']))
atlas.pack()
leaves = painted_material('Kronholmen pine', 0x427823, atlas)
bark = material('Kronholmen | Weathered grey and ochre bark', (1, 1, 1))
report = {'reference': 'https://www.visbygk.com/om-banorna/', 'blender': bpy.app.version_string,
          'budgets': BUDGET, 'variants': [], 'placement': 'Existing Visby pine roots and measured dimensions'}


def layout(index):
    # +X is the downwind lean. Model dimensions are artistic proportions,
    # not measurements of the unlocated specimen in the club photograph.
    lean = [1.0, .60, .28][index]
    hscale = [1.0, 1.08, 1.17][index]
    def p(x, y, z):
        return Vector((x - (1 - lean) * z * .45, y, z * hscale))
    trunk = [p(0, 0, 0), p(.60, .04, 1.55), p(1.65, -.12, 3.10), p(2.55, 0, 4.45)]
    paths = [(trunk, .46, .23)]
    # Uneven scaffolds: broad flattened crown, lower downwind reach, visible
    # negative space under the canopy, and upward needle sprays at the tips.
    tips = [(-1.35, -.25, 6.20), (.40, .65, 7.40), (2.15, .15, 8.00),
            (3.95, .35, 7.60), (5.55, -.40, 6.70), (7.10, -.10, 5.15),
            (1.50, -2.50, 6.55), (4.45, -2.40, 6.25), (2.25, 2.65, 6.85),
            (5.25, 2.00, 6.25)]
    pads = []
    for j, (x, y, z) in enumerate(tips):
        end = p(x, y, z)
        root = trunk[2] if j in (0, 5, 6) else trunk[3]
        elbow = root.lerp(end, .57) + Vector((-.15, .13 * math.sin(j), -.38))
        paths.append(([root, elbow, end - Vector((0, 0, .20))], .18 if j < 6 else .12, .035))
        radius = Vector(([1.80, 1.86, 1.85, 1.85, 1.95, 1.90, 1.62, 1.74, 1.78, 1.66][j],
                         1.35 if j < 6 else 1.45, .80 if j != 2 else .91))
        pads.append((end, radius, 16000 + index * 100 + j, .12 * math.sin(j)))
        # A smaller fork supports the edge of each foliage platform.
        tip = end + Vector((.65, (-1 if j % 2 else 1) * .52, .12))
        paths.append(([elbow, end.lerp(tip, .6), tip], .067, .012))
    if index == 1:
        paths.append(([p(.05, .12, 0), p(-.40, .35, 2.5), p(-.10, .5, 4.8), p(.40, .65, 7.4)], .28, .065))
    return paths, pads


def woody_mesh(paths, tier):
    m = Mesh()
    for i, (path, r0, r1) in enumerate(paths):
        if tier == 'lite' and (r0 < .15 or i > 12):
            continue
        if tier == 'full' and r0 < .10:
            continue
        points = catmull(path, 3 if tier == 'hero' else 2 if tier == 'full' else 1)
        if tier == 'lite':
            points = [points[0], points[len(points)//2], points[-1]]
        sides = {'hero': 8 if r0 > .2 else 5, 'full': 6 if r0 > .2 else 4, 'lite': 4}[tier]
        rows = []
        for k, c in enumerate(points):
            t = k / (len(points) - 1)
            axis = (points[min(k+1, len(points)-1)] - points[max(0, k-1)]).normalized()
            u = axis.cross(Vector((0, 1, 0))).normalized()
            v = axis.cross(u).normalized()
            radius = r0 * (1 - t) + r1 * t
            radius *= 1 + .24 * math.exp(-max(c.z, 0) * 4)
            row = []
            for j in range(sides):
                a = j * math.tau / sides
                n = u * math.cos(a) + v * math.sin(a)
                q = c + n * radius * (1 + .06 * math.sin(a * 5 + c.z * 2))
                q.z = max(0, q.z)
                # Grey fissured base grades into muted warm upper branches.
                warm = min(.75, max(0, (q.z - 2.5) / 6))
                low, high = linear(0x605a49), linear(0xaa8056)
                ridge = .82 + .18 * math.sin(a * 3.0 + q.z * .8) ** 2
                colour = tuple((a + (b-a) * warm) * ridge for a, b in zip(low, high))
                row.append(m.vert(q, n, colour))
            rows.append(row)
        for a, b in zip(rows, rows[1:]):
            for j in range(sides):
                m.faces.append((a[j], a[(j+1)%sides], b[(j+1)%sides], b[j]))
        m.faces.extend([tuple(reversed(rows[0])), tuple(rows[-1])])
    return m


for index, name in enumerate(['Wind leaning', 'Forked coastal', 'Sheltered upright']):
    paths, pads = layout(index)
    rec = {'seed': 16000 + index * 100, 'name': name, 'tiers': {}}
    for tier in BUDGET:
        wood = woody_mesh(paths, tier)
        crown, uv = make_branch_canopy(pads, tier, BUDGET[tier] - wood.triangles(), 'tall', rec['seed'], 10)
        count = crown.triangles() + wood.triangles()
        assert count <= BUDGET[tier], (index, tier, count)
        co = crown.object('crown', leaves, scene.collection)
        to = wood.object('trunk', bark, scene.collection)
        layer = co.data.uv_layers.new(name='UVMap')
        for loop in co.data.loops:
            layer.data[loop.index].uv = uv[loop.vertex_index]
        bpy.ops.object.select_all(action='DESELECT')
        co.select_set(True); to.select_set(True)
        bpy.context.view_layer.objects.active = co
        tmp = DOC / 'export.glb'
        bpy.ops.export_scene.gltf(filepath=str(tmp), export_format='GLB', use_selection=True,
            export_yup=True, export_apply=True, export_normals=True, export_texcoords=True,
            export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='NONE',
            export_cameras=False, export_lights=False, export_animations=False, export_skins=False, export_morph=False)
        data = tmp.read_bytes(); sha = hashlib.sha256(data).hexdigest()
        file = 'visby-pine/' + sha + '.glb'
        (OUT / file).write_bytes(data)
        rec['tiers'][tier] = {'file': file, 'bytes': len(data), 'sha256': sha, 'tris': count}
        if tier == 'hero':
            rec['templateHeight'] = max(v.co.z for ob in (co, to) for v in ob.data.vertices)
            rec['templateRadius'] = max(max(abs(v.co.x), abs(v.co.y)) for ob in (co, to) for v in ob.data.vertices)
            for ob in (co, to):
                ob.name = name + ' | ' + ob.name
                ob.location.x = (index - 1) * 18
        else:
            for ob in (co, to):
                bpy.data.objects.remove(ob, do_unlink=True)
        print('VISBY_PINE', index, tier, count, flush=True)
    pine['variants'].append(rec)
    report['variants'].append(rec)

tmp.unlink()
(OUT / 'ghibli-visby.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
floor = material('Warm limestone grass', linear(0xd4d8ba), vertex=False)
bpy.ops.mesh.primitive_plane_add(size=250)
ob = bpy.context.object; ob.name = 'Study ground'; ob.location.z = -.035; ob.data.materials.append(floor)
world = bpy.data.worlds.new('Baltic daylight'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.65, .74, .82, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .6; scene.world = world
sun = bpy.data.lights.new('Soft sun', 'SUN'); sun.energy = 2; sun.angle = .15
ob = bpy.data.objects.new(sun.name, sun); scene.collection.objects.link(ob)
ob.rotation_euler = Vector((10, 12, -22)).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.cameras.new('Pine review'); cam.type = 'ORTHO'; cam.ortho_scale = 57
ob = bpy.data.objects.new(cam.name, cam); scene.collection.objects.link(ob)
ob.location = (8, -65, 22); ob.rotation_euler = (Vector((2.5, 0, 4.5)) - ob.location).to_track_quat('-Z', 'Y').to_euler(); scene.camera = ob
scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.use_denoising = True
scene.cycles.transparent_max_bounces = 32
scene.render.resolution_x = 1800; scene.render.resolution_y = 780; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene['reference'] = report['reference']
scene['rebuild'] = str(HERE / 'visby_pine.py')
scene['note'] = 'Photo-guided coastal habit; no claim of surveyed individual specimen positions.'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
scene.render.filepath = str(DOC / 'blender-three-variants.png')
bpy.ops.wm.save_as_mainfile(filepath=str(DOC / 'visby-coastal-pines.blend'))
(DOC / 'blender-build-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
bpy.ops.render.render(write_still=True)
print('VISBY_PINE_COMPLETE', flush=True)
