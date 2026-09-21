"""Photo-guided Kronholmen Scots pines. Run in background Blender via MCP.

Uses the original martall needle-shoot atlas and bounded mesh builder. No remeshing.
All tiers share their branch paths and foliage pads; roots stay at the origin.
"""
import bpy, sys, math, json, hashlib, copy
from pathlib import Path
from mathutils import Vector

assert bpy.app.background
bpy.context.preferences.filepaths.save_version = 0
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from pine_meshes import Mesh, material, linear, catmull
from martall_geometry import layout, woody_mesh, canopy, NAMES, PALETTE
from painted_blender_material import painted_material
from package_visby_references import pack_references

OUT = ROOT / 'apps/golf/public/models/trees'
ORIGINAL_COLOURS = '--original-colours' in sys.argv
ARCHIVE = ROOT / 'docs/graphics/visby-martall-2026-09-21'
REVISION = 'visby-martall-original-colours-2026-09-21' if ORIGINAL_COLOURS else 'visby-martall-2026-09-21'
DOC = ROOT / 'docs/graphics' / REVISION
(OUT / 'visby-pine').mkdir(parents=True, exist_ok=True)
DOC.mkdir(parents=True, exist_ok=True)
BUDGET = {'hero': 4500, 'full': 1700, 'lite': 420}
source = json.loads((OUT / 'ghibli-fluffy.json').read_text(encoding='utf-8'))
manifest = copy.deepcopy(source)
manifest['revision'] = REVISION
manifest['course'] = 'visby'
pine = next(s for s in manifest['species'] if s['key'] == 'tall')
pine['name'] = 'Kronholmen martall (Pinus sylvestris)'
pine['foliage']['key'] = 'tall' if ORIGINAL_COLOURS else 'martall'
pine['foliage']['atlas'] = json.loads((ARCHIVE / 'needle-atlas.json').read_text(encoding='utf-8'))
pine['variants'] = []
scene = bpy.context.scene
scene.name = 'Visby GK | Martallar - original colours' if ORIGINAL_COLOURS else 'Visby GK | Martallar 2026-09-21'
for ob in list(scene.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
atlas = bpy.data.images.load(str(OUT / pine['foliage']['atlas']['file']))
atlas.pack()
# Use the previous Blender study's tall material for the colour revision.
# Production uses the existing FOLIAGE_PALETTES.tall ramp in the application.
leaves = painted_material('Kronholmen martall', 0x427823 if ORIGINAL_COLOURS else PALETTE[1],
    atlas, palette=None if ORIGINAL_COLOURS else PALETTE)
bark = material('Kronholmen | Weathered grey and ochre bark', (1, 1, 1))
report = {'reference': 'https://www.visbygk.com/om-banorna/', 'blender': bpy.app.version_string,
          'budgets': BUDGET, 'variants': [], 'placement': 'Existing Visby pine roots and measured dimensions',
          'revision': REVISION, 'foliageKey': pine['foliage']['key'], 'originalColours': ORIGINAL_COLOURS}


for index, name in enumerate(NAMES):
    paths, pads = layout(index)
    rec = {'seed': 16000 + index * 100, 'name': name, 'tiers': {}, 'branchPaths': len(paths), 'foliageFans': len(pads)}
    for tier in BUDGET:
        wood = woody_mesh(paths, tier, original_colours=ORIGINAL_COLOURS)
        crown, uv = canopy(pads, tier, BUDGET[tier] - wood.triangles(), rec['seed'], original_colours=ORIGINAL_COLOURS)
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
                ob.location.x = (index - 1.5) * 16
        else:
            for ob in (co, to):
                bpy.data.objects.remove(ob, do_unlink=True)
        print('VISBY_PINE', index, tier, count, flush=True)
    pine['variants'].append(rec)
    report['variants'].append(rec)

tmp.unlink()
# Export for review; selecting an active runtime catalogue is a separate step.
(DOC / 'candidate-catalogue.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
floor = material('Warm limestone grass', linear(0xd4d8ba), vertex=False)
bpy.ops.mesh.primitive_plane_add(size=250)
ob = bpy.context.object; ob.name = 'Study ground'; ob.location.z = -.035; ob.data.materials.append(floor)
world = bpy.data.worlds.new('Baltic daylight'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.65, .74, .82, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .6; scene.world = world
sun = bpy.data.lights.new('Soft sun', 'SUN'); sun.energy = 2; sun.angle = .15
ob = bpy.data.objects.new(sun.name, sun); scene.collection.objects.link(ob)
ob.rotation_euler = Vector((10, 12, -22)).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.cameras.new('Pine review'); cam.type = 'ORTHO'; cam.ortho_scale = 66
ob = bpy.data.objects.new(cam.name, cam); scene.collection.objects.link(ob)
ob.location = (4, -65, 17); ob.rotation_euler = (Vector((2.5, 0, 4.5)) - ob.location).to_track_quat('-Z', 'Y').to_euler(); scene.camera = ob
scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.use_denoising = True
scene.cycles.transparent_max_bounces = 32
scene.render.resolution_x = 2400; scene.render.resolution_y = 820; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene['reference'] = report['reference']
scene['rebuild'] = str(HERE / 'visby_pine.py')
scene['note'] = 'Photo-guided coastal habit; no claim of surveyed individual specimen positions.'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
scene.render.filepath = str(DOC / 'blender-four-variants.png')
pack_references(scene, ARCHIVE)
bpy.ops.wm.save_as_mainfile(filepath=str(DOC / 'visby-coastal-pines.blend'))
(DOC / 'blender-build-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
bpy.ops.render.render(write_still=True)
# Portraits from both sides expose unsupported foliage or flattened geometry.
scene.render.resolution_x = 1400; scene.render.resolution_y = 1100
cam.ortho_scale = 14
for index, name in enumerate(NAMES):
    centre = Vector(((index - 1.5) * 16 + (3 if index in (0,2) else .5), 0, 3.7))
    ob = scene.camera
    ob.location = centre + Vector((1, -28, 5.5))
    ob.rotation_euler = (centre - ob.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(DOC / ('variant-%d.png' % index))
    bpy.ops.render.render(write_still=True)
    if index == 0:
        ob.location = centre + Vector((18, 19, 7))
        ob.rotation_euler = (centre - ob.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(DOC / 'hero-reverse.png')
        bpy.ops.render.render(write_still=True)
print('VISBY_PINE_COMPLETE', flush=True)
